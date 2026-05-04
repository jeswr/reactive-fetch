// Re-exports the shared callback primitives. Composed by
// `@jeswr/solid-reactive-fetch`'s `mountCallback`.

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
