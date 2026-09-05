// src/utils/errorUtils.ts
// Arcis Protocol Standard Error Utilities (100% English - Delegated to errorNormalizer)

import { normalizeAppError, isUserCanceledError } from './errorNormalizer'
import type { ArcisAppError, ErrorCategory } from '../types/errors'

export interface ParsedTransactionError {
  isCanceled: boolean
  category: 'rejection' | 'gas' | 'balance' | 'slippage' | 'revert' | 'timeout' | 'network' | 'unknown'
  title: string
  message: string
  rawMessage: string
  actionHint?: string
}

/**
 * Check whether an error was caused by the user rejecting/cancelling
 * the transaction in their crypto wallet (MetaMask, Rabby, Phantom, etc.) or WebAuthn.
 */
export function isUserCanceled(err: any): boolean {
  return isUserCanceledError(err)
}

/**
 * Clean and human-friendly error formatter specifically optimized for Copilot & DeFi actions.
 * 100% in English without raw Viem calldata dumps or stack traces.
 */
export function formatCopilotError(err: any): { title: string; message: string; isCanceled: boolean; actionHint?: string } {
  const normalized: ArcisAppError = normalizeAppError(err)
  return {
    title: normalized.title,
    message: normalized.message,
    isCanceled: normalized.isCanceled,
    actionHint: normalized.actionHint,
  }
}

/**
 * Parses and categorizes any Web3 / Viem / RPC error into structured English texts.
 */
export function parseTransactionError(err: any): ParsedTransactionError {
  const normalized: ArcisAppError = normalizeAppError(err)

  // Map Arcis ErrorCategory to legacy ParsedTransactionError category
  const categoryMap: Record<ErrorCategory, ParsedTransactionError['category']> = {
    WALLET_REJECTION: 'rejection',
    INSUFFICIENT_GAS: 'gas',
    INSUFFICIENT_BALANCE: 'balance',
    SLIPPAGE_EXCEEDED: 'slippage',
    NO_ROUTE: 'slippage',
    CONTRACT_REVERT: 'revert',
    PASSKEY_AUTH: 'rejection',
    RPC_NETWORK: 'network',
    WALLET_DESYNC: 'network',
    VALIDATION: 'unknown',
    SERVER_API: 'network',
    UNKNOWN: 'unknown',
  }

  return {
    isCanceled: normalized.isCanceled,
    category: categoryMap[normalized.category] || 'unknown',
    title: normalized.title,
    message: normalized.message,
    rawMessage: normalized.rawMessage || normalized.message,
    actionHint: normalized.actionHint,
  }
}

/**
 * Formats Viem / Web3 / RPC / Wallet errors into clean, user-friendly English error messages.
 */
export function formatWalletError(err: any): string {
  const normalized: ArcisAppError = normalizeAppError(err)
  return normalized.message
}
