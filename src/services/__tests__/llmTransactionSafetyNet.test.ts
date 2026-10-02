// src/services/__tests__/llmTransactionSafetyNet.test.ts
// Verifies that explicit transaction commands always resolve to an executable action payload,
// even when the model answers with prose and never emits its tool call.

import { describe, it, expect } from 'vitest'
import { isExplicitTransactionCommand, parseLocalIntentFallback } from '../llmService'

describe('Copilot transaction safety net', () => {
  const SEND_COMMAND = 'Send 10 usdc to 0x5f8f4cc0403332fc9c22a23222ddb9b267bf2e70'

  it('flags an explicit send command as a transaction', () => {
    expect(isExplicitTransactionCommand(SEND_COMMAND)).toBe(true)
  })

  it('flags swap, deposit, and bridge commands', () => {
    expect(isExplicitTransactionCommand('swap 25 usdc to eurc')).toBe(true)
    expect(isExplicitTransactionCommand('deposit 100 usdc into the vault')).toBe(true)
    expect(isExplicitTransactionCommand('bridge 50 usdc from base')).toBe(true)
    expect(isExplicitTransactionCommand("100 USDC'yi EURC'ye çevir")).toBe(true)
    expect(isExplicitTransactionCommand('20 eurc sat')).toBe(true)
    expect(isExplicitTransactionCommand('buy 5 weth')).toBe(true)
  })

  it('never turns FAQ / how-to questions into live transactions', () => {
    expect(isExplicitTransactionCommand('How do token swaps work on Arc?')).toBe(false)
    expect(isExplicitTransactionCommand('What fees does Arcis charge on sends?')).toBe(false)
    expect(isExplicitTransactionCommand('Explain the session budget and how it protects me')).toBe(false)
  })

  it('reconstructs an executable send action from the raw command', () => {
    const result = parseLocalIntentFallback(SEND_COMMAND)

    expect(result.actionPayload?.type).toBe('interactive_send')
    expect(result.actionPayload?.data?.recipient).toBe('0x5f8f4cc0403332fc9c22a23222ddb9b267bf2e70')
    expect(result.actionPayload?.data?.amount).toBe(10)
    expect(result.actionPayload?.data?.tokenSymbol).toBe('USDC')
  })

  // The assistant message is now a short lead-in sentence; the structured network fee
  // lives on the action payload (rendered by the action card and the success receipt).
  function feeOf(r: { message: string; actionPayload?: { data?: Record<string, unknown> } }): number {
    return Number(r.actionPayload?.data?.estimatedFeeUsdc)
  }

  it('quotes a computed network fee on the payload without the removed "Native Gas" label', () => {
    const result = parseLocalIntentFallback(SEND_COMMAND)

    expect(result.message).not.toContain('Native Gas')
    expect(result.message).not.toContain('Fee:')

    const usdcFee = feeOf(result)
    // Native USDC transfer on Arc: 21,000 gas at the fast-tier fee (~0.00053 USDC).
    expect(usdcFee).toBeGreaterThan(0.0001)
    expect(usdcFee).toBeLessThan(0.001)
  })

  it('prices memo transfers with higher gas limit than standard token transfers', () => {
    const standard = parseLocalIntentFallback(SEND_COMMAND)
    const withMemo = parseLocalIntentFallback(
      `${SEND_COMMAND} with memo invoice-42`
    )

    // Memo transfers require ~75k gas vs ~65k gas for standard token transfers.
    expect(feeOf(withMemo)).toBeGreaterThan(feeOf(standard))
  })

  it('reflects the live Arc base fee when one is supplied', () => {
    const lowFee = parseLocalIntentFallback(SEND_COMMAND, undefined, undefined, undefined, undefined, 25_000_000_000n)
    const highFee = parseLocalIntentFallback(SEND_COMMAND, undefined, undefined, undefined, undefined, 50_000_000_000n)

    const low = feeOf(lowFee)
    const high = feeOf(highFee)

    // Doubling maxFeePerGas doubles the quoted network fee (65,000 gas * 25 vs 50 Gwei); the
    // displayed value is rounded to 5 decimals, so compare with a small tolerance.
    expect(high).toBeGreaterThan(low)
    expect(high / low).toBeGreaterThan(1.8)
    expect(high / low).toBeLessThan(2.2)
  })
})
