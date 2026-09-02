// src/hooks/useGatewayBalance.ts
//
// React hook for querying the Circle Gateway unified balance.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getGatewayBalances,
  type GatewayBalanceItem,
  type GatewayBalanceResponse,
} from '../services/gatewayService'
import { GATEWAY_DOMAINS, GATEWAY_CHAIN_NAMES } from '../config/gatewayConfig'

export interface GatewayBalance {
  domain: number
  chainKey: string
  name: string
  balance: string
  status: 'success' | 'error' | 'loading'
  error?: string
}

// Invert GATEWAY_DOMAINS to map domain IDs back to chain keys
const DOMAIN_TO_CHAIN: Record<number, string> = Object.entries(GATEWAY_DOMAINS).reduce(
  (acc, [chainKey, domainId]) => {
    acc[domainId] = chainKey
    return acc
  },
  {} as Record<number, string>
)

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
      console.log(`[useGatewayBalance] Fetching balance for wallet: ${walletAddress}`)
      const rawData: GatewayBalanceResponse = await getGatewayBalances(walletAddress)

      const mapped: GatewayBalance[] = (rawData.balances || []).map((item: GatewayBalanceItem) => {
        const chainKey = DOMAIN_TO_CHAIN[item.domain] || `domain_${item.domain}`
        return {
          domain: item.domain,
          chainKey,
          name: GATEWAY_CHAIN_NAMES[chainKey] || `Domain ${item.domain}`,
          balance: item.balance,
          status: 'success' as const,
        }
      })

      const sum = (rawData.balances || []).reduce(
        (acc, item) => acc + parseFloat(item.balance),
        0
      )

      return {
        balances: mapped,
        totalBalance: sum.toFixed(2),
      }
    },
    enabled: Boolean(walletAddress),
    staleTime: 15_000, // 15 seconds fresh cache
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