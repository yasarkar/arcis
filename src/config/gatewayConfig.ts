// src/config/gatewayConfig.ts
// Circle Gateway Configuration (100% English)
// Master contract addresses, domain IDs, and API endpoints.
// Backed dynamically by src/config/networks/networkRegistry.ts.

import {
  IS_TESTNET,
  TESTNET_NETWORKS,
  MAINNET_NETWORKS,
  ACTIVE_NETWORKS,
} from './networks/networkRegistry'

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

// ── Gateway Domain IDs (Derived dynamically from Master Network Registry) ────
export const GATEWAY_DOMAINS_TESTNET: Record<string, number> = Object.fromEntries(
  Object.entries(TESTNET_NETWORKS)
    .filter(([_, net]) => net.cctpDomain !== undefined)
    .map(([key, net]) => [key, net.cctpDomain!])
)

export const GATEWAY_DOMAINS_MAINNET: Record<string, number> = Object.fromEntries(
  Object.entries(MAINNET_NETWORKS)
    .filter(([_, net]) => net.cctpDomain !== undefined)
    .map(([key, net]) => [key, net.cctpDomain!])
)

export const GATEWAY_DOMAINS = IS_TESTNET ? GATEWAY_DOMAINS_TESTNET : GATEWAY_DOMAINS_MAINNET

export const DOMAIN_TO_CHAIN: Record<number, string> = Object.entries(GATEWAY_DOMAINS).reduce(
  (acc, [chainKey, domainId]) => {
    acc[domainId] = chainKey
    return acc
  },
  {} as Record<number, string>
)

// ── USDC Contract Addresses (Derived dynamically from Master Network Registry)
export const USDC_ADDRESSES_TESTNET: Record<string, `0x${string}`> = Object.fromEntries(
  Object.entries(TESTNET_NETWORKS)
    .filter(([_, net]) => net.tokens.USDC && !net.ui.isSolana)
    .map(([key, net]) => [key, net.tokens.USDC as `0x${string}`])
)

export const USDC_ADDRESSES_MAINNET: Record<string, `0x${string}`> = Object.fromEntries(
  Object.entries(MAINNET_NETWORKS)
    .filter(([_, net]) => net.tokens.USDC && !net.ui.isSolana)
    .map(([key, net]) => [key, net.tokens.USDC as `0x${string}`])
)

export const USDC_ADDRESSES = IS_TESTNET ? USDC_ADDRESSES_TESTNET : USDC_ADDRESSES_MAINNET

// ── EURC Contract Addresses (Derived dynamically from Master Network Registry)
export const EURC_ADDRESSES_TESTNET: Record<string, `0x${string}`> = Object.fromEntries(
  Object.entries(TESTNET_NETWORKS)
    .filter(([_, net]) => net.tokens.EURC && !net.ui.isSolana)
    .map(([key, net]) => [key, net.tokens.EURC as `0x${string}`])
)

export const EURC_ADDRESSES_MAINNET: Record<string, `0x${string}`> = Object.fromEntries(
  Object.entries(MAINNET_NETWORKS)
    .filter(([_, net]) => net.tokens.EURC && !net.ui.isSolana)
    .map(([key, net]) => [key, net.tokens.EURC as `0x${string}`])
)

export const EURC_ADDRESSES = IS_TESTNET ? EURC_ADDRESSES_TESTNET : EURC_ADDRESSES_MAINNET

// ── cirBTC Contract Addresses ────────────────────────────────────────────────
export const CIRBTC_ADDRESSES: Record<string, `0x${string}`> = Object.fromEntries(
  Object.entries(ACTIVE_NETWORKS)
    .filter(([_, net]) => net.tokens.cirBTC)
    .map(([key, net]) => [key, net.tokens.cirBTC as `0x${string}`])
)

// ── Chain Display Names ──────────────────────────────────────────────────────
export const GATEWAY_CHAIN_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(ACTIVE_NETWORKS).map(([key, net]) => [key, net.name])
)

// ── Supported Gateway Chains ─────────────────────────────────────────────────
export const GATEWAY_SUPPORTED_CHAINS = Object.keys(GATEWAY_DOMAINS)

// ── EIP-712 Typed Data for Burn Intents ─────────────────────────────────────
export const GATEWAY_EIP712_DOMAIN = {
  name: 'GatewayWallet',
  version: '1',
} as const

export const GATEWAY_EIP712_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
  ],
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