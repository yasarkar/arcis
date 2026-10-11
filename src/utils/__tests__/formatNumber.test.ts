import { describe, expect, it } from 'vitest'
import { formatPercent, formatUsdcAmount, formatSubscriptZero } from '../formatNumber'

describe('formatUsdcAmount', () => {
  it('groups thousands and keeps two decimals', () => {
    expect(formatUsdcAmount(1234567.891)).toBe('1,234,567.89')
    expect(formatUsdcAmount(0)).toBe('0.00')
    expect(formatUsdcAmount('12.5')).toBe('12.50')
    expect(formatUsdcAmount('0.004')).toBe('0.00')
  })

  it('falls back to 0.00 for invalid input', () => {
    expect(formatUsdcAmount('not-a-number')).toBe('0.00')
    expect(formatUsdcAmount(Number.NaN)).toBe('0.00')
    expect(formatUsdcAmount(Number.POSITIVE_INFINITY)).toBe('0.00')
  })
})

describe('formatPercent', () => {
  it('renders a single decimal percent', () => {
    expect(formatPercent(12.34)).toBe('12.3%')
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(100)).toBe('100.0%')
  })

  it('is resilient to non-finite input', () => {
    expect(formatPercent(Number.NaN)).toBe('0.0%')
  })
})

describe('formatSubscriptZero', () => {
  it('converts leading zeros to subscript notation', () => {
    // Exact user example
    expect(formatSubscriptZero(0.00000035)).toBe('0.0₆35')
    expect(formatSubscriptZero('0.00000035')).toBe('0.0₆35')

    // 4 zeros
    expect(formatSubscriptZero(0.000042)).toBe('0.0₄42')

    // 3 zeros (default threshold)
    expect(formatSubscriptZero(0.0001)).toBe('0.0₃1')

    // Scientific notation float e.g. 3.5e-7
    expect(formatSubscriptZero(3.5e-7)).toBe('0.0₆35')
    expect(formatSubscriptZero(1e-8)).toBe('0.0₇1')
  })

  it('keeps standard formatting below the zero threshold', () => {
    expect(formatSubscriptZero(0.001)).toBe('0.001')
    expect(formatSubscriptZero(0.05)).toBe('0.05')
    expect(formatSubscriptZero(0.5)).toBe('0.5')
  })

  it('preserves numbers greater than or equal to 1', () => {
    expect(formatSubscriptZero(1.25)).toBe('1.25')
    expect(formatSubscriptZero(100)).toBe('100')
    expect(formatSubscriptZero('65000')).toBe('65000')
  })

  it('handles edge cases gracefully', () => {
    expect(formatSubscriptZero(0)).toBe('0')
    expect(formatSubscriptZero('0')).toBe('0')
    expect(formatSubscriptZero(null)).toBe('—')
    expect(formatSubscriptZero(undefined)).toBe('—')
    expect(formatSubscriptZero('')).toBe('—')
  })
})

