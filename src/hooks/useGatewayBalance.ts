// src/hooks/useGatewayBalance.ts
//
// React hook for querying the Circle Gateway unified balance.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getGatewayBalances,
  type GatewayBalanceItem,
  type GatewayBalanceResponse,
} from '../services/gatewayService'
import { GATEWAY_DOMAINS, GATEWAY_CHAIN_NAMES, DOMAIN_TO_CHAIN } from '../config/gatewayConfig'
import { applyOptimisticDelta, getOptimisticDelta } from '../services/optimisticGatewayTracker'

export interface GatewayBalance {
  domain: number
  chainKey: string
  name: string
  balance: string
  status: 'success' | 'error' | 'loading'
  error?: string
}

export function useGatewayBalance(walletAddress: string) {
  const queryClient = useQueryClient()

  const {
    data,
    isLoading,
    isFetching,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['gatewayBalances', walletAddress],
    queryFn: async () => {
      if (!walletAddress) {
        return { balances: [] as GatewayBalance[], totalBalance: '0.00' }
      }
      console.log(`[useGatewayBalance] Live fetching balance for wallet: ${walletAddress}`)
      const rawData: GatewayBalanceResponse = await getGatewayBalances(walletAddress)

      const mapped: GatewayBalance[] = (rawData.balances || []).map((item: GatewayBalanceItem) => {
        const chainKey = DOMAIN_TO_CHAIN[item.domain] || `domain_${item.domain}`
        return {
          domain: item.domain,
          chainKey,
          name: GATEWAY_CHAIN_NAMES[chainKey] || `Domain ${item.domain}`,
          balance: parseFloat(item.balance || '0').toFixed(2),
          status: 'success' as const,
        }
      })

      const sum = (rawData.balances || []).reduce(
        (acc, item) => acc + (parseFloat(item.balance) || 0),
        0
      )

      const effectiveTotal = applyOptimisticDelta(walletAddress, sum, 'gateway-settlement-pool')
      const delta = getOptimisticDelta(walletAddress, sum, 'gateway-settlement-pool')

      // Distribute delta to Arc_Testnet item for UI consistency
      if (delta !== 0 && mapped.length > 0) {
        const arcIndex = mapped.findIndex((m) => m.chainKey === 'Arc_Testnet')
        if (arcIndex >= 0) {
          const oldBal = parseFloat(mapped[arcIndex].balance || '0')
          mapped[arcIndex].balance = Math.max(0, oldBal + delta).toFixed(2)
        }
      }

      return {
        balances: mapped,
        totalBalance: effectiveTotal.toFixed(2),
      }
    },
    enabled: Boolean(walletAddress),
    staleTime: 4_000, // 4 seconds fresh cache for live updates
    refetchInterval: 8_000, // Live poll every 8 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes garbage collection
  })

  return {
    balances: data?.balances || [],
    totalBalance: data?.totalBalance || '0.00',
    loading: isLoading,
    isFetching,
    error: queryError ? (queryError as Error).message : null,
    refresh: () => {
      queryClient.invalidateQueries({ queryKey: ['gatewayBalances', walletAddress] })
      refetch()
    },
  }
}