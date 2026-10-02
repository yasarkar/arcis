// src/services/arcGasService.ts
//
// Dedicated Arc L1 Gas & Dynamic Fee Service.
// Implements Arc's EWMA-smoothed base fee mechanics, protocol floor/ceiling enforcement,
// parent block header extra_data predictive base fee extraction, and EIP-1559 options.

import {
  parseGwei,
  type PublicClient,
} from 'viem'
import { arcTestnet } from '../config/arcChain'
import { type SpeedTier, SPEED_TIERS } from '../config/feeTiers'
import { getArcPublicClient as getCentralArcPublicClient } from './rpc'

// ── Arc Protocol Constants ───────────────────────────────────────────────────
/** Minimum base fee floor enforced by Arc Testnet protocol (20 Gwei). */
export const ARC_MIN_BASE_FEE_FLOOR = parseGwei('20') // 20 Gwei = 0.000000020 USDC/gas

/** Hard ceiling bounding worst-case base fee cost under peak congestion (20,000 Gwei). */
export const ARC_MAX_BASE_FEE_CEILING = parseGwei('20000')

/** Standard gas limits on Arc L1 */
export const ARC_GAS_LIMITS = {
  nativeTransfer: 21_000n,
  erc20Transfer: 65_000n,
  memoTransfer: 75_000n,
  contractInteraction: 120_000n,
} as const

// ── Shared RPC Client (Delegated to Central Resilient RPC Manager) ────────────
export function getArcPublicClient(): PublicClient {
  return getCentralArcPublicClient()
}

// ── Header extra_data Predictive Base Fee Extraction ─────────────────────────
/**
 * Extracts the next block's base fee from the parent header's extra_data field.
 * Per Arc protocol specification: The next block's base fee is published in the
 * parent header's extra_data as an 8-byte big-endian value.
 *
 * @param extraData Hex string of the parent block's extra_data
 * @returns bigint base fee in 18-decimal wei, or null if unparseable
 */
export function extractBaseFeeFromHeaderExtraData(extraData?: string | null): bigint | null {
  if (!extraData || extraData === '0x') return null

  try {
    const hex = extraData.startsWith('0x') ? extraData.slice(2) : extraData
    // Must be at least 8 bytes (16 hex characters)
    if (hex.length >= 16) {
      const feeBytesHex = '0x' + hex.slice(0, 16)
      const parsedFee = BigInt(feeBytesHex)
      if (parsedFee >= ARC_MIN_BASE_FEE_FLOOR && parsedFee <= ARC_MAX_BASE_FEE_CEILING) {
        return parsedFee
      }
    }
  } catch {
    // Return null if parsing fails
  }

  return null
}

// ── Observed Priority Fee (listens to what the sequencer ACTUALLY charges) ──
/**
 * Live on-chain probe of the priority tips actually paid in recent Arc blocks, via
 * eth_feeHistory. This is how the app "listens to the chain": instead of assuming a
 * hard-coded tip, it reads the per-block rewards (real paid tips) and takes the median
 * at the requested percentile. Arc Testnet's sequencer currently charges ~17 Gwei
 * regardless of the tip users sign — only an observation-based estimate reflects that.
 */
export async function getObservedArcPriorityFee(
  blockCount: number = 10,
  rewardPercentile: number = 50
): Promise<bigint | null> {
  try {
    const publicClient: any = getArcPublicClient()
    if (!publicClient) return null
    const transport = (publicClient as any).transport
    const request = transport?.request?.bind(transport)
    if (typeof request !== 'function') return null

    const history = await request({
      method: 'eth_feeHistory',
      params: [
        '0x' + Math.max(1, Math.min(100, blockCount)).toString(16),
        'latest',
        [Math.max(1, Math.min(100, rewardPercentile))],
      ],
    })

    const rewards: unknown = history?.reward
    if (!Array.isArray(rewards) || rewards.length === 0) return null

    const tips = rewards
      .map((row: any) => {
        const value = Array.isArray(row) ? row[0] : undefined
        if (typeof value !== 'string') return null
        try {
          return BigInt(value)
        } catch {
          return null
        }
      })
      .filter((t): t is bigint => t !== null)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    if (tips.length === 0) return null
    return tips[Math.floor((tips.length - 1) / 2)]
  } catch {
    return null
  }
}

