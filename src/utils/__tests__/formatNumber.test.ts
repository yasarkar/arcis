import { describe, expect, it } from 'vitest'
import { formatPercent, formatUsdcAmount, formatSubscriptZero, formatBroadcastAmount } from '../formatNumber'

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

describe('formatBroadcastAmount', () => {
  it('formats stablecoins (USDC, EURC) with exactly 2 decimals when >= 1', () => {
    expect(formatBroadcastAmount('5', 'USDC')).toBe('5.00')
    expect(formatBroadcastAmount(5, 'USDC')).toBe('5.00')
    expect(formatBroadcastAmount('1234.5', 'USDC')).toBe('1,234.50')
    expect(formatBroadcastAmount('10.256', 'USDC')).toBe('10.26')
    expect(formatBroadcastAmount('100', 'EURC')).toBe('100.00')
    expect(formatBroadcastAmount('0', 'USDC')).toBe('0.00')
  })

  it('formats stablecoins < 1 with up to 4 decimals', () => {
    expect(formatBroadcastAmount('0.5', 'USDC')).toBe('0.50')
    expect(formatBroadcastAmount('0.0034', 'USDC')).toBe('0.0034')
    expect(formatBroadcastAmount('0.003438', 'USDC')).toBe('0.0034')
    expect(formatBroadcastAmount('0.00003', 'USDC')).toBe('< 0.0001')
  })

  it('formats high-value assets (cirBTC, WETH) with 4 decimals when < 1', () => {
    expect(formatBroadcastAmount('0.003438343443', 'cirBTC')).toBe('0.0034')
    expect(formatBroadcastAmount('0.003438343443', 'wETH')).toBe('0.0034')
    expect(formatBroadcastAmount('0.003438343443', 'WETH')).toBe('0.0034')
    expect(formatBroadcastAmount('0.05', 'cirBTC')).toBe('0.0500')
    expect(formatBroadcastAmount('0.00002', 'cirBTC')).toBe('< 0.0001')
  })

  it('formats high-value assets >= 1 with 2 to 4 decimals', () => {
    expect(formatBroadcastAmount('1', 'cirBTC')).toBe('1.00')
    expect(formatBroadcastAmount('1.25', 'cirBTC')).toBe('1.25')
    expect(formatBroadcastAmount('1.23456', 'wETH')).toBe('1.2346')
  })

  it('formats LP tokens with 2 to 4 decimals', () => {
    expect(formatBroadcastAmount('14.839201', 'af-USDC-EURC')).toBe('14.8392')
    expect(formatBroadcastAmount('5', 'af-USDC')).toBe('5.00')
  })

  it('preserves non-numeric strings and edge cases', () => {
    expect(formatBroadcastAmount('10 USDC, 5 EURC', 'USDC')).toBe('10 USDC, 5 EURC')
    expect(formatBroadcastAmount('Yield', 'USDC')).toBe('Yield')
    expect(formatBroadcastAmount(null)).toBe('')
    expect(formatBroadcastAmount(undefined)).toBe('')
    expect(formatBroadcastAmount('')).toBe('')
  })
})


