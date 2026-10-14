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
import type { NetworkConfig, NetworkUiConfig, NetworkCapabilities, NetworkAdapters } from './types'
export type { NetworkConfig, NetworkUiConfig, NetworkCapabilities, NetworkAdapters }

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

export const ethereumSepolia = defineChain({
  ...sepolia,
  rpcUrls: {
    ...sepolia.rpcUrls,
    default: {
      http: [
        'https://ethereum-sepolia.publicnode.com',
        'https://1rpc.io/sepolia',
        'https://gateway.tenderly.co/public/sepolia',
      ],
    },
    public: {
      http: [
        'https://ethereum-sepolia.publicnode.com',
        'https://1rpc.io/sepolia',
        'https://gateway.tenderly.co/public/sepolia',
      ],
    },
  },
})

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://testnet-rpc.monad.xyz', 'https://monad-testnet.drpc.org'],
    },
    public: {
      http: ['https://testnet-rpc.monad.xyz', 'https://monad-testnet.drpc.org'],
    },
  },
  blockExplorers: {
    default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' },
  },
  testnet: true,
})

export const inkTestnet = defineChain({
  id: 763373,
  name: 'Ink Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc-gel-sepolia.inkonchain.com', 'https://ink-sepolia.drpc.org'],
    },
    public: {
      http: ['https://rpc-gel-sepolia.inkonchain.com', 'https://ink-sepolia.drpc.org'],
    },
  },
  blockExplorers: {
    default: { name: 'Ink Explorer', url: 'https://explorer.sepolia.inkonchain.com' },
  },
  testnet: true,
})

export const lineaSepolia = defineChain({
  id: 59141,
  name: 'Linea Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://rpc.sepolia.linea.build', 'https://linea-sepolia.drpc.org'],
    },
    public: {
      http: ['https://rpc.sepolia.linea.build', 'https://linea-sepolia.drpc.org'],
    },
  },
  blockExplorers: {
    default: { name: 'LineaScan', url: 'https://sepolia.lineascan.build' },
  },
  testnet: true,
})

export const plumeTestnet = defineChain({
  id: 98864,
  name: 'Plume Testnet',
  nativeCurrency: { name: 'Plume ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://testnet-rpc.plumenetwork.xyz', 'https://plume-testnet.drpc.org'],
    },
    public: {
      http: ['https://testnet-rpc.plumenetwork.xyz', 'https://plume-testnet.drpc.org'],
    },
  },
  blockExplorers: {
    default: { name: 'Plume Explorer', url: 'https://testnet-explorer.plumenetwork.xyz' },
  },
  testnet: true,
})

export const injectiveTestnet = defineChain({
  id: 14801,
  name: 'Injective Testnet',
  nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://testnet.inevm.com/http', 'https://k8s.testnet.json-rpc.injective.network'],
    },
    public: {
      http: ['https://testnet.inevm.com/http', 'https://k8s.testnet.json-rpc.injective.network'],
    },
  },
  blockExplorers: {
    default: { name: 'Injective Explorer', url: 'https://testnet.explorer.injective.network' },
  },
  testnet: true,
})

export const xdcApothem = defineChain({
  id: 51,
  name: 'XDC Apothem',
  nativeCurrency: { name: 'XDC', symbol: 'XDC', decimals: 18 },
  rpcUrls: {
    default: {
      http: ['https://erpc.apothem.network', 'https://rpc.apothem.network'],
    },
    public: {
      http: ['https://erpc.apothem.network', 'https://rpc.apothem.network'],
    },
  },
  blockExplorers: {
    default: { name: 'Blocksscan', url: 'https://apothem.blocksscan.io' },
  },
  testnet: true,
})

export const codexTestnet = defineChain({
  id: 812242,
  name: 'Codex Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.codex-stg.xyz'] },
    public: { http: ['https://rpc.codex-stg.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Codex Explorer', url: 'https://explorer.codex-stg.xyz' },
  },
  testnet: true,
})

export const cronosTestnet = defineChain({
  id: 338,
  name: 'Cronos Testnet',
  nativeCurrency: { name: 'Cronos', symbol: 'tCRO', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://evm-t3.cronos.org'] },
    public: { http: ['https://evm-t3.cronos.org'] },
  },
  blockExplorers: {
    default: { name: 'Cronos Explorer', url: 'https://explorer.cronos.org/testnet' },
  },
  testnet: true,
})

