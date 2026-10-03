// Direct on-chain Copilot execution via connected wallets or Circle UCW challenges.
// Client-side session metadata does not authorize transaction signing.
import { type Hex, parseUnits, formatUnits, encodeFunctionData, decodeEventLog } from 'viem'
import {
  canonicalCopilotTokenSymbol,
  COPILOT_SEND_DECIMALS,
  COPILOT_SEND_TOKENS,
  isValidEvmAddress,
  isUnsupportedCopilotToken,
  isZeroAddress,
  validateSendAmount,
  WBTC_UNSUPPORTED_MESSAGE,
} from '../config/copilotTokens'
import { ARC_TOKENS, IS_TESTNET } from '../config/arcChain'
import { resolveArcActualFeeUsdc } from './arcGasService'
import { getResilientPublicClient } from './rpc'
import type { CopilotActionPayload } from '../types/marketplace'
import type { InlineExecutionReceipt, ExecutionProgressState } from '../types/sessionKey'
import {
  verifySessionLimits,
  deductSessionSpend,
  getSessionKeyConfig,
} from './sessionKeyService'
import { getLiveTokenPrices, normalizeTokenSymbol, DEFAULT_TOKEN_PRICES } from './tokenPriceService'

async function valueTokenAmountUsd(tokenSymbol: string, amount: number): Promise<number> {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const norm = normalizeTokenSymbol(tokenSymbol)
  if (norm === 'USDC') return amount
  try {
    const prices = await getLiveTokenPrices()
    const price = prices[norm] || DEFAULT_TOKEN_PRICES[norm] || 1.0
    return Number((amount * price).toFixed(4))
  } catch {
    const fallback = DEFAULT_TOKEN_PRICES[norm] || 1.0
    return Number((amount * fallback).toFixed(4))
  }
}
import { createViemAdapter, sendToken } from './sendService'
import { getSwapEstimate, executeSwap, resolveArcNativeRoute } from './swapService'
import { executeBridge } from './bridgeService'
import { pollCctpDestinationTx } from './bridgeUcwService'
import {
  getStoredMscaAddress,
  sendModularUserOperation,
  createModularUsdcTransferCall,
  arcTestnetChain,
} from './modularWalletService'
import { POOL_CONTRACTS, STABLE_SWAP_ABI, ARCIS_SWAP_ROUTER_ABI, ERC20_ABI, YIELD_VAULT_ABI } from '../config/poolsConfig'
import { resolveCanonicalChainKey, getChainDisplayName } from '../config/chainMeta'
import { getExplorerTxUrl } from '../config/sendConfig'
import { addTransaction } from '../utils/history'
import { formatCopilotError, isUserCanceled } from '../utils/errorUtils'
import { recordClientSwapVolume } from '../utils/poolVolumeUtils'
import { tokenAmountToUsd } from './tokenPriceService'

export interface CopilotUcwHandlers {
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  executeUcwTransfer?: (params: {
    destinationAddress: string
    amount: string
    tokenAddress?: string
    tokenSymbol?: string
    blockchain?: string
  }) => Promise<{ success: boolean; txHash?: string; error?: string }>
  executeUcwContract?: (params: {
    contractAddress: string
    abiFunctionSignature?: string
    abiParameters?: any[]
    callData?: string
    amount?: string
    blockchain?: string
  }) => Promise<{ success: boolean; txHash?: string; error?: string }>
}

function isTransactionHash(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

function isPositiveTokenAmount(value: unknown, decimals: number): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false
  try {
    const units = parseUnits(value.toString(), decimals)
    return units > 0n && Number(formatUnits(units, decimals)) === value
  } catch {
    return false
  }
}

const knownCopilotTokenAliases = new Set([
  'usdc', 'usdcoin', 'native', 'eurc', 'eur', 'euro', 'weth', 'eth', 'ethereum',
  'cirbtc', 'circlebtc', 'circlebitcoin', 'circlewrappedbitcoin', 'btc', 'wbtc', 'bitcoin', 'wrappedbitcoin',
  'afusdc', 'vault',
])

function resolveCopilotToken(raw: unknown, fallback: string): string | null {
  if (raw == null || String(raw).trim() === '') return fallback
  const input = String(raw).trim().toLowerCase().replace(/[\s_-]/g, '')
  if (!knownCopilotTokenAliases.has(input)) return null
  return canonicalCopilotTokenSymbol(String(raw))
}

