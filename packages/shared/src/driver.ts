// =====================================================================
// WebIdDriver contract
// =====================================================================
//
// A `WebIdDriver` is parent-side code that acquires a WebID before the
// login popup opens. It runs synchronously (or close enough) to keep the
// surrounding user-gesture budget alive across the subsequent
// `window.open(...)` call.
//
// Two cases:
//
//   - **No driver passed**: `createReactiveFetch` opens the popup with
//     no `?webId=` query parameter and the callback page renders its
//     built-in WebID-input form.
//
//   - **Driver passed**: the driver runs in the parent, returns a WebID
//     (or null to cancel), and the popup opens with `?webId=<webId>` so
//     the callback skips its form and goes straight to OIDC discovery.
//
// Implementations must be synchronous-friendly. Returning a Promise is
// allowed (e.g. for an OS-native dialog wrapped in a Promise) but the
// implementation is responsible for keeping the gesture stack alive —
// pre-resolved Promises and `window.prompt(...)` style blocking calls
// preserve it; arbitrary async work (network requests, awaiting a
// timer) does not, and Chromium will refuse to open the popup.
// =====================================================================

export interface WebIdDriverContext {
  /**
   * Whether the consuming factory was constructed with `allowLocalhost: true`.
   * Drivers that validate input themselves should mirror this flag; drivers
   * that hand off the raw string to the factory can ignore it.
   */
  readonly allowLocalhost: boolean;
}

/**
 * Acquire a WebID from the user before the login popup opens. Return
 * `null` to cancel the login flow. Throwing is also acceptable — the
 * thrown error propagates to the caller of `rf.webId` / `rf.fetch` /
 * `rf.solid.login`.
 */
export type WebIdDriver = (
  context: WebIdDriverContext,
) => string | null | Promise<string | null>;
