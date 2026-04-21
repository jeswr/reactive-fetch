#!/usr/bin/env node
// Boots a Community Solid Server for Playwright e2e tests.
//
// Uses the CSS CLI (same approach as `scripts/dev-testbed.mjs`) so behaviour
// matches what developers see locally. Writes a fresh seed config, deletes
// `.css-data`, and forwards CSS's stdout/stderr. Shuts down on SIGTERM.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const e2eRoot = resolve(__dirname, '..');
const repoRoot = resolve(e2eRoot, '..');

function parsePort(argv) {
  const idx = argv.indexOf('--port');
  if (idx === -1) return 3000;
  const raw = argv[idx + 1];
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid --port value: ${raw}`);
  }
  return parsed;
}

const port = parsePort(process.argv);
const dataDir = resolve(e2eRoot, '.css-data');
const seedPath = resolve(e2eRoot, '.css-seed.json');

const seed = [
  { email: 'alice@example.com', password: 'password123', pods: [{ name: 'alice' }] },
  { email: 'bob@example.com', password: 'password123', pods: [{ name: 'bob' }] },
];

// Fresh state every start. Seeding an already-existing account errors out.
await rm(dataDir, { recursive: true, force: true });
await mkdir(dataDir, { recursive: true });
await writeFile(seedPath, JSON.stringify(seed, null, 2));

const args = [
  '@solid/community-server',
  '-p', String(port),
  '-c', '@css:config/file.json',
  '-f', dataDir,
  '-l', 'warn',
  '--seedConfig', seedPath,
];

const child = spawn('npx', args, {
  cwd: repoRoot,
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env },
});

child.on('exit', (code, signal) => {
  if (code !== null && code !== 0) {
    process.exitCode = code;
  }
  if (signal) {
    process.kill(process.pid, signal);
  }
});

const shutdown = (signal) => {
  if (!child.killed) {
    try { child.kill(signal); } catch { /* ignore */ }
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
