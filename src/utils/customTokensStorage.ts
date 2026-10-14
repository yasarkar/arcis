/**
 * Utility for persisting and managing imported custom ERC-20 tokens per blockchain network.
 */

export const CUSTOM_TOKENS_STORAGE_KEY = 'arcis_custom_tokens'
export const MAX_STORED_CUSTOM_TOKENS_PER_CHAIN = 20

export interface StoredCustomToken {
  address: string
  symbol: string
  decimals: number
  chainKey: string
  name?: string
  addedAt: number
}

type StoredCustomTokensMap = Record<string, StoredCustomToken[]>

function getRawStore(): StoredCustomTokensMap {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  try {
    const raw = localStorage.getItem(CUSTOM_TOKENS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as StoredCustomTokensMap
    }
  } catch (err) {
    console.error('[customTokensStorage] Error reading from localStorage:', err)
  }
  return {}
}

function writeRawStore(store: StoredCustomTokensMap): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    localStorage.setItem(CUSTOM_TOKENS_STORAGE_KEY, JSON.stringify(store))
  } catch (err) {
    console.error('[customTokensStorage] Error writing to localStorage:', err)
  }
}

/**
 * Retrieves all stored custom tokens for a specific chain, or all chains if chainKey is omitted.
 */
export function getStoredCustomTokens(chainKey?: string): StoredCustomToken[] {
  const store = getRawStore()
  if (chainKey) {
    const list = store[chainKey]
    return Array.isArray(list) ? list : []
  }
  return Object.values(store).flat()
}

/**
 * Saves a new custom token for the given chain.
 * Prepends to front, prevents duplicate addresses (case-insensitive), and limits per chain.
 * Returns the updated list of stored tokens for that chain.
 */
export function saveCustomToken(token: {
  address: string
  symbol: string
  decimals: number
  chainKey: string
  name?: string
}): StoredCustomToken[] {
  const cleanAddress = token.address.trim()
  if (!cleanAddress || !cleanAddress.startsWith('0x') || cleanAddress.length !== 42) {
    return getStoredCustomTokens(token.chainKey)
  }

  const store = getRawStore()
  const chainKey = token.chainKey || 'Arc_Testnet'
  const currentList = Array.isArray(store[chainKey]) ? store[chainKey] : []

  const newEntry: StoredCustomToken = {
    address: cleanAddress,
    symbol: token.symbol.trim().toUpperCase(),
    decimals: token.decimals,
    chainKey,
    name: token.name?.trim() || token.symbol.trim().toUpperCase(),
    addedAt: Date.now(),
  }

  // Filter out existing token with same address (case-insensitive)
  const filtered = currentList.filter(
    (item) => item.address.toLowerCase() !== cleanAddress.toLowerCase()
  )

  const updated = [newEntry, ...filtered].slice(0, MAX_STORED_CUSTOM_TOKENS_PER_CHAIN)
  store[chainKey] = updated
  writeRawStore(store)

  return updated
}

/**
 * Removes a custom token by address from a specific chain's stored list.
 * Returns the updated list for that chain.
 */
export function removeCustomToken(chainKey: string, address: string): StoredCustomToken[] {
  const cleanAddress = address.trim().toLowerCase()
  const store = getRawStore()
  const currentList = Array.isArray(store[chainKey]) ? store[chainKey] : []

  const updated = currentList.filter(
    (item) => item.address.toLowerCase() !== cleanAddress
  )

  store[chainKey] = updated
  writeRawStore(store)

  return updated
}

/**
 * Clears custom tokens for a specific chain, or all stored custom tokens if chainKey is omitted.
 */
export function clearCustomTokens(chainKey?: string): void {
  if (!chainKey) {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.removeItem(CUSTOM_TOKENS_STORAGE_KEY)
      } catch (err) {
        console.error('[customTokensStorage] Error removing from localStorage:', err)
      }
    }
    return
  }

  const store = getRawStore()
  delete store[chainKey]
  writeRawStore(store)
}
