import { createSessionBootstrap, ensureRestored, authFetch } from './session.js';
import { openLoginPopup } from './popup.js';

export * from './errors.js';

export interface ReactiveFetchOptions {
  clientId: string;
  callbackUrl: string;
}

export interface ReactiveFetch {
  readonly webId: Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

/**
 * Build a reactive authenticated fetch over `@uvdsl/solid-oidc-client-browser`.
 *
 * Browser-only. Constructing this in a Node/SSR environment will throw —
 * the underlying Session keeps its DPoP keypair and refresh token in
 * IndexedDB, and a shared Node process would leak that state across user
 * requests. In Next.js / Remix / SvelteKit either wrap the construction
 * in `typeof window !== 'undefined'`, mount it inside `useEffect`, or
 * dynamic-import the module from a `"use client"` boundary.
 *
 * Reading `rf.webId` or calling `rf.fetch()` that ends up needing login
 * MUST happen directly inside a user-gesture stack frame (e.g. a click
 * handler). `window.open` cannot be called across `await` boundaries
 * without losing the gesture and being blocked — any `setTimeout(() =>
 * rf.webId)` shape will be blocked by Chromium's popup blocker.
 *
 * @throws if invoked outside a browser (no `window` or no `indexedDB`).
 */
export function createReactiveFetch(options: ReactiveFetchOptions): ReactiveFetch {
  const { clientId, callbackUrl } = options;
  const { session } = createSessionBootstrap(clientId);

  // Attempt to restore any session persisted in IndexedDB before any path
  // could decide to open a popup. Swallowed at construction so a missing
  // or invalid refresh token doesn't make the factory unusable; isActive
  // stays false and the login popup will run on first demand.
  const restorePromise = ensureRestored(session).catch(() => undefined);

  let loginPromise: Promise<string> | null = null;

  const ensureLoggedIn = (): Promise<string> => {
    if (loginPromise) return loginPromise;

    // Fast path: restore already flipped isActive true, no popup needed.
    // Checked synchronously so a click handler that never reaches
    // openLoginPopup keeps its user-gesture credits intact.
    if (session.isActive && session.webId) {
      return Promise.resolve(session.webId);
    }

    // Slow path: open the popup synchronously from this call stack.
    // Any `await` before `window.open` burns the user-gesture budget and
    // Chromium's popup blocker refuses the request — which is exactly
    // what the prior shape (`await restorePromise` first) hit in e2e.
    // Trade-off: if restorePromise was about to succeed, we briefly open
    // a redundant popup. Acceptable — any shape that defers window.open
    // past an await cannot work in strict popup-blocker browsers.
    const popupPromise = openLoginPopup({ callbackUrl });

    const pending: Promise<string> = (async () => {
      try {
        await popupPromise;
        await ensureRestored(session);
        if (!session.isActive || !session.webId) {
          throw new Error('Session did not become active after login.');
        }
        return session.webId;
      } finally {
        loginPromise = null;
      }
    })();

    loginPromise = pending;
    return pending;
  };

  const rf: ReactiveFetch = {
    get webId() {
      return ensureLoggedIn();
    },
    async fetch(input, init) {
      if (session.isActive) {
        return authFetch(session, input, init);
      }

      // Send the unauthenticated attempt synchronously so that if a 401
      // lands and we need to trigger login, the caller's user-gesture
      // credit still stretches to the window.open call below.
      const { request, retry } = prepareRetryable(input, init);
      const responsePromise = globalThis.fetch(request);

      await restorePromise;
      if (session.isActive) {
        const response = await responsePromise;
        if (response.status !== 401) return response;
        return authFetch(session, retry.input, retry.init);
      }

      const response = await responsePromise;
      if (response.status !== 401) return response;

      await ensureLoggedIn();
      return authFetch(session, retry.input, retry.init);
    },
  };

  return rf;
}

interface Retryable {
  request: Request;
  retry: { input: RequestInfo | URL; init?: RequestInit };
}

function prepareRetryable(input: RequestInfo | URL, init?: RequestInit): Retryable {
  if (input instanceof Request) {
    const first = input.clone();
    const second = input.clone();
    return {
      request: first,
      retry: { input: second, init },
    };
  }

  if (init?.body && isConsumableBody(init.body)) {
    const request = new Request(input, init);
    return {
      request: request.clone(),
      retry: { input: request.clone() },
    };
  }

  return {
    request: new Request(input, init),
    retry: { input, init },
  };
}

function isConsumableBody(body: BodyInit): boolean {
  return (
    body instanceof ReadableStream ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}
