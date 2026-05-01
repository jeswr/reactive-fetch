import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'vitest';
import {
  expectClassIdentityAcrossChunks,
  expectSharedChunkAcrossEntries,
} from '@jeswr/solid-reactive-fetch-shared/dist-smoke';

// Same shared-class-identity contract as core — see that package's
// dist-smoke.test.ts for the rationale.

const distDir = resolve(process.cwd(), 'dist');
const rootEntry = resolve(distDir, 'index.js');
const callbackEntry = resolve(distDir, 'callback', 'index.js');

const distBuilt = existsSync(rootEntry) && existsSync(callbackEntry);

describe.skipIf(!distBuilt)('built dist: shared-class identity across entries', () => {
  test('root and callback bundles import shared internals from the same chunk', () => {
    expectSharedChunkAcrossEntries({ distDir, rootEntry, subpathEntry: callbackEntry });
  });

  test('InvalidWebIdError class identity is preserved across root + chunk', async () => {
    await expectClassIdentityAcrossChunks({
      distDir,
      rootEntry,
      subpathEntry: callbackEntry,
      classNames: ['InvalidWebIdError'],
    });
  });
});
