// =====================================================================
// @jeswr/solid-reactive-fetch-sw — page-side API
//
// Sibling to `@jeswr/solid-reactive-fetch` (popup) and
// `@jeswr/solid-reactive-fetch-prompt` (window.prompt). Where those
// expose an `rf.fetch` wrapper, this package intercepts the unmodified
// global `globalThis.fetch` via a Service Worker so apps can call
// `fetch('https://pod.example/private')` and get authentication
// transparently — no per-call-site change.
//
// IMPORTANT mutual-exclusivity: do NOT use this in the same app as
// `rf.fetch` from core/prompt for cross-origin requests. Both layers
// will fight over the Session and produce duplicate auth attempts.
// Pick one path per origin/URL pattern.
//
// The login UI is NOT shipped here. The consumer composes one via
// `loginDriver`, e.g.:
//
//   import { createReactiveFetchPrompt } from '@jeswr/solid-reactive-fetch-prompt';
//   const rfp = createReactiveFetchPrompt({ clientId, callbackUrl });
//   await registerReactiveFetchSW({
//     swUrl: '/reactive-fetch-sw.js',
//     loginDriver: () => rfp.webId.then(() => {}),
//     clientId,
//     callbackUrl,
//   });
//
// =====================================================================

// Wire-protocol types/constants imported from shared's bare-root
// specifier (not the `./sw` subpath) so DTS bundling can inline them
// into our published .d.ts. The sw-flavour `LOGIN_COMPLETE_MESSAGE_TYPE`
// is re-exported from shared under an `SW_`-prefixed alias to avoid
// colliding with the popup-flow constant of the same name; we re-alias
// it back to the canonical sw-public name on the way out.
import {
  REGISTER_HANDSHAKE_MESSAGE_TYPE,
  isLoginRequiredMessage,
  isRegisterAckMessage,
  SW_LOGIN_COMPLETE_MESSAGE_TYPE,
  LOGIN_FAILED_MESSAGE_TYPE,
  LOGIN_REQUIRED_MESSAGE_TYPE,
  REGISTER_ACK_MESSAGE_TYPE,
  type LoginCompleteMessage,
  type LoginFailedMessage,
  type RegisterHandshakeMessage,
} from '@jeswr/solid-reactive-fetch-shared';

export type {
  LoginRequiredMessage,
  LoginCompleteMessage,
  LoginFailedMessage,
  RegisterHandshakeMessage,
  RegisterAckMessage,
  ServiceWorkerInboundMessage,
  ServiceWorkerOutboundMessage,
} from '@jeswr/solid-reactive-fetch-shared';

// Re-export under the canonical sw-public name. Consumers see
// `LOGIN_COMPLETE_MESSAGE_TYPE = 'reactive-fetch-sw:login-complete'`.
// Use a `const` re-binding (not `export … as …`) so TypeScript inlines
// the literal type into our public declarations rather than emitting a
// re-export that points back at the unpublished private package.
export const LOGIN_COMPLETE_MESSAGE_TYPE = SW_LOGIN_COMPLETE_MESSAGE_TYPE;
export {
  LOGIN_FAILED_MESSAGE_TYPE,
  LOGIN_REQUIRED_MESSAGE_TYPE,
  REGISTER_HANDSHAKE_MESSAGE_TYPE,
  REGISTER_ACK_MESSAGE_TYPE,
};

