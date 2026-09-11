// src/config/arcChain.ts
// Arc L1 Chain Configuration Facade (100% English)
// Backed by the Master Network Registry (src/config/networks/networkRegistry.ts)
// Single Source of Truth for Arc Testnet & Mainnet definitions.

import {
  APP_ENV,
  IS_TESTNET,
  arcTestnet,
  arcMainnet,
  TESTNET_NETWORKS,
  MAINNET_NETWORKS,
} from './networks/networkRegistry'

export { APP_ENV, IS_TESTNET, arcTestnet, arcMainnet }

/** Active Arc chain definition according to environment */
export const arcActiveChain = IS_TESTNET ? arcTestnet : arcMainnet

/** Token addresses for Arc Testnet */
export const ARC_TESTNET_TOKENS = {
  USDC: TESTNET_NETWORKS.Arc_Testnet.tokens.USDC as `0x${string}`,
  EURC: TESTNET_NETWORKS.Arc_Testnet.tokens.EURC as `0x${string}`,
  cirBTC: (TESTNET_NETWORKS.Arc_Testnet.tokens.cirBTC || '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF') as `0x${string}`,
} as const

/** Token addresses for Arc Mainnet */
export const ARC_MAINNET_TOKENS = {
  USDC: (MAINNET_NETWORKS.Arc?.tokens.USDC || '0x3600000000000000000000000000000000000000') as `0x${string}`,
  EURC: (MAINNET_NETWORKS.Arc?.tokens.EURC || '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a') as `0x${string}`,
  cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF' as `0x${string}`,
} as const

/** Active token addresses according to environment */
export const ARC_TOKENS = IS_TESTNET ? ARC_TESTNET_TOKENS : ARC_MAINNET_TOKENS

/** Arc network metadata for UI and telemetry */
export const ARC_METADATA = {
  cctpDomain: 26,
  faucetUrl: 'https://faucet.circle.com',
  rpcHttpUrl: arcActiveChain.rpcUrls.default.http[0],
  rpcWsUrl: arcActiveChain.rpcUrls.default.webSocket?.[0] || (IS_TESTNET ? 'wss://rpc.testnet.arc.network' : 'wss://rpc.arc.io'),
  explorerUrl: arcActiveChain.blockExplorers?.default.url || 'https://testnet.arcscan.app',
  isTestnet: IS_TESTNET,
}
