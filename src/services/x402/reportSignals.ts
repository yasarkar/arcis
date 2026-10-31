// src/services/x402/reportSignals.ts
// Neutral signal layer between an institutional report envelope and any consumer that wants to
// reason about it (a recommendation engine today, the shelf and the copilot later).
//
// The envelope (`arcis.institutional-report/v1`) already states what was measured, how stale it
// is, and which graded findings the service stands behind. This module does not add a second
// judgement: it re-shapes those facts into one uniform `ReportSignal[]` so a rule table can match
// on ids and severities without knowing which service produced the report.
//
// Rules this module enforces:
//   - A signal restates an envelope field; it never invents a figure or a severity. Meta signals
//     (coverage gap, stale measurement) are derived from `coverage` and `freshness` only.
//   - Finding ids are `<kind>:<risk id>`, so the same risk id from two report kinds stays
//     distinguishable (e.g. `PORTFOLIO_EXPOSURE:BALANCE_READ_FAILED`).
//   - The data-quality grade is deliberately NOT a signal of its own: it is a function of
//     coverage alone, so a second signal would only duplicate `META:COVERAGE_GAP`.
//   - Malformed input yields no signals rather than a partial, half-true set.

import {
  CURRENT_READ_MAX_AGE_SECONDS,
  INSTITUTIONAL_REPORT_SCHEMA,
  type InstitutionalReport,
  type InstitutionalReportKind,
  type ReportCoverageState,
  type ReportFreshnessState,
  type ReportSubjectType,
  type RiskCategory,
  type RiskSeverity,
} from './institutionalReport'

export type ReportSignalLayer = 'meta' | 'finding'
export type ReportSignalCategory = RiskCategory | 'META'

export interface ReportSignal {
  /** Stable match key: `META:<name>` or `<kind>:<risk id>`. */
  id: string
  layer: ReportSignalLayer
  kind: InstitutionalReportKind
  serviceId: string
  reportId: string
  subject: { type: ReportSubjectType; identifier: string }
  title: string
  /** A sentence built from measured values, copied from the envelope. */
  finding: string
  severity: RiskSeverity
  category: ReportSignalCategory
  evidence: Record<string, number | string | boolean | null>
  threshold: string | null
  remediation: string
  /** When the report was assembled (ISO 8601), copied from `issuedAt`. */
  observedAt: string
  /** When the underlying measurement was taken, when the service stated it. */
  asOf: string | null
  freshness: ReportFreshnessState
  coverage: {
    state: ReportCoverageState
    coveragePct: number
    measuredReads: number
    expectedReads: number
  }
}

/** Meta signal ids, kept as constants so a rule cannot match a typo. */
export const META_SIGNAL_IDS = {
  coverageGap: 'META:COVERAGE_GAP',
  stale: 'META:STALE',
} as const

export function findingSignalId(kind: InstitutionalReportKind, riskId: string): string {
  return `${kind}:${riskId}`
}

/** The finding ids the first rules are written against. */
export const FINDING_SIGNAL_IDS = {
  portfolioGatewayBalanceUnavailable: findingSignalId(
    'PORTFOLIO_EXPOSURE',
    'GATEWAY_BALANCE_UNAVAILABLE'
  ),
  vaultPrincipalImpairment: findingSignalId('VAULT_POSITION', 'PRINCIPAL_IMPAIRMENT'),
} as const

const SEVERITY_ORDER: Record<RiskSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
}

export function severityRank(severity: RiskSeverity): number {
  return SEVERITY_ORDER[severity]
}

/** True when `severity` is at least as severe as `floor`. */
export function severityAtLeast(severity: RiskSeverity, floor: RiskSeverity): boolean {
  return severityRank(severity) <= severityRank(floor)
}

/** Shape check shared with anything that stores or re-reads an envelope (see reportDigest.ts). */
export function isInstitutionalReport(value: unknown): value is InstitutionalReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<InstitutionalReport>
  return (
    candidate.schema === INSTITUTIONAL_REPORT_SCHEMA &&
    typeof candidate.reportId === 'string' &&
    typeof candidate.kind === 'string' &&
    typeof candidate.serviceId === 'string' &&
    !!candidate.subject &&
    typeof candidate.subject.type === 'string' &&
    typeof candidate.subject.identifier === 'string' &&
    !!candidate.coverage &&
    typeof candidate.coverage.state === 'string' &&
    !!candidate.freshness &&
    typeof candidate.freshness.state === 'string' &&
    Array.isArray(candidate.riskRegister)
  )
}

