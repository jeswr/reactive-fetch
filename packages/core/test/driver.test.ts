// Tests for the `webIdDriver` option (parent-side WebID acquisition).
//
// Covers:
//   1. Driver returns a string → popup URL has `?webId=<encoded>`.
//   2. Driver returns null → rejects with WebIdPromptCancelledError.
//   3. Driver returns invalid WebID (javascript:, http:, embedded creds)
//      → rejects with InvalidWebIdError; no popup opens.
//   4. Driver returns a Promise<string> → still works; popup opens once
//      the promise resolves.
//   5. Driver returns a Promise<null> → rejects after the promise settles.
//   6. Async-driver in flight + concurrent `solid.login(other)` →
//      mismatch is rejected (target was unknown, can't safely join).
//   7. Async-driver in flight + concurrent reactive `rf.webId` read →
//      joins the pending login.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  LOGIN_COMPLETE_MESSAGE_TYPE,
  __resetPopupStateForTests,
  __resetSessionCacheForTests,
} from '@jeswr/solid-reactive-fetch-shared';
import {
  createMockPopup,
  installMockWindowOpen,
  type MockPopup,
  type MockWindowOpenStub,
} from '@jeswr/solid-reactive-fetch-shared/test-helpers';

const { FakeSession } = vi.hoisted(() => {
  class FakeSession {
    static firstInstance: FakeSession | undefined;
    static lastInstance: FakeSession | undefined;
    isActive = false;
    webId: string | undefined;
    restoreImpl: () => Promise<void> = async () => undefined;
    authFetchImpl: (input: unknown, init?: RequestInit) => Promise<Response> = async () =>
      new Response('ok');

    constructor(_details: { client_id: string }) {
      const prev = FakeSession.lastInstance;
      if (prev) {
        this.restoreImpl = prev.restoreImpl;
        this.authFetchImpl = prev.authFetchImpl;
      }
      if (!FakeSession.firstInstance) FakeSession.firstInstance = this;
      FakeSession.lastInstance = this;
    }
    async restore(): Promise<void> {
      await this.restoreImpl();
      const first = FakeSession.firstInstance;
      if (first && first !== this) {
        this.isActive = first.isActive;
        this.webId = first.webId;
      }
    }
    authFetch(input: unknown, init?: RequestInit): Promise<Response> {
      return this.authFetchImpl(input, init);
    }
    async logout(): Promise<void> {
      this.isActive = false;
      this.webId = undefined;
    }
  }
  return { FakeSession };
});

vi.mock('@uvdsl/solid-oidc-client-browser', () => ({
  Session: FakeSession,
}));

let createReactiveFetch: typeof import('../src/index.js').createReactiveFetch;
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

beforeEach(async () => {
  __resetSessionCacheForTests();
  __resetPopupStateForTests();
  FakeSession.firstInstance = undefined;
  FakeSession.lastInstance = undefined;
  stub = installMockWindowOpen();
  ({ createReactiveFetch } = await import('../src/index.js'));
});

afterEach(() => {
  __resetSessionCacheForTests();
  __resetPopupStateForTests();
  stub.restore();
  vi.restoreAllMocks();
});

describe('webIdDriver: synchronous driver', () => {
  test('passes the returned WebID through as ?webId= on the popup URL', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: 'https://app.example/callback',
      webIdDriver: () => 'https://alice.example/profile#me',
    });
    const fake = FakeSession.lastInstance!;
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://alice.example/profile#me';
    };

    const pending = rf.webId;
    await completeLoginPopup(popup);
    await pending;

    expect(stub.calls).toHaveLength(1);
    const popupUrl = new URL(stub.calls[0]!.url!);
    expect(popupUrl.searchParams.get('webId')).toBe('https://alice.example/profile#me');
  });

  test('returns null → rejects with WebIdPromptCancelledError', async () => {
    const { WebIdPromptCancelledError } = await import('@jeswr/solid-reactive-fetch-shared');
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      webIdDriver: () => null,
    });

    await expect(rf.webId).rejects.toBeInstanceOf(WebIdPromptCancelledError);
    expect(stub.calls).toHaveLength(0);
  });

  test('javascript: URL → rejects with InvalidWebIdError, no popup opens', async () => {
    const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      webIdDriver: () => 'javascript:alert(1)',
    });

    await expect(rf.webId).rejects.toBeInstanceOf(InvalidWebIdError);
    expect(stub.calls).toHaveLength(0);
  });

  test('http: WebID rejected unless allowLocalhost is true', async () => {
    const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      webIdDriver: () => 'http://attacker.example/profile#me',
    });

    await expect(rf.webId).rejects.toBeInstanceOf(InvalidWebIdError);
    expect(stub.calls).toHaveLength(0);
  });

  test('http://localhost accepted when allowLocalhost: true', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: 'https://app.example/callback',
      allowLocalhost: true,
      webIdDriver: () => 'http://localhost:3000/profile#me',
    });
    const fake = FakeSession.lastInstance!;
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'http://localhost:3000/profile#me';
    };

    const pending = rf.webId;
    await completeLoginPopup(popup);
    await pending;

    expect(stub.calls).toHaveLength(1);
  });

  test('embedded credentials in WebID URL rejected', async () => {
    const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      webIdDriver: () => 'https://attacker:hunter2@victim.example/profile#me',
    });

    await expect(rf.webId).rejects.toBeInstanceOf(InvalidWebIdError);
    expect(stub.calls).toHaveLength(0);
  });

  test('passes allowLocalhost through to the driver context', async () => {
    const seen: Array<{ allowLocalhost: boolean }> = [];
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: 'https://app.example/callback',
      allowLocalhost: true,
      webIdDriver: (ctx) => {
        seen.push({ allowLocalhost: ctx.allowLocalhost });
        return 'http://localhost:3000/profile#me';
      },
    });
    const fake = FakeSession.lastInstance!;
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'http://localhost:3000/profile#me';
    };

    const pending = rf.webId;
    await completeLoginPopup(popup);
    await pending;

    expect(seen).toEqual([{ allowLocalhost: true }]);
  });
});

