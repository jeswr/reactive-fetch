import { Session } from '@uvdsl/solid-oidc-client-browser';
import {
  LoginFailedError,
  NoOidcIssuerError,
  ReactiveFetchError,
  WebIdProfileError,
} from '../errors.js';
import { LOGIN_COMPLETE_MESSAGE_TYPE } from '../popup.js';
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

async function resolveOidcIssuer(webId: string): Promise<string> {
  let response: Response;
  try {
    response = await globalThis.fetch(webId, {
      headers: { Accept: 'text/turtle, application/ld+json;q=0.9, */*;q=0.1' },
    });
  } catch (cause) {
    throw new WebIdProfileError(webId, `Failed to fetch WebID profile at ${webId}.`, {
      cause,
    });
  }

  if (!response.ok) {
    throw new WebIdProfileError(
      webId,
      `WebID profile fetch returned HTTP ${response.status} for ${webId}.`,
    );
  }

  const body = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const issuer = extractOidcIssuer(body, contentType);
  if (!issuer) throw new NoOidcIssuerError(webId);
  return issuer;
}

const OIDC_ISSUER_IRI = 'http://www.w3.org/ns/solid/terms#oidcIssuer';

function extractOidcIssuer(body: string, contentType: string): string | null {
  if (contentType.includes('json')) {
    return extractFromJsonLd(body);
  }
  return extractFromTurtle(body);
}

function extractFromTurtle(body: string): string | null {
  const pattern = new RegExp(
    `(?:solid:oidcIssuer|<${escapeRegex(OIDC_ISSUER_IRI)}>)\\s+<([^>]+)>`,
  );
  const match = body.match(pattern);
  return match?.[1] ?? null;
}

function extractFromJsonLd(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const nodes = Array.isArray(parsed) ? parsed : [parsed];
  for (const node of nodes) {
    const issuer = findIssuerInNode(node);
    if (issuer) return issuer;
  }
  return null;
}

function findIssuerInNode(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of ['solid:oidcIssuer', OIDC_ISSUER_IRI]) {
    const value = obj[key];
    const coerced = coerceIssuer(value);
    if (coerced) return coerced;
  }

  const graph = obj['@graph'];
  if (Array.isArray(graph)) {
    for (const child of graph) {
      const found = findIssuerInNode(child);
      if (found) return found;
    }
  }
  return null;
}

function coerceIssuer(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = coerceIssuer(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const id = (value as Record<string, unknown>)['@id'];
    if (typeof id === 'string') return id;
  }
  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function describeError(err: unknown): string {
  if (err instanceof ReactiveFetchError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unexpected error while starting login.';
}
