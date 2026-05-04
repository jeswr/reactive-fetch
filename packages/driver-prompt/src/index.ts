// =====================================================================
// @jeswr/solid-reactive-fetch-driver-prompt
//
// A `WebIdDriver` that wraps `window.prompt()` to collect a WebID
// before the login popup opens. Pass to `createReactiveFetch({ driver })`
// to skip the popup's built-in form and use the OS-native dialog instead.
//
// `window.prompt` is synchronous and pauses JS, so the user-gesture
// budget survives the call — `window.open(...)` runs immediately
// afterwards without an `await` and the popup is not blocked.
//
// Useful in kiosk apps, deeply restricted CSPs, accessibility-tooling
// stacks that prefer the OS-native prompt, and tests that want a
// single-line stub for the entry step.
// =====================================================================

import type { WebIdDriver } from '@jeswr/solid-reactive-fetch-shared';

export interface PromptDriverOptions {
  /**
   * Override the message shown in `window.prompt()`. Defaults to
   * `'Enter your WebID URL'`.
   */
  message?: string;
}

/**
 * Create a `WebIdDriver` that collects a WebID via `window.prompt()`.
 * Returns `null` when the user cancels — the caller of `rf.webId` /
 * `rf.fetch` / `rf.solid.login` then gets a `WebIdPromptCancelledError`.
 */
export function promptDriver(options: PromptDriverOptions = {}): WebIdDriver {
  const message = options.message ?? 'Enter your WebID URL';
  return () => {
    // jsdom and a few headless contexts return `undefined` from
    // `window.prompt`; the WHATWG spec says `string | null`. Coerce.
    const result = window.prompt(message);
    return result ?? null;
  };
}