export interface RegisterReactiveFetchSWOptions {
  /**
   * Path or URL to the worker bundle on the SAME origin as the page.
   * Typically `'/reactive-fetch-sw.js'` (you copy `dist/worker.js` to
   * your `public/` directory under that name).
   */
  swUrl: string;
  /**
   * Service-worker scope. Defaults to `'/'` (the entire origin). Tighten
   * this if you only want the SW to claim a sub-path. The browser
   * enforces that the scope is at or below the worker URL's directory.
   */
  scope?: string;
  /**
   * Page-side login driver. Invoked when the worker dispatches a
   * `login-required` message and no login is already in flight. Must
   * resolve once a Session has been written to the shared IndexedDB
   * (which the worker can then `restore()` from). Reject to signal a
   * permanent failure for the matched request.
   *
   * Single-flighted: if a login is already in flight, the new
   * `login-required` is queued onto the same Promise and replied to
   * with the same outcome.
   */
  loginDriver: () => Promise<void>;
  /** Hosted Client ID Document URI. Forwarded to the worker via the handshake. */
  clientId: string;
  /**
   * The callback URL the login driver will redirect the popup/prompt
   * back to. Surfaced here for parity with core/prompt and so a unified
   * wrapper can pick the right registration without re-collecting it.
   * Not currently consumed by the worker (the page-side login driver
   * owns the redirect leg) but documented to match the sibling APIs.
   */
  callbackUrl: string;
  /**
   * Forwarded to whoever the consumer wires as `loginDriver`. Not
   * consumed by the worker itself. Documented here for parity with
   * the sibling factories.
   */
  allowLocalhost?: boolean;
  /**
   * How long the worker should wait for a `login-complete` reply
   * before timing out a matched request. Defaults to 5 minutes. Forwarded
   * to the worker as part of the registration handshake.
   */
  loginTimeoutMs?: number;
  /**
   * Origins (scheme + host + port, e.g. `https://pod.example`) the
   * worker is allowed to apply Solid auth to. URLs whose origin is not
   * on this list fall through the worker untouched. This is the
   * serialisable replacement for the (removed) `match` predicate; it
   * MUST include every origin that hosts a private resource your app
   * fetches and MUST NOT include OIDC discovery / token endpoints (the
   * IDP serves those without DPoP-bound auth headers — applying them
   * would break login).
   *
   * Required and non-empty: an empty list disables interception, which
   * defeats the purpose of installing the SW. Pass at least one origin
   * (typically the user's pod root) to opt in. Same-origin requests
   * never get auth applied regardless of this list.
   */
  authOrigins: readonly string[];
}

export interface ReactiveFetchSWRegistration {
  /** The underlying `ServiceWorkerRegistration` from the browser. */
  readonly registration: ServiceWorkerRegistration;
  /**
   * Tear down the message listener and (optionally) unregister the SW.
   * The worker itself is not stopped unless `unregister: true`.
   */
  unsubscribe(options?: { unregister?: boolean }): Promise<void>;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Register the reactive-fetch service worker and wire up the page-side
 * message handler that drives `loginDriver` whenever the worker asks for
 * authentication.
 *
 * Browser-only. Throws if `navigator.serviceWorker` is unavailable.
 *
 * Resolves once the SW is `active` and the registration handshake has
 * been acked. The returned object exposes the underlying
 * `ServiceWorkerRegistration` and a `unsubscribe` helper for teardown
 * (mainly useful in tests / hot-module-reload contexts).
 */
export async function registerReactiveFetchSW(
  options: RegisterReactiveFetchSWOptions,
): Promise<ReactiveFetchSWRegistration> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    throw new Error(
      'registerReactiveFetchSW must run in a browser with Service Worker support.',
    );
  }

  const {
    swUrl,
    scope,
    loginDriver,
    clientId,
    loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
    authOrigins,
  } = options;

  // Reject obviously-broken `authOrigins` here so misconfiguration fails
  // synchronously at register time rather than silently turning the SW
  // into a passthrough at fetch time. We only enforce a non-empty list
  // and that each entry parses as a URL origin; origin-membership at
  // fetch time is still authoritative.
  if (!Array.isArray(authOrigins) || authOrigins.length === 0) {
    throw new Error(
      'registerReactiveFetchSW: `authOrigins` is required and must contain at least one origin. ' +
        'Pass the origin(s) of every resource your app needs Solid auth for, e.g. ["https://pod.example"].',
    );
  }
  const normalisedAuthOrigins = authOrigins.map((entry) => {
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      throw new Error(
        `registerReactiveFetchSW: \`authOrigins\` entry "${entry}" is not a valid origin.`,
      );
    }
    if (parsed.origin !== entry) {
      throw new Error(
        `registerReactiveFetchSW: \`authOrigins\` entry "${entry}" must be an origin (scheme + host + port), not a URL with a path. Got origin "${parsed.origin}".`,
      );
    }
    return parsed.origin;
  });

  const registration = await navigator.serviceWorker.register(swUrl, {
    type: 'module',
    scope,
  });

  await waitForActiveServiceWorker(registration);

  // Single-flight pending login. Subsequent `login-required` messages
  // queue onto this Promise; when it settles, every queued requestId
  // gets the same answer back to the worker. This mirrors the popup
  // package's single-popup invariant — concurrent 401s share one login.
  let pendingLogin: Promise<void> | null = null;
  const queuedRequestIds: string[] = [];

  const messageListener = (event: MessageEvent): void => {
    if (!isExpectedServiceWorker(event.source, registration)) {
      debugWarn('Rejected message from non-SW source', event.source);
      return;
    }
    if (!isLoginRequiredMessage(event.data)) return;

    const { requestId } = event.data;
    queuedRequestIds.push(requestId);

    if (pendingLogin) {
      // A login is in flight; this requestId's response will be sent
      // when the existing pending Promise settles.
      return;
    }

    pendingLogin = (async () => {
      try {
        await loginDriver();
        flushPendingRequests((rid) => buildLoginCompleteMessage(rid));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        flushPendingRequests((rid) => buildLoginFailedMessage(rid, reason));
      } finally {
        pendingLogin = null;
      }
    })();
  };

  const flushPendingRequests = (
    build: (requestId: string) => LoginCompleteMessage | LoginFailedMessage,
  ): void => {
    const ids = queuedRequestIds.splice(0, queuedRequestIds.length);
    const target = registration.active;
    if (!target) return;
    for (const rid of ids) {
      target.postMessage(build(rid));
    }
  };

  navigator.serviceWorker.addEventListener('message', messageListener);

  await sendHandshake(registration, {
    type: REGISTER_HANDSHAKE_MESSAGE_TYPE,
    clientId,
    loginTimeoutMs,
    authOrigins: normalisedAuthOrigins,
  });

  return {
    registration,
    async unsubscribe({ unregister = false }: { unregister?: boolean } = {}) {
      navigator.serviceWorker.removeEventListener('message', messageListener);
      if (unregister) {
        await registration.unregister();
      }
    },
  };
}

