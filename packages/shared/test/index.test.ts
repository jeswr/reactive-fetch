// Export-surface smoke test for `@jeswr/solid-reactive-fetch-shared`.
//
// The shared package is consumed by `@jeswr/solid-reactive-fetch` and
// the service-worker variant. Renames and accidental drops are far
// cheaper to catch here than chasing them through downstream test
// failures, so this file just imports the documented surface and
// asserts each export is truthy / the right shape.

import { describe, expect, test } from 'vitest';
import {
  // Errors
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
  // Session
  authFetch,
  createSessionBootstrap,
  ensureRestored,
  rebuildSessionBootstrap,
  __resetSessionCacheForTests,
  // Popup
  LOGIN_COMPLETE_MESSAGE_TYPE,
  openLoginPopup,
  __resetPopupStateForTests,
} from '../src/index.js';
import {
  WebIDProfileAgent,
  fetchWebIDProfile,
  resolveOidcIssuers,
  resolveWebIdProfile,
  IssuerPickerCancelled,
  renderIssuerPicker,
  rememberWebId,
  forgetWebId,
  getCachedWebIds,
  __resetWebIdCacheForTests,
  createCard,
  ensurePopupLayout,
  ensureStylesInjected,
  beginSolidLogin,
  buildSession,
  describeError,
  driveLoginFromWebId,
  readWebIdFromQueryOrNull,
  readWebIdFromQueryStrict,
  runOidcRedirectIfPresent,
  validateWebIdSyncStrict,
} from '../src/callback/index.js';

describe('shared: export-surface smoke test', () => {
  test('error classes are constructible and extend ReactiveFetchError', () => {
    const errors = [
      new PopupBlockedError(),
      new PopupClosedError(),
      new PopupTimeoutError(1000),
      new WebIdProfileError('https://x'),
      new NoOidcIssuerError('https://x'),
      new InvalidIssuerError('https://x', 'http://nope'),
      new InvalidWebIdError('javascript:'),
      new WebIdPromptCancelledError(),
      new LoginFailedError(),
      new SessionRestoreFailedError(),
      new OriginMismatchError('https://a', 'https://b'),
    ];
    for (const err of errors) {
      expect(err).toBeInstanceOf(ReactiveFetchError);
      expect(err).toBeInstanceOf(Error);
      expect(typeof err.code).toBe('string');
    }
  });

  test('ReactiveFetchError is abstract — only typed via subclasses', () => {
    expect(typeof ReactiveFetchError).toBe('function');
  });

  test('session module exports are functions', () => {
    expect(typeof createSessionBootstrap).toBe('function');
    expect(typeof rebuildSessionBootstrap).toBe('function');
    expect(typeof ensureRestored).toBe('function');
    expect(typeof authFetch).toBe('function');
    expect(typeof __resetSessionCacheForTests).toBe('function');
  });

  test('popup module exports are functions and the login-complete tag is stable', () => {
    expect(typeof openLoginPopup).toBe('function');
    expect(typeof __resetPopupStateForTests).toBe('function');
    expect(LOGIN_COMPLETE_MESSAGE_TYPE).toBe('reactive-fetch:login-complete');
  });

  test('callback module exports are functions / classes', () => {
    expect(typeof WebIDProfileAgent).toBe('function');
    expect(typeof fetchWebIDProfile).toBe('function');
    expect(typeof resolveOidcIssuers).toBe('function');
    expect(typeof resolveWebIdProfile).toBe('function');
    expect(typeof IssuerPickerCancelled).toBe('function');
    expect(typeof renderIssuerPicker).toBe('function');
    expect(typeof rememberWebId).toBe('function');
    expect(typeof forgetWebId).toBe('function');
    expect(typeof getCachedWebIds).toBe('function');
    expect(typeof __resetWebIdCacheForTests).toBe('function');
    expect(typeof createCard).toBe('function');
    expect(typeof ensurePopupLayout).toBe('function');
    expect(typeof ensureStylesInjected).toBe('function');
    expect(typeof beginSolidLogin).toBe('function');
    expect(typeof buildSession).toBe('function');
    expect(typeof describeError).toBe('function');
    expect(typeof driveLoginFromWebId).toBe('function');
    expect(typeof readWebIdFromQueryOrNull).toBe('function');
    expect(typeof readWebIdFromQueryStrict).toBe('function');
    expect(typeof runOidcRedirectIfPresent).toBe('function');
    expect(typeof validateWebIdSyncStrict).toBe('function');
  });

  test('IssuerPickerCancelled is an Error subclass', () => {
    const err = new IssuerPickerCancelled();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('IssuerPickerCancelled');
  });
});
