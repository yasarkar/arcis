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
    expect(getExplicitTradeAmount({ amountIn: 'not-a-number' })).toBeUndefined()
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
})
