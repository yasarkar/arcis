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

  it('renders prominent section headings, semantic status badges, and coin icons for routes and pools', () => {
    const html = render({
      status: 'ROUTE_OPTIMIZED',
      netProfitUsdc: 12.5,
      routeComparison: [
        {
          path: 'USDC → EURC → WETH',
          hops: 2,
          recommended: true,
          expectedOutput: 0.0042,
          priceImpactPct: 0.35,
          estimatedGasUsdc: 0.008,
        },
      ],
      scannedPools: [
        {
          pair: 'USDC/cirBTC',
          poolRate: 90000,
          oracleRate: 91000,
          quoteUnit: 'USDC',
          grossSpreadPct: 1.1,
          netProfitUsdc: 25.4,
          netProfitPct: 0.9,
          meetsThreshold: true,
        },
      ],
    })

    expect(html).toContain('ROUTE OPTIMIZED')
    expect(html).toContain('Optimal Route')
    expect(html).toContain('Route Comparison &amp; Execution Sizing')
    expect(html).toContain('Scanned Arc Pools')
    expect(html).toContain('Best Output')
    expect(html).toContain('Above Hurdle')
    expect(html).toContain('alt="USDC"')
    expect(html).toContain('alt="EURC"')
    expect(html).toContain('alt="cirBTC"')
  })

  it('renders the redesigned 4-block Trade Execution Ticket (State B / Zero-Fluff) with guided 2-hop strip and collapsed audit bar', () => {
    const html = render({
      status: 'ROUTE_OPTIMIZED',
      generatedAt: '2026-11-25T19:30:09.000Z',
      fromToken: 'USDC',
      toToken: 'WETH',
      inputAmount: '10 USDC',
      expectedOutput: '0.0035 WETH',
      minGuaranteedOutput: '0.003482 WETH',
      recommendedPath: 'USDC → EURC → WETH',
      recommendedHops: 2,
      effectiveExecutionPrice: 0.000352,
      ammPriceImpactPct: 0.34,
      poolFeePct: 0.42,
      overallPriceImpactPct: 0.42,
      signedPriceImpactPct: -0.25,
      twoHopOutputGainPct: 1.85,
      twoHopSteps: {
        step1From: 'USDC',
        step1To: 'EURC',
        step1AmountIn: 10,
        step1EstimatedOut: 9.21,
        step2From: 'EURC',
        step2To: 'WETH',
        step2AmountIn: 9.21,
        step2EstimatedOut: 0.0035,
      },
      tradeReserveExposurePct: 3.41,
      sandwichRiskLevel: 'MODERATE',
      poolReserveUsdc: 293,
      flashReserveDepthUsdc: 293,
      estimatedGasCostUsdc: 0.0048,
      routeComparison: [
        {
          path: 'USDC → EURC → WETH',
          hops: 2,
          recommended: true,
          expectedOutput: 0.0035,
          ammPriceImpactPct: 0.34,
          poolFeePct: 0.42,
          priceImpactPct: 0,
          signedPriceImpactPct: -0.25,
          estimatedGasUsdc: 0.0048,
        },
        {
          path: 'USDC → WETH',
          hops: 1,
          recommended: false,
          expectedOutput: 0.003436,
          ammPriceImpactPct: 0.72,
          poolFeePct: 0.3,
          priceImpactPct: 0.5,
          signedPriceImpactPct: 0.5,
          estimatedGasUsdc: 0.0024,
        },
      ],
      executionSizing: {
        recommendedBatchCount: 1,
        perBatchInputAmount: 10,
        perBatchExpectedOutput: 0.0035,
        perBatchAmmPriceImpactPct: 0.34,
        singleSwapAmmPriceImpactPct: 0.34,
        estimatedTotalGasUsdc: 0.0048,
        suggestedMaxSlippagePct: 0.5,
        advisoryOnly: true,
        note: 'Single-transaction execution fits within standard pool reserve depth.',
      },
      riskRegister: [
        {
          id: 'TWO_HOP_ROUTE_ADVANTAGE',
          category: 'OPPORTUNITY',
          severity: 'INFO',
          title: '2-Hop Route Beats Direct Pool by +1.85%',
          finding: 'Routing via USDC → EURC → WETH yields more net output.',
          evidence: { recommendedPath: 'USDC → EURC → WETH', twoHopOutputGainPct: 1.85 },
        },
        {
          id: 'HIGH_RESERVE_SANDWICH_EXPOSURE',
          category: 'EXECUTION_RISK',
          severity: 'HIGH',
          title: 'High Pool Reserve Pressure',
          finding: 'Trade size drains pool reserve.',
          evidence: { tradeReserveExposurePct: 12.5 },
        },
      ],
    })

    // Block 1: Hero Trade Ticket (Strategist Recommendation + Sell → Expected + Min Guaranteed + Effective Rate + Gas)
    expect(html).toContain('Strategist Recommendation')
    expect(html).toContain('Sell Amount')
    expect(html).toContain('10 USDC')
    expect(html).toContain('0.0035 WETH')
    expect(html).toContain('Min. Guaranteed (0.5%)')
    expect(html).toContain('0.003482 WETH')
    expect(html).toContain('Effective Rate')
    expect(html).toContain('1 USDC')
    expect(html).toContain('0.000352 WETH')
    expect(html).toContain('0.0048 USDC')
    expect(html).toContain('2026-11-25 19:30:09 UTC')
    expect(html).toContain('Execution rating: 4.5 out of 5 stars')
    expect(html).toContain('#9896ff')
    expect(html).toContain('#7c3aed')
    expect(html).not.toContain('Optimal Path Ready')
    expect(html).not.toContain('Do Not Execute')
    expect(html).not.toContain('$0.0048')
    expect(html).not.toContain('Depth: $293')
    expect(html).toContain('Depth: 293 USDC')
    expect(html).not.toContain('2-Hop Optimal')
    expect(html).not.toContain('2-HOP ·')
    expect(html).not.toContain('Step 1')

    // Block 2: 3-Column Signals
    expect(html).toContain('Combined AMM Impact')
    expect(html).toContain('0.34%')
    expect(html).toContain('LP Fee: 0.42%')
    expect(html).toContain('vs. Oracle Spot')
    expect(html).toContain('+0.25%')
    expect(html).toContain('Bottleneck Pressure')
    expect(html).toContain('3.41%')

    // Block 3: Route Comparison Table (with coin icons and USDC gas — never $ mixed with USDC)
    expect(html).toContain('Route Comparison')
    expect(html).toContain('USDC → WETH')
    expect(html).toContain('Best')
    expect(html).toContain('alt="USDC"')
    expect(html).toContain('title="WETH"')
    expect(html).not.toMatch(/\$[\d.,]+\s*USDC/i)

    // Block 4: Collapsed Audit Bar (zero bloated paragraphs by default)
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('1 advisory')
    expect(html).not.toContain('Flash Reserve Depth Usdc')
    expect(html).not.toContain('Recommended Hops')
    expect(html).not.toContain('The router simulates every direct and 2-hop pool combination')
    expect(html).not.toContain('This surveillance monitor compares trade size against live sold-side pool reserve depth')
  })

  it('never mixes $ with USDC across KPI metrics, pools, bridge quotes, or vault summaries and renders USDC icons', () => {
    const html = render({
      status: 'QUOTE_READY',
      tvlUsdc: 12500,
      netProfitUsdc: 18.25,
      savingsUsdc: 0.0045,
      totalUsd: 50000,
      gateway: { available: true, totalCostUsdc: 0.005, feeBps: 5 },
      cctp: { available: true, totalCostUsdc: 0.12, feeUsdc: 0.1, sourceGasUsdc: 0.02, mechanism: 'cctp-v2' },
      recommendedRail: 'gateway',
      token: 'USDC',
      destinationChain: 'Base_Sepolia',
      defiPositions: {
        vault: { hasPosition: true, shares: '1000', currentValueUsdc: 1234.56, pendingYieldUsdc: 0.25 },
      },
    })

    expect(html).not.toMatch(/\$[\d.,]+\s*USDC/i)
    expect(html).toContain('12,500.00 USDC')
    expect(html).toContain('18.25 USDC')
    expect(html).toContain('0.0045 USDC')
    expect(html).toContain('$50,000.00')
    expect(html).toContain('alt="USDC"')
  })
})
