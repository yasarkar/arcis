// src/services/__tests__/copilotSendSafety.test.ts
// Guards the Ask Arco send path against the "silent default" hazards: no amount defaulting to
// 100/1, no zero/negative transfers, no burn or self-send, and no over-spend slipping past the
// pre-confirm balance check.

import { describe, it, expect } from 'vitest'
import {
  validateSendAmount,
  isValidEvmAddress,
  isZeroAddress,
} from '../../config/copilotTokens'
import { parseLocalIntentFallback } from '../llmService'
import { tokenAmountToUsd } from '../tokenPriceService'

const RECIPIENT = '0x5f8f4cC0403332fC9c22a23222DDb9B267BF2E70'
const SELF = '0x1111111111111111111111111111111111111111'
const ZERO = '0x0000000000000000000000000000000000000000'

describe('validateSendAmount', () => {
  it('rejects non-finite, zero and negative amounts', () => {
    for (const bad of [undefined, null, NaN, 'abc', 0, -1, '0']) {
      expect(validateSendAmount(bad, 'USDC').ok).toBe(false)
    }
  })

  it('rejects amounts more precise than the token supports', () => {
    expect(validateSendAmount(1.1234567, 'USDC').ok).toBe(false) // USDC = 6 decimals
    expect(validateSendAmount(1.12345678, 'cirBTC').ok).toBe(true) // cirBTC = 8 decimals
    expect(validateSendAmount(1.123456789, 'cirBTC').ok).toBe(false)
  })

  it('normalizes a valid amount to the token precision', () => {
    const result = validateSendAmount(0.0001, 'cirBTC')
    expect(result.ok).toBe(true)
    expect(result.normalized).toBe(0.0001)
  })
})

describe('address guards', () => {
  it('accepts only 20-byte hex addresses', () => {
    expect(isValidEvmAddress(RECIPIENT)).toBe(true)
    expect(isValidEvmAddress('alice')).toBe(false)
    expect(isValidEvmAddress('0x123')).toBe(false)
    expect(isValidEvmAddress('')).toBe(false)
  })

  it('flags the burn address', () => {
    expect(isZeroAddress(ZERO)).toBe(true)
    expect(isZeroAddress(RECIPIENT)).toBe(false)
  })
})

describe('local NLP send hardening', () => {
  it('requires an explicit amount (no silent 100 default)', () => {
    const r = parseLocalIntentFallback(`send cirBTC to ${RECIPIENT}`)
    expect(r.actionPayload).toBeUndefined()
    expect(r.message).toMatch(/Amount required/i)
  })

  it('rejects a zero amount', () => {
    const r = parseLocalIntentFallback(`send 0 usdc to ${RECIPIENT}`)
    expect(r.actionPayload).toBeUndefined()
    expect(r.message).toMatch(/Invalid amount/i)
  })

  it('rejects a free-form recipient name and a missing address', () => {
    // 'bob' rather than 'alice': "alice" contains the "al" that the (unrelated) swap intent matches.
    for (const prompt of ['send 5 usdc to bob', 'send 5 usdc']) {
      const r = parseLocalIntentFallback(prompt)
      expect(r.actionPayload).toBeUndefined()
      expect(r.message).toMatch(/Recipient required/i)
    }
  })

  it('refuses the burn address and the sender own wallet', () => {
    expect(parseLocalIntentFallback(`send 5 usdc to ${ZERO}`).actionPayload).toBeUndefined()
    const self = parseLocalIntentFallback(`send 5 usdc to ${SELF}`, SELF)
    expect(self.actionPayload).toBeUndefined()
    expect(self.message).toMatch(/own wallet/i)
  })

  it('refuses an amount above the snapshot balance', () => {
    const portfolio = { walletAddress: SELF, liquidCirBtc: 0.00005 }
    const r = parseLocalIntentFallback(`send 0.0001 cirBTC to ${RECIPIENT}`, SELF, undefined, undefined, portfolio as any)
    expect(r.actionPayload).toBeUndefined()
    expect(r.message).toMatch(/Insufficient balance/i)
  })

  it('still builds a valid cirBTC transfer and surfaces the available balance', () => {
    const portfolio = { walletAddress: SELF, liquidCirBtc: 0.5 }
    const r = parseLocalIntentFallback(`send 0.0001 cirBTC to ${RECIPIENT}`, SELF, undefined, undefined, portfolio as any)
    expect(r.actionPayload?.type).toBe('interactive_send')
    expect(r.actionPayload?.data?.amount).toBe(0.0001)
    expect(r.actionPayload?.data?.tokenSymbol).toBe('cirBTC')
    expect(r.message).toContain('Available balance: 0.5 cirBTC')
  })
})

describe('tokenAmountToUsd', () => {
  it('values non-stable tokens instead of counting them 1:1', () => {
    // cirBTC must be worth far more than its raw unit count, so session ceilings can't be bypassed.
    expect(tokenAmountToUsd('cirBTC', 0.0001)).toBeGreaterThan(1)
  })

  it('treats USDC as a 1:1 USD stablecoin', () => {
    expect(tokenAmountToUsd('USDC', 42)).toBe(42)
  })
})
