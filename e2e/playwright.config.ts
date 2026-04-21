import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config.
 *
 * Timeouts are intentionally tight (local CSS + Vite are fast, so regressions
 * show up quickly). Specs that legitimately need longer — the full OIDC
 * redirect cycle takes ~10–15s in chromium — should call
 * `test.setTimeout(30_000)` locally rather than relaxing the default.
 *
 * Servers (CSS and the vanilla-ts app) come up via Playwright's `webServer`
 * with `reuseExistingServer: !CI` so local dev doesn't re-spawn them on
 * every run. CI always spawns fresh for reproducibility.
 *
 * For tight inner-loop dev: start CSS yourself with `pnpm dev:css` and set
 * `E2E_CSS_URL=http://localhost:3000` (optionally `E2E_APP_URL` too). Any
 * URL set via those env vars disables the matching webServer entry, so
 * Playwright just reuses what you already have running.
 */

const CSS_URL = process.env['E2E_CSS_URL'] ?? 'http://localhost:3000';
const APP_URL = process.env['E2E_APP_URL'] ?? 'http://localhost:5173';

const CSS_PORT = new URL(CSS_URL).port || '3000';

const isCI = !!process.env['CI'];

const webServer = [
  ...(process.env['E2E_CSS_URL']
    ? []
    : [
        {
          command: `node ./scripts/start-css.mjs --port ${CSS_PORT}`,
          // Poll the alice pod root rather than the OIDC discovery endpoint.
          // Discovery responds before account seeding finishes; a GET on the
          // pod only succeeds once the SeededAccountInitializer has run.
          url: `${CSS_URL}/alice/`,
          reuseExistingServer: !isCI,
          timeout: 120_000,
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
        },
      ]),
  ...(process.env['E2E_APP_URL']
    ? []
    : [
        {
          command: `pnpm --filter @jeswr/example-vanilla-ts dev`,
          url: APP_URL,
          reuseExistingServer: !isCI,
          timeout: 60_000,
          stdout: 'pipe' as const,
          stderr: 'pipe' as const,
        },
      ]),
];

export default defineConfig({
  testDir: './tests',
  testIgnore: /demo\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  timeout: 15_000,
  expect: { timeout: 3_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: APP_URL,
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        contextOptions: {
          permissions: [],
        },
      },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer,
});
