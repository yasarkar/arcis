// src/config/x402/schemes.ts
// EIP-3009 and Circle Gateway Nanopayments scheme definitions

import { arcTestnet, ARC_TESTNET_TOKENS } from '../arcChain'

export const X402_SCHEMES = {
  EXACT: 'exact',
} as const

export const X402_NETWORKS = {
  ARC_TESTNET: 'arcTestnet',
  BASE_SEPOLIA: 'baseSepolia',
  // CAIP-2 standard identifiers
  CAIP2_ARC_TESTNET: 'eip155:5042002',
  CAIP2_ARC_MAINNET: 'eip155:5042',
  CAIP2_BASE_SEPOLIA: 'eip155:84532',
} as const

export const GATEWAY_CONTRACTS = {
  testnet: {
    gatewayWallet: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const,
    gatewayMinter: '0x0022222ABE238Cc2C7Bb1f21003F0a260052475B' as const,
  },
  mainnet: {
    gatewayWallet: '0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE' as const,
    gatewayMinter: '0x2222222d7164433c4C09B0b0D809a9b52C04C205' as const,
  },
} as const

export const CIRCLE_BATCHING_METADATA = {
  NAME: 'GatewayWalletBatched',
  VERSION: '1',
  // Gateway requires at least 7 days of authorization validity. The Circle SDK
  // advertises/signs 100 extra seconds to absorb request and clock skew.
  MIN_AUTH_VALIDITY_SECONDS: 604800,
  MAX_TIMEOUT_SECONDS: 604900,
  FULL_VALIDITY_SECONDS: 604900,
} as const

/**
 * Circle Gateway Nanopayments (x402 v2, batched) EIP-712 Domain
 * Primary path as specified in ADR-003
 */
export const GATEWAY_BATCHED_DOMAIN = {
  name: CIRCLE_BATCHING_METADATA.NAME,
  version: CIRCLE_BATCHING_METADATA.VERSION,
  chainId: arcTestnet.id, // 5042002
  verifyingContract: GATEWAY_CONTRACTS.testnet.gatewayWallet,
} as const

/**
 * Vanilla on-chain x402 exact EIP-712 Domain (USDC contract)
 * Maintained as secondary fallback for premium transactions (ADR-003 Option B)
 */
export const DEFAULT_X402_DOMAIN = {
  name: 'USD Coin',
  version: '2',
  chainId: arcTestnet.id, // 5042002
  verifyingContract: ARC_TESTNET_TOKENS.USDC,
} as const

export const EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const
