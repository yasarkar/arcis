// src/config/wagmi.ts
// Frontend Pure Wagmi Configuration (Zero RainbowKit Dependency)
// Consumes Viem chain definitions from src/config/networks/networkRegistry.ts

import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import type { Config } from 'wagmi'
import {
  ACTIVE_NETWORKS,
  IS_TESTNET,
  arcTestnet,
  arcMainnet,
  hyperEVMTestnet,
  seiTestnet,
  sonicTestnet,
  unichainSepolia,
  worldChainSepolia,
  ethereumSepolia,
} from './networks/networkRegistry'

// Re-export custom chains for backward compatibility
export {
  hyperEVMTestnet,
  seiTestnet,
  sonicTestnet,
  unichainSepolia,
  worldChainSepolia,
  ethereumSepolia,
}

function resolveWalletConnectProjectId(): { projectId: string; isConfigured: boolean } {
  const envId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string || '').trim()

  const isValidFormat = Boolean(
    envId &&
      envId.length >= 8 &&
      !envId.startsWith('YOUR_') &&
      envId !== 'undefined' &&
      envId !== 'null'
  )

  if (!isValidFormat) {
    if (typeof window !== 'undefined') {
      console.warn(
        `%c[Arcis Wagmi Config] ⚠️ VITE_WALLETCONNECT_PROJECT_ID is not configured in .env!\n` +
          `• Direct browser extensions (MetaMask, Rabby, Coinbase) will continue to work normally.\n` +
          `• You can generate a free Project ID at: https://cloud.walletconnect.com`,
        'color: #f59e0b; font-weight: bold; font-size: 11px; padding: 2px;'
      )
    }
    return {
      projectId: '00000000000000000000000000000000',
      isConfigured: false,
    }
  }

  return {
    projectId: envId,
    isConfigured: true,
  }
}

const resolvedWc = resolveWalletConnectProjectId()
export const walletConnectProjectId = resolvedWc.projectId
export const isWalletConnectConfigured = resolvedWc.isConfigured

// Extract supported EVM chains for the active network environment (excluding non-EVM like Solana)
const evmChains = Object.values(ACTIVE_NETWORKS)
  .filter((net) => !net.ui.isSolana)
  .map((net) => net.viemChain)

const targetChains = (evmChains.length > 0 ? evmChains : [arcTestnet]) as any

const transports = Object.fromEntries(
  targetChains.map((chain: any) => [chain.id, http()])
)

function makeConfig(connectors: any[]): Config {
  return createConfig({
    chains: targetChains,
    connectors,
    transports,
    ssr: false,
  })
}

/** Eager minimal config used for first paint. Fast to evaluate, injected-only. */
export const config: Config = makeConfig([injected()])

let fullConfigPromise: Promise<Config> | null = null

/**
 * Loads the full wallet list (WalletConnect + Coinbase) on demand and builds
 * the upgraded wagmi config. Single-flight: concurrent callers share one
 * import + build.
 */
export function ensureFullWalletConfig(): Promise<Config> {
  if (!fullConfigPromise) {
    fullConfigPromise = import('wagmi/connectors').then(({ coinbaseWallet, walletConnect }) => {
      const fullConnectors: any[] = [
        injected(),
        coinbaseWallet({ appName: 'Arcis' }),
      ]
      if (isWalletConnectConfigured) {
        fullConnectors.push(
          walletConnect({
            projectId: walletConnectProjectId,
            showQrModal: true,
          })
        )
      }
      return makeConfig(fullConnectors)
    })
  }
  return fullConfigPromise
}

/** True once the full (WalletConnect + Coinbase) config has been built. */
export function isFullWalletConfigLoaded(): boolean {
  return fullConfigPromise !== null
}
