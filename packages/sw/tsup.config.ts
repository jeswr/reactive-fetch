import { defineConfig } from 'tsup';

// Two parallel build entries:
//   - `index` runs in the page (DOM lib via tsconfig.build.json).
//   - `worker` runs in the service-worker realm (WebWorker lib via
//     tsconfig.worker.build.json). It is built bundled so consumers can
//     drop a single self-contained ESM file into their public dir without
//     wiring up an import map.
//
// We deliberately keep both formats ESM-only — modern browsers support
// `new ServiceWorker(url, { type: 'module' })` and the alternative
// "classic" build adds no value for a self-contained worker bundle.

export default defineConfig([
  {
    name: 'page',
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: {
      // Inline `@jeswr/solid-reactive-fetch-shared/sw` declarations into
      // our .d.ts so the published types don't reference the unpublished
      // private package's subpaths. Both the regex and the explicit string
      // are listed because rollup-plugin-dts matches list entries by
      // exact string equality OR regex test — listing both covers either
      // matching strategy.
      resolve: [
        /^@jeswr\/solid-reactive-fetch-shared(\/.*)?$/,
        '@jeswr/solid-reactive-fetch-shared',
        '@jeswr/solid-reactive-fetch-shared/sw',
      ],
      entry: { index: 'src/index.ts' },
    },
    tsconfig: 'tsconfig.build.json',
    sourcemap: true,
    // Only the page build cleans `dist/` — the worker build runs in
    // parallel and would otherwise wipe the page build's outputs.
    clean: true,
    treeshake: true,
    target: 'es2022',
    splitting: false,
    // Inline shared into the JS output so consumers don't need to install
    // the unpublished private package at runtime.
    noExternal: [/^@jeswr\/solid-reactive-fetch-shared(\/.*)?$/],
  },
  {
    name: 'worker',
    entry: { worker: 'src/worker.ts' },
    format: ['esm'],
    // No DTS for the worker bundle — it has no public exports (it's
    // a service-worker side-effect-only module). The companion stub
    // at `dist/worker.d.ts` is created by the build script below.
    dts: false,
    tsconfig: 'tsconfig.worker.build.json',
    sourcemap: true,
    clean: false,
    // The worker is self-contained: bundle the shared package and
    // anything else it pulls in, so consumers can ship a single
    // `worker.js` from `dist/` to their public directory.
    noExternal: [
      '@jeswr/solid-reactive-fetch-shared',
      '@uvdsl/solid-oidc-client-browser',
    ],
    treeshake: true,
    target: 'es2022',
    splitting: false,
    platform: 'browser',
  },
]);
