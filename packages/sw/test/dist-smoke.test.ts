import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, test } from 'vitest';
import { expectNoReferences } from '@jeswr/solid-reactive-fetch-shared/dist-smoke';

// The worker bundle is shipped to consumers as a single ESM file they
// drop into their public dir. Verify it doesn't reference any
// unbundled-at-runtime peer deps that wouldn't resolve in the SW realm.
//
// (The page-side bundle resolves `@jeswr/solid-reactive-fetch-shared`
// through the npm tree like any other package — no smoke test needed.)

const distDir = resolve(process.cwd(), 'dist');
const workerBundle = resolve(distDir, 'worker.js');
const workerBuilt = existsSync(workerBundle);

describe.skipIf(!workerBuilt)('built dist: worker bundle is self-contained', () => {
  test('dist/worker.js inlines shared and the OIDC client', () => {
    expectNoReferences(workerBundle, [
      '@jeswr/solid-reactive-fetch-shared',
      "from '@uvdsl/solid-oidc-client-browser",
    ]);
  });
});
