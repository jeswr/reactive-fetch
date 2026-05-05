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
// `WebIDProfile` is a forward-compatible alias for the upcoming
// `@solid/object` `WebIDProfile` export. Today it resolves to `Agent`
// from `@solid/object/webid`. See `WebIDProfile.ts` in the shared
// package for stability notes on which getters are spec-stable
// (storage, oidcIssuers) vs unstable (the social-graph getters).
//
// Reactive surface (`webId`, `fetch`) is the original USP: auth is
// triggered by the act of using the API, not by an explicit call. The
// extension-shaped facade lives on `rf.solid`.
// =====================================================================

import {
  authFetch,
  createSessionBootstrap,
  ensureRestored,
  InvalidWebIdError,
  LoginFailedError,
  openLoginPopup,
  prepareRetryable,
  rebuildSessionBootstrap,
  SessionRestoreFailedError,
  WebIdPromptCancelledError,
  type WebIdDriver,
  type WebIDProfile,
} from '@jeswr/solid-reactive-fetch-shared';
import {
  fetchWebIDProfile,
  validateWebIdSyncStrict,
} from '@jeswr/solid-reactive-fetch-shared/callback';

export {
  InvalidIssuerError,
  InvalidWebIdError,
  LoginFailedError,
  NoOidcIssuerError,
  OriginMismatchError,
  PopupBlockedError,
  PopupClosedError,
  PopupTimeoutError,
  ReactiveFetchError,
  SessionRestoreFailedError,
  WebIdProfileError,
  WebIdPromptCancelledError,
  WebIDProfileAgent,
  type ReactiveFetchErrorCode,
  type WebIdDriver,
  type WebIdDriverContext,
  type WebIDProfile,
} from '@jeswr/solid-reactive-fetch-shared';

export interface ReactiveFetchOptions {
  clientId: string;
  callbackUrl: string;
  /**
   * Optional WebID-acquisition driver. When provided, the driver runs in
   * the parent (synchronously enough to keep the user-gesture budget
   * alive) and its result is forwarded to the popup as `?webId=`, so the
   * callback page skips its built-in form. Pass `() => window.prompt(...)`
   * for an OS-native dialog, or write your own (a modal, a saved-WebID
   * dropdown, …).
   *
   * When omitted, the popup renders its built-in WebID-input form
   * (zero-config default).
   */
  webIdDriver?: WebIdDriver;
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
   * AND as valid WebID URLs in addition to HTTPS. Defaults to `false`
   * (production-safe). Set to `true` only in local-dev builds that need to
   * talk to a non-TLS IDP (Community Solid Server, ESS dev cluster, etc.).
   *
   * IMPORTANT: the actual issuer filter runs inside the popup, so the same
   * value MUST also be passed to `mountCallback` on the callback page.
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
  /** Wrapped WebID profile, or null when no session is active. */
  readonly profile: WebIDProfile | null;
  /** The Client ID URI currently in effect. */
  readonly clientId: string | undefined;
  /** Authenticated fetch. Same semantics as `ReactiveFetch.fetch`. */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Declare the dereferenceable Client ID Document URI for the current origin. */
  setClientId(clientId: string): void;
  /**
   * Begin a login flow for the given WebID. Drives the popup imperatively
   * (the standard "click Login" UX). The popup still requires a user
   * gesture — call this directly inside a click handler.
   */
  login(webId: string): Promise<void>;
  /** Clear local tokens. App-only logout (does not redirect to IDP for end-session). */
  logout(): Promise<void>;
}

