// src/utils/history.ts
//
// Client-side Transaction History Utility for Arcis Protocol.
// All persistent records are synchronized with Vercel KV / Redis via /api/history.
// Scoped strictly per-wallet (arcis_history_cache_<address>) to guarantee privacy and isolation.

export interface HistoryItem {
  id: string
  type: 'send' | 'swap' | 'bridge' | 'deposit'
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
}

// In-memory cache partitioned by wallet address
const inMemoryWalletHistory = new Map<string, HistoryItem[]>()
let hasCleanedLegacyStorage = false

function getWalletCacheKey(address: string): string {
  return `arcis_history_cache_${address.toLowerCase().trim()}`
}

function loadWalletCache(address: string): HistoryItem[] {
  if (typeof window === 'undefined' || !address) return []
  const norm = address.toLowerCase().trim()
  if (!norm) return []

  // Check in-memory map first
  if (inMemoryWalletHistory.has(norm)) {
    return inMemoryWalletHistory.get(norm)!
  }

  try {
    const raw = localStorage.getItem(getWalletCacheKey(norm))
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        // Enforce strict address filtering even within local cache
        const filtered = parsed.filter((item: HistoryItem) => {
          const isSender = item.userAddress && item.userAddress.toLowerCase().trim() === norm
          const isRecipient = item.recipient && item.recipient.toLowerCase().trim() === norm
          return Boolean(isSender || isRecipient)
        })
        inMemoryWalletHistory.set(norm, filtered)
        return filtered
      }
    }
  } catch {}

  inMemoryWalletHistory.set(norm, [])
  return []
}

function saveWalletCache(address: string, items: HistoryItem[]) {
  if (typeof window === 'undefined' || !address) return
  const norm = address.toLowerCase().trim()
  if (!norm) return

  // Enforce address ownership
  const filtered = items.filter((item) => {
    const isSender = item.userAddress && item.userAddress.toLowerCase().trim() === norm
    const isRecipient = item.recipient && item.recipient.toLowerCase().trim() === norm
    return Boolean(isSender || isRecipient)
  }).slice(0, 150)

  inMemoryWalletHistory.set(norm, filtered)

  try {
    localStorage.setItem(getWalletCacheKey(norm), JSON.stringify(filtered))
  } catch {}
}

/**
 * One-time clean up of deprecated legacy localStorage keys if they exist
 */
function cleanLegacyLocalStorage() {
  if (hasCleanedLegacyStorage || typeof window === 'undefined') return
  try {
    localStorage.removeItem('arc_unified_history')
    localStorage.removeItem('cctp_bridge_history')
    localStorage.removeItem('arcis_history_cache') // Clean up deprecated un-partitioned cache
    hasCleanedLegacyStorage = true
  } catch {
    // Ignore storage restriction errors
  }
}

/**
 * Synchronous getter that returns current in-memory history for a specific wallet address.
 * If no address is provided, returns an empty array to prevent cross-wallet data leakage.
 */
export const getHistory = (filterAddress?: string): HistoryItem[] => {
  cleanLegacyLocalStorage()

  if (!filterAddress || !filterAddress.trim()) {
    return []
  }

  const norm = filterAddress.toLowerCase().trim()
  const cached = loadWalletCache(norm)
  return [...cached].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
}

/**
 * Asynchronously fetches transactions from the server environment (Vercel KV).
 * Scoped strictly to the provided wallet address.
 */
export const fetchHistory = async (filterAddress?: string): Promise<HistoryItem[]> => {
  cleanLegacyLocalStorage()

  if (!filterAddress || !filterAddress.trim()) {
    return []
  }

  const norm = filterAddress.toLowerCase().trim()

  try {
    const res = await fetch(`/api/history?address=${encodeURIComponent(norm)}`, {
      headers: {
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch history from server (status ${res.status})`)
    }

    const data = await res.json()
    if (data.success && Array.isArray(data.transactions)) {
      const serverItems: HistoryItem[] = data.transactions

      // Strict server items filter for the current wallet
      const validServerItems = serverItems.filter((item) => {
        const isSender = item.userAddress && item.userAddress.toLowerCase().trim() === norm
        const isRecipient = item.recipient && item.recipient.toLowerCase().trim() === norm
        return Boolean(isSender || isRecipient)
      })

      const currentLocal = loadWalletCache(norm)
      const seen = new Set<string>()
      const merged: HistoryItem[] = []

      // Server items take precedence for up-to-date status (success/failed)
      for (const item of validServerItems) {
        const key = item.txHash ? item.txHash.toLowerCase() : item.id
        if (key && !seen.has(key)) {
          seen.add(key)
          merged.push(item)
        }
      }

      // Add any local items for this wallet that haven't synced yet
      for (const item of currentLocal) {
        const key = item.txHash ? item.txHash.toLowerCase() : item.id
        if (key && !seen.has(key)) {
          seen.add(key)
          merged.push(item)
        }
      }

      const sorted = merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 300)
      saveWalletCache(norm, sorted)
      return sorted
    }
  } catch (err) {
    console.warn('[history.ts] Server fetch failed, serving local wallet cache:', err)
  }

  return getHistory(norm)
}

/**
 * Adds a new transaction record to Vercel KV server storage and updates local wallet cache.
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

  // 1. Immediately insert into in-memory store & cache for the user's wallet
  if (normUser) {
    const userItems = loadWalletCache(normUser)
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
    saveWalletCache(normUser, userItems)
  }

  // If recipient is a different wallet on the same client, update its cache too
  if (normRecipient && normRecipient !== normUser) {
    const recipItems = loadWalletCache(normRecipient)
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
    saveWalletCache(normRecipient, recipItems)
  }

  // 2. Notify active components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('arc_history_updated', { detail: { userAddress: normUser } }))
  }

  // 3. Asynchronously persist transaction to Vercel KV via API
  fetch('/api/history', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(newTx),
  }).catch((err) => {
    console.error('[history.ts] Failed to persist transaction to server:', err)
  })
}