export const edgeTestnet = defineChain({
  id: 33431,
  name: 'Edge Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://edge-testnet.g.alchemy.com/public'] },
    public: { http: ['https://edge-testnet.g.alchemy.com/public'] },
  },
  blockExplorers: {
    default: { name: 'Edge Explorer', url: 'https://edge-testnet.explorer.alchemy.com' },
  },
  testnet: true,
})

export const morphTestnet = defineChain({
  id: 2910,
  name: 'Morph Hoodi Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc-hoodi.morphl2.io'] },
    public: { http: ['https://rpc-hoodi.morphl2.io'] },
  },
  blockExplorers: {
    default: { name: 'Morph Explorer', url: 'https://explorer-hoodi.morphl2.io' },
  },
  testnet: true,
})

export const pharosTestnet = defineChain({
  id: 688689,
  name: 'Pharos Atlantic Testnet',
  nativeCurrency: { name: 'Pharos', symbol: 'PHRS', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://atlantic.dplabs-internal.com'] },
    public: { http: ['https://atlantic.dplabs-internal.com'] },
  },
  blockExplorers: {
    default: { name: 'Pharos Scan', url: 'https://atlantic.pharosscan.xyz' },
  },
  testnet: true,
})

export const plasmaTestnet = defineChain({
  id: 9746,
  name: 'Plasma Testnet',
  nativeCurrency: { name: 'Plasma', symbol: 'XPL', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.plasma.to'] },
    public: { http: ['https://testnet-rpc.plasma.to'] },
  },
  blockExplorers: {
    default: { name: 'Plasma Scan', url: 'https://testnet.plasmascan.to' },
  },
  testnet: true,
})

