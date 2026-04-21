/**
 * Stubs `window.open` so popup orchestration code can be tested without
 * jsdom actually trying to navigate or open a window.
 *
 * Usage:
 *
 *   const stub = installMockWindowOpen();
 *   stub.nextPopup(createMockPopup());     // enqueue a popup to return
 *   // ... exercise code that calls window.open ...
 *   stub.restore();                        // put the real window.open back
 *
 * If `window.open` is called and no popup has been enqueued, the stub returns
 * `null` (same signal the browser gives when the popup is blocked), which
 * lets tests exercise the popup-blocked path without extra setup.
 */

import type { MockPopup } from './mockPopup.js';

export interface WindowOpenCall {
  url: string | URL | undefined;
  target: string | undefined;
  features: string | undefined;
}

export interface MockWindowOpenStub {
  /** Enqueue a popup to be returned by the next `window.open` call. */
  nextPopup(popup: MockPopup): void;
  /** Force the next `window.open` call to return `null` (popup blocked). */
  nextBlocked(): void;
  /** Calls that have been made to `window.open`, in order. */
  readonly calls: ReadonlyArray<WindowOpenCall>;
  /** Restore the original `window.open`. */
  restore(): void;
}

type OpenQueueEntry =
  | { kind: 'popup'; popup: MockPopup }
  | { kind: 'blocked' };

export function installMockWindowOpen(target: Window = globalThis.window): MockWindowOpenStub {
  const originalOpen = target.open;
  const queue: OpenQueueEntry[] = [];
  const calls: WindowOpenCall[] = [];

  target.open = function mockOpen(
    url?: string | URL,
    windowName?: string,
    windowFeatures?: string,
  ): Window | null {
    calls.push({ url, target: windowName, features: windowFeatures });
    const next = queue.shift();
    if (!next || next.kind === 'blocked') {
      return null;
    }
    return next.popup.window as unknown as Window;
  } as Window['open'];

  return {
    nextPopup(popup) {
      queue.push({ kind: 'popup', popup });
    },
    nextBlocked() {
      queue.push({ kind: 'blocked' });
    },
    get calls() {
      return calls;
    },
    restore() {
      target.open = originalOpen;
    },
  };
}
