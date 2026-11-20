import { describe, expect, it } from 'vitest'
import { normalizeWalletAddress, formatDisplayAddress } from '../address'

describe('normalizeWalletAddress', () => {
  it('lowercases and trims so one address maps to one cache entry', () => {
    expect(normalizeWalletAddress('0xAbC0000000000000000000000000000000000001')).toBe(
      '0xabc0000000000000000000000000000000000001'
    )
    expect(normalizeWalletAddress('  0xABC  ')).toBe('0xabc')
  })

  it('handles empty and missing values', () => {
    expect(normalizeWalletAddress('')).toBe('')
    expect(normalizeWalletAddress('   ')).toBe('')
    expect(normalizeWalletAddress(undefined)).toBe('')
    expect(normalizeWalletAddress(null)).toBe('')
  })
})

describe('formatDisplayAddress', () => {
  it('formats address to 0x1234...5678 format (6 prefix chars, ..., 4 suffix chars)', () => {
    expect(formatDisplayAddress('0x5ef51234567890abcdef1234567890abcdef456a')).toBe('0x5ef5...456a')
    expect(formatDisplayAddress('0x92ca73B25E67A2066cEB29b4787A5B695a3284')).toBe('0x92ca...3284')
  })

  it('handles whitespace trimming', () => {
    expect(formatDisplayAddress('  0x5ef51234567890abcdef1234567890abcdef456a  ')).toBe('0x5ef5...456a')
  })

  it('handles empty, null, and undefined values safely', () => {
    expect(formatDisplayAddress('')).toBe('')
    expect(formatDisplayAddress('   ')).toBe('')
    expect(formatDisplayAddress(null)).toBe('')
    expect(formatDisplayAddress(undefined)).toBe('')
  })

  it('returns short strings untouched if length <= 10', () => {
    expect(formatDisplayAddress('0x1234')).toBe('0x1234')
  })
})
