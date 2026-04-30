import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // jsdom + IndexedDB (fake-indexeddb) + module-singleton resets across
    // 3 test files saw vitest's fork pool deadlock starting workers under
    // load locally (the workers timed out before the setup file even
    // registered). Disabling cross-file parallelism makes runs ~6s
    // sequential — fast enough that we don't need the parallelism for
    // such a small surface, and far more deterministic.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
});