/** Coverage gap grade: a report that missed half its reads is worse than one that missed a leg. */
function coverageGapSeverity(state: ReportCoverageState): RiskSeverity {
  return state === 'INSUFFICIENT' ? 'MEDIUM' : 'LOW'
}

function staleSeverity(state: ReportFreshnessState): RiskSeverity {
  return state === 'STALE' ? 'MEDIUM' : 'LOW'
}

function metaBase(report: InstitutionalReport): Pick<
  ReportSignal,
  'kind' | 'serviceId' | 'reportId' | 'subject' | 'observedAt' | 'asOf' | 'freshness' | 'coverage'
> {
  return {
    kind: report.kind,
    serviceId: report.serviceId,
    reportId: report.reportId,
    // Copied, never re-derived: a recommendation must point at the same subject the report measured.
    subject: { type: report.subject.type, identifier: report.subject.identifier },
    observedAt: report.issuedAt,
    asOf: report.asOf,
    freshness: report.freshness.state,
    coverage: {
      state: report.coverage.state,
      coveragePct: report.coverage.coveragePct,
      measuredReads: report.coverage.measuredReads,
      expectedReads: report.coverage.expectedReads,
    },
  }
}

/**
 * Envelope → signals. Meta signals first (they qualify how much the findings can be trusted),
 * then one signal per graded register entry.
 */
export function extractReportSignals(report: unknown): ReportSignal[] {
  if (!isInstitutionalReport(report)) return []

  const base = metaBase(report)
  const signals: ReportSignal[] = []

  if (report.coverage.state !== 'COMPLETE') {
    const missing = Math.max(0, report.coverage.expectedReads - report.coverage.measuredReads)
    signals.push({
      id: META_SIGNAL_IDS.coverageGap,
      layer: 'meta',
      ...base,
      title: 'Read coverage is incomplete',
      finding: `${report.coverage.measuredReads} of ${report.coverage.expectedReads} planned reads returned (${report.coverage.coveragePct}%); ${missing} could not be read.`,
      severity: coverageGapSeverity(report.coverage.state),
      category: 'META',
      evidence: {
        measuredReads: report.coverage.measuredReads,
        expectedReads: report.coverage.expectedReads,
        coveragePct: report.coverage.coveragePct,
        missingReads: missing,
      },
      threshold: 'Every planned read must return before the report supports a decision.',
      remediation: 'Re-run the service, or restore the input that could not be read.',
    })
  }

  if (report.freshness.state !== 'CURRENT') {
    const age = report.freshness.ageSeconds
    signals.push({
      id: META_SIGNAL_IDS.stale,
      layer: 'meta',
      ...base,
      title: 'Measurement is outside the freshness window',
      finding:
        report.freshness.state === 'STALE' && age !== null
          ? `The measurement is ${age}s old, beyond the ${CURRENT_READ_MAX_AGE_SECONDS}s freshness window.`
          : 'The report carries no measurement time, so its freshness cannot be established.',
      severity: staleSeverity(report.freshness.state),
      category: 'META',
      evidence: { freshness: report.freshness.state, ageSeconds: age },
      threshold: `Measurement age <= ${CURRENT_READ_MAX_AGE_SECONDS}s`,
      remediation: 'Re-run the service before acting on these figures.',
    })
  }

  for (const risk of report.riskRegister) {
    signals.push({
      id: findingSignalId(report.kind, risk.id),
      layer: 'finding',
      ...base,
      title: risk.title,
      finding: risk.finding,
      severity: risk.severity,
      category: risk.category,
      evidence: { ...risk.evidence },
      threshold: risk.threshold,
      remediation: risk.remediation,
    })
  }

  return signals.sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity)
    if (bySeverity !== 0) return bySeverity
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** True when any signal on this subject reports an unread measurement it depends on. */
export function hasDataQualityBlocker(
  signals: ReportSignal[],
  subject: ReportSignal['subject']
): boolean {
  const identifier = subject.identifier.toLowerCase()
  return signals.some(
    (signal) =>
      signal.category === 'DATA_QUALITY' &&
      severityAtLeast(signal.severity, 'HIGH') &&
      signal.subject.type === subject.type &&
      signal.subject.identifier.toLowerCase() === identifier
  )
}
