// src/config/bridgeConfig.ts
// Arcis Protocol Bridge Configuration Facade (100% English)
// Chains backed by src/config/chainMeta.ts, fees backed by src/config/fees.ts.

import {
  CHAIN_META,
  CHAIN_DEFS,
  getChainIconId,
  getChainDisplayName,
  resolveCanonicalChainKey,
  isSolanaChain,
  getNetworksByCapability,
  type ChainMetaItem,
} from './chainMeta'
import { IS_TESTNET } from './networks/networkRegistry'
import { GATEWAY_SUPPORTED_CHAINS } from './gatewayConfig'
import { USDC_EXCLUDED_CHAINS } from './bridgeRouteMatrix'

export {
  CHAIN_META,
  CHAIN_DEFS,
  getChainIconId,
  getChainDisplayName,
  resolveCanonicalChainKey,
  type ChainMetaItem,
}

export const BRIDGE_CHAIN_META = CHAIN_META
export const BRIDGE_CHAIN_DEFS = CHAIN_DEFS

/**
 * EVM chains offered by the Bridge tab's Direct CCTP route selectors.
 *
 * Derived from Master Network Registry (`capabilities.bridge`) across all
 * live-verified, forwarder-compatible EVM CCTP v2 testnets (22 chains).
 * Solana Devnet and non-forwarder destinations stay excluded via USDC_EXCLUDED_CHAINS.
 */
export const BRIDGE_SELECTABLE_CHAINS: string[] = getNetworksByCapability('bridge', IS_TESTNET)
  .map((net) => net.key)
  .filter((chainKey) => !isSolanaChain(chainKey) && !USDC_EXCLUDED_CHAINS[chainKey])

/**
 * EVM chains offered by the Bridge tab's Gateway (Unified Balance) mode.
 * Strict subset of GATEWAY_SUPPORTED_CHAINS excluding Solana.
 */
export const BRIDGE_GATEWAY_SELECTABLE_CHAINS: string[] = GATEWAY_SUPPORTED_CHAINS.filter(
  (chainKey) => !isSolanaChain(chainKey)
)
/**
 * Whether the Bridge tab can serve `chainKey` at all.
 *
 * Entry points (the portfolio's per-chain Bridge button, a deep link, a restored
 * session) hand the tab a chain hint. A hint outside this list would leave the
 * tab on a pair nobody can bridge — an empty destination list with an enabled
 * CTA — so hints are clamped through here instead of trusted.
 */
export function isBridgeSelectableChain(chainKey?: string | null): boolean {
  return Boolean(chainKey) && BRIDGE_SELECTABLE_CHAINS.includes(chainKey as string)
}

export const getBridgeChainIconId = getChainIconId
export const getBridgeChainDisplayName = getChainDisplayName
export const resolveBridgeChainKey = resolveCanonicalChainKey

// Re-export centralized bridge fee configuration
export {
  type BridgeCustomFeeConfig,
  BRIDGE_CUSTOM_FEE_CONFIG,
  getBridgeProtocolFee,
  getBridgeProtocolFeeBps,
  getBridgeProtocolFeePercent,
  calculateBridgeProtocolFeeAmount,
} from './fees'