/**
 * Test helpers for simulating a popup window opened via `window.open`.
 * Mirrors `packages/core/test/helpers/mockPopup.ts` so both packages share
 * the same harness shape — copied rather than imported because each
 * package owns its own test/ directory and we don't want to introduce a
 * cross-package test-helpers dependency.
 */

export interface MockPopupOptions {
  defaultOrigin?: string;
  opener?: Window;
}

export interface MockPopup {
  readonly window: MockPopupWindow;
  postMessageToOpener(data: unknown, origin?: string): void;
  postMessageToOpenerAsync(data: unknown, origin?: string, delay?: number): Promise<void>;
  simulateUserClose(): void;
  readonly closed: boolean;
  readonly closeCallCount: number;
}

export interface MockPopupWindow {
  readonly closed: boolean;
  close(): void;
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
