// src/config/gatewayConfig.ts
//
// Circle Gateway configuration — contract addresses, domain IDs, and API endpoints.
// Gateway provides a unified USDC balance across multiple blockchains with
// instant (<500ms) crosschain transfers.

import { IS_TESTNET } from './arcChain'

// ── Gateway REST API ─────────────────────────────────────────────────────────
export const GATEWAY_API = {
  testnet: 'https://gateway-api-testnet.circle.com/v1',
  mainnet: 'https://gateway-api.circle.com/v1',
} as const

export const ACTIVE_GATEWAY_API = IS_TESTNET ? GATEWAY_API.testnet : GATEWAY_API.mainnet

// ── Gateway Contract Addresses (Testnet & Mainnet) ──────────────────────────
export const GATEWAY_CONTRACTS = {
  testnet: {
    gatewayWallet: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as `0x${string}`,
    gatewayMinter: '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B' as `0x${string}`,
  },
  mainnet: {
    gatewayWallet: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE' as `0x${string}`,
    gatewayMinter: '0x2222222d7164433c4C09B0b0D809a9b52C04C205' as `0x${string}`,
  },
} as const

export const ACTIVE_GATEWAY_CONTRACTS = IS_TESTNET ? GATEWAY_CONTRACTS.testnet : GATEWAY_CONTRACTS.mainnet

// ── Gateway Domain IDs ───────────────────────────────────────────────────────
export const GATEWAY_DOMAINS_TESTNET: Record<string, number> = {
  Arc_Testnet: 26,
  Ethereum_Sepolia: 0,
  Base_Sepolia: 6,
  Arbitrum_Sepolia: 3,
  Optimism_Sepolia: 2,
  Polygon_Amoy_Testnet: 7,
  Avalanche_Fuji: 1,
  HyperEVM_Testnet: 19,
  Sei_Testnet: 16,
  Solana_Devnet: 5,
  Sonic_Testnet: 13,
  Unichain_Sepolia: 10,
  World_Chain_Sepolia: 14,
}

export const GATEWAY_DOMAINS_MAINNET: Record<string, number> = {
  Arc: 26,
  Ethereum: 0,
  Base: 6,
  Arbitrum: 3,
  Optimism: 2,
  Polygon: 7,
  Avalanche: 1,
  Solana: 5,
}

export const GATEWAY_DOMAINS = IS_TESTNET ? GATEWAY_DOMAINS_TESTNET : GATEWAY_DOMAINS_MAINNET

// ── USDC Contract Addresses ──────────────────────────────────────────────────
export const USDC_ADDRESSES_TESTNET: Record<string, `0x${string}`> = {
  Arc_Testnet: '0x3600000000000000000000000000000000000000',
  Ethereum_Sepolia: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  Base_Sepolia: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  Arbitrum_Sepolia: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  Optimism_Sepolia: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
  Polygon_Amoy_Testnet: '0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582',
  Avalanche_Fuji: '0x5425890298aed601595a70ab815c96711a31bc65',
  HyperEVM_Testnet: '0x2B3370eE501B4a559b57D449569354196457D8Ab',
  Sei_Testnet: '0x4fCF1784B31630811181f670Aea7A7bEF803eaED',
  Sonic_Testnet: '0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51',
  Unichain_Sepolia: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
  World_Chain_Sepolia: '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88',
}

export const USDC_ADDRESSES_MAINNET: Record<string, `0x${string}`> = {
  Arc: '0x3600000000000000000000000000000000000000',
  Ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  Base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  Arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  Optimism: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  Polygon: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  Avalanche: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
}

export const USDC_ADDRESSES = IS_TESTNET ? USDC_ADDRESSES_TESTNET : USDC_ADDRESSES_MAINNET

// ── EURC Contract Addresses ──────────────────────────────────────────────────
export const EURC_ADDRESSES_TESTNET: Record<string, `0x${string}`> = {
  Arc_Testnet: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  Ethereum_Sepolia: '0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4',
  Base_Sepolia: '0x808007a79a5b6f3d99d3e8e21adbfcecfec11124',
  Arbitrum_Sepolia: '0xA8C865719483955250774276726980b0D0008d68',
  Avalanche_Fuji: '0x3231cb76718CDef2155FC47b5286d82e6eDA273f',
  Optimism_Sepolia: '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8',
}

