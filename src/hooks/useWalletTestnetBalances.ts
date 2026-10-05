// src/hooks/useWalletTestnetBalances.ts
//
// React hook for querying connected wallet's USDC (and EURC) balances
// across supported EVM testnet RPCs for Gateway deposit.

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { erc20Abi, formatUnits, type Chain } from 'viem'
import { USDC_ADDRESSES, EURC_ADDRESSES, CIRBTC_ADDRESSES, WETH_ADDRESSES, USYC_ADDRESSES, GATEWAY_CHAIN_NAMES } from '../config/gatewayConfig'
import { TESTNET_NETWORKS } from '../config/networks/networkRegistry'
import {
  getResilientPublicClient,
  resilientGetBalance,
  resilientMulticall,
} from '../services/rpc'
import { normalizeWalletAddress } from '../utils/address'
import { floorToPlaces } from '../utils/swapAmountUtils'

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

/** Token balances available from the hook. USDC is always fetched; the others can be skipped. */
export type WalletBalanceToken = 'USDC' | 'EURC' | 'cirBTC' | 'WETH' | 'USYC'

/**
 * Decimals and display precision for each fetchable token. Balances are floored through
 * `floorToPlaces` (swapAmountUtils) so a displayed value never exceeds the real on-chain amount.
 */
const TOKEN_FORMAT: Record<WalletBalanceToken, { decimals: number; places: number }> = {
  USDC: { decimals: 6, places: 2 },
  EURC: { decimals: 6, places: 2 },
  cirBTC: { decimals: 8, places: 5 },
  WETH: { decimals: 18, places: 4 },
  USYC: { decimals: 6, places: 2 },
}

/**
 * Cache key for the multi-chain wallet balance query.
 * Addresses are normalized and token subsets are sorted so a connect-time prefetch and every
 * consumer resolve to the same cache entry instead of re-reading the same chains.
 */
export function walletTestnetBalancesQueryKey(
  walletAddress: string,
  tokens?: readonly string[]
): readonly unknown[] {
  const normalizedAddress = normalizeWalletAddress(walletAddress)
  const tokenKey = tokens && tokens.length > 0 ? [...tokens].sort().join(',') : null
  return tokenKey
    ? (['walletTestnetBalances', normalizedAddress, tokenKey] as const)
    : (['walletTestnetBalances', normalizedAddress] as const)
}

