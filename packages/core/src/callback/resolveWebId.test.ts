import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { InvalidIssuerError, NoOidcIssuerError, WebIdProfileError } from '../errors.js';
import { resolveOidcIssuers, resolveWebIdProfile } from './resolveWebId.js';

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

  test('accepts http://localhost when allowLocalhost is true', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me> solid:oidcIssuer <http://localhost:3000/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    const issuers = await resolveOidcIssuers('https://example.com/profile#me', {
      allowLocalhost: true,
    });
    expect(issuers).toEqual(['http://localhost:3000/']);
  });

  test('accepts http://[::1] (IPv6 loopback) when allowLocalhost is true', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me> solid:oidcIssuer <http://[::1]:3000/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    const issuers = await resolveOidcIssuers('https://example.com/profile#me', {
      allowLocalhost: true,
    });
    expect(issuers).toEqual(['http://[::1]:3000/']);
  });

  test('rejects http://localhost by default (allowLocalhost unset)', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me> solid:oidcIssuer <http://localhost:3000/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    await expect(
      resolveOidcIssuers('https://example.com/profile#me'),
    ).rejects.toBeInstanceOf(InvalidIssuerError);
  });

  test('rejects http://localhost when allowLocalhost is explicitly false', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me> solid:oidcIssuer <http://127.0.0.1:3000/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    await expect(
      resolveOidcIssuers('https://example.com/profile#me', { allowLocalhost: false }),
    ).rejects.toBeInstanceOf(InvalidIssuerError);
  });

  test('accepts HTTPS issuer regardless of allowLocalhost', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me> solid:oidcIssuer <https://idp.example.com/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    const offBy = await resolveOidcIssuers('https://example.com/profile#me');
    const onBy = await resolveOidcIssuers('https://example.com/profile#me', {
      allowLocalhost: true,
    });
    expect(offBy).toEqual(['https://idp.example.com/']);
    expect(onBy).toEqual(['https://idp.example.com/']);
  });

  test('rejects javascript: / file: schemes regardless of allowLocalhost', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me>
        solid:oidcIssuer <javascript:alert(1)> ,
                         <file:///etc/hosts> .
    `;
    globalThis.fetch = mockFetchWith(body);

    await expect(
      resolveOidcIssuers('https://example.com/profile#me', { allowLocalhost: true }),
    ).rejects.toBeInstanceOf(InvalidIssuerError);
    await expect(
      resolveOidcIssuers('https://example.com/profile#me', { allowLocalhost: false }),
    ).rejects.toBeInstanceOf(InvalidIssuerError);
  });

  test('rejects http://example.com (non-loopback plaintext) even with allowLocalhost', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me> solid:oidcIssuer <http://example.com/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    await expect(
      resolveOidcIssuers('https://example.com/profile#me', { allowLocalhost: true }),
    ).rejects.toBeInstanceOf(InvalidIssuerError);
  });
});

describe('resolveOidcIssuers: JSON-LD profile path', () => {
  const realFetch = globalThis.fetch;
  const JSON_LD_HEADERS = { 'content-type': 'application/ld+json' };

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('extracts single solid:oidcIssuer from a JSON-LD profile', async () => {
    const body = JSON.stringify({
      '@context': { solid: 'http://www.w3.org/ns/solid/terms#' },
      '@id': 'https://alice.example/profile#me',
      'solid:oidcIssuer': { '@id': 'https://idp.example.com/' },
    });
    globalThis.fetch = mockFetchWith(body, JSON_LD_HEADERS);

    const issuers = await resolveOidcIssuers('https://alice.example/profile#me');
    expect(issuers).toEqual(['https://idp.example.com/']);
  });

  test('returns all issuers from a multi-issuer JSON-LD profile', async () => {
    const body = JSON.stringify({
      '@context': { solid: 'http://www.w3.org/ns/solid/terms#' },
      '@id': 'https://alice.example/profile#me',
      'solid:oidcIssuer': [
        { '@id': 'https://idp-a.example.com/' },
        { '@id': 'https://idp-b.example.com/' },
      ],
    });
    globalThis.fetch = mockFetchWith(body, JSON_LD_HEADERS);

    const issuers = await resolveOidcIssuers('https://alice.example/profile#me');
    expect([...issuers].sort()).toEqual([
      'https://idp-a.example.com/',
      'https://idp-b.example.com/',
    ]);
  });

  test('selects JSON-LD branch on application/ld+json Content-Type even with charset param', async () => {
    const body = JSON.stringify({
      '@context': { solid: 'http://www.w3.org/ns/solid/terms#' },
      '@id': 'https://alice.example/profile#me',
      'solid:oidcIssuer': { '@id': 'https://idp.example.com/' },
    });
    globalThis.fetch = mockFetchWith(body, {
      'content-type': 'application/ld+json;charset=utf-8',
    });

    const issuers = await resolveOidcIssuers('https://alice.example/profile#me');
    expect(issuers).toEqual(['https://idp.example.com/']);
  });

  test('malformed JSON-LD body surfaces WebIdProfileError', async () => {
    const body = '{ "@context": {"solid": "http://www.w3.org/ns/solid/terms#"';
    globalThis.fetch = mockFetchWith(body, JSON_LD_HEADERS);

    await expect(
      resolveOidcIssuers('https://alice.example/profile#me'),
    ).rejects.toBeInstanceOf(WebIdProfileError);
  });
});

describe('resolveWebIdProfile: display name + photo harvest', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test('returns vcard:fn as the display name when both vcard:fn and foaf:name are set', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <https://example.com/profile#me>
        solid:oidcIssuer <https://idp.example.com/> ;
        vcard:fn "Alice (formal)" ;
        foaf:name "Alice (foaf)" .
    `;
    globalThis.fetch = mockFetchWith(body);

    const profile = await resolveWebIdProfile('https://example.com/profile#me');
    expect(profile).toEqual({
      issuers: ['https://idp.example.com/'],
      name: 'Alice (formal)',
    });
  });

  test('falls back to foaf:name when vcard:fn is absent', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <https://example.com/profile#me>
        solid:oidcIssuer <https://idp.example.com/> ;
        foaf:name "Alice" .
    `;
    globalThis.fetch = mockFetchWith(body);

    const profile = await resolveWebIdProfile('https://example.com/profile#me');
    expect(profile.name).toBe('Alice');
  });

  test('omits name when neither vcard:fn nor foaf:name is present', async () => {
    // Agent.name derives from the URL when both are absent, but resolveWebIdProfile
    // deliberately drops that fallback so cached entries only hold real display names.
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me> solid:oidcIssuer <https://idp.example.com/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    const profile = await resolveWebIdProfile('https://example.com/profile#me');
    expect(profile.name).toBeUndefined();
  });

  test('harvests vcard:hasPhoto as photoUrl', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <https://example.com/profile#me>
        solid:oidcIssuer <https://idp.example.com/> ;
        vcard:hasPhoto <https://example.com/photo.jpg> .
    `;
    globalThis.fetch = mockFetchWith(body);

    const profile = await resolveWebIdProfile('https://example.com/profile#me');
    expect(profile.photoUrl).toBe('https://example.com/photo.jpg');
  });

  test('omits photoUrl when vcard:hasPhoto is absent', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      <https://example.com/profile#me> solid:oidcIssuer <https://idp.example.com/> .
    `;
    globalThis.fetch = mockFetchWith(body);

    const profile = await resolveWebIdProfile('https://example.com/profile#me');
    expect(profile.photoUrl).toBeUndefined();
  });

  test('returns full profile shape: issuers + name + photoUrl together', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <https://example.com/profile#me>
        solid:oidcIssuer <https://idp.example.com/> ;
        vcard:fn "Alice" ;
        vcard:hasPhoto <https://example.com/photo.jpg> .
    `;
    globalThis.fetch = mockFetchWith(body);

    const profile = await resolveWebIdProfile('https://example.com/profile#me');
    expect(profile).toEqual({
      issuers: ['https://idp.example.com/'],
      name: 'Alice',
      photoUrl: 'https://example.com/photo.jpg',
    });
  });

  test('resolveOidcIssuers remains a thin wrapper that returns the issuer array only', async () => {
    const body = `
      @prefix solid: <http://www.w3.org/ns/solid/terms#> .
      @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
      <https://example.com/profile#me>
        solid:oidcIssuer <https://idp.example.com/> ;
        vcard:fn "Alice" .
    `;
    globalThis.fetch = mockFetchWith(body);

    const issuers = await resolveOidcIssuers('https://example.com/profile#me');
    expect(issuers).toEqual(['https://idp.example.com/']);
  });
});
