// Public-to-other-workspace-packages barrel for test helpers. Surfaced
// via the `./test-helpers` subpath export in this package's
// `package.json` so consuming packages can
// `import { createMockPopup } from '@jeswr/solid-reactive-fetch-shared/test-helpers'`
// without reaching into a sibling package's relative path. Source-only —
// the publish surface (`"files": ["dist"]`) excludes the `test/` tree,
// so these never ship to npm.

export { createMockPopup, type MockPopup } from './mockPopup.js';
export {
  installMockWindowOpen,
  type MockWindowOpenStub,
} from './mockWindowOpen.js';
