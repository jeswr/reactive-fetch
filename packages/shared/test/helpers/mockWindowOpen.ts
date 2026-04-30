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
 *
 * Tick provider: tests can install an ordering counter via
 * `setTickProvider(fn)`. Each `window.open` call records the counter's
 * value at call time onto its `WindowOpenCall.tick` field. The
 * prompt-flavoured factory uses this to assert there's no microtask
 * boundary between `window.prompt` and `window.open` (which would
 * forfeit the user-gesture credit). Default provider returns `-1` so
 * tests that don't need ordering see a sentinel rather than NaN.
 */

import type { MockPopup } from './mockPopup.js';

export interface WindowOpenCall {
  url: string | URL | undefined;
  target: string | undefined;
  features: string | undefined;
  /**
   * Snapshot of the test-provided tick counter at the time
   * `window.open` was called. `-1` if no provider was installed.
   */
  tick: number;
}

export interface MockWindowOpenStub {
  /** Enqueue a popup to be returned by the next `window.open` call. */
  nextPopup(popup: MockPopup): void;
  /** Force the next `window.open` call to return `null` (popup blocked). */
  nextBlocked(): void;
  /** Calls that have been made to `window.open`, in order. */
  readonly calls: ReadonlyArray<WindowOpenCall>;
  /**
   * Install a tick provider — the returned value is captured on each
   * `WindowOpenCall.tick`. Used to assert call ordering relative to
   * other observable side effects (e.g. `window.prompt`).
   */
  setTickProvider(fn: () => number): void;
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
  let tickProvider: () => number = () => -1;

  target.open = function mockOpen(
    url?: string | URL,
    windowName?: string,
    windowFeatures?: string,
  ): Window | null {
    calls.push({
      url,
      target: windowName,
      features: windowFeatures,
      tick: tickProvider(),
    });
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
    setTickProvider(fn) {
      tickProvider = fn;
    },
    restore() {
      target.open = originalOpen;
    },
  };
}
