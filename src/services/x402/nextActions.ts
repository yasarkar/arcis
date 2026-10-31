// src/services/x402/nextActions.ts
// Turns report signals into next steps. Deterministic, pure and offline: the same envelope and
// the same request parameters always yield the same recommendations, in the same order.
//
// What this engine will not do:
//   - it never invents a finding. Every recommendation names the signal ids that triggered it and
//     copies its rationale from the signal's own sentence;
//   - it never suggests a follow-up on a measurement it just judged stale — a stale report only
//     earns "refresh it", because a cross-check or an action would inherit the stale figure;
//   - it never offers an advisory action on a subject with an unread measurement (a
//     `DATA_QUALITY` finding at HIGH or worse) or on a network-level report, which is not about
//     the reader's own position;
//   - it never recommends a paid call without stating that call's price.
//
// Rules are data (`src/config/x402/nextActions.ts`); this module is the matcher, the guard rails
// and the ordering.

import { getOfficialManifestById } from '../../config/x402/manifests'
import {
  NEXT_ACTION_RULES,
  type NextActionRule,
  type RecommendationTier,
} from '../../config/x402/nextActions'
import {
  CURRENT_READ_MAX_AGE_SECONDS,
  type ReportSubjectType,
  type RiskSeverity,
} from './institutionalReport'
import {
  extractReportSignals,
  hasDataQualityBlocker,
  severityAtLeast,
  severityRank,
  type ReportSignal,
} from './reportSignals'

export type { RecommendationTier }

export interface RecommendationAction {
  kind: 'rerun' | 'open_service'
  serviceId: string
  /** Catalogue name when the service is listed, the id otherwise. */
  serviceName: string
  /** The parameters the action would submit; a re-run keeps the inputs it was given. */
  params: Record<string, unknown>
  /** The call price in USDC, or `null` when the service is not in the catalogue. */
  priceUsdc: number | null
}

export interface Recommendation {
  /** Deterministic per rule and subject, so a re-render does not remount the card. */
  id: string
  ruleId: string
  subject: { type: ReportSubjectType; identifier: string }
  tier: RecommendationTier
  severity: RiskSeverity
  title: string
  /** The triggering signal's own sentence, never a model-written one. */
  rationale: string
  triggerSignalIds: string[]
  reportIds: string[]
  /** `null` when the recommendation is itself the refresh, or the report stated no measurement time. */
  expiresAt: number | null
  action: RecommendationAction
}

export interface BuildRecommendationsInput {
  signals: ReportSignal[]
  /** The request parameters of the last call per service id, as the surface submitted them. */
  requestParams?: Record<string, Record<string, unknown>>
  /** Clock used for expiry; defaults to now. */
  now?: number
  /** Maximum recommendations returned; defaults to 3. */
  limit?: number
}

const TIER_ORDER: Record<RecommendationTier, number> = {
  reparameterize: 0,
  cross_check: 1,
  advisory_action: 2,
  context: 3,
}

/** Stable key for a parameter set, so two candidates merge only when they would submit the same call. */
function paramKey(params: Record<string, unknown>): string {
  const entries = Object.keys(params)
    .sort()
    .map((key) => [key, params[key]] as const)
  return JSON.stringify(entries)
}

function matchesRule(
  rule: NextActionRule,
  signal: ReportSignal,
  requestParams: BuildRecommendationsInput['requestParams']
): boolean {
  if (rule.when.signalId !== signal.id) return false
  if (rule.when.minSeverity && !severityAtLeast(signal.severity, rule.when.minSeverity)) {
    return false
  }

  const observed = requestParams?.[signal.serviceId]
  if (rule.when.observedParams && rule.when.observedParams.length > 0) {
    if (!observed) return false
    return rule.when.observedParams.every((match) => observed[match.name] === match.equals)
  }

  return true
}

/**
 * A finding on a stale measurement supports no follow-up; a follow-up exists only for a current
 * report. Advisory actions additionally require readable data on the subject and a subject that is
 * about the reader at all.
 */
function tierAllowed(
  tier: RecommendationTier,
  signal: ReportSignal,
  signals: ReportSignal[]
): boolean {
  if (tier === 'reparameterize') return true
  if (signal.freshness !== 'CURRENT') return false
  if (tier === 'advisory_action') {
    if (signal.subject.type === 'NETWORK') return false
    if (hasDataQualityBlocker(signals, signal.subject)) return false
  }
  return true
}

/** A current measurement expires with the freshness window; everything else carries no clock. */
function expiryFor(signal: ReportSignal): number | null {
  if (signal.freshness !== 'CURRENT' || signal.asOf === null) return null
  const measuredAt = Date.parse(signal.asOf)
  if (Number.isNaN(measuredAt)) return null
  return measuredAt + CURRENT_READ_MAX_AGE_SECONDS * 1000
}

