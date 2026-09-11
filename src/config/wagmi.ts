// src/config/wagmi.ts
// Frontend Wagmi & RainbowKit Configuration
// Consumes pure Viem chain definitions from src/config/networks/networkRegistry.ts

import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import {
  rainbowWallet,
  coinbaseWallet,
  walletConnectWallet,
  rabbyWallet,
  zerionWallet,
  uniswapWallet,
  trustWallet,
  roninWallet,
  bybitWallet,
  bitgetWallet,
} from '@rainbow-me/rainbowkit/wallets'
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
} from './networks/networkRegistry'

// Re-export custom chains for backward compatibility
export {
  hyperEVMTestnet,
  seiTestnet,
  sonicTestnet,
  unichainSepolia,
  worldChainSepolia,
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

export const config = getDefaultConfig({
  appName: 'Arcis Mini App',
  projectId: walletConnectProjectId,
  wallets: [
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
  ],
  chains: (evmChains.length > 0 ? evmChains : [arcTestnet]) as any,
  ssr: false, // Vite React SPA, client-side only
})
