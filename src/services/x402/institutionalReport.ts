// src/services/x402/institutionalReport.ts
// Shared institutional report envelope for the reporting & risk agents
// (`arc-portfolio-risk-exposure`, `arc-vault-yield-tax-report`,
// `arc-yield-vault-analytics`, `arc-cross-chain-gateway-flow-indexer`).
//
// Every one of those services used to answer with a flat body plus `riskFlags: string[]`: a flag
// name carried no severity, no threshold and no evidence, so a reader could not tell a withheld
// measurement from a measured concentration breach. This module is the single definition of the
// envelope they now all attach under `report`:
//
//   identity      reportId, schema, kind, subject, issuing service
//   timeliness    asOf, ageSeconds, CURRENT / STALE / UNKNOWN
//   coverage      measured vs expected reads, percentage, COMPLETE / PARTIAL / INSUFFICIENT
//   data quality  letter grade derived from coverage only (never from risk severity)
//   risk register graded entries (severity, category, finding, evidence, threshold, remediation)
//   governance    methodology, limitations, disclosure
//
// Rules this module enforces:
//   - Nothing here invents a figure. Every number in the envelope is arithmetic on read outcomes
//     (how many planned reads returned) or on figures the caller already measured.
//   - A missing read is a coverage gap, never a zero.
//   - Grades describe data quality, not the attractiveness of a position. A high-severity finding
//     lowers `riskSummary.highestSeverity`, not the grade.
//   - `reportId` is deterministic: the same measurement re-served yields the same id, so a caller
//     can reconcile a receipt against a report without trusting a random token.

export const INSTITUTIONAL_REPORT_SCHEMA = 'arcis.institutional-report/v1'

export type InstitutionalReportKind =
  | 'PORTFOLIO_EXPOSURE'
  | 'VAULT_ANALYTICS'
  | 'VAULT_POSITION'
  | 'GATEWAY_FLOW'

export type ReportSubjectType = 'WALLET' | 'VAULT' | 'NETWORK'

export type DataQualityGrade = 'A' | 'B' | 'C' | 'D' | 'UNRATED'

export type RiskSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO'

export type RiskCategory =
  | 'DATA_QUALITY'
  | 'CONCENTRATION'
  | 'COMPOSITION'
  | 'MARKET_STRUCTURE'
  | 'DISCLOSURE'

export type ReportCoverageState = 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT'

export type ReportFreshnessState = 'CURRENT' | 'STALE' | 'UNKNOWN'

/** A figure is stale once it is older than this; the caller may pass its own state instead. */
export const CURRENT_READ_MAX_AGE_SECONDS = 300

export interface InstitutionalRisk {
  /** Stable identifier, upper snake case. Reused as the legacy `riskFlags` value where one exists. */
  id: string
  category: RiskCategory
  severity: RiskSeverity
  title: string
  /** One deterministic sentence built from measured evidence. Never model-written. */
  finding: string
  /** The measured values the finding rests on. `null` means "could not be read". */
  evidence: Record<string, number | string | boolean | null>
  /** The rule that fired, stated so a reader can verify it against the evidence. */
  threshold: string | null
  /** What a reader can do about it. Advisory only; this service never transacts. */
  remediation: string
  /** The report never submits a transaction, so every entry is an observation. */
  advisoryOnly: true
}

export interface InstitutionalReport {
  schema: typeof INSTITUTIONAL_REPORT_SCHEMA
  reportId: string
  kind: InstitutionalReportKind
  serviceId: string
  title: string
  subject: { type: ReportSubjectType; identifier: string }
  /** When this envelope was assembled (ISO 8601). */
  issuedAt: string
  /** The moment the underlying measurement was taken, when the service knows it. */
  asOf: string | null
  freshness: { state: ReportFreshnessState; ageSeconds: number | null }
  coverage: {
    measuredReads: number
    expectedReads: number
    coveragePct: number
    state: ReportCoverageState
  }
  dataQuality: { grade: DataQualityGrade; rationale: string }
  riskRegister: InstitutionalRisk[]
  riskSummary: {
    highestSeverity: RiskSeverity | null
    counts: Record<RiskSeverity, number>
  }
  methodology: string[]
  limitations: string[]
  disclosure: {
    readOnly: true
    advisoryOnly: true
    notInvestmentAdvice: true
    disclaimer: string
  }
}

export interface ReportCoverageInput {
  measuredReads: number
  expectedReads: number
}

export interface BuildInstitutionalReportInput {
  kind: InstitutionalReportKind
  serviceId: string
  title: string
  subject: { type: ReportSubjectType; identifier: string }
  issuedAt: number
  asOf: number | string | null
  /** Overrides the age-based state when the service already knows the read quality. */
  freshness?: { state: ReportFreshnessState; ageSeconds?: number | null }
  coverage: ReportCoverageInput
  risks: InstitutionalRisk[]
  methodology: string[]
  limitations: string[]
  disclaimer?: string
}

const SEVERITY_ORDER: Record<RiskSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
}

