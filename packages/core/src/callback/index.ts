import { Session } from '@uvdsl/solid-oidc-client-browser';
import { LoginFailedError, ReactiveFetchError } from '../errors.js';
import { LOGIN_COMPLETE_MESSAGE_TYPE } from '../popup.js';
import { resolveOidcIssuers } from './resolveWebId.js';
import {
  IssuerPickerCancelled,
  renderIssuerPicker,
  renderPromptUi,
  type PromptUi,
} from './ui.js';

export interface MountCallbackOptions {
  root?: HTMLElement;
  clientId?: string;
}

export async function mountCallback(options: MountCallbackOptions = {}): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  if (params.has('code') && params.has('state')) {
    await handleRedirect(options.clientId);
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

    let issuers: string[];
    try {
      issuers = await resolveOidcIssuers(webId.toString());
    } catch (err) {
      ui.setBusy(false);
      ui.setStatus(describeError(err), 'error');
      return;
    }

    if (issuers.length === 1) {
      await startLogin(ui, options, issuers[0]!);
      return;
    }

    ui.dispose();
    await showIssuerPicker(options, parent, raw, issuers);
  });
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
      showWebIdForm(options, webIdValue);
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

async function startLogin(
  ui: PromptUi,
  options: MountCallbackOptions,
  issuer: string,
): Promise<void> {
  try {
    await beginSolidLogin(options, issuer);
  } catch (err) {
    ui.setBusy(false);
    ui.setStatus(describeError(err), 'error');
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
