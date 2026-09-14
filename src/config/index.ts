// src/config/index.ts
// Arcis Protocol Central Configuration Hub (100% English)
// Single entry-point for all core configurations, fees, treasury, chains, and error definitions.

// 1. Unified Fees, Treasury & Speed Tiers
export * from './fees'

// 2. System Constraints, Limits & Magic Numbers
export * from './constants'

// 3. Chain Metadata & UI Resolvers
export * from './chainMeta'

// 4. Token Icons & Map
export * from './tokenIcons'

// 3. Network Registry & Runtime Helpers
export {
  APP_ENV,
  IS_TESTNET,
  ALL_NETWORKS,
  ACTIVE_NETWORKS,
  getNetwork,
  getViemChain,
  getNetworkRpcUrls,
  getTokenAddress,
  getDecimals,
  arcActiveChain,
  arcTestnet,
  arcMainnet,
  getNetworkByChainId,
  resolveChain,
  hyperEVMTestnet,
  seiTestnet,
  sonicTestnet,
  unichainSepolia,
  worldChainSepolia,
  type NetworkConfig,
  type NetworkUiConfig,
} from './networks/networkRegistry'

// 4. Central Error Definitions
export {
  ERROR_DEFINITIONS,
  type ErrorDefinition,
} from './errorMessages'
