import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LOGIN_COMPLETE_MESSAGE_TYPE, __resetPopupStateForTests } from './popup.js';
import { __resetSessionCacheForTests } from './session.js';
import { createMockPopup, type MockPopup } from '../test/helpers/mockPopup.js';
import { installMockWindowOpen, type MockWindowOpenStub } from '../test/helpers/mockWindowOpen.js';

/**
 * FakeSession: same shape as the session.test.ts stand-in, but this file
 * exercises the factory, so we also need `webId` (getter) and track the
 * `authFetch` calls to prove init is preserved across the retry.
 *
 * Declared via vi.hoisted so the class definition is available when the
 * hoisted vi.mock factory runs.
 */
const { FakeSession } = vi.hoisted(() => {
  class FakeSession {
    static lastInstance: FakeSession | undefined;
    // Tests can set this to mutate each new instance before anyone holds a
    // reference — useful when the test needs to intercept the
    // construction-time `restore()` call before its first microtask drains.
    static onConstruct: ((instance: FakeSession) => void) | undefined;
    isActive = false;
    webId: string | undefined;
    restoreCalls = 0;
    restoreImpl: () => Promise<void> = async () => undefined;
    authFetchCalls: Array<{ input: unknown; init?: RequestInit }> = [];
    authFetchImpl: (input: unknown, init?: RequestInit) => Promise<Response> = async () =>
      new Response('ok');

    constructor(_details: { client_id: string }) {
      FakeSession.lastInstance = this;
      FakeSession.onConstruct?.(this);
    }

    async restore(): Promise<void> {
      this.restoreCalls += 1;
      return this.restoreImpl();
    }

    authFetch(input: unknown, init?: RequestInit): Promise<Response> {
      this.authFetchCalls.push({ input, init });
      return this.authFetchImpl(input, init);
    }
  }
  return { FakeSession };
});
type FakeSession = InstanceType<typeof FakeSession>;

vi.mock('@uvdsl/solid-oidc-client-browser', () => ({
  Session: FakeSession,
}));

let createReactiveFetch: typeof import('./index.js').createReactiveFetch;

let stub: MockWindowOpenStub;

/** Wait until window.open has been called at least `target` times. */
async function waitForPopupOpened(target: number, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (stub.calls.length >= target) return;
    await Promise.resolve();
  }
  throw new Error(
    `window.open was not called ${target} time(s) within ${maxTicks} microtasks (got ${stub.calls.length})`,
  );
}

/**
 * Drive one popup flow to completion. Waits until the factory has actually
 * called window.open (N'th time), then dispatches the success message. The
 * popup module attaches its `message` listener synchronously inside the
 * Promise executor, so a single microtask flush after `window.open` is
 * enough for the listener to be live.
 */
async function completeLoginPopup(popup: MockPopup, openCount = 1): Promise<void> {
  await waitForPopupOpened(openCount);
  popup.postMessageToOpener({ type: LOGIN_COMPLETE_MESSAGE_TYPE });
  await Promise.resolve();
}

beforeEach(async () => {
  __resetSessionCacheForTests();
  __resetPopupStateForTests();
  FakeSession.lastInstance = undefined;
  stub = installMockWindowOpen();
  ({ createReactiveFetch } = await import('./index.js'));
});

afterEach(() => {
  __resetSessionCacheForTests();
  __resetPopupStateForTests();
  stub.restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('createReactiveFetch: webId', () => {
  test('triggers popup when there is no session; resolves to webId once login completes', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });

    const fake = FakeSession.lastInstance!;
    // After popup completes, restore() must flip the session active with a webId.
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://user.example/profile/card#me';
    };

    const webIdPromise = rf.webId;
    await completeLoginPopup(popup);

    await expect(webIdPromise).resolves.toBe('https://user.example/profile/card#me');
    expect(stub.calls).toHaveLength(1);
  });

  test('returns session.webId immediately when session restored silently (no popup)', async () => {
    const restoredWebId = 'https://user.example/profile/card#me';
    // Arrange: the first ensureRestored call at construction time flips the
    // session to active, so webId should not open a popup.
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;
    // The factory kicked off ensureRestored already; intercept its restore
    // impl retroactively by wiring it to the same fake.
    fake.isActive = true;
    fake.webId = restoredWebId;

    await expect(rf.webId).resolves.toBe(restoredWebId);
    expect(stub.calls).toHaveLength(0);
  });
});

