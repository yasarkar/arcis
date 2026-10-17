// src/utils/__tests__/bundleSplitGuards.test.ts
// ARC-027: the app shipped as one ~5.9 MB entry chunk (1.53 MB gzip). These guards keep the two
// changes that fixed it from being undone by an innocent-looking import:
//
//   1. the tabs/modals/drawers are imported only through `lazy(() => import(...))`, and every one
//      of them sits inside a Suspense boundary (so a suspending modal cannot blank the app);
//   2. `manualChunks` does not group the Web3 SDKs or `@web3icons` — measured, that hoists
//      on-demand vendor modules into the preloaded entry (8.65 MB web3 chunk + 12.8 MB icon chunk).

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), 'utf8')

const APP = read('src/App.tsx')
const VITE_CONFIG = read('vite.config.ts')

const LAZY_SURFACES: Array<{ identifier: string; module: string }> = [
  { identifier: 'UnifiedBalance', module: './components/UnifiedBalance' },
  { identifier: 'PoolsTab', module: './components/pools/PoolsTab' },
  { identifier: 'MarketplaceTab', module: './components/marketplace/MarketplaceTab' },
  { identifier: 'SendModal', module: './components/SendModal' },
  { identifier: 'SwapModal', module: './components/SwapModal' },
  { identifier: 'BridgeModal', module: './components/BridgeModal' },
  { identifier: 'CircleAuthModal', module: './components/CircleAuthModal' },
  { identifier: 'FaucetModal', module: './components/FaucetModal' },
  { identifier: 'PortfolioDrawer', module: './components/PortfolioDrawer' },
  { identifier: 'ArcCopilotDrawer', module: './components/copilot/ArcCopilotDrawer' },
]

describe('App lazy surfaces', () => {
  it.each(LAZY_SURFACES)('loads $identifier only on demand', ({ identifier, module }) => {
    expect(APP).toContain(`const ${identifier} = lazy(() => import('${module}'))`)
    // A static import would pull the module (and its SDKs) back into the entry chunk.
    expect(APP).not.toMatch(new RegExp(`import\\s+${identifier}\\s+from`))
  })

  it('wraps the tab content and every overlay in a Suspense boundary', () => {
    expect(APP).toContain('Suspense fallback={<TabLoadingFallback />}')
    // One boundary per deferred overlay: the drawer, both auth/faucet modals and the portfolio.
    const boundaries = APP.match(/<Suspense fallback=\{null\}>/g) ?? []
    expect(boundaries.length).toBeGreaterThanOrEqual(4)
  })
})

describe('manualChunks scope', () => {
  it('keeps the named vendor chunks', () => {
    expect(VITE_CONFIG).toContain("return 'react-vendor'")
    expect(VITE_CONFIG).toContain("return 'query-vendor'")
    expect(VITE_CONFIG).toContain("return 'icons'")
  })

  it('does not hoist the on-demand Web3/icon modules into the entry', () => {
    expect(VITE_CONFIG).not.toContain("includes('/@web3icons")
    for (const vendor of ['@circle-fin/', 'wagmi/', '@rainbow-me/', 'viem/']) {
      expect(VITE_CONFIG).not.toContain(`modulePath.includes('/${vendor}')`)
    }
  })
})
