// src/services/copilot/copilotClaimAction.ts
// On-chain "Claim All Fees" / single-pool harvest executor for Ask Arco.
// - Passkey / MSCA: batches every claimable pool's `harvest()` into ONE atomic gasless UserOp.
// - Circle UCW: sequentially executes `harvest()` challenges with clean partial-harvest reporting.
// - Injected EVM EOA: sequentially executes `harvest()` with `estimateSafeGas` and receipt event decoding.
// Never uses the ephemeral session enclave because pending fees belong to `activeWallet`.

import {
  decodeEventLog,
  encodeFunctionData,
  formatUnits,
  type Address,
  type Hex,
} from 'viem'
import {
  POOL_VERSION_V4,
  STABLE_SWAP_ABI,
  YIELD_VAULT_ABI,
} from '../../config/poolsConfig'
import type { CopilotClaimablePoolItem } from '../../types/marketplace'
import type { InlineExecutionReceipt } from '../../types/sessionKey'
import { addTransaction } from '../../utils/history'
import { formatCopilotError, isUserCanceled } from '../../utils/errorUtils'
import { resolveUcwTxHash, ucwHashPendingMessage } from '../../utils/ucwTxHash'
import { logger } from '../../utils/logger'
import { getResilientPublicClient } from '../rpc'
import { resolveArcActualFeeUsdc } from '../arcGasService'
import { sendModularUserOperation, arcTestnetChain } from '../modularWalletService'
import { estimateSafeGas } from '../pools/poolUtils'
import { DEFAULT_TOKEN_PRICES, getLiveTokenPrices, normalizeTokenSymbol } from '../tokenPriceService'
import {
  type CopilotActionContext,
  failedActionReceipt,
  getVerifiedArcReceipt,
  isPasskeyWalletContext,
  isTransactionHash,
} from './copilotCommon'
import { formatClaimPoolSummary, scanClaimableCopilotFees } from './copilotClaimQuote'

const log = logger.createScope('copilotClaimAction')

function isUcwCanceledError(errMsg?: string): boolean {
  const lower = (errMsg || '').toLowerCase()
  return lower.includes('cancel') || lower.includes('iptal') || lower.includes('closed')
}

function tokenPrice(symbol: string, prices: Record<string, number>): number {
  const norm = normalizeTokenSymbol(symbol)
  if (norm === 'USDC') return 1.0
  return prices[norm] || DEFAULT_TOKEN_PRICES[norm] || 1.0
}

