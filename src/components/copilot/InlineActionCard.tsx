import { useState, useEffect, useRef } from 'react'
import {
  Zap,
  Coins,
  Globe,
  ArrowRight,
  ArrowRightLeft,
  Loader2,
  AlertCircle,
  RotateCw,
  ArrowUpRight,
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
import type { InlineExecutionReceipt } from '../../types/sessionKey'
import { addTransaction } from '../../utils/history'

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
  const { actionPayload, receipt: initialReceipt, isExecutingInline, executionState } = message
  const [localReceipt, setLocalReceipt] = useState<InlineExecutionReceipt | null>(null)
  const receipt = localReceipt || initialReceipt
  const [isPollingDestination, setIsPollingDestination] = useState<boolean>(false)

  // ── DYNAMIC CONTINUOUS PROGRESS BAR STATE FOR INLINE EXECUTION ──
  const [execProgress, setExecProgress] = useState<number>(15)
  // Fetched directly (not via a Query hook) so the card renders safely without a QueryClientProvider.
  const [tokenPrices, setTokenPrices] = useState<TokenPriceMap | null>(null)
  const [copiedRecipient, setCopiedRecipient] = useState<boolean>(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
  }, [])

  const handleCopyRecipient = async (recipientAddress: string) => {
    if (!recipientAddress) return
    try {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      setCopyError(null)
      await navigator.clipboard.writeText(recipientAddress)
      playSound('pop')
      setCopiedRecipient(true)
      copyTimeoutRef.current = setTimeout(() => {
        setCopiedRecipient(false)
        copyTimeoutRef.current = null
      }, 2000)
    } catch (err) {
      console.warn('Clipboard write failed:', err)
      setCopyError('Kopyalama başarısız')
      copyTimeoutRef.current = setTimeout(() => {
        setCopyError(null)
        copyTimeoutRef.current = null
      }, 3000)
    }
  }

  const isPollingRef = useRef<boolean>(false)

  // ── AUTOMATIC & MANUAL CCTP DESTINATION SETTLEMENT POLLER ──
  const checkDestinationStatus = async (signal?: AbortSignal) => {
    if (!receipt || receipt.status !== 'PENDING' || receipt.actionType !== 'bridge') return
    const sourceHash = receipt.sourceTxHash || receipt.txHash
    if (!sourceHash || !sourceHash.startsWith('0x')) return
    if (isPollingRef.current) return
    isPollingRef.current = true

    setIsPollingDestination(true)
    try {
      const { pollCctpDestinationTx } = await import('../../services/bridgeUcwService')
      const sourceChain = receipt.fromChain || 'Arc_Testnet'
      const destChain = receipt.toChain || 'Ethereum_Sepolia'
      const recipientAddress = receipt.recipient || ''
      const amount = receipt.amountIn ? String(receipt.amountIn) : undefined

      const res = await pollCctpDestinationTx({
        sourceChain,
        destChain,
        burnTxHash: sourceHash,
        recipientAddress,
        amount,
        maxAttempts: 15,
        intervalMs: 3000,
        signal,
      })

      if (res.status === 'confirmed' && res.destTxHash) {
        const destExplorerUrl = getExplorerTxUrl(destChain, res.destTxHash)
        const updated: InlineExecutionReceipt = {
          ...receipt,
          status: 'SUCCESS',
          title: 'Bridge Completed Successfully',
          subtitle: 'USDC successfully bridged via Circle CCTP',
          txHash: res.destTxHash,
          destTxHash: res.destTxHash,
          explorerUrl: destExplorerUrl,
          amountOut: Number(res.receivedAmount) || receipt.amountIn,
        }
        setLocalReceipt(updated)
        playSound('success')
        addTransaction({
          type: 'bridge',
          txHash: res.destTxHash,
          amount: String(receipt.amountIn || ''),
          tokenSymbol: 'USDC',
          sourceChain,
          destChain,
          recipient: recipientAddress,
          userAddress: receipt.userAddress || receipt.sender || recipientAddress,
          status: 'success',
        })
      }
    } catch (err) {
      if (!signal?.aborted) {
        console.warn('[InlineActionCard] Error polling destination bridge settlement:', err)
      }
    } finally {
      isPollingRef.current = false
      setIsPollingDestination(false)
    }
  }

  useEffect(() => {
    if (receipt?.status === 'PENDING' && receipt?.actionType === 'bridge') {
      const controller = new AbortController()
      void checkDestinationStatus(controller.signal)
      return () => {
        controller.abort()
      }
    }
  }, [receipt?.status, receipt?.actionType, receipt?.sourceTxHash, receipt?.txHash])

  useEffect(() => {
    let active = true
    getLiveTokenPrices()
      .then((p) => {
        if (active) setTokenPrices(p)
      })
      .catch(() => { })
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
                className="group flex items-center gap-1 text-slate-200 hover:text-white transition-colors cursor-pointer select-text ml-0.5"
              >
                <span className="font-medium text-[11px] text-slate-200 group-hover:text-indigo-400 transition-colors">
                  View on {explorerName}
                </span>
                <ArrowUpRightFromSquare className="w-3 h-3 text-slate-400 hover:text-indigo-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </a>
            </div>
          </div>
        ) : receipt.txHash ? (
          <p className="text-[10px] font-mono text-slate-400 break-all">{receipt.txHash}</p>
        ) : null}

        {isBridge && (
          <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-white/[0.06]">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2 items-center justify-center shrink-0">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping ${
                    isPollingDestination ? 'bg-amber-400' : 'bg-emerald-400'
                  }`}
                  style={{ animationDuration: '2s' }}
                />
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full animate-pulse ${
                    isPollingDestination
                      ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                      : 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]'
                  }`}
                />
              </span>
              <span className="text-slate-300 font-medium">
                {isPollingDestination ? 'Checking Circle CCTP...' : 'Listening for mint...'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void checkDestinationStatus()}
              disabled={isPollingDestination}
              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-slate-600 text-[11px] font-semibold text-slate-300 hover:text-white transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <RotateCw className={`w-3 h-3 ${isPollingDestination ? 'animate-spin text-amber-400' : 'text-slate-400'}`} />
              <span>{isPollingDestination ? 'Checking...' : 'Check Status'}</span>
            </button>
          </div>
        )}
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

  // ── 4. PENDING ACTION PREVIEW CARD WITH STANDARDIZED CORPORATE TEMPLATES ──
  if (!actionPayload || !actionPayload.data) return null

  const data = actionPayload.data

  return (
    <div className="mt-3 pt-2 border-t border-slate-800 space-y-2.5 select-text selection:bg-cyan-500/30 selection:text-white">
      {/* 4.1 SWAP ACTION CARD */}
      {(actionPayload.type === 'interactive_swap' || actionPayload.type === 'trade') && (() => {
        const amount = Number(data.amount)
        const hasValidAmount = Number.isFinite(amount) && amount > 0
        const fromTok = data.fromToken || 'USDC'
        const toTok = data.toToken || 'EURC'
        const estimatedOut = Number(data.estimatedOut)
        const hasLiveQuote = Number.isFinite(estimatedOut) && estimatedOut > 0
        const estimatedFee = Number(data.estimatedFeeUsdc)
        const hasFeeEstimate = Number.isFinite(estimatedFee) && estimatedFee > 0
        const fromFiat = formatFiatEstimate(data.amount, fromTok, tokenPrices)
        const toFiat = hasLiveQuote ? formatFiatEstimate(estimatedOut, toTok, tokenPrices) : undefined
        const slippage = Number(data.slippage) || 0.5
        const exchangeRate = hasValidAmount && hasLiveQuote ? (estimatedOut / amount).toFixed(4) : null

        return (
          <ActionCardShell
            accentColor="cyan"
            header={{
              icon: <ArrowRightLeft className="w-4 h-4 text-cyan-400" />,
              title: 'Token Swap',
              subtitle: 'Arc Testnet AMM • Instant On-Chain Liquidity',
            }}
            hero={
              <div className="flex items-center justify-between gap-2 text-xs">
                {/* Left: Pay */}
                <div className="flex-1 min-w-0 select-text cursor-text">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1 select-text">
                    You Pay
                  </span>
                  <div className="font-bold text-white text-sm flex items-center gap-1.5 select-text">
                    <span className="truncate">{hasValidAmount ? `${data.amount}` : '—'}</span>
                    <span className="text-slate-300 font-normal">{fromTok}</span>
                    <CopilotTokenIcon symbol={fromTok} className="w-5 h-5 shrink-0" />
                  </div>
                  {fromFiat && (
                    <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                      {fromFiat}
                    </span>
                  )}
                </div>

                {/* Center Conversion Icon */}
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-cyan-400 select-none shadow-sm">
                  <ArrowRight className="w-3.5 h-3.5" />
                </div>

                {/* Right: Receive */}
                <div className="flex-1 min-w-0 text-right select-text cursor-text">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-1 select-text">
                    Estimated Receive
                  </span>
                  <div className="font-bold text-emerald-400 text-sm flex items-center justify-end gap-1.5 select-text">
                    <span className="truncate">{hasLiveQuote ? `~${estimatedOut}` : 'Quote required'}</span>
                    <span className="text-emerald-300/80 font-normal">{toTok}</span>
                    <CopilotTokenIcon symbol={toTok} className="w-5 h-5 shrink-0" />
                  </div>
                  {toFiat && (
                    <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                      {toFiat}
                    </span>
                  )}
                </div>
              </div>
            }
            details={
              <>
                {exchangeRate && (
                  <DetailRow
                    label="Exchange Rate"
                    value={`1 ${fromTok} ≈ ${exchangeRate} ${toTok}`}
                  />
                )}
                {hasLiveQuote && Number.isFinite(Number(data.minReceived)) && (
                  <DetailRow
                    label="Minimum Received"
                    value={`${Number(data.minReceived)} ${toTok}`}
                  />
                )}
                <DetailRow
                  label="Slippage Tolerance"
                  value={`${slippage}%`}
                />
                <DetailRow
                  label="Network Fee"
                  value={
                    hasFeeEstimate
                      ? `~${estimatedFee.toFixed(5)} USDC`
                      : 'Live estimate unavailable'
                  }
                  valueClassName={hasFeeEstimate ? 'text-slate-200' : 'text-amber-300'}
                />
              </>
            }
            primaryAction={{
              label: !hasValidAmount ? 'Amount Required' : hasLiveQuote ? 'Confirm Swap' : 'Quote Required',
              icon: <Zap className="w-3.5 h-3.5 text-cyan-200" />,
              onClick: () => onExecuteInline(message.id, actionPayload),
              disabled: !hasLiveQuote || !hasValidAmount,
              title: !hasValidAmount
                ? 'A valid explicit amount is required before confirming this swap.'
                : !hasLiveQuote
                  ? 'A live pool quote is required before confirming this swap.'
                  : undefined,
              gradient: 'bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:brightness-110 text-white shadow-emerald-500/20',
            }}
            secondaryAction={{
              label: 'Swap Page',
              onClick: () => {
                if (onNavigateToTab) onNavigateToTab('swap')
                onCloseDrawer()
              },
            }}
          />
        )
      })()}

      {/* 4.2 YIELD DEPOSIT CARD */}
      {(actionPayload.type === 'interactive_deposit' || actionPayload.type === 'view_pool') && (() => {
        const depositAmount = Number(data.amount)
        const hasValidDepositAmount = Number.isFinite(depositAmount) && depositAmount > 0
        const yearlyYield = Number(data.estimatedYieldUsdcYearly)
        const hasYieldEstimate = hasValidDepositAmount && Number.isFinite(yearlyYield) && yearlyYield > 0
        const fiat = formatFiatEstimate(data.amount, 'USDC', tokenPrices)

        return (
          <ActionCardShell
            accentColor="emerald"
            header={{
              icon: <Coins className="w-4 h-4 text-emerald-400" />,
              title: 'Yield Vault Deposit',
              subtitle: 'Arcis YieldVault • Continuous Compounding',
            }}
            hero={
              <div className="flex items-center justify-between gap-3 text-xs select-text">
                <div className="flex-1 min-w-0 select-text cursor-text">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5 select-text">
                    Deposit Amount
                  </span>
                  <div className="font-bold text-white text-base flex items-center gap-1.5 select-text">
                    <span>{hasValidDepositAmount ? `${data.amount}` : '—'}</span>
                    <span className="text-xs text-slate-300 font-semibold">USDC</span>
                    <CopilotTokenIcon symbol="USDC" className="w-5 h-5 shrink-0" />
                  </div>
                  {fiat && (
                    <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                      {fiat}
                    </span>
                  )}
                </div>

                <div className="h-9 w-px bg-slate-800/80 shrink-0" />

                <div className="flex-1 min-w-0 text-right select-text cursor-text">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block mb-0.5 select-text">
                    Est. 1Y Yield
                  </span>
                  <div className="font-bold text-emerald-400 text-base flex items-center justify-end gap-1 select-text">
                    <span>{hasYieldEstimate ? `+${yearlyYield.toFixed(2)}` : '—'}</span>
                    <span className="text-xs text-emerald-300/80 font-normal">USDC</span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-400/90 block mt-0.5">
                    Variable APY (~8.4% Benchmark)
                  </span>
                </div>
              </div>
            }
            details={
              <>
                <DetailRow
                  label="Vault Strategy"
                  value="USDC Yield Vault"
                  valueClassName="text-slate-200"
                />
                <DetailRow
                  label="APY"
                  value="Variable (Simulated ~8.4%)"
                  valueClassName="text-emerald-400"
                />
                <DetailRow
                  label="Compounding"
                  value="Continuous (Per-Block)"
                />
                <DetailRow
                  label="Lockup Period"
                  value="None (Instant Liquidity)"
                  valueClassName="text-slate-300"
                />
                <DetailRow
                  label="Network Fee"
                  value="~0.00053 USDC"
                  valueClassName="text-slate-200"
                />
              </>
            }
            primaryAction={{
              label: hasValidDepositAmount ? 'Confirm Deposit' : 'Amount Required',
              icon: <Coins className="w-3.5 h-3.5 text-emerald-200" />,
              onClick: () => onExecuteInline(message.id, actionPayload),
              disabled: !hasValidDepositAmount,
              title: !hasValidDepositAmount
                ? 'A valid explicit amount is required before confirming this deposit.'
                : undefined,
              gradient: 'bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:brightness-110 text-white shadow-emerald-500/20',
            }}
            secondaryAction={{
              label: 'Pool Page',
              onClick: () => {
                if (onNavigateToTab) onNavigateToTab('pools')
                onCloseDrawer()
              },
            }}
          />
        )
      })()}

      {/* 4.3 BRIDGE ACTION CARD */}
      {(actionPayload.type === 'interactive_bridge' || actionPayload.type === 'bridge') && (() => {
        const bridgeAmount = Number(data.amount)
        const hasValidBridgeAmount = Number.isFinite(bridgeAmount) && bridgeAmount > 0
        const fromChain = data.fromChain || 'Arc Testnet'
        const toChain = data.toChain || 'Ethereum Sepolia'
        const fiat = formatFiatEstimate(data.amount, 'USDC', tokenPrices)

        return (
          <ActionCardShell
            accentColor="indigo"
            header={{
              icon: <Globe className="w-4 h-4 text-indigo-400" />,
              title: 'Cross-Chain Bridge',
              subtitle: 'Circle Gateway • Instant Finality Route',
            }}
            hero={
              <div className="space-y-1.5 select-text">
                <div className="flex items-center justify-between select-text">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block select-text">
                    Bridge Amount
                  </span>
                </div>
                <div className="items-center justify-between select-text cursor-text">
                  <div className="flex items-center gap-1.5 select-text">
                    <span className="font-bold text-white text-base tracking-tight select-text">
                      {hasValidBridgeAmount ? `${data.amount}` : 'Amount unavailable'}
                    </span>
                    <span className="text-sm text-slate-300">USDC</span>
                    <CopilotTokenIcon symbol="USDC" className="w-5 h-5 shrink-0" />
                  </div>
                  {fiat && (
                    <span className="text-[11px] font-mono text-slate-400 select-text">
                      {fiat}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between select-text pt-2 border-t border-slate-800/80">
                  <CopilotNetworkBadge chainName={fromChain} />
                  <ArrowRight className="w-3.5 h-3.5 text-indigo-400 select-none flex-shrink-0" />
                  <CopilotNetworkBadge chainName={toChain} />
                </div>
              </div>
            }
            details={
              <>
                <DetailRow
                  label="Bridge Route"
                  value={`${fromChain} ➔ ${toChain}`}
                  valueClassName="text-slate-200"
                />
                <DetailRow
                  label="Protocol"
                  value="Circle Gateway"
                  valueClassName="text-indigo-300"
                />
                <DetailRow
                  label="Transfer Speed"
                  value="< 30s"
                  valueClassName="text-emerald-400"
                />
                <DetailRow
                  label="Protocol Fee"
                  value="0 USDC"
                  valueClassName="text-emerald-400"
                />
              </>
            }
            primaryAction={{
              label: hasValidBridgeAmount ? 'Confirm Bridge' : 'Amount Required',
              icon: <Globe className="w-3.5 h-3.5 text-indigo-200" />,
              onClick: () => onExecuteInline(message.id, actionPayload),
              disabled: !hasValidBridgeAmount,
              title: !hasValidBridgeAmount
                ? 'A valid explicit amount is required before confirming this bridge.'
                : undefined,
              gradient: 'bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-600 hover:brightness-110 text-white shadow-emerald-500/20',
            }}
            secondaryAction={{
              label: 'Bridge Page',
              onClick: () => {
                if (onNavigateToTab) onNavigateToTab('bridge')
                onCloseDrawer()
              },
            }}
          />
        )
      })()}

      {/* 4.4 SEND ACTION CARD */}
      {(actionPayload.type === 'interactive_send' || actionPayload.type === 'send' || actionPayload.type === 'interactive_batch_send') && (() => {
        const sendAmount = Number(data.amount)
        const hasValidSendAmount = Number.isFinite(sendAmount) && sendAmount > 0
        const tokenSymbol = data.tokenSymbol || data.token || 'USDC'
        const fiat = formatFiatEstimate(data.amount, tokenSymbol, tokenPrices)
        const fullRecipient = String(data.recipient || data.recipientAddress || data.to || '')
        const displayRecipient = fullRecipient.length > 14
          ? `${fullRecipient.slice(0, 8)}...${fullRecipient.slice(-6)}`
          : fullRecipient
        const hasMemo = Boolean(data.memo && String(data.memo).trim().length > 0)

        const feeString = data.estimatedFeeUsdc
          ? String(data.estimatedFeeUsdc).startsWith('~')
            ? String(data.estimatedFeeUsdc)
            : `~${data.estimatedFeeUsdc} USDC`
          : `~${arcTransferFeeFallbackUsdc(tokenSymbol, hasMemo)} USDC`

        return (
          <ActionCardShell
            accentColor="sky"
            header={{
              icon: <ArrowUpRight className="w-4 h-4 text-sky-400" />,
              title: 'Token Transfer',
              subtitle: 'Arc Testnet • Gas Abstracted Transfer',
            }}
            hero={
              <div className="space-y-1 select-text">
                <div className="flex items-center justify-between select-text">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block select-text">
                    Transfer Amount
                  </span>
                </div>
                <div className="items-baseline justify-between gap-2 pt-0.5 select-text">
                  <div className="flex items-center gap-1.5 select-text cursor-text">
                    <span className="font-bold text-white text-base tracking-tight select-text">
                      {hasValidSendAmount ? `${data.amount}` : 'Amount unavailable'}
                    </span>
                    <span className="text-xs font-semibold text-slate-300 select-text">
                      {tokenSymbol}
                    </span>
                    <CopilotTokenIcon symbol={tokenSymbol} className="w-5 h-5 shrink-0" />
                  </div>
                  {fiat && (
                    <span className="text-[11px] font-mono text-slate-400 select-text">
                      {fiat}
                    </span>
                  )}
                </div>
              </div>
            }
            details={
              <>
                <div className="flex items-center justify-between text-xs py-0.5 select-text">
                  <span className="text-slate-400 text-[11px] font-medium select-text">
                    Recipient
                  </span>
                  <div className="flex items-center gap-1.5 select-text">
                    <span
                      title={fullRecipient}
                      className="font-mono text-slate-300 font-bold text-[11px] select-text cursor-text truncate max-w-[200px]"
                    >
                      {displayRecipient || '—'}
                    </span>
                    {fullRecipient && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleCopyRecipient(fullRecipient)
                        }}
                        title={copyError || (copiedRecipient ? 'Kopyalandı!' : 'Adresi Kopyala')}
                        aria-label={copyError || (copiedRecipient ? 'Adres panoya kopyalandı' : 'Alıcı adresini kopyala')}
                        className="p-1 rounded-md text-slate-400 hover:text-cyan-300 hover:bg-slate-800/80 transition cursor-pointer flex items-center justify-center"
                      >
                        {copiedRecipient ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : copyError ? (
                          <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {hasMemo && (
                  <DetailRow
                    label="Memo"
                    value={`"${data.memo}"`}
                    valueClassName="text-slate-300 italic font-sans"
                  />
                )}
                <DetailRow
                  label="Network"
                  value="Arc Testnet"
                  valueClassName="text-slate-200"
                />
                <DetailRow
                  label="Network Fee"
                  value={`${feeString}`}
                  valueClassName="text-slate-200"
                />
                <DetailRow
                  label="Finality"
                  value="Instant (< 1s)"
                  valueClassName="text-emerald-400"
                />
              </>
            }
            primaryAction={{
              label: isExecutingInline ? 'Sending…' : hasValidSendAmount ? 'Confirm Transfer' : 'Amount Required',
              icon: <ArrowUpRight className="w-3.5 h-3.5 text-cyan-200" />,
              onClick: () => onExecuteInline(message.id, actionPayload),
              disabled: isExecutingInline || !hasValidSendAmount,
              gradient: 'bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-600 hover:brightness-110 text-white shadow-cyan-500/20',
            }}
            secondaryAction={{
              label: 'Send Page',
              onClick: () => {
                if (onNavigateToTab) onNavigateToTab('send')
                onCloseDrawer()
              },
            }}
          />
        )
      })()}

      {/* 4.5 CONFIGURE SESSION SETTINGS CARD */}
      {actionPayload.type === 'configure_session' && (
        <ActionCardShell
          accentColor="amber"
          header={{
            icon: <Settings className="w-4 h-4 text-amber-400" />,
            title: 'Session Key Authorization',
            subtitle: 'Smart Account Policy • Autonomous Limits',
          }}
          hero={
            <div className="space-y-1.5 select-text">
              <div className="flex items-center justify-between select-text">
                <span className="text-[10px] text-slate-400 uppercase font-semibold block select-text">
                  Autonomous Execution
                </span>
                <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                  Zero-Popup
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed select-text">
                Authorize an ephemeral ECDSA session key with custom spending caps to allow Copilot to execute pre-approved micro-actions without individual wallet prompts.
              </p>
            </div>
          }
          details={
            <>
              <DetailRow
                label="Execution Mode"
                value="Zero-Popup Autonomous"
                valueClassName="text-amber-300"
              />
              <DetailRow
                label="Gas Paymaster"
                value="100% Circle Gas Station"
                valueClassName="text-emerald-400"
              />
              <DetailRow
                label="Spending Policy"
                value="Per-Tx & Daily USDC Caps"
                valueClassName="text-slate-200"
              />
              <DetailRow
                label="Key Storage"
                value="Client-Side Ephemeral"
                valueClassName="text-slate-400"
              />
            </>
          }
          primaryAction={{
            label: actionPayload.title || 'Open Session Settings',
            icon: <Settings className="w-3.5 h-3.5 text-slate-950" />,
            onClick: () => {
              if (onOpenSessionSettings) {
                onOpenSessionSettings()
              } else {
                window.dispatchEvent(new CustomEvent('arcis_open_session_modal'))
              }
            },
            gradient: 'bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:brightness-110 text-slate-950 font-extrabold shadow-amber-500/20',
          }}
        />
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. UNIFIED INSTITUTIONAL ACTION CARD SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

interface DetailRowProps {
  label: string
  value: React.ReactNode
  valueClassName?: string
}

function DetailRow({ label, value, valueClassName = 'text-slate-200' }: DetailRowProps) {
  return (
    <div className="flex items-center justify-between text-xs py-0.5 select-text">
      <span className="text-slate-400 text-[11px] font-medium select-text">{label}</span>
      <span className={`text-[11px] font-semibold font-mono select-text cursor-text ${valueClassName}`}>
        {value}
      </span>
    </div>
  )
}

interface ActionCardShellProps {
  accentColor: 'cyan' | 'sky' | 'indigo' | 'emerald' | 'amber'
  header: {
    icon: React.ReactNode
    title: string
    subtitle: string
  }
  hero: React.ReactNode
  details: React.ReactNode
  primaryAction: {
    label: string
    icon?: React.ReactNode
    onClick: () => void
    disabled?: boolean
    title?: string
    gradient: string
  }
  secondaryAction?: {
    label: string
    onClick: () => void
  }
}

function ActionCardShell({
  accentColor,
  header,
  hero,
  details,
  primaryAction,
  secondaryAction,
}: ActionCardShellProps) {
  const borderStyles = {
    cyan: 'border-cyan-500/40 shadow-cyan-500/10',
    sky: 'border-sky-500/40 shadow-sky-500/10',
    indigo: 'border-indigo-500/40 shadow-indigo-500/10',
    emerald: 'border-emerald-500/40 shadow-emerald-500/10',
    amber: 'border-amber-500/40 shadow-amber-500/10',
  }

  const badgeStyles = {
    cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    sky: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    indigo: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  }

  const iconBgStyles = {
    cyan: 'bg-cyan-500/10 border-cyan-500/25 text-cyan-300',
    sky: 'bg-sky-500/10 border-sky-500/25 text-sky-300',
    indigo: 'bg-indigo-500/10 border-indigo-500/25 text-indigo-300',
    emerald: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300',
    amber: 'bg-amber-500/10 border-amber-500/25 text-amber-300',
  }

  return (
    <div
      className={`p-3.5 rounded-2xl bg-slate-950/95 border space-y-3 shadow-xl animate-fade-in select-text selection:bg-cyan-500/30 selection:text-white ${borderStyles[accentColor]}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center border shadow-inner shrink-0 ${iconBgStyles[accentColor]}`}
          >
            {header.icon}
          </div>
          <div className="min-w-0 select-text">
            <h4 className="text-xs font-bold text-white tracking-wide truncate select-text cursor-text">
              {header.title}
            </h4>
            <p className="text-[10px] text-slate-400 truncate leading-tight mt-0.5 select-text">
              {header.subtitle}
            </p>
          </div>
        </div>
      </div>

      {/* Hero Panel */}
      <div className="rounded-xl bg-slate-900/90 border border-slate-800/80 p-3 shadow-inner select-text">
        {hero}
      </div>

      {/* Details Table */}
      <div className="rounded-xl bg-slate-900/50 border border-slate-800/60 p-2.5 space-y-1.5 text-xs select-text">
        {details}
      </div>

      {/* Action Footer */}
      <div
        className={`grid gap-2 pt-0.5 select-none ${secondaryAction ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'
          }`}
      >
        <button
          type="button"
          onClick={primaryAction.onClick}
          disabled={primaryAction.disabled}
          title={primaryAction.title}
          className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer shadow-lg active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100 hover:brightness-110 ${primaryAction.gradient}`}
        >
          {primaryAction.icon}
          <span>{primaryAction.label}</span>
        </button>

        {secondaryAction && (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-850 border border-slate-700/80 hover:border-slate-600 text-slate-300 hover:text-white text-xs font-semibold flex items-center justify-center gap-1 transition cursor-pointer"
          >
            <span>{secondaryAction.label}</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>
    </div>
  )
}



