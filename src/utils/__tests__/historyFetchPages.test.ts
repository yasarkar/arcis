import { describe, it, expect, vi, afterEach } from 'vitest'
import { addTransaction, fetchHistoryResult, getHistory, type HistoryItem } from '../history'

// P0-1: a wallet's history is read through the server's cursor, not one capped page.
// P0-2: `pending` rows stay `pending` — the table decides what to show, the data layer
// never relabels an unsettled transaction as a settled one.

const walletPaged = `0x${'a1'.repeat(20)}`
const walletDeduped = `0x${'b2'.repeat(20)}`
const walletFailing = `0x${'c3'.repeat(20)}`

function row(overrides: Partial<HistoryItem> & Pick<HistoryItem, 'id' | 'timestamp' | 'status'>): HistoryItem {
  return {
    type: 'send',
    txHash: `0x${overrides.id.padEnd(64, '0')}`,
    amount: '10',
    tokenSymbol: 'USDC',
    sourceChain: 'Arc_Testnet',
    userAddress: walletPaged,
    ...overrides,
  }
}

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchHistoryResult', () => {
  it('reads every cursor page and keeps statuses verbatim', async () => {
    const urls: string[] = []
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      urls.push(url)

      if (url.includes('cursor=')) {
        return jsonResponse({
          success: true,
          hasMore: false,
          nextCursor: null,
          transactions: [row({ id: 'old', timestamp: 100, status: 'success', userAddress: walletPaged })],
        })
      }

      return jsonResponse({
        success: true,
        hasMore: true,
        nextCursor: 500,
        transactions: [
          row({ id: 'new', timestamp: 900, status: 'success', userAddress: walletPaged }),
          row({
            id: 'pending',
            type: 'bridge',
            timestamp: 800,
            status: 'pending',
            userAddress: walletPaged,
            destChain: 'Base_Sepolia',
          }),
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchHistoryResult(walletPaged)

    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(urls[0]).toContain('limit=300')
    expect(urls[0]).not.toContain('cursor=')
    expect(urls[1]).toContain('cursor=500')
    expect(result.items.map((item) => item.id)).toEqual(['new', 'pending', 'old'])
    // The pending burn is never rewritten as a success by the read path.
    expect(result.items.find((item) => item.id === 'pending')?.status).toBe('pending')
  })

  it('de-duplicates a row that appears on two pages', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      const shared = row({ id: 'shared', timestamp: 700, status: 'success', userAddress: walletDeduped })

      if (url.includes('cursor=')) {
        return jsonResponse({
          success: true,
          hasMore: false,
          nextCursor: null,
          transactions: [shared, row({ id: 'older', timestamp: 200, status: 'success', userAddress: walletDeduped })],
        })
      }

      return jsonResponse({
        success: true,
        hasMore: true,
        nextCursor: 400,
        transactions: [shared],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchHistoryResult(walletDeduped)

    expect(result.ok).toBe(true)
    expect(result.items.map((item) => item.id)).toEqual(['shared', 'older'])
  })

  it('reports a failed read instead of pretending the wallet is empty', async () => {
    // Seed the in-memory cache through the normal write path (its POST must succeed).
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true })))
    addTransaction({
      type: 'send',
      txHash: `0x${'ee'.repeat(32)}`,
      amount: '12',
      tokenSymbol: 'USDC',
      sourceChain: 'Arc_Testnet',
      recipient: walletFailing,
      userAddress: walletFailing,
      status: 'success',
    })
    expect(getHistory(walletFailing)).toHaveLength(1)

    // A later GET failing must keep the cached row and flag the failure.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false }, false, 503)))

    const result = await fetchHistoryResult(walletFailing)

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/503/)
    expect(result.items).toHaveLength(1)
    expect(result.items[0].txHash).toBe(`0x${'ee'.repeat(32)}`)
  })

  it('refuses to read without a wallet address', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchHistoryResult('   ')

    expect(result.ok).toBe(false)
    expect(result.items).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
