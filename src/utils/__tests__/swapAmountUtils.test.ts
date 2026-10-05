import { describe, it, expect } from 'vitest'
import {
  floorToPlaces,
  computeMaxSpendable,
  computeQuickAmount,
  clampDecimalInput,
  ARC_GAS_BUFFER_USDC,
} from '../swapAmountUtils'

describe('floorToPlaces', () => {
  it('floors instead of rounding half-up (MAX must never exceed the balance)', () => {
    // Regression: `toFixed(2)` produced "12.35" here — an amount the wallet did not hold.
    expect(floorToPlaces(12.345678, 2)).toBe(12.34)
    expect(floorToPlaces(12.349999, 2)).toBe(12.34)
    expect(floorToPlaces(1.999999, 2)).toBe(1.99)
  })

  it('does not lose precision to binary float error', () => {
    expect(floorToPlaces(1.13, 2)).toBe(1.13)
    expect(floorToPlaces(0.07, 2)).toBe(0.07)
    expect(floorToPlaces(0.1 + 0.2, 6)).toBeCloseTo(0.3, 6)
  })

  it('floors tiny and invalid values to zero', () => {
    expect(floorToPlaces(0.004, 2)).toBe(0)
    expect(floorToPlaces(0, 2)).toBe(0)
    expect(floorToPlaces(-5, 2)).toBe(0)
    expect(floorToPlaces(NaN, 2)).toBe(0)
    expect(floorToPlaces(Infinity, 2)).toBe(0)
  })

  it('respects higher precision tokens such as cirBTC (5 display places)', () => {
    expect(floorToPlaces(1.23456789, 5)).toBe(1.23456)
  })
})

describe('computeMaxSpendable', () => {
  it('returns the floored balance when no gas reserve is needed', () => {
    expect(computeMaxSpendable('12.345678', 2, false)).toBe(12.34)
    expect(computeMaxSpendable('10', 2, false)).toBe(10)
    expect(computeMaxSpendable('1.23456789', 5, false)).toBe(1.23456)
  })

  it('withholds the Arc USDC gas reserve so the swap can still be paid for', () => {
    expect(ARC_GAS_BUFFER_USDC).toBe(0.01)
    expect(computeMaxSpendable('10', 2, true)).toBe(9.99)
    expect(computeMaxSpendable('0.02', 2, true)).toBe(0.01)
    expect(computeMaxSpendable('12.345678', 2, true)).toBe(12.33)
  })

  it('returns 0 when nothing spendable is left after the reserve', () => {
    expect(computeMaxSpendable('0.01', 2, true)).toBe(0)
    expect(computeMaxSpendable('0.005', 2, true)).toBe(0)
    expect(computeMaxSpendable('0.00', 2, false)).toBe(0)
    expect(computeMaxSpendable('', 2, false)).toBe(0)
    expect(computeMaxSpendable('not-a-number', 2, false)).toBe(0)
  })
})

describe('computeQuickAmount', () => {
  it('floors percentage selections against the cap', () => {
    expect(computeQuickAmount(10, 25, 2)).toBe(2.5)
    expect(computeQuickAmount(10, 50, 2)).toBe(5)
    expect(computeQuickAmount(9.99, 75, 2)).toBe(7.49)
  })

  it('maps 100% exactly to the gas-reserve-aware cap', () => {
    expect(computeQuickAmount(9.99, 100, 2)).toBe(9.99)
    expect(computeQuickAmount(9.99, 100, 2)).toBeLessThanOrEqual(9.99)
  })

  it('returns 0 for unusable inputs', () => {
    expect(computeQuickAmount(0, 100, 2)).toBe(0)
    expect(computeQuickAmount(-1, 50, 2)).toBe(0)
    expect(computeQuickAmount(10, 0, 2)).toBe(0)
    expect(computeQuickAmount(NaN, 50, 2)).toBe(0)
  })
})

describe('clampDecimalInput (audit #13)', () => {
  it('truncates excess fractional digits so parseUnits can never throw', () => {
    expect(clampDecimalInput('1.1234567', 6)).toBe('1.123456')
    expect(clampDecimalInput('0.123456789', 6)).toBe('0.123456')
    expect(clampDecimalInput('1.9999999', 8)).toBe('1.9999999')
    expect(clampDecimalInput('1.5', 0)).toBe('1.')
  })

  it('keeps valid input untouched, including trailing dots and empty values', () => {
    expect(clampDecimalInput('12.345678', 6)).toBe('12.345678')
    expect(clampDecimalInput('12', 6)).toBe('12')
    expect(clampDecimalInput('12.', 6)).toBe('12.')
    expect(clampDecimalInput('.', 6)).toBe('.')
    expect(clampDecimalInput('', 6)).toBe('')
    expect(clampDecimalInput('1.5')).toBe('1.5') // no limit configured
  })

  it('normalizes decimal commas and rejects malformed values', () => {
    expect(clampDecimalInput('1,25', 6)).toBe('1.25')
    expect(clampDecimalInput('1.2.3', 6)).toBeNull()
    expect(clampDecimalInput('12a', 6)).toBeNull()
    expect(clampDecimalInput('-3', 6)).toBeNull()
  })
})