async function readArcSendBalance(tokenSymbol: string, wallet: string): Promise<bigint> {
  const client = getResilientPublicClient('Arc_Testnet')
  const tokenAddress = ARC_TOKENS[tokenSymbol as keyof typeof ARC_TOKENS]
  if (!tokenAddress) throw new Error(`No Arc Testnet token address is configured for ${tokenSymbol}.`)
  return client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [wallet as `0x${string}`],
  })
}

function tokenUnits(amount: number, tokenSymbol: string): bigint {
  return parseUnits(amount.toString(), COPILOT_SEND_DECIMALS[tokenSymbol] ?? 6)
}

async function getVerifiedArcReceipt(hash: Hex, description: string) {
  try {
    const client = getResilientPublicClient('Arc_Testnet')
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 20_000 })
    return receipt.transactionHash.toLowerCase() === hash.toLowerCase() ? receipt : null
  } catch {
    return null
  }
}

const ERC20_TRANSFER_EVENT_ABI = [{
  type: 'event',
  name: 'Transfer',
  inputs: [
    { type: 'address', indexed: true, name: 'from' },
    { type: 'address', indexed: true, name: 'to' },
    { type: 'uint256', indexed: false, name: 'value' },
  ],
}] as const

function verifyArcTokenTransferReceipt(
  receipt: any,
  tokenAddress: string,
  recipient: string,
  amount: number,
  decimals: number,
  sender?: string
): boolean {
  const expectedAmount = parseUnits(amount.toFixed(decimals), decimals)
  return receipt.logs.some((log: any) => {
    if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) return false
    try {
      const decoded = decodeEventLog({ abi: ERC20_TRANSFER_EVENT_ABI, data: log.data, topics: log.topics })
      const args = decoded.args as any
      return String(args.to).toLowerCase() === recipient.toLowerCase() &&
        (!sender || String(args.from).toLowerCase() === sender.toLowerCase()) &&
        BigInt(args.value) === expectedAmount
    } catch {
      return false
    }
  })
}

async function verifyArcSwapReceipt(
  hash: Hex,
  recipient: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: number
): Promise<{ status: 'success'; amountOut: number } | { status: 'reverted' } | { status: 'unknown' }> {
  try {
    const route = resolveArcNativeRoute(tokenIn, tokenOut)
    if (!route) return { status: 'unknown' }
    const client = getResilientPublicClient('Arc_Testnet')
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 20_000 })
    if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) return { status: 'unknown' }
    if (receipt.status === 'reverted') return { status: 'reverted' }
    if (receipt.status !== 'success') return { status: 'unknown' }

    const expectedAmountIn = parseUnits(amountIn.toString(), route.decIn)
    for (const log of receipt.logs) {
      try {
        if (log.address.toLowerCase() === POOL_CONTRACTS.ARCIS_SWAP_ROUTER.toLowerCase()) {
          const decoded = decodeEventLog({ abi: ARCIS_SWAP_ROUTER_ABI, data: log.data, topics: log.topics })
          if (decoded.eventName !== 'SwapWithFee') continue
          const args = decoded.args as any
          if (
            String(args.user).toLowerCase() === recipient.toLowerCase() &&
            String(args.pool).toLowerCase() === route.poolAddress.toLowerCase() &&
            String(args.tokenIn).toLowerCase() === route.tokenInAddr.toLowerCase() &&
            String(args.tokenOut).toLowerCase() === route.tokenOutAddr.toLowerCase() &&
            BigInt(args.amountIn) === expectedAmountIn
          ) {
            const amountOut = Number(formatUnits(BigInt(args.amountOut), route.decOut))
            if (Number.isFinite(amountOut) && amountOut > 0) return { status: 'success', amountOut }
          }
        } else if (log.address.toLowerCase() === route.poolAddress.toLowerCase()) {
          const decoded = decodeEventLog({ abi: STABLE_SWAP_ABI, data: log.data, topics: log.topics })
          if (decoded.eventName !== 'Swapped') continue
          const args = decoded.args as any
          if (
            String(args.user).toLowerCase() === recipient.toLowerCase() &&
            String(args.tokenIn).toLowerCase() === route.tokenInAddr.toLowerCase() &&
            BigInt(args.amountIn) === expectedAmountIn
          ) {
            const amountOut = Number(formatUnits(BigInt(args.amountOut), route.decOut))
            if (Number.isFinite(amountOut) && amountOut > 0) return { status: 'success', amountOut }
          }
        }
      } catch {
        // Ignore unrelated receipt logs; success requires a matching configured pool/router event.
      }
    }
    return { status: 'unknown' }
  } catch {
    return { status: 'unknown' }
  }
}

