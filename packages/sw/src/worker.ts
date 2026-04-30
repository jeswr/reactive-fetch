// =====================================================================
// @jeswr/solid-reactive-fetch-sw — service-worker bundle
//
// Built as a self-contained ESM module via tsup. The consumer drops
// `dist/worker.js` into their public directory under whatever name
// matches the `swUrl` they pass to `registerReactiveFetchSW`.
//
// What this worker does:
//
//   1. install -> skipWaiting; activate -> clients.claim. Take over
//      the page on first activation.
//   2. message -> handshake from the page provides clientId + login
//      timeout. We can't authenticate anything before the handshake
//      lands.
//   3. fetch -> if the request URL matches the page-side filter, try
//      to authenticate via the shared `SessionCore` restored from
//      IndexedDB (same DPoP keypair store the page uses). If
//      `restore()` fails or returns 401, broadcast a
//      `login-required` message to all clients and await the page's
//      `login-complete`. Re-restore, retry once, return.
//   4. Single-flight: concurrent 401s share one pending login. The
//      requestId map holds the per-fetch resolvers.
//
// IDB-realm portability:
//
// The underlying `@uvdsl/solid-oidc-client-browser` core build keeps
// its non-extractable DPoP keypair in IndexedDB at `(soidc, session)`.
// CryptoKey objects are structured-cloneable, and IDB is a per-origin
// store shared across realms (page + SW), so the SW reads the same
// keypair the page wrote. The library's only realm-bound assumption is
// `window.crypto.randomUUID()` — see the shim at the top of this file
// which aliases `globalThis.window` to the worker scope so those calls
// resolve transparently. (`crypto.randomUUID` exists on
// `WorkerGlobalScope` and on `Window`, so the shim is a no-op besides
// the alias.)
// =====================================================================

// `window` shim: the upstream library calls `window.crypto.randomUUID()`
// to generate JTI / state / PKCE-verifier UUIDs. In a service-worker
// realm `window` is undefined but `crypto.randomUUID()` is available on
// the worker global. Aliasing `globalThis.window` to the worker scope
// makes those calls resolve. We do NOT install any other DOM globals.
// MUST run before any imports from the upstream library or the
// shared package.
//
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional global aug
(globalThis as any).window = (globalThis as any).window ?? globalThis;

import { SessionCore, SessionEvents } from '@uvdsl/solid-oidc-client-browser/core';
import type { SessionDatabase } from '@uvdsl/solid-oidc-client-browser/core';
// SW wire-protocol imports come from shared's bare-root barrel (the
// non-colliding names — see comment in shared/src/index.ts). The worker
// is fully bundled, so this is a build-tree consideration rather than a
// publish-tree one, but using a single import surface across page and
// worker keeps the contract obvious.
import {
  isLoginCompleteMessage,
  isLoginFailedMessage,
  isRegisterHandshakeMessage,
  LOGIN_REQUIRED_MESSAGE_TYPE,
  REGISTER_ACK_MESSAGE_TYPE,
  type LoginRequiredMessage,
  type RegisterAckMessage,
} from '@jeswr/solid-reactive-fetch-shared';

// Mark unused-but-imported for clarity / documentation parity with the
// upstream library.
void SessionEvents;

declare const self: ServiceWorkerGlobalScope;

// ----- worker-side IndexedDB adapter ---------------------------------
// `@uvdsl/solid-oidc-client-browser/web` ships an `SessionIDB` class
// hard-coded to the database name "soidc" / store "session". We can't
// import that one (it lives in the `web` build, which pulls in
// `window.addEventListener('beforeunload', …)`), so we re-implement
// the same shape here against the same DB / store names. Otherwise the
// SW would read from a different IDB and never see the page's session.
//
// MUST stay in sync with `dist/esm/web/index.js`'s `SessionIDB` defaults
// (`dbName: 'soidc'`, `storeName: 'session'`, `dbVersion: 1`).
class WorkerSessionDatabase implements SessionDatabase {
  private db: IDBDatabase | null = null;

  constructor(
    private readonly dbName = 'soidc',
    private readonly storeName = 'session',
    private readonly dbVersion = 1,
  ) {}

  init(): Promise<SessionDatabase> {
    if (this.db) return Promise.resolve(this);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this);
      };
      request.onerror = () =>
        reject(request.error ?? new Error('IndexedDB open failed.'));
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
    });
  }

  setItem(id: string, value: unknown): Promise<void> {
    return this.transact('readwrite', (store) => store.put(value, id)).then(() => undefined);
  }

  getItem(id: string): Promise<unknown> {
    return this.transact('readonly', (store) => store.get(id));
  }

  deleteItem(id: string): Promise<void> {
    return this.transact('readwrite', (store) => store.delete(id)).then(() => undefined);
  }

  clear(): Promise<void> {
    return this.transact('readwrite', (store) => store.clear()).then(() => undefined);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private async transact<T>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    if (!this.db) {
      await this.init();
    }
    const db = this.db;
    if (!db) throw new Error('IndexedDB not initialised.');
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode);
      const store = tx.objectStore(this.storeName);
      const req = op(store);
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB transaction failed.'));
    });
  }
}

