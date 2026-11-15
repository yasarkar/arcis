import { describe, expect, it, beforeEach } from 'vitest'
import {
  findEip6963Provider,
  getMipdStore,
  resetMipdStore,
  WALLET_RDNS_MAP,
  type EIP6963ProviderDetail,
} from '../useEip6963'

describe('EIP-6963 Provider Discovery (useEip6963)', () => {
  beforeEach(() => {
    resetMipdStore()
  })

  it('exposes known RDNS mappings for top EVM wallets', () => {
    expect(WALLET_RDNS_MAP.metamask).toContain('io.metamask')
    expect(WALLET_RDNS_MAP.rabby).toContain('io.rabby')
    expect(WALLET_RDNS_MAP.okx).toContain('com.okex.wallet')
    expect(WALLET_RDNS_MAP.phantom).toContain('app.phantom')
    expect(WALLET_RDNS_MAP.coinbase).toContain('com.coinbase.wallet')
  })

  it('finds provider by known wallet key or RDNS', () => {
    const mockProviders: EIP6963ProviderDetail[] = [
      {
        info: {
          uuid: '1111-2222-3333',
          name: 'MetaMask',
          icon: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
          rdns: 'io.metamask',
        },
        provider: {} as any,
      },
      {
        info: {
          uuid: '4444-5555-6666',
          name: 'Rabby Wallet',
          icon: 'data:image/svg+xml;base64,PHN2ZyByYWJieT48L3N2Zz4=',
          rdns: 'io.rabby',
        },
        provider: {} as any,
      },
      {
        info: {
          uuid: '7777-8888-9999',
          name: 'Custom Web3 Wallet',
          icon: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          rdns: 'xyz.custom.wallet',
        },
        provider: {} as any,
      },
    ]

    // Find by wallet id key
    const mm = findEip6963Provider(mockProviders, 'metamask')
    expect(mm).toBeDefined()
    expect(mm?.info.name).toBe('MetaMask')
    expect(mm?.info.rdns).toBe('io.metamask')

    const rabby = findEip6963Provider(mockProviders, 'rabby')
    expect(rabby).toBeDefined()
    expect(rabby?.info.name).toBe('Rabby Wallet')

    // Find by direct RDNS
    const custom = findEip6963Provider(mockProviders, 'xyz.custom.wallet')
    expect(custom).toBeDefined()
    expect(custom?.info.name).toBe('Custom Web3 Wallet')

    // Non-existent
    const missing = findEip6963Provider(mockProviders, 'phantom')
    expect(missing).toBeUndefined()
  })

  it('returns null when window is undefined (SSR)', () => {
    const origWindow = globalThis.window
    try {
      delete (globalThis as any).window
      resetMipdStore()
      expect(getMipdStore()).toBeNull()
    } finally {
      globalThis.window = origWindow
    }
  })

  it('initializes and resets the MIPD store instance singleton in browser environment', () => {
    const origWindow = globalThis.window
    try {
      globalThis.window = {
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      } as any

      resetMipdStore()
      const store1 = getMipdStore()
      const store2 = getMipdStore()

      expect(store1).toBeDefined()
      expect(store1).toBe(store2)
      expect(typeof store1?.subscribe).toBe('function')
      expect(typeof store1?.getProviders).toBe('function')

      resetMipdStore()
      const store3 = getMipdStore()
      expect(store3).not.toBe(store1)
    } finally {
      globalThis.window = origWindow
    }
  })
})
