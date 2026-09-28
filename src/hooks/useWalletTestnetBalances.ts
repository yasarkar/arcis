// src/hooks/useWalletTestnetBalances.ts
//
// React hook for querying connected wallet's USDC (and EURC) balances
// across supported EVM testnet RPCs for Gateway deposit.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { erc20Abi, formatUnits, type Chain } from 'viem'
import { USDC_ADDRESSES, EURC_ADDRESSES, CIRBTC_ADDRESSES, WETH_ADDRESSES, USYC_ADDRESSES, GATEWAY_CHAIN_NAMES } from '../config/gatewayConfig'
import { TESTNET_NETWORKS } from '../config/networks/networkRegistry'
import { getResilientPublicClient, resilientReadContract } from '../services/rpc'

export const TESTNET_CHAINS: Record<string, Chain> = Object.fromEntries(
  Object.entries(TESTNET_NETWORKS)
    .filter(([_, net]) => !net.ui?.isSolana && net.testnet)
    .map(([key, net]) => [key, net.viemChain])
)

export interface WalletNativeBalance {
  symbol: string
  name: string
  amount: string
  decimals: number
  isArcGas: boolean
}

export interface WalletChainBalance {
  chainKey: string
  chainName: string
  usdc: string
  eurc?: string
  cirbtc?: string
  weth?: string
  usyc?: string
  nativeAmount: string
  nativeSymbol: string
  nativeName: string
  nativeToken?: WalletNativeBalance
  loading: boolean
  error?: string
}

export type WalletBalancesRecord = Record<string, WalletChainBalance>

function createInitialBalancesRecord(): WalletBalancesRecord {
  const initialMap: WalletBalancesRecord = {}
  Object.keys(TESTNET_CHAINS).forEach(chainKey => {
    const net = TESTNET_NETWORKS[chainKey]
    const isArc = chainKey === 'Arc_Testnet' || chainKey === 'Arc'
    const symbol = isArc ? 'USDC' : (net?.nativeCurrency?.symbol || 'ETH')
    const name = isArc ? 'USDC (Native Gas)' : (net?.nativeCurrency?.name || 'Native Currency')
    initialMap[chainKey] = {
      chainKey,
      chainName: GATEWAY_CHAIN_NAMES[chainKey] || chainKey,
      usdc: '0.00',
      eurc: EURC_ADDRESSES[chainKey] ? '0.00' : undefined,
      cirbtc: CIRBTC_ADDRESSES[chainKey] ? '0.00000' : undefined,
      weth: WETH_ADDRESSES[chainKey] ? '0.0000' : undefined,
      usyc: USYC_ADDRESSES[chainKey] ? '0.00' : undefined,
      nativeAmount: '0.0000',
      nativeSymbol: symbol,
      nativeName: name,
      nativeToken: {
        symbol,
        name,
        amount: '0.0000',
        decimals: net?.nativeCurrency?.decimals ?? 18,
        isArcGas: isArc,
      },
      loading: false,
    }
  })
  return initialMap
}

