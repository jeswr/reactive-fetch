// Unit tests for `createReactiveFetchPrompt`. Targets the security-critical
// invariants of the prompt-flavoured factory:
//
//   1. `window.prompt` is called synchronously inside the user-gesture
//      stack frame (no microtask boundary between prompt and window.open).
//   2. The cancel path (prompt returns null) rejects with the typed
//      `WebIdPromptCancelledError` and never opens a popup.
//   3. Invalid / hostile WebID URLs (`javascript:`, `data:`, `file:`,
//      raw strings, off-allow-list http) reject with `InvalidWebIdError`
//      BEFORE `window.open` is called.
//   4. Happy path: validated WebID is encoded into the popup URL.
//   5. `allowLocalhost` toggles the http-localhost branch only.
//   6. Concurrent `webId` reads share one prompt + one popup (single-flight).
//   7. `solid.login(webId)` skips `window.prompt`; passes through validation.

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

// FakeSession stand-in. Same pattern as the core package's tests: hoisted so
// the vi.mock factory below can reference the class declaration.
const { FakeSession } = vi.hoisted(() => {
  class FakeSession {
    static lastInstance: FakeSession | undefined;
    static onConstruct: ((instance: FakeSession) => void) | undefined;
    isActive = false;
    webId: string | undefined;
    restoreCalls = 0;
    restoreImpl: () => Promise<void> = async () => undefined;
    logoutImpl: () => Promise<void> = async () => {
      this.isActive = false;
      this.webId = undefined;
    };
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
    async logout(): Promise<void> {
      return this.logoutImpl();
    }
    authFetch(input: unknown, init?: RequestInit): Promise<Response> {
      this.authFetchCalls.push({ input, init });
      return this.authFetchImpl(input, init);
    }
  }
  return { FakeSession };
});

vi.mock('@uvdsl/solid-oidc-client-browser', () => ({
  Session: FakeSession,
}));

let createReactiveFetchPrompt: typeof import('./index.js').createReactiveFetchPrompt;

let stub: MockWindowOpenStub;

async function waitForPopupOpened(target: number, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (stub.calls.length >= target) return;
    await Promise.resolve();
  }
  throw new Error(
    `window.open was not called ${target} time(s) within ${maxTicks} microtasks (got ${stub.calls.length})`,
  );
}

async function completeLoginPopup(popup: MockPopup, openCount = 1): Promise<void> {
  await waitForPopupOpened(openCount);
  popup.postMessageToOpener({ type: LOGIN_COMPLETE_MESSAGE_TYPE });
  await Promise.resolve();
}

beforeEach(async () => {
  __resetSessionCacheForTests();
  __resetPopupStateForTests();
  FakeSession.lastInstance = undefined;
  FakeSession.onConstruct = undefined;
  stub = installMockWindowOpen();
  ({ createReactiveFetchPrompt } = await import('./index.js'));
});

