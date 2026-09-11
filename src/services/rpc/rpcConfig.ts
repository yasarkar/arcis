// src/services/rpc/rpcConfig.ts
// Redundant, multi-endpoint RPC configuration for Arc & connected EVM networks.
// Backed by the centralized network registry (src/config/networks/networkRegistry.ts)
// Provides prioritized primary and fallback endpoints to guarantee high availability.

import {
  IS_TESTNET,
  getNetworkRpcUrls,
  MULTI_CHAIN_RPC_FALLBACKS,
  TESTNET_NETWORKS,
  MAINNET_NETWORKS,
} from '../../config/networks/networkRegistry'

export interface ChainRpcConfig {
  chainId: number
  name: string
  primaryRpc: string
  fallbacks: string[]
  timeoutMs: number
  retryCount: number
  retryDelayMs: number
}

// ─────────────────────────────────────────────────────────────
// 1. ARC NETWORK RPC ENDPOINTS (Primary + Redundant Mirrors)
// ─────────────────────────────────────────────────────────────
export const ARC_TESTNET_RPCS = getNetworkRpcUrls('Arc_Testnet')
export const ARC_MAINNET_RPCS = getNetworkRpcUrls('Arc')
export const ACTIVE_ARC_RPCS = IS_TESTNET ? ARC_TESTNET_RPCS : ARC_MAINNET_RPCS

// ─────────────────────────────────────────────────────────────
// 2. MULTI-CHAIN RPC FALLBACK ENDPOINTS
// ─────────────────────────────────────────────────────────────
// Unified fallback lookup containing all testnet & mainnet chains
export const TESTNET_RPC_FALLBACKS: Record<string, { chainId: number; urls: string[] }> =
  MULTI_CHAIN_RPC_FALLBACKS

// ─────────────────────────────────────────────────────────────
// 3. RPC TIMING & RESILIENCE DEFAULTS (Backed by config/constants)
// ─────────────────────────────────────────────────────────────
export {
  RPC_CONSTRAINTS,
  RPC_DEFAULT_TIMEOUT_MS,
  RPC_FAST_READ_TIMEOUT_MS,
  RPC_RECEIPT_TIMEOUT_MS,
  RPC_DEFAULT_RETRIES,
  RPC_DEFAULT_RETRY_DELAY_MS,
} from '../../config/constants'

