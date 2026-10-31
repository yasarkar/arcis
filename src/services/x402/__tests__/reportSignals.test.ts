// src/services/x402/__tests__/reportSignals.test.ts
// Pins the signal layer: meta signals derive from coverage and freshness only, findings keep their
// `<kind>:<risk id>` identity, and malformed input yields nothing rather than a partial set.

import { describe, expect, it } from 'vitest'
import {
  META_SIGNAL_IDS,
  extractReportSignals,
  findingSignalId,
  hasDataQualityBlocker,
  severityAtLeast,
} from '../reportSignals'
import {
  buildInstitutionalReport,
  institutionalRisk,
  type BuildInstitutionalReportInput,
  type InstitutionalRisk,
} from '../institutionalReport'

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

function envelope(overrides: Partial<BuildInstitutionalReportInput> = {}) {
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

describe('extractReportSignals', () => {
  it('emits no meta signal for a complete, current report', () => {
    expect(extractReportSignals(envelope())).toEqual([])
  })

  it('grades an incomplete read set and states the missing count', () => {
    const signals = extractReportSignals(envelope({ coverage: { measuredReads: 5, expectedReads: 6 } }))
    const gap = signals.find((signal) => signal.id === META_SIGNAL_IDS.coverageGap)

    expect(gap).toBeDefined()
    expect(gap?.layer).toBe('meta')
    expect(gap?.severity).toBe('LOW')
    expect(gap?.evidence).toMatchObject({ measuredReads: 5, expectedReads: 6, missingReads: 1 })
    expect(gap?.finding).toContain('5 of 6 planned reads returned')
    expect(gap?.subject).toEqual({ type: 'WALLET', identifier: WALLET })

    const insufficient = extractReportSignals(
      envelope({ coverage: { measuredReads: 0, expectedReads: 6 } })
    ).find((signal) => signal.id === META_SIGNAL_IDS.coverageGap)
    expect(insufficient?.severity).toBe('MEDIUM')
  })

  it('flags a stale measurement and an unknown measurement differently', () => {
    const stale = extractReportSignals(
      envelope({ issuedAt: AS_OF, asOf: AS_OF - 900_000 })
    ).find((signal) => signal.id === META_SIGNAL_IDS.stale)
    expect(stale?.severity).toBe('MEDIUM')
    expect(stale?.finding).toContain('900s old')

    const unknown = extractReportSignals(
      envelope({ issuedAt: AS_OF, asOf: null })
    ).find((signal) => signal.id === META_SIGNAL_IDS.stale)
    expect(unknown?.severity).toBe('LOW')
    expect(unknown?.finding).toContain('no measurement time')
  })

  it('keeps finding identity scoped to the report kind and copies the register fields', () => {
    const report = envelope({
      coverage: { measuredReads: 6, expectedReads: 6 },
      risks: [
        risk({
          id: 'HIGH_CONCENTRATION',
          severity: 'HIGH',
          category: 'CONCENTRATION',
          evidence: { concentrationPct: 82, dominantAsset: 'USDC' },
        }),
      ],
    })
    const signals = extractReportSignals(report)
    const finding = signals.find((signal) => signal.id === findingSignalId('PORTFOLIO_EXPOSURE', 'HIGH_CONCENTRATION'))

    expect(finding).toBeDefined()
    expect(finding?.layer).toBe('finding')
    expect(finding?.reportId).toBe(report.reportId)
    expect(finding?.serviceId).toBe('arc-portfolio-risk-exposure')
    expect(finding?.severity).toBe('HIGH')
    expect(finding?.evidence).toEqual({ concentrationPct: 82, dominantAsset: 'USDC' })
    expect(finding?.threshold).toBe('threshold')
    expect(finding?.remediation).toBe('remediation')
    expect(finding?.observedAt).toBe(report.issuedAt)

    // The same risk id under another kind must not collide.
    expect(findingSignalId('VAULT_POSITION', 'HIGH_CONCENTRATION')).not.toBe(finding?.id)
  })

  it('orders signals most severe first, then by id', () => {
    const signals = extractReportSignals(
      envelope({
        coverage: { measuredReads: 5, expectedReads: 6 },
        risks: [
          risk({ id: 'NO_BALANCES', severity: 'INFO', category: 'COMPOSITION' }),
          risk({ id: 'BALANCE_READ_FAILED', severity: 'HIGH', category: 'DATA_QUALITY' }),
        ],
      })
    )
    expect(signals.map((signal) => signal.severity)).toEqual(['HIGH', 'LOW', 'INFO'])
  })

  it('returns nothing for input that is not an envelope', () => {
    expect(extractReportSignals(null)).toEqual([])
    expect(extractReportSignals({ report: {} })).toEqual([])
    expect(extractReportSignals({ ...envelope(), schema: 'other/v0' })).toEqual([])
  })
})

describe('hasDataQualityBlocker', () => {
  const subject = { type: 'WALLET' as const, identifier: WALLET }

  it('blocks only an unread measurement on the same subject', () => {
    const blocked = extractReportSignals(
      envelope({
        coverage: { measuredReads: 5, expectedReads: 6 },
        risks: [risk({ id: 'BALANCE_READ_FAILED', severity: 'HIGH', category: 'DATA_QUALITY' })],
      })
    )
    expect(hasDataQualityBlocker(blocked, subject)).toBe(true)
    expect(
      hasDataQualityBlocker(blocked, { type: 'WALLET', identifier: WALLET.toUpperCase() })
    ).toBe(true)
    expect(
      hasDataQualityBlocker(blocked, {
        type: 'WALLET',
        identifier: '0x0000000000000000000000000000000000000002',
      })
    ).toBe(false)
    expect(hasDataQualityBlocker(blocked, { type: 'VAULT', identifier: WALLET })).toBe(false)
  })

  it('does not block on a low-severity or non-data-quality finding', () => {
    const signals = extractReportSignals(
      envelope({
        coverage: { measuredReads: 6, expectedReads: 6 },
        risks: [
          risk({ id: 'LOW_STABLECOIN_SHARE', severity: 'LOW', category: 'COMPOSITION' }),
        ],
      })
    )
    expect(hasDataQualityBlocker(signals, subject)).toBe(false)
  })
})

describe('severityAtLeast', () => {
  it('compares in severity order, not alphabetically', () => {
    expect(severityAtLeast('CRITICAL', 'HIGH')).toBe(true)
    expect(severityAtLeast('HIGH', 'HIGH')).toBe(true)
    expect(severityAtLeast('MEDIUM', 'HIGH')).toBe(false)
    expect(severityAtLeast('INFO', 'LOW')).toBe(false)
  })
})
