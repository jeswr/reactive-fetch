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
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import open from 'open';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const CSS_PORT = Number(process.env.CSS_PORT ?? 3000);
const CSS_BASE = `http://localhost:${CSS_PORT}`;
const CSS_DATA_DIR = resolve(repoRoot, '.css-data');
const SEED_CONFIG = resolve(__dirname, 'seed.json');

const VANILLA_PORT = 5173;
const VANILLA_URL = `http://localhost:${VANILLA_PORT}`;
const REACT_PORT = 5174;
const REACT_URL = `http://localhost:${REACT_PORT}`;

const children = [];
let shuttingDown = false;

function registerChild(name, child) {
  children.push({ name, child });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
      shutdown(1);
    }
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down…');
  for (const { name, child } of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    try {
      child.kill('SIGTERM');
    } catch (err) {
      console.warn(`[${name}] failed to send SIGTERM: ${err instanceof Error ? err.message : err}`);
    }
  }
  // Give children a moment to exit gracefully, then force-kill.
  await Promise.race([
    Promise.all(
      children.map(({ child }) =>
        child.exitCode !== null || child.signalCode !== null
          ? Promise.resolve()
          : once(child, 'exit').then(() => undefined),
      ),
    ),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => { void shutdown(0); });
process.on('SIGTERM', () => { void shutdown(0); });

async function waitForHttp(url, { timeoutMs = 60_000, intervalMs = 500, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    if (shuttingDown) throw new Error('aborted');
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok || res.status === 404) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const hint = lastErr instanceof Error ? ` (last error: ${lastErr.message})` : '';
  throw new Error(`Timed out waiting for ${label ?? url}${hint}`);
}

function startCss() {
  if (!existsSync(SEED_CONFIG)) {
    throw new Error(`Seed config not found at ${SEED_CONFIG}`);
  }
  const args = [
    '@solid/community-server',
    '-p', String(CSS_PORT),
    '-c', '@css:config/file.json',
    '-f', CSS_DATA_DIR,
    '-l', 'warn',
    '--seedConfig', SEED_CONFIG,
  ];
  const child = spawn('npx', args, {
    cwd: repoRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env },
  });
  registerChild('css', child);
  return child;
}

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
  registerChild(name, child);
  return child;
}

function banner() {
  const rule = '━'.repeat(56);
  const lines = [
    rule,
    ` Community Solid Server → ${CSS_BASE}`,
    rule,
    ' Seeded accounts (all password: password123):',
    `   alice → WebID ${CSS_BASE}/alice/profile/card#me`,
    `   bob   → WebID ${CSS_BASE}/bob/profile/card#me`,
    rule,
    ` Sample apps    → ${VANILLA_URL} (vanilla-ts, opens in browser)`,
    `                 → ${REACT_URL} (react)`,
    rule,
    ' Opening browser… (Ctrl+C to stop everything)',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  console.log(`Starting Community Solid Server on ${CSS_BASE}…`);
  startCss();
  await waitForHttp(`${CSS_BASE}/.well-known/openid-configuration`, {
    timeoutMs: 120_000,
    label: 'CSS OIDC discovery',
  });

  console.log(`Starting vanilla-ts dev server on ${VANILLA_URL}…`);
  startExampleDev('vanilla-ts', '@jeswr/example-vanilla-ts');
  console.log(`Starting React dev server on ${REACT_URL}…`);
  startExampleDev('react', '@jeswr/example-react');
  await Promise.all([
    waitForHttp(VANILLA_URL, { timeoutMs: 60_000, label: 'vanilla-ts dev server' }),
    waitForHttp(REACT_URL, { timeoutMs: 60_000, label: 'react dev server' }),
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
  void shutdown(1);
});
