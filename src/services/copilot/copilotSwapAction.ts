import { type Hex, parseUnits, encodeFunctionData, createWalletClient, http, type Address } from 'viem'
import {
  isUnsupportedCopilotToken,
  WBTC_UNSUPPORTED_MESSAGE,
} from '../../config/copilotTokens'
import { arcTestnet, ARC_METADATA } from '../../config/arcChain'
import { numberToExactDecimal } from '../../utils/copilotAmount'
import { resolveArcActualFeeUsdc } from '../arcGasService'
import { getResilientPublicClient } from '../rpc'
import type { InlineExecutionReceipt } from '../../types/sessionKey'
import {
  verifySessionLimits,
  deductSessionSpend,
} from '../sessionKeyService'
import {
  getEphemeralSessionAccount,
  fetchEnclaveUsdcBalance,
} from '../sessionEnclaveService'
import { createViemAdapter } from '../sendService'
import { getSwapEstimate, executeSwap, resolveArcNativeRoute } from '../swapService'
import { walletSettingsService } from '../walletSettingsService'
import { copilotSlippageBps, approvedSwapMinimum } from '../../utils/swapSlippage'
import { sendModularUserOperation } from '../modularWalletService'
import { buildPoolSwapCall } from '../pools/poolDeadline'
import {
  POOL_CONTRACTS,
  STABLE_SWAP_ABI,
  ERC20_ABI,
} from '../../config/poolsConfig'
import { getExplorerTxUrl } from '../../config/sendConfig'
import { addTransaction } from '../../utils/history'
import { formatCopilotError, isUserCanceled } from '../../utils/errorUtils'
import { logger } from '../../utils/logger'
import {
  type CopilotActionContext,
  failedActionReceipt,
  isPositiveTokenAmount,
  isTransactionHash,
  resolveCopilotToken,
  valueTokenAmountUsd,
} from './copilotCommon'
import { verifyArcSwapReceipt } from './copilotReceiptVerifier'

const log = logger.createScope('copilotSwapAction')