const SEVERITY_RANK: RiskSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']

const KIND_PREFIX: Record<InstitutionalReportKind, string> = {
  PORTFOLIO_EXPOSURE: 'PRX',
  VAULT_ANALYTICS: 'VAN',
  VAULT_POSITION: 'VPR',
  GATEWAY_FLOW: 'GFI',
}

export const DEFAULT_REPORT_DISCLAIMER =
  'Read-only measurement. No transaction was signed, submitted or advised, and this report is not investment, legal or tax advice.'

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK_64 = 0xffffffffffffffffn

/** FNV-1a over UTF-16 code units. Deterministic and dependency-free. */
function stableHash(value: string): string {
  let hash = FNV_OFFSET
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * FNV_PRIME) & MASK_64
  }
  return hash.toString(16).padStart(16, '0')
}

const round2 = (value: number): number => Number(value.toFixed(2))

/** Non-negative integer read counts; a nonsense input degrades to zero rather than to a figure. */
function readCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export function coverageStateFor(coverage: ReportCoverageInput): ReportCoverageState {
  const expected = readCount(coverage.expectedReads)
  const measured = Math.min(readCount(coverage.measuredReads), expected)
  if (expected === 0) return 'INSUFFICIENT'
  if (measured === expected) return 'COMPLETE'
  return measured === 0 ? 'INSUFFICIENT' : 'PARTIAL'
}

/**
 * Data-quality grade from read coverage alone. Deliberately independent of the risk register:
 * a fully measured portfolio can still be badly concentrated, and calling that a low grade would
 * conflate "we could not see it" with "what we saw is risky".
 */
export function gradeForCoverage(coverage: ReportCoverageInput): {
  grade: DataQualityGrade
  rationale: string
} {
  const expected = readCount(coverage.expectedReads)
  const measured = Math.min(readCount(coverage.measuredReads), expected)

  if (expected === 0) {
    return { grade: 'UNRATED', rationale: 'No planned read was declared, so no quality grade is issued.' }
  }
  if (measured === 0) {
    return {
      grade: 'UNRATED',
      rationale: `None of the ${expected} planned reads returned, so no quality grade is issued.`,
    }
  }

  const missing = expected - measured
  const tail = missing === 0 ? 'every planned read returned.' : `${missing} could not be read.`
  const score = (measured / expected) * 100

  if (score === 100) return { grade: 'A', rationale: `${measured} of ${expected} planned reads returned — ${tail}` }
  if (score >= 90) return { grade: 'B', rationale: `${measured} of ${expected} planned reads returned — ${tail}` }
  if (score >= 60) return { grade: 'C', rationale: `${measured} of ${expected} planned reads returned — ${tail}` }
  return { grade: 'D', rationale: `${measured} of ${expected} planned reads returned — ${tail}` }
}

