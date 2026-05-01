import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'vitest';
import {
  expectClassIdentityAcrossChunks,
  expectSharedChunkAcrossEntries,
} from '@jeswr/solid-reactive-fetch-shared/dist-smoke';

// Pinning roborev's f769d27 finding: shared classes inlined via tsup
// `noExternal` MUST live in a single chunk shared by both entries, otherwise
// `instanceof` checks fail across `@jeswr/solid-reactive-fetch` and
// `@jeswr/solid-reactive-fetch/callback` imports in the same realm.

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