afterEach(() => {
  __resetSessionCacheForTests();
  __resetPopupStateForTests();
  stub.restore();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('createReactiveFetchPrompt: prompt synchronicity', () => {
  test('window.prompt is called BEFORE any await, and window.open follows synchronously', async () => {
    // Tick counter increments inside the prompt function. The factory
    // must call window.prompt and window.open back-to-back inside the
    // same synchronous frame, so the recorded tick on the open call
    // must equal whatever the bump produced.
    let tick = 0;
    stub.setTickProvider(() => tick);

    // Wire FakeSession.onConstruct BEFORE createReactiveFetchPrompt so the
    // construction-time restore() runs against the right impl.
    FakeSession.onConstruct = (instance) => {
      instance.restoreImpl = async () => {
        instance.isActive = true;
        instance.webId = 'https://alice.example/profile#me';
      };
    };

    const promptFn = vi.fn((_message: string) => {
      // Bump the tick the moment the prompt resolves. window.open MUST be
      // called before any awaited microtask, so the recorded `tick` on
      // the open call below should equal whatever this returns.
      tick += 1;
      return 'https://alice.example/profile#me';
    });

    const popup = createMockPopup();
    stub.nextPopup(popup);

    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      prompt: promptFn,
    });

    // Crucial: construction-time `ensureRestored` is async. Its restoreImpl
    // flips the session active synchronously inside the awaited body, but
    // the await + WeakMap dedup means a `webId` read before the next
    // microtask still hits the slow (popup) path. Wait one tick so the
    // initial restore has settled — that way reading rf.webId here does
    // hit the slow path under-test (no popup if isActive is true).
    //
    // For the synchronicity assertion we need rf.webId to take the slow
    // path. To guarantee that, leave restoreImpl as the default no-op
    // until AFTER construction; we'll wire the success path before the
    // popup completes the login.
    FakeSession.lastInstance!.restoreImpl = async () => undefined;
    FakeSession.lastInstance!.isActive = false;
    await Promise.resolve(); // let any pending construction-time microtasks settle

    // Wire success for the post-popup forced restore.
    FakeSession.lastInstance!.restoreImpl = async () => {
      FakeSession.lastInstance!.isActive = true;
      FakeSession.lastInstance!.webId = 'https://alice.example/profile#me';
    };

    const pending = rf.webId.catch((e: unknown) => e);

    // Single microtask is enough — prompt runs in the synchronous slow
    // path, then window.open. Anything that introduces an await between
    // the two would show up as `stub.calls.length === 0` here.
    expect(promptFn).toHaveBeenCalledOnce();
    expect(stub.calls).toHaveLength(1);

    // The recorded tick of the window.open call must be the post-prompt
    // value (1). If a microtask boundary slipped in, the tick would
    // remain 0 (the bump in promptFn would be re-read after a turn).
    expect(stub.calls[0]!.tick).toBe(1);

    await completeLoginPopup(popup);
    await pending;
  });

  test('default `window.prompt` is used when no override is provided', async () => {
    // jsdom returns `undefined` from window.prompt; the factory normalises
    // that to `null` (cancel). Spy on window.prompt to confirm it's the
    // path that runs when `options.prompt` is omitted.
    const spy = vi.spyOn(window, 'prompt').mockReturnValue(null);

    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
    });

    await expect(rf.webId).rejects.toMatchObject({ code: 'webid_prompt_cancelled' });
    expect(spy).toHaveBeenCalledOnce();
  });

  test('custom promptMessage is forwarded to window.prompt', async () => {
    const promptFn = vi.fn(() => null);
    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      promptMessage: 'Sign in with your WebID',
      prompt: promptFn,
    });

    await expect(rf.webId).rejects.toThrow();
    expect(promptFn).toHaveBeenCalledWith('Sign in with your WebID');
  });
});

describe('createReactiveFetchPrompt: cancel path', () => {
  test('prompt returns null → rejects with WebIdPromptCancelledError, no popup', async () => {
    const { WebIdPromptCancelledError, ReactiveFetchError } = await import(
      '@jeswr/solid-reactive-fetch-shared'
    );

    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      prompt: () => null,
    });

    const err = await rf.webId.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WebIdPromptCancelledError);
    expect(err).toBeInstanceOf(ReactiveFetchError);
    expect((err as { code: string }).code).toBe('webid_prompt_cancelled');
    expect(stub.calls).toHaveLength(0);
  });

  test('rejecting via fetch (401) cancel path does NOT open a popup', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(null, { status: 401 }),
    );

    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      prompt: () => null,
    });

    await expect(rf.fetch('https://pod.example/doc')).rejects.toMatchObject({
      code: 'webid_prompt_cancelled',
    });
    expect(stub.calls).toHaveLength(0);
  });
});

describe('createReactiveFetchPrompt: invalid URL path', () => {
  // Each invalid input rejects synchronously with InvalidWebIdError and
  // never opens a popup. Empty / whitespace-only / disallowed-scheme /
  // off-allow-list http all hit the same validation gate.
  const HOSTILE_INPUTS: ReadonlyArray<readonly [string, string]> = [
    ['javascript:alert(1)', 'javascript: scheme'],
    ['data:text/html,<script>alert(1)</script>', 'data: scheme'],
    ['file:///etc/passwd', 'file: scheme'],
    ['blob:https://x/foo', 'blob: scheme'],
    ['ftp://x/profile', 'ftp: scheme'],
    ['not a url', 'unparseable'],
    ['http://evil.example/profile', 'plain http (allowLocalhost off)'],
    ['', 'empty string'],
    ['   ', 'whitespace-only'],
  ];

  for (const [input, label] of HOSTILE_INPUTS) {
    test(`${label}: rejects with InvalidWebIdError, no popup opened`, async () => {
      const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
      const rf = createReactiveFetchPrompt({
        clientId: 'https://app.example/id',
        callbackUrl: '/callback',
        prompt: () => input,
      });

      const err = await rf.webId.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidWebIdError);
      expect((err as { raw: string }).raw).toBe(input);
      expect(stub.calls).toHaveLength(0);
    });
  }

  test('http://localhost rejected when allowLocalhost is not set', async () => {
    const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      prompt: () => 'http://localhost:3000/profile#me',
    });
    const err = await rf.webId.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidWebIdError);
    expect(stub.calls).toHaveLength(0);
  });
});