// ----- module-level state --------------------------------------------

interface WorkerConfig {
  clientId: string;
  loginTimeoutMs: number;
}

let config: WorkerConfig | null = null;
let session: SessionCore | null = null;
let database: WorkerSessionDatabase | null = null;

// Concurrent fetches requiring auth each register a per-requestId
// resolver here; the page replies to each individually. Single-flight
// of the actual login is enforced page-side in `registerReactiveFetchSW`
// (one popup at a time), so we don't need a worker-side gate.
const requestIdResolvers = new Map<
  string,
  { resolve: () => void; reject: (err: Error) => void; timeoutId: ReturnType<typeof setTimeout> }
>();

// ----- lifecycle -----------------------------------------------------

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

// ----- page -> SW messages -------------------------------------------

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (!isSameOriginClient(event.source)) {
    debugWarn('Rejected message from non-Client source', event.source);
    return;
  }
  const data = event.data as unknown;

  if (isRegisterHandshakeMessage(data)) {
    config = { clientId: data.clientId, loginTimeoutMs: data.loginTimeoutMs };
    // Reset session so the next fetch builds it under the (possibly
    // new) clientId. Close the prior IDB handle before dropping it so
    // we don't leak a transaction across handshake re-issues.
    session = null;
    if (database) {
      database.close();
    }
    database = null;
    const ack: RegisterAckMessage = {
      type: REGISTER_ACK_MESSAGE_TYPE,
      clientId: data.clientId,
    };
    if (event.source && 'postMessage' in event.source) {
      (event.source as Client).postMessage(ack);
    }
    return;
  }

  if (isLoginCompleteMessage(data)) {
    const entry = requestIdResolvers.get(data.requestId);
    if (!entry) return;
    clearTimeout(entry.timeoutId);
    requestIdResolvers.delete(data.requestId);
    entry.resolve();
    return;
  }

  if (isLoginFailedMessage(data)) {
    const entry = requestIdResolvers.get(data.requestId);
    if (!entry) return;
    clearTimeout(entry.timeoutId);
    requestIdResolvers.delete(data.requestId);
    entry.reject(new Error(`Login failed: ${data.reason}`));
    return;
  }
});

// ----- fetch interception --------------------------------------------

self.addEventListener('fetch', (event: FetchEvent) => {
  const request = event.request;

  // We only intercept GET-style cacheable+retryable requests + JSON/
  // RDF mutations. The match decision belongs to the page; here we
  // just check whether the page has registered (config) AND whether
  // the URL parses. Anything not configured falls through to the
  // browser's default fetch.
  if (!config) {
    return; // not yet configured; let the browser handle it.
  }

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Skip same-origin requests to assets we ourselves serve. The page
  // controls this via the `match` predicate it installed at register
  // time, but we also have a default exclusion: same-origin GETs to
  // typical static-asset extensions never get the auth treatment.
  // (Pod URLs are remote; the default is fine.)
  if (url.origin === self.location.origin) {
    // Worker doesn't know the page-side `match` because we can't
    // serialise functions across postMessage. By convention, a same-
    // origin request never needs Solid auth in the SW variant — if
    // you DO need it (e.g. a same-origin pod), use the popup or
    // prompt package instead, or wrap fetches manually. Letting
    // them through avoids breaking the app shell loading the SW
    // bundle.
    return;
  }

  event.respondWith(handleAuthFetch(request));
});

async function handleAuthFetch(request: Request): Promise<Response> {
  // The fetch listener guarantees `config` is non-null before calling
  // `respondWith`, so we narrow with `!` here.
  const cfg = config!;
  const sess = await ensureSession(cfg.clientId);

  // Try restoring once: the page may have an active session in IDB
  // already. Rebuild the request once because Body streams are
  // single-consumption.
  const firstAttempt = await tryAuthFetch(sess, request.clone());
  if (firstAttempt && firstAttempt.status !== 401) {
    return firstAttempt;
  }

  // Either no active session, or restore returned but the call still
  // 401'd. Trigger a login (single-flight) and retry once.
  try {
    await requestLoginFromClients(request.url, cfg.loginTimeoutMs);
  } catch (err) {
    // Login was refused, timed out, or no client was listening.
    if (err instanceof NoPageListenerError) {
      return synthesise401(firstAttempt, 'no-page-listener');
    }
    if (err instanceof LoginTimeoutError) {
      return synthesise401(firstAttempt, 'login-timeout');
    }
    return synthesise401(firstAttempt, 'login-failed');
  }

  // Re-restore so the freshly-written tokens land on `sess`.
  try {
    await sess.restore();
  } catch (err) {
    return synthesise401(firstAttempt, 'restore-failed', errorMessage(err));
  }

  if (!sess.isActive) {
    return synthesise401(firstAttempt, 'restore-inactive');
  }

  try {
    return await sess.authFetch(request);
  } catch (err) {
    return synthesise401(firstAttempt, 'authfetch-failed', errorMessage(err));
  }
}

