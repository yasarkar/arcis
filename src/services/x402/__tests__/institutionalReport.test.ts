// src/services/x402/__tests__/institutionalReport.test.ts
// Pins the shared institutional envelope: coverage grading, deterministic identity, graded
// register ordering, freshness, and the Gateway flow payload that now carries it.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REPORT_DISCLAIMER,
  INSTITUTIONAL_REPORT_SCHEMA,
  buildInstitutionalReport,
  formatInstitutionalReportHeader,
  formatRiskRegisterLines,
  gradeForCoverage,
  institutionalRisk,
  reportIdFor,
  type InstitutionalRisk,
} from '../institutionalReport'
import {
  buildGatewayFlowServiceData,
  formatGatewayFlowReport,
  type GatewayFlowRead,
} from '../../gatewayFlowIndexer'

const AS_OF = Date.UTC(2026, 9, 22, 10, 0, 0)

function risk(id: string, severity: InstitutionalRisk['severity']): InstitutionalRisk {
  return institutionalRisk({
    id,
    category: 'DATA_QUALITY',
    severity,
    title: `title ${id}`,
    finding: `finding ${id}`,
    evidence: { measured: 1 },
    threshold: null,
    remediation: 'nothing to do',
  })
}

const baseInput = {
  kind: 'PORTFOLIO_EXPOSURE' as const,
  serviceId: 'arc-portfolio-risk-exposure',
  title: 'Portfolio Risk & Exposure Report',
  subject: { type: 'WALLET' as const, identifier: '0x0000000000000000000000000000000000000001' },
  issuedAt: AS_OF,
  asOf: AS_OF,
  coverage: { measuredReads: 6, expectedReads: 6 },
  risks: [] as InstitutionalRisk[],
  methodology: ['read balances'],
  limitations: ['no history'],
}

describe('gradeForCoverage', () => {
  it('grades on read coverage alone', () => {
    expect(gradeForCoverage({ measuredReads: 11, expectedReads: 11 }).grade).toBe('A')
    expect(gradeForCoverage({ measuredReads: 10, expectedReads: 11 }).grade).toBe('B')
    expect(gradeForCoverage({ measuredReads: 7, expectedReads: 11 }).grade).toBe('C')
    expect(gradeForCoverage({ measuredReads: 5, expectedReads: 11 }).grade).toBe('D')
  })

  it('issues no grade when nothing was measured or nothing was declared', () => {
    const nothingRead = gradeForCoverage({ measuredReads: 0, expectedReads: 9 })
    expect(nothingRead.grade).toBe('UNRATED')
    expect(nothingRead.rationale).toContain('None of the 9 planned reads returned')

    const nothingDeclared = gradeForCoverage({ measuredReads: 0, expectedReads: 0 })
    expect(nothingDeclared.grade).toBe('UNRATED')
    expect(nothingDeclared.rationale).toContain('No planned read was declared')
  })

  it('never grades above the measured count when a caller overstates coverage', () => {
    const capped = gradeForCoverage({ measuredReads: 99, expectedReads: 2 })
    expect(capped.grade).toBe('A')
    expect(capped.rationale).toContain('2 of 2 planned reads returned')
  })
})

