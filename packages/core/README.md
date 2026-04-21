# @jeswr/solid-reactive-fetch

[![CI](https://img.shields.io/github/actions/workflow/status/jeswr/reactive-fetch/ci.yml?branch=main)](https://github.com/jeswr/reactive-fetch/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jeswr/solid-reactive-fetch)](https://www.npmjs.com/package/@jeswr/solid-reactive-fetch)
[![npm downloads](https://img.shields.io/npm/dw/@jeswr/solid-reactive-fetch)](https://www.npmjs.com/package/@jeswr/solid-reactive-fetch)

Reactive authenticated `fetch` for Solid applications. Authentication is triggered automatically — no explicit `login()` or `logout()`.

```ts
import { createReactiveFetch } from '@jeswr/solid-reactive-fetch';

const rf = createReactiveFetch({
  clientId: 'https://myapp.example/solid-client.jsonld',
});

// Reading webId triggers the login popup if no session is active.
const webId = await rf.webId;

// Fetching a private resource: tries unauthenticated first, retries with DPoP-bound auth on 401.
const res = await rf.fetch('https://pod.example/private-resource');
```

## SSR usage

`createReactiveFetch` is **browser-only** and will throw if called without `window` or `indexedDB`. The underlying Session keeps its DPoP keypair and refresh token in IndexedDB, and a long-lived Node process would leak that state across user requests.

In Next.js / Remix / SvelteKit, construct the factory inside a client-only code path:

- Next.js app router: a `"use client"` component
- Remix / SvelteKit: inside `useEffect` (Remix) or a `$lib` imported only from a `+page.svelte` that runs client-side, or gate with `typeof window !== 'undefined'`
- Any bundler: dynamic-import the module (`await import('@jeswr/solid-reactive-fetch')`) from code that only runs in the browser

React hooks (`@jeswr/solid-reactive-fetch-react`) are SSR-safe in the sense that `useWebId` suspends during the server pass — so a server-rendered `<Suspense fallback={…}>` renders the fallback — but they still require the `createReactiveFetch()` call itself to happen on the client.

Status: **under construction**. See the repo root for design notes.
