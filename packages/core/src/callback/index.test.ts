import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The popup's `beginSolidLogin` path calls `new Session(...).login(...)`,
// which normally kicks off a real browser navigation. Stub the module so we
// can assert how many times, with which issuer, login is called — without
// actually attempting redirect.
const { FakeSession } = vi.hoisted(() => {
  class FakeSession {
    static loginCalls: Array<{ issuer: string; redirectUri: string }> = [];
    static resetLogs() {
      FakeSession.loginCalls = [];
    }
    constructor(_details: unknown) {}
    async login(issuer: string, redirectUri: string): Promise<void> {
      FakeSession.loginCalls.push({ issuer, redirectUri });
    }
    async handleRedirectFromLogin(): Promise<void> {}
  }
  return { FakeSession };
});

vi.mock('@uvdsl/solid-oidc-client-browser', () => ({
  Session: FakeSession,
}));

let mountCallback: typeof import('./index.js').mountCallback;
let __resetWebIdCacheForTests: typeof import('./webidCache.js').__resetWebIdCacheForTests;
let rememberWebId: typeof import('./webidCache.js').rememberWebId;

const PROFILE_TURTLE = `
  @prefix solid: <http://www.w3.org/ns/solid/terms#> .
  @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
  <https://alice.example/profile#me>
    solid:oidcIssuer <https://idp.example.com/> ;
    vcard:fn "Alice" ;
    vcard:hasPhoto <https://alice.example/photo.jpg> .
`;

const originalFetch = globalThis.fetch;

beforeEach(async () => {
  // Fresh DOM + fresh cache + fresh fake session logs on every test.
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-reactive-fetch-layout');
  document.body.removeAttribute('data-reactive-fetch-body');
  document.getElementById('reactive-fetch-popup-styles')?.remove();
  FakeSession.resetLogs();

  // Dynamic import so the vi.mock above is in effect.
  ({ mountCallback } = await import('./index.js'));
  ({ __resetWebIdCacheForTests, rememberWebId } = await import('./webidCache.js'));
  __resetWebIdCacheForTests();

  // Default to no `?code`/`?state` query params so mountCallback takes the
  // non-redirect branch.
  history.replaceState(null, '', '/callback');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  __resetWebIdCacheForTests();
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('mountCallback: initial view decision', () => {
  test('shows the cached-webids list when at least one entry exists', async () => {
    rememberWebId({ webId: 'https://alice.example/profile#me', name: 'Alice' });
    await mountCallback();
    expect(document.querySelector('[data-reactive-fetch="cached-webids"]')).not.toBeNull();
    expect(document.querySelector('[data-reactive-fetch="prompt"]')).toBeNull();
  });

  test('shows the text-input prompt when the cache is empty', async () => {
    await mountCallback();
    expect(document.querySelector('[data-reactive-fetch="prompt"]')).not.toBeNull();
    expect(document.querySelector('[data-reactive-fetch="cached-webids"]')).toBeNull();
  });
});

describe('mountCallback: cached-card click drives discovery + login', () => {
  test('clicking a cached card fetches the profile and triggers login with its single issuer', async () => {
    rememberWebId({
      webId: 'https://alice.example/profile#me',
      name: 'Alice',
      photoUrl: 'https://alice.example/photo.jpg',
    });

    globalThis.fetch = vi.fn(async () => new Response(PROFILE_TURTLE, {
      status: 200,
      headers: { 'content-type': 'text/turtle' },
    }));

    await mountCallback();

    const pick = document.querySelector<HTMLButtonElement>(
      '[data-reactive-fetch="cached-webid-pick"]',
    );
    expect(pick).not.toBeNull();
    pick!.click();

    // Let driveLoginFromWebId → resolveWebIdProfile → beginSolidLogin settle.
    for (let i = 0; i < 20; i++) {
      if (FakeSession.loginCalls.length > 0) break;
      await flush();
    }

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://alice.example/profile#me',
      expect.any(Object),
    );
    expect(FakeSession.loginCalls).toEqual([
      { issuer: 'https://idp.example.com/', redirectUri: expect.any(String) },
    ]);
  });

  test('clicking "Sign in with a different WebID" swaps to the text-input prompt', async () => {
    rememberWebId({ webId: 'https://alice.example/profile#me', name: 'Alice' });
    await mountCallback();

    expect(document.querySelector('[data-reactive-fetch="cached-webids"]')).not.toBeNull();
    const useDifferent = document.querySelector<HTMLButtonElement>(
      '[data-reactive-fetch="use-different-webid"]',
    );
    useDifferent?.click();

    expect(document.querySelector('[data-reactive-fetch="cached-webids"]')).toBeNull();
    expect(document.querySelector('[data-reactive-fetch="prompt"]')).not.toBeNull();
  });

  test('clicking forget on the only card removes the list and falls through to the prompt', async () => {
    rememberWebId({ webId: 'https://alice.example/profile#me', name: 'Alice' });
    await mountCallback();

    const forget = document.querySelector<HTMLButtonElement>(
      '[data-reactive-fetch="forget-webid"]',
    );
    forget?.click();

    expect(document.querySelector('[data-reactive-fetch="cached-webids"]')).toBeNull();
    expect(document.querySelector('[data-reactive-fetch="prompt"]')).not.toBeNull();
  });
});

describe('mountCallback: text-input submit remembers WebID on success', () => {
  test('submitting a WebID in the prompt persists name + photo to cache', async () => {
    globalThis.fetch = vi.fn(async () => new Response(PROFILE_TURTLE, {
      status: 200,
      headers: { 'content-type': 'text/turtle' },
    }));

    await mountCallback();
    const input = document.querySelector<HTMLInputElement>('#reactive-fetch-webid');
    const form = document.querySelector<HTMLFormElement>('[data-reactive-fetch="prompt"]');
    expect(input).not.toBeNull();
    expect(form).not.toBeNull();
    input!.value = 'https://alice.example/profile#me';
    form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    for (let i = 0; i < 20; i++) {
      if (FakeSession.loginCalls.length > 0) break;
      await flush();
    }

    const { getCachedWebIds } = await import('./webidCache.js');
    const entries = getCachedWebIds();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.webId).toBe('https://alice.example/profile#me');
    expect(entries[0]?.name).toBe('Alice');
    expect(entries[0]?.photoUrl).toBe('https://alice.example/photo.jpg');
  });
});
