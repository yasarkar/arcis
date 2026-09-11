// src/config/bridgeConfig.ts
// Arcis Protocol Bridge Configuration Facade (100% English)
// Chains backed by src/config/chainMeta.ts, fees backed by src/config/fees.ts.

import {
  CHAIN_META,
  CHAIN_DEFS,
  getChainIconId,
  getChainDisplayName,
  resolveCanonicalChainKey,
  type ChainMetaItem,
} from './chainMeta'

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