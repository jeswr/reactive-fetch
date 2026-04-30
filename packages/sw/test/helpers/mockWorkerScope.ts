/**
 * Stub `self` (and the `Client` global) for the duration of a test so
 * `worker.ts` can be imported in jsdom and exercised without a real
 * service-worker realm.
 *
 * The worker code uses `declare const self: ServiceWorkerGlobalScope` and
 * accesses `self.addEventListener`, `self.skipWaiting`, `self.clients`,
 * `self.location`, plus the global `Client` constructor for instanceof
 * checks. We:
 *
 *  - Replace `globalThis.self` (which jsdom defines with a getter/setter
 *    pair returning `window`) with a fresh stub that captures listeners.
 *  - Replace `globalThis.Client` with a class so `source instanceof Client`
 *    can succeed for sources we hand it.
 *
 * IMPORTANT: install BEFORE importing `worker.ts`, because that module's
 * top-level code runs the four `self.addEventListener(...)` calls.
 *
 * Use `dispatch()` to invoke a captured handler synchronously with a fake
 * event. The fake `FetchEvent` we hand the handler exposes `request`,
 * `respondWith`, and a `responsePromise` test affordance so the assertion
 * site can `await scope.respondWithPromise` for the response the worker
 * built.
 *
 * Tear down with `scope.uninstall()` between tests.
 */

import { vi } from 'vitest';

export type WorkerEventType = 'install' | 'activate' | 'message' | 'fetch';

export interface FakeClient {
  id: string;
  url: string;
  type: 'window' | 'worker' | 'sharedworker';
  postMessage: ReturnType<typeof vi.fn>;
}

export interface FakeWorkerScope {
  /** Listeners registered by the worker's top-level code. */
  readonly listeners: Map<WorkerEventType, ((event: unknown) => void)[]>;
  /** Mock for `self.skipWaiting()`. */
  skipWaiting: ReturnType<typeof vi.fn>;
  /** Mock for `self.clients.claim()`. */
  clientsClaim: ReturnType<typeof vi.fn>;
  /** Mock that backs `self.clients.matchAll()`. Tests set `clients` to
   *  control the returned client list for a given fetch flow. */
  clients: FakeClient[];
  /** `self.location.origin` — defaults to `http://localhost`. */
  origin: string;
  /** Synchronously call the registered listener of `type` with `event`. */
  dispatch(type: WorkerEventType, event: unknown): void;
  /** Restore the prior `self` / `Client` definitions. */
  uninstall(): void;
}

class FakeClientCtor {
  constructor(public id: string, public url: string) {}
}

/**
 * Snapshot the full set of `globalThis.*` slots we mutate so `uninstall()`
 * can restore them exactly. Returns a function that puts everything back.
 */
function captureAndOverride(
  slot: PropertyKey,
  value: unknown,
): () => void {
  const desc = Object.getOwnPropertyDescriptor(globalThis, slot);
  Object.defineProperty(globalThis, slot, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (desc) {
      Object.defineProperty(globalThis, slot, desc);
    } else {
      delete (globalThis as unknown as Record<PropertyKey, unknown>)[slot as never];
    }
  };
}

