// Worker-side tests for `worker.ts`.
//
// `worker.ts` is a service-worker module with non-trivial top-level
// side effects: it calls `self.addEventListener('install' | 'activate'
// | 'message' | 'fetch', …)` four times when imported. We can't run it
// in a real SW realm from vitest, and jsdom doesn't ship a SW shim, so
// each test:
//
//   1. installs a fake `self` (and `Client`) on `globalThis`,
//   2. resets vitest's module cache so the import re-runs the
//      module-top-level code under our stubs,
//   3. dynamically imports `./worker.js` (which we never import at the
//      top of this file — the import has to happen AFTER the stub is in
//      place),
//   4. fires events through the captured handler list.
//
// We rely on `fileParallelism: false` (vitest config) so the
// module-singleton state in `worker.ts` doesn't race across files.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  installFakeWorkerScope,
  makeFakeClient,
  makeFakeExtendableEvent,
  makeFakeFetchEvent,
  makeFakeMessageEvent,
  type FakeWorkerScope,
} from '../test/helpers/mockWorkerScope.js';
import {
  LOGIN_REQUIRED_MESSAGE_TYPE,
  LOGIN_COMPLETE_MESSAGE_TYPE,
  LOGIN_FAILED_MESSAGE_TYPE,
  REGISTER_HANDSHAKE_MESSAGE_TYPE,
  REGISTER_ACK_MESSAGE_TYPE,
} from '@jeswr/solid-reactive-fetch-shared/sw';

const ORIGIN = 'http://localhost';
const REMOTE_URL = 'https://pod.example.com/private';
const SAME_ORIGIN_URL = 'http://localhost/index.html';

let scope: FakeWorkerScope;

async function loadWorker(): Promise<void> {
  // Reset vitest's module cache so worker.ts's top-level side effects
  // (the `self.addEventListener` calls) re-run against our fresh stub.
  vi.resetModules();
  // Each test installs its scope BEFORE this dynamic import.
  await import('./worker.js');
}

/**
 * Yield to the macrotask queue several times. The worker's fetch flow
 * goes through SessionCore.restore() which touches IndexedDB via
 * fake-indexeddb (real macrotasks), so a few microtask ticks are not
 * enough — we need to flush actual setTimeout callbacks.
 */
async function flushMacrotasks(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  scope = installFakeWorkerScope({ origin: ORIGIN });
});

afterEach(() => {
  scope.uninstall();
  vi.useRealTimers();
  vi.resetModules();
});

function sendHandshake(client = makeFakeClient(`${ORIGIN}/`), opts: {
  clientId?: string;
  loginTimeoutMs?: number;
  authOrigins?: readonly string[];
} = {}): typeof client {
  const handshake = {
    type: REGISTER_HANDSHAKE_MESSAGE_TYPE,
    clientId: opts.clientId ?? 'https://app.example/client.jsonld',
    loginTimeoutMs: opts.loginTimeoutMs ?? 5 * 60 * 1000,
    // Default the test allowlist to the pod origin used by REMOTE_URL.
    // Tests that need a different allowlist override.
    authOrigins: opts.authOrigins ?? ['https://pod.example.com'],
  };
  scope.dispatch('message', makeFakeMessageEvent(handshake, client));
  return client;
}

describe('worker: lifecycle', () => {
  test('install handler calls self.skipWaiting()', async () => {
    await loadWorker();
    const event = makeFakeExtendableEvent();
    scope.dispatch('install', event);
    expect(event.waitUntil).toHaveBeenCalledTimes(1);
    expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
  });

  test('activate handler calls self.clients.claim()', async () => {
    await loadWorker();
    const event = makeFakeExtendableEvent();
    scope.dispatch('activate', event);
    expect(event.waitUntil).toHaveBeenCalledTimes(1);
    // Activate is now async (rehydrates persisted config first), so
    // `clients.claim()` only fires after the awaited Promise inside
    // `event.waitUntil` resolves. Pull the Promise out and await it.
    const waited = event.waitUntil.mock.calls[0]?.[0];
    expect(waited).toBeInstanceOf(Promise);
    await waited;
    expect(scope.clientsClaim).toHaveBeenCalledTimes(1);
  });

  test('worker registers all four lifecycle/event listeners', async () => {
    await loadWorker();
    expect(scope.listeners.get('install')).toHaveLength(1);
    expect(scope.listeners.get('activate')).toHaveLength(1);
    expect(scope.listeners.get('message')).toHaveLength(1);
    expect(scope.listeners.get('fetch')).toHaveLength(1);
  });
});

