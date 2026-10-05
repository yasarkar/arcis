// src/utils/circleBlockchain.ts
//
// Single source of truth for Circle UCW TokenBlockchain identifiers.
// Shared by the Send flow (normalizeCircleBlockchain) and the Bridge/Gateway
// flows (mapChainKeyToCircleBlockchain).

/**
 * Explicit chainKey → Circle TokenBlockchain map for the chains Circle UCW
 * supports. Unknown chains MUST fail closed: guessing a substitute chain (e.g.
 * collapsing any "*_Sepolia" into ETH-SEPOLIA, or falling back to ARC-TESTNET)
 * risks signing the transfer on the wrong blockchain and losing funds.
 */
export const CIRCLE_UCW_BLOCKCHAIN_MAP: Record<string, string> = {
  Arc_Testnet: 'ARC-TESTNET',
  Arc: 'ARC',
  Base_Sepolia: 'BASE-SEPOLIA',
  Base: 'BASE',
  Ethereum_Sepolia: 'ETH-SEPOLIA',
  Ethereum: 'ETH',
  Arbitrum_Sepolia: 'ARB-SEPOLIA',
  Arbitrum: 'ARB',
  Optimism_Sepolia: 'OP-SEPOLIA',
  Optimism: 'OP',
  Avalanche_Fuji: 'AVAX-FUJI',
  Avalanche: 'AVAX',
  Polygon_Amoy_Testnet: 'MATIC-AMOY',
  Polygon_Amoy: 'MATIC-AMOY',
  Polygon: 'MATIC',
  Solana_Devnet: 'SOL-DEVNET',
  Solana: 'SOL',
}

/** Whether Circle UCW can execute transfers on the given app chain. */
export function isCircleUcwChain(chainStr?: string): boolean {
  return !!chainStr && Object.prototype.hasOwnProperty.call(CIRCLE_UCW_BLOCKCHAIN_MAP, chainStr)
}

/** Helper to map app chain names to Circle UCW TokenBlockchain enum */
export function normalizeCircleBlockchain(chainStr?: string): string {
  if (!chainStr) return 'ARC-TESTNET'
  const trimmed = chainStr.trim()
  const exact = CIRCLE_UCW_BLOCKCHAIN_MAP[trimmed]
  if (exact) return exact
  // Canonicalize separators so both display-style keys ("Arc Testnet",
  // "base sepolia") and already-normalized identifiers ("ETH", "ETH-SEPOLIA")
  // resolve — but only ever to an explicitly whitelisted chain.
  const canonical = trimmed.replace(/[\s-]+/g, '_').toLowerCase()
  for (const value of new Set(Object.values(CIRCLE_UCW_BLOCKCHAIN_MAP))) {
    if (value.replace(/[\s-]+/g, '_').toLowerCase() === canonical) return value
  }
  for (const [key, value] of Object.entries(CIRCLE_UCW_BLOCKCHAIN_MAP)) {
    if (key.toLowerCase() === canonical) return value
  }
  throw new Error(
    `Circle UCW transfers are not supported on "${chainStr}". Select a supported network and try again.`
  )
}
