// api/_utils/x402Settlement.ts
// Circle Gateway x402 settlement reconciliation, shared by the authorized HTTP endpoint and the
// background reconciler.
//
// The ledger may only move on an exact match between the pending authorization and Circle's
// reported transfer: nonce, token, networks, payer, provider, amount and transfer id. A mismatch
// is refused (409) and a Circle outage leaves the record pending (503). Nothing here credits a
// provider on an assumption.

import { getAddress, isAddress, type Address } from 'viem'
import { X402_NETWORKS } from '../../src/config/x402/schemes'
import {
  kvConfirmPendingProviderSettlement,
  kvFailPendingProviderSettlement,
  kvGetPendingProviderSettlement,
  kvMarkProviderSettlementAccepted,
} from './redisStorage'
import { recordPlatformCall } from './x402Stats'

export interface SettlementReconcileResult {
  status: number
  body: Record<string, unknown>
}

function safeChecksumAddress(addr: string): Address {
  try {
    return getAddress(addr.toLowerCase())
  } catch {
    return '0x0000000000000000000000000000000000000000' as Address
  }
}

function parseGatewayUsdcMicros(value: unknown): number | null {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const micros = BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6))
  return micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) : null
}

/**
 * Circle's transfer statuses that can be reconciled. `received`/`batched` are still pending;
 * `confirmed`/`completed` credit the provider; `failed` releases the pending amount.
 */
const RECONCILABLE_TRANSFER_STATUSES = ['received', 'batched', 'confirmed', 'completed', 'failed'] as const

/**
 * Reconciles one Gateway authorization by provider address and nonce.
 * Returns an HTTP status + JSON body so the endpoint and the sweep share one contract.
 */
