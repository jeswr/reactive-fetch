# reactive-fetch

[![CI](https://img.shields.io/github/actions/workflow/status/jeswr/reactive-fetch/ci.yml?branch=main)](https://github.com/jeswr/reactive-fetch/actions/workflows/ci.yml)
[![npm (@jeswr/solid-reactive-fetch)](https://img.shields.io/npm/v/@jeswr/solid-reactive-fetch?label=%40jeswr%2Fsolid-reactive-fetch)](https://www.npmjs.com/package/@jeswr/solid-reactive-fetch)
[![npm (@jeswr/solid-reactive-fetch-react)](https://img.shields.io/npm/v/@jeswr/solid-reactive-fetch-react?label=%40jeswr%2Fsolid-reactive-fetch-react)](https://www.npmjs.com/package/@jeswr/solid-reactive-fetch-react)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-blue?logo=dependabot)](.github/dependabot.yml)

A reactive authenticated `fetch` for Solid applications, driven by a popup-based login flow (no browser extension required).

## Demo

The full flow — click, popup login, authenticated fetch — in one 30-second
take:

<video src="./docs/demo.webm" controls muted width="720"></video>

<!-- Once ffmpeg is available, run `pnpm demo:record` to also produce
     docs/demo.mp4 (HTML video fallback) and docs/demo.gif (GitHub web UI
     embed). -->

## Packages

- [`@jeswr/solid-reactive-fetch`](packages/core) — the core framework-agnostic package
- [`@jeswr/solid-reactive-fetch-react`](packages/react) — React hooks

## Development

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm test:e2e     # requires: pnpm test:e2e:install first
```

See [`CLAUDE.md`](CLAUDE.md) for design notes.

## Releases

Releases are fully automated via [semantic-release](https://github.com/semantic-release/semantic-release). Every push to `main` runs [`multi-semantic-release`](https://github.com/qiwi/multi-semantic-release), which publishes each package independently to npm and GitHub Packages based on its own conventional-commit history.
