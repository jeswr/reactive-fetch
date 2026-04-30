/**
 * Stubs `window.open` for the prompt-flavoured tests. Mirrors the core
 * package's helper of the same name. We additionally record the call
 * order versus an external "tick counter" — the prompt-flavoured factory
 * MUST call `window.prompt` and `window.open` synchronously back-to-back
 * inside the user-gesture stack frame, with no microtask boundary in
 * between. Test code can read the recorded ordering to assert that.
 */

import type { MockPopup } from './mockPopup.js';

export interface WindowOpenCall {
  url: string | URL | undefined;
  target: string | undefined;
  features: string | undefined;
  /**
   * Monotonic counter snapshot at the time `window.open` was called.
   * Test code passes a shared counter (incremented around `window.prompt`,
   * before any awaits) and asserts the ordering invariants.
   */
  tick: number;
}

export interface MockWindowOpenStub {
  nextPopup(popup: MockPopup): void;
  nextBlocked(): void;
  readonly calls: ReadonlyArray<WindowOpenCall>;
  setTickProvider(fn: () => number): void;
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
