// src/components/marketplace/ServicePlaygroundReport.test.tsx
// The visual report surface must actually render the institutional envelope: identity, quality
// grade, read coverage, the graded register (severity, evidence, threshold, action) and the
// disclosure footer. These assertions are on rendered markup, not on the raw payload.

import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../services/soundService', () => ({ soundService: { play: vi.fn() } }))

import { VisualDataDashboard } from './ServicePlaygroundModal'

function render(payload: Record<string, unknown>, onNavigateTab: (tab: string) => void = () => {}): string {
  return renderToStaticMarkup(
    React.createElement(VisualDataDashboard, { data: payload, outputViewMode: 'visual', onNavigateTab }) as any
  )
}

const report = {
  schema: 'arcis.institutional-report/v1',
  reportId: 'ARX-PRX-20261022-0A1B2C3D',
  kind: 'PORTFOLIO_EXPOSURE',
  serviceId: 'arc-portfolio-risk-exposure',
  title: 'Portfolio Risk & Exposure Report',
  subject: { type: 'WALLET', identifier: '0x0000000000000000000000000000000000000001' },
  issuedAt: '2026-10-22T10:00:00.000Z',
  asOf: '2026-10-22T10:00:00.000Z',
  freshness: { state: 'CURRENT', ageSeconds: 0 },
  coverage: { measuredReads: 9, expectedReads: 9, coveragePct: 100, state: 'COMPLETE' },
  dataQuality: { grade: 'A', rationale: '9 of 9 planned reads returned — every planned read returned.' },
  riskRegister: [
    {
      id: 'HIGH_CONCENTRATION',
      category: 'CONCENTRATION',
      severity: 'HIGH',
      title: 'Single-asset concentration above the review threshold',
      finding: 'USDC accounts for 87.209302% of the measured 860 USD total.',
      evidence: { dominantAsset: 'USDC', concentrationPct: 87.209302 },
      threshold: 'Largest single-asset share > 50% of the measured total.',
      remediation: 'The report states the measured share; it does not instruct a trade.',
      advisoryOnly: true,
    },
    {
      id: 'PRICE_UNAVAILABLE',
      category: 'DATA_QUALITY',
      severity: 'MEDIUM',
      title: 'A nonzero holding could not be priced',
      finding: '1 position(s) with a nonzero balance have no USD price.',
      evidence: { unpricedPositions: 1, totalWithheld: null },
      threshold: null,
      remediation: 'Re-run once the price service answers.',
      advisoryOnly: true,
    },
  ],
  riskSummary: { highestSeverity: 'HIGH', counts: { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 0, INFO: 0 } },
  methodology: ['Wallet token balances are read with eth_call balanceOf() against the Arc contracts.'],
  limitations: ['No historical series is read.'],
  disclosure: {
    readOnly: true,
    advisoryOnly: true,
    notInvestmentAdvice: true,
    disclaimer: 'Read-only measurement. No transaction was signed.',
  },
}

const payload = {
  status: 'PORTFOLIO_ANALYZED',
  totalUsd: 860,
  concentrationPct: 87.209302,
  riskFlags: ['HIGH_CONCENTRATION', 'PRICE_UNAVAILABLE'],
  report,
  limitations: report.limitations,
}

describe('VisualDataDashboard institutional report', () => {
  it('prioritizes core financial KPIs and does not render the bulky institutional report masthead', () => {
    const html = render(payload)

    expect(html).not.toContain('Institutional report')
    expect(html).not.toContain('QUALITY A')
    expect(html).not.toContain('Report kind')
    expect(html).toContain('860')
    expect(html).toContain('87.21%')
  })

  it('renders human-friendly technical explanations and omits raw technical metadata clutter', () => {
    const html = render(payload)

    expect(html).toContain('Risk register (2)')
    expect(html).toContain('High Asset Concentration')
    expect(html).toContain('This automated risk audit continuously tracks portfolio allocation across all connected token contracts on Arc')
    expect(html).not.toContain('Threshold: Largest single-asset share')
    expect(html).not.toContain('Action: The report states the measured share')
  })

  it('does not render unnecessary methodology or disclosure clutter in the visual report', () => {
    const html = render(payload)

    expect(html).not.toContain('METHODOLOGY &amp; DISCLOSURE')
    expect(html).not.toContain('LIMITATIONS')
  })

  it('keeps the legacy flag callout for services that carry no envelope', () => {
    const html = render({ status: 'ANALYSIS_COMPLETE', riskFlags: ['HIGH_CONCENTRATION'] })

    expect(html).toContain('Protocol Risk Flags')
    expect(html).not.toContain('Institutional report')
    expect(html).not.toContain('Risk register')
  })

  it('does not print an empty severity pill when the register is absent', () => {
    const html = render({ status: 'VAULT_READ', tvlUsdc: 1234.56789 })
    expect(html).not.toContain('QUALITY')
  })

  it('renders ANALYSIS REPORT for REPORT_READY status', () => {
    const html = render({ status: 'REPORT_READY', currentValueUsdc: 100 })
    expect(html).toContain('ANALYSIS REPORT')
    expect(html).not.toContain('REPORT READY')
  })

  it('does not render technical shareDecimals as a metric card', () => {
    const html = render({
      status: 'REPORT_READY',
      currentValueUsdc: 1050,
      shareDecimals: 9,
    })
    expect(html).toContain('Redeemable Value')
    expect(html).not.toContain('Share Decimals')
    expect(html).not.toContain('SHARE DECIMALS')
  })

  it('renders vault analytics risk register entry with action button and technical explanation', () => {
    const vaultReport = {
      schema: 'arcis.institutional-report/v1',
      reportId: 'ARX-VAN-20261023-ABCDEF12',
      kind: 'VAULT_ANALYTICS',
      riskRegister: [
        {
          id: 'VAULT_ACTIVE_RESERVES',
          category: 'COMPOSITION',
          severity: 'INFO',
          title: 'USDC Yield Vault Operating Normally',
          finding: 'Vault holds 1234.56 USDC in verified on-chain assets across 1000 shares.',
          evidence: { totalAssetsUsdc: 1234.56, sharePriceUsdc: 1.234568 },
          threshold: 'Vault totalAssets() > 0',
          remediation: 'Deposit liquidity',
          advisoryOnly: true,
        },
      ],
      riskSummary: { highestSeverity: 'INFO', counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 1 } },
    }

    const html = render({
      status: 'VAULT_READ',
      tvlUsdc: 1234.56,
      sharePriceUsdc: 1.234568,
      report: vaultReport,
    })

    expect(html).toContain('Risk register (1)')
    expect(html).toContain('Active Yield Vault Reserves')
    expect(html).toContain('Open USDC Yield Vault')
    expect(html).toContain('This automated surveillance audit inspects live accounting state from the Arc ERC-4626 USDC Yield Vault')
  })
})