describe('buildInstitutionalReport', () => {
  it('stamps the schema, identity and a disclosure on every envelope', () => {
    const report = buildInstitutionalReport(baseInput)

    expect(report.schema).toBe(INSTITUTIONAL_REPORT_SCHEMA)
    expect(report.reportId).toMatch(/^ARX-PRX-20261022-[0-9A-F]{8}$/)
    expect(report.serviceId).toBe('arc-portfolio-risk-exposure')
    expect(report.issuedAt).toBe('2026-10-22T10:00:00.000Z')
    expect(report.asOf).toBe('2026-10-22T10:00:00.000Z')
    expect(report.coverage).toEqual({
      measuredReads: 6,
      expectedReads: 6,
      coveragePct: 100,
      state: 'COMPLETE',
    })
    expect(report.dataQuality.grade).toBe('A')
    expect(report.disclosure).toEqual({
      readOnly: true,
      advisoryOnly: true,
      notInvestmentAdvice: true,
      disclaimer: DEFAULT_REPORT_DISCLAIMER,
    })
  })

  it('keeps the report id stable for the same measurement and distinct across subjects', () => {
    const first = buildInstitutionalReport(baseInput)
    const second = buildInstitutionalReport({
      ...baseInput,
      methodology: ['different wording does not change identity'],
    })
    expect(second.reportId).toBe(first.reportId)

    const otherSubject = buildInstitutionalReport({
      ...baseInput,
      subject: { type: 'WALLET', identifier: '0x0000000000000000000000000000000000000002' },
    })
    expect(otherSubject.reportId).not.toBe(first.reportId)

    // A changed severity is a different report, not the same one re-labelled.
    const escalated = buildInstitutionalReport({ ...baseInput, risks: [risk('A', 'HIGH')] })
    expect(escalated.reportId).not.toBe(first.reportId)
  })

  it('grades a partial read as partial coverage without lowering the grade of a complete one', () => {
    const report = buildInstitutionalReport({
      ...baseInput,
      coverage: { measuredReads: 5, expectedReads: 6 },
    })
    expect(report.coverage.state).toBe('PARTIAL')
    expect(report.coverage.coveragePct).toBe(83.33)
    expect(report.dataQuality.grade).toBe('C')

    const unread = buildInstitutionalReport({
      ...baseInput,
      coverage: { measuredReads: 0, expectedReads: 6 },
    })
    expect(unread.coverage.state).toBe('INSUFFICIENT')
    expect(unread.dataQuality.grade).toBe('UNRATED')
  })

  it('orders the register by severity and reports the highest one', () => {
    const report = buildInstitutionalReport({
      ...baseInput,
      risks: [risk('LOW_ONE', 'LOW'), risk('INFO_ONE', 'INFO'), risk('CRITICAL_ONE', 'CRITICAL')],
    })

    expect(report.riskRegister.map((entry) => entry.id)).toEqual([
      'CRITICAL_ONE',
      'LOW_ONE',
      'INFO_ONE',
    ])
    expect(report.riskSummary.highestSeverity).toBe('CRITICAL')
    expect(report.riskSummary.counts).toEqual({ CRITICAL: 1, HIGH: 0, MEDIUM: 0, LOW: 1, INFO: 1 })
    // The register never silently becomes empty-handed: every entry is advisory only.
    expect(report.riskRegister.every((entry) => entry.advisoryOnly)).toBe(true)
  })

  it('derives freshness from the read time and never claims currency without one', () => {
    const fresh = buildInstitutionalReport(baseInput)
    expect(fresh.freshness).toEqual({ state: 'CURRENT', ageSeconds: 0 })

    const old = buildInstitutionalReport({ ...baseInput, issuedAt: AS_OF + 600_000 })
    expect(old.freshness.state).toBe('STALE')
    expect(old.freshness.ageSeconds).toBe(600)

    const unknown = buildInstitutionalReport({ ...baseInput, asOf: null })
    expect(unknown.asOf).toBeNull()
    expect(unknown.freshness).toEqual({ state: 'UNKNOWN', ageSeconds: null })

    const overridden = buildInstitutionalReport({
      ...baseInput,
      freshness: { state: 'STALE', ageSeconds: 42 },
    })
    expect(overridden.freshness).toEqual({ state: 'STALE', ageSeconds: 42 })
  })

  it('copies methodology and limitations so later mutation cannot rewrite a served report', () => {
    const methodology = ['one']
    const limitations = ['two']
    const report = buildInstitutionalReport({ ...baseInput, methodology, limitations })
    methodology.push('three')
    limitations.push('four')

    expect(report.methodology).toEqual(['one'])
    expect(report.limitations).toEqual(['two'])
  })

  it('keeps the id independent of a decorative title', () => {
    const renamed = buildInstitutionalReport({ ...baseInput, title: 'Renamed Report' })
    expect(renamed.reportId).toBe(buildInstitutionalReport(baseInput).reportId)
    expect(reportIdFor({
      kind: baseInput.kind,
      subject: baseInput.subject,
      asOf: '2026-10-22T10:00:00.000Z',
      coverage: baseInput.coverage,
      risks: [],
    })).toBe(renamed.reportId)
  })
})

