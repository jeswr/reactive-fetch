// Unit tests for the slim prompt-flavoured `mountCallback`.
//
// Three branches to cover:
//   1. `?code=…&state=…` present → run OIDC redirect handler, postMessage,
//      close. Validated by `runOidcRedirectIfPresent` from shared (covered
//      indirectly here — we just assert mountCallback returns early).
//   2. `?webId=<valid>` present → drive discovery + IDP redirect.
//   3. Neither present → render the "missing WebID" static error card.
//   4. `?webId=javascript:…` → InvalidWebIdError surfaced via the static
//      error card; no IDP redirect attempted.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Stub @uvdsl/solid-oidc-client-browser before mountCallback imports it
// transitively via shared/callback. We only need to count `login` calls
// and ensure `handleRedirectFromLogin` is non-throwing for the redirect-leg
// branch.
const { FakeSession } = vi.hoisted(() => {
  class FakeSession {
    static loginCalls: Array<{ issuer: string; redirectUri: string }> = [];
    static handleRedirectCalls = 0;
    static reset() {
      FakeSession.loginCalls = [];
      FakeSession.handleRedirectCalls = 0;
    }
    constructor(_details: unknown) {}
    async login(issuer: string, redirectUri: string): Promise<void> {
      FakeSession.loginCalls.push({ issuer, redirectUri });
    }
    async handleRedirectFromLogin(): Promise<void> {
      FakeSession.handleRedirectCalls += 1;
    }
  }
  return { FakeSession };
});

vi.mock('@uvdsl/solid-oidc-client-browser', () => ({
  Session: FakeSession,
}));

let mountCallback: typeof import('./index.js').mountCallback;
let __resetWebIdCacheForTests: typeof import('@jeswr/solid-reactive-fetch-shared/callback').__resetWebIdCacheForTests;

const PROFILE_TURTLE = `
  @prefix solid: <http://www.w3.org/ns/solid/terms#> .
  @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
  <https://alice.example/profile#me>
    solid:oidcIssuer <https://idp.example.com/> ;
    vcard:fn "Alice" .
`;

const originalFetch = globalThis.fetch;

beforeEach(async () => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-reactive-fetch-layout');
  document.body.removeAttribute('data-reactive-fetch-body');
  document.getElementById('reactive-fetch-popup-styles')?.remove();
  FakeSession.reset();

  ({ mountCallback } = await import('./index.js'));
  ({ __resetWebIdCacheForTests } = await import(
    '@jeswr/solid-reactive-fetch-shared/callback'
  ));
  __resetWebIdCacheForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  // Reset the URL between tests — runOidcRedirectIfPresent / readWebIdFromQuery
  // both consult `window.location.search`.
  setLocationSearch('');
});

function setLocationSearch(search: string): void {
  const base = `${window.location.origin}${window.location.pathname}`;
  const url = search ? `${base}?${search.replace(/^\?/, '')}` : base;
  // Use replaceState so we don't trigger a navigation in jsdom.
  window.history.replaceState(null, '', url);
}

