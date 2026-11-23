// src/services/copilot/copilotLpDepositAction.ts
// On-chain LP pool deposit executor for Ask Arco (1-Click Zap & Dual-Asset).
// Supports all 4 Ask Arco wallet routes: Session Enclave (USDC Zap only), Circle UCW,
// Passkey/MSCA batched UserOperations, and Injected EVM EOA wallets.
// Enforces V4 slippage guards, pool-specific explicit deadlines (EURC/cirBTC & cirBTC/WETH),
// donation protection, and strict LiquidityAdded receipt event verification.

import {
  type Hex,
  type Address,
  parseUnits,
  formatUnits,
  encodeFunctionData,
  decodeEventLog,
  createWalletClient,
  http,
} from 'viem'
import {
  ERC20_ABI,
  POOL_CONTRACTS,
  POOL_DEFAULT_SLIPPAGE_BPS,
  POOL_VERSION_V4,
  STABLE_SWAP_ABI,
  STABLE_SWAP_AMP,
  poolMinLpShares,
  poolSlippageBps,
} from '../../config/poolsConfig'
import { arcTestnet, ARC_METADATA } from '../../config/arcChain'
import { numberToExactDecimal } from '../../utils/copilotAmount'
import { getCopilotLpPoolById } from '../../utils/copilotPoolParser'
import {
  calculateConstantProductExpectedOut,
  calculatePoolShare,
  calculateStableSwapExpectedOut,
} from '../../utils/poolMath'
import { recordClientSwapVolume } from '../../utils/poolVolumeUtils'
import {
  buildPoolAddLiquidityCall,
  buildPoolAddLiquidityUcwCall,
  buildPoolSwapCall,
  buildPoolSwapUcwCall,
} from '../pools/poolDeadline'
import { estimateSafeGas, requireDeployed } from '../pools/poolUtils'
import { computeExpectedLpShares } from './copilotLpQuote'
import { resolveArcActualFeeUsdc } from '../arcGasService'
import { getResilientPublicClient } from '../rpc'
import type { InlineExecutionReceipt } from '../../types/sessionKey'
import { verifySessionLimits, deductSessionSpend } from '../sessionKeyService'
import { getEphemeralSessionAccount, fetchEnclaveUsdcBalance } from '../sessionEnclaveService'
import { sendModularUserOperation, arcTestnetChain } from '../modularWalletService'
import { addTransaction } from '../../utils/history'
import { formatCopilotError } from '../../utils/errorUtils'
import { logger } from '../../utils/logger'
import {
  type CopilotActionContext,
  failedActionReceipt,
  isPasskeyWalletContext,
  isPositiveTokenAmount,
  isTransactionHash,
  getVerifiedArcReceipt,
  valueTokenAmountUsd,
} from './copilotCommon'

const log = logger.createScope('copilotLpDepositAction')

function isConstantProductPool(poolId: string, tags?: readonly string[]): boolean {
  return (
    poolId === 'usdc-cirbtc-pool' ||
    poolId === 'usdc-weth-pool' ||
    poolId === 'eurc-weth-pool' ||
    poolId === 'eurc-cirbtc-pool' ||
    poolId === 'cirbtc-weth-pool' ||
    Boolean(tags?.includes('Constant Product'))
  )
}

function getPoolFeeBps(poolId: string, feeTierPercent?: number): bigint {
  if (typeof feeTierPercent === 'number' && feeTierPercent > 0) {
    return BigInt(Math.round(feeTierPercent * 100))
  }
  if (poolId === 'usdc-eurc-stable-pool') return 12n
  if (poolId === 'usdc-cirbtc-pool' || poolId === 'eurc-cirbtc-pool') return 25n
  return 30n
}

export function decodeLiquidityAddedFromReceipt(
  receipt: { logs?: readonly any[] },
  poolAddress: string,
  expectedProvider: string
): { amountA: bigint; amountB: bigint; lpMinted: bigint } | null {
  if (!receipt?.logs) return null
  for (const logItem of receipt.logs) {
    if (String(logItem.address || '').toLowerCase() !== poolAddress.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({
        abi: STABLE_SWAP_ABI,
        data: logItem.data,
        topics: logItem.topics,
      })
      if (decoded.eventName !== 'LiquidityAdded') continue
      const args = decoded.args as any
      const providerMatch = String(args.provider || '').toLowerCase() === expectedProvider.toLowerCase()
      const lpMinted = BigInt(args.lpMinted ?? 0)
      if (providerMatch && lpMinted > 0n) {
        return {
          amountA: BigInt(args.amountA ?? 0),
          amountB: BigInt(args.amountB ?? 0),
          lpMinted,
        }
      }
    } catch {
      // Ignore unrelated logs on this contract
    }
  }
  return null
}

function isUcwCanceledError(errMsg?: string): boolean {
  const lower = (errMsg || '').toLowerCase()
  return lower.includes('cancel') || lower.includes('iptal') || lower.includes('closed')
}

