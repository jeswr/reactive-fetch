// Cross-package smoke test: assert both the public entry and the callback
// subpath import cleanly and expose a function. The build wires the two
// subpaths separately (`./` and `./callback`) so this catches a future
// `package.json#exports` regression at unit-test time.

import { expect, test } from 'vitest';
import { createReactiveFetchPrompt } from './index.js';
import { mountCallback } from './callback/index.js';

test('createReactiveFetchPrompt is a function', () => {
  expect(typeof createReactiveFetchPrompt).toBe('function');
});

test('mountCallback is a function', () => {
  expect(typeof mountCallback).toBe('function');
});