function actionFor(
  rule: NextActionRule,
  signal: ReportSignal,
  requestParams: BuildRecommendationsInput['requestParams']
): RecommendationAction {
  const serviceId = rule.then.serviceId ?? signal.serviceId
  const observed =
    serviceId === signal.serviceId ? { ...(requestParams?.[serviceId] ?? {}) } : {}
  const params = { ...observed, ...(rule.then.params ?? {}) }
  const manifest = getOfficialManifestById(serviceId)

  return {
    kind: rule.then.action,
    serviceId,
    serviceName: manifest?.name ?? serviceId,
    params,
    priceUsdc: manifest?.pricing?.priceUsdc ?? null,
  }
}

interface Candidate {
  recommendation: Recommendation
  key: string
}

/** Two candidates are the same step when they submit the same call for the same subject. */
function candidateKey(rule: NextActionRule, signal: ReportSignal, params: Record<string, unknown>): string {
  return `${rule.id}:${signal.subject.type}:${signal.subject.identifier.toLowerCase()}:${paramKey(params)}`
}

function mergeCandidate(existing: Candidate, incoming: Candidate): Candidate {
  const rec = existing.recommendation
  const next = incoming.recommendation

  const triggerSignalIds = [...new Set([...rec.triggerSignalIds, ...next.triggerSignalIds])]
  const reportIds = [...new Set([...rec.reportIds, ...next.reportIds])]
  const expiresAt =
    rec.expiresAt === null || next.expiresAt === null
      ? null
      : Math.min(rec.expiresAt, next.expiresAt)

  return {
    key: existing.key,
    recommendation: {
      ...rec,
      // The most severe trigger states the card; a merge never softens a finding.
      severity: severityRank(next.severity) < severityRank(rec.severity) ? next.severity : rec.severity,
      title: severityRank(next.severity) < severityRank(rec.severity) ? next.title : rec.title,
      rationale:
        severityRank(next.severity) < severityRank(rec.severity) ? next.rationale : rec.rationale,
      triggerSignalIds,
      reportIds,
      expiresAt,
    },
  }
}

export interface ReportRecommendationInput {
  /** The service that produced the report; its observed request parameters travel with it. */
  serviceId: string
  requestParams?: Record<string, unknown>
  now?: number
  limit?: number
}

/**
 * The same engine over a report that was just returned (the copilot's paid call), without waiting
 * for it to be stored as a digest. An unusable payload yields no signals and therefore no cards.
 */
export function recommendationsForReport(
  report: unknown,
  input: ReportRecommendationInput
): Recommendation[] {
  const signals = extractReportSignals(report)
  if (signals.length === 0) return []

  return buildRecommendations({
    signals,
    requestParams: input.requestParams ? { [input.serviceId]: input.requestParams } : undefined,
    now: input.now,
    limit: input.limit ?? 2,
  })
}

export function isRecommendationExpired(recommendation: Recommendation, now = Date.now()): boolean {
  return recommendation.expiresAt !== null && recommendation.expiresAt <= now
}

/**
 * Match every signal against the rule table, apply the guards, merge duplicates, drop expired
 * cards and order by consequence: severity first, then how directly the step follows from the
 * evidence, then price.
 */
export function buildRecommendations(
  input: BuildRecommendationsInput,
  rules: NextActionRule[] = NEXT_ACTION_RULES
): Recommendation[] {
  const now = input.now ?? Date.now()
  const limit = input.limit === undefined ? 3 : Math.max(0, Math.floor(input.limit))
  if (limit === 0) return []

  const candidates = new Map<string, Candidate>()

  for (const signal of input.signals) {
    for (const rule of rules) {
      if (!matchesRule(rule, signal, input.requestParams)) continue
      if (!tierAllowed(rule.then.tier, signal, input.signals)) continue

      const action = actionFor(rule, signal, input.requestParams)
      const recommendation: Recommendation = {
        id: `${rule.id}:${signal.subject.type}:${signal.subject.identifier.toLowerCase()}`,
        ruleId: rule.id,
        subject: { ...signal.subject },
        tier: rule.then.tier,
        severity: signal.severity,
        title: rule.then.title,
        rationale: signal.finding,
        triggerSignalIds: [signal.id],
        reportIds: [signal.reportId],
        expiresAt: expiryFor(signal),
        action,
      }

      const key = candidateKey(rule, signal, action.params)
      const existing = candidates.get(key)
      const candidate: Candidate = { key, recommendation }
      candidates.set(key, existing ? mergeCandidate(existing, candidate) : candidate)
    }
  }

  return [...candidates.values()]
    .map((candidate) => candidate.recommendation)
    .filter((recommendation) => !isRecommendationExpired(recommendation, now))
    .sort((a, b) => {
      const bySeverity = severityRank(a.severity) - severityRank(b.severity)
      if (bySeverity !== 0) return bySeverity
      const byTier = TIER_ORDER[a.tier] - TIER_ORDER[b.tier]
      if (byTier !== 0) return byTier
      const priceA = a.action.priceUsdc ?? Number.POSITIVE_INFINITY
      const priceB = b.action.priceUsdc ?? Number.POSITIVE_INFINITY
      if (priceA !== priceB) return priceA - priceB
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .slice(0, limit)
}
