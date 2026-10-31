// src/config/x402/payouts.ts
// Payout-address guard for x402 services.
//
// A Circle Gateway settlement sends real USDC to the manifest's `payTo` address. An address that
// is a token contract, a Gateway contract, the zero address or a documentation placeholder cannot
// be a controlled provider wallet, so a service pointing at one must not be allowed to settle.
// The list is deliberately explicit: only addresses that are provably not payable are refused.
// Everything else is reported as "unverified" by scripts/audit-x402-payouts.ts for the operator to
// confirm — this module never invents an address or silently substitutes one.

import { ARC_TESTNET_TOKENS } from '../arcChain'
import { GATEWAY_CONTRACTS } from './schemes'

export interface PayoutAudit {
  usable: boolean
  reason?: string
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Addresses that can never be a provider payout wallet, keyed by lowercase address.
 * `reason` is shown to operators and in the readiness panel, never to a payer as a payment error.
 */
const UNUSABLE_PAYOUT_ADDRESSES: Record<string, string> = {
  [ZERO_ADDRESS]: 'zero address',
  // Token contracts: an ERC-20 transfer to the token itself is accepted by the token and stuck.
  [ARC_TESTNET_TOKENS.USDC.toLowerCase()]: 'Arc Testnet USDC token contract',
  [ARC_TESTNET_TOKENS.EURC.toLowerCase()]: 'Arc Testnet EURC token contract',
  [ARC_TESTNET_TOKENS.cirBTC.toLowerCase()]: 'Arc Testnet cirBTC token contract',
  [ARC_TESTNET_TOKENS.WETH.toLowerCase()]: 'Arc Testnet WETH token contract',
  // Circle Gateway contracts hold protocol funds, not provider earnings.
  [GATEWAY_CONTRACTS.testnet.gatewayWallet.toLowerCase()]: 'Circle Gateway Wallet contract',
  [GATEWAY_CONTRACTS.testnet.gatewayMinter.toLowerCase()]: 'Circle Gateway Minter contract',
  // Sepolia USDC token contract. Present because one official manifest shipped with it as payTo.
  '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238': 'Ethereum Sepolia USDC token contract',
  // Widely used in documentation examples; no key is known to exist for it.
  '0x71c7656ec7ab88b098defb751b7401b5f6d8976f': 'documentation placeholder address',
}

/** Returns whether an address can receive a provider payout, with the reason when it cannot. */
export function auditPayoutAddress(address: string | undefined | null): PayoutAudit {
  const normalized = String(address || '').trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
    return { usable: false, reason: 'not a 20-byte hex address' }
  }
  const reason = UNUSABLE_PAYOUT_ADDRESSES[normalized]
  return reason ? { usable: false, reason } : { usable: true }
}

/** Audits a manifest's provider payout address (the same address used as `accepts[].payTo`). */
export function auditManifestPayout(manifest: { provider: { address: string } }): PayoutAudit {
  return auditPayoutAddress(manifest.provider.address)
}

/**
 * Settlement additionally requires an explicit operator confirmation that every payout address is
 * controlled. Without it, enabling Gateway settlement could send testnet USDC to a demo address.
 */
export function arePayoutAddressesConfirmed(): boolean {
  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
  const localEnv = (typeof process !== 'undefined' && process.env) || {}
  return String(localEnv.X402_PAYOUT_ADDRESSES_CONFIRMED ?? globalEnv.X402_PAYOUT_ADDRESSES_CONFIRMED ?? '').trim().toLowerCase() === 'true'
}
