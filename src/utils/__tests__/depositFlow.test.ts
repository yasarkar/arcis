import { describe, expect, it } from 'vitest'
import {
  buildDepositHistoryEntry,
  computeMaxDeposit,
  formatDepositFee,
  isArcChainKey,
  isCompleteDepositAmount,
  sanitizeDepositAmountInput,
  sortDepositChains,
  sortGatewayBalances,
  validateDepositAmount,
} from '../depositFlow'

describe('depositFlow amount input', () => {
  it('accepts partial values while typing', () => {
    expect(sanitizeDepositAmountInput('')).toBe('')
    expect(sanitizeDepositAmountInput('1')).toBe('1')
    expect(sanitizeDepositAmountInput('1.')).toBe('1.')
    expect(sanitizeDepositAmountInput('0.000001')).toBe('0.000001')
  })

  it('rejects exponent notation, negatives, multiple dots and >6 decimals', () => {
    expect(sanitizeDepositAmountInput('1e5')).toBeNull()
    expect(sanitizeDepositAmountInput('-1')).toBeNull()
    expect(sanitizeDepositAmountInput('1.2.3')).toBeNull()
    expect(sanitizeDepositAmountInput('abc')).toBeNull()
    expect(sanitizeDepositAmountInput('0.0000001')).toBeNull()
  })

  it('accepts a comma as the decimal separator (TR/DE keyboards) and normalizes to a dot', () => {
    expect(sanitizeDepositAmountInput('1,5')).toBe('1.5')
    expect(sanitizeDepositAmountInput(',5')).toBe('.5')
    expect(sanitizeDepositAmountInput('1,')).toBe('1.')
    expect(sanitizeDepositAmountInput('0,000001')).toBe('0.000001')
    expect(sanitizeDepositAmountInput('1,0000001')).toBeNull()
    expect(sanitizeDepositAmountInput('1,2,3')).toBeNull()
  })

  it('normalizes pasted values with thousand separators in either format', () => {
    expect(sanitizeDepositAmountInput('1.234,56')).toBe('1234.56')
    expect(sanitizeDepositAmountInput('1,234.56')).toBe('1234.56')
    expect(sanitizeDepositAmountInput('1 234,56')).toBe('1234.56')
    expect(sanitizeDepositAmountInput('12,345,678.90')).toBe('12345678.90')
    // Malformed groupings must be rejected instead of silently misread.
    expect(sanitizeDepositAmountInput('12.34,56')).toBeNull()
    expect(sanitizeDepositAmountInput('1.234.567')).toBeNull()
  })

  it('detects complete well-formed amounts', () => {
    expect(isCompleteDepositAmount('10')).toBe(true)
    expect(isCompleteDepositAmount('10.25')).toBe(true)
    expect(isCompleteDepositAmount('0.000001')).toBe(true)
    expect(isCompleteDepositAmount('10.')).toBe(false)
    expect(isCompleteDepositAmount('.5')).toBe(false)
    expect(isCompleteDepositAmount('10.0000001')).toBe(false)
  })
})

describe('depositFlow validation', () => {
  it('reports empty, format and insufficient balance reasons separately', () => {
    expect(validateDepositAmount('', '10')).toMatchObject({ ok: false, reason: 'empty' })
    expect(validateDepositAmount('1.1234567', '10')).toMatchObject({ ok: false, reason: 'format' })
    expect(validateDepositAmount('11', '10')).toMatchObject({ ok: false, reason: 'insufficient' })
    expect(validateDepositAmount('0', '10')).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('returns the parsed value for a valid amount', () => {
    expect(validateDepositAmount('7.25', '10')).toEqual({ ok: true, parsed: 7.25 })
    expect(validateDepositAmount('10', '10.00')).toEqual({ ok: true, parsed: 10 })
  })
})

describe('depositFlow MAX calculation', () => {
  it('reserves native gas only on Arc', () => {
    expect(computeMaxDeposit('10.00', true)).toBe('9.95')
    expect(computeMaxDeposit('10.00', false)).toBe('10')
    expect(computeMaxDeposit('0.05', true)).toBe('0')
    expect(computeMaxDeposit('100.00', false)).toBe('100')
    expect(computeMaxDeposit('10.50', false)).toBe('10.5')
    expect(computeMaxDeposit('invalid', false)).toBe('0')
  })

  it('identifies Arc chain keys for both environments', () => {
    expect(isArcChainKey('Arc_Testnet')).toBe(true)
    expect(isArcChainKey('Arc')).toBe(true)
    expect(isArcChainKey('Base_Sepolia')).toBe(false)
    expect(isArcChainKey(undefined)).toBe(false)
  })
})

describe('depositFlow sorting', () => {
  it('sorts Gateway balances by descending amount', () => {
    const sorted = sortGatewayBalances([
      { chainKey: 'a', balance: '1.00' },
      { chainKey: 'b', balance: '12.50' },
      { chainKey: 'c', balance: '0.00' },
    ])
    expect(sorted.map((item) => item.chainKey)).toEqual(['b', 'a', 'c'])
  })

  it('sorts deposit chains by wallet balance with the active Arc chain first among equals', () => {
    const sorted = sortDepositChains(
      ['Base_Sepolia', 'Arc_Testnet', 'Arbitrum_Sepolia'],
      {
        Base_Sepolia: { usdc: '5.00' },
        Arc_Testnet: { usdc: '0.00' },
        Arbitrum_Sepolia: { usdc: '5.00' },
      },
      (key) => key,
      'Arc_Testnet'
    )
    expect(sorted).toEqual(['Arbitrum_Sepolia', 'Base_Sepolia', 'Arc_Testnet'])
  })
})

describe('depositFlow verified fee formatting', () => {
  it('renders a resolved fee with its native currency', () => {
    expect(formatDepositFee({ amount: '0.000792866025', symbol: 'USDC' })).toBe('0.000792866025 USDC')
    expect(formatDepositFee({ amount: '0.00012', symbol: 'ETH' })).toBe('0.00012 ETH')
  })

  it('returns null for missing, malformed or zero fees so the row is omitted', () => {
    expect(formatDepositFee(undefined)).toBeNull()
    expect(formatDepositFee(null)).toBeNull()
    expect(formatDepositFee({ amount: '', symbol: 'USDC' })).toBeNull()
    expect(formatDepositFee({ amount: '0', symbol: 'USDC' })).toBeNull()
    expect(formatDepositFee({ amount: 'abc', symbol: 'USDC' })).toBeNull()
  })
})

describe('depositFlow history mapping', () => {
  it('maps a confirmed deposit into a persisted history entry', () => {
    const entry = buildDepositHistoryEntry(
      { amount: '25.5', chainKey: 'Base_Sepolia', txHash: '0xabc' },
      '0xWALLET'
    )
    expect(entry).toMatchObject({
      type: 'deposit',
      txHash: '0xabc',
      amount: '25.5',
      tokenSymbol: 'USDC',
      sourceChain: 'Base_Sepolia',
      recipient: '0xWALLET',
      userAddress: '0xWALLET',
      status: 'success',
    })
  })
})
