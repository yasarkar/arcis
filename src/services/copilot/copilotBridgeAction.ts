import { numberToExactDecimal } from '../../utils/copilotAmount'
import { resolveCanonicalChainKey, getChainDisplayName } from '../../config/chainMeta'
import { isBridgeRouteSupported } from '../../config/bridgeRouteMatrix'
import { getExplorerTxUrl } from '../../config/sendConfig'
import { addTransaction } from '../../utils/history'
import { formatCopilotError, isUserCanceled } from '../../utils/errorUtils'
import type { InlineExecutionReceipt } from '../../types/sessionKey'
import {
  verifySessionLimits,
  deductSessionSpend,
} from '../sessionKeyService'
import { createViemAdapter } from '../sendService'
import { executeBridge } from '../bridgeService'
import { pollCctpDestinationTx } from '../bridgeUcwService'
import {
  type CopilotActionContext,
  failedActionReceipt,
  isPositiveTokenAmount,
  isTransactionHash,
} from './copilotCommon'

export async function executeCopilotBridgeAction(
  context: CopilotActionContext,
  sessionConfig: { isActive: boolean }
): Promise<InlineExecutionReceipt> {
  const {
    actionPayload,
    activeWallet,
    provider,
    onProgress,
    ucwHandlers,
    budgetManaged,
    startTime,
  } = context
  const data = actionPayload.data || {}

  const amount = Number(data.amount)
  if (!isPositiveTokenAmount(amount, 6)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('bridge', 'Invalid Bridge Amount', 'Bridge amount must be greater than zero and have at most 6 decimal places.', startTime)
  }
  const rawFromChain = data.fromChain || 'Arc Testnet'
  const rawToChain = data.toChain || (rawFromChain === 'Arc Testnet' ? 'Ethereum Sepolia' : 'Arc Testnet')

  const sourceChainKey = resolveCanonicalChainKey(rawFromChain)
  const destChainKey = resolveCanonicalChainKey(rawToChain)
  const fromDisplayName = getChainDisplayName(sourceChainKey)
  const toDisplayName = getChainDisplayName(destChainKey)
  const bridgeRecipient = String(data.recipient || activeWallet).trim()
  if (!bridgeRecipient) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('bridge', 'Invalid Bridge Recipient', 'A destination recipient is required; no transaction was sent.', startTime)
  }

  // The assistant can name any pair; this app can only complete the routes in
  // the shared matrix (which is also what the Bridge tab offers). Refuse here,
  // before any signer is touched, so an unsupported route is one clear message
  // instead of a burn that fails mid-flight. Copilot bridges are USDC-only.
  if (!isBridgeRouteSupported('USDC', sourceChainKey, destChainKey)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt(
      'bridge',
      'Route Not Supported',
      `USDC cannot be bridged from ${fromDisplayName} to ${toDisplayName} in this app. No transaction was sent.`,
      startTime
    )
  }

  const limitCheck = verifySessionLimits('bridge', amount, activeWallet)
  if (!budgetManaged && !limitCheck.allowed && sessionConfig.isActive) {
    if (onProgress) onProgress('failed')
    return {
      id: `rcpt_${Date.now()}`,
      actionType: 'bridge',
      title: `Bridge Failed: ${amount} USDC`,
      status: 'FAILED',
      txHash: '',
      fromChain: fromDisplayName,
      toChain: toDisplayName,
      amountIn: amount,
      gasUsdc: 0,
      settlementLatencyMs: Date.now() - startTime,
      timestamp: Date.now(),
      errorMessage: limitCheck.reason || 'Session limit exceeded.',
    }
  }

  if (ucwHandlers?.authSource === 'ucw') {
    if (!ucwHandlers.executeUcwContract || sourceChainKey !== 'Arc_Testnet') {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('bridge', 'Circle UCW Bridge Unavailable', 'UCW bridge requires its contract challenge handler and an Arc Testnet source chain; no fallback signer was used.', startTime)
    }
    try {
      const ucwBridge = await import('../bridgeUcwService')
      const result = await ucwBridge.executeUcwBridgeTransfer({
        amount: numberToExactDecimal(amount)!, sourceChain: sourceChainKey, destChain: destChainKey,
        recipientAddress: bridgeRecipient, connectedAddress: activeWallet,
        executeUcwContract: ucwHandlers.executeUcwContract,
        resolveChallengeTx: ucwHandlers.pollChallengeTx,
        onStepProgress: (step) => {
          if (step === 'approving') onProgress?.('signing')
          else if (step === 'burning') onProgress?.('broadcasting')
          else if (step === 'completed') onProgress?.('pending')
        },
      })
      if (!isTransactionHash(result.burnTxHash)) {
        if (onProgress) onProgress('pending')
        return {
          id: `rcpt_pending_${Date.now()}`, actionType: 'bridge', title: 'Bridge Submitted — Source Transaction Pending',
          status: 'PENDING', txHash: '', fromChain: fromDisplayName, toChain: toDisplayName, amountIn: amount, recipient: bridgeRecipient,
          gasUsdc: 0, settlementLatencyMs: Date.now() - startTime, timestamp: Date.now(),
          errorMessage: 'Circle UCW accepted the challenge but no valid source transaction hash is available yet.',
        }
      }
      if (onProgress) onProgress('pending')
      return {
        id: `rcpt_pending_${Date.now()}`,
        actionType: 'bridge',
        title: 'Source Burn Confirmed but Destination Mint Pending.',
        subtitle: 'The burn transaction has been confirmed on the source network, while the mint process on the destination network is currently in progress via Circle CCTP.',
        status: 'PENDING',
        txHash: result.burnTxHash,
        sourceTxHash: result.burnTxHash,
        explorerUrl: result.sourceExplorerUrl,
        fromChain: fromDisplayName,
        toChain: toDisplayName,
        amountIn: amount,
        recipient: bridgeRecipient,
        gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime,
        timestamp: Date.now(),
        errorMessage: 'The burn transaction has been confirmed on the source network, while the mint process on the destination network is currently in progress via Circle CCTP.',
      }
    } catch (error: any) {
      if (onProgress) onProgress('failed')
      const cleanError = formatCopilotError(error)
      return failedActionReceipt('bridge', cleanError.title || 'Bridge Failed', cleanError.message || error.message, startTime)
    }
  }

  let sourceAdapter: any
  const effectiveProvider = provider || (typeof window !== 'undefined' && (window as any).ethereum ? (window as any).ethereum : null)

  if (effectiveProvider) {
    sourceAdapter = await createViemAdapter(effectiveProvider)
  } else {
    if (onProgress) onProgress('failed')
    return {
      id: `rcpt_err_${Date.now()}`,
      actionType: 'bridge',
      title: `Bridge Failed: ${amount} USDC`,
      status: 'FAILED',
      txHash: '',
      fromChain: fromDisplayName,
      toChain: toDisplayName,
      amountIn: amount,
      gasUsdc: 0,
      settlementLatencyMs: Date.now() - startTime,
      timestamp: Date.now(),
      errorMessage: 'İşlem adaptörü oluşturulamadı. Lütfen Web3 cüzdanınızı (MetaMask/Rainbow) bağlayın.',
    }
  }

  try {
    if (onProgress) onProgress('routing')

    const result: any = await executeBridge(
      {
        fromChain: sourceChainKey,
        toChain: destChainKey,
        amount: numberToExactDecimal(amount)!,
        sourceAdapter,
        recipientAddress: bridgeRecipient,
        useForwarder: true,
        transferSpeed: 'FAST',
      },
      (step) => {
        if (step.name === 'approve' || step.name === 'approveFee') {
          if (onProgress) onProgress('signing')
        } else if (step.name === 'burn' || step.name === 'transfer') {
          if (onProgress) onProgress('broadcasting')
        } else if (step.name === 'fetchAttestation') {
          if (onProgress) onProgress('routing')
        } else if (step.name === 'mint' || step.name === 'forward') {
          if (onProgress) onProgress('broadcasting')
        }
      }
    )

    if (!result || result.state === 'error' || result.status === 'error' || result.status === 'failed') {
      const errorStep = result?.steps?.find((s: any) => s.state === 'error' || s.errorMessage || s.error)
      const errorMsg = errorStep?.errorMessage || errorStep?.error?.message || result?.errorMessage || result?.error?.message || 'CCTP Bridge transfer failed.'
      throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg))
    }

    const mintTxHash =
      result?.mintTxHash ||
      result?.forwardTxHash ||
      result?.steps?.find((s: any) => s.name === 'mint' || s.name === 'forward')?.txHash ||
      result?.steps?.find((s: any) => s.name === 'mint' || s.name === 'forward')?.data?.forwardTxHash
    const burnTxHash =
      result?.burnTxHash ||
      result?.transferTxHash ||
      result?.txHash ||
      result?.steps?.find((s: any) => s.name === 'burn' || s.name === 'transfer')?.txHash
    const sourceHash = isTransactionHash(burnTxHash) ? burnTxHash : ''
    const destinationHash = isTransactionHash(mintTxHash) ? mintTxHash : ''
    if (!sourceHash && !destinationHash) {
      throw new Error('Bridge result did not include a valid source or destination transaction hash.')
    }
    if (!destinationHash) {
      if (sourceHash) {
        addTransaction({ type: 'bridge', txHash: sourceHash, amount: numberToExactDecimal(amount)!, tokenSymbol: 'USDC', sourceChain: sourceChainKey, destChain: destChainKey, recipient: bridgeRecipient, userAddress: activeWallet, status: 'pending' })
      }
      if (onProgress) onProgress('pending')
      return {
        id: `rcpt_pending_${Date.now()}`,
        actionType: 'bridge',
        title: 'Source Burn Confirmed but Destination Mint Pending.',
        subtitle: 'The burn transaction has been confirmed on the source network, while the mint process on the destination network is currently in progress via Circle CCTP.',
        status: 'PENDING',
        txHash: sourceHash,
        sourceTxHash: sourceHash,
        explorerUrl: sourceHash ? getExplorerTxUrl(sourceChainKey, sourceHash) : undefined,
        fromChain: fromDisplayName,
        toChain: toDisplayName,
        amountIn: amount,
        recipient: bridgeRecipient,
        gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime,
        timestamp: Date.now(),
        errorMessage: 'The burn transaction has been confirmed on the source network, while the mint process on the destination network is currently in progress via Circle CCTP.',
      }
    }
    const destinationSettlement = await pollCctpDestinationTx({
      sourceChain: sourceChainKey,
      destChain: destChainKey,
      burnTxHash: sourceHash,
      recipientAddress: bridgeRecipient,
      amount: numberToExactDecimal(amount)!,
      maxAttempts: 1,
      intervalMs: 0,
    })
    if (
      destinationSettlement.status !== 'confirmed' ||
      destinationSettlement.destTxHash?.toLowerCase() !== destinationHash.toLowerCase()
    ) {
      if (sourceHash) addTransaction({ type: 'bridge', txHash: sourceHash, amount: numberToExactDecimal(amount)!, tokenSymbol: 'USDC', sourceChain: sourceChainKey, destChain: destChainKey, recipient: bridgeRecipient, userAddress: activeWallet, status: 'pending' })
      if (onProgress) onProgress('pending')
      return {
        id: `rcpt_pending_${Date.now()}`,
        actionType: 'bridge',
        title: 'Source Burn Confirmed but Destination Mint Pending.',
        subtitle: 'The burn transaction has been confirmed on the source network, while the mint process on the destination network is currently in progress via Circle CCTP.',
        status: 'PENDING',
        txHash: sourceHash,
        sourceTxHash: sourceHash,
        explorerUrl: sourceHash ? getExplorerTxUrl(sourceChainKey, sourceHash) : undefined,
        fromChain: fromDisplayName,
        toChain: toDisplayName,
        amountIn: amount,
        recipient: bridgeRecipient,
        gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime,
        timestamp: Date.now(),
        errorMessage: 'The burn transaction has been confirmed on the source network, while the mint process on the destination network is currently in progress via Circle CCTP.',
      }
    }
    const realTxHash = destinationHash

    // Determine explorer URL for confirmed destination mint.
    const explorerUrl = getExplorerTxUrl(destChainKey, realTxHash)
    const durationMs = Date.now() - startTime

    if (!budgetManaged) deductSessionSpend(amount, activeWallet)

    addTransaction({
      type: 'bridge',
      txHash: realTxHash,
      amount: numberToExactDecimal(amount)!,
      tokenSymbol: 'USDC',
      sourceChain: sourceChainKey,
      destChain: destChainKey,
      recipient: bridgeRecipient,
      userAddress: activeWallet,
      status: 'success',
    })

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('arcis_portfolio_updated'))
    }

    if (onProgress) onProgress('confirmed')

    return {
      id: `rcpt_${Date.now()}`,
      actionType: 'bridge',
      title: `Bridge Completed Successfully`,
      status: 'SUCCESS',
      txHash: realTxHash,
      sourceTxHash: sourceHash || undefined,
      destTxHash: realTxHash,
      explorerUrl,
      fromChain: fromDisplayName,
      toChain: toDisplayName,
      amountIn: amount,
      amountOut: Number(destinationSettlement.receivedAmount),
      recipient: bridgeRecipient,
      gasUsdc: 0,
      actualGasUsdc: null,
      settlementLatencyMs: durationMs,
      timestamp: Date.now(),
    }
  } catch (err: any) {
    console.error('[copilotExecutionService] Bridge error:', err)
    if (onProgress) onProgress('failed')
    const cleanErr = formatCopilotError(err)
    const isCanceled = cleanErr.isCanceled || isUserCanceled(err) || err?.isCanceled === true
    return {
      id: `rcpt_err_${Date.now()}`,
      actionType: 'bridge',
      title: isCanceled ? 'Bridge Canceled' : (cleanErr.title || `Bridge Failed: ${amount} USDC`),
      status: isCanceled ? 'CANCELED' : 'FAILED',
      txHash: '',
      fromChain: fromDisplayName,
      toChain: toDisplayName,
      amountIn: amount,
      gasUsdc: 0,
      settlementLatencyMs: Date.now() - startTime,
      timestamp: Date.now(),
      errorMessage: cleanErr.message || err.message || 'Bridge transaction failed.',
    }
  }
}
