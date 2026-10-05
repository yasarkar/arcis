import { describe, expect, it } from 'vitest'
import {
  isValidAmountInput,
  isValidEvmAddress,
  isValidInjectiveAddress,
  isValidSolanaAddress,
  truncateDecimalString,
  truncateToDecimal,
} from '../SendModal'

describe('truncateToDecimal (never rounds up)', () => {
  it('truncates down instead of rounding up at the midpoint', () => {
    // toFixed(2) would produce "0.62" and trigger a false insufficient-balance state
    expect(truncateToDecimal(0.615, 2)).toBe('0.61')
    expect(truncateToDecimal(2.345, 2)).toBe('2.34')
  })

  it('keeps whole values clean and strips trailing zeros', () => {
    expect(truncateToDecimal(100, 2)).toBe('100')
    expect(truncateToDecimal(25.5, 6)).toBe('25.5')
    expect(truncateToDecimal(1, 6)).toBe('1')
  })

  it('supports high-precision tokens without losing tiny amounts', () => {
    expect(truncateToDecimal(0.0000001, 18)).toBe('0.0000001')
    expect(truncateToDecimal(0.123456789, 8)).toBe('0.12345678')
  })

  it('returns 0 for non-positive or non-finite input', () => {
    expect(truncateToDecimal(0, 2)).toBe('0')
    expect(truncateToDecimal(-1.5, 2)).toBe('0')
    expect(truncateToDecimal(Number.NaN, 2)).toBe('0')
  })
})

describe('truncateDecimalString', () => {
  it('cuts exact decimal strings without rounding', () => {
    expect(truncateDecimalString('12.34567891234', 8)).toBe('12.34567891')
    expect(truncateDecimalString('1.9999999', 2)).toBe('1.99')
  })

  it('strips trailing zeros and keeps integers intact', () => {
    expect(truncateDecimalString('1.500000', 6)).toBe('1.5')
    expect(truncateDecimalString('42', 6)).toBe('42')
    expect(truncateDecimalString('42.000000', 6)).toBe('42')
  })
})

describe('isValidAmountInput (strict)', () => {
  it('rejects parseFloat-tolerant garbage', () => {
    expect(isValidAmountInput('12abc', 6)).toBe(false)
    expect(isValidAmountInput('0x10', 6)).toBe(false)
    expect(isValidAmountInput('1e3', 6)).toBe(false)
    expect(isValidAmountInput('-5', 6)).toBe(false)
    expect(isValidAmountInput('0', 6)).toBe(false)
  })

  it('rejects partial or malformed decimals', () => {
    expect(isValidAmountInput('.5', 6)).toBe(false)
    expect(isValidAmountInput('0.', 6)).toBe(false)
  })

  it('enforces the token decimal limit', () => {
    expect(isValidAmountInput('1.123456', 6)).toBe(true)
    expect(isValidAmountInput('1.1234567', 6)).toBe(false)
    expect(isValidAmountInput('1.1234567', 7)).toBe(true)
  })

  it('accepts plain positive decimals', () => {
    expect(isValidAmountInput('0.5', 6)).toBe(true)
    expect(isValidAmountInput('123', 6)).toBe(true)
  })
})

describe('address validators', () => {
  it('validates EVM addresses with checksum awareness', () => {
    expect(isValidEvmAddress('0x000000000000000000000000000000000000dEaD')).toBe(true)
    expect(isValidEvmAddress('0x0000000000000000000000000000000000000001')).toBe(true)
    expect(isValidEvmAddress('0x0000000000000000000000000000000000000000001')).toBe(false)
    expect(isValidEvmAddress('0x123')).toBe(false)
  })

  it('validates Solana addresses via base58 charset and length', () => {
    expect(isValidSolanaAddress('11111111111111111111111111111111')).toBe(true)
    // 0, O, I and l are not base58 — this is exactly42 chars but invalid
    expect(isValidSolanaAddress('0'.repeat(32))).toBe(false)
    // an EVM-style hex string without 0x must no longer pass as Solana
    expect(isValidSolanaAddress('a'.repeat(40))).toBe(true) // valid base58 chars, valid length
    expect(isValidSolanaAddress('0x' + 'a'.repeat(40))).toBe(false)
  })

  it('validates Injective bech32 addresses by charset', () => {
    const validData = 'q'.repeat(38)
    expect(isValidInjectiveAddress(`inj1${validData}`)).toBe(true)
    // bech32 data charset includes 0 and l but excludes 1, b, i, o
    expect(isValidInjectiveAddress(`inj1${'0'.repeat(38)}`)).toBe(true)
    expect(isValidInjectiveAddress(`inj1${'1'.repeat(38)}`)).toBe(false)
    expect(isValidInjectiveAddress(`inj1${'b'.repeat(38)}`)).toBe(false)
    expect(isValidInjectiveAddress('inj1short')).toBe(false)
    expect(isValidInjectiveAddress(`0x${'a'.repeat(40)}`)).toBe(false)
  })
})
