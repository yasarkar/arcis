import { formatUnits } from 'viem'
import type { SpeedTier } from '../../config/feeTiers'
import { COPILOT_SEND_DECIMALS } from '../../config/copilotTokens'
import type { CopilotActionPayload } from '../../types/marketplace'
import { numberToExactDecimal } from '../../utils/copilotAmount'
import { exactSwapOutputUnits, swapMinimumUnits, swapPercentToBps } from '../../utils/swapSlippage'
import { ARC_GAS_LIMITS, calculateArcGasCostFromFee, getDynamicArcGasOptions } from '../arcGasService'
import { getSwapEstimate } from '../swapService'

export interface CopilotExecutionSettingsSnapshot {
  copilotSlippage: number
  copilotSpeedTier: SpeedTier
}

function gasLimitForDraft(payload: CopilotActionPayload): bigint {
  const type = payload.type
  const data = payload.data || {}
  if (type === 'interactive_send' || type === 'send' || type === 'interactive_batch_send') {
    const hasMemo = Boolean(data.memo && String(data.memo).trim().length > 0)
    const tokenSymbol = String(data.tokenSymbol || data.token || 'USDC').toUpperCase()
    if (hasMemo) return ARC_GAS_LIMITS.memoTransfer
    return tokenSymbol === 'USDC' ? ARC_GAS_LIMITS.nativeTransfer : ARC_GAS_LIMITS.erc20Transfer
  }
  return ARC_GAS_LIMITS.contractInteraction
}

function resolveOutDecimals(symbol: string): number {
  const upper = symbol.toUpperCase()
  if (upper === 'CIRBTC') return COPILOT_SEND_DECIMALS.cirBTC ?? 8
  if (upper === 'WETH' || upper === 'ETH') return COPILOT_SEND_DECIMALS.WETH ?? 18
  return 6
}

/**
 * Re-prices an active (unsubmitted) transactional Copilot draft when the user
 * updates Ask Arco execution settings (slippage tolerance or gas speed tier).
 * Returns an updated payload with fresh slippageBps, minReceived, estimatedOut,
 * rate, title, and estimatedFeeUsdc, or null if the draft is not updatable.
 */
export async function syncDraftWithExecutionSettings(
  draft: CopilotActionPayload,
  settings: CopilotExecutionSettingsSnapshot,
  walletAddress?: string
): Promise<CopilotActionPayload | null> {
  if (!draft || !draft.data) return null
  const isSwap = draft.type === 'interactive_swap' || draft.type === 'trade'
  const isSend =
    draft.type === 'interactive_send' ||
    draft.type === 'send' ||
    draft.type === 'interactive_batch_send'
  const isDeposit = draft.type === 'interactive_deposit' || draft.type === 'view_pool'

  if (!isSwap && !isSend && !isDeposit) return null

  const data = draft.data
  const nextData: Record<string, any> = { ...data }
  let nextTitle = draft.title

  // 1. Update Swap slippage, live quote, and minimum received
  if (isSwap) {
    let slippageBps: number
    try {
      slippageBps = swapPercentToBps(settings.copilotSlippage)
    } catch {
      return null
    }

    const fromToken = String(data.fromToken || 'USDC')
    const toToken = String(data.toToken || 'EURC')
    const amount = Number(data.amount)
    const amountDecimal =
      typeof data.amountDecimal === 'string' && data.amountDecimal
        ? data.amountDecimal
        : Number.isFinite(amount) && amount > 0
          ? numberToExactDecimal(amount)
          : null

    let estimatedOut: string | undefined =
      data.estimatedOut !== undefined && data.estimatedOut !== null
        ? String(data.estimatedOut)
        : undefined
    let minReceived: string | undefined =
      typeof data.minReceived === 'string' ? data.minReceived : undefined
    let rate: number | undefined = typeof data.rate === 'number' ? data.rate : undefined

    let refreshedLiveQuote = false
    if (amountDecimal) {
      try {
        const quote = await getSwapEstimate({
          fromChain: 'Arc_Testnet',
          tokenIn: fromToken,
          tokenOut: toToken,
          amountIn: amountDecimal,
          recipientAddress: walletAddress,
          slippageBps,
        })
        if (
          Number.isFinite(Number(quote.estimatedOutput)) &&
          Number(quote.estimatedOutput) > 0 &&
          Number.isFinite(Number(quote.stopLimit)) &&
          Number(quote.stopLimit) > 0 &&
          Number(quote.stopLimit) <= Number(quote.estimatedOutput)
        ) {
          estimatedOut = quote.estimatedOutput
          minReceived = quote.stopLimit
          rate = Number(quote.rate)
          refreshedLiveQuote = true
        }
      } catch {
        // Deterministic fallback below recalculates minReceived from existing estimatedOut
      }
    }

    if (!refreshedLiveQuote && estimatedOut) {
      try {
        const outDecimals = resolveOutDecimals(toToken)
        const outUnits = exactSwapOutputUnits(estimatedOut, outDecimals)
        minReceived = formatUnits(swapMinimumUnits(outUnits, slippageBps), outDecimals)
      } catch {
        // Leave minReceived unchanged if existing output cannot be parsed
      }
    }

    nextData.slippage = undefined
    nextData.slippageBps = slippageBps
    if (estimatedOut !== undefined) nextData.estimatedOut = estimatedOut
    if (minReceived !== undefined) nextData.minReceived = minReceived
    if (rate !== undefined && Number.isFinite(rate)) nextData.rate = rate
    if (Number.isFinite(amount) && amount > 0) {
      nextTitle = `🔄 Confirm Swap: ${amount} ${fromToken}${
        estimatedOut === undefined ? '' : ` ➔ ${estimatedOut} ${toToken}`
      }`
    }
  }

  // 2. Update Network Fee for Swap, Send, and Deposit using the selected gas speed tier
  const gasLimit = gasLimitForDraft(draft)
  try {
    const gas = await getDynamicArcGasOptions(undefined, settings.copilotSpeedTier, gasLimit)
    nextData.estimatedFeeUsdc = calculateArcGasCostFromFee(gasLimit, gas.maxFeePerGas)
    nextData.feeEstimateSource = gas.source
  } catch {
    // Keep existing fee estimate if RPC is temporarily unreachable
  }

  return {
    ...draft,
    title: nextTitle,
    data: nextData,
  }
}
