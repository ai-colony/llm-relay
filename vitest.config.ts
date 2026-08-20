import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirrors the `paths` in tsconfig.json. Vite's native `resolve.tsconfigPaths` is a boolean and
  // honours the base config's `exclude: ["test"]`, so test files would lose their aliases; it
  // cannot be pointed at tsconfig.test.json. Keep this map in sync when adding an alias.
  resolve: {
    alias: {
      '@lib': path.resolve('src/lib'),
      '@db': path.resolve('src/db'),
      '@prompt': path.resolve('src/prompt'),
      '@embedding': path.resolve('src/embedding')
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    onConsoleLog: () => false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60
      }
    }
  }
});
