// api/history.ts
//
// Server-side transaction history API for Arcis Protocol.
// Stores and queries transaction records by connected wallet address.
// Uses Redis when available with a persistent in-memory fallback on the server.

export interface ServerHistoryItem {
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

import { apiSuccess, apiError, safeJsonParse } from './utils/apiResponse'

let redisClient: any = null
let redisAvailable = false
let connectionAttempted = false

// In-memory fallback array on server
const memoryHistory: ServerHistoryItem[] = []

async function getRedisClient() {
  if (connectionAttempted) {
    return redisAvailable ? redisClient : null
  }
  connectionAttempted = true

  try {
    const { default: Redis } = await import('ioredis')
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
      retryStrategy: () => null,
    })

    redisClient.on('error', () => {
      redisAvailable = false
    })

    await redisClient.connect().catch(() => {
      redisAvailable = false
    })

    redisAvailable = redisClient.status === 'ready' || redisClient.status === 'connect'
    if (redisAvailable) {
      console.log('[History API] Connected to Redis for history persistence')
    } else {
      console.log('[History API] Redis not reachable, using in-memory server history store')
    }
  } catch {
    redisAvailable = false
    console.log('[History API] ioredis load/connect failed, using in-memory server history store')
  }

  return redisAvailable ? redisClient : null
}

const REDIS_KEY_ALL = 'arcis:history:all'
const REDIS_KEY_USER_PREFIX = 'arcis:history:user:'

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

    const client = await getRedisClient()
    let items: ServerHistoryItem[] = []
    let source = 'memory'

    if (client && redisAvailable) {
      try {
        const redisKey = address ? `${REDIS_KEY_USER_PREFIX}${address}` : REDIS_KEY_ALL
        const raw = await client.get(redisKey)
        if (raw) {
          items = JSON.parse(raw)
          source = 'redis'
        }
      } catch (err) {
        console.warn('[History API] Redis fetch failed, falling back to memory store:', err)
      }
    }

    if (items.length === 0) {
      if (address) {
        items = memoryHistory.filter((item) => {
          const userMatch = item.userAddress && item.userAddress.toLowerCase() === address
          const recipientMatch = item.recipient && item.recipient.toLowerCase() === address
          return Boolean(userMatch || recipientMatch)
        })
      } else {
        items = [...memoryHistory]
      }
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
 * Adds or updates a transaction in server storage.
 */
export async function POST(req: Request) {
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
      recipient,
      userAddress: userAddress ? String(userAddress).toLowerCase() : undefined,
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

    // 1. Update in-memory server list
    // Deduplicate by txHash if present
    const existingIndex = newItem.txHash
      ? memoryHistory.findIndex((m) => m.txHash && m.txHash.toLowerCase() === newItem.txHash.toLowerCase())
      : -1

    if (existingIndex >= 0) {
      memoryHistory[existingIndex] = { ...memoryHistory[existingIndex], ...newItem }
    } else {
      memoryHistory.unshift(newItem)
      if (memoryHistory.length > 1000) {
        memoryHistory.pop()
      }
    }

    // 2. Persist to Redis if available
    const client = await getRedisClient()
    if (client && redisAvailable) {
      try {
        // Save to global list
        await client.set(REDIS_KEY_ALL, JSON.stringify(memoryHistory.slice(0, 500)))

        // If userAddress is present, update user-specific key
        if (newItem.userAddress) {
          const userKey = `${REDIS_KEY_USER_PREFIX}${newItem.userAddress.toLowerCase()}`
          const userTransactions = memoryHistory.filter(
            (m) => m.userAddress?.toLowerCase() === newItem.userAddress?.toLowerCase() ||
                   m.recipient?.toLowerCase() === newItem.userAddress?.toLowerCase()
          )
          await client.set(userKey, JSON.stringify(userTransactions.slice(0, 300)))
        }
      } catch (err) {
        console.warn('[History API] Failed to save to Redis:', err)
      }
    }

    return apiSuccess({
      transaction: newItem,
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

    // Remove from in-memory
    if (txHash) {
      const idx = memoryHistory.findIndex((m) => m.txHash?.toLowerCase() === txHash)
      if (idx >= 0) memoryHistory.splice(idx, 1)
    } else if (address) {
      for (let i = memoryHistory.length - 1; i >= 0; i--) {
        if (memoryHistory[i].userAddress?.toLowerCase() === address) {
          memoryHistory.splice(i, 1)
        }
      }
    }

    // Update Redis
    const client = await getRedisClient()
    if (client && redisAvailable) {
      try {
        if (address) {
          await client.del(`${REDIS_KEY_USER_PREFIX}${address}`)
        }
        await client.set(REDIS_KEY_ALL, JSON.stringify(memoryHistory.slice(0, 500)))
      } catch {}
    }

    return apiSuccess({ message: 'History record(s) removed' })
  } catch (error: any) {
    return apiError(error.message || 'Internal server error in History delete', 'HISTORY_DELETE_ERROR', 500)
  }
}