function failedActionReceipt(
  actionType: InlineExecutionReceipt['actionType'],
  title: string,
  errorMessage: string,
  startTime: number
): InlineExecutionReceipt {
  return {
    id: `rcpt_err_${Date.now()}`,
    actionType,
    title,
    status: 'FAILED',
    txHash: '',
    gasUsdc: 0,
    settlementLatencyMs: Date.now() - startTime,
    timestamp: Date.now(),
    errorMessage,
  }
}

/**
 * Main dispatcher for executing real on-chain actions directly from Copilot
 */
export async function executeDirectCopilotAction(
  actionPayload: CopilotActionPayload,
  walletAddress?: string,
  provider?: any,
  onProgress?: (state: ExecutionProgressState) => void,
  ucwHandlers?: CopilotUcwHandlers
): Promise<InlineExecutionReceipt> {
  const startTime = Date.now()
  const actType = actionPayload.type
  const data = actionPayload.data || {}
  const activeMsca = getStoredMscaAddress()
  const activeWallet = walletAddress || activeMsca

  if (!activeWallet) {
    if (onProgress) onProgress('failed')
    return {
      id: `rcpt_err_${Date.now()}`,
      actionType: 'swap',
      title: 'Wallet Not Connected',
      status: 'FAILED',
      txHash: '',
      gasUsdc: 0,
      settlementLatencyMs: 0,
      timestamp: Date.now(),
      errorMessage: 'Please connect your wallet first (Passkey FaceID, Circle UCW or Web3 / MetaMask).',
    }
  }

  if (!IS_TESTNET) {
    if (onProgress) onProgress('failed')
    const actionTypeMapped: InlineExecutionReceipt['actionType'] =
      actType === 'interactive_swap' || actType === 'trade'
        ? 'swap'
        : actType === 'interactive_deposit'
        ? 'deposit'
        : actType === 'interactive_bridge'
        ? 'bridge'
        : 'send'
    return failedActionReceipt(
      actionTypeMapped,
      'Network Not Enabled',
      'Mainnet execution is disabled until deployments and signing routes are verified.',
      startTime
    )
  }

  const sessionConfig = getSessionKeyConfig(activeWallet)
  // No active local session can execute until an actual SessionKeyModule integration exists.
  const isZeroPopupMode = false

  // ─────────────────────────────────────────────────────────────
  // 1. REAL ON-CHAIN SWAP EXECUTION (Arc Testnet DEX Router)
  // ─────────────────────────────────────────────────────────────
  if (actType === 'interactive_swap' || actType === 'trade') {
    const amountIn = Number(data.amount)
    const fromTok = resolveCopilotToken(data.fromToken, 'USDC')
    const toTok = resolveCopilotToken(data.toToken, 'EURC')
    const slippageTolerance = data.slippage == null ? undefined : Number(data.slippage)
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

    // Local caps are not chain-enforced and no session is active without module delegation.
    const spendUsdc = await valueTokenAmountUsd(fromTok, amountIn)
    const limitCheck = verifySessionLimits('swap', spendUsdc, activeWallet)
    if (!limitCheck.allowed && sessionConfig.isActive) {
      if (onProgress) onProgress('failed')
      return {
        id: `rcpt_${Date.now()}`,
        actionType: 'swap',
        title: `Swap Failed: ${amountIn} ${fromTok} ➔ ${toTok}`,
        status: 'FAILED',
        txHash: '',
        fromToken: fromTok,
        toToken: toTok,
        amountIn,
        amountOut: 0,
        gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime,
        timestamp: Date.now(),
        errorMessage: limitCheck.reason || 'Session limit check failed.',
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
      if (slippageTolerance !== undefined && (!Number.isFinite(slippageTolerance) || slippageTolerance <= 0 || slippageTolerance >= 1)) {
        if (onProgress) onProgress('failed')
        return failedActionReceipt('swap', 'Invalid Slippage', 'Slippage must be greater than 0 and less than 100%.', startTime)
      }
      try {
        if (onProgress) onProgress('routing')
        const quote = await getSwapEstimate({
          fromChain: 'Arc_Testnet', tokenIn: fromTok, tokenOut: toTok, amountIn: amountIn.toString(),
          slippageTolerance, authSource: 'ucw', recipientAddress: activeWallet,
          executeUcwContract: ucwHandlers.executeUcwContract,
        })
        const quoteValue = Number(quote.estimatedOutput)
        if (!Number.isFinite(quoteValue) || quoteValue <= 0) throw new Error('Live swap quote is invalid; no transaction was sent.')
        if (onProgress) onProgress('signing')
        if (onProgress) onProgress('broadcasting')
        const execution = await executeSwap({
          fromChain: 'Arc_Testnet', tokenIn: fromTok, tokenOut: toTok, amountIn: amountIn.toString(),
          slippageTolerance, authSource: 'ucw', recipientAddress: activeWallet,
          executeUcwContract: ucwHandlers.executeUcwContract,
        })
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
        deductSessionSpend(spendUsdc, activeWallet)
        addTransaction({ type: 'swap', txHash: hash, amount: amountIn.toString(), tokenSymbol: fromTok, sourceChain: 'Arc_Testnet', recipient: activeWallet, userAddress: activeWallet, status: 'success', amountIn: amountIn.toString(), amountOut: swapProof.amountOut.toString(), tokenIn: fromTok, tokenOut: toTok })
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
        quote = await getSwapEstimate({ fromChain: 'Arc_Testnet', tokenIn: fromTok, tokenOut: toTok, amountIn: amountIn.toString(), slippageTolerance })
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
      const amountInUnits = parseUnits(amountIn.toString(), decIn)
      const minOutUnits = (parseUnits(estimatedOutput, decOut) * 98n) / 100n // 2% slippage protection

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
            functionName: 'swap',
            args: [arcRoute.tokenInAddr, arcRoute.tokenOutAddr, amountInUnits, minOutUnits],
          }),
        }
        const userOpRes = await sendModularUserOperation({
          calls: [approveCall, swapCall],
          paymaster: true,
        })
        if (!userOpRes.success || !userOpRes.txHash) {
          throw new Error(userOpRes.error || 'Arc Testnet üzerinde havuz takası onaylanamadı.')
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

      // Deduct session spend
      deductSessionSpend(spendUsdc, activeWallet)

      // Add to transaction history
      addTransaction({
        type: 'swap',
        txHash: realTxHash,
        amount: amountIn.toString(),
        tokenSymbol: fromTok,
        sourceChain: 'Arc_Testnet',
        recipient: activeWallet,
        userAddress: activeWallet,
        status: 'success',
        amountIn: amountIn.toString(),
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
        errorMessage: 'İşlem adaptörü oluşturulamadı. Lütfen cüzdanınızı bağlayın veya Passkey ile giriş yapın.',
      }
    }

    try {
      // Step 1: Real On-Chain Estimate & Routing
      if (onProgress) onProgress('routing')

      const quote = await getSwapEstimate({
        fromChain: 'Arc_Testnet',
        tokenIn: fromTok,
        tokenOut: toTok,
        amountIn: amountIn.toString(),
        sourceAdapter,
        slippageTolerance,
        allowanceStrategy: 'approve',
        recipientAddress: activeWallet,
      })

      if (!Number.isFinite(Number(quote.estimatedOutput)) || Number(quote.estimatedOutput) <= 0) {
        throw new Error('Live swap quote is invalid; no transaction was sent.')
      }

      // Step 2: Sign transaction
      if (onProgress) onProgress('signing')

      // Step 3: Broadcast transaction to Arc L1
      if (onProgress) onProgress('broadcasting')
      const finalStatus = await executeSwap({
        fromChain: 'Arc_Testnet',
        tokenIn: fromTok,
        tokenOut: toTok,
        amountIn: amountIn.toString(),
        sourceAdapter,
        slippageTolerance,
        allowanceStrategy: 'approve',
        recipientAddress: activeWallet,
      })

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

        // Deduct session budget
        deductSessionSpend(spendUsdc, activeWallet)

        // Add real transaction to history & broadcast event
        addTransaction({
          type: 'swap',
          txHash: realTxHash,
          amount: amountIn.toString(),
          tokenSymbol: fromTok,
          sourceChain: 'Arc_Testnet',
          recipient: activeWallet,
          userAddress: activeWallet,
          status: 'success',
          amountIn: amountIn.toString(),
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

  // ─────────────────────────────────────────────────────────────
  // 2. YIELD VAULT DEPOSIT EXECUTION
  // ─────────────────────────────────────────────────────────────
  if (actType === 'interactive_deposit' || actType === 'view_pool') {
    const amount = Number(data.amount)
    const apy = typeof data.apy === 'string' ? data.apy : undefined
    if (!isPositiveTokenAmount(amount, 6)) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('deposit', 'Invalid Deposit Amount', 'Deposit amount must be greater than zero.', startTime)
    }

    // Limit check
    const limitCheck = verifySessionLimits('deposit', amount, activeWallet)
    if (!limitCheck.allowed && sessionConfig.isActive) {
      if (onProgress) onProgress('failed')
      return {
        id: `rcpt_${Date.now()}`,
        actionType: 'deposit',
        title: `Deposit Failed: ${amount} USDC`,
        status: 'FAILED',
        txHash: '',
        gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime,
        timestamp: Date.now(),
        errorMessage: limitCheck.reason || 'Session limit exceeded.',
      }
    }

    if (onProgress) onProgress('routing')

    // Step 1: Verify the actual USDC ERC-20 balance on Arc Testnet via resilient RPC client
    const resilientClient = getResilientPublicClient('Arc_Testnet')
    let onChainBalWei: bigint
    try {
      onChainBalWei = await resilientClient.readContract({
        address: POOL_CONTRACTS.USDC,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [activeWallet as Hex],
      })
    } catch (readErr: any) {
      console.warn('[copilotExecutionService] Failed to read USDC balance on Arc Testnet:', readErr)
      if (onProgress) onProgress('failed')
      return failedActionReceipt('deposit', 'Balance Unavailable', 'Could not verify the USDC balance; no transaction was sent.', startTime)
    }
    const reqWei = parseUnits(amount.toString(), 6)

    if (onChainBalWei < reqWei) {
      if (onProgress) onProgress('failed')
      return {
        id: `rcpt_err_${Date.now()}`,
        actionType: 'deposit',
        title: `Deposit Failed: ${amount} USDC`,
        status: 'FAILED',
        txHash: '',
        gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime,
        timestamp: Date.now(),
        errorMessage: `Arc Testnet üzerinde cüzdanınızda (${activeWallet.slice(0, 6)}...${activeWallet.slice(-4)}) yeterli bakiye bulunamadı (Mevcut: ${(Number(onChainBalWei) / 1e6).toFixed(2)} USDC). Lütfen faucet üzerinden bakiye talep edin.`,
      }
    }

    if (onProgress) onProgress('signing')
    if (onProgress) onProgress('broadcasting')

    let realTxHash = ''
    const effectiveProvider = provider || (typeof window !== 'undefined' && (window as any).ethereum ? (window as any).ethereum : null)

    const amountUnits = parseUnits(amount.toString(), 6)

    // A. Circle UCW Execution (Email OTP / User-Controlled Wallet)
    if (ucwHandlers?.authSource === 'ucw') {
      if (!ucwHandlers.executeUcwContract) {
        if (onProgress) onProgress('failed')
        return failedActionReceipt('deposit', 'Circle UCW Unavailable', 'Circle UCW contract challenge handler is missing; no fallback signer was used.', startTime)
      }

      try {
        // Step 1: Check token allowance on USDC for Yield Vault
        let currentAllowance = 0n
        try {
          currentAllowance = (await resilientClient.readContract({
            address: POOL_CONTRACTS.USDC,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [activeWallet as Hex, POOL_CONTRACTS.YIELD_VAULT],
          })) as bigint
        } catch (allowanceErr) {
          console.warn('[copilotExecutionService] USDC allowance check failed, proceeding with approve:', allowanceErr)
        }

        // Step 2: Approve if current allowance is less than deposit amount
        if (currentAllowance < amountUnits) {
          if (onProgress) onProgress('signing')
          const approveRes = await ucwHandlers.executeUcwContract({
            contractAddress: POOL_CONTRACTS.USDC,
            abiFunctionSignature: 'approve(address,uint256)',
            abiParameters: [POOL_CONTRACTS.YIELD_VAULT, amountUnits.toString()],
            blockchain: 'ARC-TESTNET',
          })
          if (!approveRes.success) {
            const isCanceled =
              approveRes.error?.toLowerCase().includes('cancel') ||
              approveRes.error?.toLowerCase().includes('iptal') ||
              approveRes.error?.toLowerCase().includes('closed')
            const err: any = new Error(approveRes.error || 'Token allowance authorization failed.')
            if (isCanceled) err.isCanceled = true
            throw err
          }
          if (approveRes.txHash && isTransactionHash(approveRes.txHash)) {
            const approveRec = await resilientClient.waitForTransactionReceipt({
              hash: approveRes.txHash as Hex,
              timeout: 20000,
            }).catch(() => null)
            if (approveRec && approveRec.status !== 'success') {
              throw new Error('USDC allowance approval reverted on-chain.')
            }
          }
        }

        // Step 3: Execute Vault Deposit
        if (onProgress) onProgress('broadcasting')
        const depositRes = await ucwHandlers.executeUcwContract({
          contractAddress: POOL_CONTRACTS.YIELD_VAULT,
          abiFunctionSignature: 'deposit(uint256,address)',
          abiParameters: [amountUnits.toString(), activeWallet],
          blockchain: 'ARC-TESTNET',
        })
        if (!depositRes.success) {
          const isCanceled =
            depositRes.error?.toLowerCase().includes('cancel') ||
            depositRes.error?.toLowerCase().includes('iptal') ||
            depositRes.error?.toLowerCase().includes('closed')
          const err: any = new Error(depositRes.error || 'Yield vault deposit authorization failed.')
          if (isCanceled) err.isCanceled = true
          throw err
        }
        if (depositRes.txHash) {
          realTxHash = depositRes.txHash
        }
      } catch (ucwErr: any) {
        console.warn('[copilotExecutionService] UCW vault deposit error:', ucwErr)
        if (onProgress) onProgress('failed')
        const cleanErr = formatCopilotError(ucwErr)
        return failedActionReceipt('deposit', cleanErr.title || 'Deposit Failed', cleanErr.message || ucwErr.message, startTime)
      }
    }

    // B. Passkey MSCA Execution
    if (!realTxHash && activeMsca) {
      try {
        const approveCall = {
          to: POOL_CONTRACTS.USDC as Hex,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [POOL_CONTRACTS.YIELD_VAULT, amountUnits],
          }),
        }
        const depositCall = {
          to: POOL_CONTRACTS.YIELD_VAULT as Hex,
          data: encodeFunctionData({
            abi: YIELD_VAULT_ABI,
            functionName: 'deposit',
            args: [amountUnits, activeWallet as Hex],
          }),
        }
        const opRes = await sendModularUserOperation({
          calls: [approveCall, depositCall],
          paymaster: true,
        })
        if (opRes.success && opRes.txHash) {
          realTxHash = opRes.txHash
        }
      } catch (opErr) {
        console.warn('[copilotExecutionService] Modular UserOp vault deposit error:', opErr)
      }
    }

    // C. Connected EOA Wallet Execution
    if (!realTxHash && effectiveProvider) {
      try {
        const { createWalletClient, custom } = await import('viem')
        const walletClient = createWalletClient({
          account: activeWallet as Hex,
          chain: arcTestnetChain,
          transport: custom(effectiveProvider),
        })

        const approveTx = await walletClient.writeContract({
          address: POOL_CONTRACTS.USDC,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [POOL_CONTRACTS.YIELD_VAULT, amountUnits],
        })
        const approveRec = await resilientClient.waitForTransactionReceipt({ hash: approveTx, timeout: 15000 }).catch((err: unknown) => {
          console.warn('[copilotExecutionService] EOA vault approve receipt warning:', err)
          return null
        })
        if (!approveRec || approveRec.transactionHash.toLowerCase() !== approveTx.toLowerCase()) throw new Error('Token approval is still pending; deposit was not submitted.')
        if (approveRec.status !== 'success') throw new Error('Token approval reverted on-chain.')

        realTxHash = await walletClient.writeContract({
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'deposit',
          args: [amountUnits, activeWallet as Hex],
        })
        const depRec = await resilientClient.waitForTransactionReceipt({ hash: realTxHash as Hex, timeout: 15000 }).catch((err: unknown) => {
          console.warn('[copilotExecutionService] EOA vault deposit receipt warning:', err)
          return null
        })
        if (!depRec || depRec.transactionHash.toLowerCase() !== realTxHash.toLowerCase()) throw new Error('Vault deposit is still pending; no success was recorded.')
        if (depRec.status !== 'success') throw new Error('Vault deposit reverted on-chain.')
      } catch (e: any) {
        console.warn('[copilotExecutionService] EOA vault transaction error:', e)
      }
    }

    if (!realTxHash) {
      if (onProgress) onProgress('failed')
      return {
        id: `rcpt_err_${Date.now()}`,
        actionType: 'deposit',
        title: `Deposit Failed: ${amount} USDC`,
        status: 'FAILED',
        txHash: '',
        gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime,
        timestamp: Date.now(),
        errorMessage: 'Arc Testnet Real-Yield Vault yatırımı onaylanamadı. Cüzdan bakiyenizi veya token izninizi kontrol edin.',
      }
    }

    if (!isTransactionHash(realTxHash)) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('deposit', 'Deposit Not Confirmed', 'No valid transaction hash was returned; refusing to report success.', startTime)
    }
    const depositReceipt = await getVerifiedArcReceipt(realTxHash as Hex, 'Copilot vault deposit')
    if (!depositReceipt) {
      if (onProgress) onProgress('pending')
      return {
        id: `rcpt_pending_${Date.now()}`, actionType: 'deposit', title: 'Deposit Submitted — Confirmation Pending',
        status: 'PENDING', txHash: realTxHash, fromToken: 'USDC', amountIn: amount, gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime, timestamp: Date.now(),
      }
    }
    if (depositReceipt.status !== 'success') {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('deposit', 'Deposit Reverted', 'The confirmed vault deposit transaction reverted; no success history or session spend was recorded.', startTime)
    }
    const expectedDepositAssets = parseUnits(amount.toString(), 6)
    let sharesReceived: bigint | null = null
    for (const log of depositReceipt.logs) {
      if (log.address.toLowerCase() !== POOL_CONTRACTS.YIELD_VAULT.toLowerCase()) continue
      try {
        const decoded = decodeEventLog({ abi: YIELD_VAULT_ABI, data: log.data, topics: log.topics })
        if (decoded.eventName !== 'Deposit') continue
        const args = decoded.args as any
        const senderMatch = String(args.sender).toLowerCase() === activeWallet.toLowerCase()
        const ownerMatch = String(args.owner).toLowerCase() === activeWallet.toLowerCase()
        if (
          (senderMatch || ownerMatch) &&
          BigInt(args.assets) === expectedDepositAssets && BigInt(args.shares) > 0n
        ) {
          sharesReceived = BigInt(args.shares)
          break
        }
      } catch {
        // Ignore unrelated vault logs; success requires an exact Deposit event.
      }
    }
    if (sharesReceived === null) {
      if (onProgress) onProgress('pending')
      return {
        id: `rcpt_pending_${Date.now()}`, actionType: 'deposit', title: 'Deposit Receipt Verification Pending',
        status: 'PENDING', txHash: realTxHash, fromToken: 'USDC', amountIn: amount, gasUsdc: 0,
        settlementLatencyMs: Date.now() - startTime, timestamp: Date.now(),
        errorMessage: 'The successful transaction receipt does not yet contain a matching vault Deposit event; no success history or session spend was recorded.',
      }
    }
    const fee = await resolveArcActualFeeUsdc(realTxHash)
    const durationMs = Date.now() - startTime
    deductSessionSpend(amount, activeWallet)

    addTransaction({
      type: 'send',
      txHash: realTxHash,
      amount: amount.toString(),
      tokenSymbol: 'USDC',
      sourceChain: 'Arc_Testnet',
      recipient: POOL_CONTRACTS.YIELD_VAULT, // Real-Yield Vault
      userAddress: activeWallet,
      status: 'success',
    })

    recordClientSwapVolume('usdc-yield-vault', amount, realTxHash)

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('arcis_portfolio_updated'))
    }

    if (onProgress) onProgress('confirmed')

    return {
      id: `rcpt_${Date.now()}`,
      actionType: 'deposit',
      title: `Deposit Completed Successfully`,
      status: 'SUCCESS',
      txHash: realTxHash,
      fromToken: 'USDC',
      toToken: 'af-USDC',
      amountIn: amount,
      ...(sharesReceived !== null && { amountOut: Number(sharesReceived) / 1e6 }),
      apy,
      gasUsdc: fee.feeUsdc ?? 0,
      actualGasUsdc: fee.feeUsdc,
      baseFeeUsdc: fee.baseFeeUsdcExact,
      priorityFeeUsdc: fee.priorityFeeUsdcExact,
      settlementLatencyMs: durationMs,
      timestamp: Date.now(),
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. REAL ON-CHAIN BRIDGE EXECUTION (Circle CCTP via AppKit)
  // ─────────────────────────────────────────────────────────────
  if (actType === 'interactive_bridge' || actType === 'bridge') {
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

    const limitCheck = verifySessionLimits('bridge', amount, activeWallet)
    if (!limitCheck.allowed && sessionConfig.isActive) {
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
        const ucwBridge = await import('./bridgeUcwService')
        const result = await ucwBridge.executeUcwBridgeTransfer({
          amount: amount.toString(), sourceChain: sourceChainKey, destChain: destChainKey,
          recipientAddress: bridgeRecipient, connectedAddress: activeWallet,
          executeUcwContract: ucwHandlers.executeUcwContract,
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
          amount: amount.toString(),
          sourceAdapter,
          recipientAddress: bridgeRecipient,
          useForwarder: true,
          transferSpeed: 'FAST',
        },
        (step) => {
          if (step.name === 'approve') {
            if (onProgress) onProgress('signing')
          } else if (step.name === 'burn') {
            if (onProgress) onProgress('broadcasting')
          } else if (step.name === 'fetchAttestation') {
            if (onProgress) onProgress('routing')
          } else if (step.name === 'mint') {
            if (onProgress) onProgress('broadcasting')
          }
        }
      )

      if (!result || result.state === 'error' || result.status === 'error' || result.status === 'failed') {
        const errorStep = result?.steps?.find((s: any) => s.state === 'error' || s.errorMessage || s.error)
        const errorMsg = errorStep?.errorMessage || errorStep?.error?.message || result?.errorMessage || result?.error?.message || 'CCTP Bridge transfer failed.'
        throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg))
      }

      const mintTxHash = result?.mintTxHash || result?.steps?.find((s: any) => s.name === 'mint')?.txHash
      const burnTxHash = result?.burnTxHash || result?.txHash || result?.steps?.find((s: any) => s.name === 'burn')?.txHash
      const sourceHash = isTransactionHash(burnTxHash) ? burnTxHash : ''
      const destinationHash = isTransactionHash(mintTxHash) ? mintTxHash : ''
      if (!sourceHash && !destinationHash) {
        throw new Error('Bridge result did not include a valid source or destination transaction hash.')
      }
      if (!destinationHash) {
        if (sourceHash) {
          addTransaction({ type: 'bridge', txHash: sourceHash, amount: amount.toString(), tokenSymbol: 'USDC', sourceChain: sourceChainKey, destChain: destChainKey, recipient: bridgeRecipient, userAddress: activeWallet, status: 'pending' })
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
        amount: amount.toString(),
        maxAttempts: 1,
        intervalMs: 0,
      })
      if (
        destinationSettlement.status !== 'confirmed' ||
        destinationSettlement.destTxHash?.toLowerCase() !== destinationHash.toLowerCase()
      ) {
        if (sourceHash) addTransaction({ type: 'bridge', txHash: sourceHash, amount: amount.toString(), tokenSymbol: 'USDC', sourceChain: sourceChainKey, destChain: destChainKey, recipient: bridgeRecipient, userAddress: activeWallet, status: 'pending' })
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

      deductSessionSpend(amount, activeWallet)

      addTransaction({
        type: 'bridge',
        txHash: realTxHash,
        amount: amount.toString(),
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

  // ─────────────────────────────────────────────────────────────
  // 5. REAL ON-CHAIN TOKEN SEND / BATCH TRANSFER EXECUTION
  // ─────────────────────────────────────────────────────────────
  if (actType === 'interactive_send' || actType === 'send' || actType === 'interactive_batch_send') {
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
    if (!limitCheck.allowed && sessionConfig.isActive) {
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
        amount: normalizedAmount.toString(),
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
      deductSessionSpend(tokenAmountToUsd(tokenSymbol, normalizedAmount), activeWallet)
      addTransaction({ type: 'send', txHash: transfer.txHash, amount: normalizedAmount.toString(), tokenSymbol, sourceChain: 'Arc_Testnet', recipient, userAddress: activeWallet, status: 'success' })
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
      deductSessionSpend(tokenAmountToUsd(tokenSymbol, normalizedAmount), activeWallet)

      addTransaction({
        type: 'send',
        txHash: realTxHash,
        amount: normalizedAmount.toString(),
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
        normalizedAmount.toString()
      )

      const realTxHash = (sendRes as any)?.txHash || (sendRes as any)?.transactionHash || ''
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

      deductSessionSpend(tokenAmountToUsd(tokenSymbol, normalizedAmount), activeWallet)

      addTransaction({
        type: 'send',
        txHash: realTxHash,
        amount: normalizedAmount.toString(),
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

  // No executable branch matched this action type: never imply an on-chain transaction.
  if (onProgress) onProgress('failed')
  return failedActionReceipt(
    'send',
    actionPayload.title || 'Action Not Executed',
    `Unsupported action type: '${actType}'. No on-chain transaction was performed.`,
    startTime
  )

}
