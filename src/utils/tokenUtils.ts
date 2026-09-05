export interface NativeTokenInfo {
  symbol: string
  name: string
  decimals: number
}

export const CHAIN_NATIVE_MAP: Record<string, NativeTokenInfo> = {
  // Avalanche
  Avalanche_Fuji: { symbol: 'AVAX', name: 'Avalanche Fuji AVAX', decimals: 18 },

  // Ethereum & EVM L2/L3s
  Ethereum_Sepolia: { symbol: 'ETH', name: 'Sepolia Ether', decimals: 18 },
  Base_Sepolia: { symbol: 'ETH', name: 'Base Sepolia Ether', decimals: 18 },
  Arbitrum_Sepolia: { symbol: 'ETH', name: 'Arbitrum Sepolia Ether', decimals: 18 },
  Optimism: { symbol: 'ETH', name: 'Optimism Ether', decimals: 18 },
  Optimism_Sepolia: { symbol: 'ETH', name: 'Optimism Sepolia Ether', decimals: 18 },
  Linea_Sepolia: { symbol: 'ETH', name: 'Linea Sepolia Ether', decimals: 18 },
  Unichain_Sepolia: { symbol: 'ETH', name: 'Unichain Sepolia Ether', decimals: 18 },
  Ink_Testnet: { symbol: 'ETH', name: 'Ink Testnet Ether', decimals: 18 },
  World_Chain_Sepolia: { symbol: 'ETH', name: 'World Chain Sepolia Ether', decimals: 18 },

  // Polygon
  Polygon_Amoy_Testnet: { symbol: 'POL', name: 'Amoy POL', decimals: 18 },

  // Solana
  Solana_Devnet: { symbol: 'SOL', name: 'Solana Devnet SOL', decimals: 9 },

  // Other Networks
  Sonic_Testnet: { symbol: 'S', name: 'Sonic Testnet Token', decimals: 18 },
  Sei_Testnet: { symbol: 'SEI', name: 'Sei Testnet Token', decimals: 6 },
  Cronos_Testnet: { symbol: 'CRO', name: 'Cronos Testnet Token', decimals: 18 },
  XDC_Apothem: { symbol: 'XDC', name: 'XDC Apothem Token', decimals: 18 },

  // Arc
  Arc_Testnet: { symbol: 'USDC', name: 'Arc Testnet USDC', decimals: 18 }
}

// Returns the symbol to be shown in the UI based on the chain name and token.
export function getDisplayTokenSymbol(chain: string, token: string): string {
  if (token === 'NATIVE') {
    return CHAIN_NATIVE_MAP[chain]?.symbol || 'NATIVE'
  }
  return token
}

/**
 * Formats a numeric fee value to at most `maxDecimals` (default 6) meaningful digits,
 * stripping floating-point inaccuracies (e.g. 0.15421200000000002 -> 0.154212).
 */
export function formatFeeDecimals(val: number | string | null | undefined, maxDecimals = 6): string {
  if (val === null || val === undefined || val === '') return '0.00'
  const num = typeof val === 'number' ? val : parseFloat(val)
  if (isNaN(num)) return '0.00'
  if (num === 0) return '0.00'

  // Eliminate IEEE-754 precision artifacts by rounding to maxDecimals
  const fixed = Number(num.toFixed(maxDecimals))
  const parts = fixed.toString().split('.')
  if (parts.length === 1) return `${parts[0]}.00`
  if (parts[1].length === 1) return `${parts[0]}.${parts[1]}0`
  return fixed.toString()
}
