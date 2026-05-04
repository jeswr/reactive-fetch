// Shared OIDC-redirect-handling primitives composed by
// `@jeswr/solid-reactive-fetch`'s `mountCallback`. The callback page
// has two entry shapes:
//
//   - `?webId=…` already provided by the parent (because a `WebIdDriver`
//     ran before `window.open`): skip the in-popup form, go straight to
//     OIDC discovery.
//   - no `?webId=`: render the built-in WebID-input form (and the
//     cached-WebIDs list, if any).

import { Session } from '@uvdsl/solid-oidc-client-browser';
import {
  InvalidWebIdError,
  LoginFailedError,
  ReactiveFetchError,
} from '../errors.js';
import { LOGIN_COMPLETE_MESSAGE_TYPE } from '../popup.js';
import { resolveWebIdProfile, type WebIdProfile } from './resolveWebId.js';
import {
  IssuerPickerCancelled,
  renderIssuerPicker,
  type IssuerPickerUi,
} from './issuerPickerUi.js';
import { rememberWebId } from './webidCache.js';

/**
 * Options shared by every callback flavour. Per-flavour `mountCallback`
 * implementations widen this with their own knobs (e.g. core's `root` /
 * cached-list re-render callbacks).
 */
export interface SharedCallbackOptions {
  clientId?: string;
  /**
   * Accept `http://localhost` / `127.0.0.1` / `[::1]` as valid OIDC issuers
   * in addition to HTTPS. Defaults to `false` — a WebID profile declaring a
   * localhost issuer is rejected with `InvalidIssuerError`, preventing a
   * hostile profile from redirecting a user's popup at a local port.
   */
  allowLocalhost?: boolean;
}

/**
 * Detect & handle the `?code=…&state=…` redirect leg. Returns true if the
 * current page IS that redirect (and we ran the handler + posted a message
 * + closed the window), false otherwise.
 *
 * Always call this first inside a `mountCallback` implementation; the rest
 * of the callback flow only runs on the initial popup open.
 */
export async function runOidcRedirectIfPresent(
  options: SharedCallbackOptions,
): Promise<boolean> {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('code') || !params.has('state')) return false;
  await handleRedirect(options.clientId);
  return true;
}

async function handleRedirect(clientId?: string): Promise<void> {
  try {
    const session = buildSession(clientId);
    await session.handleRedirectFromLogin();
  } catch (cause) {
    throw new LoginFailedError('Failed to handle IDP redirect inside popup.', { cause });
  }

  const opener = window.opener as Window | null;
  if (opener && !opener.closed) {
    opener.postMessage(
      { type: LOGIN_COMPLETE_MESSAGE_TYPE },
      window.location.origin,
    );
  }
  window.close();
}

/**
 * Pull the `?webId=` query parameter (set by the prompt-flavoured factory
 * before opening the popup) and validate it synchronously. Throws
 * `InvalidWebIdError` if the value is missing, malformed, or uses a
 * disallowed scheme.
 *
 * Defence-in-depth: even though the prompt-flavoured factory validates the
 * WebID before constructing the popup URL, a hostile actor could fabricate
 * a popup URL with a `javascript:` WebID and post-message it (or open the
 * callback directly with a phishing query string). Validate again here.
 */
export function readWebIdFromQueryStrict(
  rawSearch: string = window.location.search,
  options: { allowLocalhost?: boolean } = {},
): string {
  const params = new URLSearchParams(rawSearch);
  const raw = params.get('webId');
  if (raw === null) {
    throw new InvalidWebIdError('', 'No webId query parameter present on the callback URL.');
  }
  return validateWebIdSyncStrict(raw, options);
}

/**
 * As `readWebIdFromQueryStrict` but returns null when no `webId` param is
 * present (instead of throwing). The mount-flow uses this to branch on
 * "short-circuit vs. show form".
 */
export function readWebIdFromQueryOrNull(
  rawSearch: string = window.location.search,
  options: { allowLocalhost?: boolean } = {},
): string | null {
  const params = new URLSearchParams(rawSearch);
  if (!params.has('webId')) return null;
  return readWebIdFromQueryStrict(rawSearch, options);
}

/**
 * Validate a WebID string. Accepts only `https:` URLs by default;
 * `http:` localhost forms are accepted iff `allowLocalhost` is true.
 *
 * NOTE: `javascript:`, `data:`, `file:`, `blob:`, etc. are rejected
 * regardless of the localhost flag. This is a security boundary — a
 * hostile WebID input must never be accepted as a popup destination.
 */
export function validateWebIdSyncStrict(
  raw: string,
  options: { allowLocalhost?: boolean } = {},
): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new InvalidWebIdError(raw, 'WebID is empty.');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidWebIdError(raw, 'WebID must be a valid absolute URL.');
  }

  if (url.protocol === 'https:') {
    rejectEmbeddedCredentials(url, raw);
    return url.toString();
  }

  if (url.protocol === 'http:' && options.allowLocalhost) {
    if (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]'
    ) {
      rejectEmbeddedCredentials(url, raw);
      return url.toString();
    }
  }

  throw new InvalidWebIdError(
    raw,
    `WebID URL scheme "${url.protocol}" is not allowed${
      options.allowLocalhost ? ' (only https: or http: localhost)' : ' (only https:)'
    }.`,
  );
}

