import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Built-artifact regression guard. If `dist/` is missing (fresh checkout, no
// build yet) the suite is skipped — CI runs `pnpm build && pnpm test`, which
// satisfies the precondition. The concern, per roborev review of f467e8f:
// inlining `@jeswr/solid-reactive-fetch-shared` via tsup `noExternal` while
// splitting was disabled emitted two copies of every shared class, so an
// `InvalidWebIdError` thrown from `…/callback` failed `instanceof` checks
// against the same class imported from the root entry. Code splitting hoists
// shared internals into a single chunk; this test pins that contract.

const distDir = resolve(__dirname, '..', 'dist');
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

    // And the chunk file must actually be present.
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
