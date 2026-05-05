# @jeswr/solid-reactive-fetch-sw

> **Not security reviewed. Testing only.** This package has not yet been
> audited by `security-reviewer`. Do not use it in production.

Service-worker variant of
[`@jeswr/solid-reactive-fetch`](https://github.com/jeswr/reactive-fetch/tree/main/packages/core).
Where the popup and prompt packages give you an `rf.fetch` wrapper, this
package intercepts the **unmodified global `globalThis.fetch`** via a
Service Worker so apps can call

```ts
const res = await fetch('https://pod.example/private');
```

…and get authentication transparently. No `rf.fetch` at the call site.

The package itself ships **no login UI**. You compose one via the
`loginDriver` option — typically by chaining the popup or prompt
package's `webId` Promise.

## Install

```sh
npm install @jeswr/solid-reactive-fetch-sw @uvdsl/solid-oidc-client-browser
```

`@uvdsl/solid-oidc-client-browser` is a **peerDependency** — install it
yourself.

## Usage

### 1. Copy the worker bundle to your origin

The browser only loads service workers from the origin's HTTP server,
not from `node_modules`. Copy `dist/worker.js` into your `public/`
directory at build time:

```sh
cp node_modules/@jeswr/solid-reactive-fetch-sw/dist/worker.js public/reactive-fetch-sw.js
```

For Vite, you can also resolve it with `import.meta.url` and let Vite
emit it as an asset:

```ts
import workerUrl from '@jeswr/solid-reactive-fetch-sw/worker?url';

await registerReactiveFetchSW({ swUrl: workerUrl, /* … */ });
```

### 2. Register the worker on the page

```ts
import { registerReactiveFetchSW } from '@jeswr/solid-reactive-fetch-sw';
import { createReactiveFetch } from '@jeswr/solid-reactive-fetch';

const rf = createReactiveFetch({
  clientId: 'https://myapp.example/solid-client.jsonld',
  callbackUrl: 'https://myapp.example/reactive-fetch-callback',
  driver: () => window.prompt('Enter your WebID URL'),
});

await registerReactiveFetchSW({
  swUrl: '/reactive-fetch-sw.js',
  clientId: 'https://myapp.example/solid-client.jsonld',
  callbackUrl: 'https://myapp.example/reactive-fetch-callback',
  loginDriver: () => rf.webId.then(() => undefined),
  // Required: explicit allowlist of origins the SW is allowed to apply
  // Solid auth to. URLs outside this list (including OIDC discovery /
  // token endpoints from the IDP, and unrelated third-party APIs) fall
  // through the worker untouched. Same-origin requests are always
  // skipped regardless of this list.
  authOrigins: ['https://pod.example'],
});

// From here on, plain `fetch` calls to allowlisted origins get auth
// transparently. Anything outside `authOrigins` runs as a normal fetch.
const res = await fetch('https://pod.example/alice/private');
```

### 3. Mount the callback page

The callback page is owned by whichever sibling (popup or prompt) you
chose for `loginDriver`. Mount it as you would for that package — the
SW package does NOT ship its own callback.

## How it works

1. The page registers the SW and sends a handshake with `clientId` +
   login timeout.
2. The SW intercepts `fetch` events and, for matched URLs, attempts an
   authenticated fetch via a `SessionCore` restored from shared
   IndexedDB (the same `(soidc, session)` IDB the page-side library
   uses — the DPoP keypair is structured-cloneable across realms).
3. If no active session exists, or the auth fetch returns 401, the SW
   broadcasts a `login-required` message to all controlled clients via
   `clients.matchAll()`.
4. The page-side handler invokes `loginDriver()`. On success it posts a
   `login-complete` back; on failure a `login-failed`.
5. The SW re-restores the Session from IDB and retries the original
   request authenticated.

Tokens never cross `postMessage`. The control channel only carries
correlation ids and pass/fail signals.

### Single-flight invariants

- One pending login at a time. Concurrent matched fetches share the
  same `loginDriver()` invocation.
- Concurrent worker-side fetches that 401 share the same
  `login-required` broadcast Promise (deduped by the page-side
  handler).

## Mutually exclusive with `rf.fetch`

**Do not use this package together with `rf.fetch` from the popup or
prompt packages for URLs that match the SW's filter.** Both layers
will fight over the Session: each will detect a 401, each will trigger
a login attempt, and you'll see duplicate popups / authenticated
requests.

Pick one path per origin / URL pattern:

- Per-call-site control: stick with `rf.fetch` from popup or prompt.
- Transparent global interception: use this package and let your code
  call plain `fetch`.

You can absolutely combine them at the **app level** — using `rfp.webId`
as your `loginDriver` is exactly that — but each individual `fetch`
call should go through one path or the other, not both.

## Cold-start failure mode

If a matched fetch arrives at the SW BEFORE the page has registered
its message listener (e.g. an HTTP request fired during early page
boot, before `registerReactiveFetchSW` resolves), the SW has no client
to ask for a login. It returns a synthetic 401 with header
`X-Reactive-Fetch-SW: no-page-listener` so the calling code can
distinguish this from a real auth failure.

There is **no buffering**. We deliberately do not hold the request
indefinitely waiting for a page-side listener — service workers can be
terminated at any time by the browser, and an unbounded queue would
complicate the lifecycle. If your app makes auth-required requests
during boot, register the SW first (as early as possible in your
entry-point) before any other fetches.

## Same-origin behaviour

By default the worker ignores same-origin requests entirely. The SW
itself is an asset on your origin, and you almost never want it
sending DPoP-bound auth headers to your own static assets. If you DO
need to authenticate same-origin requests (e.g. a same-origin pod),
either use the popup or prompt package directly, or fork this worker
to add the path to your match list.

## IDB-realm-portability assumption

The underlying `@uvdsl/solid-oidc-client-browser` core build keeps a
non-extractable DPoP keypair in IndexedDB at `(soidc, session)`. We
verified by reading the published source that:

- The default DB / store names are realm-agnostic constants — `'soidc'`
  / `'session'` — so the SW reads the same objects the page wrote.
- `CryptoKey` (and therefore `CryptoKeyPair`) is structured-cloneable;
  IDB persists the keypair in a form readable from any same-origin
  realm, including service workers.
- `SessionCore` (from the `/core` subpath) does NOT depend on
  `window`, `SharedWorker`, or `beforeunload` — those live in the
  `web` build's `WebWorkerSession` subclass which we do not import.

The library's only realm-bound assumption is that `window.crypto` is
available (used internally for `randomUUID()` JTIs). Service workers
have `crypto` on the global, so we install a one-line shim at the top
of the worker bundle that aliases `globalThis.window` to the worker
scope. This is a forward-compat note: if a future upstream release
removes the `window.crypto.*` calls in favour of `crypto.*`, the shim
becomes a no-op.

## Limitations

- Same-origin pods need a different approach (see above).
- The SW must be served from the same origin as your app. That's the
  shared-IndexedDB requirement and is non-negotiable.
- Auth scope is controlled by the `authOrigins` allowlist (a list of
  scheme+host+port strings) rather than a JS predicate, because
  functions can't be serialised across `postMessage`. URL-pattern
  matching beyond origins (e.g. "only `/private/*`") isn't supported
  yet — file an issue if you need it.
- The SW currently ignores Range requests / streaming bodies in the
  retry path — `Request.clone()` covers most cases but `ReadableStream`
  bodies that pre-consumed before the 401 will fail the retry. Use
  the popup/prompt packages for those workloads.

## License

MIT
