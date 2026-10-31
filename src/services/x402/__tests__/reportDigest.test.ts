// src/services/x402/__tests__/reportDigest.test.ts
// Pins the per-wallet report memory: a digest is only taken from a real envelope of the service
// that was paid, one entry per service survives, a corrupt store reads as empty, and an aged
// digest earns a refresh rather than a follow-up.

import { describe, expect, it } from 'vitest'
import {
  MAX_DIGESTS_PER_WALLET,
  REPORT_DIGEST_SCHEMA,
  REPORT_DIGEST_STORE_SCHEMA,
  digestAgeSeconds,
  digestFromServiceCall,
  emptyReportDigestStore,
  formatDigestAge,
  mergeReportDigest,
  parseReportDigestStore,
  recommendationsFromDigests,
  type ReportDigest,
} from '../reportDigest'
import {
  buildInstitutionalReport,
  institutionalRisk,
  type BuildInstitutionalReportInput,
} from '../institutionalReport'

const AS_OF = Date.UTC(2026, 9, 22, 10, 0, 0)
const WALLET = '0x360049f5E86E2070f80B0F3Ac9443Bf38e78fC3A'

function portfolioReport(overrides: Partial<BuildInstitutionalReportInput> = {}) {
  return buildInstitutionalReport({
    kind: 'PORTFOLIO_EXPOSURE',
    serviceId: 'arc-portfolio-risk-exposure',
    title: 'Portfolio Risk & Exposure Report',
    subject: { type: 'WALLET', identifier: WALLET },
    issuedAt: AS_OF,
    asOf: AS_OF,
    coverage: { measuredReads: 6, expectedReads: 7 },
    risks: [
      institutionalRisk({
        id: 'GATEWAY_BALANCE_UNAVAILABLE',
        category: 'DATA_QUALITY',
        severity: 'MEDIUM',
        title: 'Circle Gateway balance was requested but not read',
        finding: 'The Circle Gateway unified balance could not be read.',
        evidence: { gatewayRequested: true },
        threshold: 'A unified total requires a successful Gateway balance read.',
        remediation: 'Retry, or call with includeGatewayBalance=false for an Arc-only total.',
      }),
    ],
    methodology: ['read balances'],
    limitations: ['no history'],
    ...overrides,
  })
}

function digestFor(
  serviceId: string,
  recordedAt: number,
  report = portfolioReport({ serviceId })
): ReportDigest {
  return {
    schema: REPORT_DIGEST_SCHEMA,
    serviceId,
    report,
    requestParams: { address: WALLET },
    payer: WALLET.toLowerCase(),
    recordedAt,
  }
}

describe('digestFromServiceCall', () => {
  it('takes the envelope from the paid response and keeps the observed parameters', () => {
    const report = portfolioReport()
    const digest = digestFromServiceCall({
      payer: WALLET,
      serviceId: 'arc-portfolio-risk-exposure',
      requestParams: { address: WALLET, includeGatewayBalance: true },
      data: { status: 'PARTIAL', report },
      recordedAt: AS_OF,
    })

    expect(digest).not.toBeNull()
    expect(digest?.schema).toBe(REPORT_DIGEST_SCHEMA)
    expect(digest?.payer).toBe(WALLET.toLowerCase())
    expect(digest?.recordedAt).toBe(AS_OF)
    expect(digest?.report.reportId).toBe(report.reportId)
    expect(digest?.requestParams).toEqual({ address: WALLET, includeGatewayBalance: true })
  })

  it('keeps only flat primitive parameters', () => {
    const digest = digestFromServiceCall({
      payer: WALLET,
      serviceId: 'arc-portfolio-risk-exposure',
      requestParams: {
        address: WALLET,
        includeGatewayBalance: false,
        nested: { not: 'a parameter' },
        list: [1, 2],
        long: 'x'.repeat(600),
      },
      data: { report: portfolioReport() },
      recordedAt: AS_OF,
    })

    expect(digest?.requestParams).toEqual({
      address: WALLET,
      includeGatewayBalance: false,
      long: 'x'.repeat(512),
    })
  })

  it('refuses data that is not an envelope, a foreign service id, or an unusable payer', () => {
    const base = {
      payer: WALLET,
      serviceId: 'arc-portfolio-risk-exposure',
      requestParams: {},
      data: { report: portfolioReport() },
      recordedAt: AS_OF,
    }

    expect(digestFromServiceCall({ ...base, data: {} })).toBeNull()
    expect(digestFromServiceCall({ ...base, data: { report: { reportId: 'x' } } })).toBeNull()
    expect(digestFromServiceCall({ ...base, payer: 'not-an-address' })).toBeNull()
    expect(
      digestFromServiceCall({ ...base, serviceId: 'arc-vault-yield-tax-report' })
    ).toBeNull()
  })
})

