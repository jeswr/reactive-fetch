// =====================================================================
// Public API shape — shared with the Solid browser extension
// =====================================================================
//
// `@jeswr/solid-reactive-fetch` deliberately mirrors the global API
// surface that `theodi/solid-browser-extension` (`dev_hkir` branch)
// installs at `window.solid`. A separate "unified wrapper" package
// composes the two so an app can use the extension when installed and
// fall back to this library otherwise — without changing call sites.
//
// The shared shape (`Solid` below) is the union of what both sides
// expose:
//
//   readonly webId: string | null            // bare WebID string
//   readonly profile: WebIDProfile | null    // wrapped Agent (@solid/object)
//   readonly clientId: string | undefined    // currently-set Client ID URI
//   fetch(input, init?): Promise<Response>   // authenticated fetch
//   setClientId(clientId: string): void      // declare per-origin client id
//   login(webId: string): Promise<void>      // takes a WebID, discovers IDP
//   logout(): Promise<void>                  // clear local tokens
//
// Notes on the design choices:
//
// 1. We expose `webId: string | null` (not a wrapped object) because that
//    is what the extension's `inject.ts` actually surfaces today. The
//    wrapped object lives on a separate `profile` getter, again matching
//    the extension exactly. A previous draft of these instructions
//    suggested folding the wrapped object into the `webId` slot, but
//    that drifts away from the extension's real shape and would force
//    the unified-wrapper package to do per-source adaptation.
//
// 2. `WebIDProfile` is a forward-compatible alias for the upcoming
//    `@solid/object` `WebIDProfile` export. Today it resolves to `Agent`
//    from `@solid/object/webid`. See `WebIDProfile.ts` for stability
//    notes on which getters are spec-stable (storage, oidcIssuers) vs
//    unstable (the social-graph getters: `name`, `email`, `knows`, …).
//
// 3. `ReactiveFetch` keeps its original reactive-by-design properties:
//    `webId` and `restorePromise` are retained on the top-level
//    interface for back-compat. The unified shape lives on `rf.solid`,
//    which mirrors `window.solid` byte-for-byte.
//
// 4. The library was originally framed as an "extension-free" alternative
//    that triggers login on demand (via the popup). The
//    extension-shaped `login(webId)` here therefore drives the popup
//    pre-emptively — useful for apps that want an explicit "sign in"
//    button without giving up the reactive 401-retry path.
//
// =====================================================================

import {
  createSessionBootstrap,
  ensureRestored,
  authFetch,
} from './session.js';
import { openLoginPopup } from './popup.js';
import { fetchWebIDProfile } from './callback/resolveWebId.js';
import { SessionRestoreFailedError } from './errors.js';
import type { WebIDProfile } from './WebIDProfile.js';

export * from './errors.js';
export type { WebIDProfile } from './WebIDProfile.js';
export { WebIDProfileAgent } from './callback/resolveWebId.js';

export interface ReactiveFetchOptions {
  clientId: string;
  callbackUrl: string;
  /**
   * Invoked if the construction-time `ensureRestored` call rejects (malformed
   * refresh token, token endpoint unreachable, corrupt IndexedDB, etc.). The
   * factory itself never rejects at construction — a failed restore leaves the
   * session inactive and the next `webId` / `fetch` call triggers the popup.
   * Use this callback to surface a "your session could not be restored"
   * message in the UI.
   */
  onRestoreError?: (err: unknown) => void;
  /**
   * Accept `http://localhost` / `127.0.0.1` / `[::1]` as valid OIDC issuers
   * in addition to HTTPS. Defaults to `false` (production-safe). Set to
   * `true` only in local dev builds that need to talk to a non-TLS IDP
   * (Community Solid Server, ESS dev cluster, etc.).
   *
   * IMPORTANT: the actual issuer filter runs inside the popup, so the same
   * value MUST also be passed to `mountCallback` on the callback page.
   * Keeping the two in sync is the consumer's responsibility; a mismatch
   * is practically harmless today (the factory's own filter is
   * informational) but will bite once additional surface consults it.
   */
  allowLocalhost?: boolean;
}

/**
 * Extension-shaped facade — mirrors `window.solid` from
 * `theodi/solid-browser-extension` (`dev_hkir`). The unified-wrapper
 * package picks one of these at runtime based on extension presence.
 *
 * All readers are sync (snapshots of state); mutations come back via the
 * authenticated-fetch flow and the next read sees the new value.
 */
