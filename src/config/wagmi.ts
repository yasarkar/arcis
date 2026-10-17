// src/config/wagmi.ts
// Frontend Wagmi & RainbowKit Configuration
// Consumes pure Viem chain definitions from src/config/networks/networkRegistry.ts
//
// P03: the two heavy connectors (WalletConnect, Coinbase) are NOT part of the
// eager config. They are loaded via `ensureFullWalletConfig()` on the first
// Connect click, so users who never connect never parse those SDKs. In
// production the static references below are the only wallets in the initial
// chunk (the package is ESM with restricted `sideEffects`, so unreferenced
// barrel exports are tree-shaken); the dynamic `import()` in
// `ensureFullWalletConfig` becomes its own on-demand chunk.

import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import {
  rainbowWallet,
  rabbyWallet,
  zerionWallet,
  uniswapWallet,
  trustWallet,
  roninWallet,
  bybitWallet,
  bitgetWallet,
} from '@rainbow-me/rainbowkit/wallets'
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
          `• Mobile QR code linking and WalletConnect modal require a valid project ID.\n` +
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

// Eager wallet groups: injected-only, light to evaluate. WalletConnect and
// Coinbase are intentionally absent — see `ensureFullWalletConfig`.
function eagerWalletGroups() {
  return [
    {
      groupName: 'Popüler',
      wallets: [rainbowWallet, rabbyWallet],
    },
    {
      groupName: 'Diğer',
      wallets: [
        zerionWallet,
        uniswapWallet,
        trustWallet,
        roninWallet,
        bybitWallet,
        bitgetWallet,
      ],
    },
  ]
}

type RainbowWalletGroups = Parameters<typeof getDefaultConfig>[0]['wallets']

function makeConfig(wallets: RainbowWalletGroups): Config {
  return getDefaultConfig({
    appName: 'Arcis Mini App',
    projectId: walletConnectProjectId,
    wallets,
    chains: (evmChains.length > 0 ? evmChains : [arcTestnet]) as any,
    ssr: false, // Vite React SPA, client-side only
  }) as unknown as Config
}

/** Eager minimal config used for first paint. Never triggers a transfer. */
export const config: Config = makeConfig(eagerWalletGroups())

let fullConfigPromise: Promise<Config> | null = null

/**
 * Loads the full wallet list (WalletConnect + Coinbase) on demand and builds
 * the upgraded wagmi config. Single-flight: concurrent callers share one
 * import + build. The returned config replaces the eager one via a provider
 * remount performed by the caller (see `walletConfigStore`), strictly before
 * any connection exists — never while a session is active.
 */
export function ensureFullWalletConfig(): Promise<Config> {
  if (!fullConfigPromise) {
    fullConfigPromise = import('@rainbow-me/rainbowkit/wallets').then(
      ({ walletConnectWallet, coinbaseWallet }) => {
        return makeConfig([
          {
            groupName: 'Popüler',
            wallets: [
              rainbowWallet,
              coinbaseWallet,
              walletConnectWallet,
              rabbyWallet,
            ],
          },
          {
            groupName: 'Diğer',
            wallets: [
              zerionWallet,
              uniswapWallet,
              trustWallet,
              roninWallet,
              bybitWallet,
              bitgetWallet,
            ],
          },
        ])
      }
    )
  }
  return fullConfigPromise
}

/** True once the full (WalletConnect + Coinbase) config has been built. */
export function isFullWalletConfigLoaded(): boolean {
  return fullConfigPromise !== null
}
