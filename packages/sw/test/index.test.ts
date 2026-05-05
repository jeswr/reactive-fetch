// Page-side tests for `registerReactiveFetchSW`.
//
// The most important assertions in this file enforce the
// `event.source` gate that prevents non-SW MessageEvents from
// triggering `loginDriver`. The regression test names them
// explicitly so any future regression points right at the
// security guard that landed alongside them.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  LOGIN_REQUIRED_MESSAGE_TYPE,
  REGISTER_HANDSHAKE_MESSAGE_TYPE,
  REGISTER_ACK_MESSAGE_TYPE,
  registerReactiveFetchSW,
} from '../src/index.js';
import {
  createFakeServiceWorker,
  installFakeServiceWorker,
  type FakeServiceWorkerContainer,
} from './helpers/mockServiceWorker.js';

let container: FakeServiceWorkerContainer;

beforeEach(() => {
  container = installFakeServiceWorker({ initiallyActive: true });
});

afterEach(() => {
  container.restore();
  vi.useRealTimers();
});

const baseOptions = () =>
  ({
    swUrl: '/reactive-fetch-sw.js',
    clientId: 'https://app.example/client.jsonld',
    callbackUrl: 'https://app.example/callback',
    loginDriver: vi.fn(async () => undefined),
    authOrigins: ['https://pod.example'],
  }) as const;

async function registerWithImmediateAck(loginDriver?: () => Promise<void>) {
  const opts = {
    ...baseOptions(),
    loginDriver: loginDriver ?? vi.fn(async () => undefined),
  };
  const pending = registerReactiveFetchSW(opts);
  // `sendHandshake` adds its own `'message'` listener AFTER posting the
  // handshake. Wait one microtask so the listener is installed before we
  // synthesise the ack.
  await Promise.resolve();
  await Promise.resolve();
  // Reply with the ack from the active worker.
  container.dispatchMessage(
    { type: REGISTER_ACK_MESSAGE_TYPE, clientId: opts.clientId },
    container.registration.active as unknown as MessageEventSource,
  );
  const reg = await pending;
  return { reg, opts };
}

describe('registerReactiveFetchSW: SSR / no-navigator guard', () => {
  test('throws when navigator.serviceWorker is unavailable', async () => {
    container.restore();
    // Simulate Node/SSR by deleting `navigator.serviceWorker` outright.
    const navAny = navigator as unknown as { serviceWorker?: unknown };
    delete navAny.serviceWorker;
    await expect(registerReactiveFetchSW(baseOptions())).rejects.toThrow(
      /Service Worker/i,
    );
    // Reinstall so afterEach.restore is a no-op.
    container = installFakeServiceWorker({ initiallyActive: true });
  });
});

describe('registerReactiveFetchSW: handshake', () => {
  test('registers a SW listener and resolves on register-ack from the active worker', async () => {
    const { reg } = await registerWithImmediateAck();
    expect(reg.registration).toBeDefined();
    // The page-side message listener is still attached after handshake completes.
    expect(container.messageListenerCount).toBe(1);
  });

  test('handshake times out after 1s and registration still resolves', async () => {
    vi.useFakeTimers();
    const opts = baseOptions();
    const pending = registerReactiveFetchSW(opts);

    // No ack will arrive — let the 1s timeout fire.
    await vi.advanceTimersByTimeAsync(1100);
    const reg = await pending;
    expect(reg.registration).toBeDefined();
    // After the handshake-listener self-removes, only the long-lived
    // login-required listener should be still attached.
    expect(container.messageListenerCount).toBe(1);
  });

  test('stale-source ack (e.g. MessagePort) does NOT resolve handshake', async () => {
    vi.useFakeTimers();
    const opts = baseOptions();
    const pending = registerReactiveFetchSW(opts);
    await Promise.resolve();
    await Promise.resolve();

    // Synthesise an ack from a fake MessagePort-shaped source.
    const fakePort = { postMessage: vi.fn() } as unknown as MessageEventSource;
    container.dispatchMessage(
      { type: REGISTER_ACK_MESSAGE_TYPE, clientId: opts.clientId },
      fakePort,
    );
    // No resolution; only the 1s timeout will eventually settle it.
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1100);
    await pending; // Now resolved by timeout.
    expect(settled).toBe(true);
  });
});

