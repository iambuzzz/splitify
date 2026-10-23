import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/index.ts'],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      // Floors just under the measured R0 baseline, so regressions fail CI.
      thresholds: { statements: 97, branches: 94, functions: 97, lines: 98 },
    },
  },
});
