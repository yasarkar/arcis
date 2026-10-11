import { parseUnits } from 'viem'
import { numberToExactDecimal } from './copilotAmount'
import { POOL_MIN_SLIPPAGE_BPS, POOL_MAX_SLIPPAGE_BPS } from '../config/poolsConfig'

export function validateSwapSlippageBps(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < POOL_MIN_SLIPPAGE_BPS || value > POOL_MAX_SLIPPAGE_BPS) {
    throw new Error(`Invalid slippage / Geçersiz tolerans. Choose ${POOL_MIN_SLIPPAGE_BPS / 100}%–${POOL_MAX_SLIPPAGE_BPS / 100}% in 0.01% increments; no tolerance was changed. / Tolerans değiştirilmedi.`)
  }
  return value
}

/** Convert a percentage at the UI/legacy-chat boundary, never round it to a wider tolerance. */
export function swapPercentToBps(value: unknown): number {
  const raw = String(value).replace(',', '.')
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error('Invalid slippage: use a percentage with at most two decimal places.')
  const [whole, fraction = ''] = raw.split('.')
  return validateSwapSlippageBps(Number(whole) * 100 + Number(fraction.padEnd(2, '0')))
}

/** Legacy service fractions normalize without binary multiplication/rounding. */
export function swapFractionToBps(value: number): number {
  const raw = numberToExactDecimal(value)
  if (!raw || !/^\d+(?:\.\d{1,4})?$/.test(raw)) throw new Error('Invalid slippage fraction; no tolerance was changed.')
  const [whole, fraction = ''] = raw.split('.')
  return validateSwapSlippageBps(Number(whole) * 10000 + Number(fraction.padEnd(4, '0')))
}

/** Persisted chat `slippage` was a percentage, not the swap service's fraction. */
export function copilotSlippageBps(data: { slippageBps?: unknown; slippage?: unknown }, defaultPercent = 1): number {
  const bps = data.slippageBps === undefined ? swapPercentToBps(data.slippage ?? defaultPercent) : validateSwapSlippageBps(data.slippageBps)
  if (data.slippageBps !== undefined && data.slippage !== undefined && swapPercentToBps(data.slippage) !== bps) {
    throw new Error('Conflicting slippage fields; prepare a new quote before signing.')
  }
  return bps
}

export function swapMinimumUnits(output: bigint, bps: number): bigint {
  validateSwapSlippageBps(bps)
  return (output * BigInt(10000 - bps)) / 10000n
}

/** parseUnits may round excess decimals: reject those before encoding any bound. */
export function exactSwapOutputUnits(value: unknown, decimals: number): bigint {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) || (value.split('.')[1]?.length ?? 0) > decimals) {
    throw new Error('An exact token-decimal minimum output is required; prepare a new quote before signing.')
  }
  const units = parseUnits(value, decimals)
  if (units <= 0n) throw new Error('Swap output must be greater than zero; prepare a new quote.')
  return units
}

/** The user-approved card bound is immutable even when pool reserves are refreshed. */
export function approvedSwapMinimum(data: { minReceived?: unknown }, decimals: number, freshOutput: string): bigint {
  const minimum = exactSwapOutputUnits(data.minReceived, decimals)
  if (exactSwapOutputUnits(freshOutput, decimals) < minimum) {
    throw new Error('Quote moved below the approved minimum. Prepare and confirm a new quote; no swap was signed.')
  }
  return minimum
}