// ── Dynamic EIP-1559 Gas Options Resolution ──────────────────────────────────
export interface DynamicArcGasResult {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  effectiveBaseFee: bigint
  /** Expected per-gas price actually charged: base fee + observed priority tip. */
  expectedFeePerGas: bigint
  /** Median priority tip observed on-chain via eth_feeHistory (null when unavailable). */
  observedPriorityFee: bigint | null
  /** Display estimate priced at the EXPECTED charge (not the maxFee ceiling). */
  estimatedCostUsdc: string
  /** Display split of the expected charge in USDC. */
  estimatedBaseFeeUsdc: string
  estimatedPriorityUsdc: string
  isDynamic: boolean
  source: 'header_extra_data' | 'block_base_fee' | 'static_fallback'
}

/**
 * Resolves dynamic Arc L1 EIP-1559 gas options from the live RPC.
 * Reads the latest block and predictive extra_data, clamps within [20 Gwei, 20,000 Gwei],
 * applies speed tier multipliers, and calculates the exact USDC cost.
 *
 * @param client Optional Viem PublicClient instance
 * @param tier Speed & priority tier ('standard' | 'fast' | 'turbo')
 * @param gasLimit Expected gas limit (defaults to 65,000 for ERC-20 transfers)
 */
export async function getDynamicArcGasOptions(
  client?: any,
  tier: SpeedTier = 'fast',
  gasLimit: bigint = ARC_GAS_LIMITS.erc20Transfer
): Promise<DynamicArcGasResult> {
  const publicClient: PublicClient = client || getArcPublicClient()

  try {
    const block = await publicClient.getBlock({ blockTag: 'latest' })

    // 1. Try predictive header extra_data first (next block base fee)
    let source: 'header_extra_data' | 'block_base_fee' = 'block_base_fee'
    let rawBaseFee = extractBaseFeeFromHeaderExtraData(block.extraData)

    if (rawBaseFee !== null) {
      source = 'header_extra_data'
    } else {
      rawBaseFee = block.baseFeePerGas ?? ARC_MIN_BASE_FEE_FLOOR
    }

    // 2. Enforce protocol bounds: min 20 Gwei floor, max 20,000 Gwei ceiling
    let effectiveBaseFee = rawBaseFee < ARC_MIN_BASE_FEE_FLOOR ? ARC_MIN_BASE_FEE_FLOOR : rawBaseFee
    if (effectiveBaseFee > ARC_MAX_BASE_FEE_CEILING) {
      effectiveBaseFee = ARC_MAX_BASE_FEE_CEILING
    }

    // 3. Multiplier & observed-tip percentile per tier. Live-measured calibration:
    // Arc Testnet's sequencer charges ~16.7-17.8 Gwei tips on typical transfers, which the
    // feeHistory 25th percentile tracks (median of block-level p25 rewards = 17.5 Gwei).
    // - standard: 110% maxFee headroom, p10 observed tip (economical inclusion)
    // - fast: 130% maxFee headroom, p25 observed tip (recommended, matches ArcScan fees)
    // - turbo: 175% maxFee headroom, p75 observed tip (priority queue)
    // Tier constants below are only the fallback when the live probe is unavailable.
    let multiplier = 130n
    let fallbackTip = parseGwei('2')
    let rewardPercentile = 25

    if (tier === 'standard') {
      multiplier = 110n
      fallbackTip = parseGwei('0')
      rewardPercentile = 10
    } else if (tier === 'turbo') {
      multiplier = 175n
      fallbackTip = parseGwei('5')
      rewardPercentile = 75
    }

    const observedPriorityFee = await getObservedArcPriorityFee(10, rewardPercentile)
    const priorityTip = observedPriorityFee ?? fallbackTip

    const maxFeePerGas = (effectiveBaseFee * multiplier) / 100n + priorityTip

    // 4. Display estimate prices the EXPECTED charge (base + observed tip), not the maxFee
    // ceiling — this is what ArcScan reports as the transaction fee. maxFee stays a
    // signing-only headroom above it (unused tip is refunded per EIP-1559).
    const expectedFeePerGas = effectiveBaseFee + priorityTip
    const expectedFeePerGasCapped =
      expectedFeePerGas > maxFeePerGas ? maxFeePerGas : expectedFeePerGas
    const estimatedCostUsdc = calculateArcGasCostFromFee(gasLimit, expectedFeePerGasCapped)
    const estimatedBaseFeeUsdc = calculateArcGasCostFromFee(gasLimit, effectiveBaseFee)
    const estimatedPriorityUsdc = calculateArcGasCostFromFee(
      gasLimit,
      expectedFeePerGasCapped > effectiveBaseFee ? expectedFeePerGasCapped - effectiveBaseFee : 0n
    )

    return {
      maxFeePerGas,
      maxPriorityFeePerGas: priorityTip,
      effectiveBaseFee,
      expectedFeePerGas: expectedFeePerGasCapped,
      observedPriorityFee,
      estimatedCostUsdc,
      estimatedBaseFeeUsdc,
      estimatedPriorityUsdc,
      isDynamic: true,
      source,
    }
  } catch (err) {
    console.warn('[arcGasService] Live RPC gas fetch failed, falling back to static config:', err)
    const staticTier = SPEED_TIERS[tier].arcGas

    return {
      maxFeePerGas: staticTier.maxFeePerGas,
      maxPriorityFeePerGas: staticTier.maxPriorityFeePerGas,
      effectiveBaseFee: ARC_MIN_BASE_FEE_FLOOR,
      expectedFeePerGas: ARC_MIN_BASE_FEE_FLOOR,
      observedPriorityFee: null,
      estimatedCostUsdc: staticTier.estimatedCostUsdc,
      estimatedBaseFeeUsdc: calculateArcGasCostFromFee(gasLimit, ARC_MIN_BASE_FEE_FLOOR),
      estimatedPriorityUsdc: '0.00000',
      isDynamic: false,
      source: 'static_fallback',
    }
  }
}

