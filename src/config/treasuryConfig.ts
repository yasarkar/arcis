// Centralized Arcis Treasury & Protocol Fee Configuration.
// Governs dynamic protocol fees across Send, Swap, and Bridge modules,
// scaled by the user's selected Speed & Priority tier (Standard / Fast / Turbo).
import type { SpeedTier } from './feeTiers'

// ── Multi-Chain Treasury Addresses ──────────────────────────────────────────
// Circle AppKit requires customFee.recipientAddress to be on the SOURCE blockchain.
export const TREASURY_ADDRESSES = {
  evm: ((import.meta.env.VITE_EVM_TREASURY_ADDRESS || import.meta.env.VITE_TREASURY_ADDRESS || '0x5f8f4cc0403332fc9c22a23222ddb9b267bf2e70') as `0x${string}`),
  solana: ((import.meta.env.VITE_SOLANA_TREASURY_ADDRESS || 'B7kcP7xq54hyy5yKZwLCrxcUUrDYG7tngwmDoNHGdRYY') as string),
  injective: ((import.meta.env.VITE_INJECTIVE_TREASURY_ADDRESS || 'inj16j2px4nvs3anafx6gmg8nrt3llku23n0fsygwg') as string),
} as const

// Backwards-compatible default (EVM)
export const TREASURY_ADDRESS = TREASURY_ADDRESSES.evm

export const TREASURY_EXPLORER_URL = `https://testnet.arcscan.app/address/${TREASURY_ADDRESS}`

/**
 * Resolves the appropriate treasury recipient address based on the source blockchain.
 * Circle AppKit rule: custom fee recipient MUST be on the source chain where the fee is debited.
 */
export function getTreasuryRecipientAddress(chainKeyOrName?: string): string {
  if (!chainKeyOrName) return TREASURY_ADDRESSES.evm

  const chainLower = chainKeyOrName.toLowerCase()

  if (chainLower.includes('solana')) {
    return TREASURY_ADDRESSES.solana
  }

  if (chainLower.includes('injective')) {
    return TREASURY_ADDRESSES.injective
  }

  return TREASURY_ADDRESSES.evm
}

/**
 * Returns explorer URL for a treasury address on a given chain
 */
export function getTreasuryExplorerUrl(chainKey: string = 'Arc_Testnet'): string {
  const chainLower = chainKey.toLowerCase()
  if (chainLower.includes('solana')) {
    return `https://explorer.solana.com/address/${TREASURY_ADDRESSES.solana}?cluster=devnet`
  }
  if (chainLower.includes('injective')) {
    return `https://testnet.explorer.injective.network/account/${TREASURY_ADDRESSES.injective}`
  }
  if (chainLower.includes('arc')) {
    return `https://testnet.arcscan.app/address/${TREASURY_ADDRESSES.evm}`
  }
  if (chainLower.includes('base')) {
    return `https://sepolia.basescan.org/address/${TREASURY_ADDRESSES.evm}`
  }
  if (chainLower.includes('eth') || chainLower.includes('sepolia')) {
    return `https://sepolia.etherscan.io/address/${TREASURY_ADDRESSES.evm}`
  }
  return `https://testnet.arcscan.app/address/${TREASURY_ADDRESSES.evm}`
}

// Revenue sharing model according to Circle AppKit & Arc documentation
export const REVENUE_SHARE_LABEL = '%90 Dev / %10 Arc'
export const REVENUE_SHARE_TOOLTIP =
  'Circle AppKit Revenue Sharing: 90% of the protocol fee goes to the Arcis Treasury and 10% supports the Arc Network ecosystem.'

export interface ModuleProtocolFeeConfig {
  send: Record<SpeedTier, { valueUsdc: number; label: string; description: string }>
  swap: Record<SpeedTier, { bps: number; label: string; description: string }>
  bridge: Record<SpeedTier, { bps: number; valueUsdc?: number; label: string; description: string }>
}

export const PROTOCOL_FEE_RATES: ModuleProtocolFeeConfig = {
  send: {
    standard: {
      valueUsdc: 0.0,
      label: 'Free Platform Fee',
      description: 'Standard 20 Gwei Base Fee (~$0.00042 USDC Gas)',
    },
    fast: {
      valueUsdc: 0.0,
      label: 'Free Platform Fee',
      description: 'Recommended 25 Gwei Priority (~$0.00053 USDC Gas)',
    },
    turbo: {
      valueUsdc: 0.0,
      label: 'Free Platform Fee',
      description: 'Turbo 50 Gwei Priority (~$0.00105 USDC Gas)',
    },
  },
  swap: {
    standard: {
      bps: 5, // 0.05%
      label: '0.05% Protocol Fee',
      description: 'Standard liquidity routing (5 BPS)',
    },
    fast: {
      bps: 10, // 0.10%
      label: '0.10% Protocol Fee',
      description: 'Fast execution & slippage-optimized routing (10 BPS)',
    },
    turbo: {
      bps: 20, // 0.20%
      label: '0.20% Protocol Fee',
      description: 'MEV-protected ultra-fast execution (20 BPS)',
    },
  },
  bridge: {
    standard: {
      bps: 5, // 0.05%
      valueUsdc: 0.05,
      label: '0.05% Platform Fee',
      description: 'Eco CCTP bridge (Standard block confirmations)',
    },
    fast: {
      bps: 10, // 0.10%
      valueUsdc: 0.1,
      label: '0.10% Platform Fee',
      description: 'CCTP Fast Forwarding service acceleration',
    },
    turbo: {
      bps: 25, // 0.25%
      valueUsdc: 0.25,
      label: '0.25% Platform Fee',
      description: 'Gateway instant pool (<500ms transfer)',
    },
  },
}

/**
 * Helper getters for Send, Swap, and Bridge protocol fees
 */
export function getSendProtocolFee(tier: SpeedTier): number {
  return PROTOCOL_FEE_RATES.send[tier]?.valueUsdc ?? 0.0
}

export function getSwapProtocolFeeBps(tier: SpeedTier): number {
  return PROTOCOL_FEE_RATES.swap[tier]?.bps ?? 10
}

export function getSwapProtocolFeePercent(tier: SpeedTier): string {
  const bps = getSwapProtocolFeeBps(tier)
  return `${(bps / 100).toFixed(2)}%`
}

export function calculateSwapProtocolFeeAmount(tier: SpeedTier, amountIn: string): string | null {
  const amt = parseFloat(amountIn)
  const bps = getSwapProtocolFeeBps(tier)
  if (!Number.isFinite(amt) || amt <= 0 || bps <= 0) return null
  const fee = (amt * bps) / 10000
  return fee.toFixed(6)
}

export function getBridgeProtocolFeeBps(tier: SpeedTier): number {
  return PROTOCOL_FEE_RATES.bridge[tier]?.bps ?? 10
}

export function getBridgeProtocolFee(tier: SpeedTier): number {
  return PROTOCOL_FEE_RATES.bridge[tier]?.valueUsdc ?? 0.1
}

export function getBridgeProtocolFeePercent(tier: SpeedTier): string {
  const bps = getBridgeProtocolFeeBps(tier)
  return `${(bps / 100).toFixed(2)}%`
}

export function calculateBridgeProtocolFeeAmount(tier: SpeedTier, amountIn: string): number {
  const amt = parseFloat(amountIn)
  const bps = getBridgeProtocolFeeBps(tier)
  if (!Number.isFinite(amt) || amt <= 0 || bps <= 0) return 0
  return (amt * bps) / 10000
}

export function formatTreasuryAddress(address: string = TREASURY_ADDRESS): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
