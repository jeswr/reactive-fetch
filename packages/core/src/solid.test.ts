// Tests for the extension-shaped `rf.solid` facade. This is the surface
// the unified-wrapper package will treat as interchangeable with
// `window.solid` injected by the browser extension. The contract is
// defined inline in `index.ts` (see the file-header comment block).
//
// We focus on the bits the wrapper actually depends on:
//   - shape (the right keys exist with the right types)
//   - `webId` is a string snapshot, not a wrapping object — that
//     matches the extension's `inject.ts`
//   - `profile` exposes the spec-stable getters (oidcIssuers, storage)
//   - `setClientId` updates `clientId` synchronously
//   - `logout` clears the profile snapshot
//
// Social-graph getters (name, email, knows, …) are explicitly NOT tested
// here — they're flagged unstable in `WebIDProfile.ts` and the
// unified-wrapper API does not depend on them.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LOGIN_COMPLETE_MESSAGE_TYPE, __resetPopupStateForTests } from './popup.js';
import { __resetSessionCacheForTests } from './session.js';
import { createMockPopup, type MockPopup } from '../test/helpers/mockPopup.js';
import {
  installMockWindowOpen,
  type MockWindowOpenStub,
} from '../test/helpers/mockWindowOpen.js';

const PROFILE_TURTLE = `
  @prefix solid: <http://www.w3.org/ns/solid/terms#> .
  @prefix pim: <http://www.w3.org/ns/pim/space#> .
  <https://alice.example/profile#me>
    solid:oidcIssuer <https://idp.example.com/> ;
    pim:storage <https://alice.example/storage/> .
`;

// Reuse the FakeSession pattern from index.test.ts so the popup → restore
// → webId path resolves without hitting a real IDP.
const { FakeSession } = vi.hoisted(() => {
  class FakeSession {
    static lastInstance: FakeSession | undefined;
    isActive = false;
    webId: string | undefined;
    restoreImpl: () => Promise<void> = async () => undefined;
    logoutImpl: () => Promise<void> = async () => {
      this.isActive = false;
      this.webId = undefined;
    };
    authFetchImpl: (input: unknown, init?: RequestInit) => Promise<Response> = async () =>
      new Response('ok');

    constructor(_details: { client_id: string }) {
      FakeSession.lastInstance = this;
    }
    async restore(): Promise<void> {
      await this.restoreImpl();
    }
    async logout(): Promise<void> {
      await this.logoutImpl();
    }
    authFetch(input: unknown, init?: RequestInit): Promise<Response> {
      return this.authFetchImpl(input, init);
    }
  }
  return { FakeSession };
});

vi.mock('@uvdsl/solid-oidc-client-browser', () => ({
  Session: FakeSession,
}));

let createReactiveFetch: typeof import('./index.js').createReactiveFetch;
let stub: MockWindowOpenStub;

async function waitForPopupOpened(target: number, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (stub.calls.length >= target) return;
    await Promise.resolve();
  }
  throw new Error(`window.open not called ${target}x within ${maxTicks} ticks`);
}

async function completeLoginPopup(popup: MockPopup, openCount = 1): Promise<void> {
  await waitForPopupOpened(openCount);
  popup.postMessageToOpener({ type: LOGIN_COMPLETE_MESSAGE_TYPE });
  await Promise.resolve();
}

const realFetch = globalThis.fetch;

beforeEach(async () => {
  __resetSessionCacheForTests();
  __resetPopupStateForTests();
  FakeSession.lastInstance = undefined;
  stub = installMockWindowOpen();
  ({ createReactiveFetch } = await import('./index.js'));

  // Default: any GET against the WebID document returns the canonical
  // turtle profile above. App-resource fetches (anything else) return a
  // 200 so the per-test code can override on a case-by-case basis.
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === 'https://alice.example/profile#me') {
      return new Response(PROFILE_TURTLE, {
        status: 200,
        headers: { 'content-type': 'text/turtle' },
      });
    }
    return new Response('ok', { status: 200 });
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  __resetSessionCacheForTests();
  __resetPopupStateForTests();
  stub.restore();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('rf.solid: shape contract (matches window.solid from the extension)', () => {
  test('exposes the documented Solid keys with the right types', () => {
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });

    // Sync getters: webId (string|null), profile (object|null), clientId
    // (string|undefined). Methods: fetch / setClientId / login / logout.
    expect(rf.solid.webId).toBeNull();
    expect(rf.solid.profile).toBeNull();
    expect(rf.solid.clientId).toBe('https://app.example/id');
    expect(typeof rf.solid.fetch).toBe('function');
    expect(typeof rf.solid.setClientId).toBe('function');
    expect(typeof rf.solid.login).toBe('function');
    expect(typeof rf.solid.logout).toBe('function');
  });

  test('webId is a bare string (not a wrapping object) once login completes', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://alice.example/profile#me';
    };

    const pending = rf.webId;
    await completeLoginPopup(popup);
    await pending;

    expect(typeof rf.solid.webId).toBe('string');
    expect(rf.solid.webId).toBe('https://alice.example/profile#me');
  });
});

describe('rf.solid.profile: WebIDProfile object exposes the stable surface', () => {
  test('after login, profile is a WebIDProfile (Agent) with oidcIssuers + storage', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://alice.example/profile#me';
    };

    const pending = rf.webId;
    await completeLoginPopup(popup);
    await pending;

    // Wait for the background profile fetch to settle (a couple of
    // microtasks; the fetch mock resolves synchronously).
    for (let i = 0; i < 30 && rf.solid.profile === null; i++) {
      await Promise.resolve();
    }

    const profile = rf.solid.profile;
    expect(profile).not.toBeNull();
    // `value` is the WebID IRI (TermWrapper.value).
    expect(profile!.value).toBe('https://alice.example/profile#me');
    // Stable getters (per WebIDProfile.ts):
    //   - `oidcIssuers` (added by reactive-fetch's WebIDProfileAgent subclass)
    //   - `pimStorage` / `solidStorage` / `storageUrls` (from @solid/object Agent)
    expect([...(profile as unknown as { oidcIssuers: Set<string> }).oidcIssuers]).toEqual([
      'https://idp.example.com/',
    ]);
    expect([...profile!.pimStorage]).toEqual(['https://alice.example/storage/']);
    expect([...profile!.storageUrls]).toEqual(['https://alice.example/storage/']);
  });

  test('logout clears the profile snapshot back to null', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://alice.example/profile#me';
    };

    const pending = rf.webId;
    await completeLoginPopup(popup);
    await pending;
    for (let i = 0; i < 30 && rf.solid.profile === null; i++) {
      await Promise.resolve();
    }
    expect(rf.solid.profile).not.toBeNull();

    await rf.solid.logout();
    expect(rf.solid.profile).toBeNull();
    expect(rf.solid.webId).toBeNull();
  });
});

describe('rf.solid.setClientId: synchronous updates', () => {
  test('updates clientId snapshot synchronously', () => {
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    expect(rf.solid.clientId).toBe('https://app.example/id');
    rf.solid.setClientId('https://otherapp.example/id');
    expect(rf.solid.clientId).toBe('https://otherapp.example/id');
  });
});
