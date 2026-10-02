// src/components/marketplace/ServiceActionCard.tsx
// 1-Click Actionable Signal Executor for Arcis AI Services
// Turns raw intelligence (arbitrage spreads, slippage routes, liquidity alerts)
// into real on-chain Arc Testnet transactions or direct workflow navigation.

import React, { useState } from 'react'
import {
  Zap,
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Clock,
  AlertCircle,
  Coins,
} from 'lucide-react'
import type { ActionableSignalPayload, CopilotActionPayload } from '../../types/marketplace'
import type { InlineExecutionReceipt, ExecutionProgressState } from '../../types/sessionKey'
import { executeDirectCopilotAction } from '../../services/copilotExecutionService'
import { soundService } from '../../services/soundService'

export function getExplicitTradeAmount(details: ActionableSignalPayload['details']): number | undefined {
  const rawAmount = details.tradeSizeUsdc ?? details.amountIn
  const amount =
    typeof rawAmount === 'number'
      ? rawAmount
      : typeof rawAmount === 'string' && rawAmount.trim()
        ? Number(rawAmount)
        : Number.NaN
  return Number.isFinite(amount) && amount > 0 ? amount : undefined
}

export function buildServiceActionPayload(
  payload: ActionableSignalPayload
): CopilotActionPayload | undefined {
  if (payload.type === 'arbitrage' || payload.type === 'navigate') return undefined
  if (payload.type === 'deposit' && payload.details.navTab) return undefined

  const amount = getExplicitTradeAmount(payload.details)
  if (amount === undefined) return undefined

  return {
    type: payload.type === 'deposit' ? 'interactive_deposit' : 'interactive_swap',
    title: payload.title,
    data: {
      amount,
      fromToken: (payload.details.fromToken || 'USDC').toUpperCase(),
      toToken: (payload.details.toToken || 'EURC').toUpperCase(),
      slippage: payload.details.priceImpactPct
        ? Math.max(0.5, Number((payload.details.priceImpactPct * 1.5).toFixed(2)))
        : 0.5,
      poolAddress: payload.details.poolAddress,
      estimatedOut: payload.details.estimatedOut,
      apy: payload.details.apy,
    },
  }
}

export function formatConfirmedOutput(amount: number | undefined): string {
  return amount !== undefined && Number.isFinite(amount) ? String(amount) : 'Unavailable'
}

export function formatVerifiedGasFee(amount: number | null | undefined): string {
  return amount !== undefined && amount !== null && Number.isFinite(amount)
    ? `$${amount} USDC`
    : 'Unavailable'
}

interface ServiceActionCardProps {
  payload: ActionableSignalPayload
  walletAddress?: string
  walletConnected?: boolean
  onNavigateTab?: (tab: string) => void
}

