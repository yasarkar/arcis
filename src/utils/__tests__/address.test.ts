import { describe, expect, it } from 'vitest'
import { normalizeWalletAddress } from '../address'

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
