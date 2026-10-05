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
  type ChainMetaItem,
} from './chainMeta'
import { GATEWAY_SUPPORTED_CHAINS } from './gatewayConfig'

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
 * Chains offered by the Bridge tab's route selectors.
 *
 * Solana Devnet has a CCTP domain, so it is part of GATEWAY_SUPPORTED_CHAINS,
 * but the Bridge tab cannot serve it: wallet balances, destination-delivery
 * verification and address handling on this surface are EVM-only (a transfer
 * to/from Solana can never be confirmed and shows "Pending" forever). Keep it
 * out of the selectors until those paths support it.
 */
export const BRIDGE_SELECTABLE_CHAINS: string[] = GATEWAY_SUPPORTED_CHAINS.filter(
  (chainKey) => !isSolanaChain(chainKey)
)
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