export async function reconcileSettlementByNonce(
  rawProvider: string,
  rawNonce: string
): Promise<SettlementReconcileResult> {
  if (!isAddress(rawProvider) || !/^0x[0-9a-fA-F]{64}$/.test(rawNonce)) {
    return { status: 400, body: { success: false, error: 'Invalid provider address or authorization nonce.' } }
  }

  const providerAddress = safeChecksumAddress(rawProvider).toLowerCase()
  const nonce = rawNonce.toLowerCase()
  const providerKey = `arcis:x402:provider:{${providerAddress}}`
  const pendingKey = `arcis:x402:pending:{${providerAddress}}:${nonce}`

  let pending: Awaited<ReturnType<typeof kvGetPendingProviderSettlement>>
  try {
    pending = await kvGetPendingProviderSettlement(pendingKey)
  } catch {
    return {
      status: 503,
      body: { success: false, error: 'Shared settlement storage is unavailable; no reconciliation was attempted.' },
    }
  }
  if (!pending || pending.providerAddress !== providerAddress || pending.nonce !== nonce) {
    return { status: 404, body: { success: false, error: 'No matching Gateway settlement intent was found.' } }
  }
  if (pending.status === 'confirmed' || pending.status === 'failed') {
    return { status: 200, body: { success: true, status: pending.status, idempotent: true, pendingUsdc: 0 } }
  }

  try {
    // Testnet-only by design: this app never reconciles against the mainnet Gateway.
    const gatewayApi = 'https://gateway-api-testnet.circle.com'
    const query = new URLSearchParams({ nonce, network: X402_NETWORKS.CAIP2_ARC_TESTNET, token: 'USDC' })
    const transferResponse = await fetch(`${gatewayApi}/v1/x402/transfers?${query}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!transferResponse.ok) {
      return {
        status: 503,
        body: { success: false, error: 'Circle transfer status is temporarily unavailable; pending balance was not changed.' },
      }
    }
    const transferBody = await transferResponse.json()
    const transfers = Array.isArray(transferBody?.transfers) ? transferBody.transfers : []
    const matching = transfers.filter(
      (transfer: any) =>
        transfer &&
        typeof transfer === 'object' &&
        typeof transfer.nonce === 'string' &&
        transfer.nonce.toLowerCase() === nonce
    )
    if (matching.length !== 1) {
      return { status: 200, body: { success: true, status: 'pending', pendingUsdc: pending.amountUsdc, transferFound: false } }
    }

    const transfer = matching[0]
    if (!RECONCILABLE_TRANSFER_STATUSES.includes(transfer.status)) {
      return { status: 502, body: { success: false, error: 'Circle transfer status was not recognized; ledger was not changed.' } }
    }

    const transferAmountMicros = parseGatewayUsdcMicros(transfer.amount)
    const exactMatch =
      transfer.token === 'USDC' &&
      transfer.sendingNetwork === X402_NETWORKS.CAIP2_ARC_TESTNET &&
      transfer.recipientNetwork === X402_NETWORKS.CAIP2_ARC_TESTNET &&
      transfer.fromAddress?.toLowerCase() === pending.payerAddress &&
      // Fee-bearing calls land in the protocol treasury, so the payee is the recorded recipient
      // (older records predate escrow and named the provider directly).
      transfer.toAddress?.toLowerCase() === (pending.recipientAddress ?? pending.providerAddress) &&
      transferAmountMicros === pending.amountMicros &&
      typeof transfer.id === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transfer.id) &&
      (!pending.settlementRef ||
        pending.settlementRef === transfer.id ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pending.settlementRef))
    if (!exactMatch) {
      return {
        status: 409,
        body: { success: false, error: 'Circle returned a transfer that does not exactly match the pending authorization; no ledger credit was applied.' },
      }
    }

    if (pending.status === 'settling') {
      const accepted = await kvMarkProviderSettlementAccepted(providerKey, pendingKey, transfer.id)
      if (accepted === 'unavailable') {
        return {
          status: 503,
          body: { success: false, error: 'Circle transfer exists but durable provider accounting is unavailable; no balance was credited.' },
        }
      }
      // Recovery path: the paid call may have been accepted by Circle while the original HTTP
      // request failed before it could count itself. The claim key keeps this from double counting.
      await recordPlatformCall('accepted', {
        providerAddress: pending.providerAddress,
        nonce: pending.nonce,
        serviceId: pending.serviceId,
        amountMicros: pending.amountMicros,
      })
      pending = { ...pending, status: 'pending', settlementRef: transfer.id }
    }

    if (transfer.status === 'confirmed' || transfer.status === 'completed') {
      const result = await kvConfirmPendingProviderSettlement(
        providerKey,
        pendingKey,
        transfer.id,
        typeof transfer.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(transfer.txHash) ? transfer.txHash : undefined
      )
      if (result === 'unavailable') {
        return {
          status: 503,
          body: { success: false, error: 'Shared atomic ledger storage is unavailable; reconciliation was not confirmed.' },
        }
      }
      // Circle reported the matching transfer as confirmed/completed: this call is finally settled.
      await recordPlatformCall('settled', {
        providerAddress: pending.providerAddress,
        nonce: pending.nonce,
        serviceId: pending.serviceId,
      })
      return {
        status: 200,
        body: {
          success: true,
          status: 'confirmed',
          idempotent: result === 'already_confirmed',
          transferId: transfer.id,
          txHash:
            typeof transfer.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(transfer.txHash)
              ? transfer.txHash
              : undefined,
          pendingUsdc: 0,
        },
      }
    }

    if (transfer.status === 'failed') {
      const result = await kvFailPendingProviderSettlement(providerKey, pendingKey, transfer.id)
      if (result === 'unavailable') {
        return {
          status: 503,
          body: { success: false, error: 'Shared atomic ledger storage is unavailable; failed settlement remains pending for manual review.' },
        }
      }
      return {
        status: 200,
        body: { success: true, status: result === 'already_confirmed' ? 'confirmed' : 'failed', pendingUsdc: 0 },
      }
    }

    return {
      status: 200,
      body: { success: true, status: 'pending', circleStatus: transfer.status, pendingUsdc: pending.amountUsdc },
    }
  } catch {
    return {
      status: 503,
      body: { success: false, error: 'Circle transfer reconciliation failed; pending balance was not changed.' },
    }
  }
}
