// src/utils/history.ts
//
// Pure Database Transaction History Utility for Arcis Protocol.
// All persistent records are stored and fetched exclusively via Vercel KV / Redis (/api/history).
// LocalStorage is completely eliminated for privacy, cross-device persistence, and strict per-wallet isolation.

export interface HistoryItem {
  id: string
  type: 'send' | 'swap' | 'bridge' | 'deposit' | 'ai_service'
  txHash: string
  amount: string
  tokenSymbol: string
  sourceChain: string
  destChain?: string
  recipient?: string
  userAddress?: string
  timestamp: number
  status: 'success' | 'pending' | 'failed'

  // Swap specific
  amountIn?: string
  amountOut?: string
  tokenIn?: string
  tokenOut?: string

  // Privacy specific
  isPrivate?: boolean

  // Arc Transaction Memo specific
  memo?: string
  memoId?: string
  memoIndex?: number

  // AI Service specific
  serviceId?: string
  serviceName?: string
  providerAddress?: string
  latencyMs?: number
}

// In-memory runtime cache partitioned by wallet address for instant UI reactivity
const inMemoryWalletHistory = new Map<string, HistoryItem[]>()
// Track in-flight promises to deduplicate simultaneous requests for the same address
const inFlightHistoryFetches = new Map<string, Promise<HistoryItem[]>>()
// Set of wallet addresses that have completed at least one successful fetch from the server
const loadedWallets = new Set<string>()
let hasCleanedLegacyStorage = false

/**
 * Checks if transactions for a wallet have been loaded into memory from the server.
 */
export const isHistoryLoaded = (filterAddress?: string): boolean => {
  if (!filterAddress || !filterAddress.trim()) return false
  const norm = filterAddress.toLowerCase().trim()
  return loadedWallets.has(norm) || inMemoryWalletHistory.has(norm)
}

/**
 * One-time clean up of deprecated legacy localStorage keys so no transaction history remains in the browser
 */
function cleanLegacyLocalStorage() {
  if (hasCleanedLegacyStorage || typeof window === 'undefined') return
  try {
    localStorage.removeItem('arc_unified_history')
    localStorage.removeItem('cctp_bridge_history')
    localStorage.removeItem('arcis_history_cache')
    // Clear any prefixed local caches if they were created
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith('arcis_history_cache')) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k))
    hasCleanedLegacyStorage = true
  } catch {
    // Ignore storage restriction errors
  }
}

/**
 * Synchronous getter that returns current in-memory history for a specific wallet address.
 * If no address is provided, returns an empty array.
 */
export const getHistory = (filterAddress?: string): HistoryItem[] => {
  cleanLegacyLocalStorage()

  if (!filterAddress || !filterAddress.trim()) {
    return []
  }

  const norm = filterAddress.toLowerCase().trim()
  const cached = inMemoryWalletHistory.get(norm) || []
  return [...cached].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
}

/**
 * Asynchronously fetches transactions directly from the Vercel KV / Redis database.
 * Scoped strictly to the provided wallet address.
 * Automatically deduplicates simultaneous in-flight requests.
 */
export const fetchHistory = async (filterAddress?: string): Promise<HistoryItem[]> => {
  cleanLegacyLocalStorage()

  if (!filterAddress || !filterAddress.trim()) {
    return []
  }

  const norm = filterAddress.toLowerCase().trim()

  // Deduplicate: If there is already an in-flight fetch for this wallet, return the existing Promise
  const existingFetch = inFlightHistoryFetches.get(norm)
  if (existingFetch) {
    return existingFetch
  }

  const fetchPromise = (async () => {
    try {
      const res = await fetch(`/api/history?address=${encodeURIComponent(norm)}`, {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!res.ok) {
        throw new Error(`Failed to fetch history from database (status ${res.status})`)
      }

      const data = await res.json()
      if (data.success && Array.isArray(data.transactions)) {
        const serverItems: HistoryItem[] = data.transactions

        // Strict address filter: records must involve this wallet address
        const validItems = serverItems
          .filter((item) => {
            const isSender = item.userAddress && item.userAddress.toLowerCase().trim() === norm
            const isRecipient = item.recipient && item.recipient.toLowerCase().trim() === norm
            return Boolean(isSender || isRecipient)
          })
          .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
          .slice(0, 300)

        inMemoryWalletHistory.set(norm, validItems)
        loadedWallets.add(norm)
        return validItems
      }
    } catch (err) {
      console.warn('[history.ts] Vercel KV database fetch failed, serving in-memory state:', err)
    } finally {
      inFlightHistoryFetches.delete(norm)
    }

    return getHistory(norm)
  })()

  inFlightHistoryFetches.set(norm, fetchPromise)
  return fetchPromise
}

/**
 * Prefetches history for a wallet address in the background without blocking the UI.
 */
export const prefetchHistory = (filterAddress?: string): Promise<HistoryItem[]> => {
  return fetchHistory(filterAddress)
}

/**
 * Adds a new transaction record to Vercel KV database via /api/history.
 * Also updates in-memory cache for immediate UI responsiveness.
 */
export const addTransaction = (item: Omit<HistoryItem, 'id' | 'timestamp'>) => {
  cleanLegacyLocalStorage()

  const normUser = item.userAddress ? item.userAddress.toLowerCase().trim() : undefined
  const normRecipient = item.recipient ? item.recipient.toLowerCase().trim() : undefined

  const newTx: HistoryItem = {
    ...item,
    userAddress: normUser,
    recipient: normRecipient,
    id: Math.random().toString(36).substring(2, 9),
    timestamp: Date.now(),
  }

  // 1. Immediately insert into in-memory runtime store for instant UI feedback
  if (normUser) {
    const userItems = inMemoryWalletHistory.get(normUser) || []
    const existingIndex = newTx.txHash
      ? userItems.findIndex((x) => x.txHash && x.txHash.toLowerCase() === newTx.txHash.toLowerCase())
      : -1

    if (existingIndex >= 0) {
      userItems[existingIndex] = { ...userItems[existingIndex], ...newTx }
    } else {
      userItems.unshift(newTx)
      if (userItems.length > 300) {
        userItems.pop()
      }
    }
    inMemoryWalletHistory.set(normUser, userItems)
  }

  // If recipient is a different wallet on the same client, update its runtime store too
  if (normRecipient && normRecipient !== normUser) {
    const recipItems = inMemoryWalletHistory.get(normRecipient) || []
    const existingIndex = newTx.txHash
      ? recipItems.findIndex((x) => x.txHash && x.txHash.toLowerCase() === newTx.txHash.toLowerCase())
      : -1

    if (existingIndex >= 0) {
      recipItems[existingIndex] = { ...recipItems[existingIndex], ...newTx }
    } else {
      recipItems.unshift(newTx)
      if (recipItems.length > 300) {
        recipItems.pop()
      }
    }
    inMemoryWalletHistory.set(normRecipient, recipItems)
    loadedWallets.add(normRecipient)
  }

  if (normUser) {
    loadedWallets.add(normUser)
  }

  // 2. Notify active components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('arc_history_updated', { detail: { userAddress: normUser } }))
  }

  // 3. Persist transaction directly to Vercel KV database via API
  fetch('/api/history', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(newTx),
  }).catch((err) => {
    console.error('[history.ts] Failed to persist transaction to Vercel KV database:', err)
  })
}