function toIso(asOf: number | string | null): string | null {
  if (asOf === null || asOf === undefined || asOf === '') return null
  const date = new Date(asOf)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function freshnessFor(
  issuedAt: number,
  asOf: string | null,
  override?: { state: ReportFreshnessState; ageSeconds?: number | null }
): { state: ReportFreshnessState; ageSeconds: number | null } {
  const derivedAge =
    asOf === null ? null : Math.max(0, Math.round((issuedAt - new Date(asOf).getTime()) / 1000))

  if (override) {
    const ageSeconds =
      override.ageSeconds !== undefined ? override.ageSeconds : derivedAge
    return { state: override.state, ageSeconds }
  }

  if (asOf === null) return { state: 'UNKNOWN', ageSeconds: null }
  return {
    state: (derivedAge ?? 0) > CURRENT_READ_MAX_AGE_SECONDS ? 'STALE' : 'CURRENT',
    ageSeconds: derivedAge,
  }
}

/** The report identifier is a hash of what the report *is*, so a re-served read keeps its id. */
export function reportIdFor(args: {
  kind: InstitutionalReportKind
  subject: { type: ReportSubjectType; identifier: string }
  asOf: string | null
  coverage: ReportCoverageInput
  risks: InstitutionalRisk[]
}): string {
  const signature = JSON.stringify({
    schema: INSTITUTIONAL_REPORT_SCHEMA,
    kind: args.kind,
    subject: args.subject.type,
    identifier: args.subject.identifier.toLowerCase(),
    asOf: args.asOf,
    coverage: [readCount(args.coverage.measuredReads), readCount(args.coverage.expectedReads)],
    risks: [...args.risks]
      .map((entry) => `${entry.id}:${entry.severity}`)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  })

  const date = args.asOf === null ? '00000000' : args.asOf.slice(0, 10).replace(/-/g, '')
  return `ARX-${KIND_PREFIX[args.kind]}-${date}-${stableHash(signature).slice(0, 8).toUpperCase()}`
}

/** Severity first, then id, so the most consequential finding is always read first. */
export function sortRiskRegister(risks: InstitutionalRisk[]): InstitutionalRisk[] {
  return [...risks].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (bySeverity !== 0) return bySeverity
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export function summarizeRiskRegister(risks: InstitutionalRisk[]): InstitutionalReport['riskSummary'] {
  const counts: Record<RiskSeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }
  for (const entry of risks) counts[entry.severity] += 1
  const highestSeverity = SEVERITY_RANK.find((severity) => counts[severity] > 0) ?? null
  return { highestSeverity, counts }
}

export function buildInstitutionalReport(input: BuildInstitutionalReportInput): InstitutionalReport {
  const expectedReads = readCount(input.coverage.expectedReads)
  const measuredReads = Math.min(readCount(input.coverage.measuredReads), expectedReads)
  const coverage = {
    measuredReads,
    expectedReads,
    coveragePct: expectedReads === 0 ? 0 : round2((measuredReads / expectedReads) * 100),
    state: coverageStateFor({ measuredReads, expectedReads }),
  }

  const riskRegister = sortRiskRegister(input.risks)
  const asOf = toIso(input.asOf)

  return {
    schema: INSTITUTIONAL_REPORT_SCHEMA,
    reportId: reportIdFor({
      kind: input.kind,
      subject: input.subject,
      asOf,
      coverage: { measuredReads, expectedReads },
      risks: riskRegister,
    }),
    kind: input.kind,
    serviceId: input.serviceId,
    title: input.title,
    subject: input.subject,
    issuedAt: new Date(input.issuedAt).toISOString(),
    asOf,
    freshness: freshnessFor(input.issuedAt, asOf, input.freshness),
    coverage,
    dataQuality: gradeForCoverage({ measuredReads, expectedReads }),
    riskRegister,
    riskSummary: summarizeRiskRegister(riskRegister),
    methodology: [...input.methodology],
    limitations: [...input.limitations],
    disclosure: {
      readOnly: true,
      advisoryOnly: true,
      notInvestmentAdvice: true,
      disclaimer: input.disclaimer ?? DEFAULT_REPORT_DISCLAIMER,
    },
  }
}

/** Builds one register entry with the fields every service must supply. */
export function institutionalRisk(entry: Omit<InstitutionalRisk, 'advisoryOnly'>): InstitutionalRisk {
  return { ...entry, advisoryOnly: true }
}

/** Formats an evidence value for a report line, keeping an unread value visibly unread. */
export function formatEvidenceValue(value: number | string | boolean | null | undefined): string {
  if (value === null || value === undefined) return 'unavailable'
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value.toLocaleString('en-US', { maximumFractionDigits: 4 })
      : 'unavailable'
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return value
}

/**
 * Plain-text rendering of the graded register, most severe first. `evidence` is printed as a
 * compact `key: value` list so a reader can check the finding against its own read, and an
 * unread value stays visibly `unavailable` instead of disappearing.
 */
export function formatRiskRegisterLines(report: unknown, maxEntries = 6): string[] {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return []
  const register = (report as Partial<InstitutionalReport>).riskRegister
  if (!Array.isArray(register) || register.length === 0) return []

  const lines: string[] = ['Risk register (graded, most severe first):']

  register.slice(0, maxEntries).forEach((entry) => {
    lines.push(`• [${entry.severity}] ${entry.title} — ${entry.finding}`)
    const evidence = Object.entries(entry.evidence ?? {})
      .map(([key, value]) => `${key}: ${formatEvidenceValue(value)}`)
      .join(', ')
    if (evidence) lines.push(`  Evidence: ${evidence}`)
    if (entry.threshold) lines.push(`  Threshold: ${entry.threshold}`)
    lines.push(`  Action: ${entry.remediation}`)
  })

  if (register.length > maxEntries) {
    lines.push(`• ${register.length - maxEntries} further entr(ies) are in the structured payload.`)
  }

  return lines
}

/**
 * Compact header for the chat surface: identity, freshness, coverage grade and the count of
 * graded findings. Returns an empty string when the payload carries no envelope, so surfaces
 * that predate it render exactly as before.
 */
export function formatInstitutionalReportHeader(report: unknown): string {
  if (!report || typeof report !== 'object' || Array.isArray(report)) return ''
  const value = report as Partial<InstitutionalReport>
  if (typeof value.reportId !== 'string') return ''

  const coverage = value.coverage
  const summary = value.riskSummary
  const highest = summary?.highestSeverity
  const findings = summary?.counts
    ? SEVERITY_RANK.reduce((total, severity) => total + (summary.counts?.[severity] ?? 0), 0)
    : 0

  const lines = [
    `Report ${value.reportId} · ${value.dataQuality?.grade ?? 'UNRATED'} · ${coverage?.measuredReads ?? 0}/${coverage?.expectedReads ?? 0} reads (${coverage?.coveragePct ?? 0}%) · ${value.freshness?.state ?? 'UNKNOWN'}`,
  ]
  if (findings > 0) {
    lines.push(`Findings: ${findings} graded entr${findings === 1 ? 'y' : 'ies'}, highest severity ${highest ?? 'INFO'}.`)
  }
  return lines.join('\n')
}
