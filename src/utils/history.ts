// src/utils/history.ts
//
// Pure Database Transaction History Utility for Arcis Protocol.
// All persistent records are stored and fetched exclusively via Vercel KV / Redis (/api/history).
// LocalStorage is completely eliminated for privacy, cross-device persistence, and strict per-wallet isolation.

export interface HistoryItem {
  id: string
  type:
    | 'send'
    | 'swap'
    | 'bridge'
    | 'deposit'
    | 'ai_service'
    | 'add_liquidity'
    | 'remove_liquidity'
    | 'harvest'
  txHash: string
  /**
   * Bridge only: destination (mint) transaction hash. Rows created before the
   * destination is confirmed keep `txHash` as the SOURCE (burn) hash and fill
   * this in when the mint resolves, so one bridge is one row — never two.
   */
  destTxHash?: string
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

  // Pool / AMM specific
  poolId?: string
  poolName?: string
  lpMinted?: string
  poolShare?: number
  amountB?: string
  tokenB?: string
}

export const ARCIS_HISTORY_UPDATED_EVENT = 'arcis_history_updated'
export const LEGACY_ARC_HISTORY_UPDATED_EVENT = 'arc_history_updated'

/**
 * Dispatches history update notifications to active browser listeners.
 * Emits both canonical 'arcis_history_updated' and legacy 'arc_history_updated'
 * to guarantee complete backwards compatibility and reactive UI updates.
 */
export const notifyHistoryUpdated = (userAddress?: string) => {
  if (typeof window === 'undefined') return
  const detail = { userAddress }
  window.dispatchEvent(new CustomEvent(ARCIS_HISTORY_UPDATED_EVENT, { detail }))
  window.dispatchEvent(new CustomEvent(LEGACY_ARC_HISTORY_UPDATED_EVENT, { detail }))
}

// In-memory runtime cache partitioned by wallet address for instant UI reactivity
const inMemoryWalletHistory = new Map<string, HistoryItem[]>()
// Track in-flight promises to deduplicate simultaneous requests for the same address
const inFlightHistoryFetches = new Map<string, Promise<HistoryFetchResult>>()
// Set of wallet addresses that have completed at least one successful fetch from the server
const loadedWallets = new Set<string>()
let hasCleanedLegacyStorage = false

/**
 * Server page size for `/api/history`. The per-user KV list is capped at 300 rows
 * today, so one page normally covers a wallet; the cursor loop keeps a single
 * fetch complete if that cap ever grows.
 */
const HISTORY_PAGE_LIMIT = 300
/** Safety stop: at most 5 pages (1500 rows) per wallet fetch. */
const HISTORY_MAX_PAGES = 5
/** In-memory cap per wallet after merging every page. */
const HISTORY_MAX_ITEMS = 1000

export interface HistoryFetchResult {
  /** Merged rows, newest first. On failure this is the last cached list, not an empty verdict. */
  items: HistoryItem[]
  /** False when the server could not be read (the cache was served instead). */
  ok: boolean
  error?: string
}

/**
 * Merges fetched pages into one newest-first list. The same row can arrive twice
 * when a page boundary shifts between requests, so rows are keyed by transaction
 * hash (falling back to id) and the newest copy wins.
 */
function mergeHistoryPages(pages: HistoryItem[][]): HistoryItem[] {
  const byKey = new Map<string, HistoryItem>()

  for (const page of pages) {
    for (const item of page) {
      const key = (item.txHash || item.id || '').toLowerCase()
      if (!key) continue
      const existing = byKey.get(key)
      if (!existing || (item.timestamp || 0) >= (existing.timestamp || 0)) {
        byKey.set(key, item)
      }
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, HISTORY_MAX_ITEMS)
}

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
 *
 * Reads every page: the server pages by `cursor` and each page is capped, so a
 * single request used to stop at the server default (100 rows) and silently drop
 * every older transaction. Pages are merged, de-duplicated by tx hash and sorted
 * newest-first before they replace the in-memory cache.
 *
 * Statuses are kept verbatim — `pending` is never rewritten as `success` here.
 * The History tab renders settled rows only, but every other reader of this
 * module must be able to tell an unsettled transaction from a final one.
 */
export async function fetchHistoryResult(filterAddress?: string): Promise<HistoryFetchResult> {
  cleanLegacyLocalStorage()

  if (!filterAddress || !filterAddress.trim()) {
    return { items: [], ok: false, error: 'No wallet address provided.' }
  }

  const norm = filterAddress.toLowerCase().trim()

  // Deduplicate: If there is already an in-flight fetch for this wallet, return the existing Promise
  const existingFetch = inFlightHistoryFetches.get(norm)
  if (existingFetch) {
    return existingFetch
  }

  const fetchPromise = (async (): Promise<HistoryFetchResult> => {
    try {
      const pages: HistoryItem[][] = []
      let cursor: number | undefined

      for (let page = 0; page < HISTORY_MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
          address: norm,
          limit: String(HISTORY_PAGE_LIMIT),
        })
        if (cursor !== undefined) params.set('cursor', String(cursor))

        const res = await fetch(`/api/history?${params.toString()}`, {
          headers: {
            Accept: 'application/json',
          },
        })

        if (!res.ok) {
          throw new Error(`Failed to fetch history from database (status ${res.status})`)
        }

        const data = await res.json()
        if (!data?.success || !Array.isArray(data.transactions)) {
          throw new Error('History response was not readable.')
        }

        // Strict address filter: records must involve this wallet address
        pages.push(
          (data.transactions as HistoryItem[]).filter((item) => {
            const isSender = item.userAddress && item.userAddress.toLowerCase().trim() === norm
            const isRecipient = item.recipient && item.recipient.toLowerCase().trim() === norm
            return Boolean(isSender || isRecipient)
          })
        )

        if (!data.hasMore || typeof data.nextCursor !== 'number') break
        cursor = data.nextCursor
      }

      const items = mergeHistoryPages(pages)
      inMemoryWalletHistory.set(norm, items)
      loadedWallets.add(norm)
      return { items, ok: true }
    } catch (err) {
      console.warn('[history.ts] Vercel KV database fetch failed, serving in-memory state:', err)
      return {
        items: getHistory(norm),
        ok: false,
        error: err instanceof Error && err.message ? err.message : 'History could not be loaded.',
      }
    } finally {
      inFlightHistoryFetches.delete(norm)
    }
  })()

  inFlightHistoryFetches.set(norm, fetchPromise)
  return fetchPromise
}

