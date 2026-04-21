import { PopupBlockedError, PopupClosedError } from './errors.js';

export const LOGIN_COMPLETE_MESSAGE_TYPE = 'reactive-fetch:login-complete';

export interface OpenLoginPopupOptions {
  callbackUrl: string;
  features?: string;
  pollIntervalMs?: number;
}

let pending: Promise<void> | null = null;
let activeAbort: (() => void) | null = null;

const DEFAULT_FEATURES = 'popup=yes,width=520,height=640';
const DEFAULT_POLL_INTERVAL_MS = 500;

export function openLoginPopup(options: OpenLoginPopupOptions): Promise<void> {
  if (pending) return pending;

  const features = options.features ?? DEFAULT_FEATURES;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const popup = window.open(options.callbackUrl, 'reactive-fetch-login', features);
  if (!popup) {
    return Promise.reject(new PopupBlockedError());
  }

  const expectedOrigin = window.location.origin;

  const promise = new Promise<void>((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (pollTimer !== undefined) clearInterval(pollTimer);
    };

    const settleResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try { popup.close(); } catch { /* popup already closed */ }
      resolve();
    };

    const settleReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== popup) return;
      if (event.origin !== expectedOrigin) return;
      const data = event.data as unknown;
      if (
        data &&
        typeof data === 'object' &&
        (data as { type?: unknown }).type === LOGIN_COMPLETE_MESSAGE_TYPE
      ) {
        settleResolve();
      }
    };

    window.addEventListener('message', onMessage);

    pollTimer = setInterval(() => {
      if (popup.closed) {
        settleReject(new PopupClosedError());
      }
    }, pollIntervalMs);

    activeAbort = () => settleReject(new PopupClosedError());
  });

  pending = promise;
  promise.finally(() => {
    if (pending === promise) {
      pending = null;
      activeAbort = null;
    }
  });

  return promise;
}

export function __resetPopupStateForTests(): void {
  if (activeAbort) {
    try {
      activeAbort();
    } catch {
      /* swallow — test reset should never throw */
    }
  }
  activeAbort = null;
  pending = null;
}
