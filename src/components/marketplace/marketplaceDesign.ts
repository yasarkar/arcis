// src/components/marketplace/marketplaceDesign.ts
// Centralized DESIGN.md semantic status palette, status classifiers, and token/chain
// metadata extractors for Arcis AI Services (Aave Luxury + Arc Blockchain Obsidian).

import type { x402ExecutionResult, x402Service } from '../../types/marketplace'
import type { X402FailureDiagnosis } from '../../utils/x402FailureDiagnosis'

export type MarketplaceStatusTone = 'success' | 'error' | 'cancelled' | 'info' | 'pending'

export interface StatusToneStyle {
  tone: MarketplaceStatusTone
  fg: string
  accent: string
  dot: string
  bg: string
  border: string
  glow: string
  pillBg: string
  pillBorder: string
}

/**
 * Institutional Obsidian + Indigo/Aave Purple monochromatic status palette.
 * Avoids eye-fatiguing neon green, bright orange, and stark red surface fills;
 * communicates status through subtle indigo/slate hierarchy and 6px muted dots.
 */
export const STATUS_TONES: Record<MarketplaceStatusTone, StatusToneStyle> = {
  success: {
    tone: 'success',
    fg: '#c4c2ff',
    accent: 'var(--purple-1, #9896ff)',
    dot: '#818cf8',
    bg: 'rgba(99, 102, 241, 0.08)',
    border: 'rgba(152, 150, 255, 0.24)',
    glow: 'rgba(99, 102, 241, 0.14)',
    pillBg: 'rgba(99, 102, 241, 0.14)',
    pillBorder: 'rgba(152, 150, 255, 0.30)',
  },
  error: {
    tone: 'error',
    fg: '#e8ced3',
    accent: '#d898a2',
    dot: '#e88c8c',
    bg: 'rgba(22, 25, 38, 0.82)',
    border: 'rgba(232, 140, 140, 0.24)',
    glow: 'rgba(232, 140, 140, 0.08)',
    pillBg: 'rgba(22, 25, 38, 0.94)',
    pillBorder: 'rgba(232, 140, 140, 0.26)',
  },
  cancelled: {
    tone: 'cancelled',
    fg: '#dcd9f8',
    accent: '#b4b0e6',
    dot: '#c9b896',
    bg: 'rgba(22, 25, 38, 0.76)',
    border: 'rgba(152, 150, 255, 0.22)',
    glow: 'rgba(99, 102, 241, 0.10)',
    pillBg: 'rgba(22, 25, 38, 0.92)',
    pillBorder: 'rgba(152, 150, 255, 0.24)',
  },
  info: {
    tone: 'info',
    fg: 'var(--secondary-colors--static-ether, #d5e0e7)',
    accent: 'var(--secondary-colors--sky-sync, #acc6e9)',
    dot: '#acc6e9',
    bg: 'rgba(15, 17, 26, 0.72)',
    border: 'rgba(152, 150, 255, 0.16)',
    glow: 'rgba(47, 87, 140, 0.12)',
    pillBg: 'rgba(22, 25, 38, 0.88)',
    pillBorder: 'rgba(152, 150, 255, 0.20)',
  },
  pending: {
    tone: 'pending',
    fg: 'var(--purple-8, #e5e5ff)',
    accent: '#818cf8',
    dot: '#6366f1',
    bg: 'rgba(99, 102, 241, 0.10)',
    border: 'rgba(152, 150, 255, 0.28)',
    glow: 'rgba(99, 102, 241, 0.16)',
    pillBg: 'rgba(99, 102, 241, 0.16)',
    pillBorder: 'rgba(152, 150, 255, 0.34)',
  },
}

export function getStatusToneStyle(tone: MarketplaceStatusTone): StatusToneStyle {
  return STATUS_TONES[tone] ?? STATUS_TONES.info
}

export interface ServiceStatusMeta {
  tone: MarketplaceStatusTone
  heading: string
  badgeLabel: string
}

/**
 * Maps an x402 service payload `status` to its headline, semantic tone, and compact badge label.
 * Keeps `ANALYSIS REPORT` for PORTFOLIO_ANALYZED / REPORT_READY (verified by report tests).
 */
