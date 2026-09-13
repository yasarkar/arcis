// Centralized Master Blockchain Network Registry for Arcis Protocol.
// Single source of truth for:
// - Viem Chain Definitions (zero wagmi/rainbowkit dependencies)
// - Primary & Fallback RPC endpoints with auto-failover
// - Native Currency & Token Decimals (Arc 18 gas, ETH 18, SOL 9, USDC 6, cirBTC 8)
// - Token Contracts (USDC, EURC, cirBTC) & CCTP Domains
// - UI Visual Metadata (Web3 Icons, Brand Colors, Gradients)
import { defineChain, type Chain } from 'viem'
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
} from 'viem/chains'
import type { NetworkConfig, NetworkUiConfig } from './types'
export type { NetworkConfig, NetworkUiConfig }

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

// Environment-based RPC override for Arc
const customArcRpc = (
  (typeof process !== 'undefined' && process.env && process.env.VITE_ARC_RPC_URL) ||
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ARC_RPC_URL) ||
  ''
).trim()

// ─────────────────────────────────────────────────────────────
// 2. CUSTOM VIEM CHAIN DEFINITIONS (Pure Viem, no Wagmi/RainbowKit)
// ─────────────────────────────────────────────────────────────

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18, // Arc native gas uses 18 decimals
  },
  rpcUrls: {
    default: {
      http: customArcRpc
        ? [customArcRpc, 'https://rpc.testnet.arc.network', 'https://rpc.testnet.arc.io']
        : ['https://rpc.testnet.arc.network', 'https://rpc.testnet.arc.io'],
      webSocket: ['wss://rpc.testnet.arc.network'],
    },
    public: {
      http: customArcRpc
        ? [customArcRpc, 'https://rpc.testnet.arc.network', 'https://rpc.testnet.arc.io']
        : ['https://rpc.testnet.arc.network', 'https://rpc.testnet.arc.io'],
      webSocket: ['wss://rpc.testnet.arc.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'ArcScan',
      url: 'https://testnet.arcscan.app',
    },
  },
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
      blockCreated: 0,
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
      http: customArcRpc
        ? [customArcRpc, 'https://rpc.arc.io', 'https://rpc.arc.network']
        : ['https://rpc.arc.io', 'https://rpc.arc.network'],
      webSocket: ['wss://rpc.arc.io'],
    },
    public: {
      http: customArcRpc
        ? [customArcRpc, 'https://rpc.arc.io', 'https://rpc.arc.network']
        : ['https://rpc.arc.io', 'https://rpc.arc.network'],
      webSocket: ['wss://rpc.arc.io'],
    },
  },
  blockExplorers: {
    default: {
      name: 'ArcScan',
      url: 'https://arcscan.app',
    },
  },
  contracts: {
    multicall3: {
      address: '0xca11bde05977b3631167028862be2a173976ca11',
      blockCreated: 0,
    },
  },
  testnet: false,
})

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
      http: ['https://sepolia.unichain.org', 'https://unichain-sepolia.drpc.org'],
    },
    public: {
      http: ['https://sepolia.unichain.org', 'https://unichain-sepolia.drpc.org'],
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

// Simulated chain for Solana (for UI & address book purposes)
const solanaDevnetChain = defineChain({
  id: 999001,
  name: 'Solana Devnet',
  nativeCurrency: { name: 'SOL', symbol: 'SOL', decimals: 9 },
  rpcUrls: {
    default: { http: ['https://api.devnet.solana.com'] },
    public: { http: ['https://api.devnet.solana.com'] },
  },
  blockExplorers: {
    default: { name: 'Solana Explorer', url: 'https://explorer.solana.com/?cluster=devnet' },
  },
  testnet: true,
})

const solanaMainnetChain = defineChain({
  id: 999000,
  name: 'Solana',
  nativeCurrency: { name: 'SOL', symbol: 'SOL', decimals: 9 },
  rpcUrls: {
    default: { http: ['https://api.mainnet-beta.solana.com'] },
    public: { http: ['https://api.mainnet-beta.solana.com'] },
  },
  blockExplorers: {
    default: { name: 'Solana Explorer', url: 'https://explorer.solana.com' },
  },
  testnet: false,
})

// ─────────────────────────────────────────────────────────────
// 3. MASTER TESTNET REGISTRY
// ─────────────────────────────────────────────────────────────
export const TESTNET_NETWORKS: Record<string, NetworkConfig> = {
  Arc_Testnet: {
    key: 'Arc_Testnet',
    name: 'Arc Testnet',
    chainId: arcTestnet.id,
    testnet: true,
    cctpDomain: 26,
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: {
      primary: customArcRpc || 'https://rpc.testnet.arc.network',
      fallbacks: [
        'https://rpc.testnet.arc.io',
        'https://rpc.quicknode.testnet.arc.io',
        'https://rpc.blockdaemon.testnet.arc.io',
        'https://rpc.drpc.testnet.arc.io',
      ],
      ws: 'wss://rpc.testnet.arc.network',
    },
    blockExplorers: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
    tokens: {
      USDC: '0x3600000000000000000000000000000000000000',
      EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
      cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
    },
    tokenDecimals: { USDC: 6, EURC: 6, cirBTC: 8 },
    gatewayContracts: {
      gatewayWallet: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
      gatewayMinter: '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B',
    },
    ui: {
      iconId: 'arc',
      name: 'Arc Testnet',
      color: '#4f7de8',
      gradient: 'linear-gradient(135deg, #9896ff 0%, #6366f1 50%, #3b82f6 100%)',
    },
    viemChain: arcTestnet,
  },

  Ethereum_Sepolia: {
    key: 'Ethereum_Sepolia',
    name: 'Ethereum Sepolia',
    chainId: sepolia.id,
    testnet: true,
    cctpDomain: 0,
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://rpc.sepolia.org',
      fallbacks: [
        'https://ethereum-sepolia.publicnode.com',
        'https://1rpc.io/sepolia',
        'https://gateway.tenderly.co/public/sepolia',
      ],
    },
    blockExplorers: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' },
    tokens: {
      USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      EURC: '0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4',
    },
    tokenDecimals: { USDC: 6, EURC: 6 },
    ui: {
      iconId: 'ethereum',
      name: 'Ethereum Sepolia',
      color: '#8b5cf6',
      gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
    },
    viemChain: sepolia,
  },

  Base_Sepolia: {
    key: 'Base_Sepolia',
    name: 'Base Sepolia',
    chainId: baseSepolia.id,
    testnet: true,
    cctpDomain: 6,
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://sepolia.base.org',
      fallbacks: [
        'https://base-sepolia-rpc.publicnode.com',
        'https://1rpc.io/base-sepolia',
        'https://base-sepolia.gateway.tenderly.co',
      ],
    },
    blockExplorers: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
    tokens: {
      USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      EURC: '0x808007a79a5b6f3d99d3e8e21adbfcecfec11124',
    },
    tokenDecimals: { USDC: 6, EURC: 6 },
    ui: {
      iconId: 'base-sepolia',
      name: 'Base Sepolia',
      color: '#3b82f6',
      gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)',
    },
    viemChain: baseSepolia,
  },

  Arbitrum_Sepolia: {
    key: 'Arbitrum_Sepolia',
    name: 'Arbitrum Sepolia',
    chainId: arbitrumSepolia.id,
    testnet: true,
    cctpDomain: 3,
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://sepolia-rollup.arbitrum.io/rpc',
      fallbacks: [
        'https://arbitrum-sepolia.publicnode.com',
        'https://endpoints.omniatech.io/v1/arbitrum/sepolia/public',
      ],
    },
    blockExplorers: { name: 'Arbiscan', url: 'https://sepolia.arbiscan.io' },
    tokens: {
      USDC: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
      EURC: '0xA8C865719483955250774276726980b0D0008d68',
    },
    tokenDecimals: { USDC: 6, EURC: 6 },
    ui: {
      iconId: 'arbitrum-sepolia',
      name: 'Arbitrum Sepolia',
      color: '#22d3ee',
      gradient: 'linear-gradient(135deg, #22d3ee, #06b6d4)',
    },
    viemChain: arbitrumSepolia,
  },

  Optimism_Sepolia: {
    key: 'Optimism_Sepolia',
    name: 'Optimism Sepolia',
    chainId: optimismSepolia.id,
    testnet: true,
    cctpDomain: 2,
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://sepolia.optimism.io',
      fallbacks: [
        'https://optimism-sepolia.publicnode.com',
        'https://endpoints.omniatech.io/v1/op/sepolia/public',
      ],
    },
    blockExplorers: { name: 'Optimism Explorer', url: 'https://sepolia-optimism.etherscan.io' },
    tokens: {
      USDC: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
      EURC: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8',
    },
    tokenDecimals: { USDC: 6, EURC: 6 },
    ui: {
      iconId: 'optimism-sepolia',
      name: 'Optimism Sepolia',
      color: '#ef4444',
      gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
    },
    viemChain: optimismSepolia,
  },

  Polygon_Amoy_Testnet: {
    key: 'Polygon_Amoy_Testnet',
    name: 'Polygon PoS Amoy',
    chainId: polygonAmoy.id,
    testnet: true,
    cctpDomain: 7,
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: {
      primary: 'https://rpc-amoy.polygon.technology',
      fallbacks: [
        'https://polygon-amoy.drpc.org',
        'https://polygon-amoy-bor-rpc.publicnode.com',
      ],
    },
    blockExplorers: { name: 'PolygonScan', url: 'https://amoy.polygonscan.com' },
    tokens: {
      USDC: '0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'polygon-amoy',
      name: 'Polygon PoS Amoy',
      color: '#a855f7',
      gradient: 'linear-gradient(135deg, #a855f7, #9333ea)',
    },
    viemChain: polygonAmoy,
  },

  Avalanche_Fuji: {
    key: 'Avalanche_Fuji',
    name: 'Avalanche Fuji',
    chainId: avalancheFuji.id,
    testnet: true,
    cctpDomain: 1,
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    rpcUrls: {
      primary: 'https://api.avax-test.network/ext/bc/C/rpc',
      fallbacks: [
        'https://avalanche-fuji-c-chain-rpc.publicnode.com',
        'https://endpoints.omniatech.io/v1/avax/fuji/public',
      ],
    },
    blockExplorers: { name: 'SnowTrace', url: 'https://testnet.snowtrace.io' },
    tokens: {
      USDC: '0x5425890298aed601595a70ab815c96711a31bc65',
      EURC: '0x3231cb76718CDef2155FC47b5286d82e6eDA273f',
    },
    tokenDecimals: { USDC: 6, EURC: 6 },
    ui: {
      iconId: 'avalanche-fuji',
      name: 'Avalanche Fuji',
      color: '#ef4444',
      gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
    },
    viemChain: avalancheFuji,
  },

  HyperEVM_Testnet: {
    key: 'HyperEVM_Testnet',
    name: 'HyperEVM Testnet',
    chainId: hyperEVMTestnet.id,
    testnet: true,
    cctpDomain: 19,
    nativeCurrency: { name: 'HIP', symbol: 'HIP', decimals: 18 },
    rpcUrls: {
      primary: 'https://rpc.hyperliquid-testnet.xyz/evm',
      fallbacks: ['https://api.hyperliquid-testnet.xyz/evm'],
    },
    blockExplorers: { name: 'HyperEVM Explorer', url: 'https://testnet-explorer.hyperliquid.xyz' },
    tokens: {
      USDC: '0x2B3370eE501B4a559b57D449569354196457D8Ab',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'hyper-evm',
      name: 'HyperEVM Testnet',
      color: '#10b981',
      gradient: 'linear-gradient(135deg, #10b981, #059669)',
    },
    viemChain: hyperEVMTestnet,
  },

  Sei_Testnet: {
    key: 'Sei_Testnet',
    name: 'Sei Testnet',
    chainId: seiTestnet.id,
    testnet: true,
    cctpDomain: 16,
    nativeCurrency: { name: 'SEI', symbol: 'SEI', decimals: 18 },
    rpcUrls: {
      primary: 'https://evm-rpc-testnet.sei-apis.com',
      fallbacks: [
        'https://testnet-rpc.sei-apis.com',
        'https://sei-testnet.drpc.org',
      ],
    },
    blockExplorers: { name: 'SeiTrace', url: 'https://seitrace.com/?chain=atlantic-2' },
    tokens: {
      USDC: '0x4fCF1784B31630811181f670Aea7A7bEF803eaED',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'sei-network',
      name: 'Sei Testnet',
      color: '#eab308',
      gradient: 'linear-gradient(135deg, #eab308, #ca8a04)',
    },
    viemChain: seiTestnet,
  },

  Sonic_Testnet: {
    key: 'Sonic_Testnet',
    name: 'Sonic Testnet',
    chainId: sonicTestnet.id,
    testnet: true,
    cctpDomain: 13,
    nativeCurrency: { name: 'S', symbol: 'S', decimals: 18 },
    rpcUrls: {
      primary: 'https://rpc.testnet.soniclabs.com',
      fallbacks: [
        'https://sonic-testnet.drpc.org',
        'https://rpc-testnet.soniclabs.com',
      ],
    },
    blockExplorers: { name: 'SonicScan', url: 'https://testnet.sonicscan.org' },
    tokens: {
      USDC: '0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'sonic',
      name: 'Sonic Testnet',
      color: '#84cc16',
      gradient: 'linear-gradient(135deg, #84cc16, #65a30d)',
    },
    viemChain: sonicTestnet,
  },

  Unichain_Sepolia: {
    key: 'Unichain_Sepolia',
    name: 'Unichain Sepolia',
    chainId: unichainSepolia.id,
    testnet: true,
    cctpDomain: 10,
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://sepolia.unichain.org',
      fallbacks: ['https://unichain-sepolia.drpc.org'],
    },
    blockExplorers: { name: 'Uniscan', url: 'https://sepolia.uniscan.xyz' },
    tokens: {
      USDC: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'unichain',
      name: 'Unichain Sepolia',
      color: '#f472b6',
      gradient: 'linear-gradient(135deg, #f472b6, #db2777)',
    },
    viemChain: unichainSepolia,
  },

  World_Chain_Sepolia: {
    key: 'World_Chain_Sepolia',
    name: 'World Chain Sepolia',
    chainId: worldChainSepolia.id,
    testnet: true,
    cctpDomain: 14,
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://worldchain-sepolia.drpc.org',
      fallbacks: ['https://worldchain-sepolia.g.alchemy.com/public'],
    },
    blockExplorers: { name: 'Worldscan', url: 'https://sepolia.worldscan.org' },
    tokens: {
      USDC: '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'world',
      name: 'World Chain Sepolia',
      color: '#0ea5e9',
      gradient: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
    },
    viemChain: worldChainSepolia,
  },

  Solana_Devnet: {
    key: 'Solana_Devnet',
    name: 'Solana Devnet',
    chainId: 999001,
    testnet: true,
    cctpDomain: 5,
    nativeCurrency: { name: 'SOL', symbol: 'SOL', decimals: 9 },
    rpcUrls: {
      primary: 'https://api.devnet.solana.com',
      fallbacks: ['https://devnet.helius-rpc.com'],
    },
    blockExplorers: { name: 'Solana Explorer', url: 'https://explorer.solana.com/?cluster=devnet' },
    tokens: {
      USDC: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'solana',
      name: 'Solana Devnet',
      color: '#14b8a6',
      gradient: 'linear-gradient(135deg, #14b8a6, #0d9488)',
      isSolana: true,
    },
    viemChain: solanaDevnetChain,
  },
}

