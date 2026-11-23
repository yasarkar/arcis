// src/services/copilot/copilotLpRemoveAction.ts
// On-chain LP liquidity removal executor (`removeLiquidity(lpAmount, minOutA, minOutB)`) for Ask Arco.
// Supports Passkey/MSCA (gasless UserOp), Circle UCW, and Injected EVM EOA wallets.
// Verifies live reserves & approved slippage minimums before signing and decodes `LiquidityRemoved` on-chain.

import {
  decodeEventLog,
  encodeFunctionData,
  formatUnits,
  type Address,
  type Hex,
} from 'viem'
import {
  POOL_DEFAULT_SLIPPAGE_BPS,
  POOL_VERSION_V4,
  STABLE_SWAP_ABI,
  poolMinOut,
  poolSlippageBps,
} from '../../config/poolsConfig'
import type { InlineExecutionReceipt } from '../../types/sessionKey'
import { getCopilotLpPoolById } from '../../utils/copilotPoolParser'
import { addTransaction } from '../../utils/history'
import { formatCopilotError } from '../../utils/errorUtils'
import { resolveUcwTxHash, ucwHashPendingMessage } from '../../utils/ucwTxHash'
import { logger } from '../../utils/logger'
import { getResilientPublicClient } from '../rpc'
import { resolveArcActualFeeUsdc } from '../arcGasService'
import { sendModularUserOperation, arcTestnetChain } from '../modularWalletService'
import { estimateSafeGas, requireDeployed } from '../pools/poolUtils'
import { DEFAULT_TOKEN_PRICES, getLiveTokenPrices, normalizeTokenSymbol } from '../tokenPriceService'
import {
  type CopilotActionContext,
  failedActionReceipt,
  getVerifiedArcReceipt,
  isPasskeyWalletContext,
  isTransactionHash,
} from './copilotCommon'

const log = logger.createScope('copilotLpRemoveAction')

function isUcwCanceledError(errMsg?: string): boolean {
  const lower = (errMsg || '').toLowerCase()
  return lower.includes('cancel') || lower.includes('iptal') || lower.includes('closed')
}

function trimUnits(units: bigint, decimals: number): string {
  if (units <= 0n) return '0'
  const raw = formatUnits(units, decimals)
  const [whole, frac = ''] = raw.split('.')
  const maxFrac = decimals >= 18 ? 8 : Math.min(decimals, 6)
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

function tokenPrice(symbol: string, prices: Record<string, number>): number {
  const norm = normalizeTokenSymbol(symbol)
  if (norm === 'USDC') return 1.0
  return prices[norm] || DEFAULT_TOKEN_PRICES[norm] || 1.0
}

/** Decodes `LiquidityRemoved(provider, lpAmount, amountA, amountB)` from a mined Arc receipt. */
export function decodeLiquidityRemovedFromReceipt(
  receipt: { logs?: readonly any[] },
  poolAddress: string,
  expectedProvider: string
): { lpAmount: bigint; amountA: bigint; amountB: bigint } | null {
  if (!receipt?.logs) return null
  for (const logItem of receipt.logs) {
    if (String(logItem.address || '').toLowerCase() !== poolAddress.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: STABLE_SWAP_ABI,
        data: logItem.data,
        topics: logItem.topics,
      })
      if (decoded.eventName !== 'LiquidityRemoved') continue
      const args = decoded.args as any
      if (
        String(args.provider || '').toLowerCase() === expectedProvider.toLowerCase() &&
        BigInt(args.lpAmount ?? 0) > 0n
      ) {
        return {
          lpAmount: BigInt(args.lpAmount ?? 0),
          amountA: BigInt(args.amountA ?? 0),
          amountB: BigInt(args.amountB ?? 0),
        }
      }
    } catch {
      // Ignore unrelated logs
    }
  }
  return null
}

