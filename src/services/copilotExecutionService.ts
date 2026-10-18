// Direct on-chain Copilot execution via connected wallets or Circle UCW challenges.
// Client-side session metadata does not authorize transaction signing.
import { type Hex, parseUnits, decodeEventLog } from 'viem'
import {
  COPILOT_SEND_DECIMALS,
} from '../config/copilotTokens'
import { ARC_TOKENS, IS_TESTNET } from '../config/arcChain'
import { numberToExactDecimal } from '../utils/copilotAmount'
import type { CopilotActionPayload } from '../types/marketplace'
import type { InlineExecutionReceipt, ExecutionProgressState } from '../types/sessionKey'
import {
  getSessionKeyConfig,
} from './sessionKeyService'
import { logger } from '../utils/logger'
import {
  admitSessionSpend,
  claimSessionSpend,
  updateSessionSpend,
  readSessionSpendLedger,
  outstandingSpendMicros,
  spendMicros,
} from './sessionSpendLedger'
import { pollCctpDestinationTx } from './bridgeUcwService'
import { getStoredMscaAddress } from './modularWalletService'
import {
  POOL_CONTRACTS,
  YIELD_VAULT_ABI,
} from '../config/poolsConfig'
import { resolveCanonicalChainKey } from '../config/chainMeta'
import { isUserCanceled } from '../utils/errorUtils'

import {
  type CopilotUcwHandlers,
  type CopilotActionContext,
  valueTokenAmountUsd,
  isTransactionHash,
  resolveCopilotToken,
  getVerifiedArcReceipt,
  verifyArcTokenTransferReceipt,
  failedActionReceipt,
  budgetActionType,
} from './copilot/copilotCommon'
import { verifyArcSwapReceipt } from './copilot/copilotReceiptVerifier'
import { executeCopilotSwapAction } from './copilot/copilotSwapAction'
import { executeCopilotDepositAction } from './copilot/copilotDepositAction'
import { executeCopilotBridgeAction } from './copilot/copilotBridgeAction'
import { executeCopilotSendAction } from './copilot/copilotSendAction'

// Re-exports for backward compatibility
export type { CopilotUcwHandlers }
export { verifyArcSwapReceipt }

/** Scoped logger: expected non-matching receipt logs are recorded so a real decode failure is visible. */
const log = logger.createScope('copilotExecutionService')

/** Read-only evidence reconciliation; never re-enters a signer, even after reload. */
export async function reconcileCopilotReservation(wallet: string, id: string): Promise<InlineExecutionReceipt | undefined> {
  const record = readSessionSpendLedger(wallet).reservations[id]
  if (!record || ['committed', 'released'].includes(record.state)) return record?.receipt
  const hash = record.txHash
  if (!isTransactionHash(hash)) return record.receipt
  const data = record.action.data || {}
  let confirmed = false
  let reverted = false
  let destinationHash: string | undefined
  if (record.actionType === 'bridge' && record.phase !== 'approval') {
    const result = await pollCctpDestinationTx({ sourceChain: resolveCanonicalChainKey(data.fromChain || 'Arc_Testnet'), destChain: resolveCanonicalChainKey(data.toChain || 'Ethereum_Sepolia'), burnTxHash: hash, recipientAddress: String(data.recipient || wallet), amount: numberToExactDecimal(Number(data.amount))!, maxAttempts: 1, intervalMs: 0 })
    confirmed = result.status === 'confirmed' && isTransactionHash(result.destTxHash)
    destinationHash = result.destTxHash
  } else {
    const chainReceipt = await getVerifiedArcReceipt(hash, 'Session budget reconciliation')
    if (!chainReceipt) return record.receipt
    reverted = chainReceipt.status === 'reverted'
    if (chainReceipt.status === 'success' && record.phase !== 'approval') {
      if (record.actionType === 'send') {
        const token = resolveCopilotToken(data.tokenSymbol || data.token, 'USDC')
        if (token) confirmed = verifyArcTokenTransferReceipt(chainReceipt, ARC_TOKENS[token as keyof typeof ARC_TOKENS], String(data.recipient || data.recipientAddress), Number(data.amount), COPILOT_SEND_DECIMALS[token], wallet)
      } else if (record.actionType === 'swap') {
        confirmed = (await verifyArcSwapReceipt(hash, wallet, String(data.fromToken), String(data.toToken), Number(data.amount))).status === 'success'
      } else if (record.actionType === 'deposit') {
        confirmed = chainReceipt.logs.some((logItem: any) => {
          if (logItem.address.toLowerCase() !== POOL_CONTRACTS.YIELD_VAULT.toLowerCase()) return false
          try {
            const event = decodeEventLog({ abi: YIELD_VAULT_ABI, data: logItem.data, topics: logItem.topics })
            const args = event.args as any
            return event.eventName === 'Deposit' && String(args.owner).toLowerCase() === wallet.toLowerCase() && BigInt(args.assets) === parseUnits(numberToExactDecimal(Number(data.amount))!, 6) && BigInt(args.shares) > 0n
          } catch (err) {
            // Expected for every log that is not this vault's Deposit event; logged so that a genuine
            // ABI mismatch shows up as "no log decoded" instead of a silent non-confirmation.
            log.debug('Receipt log did not decode as a YieldVault deposit event; continuing with the remaining logs.', err)
            return false
          }
        })
      }
    }
  }
  // A confirmed approval alone is not proof that the following spend was never submitted.
  if (!confirmed && !reverted) return record.receipt
  const receipt: InlineExecutionReceipt = { ...record.receipt, id: record.receipt?.id || `rcpt_${id}`, actionType: record.actionType, status: confirmed ? 'SUCCESS' : 'FAILED', title: confirmed ? 'Transaction Evidence Confirmed' : 'Transaction Reverted', txHash: destinationHash || hash, reservationId: id, reservationWallet: wallet, gasUsdc: record.receipt?.gasUsdc || 0, timestamp: Date.now(), settlementLatencyMs: 0 }
  const settled = await updateSessionSpend(wallet, id, { state: confirmed ? 'committed' : 'released', receipt })
  return settled.receipt
}

