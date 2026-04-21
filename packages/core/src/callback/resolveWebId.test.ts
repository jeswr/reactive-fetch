import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { InvalidIssuerError, NoOidcIssuerError } from '../errors.js';
import { resolveOidcIssuers } from './resolveWebId.js';

const TURTLE_HEADERS = { 'content-type': 'text/turtle' };

function mockFetchWith(body: string, headers: Record<string, string> = TURTLE_HEADERS) {
  return vi.fn<(typeof globalThis.fetch)>(async () => new Response(body, {
    status: 200,
    headers,
  }));
}

describe('resolveOidcIssuers', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // Every test installs its own mock; restore between to avoid cross-test leak.
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('returns only issuers whose subject matches the WebID IRI', async () => {
    // Two subjects each declare an oidcIssuer; only the WebID's issuer should surface.
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me> solid:oidcIssuer <https://idp.example.com/> .
      <https://other.example/profile#not-me> solid:oidcIssuer <https://wrong-idp.example.com/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    const issuers = await resolveOidcIssuers('https://example.com/profile#me');
    expect(issuers).toEqual(['https://idp.example.com/']);
  });

  test('returns all issuers declared on the WebID subject when there are several', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me>
        solid:oidcIssuer <https://idp-a.example.com/> ,
                         <https://idp-b.example.com/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    const issuers = await resolveOidcIssuers('https://example.com/profile#me');
    expect([...issuers].sort()).toEqual([
      'https://idp-a.example.com/',
      'https://idp-b.example.com/',
    ]);
  });

  test('throws NoOidcIssuerError when the profile has no oidcIssuer triple at all', async () => {
    const body = `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <https://example.com/profile#me> foaf:name "No IdP" .
    `;
    globalThis.fetch = mockFetchWith(body);

    await expect(
      resolveOidcIssuers('https://example.com/profile#me'),
    ).rejects.toBeInstanceOf(NoOidcIssuerError);
  });

  test('throws NoOidcIssuerError when oidcIssuer is declared only on a different subject', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://other.example/profile#not-me> solid:oidcIssuer <https://idp.example.com/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    await expect(
      resolveOidcIssuers('https://example.com/profile#me'),
    ).rejects.toBeInstanceOf(NoOidcIssuerError);
  });

  test('rejects non-https issuers and throws InvalidIssuerError', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me>
        solid:oidcIssuer <javascript:alert(1)> ,
                         <http://auth.example.com/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    await expect(
      resolveOidcIssuers('https://example.com/profile#me'),
    ).rejects.toBeInstanceOf(InvalidIssuerError);
  });

  test('accepts http://localhost for dev workflows', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me> solid:oidcIssuer <http://localhost:3000/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    const issuers = await resolveOidcIssuers('https://example.com/profile#me');
    expect(issuers).toEqual(['http://localhost:3000/']);
  });

  test('accepts http://[::1] (IPv6 loopback) for dev workflows', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me> solid:oidcIssuer <http://[::1]:3000/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    const issuers = await resolveOidcIssuers('https://example.com/profile#me');
    expect(issuers).toEqual(['http://[::1]:3000/']);
  });

  test('rejects http://example.com (non-loopback plaintext) with InvalidIssuerError', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me> solid:oidcIssuer <http://example.com/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    await expect(
      resolveOidcIssuers('https://example.com/profile#me'),
    ).rejects.toBeInstanceOf(InvalidIssuerError);
  });
});
