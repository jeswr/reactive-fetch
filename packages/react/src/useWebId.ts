import type { ReactiveFetch } from '@jeswr/solid-reactive-fetch';
import { useReactiveFetch } from './context.js';

type ResourceState =
  | { status: 'pending'; promise: Promise<string> }
  | { status: 'resolved'; value: string }
  | { status: 'rejected'; error: unknown };

const cache = new WeakMap<ReactiveFetch, ResourceState>();

// On the server there's no DOM and reading rf.webId would call window.open
// inside the core popup orchestrator. Suspend indefinitely so the surrounding
// <Suspense fallback={…}> renders on the server, and let the client pass
// pick up the real Promise on hydration.
const SSR_PENDING: Promise<string> = new Promise(() => { /* never resolves */ });

function readWebId(rf: ReactiveFetch): string {
  if (typeof window === 'undefined') throw SSR_PENDING;

  const existing = cache.get(rf);
  if (existing) {
    if (existing.status === 'resolved') return existing.value;
    if (existing.status === 'rejected') throw existing.error;
    throw existing.promise;
  }

  const promise = Promise.resolve(rf.webId).then(
    (value) => {
      cache.set(rf, { status: 'resolved', value });
      return value;
    },
    (error: unknown) => {
      cache.set(rf, { status: 'rejected', error });
      throw error;
    },
  );
  cache.set(rf, { status: 'pending', promise });
  throw promise;
}

export function useWebId(): string {
  const rf = useReactiveFetch();
  return readWebId(rf);
}
