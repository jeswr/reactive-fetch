// =====================================================================
// @jeswr/solid-reactive-fetch-shared
//
// Internal, unpublished package. Holds the primitives both
// `@jeswr/solid-reactive-fetch` (in-popup form) and
// `@jeswr/solid-reactive-fetch-prompt` (window.prompt + popup) consume:
// session bootstrap, popup orchestration, error hierarchy, WebID profile
// resolution, the issuer-picker UI, and the OIDC-redirect handler.
// =====================================================================

export * from './errors.js';
export type { WebIDProfile } from './WebIDProfile.js';

// Re-exported from `./callback/*` so consumers (core, prompt, sw) can
// import these from the bare root specifier. `tsup`'s DTS bundler
// (rollup-plugin-dts) inlines deps reachable through the entry's import
// graph; reaching them via subpath imports leaves dangling references to
// `@jeswr/solid-reactive-fetch-shared/callback` in the published .d.ts —
// which would fail to resolve since this package is unpublished.
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
