import React, { useState } from 'react'
import { ShieldCheck, Zap, ArrowUpRight, RotateCcw, Shield, Sparkles, Check, Info } from 'lucide-react'
import { useSpendingCeiling, checkCeilingStatus, resetSpendingCeiling } from '../../services/spendingCeilingService'

interface SpendingCeilingBadgeProps {
  walletAddress: string
  tokenSymbol?: string
  amount: string
  onOpenSettings?: () => void
}

/**
 * Dynamic spending ceiling badge that displays above CTA buttons in SwapModal and BridgeModal.
 * Informs the user whether their transaction will be 1-Click Fast (zero approval popups)
 * or if it will establish / elevate a spending ceiling.
 */
export const SpendingCeilingBadge: React.FC<SpendingCeilingBadgeProps> = ({
  walletAddress,
  tokenSymbol = 'USDC',
  amount,
  onOpenSettings,
}) => {
  const { ceiling } = useSpendingCeiling(walletAddress, tokenSymbol)

  if (!walletAddress) return null

  const amountNum = parseFloat(amount || '0')
  const ceilingStatus = checkCeilingStatus(walletAddress, tokenSymbol, amount)

  // Case 1: Active ceiling and current amount is within ceiling (1-Click Fast Transaction)
  if (ceiling > 0 && (amountNum <= 0 || ceilingStatus.isWithinCeiling)) {
    return (
      <div
        className="w-full px-3.5 py-2 rounded-2xl border transition-all duration-200 flex items-center justify-between gap-2.5"
        style={{
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(6, 78, 59, 0.12) 100%)',
          borderColor: 'rgba(52, 211, 153, 0.25)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold text-emerald-300">
                1-Click Fast Execution
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                (Limit: ${ceiling.toFixed(2)} {tokenSymbol})
              </span>
            </div>
            <p className="text-[10px] text-slate-400 truncate">
              Zero wallet approval popups required for this transaction
            </p>
          </div>
        </div>

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-[10px] text-emerald-400 hover:text-emerald-300 underline underline-offset-2 shrink-0 cursor-pointer font-medium"
            title="Adjust or reset spending limit"
          >
            Manage
          </button>
        )}
      </div>
    )
  }

  // Case 2: Active ceiling but amount EXCEEDS ceiling (Elevate Ceiling)
  if (ceiling > 0 && !ceilingStatus.isWithinCeiling && amountNum > 0) {
    return (
      <div
        className="w-full px-3.5 py-2 rounded-2xl border transition-all duration-200 flex items-center justify-between gap-2.5"
        style={{
          background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, rgba(180, 83, 9, 0.12) 100%)',
          borderColor: 'rgba(251, 191, 36, 0.3)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-amber-500/20 border border-amber-400/40 flex items-center justify-center shrink-0">
            <ArrowUpRight className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold text-amber-300">
                Elevating Spending Limit
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                ${ceiling.toFixed(2)} → ${ceilingStatus.suggestedCeiling} {tokenSymbol}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 truncate">
              One wallet confirmation will authorize your elevated limit for future 1-click use
            </p>
          </div>
        </div>

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-[10px] text-amber-400 hover:text-amber-300 underline underline-offset-2 shrink-0 cursor-pointer font-medium"
            title="Manage spending limit"
          >
            Manage
          </button>
        )}
      </div>
    )
  }

  // Case 3: Initial use (No ceiling set yet) with amount entered
  if (ceiling === 0 && amountNum > 0) {
    return (
      <div
        className="w-full px-3.5 py-2 rounded-2xl border transition-all duration-200 flex items-center justify-between gap-2.5"
        style={{
          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(79, 70, 229, 0.12) 100%)',
          borderColor: 'rgba(129, 140, 248, 0.3)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-lg bg-indigo-500/20 border border-indigo-400/40 flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold text-indigo-300">
                Initial Spending Limit Setup: ${ceilingStatus.suggestedCeiling} {tokenSymbol}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 truncate">
              Approves once: future transactions ≤ ${ceilingStatus.suggestedCeiling} will need 0 extra confirmations
            </p>
          </div>
        </div>

        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 underline underline-offset-2 shrink-0 cursor-pointer font-medium"
            title="Spending limit info"
          >
            Info
          </button>
        )}
      </div>
    )
  }

  return null
}

interface SpendingCeilingSettingsCardProps {
  walletAddress: string
  tokenSymbol?: string
}

/**
 * Settings Card rendered inside the Transaction/Bridge Settings modal.
 * Displays current ceiling, explanation of the security model, and provides a 1-click Reset/Revoke action.
 */
export const SpendingCeilingSettingsCard: React.FC<SpendingCeilingSettingsCardProps> = ({
  walletAddress,
  tokenSymbol = 'USDC',
}) => {
  const { ceiling, lastApprovedTx, resetCeiling } = useSpendingCeiling(walletAddress, tokenSymbol)
  const [resetSuccess, setResetSuccess] = useState(false)

  const handleReset = () => {
    resetCeiling()
    setResetSuccess(true)
    setTimeout(() => setResetSuccess(false), 3000)
  }

  return (
    <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold text-white tracking-wide">
              Smart Spending Limits
            </h4>
            <p className="text-[10px] text-slate-400">Automated 1-click wallet approval management</p>
          </div>
        </div>

        {ceiling > 0 ? (
          <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            ${ceiling.toFixed(2)} {tokenSymbol}
          </span>
        ) : (
          <span className="text-[11px] font-mono text-slate-400 px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08]">
            Not Configured
          </span>
        )}
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        Arcis authorizes a safe spending ceiling on your first transaction so subsequent transfers
        within that limit execute instantly without repetitive approval popups. Any transaction
        exceeding your ceiling automatically asks for a new confirmation.
      </p>

      {ceiling > 0 && (
        <div className="flex items-center justify-between pt-1 border-t border-white/[0.06]">
          <span className="text-[10px] text-slate-400">
            Active Ceiling: <strong className="text-slate-200">${ceiling.toFixed(2)} {tokenSymbol}</strong>
          </span>

          <button
            type="button"
            onClick={handleReset}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all cursor-pointer ${
              resetSuccess
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 border border-rose-500/30'
            }`}
          >
            {resetSuccess ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span>Limit Reset!</span>
              </>
            ) : (
              <>
                <RotateCcw className="w-3 h-3" />
                <span>Reset Limit (Revoke)</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
