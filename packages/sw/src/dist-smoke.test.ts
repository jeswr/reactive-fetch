import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'vitest';
import { expectNoReferences } from '@jeswr/solid-reactive-fetch-shared/dist-smoke';

// The page-side `dist/index.js` is published to npm; if it ever started
// referencing the unpublished `@jeswr/solid-reactive-fetch-shared`
// package, consumers would fail to install. The worker bundle is fully
// inlined (uvdsl + shared) so consumers can drop a single file in their
// public dir. No class-identity assertions are needed here — the page-side
// bundle has no inlined classes, just typed message constants.

const distDir = resolve(process.cwd(), 'dist');
const pageEntry = resolve(distDir, 'index.js');
const pageDts = resolve(distDir, 'index.d.ts');
const workerBundle = resolve(distDir, 'worker.js');

const pageBuilt = existsSync(pageEntry) && existsSync(pageDts);
const workerBuilt = existsSync(workerBundle);

describe.skipIf(!pageBuilt)('built dist: page bundle is self-contained', () => {
  test('dist/index.js does not reference @jeswr/solid-reactive-fetch-shared', () => {
    expectNoReferences(pageEntry, ['@jeswr/solid-reactive-fetch-shared']);
  });

  test('dist/index.d.ts does not reference @jeswr/solid-reactive-fetch-shared', () => {
    expectNoReferences(pageDts, ['@jeswr/solid-reactive-fetch-shared']);
  });
});

describe.skipIf(!workerBuilt)('built dist: worker bundle is self-contained', () => {
  test('dist/worker.js inlines all unpublished or peer-only deps', () => {
    expectNoReferences(workerBundle, [
      '@jeswr/solid-reactive-fetch-shared',
      "from '@uvdsl/solid-oidc-client-browser",
    ]);
  });
});
