// src/components/marketplace/TradeExecutionTicketReport.tsx
// Zero-Fluff Execution Ticket for Smart Trade & Execution Advisor (`arc-deep-liquidity-slippage-optimizer`).
// Implements the 4-block Figma design (Hero Trade Ticket + 3-Column Visual Signals +
// Pixel-Aligned Route Comparison Table + Progressive Disclosure Audit Bar) using Arcis DESIGN.md tokens.

import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useState } from 'react'
import type { CopilotUcwHandlers } from '../../services/copilot/copilotCommon'
import { soundService } from '../../services/soundService'
import { resolveTradeExecutionVerdict } from '../../services/x402/tradeExecutionAdvisor'
import type { ActionableSignalPayload } from '../../types/marketplace'
import { PortfolioAssetIcon } from '../portfolio/PortfolioAssetIcon'
import {
  extractTokenSymbols,
  getStatusToneStyle,
  resolveRiskSeverityTone,
  STATUS_TONES,
  type MarketplaceStatusTone,
} from './marketplaceDesign'
import { ExecutionStarRating, TokenIconBadge, TokenPairIcons } from './MarketplaceVisualPrimitives'
import ServiceActionCard from './ServiceActionCard'

interface TradeExecutionTicketReportProps {
  data: Record<string, any>
  actionablePayload?: ActionableSignalPayload
  walletAddress?: string
  walletConnected?: boolean
  ucwHandlers?: CopilotUcwHandlers
  onNavigateTab?: (tab: string) => void
}

function formatRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '—'
  if (rate < 0.001) return rate.toLocaleString('en-US', { maximumFractionDigits: 6 })
  if (rate < 1) return rate.toLocaleString('en-US', { maximumFractionDigits: 6 })
  return rate.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function formatGasUsdc(gas: number): string {
  if (!Number.isFinite(gas)) return '—'
  if (gas > 0 && gas < 0.01) {
    return `${gas.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} USDC`
  }
  return `${gas.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`
}

function formatShortGasUsdc(gas: number): string {
  if (!Number.isFinite(gas)) return '—'
  return gas > 0 && gas < 0.01 ? `${gas.toFixed(4)} USDC` : `${gas.toFixed(2)} USDC`
}

function formatCompactAmount(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 100) return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (value >= 0.1) return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

function extractAuditMetric(entry: any): string | null {
  const ev = entry?.evidence && typeof entry.evidence === 'object' ? entry.evidence : null
  if (!ev) return null
  if (typeof ev.tradeReserveExposurePct === 'number') return `${ev.tradeReserveExposurePct.toFixed(2)}%`
  if (typeof ev.twoHopOutputGainPct === 'number' && ev.twoHopOutputGainPct > 0) {
    return `+${ev.twoHopOutputGainPct.toFixed(2)}%`
  }
  if (typeof ev.ammPriceImpactPct === 'number') return `${ev.ammPriceImpactPct.toFixed(2)}%`
  if (typeof ev.priceImpactPct === 'number') return `${ev.priceImpactPct.toFixed(2)}%`
  return null
}