describe('formatInstitutionalReportHeader / formatRiskRegisterLines', () => {
  it('renders nothing for a payload that predates the envelope', () => {
    expect(formatInstitutionalReportHeader(null)).toBe('')
    expect(formatInstitutionalReportHeader({ status: 'LIVE' })).toBe('')
    expect(formatRiskRegisterLines({ status: 'LIVE' })).toEqual([])
  })

  it('states identity, grade, coverage, freshness and the finding count', () => {
    const report = buildInstitutionalReport({
      ...baseInput,
      coverage: { measuredReads: 5, expectedReads: 6 },
      risks: [risk('ONE', 'HIGH')],
    })
    const header = formatInstitutionalReportHeader(report)

    expect(header).toContain(report.reportId)
    expect(header).toContain('C · 5/6 reads (83.33%)')
    expect(header).toContain('CURRENT')
    expect(header).toContain('highest severity HIGH')
  })

  it('prints each finding with its severity, evidence and action', () => {
    const report = buildInstitutionalReport({ ...baseInput, risks: [risk('ONE', 'HIGH')] })
    const lines = formatRiskRegisterLines(report)

    expect(lines[0]).toContain('Risk register')
    expect(lines.join('\n')).toContain('[HIGH] title ONE — finding ONE')
    expect(lines.join('\n')).toContain('Evidence: measured: 1')
    expect(lines.join('\n')).toContain('Action: nothing to do')
  })
})

// ── The Gateway flow agent's envelope ────────────────────────────────────────────────────────

const flowRead = (overrides: Partial<GatewayFlowRead>): GatewayFlowRead => ({
  status: 'LIVE',
  source: 'Circle Gateway contracts on Arc L1',
  readAt: '2026-10-22T10:00:00.000Z',
  ageSeconds: 0,
  timeWindow: '1h',
  requestedWindowSeconds: 3_600,
  grossInflowUsdc: 10,
  grossOutflowUsdc: 0,
  netInflowUsdc: 10,
  transferCount: 1,
  whaleTransferCount: 0,
  topSourceChains: [{ chain: 'Ethereum Sepolia', domain: 0, inflowUsdc: 10, sharePct: 100 }],
  flowDirection: 'INFLOW',
  window: {
    fromBlock: 1,
    toBlock: 1_000,
    scannedBlocks: 1_000,
    requestedSeconds: 3_600,
    secondsPerBlock: 0.5,
    coveredSeconds: 500,
    partialWindow: false,
  },
  ...overrides,
})

