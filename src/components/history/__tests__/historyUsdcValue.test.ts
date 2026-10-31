import { describe, it, expect } from 'vitest'
import type { HistoryItem } from '../../../utils/history'
import { getItemRawAmount, getItemUsdcValue } from '../historyHelpers'

// P0-4: the amount filter compares USDC-equivalent values, so a 0.5 wETH row is
// ~$1,250 and a 95 EURC leg is ~$102 — never "0.5" or "95" against USDC thresholds.

const prices = { USDC: 1, EURC: 1.08, WETH: 2500, CIRBTC: 80000 }

function item(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    id: 'x',
    type: 'send',
    txHash: '0xabc',
    amount: '0',
    tokenSymbol: 'USDC',
    sourceChain: 'Arc_Testnet',
    timestamp: 1,
    status: 'success',
    ...overrides,
  }
}

describe('getItemUsdcValue', () => {
  it('values a USDC transfer one-to-one', () => {
    expect(getItemUsdcValue(item({ amount: '25', tokenSymbol: 'USDC' }), prices)).toBe(25)
  })

  it('values a non-USDC transfer at the live price', () => {
    expect(getItemUsdcValue(item({ amount: '0.5', tokenSymbol: 'wETH' }), prices)).toBe(1250)
  })

  it('normalizes token symbols when looking up a price', () => {
    expect(getItemUsdcValue(item({ amount: '0.0001', tokenSymbol: 'cirBTC' }), prices)).toBe(8)
    expect(getItemUsdcValue(item({ amount: '1', tokenSymbol: 'WETH' }), prices)).toBe(2500)
  })

  it('values a swap on the leg the wallet spent', () => {
    const swap = item({
      type: 'swap',
      amountIn: '1',
      tokenIn: 'wETH',
      amountOut: '2450',
      tokenOut: 'USDC',
      amount: '1',
      tokenSymbol: 'wETH',
    })
    expect(getItemUsdcValue(swap, prices)).toBe(2500)
  })

  it('falls back to the received leg when the spent leg cannot be priced', () => {
    const swap = item({
      type: 'swap',
      amountIn: '100',
      tokenIn: 'UNKNOWN',
      amountOut: '108',
      tokenOut: 'USDC',
      amount: '100',
      tokenSymbol: 'UNKNOWN',
    })
    expect(getItemUsdcValue(swap, prices)).toBe(108)
  })

  it('sums both priced legs of a dual-token liquidity deposit', () => {
    const deposit = item({
      type: 'add_liquidity',
      amount: '100',
      tokenSymbol: 'USDC',
      amountB: '95',
      tokenB: 'EURC',
    })
    expect(getItemUsdcValue(deposit, prices)).toBeCloseTo(202.6, 6)
  })

  it('values harvest and x402 rows like any other USDC amount', () => {
    expect(getItemUsdcValue(item({ type: 'harvest', amount: '2.5', tokenSymbol: 'USDC' }), prices)).toBe(2.5)
    expect(getItemUsdcValue(item({ type: 'ai_service', amount: '0.05', tokenSymbol: 'USDC' }), prices)).toBe(0.05)
  })

  it('returns null for an asset with no price instead of assuming $1', () => {
    expect(getItemUsdcValue(item({ amount: '10', tokenSymbol: 'UNKNOWN' }), prices)).toBeNull()
    expect(getItemUsdcValue(item({ amount: '10', tokenSymbol: 'UNKNOWN' }), null)).toBeNull()
  })

  it('returns null for a malformed amount', () => {
    expect(getItemUsdcValue(item({ amount: 'not-a-number', tokenSymbol: 'USDC' }), prices)).toBeNull()
  })
})

describe('getItemRawAmount', () => {
  it('keeps the raw swap input amount', () => {
    expect(getItemRawAmount(item({ type: 'swap', amountIn: '10', amountOut: '9.9' }))).toBe(10)
  })

  it('sums both raw legs of an add-liquidity row', () => {
    expect(getItemRawAmount(item({ type: 'add_liquidity', amount: '100', amountB: '95' }))).toBe(195)
  })

  it('falls back to the amount field', () => {
    expect(getItemRawAmount(item({ type: 'bridge', amount: '500' }))).toBe(500)
  })
})