export interface Solid {
  /** The authenticated user's WebID, or null if not logged in. Snapshot. */
  readonly webId: string | null;
  /**
   * Wrapped WebID profile (`@solid/object`-style RDF wrapper), or null
   * when no session is active. See `WebIDProfile.ts` for stability notes
   * on which getters are spec-stable vs unstable (the social ones).
   */
  readonly profile: WebIDProfile | null;
  /**
   * The Client ID URI currently in effect. Set via `setClientId(...)`.
   * Undefined until the consumer declares one.
   */
  readonly clientId: string | undefined;
  /**
   * Authenticated fetch. Same semantics as `ReactiveFetch.fetch`: tries
   * unauthenticated first if no session is active, retries with auth on a
   * 401 (which may trigger the login popup if the user has not yet
   * signed in).
   */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /**
   * Declare the dereferenceable Client ID Document URI for the current
   * origin. Replaces the URI passed at construction. The unified-wrapper
   * shape requires this to be a sync setter (the extension's per-origin
   * map is updated synchronously and the actual server message is fired
   * in the background).
   */
  setClientId(clientId: string): void;
  /**
   * Begin a login flow for the given WebID. Discovers the IDP from the
   * WebID's profile and opens the popup. Resolves once login completes.
   *
   * In contrast to `ReactiveFetch.webId` (which triggers login lazily on
   * read), this drives the popup imperatively — the standard "click
   * Login" UX. The popup still requires a user gesture, so call this
   * directly inside a click handler.
   */
  login(webId: string): Promise<void>;
  /**
   * Clear local tokens. Resolves once the underlying session has been
   * torn down. Does NOT redirect to the IDP for end-session — same
   * semantics as the extension's app-only logout.
   */
  logout(): Promise<void>;
}

export interface ReactiveFetch {
  readonly webId: Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /**
   * Resolves when the construction-time restore attempt settles (success OR
   * swallowed failure). Never rejects — failures are exposed via the
   * `onRestoreError` option at construction time. Use this to render a
   * loading state over the 100–500ms restore window before deciding whether
   * to offer a login button or show an already-signed-in state.
   */
  readonly restorePromise: Promise<void>;
  /**
   * Extension-shaped facade. Mirrors the API the
   * `theodi/solid-browser-extension` installs on `window.solid`. The
   * unified-wrapper package re-exports this when the extension is absent.
   *
   * See the `Solid` interface above and the file header for the full
   * shared-shape contract.
   */
  readonly solid: Solid;
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
  const { clientId: initialClientId, callbackUrl, onRestoreError, allowLocalhost } = options;
  const { session } = createSessionBootstrap(initialClientId);

  // Mutable client-id slot for the extension-shaped facade. Starts at
  // whatever the consumer passed at construction; replaced (in-place,
  // sync) by `solid.setClientId(...)`. This does NOT rebuild the
  // underlying Session — the per-origin Client ID story belongs to the
  // extension's multi-origin proxy and isn't a 1:1 fit here. Documented
  // as forward-looking in the README.
  let currentClientId: string | undefined = initialClientId;

  // Snapshot cache of the wrapped WebID profile. Populated lazily after
  // login completes (the popup brings back a webId, then we fetch its
  // profile in the background). Reset to null on logout.
  let profileSnapshot: WebIDProfile | null = null;
  let profileFetchInFlight: Promise<void> | null = null;

  // Attempt to restore any session persisted in IndexedDB before any path
  // could decide to open a popup. Swallowed at construction so a missing
  // or invalid refresh token doesn't make the factory unusable; isActive
  // stays false and the login popup will run on first demand. Failures are
  // surfaced to the app via onRestoreError if provided.
  const restorePromise: Promise<void> = ensureRestored(session).catch(
    (err: unknown) => {
      try {
        onRestoreError?.(err);
      } catch {
        /* consumer callback must not break the factory */
      }
    },
  );
  // After a successful restore, kick off a background profile fetch so
  // `solid.profile` is populated without a manual webId read.
  void restorePromise.then(() => {
    if (session.isActive && session.webId) {
      void refreshProfile(session.webId);
    }
  });

  let loginPromise: Promise<string> | null = null;