// ─────────────────────────────────────────────────────────────
// 4. MASTER MAINNET REGISTRY
// ─────────────────────────────────────────────────────────────
export const MAINNET_NETWORKS: Record<string, NetworkConfig> = {
  Arc: {
    key: 'Arc',
    name: 'Arc',
    chainId: arcMainnet.id,
    testnet: false,
    cctpDomain: 26,
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: {
      primary: customArcRpc || 'https://rpc.arc.io',
      fallbacks: ['https://rpc.arc.network'],
      ws: 'wss://rpc.arc.io',
    },
    blockExplorers: { name: 'ArcScan', url: 'https://arcscan.app' },
    tokens: {
      USDC: '0x3600000000000000000000000000000000000000',
      EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
      cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
    },
    tokenDecimals: { USDC: 6, EURC: 6, cirBTC: 8 },
    gatewayContracts: {
      gatewayWallet: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE',
      gatewayMinter: '0x2222222d7164433c4C09B0b0D809a9b52C04C205',
    },
    ui: {
      iconId: 'arc',
      name: 'Arc',
      color: '#4f7de8',
      gradient: 'linear-gradient(135deg, #9896ff 0%, #6366f1 50%, #3b82f6 100%)',
    },
    viemChain: arcMainnet,
  },

  Ethereum: {
    key: 'Ethereum',
    name: 'Ethereum',
    chainId: mainnet.id,
    testnet: false,
    cctpDomain: 0,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://eth.llamarpc.com',
      fallbacks: ['https://rpc.ankr.com/eth', 'https://1rpc.io/eth'],
    },
    blockExplorers: { name: 'Etherscan', url: 'https://etherscan.io' },
    tokens: {
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      EURC: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c',
    },
    tokenDecimals: { USDC: 6, EURC: 6 },
    ui: {
      iconId: 'ethereum',
      name: 'Ethereum',
      color: '#8b5cf6',
      gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
    },
    viemChain: mainnet,
  },

  Base: {
    key: 'Base',
    name: 'Base',
    chainId: base.id,
    testnet: false,
    cctpDomain: 6,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://mainnet.base.org',
      fallbacks: ['https://base.llamarpc.com', 'https://1rpc.io/base'],
    },
    blockExplorers: { name: 'BaseScan', url: 'https://basescan.org' },
    tokens: {
      USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1DD429',
    },
    tokenDecimals: { USDC: 6, EURC: 6 },
    ui: {
      iconId: 'base-sepolia',
      name: 'Base',
      color: '#3b82f6',
      gradient: 'linear-gradient(135deg, #3b82f6, #2563eb)',
    },
    viemChain: base,
  },

  Arbitrum: {
    key: 'Arbitrum',
    name: 'Arbitrum One',
    chainId: arbitrum.id,
    testnet: false,
    cctpDomain: 3,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://arb1.arbitrum.io/rpc',
      fallbacks: ['https://arbitrum.llamarpc.com', 'https://1rpc.io/arb'],
    },
    blockExplorers: { name: 'Arbiscan', url: 'https://arbiscan.io' },
    tokens: {
      USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'arbitrum-sepolia',
      name: 'Arbitrum One',
      color: '#22d3ee',
      gradient: 'linear-gradient(135deg, #22d3ee, #06b6d4)',
    },
    viemChain: arbitrum,
  },

  Optimism: {
    key: 'Optimism',
    name: 'OP Mainnet',
    chainId: optimism.id,
    testnet: false,
    cctpDomain: 2,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://mainnet.optimism.io',
      fallbacks: ['https://optimism.llamarpc.com', 'https://1rpc.io/op'],
    },
    blockExplorers: { name: 'Optimism Explorer', url: 'https://optimistic.etherscan.io' },
    tokens: {
      USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'optimism-sepolia',
      name: 'OP Mainnet',
      color: '#ef4444',
      gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
    },
    viemChain: optimism,
  },

  Polygon: {
    key: 'Polygon',
    name: 'Polygon PoS',
    chainId: polygon.id,
    testnet: false,
    cctpDomain: 7,
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: {
      primary: 'https://polygon-rpc.com',
      fallbacks: ['https://polygon.llamarpc.com', 'https://1rpc.io/matic'],
    },
    blockExplorers: { name: 'PolygonScan', url: 'https://polygonscan.com' },
    tokens: {
      USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'polygon-amoy',
      name: 'Polygon PoS',
      color: '#a855f7',
      gradient: 'linear-gradient(135deg, #a855f7, #9333ea)',
    },
    viemChain: polygon,
  },

  Avalanche: {
    key: 'Avalanche',
    name: 'Avalanche C-Chain',
    chainId: avalanche.id,
    testnet: false,
    cctpDomain: 1,
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    rpcUrls: {
      primary: 'https://api.avax.network/ext/bc/C/rpc',
      fallbacks: ['https://avalanche.public-rpc.com', 'https://1rpc.io/avax/c'],
    },
    blockExplorers: { name: 'SnowTrace', url: 'https://snowtrace.io' },
    tokens: {
      USDC: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
      EURC: '0xC891EB4cbdEFf6e073e859e987815Ed43c477641',
    },
    tokenDecimals: { USDC: 6, EURC: 6 },
    ui: {
      iconId: 'avalanche-fuji',
      name: 'Avalanche C-Chain',
      color: '#ef4444',
      gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
    },
    viemChain: avalanche,
  },

  Solana: {
    key: 'Solana',
    name: 'Solana',
    chainId: 999000,
    testnet: false,
    cctpDomain: 5,
    nativeCurrency: { name: 'SOL', symbol: 'SOL', decimals: 9 },
    rpcUrls: {
      primary: 'https://api.mainnet-beta.solana.com',
      fallbacks: ['https://solana-mainnet.rpc.extrnode.com'],
    },
    blockExplorers: { name: 'Solana Explorer', url: 'https://explorer.solana.com' },
    tokens: {
      USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'solana',
      name: 'Solana',
      color: '#14b8a6',
      gradient: 'linear-gradient(135deg, #14b8a6, #0d9488)',
      isSolana: true,
    },
    viemChain: solanaMainnetChain,
  },
}

