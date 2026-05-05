# reactive-fetch — design notes

This file is the **design-rationale** doc — the "why" behind the public API. For the **what** see [`packages/core/README.md`](packages/core/README.md); for the **how** (release flow, CI, Pages, monitoring) see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Goal

A **reactive** authenticated `fetch` for Solid applications. "Reactive" means authentication is triggered by the act of accessing a resource that needs it — never by an explicit `login()` call. Use of an existing session, login when none exists, retry-on-401, and profile hydration all happen behind one promise-shaped surface.

## Public surface (the union of two contracts)

**Reactive (the original USP)** — `rf.fetch` and `rf.webId`:

- `rf.fetch(input, init?)` — tries unauthenticated first (or with an already-restored session), retries with auth on a 401.
- `rf.webId: Promise<string>` — reading it when no session is active triggers the login popup and resolves once auth completes. Multiple reads share the same pending Promise.

**Extension-shaped facade** — `rf.solid`:

Mirrors `window.solid` from the in-development [`theodi/solid-browser-extension`](https://github.com/theodi/solid-browser-extension) (`dev_hkir`) so a future "unified wrapper" package can `const solid = window.solid ?? rf.solid;` without per-source adaptation. See `packages/core/src/index.ts` for the file-header comment with the full contract and the design judgement calls — notably that `solid.webId` is a bare string snapshot, while the wrapped `WebIDProfile` lives on `solid.profile`. That matches the extension's `inject.ts`.

## Login flow (internal mechanics)

When `rf.fetch` gets a 401 or `rf.webId` is read with no active session:

1. **Open a same-origin popup** — synchronously from the user gesture.
2. **Acquire a WebID** — either via the popup's built-in WebID-input form (the zero-config default), or by running a `WebIdDriver` in the parent before the popup opens (e.g. `() => window.prompt('Enter your WebID')` for an OS-native dialog, or a custom modal). When a driver supplies a WebID, the parent appends `?webId=` to the popup URL and the callback skips the form.
3. **Discover the IDP** — popup fetches the WebID Profile Document, reads `solid:oidcIssuer`.
4. **Run the OIDC dance** — popup calls `Session.login(issuer, redirectUri)` via `@uvdsl/solid-oidc-client-browser`, redirects to the IDP, the IDP redirects back, popup runs `handleRedirectFromLogin()`.
5. **Notify the parent** — popup `postMessage`s a completion signal to `window.opener` (with explicit `targetOrigin`; tokens never cross the channel), then calls `window.close()`.
6. **Parent hydrates** — after origin-validating the message, the parent calls `session.restore()` to pick up the session from shared IndexedDB.
7. **Continuation** — the pending `webId` Promise resolves; any in-flight failed fetches retry with `session.authFetch(...)`.

## Concurrency invariants

- Concurrent 401s share **one** login attempt and **one** popup.
- Concurrent `webId` reads share the same pending Promise.
- A `webId` read and a fetching 401 during the same auth-less state share the same popup.
- Concurrent `solid.login(X)` and `solid.login(Y)` — the second rejects with `LoginFailedError` rather than silently joining; the gesture chain that triggered the first cannot drive a second popup.
- If the user closes the popup without completing login, all pending Promises reject with a clear error.

## Design constraints

- **Popup over iframe** — iframes are blocked by most IDPs and can't own top-level navigation.
- **Same-origin popup** — required so `IndexedDB` (where `@uvdsl/solid-oidc-client-browser` persists the non-extractable DPoP keypair and refresh token) is shared. The parent restores its session via `session.restore()` after the popup postMessages completion. **This is not silent authentication** — the user interacts with the IDP inside the popup.
- **Explicitly not silent auth** — the upstream library's author warns against iframe/popup-based silent auth because it produces extractable DPoP keypairs. Our popup is user-driven login, so the concern does not apply.
- **Origin-validated `postMessage`** as the popup → opener signal channel. Used only to notify the parent that login completed; tokens live in shared `IndexedDB`.
- **Browser-only** — `createReactiveFetch` throws on Node/SSR. The underlying `Session` keeps its DPoP keypair and refresh token in IndexedDB, and a long-lived Node process sharing that singleton across users would leak tokens. In Next.js / Remix / SvelteKit construct inside a `"use client"` boundary, `useEffect`, or a `typeof window !== 'undefined'` guard. The module itself is importable in SSR bundles without throwing — only the factory invocation is guarded.
- **Framework-agnostic** core, with thin adapters layered on (`@jeswr/solid-reactive-fetch-react`, future Svelte store, …).

## `WebIdDriver` — parent-side WebID acquisition

A `WebIdDriver` is `(ctx) => string | null | Promise<string | null>` that runs in the parent before the popup opens. It must be synchronous-friendly so the user-gesture budget survives across the subsequent `window.open(...)`.

Two cases:

1. **No driver passed** to `createReactiveFetch` → popup opens with no `?webId=` → callback page renders its built-in WebID-input form (zero-config default).
2. **Driver passed** → driver runs in the parent → popup opens with `?webId=<webId>` → callback skips the form and goes straight to OIDC discovery.

No driver packages are shipped — drivers are a one-function contract written inline by the consumer. The two-line `() => window.prompt('Enter your WebID')` is enough for the OS-native-dialog case; styled modals, saved-WebID dropdowns, and Electron IPC dialogs are equally just functions.

## Underlying library

[`@uvdsl/solid-oidc-client-browser`](https://github.com/uvdsl/solid-oidc-client-browser) (peerDependency) — a Solid-OIDC client using **non-extractable DPoP keypairs** stored in `IndexedDB` and session bootstrap data in `sessionStorage`. Exposes a `Session` class: `login(idp, redirectUri)`, `handleRedirectFromLogin()`, `restore()`, `authFetch()`, `webId`, `isActive`. A `core` subpath is available for contexts without `IndexedDB`.

## Reference

- Target API: <https://github.com/theodi/solid-browser-extension/blob/main/PLAN.md>
- Solid-OIDC spec: <https://solidproject.org/TR/oidc>
- DPoP (RFC 9449): <https://datatracker.ietf.org/doc/html/rfc9449>

## Agents (team roles)

See `.claude/agents/` — five role-based teammates are defined, all running Opus 4.7. The intent is an agent **team** (not just sub-agents): each teammate owns a deliverable and coordinates via the shared task list and `SendMessage`.

- `plugin-author` — owns net-new features in the core reactive-fetch package.
- `refactor-engineer` — handles refactors, cleanup, roborev findings, dep upgrades; preserves behavior, improves shape.
- `sample-app-author` — owns `examples/` (vanilla, React demos + Client ID Document).
- `test-infrastructure-engineer` — owns the test stack and CI workflows.
- `security-reviewer` — gatekeeper; reviews every auth-touching change, cannot be bypassed.

Agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) are enabled in `.claude/settings.json`.

**Standard workflow**: `plugin-author` drafts a feature → `test-infrastructure-engineer` validates it with tests → `refactor-engineer` sweeps review feedback and style debt in parallel → `security-reviewer` audits → `sample-app-author` updates demos if the public API changed.

## See also

- [`README.md`](README.md) — user-facing entry point and package index.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — development workflow, release flow, deployment setup.
- [`packages/core/README.md`](packages/core/README.md) — full API documentation for the core library.
