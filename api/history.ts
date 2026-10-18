// api/history.ts
//
// Server-side transaction history API for Arcis Protocol.
// Stores and queries transaction records by connected wallet address.
// Leverages Vercel KV / Upstash Redis with a resilient in-memory fallback.

export interface ServerHistoryItem {
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

  // Pool specific
  poolId?: string
  poolName?: string
  lpMinted?: string
  poolShare?: number
  amountB?: string
  tokenB?: string
}

import { apiSuccess, apiError, safeJsonParse } from './_utils/apiResponse'
import {
  kvGet,
  kvMget,
  kvSet,
  kvDel,
  isStorageAvailable,
  getStorageDriver,
} from './_utils/redisStorage'

// In-memory fallback array on server for offline or cold-start fallback
const memoryHistory: ServerHistoryItem[] = []

const REDIS_KEY_ALL = 'arcis:history:all'
const REDIS_KEY_USER_PREFIX = 'arcis:history:user:'

function parseItems(raw: string | null): ServerHistoryItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function mergeItemIntoList(
  list: ServerHistoryItem[],
  newItem: ServerHistoryItem,
  maxLimit: number
): ServerHistoryItem[] {
  const nextList = [...list]
  const existingIdx = newItem.txHash
    ? nextList.findIndex((m) => m.txHash && m.txHash.toLowerCase() === newItem.txHash.toLowerCase())
    : nextList.findIndex((m) => m.id === newItem.id)

  if (existingIdx >= 0) {
    nextList[existingIdx] = { ...nextList[existingIdx], ...newItem }
  } else {
    nextList.unshift(newItem)
  }

  return nextList.slice(0, maxLimit)
}

/**
 * GET /api/history
 * Query params:
 *   - address: string (optional, wallet address to filter by)
 *   - limit: number (optional, default 100, max 500)
 *   - cursor: number (optional, exclusive upper bound on `timestamp`; pages older items)
 *
 * P09: per-user key is the primary read; the global blob is only a legacy fallback
 * for records written before per-user keys existed. Both blobs are fetched
 * concurrently (single MGET where supported) and only the newest `limit` rows
 * are serialized, so a large global list is never shipped in full.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const address = url.searchParams.get('address')?.toLowerCase()
    const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)), 500)
    const cursorRaw = url.searchParams.get('cursor')
    const cursor = cursorRaw !== null && cursorRaw !== '' ? Number(cursorRaw) : undefined
    if (cursorRaw !== null && cursorRaw !== '' && !Number.isFinite(cursor)) {
      return apiError('Invalid cursor parameter.', 'INVALID_CURSOR', 400)
    }

    let items: ServerHistoryItem[] = []
    let source: string = 'memory'

    const storageOnline = await isStorageAvailable()

    if (storageOnline) {
      if (address) {
        const userKey = `${REDIS_KEY_USER_PREFIX}${address}`
        // Concurrent fetch: per-user list first-class, global list legacy fallback.
        const [rawUser, rawAll] = await kvMget([userKey, REDIS_KEY_ALL])
        const matchesAddress = (item: ServerHistoryItem) => {
          const userMatch = item.userAddress && item.userAddress.toLowerCase() === address
          const recipientMatch = item.recipient && item.recipient.toLowerCase() === address
          return Boolean(userMatch || recipientMatch)
        }
        const userList = parseItems(rawUser).filter(matchesAddress)

        if (userList.length > 0) {
          items = userList
          source = getStorageDriver()
        } else {
          // Legacy fallback: records written before per-user keys existed.
          items = parseItems(rawAll).filter(matchesAddress)
          if (items.length > 0) {
            source = getStorageDriver()
          }
        }
      } else {
        // No address provided: do not expose any user transactions
        items = []
        source = getStorageDriver()
      }
    }

    // Fallback to in-memory if storage returned nothing
    if (items.length === 0 && address) {
      items = memoryHistory.filter((item) => {
        const userMatch = item.userAddress && item.userAddress.toLowerCase() === address
        const recipientMatch = item.recipient && item.recipient.toLowerCase() === address
        return Boolean(userMatch || recipientMatch)
      })
      source = 'memory'
    }

    // Sort descending by timestamp (newest first), apply cursor, then cap the page.
    // Cursor is an exclusive timestamp bound: only rows strictly older than the
    // cursor are returned, so re-requesting with nextCursor never repeats rows.
    const sorted = items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    const afterCursor = cursor !== undefined ? sorted.filter((item) => (item.timestamp || 0) < cursor) : sorted
    const page = afterCursor.slice(0, limit)
    const hasMore = afterCursor.length > page.length
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].timestamp : null

    // Security (SEC-04): Strip private memo content for public unauthenticated requests
    const sanitized = page.map((item) => {
      if (item.isPrivate) {
        return {
          ...item,
          memo: undefined,
          memoId: undefined,
          memoIndex: undefined,
        }
      }
      return item
    })

    return apiSuccess({
      address: address || null,
      count: sanitized.length,
      transactions: sanitized,
      source,
      nextCursor,
      hasMore,
    })
  } catch (error: any) {
    console.error('[History API] GET Error:', error)
    return apiError(error.message || 'Internal server error in History query', 'HISTORY_GET_ERROR', 500)
  }
}

/**
 * POST /api/history
 * Body: Partial<ServerHistoryItem>
 * Adds or updates a transaction in server storage (Vercel KV / Redis + memory fallback).
 * Scoped and indexed by userAddress and recipient wallet addresses.
 */
