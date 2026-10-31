import { describe, it, expect } from 'vitest'
import { formatAmountDisplay, formatAmountExact } from '../historyHelpers'

// P2-4: the table shows a compact, rounded amount; hovering reveals the exact
// stored value and the receipt renders it unrounded. No digit may be lost.

describe('formatAmountExact', () => {
  it('keeps every significant digit instead of rounding to 2 decimals', () => {
    expect(formatAmountExact('12.345678')).toBe('12.345678')
    expect(formatAmountExact('0.123456789')).toBe('0.123456789')
  })

  it('trims only insignificant trailing zeros', () => {
    expect(formatAmountExact('1.230000')).toBe('1.23')
    expect(formatAmountExact('1.000000')).toBe('1')
    expect(formatAmountExact('100.000000')).toBe('100')
  })

  it('keeps tiny values out of exponential notation', () => {
    expect(formatAmountExact('0.0000001234')).toBe('0.0000001234')
    expect(formatAmountExact('0.000000000001')).toBe('0.000000000001')
  })

  it('preserves the sign', () => {
    expect(formatAmountExact('-2.5000')).toBe('-2.5')
  })

  it('passes through values that are not plain decimals', () => {
    expect(formatAmountExact('1e-7')).toBe('1e-7')
    expect(formatAmountExact('n/a')).toBe('n/a')
    expect(formatAmountExact(undefined)).toBe('')
  })
})

describe('formatAmountDisplay', () => {
  it('rounds for the compact row display', () => {
    expect(formatAmountDisplay('12.345678')).toBe('12.35')
    expect(formatAmountDisplay('1000.999')).toBe('1001')
  })

  it('never renders a real sub-micro amount as a flat zero', () => {
    expect(formatAmountDisplay('0.0000001234')).toBe('0.0000001234')
    expect(formatAmountDisplay('0.00001234')).toBe('0.00001234')
  })

  it('handles zero and non-numeric input', () => {
    expect(formatAmountDisplay('0')).toBe('0')
    expect(formatAmountDisplay('abc')).toBe('abc')
    expect(formatAmountDisplay('')).toBe('0')
  })
})
