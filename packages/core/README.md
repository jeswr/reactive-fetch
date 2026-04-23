# @jeswr/solid-reactive-fetch

[![CI](https://img.shields.io/github/actions/workflow/status/jeswr/reactive-fetch/ci.yml?branch=main)](https://github.com/jeswr/reactive-fetch/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jeswr/solid-reactive-fetch)](https://www.npmjs.com/package/@jeswr/solid-reactive-fetch)
[![npm downloads](https://img.shields.io/npm/dw/@jeswr/solid-reactive-fetch)](https://www.npmjs.com/package/@jeswr/solid-reactive-fetch)

> [!WARNING]
> **This package has NOT been independently security reviewed.** It is published for **testing and evaluation purposes only** and should not be used to protect production user data. The public API, storage format, and security guarantees may change without notice. Use at your own risk.

Reactive authenticated `fetch` for Solid applications. Authentication is triggered automatically — no explicit `login()` or `logout()` required.

The package's public shape mirrors the global API installed by the in-development [`theodi/solid-browser-extension`](https://github.com/theodi/solid-browser-extension) (`dev_hkir` branch), so a future "unified wrapper" package can re-export from either source transparently. The extension is **not yet on npm** — the colleague is working through publish-auth issues. Until it ships, `@jeswr/solid-reactive-fetch` is the single source for both the reactive surface (`rf.webId`, `rf.fetch`) and the extension-shaped facade (`rf.solid`).

**Live demo**: <https://jeswr.github.io/reactive-fetch/>

<video src="../../docs/demo.webm" controls muted width="100%"></video>

```ts
import { createReactiveFetch } from '@jeswr/solid-reactive-fetch';

const rf = createReactiveFetch({
  clientId: 'https://myapp.example/solid-client.jsonld',
  callbackUrl: 'https://myapp.example/reactive-fetch-callback',
});

// Reading webId triggers the login popup if no session is active.
const webId = await rf.webId;

// Fetching a private resource: tries unauthenticated first, retries with DPoP-bound auth on 401.
const res = await rf.fetch('https://pod.example/private-resource');
```

## Extension-shaped facade — `rf.solid`

`rf.solid` mirrors `window.solid` from the browser extension byte-for-byte, so the unified-wrapper package can pick whichever source is available at runtime:

```ts
const solid = (typeof window !== 'undefined' && window.solid) ?? rf.solid;

solid.webId;        // string | null   — bare WebID, snapshot
solid.profile;      // WebIDProfile | null — wrapped @solid/object Agent
solid.clientId;     // string | undefined  — currently-set Client ID URI
await solid.fetch(url, init);            // authenticated fetch
solid.setClientId('https://app.example/client-id.jsonld'); // sync
await solid.login('https://alice.example/profile#me');     // takes WebID
await solid.logout();                                       // clear local tokens
```

### `WebIDProfile` — wrapped profile object

`WebIDProfile` is a forward-compatible alias for the upcoming `@solid/object` `WebIDProfile` export. Today it resolves to `Agent` from `@solid/object/webid`. When `@solid/object` ships the rename, switching is a one-line import change inside `reactive-fetch` — your code that uses `WebIDProfile` keeps working.

**Stable getters** (use freely):

- `value` — the WebID IRI as a string
- `oidcIssuers` — `Set<string>` of `solid:oidcIssuer` IRIs
- `pimStorage` / `solidStorage` / `storageUrls` — `Set<string>` of declared storage roots

**UNSTABLE — do not depend on these in cross-package code**: the social-graph getters from `@solid/object` (`name`, `email`, `knows`, `phone`, `photoUrl`, `website`, `organization`, `role`, `title`, `vcardFn`, `foafName`, `hasEmail`, `hasTelephone`, `vcardHasUrl`, `foafHomepage`). The Solid 26 spec note explicitly flags these as subject to change. They remain accessible — `WebIDProfile extends Agent` — but the unified-wrapper API does not promise them.

### `webId`: reactive promise vs sync snapshot

Two ways to read the WebID, on purpose:

| Surface | Type | Triggers login? | When to use |
| --- | --- | --- | --- |
| `rf.webId` | `Promise<string>` | YES — opens popup if no session | "I want to render a signed-in UI; sign me in if needed" |
| `rf.solid.webId` | `string \| null` | NO — pure read | "Render a snapshot; offer a Login button if `null`" |
| `rf.solid.login(webId)` | `Promise<void>` | YES — opens popup | Imperative "Sign in" click handler |

## Restore lifecycle

On construction, `createReactiveFetch` tries to rehydrate any session previously persisted in IndexedDB. Two escape hatches are exposed for UIs that want to render a loading state or surface restore errors:

```ts
const rf = createReactiveFetch({
  clientId: '…',
  callbackUrl: '…',
  onRestoreError(err) {
    // Invoked if the construction-time restore attempt rejects (malformed
    // refresh token, token endpoint unreachable, corrupt IndexedDB, etc.).
    // The factory itself never rejects — a failed restore leaves the
    // session inactive and the next rf.webId / rf.fetch call triggers
    // the popup. Use this to log or to show a "session expired" toast.
    console.warn('Could not restore previous session:', err);
  },
});

// Render a spinner while we're trying to rehydrate.
await rf.restorePromise;
//   ^ never rejects; failures surface via onRestoreError only.
```

## Security: localhost issuers

By default, the library only accepts `https://` OIDC issuers. `allowLocalhost` is a plain boolean consumers opt into — the library never reads `import.meta.env`, `process.env`, or any other environment signal behind your back. It's always the value your code passed.

```ts
// dev build: let users sign in with a pod on their own machine
const rf = createReactiveFetch({
  clientId,
  callbackUrl,
  allowLocalhost: import.meta.env.DEV, // or process.env.NODE_ENV !== 'production'
});

// The filter runs inside the popup, so pass the SAME value to mountCallback
// on the callback page:
mountCallback({
  clientId,
  allowLocalhost: import.meta.env.DEV,
});
```

With `allowLocalhost: false` (the default), a WebID profile declaring `http://localhost:3000/` as its issuer is rejected with `InvalidIssuerError` before it can reach `session.login()`. This stops a hostile profile hosted anywhere on the web from redirecting a production user's popup to whatever happens to be listening on a local port — e.g. a dev server still running, an internal admin UI, or a credential-stealing `http://localhost/auth` spoof.

Accepted loopback hosts when enabled: `localhost`, `127.0.0.1`, and `[::1]` (IPv6, WHATWG-bracketed form). Anything else — `http://example.com`, `http://10.0.0.1`, `javascript:`, `file:`, `data:` — is rejected regardless of `allowLocalhost`.

## SSR usage

`createReactiveFetch` is **browser-only** and will throw if called without `window` or `indexedDB`. The underlying Session keeps its DPoP keypair and refresh token in IndexedDB, and a long-lived Node process would leak that state across user requests.

In Next.js / Remix / SvelteKit, construct the factory inside a client-only code path:

- Next.js app router: a `"use client"` component
- Remix / SvelteKit: inside `useEffect` (Remix) or a `$lib` imported only from a `+page.svelte` that runs client-side, or gate with `typeof window !== 'undefined'`
- Any bundler: dynamic-import the module (`await import('@jeswr/solid-reactive-fetch')`) from code that only runs in the browser

React hooks (`@jeswr/solid-reactive-fetch-react`) are SSR-safe in the sense that `useWebId` suspends during the server pass — so a server-rendered `<Suspense fallback={…}>` renders the fallback — but they still require the `createReactiveFetch()` call itself to happen on the client.

Status: **under construction**. See the repo root for design notes.
