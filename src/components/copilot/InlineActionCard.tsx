import React, { useState, useEffect } from 'react'
import {
  Zap,
  Coins,
  Sparkles,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  AlertCircle,
  Clock,
  RotateCw,
  Send as SendIcon,
  Settings,
  ShieldAlert,
} from 'lucide-react'
import type { CopilotMessage, CopilotActionPayload } from '../../types/marketplace'
import { getExplorerTxUrl } from '../../config/sendConfig'
import { CopilotTokenIcon, CopilotNetworkBadge } from './CopilotTokenIcon'
import { playSound } from '../../services/soundService'

interface InlineActionCardProps {
  message: CopilotMessage
  onExecuteInline: (messageId: string, actionPayload: CopilotActionPayload) => Promise<void>
  onNavigateToTab?: (tab: string) => void
  onOpenFaucet?: () => void
  onOpenSessionSettings?: () => void
  onCloseDrawer: () => void
}

export default function InlineActionCard({
  message,
  onExecuteInline,
  onNavigateToTab,
  onOpenFaucet,
  onOpenSessionSettings,
  onCloseDrawer,
}: InlineActionCardProps) {
  const { actionPayload, receipt, isExecutingInline, executionState } = message

  // ── DYNAMIC CONTINUOUS PROGRESS BAR STATE FOR INLINE EXECUTION ──
  const [execProgress, setExecProgress] = useState<number>(15)

  useEffect(() => {
    const isExecuting =
      isExecutingInline ||
      (executionState && executionState !== 'confirmed' && executionState !== 'idle' && !receipt)

    if (!isExecuting) {
      setExecProgress(15)
      return
    }

    const interval = setInterval(() => {
      setExecProgress((prev) => {
        if (executionState === 'routing') {
          if (prev < 35) return Math.min(35, prev + 2.5)
          return prev
        }
        if (executionState === 'signing') {
          if (prev < 68) return Math.min(68, prev + 2.0)
          return prev
        }
        if (executionState === 'broadcasting') {
          if (prev < 88) return prev + 1.2
          if (prev < 96) return prev + 0.3
          return prev
        }
        // General fallback
        if (prev < 90) return prev + 1.5
        return prev
      })
    }, 100)

    return () => clearInterval(interval)
  }, [isExecutingInline, executionState, receipt])

  // ── SOUND FX TRIGGER ON RECEIPT STATUS ──
  useEffect(() => {
    if (receipt) {
      if (receipt.status === 'SUCCESS') {
        playSound(receipt.actionType === 'faucet' ? 'faucet' : 'success')
      } else if (receipt.status === 'FAILED') {
        const isRejection =
          receipt.errorMessage?.toLowerCase().includes('iptal') ||
          receipt.errorMessage?.toLowerCase().includes('reject') ||
          receipt.errorMessage?.toLowerCase().includes('denied') ||
          receipt.errorMessage?.toLowerCase().includes('reddedildi')
        playSound(isRejection ? 'cancel' : 'error')
      }
    }
  }, [receipt])

  // ── 1. ACTIVE INLINE EXECUTION PROGRESS BANNER ──
  if (isExecutingInline || (executionState && executionState !== 'confirmed' && executionState !== 'idle' && !receipt)) {
    return (
      <div className="mt-3 p-3.5 rounded-2xl bg-slate-950/95 border border-cyan-500/50 space-y-2.5 shadow-xl shadow-cyan-500/10 animate-fade-in select-text selection:bg-cyan-500/30 selection:text-white">
        <div className="flex items-center justify-between select-text">
          <div className="flex items-center gap-2 text-xs font-bold text-cyan-300 select-text cursor-text">
            <Loader2 className="w-4 h-4 text-cyan-400 animate-spin select-none" />
            <span className="select-text">
              {executionState === 'routing' && 'Analysing liquidity and price impact...'}
              {executionState === 'signing' && 'Signing with Session Key...'}
              {executionState === 'broadcasting' && 'Submitting to Arc Testnet...'}
              {!executionState && 'Processing transaction...'}
            </span>
          </div>
        </div>

        {/* Dynamic Smooth Progress Bar */}
        <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden relative select-none">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 via-teal-400 to-indigo-500 rounded-full transition-all duration-300 ease-out"
            style={{
              width: `${Math.max(10, Math.min(98, execProgress))}%`,
            }}
          />
        </div>
      </div>
    )
  }

  // ── 2. SUCCESSFUL INLINE EXECUTION RECEIPT CARD ──
  if (receipt && receipt.status === 'SUCCESS') {
    const targetChain = receipt.actionType === 'bridge'
      ? (receipt.toChain?.toLowerCase().includes('arc') ? 'Arc_Testnet' : receipt.fromChain || 'Arc_Testnet')
      : 'Arc_Testnet'
    const explorerUrl = receipt.explorerUrl || getExplorerTxUrl(targetChain, receipt.txHash)
    const explorerLabel = targetChain.toLowerCase().includes('arc')
      ? 'ArcScan'
      : targetChain.toLowerCase().includes('sepolia')
        ? 'Etherscan'
        : 'Explorer'

    return (
      <div className="mt-3 p-3.5 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 border border-emerald-500/50 space-y-3 shadow-xl shadow-emerald-500/10 animate-fade-in select-text selection:bg-emerald-500/30 selection:text-white">
        <div className="flex items-center gap-2 select-text cursor-text">
          <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center select-none">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <span className="text-xs font-extrabold text-white select-text cursor-text">{receipt.title}</span>
        </div>

        {/* Token/Network Summary in Receipt */}
        {receipt.actionType === 'swap' && receipt.fromToken && receipt.toToken && (
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
            <div className="flex items-center gap-1.5 text-white font-semibold">
              <CopilotTokenIcon symbol={receipt.fromToken} className="w-4 h-4" />
              <span>{receipt.amountIn} {receipt.fromToken}</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-slate-500 select-none" />
            <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
              <CopilotTokenIcon symbol={receipt.toToken} className="w-4 h-4" />
              <span>{receipt.amountOut ? `${receipt.amountOut} ${receipt.toToken}` : receipt.toToken}</span>
            </div>
          </div>
        )}

        {receipt.actionType === 'bridge' && receipt.fromChain && receipt.toChain && (
          <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs select-text">
            <div className="flex items-center justify-between select-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text">Amount</span>
              <div className="flex items-center gap-1 font-bold text-cyan-300 select-text cursor-text">
                <span>{receipt.amountIn} USDC</span>
                <CopilotTokenIcon symbol="USDC" className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="flex items-center justify-between select-text pt-1.5 border-t border-slate-800/80">
              <CopilotNetworkBadge chainName={receipt.fromChain} />
              <ArrowRight className="w-3.5 h-3.5 text-slate-500 select-none flex-shrink-0" />
              <CopilotNetworkBadge chainName={receipt.toChain} />
            </div>
          </div>
        )}

        {receipt.actionType === 'deposit' && (
          <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs select-text">
            <div className="flex items-center justify-between select-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text">Amount</span>
              <div className="flex items-center gap-1 font-bold text-emerald-400 select-text cursor-text">
                <span>{receipt.amountIn} USDC</span>
                <CopilotTokenIcon symbol="USDC" className="w-3.5 h-3.5" />
              </div>
            </div>
            {receipt.apy && (
              <div className="flex items-center justify-between select-text pt-1.5 border-t border-slate-800/80 text-[11px]">
                <span className="text-slate-400">Yield Vault APY:</span>
                <span className="font-bold text-emerald-400">{receipt.apy}</span>
              </div>
            )}
          </div>
        )}

        {receipt.actionType === 'send' && (
          <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2 text-xs select-text">
            <div className="flex items-center justify-between select-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text">Amount Sent</span>
              <div className="flex items-center gap-1 font-bold text-cyan-300 select-text cursor-text">
                <span>{receipt.amountIn || 0} {receipt.fromToken || 'USDC'}</span>
                <CopilotTokenIcon symbol={receipt.fromToken || 'USDC'} className="w-3.5 h-3.5" />
              </div>
            </div>
            {receipt.recipient && (
              <div className="flex items-center justify-between select-text pt-1.5 border-t border-slate-800/80 text-[11px]">
                <span className="text-slate-400">Recipient:</span>
                <span className="font-mono text-slate-200 font-semibold truncate max-w-[180px]">{receipt.recipient}</span>
              </div>
            )}
            {receipt.memo && (
              <div className="flex items-center justify-between select-text pt-1 border-t border-slate-800/80 text-[11px]">
                <span className="text-slate-400">Memo:</span>
                <span className="text-slate-300 italic">{receipt.memo}</span>
              </div>
            )}
          </div>
        )}

        {receipt.actionType === 'faucet' && (
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs select-text">
            <span className="text-[10px] text-slate-400 uppercase font-semibold select-text">Amount</span>
            <div className="flex items-center gap-1 font-bold text-cyan-300 select-text cursor-text">
              <span>+{receipt.amountOut || 1000} USDC</span>
              <CopilotTokenIcon symbol="USDC" className="w-3.5 h-3.5" />
            </div>
          </div>
        )}

        {/* View on Explorer Action */}
        <div className="flex items-center gap-2 pt-1 select-text">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-3 px-8 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-700/80 hover:border-cyan-500/40 text-slate-200 hover:text-cyan-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer select-text"
          >
            <span className="select-text">View on {explorerLabel}: {receipt.txHash ? `${receipt.txHash.slice(0, 10)}...${receipt.txHash.slice(-8)}` : 'Explorer'}</span>
            <ExternalLink className="w-3.5 h-3.5 select-none" />
          </a>
        </div>
      </div>
    )
  }

  // ── 3. FAILED / CANCELLED RECEIPT CARD ──
  if (receipt && receipt.status === 'FAILED') {
    const isRejection =
      receipt.errorMessage?.toLowerCase().includes('iptal') ||
      receipt.errorMessage?.toLowerCase().includes('reject') ||
      receipt.errorMessage?.toLowerCase().includes('denied') ||
      receipt.errorMessage?.toLowerCase().includes('reddedildi')

    return (
      <div
        className={`mt-3 p-3.5 rounded-2xl bg-slate-950/95 border space-y-2.5 shadow-xl select-text selection:bg-rose-500/30 selection:text-white ${isRejection
          ? 'border-amber-500/40 shadow-amber-500/5'
          : 'border-rose-500/50 shadow-rose-500/10'
          }`}
      >
        <div
          className={`flex items-center justify-between text-xs font-bold ${isRejection ? 'text-amber-300' : 'text-rose-300'
            }`}
        >
          <div className="flex items-center gap-1.5 select-text cursor-text">
            <AlertCircle className={`w-4 h-4 select-none ${isRejection ? 'text-amber-400' : 'text-rose-400'}`} />
            <span className="select-text">{receipt.title || (isRejection ? 'Transaction Rejected' : 'Transaction Failed')}</span>
          </div>
        </div>
        <p className={`text-xs leading-relaxed select-text cursor-text ${isRejection ? 'text-slate-300' : 'text-rose-200/90'}`}>
          {receipt.errorMessage || 'An unexpected error occurred.'}
        </p>
        {actionPayload && (
          <button
            onClick={() => onExecuteInline(message.id, actionPayload)}
            className={`w-full py-2 px-3 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 select-none ${isRejection
              ? 'bg-slate-900 hover:bg-slate-850 border-slate-700 hover:border-cyan-500/40 text-cyan-300'
              : 'bg-rose-950/80 hover:bg-rose-900 border-rose-700/80 text-rose-200'
              }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>{isRejection ? 'Tekrar Dene' : 'Yeniden Dene'}</span>
          </button>
        )}
      </div>
    )
  }

  // ── 4. PENDING ACTION PREVIEW CARD WITH STATIC CONFIRMATION ──
  if (!actionPayload || !actionPayload.data) return null

  const data = actionPayload.data

  return (
    <div className="mt-3 pt-2 border-t border-slate-800 space-y-2.5 select-text selection:bg-cyan-500/30 selection:text-white">
      {/* 4.1 SWAP ACTION CARD */}
      {(actionPayload.type === 'interactive_swap' || actionPayload.type === 'trade') && (
        <div className="p-3 rounded-2xl bg-slate-950/95 border border-cyan-500/40 space-y-2.5 shadow-lg shadow-cyan-500/5 select-text">
          <div className="grid grid-cols-2 gap-2 bg-slate-900/90 p-2.5 rounded-xl border border-slate-800/80 text-xs select-text">
            <div className="select-text cursor-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text block">Pay Amount</span>
              <div className="font-bold text-white text-sm flex items-center gap-1.5 mt-0.5 select-text">
                <span>{data.amount || 100} {data.fromToken || 'USDC'}</span>
                <CopilotTokenIcon symbol={data.fromToken || 'USDC'} className="w-4 h-4" />
              </div>
            </div>
            <div className="text-right select-text cursor-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text block">Est. Receive</span>
              <div className="font-bold text-emerald-400 text-sm flex items-center justify-end gap-1.5 mt-0.5 select-text">
                <span>~{data.estimatedOut} {data.toToken || 'EURC'}</span>
                <CopilotTokenIcon symbol={data.toToken || 'EURC'} className="w-4 h-4" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 select-none">
            <button
              onClick={() => onExecuteInline(message.id, actionPayload)}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-[0.99]"
            >
              <Zap className="w-3.5 h-3.5 text-cyan-200" />
              <span>Confirm Swap</span>
            </button>

            <button
              onClick={() => {
                if (onNavigateToTab) onNavigateToTab('swap')
                onCloseDrawer()
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-700/80 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1 transition cursor-pointer"
            >
              <span>Swap Page</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* 4.2 YIELD DEPOSIT CARD */}
      {(actionPayload.type === 'interactive_deposit' || actionPayload.type === 'view_pool') && (
        <div className="p-3 rounded-2xl bg-slate-950/95 border border-emerald-500/40 space-y-2.5 shadow-lg shadow-emerald-500/5 select-text">
          <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs select-text">
            <div className="select-text cursor-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text block">Deposit Amount</span>
              <div className="font-bold text-white text-sm flex items-center gap-1.5 mt-0.5 select-text">
                <span>{data.amount || 500} USDC</span>
                <CopilotTokenIcon symbol="USDC" className="w-4 h-4" />
              </div>
            </div>
            <div className="text-right select-text cursor-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text block">Estimated 1Y Yield</span>
              <div className="font-bold text-emerald-400 text-sm flex items-center justify-end gap-1.5 mt-0.5 select-text">
                <span>+${data.estimatedYieldUsdcYearly || (Number(data.amount || 500) * 0.0842).toFixed(2)} USDC</span>
                <CopilotTokenIcon symbol="USDC" className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 select-none">
            <button
              onClick={() => onExecuteInline(message.id, actionPayload)}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-[0.99]"
            >
              <Coins className="w-3.5 h-3.5 text-emerald-200" />
              <span>Confirm Deposit</span>
            </button>

            <button
              onClick={() => {
                if (onNavigateToTab) onNavigateToTab('pools')
                onCloseDrawer()
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1 transition cursor-pointer"
            >
              <span>Pool Page</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* 4.3 BRIDGE ACTION CARD */}
      {(actionPayload.type === 'interactive_bridge' || actionPayload.type === 'bridge') && (
        <div className="p-3 rounded-2xl bg-slate-950/95 border border-indigo-500/40 space-y-2.5 shadow-lg shadow-indigo-500/5 select-text">
          <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800/80 space-y-2 select-text">
            <div className="flex items-center justify-between select-text mb-2">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text block">Bridge Amount</span>
              <div className="font-bold text-cyan-400 text-sm flex items-center justify-end gap-1.5 select-text cursor-text">
                <span>{data.amount || 250} USDC</span>
                <CopilotTokenIcon symbol="USDC" className="w-4 h-4" />
              </div>
            </div>

            <div className="flex items-center justify-between select-text pt-1.5 border-t border-slate-800/80">
              <CopilotNetworkBadge chainName={data.fromChain || 'Arc Testnet'} />
              <ArrowRight className="w-3.5 h-3.5 text-slate-500 select-none flex-shrink-0" />
              <CopilotNetworkBadge chainName={data.toChain || 'Ethereum Sepolia'} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 select-none">
            <button
              onClick={() => onExecuteInline(message.id, actionPayload)}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-[0.99]"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
              <span>Confirm Bridge</span>
            </button>

            <button
              onClick={() => {
                if (onNavigateToTab) onNavigateToTab('bridge')
                onCloseDrawer()
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-700/80 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1 transition cursor-pointer"
            >
              <span>Bridge Page</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* 4.4 SEND ACTION CARD */}
      {(actionPayload.type === 'interactive_send' || actionPayload.type === 'send' || actionPayload.type === 'interactive_batch_send') && (
        <div className="p-3 rounded-2xl bg-slate-950/95 border border-cyan-500/40 space-y-2.5 shadow-lg shadow-cyan-500/5 select-text">
          <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800/80 space-y-2 select-text">
            <div className="flex items-center justify-between select-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text block">Transfer Amount</span>
              <div className="font-bold text-white text-sm flex items-center justify-end gap-1.5 select-text cursor-text">
                <span>{data.amount || 10} {data.tokenSymbol || data.token || 'USDC'}</span>
                <CopilotTokenIcon symbol={data.tokenSymbol || data.token || 'USDC'} className="w-4 h-4" />
              </div>
            </div>

            <div className="flex items-center justify-between select-text pt-1.5 border-t border-slate-800/80 text-xs">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text">Recipient</span>
              <span className="font-mono text-cyan-300 font-bold select-text cursor-text truncate max-w-[200px]">
                {data.recipient || data.recipientAddress || '0x...'}
              </span>
            </div>

            {data.memo && (
              <div className="flex items-center justify-between select-text pt-1 border-t border-slate-800/80 text-xs">
                <span className="text-[10px] text-slate-400 uppercase font-semibold select-text">Memo</span>
                <span className="text-slate-300 italic select-text cursor-text">
                  {data.memo}
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 select-none">
            <button
              onClick={() => onExecuteInline(message.id, actionPayload)}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-600 hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg shadow-cyan-500/20 active:scale-[0.99]"
            >
              <SendIcon className="w-3.5 h-3.5 text-cyan-200" />
              <span>Confirm Transfer</span>
            </button>

            <button
              onClick={() => {
                if (onNavigateToTab) onNavigateToTab('send')
                onCloseDrawer()
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-700/80 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1 transition cursor-pointer"
            >
              <span>Send Page</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* 4.5 FAUCET ACTION CARD */}
      {actionPayload.type === 'faucet' && (
        <div className="p-3 rounded-2xl bg-slate-950/95 border border-cyan-500/40 space-y-2.5 select-text">
          <button
            onClick={() => onExecuteInline(message.id, actionPayload)}
            className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 text-white font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-md select-none"
          >
            <CopilotTokenIcon symbol="USDC" className="w-4 h-4" />
            <span>Claim 1,000 Testnet USDC on Arc</span>
          </button>
        </div>
      )}

      {/* 4.6 CONFIGURE SESSION SETTINGS CARD */}
      {actionPayload.type === 'configure_session' && (
        <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950/30 border border-amber-500/40 space-y-3 shadow-xl shadow-amber-500/10 animate-fade-in select-text">
          <div className="flex items-center justify-between select-none">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <span className="text-xs font-bold text-white">Autonomous Session Keys</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (onOpenSessionSettings) {
                onOpenSessionSettings()
              } else {
                window.dispatchEvent(new CustomEvent('arcis_open_session_modal'))
              }
            }}
            className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:brightness-110 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-lg shadow-amber-500/20 active:scale-[0.99] select-none"
          >
            <Settings className="w-3.5 h-3.5 text-slate-950" />
            <span>Open Session Settings</span>
          </button>
        </div>
      )}
    </div>
  )
}


