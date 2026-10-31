// src/services/x402/reportDigest.ts
// Per-wallet memory of the reports a payer has actually bought.
//
// A shelf can only say "you used this, here is what it measured, and here is the next step" if
// the report outlives the modal that rendered it. This module is the shared shape: what a digest
// is, how one is taken from a paid call, how the newest one per service is kept, and how a set of
// digests becomes recommendations through the same engine the playground uses.
//
// Rules this module enforces:
//   - a digest is taken from the service response the tollgate already produced, never from a
//     client claim: `digestFromServiceCall` rejects a payload without a valid envelope;
//   - the envelope is stored whole. A summary would be a second, lossy definition of the report,
//     and the recommendation engine reads the risk register, not a synopsis of it;
//   - one entry per service: the shelf is about the latest measurement, not a call log;
//   - a digest that has aged past the freshness window is aged, not silently dropped — its
//     findings still exist, so it earns "refresh" and nothing else.

import {
  CURRENT_READ_MAX_AGE_SECONDS,
  INSTITUTIONAL_REPORT_SCHEMA,
  type InstitutionalReport,
} from './institutionalReport'
import { buildRecommendations, type Recommendation } from './nextActions'
import { extractReportSignals, isInstitutionalReport } from './reportSignals'

export const REPORT_DIGEST_SCHEMA = 'arcis.report-digest/v1'
export const REPORT_DIGEST_STORE_SCHEMA = 'arcis.report-digests/v1'

/** One entry per report service; a wallet cannot hold more distinct report kinds than this. */
export const MAX_DIGESTS_PER_WALLET = 8

/** The largest observed-parameter payload kept; a call cannot exceed this in the first place. */
const MAX_PARAM_JSON_LENGTH = 2000
const MAX_PARAM_VALUE_LENGTH = 512

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

export interface ReportDigest {
  schema: typeof REPORT_DIGEST_SCHEMA
  serviceId: string
  /** The envelope exactly as the paid call returned it. */
  report: InstitutionalReport
  /** The request parameters the payer submitted, so a re-run can keep them. */
  requestParams: Record<string, unknown>
  /** Lowercased payer address; the store is keyed by it and the digest repeats it as evidence. */
  payer: string
  recordedAt: number
}

export interface ReportDigestStore {
  schema: typeof REPORT_DIGEST_STORE_SCHEMA
  payer: string
  updatedAt: number | null
  digests: ReportDigest[]
}

export function emptyReportDigestStore(payer: string): ReportDigestStore {
  return {
    schema: REPORT_DIGEST_STORE_SCHEMA,
    payer: payer.toLowerCase(),
    updatedAt: null,
    digests: [],
  }
}

/** Only flat primitive parameters are kept; the service schema admits nothing else anyway. */
function sanitizeParams(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}

  const params: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === 'string') params[key] = value.slice(0, MAX_PARAM_VALUE_LENGTH)
    else if (typeof value === 'number' && Number.isFinite(value)) params[key] = value
    else if (typeof value === 'boolean') params[key] = value
  }

  return JSON.stringify(params).length <= MAX_PARAM_JSON_LENGTH ? params : {}
}

export interface ReportDigestInput {
  payer: string
  serviceId: string
  requestParams: unknown
  /** The service payload the tollgate produced; the digest is taken from its `report`. */
  data: unknown
  recordedAt?: number
}

/**
 * Takes a digest from one paid call. Returns `null` when the call was not a report (no envelope),
 * when the payer address is unusable, or when the envelope belongs to a different service — a
 * digest that misattributes its source would route the next step to the wrong service.
 */
export function digestFromServiceCall(input: ReportDigestInput): ReportDigest | null {
  if (!ADDRESS_PATTERN.test(input.payer)) return null
  if (!input.data || typeof input.data !== 'object' || Array.isArray(input.data)) return null

  const report = (input.data as { report?: unknown }).report
  if (!isInstitutionalReport(report)) return null
  if (report.schema !== INSTITUTIONAL_REPORT_SCHEMA) return null
  if (report.serviceId !== input.serviceId) return null

  return {
    schema: REPORT_DIGEST_SCHEMA,
    serviceId: input.serviceId,
    report,
    requestParams: sanitizeParams(input.requestParams),
    payer: input.payer.toLowerCase(),
    recordedAt: Number.isFinite(input.recordedAt) ? Number(input.recordedAt) : Date.now(),
  }
}

