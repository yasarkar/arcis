// src/services/x402PaymentEngine.ts
// Legacy direct-transfer settlement helper, not the x402 paid-service client.
// Paid service execution is handled by paymentOrchestrator and fails closed without facilitator confirmation.

import { getAddress, type Address } from 'viem'
import type { x402Service, x402PaymentChallenge } from '../types/marketplace'
import { arcTestnet } from '../config/arcChain'
import { getStoredMscaAddress } from './modularWalletService'
import {
  providerSignerErrorMessage,
  resolveProviderSigner,
  signProviderLedgerAuthorization,
  type ProviderAuthSource,
} from './x402/providerAuthorization'
import type { UcwTypedDataChallenge } from './ucwChallengeSigner'

const PROVIDER_EARNINGS_STORAGE_KEY = 'arcis_x402_provider_earnings_v2'
const YIELD_VAULT_CONTRIBUTIONS_KEY = 'arcis_yield_vault_ai_share_v2'

export interface StoredProviderEarnings {
  [providerAddress: string]: {
    totalCallsServed: number
    totalUsdcEarned: number
    unclaimedEarningsUsdc: number
  }
}

/**
 * Retrieves accumulated provider earnings from local persistent storage
 */
export function getStoredProviderEarnings(): StoredProviderEarnings {
  try {
    const raw = localStorage.getItem(PROVIDER_EARNINGS_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) {
    console.error('Failed to parse provider earnings', e)
  }
  return {}
}

/**
 * Saves provider earnings
 */
export function saveStoredProviderEarnings(earnings: StoredProviderEarnings): void {
  try {
    localStorage.setItem(PROVIDER_EARNINGS_STORAGE_KEY, JSON.stringify(earnings))
  } catch (e) {
    console.error('Failed to save provider earnings', e)
  }
}

/**
 * Credits earnings to a provider address
 */
export function creditProviderEarnings(providerAddress: string, amountUsdc: number): void {
  const earnings = getStoredProviderEarnings()
  const lower = providerAddress.toLowerCase()
  const current = earnings[lower] || {
    totalCallsServed: 0,
    totalUsdcEarned: 0,
    unclaimedEarningsUsdc: 0,
  }

  earnings[lower] = {
    totalCallsServed: current.totalCallsServed + 1,
    totalUsdcEarned: Number((current.totalUsdcEarned + amountUsdc).toFixed(6)),
    unclaimedEarningsUsdc: Number((current.unclaimedEarningsUsdc + amountUsdc).toFixed(6)),
  }

  saveStoredProviderEarnings(earnings)
}

/**
 * Claims accumulated earnings for a provider
 */
export function claimProviderEarnings(providerAddress: string): number {
  const earnings = getStoredProviderEarnings()
  const lower = providerAddress.toLowerCase()
  const current = earnings[lower]
  if (!current || current.unclaimedEarningsUsdc <= 0) return 0

  const claimed = current.unclaimedEarningsUsdc
  earnings[lower] = {
    ...current,
    unclaimedEarningsUsdc: 0,
  }
  saveStoredProviderEarnings(earnings)
  return claimed
}

/**
 * Fetches canonical provider ledger from the server/Gateway API (ADR-005)
 * LocalStorage acts as an ephemeral UI cache only; server/Gateway is authoritative.
 */
export async function fetchCanonicalProviderLedger(providerAddress: string): Promise<any> {
  try {
    const res = await fetch(`/api/x402/provider/${providerAddress.toLowerCase()}`)
    if (res.ok) {
      const data = await res.json()
      if (data.ledger) {
        // Sync local cache for fast offline rendering.
        //
        // The provider ledger is wallet-wide and the server returns it with `services: []` on
        // purpose (per-service dimensions are not stored atomically yet). Summing those empty rows
        // used to overwrite a provider's real figures with zero, so the wallet-wide totals are read
        // directly and a response that omits them keeps whatever was already cached.
        const earnings = getStoredProviderEarnings()
        const lower = providerAddress.toLowerCase()
        const previous = earnings[lower]
        const serverCalls = Number(data.ledger.totalCallsServed)
        const serverEarned = Number(data.ledger.totalUsdcEarned)
        const serverUnclaimed = Number(data.ledger.availableUsdc)
        earnings[lower] = {
          totalCallsServed: Number.isFinite(serverCalls)
            ? serverCalls
            : (previous?.totalCallsServed ?? 0),
          totalUsdcEarned: Number.isFinite(serverEarned)
            ? serverEarned
            : (previous?.totalUsdcEarned ?? 0),
          unclaimedEarningsUsdc: Number.isFinite(serverUnclaimed)
            ? serverUnclaimed
            : (previous?.unclaimedEarningsUsdc ?? 0),
        }
        saveStoredProviderEarnings(earnings)
        return data.ledger
      }
    }
  } catch (err) {
    console.warn('[x402PaymentEngine] Canonical ledger fetch fallback to local cache:', err)
  }
  return null
}

/**
 * Non-custodial cryptographic withdrawal of provider earnings via /api/x402/withdraw (ADR-005).
 *
 * The signer is chosen by `resolveProviderSigner`, so an injected EOA and a Circle UCW EOA sign
 * the same `ProviderLedgerAuthorization`. Omitting `options` keeps the injected-provider path.
 */
export async function withdrawProviderEarningsApi(
  providerAddress: string,
  amountUsdc: number,
  signerProvider?: any,
  options?: { authSource?: ProviderAuthSource; ucwSignTypedData?: UcwTypedDataChallenge }
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const resolved = resolveProviderSigner({
      // No auth source keeps the historical injected-provider behavior for existing callers.
      authSource: options?.authSource ?? 'evm',
      walletAddress: providerAddress,
      provider: signerProvider,
      ucwSignTypedData: options?.ucwSignTypedData,
      memo: `Arcis provider withdrawal: ${amountUsdc} USDC`,
    })
    if (!resolved.ok) {
      return { success: false, error: providerSignerErrorMessage(resolved.reason) }
    }

    const { nonce, deadline, signature } = await signProviderLedgerAuthorization({
      providerAddress,
      amountUsdc,
      signTypedData: resolved.signer,
    })

    const res = await fetch('/api/x402/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerAddress,
        amountUsdc,
        signature,
        nonce,
        deadline,
      }),
    })

    const data = await res.json()
    if (res.ok && data.success) {
      // Synchronize local cache
      const earnings = getStoredProviderEarnings()
      const lower = providerAddress.toLowerCase()
      if (earnings[lower]) {
        earnings[lower].unclaimedEarningsUsdc = Math.max(
          0,
          Number((earnings[lower].unclaimedEarningsUsdc - amountUsdc).toFixed(6))
        )
        saveStoredProviderEarnings(earnings)
      }
      return { success: true, txHash: data.txHash }
    } else {
      return { success: false, error: data.error || 'Withdrawal rejected by server' }
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Provider ledger operation failed' }
  }
}

