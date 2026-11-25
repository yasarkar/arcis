// src/components/marketplace/TradeExecutionTicketReport.tsx
// Zero-Fluff Execution Ticket for Smart Trade & Execution Advisor (`arc-deep-liquidity-slippage-optimizer`).
// Implements the 4-block Figma design (Hero Trade Ticket + 3-Column Visual Signals +
// Pixel-Aligned Route Comparison Table + Progressive Disclosure Audit Bar) using Arcis DESIGN.md tokens.

import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import type { CopilotUcwHandlers } from '../../services/copilot/copilotCommon'
import { soundService } from '../../services/soundService'
import type { ActionableSignalPayload } from '../../types/marketplace'
import { PortfolioAssetIcon } from '../portfolio/PortfolioAssetIcon'
import {
  extractTokenSymbols,
  getStatusToneStyle,
  resolveRiskSeverityTone,
  STATUS_TONES,
  type MarketplaceStatusTone,
} from './marketplaceDesign'
import { TokenIconBadge } from './MarketplaceVisualPrimitives'
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

function formatShortGas(gas: number): string {
  if (!Number.isFinite(gas)) return '—'
  return gas > 0 && gas < 0.01 ? `$${gas.toFixed(4)}` : `$${gas.toFixed(2)}`
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

  const auditSummaryLine =
    elevatedAlerts.length > 0
      ? `${elevatedAlerts.length} ${elevatedAlerts.length === 1 ? 'alert' : 'alerts'} · ${isSplitRecommended
        ? `Exceeds 5% pool depth — split into ${batchCount} batches`
        : String(elevatedAlerts[0]?.title || 'Review execution risk details')
      }`
      : recommendedHops === 2 && twoHopGainPct > 0
        ? `2-Hop beats direct by +${twoHopGainPct.toFixed(2)}% after gas · Step 2 auto-quotes live`
        : `All checks passed · Single-tx safe on Arc FIFO · Max slippage ${slippagePct}%`

  return (
    <div className="space-y-3.5">
      {/* ── BLOCK 1: HERO TRADE TICKET (Decision + Key Specs + Integrated Action) ── */}
      <div
        className="p-4 sm:p-5 rounded-2xl border space-y-4 relative overflow-hidden"
        style={{
          background: 'linear-gradient(145deg, rgba(23, 28, 50, 0.92) 0%, rgba(11, 14, 26, 0.96) 100%)',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          boxShadow: '0 10px 28px -10px rgba(0, 0, 0, 0.55)',
        }}
      >
        {/* Center Trade Flow: Sell ⟶ Expected Output */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          <div className="space-y-1 min-w-0">
            <span
              className="text-[9.5px] font-mono uppercase tracking-[1.3px] block"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--fp-4)' }}
            >
              Sell Amount
            </span>
            <div className="inline-flex items-center gap-1.5">
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
              backgroundColor: 'rgba(152, 150, 255, 0.12)',
              borderColor: 'rgba(152, 150, 255, 0.30)',
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
            <div className="inline-flex items-center gap-1.5 sm:justify-end">
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

        {/* Hairline Divider + 3-Column Key Specs Strip */}
        <div className="pt-3.5 border-t border-white/[0.07] grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-0.5">
            <span
              className="text-[9.5px] font-mono uppercase tracking-[1.1px] block"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--fp-4)' }}
            >
              Min. Guaranteed ({slippagePct}%)
            </span>
            <span
              className="text-[13px] font-medium text-white tabular-nums block"
              style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
            >
              {minGuaranteed || '—'}
            </span>
          </div>

          <div className="space-y-0.5">
            <span
              className="text-[9.5px] font-mono uppercase tracking-[1.1px] block"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--fp-4)' }}
            >
              Effective Rate
            </span>
            <span
              className="text-[13px] font-medium text-white tabular-nums block"
              style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
            >
              {execRate !== null ? `1 ${fromSym} = ${formatRate(execRate)} ${toSym}` : '—'}
            </span>
          </div>

          <div className="space-y-0.5 sm:text-right">
            <span
              className="text-[9.5px] font-mono uppercase tracking-[1.1px] block"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--fp-4)' }}
            >
              {gasLabel}
            </span>
            <span
              className="text-[13px] font-medium text-white tabular-nums inline-flex items-center gap-1.5 sm:justify-end"
              style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
            >
              {estGas !== null ? (
                <>
                  <span>{formatGasUsdc(estGas)}</span>
                </>
              ) : (
                <span>—</span>
              )}
            </span>
          </div>
        </div>

        {/* Visual Split-Batch Plan (State C — replaces multi-sentence sizing paragraphs) */}
        {isSplitRecommended && executionSizing && (
          <div
            className="p-3 rounded-xl border space-y-2.5"
            style={{
              backgroundColor: STATUS_TONES.cancelled.bg,
              borderColor: STATUS_TONES.cancelled.border,
            }}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="w-3.5 h-3.5 shrink-0 mt-0.5"
                style={{ color: STATUS_TONES.cancelled.accent }}
              />
              <span
                className="text-xs font-semibold leading-snug"
                style={{ color: STATUS_TONES.cancelled.fg }}
              >
                {reserveExp !== null ? `${reserveExp.toFixed(1)}% of pool depth — ` : ''}
                split into {batchCount} spaced batches
                {typeof executionSizing.singleSwapAmmPriceImpactPct === 'number' &&
                  typeof executionSizing.perBatchAmmPriceImpactPct === 'number' &&
                  executionSizing.perBatchAmmPriceImpactPct < executionSizing.singleSwapAmmPriceImpactPct
                  ? ` to cut AMM impact ${executionSizing.singleSwapAmmPriceImpactPct.toFixed(1)}% → ${executionSizing.perBatchAmmPriceImpactPct.toFixed(1)}%`
                  : ' to reduce AMM curve pressure'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="px-2.5 py-2 rounded-lg border border-white/[0.07] bg-black/35">
                <span
                  className="text-[8.5px] font-mono uppercase tracking-[1px] block"
                  style={{ color: 'var(--fp-4)', fontFamily: 'var(--fonts--space-mono)' }}
                >
                  Batches
                </span>
                <span
                  className="text-xs font-bold tabular-nums mt-0.5 block"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)', color: STATUS_TONES.cancelled.fg }}
                >
                  {batchCount} × Swaps
                </span>
              </div>

              <div className="px-2.5 py-2 rounded-lg border border-white/[0.07] bg-black/35">
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

              <div className="px-2.5 py-2 rounded-lg border border-white/[0.07] bg-black/35">
                <span
                  className="text-[8.5px] font-mono uppercase tracking-[1px] block"
                  style={{ color: 'var(--fp-4)', fontFamily: 'var(--fonts--space-mono)' }}
                >
                  Batch 1 Out
                </span>
                <span
                  className="text-xs font-bold tabular-nums mt-0.5 inline-flex items-center gap-1.5"
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

              <div className="px-2.5 py-2 rounded-lg border border-white/[0.07] bg-black/35">
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

      {/* ── BLOCK 2: 3-COLUMN VISUAL SIGNAL & GAUGE STRIP (Equal Height, Zero Paragraphs) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* 1. AMM Price Impact + Micro-Gauge */}
        <div
          className="p-3.5 rounded-2xl border flex flex-col justify-between gap-2"
          style={{
            background: 'linear-gradient(155deg, rgba(20, 24, 42, 0.85) 0%, rgba(12, 15, 26, 0.94) 100%)',
            borderColor: ammTone ? ammTone.border : 'rgba(172, 198, 233, 0.14)',
          }}
        >
          <span
            className="text-[9.5px] font-mono font-bold uppercase tracking-[1.2px] block"
            style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--secondary-colors--sky-sync)' }}
          >
            {isSplitRecommended
              ? 'Full-Order Impact'
              : recommendedHops === 2
                ? 'Combined AMM Impact'
                : 'AMM Price Impact'}
          </span>
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
            <div className="w-full h-1.5 rounded-full bg-black/50 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.round(ammGaugePct * 100)}%`,
                  backgroundColor: ammTone ? ammTone.accent : 'var(--purple-1)',
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
            background: 'linear-gradient(155deg, rgba(20, 24, 42, 0.85) 0%, rgba(12, 15, 26, 0.94) 100%)',
            borderColor: oracleTone ? oracleTone.border : 'rgba(172, 198, 233, 0.14)',
          }}
        >
          <span
            className="text-[9.5px] font-mono font-bold uppercase tracking-[1.2px] block"
            style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--secondary-colors--sky-sync)' }}
          >
            vs. Oracle Spot
          </span>
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
                    ? 'Severe curve slippage'
                    : 'Below oracle spot'}
          </span>
        </div>

        {/* 3. Pool Reserve Pressure + 5% Caution Tick Gauge */}
        <div
          className="p-3.5 rounded-2xl border flex flex-col justify-between gap-2"
          style={{
            background: 'linear-gradient(155deg, rgba(20, 24, 42, 0.85) 0%, rgba(12, 15, 26, 0.94) 100%)',
            borderColor: reserveTone ? reserveTone.border : 'rgba(172, 198, 233, 0.14)',
          }}
        >
          <span
            className="text-[9.5px] font-mono font-bold uppercase tracking-[1.2px] block"
            style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--secondary-colors--sky-sync)' }}
          >
            {recommendedHops === 2 ? 'Bottleneck Pressure' : 'Reserve Pressure'}
          </span>
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
            <div className="relative w-full h-1.5 rounded-full bg-black/50 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.round(reserveGaugePct * 100)}%`,
                  backgroundColor: reserveTone ? reserveTone.accent : STATUS_TONES.info.accent,
                }}
              />
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-white/75"
                style={{ left: `${Math.round(reserveTickPct * 100)}%` }}
                title="5% pool depth caution threshold"
              />
            </div>
          )}
          <span className="text-[10px] font-mono block tabular-nums truncate" style={{ color: 'var(--fp-4)' }}>
            {poolReserveUsd !== null
              ? `Depth: $${Math.round(poolReserveUsd).toLocaleString('en-US')} · ${reserveExp !== null && reserveExp > 5 ? 'Over 5%' : 'Limit 5%'}`
              : data.sandwichRiskLevel
                ? `Risk: ${data.sandwichRiskLevel}`
                : 'Pool depth unavailable'}
          </span>
        </div>
      </div>

      {/* ── BLOCK 3: PIXEL-ALIGNED ROUTE COMPARISON TABLE ── */}
      {routeComparison.length > 0 && (
        <div
          className="rounded-2xl border border-white/[0.08] overflow-hidden"
          style={{ backgroundColor: 'rgba(15, 19, 34, 0.72)' }}
        >
          <div className="px-4 py-2.5 bg-black/30 flex items-center justify-between gap-2 border-b border-white/[0.06]">
            <span
              className="text-[10px] font-mono font-bold uppercase tracking-[1.4px]"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--secondary-colors--sky-sync)' }}
            >
              Route Comparison
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr
                  className="border-b border-white/[0.06] text-[9px] font-mono uppercase tracking-[1px]"
                  style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--fp-4)' }}
                >
                  <th className="py-2 pl-4 pr-2 font-normal">Path</th>
                  <th className="py-2 px-2 font-normal text-right">Expected Out</th>
                  <th className="py-2 px-2 font-normal text-right">vs Best</th>
                  <th className="py-2 px-2 font-normal text-right">AMM / Fee</th>
                  <th className="py-2 pl-2 pr-4 font-normal text-right">Gas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05] text-xs tabular-nums">
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

                  return (
                    <tr
                      key={route.path || idx}
                      style={isBest ? { backgroundColor: STATUS_TONES.success.bg } : undefined}
                    >
                      <td className="py-2.5 pl-4 pr-2 whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <span
                            className={`text-xs ${isBest ? 'font-semibold text-white' : 'text-white/75'}`}
                            style={{ fontFamily: 'var(--font-app)' }}
                          >
                            {route.path}
                          </span>
                          {isBest && (
                            <span
                              className="px-1.5 py-0.5 rounded-full border text-[8.5px] font-mono font-bold uppercase tracking-wider"
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
                        className={`py-2.5 px-2 text-right whitespace-nowrap ${isBest ? 'font-bold text-white' : 'text-white/75'}`}
                        style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                      >
                        {outNum !== null ? formatCompactAmount(outNum) : '—'}
                      </td>
                      <td
                        className="py-2.5 px-2 text-right font-mono text-[10.5px] font-bold whitespace-nowrap"
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
                        className="py-2.5 px-2 text-right font-mono text-[10.5px] whitespace-nowrap"
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
                        className="py-2.5 pl-2 pr-4 text-right font-mono text-[10.5px] whitespace-nowrap"
                        style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--fp-4)' }}
                      >
                        {gasNum !== null ? formatShortGas(gasNum) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── BLOCK 4: PROGRESSIVE DISCLOSURE AUDIT BAR (Collapsed by Default) ── */}
      {riskRegister.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden transition-colors"
          style={{
            backgroundColor: 'rgba(10, 13, 23, 0.92)',
            borderColor: auditToneStyle.border,
          }}
        >
          <button
            type="button"
            aria-expanded={auditOpen}
            onClick={() => {
              soundService.play('pop')
              setAuditOpen((prev) => !prev)
            }}
            className="ai-focus-ring w-full px-3.5 py-2.5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-white/[0.025] transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              {elevatedAlerts.length > 0 ? (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: auditToneStyle.accent }} />
              ) : recommendedHops === 2 ? (
                <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: STATUS_TONES.pending.accent }} />
              ) : (
                <Check className="w-3.5 h-3.5 shrink-0" style={{ color: STATUS_TONES.success.accent }} />
              )}
              <span
                className="text-[11.5px] font-medium truncate"
                style={{
                  color: elevatedAlerts.length > 0 ? STATUS_TONES.cancelled.fg : 'rgba(255, 255, 255, 0.82)',
                }}
              >
                {auditSummaryLine}
              </span>
            </div>

            <span
              className="inline-flex items-center gap-1 text-[10px] font-mono font-bold shrink-0"
              style={{ fontFamily: 'var(--fonts--space-mono)', color: 'var(--secondary-colors--sky-sync)' }}
            >
              <span>{auditOpen ? 'Hide Audit' : `Audit (${riskRegister.length})`}</span>
              {auditOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </button>

          {auditOpen && (
            <div className="px-3.5 pb-3 pt-2.5 border-t border-white/[0.07] space-y-2 animate-fade-in">
              {riskRegister.map((entry, idx) => {
                const sev = String(entry?.severity ?? 'INFO').toUpperCase()
                const tone = getStatusToneStyle(resolveRiskSeverityTone(sev))
                const metric = extractAuditMetric(entry)
                return (
                  <div
                    key={`${String(entry?.id ?? 'audit')}-${idx}`}
                    className="px-3 py-2.5 rounded-xl border flex items-center justify-between gap-3"
                    style={{
                      backgroundColor: 'rgba(17, 21, 38, 0.7)',
                      borderColor: tone.border,
                    }}
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span
                        className="px-1.5 py-0.5 rounded-md text-[8.5px] font-mono font-bold uppercase tracking-wider shrink-0 mt-0.5"
                        style={{
                          fontFamily: 'var(--fonts--space-mono)',
                          color: tone.fg,
                          backgroundColor: tone.pillBg,
                        }}
                      >
                        {sev}
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