describe('webIdDriver: async (Promise-returning) driver', () => {
  test('Promise<string> resolves → popup opens with ?webId= once it settles', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    let resolveDriver: (webId: string) => void;
    const driverPromise = new Promise<string>((resolve) => {
      resolveDriver = resolve;
    });

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: 'https://app.example/callback',
      webIdDriver: () => driverPromise.then((webId) => webId),
    });
    const fake = FakeSession.lastInstance!;
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://alice.example/profile#me';
    };

    const pending = rf.webId;

    // Before driver settles, no popup.
    await Promise.resolve();
    expect(stub.calls).toHaveLength(0);

    resolveDriver!('https://alice.example/profile#me');
    await completeLoginPopup(popup);
    await pending;

    expect(stub.calls).toHaveLength(1);
    const popupUrl = new URL(stub.calls[0]!.url!);
    expect(popupUrl.searchParams.get('webId')).toBe('https://alice.example/profile#me');
  });

  test('Promise<null> → rejects with WebIdPromptCancelledError', async () => {
    const { WebIdPromptCancelledError } = await import('@jeswr/solid-reactive-fetch-shared');
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      webIdDriver: async () => null,
    });

    await expect(rf.webId).rejects.toBeInstanceOf(WebIdPromptCancelledError);
    expect(stub.calls).toHaveLength(0);
  });

  test('async driver in flight: concurrent solid.login(other) rejects', async () => {
    const { LoginFailedError } = await import('@jeswr/solid-reactive-fetch-shared');
    const popup = createMockPopup();
    stub.nextPopup(popup);

    let resolveDriver: (webId: string) => void;
    const driverPromise = new Promise<string>((resolve) => {
      resolveDriver = resolve;
    });

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: 'https://app.example/callback',
      webIdDriver: () => driverPromise,
    });
    const fake = FakeSession.lastInstance!;
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://alice.example/profile#me';
    };

    // Start the async-driver login.
    const first = rf.webId.catch((e: unknown) => e);

    // While the driver hasn't resolved, target is unknown — concurrent
    // explicit-target login must reject.
    await expect(rf.solid.login('https://bob.example/profile#me')).rejects.toBeInstanceOf(
      LoginFailedError,
    );

    // Settle the driver and let the original login complete.
    resolveDriver!('https://alice.example/profile#me');
    await completeLoginPopup(popup);
    await first;
  });

  test('async driver in flight: concurrent reactive read joins it', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    let resolveDriver: (webId: string) => void;
    const driverPromise = new Promise<string>((resolve) => {
      resolveDriver = resolve;
    });

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: 'https://app.example/callback',
      webIdDriver: () => driverPromise,
    });
    const fake = FakeSession.lastInstance!;
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://alice.example/profile#me';
    };

    const first = rf.webId;
    const second = rf.webId; // reactive read with no target — should join

    resolveDriver!('https://alice.example/profile#me');
    await completeLoginPopup(popup);

    await expect(first).resolves.toBe('https://alice.example/profile#me');
    await expect(second).resolves.toBe('https://alice.example/profile#me');
    // Only one popup was opened — concurrent reads shared the flow.
    expect(stub.calls).toHaveLength(1);
  });
});

describe('webIdDriver: no driver (zero-config default)', () => {
  test('popup URL has no ?webId= when no driver is passed', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: 'https://app.example/callback',
    });
    const fake = FakeSession.lastInstance!;
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://alice.example/profile#me';
    };

    const pending = rf.webId;
    await completeLoginPopup(popup);
    await pending;

    expect(stub.calls).toHaveLength(1);
    const popupUrl = String(stub.calls[0]!.url!);
    // Either bare callbackUrl or one without a ?webId= param.
    if (popupUrl.includes('?')) {
      const u = new URL(popupUrl);
      expect(u.searchParams.has('webId')).toBe(false);
    }
  });
});
