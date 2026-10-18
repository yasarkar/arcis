import { type Hex, parseUnits, encodeFunctionData, decodeEventLog } from 'viem'
import {
  POOL_CONTRACTS,
  ERC20_ABI,
  YIELD_VAULT_ABI,
  POOL_VERSION_V4,
  POOL_DEFAULT_SLIPPAGE_BPS,
  poolMinOut,
} from '../../config/poolsConfig'
import { numberToExactDecimal } from '../../utils/copilotAmount'
import { resolveArcActualFeeUsdc } from '../arcGasService'
import { getResilientPublicClient } from '../rpc'
import type { InlineExecutionReceipt } from '../../types/sessionKey'
import {
  verifySessionLimits,
  deductSessionSpend,
} from '../sessionKeyService'
import {
  sendModularUserOperation,
  arcTestnetChain,
} from '../modularWalletService'
import { addTransaction } from '../../utils/history'
import { formatCopilotError } from '../../utils/errorUtils'
import {
  type CopilotActionContext,
  failedActionReceipt,
  isPositiveTokenAmount,
  isTransactionHash,
  getVerifiedArcReceipt,
} from './copilotCommon'

export async function executeCopilotDepositAction(
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
  const apy = typeof data.apy === 'string' ? data.apy : undefined
  if (!isPositiveTokenAmount(amount, 6)) {
    if (onProgress) onProgress('failed')
    return failedActionReceipt('deposit', 'Invalid Deposit Amount', 'Deposit amount must be greater than zero.', startTime)
  }

  // Limit check
  const limitCheck = verifySessionLimits('deposit', amount, activeWallet)
  if (!budgetManaged && !limitCheck.allowed && sessionConfig.isActive) {
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
  const reqWei = parseUnits(numberToExactDecimal(amount)!, 6)

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

  const amountUnits = parseUnits(numberToExactDecimal(amount)!, 6)

  // H4: on V4 the vault deposit carries a min-shares guard so a share-price manipulation
  // between quote and execution reverts instead of silently minting fewer shares.
  let guardedDepositArgs: readonly [bigint, Hex, bigint] | null = null
  if (POOL_VERSION_V4) {
    try {
      const expectedShares = (await resilientClient.readContract({
        address: POOL_CONTRACTS.YIELD_VAULT,
        abi: YIELD_VAULT_ABI,
        functionName: 'previewDeposit',
        args: [amountUnits],
      })) as bigint
      if (expectedShares > 0n) {
        guardedDepositArgs = [amountUnits, activeWallet as Hex, poolMinOut(expectedShares, POOL_DEFAULT_SLIPPAGE_BPS)]
      }
    } catch (previewErr) {
      console.warn('[copilotExecutionService] vault previewDeposit failed:', previewErr)
    }
    if (!guardedDepositArgs) {
      if (onProgress) onProgress('failed')
      return failedActionReceipt(
        'deposit',
        'Deposit Guard Unavailable',
        'Unable to compute a safe minimum-shares guard for the vault deposit; no transaction was sent.',
        startTime
      )
    }
  }

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
        abiFunctionSignature: guardedDepositArgs
          ? 'depositWithMinShares(uint256,address,uint256)'
          : 'deposit(uint256,address)',
        abiParameters: guardedDepositArgs
          ? [amountUnits.toString(), activeWallet, guardedDepositArgs[2].toString()]
          : [amountUnits.toString(), activeWallet],
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
        data: guardedDepositArgs
          ? encodeFunctionData({
              abi: YIELD_VAULT_ABI,
              functionName: 'depositWithMinShares',
              args: guardedDepositArgs,
            })
          : encodeFunctionData({
              abi: YIELD_VAULT_ABI,
              functionName: 'deposit',
              args: [amountUnits, activeWallet as Hex],
            }),
      }
      const opRes = await sendModularUserOperation({
        calls: [approveCall, depositCall],
        paymaster: true,
      })
      onSubmission?.({ txHash: opRes.txHash, userOpHash: opRes.userOpHash, phase: 'spend' })
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

      realTxHash = guardedDepositArgs
        ? await walletClient.writeContract({
            address: POOL_CONTRACTS.YIELD_VAULT,
            abi: YIELD_VAULT_ABI,
            functionName: 'depositWithMinShares',
            args: guardedDepositArgs,
          })
        : await walletClient.writeContract({
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
  const expectedDepositAssets = parseUnits(numberToExactDecimal(amount)!, 6)
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
  if (!budgetManaged) deductSessionSpend(amount, activeWallet)

  addTransaction({
    type: 'send',
    txHash: realTxHash,
    amount: numberToExactDecimal(amount)!,
    tokenSymbol: 'USDC',
    sourceChain: 'Arc_Testnet',
    recipient: POOL_CONTRACTS.YIELD_VAULT, // Real-Yield Vault
    userAddress: activeWallet,
    status: 'success',
  })

  // Phase 0: vault deposits are not trading volume.

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
