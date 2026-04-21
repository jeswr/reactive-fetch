# reactive-fetch

[![CI](https://img.shields.io/github/actions/workflow/status/jeswr/reactive-fetch/ci.yml?branch=main)](https://github.com/jeswr/reactive-fetch/actions/workflows/ci.yml)
[![npm (@jeswr/solid-reactive-fetch)](https://img.shields.io/npm/v/@jeswr/solid-reactive-fetch?label=%40jeswr%2Fsolid-reactive-fetch)](https://www.npmjs.com/package/@jeswr/solid-reactive-fetch)
[![npm (@jeswr/solid-reactive-fetch-react)](https://img.shields.io/npm/v/@jeswr/solid-reactive-fetch-react?label=%40jeswr%2Fsolid-reactive-fetch-react)](https://www.npmjs.com/package/@jeswr/solid-reactive-fetch-react)
[![Dependabot](https://img.shields.io/badge/Dependabot-enabled-blue?logo=dependabot)](.github/dependabot.yml)

A reactive authenticated `fetch` for Solid applications, driven by a popup-based login flow (no browser extension required).

**Live demo**: <https://jeswr.github.io/reactive-fetch/>

## Demo

The full flow — click, popup login, authenticated fetch — in one 30-second
take:

<video src="./docs/demo.webm" controls muted width="100%"></video>

The left pane is the opener app; the right pane is the login popup (WebID
prompt, CSS login form, consent) so the whole flow is visible in one take.

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

## Deploying this repo

### Prerequisites (one-time, user action required)

Before the GitHub Pages workflow can publish the live demo:

1. **Enable Pages** — go to **Settings → Pages** on GitHub and set **Source** to **GitHub Actions**. The `deploy-pages.yml` workflow uses `actions/configure-pages@v5` with `enablement: true` so it will auto-enable on first run if org policy allows it; if auto-enablement is blocked (common for org-owned repos) flip the setting manually.

2. **Add repo secrets** for the release workflow:
   - `NPM_TOKEN` — npm automation token (classic, or granular with `read:packages write:packages` for the `@jeswr` scope)
   - `GH_TOKEN` — personal access token with `repo` + `workflow` scopes (so `semantic-release` can create tags and trigger downstream workflows). GitHub's default `github.token` won't trigger those downstream workflows.

### After enabling Pages

The `deploy-pages.yml` workflow runs on every push to `main` and publishes:

- `https://jeswr.github.io/reactive-fetch/` — landing page
- `https://jeswr.github.io/reactive-fetch/vanilla-ts/` — vanilla-ts example
- `https://jeswr.github.io/reactive-fetch/react/` — React example

A post-deploy smoke test fetches each subpath and fails the workflow if any returns non-200, so deploy success is always load-bearing.

### Monitoring

`link-check.yml` runs lychee on a daily cron (08:00 UTC), plus on every push and PR, so link rot in READMEs, example HTML, and `package.json` `homepage`/`repository` fields surfaces within 24 hours. Configuration lives in `lychee.toml`.
