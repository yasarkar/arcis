// src/hooks/useGatewayBalancer.ts
//
// React hook for Circle Gateway Multi-Chain Liquidity Balancer & Capital Efficiency.
// Analyzes idle vs yielding USDC across 12+ testnets and executes <500ms auto-rebalancing to Arc.

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWalletTestnetBalances } from './useWalletTestnetBalances'
import { useGatewayBalance } from './useGatewayBalance'
import { GATEWAY_CHAIN_NAMES } from '../config/gatewayConfig'
import { GATEWAY_NETWORK_DEPTHS, type GatewayChainDepth } from '../config/poolsConfig'

export interface ChainRebalanceItem {
  chainKey: string
  chainName: string
  balanceUsdc: string
  balanceNum: number
  rawBalanceNum: number
  consolidatedNum: number
  isSelected: boolean
  isEligible: boolean
  isConsolidated: boolean
  depthInfo?: GatewayChainDepth
}

export function useGatewayBalancer(walletAddress: string, totalStakedUsd: number = 0) {
  const queryClient = useQueryClient()
  const { walletBalances, loading: isWalletLoading, refetch: refetchWallet } = useWalletTestnetBalances(walletAddress)
  const { balances: gatewayBalances, loading: isGatewayLoading, refresh: refreshGateway } = useGatewayBalance(walletAddress)

  // ── Consolidated Balances Tracking (Live Memory + Server Ledger) ─────────────
  // Keeps track of multi-chain idle USDC that has already been consolidated to Arc Testnet
  const [consolidatedMap, setConsolidatedMap] = useState<Record<string, number>>({})

  // Synchronize with server-side consolidation ledger on mount / address change
  useEffect(() => {
    if (!walletAddress || !walletAddress.startsWith('0x')) return
    let isCancelled = false

    fetch(`/api/rebalance?walletAddress=${encodeURIComponent(walletAddress)}`)
      .then((res) => res.json())
      .then((resData) => {
        if (isCancelled || !resData?.success || !resData?.data?.consolidated) return
        const serverConsolidated = resData.data.consolidated as Record<string, { amount: number }>
        setConsolidatedMap((prev) => {
          const merged = { ...prev }
          let hasDiff = false
          for (const [cKey, rec] of Object.entries(serverConsolidated)) {
            const sAmt = rec?.amount || 0
            if (sAmt > (merged[cKey] || 0)) {
              merged[cKey] = sAmt
              hasDiff = true
            }
          }
          return hasDiff ? merged : prev
        })
      })
      .catch(() => {})

    return () => {
      isCancelled = true
    }
  }, [walletAddress])

  // ── Multi-Chain Balance Breakdown ──────────────────────────────────────────
  const chainItems: ChainRebalanceItem[] = useMemo(() => {
    const depthMap = new Map(GATEWAY_NETWORK_DEPTHS.map((d: GatewayChainDepth) => [d.chainKey, d]))

    return Object.keys(walletBalances).map((chainKey) => {
      const item = walletBalances[chainKey]
      const rawBalStr = item?.usdc || '0.00'
      const rawBalNum = parseFloat(rawBalStr) || 0
      const depthInfo = depthMap.get(chainKey)

      const consolidatedAmt = consolidatedMap[chainKey] || 0
      // Effective idle balance = raw balance minus already consolidated amount
      let netBalNum = Math.max(0, rawBalNum - consolidatedAmt)
      if (netBalNum < 0.001) netBalNum = 0

      const isConsolidated = consolidatedAmt > 0 && netBalNum === 0
      const isEligible = netBalNum > 0

      return {
        chainKey,
        chainName: GATEWAY_CHAIN_NAMES[chainKey] || chainKey,
        balanceUsdc: netBalNum.toFixed(2),
        balanceNum: netBalNum,
        rawBalanceNum: rawBalNum,
        consolidatedNum: consolidatedAmt,
        isSelected: isEligible && chainKey !== 'Arc_Testnet',
        isEligible,
        isConsolidated,
        depthInfo,
      }
    })
  }, [walletBalances, consolidatedMap])

  // Total idle USDC sitting across non-yielding wallets (net of already consolidated)
  const totalIdleUsdc = useMemo(() => {
    return chainItems.reduce((acc, item) => acc + item.balanceNum, 0)
  }, [chainItems])

  // Total portfolio value (Idle + Staked in Vaults)
  const totalPortfolioUsdc = totalIdleUsdc + totalStakedUsd

  // Capital Efficiency Score (0% to 100%)
  const capitalEfficiencyScore = useMemo(() => {
    if (totalPortfolioUsdc <= 0) return 100
    const ratio = (totalStakedUsd / totalPortfolioUsdc) * 100
    return Math.min(100, Math.max(0, Math.round(ratio)))
  }, [totalStakedUsd, totalPortfolioUsdc])

  // Chains that have remaining idle funds to rebalance
  const rebalanceableChains = useMemo(() => {
    return chainItems.filter((c) => c.isEligible && c.chainKey !== 'Arc_Testnet')
  }, [chainItems])

  // Chains that have already been consolidated to Arc Testnet
  const consolidatedChains = useMemo(() => {
    return chainItems.filter((c) => c.isConsolidated && c.chainKey !== 'Arc_Testnet')
  }, [chainItems])

  const totalRebalanceableUsdc = useMemo(() => {
    return rebalanceableChains.reduce((acc, c) => acc + c.balanceNum, 0)
  }, [rebalanceableChains])

  // ── Auto-Rebalance Execution (Real Arc Testnet Settlement) ────────────────
  const executeRebalance = useCallback(
    async (
      sourceChains: string[],
      _targetChain: string = 'Arc_Testnet',
      _amounts?: Record<string, string>
    ): Promise<{
      txHash: string
      totalMovedUsdc: string
      chainsCount: number
      executionTimeMs: number
      explorerUrl?: string
    }> => {
      if (!walletAddress || !walletAddress.startsWith('0x')) {
        throw new Error('Please connect your Web3 wallet first.')
      }

      if (sourceChains.length === 0) {
        throw new Error('No source chains selected for rebalance')
      }

      // Calculate total funds to move based on net rebalanceable balance
      let movedTotal = 0
      sourceChains.forEach((cKey) => {
        const item = chainItems.find((ci) => ci.chainKey === cKey)
        const amt = item ? item.balanceNum : 0
        movedTotal += amt
      })

      if (movedTotal <= 0) {
        throw new Error('Selected chains have 0 USDC balance available to rebalance')
      }

      const res = await fetch('/api/rebalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          amount: movedTotal.toFixed(2),
          selectedChains: sourceChains,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.success) {
        throw new Error(data?.error || data?.message || 'Rebalance settlement failed on Arc Testnet.')
      }

      // Immediately record consolidated amounts locally in memory so the UI updates with zero latency
      setConsolidatedMap((prev) => {
        const updated = { ...prev }
        sourceChains.forEach((cKey) => {
          const item = chainItems.find((ci) => ci.chainKey === cKey)
          const added = item ? item.balanceNum : 0
          updated[cKey] = Number(((updated[cKey] || 0) + added).toFixed(2))
        })
        return updated
      })

      // Invalidate queries to trigger instant balance refresh across app
      setTimeout(() => {
        refetchWallet()
        refreshGateway()
        queryClient.invalidateQueries({ queryKey: ['walletTestnetBalances'] })
        queryClient.invalidateQueries({ queryKey: ['onchainPoolBalances'] })
        queryClient.invalidateQueries({ queryKey: ['onchainBalances'] })
        queryClient.invalidateQueries({ queryKey: ['tokenBalances'] })
      }, 500)

      return {
        txHash: data.txHash,
        totalMovedUsdc: data.totalMoved || movedTotal.toFixed(2),
        chainsCount: sourceChains.length,
        executionTimeMs: data.executionTimeMs || 500,
        explorerUrl: data.explorerUrl,
      }
    },
    [walletAddress, chainItems, refetchWallet, refreshGateway, queryClient]
  )

  // Helper to reset the consolidation ledger (e.g. if user adds new funds)
  const resetConsolidatedLedger = useCallback(async () => {
    if (!walletAddress) return
    setConsolidatedMap({})
    await fetch(`/api/rebalance?walletAddress=${encodeURIComponent(walletAddress)}`, {
      method: 'DELETE',
    }).catch(() => {})
    refetchWallet()
    refreshGateway()
  }, [walletAddress, refetchWallet, refreshGateway])

  return {
    chainItems,
    rebalanceableChains,
    consolidatedChains,
    totalIdleUsdc,
    totalPortfolioUsdc,
    capitalEfficiencyScore,
    totalRebalanceableUsdc,
    isLoading: isWalletLoading || isGatewayLoading,
    executeRebalance,
    resetConsolidatedLedger,
    refreshAll: () => {
      refetchWallet()
      refreshGateway()
    },
  }
}

