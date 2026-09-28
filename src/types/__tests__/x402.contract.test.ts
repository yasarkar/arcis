// src/types/__tests__/x402.contract.test.ts
// Architectural contract and invariant verification for x402 AI Services

import { describe, it, expect } from 'vitest'
import { OFFICIAL_MANIFESTS } from '../../config/x402/manifests'
import { calculateFeeSplit, usdcToBaseUnits, baseUnitsToUsdc } from '../../config/x402/pricing'
import { DEFAULT_X402_DOMAIN, X402_SCHEMES, X402_NETWORKS } from '../../config/x402/schemes'
import { SERVICE_CATEGORIES, ALL_CATEGORY_LABELS } from '../../config/x402/categories'

describe('x402 Architectural Contracts & Manifest Integrity', () => {
  it('contains all 5 official manifests with valid v2 structure', () => {
    expect(OFFICIAL_MANIFESTS.length).toBe(5)
    
    for (const manifest of OFFICIAL_MANIFESTS) {
      // Identity & Version
      expect(manifest.id).toMatch(/^arc-[a-z0-9-]+$/)
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(manifest.name).toBeTruthy()
      expect(manifest.tagline).toBeTruthy()
      expect(manifest.description).toBeTruthy()

      // Engine transparency
      expect(['native', 'llm', 'proxy']).toContain(manifest.engine)
      expect(manifest.engine).toBe('native') // All 5 official services are native deterministic algorithms

      // Listing & Provider
      expect(manifest.listing.kind).toBe('official')
      expect(manifest.listing.ownerAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(manifest.provider.address).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(manifest.provider.isVerified).toBe(true)

      // Invariant I7: Pricing is single source of truth and positive
      expect(manifest.pricing).toBeDefined()
      expect(manifest.pricing.model).toBe('per_call')
      expect(manifest.pricing.priceUsdc).toBeGreaterThan(0)
      expect(manifest.pricing.maxAmountUsdc).toBeGreaterThanOrEqual(manifest.pricing.priceUsdc)

      // Payment Acceptance (Circle Gateway & Arc Testnet compatible)
      expect(manifest.accepts.length).toBeGreaterThan(0)
      for (const accept of manifest.accepts) {
        expect(accept.scheme).toBe(X402_SCHEMES.EXACT)
        expect(accept.asset).toBe('USDC')
        expect(accept.network).toBe(X402_NETWORKS.ARC_TESTNET)
        expect(accept.payTo).toMatch(/^0x[a-fA-F0-9]{40}$/)
        if (accept.domain) {
          expect(accept.domain.chainId).toBe(5042002)
          expect(accept.domain.name).toBe('USD Coin')
        }
      }

      // Serve endpoint
      expect(['GET', 'POST']).toContain(manifest.serve.method)
      expect(manifest.serve.path).toMatch(/^\/api\/x402\//)

      // Request schema & UI Form
      expect(manifest.requestSchema).toBeDefined()
      expect(manifest.ui.form).toBeDefined()
      expect(Array.isArray(manifest.ui.form)).toBe(true)

      // SLA & Telemetry
      expect(manifest.sla.p95LatencyMs).toBeGreaterThan(0)
      expect(manifest.sla.uptimePct).toBeGreaterThanOrEqual(99.0)
      expect(manifest.sla.successRate).toBeGreaterThanOrEqual(99.0)

      // Examples
      expect(manifest.examples.request).toBeDefined()
      expect(manifest.examples.response).toBeDefined()
    }
  })

  it('validates ServiceCategory definitions and metadata coverage', () => {
    expect(SERVICE_CATEGORIES.length).toBeGreaterThanOrEqual(10)
    expect(ALL_CATEGORY_LABELS).toContain('All')
    
    // Ensure all 5 official manifests belong to registered categories
    const categoryIds = SERVICE_CATEGORIES.map((c) => c.id)
    for (const manifest of OFFICIAL_MANIFESTS) {
      expect(categoryIds).toContain(manifest.category)
    }
  })

  describe('Invariant I1 & Pricing/Fee Integrity', () => {
    it('splits exactly 1% to YieldVault and 99% to provider by default', () => {
      const split = calculateFeeSplit(0.005) // 0.005 USDC call
      expect(split.grossAmountUsdc).toBe(0.005)
      expect(split.protocolFeeUsdc).toBe(0.00005) // 1%
      expect(split.providerEarnedUsdc).toBe(0.00495) // 99%
      expect(split.protocolFeeBps).toBe(100)
    })

    it('supports custom protocolFeeBps', () => {
      const splitZero = calculateFeeSplit(0.01, 0) // 0%
      expect(splitZero.protocolFeeUsdc).toBe(0)
      expect(splitZero.providerEarnedUsdc).toBe(0.01)

      const splitTwoPct = calculateFeeSplit(0.01, 200) // 2%
      expect(splitTwoPct.protocolFeeUsdc).toBe(0.0002)
      expect(splitTwoPct.providerEarnedUsdc).toBe(0.0098)
    })

    it('correctly converts between USDC decimals and 6-decimal base units', () => {
      expect(usdcToBaseUnits(0.005)).toBe('5000')
      expect(baseUnitsToUsdc('5000')).toBe(0.005)
      expect(usdcToBaseUnits(1.50)).toBe('1500000')
      expect(baseUnitsToUsdc('1500000')).toBe(1.5)
    })

    it('enforces Invariant I1: authorizedMaxUsdc is always >= priceUsdc', () => {
      for (const manifest of OFFICIAL_MANIFESTS) {
        expect(manifest.pricing.maxAmountUsdc).toBeGreaterThanOrEqual(manifest.pricing.priceUsdc)
      }
    })
  })

  describe('EIP-3009 Domain Specification', () => {
    it('provides valid Arc Testnet USDC EIP-712 domain configuration', () => {
      expect(DEFAULT_X402_DOMAIN.name).toBe('USD Coin')
      expect(DEFAULT_X402_DOMAIN.version).toBe('2')
      expect(DEFAULT_X402_DOMAIN.chainId).toBe(5042002)
      expect(DEFAULT_X402_DOMAIN.verifyingContract).toMatch(/^0x[a-fA-F0-9]{40}$/)
    })
  })
})
