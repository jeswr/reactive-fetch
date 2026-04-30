/**
 * Test helpers for the page-side service-worker API. Stubs
 * `navigator.serviceWorker` plus a configurable
 * `ServiceWorkerRegistration` so tests can drive
 * `registerReactiveFetchSW` without a real worker realm.
 *
 * The registration exposes settable `installing` / `waiting` / `active`
 * slots so tests can stage the activation sequence
 * (`waitForActiveServiceWorker`) and simulate which `ServiceWorker`
 * instances should pass `isExpectedServiceWorker`.
 *
 * Listeners attached via `navigator.serviceWorker.addEventListener('message', …)`
 * are collected so tests can dispatch synthesised `MessageEvent`s into
 * them. Real jsdom doesn't ship a Service Worker shim — the
 * `MessageEvent.source` field there is read-only and types
 * `MessageEventSource`, so we cast at the seam.
 */

import { vi } from 'vitest';

export interface FakeServiceWorker {
  postMessage: ReturnType<typeof vi.fn>;
  state: ServiceWorkerState;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  /** Test affordance: emit a `statechange` to any listener installed via addEventListener. */
  emitStateChange(state: ServiceWorkerState): void;
}

export interface FakeServiceWorkerRegistration {
  active: FakeServiceWorker | null;
  installing: FakeServiceWorker | null;
  waiting: FakeServiceWorker | null;
  scope: string;
  unregister: ReturnType<typeof vi.fn>;
  /** Captured registration scope passed to `navigator.serviceWorker.register`. */
  readonly registerOptions?: RegistrationOptions;
  /** Test handle: cast to the ServiceWorkerRegistration interface for the SUT. */
  asRegistration(): ServiceWorkerRegistration;
}

export interface FakeServiceWorkerContainer {
  registration: FakeServiceWorkerRegistration;
  controller: FakeServiceWorker | null;
  /** Dispatch a synthesised `MessageEvent` to all `'message'` listeners. */
  dispatchMessage(data: unknown, source: MessageEventSource | null): void;
  /** Number of `'message'` listeners currently registered. */
  readonly messageListenerCount: number;
  /** Restore `navigator.serviceWorker` to whatever was there before. */
  restore(): void;
}

export interface InstallFakeServiceWorkerOptions {
  initiallyActive?: boolean;
  swUrl?: string;
}

export function createFakeServiceWorker(
  initialState: ServiceWorkerState = 'activated',
): FakeServiceWorker {
  let state: ServiceWorkerState = initialState;
  const stateChangeListeners = new Set<(ev: Event) => void>();
  const sw: FakeServiceWorker = {
    postMessage: vi.fn(),
    get state() {
      return state;
    },
    set state(next: ServiceWorkerState) {
      state = next;
    },
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'statechange') {
        stateChangeListeners.add(listener as (ev: Event) => void);
      }
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'statechange') {
        stateChangeListeners.delete(listener as (ev: Event) => void);
      }
    }),
    emitStateChange(next: ServiceWorkerState) {
      state = next;
      const event = new Event('statechange');
      for (const listener of [...stateChangeListeners]) {
        listener(event);
      }
    },
  };
  return sw;
}

function createFakeRegistration(
  initiallyActive: boolean,
): {
  registration: FakeServiceWorkerRegistration;
  active: FakeServiceWorker;
} {
  const active = createFakeServiceWorker('activated');
  const registration: FakeServiceWorkerRegistration = {
    active: initiallyActive ? active : null,
    installing: null,
    waiting: null,
    scope: 'http://localhost/',
    unregister: vi.fn(async () => true),
    asRegistration() {
      return this as unknown as ServiceWorkerRegistration;
    },
  };
  return { registration, active };
}

export function installFakeServiceWorker(
  options: InstallFakeServiceWorkerOptions = {},
): FakeServiceWorkerContainer {
  const { initiallyActive = true } = options;

  const messageListeners = new Set<(ev: MessageEvent) => void>();

  const { registration, active } = createFakeRegistration(initiallyActive);

  const navAny = navigator as unknown as { serviceWorker?: unknown };
  const previous = navAny.serviceWorker;

  const controller: FakeServiceWorker | null = initiallyActive ? active : null;

  const fakeContainer = {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'message') {
        messageListeners.add(listener as (ev: MessageEvent) => void);
      }
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === 'message') {
        messageListeners.delete(listener as (ev: MessageEvent) => void);
      }
    }),
    register: vi.fn(async (_url: string, opts?: RegistrationOptions) => {
      Object.defineProperty(registration, 'registerOptions', { value: opts });
      return registration as unknown as ServiceWorkerRegistration;
    }),
    controller,
  } as unknown as ServiceWorkerContainer;

  // The container exposes a mutable `controller` so test code can swap it
  // when simulating a worker takeover. jsdom's `navigator.serviceWorker`
  // is read-only on the original property descriptor; we override the
  // whole property here.
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: fakeContainer,
  });

  return {
    registration,
    get controller() {
      return (navigator.serviceWorker as unknown as { controller: FakeServiceWorker | null })
        .controller;
    },
    set controller(next: FakeServiceWorker | null) {
      (navigator.serviceWorker as unknown as { controller: FakeServiceWorker | null })
        .controller = next;
    },
    dispatchMessage(data: unknown, source: MessageEventSource | null) {
      const event = new MessageEvent('message', {
        data,
        origin: window.location.origin,
        source,
      });
      for (const listener of [...messageListeners]) {
        listener(event);
      }
    },
    get messageListenerCount() {
      return messageListeners.size;
    },
    restore() {
      if (previous === undefined) {
        delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
      } else {
        Object.defineProperty(navigator, 'serviceWorker', {
          configurable: true,
          value: previous,
        });
      }
    },
  };
}
