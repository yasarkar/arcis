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
  sepolia,
  baseSepolia,
  arbitrumSepolia,
  optimismSepolia,
  polygonAmoy,
  avalancheFuji,
  mainnet,
  base,
  arbitrum,
  optimism,
  polygon,
  avalanche,
} from 'wagmi/chains'
import { arcTestnet, arcMainnet, IS_TESTNET } from './arcChain'
import { defineChain } from 'viem'

export const hyperEVMTestnet = defineChain({
  id: 998,
  name: 'HyperEVM Testnet',
  nativeCurrency: {
    name: 'HIP',
    symbol: 'HIP',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        'https://rpc.hyperliquid-testnet.xyz/evm',
        'https://api.hyperliquid-testnet.xyz/evm',
      ],
    },
    public: {
      http: [
        'https://rpc.hyperliquid-testnet.xyz/evm',
        'https://api.hyperliquid-testnet.xyz/evm',
      ],
    },
  },
  blockExplorers: {
    default: {
      name: 'HyperEVM Explorer',
      url: 'https://testnet-explorer.hyperliquid.xyz',
    },
  },
  testnet: true,
})

export const seiTestnet = defineChain({
  id: 1328,
  name: 'Sei Testnet',
  nativeCurrency: { name: 'SEI', symbol: 'SEI', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        'https://evm-rpc-testnet.sei-apis.com',
        'https://testnet-rpc.sei-apis.com',
        'https://sei-testnet.drpc.org',
      ],
    },
    public: {
      http: [
        'https://evm-rpc-testnet.sei-apis.com',
        'https://testnet-rpc.sei-apis.com',
        'https://sei-testnet.drpc.org',
      ],
    },
  },
  blockExplorers: {
    default: { name: 'SeiTrace', url: 'https://seitrace.com/?chain=atlantic-2' },
  },
  testnet: true,
})

export const sonicTestnet = defineChain({
  id: 14601,
  name: 'Sonic Testnet',
  nativeCurrency: { name: 'S', symbol: 'S', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        'https://rpc.testnet.soniclabs.com',
        'https://sonic-testnet.drpc.org',
        'https://rpc-testnet.soniclabs.com',
      ],
    },
    public: {
      http: [
        'https://rpc.testnet.soniclabs.com',
        'https://sonic-testnet.drpc.org',
        'https://rpc-testnet.soniclabs.com',
      ],
    },
  },
  blockExplorers: {
    default: { name: 'SonicScan', url: 'https://testnet.sonicscan.org' },
  },
  testnet: true,
})

export const unichainSepolia = defineChain({
  id: 1301,
  name: 'Unichain Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        'https://sepolia.unichain.org',
        'https://unichain-sepolia.drpc.org',
      ],
    },
    public: {
      http: [
        'https://sepolia.unichain.org',
        'https://unichain-sepolia.drpc.org',
      ],
    },
  },
  blockExplorers: {
    default: { name: 'Uniscan', url: 'https://sepolia.uniscan.xyz' },
  },
  testnet: true,
})

export const worldChainSepolia = defineChain({
  id: 4801,
  name: 'World Chain Sepolia',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        'https://worldchain-sepolia.drpc.org',
        'https://worldchain-sepolia.g.alchemy.com/public',
      ],
    },
    public: {
      http: [
        'https://worldchain-sepolia.drpc.org',
        'https://worldchain-sepolia.g.alchemy.com/public',
      ],
    },
  },
  blockExplorers: {
    default: { name: 'Worldscan', url: 'https://sepolia.worldscan.org' },
  },
  testnet: true,
})

function resolveWalletConnectProjectId(): { projectId: string; isConfigured: boolean } {
  const envId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string || '').trim()

  // Valid project IDs are typically 32-character hexadecimal strings
  const isValidFormat = Boolean(envId && envId.length >= 8 && !envId.startsWith('YOUR_') && envId !== 'undefined' && envId !== 'null')

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
    // Safe fallback dummy key to prevent RainbowKit initialization crash
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
      ]
    }
  ],
  chains: (IS_TESTNET
    ? [
        arcTestnet,
        sepolia,
        baseSepolia,
        arbitrumSepolia,
        optimismSepolia,
        polygonAmoy,
        avalancheFuji,
        seiTestnet,
        sonicTestnet,
        unichainSepolia,
        worldChainSepolia,
        hyperEVMTestnet,
      ]
    : [
        arcMainnet,
        mainnet,
        base,
        arbitrum,
        optimism,
        polygon,
        avalanche,
      ]) as any,
  ssr: false, // Vite React SPA, client-side only
})
