import { useState, useEffect } from 'react'
import {
  Zap,
  Coins,
  Sparkles,
  ArrowRight,
  Loader2,
  AlertCircle,
  RotateCw,
  Send as SendIcon,
  Settings,
  Copy,
  Check,
  ArrowUpRightFromSquare,
} from 'lucide-react'
import type { CopilotMessage, CopilotActionPayload } from '../../types/marketplace'
import { arcTransferFeeFallbackUsdc } from '../../services/arcGasService'
import { CopilotTokenIcon, CopilotNetworkBadge } from './CopilotTokenIcon'
import { isCanceledReceipt } from '../../utils/errorUtils'
import { playSound } from '../../services/soundService'
import { getLiveTokenPrices, type TokenPriceMap } from '../../services/tokenPriceService'
import { formatFiatEstimate } from '../../hooks/useLiveTokenPrices'
import { getExplorerTxUrl, getExplorerName } from '../../config/sendConfig'
import CopilotSuccessReceipt from './CopilotSuccessReceipt'

interface InlineActionCardProps {
  message: CopilotMessage
  onExecuteInline: (messageId: string, actionPayload: CopilotActionPayload) => Promise<void>
  onNavigateToTab?: (tab: string) => void
  onOpenSessionSettings?: () => void
  onCloseDrawer: () => void
}

