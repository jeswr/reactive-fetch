/**
 * Shared helpers for launching a seeded Community Solid Server and wiring up
 * orderly shutdown of child processes. Consumed by `dev-testbed.mjs` and
 * `dev-css.mjs`.
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const scriptsDir = resolve(__dirname, '..');
export const repoRoot = resolve(scriptsDir, '..');

export const CSS_PORT = Number(process.env.CSS_PORT ?? 3000);
export const CSS_BASE = `http://localhost:${CSS_PORT}`;
export const CSS_DATA_DIR = resolve(repoRoot, '.css-data');
export const SEED_CONFIG = resolve(scriptsDir, 'seed.json');

export const SEEDED_ACCOUNTS = [
  { name: 'alice', email: 'alice@example.com' },
  { name: 'bob', email: 'bob@example.com' },
];
export const SEEDED_PASSWORD = 'password123';

export function cssBannerLines() {
  const lines = [
    ` Community Solid Server → ${CSS_BASE}`,
    ` Data dir               → ${CSS_DATA_DIR}`,
    ` Seeded accounts (all password: ${SEEDED_PASSWORD}):`,
  ];
  for (const { name } of SEEDED_ACCOUNTS) {
    const padded = name.padEnd(5, ' ');
    lines.push(`   ${padded} → WebID ${CSS_BASE}/${name}/profile/card#me`);
  }
  return lines;
}

export function createChildRegistry() {
  const children = [];
  let shuttingDown = false;

  const registerChild = (name, child) => {
    children.push({ name, child });
    child.on('exit', (code, signal) => {
      if (shuttingDown) return;
      if (code !== 0 && code !== null) {
        console.error(
          `[${name}] exited with code ${code}${signal ? ` (signal ${signal})` : ''}`,
        );
        void shutdown(1);
      }
    });
  };

  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down…');
    for (const { name, child } of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      try {
        child.kill('SIGTERM');
      } catch (err) {
        console.warn(
          `[${name}] failed to send SIGTERM: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
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
  };

  process.on('SIGINT', () => { void shutdown(0); });
  process.on('SIGTERM', () => { void shutdown(0); });

  return {
    registerChild,
    shutdown,
    isShuttingDown: () => shuttingDown,
  };
}

export async function waitForHttp(url, options = {}) {
  const {
    timeoutMs = 60_000,
    intervalMs = 500,
    label,
    isShuttingDown,
  } = options;
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    if (isShuttingDown?.()) throw new Error('aborted');
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

export function startCss({ registerChild }) {
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

export async function waitForCssReady({ isShuttingDown } = {}) {
  await waitForHttp(`${CSS_BASE}/.well-known/openid-configuration`, {
    timeoutMs: 120_000,
    label: 'CSS OIDC discovery',
    isShuttingDown,
  });
}

export function makeRule(width = 56) {
  return '━'.repeat(width);
}
