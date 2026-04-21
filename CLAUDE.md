# reactive-fetch

An npm package that provides a **reactive authenticated `fetch`** for Solid applications, using a **popup-based login flow** instead of a browser extension.

## Goal

A **reactive** authenticated `fetch` for Solid applications. "Reactive" here means authentication is triggered by the act of accessing a resource that needs it — never by an explicit `login()` call.

### Public API (minimal by design)

```ts
const rf = createReactiveFetch({
  clientId: "https://myapp.example/solid-client.jsonld",
  callbackUrl: "https://myapp.example/reactive-fetch-callback",
});

// Promise-valued. Reading it reactively triggers the login popup if not yet authenticated.
const webId: string = await rf.webId;

// Fetches public resources without auth. On 401, transparently triggers login and retries.
const res = await rf.fetch("https://pod.example/private-resource");
```

That is the entire surface:

- **`rf.fetch(input, init?)`** — tries unauthenticated first (or with an already-restored session), retries with auth on a 401
- **`rf.webId`** — a `Promise<string>` that resolves to the authenticated WebID. Reading it when no session is active triggers the login popup and resolves once auth completes. Multiple reads share the same pending Promise
- **Init option `clientId`** — the hosted Client ID Document URI
- **Init option `callbackUrl`** — the URL where the consumer has mounted `mountCallback()` from `@jeswr/solid-reactive-fetch/callback`. Must be served from the same origin as the app so IndexedDB is shared. This URL must also appear in the Client ID Document's `redirect_uris`

### Explicitly NOT in the API

- No `login(idp)` — auth is triggered by fetch or by reading `webId`
- No `logout()` — sessions clear through refresh-token expiry or tab close; no explicit tear-down method
- No state-change event subscription — `webId` and `fetch` are the only reactive surfaces
- No `setClientId(...)` method — set once at construction

### The login flow (internal mechanics)

When either `rf.fetch` gets a 401 or `rf.webId` is read with no active session:

1. **Open a same-origin popup** — synchronously from the user gesture (for fetch, the triggering call stack must originate in a gesture; for `webId` reads, the consumer is responsible for timing)
2. **WebID prompt inside the popup** — the library ships the popup UI. User enters their WebID URI (optionally picks from a preset IDP list)
3. **Discover the IDP** — popup fetches the WebID Profile Document, reads `solid:oidcIssuer`
4. **Run the OIDC dance** — popup calls `Session.login(issuer, redirectUri)` via `@uvdsl/solid-oidc-client-browser`, redirects to the IDP, IDP redirects back, popup runs `handleRedirectFromLogin()`
5. **Notify the parent** — popup `postMessage`s a completion signal to `window.opener` (with explicit `targetOrigin`; tokens never cross the channel), then calls `window.close()`
6. **Parent hydrates** — after origin-validating the message, the parent calls `session.restore()` to pick up the session from shared IndexedDB
7. **Continuation** — the pending `webId` Promise resolves; any in-flight failed fetches retry with `session.authFetch(...)`

### Concurrency invariants

- Concurrent 401s share **one** login attempt and **one** popup
- Concurrent `webId` reads share the same pending Promise
- A `webId` read and a fetching 401 during the same auth-less state share the same popup
- If the user closes the popup without completing login, all pending Promises reject with a clear error

## Reference

