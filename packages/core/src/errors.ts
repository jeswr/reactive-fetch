export type ReactiveFetchErrorCode =
  | 'popup_blocked'
  | 'popup_closed'
  | 'webid_profile'
  | 'no_oidc_issuer'
  | 'login_failed'
  | 'origin_mismatch';

export abstract class ReactiveFetchError extends Error {
  abstract readonly code: ReactiveFetchErrorCode;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions | undefined);
    this.name = new.target.name;
  }
}

export class PopupBlockedError extends ReactiveFetchError {
  readonly code = 'popup_blocked';

  constructor(message = 'Popup was blocked by the browser. Ensure login() is called from a user gesture.') {
    super(message);
  }
}

export class PopupClosedError extends ReactiveFetchError {
  readonly code = 'popup_closed';

  constructor(message = 'Login popup was closed before authentication completed.') {
    super(message);
  }
}

export class WebIdProfileError extends ReactiveFetchError {
  readonly code = 'webid_profile';
  readonly webId: string;

  constructor(webId: string, message?: string, options?: { cause?: unknown }) {
    super(message ?? `Failed to fetch or parse WebID Profile Document at ${webId}.`, options);
    this.webId = webId;
  }
}

export class NoOidcIssuerError extends ReactiveFetchError {
  readonly code = 'no_oidc_issuer';
  readonly webId: string;

  constructor(webId: string, message?: string) {
    super(message ?? `WebID Profile Document at ${webId} has no solid:oidcIssuer triple.`);
    this.webId = webId;
  }
}

export class LoginFailedError extends ReactiveFetchError {
  readonly code = 'login_failed';

  constructor(message = 'Solid-OIDC login flow failed.', options?: { cause?: unknown }) {
    super(message, options);
  }
}

export class OriginMismatchError extends ReactiveFetchError {
  readonly code = 'origin_mismatch';
  readonly expectedOrigin: string;
  readonly actualOrigin: string;

  constructor(expectedOrigin: string, actualOrigin: string, message?: string) {
    super(
      message ??
        `postMessage origin mismatch: expected ${expectedOrigin}, got ${actualOrigin}.`,
    );
    this.expectedOrigin = expectedOrigin;
    this.actualOrigin = actualOrigin;
  }
}
