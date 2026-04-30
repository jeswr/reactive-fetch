// =====================================================================
// @jeswr/solid-reactive-fetch-prompt
//
// Drop-in alternative to `@jeswr/solid-reactive-fetch` that uses
// `window.prompt()` for WebID entry instead of an in-popup form.
//
// Why a separate package? The original popup ships its own DOM (a
// `<form>` with input + submit). Some embedding contexts forbid the
// extra DOM (kiosk apps, deeply restricted CSPs, accessibility tooling
// stacks that prefer the OS-native prompt) and `window.prompt()` is the
// blunter, more portable alternative — it pauses JS, returns a string or
// null, and keeps the user-gesture credit alive across the call so we
// can still synchronously open the popup that runs the OIDC dance.
//
// The popup is still required: `window.prompt()` only collects the
// WebID; the IDP redirect, `code+state` round-trip, and DPoP keypair
// stay in `IndexedDB`-shared popup land. The popup just skips the
// WebID-form step because the parent already provided one via the
// `?webId=` query parameter.
//
// All security guarantees of the popup-flavoured factory carry over:
//
//   - WebID is validated synchronously (https: only, +localhost iff the
//     allowLocalhost flag is set) BEFORE the popup URL is constructed;
//     `javascript:`, `data:`, `file:`, etc. never reach the popup.
//   - DPoP keypairs remain non-extractable in IndexedDB.
//   - The opener validates `event.origin` on the postMessage from the
//     popup. Tokens never cross postMessage.
//   - Same-origin popup callback so IndexedDB is shared.
// =====================================================================

import {
  authFetch,
  createSessionBootstrap,
  ensureRestored,
  InvalidWebIdError,
  openLoginPopup,
  rebuildSessionBootstrap,
  SessionRestoreFailedError,
  WebIdPromptCancelledError,
  type WebIDProfile,
} from '@jeswr/solid-reactive-fetch-shared';
import {
  fetchWebIDProfile,
  validateWebIdSyncStrict,
} from '@jeswr/solid-reactive-fetch-shared/callback';
// `WebIDProfileAgent` is sourced from shared's bare-root barrel so the
// DTS bundler (rollup-plugin-dts) doesn't leave a dangling reference to
// the unpublished `@jeswr/solid-reactive-fetch-shared/callback` subpath
// in our published .d.ts.

// Re-export the public error + type surface so consumers can import from
// this package without also depending on `@jeswr/solid-reactive-fetch-shared`
// (which is private/unpublished).
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
  type WebIDProfile,
} from '@jeswr/solid-reactive-fetch-shared';

export interface ReactiveFetchPromptOptions {
  clientId: string;
  callbackUrl: string;
  /**
   * Invoked if the construction-time `ensureRestored` call rejects (malformed
   * refresh token, token endpoint unreachable, corrupt IndexedDB, etc.). The
   * factory itself never rejects at construction — a failed restore leaves the
   * session inactive and the next `webId` / `fetch` call triggers the prompt
   * + popup. Use this callback to surface a "your session could not be
   * restored" message in the UI.
   */
  onRestoreError?: (err: unknown) => void;
  /**
   * Accept `http://localhost` / `127.0.0.1` / `[::1]` as valid OIDC issuers
   * AND as valid WebID URLs in addition to HTTPS. Defaults to `false`
   * (production-safe). Set to `true` only in local dev builds that need to
   * talk to a non-TLS IDP / pod.
   *
   * IMPORTANT: the actual issuer filter runs inside the popup, so the same
   * value MUST also be passed to `mountCallback` on the callback page.
   */
  allowLocalhost?: boolean;
  /**
   * Override the message shown in `window.prompt()`. Defaults to
   * `'Enter your WebID URL'`.
   */
  promptMessage?: string;
  /**
   * Override `window.prompt` (mainly for tests). The default uses the
   * global `window.prompt`. The shape is the same as the WHATWG prompt
   * function: take a message + default value, return a string (the user
   * input) or null (cancel). When implementing your own, remember it MUST
   * be synchronous so the surrounding user-gesture budget survives the call.
   */
  prompt?: (message: string, defaultValue?: string) => string | null;
}

export interface SolidPrompt {
  readonly webId: string | null;
  readonly profile: WebIDProfile | null;
  readonly clientId: string | undefined;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  setClientId(clientId: string): void;
  /**
   * Imperative login. The WebID is taken as-is — no `window.prompt()` is
   * shown. Validates the WebID synchronously (https / localhost) and then
   * opens the popup with `?webId=` set so the callback page short-circuits
   * straight to discovery. Resolves once login completes.
   */
  login(webId: string): Promise<void>;
  logout(): Promise<void>;
}

export interface ReactiveFetchPrompt {
  readonly webId: Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  readonly restorePromise: Promise<void>;
  readonly solid: SolidPrompt;
}

/**
 * Build a reactive authenticated fetch that uses `window.prompt()` for
 * WebID entry. Browser-only — throws if invoked without `window` /
 * `indexedDB`.
 *
 * The user-gesture-and-popup contract is the same as the popup-flavoured
 * factory: reading `rf.webId` or calling `rf.fetch(...)` that ends up
 * needing login MUST happen directly inside a click/keydown handler.
 * `window.prompt()` itself is synchronous, so the gesture budget survives
 * across it; `window.open()` is then called immediately afterwards
 * without an `await`.
 *
 * @throws if invoked outside a browser (no `window` or no `indexedDB`).
 */
