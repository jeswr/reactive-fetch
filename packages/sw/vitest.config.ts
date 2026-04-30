import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Same rationale as the prompt package: jsdom + IndexedDB
    // (fake-indexeddb) + module-singleton resets across multiple test
    // files saw vitest's fork pool deadlock starting workers under load
    // locally. The worker-side suite imports `worker.ts` once per file
    // with global stubs in place — disabling cross-file parallelism keeps
    // the global mutations from racing.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
  },
});