/**
 * Retrieves total protocol fees diverted to YieldVault
 */
export function getAccumulatedYieldVaultFees(): number {
  try {
    const raw = localStorage.getItem(YIELD_VAULT_CONTRIBUTIONS_KEY)
    if (raw) return parseFloat(raw) || 0
  } catch {
    // fallback
  }
  return 0
}

/**
 * Increments accumulated protocol fees sent to YieldVault
 */
export function incrementYieldVaultFees(feeUsdc: number): number {
  const current = getAccumulatedYieldVaultFees()
  const updated = Number((current + feeUsdc).toFixed(6))
  try {
    localStorage.setItem(YIELD_VAULT_CONTRIBUTIONS_KEY, updated.toString())
  } catch {
    // ignore
  }
  return updated
}

/**
 * Legacy direct-transfer routine retained for compatibility. It is not an x402 payment and
 * never credits provider earnings, protocol fees, or a canonical settlement ledger.
 */
export async function settleX402Payment(
  service: x402Service,
  payerAddress?: string,
  provider?: any
): Promise<{
  success: boolean
  error?: string
  costUsdc: number
  protocolFeeUsdc: number
  providerEarnedUsdc: number
  txHash?: string
  blockNumber?: number
  explorerUrl?: string
  challenge: x402PaymentChallenge
  authProof?: {
    signature: string
    payerAddress: string
    timestamp: number
  }
  executionMode?: 'onchain_verified' | 'session_autonomous'
  gasSponsored?: boolean
}> {
  const mscaAddress = getStoredMscaAddress()
  const activePayer = payerAddress || mscaAddress
  const price = service.pricing.priceUsdc
  const protocolFeeUsdc = 0
  const providerEarnedUsdc = 0
  void provider

  const nonce = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  const challenge: x402PaymentChallenge = {
    statusCode: 402,
    paymentRequired: true,
    token: 'USDC',
    recipient: service.provider.address,
    amountUsdc: price,
    amountUnits: (price * 1e6).toString(),
    scheme: service.accepts[0]?.scheme || 'exact',
    chainId: arcTestnet.id,
    nonce,
    validUntil: Date.now() + 60000,
  }

  // A direct ERC-20 transfer is not an x402 facilitator settlement. Refuse before signing,
  // sending any transaction, changing budget state, or creating financial history.
  return {
    success: false,
    error: activePayer
      ? 'Paid service execution is unavailable: no trusted payment settlement is configured. No authorization or charge was created.'
      : 'Connect a wallet to request a paid service; no authorization or charge was created.',
    costUsdc: 0,
    protocolFeeUsdc,
    providerEarnedUsdc,
    challenge,
  }
}