export function resolveServiceStatusMeta(status: string | null | undefined): ServiceStatusMeta | null {
  if (!status || typeof status !== 'string') return null
  const upper = status.trim().toUpperCase()
  if (!upper) return null

  if (upper === 'PORTFOLIO_ANALYZED' || upper === 'REPORT_READY') {
    return { tone: 'success', heading: 'ANALYSIS REPORT', badgeLabel: 'Verified Read' }
  }
  if (upper === 'ROUTE_OPTIMIZED') {
    return { tone: 'success', heading: 'ROUTE OPTIMIZED', badgeLabel: 'Optimal Route' }
  }
  if (upper === 'OPPORTUNITY_DETECTED') {
    return { tone: 'success', heading: 'OPPORTUNITY DETECTED', badgeLabel: 'Spread Found' }
  }
  if (upper === 'QUOTE_READY') {
    return { tone: 'success', heading: 'QUOTE READY', badgeLabel: 'Live Quote' }
  }
  if (upper === 'LIVE' || upper === 'ANALYSIS_COMPLETE') {
    return { tone: 'success', heading: upper.replace(/_/g, ' '), badgeLabel: 'Live Read' }
  }
  if (upper === 'VAULT_READ') {
    return { tone: 'info', heading: 'VAULT READ', badgeLabel: 'On-Chain State' }
  }
  if (upper === 'VAULT_EMPTY' || upper === 'NO_POSITION' || upper === 'SPREAD_BELOW_THRESHOLD') {
    return {
      tone: 'info',
      heading: upper.replace(/_/g, ' '),
      badgeLabel: upper === 'SPREAD_BELOW_THRESHOLD' ? 'Below Hurdle' : 'Advisory Info',
    }
  }
  if (upper === 'PARTIAL' || upper === 'STALE') {
    return {
      tone: 'cancelled',
      heading: upper.replace(/_/g, ' '),
      badgeLabel: upper === 'STALE' ? 'Stale Read' : 'Partial Data',
    }
  }
  if (upper === 'UNAVAILABLE' || upper === 'INVALID_ADDRESS') {
    return {
      tone: 'error',
      heading: upper.replace(/_/g, ' '),
      badgeLabel: upper === 'INVALID_ADDRESS' ? 'Invalid Input' : 'Unavailable',
    }
  }
  return { tone: 'info', heading: upper.replace(/_/g, ' '), badgeLabel: 'Report Info' }
}

/**
 * Maps institutional RiskRegister severity to DESIGN.md semantic status tones.
 */
export function resolveRiskSeverityTone(severity: unknown): MarketplaceStatusTone {
  const s = String(severity ?? 'INFO').toUpperCase()
  if (s === 'CRITICAL' || s === 'HIGH') return 'error'
  if (s === 'MEDIUM') return 'cancelled'
  return 'info'
}

const USER_CANCEL_PATTERN = /cancel|canceled by user|cancelled by user|user rejected|user denied|rejected the request/i

export function isUserCanceledMessage(message?: string | null): boolean {
  return typeof message === 'string' && USER_CANCEL_PATTERN.test(message)
}

export interface FailurePresentation {
  tone: MarketplaceStatusTone
  badgeLabel: string
  defaultTitle: string
}

/**
 * Separates user cancellations and uncharged voided calls (Blockstream Gold / Cancelled)
 * from true technical/settlement errors (Obsidian Crimson / Error) and wallet scope notices (Sky Sync / Info).
 */
export function resolveFailurePresentation(
  diagnosis: X402FailureDiagnosis | null,
  result: Pick<x402ExecutionResult, 'error' | 'costUsdc'>
): FailurePresentation {
  const charged = diagnosis ? diagnosis.charged : (result.costUsdc ?? 0) > 0
  if (isUserCanceledMessage(result.error) || isUserCanceledMessage(diagnosis?.detail)) {
    return {
      tone: 'cancelled',
      badgeLabel: 'Cancelled · No charge',
      defaultTitle: 'Request Cancelled',
    }
  }
  if (diagnosis?.kind === 'payer_unsupported') {
    return {
      tone: 'info',
      badgeLabel: 'Wallet Scope · No charge',
      defaultTitle: 'Wallet Signature Required',
    }
  }
  if (
    !charged &&
    (diagnosis?.kind === 'payment_voided' ||
      diagnosis?.kind === 'model_budget' ||
      diagnosis?.kind === 'measurement_missing')
  ) {
    return {
      tone: 'cancelled',
      badgeLabel: 'Voided · No charge',
      defaultTitle: 'Call Voided',
    }
  }
  return {
    tone: 'error',
    badgeLabel: charged ? 'Execution Failed' : 'Failed · No charge',
    defaultTitle: 'Execution Error',
  }
}

const KNOWN_SYMBOL_CANONICAL: Record<string, string> = {
  USDC: 'USDC',
  EURC: 'EURC',
  WETH: 'WETH',
  ETH: 'ETH',
  CIRBTC: 'cirBTC',
  BTC: 'cirBTC',
  WBTC: 'cirBTC',
  'AF-USDC': 'af-USDC',
  AFUSDC: 'af-USDC',
  SOL: 'SOL',
  AVAX: 'AVAX',
  POL: 'POL',
  MATIC: 'POL',
  SEI: 'SEI',
  PHRS: 'PHRS',
  OKB: 'OKB',
  XPL: 'XPL',
}

const TOKEN_MATCH_REGEX = /\b(af-USDC|cirBTC|USDC|EURC|wETH|WETH|ETH|WBTC|BTC)\b/gi

/**
 * Extracts canonical Arcis token symbols in display order from any label, pair, or route string.
 */
export function extractTokenSymbols(text: string | null | undefined, maxCount = 6): string[] {
  if (!text || typeof text !== 'string') return []
  const found: string[] = []
  const seen = new Set<string>()
  const matches = text.match(TOKEN_MATCH_REGEX)
  if (!matches) return []
  for (const raw of matches) {
    const canonical = KNOWN_SYMBOL_CANONICAL[raw.toUpperCase()] ?? raw
    const key = canonical.toUpperCase()
    if (!seen.has(key)) {
      seen.add(key)
      found.push(canonical)
      if (found.length >= maxCount) break
    }
  }
  return found
}

