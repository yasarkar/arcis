// src/config/x402/nextActions.ts
// The recommendation rule table: which envelope signal leads to which next step.
//
// This file is data, not judgement. A rule may only reference a signal id that a report service
// actually emits, and every `then` names a step the app can really offer (a re-run through the
// existing tollgate, or another listed service). Rules live here rather than inside a manifest
// because most of them relate two services; the manifest stays the description of one service.
//
// First slice — three rules:
//   1. a stale measurement supports no follow-up except a refresh;
//   2. a failed optional Gateway read has a documented, scoped alternative (Arc-only total);
//   3. a principal-impairment finding is a claim about the vault, so it is cross-checked against
//      the vault's own read instead of being acted on directly.

import type { RiskSeverity } from '../../services/x402/institutionalReport.js'
import {
  FINDING_SIGNAL_IDS,
  META_SIGNAL_IDS,
} from '../../services/x402/reportSignals.js'

export type RecommendationTier =
  | 'reparameterize'
  | 'cross_check'
  | 'advisory_action'
  | 'context'

export interface RuleParamMatch {
  name: string
  equals: string | number | boolean
}

export interface NextActionRule {
  id: string
  /** Why this rule exists, in one sentence, so a reviewer can judge the mapping itself. */
  description: string
  when: {
    /** Exact signal id (`META:<name>` or `<kind>:<risk id>`). */
    signalId: string
    /** Fires only when the signal is at least this severe. */
    minSeverity?: RiskSeverity
    /**
     * Fires only when the last call for the reporting service actually used these parameter
     * values. A rule about a parameter must not fire on a call that never set it.
     */
    observedParams?: RuleParamMatch[]
  }
  then: {
    tier: RecommendationTier
    action: 'rerun' | 'open_service'
    /** Defaults to the service that produced the report. */
    serviceId?: string
    /** Merged over the observed request parameters, so a re-run keeps its other inputs. */
    params?: Record<string, unknown>
    title: string
  }
}

export const NEXT_ACTION_RULES: NextActionRule[] = [
  {
    id: 'refresh-stale-report',
    description:
      'Figures measured outside the freshness window cannot support a follow-up, so the only honest next step is a re-run.',
    when: { signalId: META_SIGNAL_IDS.stale },
    then: {
      tier: 'reparameterize',
      action: 'rerun',
      title: 'Refresh this report before using its figures',
    },
  },
  {
    id: 'gateway-scope-fallback',
    description:
      'The call asked for the Circle Gateway balance and that read did not return; the service documents an Arc-only total that states its scope as the alternative.',
    when: {
      signalId: FINDING_SIGNAL_IDS.portfolioGatewayBalanceUnavailable,
      observedParams: [{ name: 'includeGatewayBalance', equals: true }],
    },
    then: {
      tier: 'reparameterize',
      action: 'rerun',
      params: { includeGatewayBalance: false },
      title: 'Re-run as an Arc-only total that states its scope',
    },
  },
  {
    id: 'vault-impairment-cross-check',
    description:
      'A principal-impairment finding is a claim about the vault’s economics; the vault read measures those economics independently instead of inferring an action from the shortfall alone.',
    when: {
      signalId: FINDING_SIGNAL_IDS.vaultPrincipalImpairment,
      minSeverity: 'MEDIUM',
    },
    then: {
      tier: 'cross_check',
      action: 'open_service',
      serviceId: 'arc-yield-vault-analytics',
      params: { riskPreference: 'stable_only' },
      title: 'Cross-check the vault’s own TVL and share price',
    },
  },
  {
    id: 'portfolio-concentration-yield-check',
    description:
      'When a wallet is heavily concentrated (>= 75%) in a single asset on a clean, current audit, comparing live Arc yield pools and vault options is an evidence-backed next step.',
    when: {
      signalId: FINDING_SIGNAL_IDS.portfolioHighConcentration,
      minSeverity: 'HIGH',
    },
    then: {
      tier: 'advisory_action',
      action: 'open_service',
      serviceId: 'arc-yield-vault-analytics',
      params: { riskPreference: 'all' },
      title: 'Compare live Arc yield pools & vault opportunities for your holdings',
    },
  },
  {
    id: 'portfolio-unclaimed-rewards-statement',
    description:
      'When the portfolio audit detects accrued vault yield or unharvested AMM LP swap fees, the AI position statement breaks down principal, redeemable value and harvestable fees for record-keeping.',
    when: {
      signalId: FINDING_SIGNAL_IDS.portfolioUnclaimedRewards,
      minSeverity: 'INFO',
    },
    then: {
      tier: 'cross_check',
      action: 'open_service',
      serviceId: 'arc-vault-yield-tax-report',
      title: 'Generate an AI yield & LP fees statement for these accrued rewards',
    },
  },
]
