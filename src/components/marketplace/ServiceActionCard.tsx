// src/components/marketplace/ServiceActionCard.tsx
// 1-Click Actionable Signal Executor for Arcis AI Services
// Turns raw intelligence (arbitrage spreads, slippage routes, liquidity alerts)
// into real on-chain Arc Testnet transactions or direct workflow navigation,
// including guided Step 1 → Step 2 execution for 2-hop routes with fresh live quoting.
import { useCallback, useEffect, useState } from 'react'
import {
  Zap,
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Clock,
  AlertCircle,
  Ban,
  Coins,
  RefreshCw,
} from 'lucide-react'
import type { ActionableSignalPayload, CopilotActionPayload } from '../../types/marketplace'
import type { InlineExecutionReceipt, ExecutionProgressState } from '../../types/sessionKey'
import { executeDirectCopilotAction } from '../../services/copilotExecutionService'
import type { CopilotUcwHandlers } from '../../services/copilot/copilotCommon'
import { getSwapEstimate } from '../../services/swapService'
import { soundService } from '../../services/soundService'
import {
  resolveArcSwapTokenBalance,
  useArcSwapTokenBalances,
} from '../../hooks/useArcSwapTokenBalances'
import { PinnedTokenIcon } from '../common/PinnedIcons'
import { formatUnits, parseUnits } from 'viem'
import { POOL_MIN_SLIPPAGE_BPS, POOL_MAX_SLIPPAGE_BPS } from '../../config/poolsConfig'
import { numberToExactDecimal } from '../../utils/copilotAmount'
import { swapMinimumUnits, swapPercentToBps } from '../../utils/swapSlippage'
import { isUserCanceledMessage, STATUS_TONES } from './marketplaceDesign'
import { StatusBadge } from './MarketplaceVisualPrimitives'

const MIN_ACTION_SLIPPAGE_PCT = POOL_MIN_SLIPPAGE_BPS / 100
const MAX_ACTION_SLIPPAGE_PCT = POOL_MAX_SLIPPAGE_BPS / 100

const TOKEN_DECIMALS: Record<string, number> = {
  USDC: 6,
  EURC: 6,
  CIRBTC: 8,
  BTC: 8,
  WETH: 18,
  ETH: 18,
}

export interface ActionableNextStep {
  step: number
  totalSteps: number
  fromToken: string
  toToken: string
  estimatedIn?: number
  estimatedOut?: number
  poolAddress?: string
  optimalPool?: string
  slippageTolerancePct?: number
  fullPath?: string
}

function formatCardTokenAmount(value: number): string {
  if (!Number.isFinite(value)) return '--'
  if (value >= 100) return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  if (value >= 0.1) return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  return value.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
}

function resolveActionSlippagePct(details: ActionableSignalPayload['details']): number {
  const raw =
    typeof details.slippageTolerancePct === 'number' && Number.isFinite(details.slippageTolerancePct)
      ? details.slippageTolerancePct
      : 0.5
  return Number(Math.min(MAX_ACTION_SLIPPAGE_PCT, Math.max(MIN_ACTION_SLIPPAGE_PCT, raw)).toFixed(2))
}

function resolveSwapMinReceived(
  details: ActionableSignalPayload['details'],
  toTokenUpper: string,
  slippagePct: number
): string | undefined {
  if (typeof details.minReceived === 'string' && /^\d+(?:\.\d+)?$/.test(details.minReceived.trim())) {
    return details.minReceived.trim()
  }
  const est = details.estimatedOut
  if (typeof est !== 'number' || !Number.isFinite(est) || est <= 0) return undefined
  const decimals = TOKEN_DECIMALS[toTokenUpper] ?? 6
  try {
    const outUnits = parseUnits(est.toFixed(decimals), decimals)
    if (outUnits <= 0n) return undefined
    const minUnits = swapMinimumUnits(outUnits, swapPercentToBps(slippagePct))
    if (minUnits <= 0n) return undefined
    return formatUnits(minUnits, decimals)
  } catch {
    return undefined
  }
}

export function extractActionableNextStep(
  details: ActionableSignalPayload['details'] | undefined
): ActionableNextStep | null {
  const raw = details?.nextStep
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.fromToken !== 'string' || typeof raw.toToken !== 'string') return null
  return {
    step: typeof raw.step === 'number' ? raw.step : 2,
    totalSteps: typeof raw.totalSteps === 'number' ? raw.totalSteps : 2,
    fromToken: raw.fromToken,
    toToken: raw.toToken,
    estimatedIn: typeof raw.estimatedIn === 'number' ? raw.estimatedIn : undefined,
    estimatedOut: typeof raw.estimatedOut === 'number' ? raw.estimatedOut : undefined,
    poolAddress: typeof raw.poolAddress === 'string' ? raw.poolAddress : undefined,
    optimalPool: typeof raw.optimalPool === 'string' ? raw.optimalPool : undefined,
    slippageTolerancePct: typeof raw.slippageTolerancePct === 'number' ? raw.slippageTolerancePct : undefined,
    fullPath: typeof raw.fullPath === 'string' ? raw.fullPath : undefined,
  }
}

/**
 * Builds the executable Step 2 swap payload using the real on-chain confirmed Step 1 output
 * and a freshly fetched live Step 2 quote (never a stale pre-Step-1 estimate).
 */
