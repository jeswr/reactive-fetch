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
