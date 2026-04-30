import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Built-artifact regression guard. The page-side `dist/index.js` is
// published to npm; if it ever started referencing the unpublished
// `@jeswr/solid-reactive-fetch-shared` package, consumers would fail to
// install. This test only asserts on the static shape — no instanceof
// assertions, because the page-side bundle has no inlined classes whose
// identity could split (it imports only typed message constants).

const distDir = resolve(process.cwd(), 'dist');
const pageEntry = resolve(distDir, 'index.js');
const pageDts = resolve(distDir, 'index.d.ts');
const workerBundle = resolve(distDir, 'worker.js');

const pageBuilt = existsSync(pageEntry) && existsSync(pageDts);
const workerBuilt = existsSync(workerBundle);

describe.skipIf(!pageBuilt)('built dist: page bundle is self-contained', () => {
  test('dist/index.js does not reference @jeswr/solid-reactive-fetch-shared', () => {
    const src = readFileSync(pageEntry, 'utf8');
    expect(src.includes('@jeswr/solid-reactive-fetch-shared')).toBe(false);
  });

  test('dist/index.d.ts does not reference @jeswr/solid-reactive-fetch-shared', () => {
    const src = readFileSync(pageDts, 'utf8');
    expect(src.includes('@jeswr/solid-reactive-fetch-shared')).toBe(false);
  });
});

describe.skipIf(!workerBuilt)('built dist: worker bundle is self-contained', () => {
  test('dist/worker.js does not reference @jeswr/solid-reactive-fetch-shared', () => {
    const src = readFileSync(workerBundle, 'utf8');
    expect(src.includes('@jeswr/solid-reactive-fetch-shared')).toBe(false);
  });

  test('dist/worker.js does not reference @uvdsl/solid-oidc-client-browser', () => {
    // Worker is fully bundled — uvdsl is also inlined so consumers can drop
    // a single file in their public dir.
    const src = readFileSync(workerBundle, 'utf8');
    expect(src.includes("from '@uvdsl/solid-oidc-client-browser")).toBe(false);
  });
});
