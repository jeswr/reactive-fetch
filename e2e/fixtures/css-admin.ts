// Helpers that drive CSS's account + client-credentials API to obtain an
// authenticated fetch for a seeded user, then use it to seed test data
// (private files, ACLs, multi-issuer profiles). Happens outside the browser
// so seeding is fast and independent of UI state.

import { ALICE, BOB, CSS_URL } from './constants.js';

export interface CssCredentials {
  email: string;
  password: string;
}

export interface CssFetcher {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  webId: string;
}

interface LoginResponse {
  authorization: string;
}

interface AccountResponse {
  controls: {
    password: { login: string };
    account: { clientCredentials: string };
  };
}

interface ClientCredentialsResponse {
  id: string;
  secret: string;
  resource: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

async function jsonOk<T>(res: Response, context: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CSS admin ${context} failed (${res.status} ${res.statusText}): ${body}`);
  }
  return res.json() as Promise<T>;
}

function webIdForCreds(creds: CssCredentials): string {
  if (creds.email === ALICE.email) return ALICE.webId;
  if (creds.email === BOB.email) return BOB.webId;
  const local = creds.email.split('@')[0];
  if (!local) throw new Error(`cannot derive webId from email: ${creds.email}`);
  return `${CSS_URL}/${local}/profile/card#me`;
}

export async function getAuthenticatedFetch(creds: CssCredentials): Promise<CssFetcher> {
  const webId = webIdForCreds(creds);

  const accountRes = await fetch(`${CSS_URL}/.account/`);
  const account = await jsonOk<AccountResponse>(accountRes, 'account discovery');

  const loginRes = await fetch(account.controls.password.login, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const login = await jsonOk<LoginResponse>(loginRes, 'password login');

  const ccRes = await fetch(account.controls.account.clientCredentials, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `CSS-Account-Token ${login.authorization}`,
    },
    body: JSON.stringify({ name: `e2e-${Date.now()}`, webId }),
  });
  const cc = await jsonOk<ClientCredentialsResponse>(ccRes, 'client credentials');

  const basic = Buffer.from(
    `${encodeURIComponent(cc.id)}:${encodeURIComponent(cc.secret)}`,
  ).toString('base64');
  const tokenRes = await fetch(`${CSS_URL}/.oidc/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${basic}`,
    },
    body: 'grant_type=client_credentials&scope=webid',
  });
  const token = await jsonOk<TokenResponse>(tokenRes, 'token exchange');

  return {
    webId,
    async fetch(input: string, init?: RequestInit): Promise<Response> {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${token.access_token}`);
      return fetch(input, { ...init, headers });
    },
  };
}

export async function putResource(
  fetcher: CssFetcher,
  url: string,
  body: string,
  contentType: string,
): Promise<void> {
  const res = await fetcher.fetch(url, {
    method: 'PUT',
    headers: { 'content-type': contentType },
    body,
  });
  if (!res.ok && res.status !== 205) {
    const detail = await res.text().catch(() => '');
    throw new Error(`PUT ${url} failed (${res.status}): ${detail}`);
  }
}

export async function putAcl(
  fetcher: CssFetcher,
  resourceUrl: string,
  aclTurtle: string,
): Promise<void> {
  const aclUrl = `${resourceUrl}.acl`;
  await putResource(fetcher, aclUrl, aclTurtle, 'text/turtle');
}

export function privateContainerAcl(containerUrl: string, webId: string): string {
  return [
    '@prefix acl: <http://www.w3.org/ns/auth/acl#>.',
    '',
    '<#owner>',
    '  a acl:Authorization;',
    `  acl:agent <${webId}>;`,
    `  acl:accessTo <${containerUrl}>;`,
    `  acl:default <${containerUrl}>;`,
    '  acl:mode acl:Read, acl:Write, acl:Control.',
    '',
  ].join('\n');
}

export function publicReadAcl(resourceUrl: string, ownerWebId: string): string {
  return [
    '@prefix acl: <http://www.w3.org/ns/auth/acl#>.',
    '@prefix foaf: <http://xmlns.com/foaf/0.1/>.',
    '',
    '<#owner>',
    '  a acl:Authorization;',
    `  acl:agent <${ownerWebId}>;`,
    `  acl:accessTo <${resourceUrl}>;`,
    '  acl:mode acl:Read, acl:Write, acl:Control.',
    '',
    '<#public>',
    '  a acl:Authorization;',
    `  acl:accessTo <${resourceUrl}>;`,
    '  acl:agentClass foaf:Agent;',
    '  acl:mode acl:Read.',
    '',
  ].join('\n');
}

export function multiIssuerProfile(webIdUri: string, issuers: string[]): string {
  const frag = new URL(webIdUri).hash;
  const subject = frag && frag.startsWith('#') ? `<${frag}>` : '<#me>';
  const issuerTriples = issuers.map((iss) => `  solid:oidcIssuer <${iss}>;`).join('\n');
  return [
    '@prefix foaf: <http://xmlns.com/foaf/0.1/>.',
    '@prefix solid: <http://www.w3.org/ns/solid/terms#>.',
    '',
    subject,
    '  a foaf:Person;',
    issuerTriples,
    '  foaf:name "Multi Issuer User".',
    '',
  ].join('\n');
}
