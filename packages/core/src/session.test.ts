import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { LoginFailedError } from './errors.js';

/**
 * FakeSession stands in for `@uvdsl/solid-oidc-client-browser`'s Session.
 * It's intentionally the smallest surface our session wrapper touches:
 * `isActive`, `restore()`, `authFetch(input, init)`. Instances track every
 * call so tests can assert exact pass-through behaviour.
 */
class FakeSession {
  static lastInstance: FakeSession | undefined;
  static constructorCalls: Array<{ client_id: string }> = [];

  isActive = false;
  restoreCalls = 0;
  restoreImpl: () => Promise<void> = async () => {
    this.isActive = true;
  };
  authFetchCalls: Array<{ input: unknown; init?: RequestInit }> = [];
  authFetchImpl: (input: unknown, init?: RequestInit) => Promise<Response> = async () =>
    new Response('ok');

  constructor(clientDetails: { client_id: string }) {
    FakeSession.constructorCalls.push(clientDetails);
    FakeSession.lastInstance = this;
  }

  async restore(): Promise<void> {
    this.restoreCalls += 1;
    return this.restoreImpl();
  }

  authFetch(input: unknown, init?: RequestInit): Promise<Response> {
    this.authFetchCalls.push({ input, init });
    return this.authFetchImpl(input, init);
  }

  static reset(): void {
    FakeSession.lastInstance = undefined;
    FakeSession.constructorCalls = [];
  }
}

vi.mock('@uvdsl/solid-oidc-client-browser', () => ({
  Session: FakeSession,
}));

let sessionModule: typeof import('./session.js');

beforeEach(async () => {
  FakeSession.reset();
  sessionModule = await import('./session.js');
  sessionModule.__resetSessionCacheForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createSessionBootstrap', () => {
  test('caches SessionBootstrap per clientId (same instance returned)', () => {
    const first = sessionModule.createSessionBootstrap('https://app.example/id');
    const second = sessionModule.createSessionBootstrap('https://app.example/id');
    expect(second).toBe(first);
    expect(FakeSession.constructorCalls).toEqual([{ client_id: 'https://app.example/id' }]);
  });

  test('different clientIds produce distinct Session instances', () => {
    const a = sessionModule.createSessionBootstrap('https://a.example/id');
    const b = sessionModule.createSessionBootstrap('https://b.example/id');
    expect(a.session).not.toBe(b.session);
    expect(a.clientId).toBe('https://a.example/id');
    expect(b.clientId).toBe('https://b.example/id');
    expect(FakeSession.constructorCalls.map((c) => c.client_id)).toEqual([
      'https://a.example/id',
      'https://b.example/id',
    ]);
  });

  test('__resetSessionCacheForTests drops cached bootstraps', () => {
    const before = sessionModule.createSessionBootstrap('https://app.example/id');
    sessionModule.__resetSessionCacheForTests();
    const after = sessionModule.createSessionBootstrap('https://app.example/id');
    expect(after).not.toBe(before);
    expect(FakeSession.constructorCalls).toHaveLength(2);
  });
});

describe('ensureRestored', () => {
  test('no-op when session is already active', async () => {
    const { session } = sessionModule.createSessionBootstrap('https://app.example/id');
    const fake = session as unknown as FakeSession;
    fake.isActive = true;

    await sessionModule.ensureRestored(session);
    expect(fake.restoreCalls).toBe(0);
  });

  test('calls restore() once and flips isActive', async () => {
    const { session } = sessionModule.createSessionBootstrap('https://app.example/id');
    const fake = session as unknown as FakeSession;

    await sessionModule.ensureRestored(session);
    expect(fake.restoreCalls).toBe(1);
    expect(fake.isActive).toBe(true);
  });

  test('concurrent callers share a single in-flight restore (idempotency)', async () => {
    const { session } = sessionModule.createSessionBootstrap('https://app.example/id');
    const fake = session as unknown as FakeSession;

    let resolveRestore!: () => void;
    fake.restoreImpl = () =>
      new Promise<void>((resolve) => {
        resolveRestore = () => {
          fake.isActive = true;
          resolve();
        };
      });

    const p1 = sessionModule.ensureRestored(session);
    const p2 = sessionModule.ensureRestored(session);
    const p3 = sessionModule.ensureRestored(session);

    resolveRestore();
    await Promise.all([p1, p2, p3]);

    expect(fake.restoreCalls).toBe(1);
  });

  test('wraps underlying restore() errors in LoginFailedError with cause', async () => {
    const { session } = sessionModule.createSessionBootstrap('https://app.example/id');
    const fake = session as unknown as FakeSession;
    const underlying = new Error('refresh token expired');
    fake.restoreImpl = async () => {
      throw underlying;
    };

    const err = await sessionModule.ensureRestored(session).catch((e) => e);
    expect(err).toBeInstanceOf(LoginFailedError);
    expect((err as LoginFailedError).code).toBe('login_failed');
    expect((err as LoginFailedError).cause).toBe(underlying);
  });

  test('clears in-flight promise on rejection so a later call can retry', async () => {
    const { session } = sessionModule.createSessionBootstrap('https://app.example/id');
    const fake = session as unknown as FakeSession;

    fake.restoreImpl = async () => {
      throw new Error('first attempt fails');
    };
    await sessionModule.ensureRestored(session).catch(() => undefined);

    fake.restoreImpl = async () => {
      fake.isActive = true;
    };
    await sessionModule.ensureRestored(session);
    expect(fake.restoreCalls).toBe(2);
    expect(fake.isActive).toBe(true);
  });
});

describe('authFetch', () => {
  test('routes through session.authFetch when session is active', async () => {
    const { session } = sessionModule.createSessionBootstrap('https://app.example/id');
    const fake = session as unknown as FakeSession;
    fake.isActive = true;
    const response = new Response('auth');
    fake.authFetchImpl = async () => response;

    const result = await sessionModule.authFetch(session, 'https://pod.example/resource', {
      method: 'GET',
      headers: { 'X-Test': '1' },
    });

    expect(result).toBe(response);
    expect(fake.authFetchCalls).toEqual([
      { input: 'https://pod.example/resource', init: { method: 'GET', headers: { 'X-Test': '1' } } },
    ]);
  });

  test('falls back to globalThis.fetch when session is inactive', async () => {
    const { session } = sessionModule.createSessionBootstrap('https://app.example/id');
    const fake = session as unknown as FakeSession;
    const response = new Response('anon');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => response);

    const result = await sessionModule.authFetch(session, 'https://public.example/data');

    expect(result).toBe(response);
    expect(fetchSpy).toHaveBeenCalledWith('https://public.example/data', undefined);
    expect(fake.authFetchCalls).toHaveLength(0);
  });
});
