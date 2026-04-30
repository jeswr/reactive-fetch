export type ReactiveFetchErrorCode =
  | 'popup_blocked'
  | 'popup_closed'
  | 'popup_timeout'
  | 'webid_profile'
  | 'no_oidc_issuer'
  | 'invalid_issuer'
  | 'invalid_webid'
  | 'webid_prompt_cancelled'
  | 'login_failed'
  | 'session_restore_failed'
  | 'origin_mismatch';

export abstract class ReactiveFetchError extends Error {
  abstract readonly code: ReactiveFetchErrorCode;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class PopupBlockedError extends ReactiveFetchError {
  readonly code = 'popup_blocked';

  constructor(
    message = 'Popup was blocked by the browser. Ensure login() is called from a user gesture.',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PopupBlockedError';
  }
}

export class PopupClosedError extends ReactiveFetchError {
  readonly code = 'popup_closed';

  constructor(
    message = 'Login popup was closed before authentication completed.',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PopupClosedError';
  }
}

export class PopupTimeoutError extends ReactiveFetchError {
  readonly code = 'popup_timeout';
  readonly timeoutMs: number;

  constructor(timeoutMs: number, message?: string, options?: ErrorOptions) {
    super(
      message ?? `Login popup did not complete within ${timeoutMs}ms.`,
      options,
    );
    this.name = 'PopupTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export class WebIdProfileError extends ReactiveFetchError {
  readonly code = 'webid_profile';
  readonly webId: string;

  constructor(webId: string, message?: string, options?: ErrorOptions) {
    super(message ?? `Failed to fetch or parse WebID Profile Document at ${webId}.`, options);
    this.name = 'WebIdProfileError';
    this.webId = webId;
  }
}

export class NoOidcIssuerError extends ReactiveFetchError {
  readonly code = 'no_oidc_issuer';
  readonly webId: string;

  constructor(webId: string, message?: string, options?: ErrorOptions) {
    super(message ?? `WebID Profile Document at ${webId} has no solid:oidcIssuer triple.`, options);
    this.name = 'NoOidcIssuerError';
    this.webId = webId;
  }
}

export class InvalidIssuerError extends ReactiveFetchError {
  readonly code = 'invalid_issuer';
  readonly webId: string;
  readonly issuer: string;

  constructor(webId: string, issuer: string, message?: string, options?: ErrorOptions) {
    super(
      message ??
        `OIDC issuer "${issuer}" declared by WebID ${webId} is not a valid HTTPS URL.`,
      options,
    );
    this.name = 'InvalidIssuerError';
    this.webId = webId;
    this.issuer = issuer;
  }
}

/**
 * Thrown when a WebID string entered by the user is syntactically invalid or
 * uses a disallowed scheme. The prompt-flavoured factory validates the WebID
 * synchronously before opening the popup so a hostile `javascript:`/`data:`/
 * `file:` URL can never reach the popup query string. The popup-flavoured
 * factory hits the same path through the in-popup form's URL validation.
 */
export class InvalidWebIdError extends ReactiveFetchError {
  readonly code = 'invalid_webid';
  readonly raw: string;

  constructor(raw: string, message?: string, options?: ErrorOptions) {
    super(message ?? `"${raw}" is not a valid WebID URL.`, options);
    this.name = 'InvalidWebIdError';
    this.raw = raw;
  }
}

/**
 * The user cancelled (or dismissed) the `window.prompt()` that asks for a
 * WebID in the prompt-flavoured factory. Pending `webId` and `fetch` Promises
 * reject with this so callers can distinguish a deliberate abort from a real
 * failure.
 */
export class WebIdPromptCancelledError extends ReactiveFetchError {
  readonly code = 'webid_prompt_cancelled';

  constructor(
    message = 'WebID prompt cancelled before a WebID was entered.',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'WebIdPromptCancelledError';
  }
}

export class LoginFailedError extends ReactiveFetchError {
  readonly code = 'login_failed';

  constructor(message = 'Solid-OIDC login flow failed.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'LoginFailedError';
  }
}

export class SessionRestoreFailedError extends ReactiveFetchError {
  readonly code = 'session_restore_failed';

  constructor(
    message = 'Session did not become active after login — the underlying library resolved restore() without flipping isActive, usually indicating a malformed access token or a DPoP / client_id mismatch between popup and opener.',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SessionRestoreFailedError';
  }
}

export class OriginMismatchError extends ReactiveFetchError {
  readonly code = 'origin_mismatch';
  readonly expectedOrigin: string;
  readonly actualOrigin: string;

  constructor(
    expectedOrigin: string,
    actualOrigin: string,
    message?: string,
    options?: ErrorOptions,
  ) {
    super(
      message ??
        `postMessage origin mismatch: expected ${expectedOrigin}, got ${actualOrigin}.`,
      options,
    );
    this.name = 'OriginMismatchError';
    this.expectedOrigin = expectedOrigin;
    this.actualOrigin = actualOrigin;
  }
}
