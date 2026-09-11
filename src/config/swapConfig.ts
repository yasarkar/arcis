// src/config/swapConfig.ts
// Arcis Protocol Swap Configuration Facade (100% English)
// Chains backed by src/config/chainMeta.ts, fees backed by src/config/fees.ts.

import { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName } from './chainMeta'

export { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName }

// Swap focuses on Arc Testnet as primary native token swap network
export const SWAP_CHAIN_META = {
  Arc_Testnet: CHAIN_META.Arc_Testnet,
}
export const SWAP_CHAIN_DEFS = {
  Arc_Testnet: CHAIN_DEFS.Arc_Testnet,
}
export const getSwapChainIconId = (chainKey: string = 'Arc_Testnet') => getChainIconId(chainKey)

// Re-export centralized swap fee configuration
export {
  type SwapCustomFeeConfig,
  SWAP_CUSTOM_FEE_CONFIG,
  getSwapFeePercent,
  calculateSwapFeeAmount,
  getSwapProtocolFeeBps,
  getSwapProtocolFeePercent,
  calculateSwapProtocolFeeAmount,
} from './fees'