/**
 * Calculates estimated Arc L1 gas cost in USDC from gas units and maxFeePerGas.
 * Formula: (gasLimit * maxFeePerGas) / 10^18 USDC
 */
export function calculateArcGasCostFromFee(gasLimit: bigint | number, maxFeePerGas: bigint): string {
  const totalWei = BigInt(gasLimit) * maxFeePerGas
  const cost = Number(totalWei) / 1e18
  return cost < 0.00001 ? '0.00001' : cost.toFixed(5)
}

// ── Static Display Fallbacks (no RPC roundtrip) ──────────────────────────────
/**
 * Synchronous gas-cost fallback priced from a tier's static maxFeePerGas — the same
 * formula as calculateArcGasCostFromFee without an RPC roundtrip. Display-only:
 * the live dynamic estimate is always preferred when available.
 */
export function calculateStaticTierGasCostUsdc(
  gasLimit: bigint | number,
  tier: SpeedTier = 'fast'
): string {
  return calculateArcGasCostFromFee(gasLimit, SPEED_TIERS[tier].arcGas.maxFeePerGas)
}

/**
 * Picks the Arc gas limit for a token transfer by asset type: native USDC (or the chain's
 * native gas asset, 'NATIVE') moves like a value send (21k), other ERC-20s cost ~65k, memo
 * contract calls ~75k. Keeps fallback labels consistent with the live dynamic estimate.
 */
export function arcTransferGasLimit(tokenSymbol?: string | null, hasMemo: boolean = false): bigint {
  if (hasMemo) return ARC_GAS_LIMITS.memoTransfer
  const symbol = (tokenSymbol || '').toUpperCase()
  return symbol === 'USDC' || symbol === 'NATIVE'
    ? ARC_GAS_LIMITS.nativeTransfer
    : ARC_GAS_LIMITS.erc20Transfer
}

/**
 * Display fallback for an Arc transfer network fee in USDC, consistent with the live
 * 21k/65k/75k dynamic estimate but priced from the tier's static gas configuration.
 */
export function arcTransferFeeFallbackUsdc(
  tokenSymbol?: string | null,
  hasMemo: boolean = false,
  tier: SpeedTier = 'fast'
): string {
  return calculateStaticTierGasCostUsdc(arcTransferGasLimit(tokenSymbol, hasMemo), tier)
}

