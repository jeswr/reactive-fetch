import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  LOGIN_COMPLETE_MESSAGE_TYPE,
  __resetPopupStateForTests,
  openLoginPopup,
} from './popup.js';
import { PopupBlockedError, PopupClosedError } from './errors.js';
import { createMockPopup } from '../test/helpers/mockPopup.js';
import { installMockWindowOpen, type MockWindowOpenStub } from '../test/helpers/mockWindowOpen.js';

let stub: MockWindowOpenStub;

beforeEach(() => {
  __resetPopupStateForTests();
  stub = installMockWindowOpen();
});

afterEach(() => {
  __resetPopupStateForTests();
  stub.restore();
  vi.useRealTimers();
});

describe('openLoginPopup: success', () => {
  test('resolves when popup posts the login-complete message and closes the popup', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const pending = openLoginPopup({ callbackUrl: '/callback' });

    // Let the module attach its `message` listener before we dispatch.
    await Promise.resolve();
    popup.postMessageToOpener({ type: LOGIN_COMPLETE_MESSAGE_TYPE });

    await expect(pending).resolves.toBeUndefined();
    expect(popup.closed).toBe(true);
    expect(popup.closeCallCount).toBe(1);
    expect(stub.calls).toEqual([
      { url: '/callback', target: 'reactive-fetch-login', features: 'popup=yes,width=520,height=640' },
    ]);
  });

  test('custom features override the default window.open features string', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const pending = openLoginPopup({ callbackUrl: '/callback', features: 'popup=1,width=600' });
    await Promise.resolve();
    popup.postMessageToOpener({ type: LOGIN_COMPLETE_MESSAGE_TYPE });
    await pending;

    expect(stub.calls[0]?.features).toBe('popup=1,width=600');
  });
});

describe('openLoginPopup: failure modes', () => {
  test('rejects with PopupBlockedError when window.open returns null', async () => {
    stub.nextBlocked();
    await expect(openLoginPopup({ callbackUrl: '/callback' })).rejects.toBeInstanceOf(
      PopupBlockedError,
    );
  });

  test('popup-blocked rejection does NOT latch the single-flight guard', async () => {
    // A failed attempt must not poison the module state: a subsequent call
    // with a real popup should succeed.
    stub.nextBlocked();
    await expect(openLoginPopup({ callbackUrl: '/callback' })).rejects.toBeInstanceOf(
      PopupBlockedError,
    );

    const popup = createMockPopup();
    stub.nextPopup(popup);
    const pending = openLoginPopup({ callbackUrl: '/callback' });
    await Promise.resolve();
    popup.postMessageToOpener({ type: LOGIN_COMPLETE_MESSAGE_TYPE });
    await expect(pending).resolves.toBeUndefined();
  });

  test('rejects with PopupClosedError when the user closes the popup', async () => {
    vi.useFakeTimers();
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const pending = openLoginPopup({ callbackUrl: '/callback', pollIntervalMs: 10 });
    const caught = pending.catch((e: unknown) => e);

    popup.simulateUserClose();
    await vi.advanceTimersByTimeAsync(15);

    const err = await caught;
    expect(err).toBeInstanceOf(PopupClosedError);
    expect((err as PopupClosedError).code).toBe('popup_closed');
  });

  test('ignores messages whose origin does not match window.location.origin', async () => {
    vi.useFakeTimers();
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const pending = openLoginPopup({ callbackUrl: '/callback', pollIntervalMs: 5 });
    const settled = vi.fn<(value: unknown) => void>();
    pending.then(() => settled('resolved'), (e) => settled(e));

    await Promise.resolve();
    popup.postMessageToOpener({ type: LOGIN_COMPLETE_MESSAGE_TYPE }, 'https://evil.example');

    // Let microtasks drain — the listener should have rejected the bad-origin
    // message without settling.
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    // Close the popup to let the test finish without leaking the interval.
    popup.simulateUserClose();
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toHaveBeenCalledWith(expect.any(PopupClosedError));
  });

  test('ignores messages whose source is not the opened popup', async () => {
    vi.useFakeTimers();
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const pending = openLoginPopup({ callbackUrl: '/callback', pollIntervalMs: 5 });
    const settled = vi.fn<(value: unknown) => void>();
    pending.then(() => settled('resolved'), (e) => settled(e));

    // Hand-crafted event with source === window (the opener), NOT the popup.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: LOGIN_COMPLETE_MESSAGE_TYPE },
        origin: window.location.origin,
        source: window,
      }),
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    popup.simulateUserClose();
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toHaveBeenCalledWith(expect.any(PopupClosedError));
  });

  test('ignores messages whose payload is the wrong shape', async () => {
    vi.useFakeTimers();
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const pending = openLoginPopup({ callbackUrl: '/callback', pollIntervalMs: 5 });
    const settled = vi.fn<(value: unknown) => void>();
    pending.then(() => settled('resolved'), (e) => settled(e));

    // Strings, nulls, wrong type string — none should settle the promise.
    popup.postMessageToOpener('login-complete');
    popup.postMessageToOpener(null);
    popup.postMessageToOpener({ type: 'something-else' });
    popup.postMessageToOpener({ notType: LOGIN_COMPLETE_MESSAGE_TYPE });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    popup.simulateUserClose();
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toHaveBeenCalledWith(expect.any(PopupClosedError));
  });
});

describe('openLoginPopup: single-flight', () => {
  test('concurrent callers share one popup and one Promise', async () => {
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const p1 = openLoginPopup({ callbackUrl: '/callback' });
    const p2 = openLoginPopup({ callbackUrl: '/callback' });
    const p3 = openLoginPopup({ callbackUrl: '/callback' });

    // Same Promise instance is returned while one is pending.
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);
    expect(stub.calls).toHaveLength(1);

    await Promise.resolve();
    popup.postMessageToOpener({ type: LOGIN_COMPLETE_MESSAGE_TYPE });
    await Promise.all([p1, p2, p3]);

    expect(popup.closeCallCount).toBe(1);
  });

  test('after resolve, a subsequent call opens a fresh popup', async () => {
    const first = createMockPopup();
    stub.nextPopup(first);
    const run1 = openLoginPopup({ callbackUrl: '/callback' });
    await Promise.resolve();
    first.postMessageToOpener({ type: LOGIN_COMPLETE_MESSAGE_TYPE });
    await run1;

    const second = createMockPopup();
    stub.nextPopup(second);
    const run2 = openLoginPopup({ callbackUrl: '/callback' });
    expect(run2).not.toBe(run1);
    await Promise.resolve();
    second.postMessageToOpener({ type: LOGIN_COMPLETE_MESSAGE_TYPE });
    await run2;

    expect(stub.calls).toHaveLength(2);
  });
});

describe('__resetPopupStateForTests', () => {
  test('rejects an in-flight popup with PopupClosedError', async () => {
    vi.useFakeTimers();
    const popup = createMockPopup();
    stub.nextPopup(popup);

    const pending = openLoginPopup({ callbackUrl: '/callback', pollIntervalMs: 10_000 });
    const caught = pending.catch((e: unknown) => e);

    __resetPopupStateForTests();

    const err = await caught;
    expect(err).toBeInstanceOf(PopupClosedError);
  });
});
