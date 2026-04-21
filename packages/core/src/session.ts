import { Session } from '@uvdsl/solid-oidc-client-browser';
import { LoginFailedError } from './errors.js';

export interface SessionBootstrap {
  readonly clientId: string;
  readonly session: Session;
}

const cache = new Map<string, SessionBootstrap>();
const restorePromises = new WeakMap<Session, Promise<void>>();

// The module-level `cache` above is per-JS-realm. In a long-lived Node
// process running SSR (Next.js/Remix/SvelteKit) this realm is shared across
// every user request, so two different users hitting the server with the
// same clientId would otherwise share one Session instance — and one
// authenticated identity. We refuse to construct at all off-browser.
function assertBrowserEnvironment(): void {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    throw new Error(
      'createReactiveFetch must run in a browser context. ' +
        'In SSR bundlers (Next.js, Remix, SvelteKit) either guard construction with ' +
        '`typeof window !== "undefined"` or dynamic-import this module inside a ' +
        'client-only code path (e.g. `"use client"` or `useEffect`).',
    );
  }
}

export function createSessionBootstrap(clientId: string): SessionBootstrap {
  assertBrowserEnvironment();

  const cached = cache.get(clientId);
  if (cached) return cached;

  const session = new Session({ client_id: clientId });
  const bootstrap: SessionBootstrap = { clientId, session };
  cache.set(clientId, bootstrap);
  return bootstrap;
}

export async function ensureRestored(session: Session, force = false): Promise<void> {
  if (!force && session.isActive) return;

  const existing = !force ? restorePromises.get(session) : undefined;
  if (existing) return existing;

  const pending = (async () => {
    try {
      await session.restore();
    } catch (cause) {
      throw new LoginFailedError('Failed to restore Solid-OIDC session.', { cause });
    }
  })();

  restorePromises.set(session, pending);
  try {
    await pending;
  } finally {
    restorePromises.delete(session);
  }
}

export function authFetch(
  session: Session,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (session.isActive) {
    return session.authFetch(input, init);
  }
  return globalThis.fetch(input, init);
}

export function __resetSessionCacheForTests(): void {
  cache.clear();
}
