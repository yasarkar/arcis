// src/utils/depositFlow.ts
// Pure helper functions for the Unified Balance (Circle Gateway) deposit flow.
// Kept React-free so the validation, MAX calculation and sorting logic can be unit tested.

import type { HistoryItem } from './history'

export const MAX_DEPOSIT_DECIMALS = 6
/** Native-gas reserve kept on Arc, where USDC itself pays for gas. */
export const ARC_GAS_RESERVE_USDC = 0.05

const COMPLETE_AMOUNT_REGEX = /^\d+(?:\.\d{1,6})?$/
const PARTIAL_AMOUNT_REGEX = /^\d*\.?\d*$/

/** Arc Testnet ("Arc_Testnet") is the testnet key, mainnet uses "Arc". */
export function isArcChainKey(chainKey?: string | null): boolean {
  return chainKey === 'Arc' || chainKey === 'Arc_Testnet'
}

/**
 * Filters and normalizes raw keyboard/paste input for the deposit amount field.
 *
 * TR/DE keyboards emit a comma as the decimal key, and pasted values may carry thousand
 * separators ("1.234,56" or "1,234.56"), so both separators are accepted and the value is
 * normalized to the canonical dot-decimal form the rest of the flow expects.
 *
 * Allows partial values while typing ("", "1.", "0.123456") but rejects exponent notation,
 * negatives, repeated separators and more than 6 decimals. Returns null when the input should
 * be ignored by the caller.
 */
export function sanitizeDepositAmountInput(raw: string): string | null {
  // Whitespace (including NBSP) only ever acts as a thousands separator here.
  const compact = raw.replace(/\s/g, '')
  if (compact === '') return ''
  if (!/^[\d.,]+$/.test(compact)) return null

  const lastDot = compact.lastIndexOf('.')
  const lastComma = compact.lastIndexOf(',')
  // The separator that occurs last wins: "1.234,56" has comma decimals, "1,234.56" dot decimals.
  const decimalSeparator =
    lastDot === -1 && lastComma === -1 ? null : lastDot > lastComma ? '.' : ','

  if (!decimalSeparator) {
    return PARTIAL_AMOUNT_REGEX.test(compact) ? compact : null
  }

  const decimalIndex = compact.lastIndexOf(decimalSeparator)
  const integerRaw = compact.slice(0, decimalIndex)
  const decimalPart = compact.slice(decimalIndex + 1)

  // A repeated decimal separator is a malformed value ("1.2.3"), never a valid group.
  if (integerRaw.includes(decimalSeparator)) return null

  // The other separator is only meaningful as a thousands grouping: "1.234,56".
  const otherSeparator = decimalSeparator === '.' ? ',' : '.'
  if (integerRaw.includes(otherSeparator)) {
    const grouped = new RegExp(`^\\d{1,3}(?:\\${otherSeparator}\\d{3})+$`).test(integerRaw)
    if (!grouped) return null
  }

  if (decimalPart.length > MAX_DEPOSIT_DECIMALS) return null

  const normalized = `${integerRaw.replace(/[.,]/g, '')}.${decimalPart}`
  return PARTIAL_AMOUNT_REGEX.test(normalized) ? normalized : null
}

/** True when the typed value is a complete, well-formed USDC amount. */
export function isCompleteDepositAmount(raw: string): boolean {
  return COMPLETE_AMOUNT_REGEX.test(raw.trim())
}

export type DepositAmountErrorReason = 'empty' | 'format' | 'insufficient'

export interface DepositAmountCheck {
  ok: boolean
  reason?: DepositAmountErrorReason
  error?: string
  parsed?: number
}

/**
 * Validates a deposit amount against the wallet's USDC balance on the selected chain.
 * The caller decides how to present the error (inline banner vs. disabled CTA).
 */