export function installFakeWorkerScope(
  options: { origin?: string } = {},
): FakeWorkerScope {
  const listeners = new Map<WorkerEventType, ((event: unknown) => void)[]>();
  const origin = options.origin ?? 'http://localhost';

  const scope = {
    listeners,
    skipWaiting: vi.fn(async () => undefined),
    clientsClaim: vi.fn(async () => undefined),
    clients: [] as FakeClient[],
    origin,
  };

  const fakeSelf: Record<string, unknown> = {
    addEventListener(type: WorkerEventType, listener: (event: unknown) => void) {
      const list = listeners.get(type);
      if (list) list.push(listener);
      else listeners.set(type, [listener]);
    },
    removeEventListener(type: WorkerEventType, listener: (event: unknown) => void) {
      const list = listeners.get(type);
      if (!list) return;
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    },
    skipWaiting: () => scope.skipWaiting(),
    clients: {
      claim: () => scope.clientsClaim(),
      matchAll: async () => scope.clients,
    },
    location: { origin },
  };

  // In-memory CacheStorage stub. The worker uses `caches.open(...).put(key, response)`
  // and `caches.open(...).match(key)` for handshake-config persistence; tests
  // need a working facade so the put/match round-trip behaves like a real
  // cache. Keys are normalised to URL strings (the real Cache API does the
  // same — `Request` URLs and absolute URL strings hash to the same entry).
  const cacheStores = new Map<string, Map<string, Response>>();
  const fakeCaches = {
    async open(name: string) {
      let store = cacheStores.get(name);
      if (!store) {
        store = new Map();
        cacheStores.set(name, store);
      }
      const s = store;
      return {
        async put(key: string | Request, response: Response) {
          const url = typeof key === 'string' ? new URL(key, origin).toString() : key.url;
          // Real Cache.put consumes the body of the response, so we clone
          // before storing — matches the contract callers rely on.
          s.set(url, response.clone());
        },
        async match(key: string | Request): Promise<Response | undefined> {
          const url = typeof key === 'string' ? new URL(key, origin).toString() : key.url;
          const stored = s.get(url);
          return stored ? stored.clone() : undefined;
        },
      };
    },
  };

  const restoreSelf = captureAndOverride('self', fakeSelf);
  const restoreClient = captureAndOverride('Client', FakeClientCtor);
  const restoreCaches = captureAndOverride('caches', fakeCaches);

  return {
    listeners,
    get skipWaiting() {
      return scope.skipWaiting;
    },
    get clientsClaim() {
      return scope.clientsClaim;
    },
    get clients() {
      return scope.clients;
    },
    set clients(list: FakeClient[]) {
      scope.clients = list;
    },
    origin,
    dispatch(type: WorkerEventType, event: unknown) {
      const list = listeners.get(type);
      if (!list || list.length === 0) {
        throw new Error(`No worker listener registered for "${type}"`);
      }
      for (const fn of [...list]) fn(event);
    },
    uninstall() {
      restoreSelf();
      restoreClient();
      restoreCaches();
    },
  };
}

export function makeFakeClient(
  url = 'http://localhost/',
  id = 'client-1',
): FakeClient {
  // Build via the FakeClientCtor so `source instanceof Client` is true
  // when the worker's `isSameOriginClient` runs.
  const ClientCtor = (globalThis as unknown as { Client?: typeof FakeClientCtor })
    .Client as unknown as typeof FakeClientCtor;
  const inst = new ClientCtor(id, url) as unknown as FakeClient;
  inst.type = 'window';
  inst.postMessage = vi.fn();
  return inst;
}

export interface FakeExtendableEvent {
  waitUntil: ReturnType<typeof vi.fn>;
}

export function makeFakeExtendableEvent(): FakeExtendableEvent {
  return { waitUntil: vi.fn() };
}

export interface FakeMessageEvent {
  data: unknown;
  source: unknown;
  /**
   * Real `ExtendableMessageEvent` exposes `waitUntil`. The worker uses
   * it on the handshake to keep itself alive across async config
   * persistence; tests can read this mock to assert that persistence
   * was triggered.
   */
  waitUntil: ReturnType<typeof vi.fn>;
}

export function makeFakeMessageEvent(data: unknown, source: unknown): FakeMessageEvent {
  return { data, source, waitUntil: vi.fn() };
}

export interface FakeFetchEvent {
  request: Request;
  respondWith: ReturnType<typeof vi.fn>;
  /** Resolves with the Response (or null) the worker passed to `respondWith`. */
  responsePromise: Promise<Response | null>;
}

export function makeFakeFetchEvent(request: Request): FakeFetchEvent {
  let resolveResponse!: (r: Response | null) => void;
  const responsePromise = new Promise<Response | null>((resolve) => {
    resolveResponse = resolve;
  });
  let respondCalled = false;
  return {
    request,
    respondWith: vi.fn((p: Promise<Response>) => {
      respondCalled = true;
      Promise.resolve(p)
        .then(resolveResponse)
        .catch(() => resolveResponse(null));
    }),
    get responsePromise() {
      // If the handler returned without calling respondWith, surface that
      // as a non-null marker rather than hanging the test forever.
      queueMicrotask(() => {
        if (!respondCalled) resolveResponse(null);
      });
      return responsePromise;
    },
  };
}
