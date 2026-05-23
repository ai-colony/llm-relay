import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@lib': path.resolve('src/lib'),
      '@db': path.resolve('src/db'),
      '@prompt': path.resolve('src/prompt')
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
