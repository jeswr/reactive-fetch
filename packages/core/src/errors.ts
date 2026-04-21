export type ReactiveFetchErrorCode =
  | 'popup_blocked'
  | 'popup_closed'
  | 'popup_timeout'
  | 'webid_profile'
  | 'no_oidc_issuer'
  | 'invalid_issuer'
  | 'login_failed'
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

export class LoginFailedError extends ReactiveFetchError {
  readonly code = 'login_failed';

  constructor(message = 'Solid-OIDC login flow failed.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'LoginFailedError';
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