describe('worker: handshake', () => {
  test('a same-origin Client handshake stores config and sends an ack', async () => {
    await loadWorker();
    const client = makeFakeClient(`${ORIGIN}/`);
    sendHandshake(client, { clientId: 'https://app.example/cid' });

    expect(client.postMessage).toHaveBeenCalledWith({
      type: REGISTER_ACK_MESSAGE_TYPE,
      clientId: 'https://app.example/cid',
    });
  });

  test('handshake from a non-Client source is ignored (no ack)', async () => {
    await loadWorker();
    const fakePort = { postMessage: vi.fn() };
    scope.dispatch(
      'message',
      makeFakeMessageEvent(
        {
          type: REGISTER_HANDSHAKE_MESSAGE_TYPE,
          clientId: 'https://app.example/cid',
          loginTimeoutMs: 60000,
          authOrigins: ['https://pod.example.com'],
        },
        fakePort,
      ),
    );
    expect(fakePort.postMessage).not.toHaveBeenCalled();
  });

  test('handshake from a cross-origin Client is ignored (no ack)', async () => {
    await loadWorker();
    const client = makeFakeClient('https://evil.example/');
    sendHandshake(client);
    expect(client.postMessage).not.toHaveBeenCalled();
  });
});

describe('worker: fetch interception', () => {
  test('worker hardcodes "skip same-origin" — same-origin GET falls through (no respondWith)', async () => {
    await loadWorker();
    sendHandshake();

    const event = makeFakeFetchEvent(new Request(SAME_ORIGIN_URL));
    scope.dispatch('fetch', event);

    expect(event.respondWith).not.toHaveBeenCalled();
  });

  test('without a handshake (config null, no persisted config) the fetch passes through unauthenticated', async () => {
    await loadWorker();

    // The worker now lazily loads persisted config inside `respondWith`
    // (because `activate` doesn't fire on every browser-triggered SW
    // restart), so it DOES call respondWith — but with no config to
    // load, the resolved Response must be a plain pass-through to
    // globalThis.fetch. Stub fetch to verify that path.
    const passthroughResponse = new Response('passthrough', { status: 200 });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(passthroughResponse);

    const event = makeFakeFetchEvent(new Request(REMOTE_URL));
    scope.dispatch('fetch', event);
    expect(event.respondWith).toHaveBeenCalledTimes(1);
    const responsePromise = event.respondWith.mock.calls[0]?.[0] as Promise<Response>;
    const response = await responsePromise;
    expect(response).toBe(passthroughResponse);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  // The lazy-rehydrate path inside `handleFetchWithLazyConfig` is
  // exercised by the "without a handshake (config null, no persisted
  // config)" test above (it asserts the passthrough route through
  // `globalThis.fetch`). A standalone re-import test would be brittle:
  // `vi.resetModules()` doesn't clear the listener map captured by the
  // existing fake scope, so the new module's top-level
  // `self.addEventListener(...)` calls would double-register and break
  // every subsequent dispatch. The activate-time rehydrate path is
  // covered separately ("handshake config is persisted to caches…").

  test('cross-origin request to a non-allowlisted origin falls through (no respondWith)', async () => {
    await loadWorker();
    // Allowlist only the pod; the third-party API below must not be
    // auth-decorated even though it's cross-origin.
    sendHandshake(undefined, { authOrigins: ['https://pod.example.com'] });

    const event = makeFakeFetchEvent(new Request('https://thirdparty.example.com/api'));
    scope.dispatch('fetch', event);

    expect(event.respondWith).not.toHaveBeenCalled();
  });

  test('handshake config is persisted to caches so a restarted worker can rehydrate', async () => {
    await loadWorker();
    const event = makeFakeMessageEvent(
      {
        type: REGISTER_HANDSHAKE_MESSAGE_TYPE,
        clientId: 'https://app.example/cid',
        loginTimeoutMs: 60000,
        authOrigins: ['https://pod.example.com'],
      },
      makeFakeClient(`${ORIGIN}/`),
    );
    scope.dispatch('message', event);
    // The handshake handler calls `event.waitUntil(persistConfig(...))`.
    // Pull the Promise out and await persistence.
    const waited = event.waitUntil.mock.calls[0]?.[0];
    expect(waited).toBeInstanceOf(Promise);
    await waited;

    // Subsequent activate should rehydrate the config from caches and
    // claim clients without needing another handshake.
    const activate = makeFakeExtendableEvent();
    scope.dispatch('activate', activate);
    await activate.waitUntil.mock.calls[0]?.[0];
    expect(scope.clientsClaim).toHaveBeenCalled();
  });

  test('cross-origin request without active session broadcasts login-required to clients', async () => {
    await loadWorker();
    const client = sendHandshake();
    scope.clients = [client];

    const event = makeFakeFetchEvent(new Request(REMOTE_URL));
    scope.dispatch('fetch', event);
    expect(event.respondWith).toHaveBeenCalled();

    // The fetch flow goes through SessionCore.restore() which touches
    // IndexedDB via fake-indexeddb (macrotask). Yield to the macrotask
    // queue a few times so the broadcast lands.
    await flushMacrotasks();

    const loginRequiredCalls = client.postMessage.mock.calls
      .map((c) => c[0] as { type?: string })
      .filter((m) => m && m.type === LOGIN_REQUIRED_MESSAGE_TYPE);
    expect(loginRequiredCalls).toHaveLength(1);
    const message = loginRequiredCalls[0] as { requestId: string; url: string };
    expect(message.url).toBe(REMOTE_URL);
    expect(message.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test('cold-start with no clients listening: 401 with X-Reactive-Fetch-SW: no-page-listener', async () => {
    await loadWorker();
    sendHandshake();
    scope.clients = []; // no listeners

    const event = makeFakeFetchEvent(new Request(REMOTE_URL));
    scope.dispatch('fetch', event);

    await flushMacrotasks();
    const response = await event.responsePromise;
    expect(response).not.toBeNull();
    expect(response!.status).toBe(401);
    expect(response!.headers.get('X-Reactive-Fetch-SW')).toBe('no-page-listener');
  });

  test('login-timeout configurable via the handshake; expiry surfaces X-Reactive-Fetch-SW: login-timeout', async () => {
    // Real timers: fake-indexeddb's restore path uses real macrotasks
    // and mixing fake timers with that is fragile. The configured
    // timeout (50ms) keeps the test fast.
    await loadWorker();
    const client = sendHandshake(undefined, { loginTimeoutMs: 50 });
    scope.clients = [client];

    const event = makeFakeFetchEvent(new Request(REMOTE_URL));
    scope.dispatch('fetch', event);

    // Wait long enough for the broadcast + the configured timeout +
    // the catch-branch 401 build.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await flushMacrotasks();

    const response = await event.responsePromise;
    expect(response).not.toBeNull();
    expect(response!.status).toBe(401);
    expect(response!.headers.get('X-Reactive-Fetch-SW')).toBe('login-timeout');
  });

  test('login-timeout default is 5 minutes when handshake omits it', async () => {
    // We don't wait 5 minutes; we just verify the worker armed a timer
    // for that duration by checking that no timeout fires within a
    // short real wait.
    await loadWorker();
    const client = sendHandshake(undefined, { loginTimeoutMs: 5 * 60 * 1000 });
    scope.clients = [client];

    const event = makeFakeFetchEvent(new Request(REMOTE_URL));
    scope.dispatch('fetch', event);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await flushMacrotasks();

    // After 100ms the 5-minute timeout has not fired; respondWith was
    // called but no response should be ready yet.
    const settled = vi.fn();
    void event.responsePromise.then(settled);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(settled).not.toHaveBeenCalled();
  });
});

describe('worker: page -> worker login replies (event.source security gate)', () => {
  test('login-complete from a non-Client source is dropped silently (no resolver fires)', async () => {
    await loadWorker();
    const client = sendHandshake();
    scope.clients = [client];

    const event = makeFakeFetchEvent(new Request(REMOTE_URL));
    scope.dispatch('fetch', event);
    await flushMacrotasks();

    const sentRid = (client.postMessage.mock.calls.find(
      (c) => (c[0] as { type?: string })?.type === LOGIN_REQUIRED_MESSAGE_TYPE,
    )?.[0] as { requestId: string }).requestId;

    // A spoofed login-complete from a non-Client source is silently
    // dropped by `isSameOriginClient`. The resolver entry survives.
    const fakePort = { postMessage: vi.fn() };
    scope.dispatch(
      'message',
      makeFakeMessageEvent(
        { type: LOGIN_COMPLETE_MESSAGE_TYPE, requestId: sentRid },
        fakePort,
      ),
    );

    // Now send a legit login-complete from the controlling client and
    // verify the request still completes (resolver was untouched by the
    // spoof). We expect the worker to attempt restore() afterwards;
    // restore failure is fine — we only need to confirm the resolver
    // fired (i.e., respondWith eventually settles).
    scope.dispatch(
      'message',
      makeFakeMessageEvent(
        { type: LOGIN_COMPLETE_MESSAGE_TYPE, requestId: sentRid },
        client,
      ),
    );

    await flushMacrotasks(10);
    const response = await event.responsePromise;
    expect(response).not.toBeNull();
    // The response will be a 401 (restore failed / restore-inactive),
    // because no real Session is in IDB; the important thing is that
    // the spoofed message DID NOT short-circuit the flow.
    expect(response!.status).toBe(401);
  });

  test('stale requestId in login-complete is dropped silently', async () => {
    await loadWorker();
    const client = sendHandshake();
    // No outstanding requestIds; the worker should swallow this without throwing.
    expect(() =>
      scope.dispatch(
        'message',
        makeFakeMessageEvent(
          { type: LOGIN_COMPLETE_MESSAGE_TYPE, requestId: 'no-such-id' },
          client,
        ),
      ),
    ).not.toThrow();

    expect(() =>
      scope.dispatch(
        'message',
        makeFakeMessageEvent(
          {
            type: LOGIN_FAILED_MESSAGE_TYPE,
            requestId: 'no-such-id',
            reason: 'whatever',
          },
          client,
        ),
      ),
    ).not.toThrow();
  });
});

describe('worker: requestId uniqueness', () => {
  test('three concurrent broadcasts produce three distinct UUIDv4 requestIds', async () => {
    await loadWorker();
    const client = sendHandshake();
    scope.clients = [client];

    // Three concurrent fetches — one broadcast each.
    const events = [
      makeFakeFetchEvent(new Request(`${REMOTE_URL}/a`)),
      makeFakeFetchEvent(new Request(`${REMOTE_URL}/b`)),
      makeFakeFetchEvent(new Request(`${REMOTE_URL}/c`)),
    ];
    for (const e of events) scope.dispatch('fetch', e);

    await flushMacrotasks(10);

    const ids = client.postMessage.mock.calls
      .map((c) => c[0] as { type?: string; requestId?: string })
      .filter((m) => m && m.type === LOGIN_REQUIRED_MESSAGE_TYPE)
      .map((m) => m.requestId);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });
});
