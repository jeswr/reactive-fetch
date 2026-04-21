/**
 * Playwright config for the demo recording. Separate from the main
 * `playwright.config.ts` so `pnpm test:e2e` stays lean and doesn't
 * re-record the video on every build.
 *
 * Run via `pnpm demo:record` from the repo root; that script will also
 * convert the resulting webm to mp4 + gif via ffmpeg.
 *
 * Design notes:
 *  - chromium only. Firefox's popup opening is less reliable under
 *    Playwright and we want the cleanest possible recording.
 *  - `slowMo: 400` paces each action by ~400ms so a human watching the
 *    resulting video can follow along without frame-stepping.
 *  - viewport 1280x720 is a balance between legibility and file size;
 *    the UI is laid out inside a 720px-wide column so most of the vertical
 *    height is "wasted" — we accept that for symmetry with README images.
 *  - `video.size` must match the viewport; Playwright will silently
 *    downscale otherwise.
 */

import { defineConfig, devices } from '@playwright/test';

const CSS_PORT = Number(process.env['CSS_PORT'] ?? 3000);
const APP_PORT = Number(process.env['APP_PORT'] ?? 5173);
const CSS_URL = `http://localhost:${CSS_PORT}`;
const APP_URL = `http://localhost:${APP_PORT}`;

export default defineConfig({
  testDir: './tests',
  testMatch: /demo\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Recording runs longer than a normal spec because of slowMo pacing.
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: APP_URL,
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    video: {
      mode: 'on',
      size: { width: 1280, height: 720 },
    },
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      slowMo: 400,
    },
  },
  outputDir: 'demo-output',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `node ./scripts/start-css.mjs --port ${CSS_PORT}`,
      url: `${CSS_URL}/.well-known/openid-configuration`,
      reuseExistingServer: true,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @jeswr/example-vanilla-ts dev',
      url: APP_URL,
      reuseExistingServer: true,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
