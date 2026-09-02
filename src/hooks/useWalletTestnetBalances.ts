// src/hooks/useWalletTestnetBalances.ts
//
// React hook for querying connected wallet's USDC (and EURC) balances
// across supported EVM testnet RPCs for Gateway deposit.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createPublicClient, http, erc20Abi, formatUnits, type Chain } from 'viem'
import { USDC_ADDRESSES, EURC_ADDRESSES, CIRBTC_ADDRESSES, GATEWAY_CHAIN_NAMES } from '../config/gatewayConfig'
import { arcTestnet } from '../config/arcChain'
import { sepolia, baseSepolia, arbitrumSepolia, optimismSepolia, polygonAmoy, avalancheFuji } from 'wagmi/chains'
import { hyperEVMTestnet, seiTestnet, sonicTestnet, unichainSepolia, worldChainSepolia } from '../config/wagmi'

export const TESTNET_CHAINS: Record<string, Chain> = {
  Arc_Testnet: arcTestnet,
  Ethereum_Sepolia: sepolia,
  Base_Sepolia: baseSepolia,
  Arbitrum_Sepolia: arbitrumSepolia,
  Optimism_Sepolia: optimismSepolia,
  Polygon_Amoy_Testnet: polygonAmoy,
  Avalanche_Fuji: avalancheFuji,
  HyperEVM_Testnet: hyperEVMTestnet,
  Sei_Testnet: seiTestnet,
  Sonic_Testnet: sonicTestnet,
  Unichain_Sepolia: unichainSepolia,
  World_Chain_Sepolia: worldChainSepolia,
}

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

          const rpcUrl = chainDef.rpcUrls?.default?.http?.[0]
          if (!rpcUrl || !usdcAddress) {
            throw new Error(`RPC URL or USDC address missing for ${chainKey}`)
          }

          const client = createPublicClient({
            chain: chainDef,
            transport: http(rpcUrl, { timeout: 6000, retryCount: 1 }),
          })

          // Fetch USDC balance
          const usdcRaw = await client.readContract({
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
              const eurcRaw = await client.readContract({
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
              const cirbtcRaw = await client.readContract({
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
