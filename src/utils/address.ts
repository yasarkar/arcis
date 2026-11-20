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

/**
 * Formats a wallet address for display as `0x1234...5678` (first 6 chars, `...`, last 4 chars).
 * Consistent display format across all login methods (Google/UCW, Passkey/MSCA, EVM).
 */
export function formatDisplayAddress(address: string | null | undefined): string {
  if (!address) return ''
  const trimmed = address.trim()
  if (trimmed.length <= 10) return trimmed
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`
}

