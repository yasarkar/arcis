import React from 'react'
import { AlertTriangle, Ban, Clock } from 'lucide-react'

export interface PendingSwapState {
  txHash?: string
  stage: 'approve' | 'swap'
  message: string
  broadcastId: string
  payload: {
    amountIn: string
    amountOut: string
    tokenIn: string
    tokenOut: string
    recipient: string
  }
}

export interface SwapAlertsProps {
  error: string | null
  isCanceledError: boolean
  pendingSwap: PendingSwapState | null
  onDismissPending: () => void
  notice: string | null
  onDismissNotice: () => void
  estimateError: string | null
}

export const SwapAlerts: React.FC<SwapAlertsProps> = ({
  error,
  isCanceledError,
  pendingSwap,
  onDismissPending,
  notice,
  onDismissNotice,
  estimateError,
}) => {
  return (
    <>
      {/* Error / Rejection Alert */}
      {error && (
        <div
          className={`p-3 rounded-2xl border text-xs flex items-center gap-2.5 animate-fade-in ${
            isCanceledError
              ? 'bg-amber-500/10 border-amber-500/25 text-amber-300/90'
              : 'bg-rose-500/10 border-rose-500/25 text-rose-400'
          }`}
        >
          {isCanceledError ? (
            <Ban className="w-4 h-4 shrink-0 text-amber-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          )}
          <span className="flex-1 leading-relaxed">{error}</span>
        </div>
      )}

      {/* Submitted Swap Awaiting Confirmation (fix #1) */}
      {pendingSwap && (
        <div className="p-3 rounded-2xl border text-xs flex items-start gap-2.5 bg-indigo-500/10 border-indigo-500/25 text-indigo-200 animate-fade-in">
          <Clock className="w-4 h-4 shrink-0 mt-0.5 text-indigo-300" />
          <span className="flex-1 leading-relaxed">
            {pendingSwap.message}
            {pendingSwap.txHash && (
              <span className="block mt-1 font-mono text-[10px] text-indigo-300/80">
                {pendingSwap.txHash.slice(0, 18)}…{pendingSwap.txHash.slice(-6)}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onDismissPending}
            className="shrink-0 text-[11px] text-indigo-300 hover:text-indigo-200 underline underline-offset-2 cursor-pointer transition-colors"
            title="Only dismiss if you are certain the transaction was never broadcast."
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Non-blocking follow-up notice */}
      {notice && (
        <div className="p-3 rounded-2xl border text-xs flex items-start gap-2.5 bg-emerald-500/10 border-emerald-500/25 text-emerald-300 animate-fade-in">
          <Clock className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
          <span className="flex-1 leading-relaxed">{notice}</span>
          <button
            type="button"
            onClick={onDismissNotice}
            className="shrink-0 text-[11px] text-emerald-300 hover:text-emerald-200 underline underline-offset-2 cursor-pointer transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Route Error Alert */}
      {estimateError && !error && (
        <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/25 text-amber-300 text-xs flex items-center gap-2.5 animate-fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            {estimateError.includes('INPUT_AMOUNT_OUT_OF_RANGE')
              ? 'Entered amount is outside supported swap liquidity limits.'
              : estimateError}
          </span>
        </div>
      )}
    </>
  )
}