// ─────────────────────────────────────────────────────────────
// 5. ACTIVE NETWORK ADAPTER & RUNTIME HELPERS
// ─────────────────────────────────────────────────────────────

export const ALL_NETWORKS: Record<string, NetworkConfig> = {
  ...TESTNET_NETWORKS,
  ...MAINNET_NETWORKS,
}

export const ACTIVE_NETWORKS: Record<string, NetworkConfig> = IS_TESTNET
  ? TESTNET_NETWORKS
  : MAINNET_NETWORKS

/** Active Arc chain definition according to environment */
export const arcActiveChain: Chain = IS_TESTNET ? arcTestnet : arcMainnet

/** Retrieve full network configuration by key (fuzzy match supported) */
export function getNetwork(chainKey?: string): NetworkConfig | undefined {
  if (!chainKey) return undefined
  const trimmed = chainKey.trim()

  if (ACTIVE_NETWORKS[trimmed]) return ACTIVE_NETWORKS[trimmed]
  if (ALL_NETWORKS[trimmed]) return ALL_NETWORKS[trimmed]

  const clean = trimmed.toLowerCase().replace(/[\s_-]+/g, '')
  for (const [key, net] of Object.entries(ALL_NETWORKS)) {
    if (key.toLowerCase().replace(/[\s_-]+/g, '') === clean) return net
    if (net.name.toLowerCase().replace(/[\s_-]+/g, '') === clean) return net
  }

  return undefined
}

