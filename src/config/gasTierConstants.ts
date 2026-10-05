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
      // Turbo is the fastest DIRECT CCTP tier and runs today's Fast Transfer
      // path (15-30 sec); the '< 500 ms' figure belongs to the Gateway route,
      // which is a separate mode, not a speed tier.
      cctpBridge: '15-30 sec',
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
