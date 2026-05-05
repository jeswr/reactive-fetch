# @jeswr/solid-reactive-fetch-shared

Shared primitives consumed by [`@jeswr/solid-reactive-fetch`](../core/) and [`@jeswr/solid-reactive-fetch-sw`](../sw/).

**Most applications don't import this package directly** — the core package re-exports the public types and errors. Install this only if you're authoring a custom WebID driver, a custom callback page, or another sibling integration that needs the OIDC primitives.

## What lives here

- **`WebIdDriver`** contract (`src/driver.ts`) — the one-function shape every WebID driver implements: `(ctx) => string | null | Promise<string | null>`.
- **Errors** — `ReactiveFetchError`, `InvalidWebIdError`, `LoginFailedError`, `PopupBlockedError`, `WebIdPromptCancelledError`, etc.
- **Session bootstrap** — `createSessionBootstrap`, `ensureRestored`, `rebuildSessionBootstrap`, `authFetch`.
- **Popup orchestration** — `openLoginPopup`, `LOGIN_COMPLETE_MESSAGE_TYPE`, plus origin / `event.source` hardening.
- **Callback handlers** (`./callback`) — `runOidcRedirectIfPresent`, `driveLoginFromWebId`, `validateWebIdSyncStrict`, the issuer-picker UI, the WebID-input form, and the cached-WebIDs list.
- **Service-worker wire protocol** (`./sw`) — message-type constants and type guards used by `@jeswr/solid-reactive-fetch-sw`.

## Stability

The exports surfaced from this package are versioned alongside core. Adding a custom WebID driver only needs the `WebIdDriver` type from this package; everything else is implementation detail core happens to expose.

## See also

- [Design rationale](../../CLAUDE.md) — the `WebIdDriver` model, popup-vs-iframe choices, postMessage hygiene.
- [`@jeswr/solid-reactive-fetch`](../core/) — the consumer-facing factory.
