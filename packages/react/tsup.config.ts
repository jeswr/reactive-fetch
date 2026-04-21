import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: { resolve: false, entry: { index: 'src/index.ts' } },
  tsconfig: 'tsconfig.build.json',
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2022',
  splitting: false,
  external: ['react', '@jeswr/solid-reactive-fetch'],
});
