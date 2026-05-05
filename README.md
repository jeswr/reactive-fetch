# reactive-fetch

[![CI](https://img.shields.io/github/actions/workflow/status/jeswr/reactive-fetch/ci.yml?branch=main)](https://github.com/jeswr/reactive-fetch/actions/workflows/ci.yml)
[![npm (@jeswr/solid-reactive-fetch)](https://img.shields.io/npm/v/@jeswr/solid-reactive-fetch?label=%40jeswr%2Fsolid-reactive-fetch)](https://www.npmjs.com/package/@jeswr/solid-reactive-fetch)

A reactive authenticated `fetch` for [Solid](https://solidproject.org/) applications. Authentication is triggered automatically by the act of using a resource — no explicit `login()` call required, no browser extension, no per-call-site change.

**Live demo**: <https://jeswr.github.io/reactive-fetch/>

```ts
import { createReactiveFetch } from '@jeswr/solid-reactive-fetch';

const rf = createReactiveFetch({
  clientId: 'https://myapp.example/solid-client.jsonld',
  callbackUrl: 'https://myapp.example/reactive-fetch-callback',
});

// Reading webId triggers the login popup if no session is active.
const webId = await rf.webId;

// Tries unauthenticated first; on 401 retries with DPoP-bound auth.
const res = await rf.fetch('https://pod.example/private-resource');
```

## Packages

| Package | Description |
| --- | --- |
| [`@jeswr/solid-reactive-fetch`](packages/core/) | The core framework-agnostic library — popup-based login, reactive `fetch`, extension-shaped `solid` facade. **Start here.** |
| [`@jeswr/solid-reactive-fetch-react`](packages/react/) | React hooks (`useWebId`, `useSolidFetch`) and `<ReactiveFetchProvider>`. |
| [`@jeswr/solid-reactive-fetch-sw`](packages/sw/) | Service-worker variant — intercepts the unmodified global `fetch` so apps don't need an explicit `rf.fetch` wrapper. |
| [`@jeswr/solid-reactive-fetch-shared`](packages/shared/) | Shared primitives (errors, session bootstrap, popup orchestration, the `WebIdDriver` contract). Most apps don't import this directly. |

## Demo video

The full flow — click, popup login, authenticated fetch — in one 30-second take:

<video src="./docs/demo.webm" controls muted width="100%"></video>

The left pane is the opener app; the right pane is the login popup (WebID prompt, CSS login form, consent) so the whole flow is visible in one take.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, release process, GitHub Pages setup, npm Trusted Publisher configuration, and CI/monitoring details.

Quick start for development:

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm test:e2e     # requires: pnpm test:e2e:install first
```

## License

MIT
