// src/config/copilotTokens.ts
// Canonical token vocabulary for the Ask Arco copilot.
//
// Arc Testnet's Bitcoin asset is cirBTC (8 decimals) — there is no WBTC deployment on Arc. Every
// layer that parses, prompts, or executes a copilot action must therefore:
//   1. resolve "cirBTC" BEFORE the generic "...btc" aliases, and
//   2. treat a plain BTC/WBTC request as UNSUPPORTED and answer with guidance, never by silently
//      routing to a different asset (which would move the user's USDC while claiming WBTC).

import { numberToExactDecimal } from '../utils/copilotAmount'
import type { CopilotActionPayload } from '../types/marketplace'

/** Tokens the copilot can send or swap on Arc Testnet, in their canonical display casing. */
export const COPILOT_SUPPORTED_TOKENS = ['USDC', 'EURC', 'WETH', 'cirBTC', 'af-USDC'] as const

/** Tokens the copilot can actually send on Arc Testnet (af-USDC is a vault share, not a send target). */
export const COPILOT_SEND_TOKENS = ['USDC', 'EURC', 'WETH', 'cirBTC'] as const

/**
 * Names a user or model may mention that have no Arc Testnet deployment. They are recognized so the
 * copilot can answer with guidance instead of coercing them into a different asset.
 */
export const COPILOT_UNSUPPORTED_TOKENS = ['WBTC'] as const

export type CopilotTokenSymbol =
  | (typeof COPILOT_SUPPORTED_TOKENS)[number]
  | (typeof COPILOT_UNSUPPORTED_TOKENS)[number]

/** Decimals for each sendable Arc token, used to validate amount precision before parseUnits. */
export const COPILOT_SEND_DECIMALS: Record<string, number> = {
  USDC: 6,
  EURC: 6,
  cirBTC: 8,
  WETH: 18,
}

/** Canonical zero address — a transfer to it irreversibly burns the funds. */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** True when the value looks like a 20-byte EVM address. */
export function isValidEvmAddress(value?: string | null): boolean {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value)
}

/** True when the value is the all-zero address (a burn target). */
export function isZeroAddress(value?: string | null): boolean {
  return typeof value === 'string' && value.toLowerCase() === ZERO_ADDRESS
}

export interface SendAmountValidation {
  ok: boolean
  error?: string
  /** Exact amount within the token's supported precision, present only when ok. */
  normalized?: number
}

/**
 * Validates a transfer amount: it must be a finite, strictly positive number that fits the token's
 * decimal precision. A silent fallback (the old `|| 1` / `|| 100`) is deliberately not provided,
 * because turning "send 0" into "send 1" moves real funds the user never asked to move.
 */
export function validateSendAmount(amount: unknown, tokenSymbol: string): SendAmountValidation {
  const n = typeof amount === 'number' ? amount : Number(amount)
  if (!Number.isFinite(n)) return { ok: false, error: 'Please provide a numeric transfer amount.' }
  if (n <= 0) return { ok: false, error: 'Transfer amount must be greater than zero.' }
  if (Number.isInteger(n) && !Number.isSafeInteger(n)) {
    return { ok: false, error: 'Transfer amount cannot be represented exactly by the transaction interface.' }
  }

  const decimals = COPILOT_SEND_DECIMALS[tokenSymbol]
  if (decimals !== undefined) {
    const decimal = numberToExactDecimal(n)!
    const [whole, fraction = ''] = decimal.split('.')
    // Exact digit validation: float multiplication/tolerances can accept amounts below one unit.
    if (fraction.length > decimals) {
      return { ok: false, error: `Amount is more precise than ${tokenSymbol} supports (max ${decimals} decimals).` }
    }
    const units = BigInt(whole + fraction.padEnd(decimals, '0'))
    if (units <= 0n || units > (1n << 256n) - 1n) {
      return { ok: false, error: 'Transfer amount is outside the token atomic-unit range.' }
    }
    return { ok: true, normalized: n }
  }

  return { ok: true, normalized: n }
}

/** Plain-text guidance shown when the user asks for a token that has no Arc deployment. */
export const WBTC_UNSUPPORTED_MESSAGE =
  'WBTC is not available on Arc Testnet. Arc\'s Bitcoin asset is cirBTC (Circle Wrapped Bitcoin) — use "cirBTC" instead.'

/**
 * Normalizes any user- or model-supplied token string into a canonical copilot symbol.
 * cirBTC is matched before the generic BTC aliases so "cirBTC" never degrades into WBTC.
 * Unknown / empty input falls back to USDC, matching the historical parser contract.
 */