function trimDecimal(units: bigint, decimals: number): string {
  if (units <= 0n) return '0'
  const raw = formatUnits(units, decimals)
  const [whole, frac = ''] = raw.split('.')
  const maxFrac = decimals >= 18 ? 8 : Math.min(decimals, 6)
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

/** Decodes `FeesHarvested` (AMM LP pool) or `YieldHarvested` (Yield Vault) from a mined receipt. */
export function decodeHarvestedFromReceipt(
  receipt: { logs?: readonly any[] },
  item: CopilotClaimablePoolItem,
  expectedOwner: string
): { feeA: bigint; feeB: bigint } | null {
  if (!receipt?.logs) return null
  for (const logItem of receipt.logs) {
    if (String(logItem.address || '').toLowerCase() !== item.poolAddress.toLowerCase()) continue
    try {
      if (item.isVault) {
        const decoded = decodeEventLog({
          abi: YIELD_VAULT_ABI,
          data: logItem.data,
          topics: logItem.topics,
        })
        if (decoded.eventName !== 'YieldHarvested') continue
        const args = decoded.args as any
        if (String(args.user || '').toLowerCase() === expectedOwner.toLowerCase()) {
          return { feeA: BigInt(args.amount ?? 0), feeB: 0n }
        }
      } else {
        const decoded = decodeEventLog({
          abi: STABLE_SWAP_ABI,
          data: logItem.data,
          topics: logItem.topics,
        })
        if (decoded.eventName !== 'FeesHarvested') continue
        const args = decoded.args as any
        if (String(args.lp || '').toLowerCase() === expectedOwner.toLowerCase()) {
          return { feeA: BigInt(args.feeA ?? 0), feeB: BigInt(args.feeB ?? 0) }
        }
      }
    } catch {
      // Ignore unrelated logs
    }
  }
  return null
}

function tokenDecimalsForSymbol(symbol?: string): number {
  if (!symbol) return 6
  const upper = symbol.toUpperCase()
  if (upper === 'CIRBTC') return 8
  if (upper === 'WETH' || upper === 'ETH') return 18
  return 6
}

export async function executeCopilotClaimFeesAction(
  context: CopilotActionContext
): Promise<InlineExecutionReceipt> {
  const {
    actionPayload,
    activeWallet,
    provider,
    onProgress,
    ucwHandlers,
    startTime,
  } = context

  if (!POOL_VERSION_V4) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('claim', 'Fee Harvest Unavailable', 'Fee harvesting requires V4 pool contracts.', startTime)
  }

  if (onProgress) onProgress('routing')

  const data = actionPayload.data || {}
  const targetPoolId = data.claimScope === 'single' && typeof data.poolId === 'string' ? data.poolId : undefined

  // Re-verify live claimable fees on-chain right before signing so already-harvested pools are skipped.
  const freshScan = await scanClaimableCopilotFees(activeWallet, { poolId: targetPoolId })
  if (!freshScan.ok || freshScan.pools.length === 0) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt(
      'claim',
      'No Claimable Fees',
      freshScan.ok
        ? 'No accrued fees remain to harvest on Arc Testnet.'
        : freshScan.error.replace(/<[^>]*>/g, ''),
      startTime
    )
  }

  const claimablePools = freshScan.pools
  const prices = await getLiveTokenPrices().catch(() => ({ ...DEFAULT_TOKEN_PRICES }))
  const resilientClient = getResilientPublicClient('Arc_Testnet')
  const effectiveProvider =
    provider || (typeof window !== 'undefined' && (window as any).ethereum ? (window as any).ethereum : null)

  if (onProgress) onProgress('signing')
  if (onProgress) onProgress('broadcasting')

  type ClaimedOutcome = {
    poolId: string
    poolName: string
    summary: string
    usdValue: number
    txHash: string
  }

  const claimedOutcomes: ClaimedOutcome[] = []
  const failedPools: string[] = []
  const txHashes: string[] = []
  let canceledError: any = null

  const buildOutcomeFromReceipt = (
    item: CopilotClaimablePoolItem,
    receipt: { logs?: readonly any[] } | null,
    txHash: string
  ): ClaimedOutcome => {
    const decoded = receipt ? decodeHarvestedFromReceipt(receipt, item, activeWallet) : null
    const feeA = decoded ? decoded.feeA : BigInt(item.feeARaw || '0')
    const feeB = decoded ? decoded.feeB : BigInt(item.feeBRaw || '0')
    const decA = tokenDecimalsForSymbol(item.tokenA)
    const decB = tokenDecimalsForSymbol(item.tokenB)
    const usdA = Number(formatUnits(feeA, decA)) * tokenPrice(item.tokenA, prices)
    const usdB = item.tokenB && feeB > 0n ? Number(formatUnits(feeB, decB)) * tokenPrice(item.tokenB, prices) : 0
    const usdValue = Number((usdA + usdB).toFixed(6))

    const parts: string[] = []
    if (feeA > 0n) parts.push(`${trimDecimal(feeA, decA)} ${item.tokenA}`)
    if (item.tokenB && feeB > 0n) parts.push(`${trimDecimal(feeB, decB)} ${item.tokenB}`)
    const summary = parts.join(' + ') || formatClaimPoolSummary(item)

    return {
      poolId: item.poolId,
      poolName: item.poolName,
      summary,
      usdValue,
      txHash,
    }
  }

  // ── A. Passkey / Modular Smart Account (Single Atomic Batched UserOp) ──
  if (isPasskeyWalletContext(context)) {
    try {
      const calls = claimablePools.map((item) => ({
        to: item.poolAddress as Hex,
        data: item.isVault
          ? encodeFunctionData({ abi: YIELD_VAULT_ABI, functionName: 'harvest' })
          : encodeFunctionData({ abi: STABLE_SWAP_ABI, functionName: 'harvest' }),
      }))

      const opRes = await sendModularUserOperation({ calls, paymaster: true })
      if (!opRes.success || !opRes.txHash) {
        throw new Error(opRes.error || 'Modular UserOperation harvest failed.')
      }

      if (!isTransactionHash(opRes.txHash)) {
        if (onProgress) onProgress('failed')
        return failedActionReceipt('claim', 'Harvest Not Confirmed', 'No valid transaction hash was returned.', startTime)
      }

      const receipt = await getVerifiedArcReceipt(opRes.txHash as Hex, 'Copilot batched harvest')
      if (!receipt) {
        if (onProgress) onProgress('pending')
        return {
          id: `rcpt_pending_${Date.now()}`,
          actionType: 'claim',
          title: 'Fee Claim Submitted — Confirmation Pending',
          status: 'PENDING',
          txHash: opRes.txHash,
          totalClaimedUsd: freshScan.totalClaimableUsd,
          txCount: 1,
          gasUsdc: 0,
          settlementLatencyMs: Date.now() - startTime,
          timestamp: Date.now(),
        }
      }
      if (receipt.status !== 'success') {
        if (onProgress) onProgress('failed')
        return failedActionReceipt('claim', 'Fee Claim Reverted', 'The batched harvest UserOperation reverted on Arc Testnet.', startTime)
      }

      txHashes.push(opRes.txHash)
      for (const item of claimablePools) {
        claimedOutcomes.push(buildOutcomeFromReceipt(item, receipt, opRes.txHash))
      }
    } catch (opErr: any) {
      log.warn('Modular UserOp claim all error:', opErr)
      if (onProgress) onProgress('failed')
      const cleanErr = formatCopilotError(opErr)
      return {
        ...failedActionReceipt('claim', cleanErr.title || 'Fee Claim Failed', cleanErr.message || opErr?.message || 'Harvest failed.', startTime),
        status: cleanErr.isCanceled ? 'CANCELED' : 'FAILED',
      }
    }
  } else if (ucwHandlers?.authSource === 'ucw') {
    // ── B. Circle UCW Execution (Sequential `harvest()` Challenges) ──
    if (!ucwHandlers.executeUcwContract) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('claim', 'Circle UCW Unavailable', 'Circle UCW contract challenge handler is missing; no fallback signer was used.', startTime)
    }

    for (const item of claimablePools) {
      try {
        const res = await ucwHandlers.executeUcwContract({
          contractAddress: item.poolAddress,
          abiFunctionSignature: 'harvest()',
          abiParameters: [],
          blockchain: 'ARC-TESTNET',
        })
        if (!res.success) {
          const err: any = new Error(res.error || `Harvest authorization failed for ${item.poolName}.`)
          if (isUcwCanceledError(res.error)) err.isCanceled = true
          throw err
        }
        const hash = resolveUcwTxHash(res)
        if (!hash || !isTransactionHash(hash)) {
          throw new Error(ucwHashPendingMessage(`Harvest (${item.poolName})`))
        }
        const receipt = await getVerifiedArcReceipt(hash as Hex, `UCW harvest (${item.poolName})`)
        if (receipt && receipt.status !== 'success') {
          throw new Error(`Harvest reverted on-chain for ${item.poolName}.`)
        }
        txHashes.push(hash)
        claimedOutcomes.push(buildOutcomeFromReceipt(item, receipt, hash))
      } catch (err: any) {
        if (isUserCanceled(err) || err?.isCanceled) {
          canceledError = err
          break
        }
        log.warn(`UCW harvest failed for ${item.poolName}:`, err)
        failedPools.push(item.poolName)
      }
    }
  } else if (effectiveProvider) {
    // ── C. Injected EVM EOA Execution (Sequential `harvest()` Calls) ──
    try {
      const { createWalletClient, custom } = await import('viem')
      const walletClient = createWalletClient({
        account: activeWallet as Hex,
        chain: arcTestnetChain,
        transport: custom(effectiveProvider),
      })

      for (const item of claimablePools) {
        try {
          const abi = item.isVault ? YIELD_VAULT_ABI : STABLE_SWAP_ABI
          const gasLimit = await estimateSafeGas(
            resilientClient,
            {
              address: item.poolAddress as Address,
              abi,
              functionName: 'harvest',
              args: [],
              account: activeWallet as Address,
            },
            300_000n
          )
          const hash = await walletClient.writeContract({
            address: item.poolAddress as Address,
            abi,
            functionName: 'harvest',
            args: [],
            gas: gasLimit,
          })
          const receipt = await getVerifiedArcReceipt(hash as Hex, `EOA harvest (${item.poolName})`)
          if (receipt && receipt.status !== 'success') {
            throw new Error(`Harvest reverted on-chain for ${item.poolName}.`)
          }
          txHashes.push(hash)
          claimedOutcomes.push(buildOutcomeFromReceipt(item, receipt, hash))
        } catch (err: any) {
          if (isUserCanceled(err) || err?.isCanceled || err?.code === 4001) {
            canceledError = err
            break
          }
          log.warn(`EOA harvest failed for ${item.poolName}:`, err)
          failedPools.push(item.poolName)
        }
      }
    } catch (providerErr: any) {
      log.warn('EOA wallet client error during claim all:', providerErr)
      if (onProgress) onProgress('failed')
      const cleanErr = formatCopilotError(providerErr)
      return failedActionReceipt('claim', cleanErr.title || 'Fee Claim Failed', cleanErr.message || providerErr?.message || 'Wallet error.', startTime)
    }
  } else {
    if (onProgress) onProgress('failed')
    return failedActionReceipt(
      'claim',
      'Wallet Not Connected',
      'Please connect your wallet (Passkey, Circle UCW, or EVM EOA) to claim accrued fees.',
      startTime
    )
  }

  // Handle total failure or full cancel
  if (claimedOutcomes.length === 0) {
    if (onProgress) onProgress('failed')
    if (canceledError) {
      const cleanErr = formatCopilotError(canceledError)
      return {
        ...failedActionReceipt('claim', 'Fee Claim Cancelled', cleanErr.message || 'Fee claim canceled by user.', startTime),
        status: 'CANCELED',
      }
    }
    return failedActionReceipt(
      'claim',
      'Fee Claim Failed',
      failedPools.length > 0
        ? `Could not harvest fees for: ${failedPools.join(', ')}. Please try again.`
        : 'No fees were harvested. Please try again.',
      startTime
    )
  }

  // Record each harvested pool in transaction history
  for (const outcome of claimedOutcomes) {
    try {
      addTransaction({
        type: 'harvest',
        txHash: outcome.txHash,
        amount: outcome.usdValue.toFixed(4),
        tokenSymbol: 'USDC',
        sourceChain: 'Arc_Testnet',
        recipient: activeWallet,
        userAddress: activeWallet,
        status: 'success',
        poolId: outcome.poolId,
        poolName: outcome.poolName,
      })
    } catch (histErr) {
      log.debug('Could not persist harvest history entry:', histErr)
    }
  }

  // Sum verified Arc gas fees across unique tx hashes
  const uniqueHashes = [...new Set(txHashes)]
  let totalGasUsdc: number | null = null
  let firstFeeRes: Awaited<ReturnType<typeof resolveArcActualFeeUsdc>> | undefined
  for (const hash of uniqueHashes) {
    const feeRes = await resolveArcActualFeeUsdc(hash)
    if (!firstFeeRes) firstFeeRes = feeRes
    if (feeRes.feeUsdc != null && Number.isFinite(feeRes.feeUsdc)) {
      totalGasUsdc = (totalGasUsdc ?? 0) + feeRes.feeUsdc
    }
  }

  const totalClaimedUsd = Number(
    claimedOutcomes.reduce((acc, item) => acc + item.usdValue, 0).toFixed(6)
  )
  const durationMs = Date.now() - startTime

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('arcis_portfolio_updated'))
    window.dispatchEvent(new CustomEvent('arcis:pool-tx-indexed'))
  }

  if (onProgress) onProgress('confirmed')

  const isPartial = Boolean(canceledError) || failedPools.length > 0
  const isSinglePoolClaim = Boolean(targetPoolId) && claimedOutcomes.length === 1
  const singlePool = isSinglePoolClaim ? claimedOutcomes[0] : undefined
  const isSingleVault = singlePool?.poolId === 'usdc-yield-vault'

  const title = isPartial
    ? 'Partial Fee Harvest Completed'
    : singlePool
      ? isSingleVault
        ? `${singlePool.poolName} Yield Claimed`
        : `${singlePool.poolName} Fees Claimed`
      : 'All Fees Claimed Successfully'

  const subtitle = isPartial
    ? `Harvested ${claimedOutcomes.length} of ${claimablePools.length} pools${canceledError ? ' (remaining canceled)' : ''}`
    : singlePool
      ? `${singlePool.poolName} accrued ${isSingleVault ? 'yield' : 'fees'} credited directly to your wallet`
      : uniqueHashes.length === 1 && claimedOutcomes.length > 1
        ? `Harvested ${claimedOutcomes.length} pools in 1 batched transaction`
        : `Harvested across ${claimedOutcomes.length} ${claimedOutcomes.length === 1 ? 'pool' : 'pools'}`

  return {
    id: `rcpt_${Date.now()}`,
    actionType: 'claim',
    title,
    subtitle,
    status: 'SUCCESS',
    txHash: uniqueHashes[uniqueHashes.length - 1] || '',
    fromToken: 'USDC',
    amountIn: totalClaimedUsd,
    amountOut: totalClaimedUsd,
    ...(singlePool && { poolId: singlePool.poolId, poolName: singlePool.poolName }),
    userAddress: activeWallet,
    claimedPools: claimedOutcomes,
    ...(failedPools.length > 0 && { failedPools }),
    totalClaimedUsd,
    txCount: uniqueHashes.length,
    gasUsdc: totalGasUsdc ?? 0,
    actualGasUsdc: totalGasUsdc,
    baseFeeUsdc: uniqueHashes.length === 1 ? firstFeeRes?.baseFeeUsdcExact : undefined,
    priorityFeeUsdc: uniqueHashes.length === 1 ? firstFeeRes?.priorityFeeUsdcExact : undefined,
    settlementLatencyMs: durationMs,
    timestamp: Date.now(),
  }
}
