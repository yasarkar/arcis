// src/config/x402/treasury.ts
// Settlement recipient for fee-bearing x402 services.
//
// A paid call's EIP-3009 authorization names exactly one payee, so a protocol fee cannot be
// "deducted" from a payment that already pays the provider: fee-bearing services settle to the
// protocol treasury, and the provider's net earnings become withdrawable from it.
//
// The treasury is server-side configuration. When a service charges a fee and no usable treasury is
// configured, settlement fails closed — it never quietly pays the provider the gross amount while
// the UI advertises a fee.

import { getAddress, type Address } from 'viem'
import { auditPayoutAddress } from './payouts'

/**
 * Normalizes an address the way the tollgate does. Manifest addresses are not always correctly
 * checksummed, and viem's `isAddress` rejects a mixed-case string whose checksum is wrong.
 */
function normalizeAddress(value: string | undefined | null): Address | null {
  const raw = String(value || '').trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return null
  try {
    return getAddress(raw.toLowerCase())
  } catch {
    return null
  }
}

export const X402_TREASURY_ADDRESS_ENV = 'X402_TREASURY_ADDRESS'

function readEnv(name: string): string {
  const local = typeof process !== 'undefined' && process.env ? process.env[name] : undefined
  const globalValue = (globalThis as any)?.process?.env?.[name]
  return String(local ?? globalValue ?? '').trim()
}

/**
 * The address that receives fee-bearing paid calls, or null when none is configured.
 *
 * `X402_TREASURY_ADDRESS` is the dedicated server setting; `VITE_EVM_TREASURY_ADDRESS` is accepted
 * as a fallback because it already names the protocol treasury for the rest of the app. The address
 * is audited with the same guard as provider payouts (no token/Gateway/zero addresses).
 */
export function resolveX402TreasuryAddress(): Address | null {
  const raw = readEnv(X402_TREASURY_ADDRESS_ENV) || readEnv('VITE_EVM_TREASURY_ADDRESS')
  const address = normalizeAddress(raw)
  if (!address || !auditPayoutAddress(address).usable) return null
  return address
}

export interface SettlementRoute {
  /** The address named in the 402 challenge, the EIP-3009 authorization and the Circle transfer. */
  payTo: Address
  /** Fee taken from the gross amount, in basis points. */
  feeBps: number
}

/**
 * Resolves who receives the money for one paid call.
 *
 * A zero-fee service still pays its provider directly. A fee-bearing service needs the treasury;
 * returning null makes the caller refuse settlement instead of guessing a recipient.
 */
export function resolveSettlementRoute(manifest: {
  provider: { address: string }
  pricing: { protocolFeeBps?: number }
}): SettlementRoute | null {
  const provider = normalizeAddress(manifest.provider.address)
  if (!provider) return null
  const rawBps = Number(manifest.pricing?.protocolFeeBps ?? 0)
  const feeBps = Number.isFinite(rawBps) ? Math.max(0, Math.min(10_000, Math.trunc(rawBps))) : 0

  if (feeBps === 0) return { payTo: provider, feeBps: 0 }

  const treasury = resolveX402TreasuryAddress()
  if (!treasury) return null
  return { payTo: treasury, feeBps }
}
