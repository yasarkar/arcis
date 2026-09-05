// src/services/arcGasService.ts
//
// Dedicated Arc L1 Gas & Dynamic Fee Service.
// Implements Arc's EWMA-smoothed base fee mechanics, protocol floor/ceiling enforcement,
// parent block header extra_data predictive base fee extraction, and EIP-1559 options.

import {
  createPublicClient,
  http,
  parseGwei,
  type PublicClient,
} from 'viem'
import { arcTestnet, ARC_METADATA } from '../config/arcChain'
import { type SpeedTier, SPEED_TIERS } from '../config/feeTiers'

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

// ── Shared RPC Client ────────────────────────────────────────────────────────
let _cachedArcPublicClient: PublicClient | null = null

export function getArcPublicClient(): PublicClient {
  if (!_cachedArcPublicClient) {
    const rpcUrl = arcTestnet.rpcUrls?.default?.http?.[0] || ARC_METADATA.rpcHttpUrl
    _cachedArcPublicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(rpcUrl, { timeout: 15_000, retryCount: 3 }),
      batch: { multicall: false },
      pollingInterval: 4000,
    })
  }
  return _cachedArcPublicClient
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

// ── Dynamic EIP-1559 Gas Options Resolution ──────────────────────────────────
export interface DynamicArcGasResult {
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  effectiveBaseFee: bigint
  estimatedCostUsdc: string
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

    // 3. Multiplier & priority tip per tier:
    // - standard: %110 base fee, 0 Gwei tip (Arc validators require no tip under normal load)
    // - fast: %130 base fee, 2 Gwei tip (Recommended for instant inclusion)
    // - turbo: %175 base fee, 5 Gwei tip (Priority sequencer queue)
    let multiplier = 130n
    let priorityTip = parseGwei('2')

    if (tier === 'standard') {
      multiplier = 110n
      priorityTip = parseGwei('0')
    } else if (tier === 'turbo') {
      multiplier = 175n
      priorityTip = parseGwei('5')
    }

    const maxFeePerGas = (effectiveBaseFee * multiplier) / 100n + priorityTip

    // 4. Calculate estimated gas cost in USDC
    const estimatedCostUsdc = calculateArcGasCostFromFee(gasLimit, maxFeePerGas)

    return {
      maxFeePerGas,
      maxPriorityFeePerGas: priorityTip,
      effectiveBaseFee,
      estimatedCostUsdc,
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
      estimatedCostUsdc: staticTier.estimatedCostUsdc,
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
