// src/config/wagmi.ts
// Frontend Pure Wagmi Configuration (Zero RainbowKit Dependency)
// Consumes Viem chain definitions from src/config/networks/networkRegistry.ts

import { createConfig, http } from 'wagmi'
import { injected, coinbaseWallet, walletConnect } from 'wagmi/connectors'
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
    multiInjectedProviderDiscovery: true,
  })
}

function buildConnectors(): any[] {
  const list: any[] = [
    injected(),
    coinbaseWallet({ appName: 'Arcis' }),
  ]
  if (isWalletConnectConfigured) {
    list.push(
      walletConnect({
        projectId: walletConnectProjectId,
        showQrModal: true,
        qrModalOptions: {
          themeMode: 'dark',
          themeVariables: {
            '--wcm-z-index': '100050',
          },
        },
      })
    )
  }
  return list
}

/** Complete Wagmi config initialized with all supported EVM connectors. */
export const config: Config = makeConfig(buildConnectors())

/**
 * Ensures full wallet config is active. Config is already initialized
 * with all connectors, returning immediately without triggering provider remounts.
 */
export async function ensureFullWalletConfig(): Promise<Config> {
  return config
}

/** True once the full (WalletConnect + Coinbase) config has been built. */
export function isFullWalletConfigLoaded(): boolean {
  return true
}