- Target API: https://github.com/theodi/solid-browser-extension/blob/main/PLAN.md
- Solid-OIDC spec: https://solidproject.org/TR/oidc
- DPoP (RFC 9449): https://datatracker.ietf.org/doc/html/rfc9449
- **Underlying library** (peerDependency): [`@uvdsl/solid-oidc-client-browser`](https://github.com/uvdsl/solid-oidc-client-browser) — a small Solid-OIDC client that uses **non-extractable DPoP keypairs** stored in `IndexedDB` and session bootstrap data in `sessionStorage`. Exposes a `Session` class: `login(idp, redirectUri)`, `handleRedirectFromLogin()`, `restore()`, `authFetch()`, `webId`, `isActive`. A `core` subpath (`@uvdsl/solid-oidc-client-browser/core`) is available for contexts without `IndexedDB`.

## Design constraints

- **Popup over iframe** for login (iframes are blocked by most IDPs and can't own top-level navigation)
- **Same-origin popup**: the login popup must be served from the same origin as the parent app, so that `IndexedDB` (where `@uvdsl/solid-oidc-client-browser` persists the non-extractable DPoP keypair and refresh token) is shared. The parent restores its session via `session.restore()` after the popup postMessages completion. **This is not silent authentication** — it requires explicit user interaction inside the popup.
- **Explicitly not silent auth**: the upstream library's author warns against iframe/popup-based silent auth because it produces extractable DPoP keypairs; our popup is user-driven login (the user interacts with the IDP inside it), so this concern does not apply. Document this clearly in the README.
- **Origin-validated `postMessage`** as the popup→opener signal channel (used only to notify the parent that login completed and to close the popup; tokens themselves never cross the channel — they live in shared `IndexedDB`)
- **Reactive** — not just promise-returning; consumers can react to session changes without polling
- **Framework-agnostic** core, with thin adapters possible later (React hook, Svelte store, etc.)
- **Browser-first** but should not break in SSR bundlers (Next.js, Remix, SvelteKit) — either SSR-safe or cleanly tree-shakeable

## Agents (team roles)

See `.claude/agents/` — five role-based teammates are defined, all running Opus 4.7. The intent is an agent **team** (not just sub-agents): each teammate owns a deliverable and coordinates via the shared task list and `SendMessage`.

- `plugin-author` — owns `src/` (net-new features in the core reactive-fetch package)
- `refactor-engineer` — handles refactors, cleanup, roborev findings, dep upgrades; preserves behavior, improves shape. Runs in parallel with `plugin-author` so features and cleanup don't block each other
- `sample-app-author` — owns `examples/` (vanilla, React, optional SSR demos + Client ID Document)
- `test-infrastructure-engineer` — owns `test/`, vitest/MSW/Playwright config, CI workflows
- `security-reviewer` — gatekeeper; reviews every auth-touching change, cannot be bypassed

Agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) are enabled in `.claude/settings.json`.

**Standard workflow**: `plugin-author` drafts a feature → `test-infrastructure-engineer` validates it with tests → `refactor-engineer` sweeps review feedback and style debt in parallel → `security-reviewer` audits → `sample-app-author` updates demos if the public API changed.

## Code review

This repo uses [roborev](https://www.roborev.io) for continuous review of AI-generated commits. Run `roborev init` once, then `roborev` to browse findings.

## Monorepo layout

This repo is a **pnpm workspace** hosting multiple packages:

```
reactive-fetch/
├── packages/
│   ├── core/       # @jeswr/solid-reactive-fetch          (the main library)
│   └── react/      # @jeswr/solid-reactive-fetch-react    (React hooks, stubbed)
├── examples/        # vanilla-ts, react demos, callback page, client-id-document
├── .changeset/      # changesets for versioned releases
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json     # workspace root
```

### Tooling

- **pnpm 10** (set via `packageManager` field) — `pnpm install` from root
- **TypeScript 5.7** with `moduleResolution: "Bundler"`, strict + `noUncheckedIndexedAccess`
- **tsup** for builds (ESM-only, DTS + source maps)
- **vitest 4** for tests (`--passWithNoTests` in default scripts while suites are empty)
- **changesets** for versioning and coordinated publishing

### Root scripts

| Command | Does |
|---|---|
| `pnpm build` | Build every `packages/*` |
| `pnpm dev` | Watch-build every `packages/*` in parallel |
| `pnpm test` | Run vitest in every `packages/*` |
| `pnpm typecheck` | `tsc --noEmit` in every `packages/*` |
| `pnpm changeset` | Record a change for release |
| `pnpm version-packages` | Apply pending changesets (bumps versions, writes changelogs) |
| `pnpm release` | Build then `changeset publish` to npm |

Per-package scripts mirror the root ones (minus the `--filter`).

### Current package status

- `@jeswr/solid-reactive-fetch` — API surface stubbed (`createReactiveFetch`, `mountCallback`); throws `not yet implemented`. Next step: implement per the design above.
- `@jeswr/solid-reactive-fetch-react` — stubbed, no hooks yet. Will be built once the core is done.

## Status

Monorepo scaffolded, builds pass, API surface typed as stubs. Next: implement the core `createReactiveFetch` with popup orchestration, then the `mountCallback` entry for the popup side.
