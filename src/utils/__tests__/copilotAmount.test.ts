import { describe, it, expect } from 'vitest'
import { parseUnits } from 'viem'
import { parseCopilotAmount, parseCopilotPromptAmount, numberToExactDecimal } from '../copilotAmount'
import { validateSendAmount } from '../../config/copilotTokens'

const RECIPIENT = '0x2222222222222222222222222222222222222222'

describe('Ask Arco exact TR/EN amounts (A01)', () => {
  it.each([
    ['1,5', '1.5'], ['1.5', '1.5'], ['0,001', '0.001'], ['0.001', '0.001'],
    ['1000', '1000'], ['1000,00', '1000'], ['1000.00', '1000'],
    ['1.234,56', '1234.56'], ['1,234.56', '1234.56'],
    ['1.234.567', '1234567'], ['1,234,567', '1234567'],
    ['0,000001', '0.000001'], ['0.00000001', '0.00000001'],
    ['0,000000000000000001', '0.000000000000000001'],
    [',5', '0.5'], ['.5', '0.5'], ['0001,50', '1.5'],
  ])('normalizes %s losslessly to %s', (raw, decimal) => {
    const result = parseCopilotAmount(raw)
    expect(result.status).toBe('valid')
    if (result.status !== 'valid') throw new Error('Expected a valid amount')
    expect(result.decimal).toBe(decimal)
    expect(numberToExactDecimal(result.amount)).toBe(decimal)
  })

  it.each(['1.000', '1,000', '1.500', '1,500', '12.345', '123,456'])('asks for clarification for %s', raw => {
    expect(parseCopilotAmount(raw).status).toBe('ambiguous')
  })

  it.each(['1.2.3', '1,2,3', '1.23,45', '1,23.45', '-1', '+1', '1e3', '1e-3',
    '1.', '1,', '0', '0,00', 'NaN', 'Infinity', '9007199254740993',
    '1.000000000000000001', '0.123456789012345678', '9'.repeat(81),
  ])('rejects %s rather than rounding or parsing its prefix', raw => {
    expect(parseCopilotAmount(raw).status).toBe('invalid')
    expect(parseCopilotPromptAmount(`send ${raw} USDC to ${RECIPIENT}`).status).not.toBe('valid')
  })

  it.each(['1 000', '1\u00a0000', '1\u202f000', '1 000,50'])('does not truncate spaced grouping %s to its first group', raw => {
    expect(parseCopilotPromptAmount(`send ${raw} USDC to ${RECIPIENT}`).status).toBe('ambiguous')
  })

  it('ignores addresses, memo numbers and slippage rather than treating them as the amount', () => {
    expect(parseCopilotPromptAmount(`send USDC to ${RECIPIENT} memo invoice 1000`)).toEqual({ status: 'missing' })
    expect(parseCopilotPromptAmount('swap USDC to EURC slippage 1,5%')).toEqual({ status: 'missing' })
    expect(parseCopilotPromptAmount('swap 2,5 USDC to EURC slippage 1,5%')).toMatchObject({ status: 'valid', amount: 2.5 })
    expect(parseCopilotPromptAmount('swap 2,5 USDC to EURC 1,5% slippage')).toMatchObject({ status: 'valid', amount: 2.5 })
  })

  it.each([
    ['USDC', '0.000001', 6], ['EURC', '0.000001', 6],
    ['cirBTC', '0.00000001', 8], ['WETH', '0.000000000000000001', 18],
  ])('retains the smallest %s atomic unit', (token, raw, decimals) => {
    const result = parseCopilotAmount(raw)
    if (result.status !== 'valid') throw new Error('Expected smallest unit to be valid')
    expect(validateSendAmount(result.amount, token)).toMatchObject({ ok: true, normalized: result.amount })
    expect(parseUnits(result.decimal, decimals)).toBe(1n)
    expect(validateSendAmount(result.amount / 10, token).ok).toBe(false)
  })
})
