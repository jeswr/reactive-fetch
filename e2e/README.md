# reactive-fetch e2e tests

Playwright end-to-end tests that exercise the full `@jeswr/solid-reactive-fetch`
flow in a real browser against a real [Community Solid Server].

## Running

From the repo root:

```sh
pnpm install
pnpm build                        # core + react packages
pnpm --filter reactive-fetch-e2e exec playwright install chromium
pnpm test:e2e                     # chromium + firefox
```

Playwright boots both a fresh CSS (on :3000) and the vanilla-ts example
(on :5173) as part of the test run, then tears them down at the end.

## During development

The default `pnpm test:e2e` re-spawns CSS + the Vite dev server on every
invocation. That's fine for CI but adds ~10s per run when you're
iterating on a single spec. For tight inner-loop dev, start CSS yourself
once and point the Playwright config at it:

```sh
# Terminal 1 — run CSS once and leave it
pnpm dev:css

# Terminal 2 — run e2e tests as often as you like
E2E_CSS_URL=http://localhost:3000 pnpm test:e2e
```

Any of these env vars disables the matching `webServer` entry and
reuses whatever is already listening:

| env var         | default                   | what it skips                     |
| --------------- | ------------------------- | --------------------------------- |
| `E2E_CSS_URL`   | `http://localhost:3000`   | `node scripts/start-css.mjs`      |
| `E2E_APP_URL`   | `http://localhost:5173`   | `pnpm --filter @jeswr/example-vanilla-ts dev` |

You can also point at a **remote** CSS (e.g. solidcommunity.net) by
setting `E2E_CSS_URL=https://solidcommunity.net`, though the seeded
`alice` account obviously won't exist there — you'd need to adjust
`fixtures/constants.ts` for that case.

## Timeouts

The suite defaults are deliberately tight:

```ts
timeout: 15_000,
expect:  { timeout: 3_000 },
use: {
  actionTimeout: 5_000,
  navigationTimeout: 10_000,
}
```

The full Solid-OIDC popup dance legitimately needs longer — every spec
that drives login calls `test.setTimeout(30_000)` locally. Don't relax
the suite default; opt in per test so performance regressions in the
fast paths stay visible.

## What the specs cover

| spec                         | flow                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `webid-golden-path.spec.ts`  | click → popup → enter WebID → CSS login → consent → popup closes → WebID shown in opener |
| `authed-fetch.spec.ts`       | logged-in user fetches a private container (only visible with auth)  |
| `session-restore.spec.ts`    | full page reload keeps the session; no popup opens on re-click       |
| `multi-issuer-picker.spec.ts`| WebID with two `solid:oidcIssuer` triples shows the picker           |
| `popup-closed.spec.ts`       | user closes the popup → app surfaces `PopupClosedError`              |
| `401-retry.spec.ts`          | unauthenticated click → 401 → reactive popup → retry succeeds        |
| `demo.spec.ts`               | golden path, paced for human viewing — NOT run by default; see below |

## Demo recording

`demo.spec.ts` is excluded from the default Playwright config so CI
doesn't re-record the video on every build. To re-record:

```sh
pnpm demo:record
```

That script runs the demo spec via `playwright.demo.config.ts` (1280×720,
`slowMo: 400`, `video: 'on'`, chromium only), then invokes `ffmpeg` to
produce `docs/demo.webm`, `docs/demo.mp4`, and `docs/demo.gif`. You need
ffmpeg on `PATH` — `brew install ffmpeg` on macOS.

## Seeded test data

The suite relies on two CSS accounts that `scripts/start-css.mjs` seeds
via `SeededAccountInitializer`:

| email                 | password      | WebID                                              |
| --------------------- | ------------- | -------------------------------------------------- |
| `alice@example.com`   | `password123` | `http://localhost:3000/alice/profile/card#me`      |
| `bob@example.com`     | `password123` | `http://localhost:3000/bob/profile/card#me`        |

Private resources and multi-issuer profiles are created per-test via
the `aliceFetcher` fixture (client-credentials flow → authed PUT).

## Debugging failures

- `e2e/playwright-report/` — HTML report (always written)
- `e2e/test-results/<test-name>/trace.zip` — interactive trace (on retry)
  - Open with `pnpm --filter reactive-fetch-e2e exec playwright show-trace <path>`
- `e2e/test-results/<test-name>/video.webm` — failure-only video
- `e2e/test-results/<test-name>/test-failed-1.png` — screenshot at failure

In CI, `playwright-report/` and `test-results/` are uploaded as
artifacts when the workflow fails (see `.github/workflows/ci.yml`).

[Community Solid Server]: https://github.com/CommunitySolidServer/CommunitySolidServer
