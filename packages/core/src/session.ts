import { Session } from '@uvdsl/solid-oidc-client-browser';
import { LoginFailedError } from './errors.js';

export interface SessionBootstrap {
  readonly clientId: string;
  readonly session: Session;
}

const cache = new Map<string, SessionBootstrap>();
const restorePromises = new WeakMap<Session, Promise<void>>();

export function createSessionBootstrap(clientId: string): SessionBootstrap {
  const cached = cache.get(clientId);
  if (cached) return cached;

  const session = new Session({ client_id: clientId });
  const bootstrap: SessionBootstrap = { clientId, session };
  cache.set(clientId, bootstrap);
  return bootstrap;
}

export async function ensureRestored(session: Session): Promise<void> {
  if (session.isActive) return;

  const existing = restorePromises.get(session);
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
    return session.authFetch(input as string | URL | Request, init);
  }
  return globalThis.fetch(input, init);
}

export function __resetSessionCacheForTests(): void {
  cache.clear();
}
