// Tests for `rf.solid.login(webId)` — the imperative login path.
//
// Covers:
//   1. solid.login(validWebId) opens a popup with `?webId=` set, resolves
//      once login completes.
//   2. solid.login(invalidWebId) rejects with InvalidWebIdError BEFORE
//      opening any popup.
//   3. solid.login(currentSessionWebId) is idempotent when a session is
//      already active — no popup, resolves immediately.
//   4. solid.login(otherWebId) when a session for A is active triggers a
//      user-switch popup (clears profile state and drives a fresh login).
//   5. Concurrent solid.login(A) + solid.login(B) → second rejects with
//      LoginFailedError.
//   6. Concurrent solid.login(A) + solid.login(A) → second joins (same
//      target).
//   7. Concurrent solid.login(A) + reactive rf.webId → reactive joins.

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
      const first = FakeSession.firstInstance;
      if (first && first !== this) {
        first.isActive = false;
        first.webId = undefined;
      }
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

describe('solid.login(webId): happy path', () => {
  test('drives the popup with the supplied WebID set as ?webId=', async () => {
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

    const pending = rf.solid.login('https://alice.example/profile#me');
    await completeLoginPopup(popup);
    await pending;

    expect(stub.calls).toHaveLength(1);
    const popupUrl = new URL(stub.calls[0]!.url!);
    expect(popupUrl.searchParams.get('webId')).toBe('https://alice.example/profile#me');
    expect(rf.solid.webId).toBe('https://alice.example/profile#me');
  });
});

describe('solid.login(webId): validation', () => {
  test('javascript: URL → rejects InvalidWebIdError, no popup', async () => {
    const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });

    await expect(rf.solid.login('javascript:alert(1)')).rejects.toBeInstanceOf(
      InvalidWebIdError,
    );
    expect(stub.calls).toHaveLength(0);
  });

  test('http: URL rejected without allowLocalhost', async () => {
    const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });

    await expect(rf.solid.login('http://attacker.example/me')).rejects.toBeInstanceOf(
      InvalidWebIdError,
    );
    expect(stub.calls).toHaveLength(0);
  });

  test('embedded credentials rejected', async () => {
    const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });

    await expect(
      rf.solid.login('https://attacker:hunter2@victim.example/me'),
    ).rejects.toBeInstanceOf(InvalidWebIdError);
    expect(stub.calls).toHaveLength(0);
  });

  test('empty string rejected', async () => {
    const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });

    await expect(rf.solid.login('')).rejects.toBeInstanceOf(InvalidWebIdError);
    expect(stub.calls).toHaveLength(0);
  });

  test('validation runs even when a session is already active', async () => {
    const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
    // Pre-populate an active session via the construction-time restore.
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;
    fake.isActive = true;
    fake.webId = 'https://alice.example/profile#me';

    await expect(rf.solid.login('javascript:evil()')).rejects.toBeInstanceOf(
      InvalidWebIdError,
    );
  });
});

describe('solid.login(webId): idempotence', () => {
  test('login(currentSessionWebId) when session is active is a no-op (no popup)', async () => {
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;
    fake.isActive = true;
    fake.webId = 'https://alice.example/profile#me';

    await expect(
      rf.solid.login('https://alice.example/profile#me'),
    ).resolves.toBeUndefined();
    expect(stub.calls).toHaveLength(0);
  });
});

describe('solid.login(webId): user-switch', () => {
  test('login(B) while session for A is active opens a fresh popup', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: 'https://app.example/callback',
    });
    const fake = FakeSession.lastInstance!;
    fake.isActive = true;
    fake.webId = 'https://alice.example/profile#me';

    // After the popup completes, restore should reflect the NEW user.
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://bob.example/profile#me';
    };

    const pending = rf.solid.login('https://bob.example/profile#me');
    await completeLoginPopup(popup);
    await pending;

    expect(stub.calls).toHaveLength(1);
    const popupUrl = new URL(stub.calls[0]!.url!);
    expect(popupUrl.searchParams.get('webId')).toBe('https://bob.example/profile#me');
    expect(rf.solid.webId).toBe('https://bob.example/profile#me');
  });
});

describe('solid.login(webId): concurrency', () => {
  test('concurrent solid.login(A) + solid.login(B) → B rejects with LoginFailedError', async () => {
    const { LoginFailedError } = await import('@jeswr/solid-reactive-fetch-shared');
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

    const aliceLogin = rf.solid.login('https://alice.example/profile#me');
    const bobLogin = rf.solid.login('https://bob.example/profile#me');

    await expect(bobLogin).rejects.toBeInstanceOf(LoginFailedError);

    // Let alice's login finish so the test cleans up cleanly.
    await completeLoginPopup(popup);
    await expect(aliceLogin).resolves.toBeUndefined();

    // Only one popup was opened.
    expect(stub.calls).toHaveLength(1);
  });

  test('concurrent solid.login(A) + solid.login(A) → second joins (same target)', async () => {
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

    const a1 = rf.solid.login('https://alice.example/profile#me');
    const a2 = rf.solid.login('https://alice.example/profile#me');

    await completeLoginPopup(popup);
    await expect(a1).resolves.toBeUndefined();
    await expect(a2).resolves.toBeUndefined();
    expect(stub.calls).toHaveLength(1);
  });

  test('reactive rf.webId joins an in-flight solid.login(A)', async () => {
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

    const explicitLogin = rf.solid.login('https://alice.example/profile#me');
    const reactiveRead = rf.webId;

    await completeLoginPopup(popup);
    await expect(explicitLogin).resolves.toBeUndefined();
    await expect(reactiveRead).resolves.toBe('https://alice.example/profile#me');
    expect(stub.calls).toHaveLength(1);
  });
});
