import { type Hex, encodeFunctionData } from 'viem'
import {
  COPILOT_SEND_DECIMALS,
  COPILOT_SEND_TOKENS,
  isValidEvmAddress,
  isUnsupportedCopilotToken,
  isZeroAddress,
  validateSendAmount,
  WBTC_UNSUPPORTED_MESSAGE,
} from '../../config/copilotTokens'
import { ARC_TOKENS } from '../../config/arcChain'
import { numberToExactDecimal } from '../../utils/copilotAmount'
import { resolveArcActualFeeUsdc } from '../arcGasService'
import type { InlineExecutionReceipt } from '../../types/sessionKey'
import {
  verifySessionLimits,
  deductSessionSpend,
} from '../sessionKeyService'
import { tokenAmountToUsd } from '../tokenPriceService'
import { createViemAdapter, sendToken } from '../sendService'
import {
  sendModularUserOperation,
  createModularUsdcTransferCall,
} from '../modularWalletService'
import { ERC20_ABI } from '../../config/poolsConfig'
import { getExplorerTxUrl } from '../../config/sendConfig'
import { addTransaction } from '../../utils/history'
import { formatCopilotError, isUserCanceled } from '../../utils/errorUtils'
import {
  type CopilotActionContext,
  failedActionReceipt,
  isTransactionHash,
  resolveCopilotToken,
  readArcSendBalance,
  tokenUnits,
  getVerifiedArcReceipt,
  verifyArcTokenTransferReceipt,
} from './copilotCommon'

