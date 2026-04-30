import { defineConfig } from 'tsup';

// `@jeswr/solid-reactive-fetch-shared` is private (`"private": true` in its
// package.json) and not published to npm. We inline it into this package's
// bundle so consumers installing `@jeswr/solid-reactive-fetch` from npm get
// a self-contained artifact that doesn't try to resolve the unpublished
// shared package at install time.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'callback/index': 'src/callback/index.ts',
  },
  format: ['esm'],
  dts: {
    // Inline `@jeswr/solid-reactive-fetch-shared` declarations into our
    // .d.ts so the published types don't reference the unpublished private
    // package. Both the regex and the explicit subpath strings are listed
    // so rollup-plugin-dts matches both bare and `.../callback` imports.
    resolve: [
      /^@jeswr\/solid-reactive-fetch-shared(\/.*)?$/,
      '@jeswr/solid-reactive-fetch-shared',
      '@jeswr/solid-reactive-fetch-shared/callback',
    ],
    entry: { index: 'src/index.ts', 'callback/index': 'src/callback/index.ts' },
  },
  tsconfig: 'tsconfig.build.json',
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  // ESM code splitting is required so the inlined shared classes
  // (`InvalidWebIdError`, `LoginFailedError`, etc.) live in a single
  // chunk shared by both `index` and `callback/index`. Without it,
  // each entry would carry its own copy of the class definitions and
  // `instanceof` checks would fail when the same class is imported
  // through both subpaths in the same realm.
  splitting: true,
  noExternal: [/^@jeswr\/solid-reactive-fetch-shared(\/.*)?$/],
});
