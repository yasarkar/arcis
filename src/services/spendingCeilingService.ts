// src/services/spendingCeilingService.ts
// Progressive High-Water Mark Spending Ceiling Manager for Arcis
// Manages per-wallet, per-token spending ceilings.
// Once approved (e.g. $90), subsequent transactions <= $90 skip wallet approval popups.
// When an amount exceeds the ceiling (e.g. $120), a new approval is requested to elevate the ceiling.

import { useState, useEffect } from 'react'

export const SPENDING_CEILING_UPDATED_EVENT = 'arcis_spending_ceiling_updated'
const STORAGE_PREFIX = 'arcis_spending_ceiling_v1_'

export interface TokenSpendingCeiling {
  tokenSymbol: string
  ceilingAmount: number
  updatedAt: number
  lastTxHash?: string
}

export interface CeilingCheckResult {
  isWithinCeiling: boolean
  currentCeiling: number
  requestedAmount: number
  requiresApproval: boolean
  isFirstApproval: boolean
  suggestedCeiling: number
}

function getStorageKey(walletAddress: string, tokenSymbol: string): string {
  return `${STORAGE_PREFIX}${walletAddress.toLowerCase()}_${tokenSymbol.toUpperCase()}`
}

function dispatchCeilingUpdate(walletAddress: string, tokenSymbol: string, ceiling: number): void {
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent(SPENDING_CEILING_UPDATED_EVENT, {
          detail: {
            walletAddress: walletAddress.toLowerCase(),
            tokenSymbol: tokenSymbol.toUpperCase(),
            ceiling,
          },
        })
      )
    } catch {
      // ignore event error in non-browser environments
    }
  }
}

/**
 * Returns the full ceiling record for a given wallet and token.
 */
export function getSpendingCeilingRecord(
  walletAddress: string,
  tokenSymbol: string
): TokenSpendingCeiling | null {
  if (!walletAddress || !tokenSymbol) return null
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(getStorageKey(walletAddress, tokenSymbol))
      if (raw) {
        return JSON.parse(raw) as TokenSpendingCeiling
      }
    }
  } catch (err) {
    console.warn('[spendingCeilingService] Failed to read ceiling record:', err)
  }
  return null
}

/**
 * Returns the current spending ceiling for a given wallet and token.
 * Defaults to 0 if never set.
 */
export function getSpendingCeiling(walletAddress: string, tokenSymbol: string): number {
  const record = getSpendingCeilingRecord(walletAddress, tokenSymbol)
  return record ? Number(record.ceilingAmount) || 0 : 0
}

/**
 * Sets or elevates the spending ceiling for a given wallet and token.
 */
export function setSpendingCeiling(
  walletAddress: string,
  tokenSymbol: string,
  newCeiling: number,
  txHash?: string
): void {
  if (!walletAddress || !tokenSymbol) return
  const safeCeiling = Math.max(0, Number(newCeiling) || 0)
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const data: TokenSpendingCeiling = {
        tokenSymbol: tokenSymbol.toUpperCase(),
        ceilingAmount: safeCeiling,
        updatedAt: Date.now(),
        lastTxHash: txHash,
      }
      localStorage.setItem(getStorageKey(walletAddress, tokenSymbol), JSON.stringify(data))
      dispatchCeilingUpdate(walletAddress, tokenSymbol, safeCeiling)
    }
  } catch (err) {
    console.warn('[spendingCeilingService] Failed to save ceiling:', err)
  }
}

/**
 * Checks if the requested transaction amount is within the current ceiling.
 * If amount <= currentCeiling (and currentCeiling > 0), no extra approval popup is needed.
 * If amount > currentCeiling, requiresApproval is true and new suggested ceiling is amount.
 */
export function checkCeilingStatus(
  walletAddress: string,
  tokenSymbol: string,
  amount: number | string
): CeilingCheckResult {
  const numAmount = typeof amount === 'number' ? amount : parseFloat(amount || '0')
  const validAmount = isNaN(numAmount) ? 0 : numAmount
  const currentCeiling = getSpendingCeiling(walletAddress, tokenSymbol)
  const isFirstApproval = currentCeiling <= 0
  const isWithinCeiling = !isFirstApproval && validAmount <= currentCeiling

  return {
    isWithinCeiling,
    currentCeiling,
    requestedAmount: validAmount,
    requiresApproval: !isWithinCeiling,
    isFirstApproval,
    suggestedCeiling: Math.max(validAmount, currentCeiling),
  }
}

/**
 * Resets the spending ceiling to 0 (Security Revoke).
 */
export function resetSpendingCeiling(walletAddress: string, tokenSymbol: string): void {
  if (!walletAddress || !tokenSymbol) return
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem(getStorageKey(walletAddress, tokenSymbol))
      dispatchCeilingUpdate(walletAddress, tokenSymbol, 0)
    }
  } catch (err) {
    console.warn('[spendingCeilingService] Failed to reset ceiling:', err)
  }
}

/**
 * Retrieves all stored ceilings for a specific wallet address.
 */
export function getAllSpendingCeilings(walletAddress: string): Record<string, number> {
  const result: Record<string, number> = {}
  if (!walletAddress || typeof window === 'undefined' || !window.localStorage) return result

  try {
    const prefix = `${STORAGE_PREFIX}${walletAddress.toLowerCase()}_`
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) {
        const token = key.replace(prefix, '')
        const raw = localStorage.getItem(key)
        if (raw) {
          const parsed: TokenSpendingCeiling = JSON.parse(raw)
          result[token] = parsed.ceilingAmount || 0
        }
      }
    }
  } catch (err) {
    console.warn('[spendingCeilingService] Failed to get all ceilings:', err)
  }

  return result
}

export interface UseSpendingCeilingResult {
  ceiling: number
  lastApprovedTx?: string
  resetCeiling: () => void
  setCeiling: (newCeiling: number, txHash?: string) => void
}

/**
 * Reactive React hook to observe spending ceiling updates for a wallet and token.
 */
export function useSpendingCeiling(
  walletAddress: string,
  tokenSymbol: string
): UseSpendingCeilingResult {
  const [record, setRecord] = useState<TokenSpendingCeiling | null>(() =>
    getSpendingCeilingRecord(walletAddress, tokenSymbol)
  )

  useEffect(() => {
    setRecord(getSpendingCeilingRecord(walletAddress, tokenSymbol))

    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent
      if (
        customEvent.detail?.walletAddress === walletAddress?.toLowerCase() &&
        customEvent.detail?.tokenSymbol === tokenSymbol?.toUpperCase()
      ) {
        setRecord(getSpendingCeilingRecord(walletAddress, tokenSymbol))
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener(SPENDING_CEILING_UPDATED_EVENT, handleUpdate)
      return () => window.removeEventListener(SPENDING_CEILING_UPDATED_EVENT, handleUpdate)
    }
  }, [walletAddress, tokenSymbol])

  const ceiling = record?.ceilingAmount || 0
  const lastApprovedTx = record?.lastTxHash

  const resetCeiling = () => {
    resetSpendingCeiling(walletAddress, tokenSymbol)
  }

  const updateCeiling = (newCeiling: number, txHash?: string) => {
    setSpendingCeiling(walletAddress, tokenSymbol, newCeiling, txHash)
  }

  return {
    ceiling,
    lastApprovedTx,
    resetCeiling,
    setCeiling: updateCeiling,
  }
}
