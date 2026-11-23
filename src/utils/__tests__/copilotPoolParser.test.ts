// src/utils/__tests__/copilotPoolParser.test.ts
import { describe, expect, it } from 'vitest'
import {
  COPILOT_LP_POOLS,
  findCopilotLpPoolByPair,
  getCopilotLpPoolById,
  isLpPoolPrompt,
  parseCopilotLpAmounts,
  resolveCopilotLpPoolFromPrompt,
} from '../copilotPoolParser'
import { computeMinLpShares } from '../../services/pools/poolUtils'

describe('copilotPoolParser — pool resolution', () => {
  it('exposes all 6 live Arc AMM LP pools', () => {
    expect(COPILOT_LP_POOLS.map((p) => p.id)).toEqual([
      'usdc-eurc-stable-pool',
      'usdc-cirbtc-pool',
      'usdc-weth-pool',
      'eurc-weth-pool',
      'eurc-cirbtc-pool',
      'cirbtc-weth-pool',
    ])
  })

  it.each([
    ['Zap 50 USDC into USDC/EURC pool', 'usdc-eurc-stable-pool'],
    ['EURC/USDC havuzuna 100 USDC yatır', 'usdc-eurc-stable-pool'],
    ['stableswap havuzuna 25 USDC ekle', 'usdc-eurc-stable-pool'],
    ['Add 50 USDC to USDC/cirBTC pool', 'usdc-cirbtc-pool'],
    ['USDC-WETH havuzuna 100 USDC yatır', 'usdc-weth-pool'],
    ['EURC/WETH havuzuna 100 EURC ekle', 'eurc-weth-pool'],
    ['Add 200 EURC and 0.003 cirBTC to EURC/cirBTC pool', 'eurc-cirbtc-pool'],
    ['cirBTC/WETH havuzuna 0.01 cirBTC ekle', 'cirbtc-weth-pool'],
    ['deposit 50 USDC into usdc-weth-pool', 'usdc-weth-pool'],
  ])('resolves "%s" to %s', (prompt, expectedId) => {
    const res = resolveCopilotLpPoolFromPrompt(prompt)
    expect(res.status).toBe('matched')
    if (res.status === 'matched') {
      expect(res.pool.id).toBe(expectedId)
    }
  })

  it('refuses plain BTC/WBTC pool references with WBTC guidance instead of silently mapping to cirBTC', () => {
    const res1 = resolveCopilotLpPoolFromPrompt('USDC/WBTC havuzuna 50 USDC yatır')
    expect(res1.status).toBe('unsupported_wbtc')
    const res2 = resolveCopilotLpPoolFromPrompt('Add 50 USDC to USDC/BTC pool')
    expect(res2.status).toBe('unsupported_wbtc')
  })

  it('matches pairs regardless of token order', () => {
    expect(findCopilotLpPoolByPair('WETH', 'cirBTC')?.id).toBe('cirbtc-weth-pool')
    expect(findCopilotLpPoolByPair('EURC', 'USDC')?.id).toBe('usdc-eurc-stable-pool')
  })
})

describe('copilotPoolParser — LP vs Vault disambiguation', () => {
  it('identifies LP pool prompts accurately', () => {
    expect(isLpPoolPrompt('USDC/EURC havuzuna 100 USDC yatır')).toBe(true)
    expect(isLpPoolPrompt('Zap 25 USDC into USDC/WETH pool')).toBe(true)
    expect(isLpPoolPrompt('EURC/cirBTC havuzuna 50 EURC ekle')).toBe(true)
    expect(isLpPoolPrompt('Add liquidity 10 USDC to pool')).toBe(true)
  })

  it('keeps plain Vault deposit prompts out of LP routing', () => {
    expect(isLpPoolPrompt('deposit 100 USDC')).toBe(false)
    expect(isLpPoolPrompt('deposit 100 USDC into yield vault')).toBe(false)
    expect(isLpPoolPrompt('kasaya 50 USDC yatır')).toBe(false)
    expect(isLpPoolPrompt('100 USDC yatır')).toBe(false)
  })
})

