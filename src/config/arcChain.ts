import { defineChain } from 'viem'

// ─────────────────────────────────────────────────────────────
// 1. ENVIRONMENT & NETWORK SELECTION
// ─────────────────────────────────────────────────────────────
const envSetting = (
  (typeof process !== 'undefined' && process.env && (process.env.VITE_APP_ENV || process.env.VITE_NETWORK || process.env.APP_ENV)) ||
  (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env.VITE_APP_ENV || import.meta.env.VITE_NETWORK)) ||
  'testnet'
).toLowerCase()

export const APP_ENV: 'testnet' | 'mainnet' = envSetting === 'mainnet' ? 'mainnet' : 'testnet'
export const IS_TESTNET = APP_ENV === 'testnet'

// Custom RPC override from environment
const customRpcUrl = (
  (typeof process !== 'undefined' && process.env && process.env.VITE_ARC_RPC_URL) ||
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ARC_RPC_URL) ||
  ''
).trim()

// ─────────────────────────────────────────────────────────────
// 2. ARC CHAIN DEFINITIONS (Testnet & Mainnet)
// ─────────────────────────────────────────────────────────────
export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18, // Native gas view has 18 decimals on Arc
  },
  rpcUrls: {
    default: {
      http: customRpcUrl
        ? [customRpcUrl, 'https://rpc.testnet.arc.io', 'https://rpc-testnet.arc.io']
        : ['https://rpc.testnet.arc.io', 'https://rpc-testnet.arc.io'],
      webSocket: ['wss://rpc.testnet.arc.io'],
    },
    public: {
      http: customRpcUrl
        ? [customRpcUrl, 'https://rpc.testnet.arc.io', 'https://rpc-testnet.arc.io']
        : ['https://rpc.testnet.arc.io', 'https://rpc-testnet.arc.io'],
      webSocket: ['wss://rpc.testnet.arc.io'],
    },
  },
  blockExplorers: {
    default: {
      name: 'ArcScan',
      url: 'https://testnet.arcscan.app',
    },
  },
  testnet: true,
})

export const arcMainnet = defineChain({
  id: 5042001,
  name: 'Arc',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: customRpcUrl
        ? [customRpcUrl, 'https://rpc.arc.io']
        : ['https://rpc.arc.io'],
      webSocket: ['wss://rpc.arc.io'],
    },
    public: {
      http: customRpcUrl
        ? [customRpcUrl, 'https://rpc.arc.io']
        : ['https://rpc.arc.io'],
      webSocket: ['wss://rpc.arc.io'],
    },
  },
  blockExplorers: {
    default: {
      name: 'ArcScan',
      url: 'https://arcscan.app',
    },
  },
  testnet: false,
})

// Active chain according to environment
export const arcActiveChain = IS_TESTNET ? arcTestnet : arcMainnet

// ─────────────────────────────────────────────────────────────
// 3. TOKEN ADDRESSES & METADATA
// ─────────────────────────────────────────────────────────────
export const ARC_TESTNET_TOKENS = {
  USDC: '0x3600000000000000000000000000000000000000' as const,
  EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const,
  cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF' as const,
}

export const ARC_MAINNET_TOKENS = {
  USDC: '0x3600000000000000000000000000000000000000' as const,
  EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' as const,
  cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF' as const,
}

export const ARC_TOKENS = IS_TESTNET ? ARC_TESTNET_TOKENS : ARC_MAINNET_TOKENS

export const ARC_METADATA = {
  cctpDomain: IS_TESTNET ? 26 : 26,
  faucetUrl: 'https://faucet.circle.com',
  rpcHttpUrl: customRpcUrl || (IS_TESTNET ? 'https://rpc.testnet.arc.io' : 'https://rpc.arc.io'),
  rpcWsUrl: IS_TESTNET ? 'wss://rpc.testnet.arc.io' : 'wss://rpc.arc.io',
  explorerUrl: IS_TESTNET ? 'https://testnet.arcscan.app' : 'https://arcscan.app',
  isTestnet: IS_TESTNET,
}
