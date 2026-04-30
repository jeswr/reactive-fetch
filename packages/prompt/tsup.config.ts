import { defineConfig } from 'tsup';

// `@jeswr/solid-reactive-fetch-shared` is private (`"private": true` in its
// package.json) and not published to npm. We inline it into this package's
// bundle so consumers installing `@jeswr/solid-reactive-fetch-prompt` from
// npm get a self-contained artifact that doesn't try to resolve the
// unpublished shared package at install time. Code splitting hoists the
// inlined shared classes into a single chunk shared by both `index` and
// `callback/index`, preserving `instanceof` identity across entries.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'callback/index': 'src/callback/index.ts',
  },
  format: ['esm'],
  dts: {
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
  splitting: true,
  noExternal: [/^@jeswr\/solid-reactive-fetch-shared(\/.*)?$/],
});
