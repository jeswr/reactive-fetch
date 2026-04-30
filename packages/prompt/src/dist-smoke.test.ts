import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Built-artifact regression guard, mirrored from core. Ensures tsup's ESM
// code splitting keeps the inlined `@jeswr/solid-reactive-fetch-shared`
// classes in a single chunk shared by the root and callback entries, so
// `instanceof` checks remain consistent across entry points.

const distDir = resolve(process.cwd(), 'dist');
const rootEntry = resolve(distDir, 'index.js');
const callbackEntry = resolve(distDir, 'callback', 'index.js');

const distBuilt = existsSync(rootEntry) && existsSync(callbackEntry);

describe.skipIf(!distBuilt)('built dist: shared-class identity across entries', () => {
  test('root and callback bundles import shared internals from the same chunk', () => {
    const rootSrc = readFileSync(rootEntry, 'utf8');
    const cbSrc = readFileSync(callbackEntry, 'utf8');

    const rootChunkRef = rootSrc.match(/from\s+['"]\.\/(chunk-[^'"\s]+\.js)['"]/);
    const cbChunkRef = cbSrc.match(/from\s+['"]\.\.\/(chunk-[^'"\s]+\.js)['"]/);

    expect(rootChunkRef, 'root entry must import a shared chunk').not.toBeNull();
    expect(cbChunkRef, 'callback entry must import a shared chunk').not.toBeNull();
    expect(cbChunkRef![1]).toBe(rootChunkRef![1]);

    expect(readdirSync(distDir)).toContain(rootChunkRef![1]);
  });

  test('InvalidWebIdError loaded from root and shared chunk is the same constructor', async () => {
    const root: Record<string, unknown> = await import(rootEntry);
    const cbSrc = readFileSync(callbackEntry, 'utf8');
    const chunkName = cbSrc.match(/from\s+['"]\.\.\/(chunk-[^'"\s]+\.js)['"]/)?.[1];
    expect(chunkName).toBeTruthy();
    const chunk: Record<string, unknown> = await import(resolve(distDir, chunkName!));

    expect(typeof root['InvalidWebIdError']).toBe('function');
    expect(chunk['InvalidWebIdError']).toBe(root['InvalidWebIdError']);
  });
});
