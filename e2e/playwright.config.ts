import { defineConfig, devices } from '@playwright/test';

const CSS_PORT = Number(process.env['CSS_PORT'] ?? 3000);
const APP_PORT = Number(process.env['APP_PORT'] ?? 5173);
const CSS_URL = `http://localhost:${CSS_PORT}`;
const APP_URL = `http://localhost:${APP_PORT}`;

const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './tests',
  testIgnore: /demo\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: APP_URL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
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
  webServer: [
    {
      command: `node ./scripts/start-css.mjs --port ${CSS_PORT}`,
      url: `${CSS_URL}/.well-known/openid-configuration`,
      reuseExistingServer: !isCI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm --filter @jeswr/example-vanilla-ts dev`,
      url: APP_URL,
      reuseExistingServer: !isCI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