export interface ReactiveFetch {
  readonly webId: Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /**
   * Resolves when the construction-time restore attempt settles (success OR
   * swallowed failure). Never rejects — failures are exposed via
   * `onRestoreError`. Use this to render a loading state over the restore
   * window before deciding whether to offer a login button.
   */
  readonly restorePromise: Promise<void>;
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
 * without losing the gesture and being blocked.
 *
 * @throws if invoked outside a browser (no `window` or no `indexedDB`).
 */
export function createReactiveFetch(options: ReactiveFetchOptions): ReactiveFetch {
  const {
    clientId: initialClientId,
    callbackUrl,
    webIdDriver,
    onRestoreError,
    allowLocalhost = false,
  } = options;

  // `session` is reassignable: a successful popup login writes a fresh
  // DPoP keypair + refresh token to IndexedDB, and the construction-time
  // `Session` instance can hold internal state that prevents `restore()`
  // from picking the new entry up cleanly. After the popup closes we
  // rebuild via `rebuildSessionBootstrap` so subsequent reads/fetches
  // see the freshly-restored session. Closures over `session` resolve
  // the binding on each access, so the swap is observed immediately.
  let { session } = createSessionBootstrap(initialClientId);

  // Mutable client-id slot for the extension-shaped facade.
  let currentClientId: string | undefined = initialClientId;

  // Snapshot of the wrapped WebID profile, populated lazily after login
  // and after a successful restore. Reset to null on logout.
  let profileSnapshot: WebIDProfile | null = null;
  let profileFetchInFlight: Promise<void> | null = null;
  // The WebID a profile fetch is targeting — used as a late-publish guard
  // so a fetch started for user A can't overwrite the snapshot after a
  // `solid.login(B)` has already published B's profile.
  let profileFetchWebId: string | null = null;

  const restorePromise: Promise<void> = ensureRestored(session).catch(
    (err: unknown) => {
      try {
        onRestoreError?.(err);
      } catch {
        /* consumer callback must not break the factory */
      }
    },
  );
  void restorePromise.then(() => {
    if (session.isActive && session.webId) {
      void refreshProfile(session.webId);
    }
  });

  let loginPromise: Promise<string> | null = null;
  // Track the explicit target of the in-flight login so a `solid.login(B)`
  // launched while a `solid.login(A)` is pending doesn't silently join
  // A's promise. `null` = no specific target (a reactive `webId` read or
  // a 401 retry — any successful login resolves intent).
  // `DRIVER_PENDING_TARGET` = an async driver hasn't yet resolved its
  // WebID, so we don't yet know the target. Reactive reads can still
  // join in that state, but explicit `solid.login(X)` must reject —
  // joining would risk resolving with the wrong user once the driver
  // produces a different WebID.
  const DRIVER_PENDING_TARGET = Symbol('webIdDriver pending');
  let loginPromiseTarget: string | typeof DRIVER_PENDING_TARGET | null = null;

  const ensureLoggedIn = (overrideWebId?: string): Promise<string> => {
    // Validate `overrideWebId` BEFORE any short-circuit so an explicit
    // login is rejected for a malformed WebID even when a session is
    // active OR another login is already in flight.
    let validatedOverride: string | undefined;
    if (overrideWebId !== undefined) {
      try {
        validatedOverride = validateWebIdSyncStrict(overrideWebId, { allowLocalhost });
      } catch (err) {
        return Promise.reject(
          err instanceof InvalidWebIdError
            ? err
            : new InvalidWebIdError(overrideWebId, undefined, { cause: err }),
        );
      }
    }

    if (loginPromise) {
      // Concurrent calls share the in-flight login only if their targets
      // match. A reactive read with no target joins any pending login.
      // A `solid.login(X)` joins only when the pending login already
      // targets X (or has no target); otherwise reject — queueing would
      // require driving a second popup, which can't be done outside the
      // gesture chain that triggered it.
      if (validatedOverride === undefined) return loginPromise;
      if (loginPromiseTarget === DRIVER_PENDING_TARGET) {
        // Async driver hasn't resolved yet; we don't know if its target
        // will match. Reject to be safe.
        return Promise.reject(
          new LoginFailedError(
            `An asynchronous WebID driver is still resolving; ` +
              `wait for it to settle before logging in as ${validatedOverride}.`,
          ),
        );
      }
      if (loginPromiseTarget === null || loginPromiseTarget === validatedOverride) {
        return loginPromise;
      }
      return Promise.reject(
        new LoginFailedError(
          `Another login flow is in progress (targeting ${loginPromiseTarget}); ` +
            `wait for it to settle before logging in as ${validatedOverride}.`,
        ),
      );
    }

    if (session.isActive && session.webId) {
      const idempotent =
        validatedOverride === undefined || validatedOverride === session.webId;
      if (idempotent) {
        if (profileSnapshot === null && profileFetchInFlight === null) {
          void refreshProfile(session.webId);
        }
        return Promise.resolve(session.webId);
      }
      // User-switch: drop the previous user's profile state so a
      // late-arriving `refreshProfile(oldWebId)` can't publish back into
      // `solid.profile` after the new login completes.
      profileSnapshot = null;
      profileFetchInFlight = null;
      profileFetchWebId = null;
    }

    // Slow path: open the popup synchronously from this call stack. Any
    // `await` before `window.open` burns the user-gesture budget and
    // Chromium's popup blocker refuses the request.
    //
    // If a driver is configured AND the caller didn't supply an explicit
    // override, run the driver synchronously to acquire a WebID, then
    // append it as `?webId=` so the callback skips its built-in form.
    let popupTargetWebId: string | undefined = validatedOverride;
    if (popupTargetWebId === undefined && webIdDriver !== undefined) {
      const driverResult = webIdDriver({ allowLocalhost });
      if (typeof driverResult === 'string') {
        try {
          popupTargetWebId = validateWebIdSyncStrict(driverResult, { allowLocalhost });
        } catch (err) {
          return Promise.reject(
            err instanceof InvalidWebIdError
              ? err
              : new InvalidWebIdError(driverResult, undefined, { cause: err }),
          );
        }
      } else if (driverResult === null) {
        return Promise.reject(new WebIdPromptCancelledError());
      } else {
        // Promise — must resolve before window.open. This breaks the
        // user-gesture budget unless the consumer has already set up
        // delegated permissions; we accept this trade-off because some
        // drivers (custom modals) can't be synchronous.
        //
        // The target isn't known until the driver resolves. Pin it to
        // `DRIVER_PENDING_TARGET` so concurrent `solid.login(X)` calls
        // reject (rather than silently joining a flow that may resolve
        // with a different user). Once the driver's WebID is in hand,
        // upgrade the target to the validated string.
        const popupUrlPromise = driverResult.then((webId) => {
          if (webId === null) throw new WebIdPromptCancelledError();
          const validated = validateWebIdSyncStrict(webId, { allowLocalhost });
          loginPromiseTarget = validated;
          return appendWebIdParam(callbackUrl, validated);
        });
        return runLoginFlow(popupUrlPromise, DRIVER_PENDING_TARGET);
      }
    }

    const popupUrl = popupTargetWebId !== undefined
      ? appendWebIdParam(callbackUrl, popupTargetWebId)
      : callbackUrl;
    return runLoginFlow(popupUrl, popupTargetWebId ?? null);
  };

  const runLoginFlow = (
    popupUrlOrPromise: string | Promise<string>,
    target: string | typeof DRIVER_PENDING_TARGET | null,
  ): Promise<string> => {
    const popupPromise =
      typeof popupUrlOrPromise === 'string'
        ? openLoginPopup({ callbackUrl: popupUrlOrPromise })
        : popupUrlOrPromise.then((url) => openLoginPopup({ callbackUrl: url }));

    const pending: Promise<string> = (async () => {
      try {
        await popupPromise;
        // The popup wrote a fresh DPoP keypair + refresh token to IDB.
        // Rebuild the Session so it doesn't carry stale internal restore
        // state from the construction-time restore — without this,
        // `ensureRestored` can return early and miss the popup-written
        // entry, surfacing as `SessionRestoreFailedError` here.
        session = rebuildSessionBootstrap(currentClientId ?? initialClientId).session;
        await ensureRestored(session, true);
        if (!session.isActive || !session.webId) {
          throw new SessionRestoreFailedError();
        }
        void refreshProfile(session.webId);
        return session.webId;
      } finally {
        loginPromise = null;
        loginPromiseTarget = null;
      }
    })();

    loginPromise = pending;
    loginPromiseTarget = target;
    return pending;
  };

  const refreshProfile = (webId: string): Promise<void> => {
    // Don't dedup across user-switches: if a fetch is in flight for the
    // previous user, ignore the dedup and start a new fetch that races.
    // The late-publish guard below keeps the snapshot consistent.
    if (profileFetchInFlight && profileFetchWebId === webId) {
      return profileFetchInFlight;
    }
    profileFetchWebId = webId;
    let pending!: Promise<void>;
    pending = (async () => {
      try {
        const { agent } = await fetchWebIDProfile(webId, { allowLocalhost });
        if (profileFetchWebId === webId) {
          profileSnapshot = agent;
        }
      } catch {
        /* snapshot stays at its previous value */
      } finally {
        if (profileFetchInFlight === pending) {
          profileFetchInFlight = null;
        }
      }
    })();
    profileFetchInFlight = pending;
    return pending;
  };

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
    },
    async login(webId: string): Promise<void> {
      await ensureLoggedIn(webId);
    },
    async logout(): Promise<void> {
      try {
        await session.logout();
      } finally {
        profileSnapshot = null;
        profileFetchInFlight = null;
        profileFetchWebId = null;
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

function appendWebIdParam(callbackUrl: string, webId: string): string {
  const url = new URL(callbackUrl, window.location.href);
  url.searchParams.set('webId', webId);
  return url.toString();
}
