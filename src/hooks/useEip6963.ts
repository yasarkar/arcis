import { useSyncExternalStore } from 'react'
import { createStore, type Store as MipdStore, type EIP6963ProviderDetail } from 'mipd'

export type { EIP6963ProviderDetail }

/**
 * Standard Reverse Domain Name Identifiers (RDNS) for top EVM wallets
 * adhering to the EIP-6963 Multi-Injected Provider Discovery standard.
 */
export const WALLET_RDNS_MAP: Record<string, string[]> = {
  metamask: ['io.metamask', 'io.metamask.mobile'],
  rabby: ['io.rabby'],
  okx: ['com.okex.wallet'],
  phantom: ['app.phantom'],
  coinbase: ['com.coinbase.wallet'],
  trust: ['com.trustwallet.app'],
  rainbow: ['me.rainbow'],
  zerion: ['io.zerion.wallet'],
  binance: ['com.binance.wallet', 'binance'],
  brave: ['com.brave.wallet'],
}

let storeInstance: MipdStore | null = null

/**
 * Returns the singleton MIPD store for discovering EIP-6963 providers.
 */
export function getMipdStore(): MipdStore | null {
  if (typeof window === 'undefined') return null
  if (!storeInstance) {
    storeInstance = createStore()
  }
  return storeInstance
}

/**
 * Resets the MIPD store instance (useful for test isolation).
 */
export function resetMipdStore(): void {
  if (storeInstance) {
    try {
      storeInstance.destroy()
    } catch (err) {
      console.debug('[useEip6963] MIPD store destroy error:', err)
    }
    storeInstance = null
  }
}

/**
 * Finds an announced EIP-6963 provider matching a known wallet identifier or RDNS.
 */
export function findEip6963Provider(
  providers: readonly EIP6963ProviderDetail[],
  walletId: string
): EIP6963ProviderDetail | undefined {
  if (!providers || providers.length === 0) return undefined
  const targetId = walletId.toLowerCase()
  const rdnsList = WALLET_RDNS_MAP[targetId] || [targetId]

  return providers.find((p) => {
    const pRdns = p.info.rdns.toLowerCase()
    return rdnsList.some((r) => pRdns.includes(r.toLowerCase())) || pRdns === targetId
  })
}

/**
 * React hook subscribing to EIP-6963 Multi-Injected Provider Discovery.
 * Automatically synchronizes whenever any wallet extension announces itself.
 */
export function useEip6963(): readonly EIP6963ProviderDetail[] {
  const store = getMipdStore()

  return useSyncExternalStore(
    (callback) => {
      if (!store) return () => {}
      return store.subscribe(callback)
    },
    () => (store ? store.getProviders() : []),
    () => []
  )
}
