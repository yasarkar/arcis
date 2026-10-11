import { describe, expect, it } from 'vitest'
import { approvedSwapMinimum, copilotSlippageBps, exactSwapOutputUnits, swapMinimumUnits } from '../swapSlippage'

describe('A03 exact swap bounds', () => {
  it.each([[6, '0.000001'], [8, '0.00000001'], [18, '0.000000000000000001']] as const)('preserves an atomic unit at %s decimals', (decimals, decimal) => {
    expect(exactSwapOutputUnits(decimal, decimals)).toBe(1n)
    expect(approvedSwapMinimum({ minReceived: decimal }, decimals, decimal)).toBe(1n)
  })
  it.each([0, 9.405, '0', '1e-8', '0.0000001', '-1', undefined])('rejects non-exact or invalid minimum %s for 6 decimals', value => {
    expect(() => exactSwapOutputUnits(value, 6)).toThrow()
  })
  it('retains the card bound for better or worse quotes within its approved minimum', () => {
    expect(approvedSwapMinimum({ minReceived: '9.405' }, 6, '9.49')).toBe(9_405_000n)
    expect(approvedSwapMinimum({ minReceived: '9.405' }, 6, '9.6')).toBe(9_405_000n)
    expect(() => approvedSwapMinimum({ minReceived: '9.405' }, 6, '9.404999')).toThrow('approved minimum')
  })
  it('normalizes legacy chat percentages without confusing fractions or widening', () => {
    expect(copilotSlippageBps({ slippage: 0.1 })).toBe(10)
    expect(copilotSlippageBps({ slippage: 1 })).toBe(100)
    expect(() => copilotSlippageBps({ slippage: 0.001 })).toThrow()
    expect(() => copilotSlippageBps({ slippageBps: 10, slippage: 1 })).toThrow('Conflicting')
  })
  it('floors the output only at the atomic-unit boundary', () => {
    expect(swapMinimumUnits(123n, 10)).toBe(122n)
  })
})
