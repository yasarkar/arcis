// src/utils/history.ts
//
// Client-side Transaction History Utility for Arcis Protocol.
// All persistence is handled on the server via /api/history.
// LocalStorage dependencies have been completely removed.

export interface HistoryItem {
  id: string
  type: 'send' | 'swap' | 'bridge'
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

// In-memory cache for ultra-fast local state rendering
let inMemoryHistory: HistoryItem[] = []
let hasCleanedLegacyStorage = false

/**
 * One-time clean up of legacy localStorage keys if they exist in the browser
 */
function cleanLegacyLocalStorage() {
  if (hasCleanedLegacyStorage || typeof window === 'undefined') return
  try {
    localStorage.removeItem('arc_unified_history')
    localStorage.removeItem('cctp_bridge_history')
    hasCleanedLegacyStorage = true
  } catch {
    // Ignore storage restriction errors
  }
}

/**
 * Synchronous getter that returns current in-memory history.
 * Optionally filtered by connected wallet address.
 */
export const getHistory = (filterAddress?: string): HistoryItem[] => {
  cleanLegacyLocalStorage()

  if (!filterAddress) {
    return [...inMemoryHistory].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
  }

  const norm = filterAddress.toLowerCase()
  return inMemoryHistory
    .filter((item) => {
      const isSender = item.userAddress && item.userAddress.toLowerCase() === norm
      const isRecipient = item.recipient && item.recipient.toLowerCase() === norm
      return Boolean(isSender || isRecipient)
    })
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
}

/**
 * Asynchronously fetches transactions from the server environment.
 * Optionally filtered by user connected wallet address.
 */
export const fetchHistory = async (filterAddress?: string): Promise<HistoryItem[]> => {
  cleanLegacyLocalStorage()

  try {
    const query = filterAddress ? `?address=${encodeURIComponent(filterAddress)}` : ''
    const res = await fetch(`/api/history${query}`, {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch history from server (status ${res.status})`)
    }

    const data = await res.json()
    if (data.success && Array.isArray(data.transactions)) {
      const serverItems: HistoryItem[] = data.transactions

      // Merge server items into in-memory store without losing unsaved pending items
      const seen = new Set<string>()
      const merged: HistoryItem[] = []

      for (const item of [...serverItems, ...inMemoryHistory]) {
        const key = item.txHash ? item.txHash.toLowerCase() : item.id
        if (key && !seen.has(key)) {
          seen.add(key)
          merged.push(item)
        }
      }

      inMemoryHistory = merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 300)
      return getHistory(filterAddress)
    }
  } catch (err) {
    console.warn('[history.ts] Server fetch failed, serving in-memory history:', err)
  }

  return getHistory(filterAddress)
}

/**
 * Adds a new transaction record to server storage and updates local in-memory state.
 */
export const addTransaction = (item: Omit<HistoryItem, 'id' | 'timestamp'>) => {
  cleanLegacyLocalStorage()

  const newTx: HistoryItem = {
    ...item,
    id: Math.random().toString(36).substring(2, 9),
    timestamp: Date.now(),
  }

  // 1. Immediately insert into in-memory store for instant UI feedback
  const existingIndex = newTx.txHash
    ? inMemoryHistory.findIndex((x) => x.txHash && x.txHash.toLowerCase() === newTx.txHash.toLowerCase())
    : -1

  if (existingIndex >= 0) {
    inMemoryHistory[existingIndex] = { ...inMemoryHistory[existingIndex], ...newTx }
  } else {
    inMemoryHistory.unshift(newTx)
    if (inMemoryHistory.length > 300) {
      inMemoryHistory.pop()
    }
  }

  // 2. Notify active components
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('arc_history_updated'))
  }

  // 3. Asynchronously persist transaction to server
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
