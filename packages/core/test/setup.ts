// Test bootstrap. Side effects only — installs fake-indexeddb, polyfills
// `globalThis.crypto.subtle`, and replaces Node 22+'s built-in `localStorage`
// (which throws on use without a CLI flag) with an in-memory Storage on
// both `globalThis` and `window`. Defined once in the shared package so
// every workspace consumer gets identical setup.
import '@jeswr/solid-reactive-fetch-shared/test-setup';