export const EURC_ADDRESSES_MAINNET: Record<string, `0x${string}`> = {
  Arc: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  Ethereum: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c',
  Base: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1DD429',
  Avalanche: '0xC891EB4cbdEFf6e073e859e987815Ed43c477641',
}

export const EURC_ADDRESSES = IS_TESTNET ? EURC_ADDRESSES_TESTNET : EURC_ADDRESSES_MAINNET

// ── cirBTC Contract Addresses ────────────────────────────────────────────────
export const CIRBTC_ADDRESSES: Record<string, `0x${string}`> = {
  Arc_Testnet: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
  Arc: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
}

// ── Chain Display Names ──────────────────────────────────────────────────────
export const GATEWAY_CHAIN_NAMES: Record<string, string> = {
  Arc_Testnet: 'Arc Testnet',
  Arc: 'Arc Mainnet',
  Ethereum_Sepolia: 'Ethereum Sepolia',
  Ethereum: 'Ethereum',
  Base_Sepolia: 'Base Sepolia',
  Base: 'Base',
  Arbitrum_Sepolia: 'Arbitrum Sepolia',
  Arbitrum: 'Arbitrum One',
  Optimism_Sepolia: 'Optimism Sepolia',
  Optimism: 'OP Mainnet',
  Polygon_Amoy_Testnet: 'Polygon Amoy',
  Polygon: 'Polygon',
  Avalanche_Fuji: 'Avalanche Fuji',
  Avalanche: 'Avalanche C-Chain',
  HyperEVM_Testnet: 'HyperEVM Testnet',
  Sei_Testnet: 'Sei Testnet',
  Solana_Devnet: 'Solana Devnet',
  Solana: 'Solana',
  Sonic_Testnet: 'Sonic Testnet',
  Unichain_Sepolia: 'Unichain Sepolia',
  World_Chain_Sepolia: 'World Chain Sepolia',
}

// ── Supported Gateway Chains ─────────────────────────────────────────────────
export const GATEWAY_SUPPORTED_CHAINS = Object.keys(GATEWAY_DOMAINS)

// ── EIP-712 Typed Data for Burn Intents ─────────────────────────────────────
export const GATEWAY_EIP712_DOMAIN = {
  name: 'GatewayWallet',
  version: '1',
} as const

export const GATEWAY_EIP712_TYPES = {
  BurnIntent: [
    { name: 'maxBlockHeight', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'spec', type: 'TransferSpec' },
  ],
  TransferSpec: [
    { name: 'version', type: 'uint32' },
    { name: 'sourceDomain', type: 'uint32' },
    { name: 'destinationDomain', type: 'uint32' },
    { name: 'sourceContract', type: 'bytes32' },
    { name: 'destinationContract', type: 'bytes32' },
    { name: 'sourceToken', type: 'bytes32' },
    { name: 'destinationToken', type: 'bytes32' },
    { name: 'sourceDepositor', type: 'bytes32' },
    { name: 'destinationRecipient', type: 'bytes32' },
    { name: 'sourceSigner', type: 'bytes32' },
    { name: 'destinationCaller', type: 'bytes32' },
    { name: 'value', type: 'uint256' },
    { name: 'salt', type: 'bytes32' },
    { name: 'hookData', type: 'bytes' },
  ],
} as const

// ── ABIs ─────────────────────────────────────────────────────────────────────
export const GATEWAY_WALLET_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

export const GATEWAY_MINTER_ABI = [
  {
    name: 'gatewayMint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'attestation', type: 'bytes' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

// ── Gas Limits ───────────────────────────────────────────────────────────────
export const GATEWAY_GAS_LIMITS = {
  approve: 65_000n,
  deposit: 120_000n,
  mint: 150_000n,
} as const

export const GATEWAY_MAX_FEE = 10_000_000n // 10 USDC max fee