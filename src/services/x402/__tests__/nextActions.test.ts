// src/services/x402/__tests__/nextActions.test.ts
// Pins the three first rules and the guard rails around them: a re-run keeps the inputs it was
// given, a stale report earns only a refresh, an unread subject earns no advisory action, and a
// recommendation is not offered after the measurement it rests on has expired.

import { describe, expect, it } from 'vitest'
import {
  buildRecommendations,
  isRecommendationExpired,
  recommendationsForReport,
  type BuildRecommendationsInput,
} from '../nextActions'
import { extractReportSignals } from '../reportSignals'
import {
  buildInstitutionalReport,
  institutionalRisk,
  type BuildInstitutionalReportInput,
  type InstitutionalRisk,
} from '../institutionalReport'
import type { NextActionRule } from '../../../config/x402/nextActions'

const AS_OF = Date.UTC(2026, 9, 22, 10, 0, 0)
const WALLET = '0x0000000000000000000000000000000000000001'

function risk(overrides: Partial<InstitutionalRisk> & { id: string }): InstitutionalRisk {
  return institutionalRisk({
    category: 'CONCENTRATION',
    severity: 'MEDIUM',
    title: `title ${overrides.id}`,
    finding: `finding ${overrides.id}`,
    evidence: { measured: 1 },
    threshold: 'threshold',
    remediation: 'remediation',
    ...overrides,
  })
}

function portfolioReport(
  overrides: Partial<BuildInstitutionalReportInput> = {}
) {
  return buildInstitutionalReport({
    kind: 'PORTFOLIO_EXPOSURE',
    serviceId: 'arc-portfolio-risk-exposure',
    title: 'Portfolio Risk & Exposure Report',
    subject: { type: 'WALLET', identifier: WALLET },
    issuedAt: AS_OF,
    asOf: AS_OF,
    coverage: { measuredReads: 6, expectedReads: 6 },
    risks: [],
    methodology: ['read balances'],
    limitations: ['no history'],
    ...overrides,
  })
}

function vaultPositionReport(
  overrides: Partial<BuildInstitutionalReportInput> = {}
) {
  return buildInstitutionalReport({
    kind: 'VAULT_POSITION',
    serviceId: 'arc-vault-yield-tax-report',
    title: 'Vault Yield & Tax Report',
    subject: { type: 'WALLET', identifier: WALLET },
    issuedAt: AS_OF,
    asOf: AS_OF,
    coverage: { measuredReads: 5, expectedReads: 5 },
    risks: [],
    methodology: ['read vault position'],
    limitations: ['no cost basis'],
    ...overrides,
  })
}

function run(
  report: ReturnType<typeof portfolioReport>,
  input: Omit<BuildRecommendationsInput, 'signals'> = {}
) {
  return buildRecommendations({ signals: extractReportSignals(report), ...input })
}

describe('gateway-scope-fallback', () => {
  const gatewayReport = portfolioReport({
    coverage: { measuredReads: 6, expectedReads: 7 },
    risks: [
      risk({
        id: 'GATEWAY_BALANCE_UNAVAILABLE',
        category: 'DATA_QUALITY',
        severity: 'MEDIUM',
        finding:
          'The Circle Gateway unified balance could not be read, so the unified total excludes whatever USDC is held there.',
      }),
    ],
  })

  it('re-runs the same service with the Gateway leg switched off and keeps the other inputs', () => {
    const [recommendation, ...rest] = run(gatewayReport, {
      requestParams: {
        'arc-portfolio-risk-exposure': { address: WALLET, includeGatewayBalance: true },
      },
      now: AS_OF,
    })

    expect(rest).toEqual([])
    expect(recommendation.ruleId).toBe('gateway-scope-fallback')
    expect(recommendation.tier).toBe('reparameterize')
    expect(recommendation.action.kind).toBe('rerun')
    expect(recommendation.action.serviceId).toBe('arc-portfolio-risk-exposure')
    expect(recommendation.action.params).toEqual({
      address: WALLET,
      includeGatewayBalance: false,
    })
    expect(recommendation.action.priceUsdc).toBe(0.004)
    expect(recommendation.action.serviceName).toBe('Portfolio Risk & Exposure Engine')
    expect(recommendation.triggerSignalIds).toEqual([
      'PORTFOLIO_EXPOSURE:GATEWAY_BALANCE_UNAVAILABLE',
    ])
    expect(recommendation.rationale).toContain('Gateway unified balance could not be read')
  })

  it('does not fire when the call never requested the Gateway leg', () => {
    expect(
      run(gatewayReport, {
        requestParams: {
          'arc-portfolio-risk-exposure': { address: WALLET, includeGatewayBalance: false },
        },
        now: AS_OF,
      })
    ).toEqual([])
  })

  it('does not fire without the observed request parameters', () => {
    expect(run(gatewayReport, { now: AS_OF })).toEqual([])
  })
})

