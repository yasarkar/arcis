import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  poolSlippageBps,
  POOL_MAX_SLIPPAGE_BPS,
  POOL_MIN_SLIPPAGE_BPS,
  POOL_DEFAULT_SLIPPAGE_BPS,
} from '../../config/poolsConfig'

const poolsConfigSource = readFileSync(new URL('../../config/poolsConfig.ts', import.meta.url), 'utf8')
const poolsDataSource = readFileSync(new URL('../../hooks/usePoolsData.ts', import.meta.url), 'utf8')
const poolModalSource = readFileSync(new URL('../../components/pools/PoolActionModal.tsx', import.meta.url), 'utf8')
const swapModalSource = readFileSync(new URL('../../components/SwapModal.tsx', import.meta.url), 'utf8')

// Phase 1 remaining items: O3 (slippage cap) and 1.2 (on-chain-only 24h volume).

describe('O3 — slippage tolerance is clamped to a safe band', () => {
  it('caps any tolerance at 2% (200 bps), down from the old 10% ceiling', () => {
    expect(POOL_MAX_SLIPPAGE_BPS).toBe(200)
    expect(poolSlippageBps(2)).toBe(200)
    expect(poolSlippageBps(5)).toBe(200)
    expect(poolSlippageBps(50)).toBe(200)
    expect(poolSlippageBps(1.5)).toBe(150)
    expect(poolSlippageBps(0.5)).toBe(50)
  })

  it('floors tiny tolerances and falls back to the default for invalid input', () => {
    expect(POOL_MIN_SLIPPAGE_BPS).toBe(10)
    expect(poolSlippageBps(0.01)).toBe(10)
    expect(poolSlippageBps(0)).toBe(POOL_DEFAULT_SLIPPAGE_BPS)
    expect(poolSlippageBps(NaN)).toBe(POOL_DEFAULT_SLIPPAGE_BPS)
    expect(poolSlippageBps(Infinity)).toBe(POOL_DEFAULT_SLIPPAGE_BPS)
  })

  it('leaves no inline 10% clamp in the pool code', () => {
    expect(poolsDataSource).not.toMatch(/Math\.min\(1000/)
    expect(poolsConfigSource).not.toMatch(/Math\.min\(1000/)
  })

  it('the swap path derives its min-out guard from the shared clamp', () => {
    expect(poolsDataSource).toMatch(/BigInt\(poolSlippageBps\(slippageTolerance\)\)/)
  })
})

describe('1.2 — 24h volume has no localStorage fallback', () => {
  it('pool volume comes only from the on-chain rolling counters', () => {
    expect(poolsDataSource).not.toMatch(/Math\.max\(ssContract24h/)
    expect(poolsDataSource).not.toMatch(/Math\.max\(cpContract24h/)
    expect(poolsDataSource).not.toMatch(/eurcRollingVol/)
    expect(poolsDataSource).not.toMatch(/cirBtcRollingVol/)
    expect(poolsDataSource).not.toMatch(/getRollingClientSwapVolume/)
  })

  it('both AMM pools publish the on-chain 24h counter directly', () => {
    expect(poolsDataSource).toMatch(/volume24hUsd = ssContract24h/)
    expect(poolsDataSource).toMatch(/volume24hUsd = cpContract24h/)
  })

  it('the vault keeps zero trading volume (deposits are not swaps)', () => {
    expect(poolsDataSource).toMatch(/a yield vault has no trading volume/)
  })
})

describe('O3 — slippage UI matches the 2% execution cap', () => {
  it('the pool modal no longer offers a 5% custom tolerance', () => {
    expect(poolModalSource).not.toMatch(/max="5\.0"/)
    expect(poolModalSource).not.toMatch(/capped at 5\.0%/)
    expect(poolModalSource).toMatch(/POOL_MAX_SLIPPAGE_BPS/)
  })

  it('the swap modal no longer offers a 50% custom tolerance', () => {
    expect(swapModalSource).not.toMatch(/max="50"/)
    expect(swapModalSource).toMatch(/POOL_MAX_SLIPPAGE_BPS/)
  })
})