describe('createReactiveFetchPrompt: happy path & URL encoding', () => {
  test('valid https WebID → popup URL has ?webId=<percent-encoded WebID>', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    // After login completes, the factory rebuilds the Session via
    // `rebuildSessionBootstrap` (sidesteps stale internal restore state in
    // the upstream uvdsl client). Gate the active-flipping restore on the
    // rebuild — the construction-time restore must stay inert so the
    // initial `restorePromise` doesn't make `ensureLoggedIn` short-circuit
    // and skip the popup we're testing.
    let isRebuild = false;
    FakeSession.onConstruct = (s) => {
      if (!isRebuild) return;
      s.restoreImpl = async () => {
        s.isActive = true;
        s.webId = 'https://alice.example/profile#me';
      };
    };
    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: 'https://app.example/callback',
      prompt: () => 'https://alice.example/profile#me',
    });
    isRebuild = true;

    const pending = rf.webId;
    await completeLoginPopup(popup);
    await expect(pending).resolves.toBe('https://alice.example/profile#me');

    expect(stub.calls).toHaveLength(1);
    const opened = String(stub.calls[0]!.url);
    // The URL constructor encodes `#` as `%23` in query parameter values
    // (URLSearchParams.set), so the fragment delimiter survives round
    // trip into the popup as a literal token.
    expect(opened).toContain(
      '?webId=https%3A%2F%2Falice.example%2Fprofile%23me',
    );
  });

  test('relative callbackUrl resolves against window.location', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    let isRebuild = false;
    FakeSession.onConstruct = (s) => {
      if (!isRebuild) return;
      s.restoreImpl = async () => {
        s.isActive = true;
        s.webId = 'https://alice.example/profile#me';
      };
    };
    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      prompt: () => 'https://alice.example/profile#me',
    });
    isRebuild = true;

    const pending = rf.webId;
    await completeLoginPopup(popup);
    await pending;

    const opened = new URL(String(stub.calls[0]!.url));
    expect(opened.pathname).toBe('/callback');
    expect(opened.searchParams.get('webId')).toBe(
      'https://alice.example/profile#me',
    );
  });

  test('callbackUrl with existing query params: webId merges in', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    let isRebuild = false;
    FakeSession.onConstruct = (s) => {
      if (!isRebuild) return;
      s.restoreImpl = async () => {
        s.isActive = true;
        s.webId = 'https://alice.example/profile#me';
      };
    };
    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: 'https://app.example/callback?source=app',
      prompt: () => 'https://alice.example/profile#me',
    });
    isRebuild = true;

    const pending = rf.webId;
    await completeLoginPopup(popup);
    await pending;

    const url = new URL(String(stub.calls[0]!.url));
    expect(url.searchParams.get('source')).toBe('app');
    expect(url.searchParams.get('webId')).toBe(
      'https://alice.example/profile#me',
    );
  });
});

