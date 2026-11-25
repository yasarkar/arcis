import { describe, expect, it } from 'vitest'
import { OFFICIAL_MANIFESTS } from '../../../config/x402/manifests'
import {
  extractTokenSymbols,
  getServiceTokenSymbols,
  inferMetricAccentTone,
  inferMetricTokenSymbol,
  isUserCanceledMessage,
  parseRouteTokenSequence,
  resolveFailurePresentation,
  resolveRiskSeverityTone,
  resolveServiceStatusMeta,
} from '../marketplaceDesign'

describe('marketplaceDesign semantic status & token helpers', () => {
  it('classifies service statuses into success, info, cancelled, and error tones', () => {
    expect(resolveServiceStatusMeta('PORTFOLIO_ANALYZED')).toEqual({
      tone: 'success',
      heading: 'ANALYSIS REPORT',
      badgeLabel: 'Verified Read',
    })
    expect(resolveServiceStatusMeta('REPORT_READY')?.heading).toBe('ANALYSIS REPORT')
    expect(resolveServiceStatusMeta('ROUTE_OPTIMIZED')?.tone).toBe('success')
    expect(resolveServiceStatusMeta('OPPORTUNITY_DETECTED')?.tone).toBe('success')
    expect(resolveServiceStatusMeta('QUOTE_READY')?.tone).toBe('success')

    expect(resolveServiceStatusMeta('VAULT_READ')?.tone).toBe('info')
    expect(resolveServiceStatusMeta('NO_POSITION')?.tone).toBe('info')
    expect(resolveServiceStatusMeta('SPREAD_BELOW_THRESHOLD')?.tone).toBe('info')

    expect(resolveServiceStatusMeta('PARTIAL')?.tone).toBe('cancelled')
    expect(resolveServiceStatusMeta('STALE')?.tone).toBe('cancelled')

    expect(resolveServiceStatusMeta('UNAVAILABLE')?.tone).toBe('error')
    expect(resolveServiceStatusMeta('INVALID_ADDRESS')?.tone).toBe('error')
  })

  it('maps risk register severities consistently', () => {
    expect(resolveRiskSeverityTone('CRITICAL')).toBe('error')
    expect(resolveRiskSeverityTone('HIGH')).toBe('error')
    expect(resolveRiskSeverityTone('MEDIUM')).toBe('cancelled')
    expect(resolveRiskSeverityTone('LOW')).toBe('info')
    expect(resolveRiskSeverityTone('INFO')).toBe('info')
  })

  it('separates user cancellations and uncharged voids from hard errors and wallet scope info', () => {
    expect(isUserCanceledMessage('Transaction canceled by user')).toBe(true)
    expect(isUserCanceledMessage('User rejected the request')).toBe(true)

    const userCancelled = resolveFailurePresentation(null, {
      error: 'User rejected the request in MetaMask',
      costUsdc: 0,
    })
    expect(userCancelled.tone).toBe('cancelled')
    expect(userCancelled.badgeLabel).toContain('Cancelled')

    const voided = resolveFailurePresentation(
      {
        kind: 'payment_voided',
        title: 'The service returned no result',
        detail: 'Voided',
        action: 'Retry',
        charged: false,
        reasons: [],
      },
      { error: 'No result', costUsdc: 0 }
    )
    expect(voided.tone).toBe('cancelled')
    expect(voided.badgeLabel).toContain('No charge')

    const walletScope = resolveFailurePresentation(
      {
        kind: 'payer_unsupported',
        title: 'No wallet can sign this call',
        detail: 'Passkey unsupported',
        action: 'Connect EOA',
        charged: false,
        reasons: [],
      },
      { error: 'Passkey unsupported', costUsdc: 0 }
    )
    expect(walletScope.tone).toBe('info')

    const hardError = resolveFailurePresentation(
      {
        kind: 'payment_rejected',
        title: 'Payment was not accepted',
        detail: 'Gateway rejected signature',
        action: 'Retry',
        charged: false,
        reasons: [],
      },
      { error: 'Gateway rejected signature', costUsdc: 0 }
    )
    expect(hardError.tone).toBe('error')
  })

  it('extracts canonical token symbols and route sequences accurately', () => {
    expect(extractTokenSymbols('cirBTC / WETH (Bluechip Pair)')).toEqual(['cirBTC', 'WETH'])
    expect(extractTokenSymbols('USDC/EURC')).toEqual(['USDC', 'EURC'])
    expect(parseRouteTokenSequence('USDC → EURC → WETH')).toEqual(['USDC', 'EURC', 'WETH'])
    expect(inferMetricTokenSymbol('netProfitUsdc')).toBe('USDC')
    expect(inferMetricTokenSymbol('concentrationPct')).toBeNull()
    expect(inferMetricAccentTone('netProfitUsdc', 12.5)).toBe('success')
    expect(inferMetricAccentTone('overallPriceImpactPct', 2.4)).toBe('error')
    expect(inferMetricAccentTone('overallPriceImpactPct', 1.2)).toBe('cancelled')
    expect(inferMetricAccentTone('overallPriceImpactPct', 0.3)).toBe('success')
  })

  it('resolves non-empty coin symbols for every official AI service manifest', () => {
    for (const manifest of OFFICIAL_MANIFESTS) {
      const symbols = getServiceTokenSymbols(manifest)
      expect(symbols.length).toBeGreaterThan(0)
      expect(symbols).toContain('USDC')
    }
  })
})