/** Retrieve full network configuration by numeric EVM Chain ID */
export function getNetworkByChainId(chainId?: number): NetworkConfig | undefined {
  if (!chainId) return undefined
  for (const net of Object.values(ALL_NETWORKS)) {
    if (net.chainId === chainId || net.viemChain.id === chainId) {
      return net
    }
  }
  return undefined
}

/**
 * Resolves a Chain object from a numeric ID, string key/name, or existing Chain object.
 */
export function resolveChain(target?: string | number | Chain): Chain | undefined {
  if (!target) return undefined
  if (typeof target === 'object' && 'id' in target && 'name' in target) {
    return target as Chain
  }
  if (typeof target === 'number') {
    if (target === arcActiveChain.id) return arcActiveChain
    if (target === arcTestnet.id) return arcTestnet
    if (target === arcMainnet.id) return arcMainnet
    return getNetworkByChainId(target)?.viemChain
  }
  if (typeof target === 'string') {
    return getNetwork(target)?.viemChain
  }
  return undefined
}

/** Get Viem Chain definition */
export function getViemChain(chainKey?: string): Chain | undefined {
  return getNetwork(chainKey)?.viemChain
}

/** Get list of primary + fallback RPC URLs for a chain */
export function getNetworkRpcUrls(chainKey?: string): string[] {
  const net = getNetwork(chainKey)
  if (!net) return []
  return [net.rpcUrls.primary, ...net.rpcUrls.fallbacks].filter(
    (url, idx, arr) => arr.indexOf(url) === idx
  )
}