async function waitForActiveServiceWorker(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  if (registration.active) return;

  await new Promise<void>((resolve) => {
    const candidate = registration.installing ?? registration.waiting;
    if (!candidate) {
      // No installing/waiting worker but no active either — the
      // registration is in a weird in-between state. Resolve and let
      // the handshake retry handle it; if it never reaches the worker
      // the consumer's first matched fetch will surface a clear error.
      resolve();
      return;
    }
    const handleStateChange = () => {
      if (candidate.state === 'activated') {
        candidate.removeEventListener('statechange', handleStateChange);
        resolve();
      }
    };
    candidate.addEventListener('statechange', handleStateChange);
  });
}

async function sendHandshake(
  registration: ServiceWorkerRegistration,
  message: RegisterHandshakeMessage,
): Promise<void> {
  const target =
    registration.installing ?? registration.waiting ?? registration.active;
  if (!target) {
    // Without an active worker the handshake has nowhere to land.
    // Don't throw: the worker may still come up after the next
    // navigation and pick up the handshake we'll re-send on the next
    // matched fetch. Silently drop and let the worker time out a
    // matched request as `no-page-listener` if it stays unconfigured.
    return;
  }

  await new Promise<void>((resolve) => {
    const onAck = (event: MessageEvent) => {
      if (event.source !== target) {
        debugWarn('Rejected handshake ack from non-SW source', event.source);
        return;
      }
      if (!isRegisterAckMessage(event.data)) return;
      if (event.data.clientId !== message.clientId) return;
      navigator.serviceWorker.removeEventListener('message', onAck);
      resolve();
    };
    navigator.serviceWorker.addEventListener('message', onAck);
    target.postMessage(message);

    // Don't block the registration on the ack indefinitely — the
    // worker may have been deactivated by a fresh install. Settle
    // after a short window; subsequent matched requests will trigger
    // the SW to start up and the next handshake retry.
    setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onAck);
      resolve();
    }, 1000);
  });
}

function buildLoginCompleteMessage(requestId: string): LoginCompleteMessage {
  return { type: LOGIN_COMPLETE_MESSAGE_TYPE, requestId };
}

function buildLoginFailedMessage(requestId: string, reason: string): LoginFailedMessage {
  return { type: LOGIN_FAILED_MESSAGE_TYPE, requestId, reason };
}

// Verifies a `MessageEvent` originated from the controlling SW (or, during
// early activation, from the registration's installing/waiting/active worker).
// Without this gate any same-origin attacker that lands a `MessageEvent`
// (BroadcastChannel, embedded iframe, Worker, extension content script)
// could trigger `loginDriver()` on demand or spoof `login-complete` for an
// unrelated outstanding `requestId`.
function isExpectedServiceWorker(
  source: MessageEventSource | null,
  registration: ServiceWorkerRegistration,
): boolean {
  if (!source) return false;
  const controller = navigator.serviceWorker.controller;
  if (controller && source === controller) return true;
  const fallback =
    registration.active ?? registration.waiting ?? registration.installing;
  return fallback != null && source === fallback;
}

function debugWarn(...args: unknown[]): void {
  if ((globalThis as { __REACTIVE_FETCH_SW_DEBUG?: boolean }).__REACTIVE_FETCH_SW_DEBUG === true) {
    // eslint-disable-next-line no-console -- opt-in debug
    console.warn('[reactive-fetch-sw]', ...args);
  }
}