// ── Actual Paid Fee Resolution (post-execution truth) ───────────────────────
export interface ArcActualFeeResult {
  /** Actual fee in USDC (fee WEI / 1e18), or null when the receipt lacks gas data. */
  feeUsdc: number | null
  /** Exact unrounded fee as a decimal string, or null when unavailable. */
  feeUsdcExact: string | null
  /** Base-fee component (gasUsed × block baseFeePerGas), exact decimal string. */
  baseFeeUsdcExact: string | null
  /** Priority-tip component (total − base), exact decimal string. */
  priorityFeeUsdcExact: string | null
  /** Gas actually consumed by the transaction. */
  gasUsed: number | null
  /** Effective per-gas price charged, in Gwei. */
  effectiveGasPriceGwei: number | null
  /** Block the transaction was mined in. */
  blockNumber: number | null
  /** Hex tx hash the fee was resolved from, or '' when unavailable. */
  txHash: string
}

/**
 * Resolves the ACTUAL fee the network charged for an Arc transaction, straight from its
 * receipt: gasUsed × effectiveGasPrice. This is the same number ArcScan displays and the
 * only value that can be presented as "paid". Returns nulls when the hash or gas fields
 * are unavailable — callers must never substitute an estimate for a paid amount.
 */
export async function resolveArcActualFeeUsdc(
  txHash?: string | null,
  client?: any
): Promise<ArcActualFeeResult> {
  const empty: ArcActualFeeResult = {
    feeUsdc: null,
    feeUsdcExact: null,
    baseFeeUsdcExact: null,
    priorityFeeUsdcExact: null,
    gasUsed: null,
    effectiveGasPriceGwei: null,
    blockNumber: null,
    txHash: '',
  }
  if (!txHash || !String(txHash).startsWith('0x')) return empty
  try {
    const publicClient: any = client || getArcPublicClient()
    if (!publicClient) return empty

    let receipt: any = null
    if (typeof publicClient.waitForTransactionReceipt === 'function') {
      try {
        receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash as any,
          timeout: 8_000,
        })
      } catch {
        // Not mined within the window or wait unsupported — fall through to a direct read.
      }
    }
    if (!receipt && typeof publicClient.getTransactionReceipt === 'function') {
      receipt = await publicClient.getTransactionReceipt({ hash: txHash as any })
    }

    const gasUsed = receipt?.gasUsed as bigint | undefined
    const effectiveGasPrice = (receipt?.effectiveGasPrice ?? receipt?.gasPrice) as bigint | undefined
    if (gasUsed == null || effectiveGasPrice == null) return empty

    const feeWei = gasUsed * effectiveGasPrice

    // Base/priority split, exactly like ArcScan: base component = gasUsed × the mined
    // block's baseFeePerGas (clamped to the effective price), priority = the remainder.
    let baseFeePerGas: bigint | undefined
    let blockNumber: number | null = null
    try {
      if (receipt?.blockNumber != null && typeof publicClient.getBlock === 'function') {
        const block: any = await publicClient.getBlock({ blockNumber: receipt.blockNumber })
        baseFeePerGas = block?.baseFeePerGas
        blockNumber =
          typeof receipt.blockNumber === 'bigint' ? Number(receipt.blockNumber) : (receipt.blockNumber ?? null)
      }
    } catch {
      // The split is best-effort; the total fee remains available regardless.
    }

    const baseComponent =
      baseFeePerGas != null && baseFeePerGas < effectiveGasPrice ? baseFeePerGas : effectiveGasPrice
    const baseWei = gasUsed * baseComponent
    const priorityWei = feeWei - baseWei

    const feeUsdcExact = (Number(feeWei) / 1e18).toString()
    const feeUsdc = Number(feeUsdcExact)
    if (!Number.isFinite(feeUsdc) || feeUsdc < 0) return empty

    return {
      feeUsdc,
      feeUsdcExact,
      baseFeeUsdcExact: (Number(baseWei) / 1e18).toString(),
      priorityFeeUsdcExact: (Number(priorityWei) / 1e18).toString(),
      gasUsed: Number(gasUsed),
      effectiveGasPriceGwei: Number(effectiveGasPrice) / 1e9,
      blockNumber,
      txHash: String(txHash),
    }
  } catch {
    return empty
  }
}
