// =====================================================================
// @jeswr/solid-reactive-fetch-shared
//
// Primitives consumed by `@jeswr/solid-reactive-fetch`, its WebID
// drivers (e.g. `@jeswr/solid-reactive-fetch-driver-prompt`), and the
// service-worker variant: session bootstrap, popup orchestration, error
// hierarchy, WebID profile resolution, the issuer-picker UI, the OIDC-
// redirect handler, and the `WebIdDriver` contract.
// =====================================================================

export * from './errors.js';
export type { WebIDProfile } from './WebIDProfile.js';
export type { WebIdDriver, WebIdDriverContext } from './driver.js';

export { WebIDProfileAgent } from './callback/resolveWebId.js';
export type { SharedCallbackOptions } from './callback/handler.js';

export {
  authFetch,
  createSessionBootstrap,
  ensureRestored,
  rebuildSessionBootstrap,
  __resetSessionCacheForTests,
  type SessionBootstrap,
} from './session.js';

export {
  LOGIN_COMPLETE_MESSAGE_TYPE,
  openLoginPopup,
  __resetPopupStateForTests,
  type OpenLoginPopupOptions,
} from './popup.js';

export {
  prepareRetryable,
  type Retryable,
} from './retry.js';

// SW wire-protocol re-exports. `LOGIN_COMPLETE_MESSAGE_TYPE` collides with
// the popup-flow constant above (different string values for different
// protocols), so the sw-flavour is re-exported under an `SW_`-prefixed
// alias here. Other sw constants don't collide and keep their canonical
// names. Re-exporting from root (rather than relying on the `./sw`
// subpath) lets DTS bundlers in consumer packages inline these types
// without dangling subpath references in published .d.ts files.
export {
  LOGIN_COMPLETE_MESSAGE_TYPE as SW_LOGIN_COMPLETE_MESSAGE_TYPE,
  LOGIN_REQUIRED_MESSAGE_TYPE,
  LOGIN_FAILED_MESSAGE_TYPE,
  REGISTER_HANDSHAKE_MESSAGE_TYPE,
  REGISTER_ACK_MESSAGE_TYPE,
  isLoginRequiredMessage,
  isLoginCompleteMessage,
  isLoginFailedMessage,
  isRegisterHandshakeMessage,
  isRegisterAckMessage,
  type LoginRequiredMessage,
  type LoginCompleteMessage,
  type LoginFailedMessage,
  type RegisterHandshakeMessage,
  type RegisterAckMessage,
  type ServiceWorkerInboundMessage,
  type ServiceWorkerOutboundMessage,
} from './sw/messages.js';
