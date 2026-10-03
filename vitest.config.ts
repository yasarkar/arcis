import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'api/**/*.test.ts', 'scripts/**/*.test.mjs', 'docs/**/*.acceptance.test.ts'],
    exclude: ['contracts/**', 'node_modules/**', 'dist/**', '**/*.repro.test.ts'],
    testTimeout: 15000,
  },
})