export async function executeCopilotSwapAction(
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

  const amountIn = Number(data.amount)
  const fromTok = resolveCopilotToken(data.fromToken, 'USDC')
  const toTok = resolveCopilotToken(data.toToken, 'EURC')
  let slippageBps: number
  try {
    slippageBps = copilotSlippageBps(data)
  } catch (error) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('swap', 'Invalid Slippage', (error as Error).message, startTime)
  }
  if (!fromTok || !toTok) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('swap', 'Unknown Token', 'The requested token is not recognized; no transaction was sent.', startTime)
  }
  const swapRoute = resolveArcNativeRoute(fromTok, toTok)
  const swapInputDecimals = swapRoute?.decIn ?? 6
  if (!swapRoute) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('swap', 'Unsupported Swap Route', `No on-chain Arc swap route exists for ${fromTok} → ${toTok}.`, startTime)
  }
  if (!isPositiveTokenAmount(amountIn, swapInputDecimals)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('swap', 'Invalid Swap Amount', 'Swap amount must be a finite value greater than zero.', startTime)
  }
  if (isUnsupportedCopilotToken(fromTok) || isUnsupportedCopilotToken(toTok)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('swap', 'Unsupported Token', WBTC_UNSUPPORTED_MESSAGE, startTime)
  }

  const spendUsdc = await valueTokenAmountUsd(fromTok, amountIn)

  // ─────────────────────────────────────────────────────────────
  // 0. AUTONOMOUS SESSION ENCLAVE EXECUTION (ZERO-POPUP)
  // ─────────────────────────────────────────────────────────────
  const ephemeralAccount = getEphemeralSessionAccount(activeWallet, 'copilot')
  if (ephemeralAccount && fromTok === 'USDC' && swapRoute) {
    const limitCheck = verifySessionLimits('swap', spendUsdc, activeWallet, 'copilot')
    if (limitCheck.allowed || budgetManaged) {
      let enclaveBalance = 0
      try {
        enclaveBalance = await fetchEnclaveUsdcBalance(ephemeralAccount.address)
      } catch (balErr) {
        log.debug('Could not fetch enclave balance:', balErr)
      }

      if (enclaveBalance >= amountIn) {
      if (onProgress) onProgress('routing')
      if (onProgress) onProgress('signing')
      if (onProgress) onProgress('broadcasting')

      try {
        const resilientClient = getResilientPublicClient('Arc_Testnet')
        const walletClient = createWalletClient({
          account: ephemeralAccount,
          chain: arcTestnet,
          transport: http(ARC_METADATA.rpcHttpUrl),
        })

        const amountInUnits = parseUnits(numberToExactDecimal(amountIn)!, swapRoute.decIn)
        let quote: any
        try {
          quote = await getSwapEstimate({
            fromChain: 'Arc_Testnet',
            tokenIn: fromTok,
            tokenOut: toTok,
            amountIn: numberToExactDecimal(amountIn)!,
            slippageBps,
          })
        } catch (quoteErr: any) {
          log.warn('Could not fetch quote for enclave swap:', quoteErr)
        }
        const estimatedOutput = quote?.estimatedOutput || String(amountIn)
        let minOutUnits: bigint
        try {
          minOutUnits = approvedSwapMinimum(data, swapRoute.decOut, estimatedOutput)
        } catch {
          minOutUnits = 0n
        }

        const allowance = (await resilientClient.readContract({
          address: swapRoute.tokenInAddr as Hex,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [ephemeralAccount.address, swapRoute.poolAddress as Hex],
        })) as bigint

        if (allowance < amountInUnits) {
          const approveHash = await walletClient.sendTransaction({
            to: swapRoute.tokenInAddr as Hex,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [swapRoute.poolAddress as Hex, amountInUnits * 100n],
            }),
          })
          onSubmission?.({ txHash: approveHash, phase: 'approval' })
          await resilientClient.waitForTransactionReceipt({ hash: approveHash, timeout: 20000 })
        }

        const swapHash = await walletClient.sendTransaction({
          to: swapRoute.poolAddress as Hex,
          data: encodeFunctionData({
            abi: STABLE_SWAP_ABI,
            ...buildPoolSwapCall(swapRoute.poolAddress, swapRoute.tokenInAddr, swapRoute.tokenOutAddr, amountInUnits, minOutUnits),
          }),
        })

        onSubmission?.({ txHash: swapHash, phase: 'spend' })
        if (!isTransactionHash(swapHash)) {
          if (onProgress) onProgress('failed')
          return failedActionReceipt('swap', 'Swap Not Confirmed', 'Autonomous session key did not return a valid transaction hash.', startTime)
        }

        const swapProof = await verifyArcSwapReceipt(swapHash, ephemeralAccount.address, fromTok, toTok, amountIn)
        if (swapProof.status === 'unknown') {
          if (onProgress) onProgress('pending')
          return {
            id: `rcpt_pending_${Date.now()}`,
            actionType: 'swap',
            title: 'Swap Submitted — Output Verification Pending',
            status: 'PENDING',
            txHash: swapHash,
            fromToken: fromTok,
            toToken: toTok,
            amountIn,
            gasUsdc: 0,
            settlementLatencyMs: Date.now() - startTime,
            timestamp: Date.now(),
            errorMessage: 'A matching successful pool/router event has not been verified yet.',
          }
        }
        if (swapProof.status === 'reverted') throw new Error('Autonomous swap reverted on Arc Testnet.')

        // Forward output tokens to activeWallet so the user's primary wallet receives the swapped token
        try {
          const tokenOutContract = swapRoute.tokenOutAddr as Address
          const outBal = (await resilientClient.readContract({
            address: tokenOutContract,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [ephemeralAccount.address],
          })) as bigint
          if (outBal > 0n && activeWallet.toLowerCase() !== ephemeralAccount.address.toLowerCase()) {
            await walletClient.sendTransaction({
              to: tokenOutContract,
              data: encodeFunctionData({
                abi: ERC20_ABI,
                functionName: 'transfer',
                args: [activeWallet as Address, outBal],
              }),
            })
          }
        } catch (fwdErr) {
          log.warn('Could not forward swapped tokenOut to activeWallet:', fwdErr)
        }

        const fee = await resolveArcActualFeeUsdc(swapHash)
        const durationMs = Date.now() - startTime

        if (!budgetManaged) deductSessionSpend(spendUsdc, activeWallet, 'copilot')

        addTransaction({
          type: 'swap',
          txHash: swapHash,
          amount: numberToExactDecimal(amountIn)!,
          tokenSymbol: fromTok,
          sourceChain: 'Arc_Testnet',
          recipient: activeWallet,
          userAddress: activeWallet,
          status: 'success',
          amountIn: numberToExactDecimal(amountIn)!,
          amountOut: swapProof.amountOut.toString(),
          tokenIn: fromTok,
          tokenOut: toTok,
        })

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('arcis_portfolio_updated'))
        }

        if (onProgress) onProgress('confirmed')

        return {
          id: `rcpt_${Date.now()}`,
          actionType: 'swap',
          title: 'Swap Completed Successfully',
          subtitle: 'Executed via Session Key (Zero-Popup)',
          status: 'SUCCESS',
          txHash: swapHash,
          fromToken: fromTok,
          toToken: toTok,
          amountIn,
          amountOut: swapProof.amountOut,
          rate: swapProof.amountOut / amountIn,
          gasUsdc: fee.feeUsdc ?? 0,
          actualGasUsdc: fee.feeUsdc,
          baseFeeUsdc: fee.baseFeeUsdcExact,
          priorityFeeUsdc: fee.priorityFeeUsdcExact,
          settlementLatencyMs: durationMs,
          timestamp: Date.now(),
        }
      } catch (enclaveSwapErr: any) {
        log.warn('Autonomous enclave swap error, falling back to connected provider:', enclaveSwapErr)
      }
    }
  }
}

  // ─────────────────────────────────────────────────────────────
  // A. CIRCLE MODULAR WALLET & SESSION KEY EXECUTION
  // ─────────────────────────────────────────────────────────────
  const isPasskeyMode = Boolean(activeMsca && activeWallet.toLowerCase() === activeMsca.toLowerCase())

  if (ucwHandlers?.authSource === 'ucw') {
    if (!ucwHandlers.executeUcwContract) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('swap', 'Circle UCW Unavailable', 'Circle UCW contract challenge handler is missing; no fallback signer was used.', startTime)
    }
    try {
      if (onProgress) onProgress('routing')
      const resilientClient = getResilientPublicClient('Arc_Testnet')
      try {
        const balanceUnits = await resilientClient.readContract({
          address: swapRoute.tokenInAddr as Hex,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [activeWallet as Hex],
        })
        const requiredUnits = parseUnits(numberToExactDecimal(amountIn)!, swapInputDecimals)
        if (balanceUnits < requiredUnits) {
          if (onProgress) onProgress('failed')
          return failedActionReceipt(
            'swap',
            'Insufficient Balance',
            `Your Arc Testnet balance is insufficient for ${amountIn} ${fromTok} (available: ${(Number(balanceUnits) / 10 ** swapInputDecimals).toFixed(6)} ${fromTok}).`,
            startTime
          )
        }
      } catch (e: any) {
        if (e.message?.includes('insufficient') || e.message?.includes('Insufficient')) throw e
        console.warn('[copilotSwapAction] UCW balance read warning:', e)
      }

      const quote = await getSwapEstimate({
        fromChain: 'Arc_Testnet', tokenIn: fromTok, tokenOut: toTok, amountIn: numberToExactDecimal(amountIn)!,
        slippageBps, authSource: 'ucw', senderAddress: activeWallet, recipientAddress: activeWallet,
        executeUcwContract: ucwHandlers.executeUcwContract,
      })
      const quoteValue = Number(quote.estimatedOutput)
      if (!Number.isFinite(quoteValue) || quoteValue <= 0) throw new Error('Live swap quote is invalid; no transaction was sent.')
      approvedSwapMinimum(data, swapRoute.decOut, quote.estimatedOutput)
      if (onProgress) onProgress('signing')
      if (onProgress) onProgress('broadcasting')
      const execution = await executeSwap({
        minimumOutput: data.minReceived !== undefined ? String(data.minReceived) : undefined,
        fromChain: 'Arc_Testnet', tokenIn: fromTok, tokenOut: toTok, amountIn: numberToExactDecimal(amountIn)!,
        slippageBps, authSource: 'ucw', senderAddress: activeWallet, recipientAddress: activeWallet,
        executeUcwContract: ucwHandlers.executeUcwContract,
      })
      onSubmission?.({ txHash: execution.destinationTxHash || execution.sourceTxHash, phase: execution.pendingStage === 'approve' ? 'approval' : 'spend' })
      if (execution.status === 'PENDING') {
        if (onProgress) onProgress('pending')
        return {
          id: `rcpt_pending_${Date.now()}`, actionType: 'swap', title: 'Swap Submitted — Confirmation Pending',
          status: 'PENDING', txHash: isTransactionHash(execution.sourceTxHash) ? execution.sourceTxHash : '',
          fromToken: fromTok, toToken: toTok, amountIn,
          gasUsdc: 0, settlementLatencyMs: Date.now() - startTime, timestamp: Date.now(),
          errorMessage: execution.errorMessage || 'Swap is awaiting on-chain confirmation.',
        }
      }
      const hash = execution.destinationTxHash || execution.sourceTxHash
      if (execution.status !== 'DONE' || !isTransactionHash(hash)) throw new Error(execution.errorMessage || 'Circle UCW swap did not return a confirmed transaction hash.')
      const swapProof = await verifyArcSwapReceipt(hash, activeWallet, fromTok, toTok, amountIn)
      if (swapProof.status === 'unknown') {
        if (onProgress) onProgress('pending')
        return { id: `rcpt_pending_${Date.now()}`, actionType: 'swap', title: 'Swap Submitted — Output Verification Pending', status: 'PENDING', txHash: hash, fromToken: fromTok, toToken: toTok, amountIn, gasUsdc: 0, settlementLatencyMs: Date.now() - startTime, timestamp: Date.now(), errorMessage: 'A matching successful pool/router event has not been verified yet.' }
      }
      if (swapProof.status === 'reverted') throw new Error('Swap reverted on Arc Testnet.')
      const fee = await resolveArcActualFeeUsdc(hash)
      addTransaction({ type: 'swap', txHash: hash, amount: numberToExactDecimal(amountIn)!, tokenSymbol: fromTok, sourceChain: 'Arc_Testnet', recipient: activeWallet, userAddress: activeWallet, status: 'success', amountIn: numberToExactDecimal(amountIn)!, amountOut: swapProof.amountOut.toString(), tokenIn: fromTok, tokenOut: toTok })
      if (onProgress) onProgress('confirmed')
      return {
        id: `rcpt_${Date.now()}`, actionType: 'swap', title: 'Swap Completed Successfully', status: 'SUCCESS', txHash: hash,
        explorerUrl: getExplorerTxUrl('Arc_Testnet', hash), fromToken: fromTok, toToken: toTok, amountIn,
        amountOut: swapProof.amountOut, rate: swapProof.amountOut / amountIn, gasUsdc: fee.feeUsdc ?? 0, actualGasUsdc: fee.feeUsdc,
        baseFeeUsdc: fee.baseFeeUsdcExact, priorityFeeUsdc: fee.priorityFeeUsdcExact,
        settlementLatencyMs: Date.now() - startTime, timestamp: Date.now(),
      }
    } catch (error: any) {
      if (onProgress) onProgress('failed')
      const cleanError = formatCopilotError(error)
      return failedActionReceipt('swap', cleanError.title || 'Swap Failed', cleanError.message || error.message, startTime)
    }
  }

  if (isPasskeyMode) {
    if (onProgress) onProgress('routing')

    const arcRoute = resolveArcNativeRoute(fromTok, toTok)
    if (!arcRoute) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('swap', 'Unsupported Swap Route', `No on-chain Arc swap route exists for ${fromTok} → ${toTok}.`, startTime)
    }
    let quote
    try {
      quote = await getSwapEstimate({ fromChain: 'Arc_Testnet', tokenIn: fromTok, tokenOut: toTok, amountIn: numberToExactDecimal(amountIn)!, slippageBps })
    } catch (error: any) {
      if (onProgress) onProgress('failed')
      const cleanError = formatCopilotError(error)
      return failedActionReceipt('swap', cleanError.title || 'Swap Quote Failed', cleanError.message || error.message, startTime)
    }
    const quoteValue = Number(quote.estimatedOutput)
    if (!Number.isFinite(quoteValue) || quoteValue <= 0) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('swap', 'Invalid Swap Quote', 'The live pool quote was invalid; no transaction was sent.', startTime)
    }
    const estimatedOutput = quote.estimatedOutput

    // Step 1: Check this input token balance in its own decimals; never compare it to native USDC.
    const decIn = arcRoute ? arcRoute.decIn : 6
    const decOut = arcRoute ? arcRoute.decOut : 6
    const amountInUnits = parseUnits(numberToExactDecimal(amountIn)!, decIn)
    let minOutUnits: bigint
    try {
      minOutUnits = approvedSwapMinimum(data, decOut, estimatedOutput)
    } catch (error) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('swap', 'Quote Requires Confirmation', (error as Error).message, startTime)
    }

    const resilientClient = getResilientPublicClient('Arc_Testnet')

    let effectiveBalUnits = 0n
    try {
      // Every configured swap route consumes an ERC-20; Arc's native gas-token balance
      // is a separate asset and must never satisfy a USDC token balance check.
      effectiveBalUnits = await resilientClient.readContract({
        address: arcRoute.tokenInAddr as Hex,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [activeWallet as Hex],
      })
    } catch (balanceError) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('swap', 'Balance Unavailable', `Could not verify the ${fromTok} balance; no transaction was sent.`, startTime)
    }

    if (effectiveBalUnits < amountInUnits) {
      if (onProgress) onProgress('failed')
      return {
        id: `rcpt_err_${Date.now()}`,
        actionType: 'swap',
        title: `Swap Failed: ${amountIn} ${fromTok} ➔ ${toTok}`,
        status: 'FAILED',
        txHash: '',
        fromToken: fromTok,
        toToken: toTok,
        amountIn,
        gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime,
        timestamp: Date.now(),
        errorMessage: `Arc Testnet wallet balance is insufficient for ${amountIn} ${fromTok} (available: ${(Number(effectiveBalUnits) / 10 ** decIn).toFixed(6)} ${fromTok}).`,
      }
    }

    if (onProgress) onProgress('signing')
    if (onProgress) onProgress('broadcasting')

    // Session keys cannot sign; use the passkey-controlled MSCA path only.
    let realTxHash = ''

    if (!realTxHash && arcRoute) {
      // Modular smart account batch user operation (approve + swap)
      const approveCall = {
        to: arcRoute.tokenInAddr as Hex,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [arcRoute.poolAddress, amountInUnits],
        }),
      }
      const swapCall = {
        to: arcRoute.poolAddress as Hex,
        data: encodeFunctionData({
          abi: STABLE_SWAP_ABI,
          ...buildPoolSwapCall(arcRoute.poolAddress, arcRoute.tokenInAddr, arcRoute.tokenOutAddr, amountInUnits, minOutUnits),
        }),
      }
      const userOpRes = await sendModularUserOperation({
        calls: [approveCall, swapCall],
        paymaster: true,
      })
      onSubmission?.({ txHash: userOpRes.txHash, userOpHash: userOpRes.userOpHash, phase: 'spend' })
      if (!userOpRes.success || !userOpRes.txHash) {
        throw new Error(userOpRes.error || 'The pool swap could not be confirmed on Arc Testnet.')
      }
      realTxHash = userOpRes.txHash
    }

    if (!isTransactionHash(realTxHash)) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('swap', 'Swap Not Confirmed', 'No valid transaction hash was returned; refusing to report success.', startTime)
    }
    const swapProof = await verifyArcSwapReceipt(realTxHash, activeWallet, fromTok, toTok, amountIn)
    if (swapProof.status === 'unknown') {
      if (onProgress) onProgress('pending')
      return { id: `rcpt_pending_${Date.now()}`, actionType: 'swap', title: 'Swap Submitted — Output Verification Pending', status: 'PENDING', txHash: realTxHash, fromToken: fromTok, toToken: toTok, amountIn, gasUsdc: 0, settlementLatencyMs: Date.now() - startTime, timestamp: Date.now(), errorMessage: 'A matching successful pool/router event has not been verified yet.' }
    }
    if (swapProof.status === 'reverted') throw new Error('Swap reverted on Arc Testnet.')
    const fee = await resolveArcActualFeeUsdc(realTxHash)
    const durationMs = Date.now() - startTime

    // Add to transaction history
    addTransaction({
      type: 'swap',
      txHash: realTxHash,
      amount: numberToExactDecimal(amountIn)!,
      tokenSymbol: fromTok,
      sourceChain: 'Arc_Testnet',
      recipient: activeWallet,
      userAddress: activeWallet,
      status: 'success',
      amountIn: numberToExactDecimal(amountIn)!,
      amountOut: swapProof.amountOut.toString(),
      tokenIn: fromTok,
      tokenOut: toTok,
    })

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('arcis_portfolio_updated'))
    }

    if (onProgress) onProgress('confirmed')

    return {
      id: `rcpt_${Date.now()}`,
      actionType: 'swap',
      title: `Swap Completed Successfully`,
      status: 'SUCCESS',
      txHash: realTxHash,
      fromToken: fromTok,
      toToken: toTok,
      amountIn,
      amountOut: swapProof.amountOut,
      rate: swapProof.amountOut / amountIn,
      gasUsdc: fee.feeUsdc ?? 0,
      actualGasUsdc: fee.feeUsdc,
      baseFeeUsdc: fee.baseFeeUsdcExact,
      priorityFeeUsdc: fee.priorityFeeUsdcExact,
      settlementLatencyMs: durationMs,
      timestamp: Date.now(),
    }
  }

  // ─────────────────────────────────────────────────────────────
  // B. METAMASK / RAINBOWKIT EOA EXECUTION (VIA VIEM ADAPTER)
  // ─────────────────────────────────────────────────────────────
  let sourceAdapter: any
  const effectiveProvider = provider || (typeof window !== 'undefined' && (window as any).ethereum ? (window as any).ethereum : null)

  if (effectiveProvider) {
    sourceAdapter = await createViemAdapter(effectiveProvider)
  } else {
    if (onProgress) onProgress('failed')
    return {
      id: `rcpt_err_${Date.now()}`,
      actionType: 'swap',
      title: `Swap Failed`,
      status: 'FAILED',
      txHash: '',
      fromToken: fromTok,
      toToken: toTok,
      amountIn,
      gasUsdc: 0,
      settlementLatencyMs: Date.now() - startTime,
      timestamp: Date.now(),
      errorMessage: 'Could not create the transaction adapter. Please connect your wallet or sign in with Passkey.',
    }
  }

  try {
    // Step 1: Real On-Chain Estimate & Routing
    if (onProgress) onProgress('routing')

    const resilientClient = getResilientPublicClient('Arc_Testnet')
    try {
      const balanceUnits = await resilientClient.readContract({
        address: swapRoute.tokenInAddr as Hex,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [activeWallet as Hex],
      })
      const requiredUnits = parseUnits(numberToExactDecimal(amountIn)!, swapInputDecimals)
      if (balanceUnits < requiredUnits) {
        if (onProgress) onProgress('failed')
        return failedActionReceipt(
          'swap',
          'Insufficient Balance',
          `Your Arc Testnet balance is insufficient for ${amountIn} ${fromTok} (available: ${(Number(balanceUnits) / 10 ** swapInputDecimals).toFixed(6)} ${fromTok}).`,
          startTime
        )
      }
    } catch (e: any) {
      if (e.message?.includes('insufficient') || e.message?.includes('Insufficient')) throw e
      console.warn('[copilotSwapAction] EOA balance read warning:', e)
    }

    const quote = await getSwapEstimate({
      fromChain: 'Arc_Testnet',
      tokenIn: fromTok,
      tokenOut: toTok,
      amountIn: numberToExactDecimal(amountIn)!,
      sourceAdapter,
      slippageBps,
      allowanceStrategy: 'approve',
      recipientAddress: activeWallet,
    })

    if (!Number.isFinite(Number(quote.estimatedOutput)) || Number(quote.estimatedOutput) <= 0) {
      throw new Error('Live swap quote is invalid; no transaction was sent.')
    }

    approvedSwapMinimum(data, swapRoute.decOut, quote.estimatedOutput)
    // Step 2: Sign transaction
    if (onProgress) onProgress('signing')

    // Step 3: Broadcast transaction to Arc L1
    if (onProgress) onProgress('broadcasting')
    const speedTier = walletSettingsService.getCopilotSpeedTier(activeWallet)
    const finalStatus = await executeSwap({
      minimumOutput: data.minReceived !== undefined ? String(data.minReceived) : undefined,
      fromChain: 'Arc_Testnet',
      tokenIn: fromTok,
      tokenOut: toTok,
      amountIn: numberToExactDecimal(amountIn)!,
      sourceAdapter,
      slippageBps,
      speedTier,
      allowanceStrategy: 'approve',
      // Explicit 'evm' routing: a warm passkey MSCA cache must never sign this EOA swap.
      authSource: 'evm',
      senderAddress: activeWallet,
      recipientAddress: activeWallet,
    })
    onSubmission?.({ txHash: finalStatus.destinationTxHash || finalStatus.sourceTxHash, phase: finalStatus.pendingStage === 'approve' ? 'approval' : 'spend' })
    if (finalStatus.status === 'PENDING') {
      const pendingHash = isTransactionHash(finalStatus.sourceTxHash) ? finalStatus.sourceTxHash : ''
      if (onProgress) onProgress('pending')
      return {
        id: `rcpt_pending_${Date.now()}`,
        actionType: 'swap',
        title: 'Swap Submitted — Confirmation Pending',
        status: 'PENDING',
        txHash: pendingHash,
        fromToken: fromTok,
        toToken: toTok,
        amountIn,
        gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime,
        timestamp: Date.now(),
        errorMessage: finalStatus.errorMessage || 'The swap was submitted and is awaiting on-chain confirmation.',
      }
    }

    if (finalStatus.status === 'DONE') {
      const candidateHash = finalStatus.destinationTxHash || finalStatus.sourceTxHash
      if (!isTransactionHash(candidateHash)) {
        throw new Error('Swap reported completion without a valid on-chain transaction hash; refusing to record success.')
      }
      const realTxHash = candidateHash
      const swapProof = await verifyArcSwapReceipt(realTxHash, activeWallet, fromTok, toTok, amountIn)
      if (swapProof.status === 'unknown') {
        if (onProgress) onProgress('pending')
        return { id: `rcpt_pending_${Date.now()}`, actionType: 'swap', title: 'Swap Submitted — Output Verification Pending', status: 'PENDING', txHash: realTxHash, fromToken: fromTok, toToken: toTok, amountIn, gasUsdc: 0, settlementLatencyMs: Date.now() - startTime, timestamp: Date.now(), errorMessage: 'A matching successful pool/router event has not been verified yet.' }
      }
      if (swapProof.status === 'reverted') throw new Error('Swap reverted on Arc Testnet.')
      const fee = await resolveArcActualFeeUsdc(realTxHash)
      const durationMs = Date.now() - startTime

      // Add real transaction to history & broadcast event
      addTransaction({
        type: 'swap',
        txHash: realTxHash,
        amount: numberToExactDecimal(amountIn)!,
        tokenSymbol: fromTok,
        sourceChain: 'Arc_Testnet',
        recipient: activeWallet,
        userAddress: activeWallet,
        status: 'success',
        amountIn: numberToExactDecimal(amountIn)!,
        amountOut: swapProof.amountOut.toString(),
        tokenIn: fromTok,
        tokenOut: toTok,
      })

      if (onProgress) onProgress('confirmed')

      return {
        id: `rcpt_${Date.now()}`,
        actionType: 'swap',
        title: `Swap Completed Successfully`,
        status: 'SUCCESS',
        txHash: realTxHash,
        fromToken: fromTok,
        toToken: toTok,
        amountIn,
        amountOut: swapProof.amountOut,
        rate: swapProof.amountOut / amountIn,
        gasUsdc: fee.feeUsdc ?? 0,
        actualGasUsdc: fee.feeUsdc,
        baseFeeUsdc: fee.baseFeeUsdcExact,
        priorityFeeUsdc: fee.priorityFeeUsdcExact,
        settlementLatencyMs: durationMs,
        timestamp: Date.now(),
      }
    } else {
      throw new Error(finalStatus.errorMessage || 'Swap transaction failed on Arc Testnet.')
    }
  } catch (err: any) {
    console.error('[copilotExecutionService] Swap error:', err)
    if (onProgress) onProgress('failed')
    const cleanErr = formatCopilotError(err)
    const isCanceled = cleanErr.isCanceled || isUserCanceled(err) || err?.isCanceled === true
    return {
      id: `rcpt_err_${Date.now()}`,
      actionType: 'swap',
      title: isCanceled ? 'Swap Canceled' : cleanErr.title,
      status: isCanceled ? 'CANCELED' : 'FAILED',
      txHash: '',
      fromToken: fromTok,
      toToken: toTok,
      amountIn,
      gasUsdc: 0,
      settlementLatencyMs: Date.now() - startTime,
      timestamp: Date.now(),
      errorMessage: cleanErr.message,
    }
  }
}