export async function executeCopilotLpDepositAction(
  context: CopilotActionContext,
  _sessionConfig: { isActive: boolean }
): Promise<InlineExecutionReceipt> {
  const {
    actionPayload,
    activeWallet,
    provider,
    onProgress,
    ucwHandlers,
    budgetManaged,
    onSubmission,
    startTime,
  } = context

  const data = actionPayload.data || {}
  const pool = getCopilotLpPoolById(data.poolId)
  if (!pool || !pool.isLpPool) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('deposit', 'Unknown Liquidity Pool', 'The target AMM liquidity pool could not be resolved; no transaction was sent.', startTime)
  }

  const poolAddress = pool.contractAddress as Address
  try {
    requireDeployed(poolAddress, pool.name)
  } catch (err: any) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('deposit', 'Pool Not Deployed', err?.message || 'Pool contract is not deployed on Arc Testnet.', startTime)
  }

  const lpMode: 'zap' | 'dual' = data.lpMode === 'zap' ? 'zap' : 'dual'
  const tokenA = pool.tokens[0]
  const tokenB = pool.tokens[1]
  const tokenAAddress = tokenA.address as Address
  const tokenBAddress = tokenB.address as Address
  const decA = tokenA.decimals
  const decB = tokenB.decimals

  const amountA = Number(data.amountA ?? data.amount)
  const amountB = lpMode === 'dual' ? Number(data.amountB) : 0

  if (!isPositiveTokenAmount(amountA, decA)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('deposit', 'Invalid LP Deposit Amount', `Please provide a valid positive ${tokenA.symbol} amount.`, startTime)
  }
  if (lpMode === 'dual' && !isPositiveTokenAmount(amountB, decB)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('deposit', 'Invalid Dual LP Amount', `Please provide valid positive amounts for both ${tokenA.symbol} and ${tokenB.symbol}.`, startTime)
  }
  if (lpMode === 'zap' && (!pool.supportsZap || tokenA.symbol !== 'USDC')) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('deposit', 'Zap Not Supported', `1-Click Zap is not supported for ${pool.name}. Use Dual-Asset deposit instead.`, startTime)
  }

  const amountADec = numberToExactDecimal(amountA)!
  const amountBDec = lpMode === 'dual' ? numberToExactDecimal(amountB)! : '0'
  const amountAUnits = parseUnits(amountADec, decA)
  const amountBUnits = lpMode === 'dual' ? parseUnits(amountBDec, decB) : 0n

  const slipBps =
    typeof data.slippageBps === 'number' && Number.isFinite(data.slippageBps) && data.slippageBps > 0
      ? poolSlippageBps(data.slippageBps / 100)
      : POOL_DEFAULT_SLIPPAGE_BPS

  const approvedMinLpRaw = data.minLpSharesRaw ? BigInt(String(data.minLpSharesRaw)) : 0n
  if (POOL_VERSION_V4 && approvedMinLpRaw <= 0n) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt(
      'deposit',
      'Slippage Guard Required',
      'This LP draft is missing a live minimum LP-shares guard. Please request a fresh quote before confirming.',
      startTime
    )
  }

  if (onProgress) onProgress('routing')
  const resilientClient = getResilientPublicClient('Arc_Testnet')

  // Step 1: Read live pool reserves & paused status right before execution
  let reserveA = 0n
  let reserveB = 0n
  let totalLp = 0n
  let paused = false
  try {
    const [rA, rB, tLp, p] = await Promise.all([
      resilientClient.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }) as Promise<bigint>,
      resilientClient.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }) as Promise<bigint>,
      resilientClient.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }) as Promise<bigint>,
      resilientClient.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'paused' }).catch(() => false) as Promise<boolean>,
    ])
    reserveA = rA
    reserveB = rB
    totalLp = tLp
    paused = Boolean(p)
  } catch (err) {
    log.warn('Failed to read live pool reserves before LP execution:', err)
    if (onProgress) onProgress('failed')
    return failedActionReceipt('deposit', 'Pool Reserves Unavailable', `Could not read live reserves for ${pool.name}; no transaction was sent.`, startTime)
  }

  if (paused) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('deposit', 'Pool Paused', `${pool.name} is currently paused on Arc Testnet; no transaction was sent.`, startTime)
  }
  if (lpMode === 'zap' && (reserveA <= 0n || reserveB <= 0n || totalLp <= 0n)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('deposit', 'Zap Unavailable', `${pool.name} has zero reserves; 1-Click Zap requires active pool liquidity.`, startTime)
  }

  // Helper to compute live minLpShares and enforce >= approvedMinLpRaw on Dual deposits
  const liveDualMinLp =
    lpMode === 'dual' && POOL_VERSION_V4 && totalLp > 0n
      ? poolMinLpShares(computeExpectedLpShares(pool, reserveA, reserveB, totalLp, amountAUnits, amountBUnits), slipBps)
      : 0n
  if (lpMode === 'dual' && POOL_VERSION_V4 && totalLp > 0n) {
    if (liveDualMinLp <= 0n) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('deposit', 'Slippage Guard Unavailable', 'Could not compute a safe minimum LP-shares guard from live reserves; no transaction was sent.', startTime)
    }
    if (approvedMinLpRaw > 0n && liveDualMinLp < approvedMinLpRaw) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt(
        'deposit',
        'Pool Ratio Moved',
        `Live LP output moved below your approved minimum (${formatUnits(approvedMinLpRaw, 18)} ${pool.lpTokenSymbol || 'LP'}). Request a fresh quote and retry.`,
        startTime
      )
    }
  }
  const effectiveDualMinLp = liveDualMinLp > approvedMinLpRaw ? liveDualMinLp : approvedMinLpRaw

  // Zap swap math helper
  const computeZapSwapParams = () => {
    const halfUsdc = amountAUnits / 2n
    const remainingUsdc = amountAUnits - halfUsdc
    const feeBps = getPoolFeeBps(pool.id, pool.feeTierPercent)
    const expectedCounterOut = isConstantProductPool(pool.id, pool.tags)
      ? calculateConstantProductExpectedOut(halfUsdc, reserveA, reserveB, feeBps)
      : calculateStableSwapExpectedOut(halfUsdc, reserveA, reserveB, feeBps, STABLE_SWAP_AMP)
    const minSwapOut = expectedCounterOut > 0n ? (expectedCounterOut * (10000n - BigInt(slipBps))) / 10000n : 0n
    return { halfUsdc, remainingUsdc, expectedCounterOut, minSwapOut }
  }

  const readPostSwapMinLp = async (remainingUsdc: bigint, actualCounter: bigint): Promise<bigint> => {
    const [freshA, freshB, freshTotal] = await Promise.all([
      resilientClient.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }).catch(() => reserveA) as Promise<bigint>,
      resilientClient.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }).catch(() => reserveB) as Promise<bigint>,
      resilientClient.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }).catch(() => totalLp) as Promise<bigint>,
    ])
    const expectedLp = computeExpectedLpShares(pool, freshA, freshB, freshTotal, remainingUsdc, actualCounter)
    return POOL_VERSION_V4 ? poolMinLpShares(expectedLp, slipBps) : 0n
  }

  // ── 0. AUTONOMOUS SESSION ENCLAVE EXECUTION (ZERO-POPUP, USDC ZAP ONLY) ──
  const ephemeralAccount = getEphemeralSessionAccount(activeWallet, 'copilot')
  if (ephemeralAccount && lpMode === 'zap' && tokenA.symbol === 'USDC') {
    const spendUsd = await valueTokenAmountUsd('USDC', amountA)
    const limitCheck = verifySessionLimits('deposit', spendUsd, activeWallet, 'copilot')
    if (limitCheck.allowed || budgetManaged) {
      let enclaveBalance = 0
      try {
        enclaveBalance = await fetchEnclaveUsdcBalance(ephemeralAccount.address)
      } catch (balErr) {
        log.debug('Could not fetch enclave balance:', balErr)
      }

      if (enclaveBalance >= amountA) {
        if (onProgress) onProgress('signing')
        if (onProgress) onProgress('broadcasting')
        try {
          const { halfUsdc, remainingUsdc, minSwapOut } = computeZapSwapParams()
          if (minSwapOut <= 0n) throw new Error('Pool liquidity is insufficient for Zap swap.')

          const walletClient = createWalletClient({
            account: ephemeralAccount,
            chain: arcTestnet,
            transport: http(ARC_METADATA.rpcHttpUrl),
          })

          // Approve USDC to pool
          const usdcAllowance = (await resilientClient.readContract({
            address: POOL_CONTRACTS.USDC,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [ephemeralAccount.address, poolAddress],
          })) as bigint
          if (usdcAllowance < amountAUnits) {
            const approveHash = await walletClient.sendTransaction({
              to: POOL_CONTRACTS.USDC as Hex,
              data: encodeFunctionData({
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [poolAddress, amountAUnits * 10n],
              }),
            })
            onSubmission?.({ txHash: approveHash, phase: 'approval' })
            const appRec = await resilientClient.waitForTransactionReceipt({ hash: approveHash, timeout: 20000 })
            if (appRec.status !== 'success') throw new Error('Enclave USDC approval reverted.')
          }

          // Snapshot counter token balance before swap
          const counterBefore = (await resilientClient.readContract({
            address: tokenBAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [ephemeralAccount.address],
          })) as bigint

          // Step A: Swap half USDC → counter token
          const swapCall = buildPoolSwapCall(poolAddress, POOL_CONTRACTS.USDC, tokenBAddress, halfUsdc, minSwapOut)
          const swapHash = await walletClient.sendTransaction({
            to: poolAddress as Hex,
            data: encodeFunctionData({ abi: STABLE_SWAP_ABI, ...swapCall }),
          })
          onSubmission?.({ txHash: swapHash, phase: 'spend' })
          const swapRec = await resilientClient.waitForTransactionReceipt({ hash: swapHash, timeout: 20000 })
          if (swapRec.status !== 'success') throw new Error('Enclave Zap swap reverted on-chain.')

          const counterAfter = (await resilientClient.readContract({
            address: tokenBAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [ephemeralAccount.address],
          })) as bigint
          const actualCounter = counterAfter > counterBefore ? counterAfter - counterBefore : 0n
          if (actualCounter <= 0n) throw new Error('Zap swap produced zero counter tokens.')

          // Approve counter token to pool
          const counterAllowance = (await resilientClient.readContract({
            address: tokenBAddress,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [ephemeralAccount.address, poolAddress],
          })) as bigint
          if (counterAllowance < actualCounter) {
            const appCounterHash = await walletClient.sendTransaction({
              to: tokenBAddress as Hex,
              data: encodeFunctionData({
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [poolAddress, actualCounter],
              }),
            })
            const appCRec = await resilientClient.waitForTransactionReceipt({ hash: appCounterHash, timeout: 20000 })
            if (appCRec.status !== 'success') throw new Error(`Enclave ${tokenB.symbol} approval reverted.`)
          }

          const minLp = await readPostSwapMinLp(remainingUsdc, actualCounter)
          if (POOL_VERSION_V4 && minLp <= 0n) throw new Error('Could not compute post-swap minimum LP guard.')

          // Step B: addLiquidity
          const addCall = buildPoolAddLiquidityCall(poolAddress, remainingUsdc, actualCounter, minLp)
          const addHash = await walletClient.sendTransaction({
            to: poolAddress as Hex,
            data: encodeFunctionData({ abi: STABLE_SWAP_ABI, ...addCall }),
          })
          onSubmission?.({ txHash: addHash, phase: 'spend' })
          const addReceipt = await getVerifiedArcReceipt(addHash as Hex, 'Copilot autonomous LP Zap')
          if (!addReceipt) {
            if (onProgress) onProgress('pending')
            return {
              id: `rcpt_pending_${Date.now()}`,
              actionType: 'deposit',
              title: `LP Zap Submitted — Pending (${pool.name})`,
              status: 'PENDING',
              txHash: addHash,
              fromToken: tokenA.symbol,
              amountIn: amountA,
              poolId: pool.id,
              poolName: pool.name,
              lpMode: 'zap',
              lpTokenSymbol: pool.lpTokenSymbol,
              gasUsdc: 0,
              settlementLatencyMs: Date.now() - startTime,
              timestamp: Date.now(),
            }
          }
          if (addReceipt.status !== 'success') {
            if (onProgress) onProgress('failed')
            return failedActionReceipt('deposit', 'LP Zap Reverted', 'Autonomous LP Zap liquidity addition reverted on Arc Testnet.', startTime)
          }

          const decoded = decodeLiquidityAddedFromReceipt(addReceipt, poolAddress, ephemeralAccount.address)
          const lpMintedRaw = decoded?.lpMinted ?? minLp
          const lpMintedFormatted = Number(formatUnits(lpMintedRaw, 18)).toFixed(6)
          const poolSharePct = calculatePoolShare(lpMintedRaw, totalLp + lpMintedRaw)

          // Forward minted LP tokens from the ephemeral enclave to activeWallet so the user's
          // primary wallet owns the position (required for Remove LP, Claim Fees, and portfolio reads).
          // All Arc V4 pool LP tokens inherit ERC20 and checkpoint LpFeeAccounting inside `_update`.
          let forwardedToWallet = activeWallet.toLowerCase() === ephemeralAccount.address.toLowerCase()
          if (!forwardedToWallet) {
            try {
              const enclaveLpBal = (await resilientClient.readContract({
                address: poolAddress,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [ephemeralAccount.address],
              }).catch(() => lpMintedRaw)) as bigint
              const lpToForward = enclaveLpBal > 0n ? enclaveLpBal : lpMintedRaw
              if (lpToForward > 0n) {
                const forwardHash = await walletClient.sendTransaction({
                  to: poolAddress as Hex,
                  data: encodeFunctionData({
                    abi: ERC20_ABI,
                    functionName: 'transfer',
                    args: [activeWallet as Address, lpToForward],
                  }),
                })
                const forwardRec = await resilientClient
                  .waitForTransactionReceipt({ hash: forwardHash, timeout: 20000 })
                  .catch(() => null)
                if (forwardRec?.status === 'success') {
                  forwardedToWallet = true
                } else {
                  log.warn('Enclave LP token transfer to activeWallet did not confirm as success:', {
                    forwardHash,
                    status: forwardRec?.status,
                  })
                }
              }
            } catch (fwdErr) {
              log.warn('Could not forward minted LP tokens from enclave to activeWallet:', fwdErr)
            }
          }

          const fee = await resolveArcActualFeeUsdc(addHash)
          const durationMs = Date.now() - startTime

          if (!budgetManaged) deductSessionSpend(spendUsd, activeWallet, 'copilot')
          recordClientSwapVolume(pool.id, amountA / 2)

          addTransaction({
            type: 'add_liquidity',
            txHash: addHash,
            amount: amountADec,
            tokenSymbol: tokenA.symbol,
            sourceChain: 'Arc_Testnet',
            recipient: poolAddress,
            userAddress: activeWallet,
            status: 'success',
            poolId: pool.id,
            poolName: pool.name,
            lpMinted: lpMintedFormatted,
            poolShare: poolSharePct,
          })

          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('arcis_portfolio_updated'))
            window.dispatchEvent(new CustomEvent('arcis:pool-tx-indexed'))
          }
          if (onProgress) onProgress('confirmed')

          const enclaveShort = `${ephemeralAccount.address.slice(0, 6)}...${ephemeralAccount.address.slice(-4)}`

          return {
            id: `rcpt_${Date.now()}`,
            actionType: 'deposit',
            title: `${pool.name} LP Deposit Completed`,
            subtitle: forwardedToWallet
              ? 'Executed via Session Key (Zero-Popup 1-Click Zap)'
              : `LP minted via Session Key, but transfer to your wallet did not confirm; LP shares remain at enclave ${enclaveShort}`,
            status: 'SUCCESS',
            txHash: addHash,
            fromToken: tokenA.symbol,
            toToken: pool.lpTokenSymbol || 'LP',
            amountIn: amountA,
            amountOut: Number(lpMintedFormatted),
            poolId: pool.id,
            poolName: pool.name,
            lpMode: 'zap',
            lpTokenSymbol: pool.lpTokenSymbol,
            lpMinted: lpMintedFormatted,
            poolSharePct,
            apy: `${pool.apy.toFixed(2)}% ${pool.apyType}`,
            gasUsdc: fee.feeUsdc ?? 0,
            actualGasUsdc: fee.feeUsdc,
            baseFeeUsdc: fee.baseFeeUsdcExact,
            priorityFeeUsdc: fee.priorityFeeUsdcExact,
            settlementLatencyMs: durationMs,
            timestamp: Date.now(),
          }
        } catch (enclaveErr: any) {
          log.warn('Autonomous enclave LP Zap failed, falling back to connected wallet:', enclaveErr)
        }
      }
    }
  }

  // Step 2: Verify live on-chain token balances for activeWallet
  try {
    const balA = (await resilientClient.readContract({
      address: tokenAAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [activeWallet as Address],
    })) as bigint
    if (balA < amountAUnits) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt(
        'deposit',
        `Insufficient ${tokenA.symbol} Balance`,
        `Wallet ${activeWallet.slice(0, 6)}...${activeWallet.slice(-4)} has ${Number(formatUnits(balA, decA)).toFixed(4)} ${tokenA.symbol}, but ${amountADec} ${tokenA.symbol} is required.`,
        startTime
      )
    }

    if (lpMode === 'dual') {
      const balB = (await resilientClient.readContract({
        address: tokenBAddress,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [activeWallet as Address],
      })) as bigint
      if (balB < amountBUnits) {
        if (onProgress) onProgress('failed')
        return failedActionReceipt(
          'deposit',
          `Insufficient ${tokenB.symbol} Balance`,
          `Wallet ${activeWallet.slice(0, 6)}...${activeWallet.slice(-4)} has ${Number(formatUnits(balB, decB)).toFixed(6)} ${tokenB.symbol}, but ${amountBDec} ${tokenB.symbol} is required.`,
          startTime
        )
      }
    }
  } catch (balErr) {
    log.warn('Failed to verify on-chain wallet balance before LP deposit:', balErr)
    if (onProgress) onProgress('failed')
    return failedActionReceipt('deposit', 'Balance Unavailable', 'Could not verify token balances on Arc Testnet; no transaction was sent.', startTime)
  }

  if (onProgress) onProgress('signing')
  if (onProgress) onProgress('broadcasting')

  let realTxHash = ''
  const effectiveProvider =
    provider || (typeof window !== 'undefined' && (window as any).ethereum ? (window as any).ethereum : null)

  // ── A. Circle UCW Execution (Email OTP / User-Controlled Wallet) ──
  if (ucwHandlers?.authSource === 'ucw') {
    if (!ucwHandlers.executeUcwContract) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt('deposit', 'Circle UCW Unavailable', 'Circle UCW contract challenge handler is missing; no fallback signer was used.', startTime)
    }

    const ensureUcwApproval = async (tokenAddr: Address, required: bigint, symbol: string) => {
      let currentAllowance = 0n
      try {
        currentAllowance = (await resilientClient.readContract({
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [activeWallet as Address, poolAddress],
        })) as bigint
      } catch {
        currentAllowance = 0n
      }
      if (currentAllowance >= required) return
      if (onProgress) onProgress('signing')
      const appRes = await ucwHandlers.executeUcwContract!({
        contractAddress: tokenAddr,
        abiFunctionSignature: 'approve(address,uint256)',
        abiParameters: [poolAddress, required.toString()],
        blockchain: 'ARC-TESTNET',
      })
      if (!appRes.success) {
        const err: any = new Error(appRes.error || `${symbol} allowance authorization failed.`)
        if (isUcwCanceledError(appRes.error)) err.isCanceled = true
        throw err
      }
      if (appRes.txHash && isTransactionHash(appRes.txHash)) {
        const appRec = await resilientClient.waitForTransactionReceipt({ hash: appRes.txHash as Hex, timeout: 20000 }).catch(() => null)
        if (appRec && appRec.status !== 'success') {
          throw new Error(`${symbol} allowance approval reverted on-chain.`)
        }
      }
    }

    try {
      if (lpMode === 'zap') {
        const { halfUsdc, remainingUsdc, minSwapOut } = computeZapSwapParams()
        if (minSwapOut <= 0n) throw new Error('Pool liquidity is insufficient for Zap swap.')

        await ensureUcwApproval(POOL_CONTRACTS.USDC, amountAUnits, 'USDC')

        const counterBefore = (await resilientClient.readContract({
          address: tokenBAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [activeWallet as Address],
        })) as bigint

        if (onProgress) onProgress('broadcasting')
        const swapRes = await ucwHandlers.executeUcwContract({
          contractAddress: poolAddress,
          ...buildPoolSwapUcwCall(poolAddress, POOL_CONTRACTS.USDC, tokenBAddress, halfUsdc, minSwapOut),
          blockchain: 'ARC-TESTNET',
        })
        if (!swapRes.success) {
          const err: any = new Error(swapRes.error || 'Zap swap authorization failed.')
          if (isUcwCanceledError(swapRes.error)) err.isCanceled = true
          throw err
        }
        if (swapRes.txHash && isTransactionHash(swapRes.txHash)) {
          const swapRec = await resilientClient.waitForTransactionReceipt({ hash: swapRes.txHash as Hex, timeout: 20000 }).catch(() => null)
          if (swapRec && swapRec.status !== 'success') throw new Error('Zap swap reverted on-chain.')
        }

        const counterAfter = (await resilientClient.readContract({
          address: tokenBAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [activeWallet as Address],
        })) as bigint
        const actualCounter = counterAfter > counterBefore ? counterAfter - counterBefore : 0n
        if (actualCounter <= 0n) throw new Error('Failed to receive counter token from Zap swap.')

        await ensureUcwApproval(POOL_CONTRACTS.USDC, remainingUsdc, 'USDC')
        await ensureUcwApproval(tokenBAddress, actualCounter, tokenB.symbol)

        const minLp = await readPostSwapMinLp(remainingUsdc, actualCounter)
        if (POOL_VERSION_V4 && minLp <= 0n) throw new Error('Unable to compute safe minimum LP guard after Zap swap.')

        if (onProgress) onProgress('broadcasting')
        const addRes = await ucwHandlers.executeUcwContract({
          contractAddress: poolAddress,
          ...buildPoolAddLiquidityUcwCall(poolAddress, remainingUsdc, actualCounter, minLp),
          blockchain: 'ARC-TESTNET',
        })
        if (!addRes.success) {
          const counterFmt = formatUnits(actualCounter, decB)
          const err: any = new Error(
            `Zap swap completed (${counterFmt} ${tokenB.symbol} added to wallet), but liquidity addition was not completed: ${addRes.error || 'Authorization failed'}. Your ${tokenB.symbol} is safe in your wallet.`
          )
          if (isUcwCanceledError(addRes.error)) err.isCanceled = true
          throw err
        }
        if (addRes.txHash) realTxHash = addRes.txHash
      } else {
        // Dual-Asset UCW
        await ensureUcwApproval(tokenAAddress, amountAUnits, tokenA.symbol)
        await ensureUcwApproval(tokenBAddress, amountBUnits, tokenB.symbol)

        if (onProgress) onProgress('broadcasting')
        const addRes = await ucwHandlers.executeUcwContract({
          contractAddress: poolAddress,
          ...buildPoolAddLiquidityUcwCall(poolAddress, amountAUnits, amountBUnits, effectiveDualMinLp),
          blockchain: 'ARC-TESTNET',
        })
        if (!addRes.success) {
          const err: any = new Error(addRes.error || 'Dual LP deposit authorization failed.')
          if (isUcwCanceledError(addRes.error)) err.isCanceled = true
          throw err
        }
        if (addRes.txHash) realTxHash = addRes.txHash
      }
    } catch (ucwErr: any) {
      log.warn('UCW LP deposit error:', ucwErr)
      if (onProgress) onProgress('failed')
      const cleanErr = formatCopilotError(ucwErr)
      return failedActionReceipt('deposit', cleanErr.title || 'LP Deposit Failed', cleanErr.message || ucwErr.message, startTime)
    }
  }

  // ── B. Passkey / Modular Smart Account (MSCA) Execution ──
  if (!realTxHash && isPasskeyWalletContext(context)) {
    try {
      if (lpMode === 'zap') {
        const { halfUsdc, remainingUsdc, minSwapOut } = computeZapSwapParams()
        if (minSwapOut <= 0n) throw new Error('Pool liquidity is insufficient for Zap swap.')

        const counterBefore = (await resilientClient.readContract({
          address: tokenBAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [activeWallet as Address],
        })) as bigint

        const approveUsdcCall = {
          to: POOL_CONTRACTS.USDC as Hex,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [poolAddress, amountAUnits] }),
        }
        const swapCall = {
          to: poolAddress as Hex,
          data: encodeFunctionData({
            abi: STABLE_SWAP_ABI,
            ...buildPoolSwapCall(poolAddress, POOL_CONTRACTS.USDC, tokenBAddress, halfUsdc, minSwapOut),
          }),
        }
        const swapOp = await sendModularUserOperation({ calls: [approveUsdcCall, swapCall], paymaster: true })
        onSubmission?.({ txHash: swapOp.txHash, userOpHash: swapOp.userOpHash, phase: 'spend' })
        if (!swapOp.success || !swapOp.txHash) throw new Error(swapOp.error || 'Modular Zap swap UserOp failed.')

        const swapRec = await getVerifiedArcReceipt(swapOp.txHash as Hex, 'Modular Zap swap')
        if (!swapRec || swapRec.status !== 'success') throw new Error('Modular Zap swap reverted on-chain.')

        const counterAfter = (await resilientClient.readContract({
          address: tokenBAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [activeWallet as Address],
        })) as bigint
        const actualCounter = counterAfter > counterBefore ? counterAfter - counterBefore : 0n
        if (actualCounter <= 0n) throw new Error('Failed to receive counter token from Zap swap.')

        const minLp = await readPostSwapMinLp(remainingUsdc, actualCounter)
        if (POOL_VERSION_V4 && minLp <= 0n) throw new Error('Unable to compute safe minimum LP guard after Zap swap.')

        const approveCounterCall = {
          to: tokenBAddress as Hex,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [poolAddress, actualCounter] }),
        }
        const addCall = {
          to: poolAddress as Hex,
          data: encodeFunctionData({
            abi: STABLE_SWAP_ABI,
            ...buildPoolAddLiquidityCall(poolAddress, remainingUsdc, actualCounter, minLp),
          }),
        }
        const addOp = await sendModularUserOperation({ calls: [approveCounterCall, addCall], paymaster: true })
        onSubmission?.({ txHash: addOp.txHash, userOpHash: addOp.userOpHash, phase: 'spend' })
        if (!addOp.success || !addOp.txHash) {
          const counterFmt = formatUnits(actualCounter, decB)
          throw new Error(
            `Zap swap completed (${counterFmt} ${tokenB.symbol} added to wallet), but liquidity addition failed: ${addOp.error || 'UserOp failed'}. Your ${tokenB.symbol} is safe in your wallet.`
          )
        }
        realTxHash = addOp.txHash
      } else {
        // Dual-Asset MSCA: single batched UserOp [approveA, approveB, addLiquidity]
        const approveCallA = {
          to: tokenAAddress as Hex,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [poolAddress, amountAUnits] }),
        }
        const approveCallB = {
          to: tokenBAddress as Hex,
          data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [poolAddress, amountBUnits] }),
        }
        const addCall = {
          to: poolAddress as Hex,
          data: encodeFunctionData({
            abi: STABLE_SWAP_ABI,
            ...buildPoolAddLiquidityCall(poolAddress, amountAUnits, amountBUnits, effectiveDualMinLp),
          }),
        }
        const opRes = await sendModularUserOperation({
          calls: [approveCallA, approveCallB, addCall],
          paymaster: true,
        })
        onSubmission?.({ txHash: opRes.txHash, userOpHash: opRes.userOpHash, phase: 'spend' })
        if (!opRes.success || !opRes.txHash) throw new Error(opRes.error || 'Modular dual LP UserOperation failed.')
        realTxHash = opRes.txHash
      }
    } catch (opErr: any) {
      log.warn('Modular UserOp LP deposit error:', opErr)
      if (onProgress) onProgress('failed')
      const cleanErr = formatCopilotError(opErr)
      return failedActionReceipt('deposit', cleanErr.title || 'LP Deposit Failed', cleanErr.message || opErr?.message || 'Modular LP deposit failed.', startTime)
    }
  }

  // ── C. Injected EOA Wallet Execution ──
  if (!realTxHash && ucwHandlers?.authSource !== 'ucw' && effectiveProvider) {
    try {
      const { createWalletClient: createBrowserWalletClient, custom } = await import('viem')
      const walletClient = createBrowserWalletClient({
        account: activeWallet as Hex,
        chain: arcTestnetChain,
        transport: custom(effectiveProvider),
      })

      const ensureEoaApproval = async (tokenAddr: Address, required: bigint, symbol: string) => {
        const allowance = (await resilientClient.readContract({
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [activeWallet as Address, poolAddress],
        }).catch(() => 0n)) as bigint
        if (allowance >= required) return
        const approveTx = await walletClient.writeContract({
          address: tokenAddr,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [poolAddress, required],
        })
        const approveRec = await resilientClient.waitForTransactionReceipt({ hash: approveTx, timeout: 20000 }).catch(() => null)
        if (!approveRec || approveRec.transactionHash.toLowerCase() !== approveTx.toLowerCase()) {
          throw new Error(`${symbol} token approval is still pending; liquidity was not submitted.`)
        }
        if (approveRec.status !== 'success') throw new Error(`${symbol} token approval reverted on-chain.`)
      }

      if (lpMode === 'zap') {
        const { halfUsdc, remainingUsdc, minSwapOut } = computeZapSwapParams()
        if (minSwapOut <= 0n) throw new Error('Pool liquidity is insufficient for Zap swap.')

        await ensureEoaApproval(POOL_CONTRACTS.USDC, amountAUnits, 'USDC')

        const counterBefore = (await resilientClient.readContract({
          address: tokenBAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [activeWallet as Address],
        })) as bigint

        const zapSwapCall = buildPoolSwapCall(poolAddress, POOL_CONTRACTS.USDC, tokenBAddress, halfUsdc, minSwapOut)
        const swapGas = await estimateSafeGas(
          resilientClient,
          { address: poolAddress, abi: STABLE_SWAP_ABI, ...zapSwapCall, account: activeWallet as Address },
          350_000n
        )
        const swapTx = await walletClient.writeContract({
          address: poolAddress,
          abi: STABLE_SWAP_ABI,
          ...zapSwapCall,
          gas: swapGas,
        })
        const swapRec = await resilientClient.waitForTransactionReceipt({ hash: swapTx, timeout: 20000 }).catch(() => null)
        if (!swapRec || swapRec.status !== 'success') throw new Error('Zap swap reverted or remained pending.')

        const counterAfter = (await resilientClient.readContract({
          address: tokenBAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [activeWallet as Address],
        })) as bigint
        const actualCounter = counterAfter > counterBefore ? counterAfter - counterBefore : 0n
        if (actualCounter <= 0n) throw new Error('Failed to receive counter token from Zap swap.')

        await ensureEoaApproval(POOL_CONTRACTS.USDC, remainingUsdc, 'USDC')
        await ensureEoaApproval(tokenBAddress, actualCounter, tokenB.symbol)

        const minLp = await readPostSwapMinLp(remainingUsdc, actualCounter)
        if (POOL_VERSION_V4 && minLp <= 0n) throw new Error('Unable to compute safe minimum LP guard after Zap swap.')

        try {
          const addCall = buildPoolAddLiquidityCall(poolAddress, remainingUsdc, actualCounter, minLp)
          const addGas = await estimateSafeGas(
            resilientClient,
            { address: poolAddress, abi: STABLE_SWAP_ABI, ...addCall, account: activeWallet as Address },
            450_000n
          )
          realTxHash = await walletClient.writeContract({
            address: poolAddress,
            abi: STABLE_SWAP_ABI,
            ...addCall,
            gas: addGas,
          })
        } catch (addErr: any) {
          const counterFmt = formatUnits(actualCounter, decB)
          throw new Error(
            `Zap swap completed (${counterFmt} ${tokenB.symbol} added to wallet), but liquidity addition failed: ${addErr?.shortMessage || addErr?.message || 'Transaction reverted'}. Your ${tokenB.symbol} is safe in your wallet.`
          )
        }
      } else {
        // Dual-Asset EOA
        await ensureEoaApproval(tokenAAddress, amountAUnits, tokenA.symbol)
        await ensureEoaApproval(tokenBAddress, amountBUnits, tokenB.symbol)

        const addCall = buildPoolAddLiquidityCall(poolAddress, amountAUnits, amountBUnits, effectiveDualMinLp)
        const addGas = await estimateSafeGas(
          resilientClient,
          { address: poolAddress, abi: STABLE_SWAP_ABI, ...addCall, account: activeWallet as Address },
          450_000n
        )
        realTxHash = await walletClient.writeContract({
          address: poolAddress,
          abi: STABLE_SWAP_ABI,
          ...addCall,
          gas: addGas,
        })
      }
    } catch (eoaErr: any) {
      log.warn('EOA LP deposit error:', eoaErr)
      if (onProgress) onProgress('failed')
      const cleanErr = formatCopilotError(eoaErr)
      return failedActionReceipt('deposit', cleanErr.title || 'LP Deposit Failed', cleanErr.message || eoaErr?.message || 'LP transaction failed.', startTime)
    }
  }

  if (!realTxHash) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt(
      'deposit',
      `LP Deposit Failed: ${pool.name}`,
      'Arc Testnet LP deposit could not be confirmed. Check your wallet connection or token balances.',
      startTime
    )
  }

  if (!isTransactionHash(realTxHash)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('deposit', 'LP Deposit Not Confirmed', 'No valid transaction hash was returned; refusing to report success.', startTime)
  }

  const lpReceipt = await getVerifiedArcReceipt(realTxHash as Hex, `Copilot LP deposit (${pool.name})`)
  if (!lpReceipt) {
    if (onProgress) onProgress('pending')
    return {
      id: `rcpt_pending_${Date.now()}`,
      actionType: 'deposit',
      title: `LP Deposit Submitted — Confirmation Pending`,
      status: 'PENDING',
      txHash: realTxHash,
      fromToken: tokenA.symbol,
      amountIn: amountA,
      ...(lpMode === 'dual' && { tokenB: tokenB.symbol, amountB }),
      poolId: pool.id,
      poolName: pool.name,
      lpMode,
      lpTokenSymbol: pool.lpTokenSymbol,
      gasUsdc: 0,
      settlementLatencyMs: Date.now() - startTime,
      timestamp: Date.now(),
    }
  }

  if (lpReceipt.status !== 'success') {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('deposit', 'LP Deposit Reverted', `The confirmed ${pool.name} liquidity transaction reverted; no success history or session spend was recorded.`, startTime)
  }

  const decoded = decodeLiquidityAddedFromReceipt(lpReceipt, poolAddress, activeWallet)
  if (!decoded) {
    if (onProgress) onProgress('pending')
    return {
      id: `rcpt_pending_${Date.now()}`,
      actionType: 'deposit',
      title: 'LP Receipt Verification Pending',
      status: 'PENDING',
      txHash: realTxHash,
      fromToken: tokenA.symbol,
      amountIn: amountA,
      ...(lpMode === 'dual' && { tokenB: tokenB.symbol, amountB }),
      poolId: pool.id,
      poolName: pool.name,
      lpMode,
      lpTokenSymbol: pool.lpTokenSymbol,
      gasUsdc: 0,
      settlementLatencyMs: Date.now() - startTime,
      timestamp: Date.now(),
      errorMessage: 'The confirmed receipt does not contain a matching LiquidityAdded event; no success history or session spend was recorded.',
    }
  }

  const lpMintedFormatted = Number(formatUnits(decoded.lpMinted, 18)).toFixed(6)
  const poolSharePct = calculatePoolShare(decoded.lpMinted, totalLp + decoded.lpMinted)
  const fee = await resolveArcActualFeeUsdc(realTxHash)
  const durationMs = Date.now() - startTime

  if (lpMode === 'zap') {
    recordClientSwapVolume(pool.id, amountA / 2)
  }

  addTransaction({
    type: 'add_liquidity',
    txHash: realTxHash,
    amount: amountADec,
    tokenSymbol: tokenA.symbol,
    sourceChain: 'Arc_Testnet',
    recipient: poolAddress,
    userAddress: activeWallet,
    status: 'success',
    poolId: pool.id,
    poolName: pool.name,
    lpMinted: lpMintedFormatted,
    poolShare: poolSharePct,
    ...(lpMode === 'dual' && { amountB: amountBDec, tokenB: tokenB.symbol }),
  })

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('arcis_portfolio_updated'))
    window.dispatchEvent(new CustomEvent('arcis:pool-tx-indexed'))
  }

  if (onProgress) onProgress('confirmed')

  return {
    id: `rcpt_${Date.now()}`,
    actionType: 'deposit',
    title: `${pool.name} LP Deposit Completed`,
    subtitle: lpMode === 'zap' ? '1-Click Zap Liquidity Provision' : 'Dual-Asset Liquidity Provision',
    status: 'SUCCESS',
    txHash: realTxHash,
    fromToken: tokenA.symbol,
    toToken: pool.lpTokenSymbol || 'LP',
    amountIn: amountA,
    amountOut: Number(lpMintedFormatted),
    ...(lpMode === 'dual' && { tokenB: tokenB.symbol, amountB }),
    poolId: pool.id,
    poolName: pool.name,
    lpMode,
    lpTokenSymbol: pool.lpTokenSymbol,
    lpMinted: lpMintedFormatted,
    poolSharePct,
    apy: `${pool.apy.toFixed(2)}% ${pool.apyType}`,
    gasUsdc: fee.feeUsdc ?? 0,
    actualGasUsdc: fee.feeUsdc,
    baseFeeUsdc: fee.baseFeeUsdcExact,
    priorityFeeUsdc: fee.priorityFeeUsdcExact,
    settlementLatencyMs: durationMs,
    timestamp: Date.now(),
  }
}
