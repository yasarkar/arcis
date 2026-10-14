export interface NativeTokenInfo {
  symbol: string
  name: string
  decimals: number
}

export const CHAIN_NATIVE_MAP: Record<string, NativeTokenInfo> = {
  Ethereum_Sepolia: { symbol: 'ETH', name: 'Sepolia Ether', decimals: 18 },
  Base_Sepolia: { symbol: 'ETH', name: 'Base Sepolia Ether', decimals: 18 },
  Arbitrum_Sepolia: { symbol: 'ETH', name: 'Arbitrum Sepolia Ether', decimals: 18 },
  Optimism_Sepolia: { symbol: 'ETH', name: 'Optimism Sepolia Ether', decimals: 18 },
  Linea_Sepolia: { symbol: 'ETH', name: 'Linea Sepolia Ether', decimals: 18 },
  Unichain_Sepolia: { symbol: 'ETH', name: 'Unichain Sepolia Ether', decimals: 18 },
  Ink_Testnet: { symbol: 'ETH', name: 'Ink Testnet Ether', decimals: 18 },
  World_Chain_Sepolia: { symbol: 'ETH', name: 'World Chain Sepolia Ether', decimals: 18 },
  Plume_Testnet: { symbol: 'ETH', name: 'Plume Testnet Ether', decimals: 18 },
  Codex_Testnet: { symbol: 'ETH', name: 'Codex Testnet Ether', decimals: 18 },
  Edge_Testnet: { symbol: 'ETH', name: 'Edge Testnet Ether', decimals: 18 },
  Morph_Testnet: { symbol: 'ETH', name: 'Morph Testnet Ether', decimals: 18 },
  
  Avalanche_Fuji: { symbol: 'AVAX', name: 'Avalanche Fuji AVAX', decimals: 18 },
  Polygon_Amoy_Testnet: { symbol: 'POL', name: 'Amoy POL', decimals: 18 },
  Solana_Devnet: { symbol: 'SOL', name: 'Solana Devnet SOL', decimals: 9 },
  Sonic_Testnet: { symbol: 'S', name: 'Sonic Testnet Token', decimals: 18 },
  Sei_Testnet: { symbol: 'SEI', name: 'Sei Testnet Token', decimals: 6 },
  Cronos_Testnet: { symbol: 'CRO', name: 'Cronos Testnet Token', decimals: 18 },
  XDC_Apothem: { symbol: 'XDC', name: 'XDC Apothem Token', decimals: 18 },
  Monad_Testnet: { symbol: 'MON', name: 'Monad Testnet Token', decimals: 18 },
  Injective_Testnet: { symbol: 'INJ', name: 'Injective Testnet Token', decimals: 18 },
  X_Layer_Testnet: { symbol: 'OKB', name: 'X Layer OKB', decimals: 18 },
  OKB_Testnet: { symbol: 'OKB', name: 'X Layer OKB', decimals: 18 },
  Plasma_Testnet: { symbol: 'XPL', name: 'Plasma Testnet Token', decimals: 18 },
  Arc_Testnet: { symbol: 'USDC', name: 'Arc Testnet USDC', decimals: 18 },
  HyperEVM_Testnet: { symbol: 'HYPE', name: 'HyperEVM Testnet', decimals: 18 },
  Pharos_Testnet: { symbol: 'PHRS', name: 'Pharos Atlantic PHRS', decimals: 18 }
}

// Returns the symbol to be shown in the UI based on the chain name and token.
export function getDisplayTokenSymbol(chain: string, token: string): string {
  if (token === 'NATIVE') {
    return CHAIN_NATIVE_MAP[chain]?.symbol || 'NATIVE'
  }
  return token
}

/**
 * Returns a human-friendly standard name for native gas tokens (e.g. 'Ethereum', 'Avalanche', 'Polygon').
 */
export function getCleanNativeTokenName(symbol: string): string {
  switch (symbol.toUpperCase()) {
    case 'ETH':
      return 'Ethereum'
    case 'AVAX':
      return 'Avalanche'
    case 'POL':
    case 'MATIC':
      return 'Polygon'
    case 'SOL':
      return 'Solana'
    case 'S':
      return 'Sonic'
    case 'SEI':
      return 'Sei'
    case 'CRO':
      return 'Cronos'
    case 'XDC':
      return 'XDC Network'
    case 'MON':
      return 'Monad'
    case 'INJ':
      return 'Injective'
    case 'OKB':
    case 'XLAYER':
    case 'X_LAYER':
      return 'OKB'
    case 'XPL':
      return 'Plasma'
    case 'HYPE':
      return 'HyperEVM'
    case 'PHRS':
      return 'Pharos'
    case 'USDC':
      return 'USD Coin'
    default:
      return 'Native Gas Token'
  }
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