describe('createReactiveFetchPrompt: allowLocalhost', () => {
  const LOCALHOST_FORMS = [
    'http://localhost:3000/profile#me',
    'http://127.0.0.1/profile',
    'http://[::1]/profile',
  ];

  for (const url of LOCALHOST_FORMS) {
    test(`allowLocalhost: true accepts ${url}`, async () => {
      const popup = createMockPopup();
      stub.nextPopup(popup);

      let isRebuild = false;
      FakeSession.onConstruct = (s) => {
        if (!isRebuild) return;
        s.restoreImpl = async () => {
          s.isActive = true;
          s.webId = url;
        };
      };
      const rf = createReactiveFetchPrompt({
        clientId: 'https://app.example/id',
        callbackUrl: 'https://app.example/callback',
        allowLocalhost: true,
        prompt: () => url,
      });
      isRebuild = true;

      const pending = rf.webId;
      await completeLoginPopup(popup);
      await expect(pending).resolves.toBe(url);
      expect(stub.calls).toHaveLength(1);
    });

    test(`allowLocalhost: false rejects ${url}`, async () => {
      const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
      const rf = createReactiveFetchPrompt({
        clientId: 'https://app.example/id',
        callbackUrl: 'https://app.example/callback',
        allowLocalhost: false,
        prompt: () => url,
      });
      const err = await rf.webId.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidWebIdError);
      expect(stub.calls).toHaveLength(0);
    });
  }
});

describe('createReactiveFetchPrompt: concurrent reads (single-flight)', () => {
  test('two concurrent webId reads call window.prompt only once', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const promptFn = vi.fn(() => 'https://alice.example/profile#me');

    let isRebuild = false;
    FakeSession.onConstruct = (s) => {
      if (!isRebuild) return;
      s.restoreImpl = async () => {
        s.isActive = true;
        s.webId = 'https://alice.example/profile#me';
      };
    };
    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      prompt: promptFn,
    });
    isRebuild = true;

    const p1 = rf.webId;
    const p2 = rf.webId;
    expect(p2).toBe(p1);

    await completeLoginPopup(popup);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe('https://alice.example/profile#me');
    expect(r2).toBe('https://alice.example/profile#me');
    expect(promptFn).toHaveBeenCalledOnce();
    expect(stub.calls).toHaveLength(1);
  });

  test('three concurrent reads share one popup', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);
    const promptFn = vi.fn(() => 'https://alice.example/profile#me');

    let isRebuild = false;
    FakeSession.onConstruct = (s) => {
      if (!isRebuild) return;
      s.restoreImpl = async () => {
        s.isActive = true;
        s.webId = 'https://alice.example/profile#me';
      };
    };
    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      prompt: promptFn,
    });
    isRebuild = true;

    const p1 = rf.webId;
    const p2 = rf.webId;
    const p3 = rf.webId;
    await completeLoginPopup(popup);
    await Promise.all([p1, p2, p3]);

    expect(promptFn).toHaveBeenCalledOnce();
    expect(stub.calls).toHaveLength(1);
  });
});

describe('createReactiveFetchPrompt: solid.login imperative path', () => {
  test('solid.login(webId) skips window.prompt entirely', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const promptFn = vi.fn(() => 'should-never-be-called');
    let isRebuild = false;
    FakeSession.onConstruct = (s) => {
      if (!isRebuild) return;
      s.restoreImpl = async () => {
        s.isActive = true;
        s.webId = 'https://alice.example/profile#me';
      };
    };
    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      prompt: promptFn,
    });
    isRebuild = true;

    const pending = rf.solid.login('https://alice.example/profile#me');
    await completeLoginPopup(popup);
    await expect(pending).resolves.toBeUndefined();

    expect(promptFn).not.toHaveBeenCalled();
    expect(stub.calls).toHaveLength(1);
    // The popup URL still carries the validated webId so the callback
    // page short-circuits straight to discovery.
    const opened = new URL(String(stub.calls[0]!.url), window.location.href);
    expect(opened.searchParams.get('webId')).toBe(
      'https://alice.example/profile#me',
    );
  });

  test('solid.login(javascript:…) rejects with InvalidWebIdError, no popup', async () => {
    const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
    const promptFn = vi.fn(() => null);

    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      prompt: promptFn,
    });

    const err = await rf.solid
      .login('javascript:alert(1)')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidWebIdError);
    expect(promptFn).not.toHaveBeenCalled();
    expect(stub.calls).toHaveLength(0);
  });

  test('solid.login(empty string) rejects with InvalidWebIdError', async () => {
    const { InvalidWebIdError } = await import('@jeswr/solid-reactive-fetch-shared');
    const rf = createReactiveFetchPrompt({
      clientId: 'https://app.example/id',
      callbackUrl: '/callback',
      prompt: () => null,
    });

    const err = await rf.solid.login('').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidWebIdError);
    expect(stub.calls).toHaveLength(0);
  });
});

type FakeSession = InstanceType<typeof FakeSession>;
