import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'api/**/*.test.ts', 'scripts/**/*.test.mjs'],
    exclude: ['contracts/**', 'node_modules/**', 'dist/**'],
    testTimeout: 15000,
  },
})