export function createReactiveFetchPrompt(
  options: ReactiveFetchPromptOptions,
): ReactiveFetchPrompt {
  const {
    clientId: initialClientId,
    callbackUrl,
    onRestoreError,
    allowLocalhost,
    promptMessage,
    prompt: promptFn,
  } = options;

  // `session` must be reassignable because a successful popup login writes
  // the new DPoP keypair + refresh token to IndexedDB, and the construction-
  // time `Session` instance can hold internal state that prevents `restore()`
  // from picking the new entry up cleanly. After the popup closes we replace
  // the instance via `rebuildSessionBootstrap` so subsequent reads/fetches
  // see the freshly-restored session. Closures over `session` in the
  // accessors below resolve the binding on each access, so the swap is
  // observed immediately.
  let { session } = createSessionBootstrap(initialClientId);

  let currentClientId: string | undefined = initialClientId;
  let profileSnapshot: WebIDProfile | null = null;
  let profileFetchInFlight: Promise<void> | null = null;

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

  const ensureLoggedIn = (overrideWebId?: string): Promise<string> => {
    if (loginPromise) return loginPromise;

    // Validate `overrideWebId` BEFORE any active-session short-circuit so
    // that `solid.login(webId)` is treated as an explicit login request:
    // a malformed WebID is rejected even when another user is signed in,
    // and a different WebID forces a fresh login (the popup overwrites
    // the IDB session). Only an exact match with the active `session.webId`
    // is treated as idempotent and short-circuits without opening a popup.
    let validatedOverride: string | undefined;
    if (overrideWebId !== undefined) {
      try {
        validatedOverride = validateWebIdSyncStrict(overrideWebId, {
          allowLocalhost: allowLocalhost ?? false,
        });
      } catch (err) {
        return Promise.reject(
          err instanceof InvalidWebIdError
            ? err
            : new InvalidWebIdError(overrideWebId, undefined, { cause: err }),
        );
      }
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
      // Different WebID supplied while a session is active — caller wants
      // to switch users. Fall through to the popup flow; the IDP redirect
      // overwrites the IDB-stored session, and we rebuild our `Session`
      // reference below so the swap is observed locally.
    }

    // Synchronously: collect a WebID. If the caller already gave one
    // (`solid.login(webId)` path), skip the prompt; otherwise open the
    // OS-native prompt. `window.prompt` is blocking, so the user-gesture
    // credit is still active when it returns and `window.open` below
    // succeeds.
    let validatedWebId: string;
    if (validatedOverride !== undefined) {
      validatedWebId = validatedOverride;
    } else {
      const promptImpl = promptFn ?? defaultPrompt;
      const rawWebId = promptImpl(promptMessage ?? 'Enter your WebID URL');
      if (rawWebId === null) {
        return Promise.reject(new WebIdPromptCancelledError());
      }
      try {
        validatedWebId = validateWebIdSyncStrict(rawWebId, {
          allowLocalhost: allowLocalhost ?? false,
        });
      } catch (err) {
        return Promise.reject(
          err instanceof InvalidWebIdError
            ? err
            : new InvalidWebIdError(rawWebId, undefined, { cause: err }),
        );
      }
    }

    const popupUrl = appendWebIdParam(callbackUrl, validatedWebId);
    const popupPromise = openLoginPopup({ callbackUrl: popupUrl });

    const pending: Promise<string> = (async () => {
      try {
        await popupPromise;
        // The popup wrote a fresh DPoP keypair + refresh token to IDB.
        // Rebuild the Session instance so it doesn't carry stale internal
        // restore state from the construction-time restore — without this,
        // `ensureRestored` can return early and miss the popup-written
        // entry, surfacing as `SessionRestoreFailedError` here.
        const fresh = rebuildSessionBootstrap(currentClientId ?? initialClientId).session;
        session = fresh;
        await ensureRestored(session, true);
        if (!session.isActive || !session.webId) {
          throw new SessionRestoreFailedError();
        }
        void refreshProfile(session.webId);
        return session.webId;
      } finally {
        loginPromise = null;
      }
    })();

    loginPromise = pending;
    return pending;
  };

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

  const solid: SolidPrompt = {
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
      // Imperative login: skip the prompt, validate the supplied WebID,
      // and drive the same popup pipeline. Synchronous validation +
      // `window.open` keeps the user-gesture budget alive.
      await ensureLoggedIn(webId);
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

  const rf: ReactiveFetchPrompt = {
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

function defaultPrompt(message: string): string | null {
  // jsdom and a few headless contexts return `undefined` from `window.prompt`;
  // the WHATWG spec says `string | null`. Coerce to the spec contract.
  const result = window.prompt(message);
  return result ?? null;
}

function appendWebIdParam(callbackUrl: string, webId: string): string {
  const url = new URL(callbackUrl, window.location.href);
  url.searchParams.set('webId', webId);
  return url.toString();
}

interface Retryable {
  request: Request;
  retry: { input: RequestInfo | URL; init?: RequestInit };
}

function prepareRetryable(input: RequestInfo | URL, init?: RequestInit): Retryable {
  if (input instanceof Request) {
    // `globalThis.fetch(request, init)` overlays `init` on top of `request`'s
    // properties (method, headers, body, …) per the Fetch spec. Cloning the
    // bare request and dropping `init` would send the unauthenticated
    // request with the wrong overrides — a non-401 200 OK could come back
    // for the wrong method/headers/body. Materialize the merged Request
    // once so both the initial fetch and the retry inherit the overrides.
    const merged = init ? new Request(input, init) : input;
    return {
      request: merged.clone(),
      retry: { input: merged.clone() },
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