export default function ServiceActionCard({
  payload,
  walletAddress,
  walletConnected,
  onNavigateTab,
}: ServiceActionCardProps) {
  const [isExecuting, setIsExecuting] = useState<boolean>(false)
  const [progressState, setProgressState] = useState<ExecutionProgressState>('idle')
  const [receipt, setReceipt] = useState<InlineExecutionReceipt | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const tradeAmount = getExplicitTradeAmount(payload.details)
  const hasValidTradeAmount = tradeAmount !== undefined
  const requiresTradeAmount =
    payload.type === 'swap' ||
    (payload.type === 'deposit' && !payload.details.navTab)

  const handleExecute = async () => {
    if (payload.type === 'arbitrage') {
      soundService.play('pop')
      if (onNavigateTab) onNavigateTab('swap')
      return
    }

    if (payload.type === 'navigate') {
      if (!payload.details.navTab) {
        setErrorMsg('No destination is configured for this action.')
        return
      }
      soundService.play('pop')
      if (onNavigateTab) onNavigateTab(payload.details.navTab)
      return
    }

    if (payload.type === 'deposit' && payload.details.navTab) {
      soundService.play('pop')
      if (onNavigateTab) onNavigateTab(payload.details.navTab || 'unified')
      return
    }

    const actionPayload = buildServiceActionPayload(payload)
    if (!actionPayload) {
      setErrorMsg('A positive, explicit amount is required for this executable action. No default amount will be submitted.')
      return
    }

    setIsExecuting(true)
    setErrorMsg(null)
    soundService.play('pop')

    try {
      const provider =
        typeof window !== 'undefined'
          ? (window as any).ethereum || (window as any).arcProvider
          : undefined

      const res = await executeDirectCopilotAction(
        actionPayload,
        walletAddress,
        provider,
        (st) => setProgressState(st)
      )

      setReceipt(res)
      if (res.status === 'SUCCESS') {
        soundService.play('success')
      } else {
        soundService.play('error')
        if (res.errorMessage) setErrorMsg(res.errorMessage)
      }
    } catch (err: any) {
      console.error('[ServiceActionCard] Execution failed:', err)
      soundService.play('error')
      setErrorMsg(err.message || 'Execution failed on Arc Testnet.')
    } finally {
      setIsExecuting(false)
    }
  }

  const fromTok = (payload.details.fromToken || 'USDC').toUpperCase()
  const toTok = (payload.details.toToken || 'EURC').toUpperCase()

  return (
    <div
      className="mt-4 rounded-2xl p-4 md:p-5 border border-indigo-500/30 overflow-hidden relative"
      style={{
        background: 'linear-gradient(135deg, rgba(24, 28, 50, 0.95) 0%, rgba(18, 14, 38, 0.95) 100%)',
        boxShadow: '0 12px 32px -8px rgba(99, 102, 241, 0.2)',
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            {payload.type === 'arbitrage' ? (
              <Zap className="w-4 h-4 text-emerald-400" />
            ) : payload.type === 'swap' ? (
              <TrendingUp className="w-4 h-4 text-cyan-400" />
            ) : (
              <Coins className="w-4 h-4 text-purple-400" />
            )}
          </div>
          <div>
            <h5 className="text-xs md:text-sm font-bold text-white flex items-center gap-2">
              <span>{payload.title}</span>
            </h5>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] font-semibold text-emerald-400 font-mono">
                {payload.badgeText}
              </span>
            </div>
          </div>
        </div>

        {/* Action Button */}
        {!receipt && (
          <button
            onClick={handleExecute}
            disabled={isExecuting || (requiresTradeAmount && !hasValidTradeAmount)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:brightness-110 text-white text-xs font-bold transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 cursor-pointer disabled:opacity-50"
          >
            {isExecuting ? (
              <>
                <Clock className="w-3.5 h-3.5 animate-spin text-white" />
                <span className="capitalize">{progressState}...</span>
              </>
            ) : (
              <>
                <span>
                  {payload.type === 'arbitrage'
                    ? 'Review Quote in Swap'
                    : payload.type === 'navigate' || payload.type === 'deposit'
                      ? 'Apply & Proceed'
                      : 'Execute Opportunity on Arc'}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        )}
      </div>

      {/* Signal Execution Details Grid */}
      {!receipt && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-3 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs">
          <div>
            <span className="text-[10px] text-slate-400 block font-medium">Input Amount</span>
            <span className="font-mono font-bold text-white">
              {tradeAmount ?? 'Not provided'} {fromTok}
            </span>
          </div>
          {payload.type === 'arbitrage' ? (
            <div className="col-span-2 sm:col-span-4 text-amber-300 text-[11px]">
              This is analysis, not an executable arbitrage route. Review a fresh quote and confirm separately in Swap.
            </div>
          ) : requiresTradeAmount && !hasValidTradeAmount ? (
            <div className="col-span-2 sm:col-span-4 text-amber-300 text-[11px]">
              An explicit positive amount is required before this action can execute.
            </div>
          ) : null}
          <div>
            <span className="text-[10px] text-slate-400 block font-medium">Estimated Output</span>
            <span className="font-mono font-bold text-cyan-400">
              {payload.details.estimatedOut ? payload.details.estimatedOut.toFixed(4) : '--'} {toTok}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-medium">Net Advantage / Spread</span>
            <span className="font-mono font-bold text-emerald-400">
              {payload.details.spreadPct
                ? `+${payload.details.spreadPct.toFixed(2)}%`
                : payload.details.estimatedProfitUsdc
                ? `+$${payload.details.estimatedProfitUsdc.toFixed(4)}`
                : payload.badgeText}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block font-medium">Target Route / Pool</span>
            <span
              className="font-mono text-[11px] text-slate-300 truncate block"
              title={payload.details.optimalPool || payload.details.poolAddress || 'Arcis Curve StableSwap'}
            >
              {payload.details.optimalPool
                ? payload.details.optimalPool.replace('Arcis ', '')
                : 'Curve StableSwap'}
            </span>
          </div>
        </div>
      )}

      {/* Error state */}
      {errorMsg && (
        <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
            <span className="leading-relaxed">{errorMsg}</span>
          </div>
          {errorMsg.includes('bakiye') || errorMsg.includes('balance') || errorMsg.includes('faucet') ? (
            <div className="pt-1 flex items-center gap-2">
              <a
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 text-[11px] font-semibold flex items-center gap-1.5 transition"
              >
                <span>Get Arc Testnet USDC (Circle Faucet)</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          ) : null}
        </div>
      )}

      {/* Success Receipt Card */}
      {receipt && receipt.status === 'SUCCESS' && (
        <div className="mt-3 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2.5 animate-fade-in">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-emerald-300 font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Successfully Confirmed on Arc Testnet!</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              {receipt.settlementLatencyMs}ms
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 py-2 border-y border-emerald-500/20 text-xs font-mono">
            <div>
              <span className="text-[10px] text-slate-400 block">Swapped</span>
              <span className="font-bold text-white">
                {receipt.amountIn !== undefined && Number.isFinite(receipt.amountIn)
                  ? receipt.amountIn
                  : 'Unavailable'} {receipt.fromToken || fromTok}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">Received</span>
              <span className="font-bold text-emerald-400">
                {formatConfirmedOutput(receipt.amountOut)} {receipt.toToken || toTok}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-400 block">Actual Gas Fee</span>
              <span className="font-bold text-cyan-300">
                {formatVerifiedGasFee(receipt.actualGasUsdc)}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-300 pt-1">
            {receipt.txHash ? (
              <a
                href={receipt.explorerUrl || `https://testnet.arcscan.app/tx/${receipt.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono hover:underline"
              >
                <span>{receipt.txHash.substring(0, 10)}...{receipt.txHash.substring(receipt.txHash.length - 8)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : null}

            {onNavigateTab && (
              <button
                onClick={() => onNavigateTab('swap')}
                className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold flex items-center gap-1 transition cursor-pointer"
              >
                <span>View Swap Pools</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