export function buildNextStepSignalPayload(params: {
  nextStep: ActionableNextStep
  confirmedAmountIn: number
  freshEstimatedOut: number
  freshMinReceived?: string
}): ActionableSignalPayload | null {
  const { nextStep, confirmedAmountIn, freshEstimatedOut, freshMinReceived } = params
  if (
    !Number.isFinite(confirmedAmountIn) ||
    confirmedAmountIn <= 0 ||
    !Number.isFinite(freshEstimatedOut) ||
    freshEstimatedOut <= 0
  ) {
    return null
  }
  return {
    type: 'swap',
    title: `Step ${nextStep.step} of ${nextStep.totalSteps}: Swap ${formatCardTokenAmount(confirmedAmountIn)} ${nextStep.fromToken} → ${nextStep.toToken}`,
    badgeText: `2-Hop Step ${nextStep.step} · ${nextStep.fullPath || `${nextStep.fromToken} → ${nextStep.toToken}`}`,
    details: {
      amountIn: confirmedAmountIn,
      fromToken: nextStep.fromToken,
      toToken: nextStep.toToken,
      estimatedOut: freshEstimatedOut,
      ...(freshMinReceived ? { minReceived: freshMinReceived } : {}),
      slippageTolerancePct: nextStep.slippageTolerancePct,
      poolAddress: nextStep.poolAddress,
      optimalPool: nextStep.optimalPool || 'Arcis DEX Router',
      fullPath: nextStep.fullPath,
      step: nextStep.step,
      totalSteps: nextStep.totalSteps,
      buttonLabel: `Execute Step ${nextStep.step}/${nextStep.totalSteps} (${nextStep.fromToken} → ${nextStep.toToken})`,
    },
  }
}

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

  const fromToken = (payload.details.fromToken || 'USDC').toUpperCase()
  const toToken = (payload.details.toToken || 'EURC').toUpperCase()
  const slippage = resolveActionSlippagePct(payload.details)
  const minReceived =
    payload.type === 'swap' ? resolveSwapMinReceived(payload.details, toToken, slippage) : undefined

  return {
    type: payload.type === 'deposit' ? 'interactive_deposit' : 'interactive_swap',
    title: payload.title,
    data: {
      amount,
      fromToken,
      toToken,
      slippage,
      ...(minReceived ? { minReceived } : {}),
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
  /**
   * Circle Wallet executors. Without them the card would execute a post-payment swap through an
   * injected EIP-1193 provider, which a UCW-only session does not have.
   */
  ucwHandlers?: CopilotUcwHandlers
  onNavigateTab?: (tab: string) => void
  /**
   * 'card' (default) renders the standalone ServiceActionCard container.
   * 'inline' embeds a streamlined CTA + live balance + receipt/Step-2 bar inside a Hero Ticket.
   */
  variant?: 'card' | 'inline'
}

export default function ServiceActionCard({
  payload,
  walletAddress,
  walletConnected,
  ucwHandlers,
  onNavigateTab,
  variant = 'card',
}: ServiceActionCardProps) {
  const [activePayload, setActivePayload] = useState<ActionableSignalPayload>(payload)
  const [completedStep1Receipt, setCompletedStep1Receipt] = useState<InlineExecutionReceipt | null>(null)
  const [step2QuoteLoading, setStep2QuoteLoading] = useState<boolean>(false)
  const [step2QuoteError, setStep2QuoteError] = useState<string | null>(null)
  const [preparedStep2Payload, setPreparedStep2Payload] = useState<ActionableSignalPayload | null>(null)

  const [isExecuting, setIsExecuting] = useState<boolean>(false)
  const [progressState, setProgressState] = useState<ExecutionProgressState>('idle')
  const [receipt, setReceipt] = useState<InlineExecutionReceipt | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'cancelled' | 'error' | null>(null)

  // Reset card state whenever the parent passes a brand-new signal payload.
  useEffect(() => {
    setActivePayload(payload)
    setCompletedStep1Receipt(null)
    setStep2QuoteLoading(false)
    setStep2QuoteError(null)
    setPreparedStep2Payload(null)
    setReceipt(null)
    setErrorMsg(null)
    setErrorKind(null)
    setProgressState('idle')
  }, [payload])

  useEffect(() => {
    if (!errorMsg || !isUserCanceledMessage(errorMsg)) return
    const timer = window.setTimeout(() => {
      setErrorMsg(null)
      setErrorKind(null)
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [errorMsg])

  const shouldCheckBalance = Boolean(
    walletAddress && activePayload.type === 'swap' && !receipt
  )
  const { balances: arcBalances } = useArcSwapTokenBalances(walletAddress, shouldCheckBalance)

  const prepareStep2Quote = useCallback(
    async (nextStep: ActionableNextStep, confirmedAmountOut: number) => {
      const exactAmountIn = numberToExactDecimal(confirmedAmountOut)
      if (!exactAmountIn || confirmedAmountOut <= 0) {
        setStep2QuoteError('Confirmed Step 1 output could not be read for Step 2 quoting.')
        return
      }
      setStep2QuoteLoading(true)
      setStep2QuoteError(null)
      try {
        const slippagePct = resolveActionSlippagePct({
          slippageTolerancePct: nextStep.slippageTolerancePct,
        })
        const quote = await getSwapEstimate({
          fromChain: 'Arc_Testnet',
          toChain: 'Arc_Testnet',
          tokenIn: nextStep.fromToken.toUpperCase(),
          tokenOut: nextStep.toToken.toUpperCase(),
          amountIn: exactAmountIn,
          slippageBps: swapPercentToBps(slippagePct),
          sourceAdapter: null,
        })
        const freshOut = Number(quote.estimatedOutput)
        if (!Number.isFinite(freshOut) || freshOut <= 0) {
          throw new Error('Live Step 2 quote returned zero output.')
        }
        const built = buildNextStepSignalPayload({
          nextStep,
          confirmedAmountIn: confirmedAmountOut,
          freshEstimatedOut: freshOut,
          freshMinReceived: quote.stopLimit,
        })
        if (!built) {
          throw new Error('Could not build a valid Step 2 swap payload.')
        }
        setPreparedStep2Payload(built)
      } catch (err: any) {
        setPreparedStep2Payload(null)
        setStep2QuoteError(
          err?.message || `Live quote for Step 2 (${nextStep.fromToken} → ${nextStep.toToken}) is currently unavailable.`
        )
      } finally {
        setStep2QuoteLoading(false)
      }
    },
    []
  )

  const tradeAmount = getExplicitTradeAmount(activePayload.details)
  const hasValidTradeAmount = tradeAmount !== undefined
  const requiresTradeAmount =
    activePayload.type === 'swap' ||
    (activePayload.type === 'deposit' && !activePayload.details.navTab)

  const fromTok = (activePayload.details.fromToken || 'USDC').toUpperCase()
  const toTok = (activePayload.details.toToken || 'EURC').toUpperCase()
  const availableArcBalance = shouldCheckBalance
    ? resolveArcSwapTokenBalance(arcBalances, activePayload.details.fromToken)
    : null
  const hasInsufficientArcBalance =
    availableArcBalance !== null &&
    tradeAmount !== undefined &&
    availableArcBalance + 1e-9 < tradeAmount

  const actionSlippagePct = resolveActionSlippagePct(activePayload.details)
  const previewMinReceived =
    activePayload.type === 'swap'
      ? resolveSwapMinReceived(activePayload.details, toTok, actionSlippagePct)
      : undefined
  const activeNextStep = extractActionableNextStep(activePayload.details)

  const handleExecute = async () => {
    if (activePayload.type === 'arbitrage') {
      soundService.play('pop')
      if (onNavigateTab) onNavigateTab('swap')
      return
    }

    if (activePayload.type === 'navigate') {
      if (!activePayload.details.navTab) {
        setErrorKind('error')
        setErrorMsg('No destination is configured for this action.')
        return
      }
      soundService.play('pop')
      if (onNavigateTab) onNavigateTab(activePayload.details.navTab)
      return
    }

    if (activePayload.type === 'deposit' && activePayload.details.navTab) {
      soundService.play('pop')
      if (onNavigateTab) onNavigateTab(activePayload.details.navTab || 'unified')
      return
    }

    const actionPayload = buildServiceActionPayload(activePayload)
    if (!actionPayload) {
      setErrorKind('error')
      setErrorMsg('A positive, explicit amount is required for this executable action. No default amount will be submitted.')
      return
    }

    setIsExecuting(true)
    setErrorMsg(null)
    setErrorKind(null)
    setReceipt(null)
    setPreparedStep2Payload(null)
    setStep2QuoteError(null)
    setProgressState('idle')
    soundService.play('pop')

    try {
      const provider =
        typeof window !== 'undefined'
          ? (window as any).ethereum || (window as any).arcProvider
          : undefined

      const res = await executeDirectCopilotAction(
        {
          ...actionPayload,
          draftId: `svc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          revision: 1,
        },
        walletAddress,
        provider,
        (st) => setProgressState(st),
        ucwHandlers
      )

      if (res.status === 'SUCCESS') {
        setReceipt(res)
        soundService.play('success')
        const nextStep = extractActionableNextStep(activePayload.details)
        if (nextStep && typeof res.amountOut === 'number' && Number.isFinite(res.amountOut) && res.amountOut > 0) {
          void prepareStep2Quote(nextStep, res.amountOut)
        }
      } else if (res.status === 'PENDING') {
        setReceipt(res)
        soundService.play('pop')
        if (res.errorMessage) {
          setErrorKind('cancelled')
          setErrorMsg(res.errorMessage)
        }
      } else {
        // CANCELED or FAILED: keep card actionable so the user can immediately retry.
        const isCanceled = res.status === 'CANCELED' || isUserCanceledMessage(res.errorMessage)
        setReceipt(null)
        soundService.play('error')
        setErrorKind(isCanceled ? 'cancelled' : 'error')
        setErrorMsg(
          res.errorMessage ||
            (isCanceled
              ? 'Transaction was cancelled in your wallet. No funds moved.'
              : 'Transaction was not completed. Please try again.')
        )
      }
    } catch (err: any) {
      console.error('[ServiceActionCard] Execution failed:', err)
      const isCanceled = isUserCanceledMessage(err?.message)
      setReceipt(null)
      soundService.play('error')
      setErrorKind(isCanceled ? 'cancelled' : 'error')
      setErrorMsg(err.message || 'Execution failed on Arc Testnet.')
    } finally {
      setIsExecuting(false)
    }
  }

  const handleAdvanceToStep2 = () => {
    if (!preparedStep2Payload || !receipt) return
    soundService.play('pop')
    setCompletedStep1Receipt(receipt)
    setActivePayload(preparedStep2Payload)
    setPreparedStep2Payload(null)
    setStep2QuoteError(null)
    setReceipt(null)
    setErrorMsg(null)
    setErrorKind(null)
    setProgressState('idle')
  }

  const routeSource =
    typeof activePayload.details.fullPath === 'string' && activePayload.details.fullPath.includes('→')
      ? activePayload.details.fullPath
      : typeof activePayload.badgeText === 'string' && activePayload.badgeText.includes('→')
        ? activePayload.badgeText.split('·').pop() || ''
        : ''
  const routeTokens = routeSource
    ? routeSource.split('→').map((t) => t.trim()).filter(Boolean)
    : []

  const headerTone =
    activePayload.type === 'arbitrage'
      ? STATUS_TONES.info
      : activePayload.type === 'swap'
        ? STATUS_TONES.success
        : STATUS_TONES.pending

  const feedbackTone = errorKind === 'cancelled' ? STATUS_TONES.cancelled : STATUS_TONES.error

  const ctaDisabled = isExecuting || (requiresTradeAmount && !hasValidTradeAmount)
  const ctaLabelText = activePayload.details.buttonLabel
    ? activePayload.details.buttonLabel
    : activePayload.type === 'arbitrage'
      ? 'Review Quote in Swap'
      : activePayload.type === 'navigate' || activePayload.type === 'deposit'
        ? 'Apply & Proceed'
        : 'Execute Opportunity on Arc'

  if (variant === 'inline') {
    return (
      <div className="space-y-2.5">
        {/* Compact Step 1 Confirmation Strip while executing Step 2 of a 2-hop route */}
        {completedStep1Receipt && (
          <div
            className="px-3 py-2 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono"
            style={{
              backgroundColor: STATUS_TONES.success.bg,
              borderColor: STATUS_TONES.success.border,
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: STATUS_TONES.success.accent }} />
              <span className="text-white/90 truncate">
                Step 1/2 Confirmed: {completedStep1Receipt.amountIn} {completedStep1Receipt.fromToken} →{' '}
                <strong style={{ color: STATUS_TONES.success.fg }}>
                  {formatConfirmedOutput(completedStep1Receipt.amountOut)} {completedStep1Receipt.toToken}
                </strong>
              </span>
            </div>
            {completedStep1Receipt.txHash && (
              <a
                href={completedStep1Receipt.explorerUrl || `https://testnet.arcscan.app/tx/${completedStep1Receipt.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:underline shrink-0"
                style={{ color: STATUS_TONES.info.accent }}
              >
                <span>
                  {completedStep1Receipt.txHash.substring(0, 8)}...{completedStep1Receipt.txHash.substring(completedStep1Receipt.txHash.length - 6)}
                </span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Primary Inline Execution Bar */}
        {!receipt && (
          <button
            type="button"
            onClick={handleExecute}
            disabled={ctaDisabled}
            className={`ai-focus-ring w-full px-5 py-3 rounded-full font-semibold text-xs sm:text-[13px] tracking-wide transition-all duration-200 flex items-center justify-center gap-2 select-none ${
              !ctaDisabled
                ? 'text-white hover:scale-[1.01] hover:brightness-110 active:scale-[0.98] cursor-pointer'
                : 'bg-white/[0.04] text-white/40 border border-white/[0.08] cursor-not-allowed opacity-80'
            }`}
            style={{
              fontFamily: 'var(--font-app)',
              ...(!ctaDisabled
                ? {
                    background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                    boxShadow: '0 6px 22px rgba(152, 150, 255, 0.28)',
                  }
                : {}),
            }}
          >
            {isExecuting ? (
              <>
                <Clock className="w-3.5 h-3.5 animate-spin text-white" />
                <span className="capitalize">{progressState}...</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5 text-white shrink-0" />
                <span className="truncate">{ctaLabelText}</span>
                <ArrowRight className="w-3.5 h-3.5 text-white shrink-0" />
              </>
            )}
          </button>
        )}

        {/* Insufficient balance helper (inline) */}
        {!receipt && hasInsufficientArcBalance && availableArcBalance !== null && tradeAmount !== undefined && (
          <div
            className="px-3 py-2 rounded-xl border text-[11px] flex flex-wrap items-center justify-between gap-2"
            style={{
              backgroundColor: STATUS_TONES.cancelled.bg,
              borderColor: STATUS_TONES.cancelled.border,
              color: STATUS_TONES.cancelled.fg,
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: STATUS_TONES.cancelled.accent }} />
              <span>
                Wallet holds {formatCardTokenAmount(availableArcBalance)} {fromTok} (needs {formatCardTokenAmount(tradeAmount)} {fromTok}).
              </span>
            </div>
            {fromTok === 'USDC' ? (
              <a
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-0.5 rounded-full border text-[10px] font-semibold inline-flex items-center gap-1 hover:brightness-110 transition"
                style={{
                  backgroundColor: STATUS_TONES.cancelled.pillBg,
                  borderColor: STATUS_TONES.cancelled.pillBorder,
                  color: STATUS_TONES.cancelled.fg,
                }}
              >
                <span>Faucet</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            ) : onNavigateTab ? (
              <button
                type="button"
                onClick={() => onNavigateTab('swap')}
                className="px-2.5 py-0.5 rounded-full border text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer hover:brightness-110 transition"
                style={{
                  backgroundColor: STATUS_TONES.cancelled.pillBg,
                  borderColor: STATUS_TONES.cancelled.pillBorder,
                  color: STATUS_TONES.cancelled.fg,
                }}
              >
                <span>Open Swap</span>
                <ArrowRight className="w-2.5 h-2.5" />
              </button>
            ) : null}
          </div>
        )}

        {/* Cancelled / Failed feedback (inline) */}
        {errorMsg && (
          <div
            className="p-3 rounded-xl border text-xs flex items-start justify-between gap-2 animate-fade-in"
            style={{
              backgroundColor: feedbackTone.bg,
              borderColor: feedbackTone.border,
              borderLeftWidth: '3px',
              borderLeftColor: feedbackTone.accent,
              color: feedbackTone.fg,
            }}
          >
            <div className="flex items-start gap-2 min-w-0">
              {errorKind === 'cancelled' ? (
                <Ban className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: feedbackTone.accent }} />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: feedbackTone.accent }} />
              )}
              <span className="leading-relaxed">{errorMsg}</span>
            </div>
            <StatusBadge
              tone={errorKind === 'cancelled' ? 'cancelled' : 'error'}
              label={errorKind === 'cancelled' ? 'Cancelled' : 'Failed'}
              size="xs"
            />
          </div>
        )}

        {/* Pending receipt (inline) */}
        {receipt && receipt.status === 'PENDING' && (
          <div
            className="p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-xs animate-fade-in"
            style={{
              backgroundColor: STATUS_TONES.pending.bg,
              borderColor: STATUS_TONES.pending.border,
            }}
          >
            <div className="flex items-center gap-2 font-semibold text-white">
              <Clock className="w-3.5 h-3.5 animate-spin" style={{ color: STATUS_TONES.pending.accent }} />
              <span>Transaction Broadcast — Awaiting Confirmation</span>
            </div>
            {receipt.txHash && (
              <a
                href={receipt.explorerUrl || `https://testnet.arcscan.app/tx/${receipt.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[11px] hover:underline"
                style={{ color: STATUS_TONES.info.accent }}
              >
                <span>{receipt.txHash.substring(0, 8)}...{receipt.txHash.substring(receipt.txHash.length - 6)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Confirmed receipt + Step 2 continuation (inline) */}
        {receipt && receipt.status === 'SUCCESS' && (
          <div
            className="p-3.5 rounded-xl border space-y-2.5 animate-fade-in"
            style={{
              backgroundColor: STATUS_TONES.success.bg,
              borderColor: STATUS_TONES.success.border,
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-white">
                <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: STATUS_TONES.success.accent }} />
                <span>
                  {completedStep1Receipt
                    ? '2-Hop Route Completed!'
                    : activeNextStep
                      ? 'Step 1/2 Confirmed!'
                      : 'Swap Confirmed on Arc!'}
                </span>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums">
                <span className="text-white/80">
                  {receipt.amountIn ?? '—'} {receipt.fromToken || fromTok} →{' '}
                  <strong style={{ color: STATUS_TONES.success.fg }}>
                    {formatConfirmedOutput(receipt.amountOut)} {receipt.toToken || toTok}
                  </strong>
                </span>
                {receipt.txHash && (
                  <a
                    href={receipt.explorerUrl || `https://testnet.arcscan.app/tx/${receipt.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:underline"
                    style={{ color: STATUS_TONES.info.accent }}
                  >
                    <span>Tx</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>

            {activeNextStep && (
              <div
                className="p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2"
                style={{
                  backgroundColor: STATUS_TONES.pending.bg,
                  borderColor: STATUS_TONES.pending.border,
                }}
              >
                <div className="space-y-0.5 min-w-0">
                  <span
                    className="text-[10px] font-mono uppercase tracking-wider block font-bold"
                    style={{ color: STATUS_TONES.pending.accent }}
                  >
                    Step {activeNextStep.step}/{activeNextStep.totalSteps} Live Quote
                  </span>
                  <p className="text-xs text-white/90 font-mono tabular-nums">
                    {step2QuoteLoading
                      ? `Quoting ${activeNextStep.fromToken} → ${activeNextStep.toToken}…`
                      : preparedStep2Payload
                        ? `${formatCardTokenAmount(preparedStep2Payload.details.amountIn ?? 0)} ${activeNextStep.fromToken} → ~${formatCardTokenAmount(preparedStep2Payload.details.estimatedOut ?? 0)} ${activeNextStep.toToken}`
                        : step2QuoteError || `Ready to quote Step 2 (${activeNextStep.fromToken} → ${activeNextStep.toToken}).`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {typeof receipt.amountOut === 'number' && receipt.amountOut > 0 && (
                    <button
                      type="button"
                      disabled={step2QuoteLoading}
                      onClick={() => void prepareStep2Quote(activeNextStep, receipt.amountOut!)}
                      className="ai-focus-ring p-1.5 rounded-full border border-white/15 hover:border-white/30 bg-white/[0.05] text-white/80 hover:text-white transition cursor-pointer disabled:opacity-50"
                      title="Refresh live Step 2 quote"
                      aria-label="Refresh live Step 2 quote"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${step2QuoteLoading ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                  {preparedStep2Payload && (
                    <button
                      type="button"
                      onClick={handleAdvanceToStep2}
                      className="ai-focus-ring px-3.5 py-1.5 rounded-full font-semibold text-xs text-white inline-flex items-center gap-1.5 cursor-pointer hover:brightness-110 transition"
                      style={{
                        background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                        boxShadow: '0 4px 16px rgba(152, 150, 255, 0.28)',
                      }}
                    >
                      <span>Continue to Step 2/2</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="arc-card glow-card mt-4 rounded-2xl p-4 md:p-5 overflow-hidden relative"
      style={{
        background: 'linear-gradient(145deg, rgba(20, 24, 42, 0.94) 0%, rgba(11, 14, 26, 0.97) 100%)',
        border: '1px solid rgba(47, 87, 140, 0.42)',
        boxShadow: '0 14px 36px -10px rgba(0, 0, 0, 0.65), 0 0 24px rgba(152, 150, 255, 0.08)',
      }}
    >
      {/* Compact Step 1 Confirmation Strip while executing Step 2 of a 2-hop route */}
      {completedStep1Receipt && (
        <div
          className="mb-3.5 px-3.5 py-2.5 rounded-xl border flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono"
          style={{
            backgroundColor: STATUS_TONES.success.bg,
            borderColor: STATUS_TONES.success.border,
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: STATUS_TONES.success.accent }} />
            <span className="text-white/90 truncate">
              Step 1/2 Confirmed: {completedStep1Receipt.amountIn} {completedStep1Receipt.fromToken} →{' '}
              <strong style={{ color: STATUS_TONES.success.fg }}>
                {formatConfirmedOutput(completedStep1Receipt.amountOut)} {completedStep1Receipt.toToken}
              </strong>
            </span>
          </div>
          {completedStep1Receipt.txHash && (
            <a
              href={completedStep1Receipt.explorerUrl || `https://testnet.arcscan.app/tx/${completedStep1Receipt.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:underline shrink-0"
              style={{ color: STATUS_TONES.info.accent }}
            >
              <span>
                {completedStep1Receipt.txHash.substring(0, 8)}...{completedStep1Receipt.txHash.substring(completedStep1Receipt.txHash.length - 6)}
              </span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-white/[0.08]">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0"
            style={{
              backgroundColor: headerTone.bg,
              borderColor: headerTone.border,
              color: headerTone.accent,
            }}
          >
            {activePayload.type === 'arbitrage' ? (
              <Zap className="w-4 h-4" />
            ) : activePayload.type === 'swap' ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <Coins className="w-4 h-4" />
            )}
          </div>
          <div className="min-w-0">
            <h5
              className="text-sm md:text-base font-bold text-white tracking-tight truncate"
              style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
            >
              {activePayload.title}
            </h5>
          </div>
        </div>

        {/* Action Button */}
        {!receipt && (
          <button
            onClick={handleExecute}
            disabled={isExecuting || (requiresTradeAmount && !hasValidTradeAmount)}
            className={`ai-focus-ring px-5 py-2.5 rounded-full font-semibold text-xs tracking-wide transition-all duration-200 flex items-center justify-center gap-2 select-none shrink-0 ${
              !(isExecuting || (requiresTradeAmount && !hasValidTradeAmount))
                ? 'text-white hover:scale-[1.01] hover:brightness-110 active:scale-[0.98] cursor-pointer'
                : 'bg-white/[0.04] text-white/40 border border-white/[0.08] cursor-not-allowed opacity-80'
            }`}
            style={{
              fontFamily: 'var(--font-app)',
              ...(!(isExecuting || (requiresTradeAmount && !hasValidTradeAmount))
                ? {
                    background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                    boxShadow: '0 6px 24px rgba(152, 150, 255, 0.3)',
                  }
                : {}),
            }}
          >
            {isExecuting ? (
              <>
                <Clock className="w-3.5 h-3.5 animate-spin text-white" />
                <span className="capitalize">{progressState}...</span>
              </>
            ) : (
              <>
                <span>
                  {activePayload.details.buttonLabel
                    ? activePayload.details.buttonLabel
                    : activePayload.type === 'arbitrage'
                      ? 'Review Quote in Swap'
                      : activePayload.type === 'navigate' || activePayload.type === 'deposit'
                        ? 'Apply & Proceed'
                        : 'Execute Opportunity on Arc'}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-white" />
              </>
            )}
          </button>
        )}
      </div>

      {/* Signal Execution Details Grid */}
      {!receipt ? (
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-4 my-3.5 px-4 py-4 rounded-xl border border-white/[0.06] text-xs"
          style={{ background: 'rgba(8, 10, 18, 0.72)' }}
        >
          <div>
            <span
              className="text-[10px] font-mono uppercase tracking-wider block"
              style={{ color: 'var(--secondary-colors--sky-sync)' }}
            >
              Input Amount
            </span>
            <span
              className="font-bold text-white tabular-nums inline-flex items-center gap-1.5 mt-1.5 text-sm"
              style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
            >
              <PinnedTokenIcon symbol={fromTok} size={16} className="shrink-0" />
              <span>{tradeAmount ?? 'Not provided'} {fromTok}</span>
            </span>
            {availableArcBalance !== null && (
              <span
                className="block text-[10px] font-mono mt-1 tabular-nums"
                style={{
                  color: hasInsufficientArcBalance ? STATUS_TONES.cancelled.fg : 'var(--fp-4)',
                }}
              >
                Wallet: {formatCardTokenAmount(availableArcBalance)} {fromTok}
              </span>
            )}
          </div>
          {activePayload.type === 'arbitrage' ? (
            <div
              className="col-span-2 sm:col-span-4 px-3 py-2 rounded-xl border text-[11px] flex items-center gap-2"
              style={{
                backgroundColor: STATUS_TONES.cancelled.bg,
                borderColor: STATUS_TONES.cancelled.border,
                color: STATUS_TONES.cancelled.fg,
              }}
            >
              <AlertCircle
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: STATUS_TONES.cancelled.accent }}
              />
              <span>
                This is analysis, not an executable arbitrage route. Review a fresh quote and confirm separately in Swap.
              </span>
            </div>
          ) : requiresTradeAmount && !hasValidTradeAmount ? (
            <div
              className="col-span-2 sm:col-span-4 px-3 py-2 rounded-xl border text-[11px] flex items-center gap-2"
              style={{
                backgroundColor: STATUS_TONES.cancelled.bg,
                borderColor: STATUS_TONES.cancelled.border,
                color: STATUS_TONES.cancelled.fg,
              }}
            >
              <AlertCircle
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: STATUS_TONES.cancelled.accent }}
              />
              <span>An explicit positive amount is required before this action can execute.</span>
            </div>
          ) : null}
          <div>
            <span
              className="text-[10px] font-mono uppercase tracking-wider block"
              style={{ color: 'var(--secondary-colors--sky-sync)' }}
            >
              Estimated Output
            </span>
            <span
              className="font-bold text-white tabular-nums inline-flex items-center gap-1.5 mt-1.5 text-sm"
              style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
            >
              <PinnedTokenIcon symbol={toTok} size={16} className="shrink-0" />
              <span>
                {typeof activePayload.details.estimatedOut === 'number'
                  ? formatCardTokenAmount(activePayload.details.estimatedOut)
                  : '--'}{' '}
                {toTok}
              </span>
            </span>
            {previewMinReceived && (
              <span className="block text-[10px] font-mono mt-1 tabular-nums" style={{ color: 'var(--fp-4)' }}>
                Min ({actionSlippagePct}%): {formatCardTokenAmount(Number(previewMinReceived))} {toTok}
              </span>
            )}
          </div>
          <div>
            <span
              className="text-[10px] font-mono uppercase tracking-wider block"
              style={{ color: 'var(--secondary-colors--sky-sync)' }}
            >
              Net Advantage / Route
            </span>
            <span
              className="text-white font-bold tabular-nums inline-flex items-center gap-1 mt-1.5"
              title={routeTokens.length >= 2 ? routeTokens.join(' → ') : undefined}
              style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
            >
              {activePayload.details.spreadPct ? (
                <span style={{ color: STATUS_TONES.success.fg }}>
                  +{activePayload.details.spreadPct.toFixed(2)}%
                </span>
              ) : activePayload.details.estimatedProfitUsdc ? (
                <span style={{ color: STATUS_TONES.success.fg }}>
                  +${activePayload.details.estimatedProfitUsdc.toFixed(4)}
                </span>
              ) : routeTokens.length >= 2 ? (
                routeTokens.map((tok, idx) => (
                  <span key={`${tok}-${idx}`} className="inline-flex items-center gap-1">
                    {idx > 0 && (
                      <ArrowRight
                        className="w-3 h-3 shrink-0"
                        style={{ color: 'var(--secondary-colors--sky-sync)' }}
                      />
                    )}
                    <PinnedTokenIcon symbol={tok} size={24} className="shrink-0" />
                  </span>
                ))
              ) : (
                activePayload.badgeText
              )}
            </span>
          </div>
          <div>
            <span
              className="text-[10px] font-mono uppercase tracking-wider block"
              style={{ color: 'var(--secondary-colors--sky-sync)' }}
            >
              Target Route / Pool
            </span>
            <span
              className="font-bold text-xs text-white tabular-nums block mt-1.5"
              title={activePayload.details.optimalPool || activePayload.details.poolAddress || 'Arcis Curve StableSwap'}
            >
              {activePayload.details.optimalPool
                ? activePayload.details.optimalPool.replace('Arcis ', '')
                : 'Curve StableSwap'}
            </span>
          </div>

          {hasInsufficientArcBalance && availableArcBalance !== null && tradeAmount !== undefined && (
            <div
              className="col-span-2 sm:col-span-4 px-3 py-2.5 rounded-xl border text-[11px] flex flex-wrap items-center justify-between gap-2"
              style={{
                backgroundColor: STATUS_TONES.cancelled.bg,
                borderColor: STATUS_TONES.cancelled.border,
                color: STATUS_TONES.cancelled.fg,
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: STATUS_TONES.cancelled.accent }} />
                <span>
                  Arc wallet holds {formatCardTokenAmount(availableArcBalance)} {fromTok}, below the {formatCardTokenAmount(tradeAmount)} {fromTok} order size. Fund or reduce amount before signing.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {fromTok === 'USDC' ? (
                  <a
                    href="https://faucet.circle.com"
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 rounded-full border text-[10px] font-semibold inline-flex items-center gap-1 hover:brightness-110 transition"
                    style={{
                      backgroundColor: STATUS_TONES.cancelled.pillBg,
                      borderColor: STATUS_TONES.cancelled.pillBorder,
                      color: STATUS_TONES.cancelled.fg,
                    }}
                  >
                    <span>Faucet</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                ) : onNavigateTab ? (
                  <button
                    type="button"
                    onClick={() => onNavigateTab('swap')}
                    className="px-2.5 py-1 rounded-full border text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer hover:brightness-110 transition"
                    style={{
                      backgroundColor: STATUS_TONES.cancelled.pillBg,
                      borderColor: STATUS_TONES.cancelled.pillBorder,
                      color: STATUS_TONES.cancelled.fg,
                    }}
                  >
                    <span>Open Swap</span>
                    <ArrowRight className="w-2.5 h-2.5" />
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Cancelled (Gold) vs Failed (Crimson) feedback state */}
      {errorMsg && (
        <div
          className="mt-3 p-3.5 rounded-xl border text-xs space-y-2 animate-fade-in"
          style={{
            backgroundColor: feedbackTone.bg,
            borderColor: feedbackTone.border,
            borderLeftWidth: '3px',
            borderLeftColor: feedbackTone.accent,
            color: feedbackTone.fg,
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5 min-w-0">
              {errorKind === 'cancelled' ? (
                <Ban
                  className="w-4 h-4 flex-shrink-0 mt-0.5"
                  style={{ color: feedbackTone.accent }}
                />
              ) : (
                <AlertCircle
                  className="w-4 h-4 flex-shrink-0 mt-0.5"
                  style={{ color: feedbackTone.accent }}
                />
              )}
              <span className="leading-relaxed">{errorMsg}</span>
            </div>
            <StatusBadge
              tone={errorKind === 'cancelled' ? 'cancelled' : 'error'}
              label={errorKind === 'cancelled' ? 'Cancelled' : 'Failed'}
              size="xs"
            />
          </div>
          {errorMsg.includes('bakiye') || errorMsg.includes('balance') || errorMsg.includes('faucet') ? (
            <div className="pt-1 flex flex-wrap items-center gap-2">
              <a
                href="https://faucet.circle.com"
                target="_blank"
                rel="noreferrer"
                className="px-3 py-1.5 rounded-full border text-[11px] font-semibold inline-flex items-center gap-1.5 transition hover:brightness-110"
                style={{
                  backgroundColor: STATUS_TONES.pending.pillBg,
                  borderColor: STATUS_TONES.pending.pillBorder,
                  color: STATUS_TONES.pending.fg,
                }}
              >
                <PinnedTokenIcon symbol="USDC" size={13} className="shrink-0" />
                <span>Get Arc Testnet USDC (Circle Faucet)</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          ) : null}
        </div>
      )}

      {/* Pending Receipt Card */}
      {receipt && receipt.status === 'PENDING' && (
        <div
          className="mt-3 p-4 rounded-xl border space-y-2 animate-fade-in"
          style={{
            backgroundColor: STATUS_TONES.pending.bg,
            borderColor: STATUS_TONES.pending.border,
            borderLeftWidth: '3px',
            borderLeftColor: STATUS_TONES.pending.accent,
          }}
        >
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-bold text-white">
              <Clock className="w-4 h-4 animate-spin" style={{ color: STATUS_TONES.pending.accent }} />
              <span>Transaction Broadcast — Awaiting Confirmation</span>
            </div>
            <StatusBadge tone="pending" label="Pending" size="xs" />
          </div>
          {receipt.txHash && (
            <a
              href={receipt.explorerUrl || `https://testnet.arcscan.app/tx/${receipt.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] hover:underline"
              style={{ color: STATUS_TONES.info.accent }}
            >
              <span>{receipt.txHash.substring(0, 10)}...{receipt.txHash.substring(receipt.txHash.length - 8)}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Success Receipt Card */}
      {receipt && receipt.status === 'SUCCESS' && (
        <div
          className="mt-3 p-4 rounded-xl border space-y-3 animate-fade-in"
          style={{
            backgroundColor: STATUS_TONES.success.bg,
            borderColor: STATUS_TONES.success.border,
            borderLeftWidth: '3px',
            borderLeftColor: STATUS_TONES.success.accent,
          }}
        >
          <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
            <div className="flex items-center gap-2 font-bold" style={{ color: STATUS_TONES.success.fg }}>
              <CheckCircle2 className="w-4 h-4" style={{ color: STATUS_TONES.success.accent }} />
              <span
                className="text-sm text-white"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                {completedStep1Receipt
                  ? '2-Hop Route Completed on Arc Testnet!'
                  : activeNextStep
                    ? 'Step 1 of 2 Confirmed on Arc Testnet!'
                    : 'Successfully Confirmed on Arc Testnet!'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge tone="success" label="Confirmed" size="xs" />
              {receipt.settlementLatencyMs ? (
                <span className="text-[10px] font-mono tabular-nums" style={{ color: 'var(--fp-3)' }}>
                  {receipt.settlementLatencyMs}ms
                </span>
              ) : null}
            </div>
          </div>

          <div
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 py-2.5 border-y text-xs font-mono"
            style={{ borderColor: STATUS_TONES.success.border }}
          >
            <div>
              <span className="text-[10px] block uppercase tracking-wider" style={{ color: 'var(--fp-4)' }}>
                Swapped
              </span>
              <span
                className="font-bold text-white inline-flex items-center gap-1.5 mt-1 tabular-nums"
                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
              >
                <PinnedTokenIcon symbol={receipt.fromToken || fromTok} size={15} className="shrink-0" />
                <span>
                  {receipt.amountIn !== undefined && Number.isFinite(receipt.amountIn)
                    ? receipt.amountIn
                    : 'Unavailable'}{' '}
                  {receipt.fromToken || fromTok}
                </span>
              </span>
            </div>
            <div>
              <span className="text-[10px] block uppercase tracking-wider" style={{ color: 'var(--fp-4)' }}>
                Received
              </span>
              <span
                className="font-bold inline-flex items-center gap-1.5 mt-1 tabular-nums"
                style={{
                  color: STATUS_TONES.success.fg,
                  fontFamily: 'var(--fonts--space-grotesk)',
                }}
              >
                <PinnedTokenIcon symbol={receipt.toToken || toTok} size={15} className="shrink-0" />
                <span>
                  {formatConfirmedOutput(receipt.amountOut)} {receipt.toToken || toTok}
                </span>
              </span>
            </div>
            <div>
              <span className="text-[10px] block uppercase tracking-wider" style={{ color: 'var(--fp-4)' }}>
                Actual Gas Fee
              </span>
              <span
                className="font-bold inline-flex items-center gap-1.5 mt-1 tabular-nums"
                style={{
                  color: STATUS_TONES.info.accent,
                  fontFamily: 'var(--fonts--space-grotesk)',
                }}
              >
                <PinnedTokenIcon symbol="USDC" size={14} className="shrink-0" />
                <span>{formatVerifiedGasFee(receipt.actualGasUsdc)}</span>
              </span>
            </div>
          </div>

          {/* 2-Hop Step 2 Continuation Panel — live-quoted from confirmed Step 1 output */}
          {activeNextStep && (
            <div
              className="p-3.5 rounded-xl border space-y-2.5"
              style={{
                backgroundColor: STATUS_TONES.pending.bg,
                borderColor: STATUS_TONES.pending.border,
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5 min-w-0">
                  <span
                    className="text-[10px] font-mono uppercase tracking-wider block font-bold"
                    style={{ color: STATUS_TONES.pending.accent }}
                  >
                    Next Hop Ready · Step {activeNextStep.step}/{activeNextStep.totalSteps}
                  </span>
                  <p className="text-xs text-white/90 font-sans">
                    {step2QuoteLoading
                      ? `Quoting live ${activeNextStep.fromToken} → ${activeNextStep.toToken} rate for confirmed ${formatConfirmedOutput(receipt.amountOut)} ${activeNextStep.fromToken}…`
                      : preparedStep2Payload
                        ? `Live quote ready: ${formatCardTokenAmount(preparedStep2Payload.details.amountIn ?? 0)} ${activeNextStep.fromToken} → ~${formatCardTokenAmount(preparedStep2Payload.details.estimatedOut ?? 0)} ${activeNextStep.toToken}`
                        : step2QuoteError || `Ready to quote Step 2 (${activeNextStep.fromToken} → ${activeNextStep.toToken}).`}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {typeof receipt.amountOut === 'number' && receipt.amountOut > 0 && (
                    <button
                      type="button"
                      disabled={step2QuoteLoading}
                      onClick={() => void prepareStep2Quote(activeNextStep, receipt.amountOut!)}
                      className="ai-focus-ring p-2 rounded-full border border-white/15 hover:border-white/30 bg-white/[0.05] text-white/80 hover:text-white transition cursor-pointer disabled:opacity-50"
                      title="Refresh live Step 2 quote"
                      aria-label="Refresh live Step 2 quote"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${step2QuoteLoading ? 'animate-spin' : ''}`} />
                    </button>
                  )}
                  {preparedStep2Payload && (
                    <button
                      type="button"
                      onClick={handleAdvanceToStep2}
                      className="ai-focus-ring px-4 py-2 rounded-full font-semibold text-xs text-white inline-flex items-center gap-1.5 cursor-pointer hover:brightness-110 transition"
                      style={{
                        background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                        boxShadow: '0 4px 18px rgba(152, 150, 255, 0.3)',
                      }}
                    >
                      <span>Continue to Step 2/2</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-0.5">
            {receipt.txHash ? (
              <a
                href={receipt.explorerUrl || `https://testnet.arcscan.app/tx/${receipt.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 font-mono hover:underline"
                style={{ color: STATUS_TONES.info.accent }}
              >
                <span>{receipt.txHash.substring(0, 10)}...{receipt.txHash.substring(receipt.txHash.length - 8)}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            ) : null}

            {onNavigateTab && (
              <button
                onClick={() => onNavigateTab('swap')}
                className="ai-focus-ring px-3 py-1 rounded-full border text-[10px] font-bold flex items-center gap-1 transition cursor-pointer hover:brightness-110"
                style={{
                  backgroundColor: STATUS_TONES.success.pillBg,
                  borderColor: STATUS_TONES.success.pillBorder,
                  color: STATUS_TONES.success.fg,
                }}
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