export default function TradeExecutionTicketReport({
  data,
  actionablePayload,
  walletAddress,
  walletConnected,
  ucwHandlers,
  onNavigateTab,
}: TradeExecutionTicketReportProps) {
  const [auditOpen, setAuditOpen] = useState(false)

  const fromSym =
    typeof data.fromToken === 'string'
      ? data.fromToken
      : extractTokenSymbols(String(data.inputAmount || ''), 1)[0] || 'USDC'
  const toSym =
    typeof data.toToken === 'string'
      ? data.toToken
      : extractTokenSymbols(String(data.expectedOutput || ''), 1)[0] || 'WETH'

  const recommendedHops: 1 | 2 = data.recommendedHops === 2 ? 2 : 1
  const twoHopGainPct =
    typeof data.twoHopOutputGainPct === 'number' && Number.isFinite(data.twoHopOutputGainPct)
      ? data.twoHopOutputGainPct
      : 0

  const ammImpact = typeof data.ammPriceImpactPct === 'number' ? data.ammPriceImpactPct : null
  const poolFee = typeof data.poolFeePct === 'number' ? data.poolFeePct : null
  const signedOracle = typeof data.signedPriceImpactPct === 'number' ? data.signedPriceImpactPct : null
  const reserveExp = typeof data.tradeReserveExposurePct === 'number' ? data.tradeReserveExposurePct : null
  const poolReserveUsd =
    typeof data.poolReserveUsdc === 'number'
      ? data.poolReserveUsdc
      : typeof data.flashReserveDepthUsdc === 'number'
        ? data.flashReserveDepthUsdc
        : null
  const estGas = typeof data.estimatedGasCostUsdc === 'number' ? data.estimatedGasCostUsdc : null
  const execRate = typeof data.effectiveExecutionPrice === 'number' ? data.effectiveExecutionPrice : null
  const minGuaranteed = typeof data.minGuaranteedOutput === 'string' ? data.minGuaranteedOutput : null

  const executionSizing =
    data.executionSizing && typeof data.executionSizing === 'object' && !Array.isArray(data.executionSizing)
      ? (data.executionSizing as Record<string, any>)
      : null
  const batchCount =
    typeof executionSizing?.recommendedBatchCount === 'number' && executionSizing.recommendedBatchCount > 1
      ? executionSizing.recommendedBatchCount
      : 1
  const isSplitRecommended = batchCount > 1
  const slippagePct =
    typeof executionSizing?.suggestedMaxSlippagePct === 'number'
      ? executionSizing.suggestedMaxSlippagePct
      : 0.5

  const routeComparison: any[] = Array.isArray(data.routeComparison) ? data.routeComparison : []
  const bestRouteOut =
    routeComparison.find((r) => r?.recommended)?.expectedOutput ??
    routeComparison[0]?.expectedOutput ??
    null

  const riskRegister: any[] = Array.isArray(data.riskRegister) ? data.riskRegister : []
  const elevatedAlerts = riskRegister.filter((entry) => {
    const sev = String(entry?.severity ?? 'INFO').toUpperCase()
    return sev === 'CRITICAL' || sev === 'HIGH' || sev === 'MEDIUM'
  })

  const ammTone =
    ammImpact === null
      ? null
      : getStatusToneStyle(ammImpact >= 5 ? 'error' : ammImpact >= 1 ? 'cancelled' : 'success')
  const oracleTone =
    signedOracle === null
      ? null
      : getStatusToneStyle(
        signedOracle < 0 ? 'success' : signedOracle >= 5 ? 'error' : signedOracle >= 1 ? 'cancelled' : 'info'
      )
  const reserveTone =
    reserveExp === null
      ? null
      : getStatusToneStyle(reserveExp > 5 ? 'error' : reserveExp >= 2 ? 'cancelled' : 'success')

  // Gauge fill fractions (0–1)
  const ammGaugePct = ammImpact === null ? 0 : Math.min(1, Math.max(0.06, ammImpact / 12))
  // Scale reserve gauge so 5% caution line sits cleanly at 50% (when <= 10%) or 35% (when > 10%)
  const reserveScaleMax = reserveExp !== null && reserveExp > 10 ? Math.max(15, reserveExp) : 10
  const reserveGaugePct =
    reserveExp === null ? 0 : Math.min(1, Math.max(0.05, reserveExp / reserveScaleMax))
  const reserveTickPct = Math.min(0.85, 5 / reserveScaleMax)

  const gasLabel = isSplitRecommended
    ? `Total Batch Gas (${batchCount}×)`
    : recommendedHops === 2
      ? 'Est. 2-Hop Gas'
      : 'Est. Network Gas'

  const auditTone: MarketplaceStatusTone =
    elevatedAlerts.length > 0
      ? resolveRiskSeverityTone(elevatedAlerts[0]?.severity)
      : recommendedHops === 2
        ? 'pending'
        : 'success'
  const auditToneStyle = getStatusToneStyle(auditTone)

  const computedVerdict = resolveTradeExecutionVerdict({
    ammPriceImpactPct: ammImpact,
    signedPriceImpactPct: signedOracle,
    overallPriceImpactPct:
      typeof data.overallPriceImpactPct === 'number' ? data.overallPriceImpactPct : null,
    tradeReserveExposurePct: reserveExp,
    recommendedBatchCount: batchCount,
    perBatchAmmPriceImpactPct:
      typeof executionSizing?.perBatchAmmPriceImpactPct === 'number'
        ? executionSizing.perBatchAmmPriceImpactPct
        : null,
  })
  const strategistVerdict =
    data.executionVerdict &&
    typeof data.executionVerdict === 'object' &&
    typeof data.executionVerdict.label === 'string' &&
    typeof data.executionVerdict.tone === 'string'
      ? {
          ...computedVerdict,
          ...(data.executionVerdict as Partial<ReturnType<typeof resolveTradeExecutionVerdict>>),
          rating:
            typeof data.executionVerdict.rating === 'number' && Number.isFinite(data.executionVerdict.rating)
              ? data.executionVerdict.rating
              : computedVerdict.rating,
          maxRating: 5 as const,
        }
      : computedVerdict
  const strategistTone = getStatusToneStyle(strategistVerdict.tone)

  const auditSummaryLine =
    elevatedAlerts.length > 0
      ? `${elevatedAlerts.length} ${elevatedAlerts.length === 1 ? 'advisory' : 'advisories'} · ${isSplitRecommended
        ? `Exceeds 5% pool depth split into ${batchCount} spaced batches`
        : String(elevatedAlerts[0]?.title || 'Review execution trade-off details')
      }`
      : recommendedHops === 2 && twoHopGainPct > 0
        ? `2-Hop beats direct by +${twoHopGainPct.toFixed(2)}% after gas · Step 2 auto-quotes live`
        : `All checks passed · Single-tx optimal on Arc FIFO · Max slippage ${slippagePct}%`

  return (
    <div className="space-y-4">
      {/* ── BLOCK 1: STRATEGIST HERO TRADE TICKET (Decision + Key Specs + Integrated Action) ── */}
      <div
        className="p-4 sm:p-5 rounded-2xl border space-y-4 relative overflow-hidden"
        style={{
          background:
            'radial-gradient(circle at top left, rgba(99, 102, 241, 0.10) 0%, rgba(22, 25, 38, 0.94) 45%, #0f111a 100%)',
          borderColor: 'rgba(152, 150, 255, 0.22)',
          boxShadow: '0 12px 32px -12px rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* Strategist Eyebrow + Guidance Summary */}
        <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-[rgba(152,150,255,0.12)]">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: strategistTone.dot }}
                  aria-hidden="true"
                />
                <span
                  className="text-[13px] font-semibold tracking-[0.02em]"
                  style={{
                    fontFamily: 'var(--font-display, Outfit, sans-serif)',
                    color: '#f4f4fb',
                  }}
                >
                  Strategist Recommendation
                </span>
              </div>
              <ExecutionStarRating
                rating={strategistVerdict.rating}
                maxRating={strategistVerdict.maxRating}
                size={18}
                tooltip={`${strategistVerdict.rating.toFixed(1)}/${strategistVerdict.maxRating} — ${strategistVerdict.reason}`}
                ariaLabel={`Execution rating: ${strategistVerdict.rating.toFixed(1)} out of ${strategistVerdict.maxRating} stars`}
              />
            </div>
            <p className="text-xs leading-relaxed text-white/70">
              {strategistVerdict.reason}
            </p>
          </div>
          {typeof data.recommendedPath === 'string' && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-mono tracking-wide shrink-0"
              style={{
                fontFamily: 'var(--fonts--space-mono)',
                backgroundColor: '#0f111a',
                borderColor: 'rgba(152, 150, 255, 0.20)',
                color: 'var(--secondary-colors--sky-sync, #acc6e9)',
              }}
            >
              <TokenPairIcons symbols={extractTokenSymbols(data.recommendedPath, 3)} size={12} />
              <span>{data.recommendedPath}</span>
            </span>
          )}
        </div>

        {/* Center Trade Flow: Sell ⟶ Expected Output */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          <div className="space-y-1 min-w-0">
            <span
              className="text-[9.5px] font-mono uppercase tracking-[1.3px] block"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--fp-4)' }}
            >
              Sell Amount
            </span>
            <div className="inline-flex items-center gap-2">
              <TokenIconBadge symbol={fromSym} size={24} />
              <span
                className="text-xl sm:text-2xl font-bold text-white tabular-nums tracking-tight"
                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
              >
                {data.inputAmount}
              </span>
            </div>
          </div>

          <div
            className="hidden sm:flex items-center justify-center w-9 h-9 rounded-full border shrink-0"
            style={{
              backgroundColor: 'rgba(99, 102, 241, 0.12)',
              borderColor: 'rgba(152, 150, 255, 0.28)',
              color: 'var(--purple-1)',
            }}
          >
            <ArrowRight className="w-4 h-4" />
          </div>

          <div className="space-y-1 sm:text-right min-w-0">
            <span
              className="text-[9.5px] font-mono uppercase tracking-[1.3px] block"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--fp-4)' }}
            >
              Expected Output
            </span>
            <div className="inline-flex items-center gap-2 sm:justify-end">
              <TokenIconBadge symbol={toSym} size={24} />
              <span
                className="text-xl sm:text-2xl font-bold tabular-nums tracking-tight"
                style={{
                  fontFamily: 'var(--fonts--space-grotesk)',
                }}
              >
                {data.expectedOutput}
              </span>
            </div>
          </div>
        </div>

        {/* Hairline Divider + 3-Column Key Specs Pills (1x : 1.5x : 1x proportions) */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.3fr_1fr] gap-2.5">
          <div
            className="px-3.5 py-2.5 rounded-xl border space-y-1"
            style={{
              backgroundColor: '#0f111a',
              borderColor: 'rgba(152, 150, 255, 0.16)',
            }}
          >
            <span
              className="text-[9.5px] font-mono uppercase tracking-[1.1px] block"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--fp-4)' }}
            >
              Min. Guaranteed ({slippagePct}%)
            </span>
            <span
              className="text-[13px] font-semibold text-white tabular-nums inline-flex items-center gap-1.5"
              style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
            >
              {minGuaranteed ? (
                <>
                  <PortfolioAssetIcon symbol={toSym} size={14} className="w-3.5 h-3.5 object-contain shrink-0" />
                  <span>{minGuaranteed}</span>
                </>
              ) : (
                <span>—</span>
              )}
            </span>
          </div>

          <div
            className="px-3.5 py-2.5 rounded-xl border space-y-1"
            style={{
              backgroundColor: '#0f111a',
              borderColor: 'rgba(152, 150, 255, 0.16)',
            }}
          >
            <span
              className="text-[9.5px] font-mono uppercase tracking-[1.1px] block"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--fp-4)' }}
            >
              Effective Rate
            </span>
            <span
              className="text-[13px] font-semibold text-white tabular-nums inline-flex items-center gap-1 flex-wrap"
              style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
            >
              {execRate !== null ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <PortfolioAssetIcon symbol={fromSym} size={13} className="w-3.5 h-3.5 object-contain shrink-0" />
                    <span>{`1 ${fromSym}`}</span>
                  </span>
                  <span className="text-white/50">=</span>
                  <span className="inline-flex items-center gap-1">
                    <PortfolioAssetIcon symbol={toSym} size={13} className="w-3.5 h-3.5 object-contain shrink-0" />
                    <span>{`${formatRate(execRate)} ${toSym}`}</span>
                  </span>
                </>
              ) : (
                <span>—</span>
              )}
            </span>
          </div>

          <div
            className="px-3.5 py-2.5 rounded-xl border space-y-1 sm:text-left"
            style={{
              backgroundColor: '#0f111a',
              borderColor: 'rgba(152, 150, 255, 0.16)',
            }}
          >
            <span
              className="text-[9.5px] font-mono uppercase tracking-[1.1px] block"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--fp-4)' }}
            >
              {gasLabel}
            </span>
            <span
              className="text-[13px] font-semibold tabular-nums inline-flex items-center gap-1.5 sm:justify-end"
              style={{ fontFamily: 'var(--fonts--space-grotesk)', color: 'var(--secondary-colors--sky-sync, #acc6e9)' }}
            >
              {estGas !== null ? (
                <>
                  <PortfolioAssetIcon symbol="USDC" size={14} className="w-3.5 h-3.5 object-contain shrink-0" />
                  <span>{formatGasUsdc(estGas)}</span>
                </>
              ) : (
                <span>—</span>
              )}
            </span>
          </div>
        </div>

        {/* Visual Split-Batch Plan (Calm Obsidian + Indigo) */}
        {isSplitRecommended && executionSizing && (
          <div
            className="p-3.5 rounded-xl border space-y-2.5"
            style={{
              backgroundColor: '#0f111a',
              borderColor: 'rgba(152, 150, 255, 0.22)',
            }}
          >
            <div className="flex items-start gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                style={{ backgroundColor: STATUS_TONES.cancelled.dot }}
                aria-hidden="true"
              />
              <span
                className="text-xs font-medium leading-snug"
                style={{ color: STATUS_TONES.cancelled.fg }}
              >
                {reserveExp !== null ? `${reserveExp.toFixed(1)}% of pool depth and ` : ''}
                split into {batchCount} spaced batches
                {typeof executionSizing.singleSwapAmmPriceImpactPct === 'number' &&
                  typeof executionSizing.perBatchAmmPriceImpactPct === 'number' &&
                  executionSizing.perBatchAmmPriceImpactPct < executionSizing.singleSwapAmmPriceImpactPct
                  ? ` to reduce AMM impact ${executionSizing.singleSwapAmmPriceImpactPct.toFixed(1)}% → ${executionSizing.perBatchAmmPriceImpactPct.toFixed(1)}%`
                  : ' to reduce AMM curve pressure'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div
                className="px-2.5 py-2 rounded-lg border"
                style={{ backgroundColor: '#161926', borderColor: 'rgba(152, 150, 255, 0.14)' }}
              >
                <span
                  className="text-[8.5px] font-mono uppercase tracking-[1px] block"
                  style={{ color: 'var(--fp-4)', fontFamily: 'var(--fonts--space-mono)' }}
                >
                  Batches
                </span>
                <span
                  className="text-xs font-bold tabular-nums mt-0.5 block"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)', color: '#c4c2ff' }}
                >
                  {batchCount} × Swaps
                </span>
              </div>

              <div
                className="px-2.5 py-2 rounded-lg border"
                style={{ backgroundColor: '#161926', borderColor: 'rgba(152, 150, 255, 0.14)' }}
              >
                <span
                  className="text-[8.5px] font-mono uppercase tracking-[1px] block"
                  style={{ color: 'var(--fp-4)', fontFamily: 'var(--fonts--space-mono)' }}
                >
                  Per Batch
                </span>
                <span
                  className="text-xs font-bold text-white tabular-nums mt-0.5 inline-flex items-center gap-1.5"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                >
                  <PortfolioAssetIcon symbol={fromSym} size={14} className="w-3.5 h-3.5 object-contain shrink-0" />
                  <span>
                    {formatCompactAmount(Number(executionSizing.perBatchInputAmount))} {fromSym}
                  </span>
                </span>
              </div>

              <div
                className="px-2.5 py-2 rounded-lg border"
                style={{ backgroundColor: '#161926', borderColor: 'rgba(152, 150, 255, 0.14)' }}
              >
                <span
                  className="text-[8.5px] font-mono uppercase tracking-[1px] block"
                  style={{ color: 'var(--fp-4)', fontFamily: 'var(--fonts--space-mono)' }}
                >
                  Batch 1 Out
                </span>
                <span
                  className="text-xs font-bold text-white tabular-nums mt-0.5 inline-flex items-center gap-1.5"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                >
                  {typeof executionSizing.perBatchExpectedOutput === 'number' ? (
                    <>
                      <PortfolioAssetIcon symbol={toSym} size={14} className="w-3.5 h-3.5 object-contain shrink-0" />
                      <span>
                        {formatCompactAmount(executionSizing.perBatchExpectedOutput)} {toSym}
                      </span>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </span>
              </div>

              <div
                className="px-2.5 py-2 rounded-lg border"
                style={{ backgroundColor: '#161926', borderColor: 'rgba(152, 150, 255, 0.14)' }}
              >
                <span
                  className="text-[8.5px] font-mono uppercase tracking-[1px] block"
                  style={{ color: 'var(--fp-4)', fontFamily: 'var(--fonts--space-mono)' }}
                >
                  Batch 1 Impact
                </span>
                <span
                  className="text-xs font-bold tabular-nums mt-0.5 block"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)', color: STATUS_TONES.success.fg }}
                >
                  {typeof executionSizing.perBatchAmmPriceImpactPct === 'number'
                    ? `${executionSizing.perBatchAmmPriceImpactPct.toFixed(2)}%`
                    : '—'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Integrated 1-Click Action Bar (Embedded ServiceActionCard) */}
        {actionablePayload && (
          <div className="pt-1">
            <ServiceActionCard
              variant="inline"
              payload={actionablePayload}
              walletAddress={walletAddress}
              walletConnected={walletConnected}
              ucwHandlers={ucwHandlers}
              onNavigateTab={onNavigateTab}
            />
          </div>
        )}
      </div>

      {/* ── BLOCK 2: 3-COLUMN VISUAL SIGNAL & GAUGE STRIP (Calm Obsidian + 6px Status Dots) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* 1. AMM Price Impact + Micro-Gauge */}
        <div
          className="p-3.5 rounded-2xl border flex flex-col justify-between gap-2"
          style={{
            backgroundColor: '#0f111a',
            borderColor: 'rgba(152, 150, 255, 0.16)',
          }}
        >
          <div className="flex items-center gap-1.5">
            {ammTone && (
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: ammTone.dot }}
                aria-hidden="true"
              />
            )}
            <span
              className="text-[9.5px] font-mono font-bold uppercase tracking-[1.2px] block truncate"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--secondary-colors--sky-sync)' }}
            >
              {isSplitRecommended
                ? 'Full-Order Impact'
                : recommendedHops === 2
                  ? 'Combined AMM Impact'
                  : 'AMM Price Impact'}
            </span>
          </div>
          <div
            className="text-xl font-bold tabular-nums leading-none"
            style={{
              fontFamily: 'var(--fonts--space-grotesk)',
              color: ammTone ? ammTone.fg : '#ffffff',
            }}
          >
            {ammImpact !== null ? `${ammImpact.toFixed(2)}%` : '—'}
          </div>
          {ammImpact !== null && (
            <div className="w-full h-1.5 rounded-full bg-[#161926] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.round(ammGaugePct * 100)}%`,
                  backgroundColor: ammTone ? ammTone.dot : 'var(--purple-1)',
                }}
              />
            </div>
          )}
          <span className="text-[10px] font-mono block tabular-nums" style={{ color: 'var(--fp-4)' }}>
            {isSplitRecommended && typeof executionSizing?.perBatchAmmPriceImpactPct === 'number'
              ? `Batch 1 drops to ${executionSizing.perBatchAmmPriceImpactPct.toFixed(2)}%`
              : poolFee !== null
                ? `LP Fee: ${poolFee.toFixed(2)}%${recommendedHops === 2 ? ' (2 legs)' : ' · Curve only'}`
                : 'Measured from live reserves'}
          </span>
        </div>

        {/* 2. vs. Oracle Spot */}
        <div
          className="p-3.5 rounded-2xl border flex flex-col justify-between gap-2"
          style={{
            backgroundColor: '#0f111a',
            borderColor: 'rgba(152, 150, 255, 0.16)',
          }}
        >
          <div className="flex items-center gap-1.5">
            {oracleTone && (
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: oracleTone.dot }}
                aria-hidden="true"
              />
            )}
            <span
              className="text-[9.5px] font-mono font-bold uppercase tracking-[1.2px] block"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--secondary-colors--sky-sync)' }}
            >
              vs. Oracle Spot
            </span>
          </div>
          <div
            className="text-xl font-bold tabular-nums leading-none"
            style={{
              fontFamily: 'var(--fonts--space-grotesk)',
              color: oracleTone ? oracleTone.fg : '#ffffff',
            }}
          >
            {signedOracle === null
              ? '—'
              : signedOracle < 0
                ? `+${Math.abs(signedOracle).toFixed(2)}%`
                : signedOracle === 0
                  ? '0.00%'
                  : `-${signedOracle.toFixed(2)}%`}
          </div>
          <span className="text-[10px] font-mono block" style={{ color: 'var(--fp-4)' }}>
            {signedOracle === null
              ? 'Oracle feed unavailable'
              : recommendedHops === 2 && twoHopGainPct > 0
                ? `Outperforms direct +${twoHopGainPct.toFixed(2)}%`
                : signedOracle < 0
                  ? 'Better than market spot'
                  : signedOracle >= 5
                    ? 'Elevated curve spread'
                    : 'Below oracle spot'}
          </span>
        </div>

        {/* 3. Pool Reserve Pressure + 5% Caution Tick Gauge (USDC with Icon, NO $) */}
        <div
          className="p-3.5 rounded-2xl border flex flex-col justify-between gap-2"
          style={{
            backgroundColor: '#0f111a',
            borderColor: 'rgba(152, 150, 255, 0.16)',
          }}
        >
          <div className="flex items-center gap-1.5">
            {reserveTone && (
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: reserveTone.dot }}
                aria-hidden="true"
              />
            )}
            <span
              className="text-[9.5px] font-mono font-bold uppercase tracking-[1.2px] block truncate"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--secondary-colors--sky-sync)' }}
            >
              {recommendedHops === 2 ? 'Bottleneck Pressure' : 'Reserve Pressure'}
            </span>
          </div>
          <div
            className="text-xl font-bold tabular-nums leading-none"
            style={{
              fontFamily: 'var(--fonts--space-grotesk)',
              color: reserveTone ? reserveTone.fg : '#ffffff',
            }}
          >
            {reserveExp !== null ? `${reserveExp.toFixed(2)}%` : '—'}
          </div>
          {reserveExp !== null && (
            <div className="relative w-full h-1.5 rounded-full bg-[#161926] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.round(reserveGaugePct * 100)}%`,
                  backgroundColor: reserveTone ? reserveTone.dot : STATUS_TONES.info.dot,
                }}
              />
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-white/75"
                style={{ left: `${Math.round(reserveTickPct * 100)}%` }}
                title="5% pool depth threshold"
              />
            </div>
          )}
          <span
            className="text-[10px] font-mono inline-flex items-center gap-1 tabular-nums truncate"
            style={{ color: 'var(--fp-4)' }}
          >
            {poolReserveUsd !== null ? (
              <>
                <PortfolioAssetIcon symbol="USDC" size={12} className="w-3 h-3 object-contain shrink-0" />
                <span className="truncate">
                  {`Depth: ${Math.round(poolReserveUsd).toLocaleString('en-US')} USDC · ${reserveExp !== null && reserveExp > 5 ? 'Over 5%' : 'Limit 5%'}`}
                </span>
              </>
            ) : data.sandwichRiskLevel ? (
              <span>{`Risk: ${data.sandwichRiskLevel}`}</span>
            ) : (
              <span>Pool depth unavailable</span>
            )}
          </span>
        </div>
      </div>

      {/* ── BLOCK 3: EXECUTION PATH COMPARISON TABLE (Stitch Obsidian + Indigo Best Path + Token Icons) ── */}
      {routeComparison.length > 0 && (
        <div
          className="rounded-2xl border overflow-hidden"
          style={{
            backgroundColor: '#0f111a',
            borderColor: 'rgba(152, 150, 255, 0.16)',
          }}
        >
          <div
            className="px-4 py-2.5 flex items-center justify-between gap-2 border-b"
            style={{
              backgroundColor: 'rgba(22, 25, 38, 0.55)',
              borderColor: 'rgba(152, 150, 255, 0.12)',
            }}
          >
            <div className="inline-flex items-center gap-2">
              <span
                className="text-[10.5px] font-mono font-semibold uppercase tracking-[1.6px]"
                style={{
                  fontFamily: 'var(--fonts--space-mono)',
                  color: 'var(--secondary-colors--sky-sync, #acc6e9)',
                }}
              >
                Route Comparison
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr
                  className="border-b text-[9px] font-mono uppercase tracking-[1px]"
                  style={{
                    fontFamily: 'var(--fonts--space-mono)',
                    color: 'var(--fp-4)',
                    borderColor: 'rgba(152, 150, 255, 0.10)',
                  }}
                >
                  <th className="py-2.5 pl-4 pr-2 font-normal">Path</th>
                  <th className="py-2.5 px-2 font-normal text-right">Expected Out</th>
                  <th className="py-2.5 px-2 font-normal text-right">vs Best</th>
                  <th className="py-2.5 px-2 font-normal text-right">AMM / Fee</th>
                  <th className="py-2.5 pl-2 pr-4 font-normal text-right">Gas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(152,150,255,0.08)] text-xs tabular-nums">
                {routeComparison.map((route: any, idx: number) => {
                  const isBest = Boolean(route.recommended)
                  const outNum = typeof route.expectedOutput === 'number' ? route.expectedOutput : null
                  const deltaPct =
                    !isBest && outNum !== null && typeof bestRouteOut === 'number' && bestRouteOut > 0
                      ? ((outNum - bestRouteOut) / bestRouteOut) * 100
                      : null
                  const ammPct = typeof route.ammPriceImpactPct === 'number' ? route.ammPriceImpactPct : null
                  const feePct = typeof route.poolFeePct === 'number' ? route.poolFeePct : null
                  const gasNum = typeof route.estimatedGasUsdc === 'number' ? route.estimatedGasUsdc : null
                  const routeSymbols = extractTokenSymbols(String(route.path || ''), 3)

                  return (
                    <tr
                      key={route.path || idx}
                      className="transition-colors hover:bg-[#161926]/70"
                      style={
                        isBest
                          ? {
                              backgroundColor: 'rgba(99, 102, 241, 0.09)',
                              boxShadow: 'inset 2px 0 0 #6366f1',
                            }
                          : undefined
                      }
                    >
                      <td className="py-3 pl-4 pr-2 whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: isBest ? '#818cf8' : 'rgba(172, 198, 233, 0.35)' }}
                            aria-hidden="true"
                          />
                          {routeSymbols.length > 0 && <TokenPairIcons symbols={routeSymbols} size={14} />}
                          <span
                            className={`text-xs ${isBest ? 'font-semibold text-white' : 'text-white/75'}`}
                            style={{ fontFamily: 'var(--font-app)' }}
                          >
                            {route.path}
                          </span>
                          {isBest && (
                            <span
                              className="px-2 py-0.5 rounded-full border text-[8.5px] font-mono font-bold uppercase tracking-wider"
                              style={{
                                fontFamily: 'var(--fonts--space-mono)',
                                color: STATUS_TONES.success.fg,
                                backgroundColor: STATUS_TONES.success.pillBg,
                                borderColor: STATUS_TONES.success.pillBorder,
                              }}
                            >
                              Best
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        className={`py-3 px-2 text-right whitespace-nowrap ${isBest ? 'font-bold text-white' : 'text-white/75'}`}
                        style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                      >
                        {outNum !== null ? (
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <PortfolioAssetIcon symbol={toSym} size={13} className="w-3.5 h-3.5 object-contain shrink-0" />
                            <span>
                              {formatCompactAmount(outNum)} {toSym}
                            </span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td
                        className="py-3 px-2 text-right font-mono text-[10.5px] font-bold whitespace-nowrap"
                        style={{
                          fontFamily: 'var(--fonts--space-mono)',
                          color: isBest ? STATUS_TONES.success.fg : 'var(--fp-4)',
                        }}
                      >
                        {isBest
                          ? recommendedHops === 2 && twoHopGainPct > 0
                            ? `+${twoHopGainPct.toFixed(2)}%`
                            : 'Optimal'
                          : deltaPct !== null
                            ? `${deltaPct.toFixed(2)}%`
                            : '—'}
                      </td>
                      <td
                        className="py-3 px-2 text-right font-mono text-[10.5px] whitespace-nowrap"
                        style={{
                          fontFamily: 'var(--fonts--space-mono)',
                          color:
                            ammPct !== null && ammPct >= 5
                              ? STATUS_TONES.error.fg
                              : 'rgba(255, 255, 255, 0.78)',
                        }}
                      >
                        {ammPct !== null ? `${ammPct.toFixed(2)}%` : '—'}
                        {' / '}
                        {feePct !== null ? `${feePct.toFixed(2)}%` : '—'}
                      </td>
                      <td
                        className="py-3 pl-2 pr-4 text-right font-mono text-[10.5px] whitespace-nowrap"
                        style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--fp-4)' }}
                      >
                        {gasNum !== null ? (
                          <span className="inline-flex items-center justify-end gap-1">
                            <PortfolioAssetIcon symbol="USDC" size={12} className="w-3 h-3 object-contain shrink-0" />
                            <span>{formatShortGasUsdc(gasNum)}</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── BLOCK 4: TECHNICAL EVIDENCE & AUDIT ACCORDION (Collapsed by Default) ── */}
      {riskRegister.length > 0 && (
        <div
          className="rounded-2xl border overflow-hidden transition-colors"
          style={{
            backgroundColor: '#0f111a',
            borderColor: 'rgba(152, 150, 255, 0.16)',
          }}
        >
          <button
            type="button"
            aria-expanded={auditOpen}
            onClick={() => {
              soundService.play('pop')
              setAuditOpen((prev) => !prev)
            }}
            className="ai-focus-ring w-full px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-[#161926]/80 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: auditToneStyle.dot }}
                aria-hidden="true"
              />
              <span
                className="text-xs font-medium truncate"
                style={{ color: 'rgba(255, 255, 255, 0.84)' }}
              >
                {auditSummaryLine}
              </span>
            </div>

            <span
              className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold shrink-0"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--secondary-colors--sky-sync)' }}
            >
              {auditOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </button>

          {auditOpen && (
            <div
              className="px-4 pb-3.5 pt-3 border-t space-y-2 animate-fade-in"
              style={{ borderColor: 'rgba(152, 150, 255, 0.10)' }}
            >
              {riskRegister.map((entry, idx) => {
                const sev = String(entry?.severity ?? 'INFO').toUpperCase()
                const tone = getStatusToneStyle(resolveRiskSeverityTone(sev))
                const metric = extractAuditMetric(entry)
                return (
                  <div
                    key={`${String(entry?.id ?? 'audit')}-${idx}`}
                    className="px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3"
                    style={{
                      backgroundColor: '#161926',
                      borderColor: 'rgba(152, 150, 255, 0.14)',
                    }}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[8.5px] font-mono font-semibold uppercase tracking-wider shrink-0 mt-0.5"
                        style={{
                          fontFamily: 'var(--fonts--space-mono)',
                          color: tone.fg,
                          backgroundColor: '#0f111a',
                          borderColor: tone.pillBorder,
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: tone.dot }}
                          aria-hidden="true"
                        />
                        <span>{sev}</span>
                      </span>
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-xs font-semibold text-white leading-snug">
                          {String(entry?.title || 'Execution Check')}
                        </div>
                        <div
                          className="text-[10.5px] font-mono leading-snug"
                          style={{ color: 'var(--fp-4)' }}
                        >
                          {String(entry?.remediation || entry?.finding || '')}
                        </div>
                      </div>
                    </div>
                    {metric && (
                      <span
                        className="text-xs font-bold tabular-nums shrink-0"
                        style={{ fontFamily: 'var(--fonts--space-grotesk)', color: tone.fg }}
                      >
                        {metric}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
