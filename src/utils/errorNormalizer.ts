// src/utils/errorNormalizer.ts
// Centralized Web3 Error Normalizer Engine for Arcis Protocol (100% English)

import type { ArcisAppError, ErrorCategory } from '../types/errors'
import { ERROR_DEFINITIONS, type ErrorDefinition } from '../config/errorMessages'

/**
 * Checks whether an error was caused by the user deliberately rejecting/canceling
 * a transaction in their wallet (MetaMask, Rabby, Phantom, etc.) or canceling WebAuthn.
 */
export function isUserCanceledError(err: any): boolean {
  if (!err) return false
  if (err?.isCanceled === true) return true

  // Direct code and error name checks
  if (
    err?.code === 4001 ||
    err?.code === 'ACTION_CANCELED' ||
    err?.code === 'ACTION_REJECTED' ||
    err?.name === 'UserCanceledRequestError' ||
    err?.name === 'UserRejectedRequestError' ||
    err?.name === 'NotAllowedError' ||
    err?.cause?.code === 4001 ||
    err?.cause?.code === 'ACTION_REJECTED' ||
    err?.cause?.name === 'UserCanceledRequestError' ||
    err?.cause?.name === 'UserRejectedRequestError' ||
    err?.cause?.name === 'NotAllowedError' ||
    err?.info?.error?.code === 4001
  ) {
    return true
  }

  // Viem error tree walk
  if (typeof err?.walk === 'function') {
    const isWalkCanceled = err.walk((e: any) =>
      e?.code === 4001 ||
      e?.code === 'ACTION_CANCELED' ||
      e?.code === 'ACTION_REJECTED' ||
      e?.name === 'UserRejectedRequestError' ||
      e?.name === 'UserCanceledRequestError' ||
      e?.name === 'NotAllowedError' ||
      e?.cause?.code === 4001 ||
      e?.cause?.name === 'UserRejectedRequestError'
    )
    if (isWalkCanceled) return true
  }

  const errorString = typeof err === 'string'
    ? err
    : (err?.shortMessage || err?.message || err?.details || err?.errorMessage || err?.reason || String(err || ''))

  const lowMsg = errorString.toLowerCase()

  return (
    lowMsg.includes('user rejected') ||
    lowMsg.includes('rejected the request') ||
    lowMsg.includes('user rejected the request') ||
    lowMsg.includes('rejected transaction') ||
    lowMsg.includes('user rejected transaction') ||
    lowMsg.includes('rejected by user') ||
    lowMsg.includes('action_rejected') ||
    lowMsg.includes('userrejectedrequesterror') ||
    lowMsg.includes('user canceled') ||
    lowMsg.includes('you canceled') ||
    lowMsg.includes('canceled the confirmation') ||
    lowMsg.includes('canceled by user') ||
    lowMsg.includes('user denied') ||
    lowMsg.includes('action_canceled') ||
    lowMsg.includes('canceled the request') ||
    lowMsg.includes('user cancelled') ||
    lowMsg.includes('transaction canceled') ||
    lowMsg.includes('transaction was canceled') ||
    lowMsg.includes('transaction was cancelled') ||
    lowMsg.includes('declined') ||
    lowMsg.includes('disapproved') ||
    lowMsg.includes('cancelled by user') ||
    lowMsg.includes('signature canceled') ||
    lowMsg.includes('denied request signature') ||
    lowMsg.includes('request canceled') ||
    lowMsg.includes('notallowederror') ||
    lowMsg.includes('reddedildi') ||
    lowMsg.includes('iptal edildi')
  )
}

/**
 * Extracts the explicit revert reason string from smart contract errors or Viem calldata dumps.
 */
function extractRevertReason(err: any): string | null {
  const searchTexts = [
    err?.shortMessage,
    err?.cause?.details,
    err?.details,
    err?.cause?.shortMessage,
    err?.cause?.message,
    err?.message,
  ].filter(Boolean) as string[]

  for (const text of searchTexts) {
    const p1 = text.match(/reverted with the following reason:\s*([^\n\r]+)/i)
    if (p1 && p1[1]?.trim()) return p1[1].trim()

    const p2 = text.match(/execution reverted:\s*([^\n\r]+)/i)
    if (p2 && p2[1]?.trim()) return p2[1].trim()

    const p3 = text.match(/reason:\s*([^\n\r]+)/i)
    if (p3 && p3[1]?.trim()) return p3[1].trim()

    const p4 = text.match(/revert:\s*([^\n\r]+)/i)
    if (p4 && p4[1]?.trim()) return p4[1].trim()
  }

  return null
}

/**
 * Strips out developer noise (Viem stack traces, Request Arguments, calldata dumps)
 * from a raw error string to keep it clean and safe for UI presentation.
 */
