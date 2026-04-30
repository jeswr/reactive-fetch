// Re-exports the shared callback primitives. Per-flavour `mountCallback`
// implementations (one in `@jeswr/solid-reactive-fetch`, one in
// `@jeswr/solid-reactive-fetch-prompt`) compose these.

export {
  WebIDProfileAgent,
  fetchWebIDProfile,
  resolveOidcIssuers,
  resolveWebIdProfile,
  type ResolveOidcIssuersOptions,
  type WebIdProfile,
} from './resolveWebId.js';

export {
  forgetWebId,
  getCachedWebIds,
  rememberWebId,
  __resetWebIdCacheForTests,
  type CachedWebId,
} from './webidCache.js';

export {
  IssuerPickerCancelled,
  renderIssuerPicker,
  type IssuerPickerUi,
} from './issuerPickerUi.js';

export {
  createCard,
  ensurePopupLayout,
  ensureStylesInjected,
} from './popupChrome.js';

export {
  beginSolidLogin,
  buildSession,
  describeError,
  driveLoginFromWebId,
  readWebIdFromQueryOrNull,
  readWebIdFromQueryStrict,
  runOidcRedirectIfPresent,
  validateWebIdSyncStrict,
  type DriveLoginCallbacks,
  type SharedCallbackOptions,
} from './handler.js';