describe('mergeReportDigest', () => {
  it('keeps one entry per service, newest first', () => {
    const store = emptyReportDigestStore(WALLET)
    const first = mergeReportDigest(store, digestFor('arc-portfolio-risk-exposure', AS_OF - 60_000))
    const second = mergeReportDigest(
      first,
      digestFor('arc-vault-yield-tax-report', AS_OF, portfolioReport({ serviceId: 'arc-vault-yield-tax-report' }))
    )
    const refreshed = mergeReportDigest(
      second,
      digestFor('arc-portfolio-risk-exposure', AS_OF + 1_000)
    )

    expect(refreshed.digests.map((digest) => digest.serviceId)).toEqual([
      'arc-portfolio-risk-exposure',
      'arc-vault-yield-tax-report',
    ])
    expect(refreshed.digests[0].recordedAt).toBe(AS_OF + 1_000)
    expect(refreshed.updatedAt).toBe(AS_OF + 1_000)
  })

  it('caps the store at the configured entry count', () => {
    let store = emptyReportDigestStore(WALLET)
    for (let index = 0; index < MAX_DIGESTS_PER_WALLET + 2; index += 1) {
      store = mergeReportDigest(
        store,
        digestFor(`service-${index}`, AS_OF + index, portfolioReport({ serviceId: `service-${index}` }))
      )
    }
    expect(store.digests).toHaveLength(MAX_DIGESTS_PER_WALLET)
    expect(store.digests[0].serviceId).toBe(`service-${MAX_DIGESTS_PER_WALLET + 1}`)
  })
})

describe('parseReportDigestStore', () => {
  it('round-trips a stored payload', () => {
    const store = mergeReportDigest(emptyReportDigestStore(WALLET), digestFor('arc-portfolio-risk-exposure', AS_OF))
    const parsed = parseReportDigestStore(JSON.stringify(store), WALLET)

    expect(parsed.digests).toHaveLength(1)
    expect(parsed.digests[0].report.reportId).toBe(store.digests[0].report.reportId)
    expect(parsed.updatedAt).toBe(AS_OF)
  })

  it('reads as empty for corrupt, foreign or mistyped payloads', () => {
    expect(parseReportDigestStore(null, WALLET).digests).toEqual([])
    expect(parseReportDigestStore('not json', WALLET).digests).toEqual([])
    expect(
      parseReportDigestStore(JSON.stringify({ schema: 'other/v1', digests: [] }), WALLET).digests
    ).toEqual([])

    const store = mergeReportDigest(emptyReportDigestStore(WALLET), digestFor('arc-portfolio-risk-exposure', AS_OF))
    const foreign = parseReportDigestStore(JSON.stringify(store), '0x0000000000000000000000000000000000000002')
    expect(foreign.digests).toEqual([])
    expect(foreign.payer).toBe('0x0000000000000000000000000000000000000002')
  })

  it('drops a single invalid entry instead of the whole store', () => {
    const store = mergeReportDigest(emptyReportDigestStore(WALLET), digestFor('arc-portfolio-risk-exposure', AS_OF))
    const payload = {
      schema: REPORT_DIGEST_STORE_SCHEMA,
      payer: WALLET.toLowerCase(),
      updatedAt: AS_OF,
      digests: [...store.digests, { serviceId: 'broken' }],
    }

    expect(parseReportDigestStore(JSON.stringify(payload), WALLET).digests).toHaveLength(1)
  })
})

describe('digest age', () => {
  it('describes the age of a measurement without rounding it into a guess', () => {
    const report = portfolioReport()
    expect(digestAgeSeconds(report, AS_OF)).toBe(0)
    expect(digestAgeSeconds(report, AS_OF + 45_000)).toBe(45)
    expect(formatDigestAge(null)).toBe('age unknown')
    expect(formatDigestAge(0)).toBe('just now')
    expect(formatDigestAge(59)).toBe('just now')
    expect(formatDigestAge(60)).toBe('1m ago')
    expect(formatDigestAge(3_599)).toBe('59m ago')
    expect(formatDigestAge(3_600)).toBe('1h ago')
    expect(formatDigestAge(86_400)).toBe('1d ago')
  })
})

describe('recommendationsFromDigests', () => {
  it('derives the next step from what the wallet actually bought', () => {
    const digest = digestFor('arc-portfolio-risk-exposure', AS_OF)
    digest.requestParams = { address: WALLET, includeGatewayBalance: true }

    const [recommendation] = recommendationsFromDigests([digest], { now: AS_OF })

    expect(recommendation.ruleId).toBe('gateway-scope-fallback')
    expect(recommendation.action.params).toEqual({
      address: WALLET,
      includeGatewayBalance: false,
    })
  })

  it('ages a stored report at read time and offers only a refresh', () => {
    const digest = digestFor('arc-portfolio-risk-exposure', AS_OF)
    const later = AS_OF + 86_400_000

    const recommendations = recommendationsFromDigests([digest], { now: later })

    expect(recommendations).toHaveLength(1)
    expect(recommendations[0].ruleId).toBe('refresh-stale-report')
    expect(recommendations[0].expiresAt).toBeNull()
    expect(recommendations[0].rationale).toContain('86400s old')
  })

  it('offers nothing for an empty store and respects the card limit', () => {
    expect(recommendationsFromDigests([], { now: AS_OF })).toEqual([])

    const digest = digestFor('arc-portfolio-risk-exposure', AS_OF)
    digest.requestParams = { includeGatewayBalance: true }
    expect(recommendationsFromDigests([digest], { now: AS_OF, limit: 0 })).toEqual([])
  })
})