export async function fetchWalletTestnetBalancesData(
  walletAddress: string
): Promise<WalletBalancesRecord> {
  const isAddressValid = Boolean(walletAddress && walletAddress.startsWith('0x'))
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
      const wethAddress = WETH_ADDRESSES[chainKey]
      const usycAddress = USYC_ADDRESSES[chainKey]

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

      // Fetch WETH balance if defined (18 decimals)
      let wethFormatted: string | undefined = undefined
      if (wethAddress) {
        try {
          const wethRaw = await resilientReadContract(client, {
            address: wethAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [walletAddress as `0x${string}`],
          })
          const rawUnits = parseFloat(formatUnits(wethRaw, 18))
          wethFormatted = rawUnits.toFixed(4)
        } catch (err) {
          console.warn(`[useWalletTestnetBalances] Failed to fetch WETH balance on ${chainKey}:`, err)
          wethFormatted = '0.0000'
        }
      }

      // Fetch USYC balance if defined (6 decimals)
      let usycFormatted: string | undefined = undefined
      if (usycAddress) {
        try {
          const usycRaw = await resilientReadContract(client, {
            address: usycAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [walletAddress as `0x${string}`],
          })
          const rawUnits = parseFloat(formatUnits(usycRaw, 6))
          usycFormatted = rawUnits.toFixed(2)
        } catch (err) {
          console.warn(`[useWalletTestnetBalances] Failed to fetch USYC balance on ${chainKey}:`, err)
          usycFormatted = '0.00'
        }
      }

      // Fetch Native Gas Currency balance
      const isArc = chainKey === 'Arc_Testnet' || chainKey === 'Arc'
      const netConfig = TESTNET_NETWORKS[chainKey]
      const nativeSymbol = isArc ? 'USDC' : (netConfig?.nativeCurrency?.symbol || 'ETH')
      const nativeName = isArc ? 'USDC (Native Gas)' : (netConfig?.nativeCurrency?.name || 'Native Gas')
      const nativeDecimals = netConfig?.nativeCurrency?.decimals ?? 18
      let nativeFormatted = '0.0000'

      if (isArc) {
        // On Arc, the native gas IS USDC (unified 1-to-1 balance pool).
        // To avoid double-counting and follow Arc guidelines, native gas amount is the USDC amount.
        nativeFormatted = usdcFormatted
      } else {
        try {
          const nativeBal = await client.getBalance({ address: walletAddress as `0x${string}` })
          const rawUnits = parseFloat(formatUnits(nativeBal, nativeDecimals))
          nativeFormatted = rawUnits < 0.0001 && rawUnits > 0 ? rawUnits.toFixed(5) : rawUnits.toFixed(4)
        } catch (err) {
          console.warn(`[useWalletTestnetBalances] Failed to fetch native balance on ${chainKey}:`, err)
          nativeFormatted = '0.0000'
        }
      }

      return {
        chainKey,
        usdc: usdcFormatted,
        eurc: eurcFormatted,
        cirbtc: cirbtcFormatted,
        weth: wethFormatted,
        usyc: usycFormatted,
        nativeAmount: nativeFormatted,
        nativeSymbol,
        nativeName,
        nativeToken: {
          symbol: nativeSymbol,
          name: nativeName,
          amount: nativeFormatted,
          decimals: nativeDecimals,
          isArcGas: isArc,
        },
      }
    })
  )

  const record: WalletBalancesRecord = {}
  results.forEach((res, index) => {
    const chainKey = chainKeys[index]
    const netConfig = TESTNET_NETWORKS[chainKey]
    const isArc = chainKey === 'Arc_Testnet' || chainKey === 'Arc'
    const defaultSymbol = isArc ? 'USDC' : (netConfig?.nativeCurrency?.symbol || 'ETH')
    const defaultName = isArc ? 'USDC (Native Gas)' : (netConfig?.nativeCurrency?.name || 'Native Currency')

    if (res.status === 'fulfilled') {
      record[chainKey] = {
        chainKey,
        chainName: GATEWAY_CHAIN_NAMES[chainKey] || chainKey,
        usdc: res.value.usdc,
        eurc: res.value.eurc,
        cirbtc: res.value.cirbtc,
        weth: res.value.weth,
        usyc: res.value.usyc,
        nativeAmount: res.value.nativeAmount,
        nativeSymbol: res.value.nativeSymbol,
        nativeName: res.value.nativeName,
        nativeToken: res.value.nativeToken,
        loading: false,
      }
    } else {
      record[chainKey] = {
        chainKey,
        chainName: GATEWAY_CHAIN_NAMES[chainKey] || chainKey,
        usdc: '0.00',
        eurc: EURC_ADDRESSES[chainKey] ? '0.00' : undefined,
        cirbtc: CIRBTC_ADDRESSES[chainKey] ? '0.00000' : undefined,
        weth: WETH_ADDRESSES[chainKey] ? '0.0000' : undefined,
        usyc: USYC_ADDRESSES[chainKey] ? '0.00' : undefined,
        nativeAmount: '0.0000',
        nativeSymbol: defaultSymbol,
        nativeName: defaultName,
        nativeToken: {
          symbol: defaultSymbol,
          name: defaultName,
          amount: '0.0000',
          decimals: netConfig?.nativeCurrency?.decimals ?? 18,
          isArcGas: isArc,
        },
        loading: false,
        error: res.reason?.message || 'RPC Query Failed',
      }
    }
  })

  return record
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
    queryFn: () => fetchWalletTestnetBalancesData(walletAddress),
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
      return refetch()
    },
  }
}