export const xLayerTestnet = defineChain({
  id: 1952,
  name: 'X Layer Testnet',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testrpc.xlayer.tech'] },
    public: { http: ['https://testrpc.xlayer.tech'] },
  },
  blockExplorers: {
    default: { name: 'OKX Explorer', url: 'https://web3.okx.com/explorer/x-layer-testnet' },
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
    shortName: 'ARC',
    chainId: arcTestnet.id,
    testnet: true,
    cctpDomain: 26,
    circleBlockchain: 'ARC-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: true,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      onramp: true,
      earn: true,
      borrow: true,
      faucet: true,
      privacy: true,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: {
      primary: customArcRpc || 'https://rpc.testnet.arc.network',
      fallbacks: [
        'https://rpc.testnet.arc.io',
        'https://rpc.quicknode.testnet.arc.io',
      ],
      ws: 'wss://rpc.testnet.arc.network',
    },
    blockExplorers: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
    tokens: {
      USDC: '0x3600000000000000000000000000000000000000',
      EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
      cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
      WETH: '0x2c4047028a72803939b6fb674D01bC059B5C4961',
      USYC: '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C',
    },
    tokenDecimals: { USDC: 6, EURC: 6, cirBTC: 8, WETH: 18, USYC: 6 },
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
    shortName: 'ETH',
    chainId: sepolia.id,
    testnet: true,
    cctpDomain: 0,
    circleBlockchain: 'ETH-SEPOLIA',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://ethereum-sepolia.publicnode.com',
      fallbacks: [
        'https://1rpc.io/sepolia',
        'https://gateway.tenderly.co/public/sepolia',
        'https://rpc.sepolia.org',
      ],
    },
    blockExplorers: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' },
    tokens: {
      USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      EURC: '0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4',
      WETH: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      cirBTC: '0x3a3fe695f684bf9b9e43cf43c2b895ea5e392bb3',
    },
    tokenDecimals: { USDC: 6, EURC: 6, WETH: 18, cirBTC: 8 },
    ui: {
      iconId: 'ethereum',
      name: 'Ethereum Sepolia',
      color: '#8b5cf6',
      gradient: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
    },
    viemChain: ethereumSepolia,
  },

  Base_Sepolia: {
    key: 'Base_Sepolia',
    name: 'Base Sepolia',
    shortName: 'BASE',
    chainId: baseSepolia.id,
    testnet: true,
    cctpDomain: 6,
    circleBlockchain: 'BASE-SEPOLIA',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
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
      EURC: '0x808456652fdb597867f38412077A9182bf77359F',
      WETH: '0x4200000000000000000000000000000000000006',
    },
    tokenDecimals: { USDC: 6, EURC: 6, WETH: 18 },
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
    shortName: 'ARB',
    chainId: arbitrumSepolia.id,
    testnet: true,
    cctpDomain: 3,
    circleBlockchain: 'ARB-SEPOLIA',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
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
      WETH: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
    },
    tokenDecimals: { USDC: 6, EURC: 6, WETH: 18 },
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
    shortName: 'OP',
    chainId: optimismSepolia.id,
    testnet: true,
    cctpDomain: 2,
    circleBlockchain: 'OP-SEPOLIA',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
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
      WETH: '0x4200000000000000000000000000000000000006',
    },
    tokenDecimals: { USDC: 6, EURC: 6, WETH: 18 },
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
    shortName: 'POL',
    chainId: polygonAmoy.id,
    testnet: true,
    cctpDomain: 7,
    circleBlockchain: 'MATIC-AMOY',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
    nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
    rpcUrls: {
      primary: 'https://polygon-amoy-bor-rpc.publicnode.com',
      fallbacks: [
        'https://polygon-amoy.drpc.org',
        'https://80002.rpc.thirdweb.com',
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
    shortName: 'AVAX',
    chainId: avalancheFuji.id,
    testnet: true,
    cctpDomain: 1,
    circleBlockchain: 'AVAX-FUJI',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
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
    shortName: 'HYPER',
    chainId: hyperEVMTestnet.id,
    testnet: true,
    cctpDomain: 19,
    circleBlockchain: 'HYPEREVM-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: true,
      unifiedBalance: true,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
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
    shortName: 'SEI',
    chainId: seiTestnet.id,
    testnet: true,
    cctpDomain: 16,
    circleBlockchain: 'SEI-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: true,
      unifiedBalance: true,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
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
    shortName: 'SONIC',
    chainId: sonicTestnet.id,
    testnet: true,
    cctpDomain: 13,
    circleBlockchain: 'SONIC-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: true,
      unifiedBalance: true,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
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
    shortName: 'UNI',
    chainId: unichainSepolia.id,
    testnet: true,
    cctpDomain: 10,
    circleBlockchain: 'UNI-SEPOLIA',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: true,
      unifiedBalance: true,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
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
    shortName: 'WLD',
    chainId: worldChainSepolia.id,
    testnet: true,
    cctpDomain: 14,
    circleBlockchain: 'WORLDCHAIN-SEPOLIA',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: true,
      unifiedBalance: true,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
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
    shortName: 'SOL',
    chainId: 999001,
    testnet: true,
    cctpDomain: 5,
    circleBlockchain: 'SOL-DEVNET',
    capabilities: {
      send: true,
      bridge: false,
      swap: false,
      gateway: true,
      unifiedBalance: true,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: false,
      ethers: false,
      circleWallets: true,
      solana: true,
    },
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

  Monad_Testnet: {
    key: 'Monad_Testnet',
    name: 'Monad Testnet',
    shortName: 'MON',
    chainId: monadTestnet.id,
    testnet: true,
    circleBlockchain: 'MONAD-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: true,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: {
      primary: 'https://testnet-rpc.monad.xyz',
      fallbacks: ['https://monad-testnet.drpc.org'],
    },
    blockExplorers: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' },
    tokens: {
      USDC: '0xf817257fed379853cDe0fa4F97AB987181B1E5Ea',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'monad-testnet',
      name: 'Monad Testnet',
      color: '#8b5cf6',
      gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    },
    viemChain: monadTestnet,
  },

  Ink_Testnet: {
    key: 'Ink_Testnet',
    name: 'Ink Sepolia',
    shortName: 'INK',
    chainId: inkTestnet.id,
    testnet: true,
    circleBlockchain: 'INK-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://rpc-gel-sepolia.inkonchain.com',
      fallbacks: ['https://ink-sepolia.drpc.org'],
    },
    blockExplorers: { name: 'Ink Explorer', url: 'https://explorer.sepolia.inkonchain.com' },
    tokens: {
      USDC: '0x266854124190e44720D45B3878bC165eb3F01C60',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'ink',
      name: 'Ink Sepolia',
      color: '#a855f7',
      gradient: 'linear-gradient(135deg, #a855f7, #7e22ce)',
    },
    viemChain: inkTestnet,
  },

  Linea_Sepolia: {
    key: 'Linea_Sepolia',
    name: 'Linea Sepolia',
    shortName: 'LINEA',
    chainId: lineaSepolia.id,
    testnet: true,
    circleBlockchain: 'LINEA-SEPOLIA',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://rpc.sepolia.linea.build',
      fallbacks: ['https://linea-sepolia.drpc.org'],
    },
    blockExplorers: { name: 'LineaScan', url: 'https://sepolia.lineascan.build' },
    tokens: {
      USDC: '0xFE224D5154DE6f536F52f010c223c2a07530e84b',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'linea-sepolia',
      name: 'Linea Sepolia',
      color: '#6366f1',
      gradient: 'linear-gradient(135deg, #6366f1, #4338ca)',
    },
    viemChain: lineaSepolia,
  },

  Plume_Testnet: {
    key: 'Plume_Testnet',
    name: 'Plume Testnet',
    shortName: 'PLUME',
    chainId: plumeTestnet.id,
    testnet: true,
    circleBlockchain: 'PLUME-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
    nativeCurrency: { name: 'Plume ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://testnet-rpc.plumenetwork.xyz',
      fallbacks: ['https://plume-testnet.drpc.org'],
    },
    blockExplorers: { name: 'Plume Explorer', url: 'https://testnet-explorer.plumenetwork.xyz' },
    tokens: {
      USDC: '0xba228a0C6cf5Cd2B9F4f74d64B79c0926d2e3b2e',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'plume',
      name: 'Plume Testnet',
      color: '#ec4899',
      gradient: 'linear-gradient(135deg, #ec4899, #be185d)',
    },
    viemChain: plumeTestnet,
  },

  Injective_Testnet: {
    key: 'Injective_Testnet',
    name: 'Injective Testnet',
    shortName: 'INJ',
    chainId: injectiveTestnet.id,
    testnet: true,
    circleBlockchain: 'INJECTIVE-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
    nativeCurrency: { name: 'Injective', symbol: 'INJ', decimals: 18 },
    rpcUrls: {
      primary: 'https://testnet.inevm.com/http',
      fallbacks: ['https://k8s.testnet.json-rpc.injective.network'],
    },
    blockExplorers: { name: 'Injective Explorer', url: 'https://testnet.explorer.injective.network' },
    tokens: {
      USDC: '0x7b66C729ee944749f7b13F89A5A4e99f0BfFf191',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'injective',
      name: 'Injective Testnet',
      color: '#06b6d4',
      gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)',
    },
    viemChain: injectiveTestnet,
  },

  XDC_Apothem: {
    key: 'XDC_Apothem',
    name: 'Apothem Network',
    shortName: 'XDC',
    chainId: xdcApothem.id,
    testnet: true,
    circleBlockchain: 'XDC-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
    nativeCurrency: { name: 'XDC', symbol: 'XDC', decimals: 18 },
    rpcUrls: {
      primary: 'https://erpc.apothem.network',
      fallbacks: ['https://rpc.apothem.network'],
    },
    blockExplorers: { name: 'Blocksscan', url: 'https://apothem.blocksscan.io' },
    tokens: {
      USDC: '0x3234ff14F44621c1ea3E6Eca4a194165682Ffe5a',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'xdc',
      name: 'Apothem Network',
      color: '#0284c7',
      gradient: 'linear-gradient(135deg, #0284c7, #0369a1)',
    },
    viemChain: xdcApothem,
  },

  Codex_Testnet: {
    key: 'Codex_Testnet',
    name: 'Codex Testnet',
    shortName: 'CDX',
    chainId: codexTestnet.id,
    testnet: true,
    cctpDomain: 12,
    circleBlockchain: 'CODEX-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://rpc.codex-stg.xyz',
      fallbacks: [],
    },
    blockExplorers: { name: 'Codex Explorer', url: 'https://explorer.codex-stg.xyz' },
    tokens: {
      USDC: '0x6d7f141b6819C2c9CC2f818e6ad549E7Ca090F8f',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'codex',
      name: 'Codex Testnet',
      color: '#00d1ff',
      gradient: 'linear-gradient(135deg, #00d1ff, #0077fe)',
    },
    viemChain: codexTestnet,
  },

  Cronos_Testnet: {
    key: 'Cronos_Testnet',
    name: 'Cronos Testnet',
    shortName: 'CRO',
    chainId: cronosTestnet.id,
    testnet: true,
    cctpDomain: 32,
    circleBlockchain: 'CRONOS-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: true,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
    nativeCurrency: { name: 'Cronos', symbol: 'tCRO', decimals: 18 },
    rpcUrls: {
      primary: 'https://evm-t3.cronos.org',
      fallbacks: [],
    },
    blockExplorers: { name: 'Cronos Explorer', url: 'https://explorer.cronos.org/testnet' },
    tokens: {
      USDC: '0xEb33dc5fac03833e132593659e1dE7256aB59794',
      EURC: '0x31f7538adb53cF16350e6B0c89d03D91b7D12c46',
    },
    tokenDecimals: { USDC: 6, EURC: 6 },
    ui: {
      iconId: 'cronos',
      name: 'Cronos Testnet',
      color: '#002d74',
      gradient: 'linear-gradient(135deg, #002d74, #0056b3)',
    },
    viemChain: cronosTestnet,
  },

  Edge_Testnet: {
    key: 'Edge_Testnet',
    name: 'Edge Testnet',
    shortName: 'EDGE',
    chainId: edgeTestnet.id,
    testnet: true,
    cctpDomain: 28,
    circleBlockchain: 'EDGE-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://edge-testnet.g.alchemy.com/public',
      fallbacks: [],
    },
    blockExplorers: { name: 'Edge Explorer', url: 'https://edge-testnet.explorer.alchemy.com' },
    tokens: {
      USDC: '0x2d9F7CAD728051AA35Ecdc472a14cf8cDF5CFD6B',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'edgeless',
      name: 'Edge Testnet',
      color: '#10b981',
      gradient: 'linear-gradient(135deg, #10b981, #059669)',
    },
    viemChain: edgeTestnet,
  },

  Morph_Testnet: {
    key: 'Morph_Testnet',
    name: 'Morph Hoodi Testnet',
    shortName: 'MORPH',
    chainId: morphTestnet.id,
    testnet: true,
    cctpDomain: 30,
    circleBlockchain: 'MORPH-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://rpc-hoodi.morphl2.io',
      fallbacks: [],
    },
    blockExplorers: { name: 'Morph Explorer', url: 'https://explorer-hoodi.morphl2.io' },
    tokens: {
      USDC: '0x7433b41C6c5e1d58D4Da99483609520255ab661B',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'morph',
      name: 'Morph Hoodi Testnet',
      color: '#38d68b',
      gradient: 'linear-gradient(135deg, #38d68b, #10b981)',
    },
    viemChain: morphTestnet,
  },

  Pharos_Testnet: {
    key: 'Pharos_Testnet',
    name: 'Pharos Atlantic Testnet',
    shortName: 'PHAROS',
    chainId: pharosTestnet.id,
    testnet: true,
    cctpDomain: 31,
    circleBlockchain: 'PHAROS-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
    nativeCurrency: { name: 'Pharos', symbol: 'PHRS', decimals: 18 },
    rpcUrls: {
      primary: 'https://atlantic.dplabs-internal.com',
      fallbacks: [],
    },
    blockExplorers: { name: 'Pharos Scan', url: 'https://atlantic.pharosscan.xyz' },
    tokens: {
      USDC: '0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'pharos',
      name: 'Pharos Atlantic Testnet',
      color: '#6366f1',
      gradient: 'linear-gradient(135deg, #6366f1, #4f46e5)',
    },
    viemChain: pharosTestnet,
  },

  Plasma_Testnet: {
    key: 'Plasma_Testnet',
    name: 'Plasma Testnet',
    shortName: 'PLASM',
    chainId: plasmaTestnet.id,
    testnet: true,
    cctpDomain: 33,
    circleBlockchain: 'PLASMA-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: true,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
    nativeCurrency: { name: 'Plasma', symbol: 'XPL', decimals: 18 },
    rpcUrls: {
      primary: 'https://testnet-rpc.plasma.to',
      fallbacks: [],
    },
    blockExplorers: { name: 'Plasma Scan', url: 'https://testnet.plasmascan.to' },
    tokens: {
      USDC: '0xE67Fb267022cBA8064Dd388CC2FED724F3120D9D',
      EURC: '0x98AfA0F93Dd993B736399f9074eDcEBD1985A330',
    },
    tokenDecimals: { USDC: 6, EURC: 6 },
    ui: {
      iconId: 'plasma',
      name: 'Plasma Testnet',
      color: '#f59e0b',
      gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    },
    viemChain: plasmaTestnet,
  },

  X_Layer_Testnet: {
    key: 'X_Layer_Testnet',
    name: 'X Layer Testnet',
    shortName: 'XLAYER',
    chainId: xLayerTestnet.id,
    testnet: true,
    cctpDomain: 37,
    circleBlockchain: 'XLAYER-TESTNET',
    capabilities: {
      send: true,
      bridge: true,
      swap: false,
      gateway: false,
      unifiedBalance: false,
      ucw: false,
      faucet: true,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: false,
      solana: false,
    },
    nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
    rpcUrls: {
      primary: 'https://testrpc.xlayer.tech',
      fallbacks: [],
    },
    blockExplorers: { name: 'OKX Explorer', url: 'https://web3.okx.com/explorer/x-layer-testnet' },
    tokens: {
      USDC: '0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3',
    },
    tokenDecimals: { USDC: 6 },
    ui: {
      iconId: 'x-layer',
      name: 'X Layer Testnet',
      color: '#000000',
      gradient: 'linear-gradient(135deg, #1e293b, #0f172a)',
    },
    viemChain: xLayerTestnet,
  },
}

