// src/components/__tests__/nextStepRail.test.ts
// The shelf surfaces must state what the engine decided, never more: the tier, the triggering
// signal, the price of the call the button would run, and — for a stored report — its real age,
// grade and read coverage. Rendered to static markup, so this also pins that an empty rail
// renders nothing at all.

import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import NextStepRail, { LastMeasurementBadge } from '../marketplace/NextStepRail'
import type { Recommendation } from '../../services/x402/nextActions'
import {
  REPORT_DIGEST_SCHEMA,
  type ReportDigest,
} from '../../services/x402/reportDigest'
import { buildInstitutionalReport } from '../../services/x402/institutionalReport'

const AS_OF = Date.UTC(2026, 9, 22, 10, 0, 0)
const WALLET = '0x360049f5E86E2070f80B0F3Ac9443Bf38e78fC3A'

const recommendation: Recommendation = {
  id: 'gateway-scope-fallback:WALLET:0x360049f5e86e2070f80b0f3ac9443bf38e78fc3a',
  ruleId: 'gateway-scope-fallback',
  subject: { type: 'WALLET', identifier: WALLET },
  tier: 'reparameterize',
  severity: 'MEDIUM',
  title: 'Re-run as an Arc-only total that states its scope',
  rationale: 'The Circle Gateway unified balance could not be read.',
  triggerSignalIds: ['PORTFOLIO_EXPOSURE:GATEWAY_BALANCE_UNAVAILABLE'],
  reportIds: ['ARX-PRX-20261022-ABCDEF12'],
  expiresAt: null,
  action: {
    kind: 'rerun',
    serviceId: 'arc-portfolio-risk-exposure',
    serviceName: 'Portfolio Risk & Exposure Engine',
    params: { includeGatewayBalance: false },
    priceUsdc: 0.004,
  },
}

function digest(): ReportDigest {
  return {
    schema: REPORT_DIGEST_SCHEMA,
    serviceId: 'arc-portfolio-risk-exposure',
    report: buildInstitutionalReport({
      kind: 'PORTFOLIO_EXPOSURE',
      serviceId: 'arc-portfolio-risk-exposure',
      title: 'Portfolio Risk & Exposure Report',
      subject: { type: 'WALLET', identifier: WALLET },
      issuedAt: AS_OF,
      asOf: AS_OF,
      coverage: { measuredReads: 6, expectedReads: 7 },
      risks: [],
      methodology: ['read balances'],
      limitations: ['no history'],
    }),
    requestParams: { address: WALLET },
    payer: WALLET.toLowerCase(),
    recordedAt: AS_OF,
  }
}

describe('NextStepRail', () => {
  it('states the tier, the finding, the triggering signal and the call price', () => {
    const html = renderToStaticMarkup(
      React.createElement(NextStepRail, {
        recommendations: [recommendation],
        onOpen: () => undefined,
      })
    )

    expect(html).toContain('Next step')
    expect(html).toContain('RE-RUN WITH A CORRECTED INPUT')
    expect(html).toContain('Re-run as an Arc-only total that states its scope')
    expect(html).toContain('The Circle Gateway unified balance could not be read.')
    expect(html).toContain('PORTFOLIO_EXPOSURE:GATEWAY_BALANCE_UNAVAILABLE')
    expect(html).toContain('Open · $0.004')
    expect(html).toContain('Advisory only — not investment advice.')
  })

  it('renders compactly in chat with a caller-supplied action label', () => {
    const html = renderToStaticMarkup(
      React.createElement(NextStepRail, {
        recommendations: [recommendation],
        onOpen: () => undefined,
        compact: true,
        actionLabel: 'Open in AI Services',
      })
    )

    expect(html).toContain('Open in AI Services')
    // The price stays visible even when the button label is replaced.
    expect(html).toContain('MEDIUM · $0.004')
    expect(html).not.toContain('Advisory only — not investment advice.')
    expect(html).not.toContain('lg:grid-cols-2')
  })

  it('lets the surface label each card by what the click will do', () => {
    const html = renderToStaticMarkup(
      React.createElement(NextStepRail, {
        recommendations: [recommendation],
        onOpen: () => undefined,
        compact: true,
        actionLabel: () => 'Run in chat',
      })
    )

    expect(html).toContain('Run in chat')
    expect(html).toContain('MEDIUM · $0.004')
  })

  it('renders nothing when the engine has no step to offer', () => {
    expect(
      renderToStaticMarkup(
        React.createElement(NextStepRail, { recommendations: [], onOpen: () => undefined })
      )
    ).toBe('')
  })
})

describe('LastMeasurementBadge', () => {
  it('shows the report age, grade and coverage this wallet bought', () => {
    const html = renderToStaticMarkup(
      React.createElement(LastMeasurementBadge, {
        digest: digest(),
        now: AS_OF + 300_000,
      })
    )

    expect(html).toContain('Last measured 5m ago')
    expect(html).toContain('grade C')
    expect(html).toContain('6/7 reads')
    expect(html).toContain('var(--earned-green)')
  })

  it('marks a measurement outside the freshness window instead of showing it live', () => {
    const html = renderToStaticMarkup(
      React.createElement(LastMeasurementBadge, {
        digest: digest(),
        now: AS_OF + 86_400_000,
      })
    )

    expect(html).toContain('Last measured 1d ago')
    expect(html).toContain('var(--secondary-colors--blockstream-gold)')
  })
})
