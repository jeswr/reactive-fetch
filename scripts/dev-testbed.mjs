#!/usr/bin/env node
/**
 * One-command dev testbed for the reactive-fetch examples.
 *
 * Starts:
 *   - Community Solid Server on http://localhost:3000 (seeded with alice + bob)
 *   - The vanilla-ts example dev server on http://localhost:5173
 *   - The React example dev server on http://localhost:5174
 *
 * Waits for all three to be reachable, prints a banner with credentials +
 * URLs, opens the browser to vanilla-ts, and tears everything down on
 * SIGINT/SIGTERM.
 */

import { spawn } from 'node:child_process';
import open from 'open';
import {
  CSS_BASE,
  createChildRegistry,
  cssBannerLines,
  makeRule,
  repoRoot,
  startCss,
  waitForCssReady,
  waitForHttp,
} from './lib/css.mjs';

const VANILLA_PORT = 5173;
const VANILLA_URL = `http://localhost:${VANILLA_PORT}`;
const REACT_PORT = 5174;
const REACT_URL = `http://localhost:${REACT_PORT}`;

const registry = createChildRegistry();

function startExampleDev(name, filter) {
  const child = spawn(
    'pnpm',
    ['--filter', filter, 'dev'],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env },
    },
  );
  registry.registerChild(name, child);
  return child;
}

function banner() {
  const rule = makeRule();
  return [
    rule,
    ...cssBannerLines(),
    rule,
    ` Sample apps    → ${VANILLA_URL} (vanilla-ts, opens in browser)`,
    `                 → ${REACT_URL} (react)`,
    rule,
    ' Opening browser… (Ctrl+C to stop everything)',
    '',
  ].join('\n');
}

async function main() {
  console.log(`Starting Community Solid Server on ${CSS_BASE}…`);
  startCss(registry);
  await waitForCssReady({ isShuttingDown: registry.isShuttingDown });

  console.log(`Starting vanilla-ts dev server on ${VANILLA_URL}…`);
  startExampleDev('vanilla-ts', '@jeswr/example-vanilla-ts');
  console.log(`Starting React dev server on ${REACT_URL}…`);
  startExampleDev('react', '@jeswr/example-react');
  await Promise.all([
    waitForHttp(VANILLA_URL, {
      timeoutMs: 60_000,
      label: 'vanilla-ts dev server',
      isShuttingDown: registry.isShuttingDown,
    }),
    waitForHttp(REACT_URL, {
      timeoutMs: 60_000,
      label: 'react dev server',
      isShuttingDown: registry.isShuttingDown,
    }),
  ]);

  console.log('\n' + banner());
  try {
    await open(VANILLA_URL);
  } catch (err) {
    console.warn(`Failed to open browser automatically: ${err instanceof Error ? err.message : err}`);
    console.warn(`Open ${VANILLA_URL} manually.`);
  }

  // Keep the orchestrator alive until a child exits or the user hits Ctrl+C.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  void registry.shutdown(1);
});
