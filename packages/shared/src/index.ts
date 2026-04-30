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
