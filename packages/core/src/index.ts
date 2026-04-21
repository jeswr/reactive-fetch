import { createSessionBootstrap, ensureRestored, authFetch } from './session.js';
import { openLoginPopup } from './popup.js';

export * from './errors.js';

export interface ReactiveFetchOptions {
  clientId: string;
  callbackUrl: string;
}

export interface ReactiveFetch {
  readonly webId: Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export function createReactiveFetch(options: ReactiveFetchOptions): ReactiveFetch {
  const { clientId, callbackUrl } = options;
  const { session } = createSessionBootstrap(clientId);

  let loginPromise: Promise<string> | null = null;

  const ensureLoggedIn = (): Promise<string> => {
    if (session.isActive && session.webId) return Promise.resolve(session.webId);
    if (loginPromise) return loginPromise;

    const pending: Promise<string> = (async () => {
      try {
        await openLoginPopup({ callbackUrl });
        await ensureRestored(session);
        if (!session.isActive || !session.webId) {
          throw new Error('Session did not become active after login.');
        }
        return session.webId;
      } finally {
        loginPromise = null;
      }
    })();

    loginPromise = pending;
    return pending;
  };

  const rf: ReactiveFetch = {
    get webId() {
      return ensureLoggedIn();
    },
    async fetch(input, init) {
      if (session.isActive) {
        return authFetch(session, input, init);
      }

      const { request, retry } = prepareRetryable(input, init);
      const response = await globalThis.fetch(request);
      if (response.status !== 401) return response;

      await ensureLoggedIn();
      return authFetch(session, retry.input, retry.init);
    },
  };

  return rf;
}

interface Retryable {
  request: Request;
  retry: { input: RequestInfo | URL; init?: RequestInit };
}

function prepareRetryable(input: RequestInfo | URL, init?: RequestInit): Retryable {
  if (input instanceof Request) {
    const first = input.clone();
    const second = input.clone();
    return {
      request: first,
      retry: { input: second, init },
    };
  }

  if (init?.body && isConsumableBody(init.body)) {
    const request = new Request(input, init);
    return {
      request: request.clone(),
      retry: { input: request.clone() },
    };
  }

  return {
    request: new Request(input, init),
    retry: { input, init },
  };
}

function isConsumableBody(body: BodyInit): boolean {
  return (
    body instanceof ReadableStream ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}