/**
 * Parses a route path like "USDC → EURC → WETH" preserving repeated hops in exact order.
 */
export function parseRouteTokenSequence(path: string | null | undefined): string[] {
  if (!path || typeof path !== 'string') return []
  const parts = path
    .split(/\s*(?:→|->|\/)\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
  const resolved: string[] = []
  for (const part of parts) {
    const upper = part.toUpperCase()
    if (KNOWN_SYMBOL_CANONICAL[upper]) {
      resolved.push(KNOWN_SYMBOL_CANONICAL[upper])
    } else {
      const inner = extractTokenSymbols(part, 1)
      if (inner.length > 0) resolved.push(inner[0])
    }
  }
  return resolved
}

const SERVICE_TOKEN_PRESETS: Record<string, string[]> = {
  'arc-deep-liquidity-slippage-optimizer': ['USDC', 'EURC', 'WETH', 'cirBTC'],
  'arc-cross-dex-arbitrage-sentinel': ['USDC', 'EURC', 'WETH', 'cirBTC'],
  'arc-gateway-fee-route-scout': ['USDC', 'EURC', 'WETH', 'cirBTC'],
  'arc-yield-vault-analytics': ['USDC', 'EURC', 'WETH', 'cirBTC'],
  'arc-portfolio-risk-exposure': ['USDC', 'EURC', 'WETH', 'cirBTC'],
  'arc-vault-yield-tax-report': ['USDC', 'EURC', 'WETH', 'cirBTC'],
  'arc-cross-chain-gateway-flow-indexer': ['USDC'],
}

/**
 * Returns the primary token symbols a service operates on, for catalog cards and headers.
 */
export function getServiceTokenSymbols(service: x402Service): string[] {
  if (SERVICE_TOKEN_PRESETS[service.id]) {
    return SERVICE_TOKEN_PRESETS[service.id]
  }
  const combined: string[] = []
  const seen = new Set<string>()
  const push = (sym: string) => {
    const key = sym.toUpperCase()
    if (!seen.has(key)) {
      seen.add(key)
      combined.push(sym)
    }
  }
  for (const field of service.ui?.form ?? []) {
    for (const opt of field.options ?? []) {
      for (const sym of extractTokenSymbols(`${opt.value} ${opt.label}`, 4)) {
        push(sym)
      }
    }
  }
  for (const sym of extractTokenSymbols(`${service.name} ${service.tagline} ${service.description}`, 4)) {
    push(sym)
  }
  if (combined.length === 0) push('USDC')
  return combined.slice(0, 4)
}

/**
 * Infers a coin icon symbol for a KPI metric key when the metric is explicitly USDC-denominated.
 */
export function inferMetricTokenSymbol(metricKey: string): string | null {
  if (/usdc$/i.test(metricKey) || metricKey === 'tvlUsdc' || metricKey === 'sharePriceUsdc') {
    return 'USDC'
  }
  if (/eurc$/i.test(metricKey)) return 'EURC'
  if (/weth$/i.test(metricKey)) return 'WETH'
  if (/cirbtc$/i.test(metricKey)) return 'cirBTC'
  return null
}

/**
 * Infers an optional semantic tone for a numeric KPI card based on key and numeric value.
 */
export function inferMetricAccentTone(
  metricKey: string,
  numericValue: number
): MarketplaceStatusTone | null {
  if (
    metricKey === 'estimatedProfitUsdc' ||
    metricKey === 'netProfitUsdc' ||
    metricKey === 'netProfitPct' ||
    metricKey === 'savingsUsdc' ||
    metricKey === 'pendingYieldUsdc' ||
    metricKey === 'unrealizedYieldUsdc' ||
    metricKey === 'totalPendingLpFeesUsd' ||
    metricKey === 'totalHarvestableYieldAndFeesUsd' ||
    metricKey === 'apy' ||
    metricKey === 'yieldApy'
  ) {
    return numericValue > 0 ? 'success' : null
  }
  if (metricKey === 'netUsdcInflowUsdc') {
    if (numericValue > 0) return 'success'
    if (numericValue < 0) return 'cancelled'
    return 'info'
  }
  if (
    metricKey === 'overallPriceImpactPct' ||
    metricKey === 'priceImpactPct' ||
    metricKey === 'ammPriceImpactPct'
  ) {
    if (numericValue >= 2) return 'error'
    if (numericValue >= 1) return 'cancelled'
    return 'success'
  }
  if (metricKey === 'concentrationPct') {
    if (numericValue > 75) return 'error'
    if (numericValue > 50) return 'cancelled'
    return 'success'
  }
  if (metricKey === 'tradeReserveExposurePct') {
    if (numericValue >= 5) return 'error'
    if (numericValue >= 2) return 'cancelled'
    return 'success'
  }
  return null
}
