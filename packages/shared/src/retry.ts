// Shared "build a Request safe to fetch twice" helper.
//
// `@jeswr/solid-reactive-fetch`'s reactive-401-retry contract: try the
// request once unauthenticated, and on 401 retry it through
// `session.authFetch`. The retry has to materialise an independent
// Request because `Request.clone()` is single-use for streaming bodies,
// and `globalThis.fetch(request, init)` must apply `init`'s overrides
// onto the request's defaults per the Fetch spec.
//
// Centralised here so a fix to one of the three input shapes (Request /
// string+consumable-body / string+plain-body) doesn't drift between
// consumers — historically core lagged a security fix that landed in prompt
// because they were independent copies.

export interface Retryable {
  /** The Request to send for the unauthenticated probe. */
  readonly request: Request;
  /** Inputs to pass to `authFetch` on retry. */
  readonly retry: { input: RequestInfo | URL; init?: RequestInit };
}

/**
 * Materialise a fetch input pair so the same call can be issued twice — once
 * unauthenticated, once via `session.authFetch` after a 401 — without
 * cross-talk on streaming bodies or losing `init` overrides.
 *
 * Three branches:
 *
 *   1. `input instanceof Request` — overlay `init` onto the existing Request
 *      via `new Request(input, init)` (Fetch-spec semantics) and clone the
 *      merged Request twice. Calling `globalThis.fetch(request)` without
 *      first merging would silently drop `init`'s overrides and could come
 *      back with a 200 for the wrong method/headers/body.
 *
 *   2. String/URL with a stream-shaped body — materialise a single Request
 *      via `new Request(input, init)` and clone twice; this is the only way
 *      to get two independent copies of a `ReadableStream` body.
 *
 *   3. Plain string/URL — pass `input + init` through as-is. Both `fetch`
 *      and `authFetch` accept the same shape so no cloning is needed.
 *
 * Note: a Request whose stream body has already been consumed before this
 * helper runs cannot be cloned independently (browsers throw on the second
 * read). Callers expecting reactive auth on streaming bodies should pass
 * the body via `init` rather than pre-materialised Request bodies.
 */
export function prepareRetryable(
  input: RequestInfo | URL,
  init?: RequestInit,
): Retryable {
  if (input instanceof Request) {
    const merged = init ? new Request(input, init) : input;
    return {
      request: merged.clone(),
      retry: { input: merged.clone() },
    };
  }

  if (init?.body && isConsumableBody(init.body)) {
    const request = new Request(input, init);
    return {
      request: request.clone(),
      retry: { input: request.clone() },
    };
  }

  return {
    request: new Request(input, init),
    retry: { input, init },
  };
}

/**
 * Body shapes that are single-consumption — once `fetch` reads them, the
 * second call would re-send empty. The Fetch spec exposes them all behind
 * `BodyInit`, but only these need pre-cloning into a Request.
 */
function isConsumableBody(body: BodyInit): boolean {
  return (
    body instanceof ReadableStream ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}