export function validateDepositAmount(raw: string, availableBalance: string): DepositAmountCheck {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { ok: false, reason: 'empty', error: 'Please enter a valid deposit amount.' }
  }
  if (!isCompleteDepositAmount(trimmed)) {
    return {
      ok: false,
      reason: 'format',
      error: `Enter a valid USDC amount with up to ${MAX_DEPOSIT_DECIMALS} decimal places.`,
    }
  }
  const parsed = Number.parseFloat(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, reason: 'empty', error: 'Please enter a valid deposit amount.' }
  }
  const available = Number.parseFloat(availableBalance)
  if (Number.isFinite(available) && parsed > available) {
    return {
      ok: false,
      reason: 'insufficient',
      error: `Deposit amount exceeds your wallet balance of ${availableBalance} USDC.`,
    }
  }
  return { ok: true, parsed }
}

/**
 * Computes the MAX deposit value. USDC gas must be reserved on Arc; on all other
 * chains the gas token is the native currency (not USDC), so the full balance is spendable.
 */
export function computeMaxDeposit(
  balance: string,
  reserveNativeGas: boolean,
  gasReserve = ARC_GAS_RESERVE_USDC
): string {
  const parsed = Number.parseFloat(balance)
  if (!Number.isFinite(parsed) || parsed <= 0) return '0'
  const max = reserveNativeGas ? parsed - gasReserve : parsed
  if (max <= 0) return '0'
  const fixed = max.toFixed(2)
  return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

/** Sorts Gateway balances by descending balance, keeping zero-balance chains in API order. */
export function sortGatewayBalances<T extends { balance: string }>(balances: T[]): T[] {
  return [...balances].sort((a, b) => Number.parseFloat(b.balance) - Number.parseFloat(a.balance))
}

/**
 * Sorts deposit-chain options by descending wallet USDC balance, then keeps the
 * preferred chain (active Arc network) first among equals, then alphabetical order.
 */
export function sortDepositChains(
  chains: string[],
  walletBalances: Record<string, { usdc?: string } | undefined>,
  getDisplayName: (chainKey: string) => string,
  preferredChain: string
): string[] {
  return [...chains].sort((a, b) => {
    const balA = Number.parseFloat(walletBalances[a]?.usdc || '0')
    const balB = Number.parseFloat(walletBalances[b]?.usdc || '0')
    if (balB !== balA) return balB - balA
    if (a === preferredChain) return -1
    if (b === preferredChain) return 1
    return getDisplayName(a).localeCompare(getDisplayName(b))
  })
}

export interface DepositOutcome {
  amount: string
  chainKey: string
  txHash: string
  approveTxHash?: string
  /** REAL network fee paid by the deposit tx (receipt gasUsed × effectiveGasPrice). */
  networkFee?: DepositFee
  /** REAL network fee paid by the ERC-20 approval tx, when one was submitted. */
  approvalFee?: DepositFee
  /**
   * True when the wallet path sponsorer paid the gas (Circle Gas Station paymaster for
   * passkey MSCA UserOps). The receipt then reports "Sponsored" instead of a fake fee.
   */
  feeSponsored?: boolean
}

export interface DepositFee {
  /** Exact fee amount, already formatted from the receipt. */
  amount: string
  /** Native currency the fee was charged in (USDC on Arc, ETH elsewhere). */
  symbol: string
}

/**
 * Renders a verified fee as "0.000793 USDC" for the receipt. Non-positive, malformed or
 * missing amounts return null so the caller omits the row instead of showing a fake zero.
 */
export function formatDepositFee(fee?: DepositFee | null): string | null {
  if (!fee?.amount) return null
  const numeric = Number.parseFloat(fee.amount)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  const symbol = (fee.symbol || '').trim()
  return symbol ? `${fee.amount} ${symbol}` : fee.amount
}

/** Maps a confirmed Gateway deposit onto the persisted history record. */
export function buildDepositHistoryEntry(
  outcome: DepositOutcome,
  walletAddress: string
): Omit<HistoryItem, 'id' | 'timestamp'> {
  return {
    type: 'deposit',
    txHash: outcome.txHash || '',
    amount: outcome.amount,
    tokenSymbol: 'USDC',
    sourceChain: outcome.chainKey,
    recipient: walletAddress,
    userAddress: walletAddress,
    status: 'success',
  }
}
