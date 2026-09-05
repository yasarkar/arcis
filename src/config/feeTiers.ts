// src/config/feeTiers.ts
//
// Centralized Speed & Fee Tiers for Arc L1 and Circle Infrastructure.
// Emulates traditional crypto wallet speed tiers (Standard / Fast / Turbo)
// tailored specifically for Arc's native USDC gas model and Circle CCTP/Gateway.

import { parseGwei } from 'viem'

export type SpeedTier = 'standard' | 'fast' | 'turbo'

export interface SpeedTierConfig {
  id: SpeedTier
  label: string
  shortLabel: string
  iconName: 'car' | 'zap' | 'rocket'
  badge?: string
  timeEstimate: {
    arcL1: string
    cctpBridge: string
    gateway: string
    swap: string
  }
  arcGas: {
    maxFeePerGasGwei: number
    maxPriorityFeePerGasGwei: number
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
    estimatedCostUsdc: string
  }
  bridge: {
    transferSpeed: 'SLOW' | 'FAST'
    mode: 'direct' | 'gateway'
    description: string
  }
}

/**
 * Arc L1 Gas Parameters:
 * - Gas unit: Native USDC (18 decimals in EVM execution, 6 decimals in ERC-20 interface)
 * - Base fee floor: 20 Gwei (Testnet protocol minimum)
 * - Standard transfer gas limit: ~21,000 gas
 * - ERC-20 / Memo transfer gas limit: ~50,000 - 80,000 gas
 */
export const SPEED_TIERS: Record<SpeedTier, SpeedTierConfig> = {
  standard: {
    id: 'standard',
    label: 'Standard',
    shortLabel: 'Eco',
    iconName: 'car',
    timeEstimate: {
      arcL1: '1-2 sec',
      cctpBridge: '1-2 min',
      gateway: '< 500 ms',
      swap: '~ 2 sec',
    },
    arcGas: {
      maxFeePerGasGwei: 20,
      maxPriorityFeePerGasGwei: 0,
      maxFeePerGas: parseGwei('20'),
      maxPriorityFeePerGas: parseGwei('0'),
      estimatedCostUsdc: '0.00042',
    },
    bridge: {
      transferSpeed: 'SLOW',
      mode: 'direct',
      description: 'Standard block confirmations (0 CCTP protocol fee)',
    },
  },
  fast: {
    id: 'fast',
    label: 'Fast',
    shortLabel: 'Fast',
    iconName: 'zap',
    badge: 'Recommended',
    timeEstimate: {
      arcL1: '< 1 sec',
      cctpBridge: '15-30 sec',
      gateway: '< 500 ms',
      swap: '< 1 sec',
    },
    arcGas: {
      maxFeePerGasGwei: 25,
      maxPriorityFeePerGasGwei: 2,
      maxFeePerGas: parseGwei('25'),
      maxPriorityFeePerGas: parseGwei('2'),
      estimatedCostUsdc: '0.00053',
    },
    bridge: {
      transferSpeed: 'FAST',
      mode: 'direct',
      description: 'CCTP Fast Attestation (15-30s soft finality)',
    },
  },
  turbo: {
    id: 'turbo',
    label: 'Turbo',
    shortLabel: 'Instant',
    iconName: 'rocket',
    badge: 'Ultra Fast',
    timeEstimate: {
      arcL1: 'Sub-second',
      cctpBridge: '< 500 ms',
      gateway: '< 500 ms',
      swap: 'Instant',
    },
    arcGas: {
      maxFeePerGasGwei: 50,
      maxPriorityFeePerGasGwei: 5,
      maxFeePerGas: parseGwei('50'),
      maxPriorityFeePerGas: parseGwei('5'),
      estimatedCostUsdc: '0.00105',
    },
    bridge: {
      transferSpeed: 'FAST',
      mode: 'gateway',
      description: 'Circle Gateway instant liquidity (<500ms finality, 0.005% fee)',
    },
  },
}

/**
 * Calculates estimated Arc L1 gas cost in USDC for a given gas limit and speed tier.
 * Formula: gasLimit * (baseFee + priorityFee) in Gwei * 10^-9
 */
export function calculateArcGasCostUsdc(
  gasLimit: number | bigint = 21000n,
  tier: SpeedTier = 'fast'
): string {
  const tierConfig = SPEED_TIERS[tier]
  const gas = BigInt(gasLimit)
  const totalGwei = BigInt(tierConfig.arcGas.maxFeePerGasGwei)
  
  // 1 Gwei = 10^-9 USDC. With 21,000 gas @ 25 Gwei:
  // 21000 * 25 = 525,000 Gwei = 0.000525 USDC
  const totalGweiSpent = Number(gas * totalGwei)
  const usdcCost = totalGweiSpent / 1_000_000_000

  return usdcCost < 0.00001 ? '0.00001' : usdcCost.toFixed(5)
}

/**
 * Returns static Viem transaction options (maxFeePerGas & maxPriorityFeePerGas) for a tier.
 * For dynamic RPC-queried fees with Arc EWMA smoothing & floor enforcement,
 * prefer `getDynamicArcGasOptions` from '../services/arcGasService'.
 */
export function getViemGasOptions(tier: SpeedTier = 'fast') {
  const config = SPEED_TIERS[tier]
  return {
    maxFeePerGas: config.arcGas.maxFeePerGas,
    maxPriorityFeePerGas: config.arcGas.maxPriorityFeePerGas,
  }
}

// Re-export dynamic Arc L1 gas services for convenient access
export {
  ARC_MIN_BASE_FEE_FLOOR,
  ARC_MAX_BASE_FEE_CEILING,
  ARC_GAS_LIMITS,
  extractBaseFeeFromHeaderExtraData,
  getDynamicArcGasOptions,
  calculateArcGasCostFromFee,
  type DynamicArcGasResult,
} from '../services/arcGasService'