// ─────────────────────────────────────────────────────────────
// 4. MASTER MAINNET REGISTRY
// ─────────────────────────────────────────────────────────────
export const MAINNET_NETWORKS: Record<string, NetworkConfig> = {
  Arc: {
    key: 'Arc',
    name: 'Arc',
    shortName: 'ARC',
    chainId: arcMainnet.id,
    testnet: false,
    cctpDomain: 26,
    circleBlockchain: 'ARC',
    capabilities: {
      send: true,
      bridge: true,
      swap: true,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      onramp: true,
      earn: true,
      borrow: true,
      faucet: false,
      privacy: true,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
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
      WETH: '0x128cC466B61f542da60c70e3aA11c10e19B84EDB',
      USYC: '0x8a5D989Bbb96929F689B0200f435f53dA42bF490',
    },
    tokenDecimals: { USDC: 6, EURC: 6, cirBTC: 8, WETH: 18, USYC: 6 },
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
    shortName: 'ETH',
    chainId: mainnet.id,
    testnet: false,
    cctpDomain: 0,
    circleBlockchain: 'ETH',
    capabilities: {
      send: true,
      bridge: true,
      swap: true,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      faucet: false,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://eth.llamarpc.com',
      fallbacks: ['https://rpc.ankr.com/eth', 'https://1rpc.io/eth'],
    },
    blockExplorers: { name: 'Etherscan', url: 'https://etherscan.io' },
    tokens: {
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      EURC: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c',
      WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    },
    tokenDecimals: { USDC: 6, EURC: 6, WETH: 18 },
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
    shortName: 'BASE',
    chainId: base.id,
    testnet: false,
    cctpDomain: 6,
    circleBlockchain: 'BASE',
    capabilities: {
      send: true,
      bridge: true,
      swap: true,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      faucet: false,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://mainnet.base.org',
      fallbacks: ['https://base.llamarpc.com', 'https://1rpc.io/base'],
    },
    blockExplorers: { name: 'BaseScan', url: 'https://basescan.org' },
    tokens: {
      USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      EURC: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1DD429',
      WETH: '0x4200000000000000000000000000000000000006',
    },
    tokenDecimals: { USDC: 6, EURC: 6, WETH: 18 },
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
    shortName: 'ARB',
    chainId: arbitrum.id,
    testnet: false,
    cctpDomain: 3,
    circleBlockchain: 'ARB',
    capabilities: {
      send: true,
      bridge: true,
      swap: true,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      faucet: false,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://arb1.arbitrum.io/rpc',
      fallbacks: ['https://arbitrum.llamarpc.com', 'https://1rpc.io/arb'],
    },
    blockExplorers: { name: 'Arbiscan', url: 'https://arbiscan.io' },
    tokens: {
      USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    },
    tokenDecimals: { USDC: 6, WETH: 18 },
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
    shortName: 'OP',
    chainId: optimism.id,
    testnet: false,
    cctpDomain: 2,
    circleBlockchain: 'OP',
    capabilities: {
      send: true,
      bridge: true,
      swap: true,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      faucet: false,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      primary: 'https://mainnet.optimism.io',
      fallbacks: ['https://optimism.llamarpc.com', 'https://1rpc.io/op'],
    },
    blockExplorers: { name: 'Optimism Explorer', url: 'https://optimistic.etherscan.io' },
    tokens: {
      USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      WETH: '0x4200000000000000000000000000000000000006',
    },
    tokenDecimals: { USDC: 6, WETH: 18 },
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
    shortName: 'POL',
    chainId: polygon.id,
    testnet: false,
    cctpDomain: 7,
    circleBlockchain: 'MATIC',
    capabilities: {
      send: true,
      bridge: true,
      swap: true,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      faucet: false,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
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
    shortName: 'AVAX',
    chainId: avalanche.id,
    testnet: false,
    cctpDomain: 1,
    circleBlockchain: 'AVAX',
    capabilities: {
      send: true,
      bridge: true,
      swap: true,
      gateway: true,
      unifiedBalance: true,
      ucw: true,
      faucet: false,
      privacy: false,
    },
    adapters: {
      viem: true,
      ethers: true,
      circleWallets: true,
      solana: false,
    },
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
    shortName: 'SOL',
    chainId: 999000,
    testnet: false,
    cctpDomain: 5,
    circleBlockchain: 'SOL',
    capabilities: {
      send: true,
      bridge: true,
      swap: true,
      gateway: true,
      unifiedBalance: true,
      ucw: false,
      faucet: false,
      privacy: false,
    },
    adapters: {
      viem: false,
      ethers: false,
      circleWallets: true,
      solana: true,
    },
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

/** Retrieve all networks supporting a given capability (send, bridge, swap, gateway, unifiedBalance, ucw, etc.) */
export function getNetworksByCapability(
  capability: keyof NetworkCapabilities,
  testnetOnly?: boolean
): NetworkConfig[] {
  const pool = testnetOnly === undefined
    ? Object.values(ACTIVE_NETWORKS)
    : testnetOnly
    ? Object.values(TESTNET_NETWORKS)
    : Object.values(MAINNET_NETWORKS)

  return pool.filter((net) => {
    if (capability === 'unifiedBalance') {
      return Boolean(net.capabilities?.unifiedBalance ?? net.capabilities?.gateway)
    }
    return Boolean(net.capabilities?.[capability])
  })
}

/** Check if a network supports a specific capability */
export function supportsCapability(
  target?: string | number | Chain,
  capability?: keyof NetworkCapabilities
): boolean {
  if (!target || !capability) return false
  const net = typeof target === 'number'
    ? getNetworkByChainId(target)
    : typeof target === 'string'
    ? getNetwork(target)
    : getNetworkByChainId((target as Chain)?.id)

  if (!net?.capabilities) return false
  if (capability === 'unifiedBalance') {
    return Boolean(net.capabilities.unifiedBalance ?? net.capabilities.gateway)
  }
  return Boolean(net.capabilities[capability])
}

/** Retrieve network capabilities object */
export function getNetworkCapabilities(chainKey?: string): NetworkCapabilities | undefined {
  return getNetwork(chainKey)?.capabilities
}

/** Retrieve all networks supporting a given wallet adapter (viem, ethers, circleWallets, solana) */
export function getNetworksByAdapter(
  adapter: keyof NetworkAdapters,
  testnetOnly?: boolean
): NetworkConfig[] {
  const pool = testnetOnly === undefined
    ? Object.values(ACTIVE_NETWORKS)
    : testnetOnly
    ? Object.values(TESTNET_NETWORKS)
    : Object.values(MAINNET_NETWORKS)

  return pool.filter((net) => Boolean(net.adapters?.[adapter]))
}

/** Check if a network supports a specific wallet adapter */
export function supportsAdapter(
  target?: string | number | Chain,
  adapter?: keyof NetworkAdapters
): boolean {
  if (!target || !adapter) return false
  const net = typeof target === 'number'
    ? getNetworkByChainId(target)
    : typeof target === 'string'
    ? getNetwork(target)
    : getNetworkByChainId((target as Chain)?.id)

  return Boolean(net?.adapters?.[adapter])
}

/** Retrieve network adapters object */
export function getNetworkAdapters(chainKey?: string): NetworkAdapters | undefined {
  return getNetwork(chainKey)?.adapters
}

/** Retrieve network short name / abbreviation (e.g. 'ARC', 'ETH', 'BASE', 'MON') */
export function getNetworkShortName(chainKey?: string): string {
  const net = getNetwork(chainKey)
  return net?.shortName || net?.name || chainKey || ''
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
    iconId: 'arc',
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