/** Newest first, one entry per service, capped. */
export function mergeReportDigest(
  store: ReportDigestStore,
  digest: ReportDigest,
  maxEntries = MAX_DIGESTS_PER_WALLET
): ReportDigestStore {
  const limit = Number.isFinite(maxEntries) && maxEntries > 0 ? Math.floor(maxEntries) : 1
  const digests = [digest, ...store.digests.filter((entry) => entry.serviceId !== digest.serviceId)]
    .sort((a, b) => b.recordedAt - a.recordedAt)
    .slice(0, limit)

  return {
    schema: REPORT_DIGEST_STORE_SCHEMA,
    payer: digest.payer,
    updatedAt: digest.recordedAt,
    digests,
  }
}

function isDigest(value: unknown, payer: string): value is ReportDigest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<ReportDigest>
  return (
    candidate.schema === REPORT_DIGEST_SCHEMA &&
    typeof candidate.serviceId === 'string' &&
    candidate.payer === payer &&
    typeof candidate.recordedAt === 'number' &&
    Number.isFinite(candidate.recordedAt) &&
    isInstitutionalReport(candidate.report) &&
    !!candidate.requestParams &&
    typeof candidate.requestParams === 'object' &&
    !Array.isArray(candidate.requestParams)
  )
}

/** Storage is best-effort, so a corrupt entry is dropped rather than failing the whole read. */
export function parseReportDigestStore(raw: string | null | undefined, payer: string): ReportDigestStore {
  const empty = emptyReportDigestStore(payer)
  if (!raw) return empty

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || parsed.schema !== REPORT_DIGEST_STORE_SCHEMA) {
      return empty
    }
    const digests = Array.isArray(parsed.digests)
      ? parsed.digests.filter((entry): entry is ReportDigest => isDigest(entry, empty.payer))
      : []
    const updatedAt = Number(parsed.updatedAt)

    return {
      ...empty,
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null,
      digests: digests.sort((a, b) => b.recordedAt - a.recordedAt).slice(0, MAX_DIGESTS_PER_WALLET),
    }
  } catch {
    return empty
  }
}

/** Seconds since the report's measurement, or null when it stated no measurement time. */
export function digestAgeSeconds(report: InstitutionalReport, now: number): number | null {
  if (report.asOf === null) return null
  const measuredAt = Date.parse(report.asOf)
  if (Number.isNaN(measuredAt)) return null
  return Math.max(0, Math.round((now - measuredAt) / 1000))
}

/** Card-line age. An unknown measurement time says so rather than guessing a number. */
export function formatDigestAge(ageSeconds: number | null): string {
  if (ageSeconds === null) return 'age unknown'
  if (ageSeconds < 60) return 'just now'
  if (ageSeconds < 3_600) return `${Math.floor(ageSeconds / 60)}m ago`
  if (ageSeconds < 86_400) return `${Math.floor(ageSeconds / 3_600)}h ago`
  return `${Math.floor(ageSeconds / 86_400)}d ago`
}

/**
 * A stored envelope keeps the freshness it had when it was issued; reading it later must not
 * pretend otherwise. When the measurement is now older than the freshness window the report is
 * re-stamped as stale, so the engine's own guard applies (refresh only, no follow-up).
 */
export function agedReport(report: InstitutionalReport, now: number): InstitutionalReport {
  const ageSeconds = digestAgeSeconds(report, now)
  if (ageSeconds === null || ageSeconds <= CURRENT_READ_MAX_AGE_SECONDS) return report

  return {
    ...report,
    issuedAt: new Date(now).toISOString(),
    freshness: { state: 'STALE', ageSeconds },
  }
}

export interface DigestRecommendationOptions {
  now?: number
  limit?: number
}

/**
 * The shelf's entry point: every digest contributes its signals, its observed parameters travel
 * with it, and the shared engine decides what (if anything) is worth offering next.
 */
export function recommendationsFromDigests(
  digests: ReportDigest[],
  options: DigestRecommendationOptions = {}
): Recommendation[] {
  const now = options.now ?? Date.now()
  const signals = digests.flatMap((digest) => extractReportSignals(agedReport(digest.report, now)))
  const requestParams: Record<string, Record<string, unknown>> = {}
  for (const digest of digests) requestParams[digest.serviceId] = digest.requestParams

  return buildRecommendations({ signals, requestParams, now, limit: options.limit ?? 2 })
}
