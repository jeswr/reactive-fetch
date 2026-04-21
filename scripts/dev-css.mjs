#!/usr/bin/env node
/**
 * Standalone Community Solid Server launcher for local development.
 *
 * Starts CSS on http://localhost:3000 (seeded with alice + bob), waits for it
 * to be reachable, prints the seeded account info, and stays alive until the
 * user hits Ctrl+C. Unlike `dev-testbed.mjs`, this script does not start any
 * example dev servers or open a browser — intended for workflows where a
 * separate process (E2E runner, ad-hoc curl, a different sample app) drives
 * CSS over a long-running handle.
 */

import {
  CSS_BASE,
  createChildRegistry,
  cssBannerLines,
  makeRule,
  startCss,
  waitForCssReady,
} from './lib/css.mjs';

const registry = createChildRegistry();

function banner() {
  const rule = makeRule();
  return [
    rule,
    ...cssBannerLines(),
    rule,
    ' CSS is running. Leave this terminal open; Ctrl+C to stop.',
    '',
  ].join('\n');
}

async function main() {
  console.log(`Starting Community Solid Server on ${CSS_BASE}…`);
  startCss(registry);
  await waitForCssReady({ isShuttingDown: registry.isShuttingDown });

  console.log('\n' + banner());

  // Keep the process alive until CSS exits or the user hits Ctrl+C.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  void registry.shutdown(1);
});
