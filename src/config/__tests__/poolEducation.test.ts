import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  POOL_EDUCATION,
  impermanentLossExplainer,
  apySourceExplainer,
  feeAccrualExplainer,
} from '../poolEducation'

const poolCardSource = readFileSync(new URL('../../components/pools/PoolCard.tsx', import.meta.url), 'utf8')

// Phase 1.5 — the education layer must explain impermanent loss, fee accrual, and the
// real-vs-estimated split without over-promising.

describe('Phase 1.5 — pool education layer', () => {
  describe('impermanent loss', () => {
    it('gives risk-specific copy for every defined band', () => {
      expect(impermanentLossExplainer('Zero (Stable)')).toContain('impermanent loss is')
      expect(impermanentLossExplainer('Low')).toContain('impermanent loss')
      expect(impermanentLossExplainer('Medium')).toContain('impermanent loss')
    })

    it('never presents fees as removing IL risk', () => {
      expect(POOL_EDUCATION.impermanentLoss['Medium']).toMatch(/do not remove it/)
      expect(POOL_EDUCATION.impermanentLoss['Low']).toMatch(/not a guarantee/)
    })

    it('falls back to honest generic copy for unknown or missing risk bands', () => {
      const fallback = impermanentLossExplainer(undefined)
      expect(fallback).toContain('underperform')
      expect(impermanentLossExplainer('Unknown')).toBe(fallback)
    })
  })

  describe('fee accrual', () => {
    it('explains that fees accrue outside reserves and are harvested, not auto-compounded', () => {
      const copy = feeAccrualExplainer()
      expect(copy).toContain('pendingFees(lp)')
      expect(copy).toContain('Harvest')
      expect(copy).toMatch(/never burns your LP principal/)
    })

    it('names both real fee tiers', () => {
      const copy = feeAccrualExplainer()
      expect(copy).toContain('0.12%')
      expect(copy).toContain('0.25%')
    })
  })

  describe('real vs estimated APY', () => {
    it('labels the incentive component as an estimate and not guaranteed', () => {
      const copy = apySourceExplainer('APY')
      expect(copy).toMatch(/actually paid on chain are real/)
      expect(copy).toMatch(/not guaranteed/)
    })

    it('preserves the pool-supplied APY kind', () => {
      expect(apySourceExplainer('APY')).toContain('APY can combine')
      expect(apySourceExplainer('')).toContain('APY can combine')
    })
  })

  describe('UI wiring', () => {
    it('PoolCard surfaces all three explainers as tooltips', () => {
      expect(poolCardSource).toMatch(/impermanentLossExplainer\(pool\.impermanentLossRisk\)/)
      expect(poolCardSource).toMatch(/apySourceExplainer\(pool\.apyType\)/)
      expect(poolCardSource).toMatch(/feeAccrualExplainer\(\)/)
    })
  })
})
