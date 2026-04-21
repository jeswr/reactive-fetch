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

    const pending: Promise<string> = (async () => {
      try {
        await restorePromise;
        if (session.isActive && session.webId) return session.webId;

        await openLoginPopup({ callbackUrl });
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
      await restorePromise;
      if (session.isActive) {
        return authFetch(session, input, init);
      }

      const { request, retry } = prepareRetryable(input, init);
      const response = await globalThis.fetch(request);
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
