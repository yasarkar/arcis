// src/utils/address.ts
// Canonical address helpers shared by query cache keys and RPC reads.

/**
 * Canonical, case-insensitive form of a wallet address.
 *
 * Checksummed and lowercase spellings of the same address must always resolve to one cache
 * entry; otherwise a prefetch and its consumer would each fetch the same data.
 */
export function normalizeWalletAddress(address: string | null | undefined): string {
  return (address ?? '').trim().toLowerCase()
}