describe('refresh-stale-report', () => {
  it('refreshes a stale measurement with the inputs it was given and no expiry', () => {
    const stale = vaultPositionReport({
      issuedAt: AS_OF,
      asOf: AS_OF - 900_000,
      risks: [risk({ id: 'PRINCIPAL_IMPAIRMENT', severity: 'HIGH', category: 'COMPOSITION' })],
    })

    const recommendations = run(stale, {
      requestParams: { 'arc-vault-yield-tax-report': { address: WALLET } },
      now: AS_OF,
    })

    expect(recommendations).toHaveLength(1)
    expect(recommendations[0].ruleId).toBe('refresh-stale-report')
    expect(recommendations[0].tier).toBe('reparameterize')
    expect(recommendations[0].action.kind).toBe('rerun')
    expect(recommendations[0].action.serviceId).toBe('arc-vault-yield-tax-report')
    expect(recommendations[0].action.params).toEqual({ address: WALLET })
    expect(recommendations[0].action.priceUsdc).toBe(0.012)
    expect(recommendations[0].expiresAt).toBeNull()
    // The impairment cross-check is withheld: it would inherit the stale figure.
    expect(recommendations.map((recommendation) => recommendation.ruleId)).not.toContain(
      'vault-impairment-cross-check'
    )
  })
})

describe('vault-impairment-cross-check', () => {
  it('points at the vault read rather than proposing an action on the shortfall', () => {
    const report = vaultPositionReport({
      risks: [
        risk({ id: 'PRINCIPAL_IMPAIRMENT', severity: 'HIGH', category: 'COMPOSITION' }),
      ],
    })

    const [recommendation] = run(report, { now: AS_OF })

    expect(recommendation.ruleId).toBe('vault-impairment-cross-check')
    expect(recommendation.tier).toBe('cross_check')
    expect(recommendation.action.kind).toBe('open_service')
    expect(recommendation.action.serviceId).toBe('arc-yield-vault-analytics')
    expect(recommendation.action.serviceName).toBe('USDC Yield Vault Analytics')
    expect(recommendation.action.params).toEqual({ windowDays: '30' })
    expect(recommendation.action.priceUsdc).toBe(0.002)
    expect(recommendation.severity).toBe('HIGH')
  })

  it('does not fire below the medium impairment threshold', () => {
    const report = vaultPositionReport()
    expect(run(report, { now: AS_OF })).toEqual([])

    const low = vaultPositionReport({
      risks: [risk({ id: 'PRINCIPAL_IMPAIRMENT', severity: 'LOW', category: 'COMPOSITION' })],
    })
    expect(run(low, { now: AS_OF })).toEqual([])
  })
})

describe('expiry', () => {
  it('drops a recommendation once the measurement leaves the freshness window', () => {
    const report = vaultPositionReport({
      risks: [
        risk({ id: 'PRINCIPAL_IMPAIRMENT', severity: 'HIGH', category: 'COMPOSITION' }),
      ],
    })

    expect(run(report, { now: AS_OF + 100_000 })).toHaveLength(1)

    const [expired] = run(report, { now: AS_OF })
    expect(expired.expiresAt).toBe(AS_OF + 300_000)
    expect(isRecommendationExpired(expired, AS_OF + 299_000)).toBe(false)
    expect(isRecommendationExpired(expired, AS_OF + 300_000)).toBe(true)
    expect(run(report, { now: AS_OF + 300_000 })).toEqual([])
  })
})

describe('recommendationsForReport', () => {
  it('derives a card from a report that was just returned, without a stored digest', () => {
    const report = portfolioReport({
      coverage: { measuredReads: 6, expectedReads: 7 },
      risks: [
        risk({
          id: 'GATEWAY_BALANCE_UNAVAILABLE',
          category: 'DATA_QUALITY',
          severity: 'MEDIUM',
          finding:
            'The Circle Gateway unified balance could not be read, so the unified total excludes whatever USDC is held there.',
        }),
      ],
    })

    const [recommendation] = recommendationsForReport(report, {
      serviceId: 'arc-portfolio-risk-exposure',
      requestParams: { address: WALLET, includeGatewayBalance: true },
      now: AS_OF,
    })

    expect(recommendation.ruleId).toBe('gateway-scope-fallback')
    expect(recommendation.action.params).toEqual({
      address: WALLET,
      includeGatewayBalance: false,
    })
    expect(recommendation.action.priceUsdc).toBe(0.004)
  })

  it('returns nothing when the payload carries no envelope', () => {
    expect(recommendationsForReport(null, { serviceId: 'arc-portfolio-risk-exposure' })).toEqual([])
    expect(
      recommendationsForReport({ totalUsd: 12 }, { serviceId: 'arc-portfolio-risk-exposure' })
    ).toEqual([])
  })
})