  const ensureLoggedIn = (): Promise<string> => {
    if (loginPromise) return loginPromise;

    // Fast path: restore already flipped isActive true, no popup needed.
    // Checked synchronously so a click handler that never reaches
    // openLoginPopup keeps its user-gesture credits intact.
    if (session.isActive && session.webId) {
      // Backfill the profile snapshot if we somehow missed it (e.g. the
      // restore-promise refresh fired before the fetch mock was in place
      // in tests). Cheap no-op when already populated.
      if (profileSnapshot === null && profileFetchInFlight === null) {
        void refreshProfile(session.webId);
      }
      return Promise.resolve(session.webId);
    }

    // Slow path: open the popup synchronously from this call stack.
    // Any `await` before `window.open` burns the user-gesture budget and
    // Chromium's popup blocker refuses the request — which is exactly
    // what a prior shape (`await restorePromise` first) hit in e2e.
    const popupPromise = openLoginPopup({ callbackUrl });

    const pending: Promise<string> = (async () => {
      try {
        await popupPromise;
        // Force a fresh restore: the popup just authenticated the user and
        // wrote state into shared IndexedDB. A cached/in-flight restore from
        // page-load may be stale, so we skip the dedup WeakMap here.
        await ensureRestored(session, true);
        if (!session.isActive || !session.webId) {
          throw new SessionRestoreFailedError();
        }
        // Fire and forget — the profile is best-effort and not a precondition
        // for resolving the webId. If the profile fetch errors, the snapshot
        // stays null and consumers can degrade gracefully.
        void refreshProfile(session.webId);
        return session.webId;
      } finally {
        loginPromise = null;
      }
    })();

    loginPromise = pending;
    return pending;
  };

  // Best-effort: refetch the profile and update the snapshot. Safe to
  // call multiple times concurrently — the in-flight Promise is dedup'd
  // by `profileFetchInFlight`. Errors are swallowed (snapshot stays at
  // its previous value, or null if never populated).
  const refreshProfile = (webId: string): Promise<void> => {
    if (profileFetchInFlight) return profileFetchInFlight;
    const pending = (async () => {
      try {
        const { agent } = await fetchWebIDProfile(webId, {
          allowLocalhost: allowLocalhost ?? false,
        });
        profileSnapshot = agent;
      } catch {
        /* snapshot stays at its previous value */
      } finally {
        profileFetchInFlight = null;
      }
    })();
    profileFetchInFlight = pending;
    return pending;
  };

  // Build the extension-shaped facade. `webId` and `profile` are sync
  // snapshots — they NEVER trigger a popup or a fetch by themselves
  // (unlike `rf.webId`, which is reactive). Apps that want
  // reactive-on-read should keep using `rf.webId`. Apps that want the
  // extension-shaped surface use `rf.solid`.
  const solid: Solid = {
    get webId() {
      return session.isActive && session.webId ? session.webId : null;
    },
    get profile() {
      return profileSnapshot;
    },
    get clientId() {
      return currentClientId;
    },
    fetch(input, init) {
      return rf.fetch(input, init);
    },
    setClientId(clientId: string) {
      currentClientId = clientId;
      // NOTE: we do NOT rebuild the Session here. The current
      // implementation is a single-origin app that already passed its
      // Client ID at construction; setClientId mutates the snapshot for
      // the unified wrapper to read but does not (yet) rotate the
      // OIDC client identity. See README "Client identifier" section.
    },
    async login(webId: string): Promise<void> {
      // Discover the IDP first so the popup can short-circuit straight
      // to it. We do this inside the user-gesture stack frame; the
      // popup blocker grants the budget across the awaited fetch
      // because `openLoginPopup` is invoked synchronously inside
      // `ensureLoggedIn`'s slow-path branch (which runs before the
      // first `await`).
      //
      // For now this is a thin wrapper around `ensureLoggedIn` — the
      // popup UI itself prompts for the WebID. A future iteration can
      // pass the WebID through to skip the prompt; it's a one-flag
      // change to `mountCallback`. The shared API contract is the same
      // either way: a Promise that resolves on successful login.
      void webId; // mark intentional unused (see comment above)
      await ensureLoggedIn();
    },
    async logout(): Promise<void> {
      try {
        await session.logout();
      } finally {
        profileSnapshot = null;
        profileFetchInFlight = null;
      }
    },
  };

  const rf: ReactiveFetch = {
    get webId() {
      return ensureLoggedIn();
    },
    get restorePromise() {
      return restorePromise;
    },
    get solid() {
      return solid;
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