export function canonicalCopilotTokenSymbol(raw?: string | null): CopilotTokenSymbol {
  // Collapse spacing, underscores and dashes so "circle btc", "circle-btc" and "circlebtc" agree.
  const t = (raw || '').toLowerCase().replace(/[\s_-]/g, '')
  if (t === 'cirbtc' || t === 'circlebtc' || t === 'circlebitcoin' || t === 'circlewrappedbitcoin') return 'cirBTC'
  if (t === 'btc' || t === 'wbtc' || t === 'bitcoin' || t === 'wrappedbitcoin') return 'WBTC'
  if (t === 'eth' || t === 'weth' || t === 'ethereum') return 'WETH'
  if (t === 'eur' || t === 'eurc' || t === 'euro') return 'EURC'
  if (t === 'afusdc' || t === 'vault') return 'af-USDC'
  return 'USDC'
}

/** True when a canonical symbol can be sent through the copilot on Arc Testnet. */
export function isSupportedCopilotSendToken(symbol?: string | null): boolean {
  return (COPILOT_SEND_TOKENS as readonly string[]).includes(symbol || '')
}

/** True when a symbol is recognized but has no Arc Testnet deployment (e.g. WBTC). */
export function isUnsupportedCopilotToken(symbol?: string | null): boolean {
  return (COPILOT_UNSUPPORTED_TOKENS as readonly string[]).includes(symbol || '')
}

/** True when the prompt text names the Arc Bitcoin token (cirBTC) rather than generic/Wrapped BTC. */
export function mentionsCirBtc(prompt: string): boolean {
  const p = (prompt || '').toLowerCase()
  return p.includes('cirbtc') || p.includes('circle btc') || p.includes('circle-bitcoin') || p.includes('circle bitcoin')
}

/** True when the prompt names a Bitcoin token other than cirBTC (i.e. an unsupported BTC/WBTC ask). */
export function mentionsUnsupportedBtc(prompt: string): boolean {
  const p = (prompt || '').toLowerCase()
  if (mentionsCirBtc(p)) return false
  return p.includes('wbtc') || /\bbtc\b/.test(p) || p.includes('bitcoin')
}

/**
 * Detects if a prompt specifies a non-USDC token for bridging (e.g. WETH, ETH, cirBTC, BTC, EURC).
 * Copilot bridge operations are strictly USDC-only; any non-USDC token must be refused with guidance
 * rather than silently converting to USDC.
 */
export function detectNonUsdcBridgeToken(prompt: string): string | null {
  const p = (prompt || '').toLowerCase()

  // First, check if an explicit amount is attached to a token symbol
  const amountToken = p.match(/\b\d+(?:[.,]\d+)?\s*(weth|eth|cirbtc|btc|wbtc|eurc|usdc)\b/)
    || p.match(/\b(weth|eth|cirbtc|btc|wbtc|eurc|usdc)\s*\d+(?:[.,]\d+)?\b/)

  if (amountToken) {
    const sym = (amountToken[1] || amountToken[2] || '').toLowerCase()
    if (sym === 'usdc') return null
    if (sym === 'weth' || sym === 'eth') return 'WETH'
    if (sym === 'cirbtc' || sym === 'btc' || sym === 'wbtc') return 'cirBTC'
    if (sym === 'eurc') return 'EURC'
  }

  // If the prompt explicitly specifies a USDC amount anywhere, it is a USDC bridge
  if (/\b\d+(?:[.,]\d+)?\s*usdc\b/.test(p) || /\busdc\s*\d+(?:[.,]\d+)?\b/.test(p)) {
    return null
  }

  if (/\bcirbtc\b/.test(p) || /circle\s*btc/.test(p)) return 'cirBTC'
  if (/\b(wbtc|btc|bitcoin)\b/.test(p)) return 'cirBTC'
  if (/\bweth\b/.test(p)) return 'WETH'
  if (/\beurc\b/.test(p) || /\beuro\b/.test(p)) return 'EURC'

  // Bare ETH check: ensure it's not a chain reference like "to eth", "from eth", "eth sepolia"
  if (/\beth\b/.test(p) && !/(?:from|to|den|dan|ten|tan|ye|ya)\s+eth\b/.test(p) && !/\beth\s+sepolia\b/.test(p)) {
    return 'WETH'
  }

  return null
}

/** Plain-text / markdown guidance shown when the user asks to bridge a non-USDC token in Copilot. */
export function unsupportedBridgeTokenGuidance(tokenName: string): {
  message: string
  actionPayload: CopilotActionPayload
} {
  return {
    message: `<strong>Unsupported bridge token.</strong>\n\nAsk Arco currently supports bridging for <strong>USDC only</strong> via Circle Gateway. To bridge <strong>${tokenName}</strong>, please use the manual <strong>Bridge</strong> tab in the navigation menu where CCTP-X multi-asset routes are supported.`,
    actionPayload: {
      type: 'unsupported_bridge',
      title: 'Unsupported Bridge Asset',
      data: {
        token: tokenName,
        reason: `Ask Arco currently supports bridging for USDC only via Circle Gateway. To bridge ${tokenName}, please use the manual Bridge tab in the navigation menu where CCTP-X multi-asset routes are supported.`,
      },
    },
  }
}
