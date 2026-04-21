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

## Publishing

Versioning is driven by [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: …` → minor bump
- `fix: …` → patch bump
- A `BREAKING CHANGE:` footer (or `!` after the type, e.g. `feat!:`) → major bump

Releases trigger automatically on every push to `main` via [`.github/workflows/release.yml`](.github/workflows/release.yml). The workflow authenticates to npm via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) — no `NPM_TOKEN` secret is required.

### Adding a new publishable package

1. Publish the first version manually from your machine:

   ```bash
   npm login
   pnpm --filter <package-name> publish
   ```

2. On npmjs.com, go to **https://www.npmjs.com/package/\<package-name\>/access** and add a Trusted Publisher pointing at:
   - Repository: `jeswr/reactive-fetch`
   - Workflow: `release.yml`

3. Subsequent releases flow through CI automatically — no token needed.

Once Trusted Publishers are configured for both `@jeswr/solid-reactive-fetch` and `@jeswr/solid-reactive-fetch-react`, the `NPM_TOKEN` repo secret can be deleted.

## Deploying this repo

### Prerequisites (one-time, user action required)

Before the GitHub Pages workflow can publish the live demo:

1. **Enable Pages** — go to **Settings → Pages** on GitHub and set **Source** to **GitHub Actions**. The `deploy-pages.yml` workflow uses `actions/configure-pages@v5` with `enablement: true` so it will auto-enable on first run if org policy allows it; if auto-enablement is blocked (common for org-owned repos) flip the setting manually.

2. **Add repo secrets** for the release workflow:
   - `GH_TOKEN` — personal access token with `repo` + `workflow` scopes (so `semantic-release` can create tags and trigger downstream workflows). GitHub's default `github.token` won't trigger those downstream workflows.

   npm authentication uses Trusted Publishing (OIDC) and does not require an `NPM_TOKEN` secret. See [Publishing](#publishing) for how to configure a Trusted Publisher for each package on npmjs.com.

### After enabling Pages

The `deploy-pages.yml` workflow runs on every push to `main` and publishes:

- `https://jeswr.github.io/reactive-fetch/` — landing page
- `https://jeswr.github.io/reactive-fetch/vanilla-ts/` — vanilla-ts example
- `https://jeswr.github.io/reactive-fetch/react/` — React example

A post-deploy smoke test fetches each subpath and fails the workflow if any returns non-200, so deploy success is always load-bearing.

### Monitoring

`link-check.yml` runs lychee on a daily cron (08:00 UTC), plus on every push and PR, so link rot in READMEs, example HTML, and `package.json` `homepage`/`repository` fields surfaces within 24 hours. Configuration lives in `lychee.toml`.
