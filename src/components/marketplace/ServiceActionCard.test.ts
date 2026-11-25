import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ActionableSignalPayload } from '../../types/marketplace'
vi.mock('../../services/soundService', () => ({ soundService: { play: vi.fn() } }))
vi.mock('../../services/copilotExecutionService', () => ({ executeDirectCopilotAction: vi.fn() }))

import ServiceActionCard, {
  formatConfirmedOutput,
  formatVerifiedGasFee,
  getExplicitTradeAmount,
  buildServiceActionPayload,
  extractActionableNextStep,
  buildNextStepSignalPayload,
} from './ServiceActionCard'

function render(payload: ActionableSignalPayload): string {
  return renderToStaticMarkup(React.createElement(ServiceActionCard, { payload }))
}

const basePayload: ActionableSignalPayload = {
  type: 'arbitrage',
  title: 'Arbitrage opportunity',
  badgeText: 'Opportunity',
  details: { fromToken: 'USDC', toToken: 'WETH', estimatedOut: 2.5 },
}

describe('ServiceActionCard transaction truthfulness', () => {
  it('does not invent a default execution amount when the signal omits one', () => {
    const html = render(basePayload)
    expect(html).toContain('Not provided USDC')
    expect(html).toContain('analysis, not an executable arbitrage route')
    expect(html).not.toContain('10 USDC')
    expect(html).not.toContain('Safe testnet allocation')
    expect(html).toContain('Review Quote in Swap')
    expect(html).not.toContain('Execute Opportunity on Arc')
  })

  it('preserves the exact explicit amount rather than silently capping it', () => {
    const payload = { ...basePayload, details: { ...basePayload.details, tradeSizeUsdc: 250 } }
    expect(getExplicitTradeAmount(payload.details)).toBe(250)
    expect(render(payload)).toContain('250 USDC')
    expect(render(payload)).not.toContain('100 USDC')
  })

  it('rejects missing, zero, non-finite, and invalid string amounts', () => {
    expect(getExplicitTradeAmount({})).toBeUndefined()
    expect(getExplicitTradeAmount({ amountIn: 0 })).toBeUndefined()
    expect(getExplicitTradeAmount({ tradeSizeUsdc: Number.POSITIVE_INFINITY })).toBeUndefined()
    expect(getExplicitTradeAmount({ amountIn: 'not-a-number' as any })).toBeUndefined()
    expect(buildServiceActionPayload(basePayload)).toBeUndefined()
  })

  it('creates executable payloads only from the exact explicit amount', () => {
    const payload = { ...basePayload, type: 'swap' as const, details: { ...basePayload.details, tradeSizeUsdc: 250 } }
    expect(buildServiceActionPayload(payload)?.data?.amount).toBe(250)
    expect(buildServiceActionPayload({ ...payload, details: { ...payload.details, amountIn: 0, tradeSizeUsdc: undefined } })).toBeUndefined()
  })

  it('never creates an executable arbitrage card payload', () => {
    const payload = { ...basePayload, details: { ...basePayload.details, tradeSizeUsdc: 250 } }
    expect(buildServiceActionPayload(payload)).toBeUndefined()
    expect(render(payload)).toContain('Review Quote in Swap')
    expect(render(payload)).not.toContain('Execute Opportunity on Arc')
  })

  it('never substitutes an estimate for a confirmed output or zero gas for sponsorship', () => {
    expect(formatConfirmedOutput(undefined)).toBe('Unavailable')
    expect(formatConfirmedOutput(0)).toBe('0')
    expect(formatVerifiedGasFee(null)).toBe('Unavailable')
    expect(formatVerifiedGasFee(0)).toBe('$0 USDC')
  })

  it('clamps swap slippage to Arc DEX bounds (0.1%–2%) instead of multiplying priceImpactPct', () => {
    const highImpactPayload: ActionableSignalPayload = {
      type: 'swap',
      title: 'Step 1 of 2: Swap 3.333 USDC → EURC',
      badgeText: '2-Hop Step 1 · USDC → EURC → WETH',
      details: {
        fromToken: 'USDC',
        toToken: 'EURC',
        amountIn: 3.333333,
        estimatedOut: 3.3,
        priceImpactPct: 28.538,
        slippageTolerancePct: 1,
      },
    }
    const built = buildServiceActionPayload(highImpactPayload)
    expect(built?.data?.slippage).toBe(1)
    expect(built?.data?.minReceived).toBe('3.267')

    const overMaxPayload: ActionableSignalPayload = {
      ...highImpactPayload,
      details: { ...highImpactPayload.details, slippageTolerancePct: 5 },
    }
    expect(buildServiceActionPayload(overMaxPayload)?.data?.slippage).toBe(2)

    const fallbackPayload: ActionableSignalPayload = {
      ...highImpactPayload,
      details: { fromToken: 'USDC', toToken: 'EURC', amountIn: 10, priceImpactPct: 50 },
    }
    expect(buildServiceActionPayload(fallbackPayload)?.data?.slippage).toBe(0.5)
  })

  it('extracts and builds a live-quoted Step 2 payload from confirmed Step 1 output', () => {
    const step1Payload: ActionableSignalPayload = {
      type: 'swap',
      title: 'Step 1 of 2: Swap 100 EURC → USDC',
      badgeText: '2-Hop Step 1 · EURC → USDC → WETH',
      details: {
        fromToken: 'EURC',
        toToken: 'USDC',
        amountIn: 100,
        estimatedOut: 109.5,
        slippageTolerancePct: 0.5,
        nextStep: {
          step: 2,
          totalSteps: 2,
          fromToken: 'USDC',
          toToken: 'WETH',
          poolAddress: '0x4fB42dBbA5AD26723106bd56cA647dEb4a75Cd90',
          optimalPool: 'Arcis WETH Pool',
          slippageTolerancePct: 0.5,
          fullPath: 'EURC → USDC → WETH',
        },
      },
    }

    const nextStep = extractActionableNextStep(step1Payload.details)
    expect(nextStep).not.toBeNull()
    expect(nextStep?.fromToken).toBe('USDC')
    expect(nextStep?.toToken).toBe('WETH')

    const step2 = buildNextStepSignalPayload({
      nextStep: nextStep!,
      confirmedAmountIn: 109.42,
      freshEstimatedOut: 0.036473,
      freshMinReceived: '0.03629',
    })
    expect(step2).not.toBeNull()
    expect(step2?.details.amountIn).toBe(109.42)
    expect(step2?.details.estimatedOut).toBe(0.036473)
    expect(step2?.details.minReceived).toBe('0.03629')
    expect(step2?.details.buttonLabel).toContain('Step 2/2')

    const builtStep2 = buildServiceActionPayload(step2!)
    expect(builtStep2?.data?.fromToken).toBe('USDC')
    expect(builtStep2?.data?.toToken).toBe('WETH')
    expect(builtStep2?.data?.amount).toBe(109.42)
    expect(builtStep2?.data?.minReceived).toBe('0.03629')

    expect(
      buildNextStepSignalPayload({ nextStep: nextStep!, confirmedAmountIn: 0, freshEstimatedOut: 0.01 })
    ).toBeNull()

    const html = render(step1Payload)
    expect(html).toContain('Min (0.5%)')
  })
})