export default function InlineActionCard({
  message,
  onExecuteInline,
  onNavigateToTab,
  onOpenSessionSettings,
  onCloseDrawer,
}: InlineActionCardProps) {
  const { actionPayload, receipt, isExecutingInline, executionState } = message

  // ── DYNAMIC CONTINUOUS PROGRESS BAR STATE FOR INLINE EXECUTION ──
  const [execProgress, setExecProgress] = useState<number>(15)
  // Fetched directly (not via a Query hook) so the card renders safely without a QueryClientProvider.
  const [tokenPrices, setTokenPrices] = useState<TokenPriceMap | null>(null)
  const [copiedRecipient, setCopiedRecipient] = useState<boolean>(false)

  const handleCopyRecipient = (recipientAddress: string) => {
    if (!recipientAddress) return
    navigator.clipboard.writeText(recipientAddress)
    playSound('pop')
    setCopiedRecipient(true)
    setTimeout(() => setCopiedRecipient(false), 2000)
  }

  useEffect(() => {
    let active = true
    getLiveTokenPrices()
      .then((p) => {
        if (active) setTokenPrices(p)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

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
        playSound('success')
      } else if (receipt.status === 'FAILED' || receipt.status === 'CANCELED') {
        playSound(isCanceledReceipt(receipt) ? 'cancel' : 'error')
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

  if (receipt && receipt.status === 'PENDING') {
    const isBridge = receipt.actionType === 'bridge'
    const sourceChain = receipt.fromChain || 'Arc_Testnet'
    const sourceHash = receipt.sourceTxHash || receipt.txHash
    const explorerUrl = receipt.explorerUrl || (sourceHash ? getExplorerTxUrl(sourceChain, sourceHash) : '#')
    const explorerName = getExplorerName(sourceChain)
    const pendingMessage =
      receipt.subtitle ||
      receipt.errorMessage ||
      'Transaction was submitted but its successful on-chain receipt has not been confirmed. No success history or session spend has been recorded.'

    return (
      <div className="p-3.5 rounded-2xl bg-slate-950/95 border border-amber-500/40 space-y-2.5 shadow-xl animate-fade-in select-text">
        <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
          <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
          <span>{receipt.title || 'Transaction pending confirmation'}</span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">{pendingMessage}</p>

        {sourceHash && sourceHash.startsWith('0x') ? (
          <div className="flex items-center justify-between text-slate-400 text-xs pt-2 border-t border-white/[0.06]">
            <span>{isBridge ? 'Source Burn Tx:' : 'Transaction:'}</span>
            <div className="flex items-center gap-1.5">
              <a
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-1.5 text-slate-200 hover:text-white transition-colors cursor-pointer select-text"
              >
                <span className="font-mono text-[11px] text-cyan-400 group-hover:text-cyan-300 font-semibold transition-colors">
                  {sourceHash.slice(0, 8)}...{sourceHash.slice(-6)}
                </span>
                <span className="font-medium text-[11px] text-slate-400 group-hover:text-indigo-300 transition-colors">
                  ({explorerName})
                </span>
                <ArrowUpRightFromSquare className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </a>
            </div>
          </div>
        ) : receipt.txHash ? (
          <p className="text-[10px] font-mono text-slate-400 break-all">{receipt.txHash}</p>
        ) : null}
      </div>
    )
  }

  // ── 2. SUCCESSFUL INLINE EXECUTION RECEIPT CARD ──
  // Rendered through the shared corporate receipt template (the same UnifiedSuccessReceipt
  // the Send / Swap / Bridge tabs use) via the CopilotSuccessReceipt adapter.
  if (receipt && receipt.status === 'SUCCESS') {
    return (
      <div className="animate-fade-in">
        <CopilotSuccessReceipt receipt={receipt} />
      </div>
    )
  }

  // ── 3. FAILED / CANCELLED RECEIPT CARD ──
  if (receipt && (receipt.status === 'FAILED' || receipt.status === 'CANCELED')) {
    const isCanceled = isCanceledReceipt(receipt)

    return (
      <div
        className={`p-3.5 rounded-2xl bg-slate-950/95 border space-y-2.5 shadow-xl select-text selection:bg-rose-500/30 selection:text-white ${isCanceled
          ? 'border-amber-500/40 shadow-amber-500/5'
          : 'border-rose-500/50 shadow-rose-500/10'
          }`}
      >
        <div
          className={`flex items-center justify-between text-xs font-bold ${isCanceled ? 'text-amber-300' : 'text-rose-300'
            }`}
        >
          <div className="flex items-center gap-1.5 select-text cursor-text">
            <AlertCircle className={`w-4 h-4 select-none ${isCanceled ? 'text-amber-400' : 'text-rose-400'}`} />
            <span className="select-text">{receipt.title || (isCanceled ? 'Transaction canceled' : 'Transaction Failed')}</span>
          </div>
        </div>
        <p className={`text-xs leading-relaxed select-text cursor-text ${isCanceled ? 'text-slate-300' : 'text-rose-200/90'}`}>
          {receipt.errorMessage || 'An unexpected error occurred.'}
        </p>
        {actionPayload && (
          <button
            onClick={() => onExecuteInline(message.id, actionPayload)}
            className={`w-full py-2 px-3 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 select-none ${isCanceled
              ? 'bg-slate-900 hover:bg-slate-850 border-slate-700/80 hover:border-amber-500/40 text-amber-300'
              : 'bg-rose-950/80 hover:bg-rose-900 border-rose-700/80 text-rose-200'
              }`}
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Try Again</span>
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
      {(actionPayload.type === 'interactive_swap' || actionPayload.type === 'trade') && (() => {
        const estimatedOut = Number(data.estimatedOut)
        const hasLiveQuote = Number.isFinite(estimatedOut) && estimatedOut > 0
        const estimatedFee = Number(data.estimatedFeeUsdc)
        const hasFeeEstimate = Number.isFinite(estimatedFee) && estimatedFee > 0
        const toToken = data.toToken || 'EURC'
        const amount = Number(data.amount)
        const hasValidAmount = Number.isFinite(amount) && amount > 0
        return (
        <div className="p-3 rounded-2xl bg-slate-950/95 border border-cyan-500/40 space-y-2.5 shadow-lg shadow-cyan-500/5 select-text">
          <div className="grid grid-cols-2 gap-2 bg-slate-900/90 p-2.5 rounded-xl border border-slate-800/80 text-xs select-text">
            <div className="select-text cursor-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text block">Pay Amount</span>
              <div className="font-bold text-white text-sm flex items-center gap-1.5 mt-0.5 select-text">
                <span>{hasValidAmount ? `${data.amount} ${data.fromToken || 'USDC'}` : 'Amount unavailable'}</span>
                <CopilotTokenIcon symbol={data.fromToken || 'USDC'} className="w-4 h-4" />
              </div>
            </div>
            <div className="text-right select-text cursor-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text block">Est. Receive</span>
              <div className="font-bold text-emerald-400 text-sm flex items-center justify-end gap-1.5 mt-0.5 select-text">
                <span>{hasLiveQuote ? `~${estimatedOut} ${toToken}` : 'Live quote unavailable'}</span>
                <CopilotTokenIcon symbol={toToken} className="w-4 h-4" />
              </div>
            </div>
          </div>

          {hasLiveQuote && Number.isFinite(Number(data.minReceived)) && (
            <div className="flex items-center justify-between px-2.5 text-[11px] select-text">
              <span className="text-slate-400">Minimum received</span>
              <span className="text-slate-200">{Number(data.minReceived)} {toToken}</span>
            </div>
          )}
          <div className="flex items-center justify-between px-2.5 text-[11px] select-text">
            <span className="text-slate-400">Network fee</span>
            <span className={hasFeeEstimate ? 'text-slate-200' : 'text-amber-300'}>
              {hasFeeEstimate
                ? `~${estimatedFee.toFixed(5)} USDC${data.feeEstimateSource === 'static_fallback' ? ' (fallback estimate)' : ''}`
                : 'Live estimate unavailable'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 select-none">
            <button
              onClick={() => onExecuteInline(message.id, actionPayload)}
              disabled={!hasLiveQuote || !hasValidAmount}
              title={!hasValidAmount ? 'A valid explicit amount is required before confirming this swap.' : !hasLiveQuote ? 'A live pool quote is required before confirming this swap.' : undefined}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-[0.99]"
            >
              <Zap className="w-3.5 h-3.5 text-cyan-200" />
              <span>{!hasValidAmount ? 'Amount Required' : hasLiveQuote ? 'Confirm Swap' : 'Quote Required'}</span>
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
        )
      })()}

      {/* 4.2 YIELD DEPOSIT CARD */}
      {(actionPayload.type === 'interactive_deposit' || actionPayload.type === 'view_pool') && (() => {
        const depositAmount = Number(data.amount)
        const hasValidDepositAmount = Number.isFinite(depositAmount) && depositAmount > 0
        const yearlyYield = Number(data.estimatedYieldUsdcYearly)
        const hasYieldEstimate = hasValidDepositAmount && Number.isFinite(yearlyYield) && yearlyYield > 0
        return (
        <div className="p-3 rounded-2xl bg-slate-950/95 border border-emerald-500/40 space-y-2.5 shadow-lg shadow-emerald-500/5 select-text">
          <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs select-text">
            <div className="select-text cursor-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text block">Deposit Amount</span>
              <div className="font-bold text-white text-sm flex items-center gap-1.5 mt-0.5 select-text">
                <span>{hasValidDepositAmount ? `${data.amount} USDC` : 'Amount unavailable'}</span>
                <CopilotTokenIcon symbol="USDC" className="w-4 h-4" />
              </div>
            </div>
            <div className="text-right select-text cursor-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text block">Estimated 1Y Yield</span>
              <div className="font-bold text-emerald-400 text-sm flex items-center justify-end gap-1.5 mt-0.5 select-text">
                <span>{hasYieldEstimate ? `+$${yearlyYield.toFixed(2)} USDC` : 'Estimate unavailable'}</span>
                <CopilotTokenIcon symbol="USDC" className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 select-none">
            <button
              onClick={() => onExecuteInline(message.id, actionPayload)}
              disabled={!hasValidDepositAmount}
              title={!hasValidDepositAmount ? 'A valid explicit amount is required before confirming this deposit.' : undefined}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-[0.99]"
            >
              <Coins className="w-3.5 h-3.5 text-emerald-200" />
              <span>{hasValidDepositAmount ? 'Confirm Deposit' : 'Amount Required'}</span>
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
        )
      })()}

      {/* 4.3 BRIDGE ACTION CARD */}
      {(actionPayload.type === 'interactive_bridge' || actionPayload.type === 'bridge') && (() => {
        const bridgeAmount = Number(data.amount)
        const hasValidBridgeAmount = Number.isFinite(bridgeAmount) && bridgeAmount > 0
        return (
        <div className="p-3 rounded-2xl bg-slate-950/95 border border-indigo-500/40 space-y-2.5 shadow-lg shadow-indigo-500/5 select-text">
          <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800/80 space-y-2 select-text">
            <div className="flex items-center justify-between select-text mb-2">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text block">Bridge Amount</span>
              <div className="font-bold text-slate-300 text-[14px] flex items-center justify-end gap-1.5 select-text cursor-text">
                <span>{hasValidBridgeAmount ? `${data.amount}` : 'Amount unavailable'}</span>
                <CopilotTokenIcon symbol="USDC" className="w-5 h-5" />
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
              disabled={!hasValidBridgeAmount}
              title={!hasValidBridgeAmount ? 'A valid explicit amount is required before confirming this bridge.' : undefined}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg shadow-emerald-500/20 active:scale-[0.99]"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-200" />
              <span>{hasValidBridgeAmount ? 'Confirm Bridge' : 'Amount Required'}</span>
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
        )
      })()}

      {/* 4.4 SEND ACTION CARD */}
      {(actionPayload.type === 'interactive_send' || actionPayload.type === 'send') && (() => {
        const sendAmount = Number(data.amount)
        const hasValidSendAmount = Number.isFinite(sendAmount) && sendAmount > 0
        return (
        <div className="p-3 rounded-2xl bg-slate-950/95 border border-cyan-500/40 space-y-2.5 shadow-lg shadow-cyan-500/5 select-text">
          <div className="bg-slate-900/90 p-2.5 rounded-xl border border-slate-800/80 space-y-2 select-text">
            <div className="flex items-center justify-between select-text">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text block">Transfer Amount</span>
              <div className="font-bold text-white text-[14px] flex items-center justify-end gap-1.5 select-text cursor-text">
                <span>{hasValidSendAmount ? `${data.amount}` : 'Amount unavailable'}</span>
                <CopilotTokenIcon symbol={data.tokenSymbol || 'USDC'} className="w-5 h-5" />
              </div>
            </div>

            {(() => {
              const fiat = formatFiatEstimate(data.amount, data.tokenSymbol || data.token || 'USDC', tokenPrices)
              return fiat ? (
                <div className="flex items-center justify-end -mt-1.5 select-text">
                  <span className="text-[12px] font-mono text-slate-400">{fiat}</span>
                </div>
              ) : null
            })()}

            {(() => {
              const fullRecipient = String(data.recipient || data.recipientAddress || '')
              const displayRecipient = fullRecipient.length > 14
                ? `${fullRecipient.slice(0, 10)}...${fullRecipient.slice(-4)}`
                : fullRecipient

              return (
                <div className="flex items-center justify-between select-text pt-1.5 border-t border-slate-800/80 text-xs">
                  <span className="text-[12px] text-slate-400 uppercase font-semibold select-text">Recipient</span>
                  <div className="flex items-center gap-1.5 select-text">
                    <span
                      title={fullRecipient}
                      className="font-mono text-slate-300 font-bold select-text cursor-text truncate max-w-[240px]"
                    >
                      {displayRecipient}
                    </span>
                    {fullRecipient && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleCopyRecipient(fullRecipient)
                        }}
                        title={copiedRecipient ? 'Kopyalandı!' : 'Adresi Kopyala'}
                        className="p-1 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 transition cursor-pointer flex items-center justify-center"
                      >
                        {copiedRecipient ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })()}

            {data.memo && (
              <div className="flex items-center justify-between select-text pt-1 border-t border-slate-800/80 text-xs">
                <span className="text-[12px] text-slate-400 uppercase font-semibold select-text">Memo</span>
                <span className="text-slate-300 italic select-text cursor-text">
                  {data.memo}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between select-text pt-1.5 border-t border-slate-800/80 text-xs">
              <span className="text-[10px] text-slate-400 uppercase font-semibold select-text">Network Fee</span>
              <span className="font-mono text-slate-300 select-text cursor-text">
                {data.estimatedFeeUsdc
                  ? String(data.estimatedFeeUsdc).startsWith('~')
                    ? String(data.estimatedFeeUsdc)
                    : `~${data.estimatedFeeUsdc} USDC`
                  : `~${arcTransferFeeFallbackUsdc(
                      data.tokenSymbol || data.token,
                      Boolean(data.memo && String(data.memo).trim().length > 0)
                    )} USDC`}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 select-none">
            <button
              onClick={() => onExecuteInline(message.id, actionPayload)}
              disabled={isExecutingInline || !hasValidSendAmount}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-600 hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg shadow-cyan-500/20 active:scale-[0.99]"
            >
              <SendIcon className="w-3.5 h-3.5 text-cyan-200" />
              <span>{isExecutingInline ? 'Sending…' : hasValidSendAmount ? 'Confirm Transfer' : 'Amount Required'}</span>
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
        )
      })()}

      {/* 4.6 CONFIGURE SESSION SETTINGS CARD */}
      {actionPayload.type === 'configure_session' && (
        <div className="p-3.5 rounded-2xl space-y-3 animate-fade-in select-text">
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
            <span>{actionPayload.title || 'Open Session Settings'}</span>
          </button>
        </div>
      )}
    </div>
  )
}