describe('guard rails', () => {
  const advisoryRule: NextActionRule = {
    id: 'synthetic-advisory',
    description: 'test-only rule',
    when: { signalId: 'PORTFOLIO_EXPOSURE:HIGH_CONCENTRATION' },
    then: {
      tier: 'advisory_action',
      action: 'open_service',
      serviceId: 'arc-yield-vault-analytics',
      params: { windowDays: '30' },
      title: 'Synthetic advisory',
    },
  }

  it('withholds an advisory action while the subject has an unread measurement', () => {
    const blocked = portfolioReport({
      coverage: { measuredReads: 5, expectedReads: 6 },
      risks: [
        risk({ id: 'BALANCE_READ_FAILED', severity: 'HIGH', category: 'DATA_QUALITY' }),
        risk({ id: 'HIGH_CONCENTRATION', severity: 'HIGH' }),
      ],
    })
    expect(
      buildRecommendations(
        { signals: extractReportSignals(blocked), now: AS_OF },
        [advisoryRule]
      )
    ).toEqual([])

    const clean = portfolioReport({
      risks: [risk({ id: 'HIGH_CONCENTRATION', severity: 'HIGH' })],
    })
    const allowed = buildRecommendations(
      { signals: extractReportSignals(clean), now: AS_OF },
      [advisoryRule]
    )
    expect(allowed).toHaveLength(1)
    expect(allowed[0].tier).toBe('advisory_action')
  })

  it('never personalises a network-level report', () => {
    const network = buildInstitutionalReport({
      kind: 'GATEWAY_FLOW',
      serviceId: 'arc-cross-chain-gateway-flow-indexer',
      title: 'Gateway Flow',
      subject: { type: 'NETWORK', identifier: 'Arc Testnet' },
      issuedAt: AS_OF,
      asOf: AS_OF,
      coverage: { measuredReads: 4, expectedReads: 4 },
      risks: [risk({ id: 'NET_LIQUIDITY_OUTFLOW', severity: 'MEDIUM' })],
      methodology: ['scan logs'],
      limitations: ['windowed'],
    })
    const rule: NextActionRule = {
      ...advisoryRule,
      id: 'synthetic-network-advisory',
      when: { signalId: 'GATEWAY_FLOW:NET_LIQUIDITY_OUTFLOW' },
    }

    expect(
      buildRecommendations({ signals: extractReportSignals(network), now: AS_OF }, [rule])
    ).toEqual([])
  })
})

describe('ordering and merge', () => {
  it('orders by severity, then by how directly the step follows, and honours the limit', () => {
    const report = vaultPositionReport({
      coverage: { measuredReads: 4, expectedReads: 5 },
      risks: [
        risk({ id: 'PRINCIPAL_IMPAIRMENT', severity: 'HIGH', category: 'COMPOSITION' }),
        risk({ id: 'NARRATIVE_UNAVAILABLE', severity: 'HIGH', category: 'DATA_QUALITY' }),
      ],
    })

    const all = run(report, { now: AS_OF })
    expect(all.map((recommendation) => recommendation.ruleId)).toEqual([
      'vault-impairment-cross-check',
    ])

    expect(run(report, { now: AS_OF, limit: 0 })).toEqual([])
  })

  it('merges the same step reached from two measurements of one subject', () => {
    const first = vaultPositionReport({
      issuedAt: AS_OF,
      asOf: AS_OF - 10_000,
      risks: [
        risk({ id: 'PRINCIPAL_IMPAIRMENT', severity: 'MEDIUM', category: 'COMPOSITION' }),
      ],
    })
    const second = vaultPositionReport({
      issuedAt: AS_OF,
      asOf: AS_OF,
      risks: [
        risk({ id: 'PRINCIPAL_IMPAIRMENT', severity: 'HIGH', category: 'COMPOSITION' }),
      ],
    })

    expect(first.reportId).not.toBe(second.reportId)

    const merged = buildRecommendations({
      signals: [...extractReportSignals(first), ...extractReportSignals(second)],
      now: AS_OF,
    })

    expect(merged).toHaveLength(1)
    expect(merged[0].severity).toBe('HIGH')
    expect(new Set(merged[0].reportIds)).toEqual(new Set([first.reportId, second.reportId]))
  })

  it('ignores a rule whose signal id is emitted by no report', () => {
    const report = portfolioReport()
    const deadRule: NextActionRule = {
      id: 'dead-rule',
      description: 'matches nothing',
      when: { signalId: 'PORTFOLIO_EXPOSURE:NOT_A_REAL_FINDING' },
      then: { tier: 'context', action: 'open_service', title: 'nothing' },
    }
    expect(
      buildRecommendations({ signals: extractReportSignals(report), now: AS_OF }, [deadRule])
    ).toEqual([])
  })
})
