export interface HistoryItem {
  id: string
  type: 'send' | 'swap' | 'bridge'
  txHash: string
  amount: string
  tokenSymbol: string
  sourceChain: string
  destChain?: string
  recipient?: string
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

export const getHistory = (): HistoryItem[] => {
  try {
    const listStr = localStorage.getItem('arc_unified_history') || '[]'
    const list = JSON.parse(listStr)
    
    // Merge bridge history from localStorage (cctp_bridge_history)
    const bridgeStr = localStorage.getItem('cctp_bridge_history') || '[]'
    const bridgeList = JSON.parse(bridgeStr)
    const migratedBridges = bridgeList.map((b: any) => ({
      id: b.id || `legacy-bridge-${b.txHash}`,
      type: 'bridge' as const,
      txHash: b.txHash,
      amount: b.amount,
      tokenSymbol: 'USDC',
      sourceChain: b.sourceChain,
      destChain: b.destChain,
      timestamp: b.timestamp || Date.now(),
      status: 'success' as const
    }))

    const merged = [...list, ...migratedBridges]
    const seen = new Set()
    const deduplicated = merged.filter(item => {
      if (!item.txHash) return true
      if (seen.has(item.txHash)) return false
      seen.add(item.txHash)
      return true
    })

    return deduplicated.sort((a, b) => b.timestamp - a.timestamp)
  } catch (e) {
    console.error('[history.ts] Failed to parse history:', e)
    return []
  }
}

export const addTransaction = (item: Omit<HistoryItem, 'id' | 'timestamp'>) => {
  try {
    const list = getHistory()
    const newTx: HistoryItem = {
      ...item,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: Date.now()
    }
    list.unshift(newTx)
    localStorage.setItem('arc_unified_history', JSON.stringify(list.slice(0, 100)))
    
    // Dispatch event to notify components to refresh the history list
    window.dispatchEvent(new Event('arc_history_updated'))
  } catch (e) {
    console.error('[history.ts] Failed to add transaction to history:', e)
  }
}