export async function executeCopilotSendAction(
  context: CopilotActionContext,
  sessionConfig: { isActive: boolean }
): Promise<InlineExecutionReceipt> {
  const {
    actionPayload,
    activeWallet,
    activeMsca,
    provider,
    onProgress,
    ucwHandlers,
    budgetManaged,
    onSubmission,
    startTime,
  } = context
  const data = actionPayload.data || {}

  const amount = Number(data.amount)
  const tokenSymbol = resolveCopilotToken(data.tokenSymbol || data.token, 'USDC')
  const recipient = String(data.recipient || data.recipientAddress || data.to || '').trim()
  const memo = String(data.memo || '')

  if (!tokenSymbol) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('send', 'Unknown Token', 'The requested token is not recognized; no transaction was sent.', startTime)
  }
  if (isUnsupportedCopilotToken(tokenSymbol)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('send', 'Unsupported Token', WBTC_UNSUPPORTED_MESSAGE, startTime)
  }
  if (!COPILOT_SEND_TOKENS.includes(tokenSymbol as any)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('send', 'Unsupported Token', `${tokenSymbol} cannot be sent from the copilot.`, startTime)
  }
  const amountCheck = validateSendAmount(data.amount, tokenSymbol)
  if (!amountCheck.ok || amountCheck.normalized == null) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('send', 'Invalid Transfer Amount', amountCheck.error || 'Transfer amount is invalid.', startTime)
  }
  if (!isValidEvmAddress(recipient)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('send', 'Invalid Recipient Address', 'Please specify a valid EVM wallet address.', startTime)
  }
  if (isZeroAddress(recipient)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('send', 'Invalid Recipient Address', 'Transfers to the zero address are not allowed.', startTime)
  }
  if (recipient.toLowerCase() === activeWallet.toLowerCase()) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('send', 'Invalid Recipient Address', 'Transfers to your own wallet are not allowed.', startTime)
  }
  if (!recipient || !/^0x[a-fA-F0-9]{40}$/i.test(recipient)) {
    if (onProgress) onProgress('failed')
    return {
      id: `rcpt_err_${Date.now()}`,
      actionType: 'send',
      title: 'Invalid Recipient Address',
      status: 'FAILED',
      txHash: '',
      fromToken: tokenSymbol,
      amountIn: amount,
      gasUsdc: 0,
      settlementLatencyMs: Date.now() - startTime,
      timestamp: Date.now(),
      errorMessage: 'Please specify a valid EVM wallet address (e.g. 0x...).',
    }
  }

  const normalizedAmount = amountCheck.normalized
  const limitCheck = verifySessionLimits('send', tokenAmountToUsd(tokenSymbol, normalizedAmount), activeWallet)
  if (!budgetManaged && !limitCheck.allowed && sessionConfig.isActive) {
    if (onProgress) onProgress('failed')
    return {
      id: `rcpt_${Date.now()}`,
      actionType: 'send',
      title: `Transfer Failed: ${amount} ${tokenSymbol}`,
      status: 'FAILED',
      txHash: '',
      fromToken: tokenSymbol,
      amountIn: amount,
      recipient,
      gasUsdc: 0,
      settlementLatencyMs: Date.now() - startTime,
      timestamp: Date.now(),
      errorMessage: limitCheck.reason || 'Session spending limit exceeded.',
    }
  }

  if (ucwHandlers?.authSource === 'ucw') {
    if (!ucwHandlers.executeUcwTransfer) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('send', 'Circle UCW Unavailable', 'Circle UCW transfer handler is unavailable; no fallback signer was used.', startTime)
    }
    if (memo) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('send', 'Memo Not Supported', 'Memos cannot be attached to Circle UCW transfers; no transaction was sent.', startTime)
    }
    try {
      const balance = await readArcSendBalance(tokenSymbol, activeWallet)
      if (balance < tokenUnits(normalizedAmount, tokenSymbol)) {
        if (onProgress) onProgress('failed')
        return failedActionReceipt('send', 'Insufficient Balance', `Insufficient ${tokenSymbol} balance; no transaction was sent.`, startTime)
      }
    } catch {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('send', 'Balance Unavailable', `Could not verify the ${tokenSymbol} balance; no transaction was sent.`, startTime)
    }

    if (onProgress) onProgress('routing')
    const tokenAddress = tokenSymbol === 'USDC' ? '' : ARC_TOKENS[tokenSymbol as keyof typeof ARC_TOKENS]
    const transfer = await ucwHandlers.executeUcwTransfer({
      destinationAddress: recipient,
      amount: numberToExactDecimal(normalizedAmount)!,
      tokenSymbol,
      tokenAddress,
      blockchain: 'ARC-TESTNET',
    })
    if (!transfer.success) throw new Error(transfer.error || 'Circle UCW transfer challenge failed.')
    if (!isTransactionHash(transfer.txHash)) {
      if (onProgress) onProgress('pending')
      return {
        id: `rcpt_pending_${Date.now()}`, actionType: 'send', title: 'Transfer Submitted — Confirmation Pending',
        status: 'PENDING', txHash: '', fromToken: tokenSymbol, amountIn: normalizedAmount, recipient, gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime, timestamp: Date.now(),
        errorMessage: 'Circle accepted the challenge, but no valid transaction hash is available yet.',
      }
    }
    if (onProgress) onProgress('broadcasting')
    const receipt = await getVerifiedArcReceipt(transfer.txHash, 'Copilot UCW transfer')
    if (!receipt) {
      if (onProgress) onProgress('pending')
      return {
        id: `rcpt_pending_${Date.now()}`, actionType: 'send', title: 'Transfer Submitted — Confirmation Pending',
        status: 'PENDING', txHash: transfer.txHash, fromToken: tokenSymbol, amountIn: normalizedAmount, recipient, gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime, timestamp: Date.now(),
        errorMessage: 'The transaction is awaiting a successful on-chain receipt.',
      }
    }
    if (receipt.status !== 'success') {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('send', 'Transfer Reverted', 'The confirmed Arc transfer transaction reverted; no success history or session spend was recorded.', startTime)
    }
    const transferProof = verifyArcTokenTransferReceipt(receipt, ARC_TOKENS[tokenSymbol as keyof typeof ARC_TOKENS], recipient, normalizedAmount, COPILOT_SEND_DECIMALS[tokenSymbol], activeWallet)
    if (!transferProof) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('send', 'Transfer Not Verified', 'The successful receipt contains no matching token Transfer event for this sender, recipient, token, and amount; no success history or session spend was recorded.', startTime)
    }
    const fee = await resolveArcActualFeeUsdc(transfer.txHash)
    if (!budgetManaged) deductSessionSpend(tokenAmountToUsd(tokenSymbol, normalizedAmount), activeWallet)
    addTransaction({ type: 'send', txHash: transfer.txHash, amount: numberToExactDecimal(normalizedAmount)!, tokenSymbol, sourceChain: 'Arc_Testnet', recipient, userAddress: activeWallet, status: 'success' })
    if (onProgress) onProgress('confirmed')
    return {
      id: `rcpt_${Date.now()}`, actionType: 'send', title: 'Transfer Completed Successfully', status: 'SUCCESS',
      txHash: transfer.txHash, explorerUrl: getExplorerTxUrl('Arc_Testnet', transfer.txHash),
      fromToken: tokenSymbol, amountIn: normalizedAmount, recipient,
      gasUsdc: fee.feeUsdc ?? 0, actualGasUsdc: fee.feeUsdc,
      baseFeeUsdc: fee.baseFeeUsdcExact, priorityFeeUsdc: fee.priorityFeeUsdcExact,
      settlementLatencyMs: Date.now() - startTime, timestamp: Date.now(),
    }
  }

  const isPasskeyMode = Boolean(activeMsca && activeWallet.toLowerCase() === activeMsca.toLowerCase())
  if (isPasskeyMode) {
    if (onProgress) onProgress('routing')

    if (onProgress) onProgress('signing')
    if (onProgress) onProgress('broadcasting')

    const tokenAddress = tokenSymbol === 'USDC' ? '' : ARC_TOKENS[tokenSymbol as keyof typeof ARC_TOKENS]
    if (tokenSymbol !== 'USDC' && !tokenAddress) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('send', 'Unsupported Token', `No Arc Testnet contract address is configured for ${tokenSymbol}.`, startTime)
    }
    let realTxHash = ''
    if (!realTxHash) {
      // Modular UserOp with Paymaster
      const call = tokenSymbol === 'USDC'
        ? createModularUsdcTransferCall(recipient as Hex, normalizedAmount)
        : {
            to: tokenAddress as Hex,
            data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [recipient as Hex, tokenUnits(normalizedAmount, tokenSymbol)] }),
          }
      const userOpRes = await sendModularUserOperation({
        calls: [call],
        paymaster: true,
      })
      onSubmission?.({ txHash: userOpRes.txHash, userOpHash: userOpRes.userOpHash, phase: 'spend' })
      if (!userOpRes.success || !userOpRes.txHash) {
        throw new Error(userOpRes.error || 'Transfer could not be confirmed on Arc Testnet.')
      }
      realTxHash = userOpRes.txHash
    }

    if (!isTransactionHash(realTxHash)) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('send', 'Transfer Not Confirmed', 'No valid transaction hash was returned; refusing to report success.', startTime)
    }
    const receipt = await getVerifiedArcReceipt(realTxHash as Hex, 'Copilot passkey transfer')
    if (!receipt) {
      if (onProgress) onProgress('pending')
      return { id: `rcpt_pending_${Date.now()}`, actionType: 'send', title: 'Transfer Submitted — Confirmation Pending', status: 'PENDING', txHash: realTxHash, fromToken: tokenSymbol, amountIn: normalizedAmount, recipient, gasUsdc: 0, settlementLatencyMs: Date.now() - startTime, timestamp: Date.now() }
    }
    if (receipt.status !== 'success') {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('send', 'Transfer Reverted', 'The confirmed Arc transfer transaction reverted; no success history or session spend was recorded.', startTime)
    }
    const transferProof = verifyArcTokenTransferReceipt(receipt, ARC_TOKENS[tokenSymbol as keyof typeof ARC_TOKENS], recipient, normalizedAmount, COPILOT_SEND_DECIMALS[tokenSymbol], activeWallet)
    if (!transferProof) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('send', 'Transfer Not Verified', 'The successful receipt contains no matching token Transfer event for this sender, recipient, token, and amount; no success history or session spend was recorded.', startTime)
    }
    const fee = await resolveArcActualFeeUsdc(realTxHash)
    const durationMs = Date.now() - startTime
    if (!budgetManaged) deductSessionSpend(tokenAmountToUsd(tokenSymbol, normalizedAmount), activeWallet)

    addTransaction({
      type: 'send',
      txHash: realTxHash,
      amount: numberToExactDecimal(normalizedAmount)!,
      tokenSymbol,
      sourceChain: 'Arc_Testnet',
      recipient,
      userAddress: activeWallet,
      status: 'success',
    })

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('arcis_portfolio_updated'))
    }

    if (onProgress) onProgress('confirmed')

    return {
      id: `rcpt_${Date.now()}`,
      actionType: 'send',
      title: `Send Completed Successfully`,
      status: 'SUCCESS',
      txHash: realTxHash,
      fromToken: tokenSymbol,
      amountIn: normalizedAmount,
      recipient,
      memo,
      gasUsdc: fee.feeUsdc ?? 0,
      actualGasUsdc: fee.feeUsdc,
      baseFeeUsdc: fee.baseFeeUsdcExact,
      priorityFeeUsdc: fee.priorityFeeUsdcExact,
      settlementLatencyMs: durationMs,
      timestamp: Date.now(),
    }
  }

  // Viem / Browser Wallet Provider Fallback
  let sourceAdapter: any
  const effectiveProvider = provider || (typeof window !== 'undefined' && (window as any).ethereum ? (window as any).ethereum : null)

  if (effectiveProvider) {
    sourceAdapter = await createViemAdapter(effectiveProvider)
  } else {
    if (onProgress) onProgress('failed')
    return {
      id: `rcpt_err_${Date.now()}`,
      actionType: 'send',
      title: `Send Failed`,
      status: 'FAILED',
      txHash: '',
      fromToken: tokenSymbol,
      amountIn: amount,
      recipient,
      gasUsdc: 0,
      settlementLatencyMs: Date.now() - startTime,
      timestamp: Date.now(),
      errorMessage: 'Unable to initialize transaction adapter. Please connect your wallet.',
    }
  }

  try {
    if (onProgress) onProgress('routing')
    if (onProgress) onProgress('signing')
    if (onProgress) onProgress('broadcasting')

    const sendRes = await sendToken(
      effectiveProvider,
      'Arc_Testnet',
      tokenSymbol,
      recipient,
      numberToExactDecimal(normalizedAmount)!
    )

    const realTxHash = (sendRes as any)?.txHash || (sendRes as any)?.transactionHash || ''
    onSubmission?.({ txHash: realTxHash, phase: 'spend' })
    if (!isTransactionHash(realTxHash)) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('send', 'Transfer Not Confirmed', 'Send service did not return a valid transaction hash.', startTime)
    }
    const receipt = await getVerifiedArcReceipt(realTxHash as Hex, 'Copilot EOA transfer')
    if (!receipt) {
      if (onProgress) onProgress('pending')
      return { id: `rcpt_pending_${Date.now()}`, actionType: 'send', title: 'Transfer Submitted — Confirmation Pending', status: 'PENDING', txHash: realTxHash, fromToken: tokenSymbol, amountIn: normalizedAmount, recipient, gasUsdc: 0, settlementLatencyMs: Date.now() - startTime, timestamp: Date.now() }
    }
    if (receipt.status !== 'success') {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('send', 'Transfer Reverted', 'The confirmed Arc transfer transaction reverted; no success history or session spend was recorded.', startTime)
    }
    const transferProof = verifyArcTokenTransferReceipt(receipt, ARC_TOKENS[tokenSymbol as keyof typeof ARC_TOKENS], recipient, normalizedAmount, COPILOT_SEND_DECIMALS[tokenSymbol], activeWallet)
    if (!transferProof) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('send', 'Transfer Not Verified', 'The successful receipt contains no matching token Transfer event for this sender, recipient, token, and amount; no success history or session spend was recorded.', startTime)
    }
    const fee = await resolveArcActualFeeUsdc(realTxHash)
    const durationMs = Date.now() - startTime

    if (!budgetManaged) deductSessionSpend(tokenAmountToUsd(tokenSymbol, normalizedAmount), activeWallet)

    addTransaction({
      type: 'send',
      txHash: realTxHash,
      amount: numberToExactDecimal(normalizedAmount)!,
      tokenSymbol,
      sourceChain: 'Arc_Testnet',
      recipient,
      userAddress: activeWallet,
      status: 'success',
    })

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('arcis_portfolio_updated'))
    }

    if (onProgress) onProgress('confirmed')

    return {
      id: `rcpt_${Date.now()}`,
      actionType: 'send',
      title: `Send Completed Successfully`,
      status: 'SUCCESS',
      txHash: realTxHash,
      fromToken: tokenSymbol,
      amountIn: normalizedAmount,
      recipient,
      memo,
      gasUsdc: fee.feeUsdc ?? 0,
      actualGasUsdc: fee.feeUsdc,
      baseFeeUsdc: fee.baseFeeUsdcExact,
      priorityFeeUsdc: fee.priorityFeeUsdcExact,
      settlementLatencyMs: durationMs,
      timestamp: Date.now(),
    }
  } catch (err: any) {
    console.error('[copilotExecutionService] Send error:', err)
    if (onProgress) onProgress('failed')
    const cleanErr = formatCopilotError(err)
    const isCanceled = cleanErr.isCanceled || isUserCanceled(err) || err?.isCanceled === true
    return {
      id: `rcpt_err_${Date.now()}`,
      actionType: 'send',
      title: isCanceled ? 'Send Canceled' : (cleanErr.title || `Send Failed`),
      status: isCanceled ? 'CANCELED' : 'FAILED',
      txHash: '',
      fromToken: tokenSymbol,
      amountIn: amount,
      recipient,
      gasUsdc: 0,
      settlementLatencyMs: Date.now() - startTime,
      timestamp: Date.now(),
      errorMessage: cleanErr.message || err.message || 'Transfer transaction failed.',
    }
  }
}
