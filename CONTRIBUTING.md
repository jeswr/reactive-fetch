# Contributing to reactive-fetch

Maintainer-facing guide. See [`README.md`](README.md) for the user-facing API and [`CLAUDE.md`](CLAUDE.md) for design rationale.

## Repository layout

```
reactive-fetch/
├── packages/
│   ├── core/             # @jeswr/solid-reactive-fetch
│   ├── react/            # @jeswr/solid-reactive-fetch-react
│   ├── sw/               # @jeswr/solid-reactive-fetch-sw
│   ├── driver-prompt/    # @jeswr/solid-reactive-fetch-driver-prompt
│   └── shared/           # @jeswr/solid-reactive-fetch-shared (primitives)
├── examples/             # vanilla-ts, react demos, callback page, client-id-document
├── e2e/                  # Playwright end-to-end tests
└── .github/              # CI (ci.yml), release (release.yml), dependabot, etc.
```

## Tooling

- **pnpm 10** (set via `packageManager`) — `pnpm install` from root.
- **TypeScript 5.7** with `moduleResolution: "Bundler"`, strict + `noUncheckedIndexedAccess`.
- **tsup** for builds (ESM-only, DTS + source maps).
- **vitest 4** for unit tests; **Playwright** for e2e.
- **multi-semantic-release** for automated, per-package versioning + publishing on push to `main`.

## Common scripts

| Command | Does |
| --- | --- |
| `pnpm install` | Install all workspace deps. |
| `pnpm -r build` | Build every `packages/*`. |
| `pnpm -r dev` | Watch-build every `packages/*` in parallel. |
| `pnpm -r test` | Run vitest in every `packages/*`. |
| `pnpm -r typecheck` | `tsc --noEmit` in every `packages/*`. |
| `pnpm test:e2e` | Run Playwright e2e (needs `pnpm test:e2e:install` first). |

Per-package scripts mirror the root ones.

## Tests

All test files live under each package's `test/` directory. The `src/` tree is source-only; nothing in `src/**/*.test.ts(x)` should exist.

Test fixtures shared across packages (popup mocks, `window.open` shim, etc.) live in [`packages/shared/test/helpers/`](packages/shared/test/helpers/) and are exposed via the `@jeswr/solid-reactive-fetch-shared/test-helpers` subpath.

## Releases

Releases are automated via [semantic-release](https://github.com/semantic-release/semantic-release). Every push to `main` runs [`multi-semantic-release`](https://github.com/qiwi/multi-semantic-release), which publishes each `packages/*` independently to npm and GitHub Packages based on its own conventional-commit history.

Versioning is driven by [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: …` → minor bump
- `fix: …` → patch bump
- A `BREAKING CHANGE:` footer (or `!` after the type, e.g. `feat!:`) → major bump

The release workflow lives at [`.github/workflows/release.yml`](.github/workflows/release.yml). It authenticates to npm via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC) — no `NPM_TOKEN` secret is required.

### Adding a new publishable package

1. Publish the first version manually:

   ```bash
   npm login
   pnpm --filter <package-name> publish
   ```

2. On npmjs.com, go to **https://www.npmjs.com/package/\<package-name\>/access** and add a Trusted Publisher pointing at:
   - Repository: `jeswr/reactive-fetch`
   - Workflow: `release.yml`

3. Subsequent releases flow through CI automatically — no token needed.

## Deploying the demo (one-time setup)

Before the GitHub Pages workflow can publish the live demo:

1. **Enable Pages** — Settings → Pages on GitHub, set **Source** to **GitHub Actions**. The `deploy-pages.yml` workflow uses `actions/configure-pages@v5` with `enablement: true`, so it auto-enables on first run when org policy allows; flip the setting manually if not.

2. **Add the `GH_TOKEN` repo secret** — a personal access token with `repo` + `workflow` scopes so `semantic-release` can create tags and trigger downstream workflows. GitHub's default `github.token` won't trigger those.

   npm authentication uses Trusted Publishing (OIDC) and does not require `NPM_TOKEN`.

After enabling Pages, [`deploy-pages.yml`](.github/workflows/deploy-pages.yml) runs on every push to `main` and publishes:

- `https://jeswr.github.io/reactive-fetch/` — landing page
- `https://jeswr.github.io/reactive-fetch/vanilla-ts/` — vanilla-ts example
- `https://jeswr.github.io/reactive-fetch/react/` — React example

A post-deploy smoke test fetches each subpath and fails the workflow if any returns non-200, so deploy success is always load-bearing.

## Monitoring

[`link-check.yml`](.github/workflows/link-check.yml) runs lychee on a daily cron (08:00 UTC), plus on every push and PR, so link rot in READMEs, example HTML, and `package.json` `homepage`/`repository` fields surfaces within 24 hours. Configuration lives in `lychee.toml`.

## Code review

This repo uses [roborev](https://www.roborev.io) for continuous review of AI-generated commits. Run `roborev init` once, then `roborev` to browse findings.
