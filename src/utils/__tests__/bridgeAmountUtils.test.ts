import { describe, expect, it } from 'vitest'
import {
  bridgeAmountForPercentage,
  gatewayMaxFeeUsdc,
  maxBridgeAmount,
  sumBridgeDeductedFees,
} from '../bridgeAmountUtils'

describe('maxBridgeAmount — MAX must never exceed what execution can debit', () => {
  it('reserves the Direct CCTP platform fee on top of the amount', () => {
    // 100.00 balance, 0.50 platform fee → 99.50 debited exactly.
    expect(maxBridgeAmount('100.00', { platformFeeUsdc: 0.5, gatewayMaxFeeUsdc: 0 })).toBe('99.5')
    // requiredDebit = 99.5 + 0.5 = 100 → fits the balance exactly.
    expect(99.5 + 0.5).toBeLessThanOrEqual(100)
  })

  it('reserves the Gateway maxFee headroom (1.0 USDC floor)', () => {
    const reserve = gatewayMaxFeeUsdc(100)
    expect(reserve).toBe(1)
    expect(maxBridgeAmount('100', { platformFeeUsdc: 0, gatewayMaxFeeUsdc: reserve })).toBe('99')
    // amount + maxFee(amount) ≤ balance for any amount within the budget.
    expect(99 + gatewayMaxFeeUsdc(99)).toBeLessThanOrEqual(100)
  })

  it('reserves both when both apply', () => {
    expect(
      maxBridgeAmount('50', { platformFeeUsdc: 0.5, gatewayMaxFeeUsdc: 1 })
    ).toBe('48.5')
  })

  it('never returns a negative amount', () => {
    expect(maxBridgeAmount('0.4', { platformFeeUsdc: 0.5, gatewayMaxFeeUsdc: 0 })).toBe('0')
    expect(maxBridgeAmount('0', { platformFeeUsdc: 0, gatewayMaxFeeUsdc: 1 })).toBe('0')
    expect(maxBridgeAmount('garbage', { platformFeeUsdc: 0.5, gatewayMaxFeeUsdc: 1 })).toBe('0')
  })

  it('caps precision at 6 USDC decimals without rounding up', () => {
    expect(maxBridgeAmount('10.0000009', { platformFeeUsdc: 0, gatewayMaxFeeUsdc: 0 })).toBe(
      '10'
    )
    expect(
      maxBridgeAmount('1.2345678', { platformFeeUsdc: 0.1111111, gatewayMaxFeeUsdc: 0 })
    ).toBe('1.123456')
  })
})

describe('bridgeAmountForPercentage — chips are clamped to the same budget as MAX', () => {
  const reserves = { platformFeeUsdc: 0.5, gatewayMaxFeeUsdc: 0 }

  it('computes plain percentages while under the available budget', () => {
    expect(bridgeAmountForPercentage('100', 25, reserves)).toBe('25')
    expect(bridgeAmountForPercentage('100', 50, reserves)).toBe('50')
    expect(bridgeAmountForPercentage('100', 75, reserves)).toBe('75')
  })

  it('clamps 100% (MAX) to the available budget', () => {
    expect(bridgeAmountForPercentage('100', 100, reserves)).toBe('99.5')
    expect(bridgeAmountForPercentage('100', 100, reserves)).toBe(
      maxBridgeAmount('100', reserves)
    )
  })

  it('clamps oversized percentages too', () => {
    expect(bridgeAmountForPercentage('100', 150, reserves)).toBe('99.5')
  })

  it('never exceeds the budget even for mid-range percentages', () => {
    for (const pct of [25, 50, 75, 100]) {
      const value = parseFloat(bridgeAmountForPercentage('1', pct, reserves))
      expect(value + 0.5).toBeLessThanOrEqual(1)
    }
  })

  it('returns 0 for empty or non-positive balances', () => {
    expect(bridgeAmountForPercentage('0', 100, reserves)).toBe('0')
    expect(bridgeAmountForPercentage('', 100, reserves)).toBe('0')
    expect(bridgeAmountForPercentage('abc', 50, reserves)).toBe('0')
  })

  it('treats invalid percentages as 0', () => {
    expect(bridgeAmountForPercentage('100', Number.NaN, reserves)).toBe('0')
  })
})

describe('sumBridgeDeductedFees — Net Received must exclude the on-top platform fee', () => {
  it('sums only the provider and forwarder fees deducted from the amount', () => {
    expect(
      sumBridgeDeductedFees([
        { type: 'provider', amount: '0.01' },
        { type: 'forwarder', amount: '0.05' },
      ])
    ).toBeCloseTo(0.06, 10)
  })

  it('never counts the App Kit kit (platform) fee, which Circle charges on top', () => {
    expect(
      sumBridgeDeductedFees([
        { type: 'provider', amount: '0.01' },
        { type: 'forwarder', amount: '0.05' },
        { type: 'kit', amount: '0.50' },
      ])
    ).toBeCloseTo(0.06, 10)
  })

  it('ignores null, missing and unparsable amounts without throwing', () => {
    expect(sumBridgeDeductedFees([{ type: 'provider', amount: null }, { type: 'forwarder' }])).toBe(0)
    expect(sumBridgeDeductedFees([{ type: 'provider', amount: 'oops' }])).toBe(0)
    expect(sumBridgeDeductedFees(undefined)).toBe(0)
    expect(sumBridgeDeductedFees(null)).toBe(0)
    expect(sumBridgeDeductedFees([])).toBe(0)
  })
})