describe('copilotPoolParser — amount & mode parsing', () => {
  const usdcEurc = getCopilotLpPoolById('usdc-eurc-stable-pool')!
  const eurcWeth = getCopilotLpPoolById('eurc-weth-pool')!
  const cirBtcWeth = getCopilotLpPoolById('cirbtc-weth-pool')!

  it('selects 1-Click Zap for a single USDC amount on a Zap-enabled pool', () => {
    const parsed = parseCopilotLpAmounts('USDC/EURC havuzuna 100 USDC yatır', usdcEurc)
    expect(parsed).toEqual({
      status: 'valid',
      mode: 'zap',
      amountA: 100,
      amountADecimal: '100',
      autoMatchCounter: false,
      anchorSide: 'A',
    })
  })

  it('selects Dual-Asset with explicit amounts when both tokens are supplied (any order)', () => {
    const parsed = parseCopilotLpAmounts('USDC/EURC havuzuna 46 EURC ve 50 USDC yatır', usdcEurc)
    expect(parsed).toEqual({
      status: 'valid',
      mode: 'dual',
      amountA: 50,
      amountB: 46,
      amountADecimal: '50',
      amountBDecimal: '46',
      autoMatchCounter: false,
    })
  })

  it('selects Dual-Asset with auto-match when one token is supplied on a cross-pair pool', () => {
    const parsedA = parseCopilotLpAmounts('EURC/WETH havuzuna 100 EURC ekle', eurcWeth)
    expect(parsedA).toEqual({
      status: 'valid',
      mode: 'dual',
      amountA: 100,
      amountADecimal: '100',
      autoMatchCounter: true,
      anchorSide: 'A',
    })

    const parsedB = parseCopilotLpAmounts('EURC/WETH havuzuna 0.05 WETH ekle', eurcWeth)
    expect(parsedB).toEqual({
      status: 'valid',
      mode: 'dual',
      amountB: 0.05,
      amountBDecimal: '0.05',
      autoMatchCounter: true,
      anchorSide: 'B',
    })
  })

  it('rejects explicit Zap on cross-pair pools that do not support Zap', () => {
    const parsed = parseCopilotLpAmounts('Zap 100 EURC into EURC/WETH pool', eurcWeth)
    expect(parsed.status).toBe('error')
    if (parsed.status === 'error') {
      expect(parsed.message).toContain('1-Click Zap is not available')
    }
  })

  it('rejects ambiguous locale separators and over-precision amounts fail-closed', () => {
    expect(parseCopilotLpAmounts('Zap 1.000 USDC into USDC/EURC pool', usdcEurc).status).toBe('error')
    expect(parseCopilotLpAmounts('Zap 1,000 USDC into USDC/EURC pool', usdcEurc).status).toBe('error')
    expect(parseCopilotLpAmounts('Zap 1 000 USDC into USDC/EURC pool', usdcEurc).status).toBe('error')
    expect(parseCopilotLpAmounts('Zap 1.0000001 USDC into USDC/EURC pool', usdcEurc).status).toBe('error')
  })

  it('computes minLpShares accurately for 8-decimal tokenA on cirBTC/WETH pool', () => {
    const poolState = {
      [cirBtcWeth.contractAddress]: {
        reserveA: '1.0', // 1 cirBTC (8 decimals)
        reserveB: '25.0', // 25 WETH (18 decimals)
        totalLp: '1000', // 1000 LP (18 decimals)
      },
    }
    // Deposit 0.1 cirBTC (10_000_000 raw) + 2.5 WETH (2.5e18 raw) → 10% of pool = 100 LP, minus 0.5% slippage = 99.5 LP
    const minLp = computeMinLpShares(
      cirBtcWeth,
      cirBtcWeth.contractAddress,
      poolState,
      10_000_000n,
      2_500_000_000_000_000_000n,
      18,
      0.5
    )
    expect(minLp).toBe(99_500_000_000_000_000_000n)
  })
})
