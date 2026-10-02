// src/services/__tests__/copilotTokenSymbols.test.ts
// Regression coverage for Arc token handling in the copilot:
//   - cirBTC must never be misclassified as WBTC (Arc has no WBTC deployment),
//   - a plain BTC/WBTC ask must answer with guidance, never an executable wrong-asset transfer.

import { describe, it, expect } from 'vitest'
import {
  canonicalCopilotTokenSymbol,
  mentionsCirBtc,
  mentionsUnsupportedBtc,
  isSupportedCopilotSendToken,
  isUnsupportedCopilotToken,
} from '../../config/copilotTokens'
import { parseLocalIntentFallback, extractSwapTokens } from '../llmService'

const RECIPIENT = '0x5f8f4cC0403332fC9c22a23222DDb9B267BF2E70'
const SEND_CIRBTC = `send 0.0001 cirBTC to ${RECIPIENT}`

describe('canonicalCopilotTokenSymbol', () => {
  it('resolves every cirBTC spelling to cirBTC, never WBTC', () => {
    for (const raw of ['cirBTC', 'CIRBTC', 'cirbtc', 'circle btc', 'circle-bitcoin', 'circle bitcoin']) {
      expect(canonicalCopilotTokenSymbol(raw)).toBe('cirBTC')
    }
  })

  it('keeps generic Bitcoin aliases as the recognized-but-unsupported WBTC sentinel', () => {
    for (const raw of ['btc', 'BTC', 'wbtc', 'WBTC', 'bitcoin']) {
      expect(canonicalCopilotTokenSymbol(raw)).toBe('WBTC')
      expect(isUnsupportedCopilotToken(canonicalCopilotTokenSymbol(raw))).toBe(true)
    }
  })

  it('handles the other supported tokens and falls back to USDC', () => {
    expect(canonicalCopilotTokenSymbol('eth')).toBe('WETH')
    expect(canonicalCopilotTokenSymbol('euro')).toBe('EURC')
    expect(canonicalCopilotTokenSymbol('')).toBe('USDC')
    expect(canonicalCopilotTokenSymbol(undefined)).toBe('USDC')
    expect(canonicalCopilotTokenSymbol('not-a-token')).toBe('USDC')
  })

  it('reports exactly which tokens are sendable on Arc', () => {
    expect(isSupportedCopilotSendToken('USDC')).toBe(true)
    expect(isSupportedCopilotSendToken('EURC')).toBe(true)
    expect(isSupportedCopilotSendToken('WETH')).toBe(true)
    expect(isSupportedCopilotSendToken('cirBTC')).toBe(true)
    expect(isSupportedCopilotSendToken('WBTC')).toBe(false)
    expect(isSupportedCopilotSendToken('af-USDC')).toBe(false)
  })

  it('distinguishes cirBTC mentions from unsupported Bitcoin asks', () => {
    expect(mentionsCirBtc('send cirBTC to a friend')).toBe(true)
    expect(mentionsCirBtc('round trip to circle btc')).toBe(true)
    expect(mentionsUnsupportedBtc('send cirBTC to a friend')).toBe(false)
    expect(mentionsUnsupportedBtc('send wbtc to a friend')).toBe(true)
    expect(mentionsUnsupportedBtc('what is btc?')).toBe(true)
    expect(mentionsUnsupportedBtc('swap usdc to eurc')).toBe(false)
  })
})

describe('local NLP cirBTC send', () => {
  it('keeps cirBTC in the prepared transfer instead of rewriting it to WBTC', () => {
    const result = parseLocalIntentFallback(SEND_CIRBTC)

    expect(result.actionPayload?.type).toBe('interactive_send')
    expect(result.actionPayload?.data?.tokenSymbol).toBe('cirBTC')
    expect(result.actionPayload?.data?.amount).toBe(0.0001)
    expect(result.actionPayload?.data?.recipient).toBe(RECIPIENT)
    expect(result.message).not.toContain('WBTC')
    expect(result.actionPayload?.title).toContain('cirBTC')
  })

  it('quotes realistic gas for native USDC (21k gas) vs ERC-20 token transfers (65k gas)', () => {
    const usdc = parseLocalIntentFallback(`send 1 usdc to ${RECIPIENT}`)
    const cirbtc = parseLocalIntentFallback(SEND_CIRBTC)

    // The estimated fee lives on the action payload (rendered by the card and the receipt).
    const feeOf = (r: { actionPayload?: { data?: Record<string, unknown> } }) => Number(r.actionPayload?.data?.estimatedFeeUsdc)
    expect(feeOf(usdc)).toBeLessThan(0.001) // ~0.00053 USDC (21k gas at fast tier)
    expect(feeOf(cirbtc)).toBeGreaterThan(0.001) // ~0.00163 USDC (65k gas at fast tier)
    expect(feeOf(cirbtc)).toBeGreaterThan(feeOf(usdc))
  })

  it('recognizes cirBTC in a swap command too', () => {
    expect(extractSwapTokens('swap 100 usdc to cirbtc')).toEqual({ fromTok: 'USDC', toTok: 'cirBTC' })
    expect(extractSwapTokens('swap 0.5 cirBTC to usdc')).toEqual({ fromTok: 'cirBTC', toTok: 'USDC' })
  })

  it('preserves direction for one-token buy and sell requests without matching substrings', () => {
    expect(extractSwapTokens('buy ETH')).toEqual({ fromTok: 'USDC', toTok: 'WETH' })
    expect(extractSwapTokens('sell WETH')).toEqual({ fromTok: 'WETH', toTok: 'USDC' })
    expect(extractSwapTokens('swap 10 USDC to EURC')).toEqual({ fromTok: 'USDC', toTok: 'EURC' })
  })

  it('does not interpret incidental mentions of "eth" inside other words as a token', () => {
    expect(extractSwapTokens('swap 10 USDC to EURC for weather')).toEqual({ fromTok: 'USDC', toTok: 'EURC' })
  })
})

describe('WBTC is refused, never silently routed to another asset', () => {
  it('answers a WBTC send with guidance instead of an executable payload', () => {
    for (const prompt of [`send 1 wbtc to ${RECIPIENT}`, `send 0.5 btc to ${RECIPIENT}`]) {
      const result = parseLocalIntentFallback(prompt)
      expect(result.actionPayload).toBeUndefined()
      expect(result.message).toContain('WBTC is not available on Arc Testnet')
      expect(result.message).toContain('cirBTC')
    }
  })

  it('answers a WBTC swap with guidance too', () => {
    const result = parseLocalIntentFallback('swap 100 usdc to btc')
    expect(result.actionPayload).toBeUndefined()
    expect(result.message).toContain('WBTC is not available on Arc Testnet')
  })
})