describe('gateway flow institutional envelope', () => {
  it('grades a failed scan as unread, not as a zero-flow window', () => {
    const payload = buildGatewayFlowServiceData(
      flowRead({
        status: 'UNAVAILABLE',
        grossInflowUsdc: null,
        grossOutflowUsdc: null,
        netInflowUsdc: null,
        transferCount: null,
        whaleTransferCount: null,
        topSourceChains: null,
        flowDirection: null,
        window: null,
        error: 'rpc timeout',
      })
    )

    expect(payload.report.reportId).toMatch(/^ARX-GFI-/)
    expect(payload.report.coverage).toEqual({
      measuredReads: 0,
      expectedReads: 2,
      coveragePct: 0,
      state: 'INSUFFICIENT',
    })
    expect(payload.report.dataQuality.grade).toBe('UNRATED')
    expect(payload.report.riskRegister.map((entry: any) => entry.id)).toContain('GATEWAY_FLOW_READ_FAILED')
    expect(payload.report.freshness.state).toBe('UNKNOWN')
    expect(payload.limitations.length).toBeGreaterThan(0)
  })

  it('keeps a full measurement when it is served stale and grades the staleness separately', () => {
    const payload = buildGatewayFlowServiceData(
      flowRead({ status: 'STALE', ageSeconds: 240, error: 'rpc timeout' })
    )

    expect(payload.report.coverage.state).toBe('COMPLETE')
    expect(payload.report.dataQuality.grade).toBe('A')
    expect(payload.report.freshness).toEqual({ state: 'STALE', ageSeconds: 240 })
    const stale = payload.report.riskRegister.find((entry: any) => entry.id === 'GATEWAY_FLOW_STALE')
    expect(stale.severity).toBe('MEDIUM')
    expect(stale.evidence.ageSeconds).toBe(240)
  })

  it('surfaces window truncation, outflow direction and single-source concentration as graded findings', () => {
    const payload = buildGatewayFlowServiceData(
      flowRead({
        grossInflowUsdc: 100,
        grossOutflowUsdc: 40,
        netInflowUsdc: -60,
        transferCount: 3,
        flowDirection: 'OUTFLOW',
        topSourceChains: [
          { chain: 'Base Sepolia', domain: 6, inflowUsdc: 90, sharePct: 90 },
          { chain: 'Ethereum Sepolia', domain: 0, inflowUsdc: 10, sharePct: 10 },
        ],
        window: {
          fromBlock: 1,
          toBlock: 50_000,
          scannedBlocks: 50_000,
          requestedSeconds: 86_400,
          secondsPerBlock: 0.51,
          coveredSeconds: 25_500,
          partialWindow: true,
        },
      })
    )

    const ids = payload.report.riskRegister.map((entry: any) => entry.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'WINDOW_COVERAGE_PARTIAL',
        'NET_LIQUIDITY_OUTFLOW',
        'SINGLE_SOURCE_CONCENTRATION',
      ])
    )
    // Sorted most severe first: the truncated window (MEDIUM) outranks the two LOW findings.
    expect(payload.report.riskRegister[0].id).toBe('WINDOW_COVERAGE_PARTIAL')
    expect(payload.report.riskSummary.highestSeverity).toBe('MEDIUM')

    const outflow = payload.report.riskRegister.find((entry: any) => entry.id === 'NET_LIQUIDITY_OUTFLOW')
    expect(outflow.finding).toContain('60 USDC')

    const concentration = payload.report.riskRegister.find(
      (entry: any) => entry.id === 'SINGLE_SOURCE_CONCENTRATION'
    )
    expect(concentration.finding).toContain('90%')
  })

  it('reports a genuinely quiet window as a measured zero, not as unavailability', () => {
    const payload = buildGatewayFlowServiceData(
      flowRead({
        grossInflowUsdc: 0,
        grossOutflowUsdc: 0,
        netInflowUsdc: 0,
        transferCount: 0,
        topSourceChains: [],
        flowDirection: 'BALANCED',
      })
    )

    expect(payload.report.coverage.state).toBe('COMPLETE')
    const quiet = payload.report.riskRegister.find((entry: any) => entry.id === 'NO_GATEWAY_ACTIVITY')
    expect(quiet.severity).toBe('INFO')
  })

  it('prints the envelope and the register into the chat report', () => {
    const payload = buildGatewayFlowServiceData(flowRead({ status: 'STALE', ageSeconds: 120, error: 'rpc' }))
    const report = formatGatewayFlowReport(payload)

    expect(report).toContain(payload.report.reportId)
    expect(report).toContain('Risk register (graded, most severe first)')
    expect(report).toContain('[MEDIUM] Served flow figures are a replay')
    expect(report).not.toContain('undefined')
  })
})