describe('mountCallback (prompt flavour)', () => {
  test('?code=&state= present → runs OIDC redirect, never renders the form', async () => {
    setLocationSearch('?code=abc&state=xyz');
    // Mute window.close (jsdom logs noisily) — we just need the call to
    // complete without throwing.
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});

    await mountCallback();

    expect(FakeSession.handleRedirectCalls).toBe(1);
    // No fatal-error UI rendered (the redirect leg short-circuits before
    // any DOM mutation).
    expect(document.body.querySelector('[data-reactive-fetch="prompt-fatal"]')).toBeNull();
    closeSpy.mockRestore();
  });

  test('?webId=<valid> present → fetches profile and calls Session.login(issuer)', async () => {
    setLocationSearch(
      `?webId=${encodeURIComponent('https://alice.example/profile#me')}`,
    );

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://alice.example/profile#me') {
        return new Response(PROFILE_TURTLE, {
          status: 200,
          headers: { 'content-type': 'text/turtle' },
        });
      }
      return new Response('not found', { status: 404 });
    }) as typeof globalThis.fetch;

    await mountCallback({ clientId: 'https://app.example/id' });

    // Single issuer → driveLoginFromWebId calls beginSolidLogin →
    // session.login(issuer, popupRedirectUri). The redirect_uri MUST NOT
    // carry the `?webId=` query param (the IDP would round-trip it back
    // through the redirect leg).
    expect(FakeSession.loginCalls).toHaveLength(1);
    expect(FakeSession.loginCalls[0]!.issuer).toBe('https://idp.example.com/');
    expect(FakeSession.loginCalls[0]!.redirectUri).not.toContain('webId=');
  });

  test('neither ?code nor ?webId → renders static "missing WebID" error card', async () => {
    setLocationSearch('');

    await mountCallback();

    // The fatal card has data-reactive-fetch="prompt-fatal" + a status
    // paragraph with role="alert".
    const fatal = document.body.querySelector('[data-reactive-fetch="prompt-fatal"]');
    expect(fatal).not.toBeNull();
    const status = fatal!.querySelector('[role="alert"]');
    expect(status).not.toBeNull();
    expect(status!.textContent ?? '').toMatch(/webId|sign in/i);

    // No IDP redirect attempted.
    expect(FakeSession.loginCalls).toHaveLength(0);
  });

  test('?webId=javascript:… → renders error card; never opens IDP', async () => {
    setLocationSearch(
      `?webId=${encodeURIComponent('javascript:alert(1)')}`,
    );

    await mountCallback();

    // The reject path lands in the fatal-error branch.
    const fatal = document.body.querySelector('[data-reactive-fetch="prompt-fatal"]');
    expect(fatal).not.toBeNull();

    // No IDP login fired.
    expect(FakeSession.loginCalls).toHaveLength(0);
  });

  test('?webId=data:… → renders error card; never opens IDP', async () => {
    setLocationSearch(
      `?webId=${encodeURIComponent('data:text/html,<script>alert(1)</script>')}`,
    );

    await mountCallback();
    const fatal = document.body.querySelector('[data-reactive-fetch="prompt-fatal"]');
    expect(fatal).not.toBeNull();
    expect(FakeSession.loginCalls).toHaveLength(0);
  });

  test('?webId=file:///etc/passwd → renders error card; never opens IDP', async () => {
    setLocationSearch(
      `?webId=${encodeURIComponent('file:///etc/passwd')}`,
    );

    await mountCallback();
    const fatal = document.body.querySelector('[data-reactive-fetch="prompt-fatal"]');
    expect(fatal).not.toBeNull();
    expect(FakeSession.loginCalls).toHaveLength(0);
  });

  test('?webId=http://evil.example (no allowLocalhost) → error card', async () => {
    setLocationSearch(
      `?webId=${encodeURIComponent('http://evil.example/profile')}`,
    );

    await mountCallback();
    const fatal = document.body.querySelector('[data-reactive-fetch="prompt-fatal"]');
    expect(fatal).not.toBeNull();
    expect(FakeSession.loginCalls).toHaveLength(0);
  });

  test('options.root respected: renders error card into the supplied element', async () => {
    setLocationSearch('');
    const root = document.createElement('div');
    root.id = 'callback-root';
    document.body.appendChild(root);

    await mountCallback({ root });

    expect(root.querySelector('[data-reactive-fetch="prompt-fatal"]')).not.toBeNull();
    // The default `document.body` should NOT have received the card.
    // The card lives under the root, so a body-level query that walks
    // into root will still match — instead, assert there is exactly one
    // fatal card in the whole document and it is a descendant of root.
    const allFatal = document.querySelectorAll('[data-reactive-fetch="prompt-fatal"]');
    expect(allFatal).toHaveLength(1);
    expect(root.contains(allFatal[0]!)).toBe(true);
  });

  test('discovery error (404 on profile fetch) → renders error card', async () => {
    setLocationSearch(
      `?webId=${encodeURIComponent('https://alice.example/profile#me')}`,
    );
    globalThis.fetch = vi.fn(async () =>
      new Response('not found', { status: 404 }),
    ) as typeof globalThis.fetch;

    await mountCallback();

    const fatal = document.body.querySelector('[data-reactive-fetch="prompt-fatal"]');
    expect(fatal).not.toBeNull();
    expect(FakeSession.loginCalls).toHaveLength(0);
  });

  // Coverage gap (filed back to plugin-author):
  //   `mountCallback({ allowLocalhost: true })` does NOT currently honour
  //   `allowLocalhost` for the `?webId=` validation step. The shared
  //   `readWebIdFromQueryStrict` calls `validateWebIdSyncStrict(raw)` with
  //   no options, so it always rejects http://localhost WebIDs even when
  //   the callback consumer opted in. The downstream `driveLoginFromWebId`
  //   does receive `allowLocalhost` and would pass it to the issuer
  //   filter, but the WebID URL itself never gets there. This test asserts
  //   the CURRENT (buggy) behaviour: the callback rejects the localhost
  //   WebID. Replace with a happy-path assertion once the source fix lands.
  test('allowLocalhost: true rejects ?webId=http://localhost (current bug — see comment)', async () => {
    setLocationSearch(
      `?webId=${encodeURIComponent('http://localhost:3000/profile#me')}`,
    );

    await mountCallback({ allowLocalhost: true });

    // BUG: should accept; current behaviour: fatal-error card.
    const fatal = document.body.querySelector('[data-reactive-fetch="prompt-fatal"]');
    expect(fatal).not.toBeNull();
    expect(FakeSession.loginCalls).toHaveLength(0);
  });
});