async function tryAuthFetch(sess: SessionCore, request: Request): Promise<Response | null> {
  if (!sess.isActive) {
    // Try to restore (cheap if already not-restorable).
    try {
      await sess.restore();
    } catch {
      // No session in IDB or refresh failed; fall through to login.
      return null;
    }
    if (!sess.isActive) return null;
  }
  try {
    return await sess.authFetch(request);
  } catch {
    return null;
  }
}

async function ensureSession(clientId: string): Promise<SessionCore> {
  if (session) return session;
  database = new WorkerSessionDatabase();
  session = new SessionCore({ client_id: clientId } as never, { database });
  return session;
}

class NoPageListenerError extends Error {
  constructor() {
    super('No page listener available to drive login.');
    this.name = 'NoPageListenerError';
  }
}
class LoginTimeoutError extends Error {
  constructor() {
    super('Page-side login driver did not complete in time.');
    this.name = 'LoginTimeoutError';
  }
}

async function requestLoginFromClients(
  url: string,
  timeoutMs: number,
): Promise<void> {
  // Each fetch registers its own requestId; the page-side
  // `registerReactiveFetchSW` enforces single-flight of the actual
  // login popup, so we don't dedupe broadcasts here.
  return registerForNextLogin(url, timeoutMs);
}

async function registerForNextLogin(url: string, timeoutMs: number): Promise<void> {
  const requestId = generateRequestId();
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  if (clients.length === 0) {
    throw new NoPageListenerError();
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      requestIdResolvers.delete(requestId);
      reject(new LoginTimeoutError());
    }, timeoutMs);

    requestIdResolvers.set(requestId, {
      resolve: () => {
        clearTimeout(timeoutId);
        resolve();
      },
      reject: (err: Error) => {
        clearTimeout(timeoutId);
        reject(err);
      },
      timeoutId,
    });

    const message: LoginRequiredMessage = {
      type: LOGIN_REQUIRED_MESSAGE_TYPE,
      requestId,
      url,
    };
    for (const client of clients) {
      client.postMessage(message);
    }
  });
}

function synthesise401(
  original: Response | null,
  reason: string,
  detail?: string,
): Response {
  const headers = new Headers();
  headers.set('X-Reactive-Fetch-SW', reason);
  if (detail) headers.set('X-Reactive-Fetch-SW-Detail', detail);
  if (original && original.status === 401) {
    // Preserve the original 401 body so apps that rely on the IDP /
    // resource server's WWW-Authenticate hint still get it.
    const body = original.clone().body;
    return new Response(body, {
      status: 401,
      statusText: original.statusText,
      headers: mergeHeaders(original.headers, headers),
    });
  }
  return new Response(null, { status: 401, statusText: 'Unauthorized', headers });
}

function mergeHeaders(base: Headers, overlay: Headers): Headers {
  const result = new Headers(base);
  overlay.forEach((value, key) => {
    result.set(key, value);
  });
  return result;
}

function generateRequestId(): string {
  // `crypto.randomUUID()` is on the worker global; no `window` shim
  // needed for THIS specific call (only the upstream library uses
  // `window.crypto.randomUUID()`).
  return crypto.randomUUID();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Verifies a `MessageEvent.source` is a same-origin window/worker `Client`.
// Without this gate a `MessagePort`/`Worker`/cross-origin client could spoof
// `login-complete` for any outstanding `requestId` and bypass the popup, or
// spoof `register-handshake` to swap `clientId`.
function isSameOriginClient(source: ExtendableMessageEvent['source']): source is Client {
  if (!(source instanceof Client)) return false;
  try {
    return new URL(source.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

function debugWarn(...args: unknown[]): void {
  if ((globalThis as { __REACTIVE_FETCH_SW_DEBUG?: boolean }).__REACTIVE_FETCH_SW_DEBUG === true) {
    // eslint-disable-next-line no-console -- opt-in debug
    console.warn('[reactive-fetch-sw]', ...args);
  }
}
