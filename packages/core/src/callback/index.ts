import { Session } from '@uvdsl/solid-oidc-client-browser';
import { LoginFailedError, ReactiveFetchError } from '../errors.js';
import { LOGIN_COMPLETE_MESSAGE_TYPE } from '../popup.js';
import { resolveOidcIssuer } from './resolveWebId.js';
import { renderPromptUi } from './ui.js';

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

  renderPrompt(options);
}

async function handleRedirect(clientId?: string): Promise<void> {
  try {
    const session = clientId ? new Session({ client_id: clientId }) : new Session();
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

function renderPrompt(options: MountCallbackOptions): void {
  const parent = options.root ?? document.body;
  const ui = renderPromptUi(parent);

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

    try {
      const issuer = await resolveOidcIssuer(webId.toString());
      const session = options.clientId
        ? new Session({ client_id: options.clientId })
        : new Session({ redirect_uris: [window.location.href] });
      await session.login(issuer, window.location.href);
    } catch (err) {
      ui.setBusy(false);
      ui.setStatus(describeError(err), 'error');
    }
  });
}

function describeError(err: unknown): string {
  if (err instanceof ReactiveFetchError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unexpected error while starting login.';
}
