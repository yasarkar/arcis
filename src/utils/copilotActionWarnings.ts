// src/utils/copilotActionWarnings.ts
// ARC-025: the copilot action card is the only confirmation screen before a session key signs, and
// it used to show nothing about *who* is being paid or *how much of the balance* is leaving. These
// helpers are the single owner of that judgement so the card stays a thin renderer:
//
//   * a recipient that is not in the saved list is called out (adversarially crafted address or a
//     prompt-injected "send to …"),
//   * a transfer of more than half of the available balance is called out,
//   * a swap whose tolerance is wider than the 1% caution line is called out.
//
// They are pure and dependency-light (localStorage helper aside, whose reader is injected) so the
// thresholds can be tested without a DOM.

import { areAddressesEqual } from './recentRecipients'

export type CopilotActionWarningCode = 'new-recipient' | 'large-share-of-balance' | 'high-slippage'

export interface CopilotActionWarning {
  code: CopilotActionWarningCode
  message: string
}

/** Above this share of the available balance the card warns before signing. */
export const LARGE_SHARE_THRESHOLD = 0.5

/** Above this tolerance (1%) the card warns; the swap cap is 2%, so this is the caution line. */
export const HIGH_SLIPPAGE_BPS = 100

const TOKEN_ALIASES: Record<string, string> = {
  USDC: 'USDC',
  EURC: 'EURC',
  WETH: 'WETH',
  CIRBTC: 'cirBTC',
  BTC: 'cirBTC',
}

/** Maps a chat-supplied symbol onto the balance keys the portfolio snapshot uses. */
export function warningTokenKey(symbol: string | undefined | null): string | null {
  const raw = String(symbol ?? '').trim()
  if (!raw) return null
  return TOKEN_ALIASES[raw.toUpperCase()] ?? raw
}

/** A balance map exactly as the card receives it (portfolio liquid fields). */
export interface CopilotAvailableBalances {
  USDC?: number
  EURC?: number
  WETH?: number
  cirBTC?: number
}

export function availableBalanceFor(
  balances: CopilotAvailableBalances | null | undefined,
  symbol: string | undefined | null
): number | null {
  const key = warningTokenKey(symbol)
  if (!key || !balances) return null
  const value = (balances as Record<string, number | undefined>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function trimAmount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const fixed = value >= 1 ? value.toFixed(2) : value.toPrecision(4)
  return fixed.replace(/\.?0+$/, '')
}

/**
 * True when the recipient has never been used from this browser. An empty saved list means every
 * address is new — which is exactly what the user should be told before signing.
 */
export function isFirstTimeRecipient(
  recipient: string | undefined | null,
  savedAddresses: readonly string[]
): boolean {
  const target = String(recipient ?? '').trim()
  if (!target) return false
  return !savedAddresses.some((address) => areAddressesEqual(address, target))
}

export function newRecipientWarning(
  recipient: string | undefined | null,
  savedAddresses: readonly string[]
): CopilotActionWarning | null {
  if (!isFirstTimeRecipient(recipient, savedAddresses)) return null
  return {
    code: 'new-recipient',
    message:
      'First transfer to this address — it is not one of your recent recipients. Check every character before confirming.',
  }
}

export function largeShareWarning(
  amount: number | undefined | null,
  available: number | null | undefined,
  symbol: string | undefined | null
): CopilotActionWarning | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  if (typeof available !== 'number' || !Number.isFinite(available) || available <= 0) return null
  if (amount / available <= LARGE_SHARE_THRESHOLD) return null

  const percent = Math.min(100, Math.round((amount / available) * 100))
  return {
    code: 'large-share-of-balance',
    message: `This moves about ${percent}% of your ${warningTokenKey(symbol) ?? ''} balance (${trimAmount(
      available
    )} available).`.replace(/\s+/g, ' '),
  }
}

export function highSlippageWarning(slippageBps: number | null | undefined): CopilotActionWarning | null {
  if (typeof slippageBps !== 'number' || !Number.isInteger(slippageBps)) return null
  if (slippageBps <= HIGH_SLIPPAGE_BPS) return null
  return {
    code: 'high-slippage',
    message: `Slippage tolerance is ${slippageBps / 100}% — above the ${HIGH_SLIPPAGE_BPS / 100}% caution line. The pool may move against you.`,
  }
}

export interface SendWarningInput {
  amount?: number
  tokenSymbol?: string
  recipient?: string
  savedAddresses?: readonly string[]
  balances?: CopilotAvailableBalances | null
}

export function sendActionWarnings(input: SendWarningInput): CopilotActionWarning[] {
  const warnings: CopilotActionWarning[] = []
  const recipient = newRecipientWarning(input.recipient, input.savedAddresses ?? [])
  if (recipient) warnings.push(recipient)
  const large = largeShareWarning(
    input.amount,
    availableBalanceFor(input.balances, input.tokenSymbol || 'USDC'),
    input.tokenSymbol || 'USDC'
  )
  if (large) warnings.push(large)
  return warnings
}

export interface SwapWarningInput {
  amount?: number
  fromToken?: string
  slippageBps?: number | null
  balances?: CopilotAvailableBalances | null
}

export function swapActionWarnings(input: SwapWarningInput): CopilotActionWarning[] {
  const warnings: CopilotActionWarning[] = []
  const slippage = highSlippageWarning(input.slippageBps)
  if (slippage) warnings.push(slippage)
  const large = largeShareWarning(
    input.amount,
    availableBalanceFor(input.balances, input.fromToken || 'USDC'),
    input.fromToken || 'USDC'
  )
  if (large) warnings.push(large)
  return warnings
}

export function depositActionWarnings(input: {
  amount?: number
  balances?: CopilotAvailableBalances | null
}): CopilotActionWarning[] {
  const large = largeShareWarning(input.amount, availableBalanceFor(input.balances, 'USDC'), 'USDC')
  return large ? [large] : []
}