describe('createReactiveFetch: fetch 401 retry', () => {
  test('401 triggers popup, then retries via authFetch and returns the retry response', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;

    // First call goes through globalThis.fetch (unauthenticated) → 401.
    const unauthenticated = new Response(null, { status: 401 });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => unauthenticated);

    const retryResponse = new Response('retry ok');
    fake.authFetchImpl = async () => retryResponse;
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://user.example/me';
    };

    const pending = rf.fetch('https://pod.example/doc', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'hello',
    });
    await completeLoginPopup(popup);

    const response = await pending;
    expect(response).toBe(retryResponse);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fake.authFetchCalls).toHaveLength(1);
  });

  test('non-401 responses are returned without triggering a popup', async () => {
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const ok = new Response('public', { status: 200 });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ok);

    const response = await rf.fetch('https://public.example/data');
    expect(response).toBe(ok);
    expect(stub.calls).toHaveLength(0);
  });

  test('preserves method + headers + string body on retry', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(null, { status: 401 }),
    );
    fake.authFetchImpl = async () => new Response('ok');
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://user.example/me';
    };

    const pending = rf.fetch('https://pod.example/doc', {
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle', 'X-Custom': 'v' },
      body: '<#a> <#b> <#c> .',
    });
    await completeLoginPopup(popup);
    await pending;

    expect(fake.authFetchCalls).toHaveLength(1);
    const retry = fake.authFetchCalls[0]!;
    expect(retry.input).toBe('https://pod.example/doc');
    expect(retry.init).toEqual({
      method: 'PUT',
      headers: { 'Content-Type': 'text/turtle', 'X-Custom': 'v' },
      body: '<#a> <#b> <#c> .',
    });
  });

  test('preserves body on retry when input is a Request with a consumable body', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(null, { status: 401 }),
    );

    let retryBody = '<unset>';
    fake.authFetchImpl = async (input) => {
      retryBody = await (input as Request).text();
      return new Response('ok');
    };
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://user.example/me';
    };

    const req = new Request('https://pod.example/doc', {
      method: 'POST',
      body: 'clone-me',
      headers: { 'Content-Type': 'text/plain' },
    });
    const pending = rf.fetch(req);
    await completeLoginPopup(popup);
    await pending;

    expect(retryBody).toBe('clone-me');
  });

  test('preserves body on retry when init.body is a consumable (URLSearchParams)', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(null, { status: 401 }),
    );
    let retryBody = '<unset>';
    fake.authFetchImpl = async (input) => {
      retryBody = await (input as Request).text();
      return new Response('ok');
    };
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://user.example/me';
    };

    const pending = rf.fetch('https://pod.example/doc', {
      method: 'POST',
      body: new URLSearchParams({ hello: 'world' }),
    });
    await completeLoginPopup(popup);
    await pending;

    expect(retryBody).toBe('hello=world');
  });

  test('session already active: fetch goes straight through authFetch with no popup', async () => {
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;
    fake.isActive = true;
    fake.webId = 'https://user.example/me';
    // Wait for the factory's initial ensureRestored() microtask to drain.
    await Promise.resolve();
    await Promise.resolve();

    const response = new Response('authed');
    fake.authFetchImpl = async () => response;

    const result = await rf.fetch('https://pod.example/doc');
    expect(result).toBe(response);
    expect(stub.calls).toHaveLength(0);
    expect(fake.authFetchCalls).toHaveLength(1);
  });
});

describe('createReactiveFetch: concurrent login dedup', () => {
  test('concurrent webId reads share one popup', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://user.example/me';
    };

    const p1 = rf.webId;
    const p2 = rf.webId;
    const p3 = rf.webId;
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);

    await completeLoginPopup(popup);

    await expect(Promise.all([p1, p2, p3])).resolves.toEqual([
      'https://user.example/me',
      'https://user.example/me',
      'https://user.example/me',
    ]);
    expect(stub.calls).toHaveLength(1);
  });

  test('concurrent fetch (401) and webId reads share one popup', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(null, { status: 401 }),
    );
    fake.authFetchImpl = async () => new Response('ok');
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://user.example/me';
    };

    const webIdPromise = rf.webId;
    const fetchPromise = rf.fetch('https://pod.example/doc');

    await completeLoginPopup(popup);

    const [webId, response] = await Promise.all([webIdPromise, fetchPromise]);
    expect(webId).toBe('https://user.example/me');
    expect(response).toBeInstanceOf(Response);
    expect(stub.calls).toHaveLength(1);
  });

  test('after a failed login, a new webId read starts a fresh attempt', async () => {
    const popup1 = createMockPopup();
    stub.nextPopup(popup1);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    const fake = FakeSession.lastInstance!;

    // First attempt: popup closed by the user → PopupClosedError.
    vi.useFakeTimers();
    const first = rf.webId.catch((e: unknown) => e);
    popup1.simulateUserClose();
    await vi.advanceTimersByTimeAsync(600);
    vi.useRealTimers();
    const firstErr = await first;
    expect(firstErr).toBeInstanceOf(Error);

    // Second attempt: new popup, login succeeds.
    const popup2 = createMockPopup();
    stub.nextPopup(popup2);
    fake.restoreImpl = async () => {
      fake.isActive = true;
      fake.webId = 'https://user.example/me';
    };

    const second = rf.webId;
    await completeLoginPopup(popup2);
    await expect(second).resolves.toBe('https://user.example/me');
    expect(stub.calls).toHaveLength(2);
  });
});

describe('createReactiveFetch: restore observability', () => {
  afterEach(() => {
    FakeSession.onConstruct = undefined;
  });

  test('onRestoreError is invoked when construction-time restore throws', async () => {
    FakeSession.onConstruct = (instance) => {
      instance.restoreImpl = async () => {
        throw new Error('IDB corrupt');
      };
    };

    const onRestoreError = vi.fn();
    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      onRestoreError,
    });

    await rf.restorePromise;
    expect(onRestoreError).toHaveBeenCalledOnce();
    const [received] = onRestoreError.mock.calls[0]!;
    expect(received).toBeInstanceOf(Error);
  });

  test('rf.restorePromise resolves (never rejects) even when restore fails', async () => {
    FakeSession.onConstruct = (instance) => {
      instance.restoreImpl = async () => {
        throw new Error('boom');
      };
    };

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });
    // No onRestoreError — failure must still be swallowed so the Promise settles.
    await expect(rf.restorePromise).resolves.toBeUndefined();
  });

  test('post-login session inactivity throws SessionRestoreFailedError', async () => {
    const { SessionRestoreFailedError, ReactiveFetchError } = await import('./errors.js');
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetch({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });

    // Leave restoreImpl as the default no-op so session stays inactive even
    // after the post-popup forced restore.
    const webIdPromise = rf.webId.catch((e: unknown) => e);
    await completeLoginPopup(popup);
    const err = await webIdPromise;
    expect(err).toBeInstanceOf(SessionRestoreFailedError);
    expect(err).toBeInstanceOf(ReactiveFetchError);
    expect((err as { code: string }).code).toBe('session_restore_failed');
  });
});
