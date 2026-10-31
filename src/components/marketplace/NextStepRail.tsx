// src/components/marketplace/NextStepRail.tsx
// The shelf's "next step" rail and the per-card "last measured" line.
//
// Both read the recommendation engine's output and a stored report digest; neither decides what
// to offer. The rail shows at most the cards the engine returned, each with the signal that
// triggered it and the price of the call it would run — a paid next step is never presented as
// free. The line restates the envelope's own age, grade and coverage, so a card cannot imply a
// measurement the wallet never bought.

import { ArrowRight, Clock, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'
import { CURRENT_READ_MAX_AGE_SECONDS } from '../../services/x402/institutionalReport'
import type { Recommendation, RecommendationTier } from '../../services/x402/nextActions'
import {
  digestAgeSeconds,
  formatDigestAge,
  type ReportDigest,
} from '../../services/x402/reportDigest'

const TIER_LABEL: Record<RecommendationTier, string> = {
  reparameterize: 'RE-RUN WITH A CORRECTED INPUT',
  cross_check: 'CROSS-CHECK THE FINDING',
  advisory_action: 'CONSIDER AN ACTION',
  context: 'CONTEXT',
}

const TIER_COLOR: Record<RecommendationTier, string> = {
  reparameterize: 'var(--secondary-colors--sky-sync)',
  cross_check: 'var(--secondary-colors--blockstream-gold)',
  advisory_action: 'var(--purple-1)',
  context: 'rgba(255, 255, 255, 0.55)',
}

const TIER_ICON: Record<RecommendationTier, typeof RefreshCw> = {
  reparameterize: RefreshCw,
  cross_check: ShieldAlert,
  advisory_action: Sparkles,
  context: ArrowRight,
}

export interface NextStepRailProps {
  recommendations: Recommendation[]
  onOpen: (recommendation: Recommendation) => void | Promise<void>
  /** Chat-surface rendering: one column, tighter padding, no advisory paragraph. */
  compact?: boolean
  /** Overrides the button label per card (the call price stays visible either way). */
  actionLabel?: string | ((recommendation: Recommendation) => string)
}

function priceLabel(recommendation: Recommendation): string {
  const price = recommendation.action.priceUsdc
  return price === null ? 'Open' : `Open · $${price}`
}

export default function NextStepRail({
  recommendations,
  onOpen,
  compact = false,
  actionLabel,
}: NextStepRailProps) {
  if (recommendations.length === 0) return null

  return (
    <section
      aria-label="Next step"
      className="arc-card"
      style={{
        padding: compact ? '14px' : '20px',
        borderRadius: '20px',
        background: 'rgba(15, 23, 42, 0.75)',
        border: '1px solid rgba(47, 87, 140, 0.35)',
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="arc-eyebrow text-[11px] flex items-center gap-1.5 text-[var(--purple-1)]">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Next step</span>
          </span>
          {!compact && (
            <p
              className="text-[11px] mt-1"
              style={{
                color: 'var(--fp-4, rgba(255, 255, 255, 0.45))',
                fontFamily: 'var(--fonts--space-mono)',
              }}
            >
              Derived from the report this wallet bought. Advisory only — not investment advice.
            </p>
          )}
        </div>
      </div>

      <div className={`grid grid-cols-1 ${compact ? '' : 'lg:grid-cols-2'} gap-3 ${compact ? 'mt-3' : 'mt-4'}`}>
        {recommendations.map((recommendation) => {
          const Icon = TIER_ICON[recommendation.tier]
          const tone = TIER_COLOR[recommendation.tier]
          return (
            <article
              key={recommendation.id}
              className="rounded-2xl border p-3.5 flex flex-col justify-between gap-3"
              style={{ background: 'rgba(8, 10, 18, 0.55)', borderColor: 'rgba(255, 255, 255, 0.07)' }}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 border"
                    style={{
                      fontFamily: 'var(--fonts--space-mono)',
                      color: tone,
                      borderColor: 'rgba(255, 255, 255, 0.12)',
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      letterSpacing: '0.6px',
                    }}
                  >
                    <Icon className="w-3 h-3" />
                    {TIER_LABEL[recommendation.tier]}
                  </span>
                  <span
                    className="text-[10px] uppercase tracking-wider text-right"
                    style={{
                      fontFamily: 'var(--fonts--space-mono)',
                      color: 'var(--fp-4, rgba(255, 255, 255, 0.45))',
                    }}
                  >
                    {recommendation.severity}
                    {recommendation.action.priceUsdc === null
                      ? ''
                      : ` · $${recommendation.action.priceUsdc}`}
                  </span>
                </div>

                <h3
                  className="text-sm font-bold text-white leading-snug"
                  style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                >
                  {recommendation.title}
                </h3>
                <p
                  className="text-[11px] leading-relaxed line-clamp-2"
                  style={{ color: 'var(--fp-3, rgba(255, 255, 255, 0.65))' }}
                >
                  {recommendation.rationale}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className="text-[10px] truncate max-w-[60%]"
                  title={recommendation.triggerSignalIds.join(', ')}
                  style={{
                    fontFamily: 'var(--fonts--space-mono)',
                    color: 'var(--fp-4, rgba(255, 255, 255, 0.45))',
                  }}
                >
                  {recommendation.triggerSignalIds.join(' · ')}
                </span>
                <button
                  onClick={() => onOpen(recommendation)}
                  className="ub-action-btn ub-action-btn-primary px-3 py-1.5 rounded-full text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer transition-transform hover:scale-105 active:scale-95"
                  style={{ fontFamily: 'var(--fonts--space-mono)' }}
                >
                  <span>
                    {typeof actionLabel === 'function'
                      ? actionLabel(recommendation)
                      : actionLabel ?? priceLabel(recommendation)}
                  </span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export interface LastMeasurementBadgeProps {
  digest: ReportDigest
  /** The moment the line is rendered; the age is computed here, never stored. */
  now: number
}

/**
 * The card line: what this wallet last measured with this service, how old that measurement is,
 * and how complete it was. A stale or undated measurement is marked as such rather than shown in
 * the live green used for current reads.
 */
export function LastMeasurementBadge({ digest, now }: LastMeasurementBadgeProps) {
  const report = digest.report
  const ageSeconds = digestAgeSeconds(report, now)
  const isStale = ageSeconds === null || ageSeconds > CURRENT_READ_MAX_AGE_SECONDS
  const tone = isStale
    ? 'var(--secondary-colors--blockstream-gold)'
    : 'var(--earned-green)'
  const coverage = report.coverage

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 text-[10px] pt-2.5 mt-2.5 border-t border-white/[0.06]"
      title={`Report ${report.reportId} · measured ${report.asOf ?? 'at an unstated time'} · ${coverage.measuredReads}/${coverage.expectedReads} planned reads`}
      style={{ fontFamily: 'var(--fonts--space-mono)' }}
    >
      <Clock className="w-3 h-3 flex-shrink-0" style={{ color: tone }} />
      <span style={{ color: tone }}>Last measured {formatDigestAge(ageSeconds)}</span>
      <span className="text-white/25">·</span>
      <span style={{ color: 'var(--secondary-colors--sky-sync)' }}>
        grade {report.dataQuality.grade}
      </span>
      <span className="text-white/25">·</span>
      <span className="text-white/50 tabular-nums">
        {coverage.measuredReads}/{coverage.expectedReads} reads
      </span>
    </div>
  )
}