function cleanTechnicalNoise(raw: string): string {
  let text = raw
  if (text.includes('Request Arguments:')) {
    text = text.split('Request Arguments:')[0].trim()
  }
  if (text.includes('Details:')) {
    text = text.split('Details:')[0].trim()
  }
  if (text.includes('Version: viem')) {
    text = text.split('Version: viem')[0].trim()
  }
  if (text.startsWith('Unknown blockchain error on Arc Testnet:')) {
    text = text.replace('Unknown blockchain error on Arc Testnet:', '').trim()
  }
  return text.trim()
}

/**
 * Central Normalizer: Converts ANY error into a standardized ArcisAppError object (100% English).
 */
export function normalizeAppError(err: unknown): ArcisAppError {
  if (!err) {
    const def = ERROR_DEFINITIONS.UNKNOWN_ERROR
    return {
      category: def.category,
      code: 'UNKNOWN_ERROR',
      title: def.title,
      message: def.message,
      actionHint: def.actionHint,
      isCanceled: false,
      isRetryable: def.isRetryable,
      rawMessage: '',
    }
  }

  const rawMessage = typeof err === 'string'
    ? err
    : ((err as any).shortMessage || (err as any).message || (err as any).details || (err as any).errorMessage || String(err))

  const lowMsg = rawMessage.toLowerCase()

  // 1. User Canceled in Wallet or WebAuthn
  if (isUserCanceledError(err)) {
    const def = ERROR_DEFINITIONS.USER_CANCELED
    return {
      category: def.category,
      code: 'USER_CANCELED',
      title: def.title,
      message: def.message,
      actionHint: def.actionHint,
      isCanceled: true,
      isRetryable: true,
      rawMessage,
    }
  }

  // 2. Arc L1 Base Fee / Floor Violation (underpriced transaction <20 Gwei)
  if (
    lowMsg.includes('underpriced') ||
    lowMsg.includes('max fee per gas less than block base fee') ||
    lowMsg.includes('gas price too low') ||
    lowMsg.includes('transaction underpriced')
  ) {
    const def = ERROR_DEFINITIONS.GAS_PRICE_UNDERPRICED
    return {
      category: def.category,
      code: 'GAS_PRICE_UNDERPRICED',
      title: def.title,
      message: def.message,
      actionHint: def.actionHint,
      isCanceled: false,
      isRetryable: true,
      rawMessage,
    }
  }

  // 3. Insufficient Funds / Gas on Arc Testnet (USDC is native gas)
  if (
    lowMsg.includes('insufficient funds') ||
    lowMsg.includes('insufficient_gas') ||
    lowMsg.includes('exceeds balance') ||
    lowMsg.includes('insufficient balance') ||
    lowMsg.includes('transfer amount exceeds balance')
  ) {
    const isGasRelated = lowMsg.includes('gas') || lowMsg.includes('fee') || lowMsg.includes('insufficient funds')
    const def = isGasRelated ? ERROR_DEFINITIONS.INSUFFICIENT_USDC_FOR_GAS : ERROR_DEFINITIONS.INSUFFICIENT_BALANCE
    return {
      category: def.category,
      code: isGasRelated ? 'INSUFFICIENT_USDC_FOR_GAS' : 'INSUFFICIENT_BALANCE',
      title: def.title,
      message: def.message,
      actionHint: def.actionHint,
      isCanceled: false,
      isRetryable: false,
      rawMessage,
    }
  }

  // 4. Circle AppKit Treasury / Recipient Chain Mismatch
  if (
    lowMsg.includes('recipientaddress') ||
    (lowMsg.includes('source chain') && lowMsg.includes('customfee')) ||
    lowMsg.includes('feerecipient')
  ) {
    const def = ERROR_DEFINITIONS.TREASURY_RECIPIENT_MISMATCH
    return {
      category: def.category,
      code: 'TREASURY_RECIPIENT_MISMATCH',
      title: def.title,
      message: def.message,
      actionHint: def.actionHint,
      isCanceled: false,
      isRetryable: false,
      rawMessage,
    }
  }

  // 5. Liquidity Route Not Found
  if (
    lowMsg.includes('no route') ||
    lowMsg.includes('route or resource not found') ||
    lowMsg.includes('input_amount_out_of_range') ||
    lowMsg.includes('liquidity limits') ||
    lowMsg.includes('no active swap route') ||
    lowMsg.includes('createswap failed')
  ) {
    const def = ERROR_DEFINITIONS.NO_LIQUIDITY_ROUTE
    return {
      category: def.category,
      code: 'NO_LIQUIDITY_ROUTE',
      title: def.title,
      message: def.message,
      actionHint: def.actionHint,
      isCanceled: false,
      isRetryable: false,
      rawMessage,
    }
  }

  // 6. Slippage Tolerance Exceeded
  if (lowMsg.includes('slippage') || lowMsg.includes('price impact') || lowMsg.includes('stoplimit')) {
    const def = ERROR_DEFINITIONS.SLIPPAGE_EXCEEDED
    return {
      category: def.category,
      code: 'SLIPPAGE_EXCEEDED',
      title: def.title,
      message: def.message,
      actionHint: def.actionHint,
      isCanceled: false,
      isRetryable: true,
      rawMessage,
    }
  }

  // 7. Wallet / RPC Desync (-32603)
  if (
    lowMsg.includes('internal error was received') ||
    lowMsg.includes('internalrpcerror') ||
    lowMsg.includes('-32603') ||
    (lowMsg.includes('transaction failed') && !lowMsg.includes('execution reverted:'))
  ) {
    const def = ERROR_DEFINITIONS.WALLET_RPC_DESYNC
    return {
      category: def.category,
      code: 'WALLET_RPC_DESYNC',
      title: def.title,
      message: def.message,
      actionHint: def.actionHint,
      isCanceled: false,
      isRetryable: true,
      rawMessage,
    }
  }

  // 8. Smart Contract Revert
  if (
    lowMsg.includes('execution reverted') ||
    lowMsg.includes('transaction reverted') ||
    lowMsg.includes('revert') ||
    lowMsg.includes('contractfunctionreverted')
  ) {
    const revertReason = extractRevertReason(err)
    const lowReason = revertReason ? revertReason.toLowerCase() : ''

    if (lowReason.includes('max fee must be less than amount')) {
      const def = ERROR_DEFINITIONS.CCTP_MIN_FEE_VIOLATION
      return {
        category: def.category,
        code: 'CCTP_MIN_FEE_VIOLATION',
        title: def.title,
        message: def.message,
        actionHint: def.actionHint,
        isCanceled: false,
        isRetryable: false,
        rawMessage,
      }
    }

    if (lowReason.includes('insufficient allowance') || lowReason.includes('allowance')) {
      const def = ERROR_DEFINITIONS.INSUFFICIENT_ALLOWANCE
      return {
        category: def.category,
        code: 'INSUFFICIENT_ALLOWANCE',
        title: def.title,
        message: def.message,
        actionHint: def.actionHint,
        isCanceled: false,
        isRetryable: true,
        rawMessage,
      }
    }

    const message = revertReason
      ? `Smart contract rejected the transaction: ${revertReason}`
      : ERROR_DEFINITIONS.CONTRACT_REVERT.message

    return {
      category: 'CONTRACT_REVERT',
      code: 'CONTRACT_REVERT',
      title: ERROR_DEFINITIONS.CONTRACT_REVERT.title,
      message,
      actionHint: ERROR_DEFINITIONS.CONTRACT_REVERT.actionHint,
      isCanceled: false,
      isRetryable: false,
      rawMessage,
    }
  }

  // 9. Network Timeout / Connection Drop
  if (
    lowMsg.includes('timeout') ||
    lowMsg.includes('timed out') ||
    lowMsg.includes('network') ||
    lowMsg.includes('fetch failed') ||
    lowMsg.includes('failed to fetch')
  ) {
    const def = ERROR_DEFINITIONS.NETWORK_TIMEOUT
    return {
      category: def.category,
      code: 'NETWORK_TIMEOUT',
      title: def.title,
      message: def.message,
      actionHint: def.actionHint,
      isCanceled: false,
      isRetryable: true,
      rawMessage,
    }
  }

  // 10. Passkey / WebAuthn Specifics
  if (lowMsg.includes('webauthn') || lowMsg.includes('passkey') || (err as any)?.name === 'NotAllowedError') {
    const def = ERROR_DEFINITIONS.PASSKEY_CANCELED
    return {
      category: def.category,
      code: 'PASSKEY_CANCELED',
      title: def.title,
      message: def.message,
      actionHint: def.actionHint,
      isCanceled: true,
      isRetryable: true,
      rawMessage,
    }
  }

  // 11. General Clean Fallback
  const cleaned = cleanTechnicalNoise(rawMessage)
  const fallbackMessage = cleaned && cleaned.length > 5 && cleaned.length < 240
    ? cleaned
    : ERROR_DEFINITIONS.UNKNOWN_ERROR.message

  return {
    category: 'UNKNOWN',
    code: 'UNKNOWN_ERROR',
    title: ERROR_DEFINITIONS.UNKNOWN_ERROR.title,
    message: fallbackMessage,
    actionHint: ERROR_DEFINITIONS.UNKNOWN_ERROR.actionHint,
    isCanceled: false,
    isRetryable: true,
    rawMessage,
  }
}

/**
 * Returns a human-friendly English error message for simple error strings.
 */
export function formatErrorMessage(err: unknown): string {
  const normalized = normalizeAppError(err)
  return normalized.message
}

/**
 * Convenience bridge to construct payload for BroadcastNotification drawer (100% English).
 */
export function toBroadcastErrorPayload(
  err: unknown,
  actionName: string = 'Transaction'
): {
  status: 'canceled' | 'failed'
  title: string
  badgeText: string
  message: string
  isCanceled: boolean
} {
  const normalized = normalizeAppError(err)
  const isCanceled = normalized.isCanceled

  return {
    status: isCanceled ? 'canceled' : 'failed',
    title: isCanceled ? `${actionName} Canceled` : `${actionName} Failed`,
    badgeText: isCanceled ? 'Canceled' : 'Failed',
    message: normalized.message,
    isCanceled,
  }
}