describe('registerReactiveFetchSW: event.source security gate (regression)', () => {
  test('null source MUST NOT trigger loginDriver', async () => {
    const loginDriver = vi.fn(async () => undefined);
    await registerWithImmediateAck(loginDriver);

    container.dispatchMessage(
      { type: LOGIN_REQUIRED_MESSAGE_TYPE, requestId: 'rid-1', url: 'https://pod.example/x' },
      null,
    );
    // Drain microtasks; the listener returns synchronously when source is bad.
    await Promise.resolve();
    await Promise.resolve();
    expect(loginDriver).not.toHaveBeenCalled();
  });

  test('fake Worker-like source MUST NOT trigger loginDriver', async () => {
    const loginDriver = vi.fn(async () => undefined);
    await registerWithImmediateAck(loginDriver);

    const fakeWorker = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      terminate: vi.fn(),
    } as unknown as MessageEventSource;
    container.dispatchMessage(
      { type: LOGIN_REQUIRED_MESSAGE_TYPE, requestId: 'rid-2', url: 'https://pod.example/x' },
      fakeWorker,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(loginDriver).not.toHaveBeenCalled();
  });

  test('fake MessagePort-like source MUST NOT trigger loginDriver', async () => {
    const loginDriver = vi.fn(async () => undefined);
    await registerWithImmediateAck(loginDriver);

    const fakePort = {
      postMessage: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
    } as unknown as MessageEventSource;
    container.dispatchMessage(
      { type: LOGIN_REQUIRED_MESSAGE_TYPE, requestId: 'rid-3', url: 'https://pod.example/x' },
      fakePort,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(loginDriver).not.toHaveBeenCalled();
  });

  test('controller-source login-required DOES trigger loginDriver', async () => {
    const loginDriver = vi.fn(async () => undefined);
    const { reg } = await registerWithImmediateAck(loginDriver);
    void reg;

    // Use the registration's active worker — the page-side gate accepts
    // either `navigator.serviceWorker.controller` or the registration's
    // `active`/`waiting`/`installing` worker.
    container.dispatchMessage(
      { type: LOGIN_REQUIRED_MESSAGE_TYPE, requestId: 'rid-good', url: 'https://pod.example/x' },
      container.registration.active as unknown as MessageEventSource,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(loginDriver).toHaveBeenCalledTimes(1);
  });
});

describe('registerReactiveFetchSW: loginDriver lifecycle', () => {
  test('loginDriver success posts login-complete back to the SW', async () => {
    const loginDriver = vi.fn(async () => undefined);
    await registerWithImmediateAck(loginDriver);
    const active = container.registration.active!;

    container.dispatchMessage(
      { type: LOGIN_REQUIRED_MESSAGE_TYPE, requestId: 'rid-A', url: 'https://pod.example/x' },
      active as unknown as MessageEventSource,
    );
    await Promise.resolve();
    await Promise.resolve();
    // Wait for the loginDriver microtask to finish.
    await Promise.resolve();
    await Promise.resolve();

    expect(loginDriver).toHaveBeenCalledTimes(1);
    // Find the login-complete reply on the active worker. We strip
    // earlier handshake replies (none in this test, since the active
    // worker doesn't receive the handshake — that goes to active too,
    // so we filter by type).
    const completes = active.postMessage.mock.calls
      .map((c) => c[0] as { type?: string })
      .filter((m) => m && m.type === 'reactive-fetch-sw:login-complete');
    expect(completes).toHaveLength(1);
    expect(completes[0]).toMatchObject({ requestId: 'rid-A' });
  });

  test('loginDriver failure posts login-failed back to the SW with the error reason', async () => {
    const loginDriver = vi.fn(async () => {
      throw new Error('boom: user closed popup');
    });
    await registerWithImmediateAck(loginDriver);
    const active = container.registration.active!;

    container.dispatchMessage(
      { type: LOGIN_REQUIRED_MESSAGE_TYPE, requestId: 'rid-B', url: 'https://pod.example/y' },
      active as unknown as MessageEventSource,
    );
    // Drain enough microtasks for the catch branch to fire.
    for (let i = 0; i < 6; i++) await Promise.resolve();

    const fails = active.postMessage.mock.calls
      .map((c) => c[0] as { type?: string; reason?: string })
      .filter((m) => m && m.type === 'reactive-fetch-sw:login-failed');
    expect(fails).toHaveLength(1);
    expect(fails[0]).toMatchObject({
      requestId: 'rid-B',
      reason: 'boom: user closed popup',
    });
  });

  test('two concurrent login-required events share one loginDriver invocation; each requestId acked separately', async () => {
    let resolveLogin: (() => void) | undefined;
    const loginDriver = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    await registerWithImmediateAck(loginDriver);
    const active = container.registration.active!;

    container.dispatchMessage(
      { type: LOGIN_REQUIRED_MESSAGE_TYPE, requestId: 'rid-1', url: 'https://pod.example/a' },
      active as unknown as MessageEventSource,
    );
    container.dispatchMessage(
      { type: LOGIN_REQUIRED_MESSAGE_TYPE, requestId: 'rid-2', url: 'https://pod.example/b' },
      active as unknown as MessageEventSource,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(loginDriver).toHaveBeenCalledTimes(1);

    // Resolve the single in-flight login.
    resolveLogin?.();
    for (let i = 0; i < 6; i++) await Promise.resolve();

    const completes = active.postMessage.mock.calls
      .map((c) => c[0] as { type?: string; requestId?: string })
      .filter((m) => m && m.type === 'reactive-fetch-sw:login-complete');
    const ids = completes.map((m) => m.requestId).sort();
    expect(ids).toEqual(['rid-1', 'rid-2']);
  });
});

describe('registerReactiveFetchSW: handshake forwards clientId / loginTimeoutMs', () => {
  test('handshake message carries clientId and the consumer-supplied loginTimeoutMs', async () => {
    const opts = {
      ...baseOptions(),
      loginTimeoutMs: 12345,
    };
    const pending = registerReactiveFetchSW(opts);
    await Promise.resolve();
    await Promise.resolve();
    const active = container.registration.active!;
    const handshakeCall = active.postMessage.mock.calls.find(
      (c) => (c[0] as { type?: string })?.type === REGISTER_HANDSHAKE_MESSAGE_TYPE,
    );
    expect(handshakeCall).toBeDefined();
    expect(handshakeCall?.[0]).toMatchObject({
      clientId: opts.clientId,
      loginTimeoutMs: 12345,
    });
    container.dispatchMessage(
      { type: REGISTER_ACK_MESSAGE_TYPE, clientId: opts.clientId },
      active as unknown as MessageEventSource,
    );
    await pending;
  });
});

describe('registerReactiveFetchSW: waitForActiveServiceWorker', () => {
  test('waits for a state change to "activated" when no worker is active yet', async () => {
    container.restore();
    container = installFakeServiceWorker({ initiallyActive: false });

    const installing = createFakeServiceWorker('installing');
    container.registration.installing = installing;

    const opts = baseOptions();
    const pending = registerReactiveFetchSW(opts);
    await Promise.resolve();

    // Promote the installing worker to activated.
    container.registration.active = installing;
    installing.emitStateChange('activated');

    await Promise.resolve();
    await Promise.resolve();

    container.dispatchMessage(
      { type: REGISTER_ACK_MESSAGE_TYPE, clientId: opts.clientId },
      installing as unknown as MessageEventSource,
    );
    const reg = await pending;
    expect(reg.registration).toBeDefined();
  });
});

describe('registerReactiveFetchSW: unsubscribe', () => {
  test('removes the page-side message listener', async () => {
    const { reg } = await registerWithImmediateAck();
    expect(container.messageListenerCount).toBe(1);
    await reg.unsubscribe();
    expect(container.messageListenerCount).toBe(0);
  });

  test('unregister option calls registration.unregister', async () => {
    const { reg } = await registerWithImmediateAck();
    await reg.unsubscribe({ unregister: true });
    expect(container.registration.unregister).toHaveBeenCalledTimes(1);
  });
});
