// src/hooks/useWalletTestnetBalances.ts
//
// React hook for querying connected wallet's USDC (and EURC) balances
// across supported EVM testnet RPCs for Gateway deposit.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { erc20Abi, formatUnits, type Chain } from 'viem'
import { USDC_ADDRESSES, EURC_ADDRESSES, CIRBTC_ADDRESSES, GATEWAY_CHAIN_NAMES } from '../config/gatewayConfig'
import { CHAIN_DEFS } from '../config/chainMeta'
import { getResilientPublicClient, resilientReadContract } from '../services/rpc'

export const TESTNET_CHAINS: Record<string, Chain> = CHAIN_DEFS

export interface WalletChainBalance {
  chainKey: string
  chainName: string
  usdc: string
  eurc?: string
  cirbtc?: string
  loading: boolean
  error?: string
}

export type WalletBalancesRecord = Record<string, WalletChainBalance>

function createInitialBalancesRecord(): WalletBalancesRecord {
  const initialMap: WalletBalancesRecord = {}
  Object.keys(TESTNET_CHAINS).forEach(chainKey => {
    initialMap[chainKey] = {
      chainKey,
      chainName: GATEWAY_CHAIN_NAMES[chainKey] || chainKey,
      usdc: '0.00',
      eurc: EURC_ADDRESSES[chainKey] ? '0.00' : undefined,
      cirbtc: CIRBTC_ADDRESSES[chainKey] ? '0.00000' : undefined,
      loading: false,
    }
  })
  return initialMap
}

export function useWalletTestnetBalances(walletAddress: string) {
  const queryClient = useQueryClient()
  const isAddressValid = Boolean(walletAddress && walletAddress.startsWith('0x'))

  const {
    data,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['walletTestnetBalances', walletAddress],
    queryFn: async (): Promise<WalletBalancesRecord> => {
      if (!isAddressValid) {
        return createInitialBalancesRecord()
      }

      const chainKeys = Object.keys(TESTNET_CHAINS)

      const results = await Promise.allSettled(
        chainKeys.map(async (chainKey) => {
          const chainDef = TESTNET_CHAINS[chainKey]
          const usdcAddress = USDC_ADDRESSES[chainKey]
          const eurcAddress = EURC_ADDRESSES[chainKey]
          const cirbtcAddress = CIRBTC_ADDRESSES[chainKey]

          if (!usdcAddress) {
            throw new Error(`USDC address missing for ${chainKey}`)
          }

          // Use pooled singleton resilient client with automatic multi-RPC failover
          const client = getResilientPublicClient(chainKey)

          // Fetch USDC balance with in-flight deduplication
          const usdcRaw = await resilientReadContract(client, {
            address: usdcAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [walletAddress as `0x${string}`],
          })
          const usdcFormatted = parseFloat(formatUnits(usdcRaw, 6)).toFixed(2)

          // Fetch EURC balance if defined
          let eurcFormatted: string | undefined = undefined
          if (eurcAddress) {
            try {
              const eurcRaw = await resilientReadContract(client, {
                address: eurcAddress,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [walletAddress as `0x${string}`],
              })
              eurcFormatted = parseFloat(formatUnits(eurcRaw, 6)).toFixed(2)
            } catch {
              eurcFormatted = '0.00'
            }
          }

          // Fetch cirBTC balance if defined (8 decimals)
          let cirbtcFormatted: string | undefined = undefined
          if (cirbtcAddress) {
            try {
              const cirbtcRaw = await resilientReadContract(client, {
                address: cirbtcAddress,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [walletAddress as `0x${string}`],
              })
              const rawUnits = parseFloat(formatUnits(cirbtcRaw, 8))
              cirbtcFormatted = rawUnits.toFixed(5)
            } catch (err) {
              console.warn(`[useWalletTestnetBalances] Failed to fetch cirBTC balance on ${chainKey}:`, err)
              cirbtcFormatted = '0.00000'
            }
          }

          return {
            chainKey,
            usdc: usdcFormatted,
            eurc: eurcFormatted,
            cirbtc: cirbtcFormatted,
          }
        })
      )

      const record: WalletBalancesRecord = {}
      results.forEach((res, index) => {
        const chainKey = chainKeys[index]
        if (res.status === 'fulfilled') {
          record[chainKey] = {
            chainKey,
            chainName: GATEWAY_CHAIN_NAMES[chainKey] || chainKey,
            usdc: res.value.usdc,
            eurc: res.value.eurc,
            cirbtc: res.value.cirbtc,
            loading: false,
          }
        } else {
          record[chainKey] = {
            chainKey,
            chainName: GATEWAY_CHAIN_NAMES[chainKey] || chainKey,
            usdc: '0.00',
            eurc: EURC_ADDRESSES[chainKey] ? '0.00' : undefined,
            cirbtc: CIRBTC_ADDRESSES[chainKey] ? '0.00000' : undefined,
            loading: false,
            error: res.reason?.message || 'RPC Query Failed',
          }
        }
      })

      return record
    },
    enabled: isAddressValid,
    staleTime: 15_000, // 15 seconds cache freshness
    gcTime: 1000 * 60 * 5, // 5 minutes retention
  })

  return {
    walletBalances: data || createInitialBalancesRecord(),
    loading: isLoading,
    isFetching,
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: ['walletTestnetBalances', walletAddress] })
      refetch()
    },
  }
}
