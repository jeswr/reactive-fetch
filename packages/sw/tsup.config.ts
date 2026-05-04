import { defineConfig } from 'tsup';

// Two parallel build entries:
//   - `index` runs in the page (DOM lib via tsconfig.build.json) and
//     resolves `@jeswr/solid-reactive-fetch-shared` from npm.
//   - `worker` runs in the service-worker realm (WebWorker lib via
//     tsconfig.worker.build.json). It is built fully bundled so
//     consumers can drop a single self-contained ESM file into their
//     public dir without wiring up an import map.

export default defineConfig([
  {
    name: 'page',
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    tsconfig: 'tsconfig.build.json',
    sourcemap: true,
    // Only the page build cleans `dist/` — the worker build runs in
    // parallel and would otherwise wipe the page build's outputs.
    clean: true,
    treeshake: true,
    target: 'es2022',
    splitting: false,
  },
  {
    name: 'worker',
    entry: { worker: 'src/worker.ts' },
    format: ['esm'],
    // No DTS for the worker bundle — it has no public exports (it's a
    // service-worker side-effect-only module). The companion stub at
    // `dist/worker.d.ts` is created by the build script.
    dts: false,
    tsconfig: 'tsconfig.worker.build.json',
    sourcemap: true,
    clean: false,
    // The worker is self-contained: bundle shared and the OIDC client so
    // consumers ship a single `worker.js` from `dist/` to their public
    // directory.
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
