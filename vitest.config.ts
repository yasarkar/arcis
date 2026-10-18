import { defineConfig } from 'vitest/config'

// P12: live tests (real network: Circle registry, price oracles, Gateway API)
// are opt-in via `RUN_LIVE=1` and never run in the default suite, so a
// rate-limited registry cannot flake CI. Name a live test `*.live.test.ts`.
// The default suite stays fully offline.
const runLive = process.env.RUN_LIVE === '1'

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'api/**/*.test.ts',
      'scripts/**/*.test.mjs',
      'docs/**/*.acceptance.test.ts',
      ...(runLive ? ['src/**/*.live.test.ts', 'api/**/*.live.test.ts'] : []),
    ],
    exclude: [
      'contracts/**',
      'node_modules/**',
      'dist/**',
      '**/*.repro.test.ts',
      // Belt and suspenders: without the opt-in above, a misplaced live test
      // can never join the default run.
      ...(runLive ? [] : ['**/*.live.test.ts']),
    ],
    // P12: isolated workers + explicit node environment (component tests would
    // opt into jsdom per-file via `// @vitest-environment jsdom` if ever added).
    pool: 'forks',
    environment: 'node',
    testTimeout: 15000,
  },
})