/**
 * Array-only view of {@link fetchHistoryResult} for callers that only prefetch
 * (the failure flag is consumed by the History tab's error state).
 */
export const fetchHistory = async (filterAddress?: string): Promise<HistoryItem[]> =>
  (await fetchHistoryResult(filterAddress)).items

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
  notifyHistoryUpdated(normUser)

  // 3. Persist transaction directly to KV database via API
  void persistTransactionToServer(newTx)
}

/**
 * Persist transaction to backend API with explicit response.ok check.
 */
export async function persistTransactionToServer(tx: HistoryItem): Promise<boolean> {
  try {
    const res = await fetch('/api/history', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(tx),
    })
    if (!res.ok) {
      console.error(`[history.ts] Failed to persist transaction to KV database: HTTP ${res.status} ${res.statusText}`)
      return false
    }
    return true
  } catch (err) {
    console.error('[history.ts] Failed to persist transaction to Vercel KV database:', err)
    return false
  }
}

/**
 * Hash shown and linked for a history row.
 *
 * Bridge rows can carry two hashes: `txHash` (the source burn while the
 * transfer is pending) and `destTxHash` (the destination mint once confirmed).
 * The destination hash wins when present.
 */
export const historyDisplayTxHash = (item: HistoryItem): string => item.destTxHash || item.txHash

/**
 * Explorer chain for a history row's displayed hash. A still-pending bridge row
 * only knows its SOURCE hash, so it must open on the source chain — linking it
 * against the destination chain produces a dead explorer link.
 */
export const historyDisplayChain = (item: HistoryItem): string => {
  const fallback = item.sourceChain || 'Arc_Testnet'
  if (item.type !== 'bridge' || !item.destChain) return fallback
  const hashIsOnDestination = Boolean(item.destTxHash) || item.status === 'success'
  return hashIsOnDestination ? item.destChain : fallback
}

export interface CompleteBridgeTransactionInput
  extends Omit<HistoryItem, 'id' | 'timestamp' | 'txHash' | 'type' | 'status'> {
  /** txHash of the pending bridge row to complete (the source/burn hash). */
  sourceTxHash?: string
  /** Destination (mint) transaction hash that confirms the transfer. */
  destTxHash: string
}

/**
 * Completes a pending bridge row in place instead of inserting a second row.
 *
 * Direct CCTP bridges are first recorded as "pending" with the source (burn)
 * hash and only learn the destination (mint) hash minutes later. Inserting a
 * success row for the mint hash left TWO rows for one bridge — one of them
 * pending forever — because dedupe is keyed by txHash and the two hashes differ.
 *
 * The completed row keeps its source hash as the stable merge key (the server
 * also merges by txHash) and stores the mint hash in `destTxHash`.
 *
 * Returns true when an existing row was completed, false when no pending row
 * existed and a normal success record was inserted instead.
 */
export const completeBridgeTransaction = (item: CompleteBridgeTransactionInput): boolean => {
  cleanLegacyLocalStorage()

  const { sourceTxHash, ...patch } = item
  const normUser = item.userAddress ? item.userAddress.toLowerCase().trim() : undefined
  const normRecipient = item.recipient ? item.recipient.toLowerCase().trim() : undefined

  const findPending = (list: HistoryItem[]) =>
    sourceTxHash
      ? list.findIndex(
          (x) =>
            x.type === 'bridge' &&
            x.status === 'pending' &&
            x.txHash &&
            x.txHash.toLowerCase() === sourceTxHash.toLowerCase()
        )
      : -1

  let completed: HistoryItem | null = null

  if (normUser) {
    const userItems = inMemoryWalletHistory.get(normUser) || []
    const idx = findPending(userItems)
    if (idx >= 0) {
      completed = {
        ...userItems[idx],
        ...patch,
        type: 'bridge',
        status: 'success',
        txHash: userItems[idx].txHash,
        destTxHash: item.destTxHash,
        userAddress: normUser,
        recipient: normRecipient,
      }
      userItems[idx] = completed
      inMemoryWalletHistory.set(normUser, userItems)
    }
  }

  if (normRecipient && normRecipient !== normUser) {
    const recipItems = inMemoryWalletHistory.get(normRecipient) || []
    const idx = findPending(recipItems)
    if (idx >= 0) {
      recipItems[idx] = completed
        ? { ...completed, recipient: normRecipient }
        : {
            ...recipItems[idx],
            ...patch,
            type: 'bridge',
            status: 'success',
            txHash: recipItems[idx].txHash,
            destTxHash: item.destTxHash,
            recipient: normRecipient,
          }
      inMemoryWalletHistory.set(normRecipient, recipItems)
    }
  }

  if (!completed) {
    // No pending row to complete (e.g. the destination was already confirmed
    // when the row was written) — behave exactly like a normal insert.
    addTransaction({ ...patch, type: 'bridge', txHash: item.destTxHash, status: 'success' })
    return false
  }

  if (normUser) loadedWallets.add(normUser)

  notifyHistoryUpdated(normUser)

  void persistTransactionToServer(completed)
  return true
}