export async function POST(req: Request) {
  try {
    const jsonResult = await safeJsonParse(req)
    if (!jsonResult.success) {
      return apiError(
        jsonResult.error || 'Invalid or malformed JSON payload in request body.',
        'INVALID_JSON',
        400
      )
    }

    const body = jsonResult.data
    if (!body || typeof body !== 'object') {
      return apiError('Invalid request body.', 'INVALID_BODY', 400)
    }

    const {
      type = 'send',
      txHash = '',
      amount = '0',
      tokenSymbol = 'USDC',
      sourceChain = 'Arc_Testnet',
      destChain,
      recipient,
      userAddress,
      status = 'success',
      amountIn,
      amountOut,
      tokenIn,
      tokenOut,
      isPrivate,
      memo,
      memoId,
      memoIndex,
      poolId,
      poolName,
      lpMinted,
      poolShare,
      amountB,
      tokenB,
    } = body

    // Validation: Require either userAddress or recipient so record is always bound to a wallet
    const cleanUser = userAddress ? String(userAddress).toLowerCase().trim() : undefined
    const cleanRecipient = recipient ? String(recipient).toLowerCase().trim() : undefined

    if (!cleanUser && !cleanRecipient) {
      return apiError('Wallet address (userAddress or recipient) is required.', 'WALLET_REQUIRED', 400)
    }

    // Format validation: if userAddress or recipient is provided and starts with 0x, ensure hex address
    const hexPattern = /^0x[a-f0-9]{40}$/
    if (cleanUser && cleanUser.startsWith('0x') && !hexPattern.test(cleanUser)) {
      return apiError('Invalid userAddress format.', 'INVALID_ADDRESS', 400)
    }
    if (cleanRecipient && cleanRecipient.startsWith('0x') && !hexPattern.test(cleanRecipient)) {
      return apiError('Invalid recipient format.', 'INVALID_ADDRESS', 400)
    }

    const newItem: ServerHistoryItem = {
      id: body.id ? String(body.id) : Math.random().toString(36).substring(2, 9),
      type,
      txHash: String(txHash || ''),
      amount: String(amount ?? '0'),
      tokenSymbol: String(tokenSymbol || 'USDC'),
      sourceChain: String(sourceChain || 'Arc_Testnet'),
      destChain: destChain ? String(destChain) : undefined,
      recipient: cleanRecipient,
      userAddress: cleanUser,
      timestamp: typeof body.timestamp === 'number' ? body.timestamp : Date.now(),
      status: ['success', 'pending', 'failed'].includes(status) ? status : 'success',
      amountIn: amountIn ? String(amountIn) : undefined,
      amountOut: amountOut ? String(amountOut) : undefined,
      tokenIn: tokenIn ? String(tokenIn) : undefined,
      tokenOut: tokenOut ? String(tokenOut) : undefined,
      isPrivate: Boolean(isPrivate),
      memo: memo ? String(memo) : undefined,
      memoId: memoId ? String(memoId) : undefined,
      memoIndex: typeof memoIndex === 'number' ? memoIndex : undefined,
      poolId: poolId ? String(poolId) : undefined,
      poolName: poolName ? String(poolName) : undefined,
      lpMinted: lpMinted ? String(lpMinted) : undefined,
      poolShare: typeof poolShare === 'number' ? poolShare : (poolShare ? Number(poolShare) : undefined),
      amountB: amountB ? String(amountB) : undefined,
      tokenB: tokenB ? String(tokenB) : undefined,
    }

    // 1. Update in-memory server cache
    const existingIndex = newItem.txHash
      ? memoryHistory.findIndex((m) => m.txHash && m.txHash.toLowerCase() === newItem.txHash.toLowerCase())
      : memoryHistory.findIndex((m) => m.id === newItem.id)

    if (existingIndex >= 0) {
      memoryHistory[existingIndex] = { ...memoryHistory[existingIndex], ...newItem }
    } else {
      memoryHistory.unshift(newItem)
      if (memoryHistory.length > 1000) {
        memoryHistory.pop()
      }
    }

    // 2. Persist to Vercel KV / Upstash Redis (P09: one concurrent read round,
    // one concurrent write round; caps unchanged: global 500, per-user 300).
    let savedDriver: string = 'memory'
    try {
      const userKey = newItem.userAddress
        ? `${REDIS_KEY_USER_PREFIX}${newItem.userAddress.toLowerCase()}`
        : null
      const recipKey =
        newItem.recipient &&
        newItem.recipient.toLowerCase() !== newItem.userAddress?.toLowerCase()
          ? `${REDIS_KEY_USER_PREFIX}${newItem.recipient.toLowerCase()}`
          : null
      const readKeys = [REDIS_KEY_ALL, ...(userKey ? [userKey] : []), ...(recipKey ? [recipKey] : [])]
      const [rawAll, rawUser, rawRecip] = await (async () => {
        const results = await kvMget(readKeys)
        // Align optional keys: index 0 is always global; user/recipient shift when absent.
        let offset = 1
        const user = userKey ? (results[offset++] ?? null) : null
        const recip = recipKey ? (results[offset++] ?? null) : null
        return [results[0] ?? null, user, recip] as const
      })()

      const updatedAll = mergeItemIntoList(parseItems(rawAll), newItem, 500)
      const writes: Promise<boolean>[] = [kvSet(REDIS_KEY_ALL, JSON.stringify(updatedAll))]
      if (userKey) {
        writes.push(
          kvSet(userKey, JSON.stringify(mergeItemIntoList(parseItems(rawUser), newItem, 300)))
        )
      }
      if (recipKey) {
        writes.push(
          kvSet(recipKey, JSON.stringify(mergeItemIntoList(parseItems(rawRecip), newItem, 300)))
        )
      }
      const [successAll] = await Promise.all(writes)
      if (successAll) {
        savedDriver = getStorageDriver()
      }
    } catch (storageErr) {
      console.warn('[History API] Failed to persist to remote KV storage, in-memory updated:', storageErr)
    }

    return apiSuccess({
      transaction: newItem,
      storage: savedDriver,
    })
  } catch (error: any) {
    console.error('[History API] POST Error:', error)
    return apiError(error.message || 'Internal server error in History save', 'HISTORY_POST_ERROR', 500)
  }
}

/**
 * DELETE /api/history
 * Query params:
 *   - address: string (optional, clears user-specific history)
 *   - txHash: string (optional, removes specific transaction)
 */
export async function DELETE(_req: Request) {
  // Security (SEC-04): Disable arbitrary unauthenticated history deletions to prevent unauthorized erasure of transactions
  return apiError('Public unauthenticated history deletion is disabled.', 'FORBIDDEN', 403)
}
