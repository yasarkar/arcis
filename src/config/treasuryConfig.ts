// src/config/treasuryConfig.ts
// Centralized ArcFlow Treasury & Protocol Fee Configuration.
// Governs dynamic protocol fees across Send, Swap, and Bridge modules,
// scaled by the user's selected Speed & Priority tier (Standard / Fast / Turbo).

import type { SpeedTier } from './feeTiers'

// Global ArcFlow Protocol Treasury Address (Default developer / protocol treasury)
export const TREASURY_ADDRESS = import.meta.env.VITE_TREASURY_ADDRESS

export const TREASURY_EXPLORER_URL = `https://testnet.arcscan.app/address/${TREASURY_ADDRESS}`

// Revenue sharing model according to Circle AppKit & Arc documentation
export const REVENUE_SHARE_LABEL = '90% Dev / 10% Arc'
export const REVENUE_SHARE_TOOLTIP =
  'Circle AppKit Revenue Sharing: 90% of the protocol fee goes to the ArcFlow Treasury and 10% supports the Arc Network ecosystem.'

export interface ModuleProtocolFeeConfig {
  send: Record<SpeedTier, { valueUsdc: number; label: string; description: string }>
  swap: Record<SpeedTier, { bps: number; label: string; description: string }>
  bridge: Record<SpeedTier, { valueUsdc: number; label: string; description: string }>
}

export const PROTOCOL_FEE_RATES: ModuleProtocolFeeConfig = {
  send: {
    standard: {
      valueUsdc: 0.0,
      label: 'Free Platform Fee',
      description: 'Standard transfer with 0 platform fee (Only L1 USDC Gas)',
    },
    fast: {
      valueUsdc: 0.005,
      label: '0.005 USDC Platform Fee',
      description: 'Priority queue routing + fast memo processing',
    },
    turbo: {
      valueUsdc: 0.01,
      label: '0.010 USDC Platform Fee',
      description: 'Turbo L1 validation + instant memo anchoring',
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
      valueUsdc: 0.05,
      label: '0.05 USDC Platform Fee',
      description: 'Eco CCTP bridge (Standard block confirmations)',
    },
    fast: {
      valueUsdc: 0.1,
      label: '0.10 USDC Platform Fee',
      description: 'CCTP Fast Forwarding service acceleration',
    },
    turbo: {
      valueUsdc: 0.25,
      label: '0.25 USDC Platform Fee',
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

export function getBridgeProtocolFee(tier: SpeedTier): number {
  return PROTOCOL_FEE_RATES.bridge[tier]?.valueUsdc ?? 0.1
}

export function formatTreasuryAddress(address: string = TREASURY_ADDRESS): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}
