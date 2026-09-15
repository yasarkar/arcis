// api/history.ts
//
// Server-side transaction history API for Arcis Protocol.
// Stores and queries transaction records by connected wallet address.
// Leverages Vercel KV / Upstash Redis with a resilient in-memory fallback.

export interface ServerHistoryItem {
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

import { apiSuccess, apiError, safeJsonParse } from './_utils/apiResponse'
import {
  kvGet,
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
 *   - limit: number (optional, default 100)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const address = url.searchParams.get('address')?.toLowerCase()
    const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') || '100', 10)), 500)

    let items: ServerHistoryItem[] = []
    let source: string = 'memory'

    const storageOnline = await isStorageAvailable()

    if (storageOnline) {
      if (address) {
        // 1. Try fetching user-specific key
        const userKey = `${REDIS_KEY_USER_PREFIX}${address}`
        const rawUser = await kvGet(userKey)
        const userList = parseItems(rawUser)

        const filteredUserList = userList.filter((item) => {
          const userMatch = item.userAddress && item.userAddress.toLowerCase() === address
          const recipientMatch = item.recipient && item.recipient.toLowerCase() === address
          return Boolean(userMatch || recipientMatch)
        })

        if (filteredUserList.length > 0) {
          items = filteredUserList
          source = getStorageDriver()
        } else {
          // 2. Fallback: filter global list
          const rawAll = await kvGet(REDIS_KEY_ALL)
          const allList = parseItems(rawAll)
          items = allList.filter((item) => {
            const userMatch = item.userAddress && item.userAddress.toLowerCase() === address
            const recipientMatch = item.recipient && item.recipient.toLowerCase() === address
            return Boolean(userMatch || recipientMatch)
          })
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

    // Sort descending by timestamp (newest first)
    const sorted = items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, limit)

    return apiSuccess({
      address: address || null,
      count: sorted.length,
      transactions: sorted,
      source,
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
    } = body

    const newItem: ServerHistoryItem = {
      id: body.id || Math.random().toString(36).substring(2, 9),
      type,
      txHash,
      amount: String(amount),
      tokenSymbol,
      sourceChain,
      destChain,
      recipient: recipient ? String(recipient).toLowerCase().trim() : undefined,
      userAddress: userAddress ? String(userAddress).toLowerCase().trim() : undefined,
      timestamp: body.timestamp || Date.now(),
      status,
      amountIn: amountIn ? String(amountIn) : undefined,
      amountOut: amountOut ? String(amountOut) : undefined,
      tokenIn,
      tokenOut,
      isPrivate: Boolean(isPrivate),
      memo,
      memoId,
      memoIndex,
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

    // 2. Persist to Vercel KV / Upstash Redis
    let savedDriver: string = 'memory'
    try {
      // 2a. Update Global List in KV
      const rawAll = await kvGet(REDIS_KEY_ALL)
      const currentAll = parseItems(rawAll)
      const updatedAll = mergeItemIntoList(currentAll, newItem, 500)
      const successAll = await kvSet(REDIS_KEY_ALL, JSON.stringify(updatedAll))
      if (successAll) {
        savedDriver = getStorageDriver()
      }

      // 2b. Update User-Specific List in KV
      if (newItem.userAddress) {
        const userKey = `${REDIS_KEY_USER_PREFIX}${newItem.userAddress.toLowerCase()}`
        const rawUser = await kvGet(userKey)
        const currentUser = parseItems(rawUser)
        const updatedUser = mergeItemIntoList(currentUser, newItem, 300)
        await kvSet(userKey, JSON.stringify(updatedUser))
      }

      // 2c. Update Recipient-Specific List in KV if distinct
      if (
        newItem.recipient &&
        newItem.recipient.toLowerCase() !== newItem.userAddress?.toLowerCase()
      ) {
        const recipKey = `${REDIS_KEY_USER_PREFIX}${newItem.recipient.toLowerCase()}`
        const rawRecip = await kvGet(recipKey)
        const currentRecip = parseItems(rawRecip)
        const updatedRecip = mergeItemIntoList(currentRecip, newItem, 300)
        await kvSet(recipKey, JSON.stringify(updatedRecip))
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
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url)
    const address = url.searchParams.get('address')?.toLowerCase()
    const txHash = url.searchParams.get('txHash')?.toLowerCase()

    if (!address && !txHash) {
      return apiError('Query parameter "address" or "txHash" is required.', 'MISSING_QUERY_PARAM', 400)
    }

    // 1. Remove from in-memory
    if (txHash) {
      const idx = memoryHistory.findIndex((m) => m.txHash?.toLowerCase() === txHash)
      if (idx >= 0) memoryHistory.splice(idx, 1)
    } else if (address) {
      for (let i = memoryHistory.length - 1; i >= 0; i--) {
        if (
          memoryHistory[i].userAddress?.toLowerCase() === address ||
          memoryHistory[i].recipient?.toLowerCase() === address
        ) {
          memoryHistory.splice(i, 1)
        }
      }
    }

    // 2. Remove from KV Storage
    try {
      if (txHash) {
        // Remove from global list
        const rawAll = await kvGet(REDIS_KEY_ALL)
        const allList = parseItems(rawAll)
        const filteredAll = allList.filter((m) => m.txHash?.toLowerCase() !== txHash)
        await kvSet(REDIS_KEY_ALL, JSON.stringify(filteredAll))

        // If address also provided, clean user list
        if (address) {
          const userKey = `${REDIS_KEY_USER_PREFIX}${address}`
          const rawUser = await kvGet(userKey)
          const userList = parseItems(rawUser)
          const filteredUser = userList.filter((m) => m.txHash?.toLowerCase() !== txHash)
          await kvSet(userKey, JSON.stringify(filteredUser))
        }
      } else if (address) {
        // Delete user key
        await kvDel(`${REDIS_KEY_USER_PREFIX}${address}`)

        // Filter out this user's records from global list
        const rawAll = await kvGet(REDIS_KEY_ALL)
        const allList = parseItems(rawAll)
        const filteredAll = allList.filter(
          (m) =>
            m.userAddress?.toLowerCase() !== address &&
            m.recipient?.toLowerCase() !== address
        )
        await kvSet(REDIS_KEY_ALL, JSON.stringify(filteredAll))
      }
    } catch (storageErr) {
      console.warn('[History API] Failed to update remote KV storage on DELETE:', storageErr)
    }

    return apiSuccess({ message: 'History record(s) removed' })
  } catch (error: any) {
    return apiError(error.message || 'Internal server error in History delete', 'HISTORY_DELETE_ERROR', 500)
  }
}
