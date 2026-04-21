/**
 * Test helpers for simulating a popup window opened via `window.open`.
 *
 * The popup orchestration code in `src/popup.ts` interacts with the returned
 * `Window` handle via `.closed`, `.close()`, and receives notifications from
 * the popup by listening to `message` events on its own `window` (the opener).
 *
 * `createMockPopup()` returns an object that is structurally compatible with
 * the subset of `Window` we use, plus a handful of test affordances:
 *
 * - `postMessageToOpener(data, origin?)` — synthesizes a `MessageEvent` on the
 *   opener window (`globalThis.window`) as if the popup had called
 *   `window.opener.postMessage(data, origin)`. Fires synchronously.
 * - `postMessageToOpenerAsync(data, origin?, delay?)` — same, but after a
 *   microtask / setTimeout delay; useful for simulating realistic ordering.
 * - `simulateUserClose()` — marks the popup as closed without the opener
 *   calling `.close()`, so tests can exercise the "user closed the popup"
 *   path (polling `.closed`).
 */

export interface MockPopupOptions {
  /** Origin the `MessageEvent` will carry by default. Defaults to `window.location.origin`. */
  defaultOrigin?: string;
  /** Opener window to dispatch events on. Defaults to `globalThis.window`. */
  opener?: Window;
}

export interface MockPopup {
  /** Handle returned by `window.open` — the orchestrator uses this subset. */
  readonly window: MockPopupWindow;
  /** Synchronously dispatch a `message` event on the opener. */
  postMessageToOpener(data: unknown, origin?: string): void;
  /** Dispatch a `message` event on the opener after `delay` ms (default 0). */
  postMessageToOpenerAsync(data: unknown, origin?: string, delay?: number): Promise<void>;
  /** Simulate the user closing the popup (sets `closed` to true). */
  simulateUserClose(): void;
  /** True if `close()` was called or `simulateUserClose()` was invoked. */
  readonly closed: boolean;
  /** Number of times `close()` was called on the popup handle. */
  readonly closeCallCount: number;
}

export interface MockPopupWindow {
  readonly closed: boolean;
  close(): void;
  /** Messages the opener posted *into* the popup, if any. */
  readonly receivedMessages: ReadonlyArray<{ data: unknown; targetOrigin: string }>;
  postMessage(data: unknown, targetOrigin: string): void;
  focus(): void;
}

export function createMockPopup(options: MockPopupOptions = {}): MockPopup {
  const opener = options.opener ?? globalThis.window;
  const defaultOrigin = options.defaultOrigin ?? opener.location.origin;

  let closed = false;
  let closeCallCount = 0;
  const receivedMessages: Array<{ data: unknown; targetOrigin: string }> = [];

  const popupWindow: MockPopupWindow = {
    get closed() {
      return closed;
    },
    close() {
      closeCallCount += 1;
      closed = true;
    },
    get receivedMessages() {
      return receivedMessages;
    },
    postMessage(data, targetOrigin) {
      receivedMessages.push({ data, targetOrigin });
    },
    focus() {
      /* no-op */
    },
  };

  function dispatch(data: unknown, origin: string): void {
    const event = new MessageEvent('message', {
      data,
      origin,
      source: popupWindow as unknown as MessageEventSource,
    });
    opener.dispatchEvent(event);
  }

  return {
    window: popupWindow,
    postMessageToOpener(data, origin = defaultOrigin) {
      dispatch(data, origin);
    },
    async postMessageToOpenerAsync(data, origin = defaultOrigin, delay = 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      dispatch(data, origin);
    },
    simulateUserClose() {
      closed = true;
    },
    get closed() {
      return closed;
    },
    get closeCallCount() {
      return closeCallCount;
    },
  };
}
