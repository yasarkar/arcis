// scripts/audit-x402-payouts.ts
// Offline audit of every official x402 service payout address.
//
// Run before enabling Gateway settlement:
//   npm run audit:x402-payouts
//
// Exit 1 means at least one manifest points at an address that provably cannot receive a payout
// (zero address, token contract, Gateway contract or documentation placeholder). A "usable" row is
// not proof of ownership: confirm each address belongs to a wallet you control before setting
// X402_PAYOUT_ADDRESSES_CONFIRMED=true.

import 'dotenv/config'
import { OFFICIAL_MANIFESTS } from '../src/config/x402/manifests'
import { arePayoutAddressesConfirmed, auditManifestPayout } from '../src/config/x402/payouts'

let unusable = 0

console.log('Arcis x402 payout-address audit (offline)')
console.log('')

for (const manifest of OFFICIAL_MANIFESTS) {
  const audit = auditManifestPayout(manifest)
  if (!audit.usable) unusable += 1
  const status = audit.usable ? 'USABLE    ' : 'UNUSABLE  '
  console.log(`${status} ${manifest.id}`)
  console.log(`           payTo: ${manifest.provider.address}`)
  if (!audit.usable) console.log(`           reason: ${audit.reason}`)
}

console.log('')
console.log(`Services: ${OFFICIAL_MANIFESTS.length} · unusable payout addresses: ${unusable}`)
console.log(`X402_PAYOUT_ADDRESSES_CONFIRMED: ${arePayoutAddressesConfirmed() ? 'true' : 'false'}`)
console.log('')

if (unusable > 0) {
  console.log('Settlement is unsafe while any payout address is unusable. Fix the manifest first.')
  process.exitCode = 1
} else {
  console.log('No provably-unusable payout address found. Ownership still needs operator confirmation.')
}
