import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  addTransaction,
  completeBridgeTransaction,
  getHistory,
  historyDisplayTxHash,
  historyDisplayChain,
} from '../history'

// One Direct CCTP bridge must stay ONE history row: the pending burn row is
// completed in place when the destination mint resolves, instead of a second
// success row being inserted next to a row that stays Pending forever.

const burnHash = `0x${'ab'.repeat(32)}`
const mintHash = `0x${'cd'.repeat(32)}`

function pendingBridgeRow(userAddress: string) {
  addTransaction({
    type: 'bridge',
    txHash: burnHash,
    amount: '25',
    tokenSymbol: 'USDC',
    sourceChain: 'Base_Sepolia',
    destChain: 'Arc_Testnet',
    recipient: userAddress,
    userAddress,
    status: 'pending',
  })
}

describe('completeBridgeTransaction', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('completes the pending burn row in place instead of adding a second row', () => {
    const wallet = `0x${'11'.repeat(20)}`
    pendingBridgeRow(wallet)

    const rowsBefore = getHistory(wallet)
    expect(rowsBefore).toHaveLength(1)
    expect(rowsBefore[0].status).toBe('pending')

    const merged = completeBridgeTransaction({
      sourceTxHash: burnHash,
      destTxHash: mintHash,
      amount: '25',
      tokenSymbol: 'USDC',
      sourceChain: 'Base_Sepolia',
      destChain: 'Arc_Testnet',
      recipient: wallet,
      userAddress: wallet,
    })

    expect(merged).toBe(true)
    const rows = getHistory(wallet)
    expect(rows).toHaveLength(1) // still ONE row for one bridge
    expect(rows[0].status).toBe('success')
    expect(rows[0].destTxHash).toBe(mintHash)
    // The row keeps the source (burn) hash as its stable merge key.
    expect(rows[0].txHash).toBe(burnHash)
    expect(rows[0].id).toBe(rowsBefore[0].id)
    expect(rows[0].timestamp).toBe(rowsBefore[0].timestamp)
  })

  it('persists the completed row with the source hash so the server can merge it', async () => {
    const wallet = `0x${'22'.repeat(20)}`
    pendingBridgeRow(wallet)
    // Ignore the POST made while seeding the pending row.
    fetchMock.mockClear()

    completeBridgeTransaction({
      sourceTxHash: burnHash,
      destTxHash: mintHash,
      amount: '25',
      tokenSymbol: 'USDC',
      sourceChain: 'Base_Sepolia',
      destChain: 'Arc_Testnet',
      recipient: wallet,
      userAddress: wallet,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/history')
    const body = JSON.parse(String(init.body))
    expect(body.txHash).toBe(burnHash)
    expect(body.destTxHash).toBe(mintHash)
    expect(body.status).toBe('success')
  })

  it('falls back to a normal insert when there is no pending row to complete', () => {
    const wallet = `0x${'33'.repeat(20)}`

    const merged = completeBridgeTransaction({
      destTxHash: mintHash,
      amount: '10',
      tokenSymbol: 'USDC',
      sourceChain: 'Arc_Testnet',
      destChain: 'Base_Sepolia',
      recipient: wallet,
      userAddress: wallet,
    })

    expect(merged).toBe(false)
    const rows = getHistory(wallet)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('success')
    expect(rows[0].txHash).toBe(mintHash)
  })

  it('leaves unrelated pending rows untouched', () => {
    const wallet = `0x${'44'.repeat(20)}`
    pendingBridgeRow(wallet)

    completeBridgeTransaction({
      sourceTxHash: `0x${'ff'.repeat(32)}`,
      destTxHash: mintHash,
      amount: '5',
      tokenSymbol: 'USDC',
      sourceChain: 'Arc_Testnet',
      destChain: 'Base_Sepolia',
      recipient: wallet,
      userAddress: wallet,
    })

    const rows = getHistory(wallet)
    expect(rows).toHaveLength(2)
    const stillPending = rows.filter((r) => r.status === 'pending')
    expect(stillPending).toHaveLength(1)
    expect(stillPending[0].txHash).toBe(burnHash)
  })
})

describe('history display helpers', () => {
  it('prefers the destination hash when the bridge completed', () => {
    expect(
      historyDisplayTxHash({
        id: '1',
        type: 'bridge',
        txHash: burnHash,
        destTxHash: mintHash,
        amount: '25',
        tokenSymbol: 'USDC',
        sourceChain: 'Base_Sepolia',
        destChain: 'Arc_Testnet',
        timestamp: Date.now(),
        status: 'success',
      })
    ).toBe(mintHash)
  })

  it('links a still-pending bridge row on its SOURCE chain (no dead explorer link)', () => {
    const pending = {
      id: '2',
      type: 'bridge' as const,
      txHash: burnHash,
      amount: '25',
      tokenSymbol: 'USDC',
      sourceChain: 'Base_Sepolia',
      destChain: 'Arc_Testnet',
      timestamp: Date.now(),
      status: 'pending' as const,
    }
    expect(historyDisplayTxHash(pending)).toBe(burnHash)
    expect(historyDisplayChain(pending)).toBe('Base_Sepolia')
  })

  it('links a completed bridge row on its DESTINATION chain', () => {
    const completed = {
      id: '3',
      type: 'bridge' as const,
      txHash: burnHash,
      destTxHash: mintHash,
      amount: '25',
      tokenSymbol: 'USDC',
      sourceChain: 'Base_Sepolia',
      destChain: 'Arc_Testnet',
      timestamp: Date.now(),
      status: 'success' as const,
    }
    expect(historyDisplayChain(completed)).toBe('Arc_Testnet')
  })

  it('keeps non-bridge rows on their source chain', () => {
    const send = {
      id: '4',
      type: 'send' as const,
      txHash: mintHash,
      amount: '1',
      tokenSymbol: 'USDC',
      sourceChain: 'Arc_Testnet',
      timestamp: Date.now(),
      status: 'success' as const,
    }
    expect(historyDisplayTxHash(send)).toBe(mintHash)
    expect(historyDisplayChain(send)).toBe('Arc_Testnet')
  })
})