/** Every hook/card/auto-execute caller passes through this gate before any signer. */
export async function executeDirectCopilotAction(
  actionPayload: CopilotActionPayload,
  walletAddress?: string,
  provider?: any,
  onProgress?: (state: ExecutionProgressState) => void,
  ucwHandlers?: CopilotUcwHandlers
): Promise<InlineExecutionReceipt> {
  const wallet = walletAddress || getStoredMscaAddress()
  const actionType = budgetActionType(actionPayload)
  if (!wallet || !actionType || !IS_TESTNET) return executeCopilotActionUnreserved(actionPayload, walletAddress, provider, onProgress, ucwHandlers)
  const started = Date.now()
  let id: string | undefined
  let claimed = false
  let signerEntered = false
  let phase: 'approval' | 'spend' | undefined
  const persistSubmission = async (hash?: string) => {
    if (id && (hash || userOpHash)) await updateSessionSpend(wallet, id, { state: 'pending', txHash: hash, userOpHash, phase })
  }
  let txHash: string | undefined
  let userOpHash: string | undefined
  const observedUcw: CopilotUcwHandlers | undefined = ucwHandlers && {
    ...ucwHandlers,
    executeUcwTransfer: ucwHandlers.executeUcwTransfer && (async params => {
      phase = 'spend'; signerEntered = true
      const result = await ucwHandlers.executeUcwTransfer!(params)
      if (isTransactionHash(result.txHash)) txHash = result.txHash
      await persistSubmission(txHash)
      return result
    }),
    executeUcwContract: ucwHandlers.executeUcwContract && (async params => {
      phase = params.abiFunctionSignature?.startsWith('approve') ? 'approval' : 'spend'; signerEntered = true
      const result = await ucwHandlers.executeUcwContract!(params)
      if (isTransactionHash(result.txHash)) txHash = result.txHash
      await persistSubmission(txHash)
      return result
    }),
  }
  try {
    const config = getSessionKeyConfig(wallet)
    if (!config.isActive) {
      // A revoke/reset does not make previously submitted principal disappear.
      if (config.reservedUsdc === Infinity || (typeof localStorage !== 'undefined' && outstandingSpendMicros(readSessionSpendLedger(wallet)) > 0)) throw new Error('Unresolved wallet budget reservations require reconciliation before another transaction.')
      return executeCopilotActionUnreserved(actionPayload, walletAddress, provider, onProgress, ucwHandlers)
    }
    const data = actionPayload.data || {}
    const token = actionType === 'swap' ? String(data.fromToken || 'USDC') : actionType === 'send' ? String(data.tokenSymbol || data.token || 'USDC') : 'USDC'
    const amount = Number(data.amount)
    const usd = actionType === 'send' || actionType === 'swap' ? await valueTokenAmountUsd(token, amount) : amount
    const fingerprint = JSON.stringify([actionType, token, data.toToken, data.amount, data.recipient || data.recipientAddress, data.fromChain, data.toChain, data.memo, data.slippageBps, data.minReceived])
    id = `${actionPayload.draftId || fingerprint}:${actionPayload.revision || 1}`
    const prior = await admitSessionSpend(wallet, () => getSessionKeyConfig(wallet), { id, actionType, amountMicros: spendMicros(usd), fingerprint, action: actionPayload })
    const pendingReceipt = (): InlineExecutionReceipt => ({ id: `rcpt_reservation_${id}`, actionType, title: 'Transaction Reserved — Reconciliation Required', status: 'PENDING', txHash: prior.txHash || '', userOpHash: prior.userOpHash, reservationId: id, reservationWallet: wallet, gasUsdc: 0, timestamp: Date.now(), settlementLatencyMs: Date.now() - started, errorMessage: 'This intent already holds budget; no second signer was called.' })
    if (prior.state === 'committed' || prior.state === 'released') return prior.receipt || failedActionReceipt(actionType, 'Intent Already Settled', 'Prepare a new draft to authorize a new transaction.', started)
    if (!await claimSessionSpend(wallet, id)) return await reconcileCopilotReservation(wallet, id) || prior.receipt || pendingReceipt()
    claimed = true
    const actualProvider = provider || (typeof window !== 'undefined' ? (window as any).ethereum : undefined)
    const observedProvider = actualProvider && { request: async (params: any) => {
      if (['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_signTransaction'].includes(params.method)) { signerEntered = true; phase = 'spend' }
      const result = await actualProvider.request(params)
      if (params.method === 'eth_sendTransaction' && isTransactionHash(result)) { txHash = result; await persistSubmission(txHash) }
      return result
    } }
    const receipt = await executeCopilotActionUnreserved(actionPayload, wallet, observedProvider,
      state => { if (state === 'broadcasting') signerEntered = true; onProgress?.(state) }, observedUcw, true,
      evidence => { signerEntered = true; phase = evidence.phase; txHash = evidence.txHash || txHash; userOpHash = evidence.userOpHash || userOpHash })
    let result: InlineExecutionReceipt = { ...receipt, reservationId: id, reservationWallet: wallet }
    const canceled = !txHash && !userOpHash && (isUserCanceled({ message: result.errorMessage || '' }) || result.status === 'CANCELED')
    const reverted = /confirmed.*reverted|swap reverted on arc|confirmed.*receipt.*revert/i.test(result.errorMessage || '')
    const safePreflight = !signerEntered || (phase === 'approval' && /no swap|not submitted|no transaction|approved minimum/i.test(result.errorMessage || ''))
    if ((result.status === 'FAILED' || result.status === 'CANCELED') && !canceled && !reverted && !safePreflight) {
      result = { ...result, status: 'PENDING', title: 'Transaction Outcome Unknown — Budget Reserved', txHash: result.txHash || txHash || '', userOpHash, errorMessage: result.errorMessage || 'Signer outcome requires reconciliation; retry will not submit again.' }
    }
    await updateSessionSpend(wallet, id, { state: result.status === 'SUCCESS' ? 'committed' : result.status === 'PENDING' ? 'pending' : 'released', receipt: result, txHash: result.txHash || txHash, userOpHash: result.userOpHash || userOpHash, phase })
    return result
  } catch (error) {
    const failed = failedActionReceipt(actionType, 'Session Budget Blocked', (error as Error).message, started)
    if (!id || !claimed) return failed
    const result: InlineExecutionReceipt = { ...failed, status: signerEntered && (!isUserCanceled(error) || Boolean(txHash || userOpHash)) ? 'PENDING' : 'FAILED', txHash: txHash || '', userOpHash, reservationId: id, reservationWallet: wallet }
    try {
      await updateSessionSpend(wallet, id, { state: result.status === 'PENDING' ? 'pending' : 'released', receipt: result, txHash, userOpHash, phase })
    } catch {
      // The pre-signing durable record remains held; never report a release that was not persisted.
      return { ...result, status: 'PENDING', title: 'Budget Journal Unavailable — Reservation Retained' }
    }
    return result
  }
}