// `https://attacker:hunter2@victim.example/...` parses cleanly and has
// `protocol === 'https:'`, but forwarding it to `fetchRdf` makes the popup
// send `Authorization: Basic …` to the host — a credential-phishing channel
// plus a per-victim tracking ID. Reject embedded userinfo regardless of the
// localhost flag.
function rejectEmbeddedCredentials(url: URL, raw: string): void {
  if (url.username !== '' || url.password !== '') {
    throw new InvalidWebIdError(raw, 'WebID must not contain embedded credentials.');
  }
}

export interface DriveLoginCallbacks {
  /** Called once we know we're moving past the WebID-input step. */
  onLoginStart(): void;
  /** Called when discovery / IDP redirect failed. Provides a human message. */
  onError(message: string): void;
  /**
   * Called when the issuer picker is cancelled by the user. The host
   * implementation can re-render whichever view it likes (the cached-list
   * for core, an empty error for prompt). If omitted, cancel is silent —
   * the picker has already disposed itself.
   */
  onIssuerPickerCancelled?(webId: string): void;
}

/**
 * Discover the OIDC issuer(s) for the given WebID and either redirect to
 * the IDP (single issuer) or render the issuer picker (multiple). Used by
 * both core's manual-input + cached-pick paths and prompt's `?webId=`
 * short-circuit.
 */
export async function driveLoginFromWebId(
  options: SharedCallbackOptions,
  parent: HTMLElement,
  webId: string,
  callbacks: DriveLoginCallbacks,
): Promise<void> {
  let profile: WebIdProfile;
  try {
    profile = await resolveWebIdProfile(webId, {
      allowLocalhost: options.allowLocalhost ?? false,
    });
  } catch (err) {
    callbacks.onError(describeError(err));
    return;
  }

  // Remember the WebID now, before the IDP redirect. If the user aborts the
  // IDP step they can still use the cached entry next time; they can also
  // forget it. Name + photo come from the profile fetch so the cache renders
  // without re-fetching.
  rememberWebId({
    webId,
    ...(profile.name !== undefined && { name: profile.name }),
    ...(profile.photoUrl !== undefined && { photoUrl: profile.photoUrl }),
  });

  if (profile.issuers.length === 1) {
    // Keep the active UI alive across the redirect setup so that an
    // exception from `beginSolidLogin` (network failure, mis-configured
    // IDP discovery, etc.) can be surfaced via `onError` on a still-mounted
    // form. `onLoginStart` only fires once the IDP navigation is in flight,
    // at which point the UI is about to be torn down by the navigation.
    try {
      await beginSolidLogin(options, profile.issuers[0]!);
    } catch (err) {
      callbacks.onError(describeError(err));
      return;
    }
    callbacks.onLoginStart();
    return;
  }

  callbacks.onLoginStart();
  await runIssuerPicker(options, parent, webId, profile.issuers, callbacks);
}

async function runIssuerPicker(
  options: SharedCallbackOptions,
  parent: HTMLElement,
  webId: string,
  issuers: string[],
  callbacks: DriveLoginCallbacks,
): Promise<void> {
  const picker: IssuerPickerUi = renderIssuerPicker(parent, issuers);

  let chosen: string;
  try {
    chosen = await picker.selection;
  } catch (err) {
    picker.dispose();
    if (err instanceof IssuerPickerCancelled) {
      callbacks.onIssuerPickerCancelled?.(webId);
      return;
    }
    throw err;
  }

  picker.setBusy(true);
  picker.setStatus('Redirecting to the identity provider…');
  try {
    await beginSolidLogin(options, chosen);
  } catch (err) {
    picker.setBusy(false);
    picker.setStatus(describeError(err), 'error');
  }
}

export async function beginSolidLogin(
  options: SharedCallbackOptions,
  issuer: string,
): Promise<void> {
  const session = buildSession(options.clientId);
  await session.login(issuer, popupRedirectUri());
}

// The popup constructs two Sessions — one before the IDP redirect (for
// `login`) and one after (for `handleRedirectFromLogin`). Both must receive
// the same client details so the second Session can rehydrate what the
// first one persisted. `@uvdsl/solid-oidc-client-browser` accepts either a
// hosted Client ID Document URI (preferred) or dynamic-registration details
// with an explicit redirect_uris array.
export function buildSession(clientId?: string): Session {
  if (clientId) {
    return new Session({ client_id: clientId });
  }
  return new Session({ redirect_uris: [popupRedirectUri()] });
}

// The IDP must redirect back to the popup URL WITHOUT the `?webId=` query
// param the prompt-flavoured factory adds — otherwise the post-redirect
// `code+state` round-trip would carry it through and we'd treat the
// redirected page as a "fresh" prompt-driven session. Strip the param from
// the redirect_uri we hand to the IDP.
function popupRedirectUri(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('webId');
  return url.toString();
}

export function describeError(err: unknown): string {
  if (err instanceof ReactiveFetchError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unexpected error while starting login.';
}
