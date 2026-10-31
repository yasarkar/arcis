import { describe, it, expect } from 'vitest'
import type { HistoryItem } from '../history'

// Test sort logic
function sortHistoryItems(
  items: HistoryItem[],
  sortField: 'time' | 'amount' | 'type' | 'network',
  sortDirection: 'asc' | 'desc'
): HistoryItem[] {
  const getAmountNum = (item: HistoryItem): number => {
    if (item.type === 'swap') {
      const valIn = item.amountIn ? parseFloat(item.amountIn) : 0
      const valOut = item.amountOut ? parseFloat(item.amountOut) : 0
      if (!isNaN(valIn) && valIn > 0) return valIn
      if (!isNaN(valOut) && valOut > 0) return valOut
    }
    if (item.type === 'add_liquidity' && item.amountB) {
      const a = parseFloat(item.amount || '0')
      const b = parseFloat(item.amountB || '0')
      return (isNaN(a) ? 0 : a) + (isNaN(b) ? 0 : b)
    }
    const val = parseFloat(item.amount || '0')
    return isNaN(val) ? 0 : val
  }

  const list = [...items]
  list.sort((a, b) => {
    if (sortField === 'amount') {
      const amtA = getAmountNum(a)
      const amtB = getAmountNum(b)
      if (amtA !== amtB) {
        return sortDirection === 'asc' ? amtA - amtB : amtB - amtA
      }
    } else if (sortField === 'type') {
      const typeA = (a.type || '').toLowerCase()
      const typeB = (b.type || '').toLowerCase()
      const cmp = typeA.localeCompare(typeB)
      if (cmp !== 0) {
        return sortDirection === 'asc' ? cmp : -cmp
      }
    } else if (sortField === 'network') {
      const netA = (a.destChain || a.sourceChain || 'Arc_Testnet').toLowerCase()
      const netB = (b.destChain || b.sourceChain || 'Arc_Testnet').toLowerCase()
      const cmp = netA.localeCompare(netB)
      if (cmp !== 0) {
        return sortDirection === 'asc' ? cmp : -cmp
      }
    }
    const tsA = a.timestamp || 0
    const tsB = b.timestamp || 0
    return sortDirection === 'asc' ? tsA - tsB : tsB - tsA
  })
  return list
}

describe('history sorting logic', () => {
  const mockItems: HistoryItem[] = [
    {
      id: '1',
      type: 'send',
      txHash: '0x11',
      amount: '50',
      tokenSymbol: 'USDC',
      sourceChain: 'Arc_Testnet',
      timestamp: 1000,
      status: 'success',
    },
    {
      id: '2',
      type: 'swap',
      txHash: '0x22',
      amountIn: '10',
      amountOut: '9.98',
      amount: '10',
      tokenSymbol: 'USDC',
      sourceChain: 'Base_Sepolia',
      timestamp: 2000,
      status: 'success',
    },
    {
      id: '3',
      type: 'bridge',
      txHash: '0x33',
      amount: '500',
      tokenSymbol: 'USDC',
      sourceChain: 'Ethereum_Sepolia',
      destChain: 'Arc_Testnet',
      timestamp: 500,
      status: 'success',
    },
  ]

  it('sorts by amount descending (high to low)', () => {
    const sorted = sortHistoryItems(mockItems, 'amount', 'desc')
    expect(sorted.map((i) => i.id)).toEqual(['3', '1', '2']) // 500, 50, 10
  })

  it('sorts by amount ascending (low to high)', () => {
    const sorted = sortHistoryItems(mockItems, 'amount', 'asc')
    expect(sorted.map((i) => i.id)).toEqual(['2', '1', '3']) // 10, 50, 500
  })

  it('sorts by timestamp descending (newest first)', () => {
    const sorted = sortHistoryItems(mockItems, 'time', 'desc')
    expect(sorted.map((i) => i.id)).toEqual(['2', '1', '3']) // 2000, 1000, 500
  })

  it('sorts by timestamp ascending (oldest first)', () => {
    const sorted = sortHistoryItems(mockItems, 'time', 'asc')
    expect(sorted.map((i) => i.id)).toEqual(['3', '1', '2']) // 500, 1000, 2000
  })

  it('sorts by type ascending (alphabetical)', () => {
    const sorted = sortHistoryItems(mockItems, 'type', 'asc')
    expect(sorted.map((i) => i.type)).toEqual(['bridge', 'send', 'swap'])
  })

  it('sorts by network ascending (alphabetical)', () => {
    const sorted = sortHistoryItems(mockItems, 'network', 'asc')
    expect(sorted.map((i) => i.id)).toEqual(['3', '1', '2']) // Arc_Testnet (ts: 500), Arc_Testnet (ts: 1000), Base_Sepolia
  })
})