/** Internal dispatcher; the exported gate owns all active-session accounting. */
async function executeCopilotActionUnreserved(
  actionPayload: CopilotActionPayload,
  walletAddress?: string,
  provider?: any,
  onProgress?: (state: ExecutionProgressState) => void,
  ucwHandlers?: CopilotUcwHandlers,
  budgetManaged = false,
  onSubmission?: (evidence: { txHash?: string; userOpHash?: string; phase: 'approval' | 'spend' }) => void
): Promise<InlineExecutionReceipt> {
  const startTime = Date.now()
  const actType = actionPayload.type
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

  const context: CopilotActionContext = {
    actionPayload,
    activeWallet,
    activeMsca,
    provider,
    onProgress,
    ucwHandlers,
    budgetManaged,
    onSubmission,
    startTime,
  }

  // 1. REAL ON-CHAIN SWAP EXECUTION (Arc Testnet DEX Router)
  if (actType === 'interactive_swap' || actType === 'trade') {
    return executeCopilotSwapAction(context, sessionConfig)
  }

  // 2. YIELD VAULT DEPOSIT EXECUTION
  if (actType === 'interactive_deposit' || actType === 'view_pool') {
    return executeCopilotDepositAction(context, sessionConfig)
  }

  // 3. REAL ON-CHAIN BRIDGE EXECUTION (Circle CCTP via AppKit)
  if (actType === 'interactive_bridge' || actType === 'bridge') {
    return executeCopilotBridgeAction(context, sessionConfig)
  }

  // 4. REAL ON-CHAIN TOKEN SEND / BATCH TRANSFER EXECUTION
  if (actType === 'interactive_send' || actType === 'send' || actType === 'interactive_batch_send') {
    return executeCopilotSendAction(context, sessionConfig)
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
