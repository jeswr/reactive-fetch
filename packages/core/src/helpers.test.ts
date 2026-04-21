import { afterEach, expect, test } from 'vitest';
import { createMockPopup } from '../test/helpers/mockPopup.js';
import { installMockWindowOpen } from '../test/helpers/mockWindowOpen.js';

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

test('mockPopup: postMessageToOpener dispatches synchronously', () => {
  const popup = createMockPopup();
  const received: MessageEvent[] = [];
  const listener = (event: MessageEvent) => received.push(event);
  window.addEventListener('message', listener);
  try {
    popup.postMessageToOpener({ kind: 'hello' });
    expect(received).toHaveLength(1);
    expect(received[0]!.data).toEqual({ kind: 'hello' });
    expect(received[0]!.origin).toBe(window.location.origin);
    expect(received[0]!.source).toBe(popup.window as unknown as MessageEventSource);
  } finally {
    window.removeEventListener('message', listener);
  }
});

test('mockPopup: postMessageToOpenerAsync dispatches after delay', async () => {
  const popup = createMockPopup();
  const received: MessageEvent[] = [];
  const listener = (event: MessageEvent) => received.push(event);
  window.addEventListener('message', listener);
  try {
    const pending = popup.postMessageToOpenerAsync({ ok: true }, 'https://example.test', 5);
    expect(received).toHaveLength(0);
    await pending;
    expect(received).toHaveLength(1);
    expect(received[0]!.origin).toBe('https://example.test');
  } finally {
    window.removeEventListener('message', listener);
  }
});

test('mockPopup: close() flips closed and counts calls', () => {
  const popup = createMockPopup();
  expect(popup.closed).toBe(false);
  popup.window.close();
  popup.window.close();
  expect(popup.closed).toBe(true);
  expect(popup.closeCallCount).toBe(2);
});

test('mockPopup: simulateUserClose flips closed without calling close()', () => {
  const popup = createMockPopup();
  popup.simulateUserClose();
  expect(popup.closed).toBe(true);
  expect(popup.closeCallCount).toBe(0);
});

test('mockPopup: postMessage on the popup window records received messages', () => {
  const popup = createMockPopup();
  popup.window.postMessage({ ping: 1 }, 'https://idp.test');
  expect(popup.window.receivedMessages).toEqual([
    { data: { ping: 1 }, targetOrigin: 'https://idp.test' },
  ]);
});

test('mockWindowOpen: returns enqueued popup and tracks call args', () => {
  const popup = createMockPopup();
  const stub = installMockWindowOpen();
  cleanup = () => stub.restore();
  stub.nextPopup(popup);

  const handle = window.open('https://idp.test/auth', 'solid-login', 'popup=1,width=480');
  expect(handle).toBe(popup.window);
  expect(stub.calls).toEqual([
    { url: 'https://idp.test/auth', target: 'solid-login', features: 'popup=1,width=480' },
  ]);
});

test('mockWindowOpen: returns null when nothing is enqueued (popup blocked)', () => {
  const stub = installMockWindowOpen();
  cleanup = () => stub.restore();
  expect(window.open('https://idp.test/auth')).toBeNull();
});

test('mockWindowOpen: nextBlocked simulates an explicit block', () => {
  const popup = createMockPopup();
  const stub = installMockWindowOpen();
  cleanup = () => stub.restore();
  stub.nextBlocked();
  stub.nextPopup(popup);
  expect(window.open('about:blank')).toBeNull();
  expect(window.open('about:blank')).toBe(popup.window);
});

test('mockWindowOpen: restore puts the original window.open back', () => {
  const original = window.open;
  const stub = installMockWindowOpen();
  expect(window.open).not.toBe(original);
  stub.restore();
  expect(window.open).toBe(original);
});