/** Get contract address for token on chain */
export function getTokenAddress(chainKey: string, symbol: string = 'USDC'): string | undefined {
  const net = getNetwork(chainKey)
  return net?.tokens[symbol]
}

/** Get decimal precision for native gas or token on chain */
export function getDecimals(chainKey: string, symbol?: string): number {
  const net = getNetwork(chainKey)
  if (!net) return 18
  if (!symbol || symbol === net.nativeCurrency.symbol) {
    return net.nativeCurrency.decimals
  }
  return net.tokenDecimals?.[symbol] ?? 6
}

// ─────────────────────────────────────────────────────────────
// 6. BACKWARD COMPATIBLE EXPORTS (For existing UI components)
// ─────────────────────────────────────────────────────────────

/** Viem Chain mapping dictionary (used by SendModal, BridgeModal, resilientRpcService) */
export const CHAIN_DEFS: Record<string, Chain> = Object.fromEntries(
  Object.entries(ALL_NETWORKS).map(([key, net]) => [key, net.viemChain])
)

/** UI Visual metadata dictionary (used by icons, colors, dropdowns) */
export const CHAIN_META: Record<string, NetworkUiConfig> = {
  Unified_Gateway: {
    iconId: 'circle',
    name: 'Unified Gateway (Multi-Chain)',
    color: '#38bdf8',
    gradient: 'linear-gradient(135deg, #0052ff, #38bdf8)',
  },
  ...Object.fromEntries(
    Object.entries(ALL_NETWORKS).map(([key, net]) => [
      key,
      {
        iconId: net.ui.iconId,
        name: net.name,
        color: net.ui.color,
        gradient: net.ui.gradient,
        isSolana: net.ui.isSolana,
      },
    ])
  ),
  // Ancillary testnets metadata for UI
  Injective_Testnet: {
    iconId: 'injective',
    name: 'Injective Testnet',
    color: '#06b6d4',
    gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)',
  },
  Ink_Testnet: {
    iconId: 'ink',
    name: 'Ink Sepolia',
    color: '#a855f7',
    gradient: 'linear-gradient(135deg, #a855f7, #7e22ce)',
  },
  Linea_Sepolia: {
    iconId: 'linea-sepolia',
    name: 'Linea Sepolia',
    color: '#6366f1',
    gradient: 'linear-gradient(135deg, #6366f1, #4338ca)',
  },
  Monad_Testnet: {
    iconId: 'monad-testnet',
    name: 'Monad Testnet',
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
  },
  Plume_Testnet: {
    iconId: 'plume',
    name: 'Plume Testnet',
    color: '#ec4899',
    gradient: 'linear-gradient(135deg, #ec4899, #be185d)',
  },
  XDC_Apothem: {
    iconId: 'xdc',
    name: 'Apothem Network',
    color: '#0284c7',
    gradient: 'linear-gradient(135deg, #0284c7, #0369a1)',
  },
}

/** Multi-chain fallback RPC configuration dictionary for RPC service */
export const MULTI_CHAIN_RPC_FALLBACKS: Record<string, { chainId: number; urls: string[] }> =
  Object.fromEntries(
    Object.entries(ALL_NETWORKS).map(([key, net]) => [
      key,
      {
        chainId: net.chainId,
        urls: [net.rpcUrls.primary, ...net.rpcUrls.fallbacks].filter(
          (u, idx, arr) => arr.indexOf(u) === idx
        ),
      },
    ])
  )