export interface WalletTestnetBalancesOptions {
  /**
   * Optional token subset. USDC is always fetched (it drives deposit validation);
   * passing `['USDC']` (or an empty array) skips the extra EURC/cirBTC/WETH/USYC reads.
   */
  tokens?: WalletBalanceToken[]
  /** Allows callers to lazily fetch only while a flow (e.g. the deposit panel) is active. */
  enabled?: boolean
}

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
  walletAddress: string,
  tokens?: WalletBalanceToken[]
): Promise<WalletBalancesRecord> {
  const normalizedAddress = normalizeWalletAddress(walletAddress)
  const readAddress = normalizedAddress as `0x${string}`
  const isAddressValid = Boolean(normalizedAddress && normalizedAddress.startsWith('0x'))
  const wantsToken = (token: WalletBalanceToken) =>
    !tokens || tokens.length === 0 || tokens.includes(token)
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

      // Batch every requested token read for this chain into a single Multicall3 request.
      const requestedTokens: WalletBalanceToken[] = ['USDC']
      if (eurcAddress && wantsToken('EURC')) requestedTokens.push('EURC')
      if (cirbtcAddress && wantsToken('cirBTC')) requestedTokens.push('cirBTC')
      if (wethAddress && wantsToken('WETH')) requestedTokens.push('WETH')
      if (usycAddress && wantsToken('USYC')) requestedTokens.push('USYC')

      const tokenAddresses: Record<WalletBalanceToken, string | undefined> = {
        USDC: usdcAddress,
        EURC: eurcAddress,
        cirBTC: cirbtcAddress,
        WETH: wethAddress,
        USYC: usycAddress,
      }

      const multicallResults = await resilientMulticall<bigint>(
        client,
        requestedTokens.map((token) => ({
          address: tokenAddresses[token] as `0x${string}`,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [readAddress],
        })),
        { allowFailure: true }
      )

      const formatted: Partial<Record<WalletBalanceToken, string>> = {}
      requestedTokens.forEach((token, index) => {
        const result = multicallResults[index]
        const { decimals, places } = TOKEN_FORMAT[token]
        if (result && result.status === 'success') {
          formatted[token] = floorToPlaces(parseFloat(formatUnits(result.result, decimals)), places).toFixed(places)
          return
        }
        // USDC drives deposit validation: a failed read must fail the whole chain.
        if (token === 'USDC') {
          throw result?.error ?? new Error(`USDC read failed for ${chainKey}`)
        }
        console.warn(`[useWalletTestnetBalances] Failed to fetch ${token} balance on ${chainKey}:`, result?.error)
        formatted[token] = (0).toFixed(places)
      })

      const usdcFormatted = formatted.USDC as string

      const eurcFormatted = formatted.EURC
      const cirbtcFormatted = formatted.cirBTC
      const wethFormatted = formatted.WETH
      const usycFormatted = formatted.USYC

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
          const nativeBal = await resilientGetBalance(client, { address: readAddress })
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
        eurc: EURC_ADDRESSES[chainKey] && wantsToken('EURC') ? '0.00' : undefined,
        cirbtc: CIRBTC_ADDRESSES[chainKey] && wantsToken('cirBTC') ? '0.00000' : undefined,
        weth: WETH_ADDRESSES[chainKey] && wantsToken('WETH') ? '0.0000' : undefined,
        usyc: USYC_ADDRESSES[chainKey] && wantsToken('USYC') ? '0.00' : undefined,
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

export function useWalletTestnetBalances(
  walletAddress: string,
  options: WalletTestnetBalancesOptions = {}
) {
  const queryClient = useQueryClient()
  const { tokens, enabled = true } = options
  const normalizedAddress = normalizeWalletAddress(walletAddress)
  const isAddressValid = Boolean(normalizedAddress && normalizedAddress.startsWith('0x'))
  // The default (no token subset) keeps the original two-segment query key so existing
  // prefetches and consumers share the same cache entry.
  const tokenKey = tokens && tokens.length > 0 ? [...tokens].sort().join(',') : null
  const queryKey = useMemo(
    () => walletTestnetBalancesQueryKey(normalizedAddress, tokenKey ? tokenKey.split(',') : undefined),
    [normalizedAddress, tokenKey]
  )
  const baseQueryKey = useMemo(
    () => walletTestnetBalancesQueryKey(normalizedAddress),
    [normalizedAddress]
  )
  const isTokenSubset = queryKey.length > baseQueryKey.length
  // A warm full-record fetch (e.g. the connect-time prefetch) already holds every value a
  // token subset needs, so reuse it instead of re-reading the same chains.
  const sharedData = isTokenSubset
    ? queryClient.getQueryData<WalletBalancesRecord>(baseQueryKey)
    : undefined
  const sharedUpdatedAt = isTokenSubset
    ? queryClient.getQueryState(baseQueryKey)?.dataUpdatedAt
    : undefined

  const {
    data,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey,
    queryFn: () => fetchWalletTestnetBalancesData(normalizedAddress, tokens),
    enabled: isAddressValid && enabled,
    staleTime: 15_000, // 15 seconds cache freshness
    gcTime: 1000 * 60 * 5, // 5 minutes retention
    ...(sharedData && sharedUpdatedAt
      ? { initialData: sharedData, initialDataUpdatedAt: sharedUpdatedAt }
      : {}),
  })

  // Stable identities so callers can safely depend on these in effects. Prefix invalidation
  // refreshes every token-subset entry for this wallet.
  const refetchWalletBalances = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: baseQueryKey })
    return refetch()
  }, [queryClient, baseQueryKey, refetch])

  /** Marks cached wallet balances stale without triggering a fetch (query may be disabled). */
  const invalidateWalletBalances = useCallback(
    () => queryClient.invalidateQueries({ queryKey: baseQueryKey }),
    [queryClient, baseQueryKey]
  )

  return {
    walletBalances: data || createInitialBalancesRecord(),
    loading: isLoading,
    isFetching,
    hasData: data !== undefined,
    refetch: refetchWalletBalances,
    invalidate: invalidateWalletBalances,
  }
}