export async function executeCopilotLpRemoveAction(
  context: CopilotActionContext
): Promise<InlineExecutionReceipt> {
  const {
    actionPayload,
    activeWallet,
    provider,
    onProgress,
    ucwHandlers,
    onSubmission,
    startTime,
  } = context

  const data = actionPayload.data || {}
  const pool = getCopilotLpPoolById(data.poolId)
  if (!pool || !pool.isLpPool) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('withdraw', 'Unknown Liquidity Pool', 'The target AMM pool could not be resolved; no transaction was sent.', startTime)
  }

  const poolAddress = pool.contractAddress as Address
  try {
    requireDeployed(poolAddress, pool.name)
  } catch (err: any) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('withdraw', 'Pool Not Deployed', err?.message || 'Pool is not deployed on Arc Testnet.', startTime)
  }

  const tokenA = pool.tokens[0]
  const tokenB = pool.tokens[1]
  const approvedMinOutARaw = data.minOutARaw ? BigInt(String(data.minOutARaw)) : 0n
  const approvedMinOutBRaw = data.minOutBRaw ? BigInt(String(data.minOutBRaw)) : 0n
  const lpToRemoveRequested = data.lpAmountRaw && /^\d+$/.test(String(data.lpAmountRaw))
    ? BigInt(String(data.lpAmountRaw))
    : 0n

  if (lpToRemoveRequested <= 0n) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('withdraw', 'Invalid LP Removal Amount', 'No valid LP token amount was specified; please prepare a fresh quote.', startTime)
  }
  if (POOL_VERSION_V4 && approvedMinOutARaw <= 0n && approvedMinOutBRaw <= 0n) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('withdraw', 'Slippage Guard Required', 'This LP removal draft is missing live minimum-output guards. Please request a fresh quote.', startTime)
  }

  const slipBps =
    typeof data.slippageBps === 'number' && Number.isFinite(data.slippageBps) && data.slippageBps > 0
      ? poolSlippageBps(data.slippageBps / 100)
      : POOL_DEFAULT_SLIPPAGE_BPS

  if (onProgress) onProgress('routing')
  const resilientClient = getResilientPublicClient('Arc_Testnet')

  // Step 1: Verify live LP balance, reserves, and paused state right before signing
  let userLpRaw = 0n
  let reserveA = 0n
  let reserveB = 0n
  let totalLp = 0n
  let paused = false
  try {
    const [bal, rA, rB, tLp, p] = await Promise.all([
      resilientClient.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'balanceOf', args: [activeWallet as Address] }) as Promise<bigint>,
      resilientClient.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }) as Promise<bigint>,
      resilientClient.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }) as Promise<bigint>,
      resilientClient.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }) as Promise<bigint>,
      resilientClient.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'paused' }).catch(() => false) as Promise<boolean>,
    ])
    userLpRaw = bal
    reserveA = rA
    reserveB = rB
    totalLp = tLp
    paused = Boolean(p)
  } catch (err) {
    log.warn('Failed to read live pool state before LP removal:', err)
    if (onProgress) onProgress('failed')
    return failedActionReceipt('withdraw', 'Pool State Unavailable', `Could not read live ${pool.name} position on Arc Testnet; no transaction was sent.`, startTime)
  }

  if (paused) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('withdraw', 'Pool Paused', `${pool.name} is currently paused on Arc Testnet.`, startTime)
  }
  if (userLpRaw <= 0n) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('withdraw', 'No LP Balance', `You no longer hold LP tokens in ${pool.name}.`, startTime)
  }

  // If removing 100% (or within 0.05% dust), burn the exact live balance so no dust remains
  const lpToRemove =
    (data.removeMode === 'percent' && Number(data.removePercent) >= 100) ||
    lpToRemoveRequested >= userLpRaw
      ? userLpRaw
      : lpToRemoveRequested

  if (totalLp <= 0n || reserveA <= 0n || reserveB <= 0n) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('withdraw', 'Pool Reserves Unavailable', `Could not verify ${pool.name} reserves for safe LP removal.`, startTime)
  }

  const liveExpectedA = (reserveA * lpToRemove) / totalLp
  const liveExpectedB = (reserveB * lpToRemove) / totalLp
  const liveMinOutA = POOL_VERSION_V4 ? poolMinOut(liveExpectedA, slipBps) : 0n
  const liveMinOutB = POOL_VERSION_V4 ? poolMinOut(liveExpectedB, slipBps) : 0n

  // Never loosen the slippage floor below what the user confirmed on the card
  const effectiveMinOutA = liveMinOutA > approvedMinOutARaw ? liveMinOutA : approvedMinOutARaw
  const effectiveMinOutB = liveMinOutB > approvedMinOutBRaw ? liveMinOutB : approvedMinOutBRaw

  if (POOL_VERSION_V4 && (liveExpectedA < approvedMinOutARaw || liveExpectedB < approvedMinOutBRaw)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt(
      'withdraw',
      'Pool Ratio Moved',
      `Live outputs for ${pool.name} moved below your approved slippage minimums. Please request a fresh quote and retry.`,
      startTime
    )
  }

  const removeArgs: readonly [bigint, bigint, bigint] = [lpToRemove, effectiveMinOutA, effectiveMinOutB]

  if (onProgress) onProgress('signing')
  if (onProgress) onProgress('broadcasting')

  let realTxHash = ''
  const effectiveProvider =
    provider || (typeof window !== 'undefined' && (window as any).ethereum ? (window as any).ethereum : null)

  // ── A. Circle UCW Execution ──
  if (ucwHandlers?.authSource === 'ucw') {
    if (!ucwHandlers.executeUcwContract) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('withdraw', 'Circle UCW Unavailable', 'Circle UCW contract challenge handler is missing; no fallback signer was used.', startTime)
    }
    try {
      const res = await ucwHandlers.executeUcwContract({
        contractAddress: poolAddress,
        abiFunctionSignature: 'removeLiquidity(uint256,uint256,uint256)',
        abiParameters: [removeArgs[0].toString(), removeArgs[1].toString(), removeArgs[2].toString()],
        blockchain: 'ARC-TESTNET',
      })
      if (!res.success) {
        const err: any = new Error(res.error || 'Remove liquidity authorization failed.')
        if (isUcwCanceledError(res.error)) err.isCanceled = true
        throw err
      }
      const ucwHash = resolveUcwTxHash(res)
      if (!ucwHash) throw new Error(ucwHashPendingMessage('Remove liquidity'))
      realTxHash = ucwHash
    } catch (ucwErr: any) {
      log.warn('UCW remove LP error:', ucwErr)
      if (onProgress) onProgress('failed')
      const cleanErr = formatCopilotError(ucwErr)
      return {
        ...failedActionReceipt('withdraw', cleanErr.title || 'LP Removal Failed', cleanErr.message || ucwErr?.message || 'Remove liquidity failed.', startTime),
        status: cleanErr.isCanceled ? 'CANCELED' : 'FAILED',
      }
    }
  } else if (isPasskeyWalletContext(context)) {
    // ── B. Passkey / MSCA Execution ──
    try {
      const removeCall = {
        to: poolAddress as Hex,
        data: encodeFunctionData({
          abi: STABLE_SWAP_ABI,
          functionName: 'removeLiquidity',
          args: removeArgs,
        }),
      }
      const opRes = await sendModularUserOperation({ calls: [removeCall], paymaster: true })
      onSubmission?.({ txHash: opRes.txHash, userOpHash: opRes.userOpHash, phase: 'spend' })
      if (!opRes.success || !opRes.txHash) {
        throw new Error(opRes.error || 'Modular UserOperation removeLiquidity failed.')
      }
      realTxHash = opRes.txHash
    } catch (opErr: any) {
      log.warn('Modular UserOp remove LP error:', opErr)
      if (onProgress) onProgress('failed')
      const cleanErr = formatCopilotError(opErr)
      return {
        ...failedActionReceipt('withdraw', cleanErr.title || 'LP Removal Failed', cleanErr.message || opErr?.message || 'Remove liquidity failed.', startTime),
        status: cleanErr.isCanceled ? 'CANCELED' : 'FAILED',
      }
    }
  } else if (effectiveProvider) {
    // ── C. Injected EOA Wallet Execution ──
    try {
      const { createWalletClient, custom } = await import('viem')
      const walletClient = createWalletClient({
        account: activeWallet as Hex,
        chain: arcTestnetChain,
        transport: custom(effectiveProvider),
      })
      const gasLimit = await estimateSafeGas(
        resilientClient,
        {
          address: poolAddress,
          abi: STABLE_SWAP_ABI,
          functionName: 'removeLiquidity',
          args: removeArgs as any,
          account: activeWallet as Address,
        },
        400_000n
      )
      realTxHash = await walletClient.writeContract({
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'removeLiquidity',
        args: removeArgs,
        gas: gasLimit,
      })
    } catch (eoaErr: any) {
      log.warn('EOA remove LP error:', eoaErr)
      if (onProgress) onProgress('failed')
      const cleanErr = formatCopilotError(eoaErr)
      return {
        ...failedActionReceipt('withdraw', cleanErr.title || 'LP Removal Failed', cleanErr.message || eoaErr?.message || 'Remove liquidity failed.', startTime),
        status: cleanErr.isCanceled ? 'CANCELED' : 'FAILED',
      }
    }
  } else {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('withdraw', 'Wallet Not Connected', 'Please connect your wallet to remove LP liquidity.', startTime)
  }

  if (!isTransactionHash(realTxHash)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('withdraw', 'LP Removal Not Confirmed', 'No valid transaction hash was returned.', startTime)
  }

  const removeReceipt = await getVerifiedArcReceipt(realTxHash as Hex, `Copilot LP removal (${pool.name})`)
  if (!removeReceipt) {
    if (onProgress) onProgress('pending')
    return {
      id: `rcpt_pending_${Date.now()}`,
      actionType: 'withdraw',
      title: `${pool.name} LP Removal Pending`,
      status: 'PENDING',
      txHash: realTxHash,
      poolId: pool.id,
      poolName: pool.name,
      lpTokenSymbol: pool.lpTokenSymbol,
      gasUsdc: 0,
      settlementLatencyMs: Date.now() - startTime,
      timestamp: Date.now(),
    }
  }

  if (removeReceipt.status !== 'success') {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('withdraw', 'LP Removal Reverted', `The confirmed ${pool.name} removeLiquidity transaction reverted on Arc Testnet.`, startTime)
  }

  const decoded = decodeLiquidityRemovedFromReceipt(removeReceipt, poolAddress, activeWallet)
  const actualLpBurned = decoded?.lpAmount ?? lpToRemove
  const actualOutA = decoded?.amountA ?? liveExpectedA
  const actualOutB = decoded?.amountB ?? liveExpectedB

  const receivedAmountA = trimUnits(actualOutA, tokenA.decimals)
  const receivedAmountB = trimUnits(actualOutB, tokenB.decimals)
  const lpBurned = trimUnits(actualLpBurned, 18)

  const prices = await getLiveTokenPrices().catch(() => ({ ...DEFAULT_TOKEN_PRICES }))
  const withdrawnUsd = Number(
    (
      Number(formatUnits(actualOutA, tokenA.decimals)) * tokenPrice(tokenA.symbol, prices) +
      Number(formatUnits(actualOutB, tokenB.decimals)) * tokenPrice(tokenB.symbol, prices)
    ).toFixed(4)
  )

  const fee = await resolveArcActualFeeUsdc(realTxHash)
  const durationMs = Date.now() - startTime

  try {
    addTransaction({
      type: 'remove_liquidity',
      txHash: realTxHash,
      amount: receivedAmountA,
      tokenSymbol: tokenA.symbol,
      amountB: receivedAmountB,
      tokenB: tokenB.symbol,
      sourceChain: 'Arc_Testnet',
      recipient: activeWallet,
      userAddress: activeWallet,
      status: 'success',
      poolId: pool.id,
      poolName: pool.name,
      lpMinted: lpBurned,
    })
  } catch (histErr) {
    log.debug('Failed to persist remove_liquidity history item:', histErr)
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('arcis_portfolio_updated'))
    window.dispatchEvent(new CustomEvent('arcis:pool-tx-indexed'))
  }

  if (onProgress) onProgress('confirmed')

  return {
    id: `rcpt_${Date.now()}`,
    actionType: 'withdraw',
    title: `${pool.name} LP Removed`,
    subtitle: `${lpBurned} ${pool.lpTokenSymbol || 'LP'} burned and returned to your wallet`,
    status: 'SUCCESS',
    txHash: realTxHash,
    fromToken: tokenA.symbol,
    tokenB: tokenB.symbol,
    amountIn: Number(receivedAmountA),
    amountB: Number(receivedAmountB),
    receivedAmountA,
    receivedAmountB,
    lpBurned,
    lpTokenSymbol: pool.lpTokenSymbol,
    withdrawnUsd,
    poolId: pool.id,
    poolName: pool.name,
    userAddress: activeWallet,
    gasUsdc: fee.feeUsdc ?? 0,
    actualGasUsdc: fee.feeUsdc,
    baseFeeUsdc: fee.baseFeeUsdcExact,
    priorityFeeUsdc: fee.priorityFeeUsdcExact,
    settlementLatencyMs: durationMs,
    timestamp: Date.now(),
  }
}
