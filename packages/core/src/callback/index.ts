import { Session } from '@uvdsl/solid-oidc-client-browser';
import { LoginFailedError, ReactiveFetchError } from '../errors.js';
import { LOGIN_COMPLETE_MESSAGE_TYPE } from '../popup.js';
import { resolveWebIdProfile, type WebIdProfile } from './resolveWebId.js';
import {
  forgetWebId,
  getCachedWebIds,
  rememberWebId,
  type CachedWebId,
} from './webidCache.js';
import {
  IssuerPickerCancelled,
  renderCachedWebIdsList,
  renderIssuerPicker,
  renderPromptUi,
  type CachedWebIdsUi,
} from './ui.js';

export interface MountCallbackOptions {
  root?: HTMLElement;
  clientId?: string;
  /**
   * Accept `http://localhost` / `127.0.0.1` / `[::1]` as valid OIDC issuers
   * in addition to HTTPS. Defaults to `false` — a WebID profile declaring a
   * localhost issuer is rejected with `InvalidIssuerError`, preventing a
   * hostile profile from redirecting a user's popup at a local port.
   *
   * Set to `true` only in local dev builds. This flag MUST match the
   * `allowLocalhost` passed to `createReactiveFetch` in the parent app;
   * otherwise the parent-vs-popup view of which issuers are acceptable will
   * diverge (practically harmless — the parent's flag is informational
   * today — but the two sides are meant to be kept in sync).
   */
  allowLocalhost?: boolean;
}

export async function mountCallback(options: MountCallbackOptions = {}): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (params.has('code') && params.has('state')) {
    await handleRedirect(options.clientId);
    return;
  }

  const cached = getCachedWebIds();
  if (cached.length > 0) {
    showCachedList(options, cached);
    return;
  }

  showWebIdForm(options);
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

function showCachedList(
  options: MountCallbackOptions,
  entries: CachedWebId[],
): void {
  const parent = options.root ?? document.body;
  let ui: CachedWebIdsUi | null = null;

  ui = renderCachedWebIdsList(parent, entries, {
    onPick: (webId) => {
      ui?.setBusy(true);
      ui?.setStatus('Looking up your identity provider…');
      void driveLoginFromWebId(options, parent, webId, () => {
        ui?.dispose();
        ui = null;
      }, (message) => {
        ui?.setBusy(false);
        ui?.setStatus(message, 'error');
      });
    },
    onForget: (webId) => {
      forgetWebId(webId);
      const remaining = getCachedWebIds();
      ui?.dispose();
      ui = null;
      if (remaining.length > 0) {
        showCachedList(options, remaining);
      } else {
        showWebIdForm(options);
      }
    },
    onUseDifferent: () => {
      ui?.dispose();
      ui = null;
      showWebIdForm(options);
    },
  });
}

function showWebIdForm(options: MountCallbackOptions, seedValue?: string): void {
  const parent = options.root ?? document.body;
  const ui = renderPromptUi(parent);
  if (seedValue) ui.input.value = seedValue;

  ui.root.addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = ui.input.value.trim();

    if (!raw) {
      ui.setStatus('Please enter your WebID.', 'error');
      return;
    }

    let webId: URL;
    try {
      webId = new URL(raw);
    } catch {
      ui.setStatus('WebID must be a valid URL.', 'error');
      return;
    }

    ui.setBusy(true);
    ui.setStatus('Looking up your identity provider…');

    await driveLoginFromWebId(
      options,
      parent,
      webId.toString(),
      () => { ui.dispose(); },
      (message) => {
        ui.setBusy(false);
        ui.setStatus(message, 'error');
      },
    );
  });
}

// Shared flow for the "we have a WebID, resolve its profile and either log
// in directly (single issuer) or show the picker (multiple issuers)".
// Used by both the cached-card click path and the manual-input submit path.
async function driveLoginFromWebId(
  options: MountCallbackOptions,
  parent: HTMLElement,
  webId: string,
  onLoginStart: () => void,
  onError: (message: string) => void,
): Promise<void> {
  let profile: WebIdProfile;
  try {
    profile = await resolveWebIdProfile(webId, {
      allowLocalhost: options.allowLocalhost ?? false,
    });
  } catch (err) {
    onError(describeError(err));
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
    onLoginStart();
    try {
      await beginSolidLogin(options, profile.issuers[0]!);
    } catch (err) {
      // Login start itself failed (rare — the IDP redirect is imperative);
      // we've already removed the previous UI so surface to the cached view.
      showCachedList(options, getCachedWebIds());
      // Schedule the status after the fresh UI has rendered.
      queueMicrotask(() => onError(describeError(err)));
    }
    return;
  }

  onLoginStart();
  await showIssuerPicker(options, parent, webId, profile.issuers);
}

async function showIssuerPicker(
  options: MountCallbackOptions,
  parent: HTMLElement,
  webIdValue: string,
  issuers: string[],
): Promise<void> {
  const picker = renderIssuerPicker(parent, issuers);

  let chosen: string;
  try {
    chosen = await picker.selection;
  } catch (err) {
    picker.dispose();
    if (err instanceof IssuerPickerCancelled) {
      // Re-render the most appropriate starting view — cached list if any,
      // else the input seeded with whatever WebID the user just came from.
      const remaining = getCachedWebIds();
      if (remaining.length > 0) {
        showCachedList(options, remaining);
      } else {
        showWebIdForm(options, webIdValue);
      }
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

async function beginSolidLogin(
  options: MountCallbackOptions,
  issuer: string,
): Promise<void> {
  const session = buildSession(options.clientId);
  await session.login(issuer, window.location.href);
}

// The popup constructs two Sessions — one before the IDP redirect (for
// `login`) and one after (for `handleRedirectFromLogin`). Both must receive
// the same client details so the second Session can rehydrate what the
// first one persisted. `@uvdsl/solid-oidc-client-browser` accepts either a
// hosted Client ID Document URI (preferred) or dynamic-registration details
// with an explicit redirect_uris array.
function buildSession(clientId?: string): Session {
  if (clientId) {
    return new Session({ client_id: clientId });
  }
  return new Session({ redirect_uris: [window.location.href] });
}

function describeError(err: unknown): string {
  if (err instanceof ReactiveFetchError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unexpected error while starting login.';
}
