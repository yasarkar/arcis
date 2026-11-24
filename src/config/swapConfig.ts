// src/config/swapConfig.ts
// Arcis Protocol Swap Configuration Facade (100% English)
// Chains backed by src/config/chainMeta.ts, fees backed by src/config/fees.ts.

import { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName } from './chainMeta'

export { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName }

// Swap focuses on Arc Testnet as the sole supported testnet swap network
export const DEFAULT_SWAP_CHAIN = 'Arc_Testnet' as const
export const SUPPORTED_TESTNET_SWAP_CHAINS = ['Arc_Testnet'] as const

export const SWAP_CHAIN_META = {
  Arc_Testnet: CHAIN_META.Arc_Testnet,
}
export const SWAP_CHAIN_DEFS = {
  Arc_Testnet: CHAIN_DEFS.Arc_Testnet,
}
export const getSwapChainIconId = (chainKey: string = DEFAULT_SWAP_CHAIN) => getChainIconId(chainKey)

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