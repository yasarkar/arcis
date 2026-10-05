import { describe, expect, it } from 'vitest'
import { formatPercent, formatUsdcAmount } from '../formatNumber'

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
