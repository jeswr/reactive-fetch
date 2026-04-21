import { PopupBlockedError, PopupClosedError, PopupTimeoutError } from './errors.js';

export const LOGIN_COMPLETE_MESSAGE_TYPE = 'reactive-fetch:login-complete';

export interface OpenLoginPopupOptions {
  callbackUrl: string;
  features?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

let pending: Promise<void> | null = null;
let activeAbort: (() => void) | null = null;

const DEFAULT_FEATURES = 'popup=yes,width=520,height=640';
const DEFAULT_POLL_INTERVAL_MS = 500;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function openLoginPopup(options: OpenLoginPopupOptions): Promise<void> {
  if (pending) return pending;

  const features = options.features ?? DEFAULT_FEATURES;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const popup = window.open(options.callbackUrl, 'reactive-fetch-login', features);
  if (!popup) {
    return Promise.reject(new PopupBlockedError());
  }

  const expectedOrigin = window.location.origin;

  const promise = new Promise<void>((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      if (pollTimer !== undefined) clearInterval(pollTimer);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      if (pending === promise) {
        pending = null;
        activeAbort = null;
      }
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

    if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
      timeoutTimer = setTimeout(() => {
        try { popup.close(); } catch { /* popup already closed */ }
        settleReject(new PopupTimeoutError(timeoutMs));
      }, timeoutMs);
    }

    activeAbort = () => settleReject(new PopupClosedError());
  });

  pending = promise;
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
