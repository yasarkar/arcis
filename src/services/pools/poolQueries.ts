import type { QueryClient } from '@tanstack/react-query'
import {
  formatUnits,
  parseUnits,
  erc20Abi,
  type Address,
} from 'viem'
import {
  AMM_POOL_STATE_READ_FNS,
  ARCIS_POOLS,
  CONSTANT_PRODUCT_ABI,
  POOL_CONTRACTS,
  POOL_VERSION_V4,
  STABLE_SWAP_ABI,
  VAULT_SHARE_DECIMALS,
  YIELD_VAULT_ABI,
} from '../../config/poolsConfig'
import { redisCache } from '../redisCacheService'
import {
  getArcPublicClient,
  resilientMulticall,
  resilientReadContract,
} from '../rpc'
import {
  getCachedTokenPrice,
  getLiveTokenPrices,
  isLivePriceAvailable,
} from '../tokenPriceService'
import { safeStorage, poolsLog, type UserPoolPosition } from './poolTypes'
import { isDeployed } from './poolUtils'

export const ONCHAIN_POOL_STATE_QUERY_KEY = ['onchainPoolState'] as const

/**
 * Retrieves last persisted on-chain pool state from localStorage for instantaneous 0ms first-paint.
 */
export function getLastKnownPoolState(): Record<string, any> | undefined {
  try {
    const raw = safeStorage.get('arcis:pools:state:last')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        return parsed
      }
    }
  } catch (err) {
    poolsLog.debug('Persisted pool-state cache could not be read; waiting for the live read', err)
  }
  return undefined
}

/**
 * Public, wallet-independent on-chain pool state reader (StableSwap, ConstantProduct, YieldVault).
 * Queries reserves, total LP shares, and 24h volume metrics via multicall.
 */
export async function fetchOnchainPoolState(): Promise<Record<string, any>> {
  const cacheKey = 'arcis:pools:state'
  const cached = await redisCache.get<Record<string, any>>(cacheKey)
  if (cached && Object.keys(cached).length > 0) {
    return cached
  }

  const publicClient = getArcPublicClient()
  const state: Record<string, any> = {}

  // StableSwapPool (USDC/EURC) via Multicall3
  if (isDeployed(POOL_CONTRACTS.STABLE_SWAP_POOL)) {
    try {
      const fnNames = AMM_POOL_STATE_READ_FNS

      const calls = fnNames.map((fn) => ({
        address: POOL_CONTRACTS.STABLE_SWAP_POOL as Address,
        abi: STABLE_SWAP_ABI,
        functionName: fn,
      }))

      const results = await resilientMulticall(publicClient, calls, { allowFailure: true })
      const val = (idx: number, fallback: bigint = 0n) =>
        results[idx]?.status === 'success' ? (results[idx].result as bigint) : fallback

      state[POOL_CONTRACTS.STABLE_SWAP_POOL] = {
        reserveA: formatUnits(val(0), 6),
        reserveB: formatUnits(val(1), 6),
        totalLp: formatUnits(val(2), 18),
        unclaimedFeeA: formatUnits(val(3), 6),
        unclaimedFeeB: formatUnits(val(4), 6),
        ...(POOL_VERSION_V4
          ? { feeReserveA: formatUnits(val(5), 6), feeReserveB: formatUnits(val(6), 6) }
          : { accumulatedFeeA: formatUnits(val(5), 6), accumulatedFeeB: formatUnits(val(6), 6) }),
        swapFeeBps: Number(val(7, 12n)),
        volume24hA: formatUnits(val(8), 6),
        volume24hB: formatUnits(val(9), 6),
      }
    } catch (err) {
      console.warn('[usePoolsData] StableSwap multicall state read failed:', err)
    }
  }

  // ConstantProductPool (USDC/cirBTC) via Multicall3
  const cpAddresses = [
    POOL_CONTRACTS.CONSTANT_PRODUCT_POOL,
  ].filter((addr, idx, arr) => isDeployed(addr) && arr.indexOf(addr) === idx)

  for (const cpAddr of cpAddresses) {
    try {
      const fnNames = AMM_POOL_STATE_READ_FNS

      const calls = fnNames.map((fn) => ({
        address: cpAddr as Address,
        abi: CONSTANT_PRODUCT_ABI,
        functionName: fn,
      }))

      const results = await resilientMulticall(publicClient, calls, { allowFailure: true })
      const val = (idx: number, fallback: bigint = 0n) =>
        results[idx]?.status === 'success' ? (results[idx].result as bigint) : fallback

      state[cpAddr] = {
        reserveA: formatUnits(val(0), 6),
        reserveB: formatUnits(val(1), 8),
        totalLp: formatUnits(val(2), 18),
        unclaimedFeeA: formatUnits(val(3), 6),
        unclaimedFeeB: formatUnits(val(4), 8),
        ...(POOL_VERSION_V4
          ? { feeReserveA: formatUnits(val(5), 6), feeReserveB: formatUnits(val(6), 8) }
          : { accumulatedFeeA: formatUnits(val(5), 6), accumulatedFeeB: formatUnits(val(6), 8) }),
        swapFeeBps: Number(val(7, 25n)),
        volume24hA: formatUnits(val(8), 6),
        volume24hB: formatUnits(val(9), 8),
      }
    } catch (err) {
      console.warn(`[usePoolsData] ConstantProduct multicall state read failed for ${cpAddr}:`, err)
    }
  }

  // ConstantProductPool (USDC/WETH) via Multicall3
  if (isDeployed(POOL_CONTRACTS.WETH_POOL)) {
    try {
      const fnNames = AMM_POOL_STATE_READ_FNS

      const calls = fnNames.map((fn) => ({
        address: POOL_CONTRACTS.WETH_POOL as Address,
        abi: CONSTANT_PRODUCT_ABI,
        functionName: fn,
      }))

      const results = await resilientMulticall(publicClient, calls, { allowFailure: true })
      const val = (idx: number, fallback: bigint = 0n) =>
        results[idx]?.status === 'success' ? (results[idx].result as bigint) : fallback

      state[POOL_CONTRACTS.WETH_POOL] = {
        reserveA: formatUnits(val(0), 6),
        reserveB: formatUnits(val(1), 18),
        totalLp: formatUnits(val(2), 18),
        unclaimedFeeA: formatUnits(val(3), 6),
        unclaimedFeeB: formatUnits(val(4), 18),
        ...(POOL_VERSION_V4
          ? { feeReserveA: formatUnits(val(5), 6), feeReserveB: formatUnits(val(6), 18) }
          : { accumulatedFeeA: formatUnits(val(5), 6), accumulatedFeeB: formatUnits(val(6), 18) }),
        swapFeeBps: Number(val(7, 30n)),
        volume24hA: formatUnits(val(8), 6),
        volume24hB: formatUnits(val(9), 18),
      }
    } catch (err) {
      console.warn(`[usePoolsData] WETH ConstantProduct multicall state read failed:`, err)
    }
  }

  // ConstantProductPool (EURC/WETH) via Multicall3
  if (isDeployed(POOL_CONTRACTS.EURC_WETH_POOL)) {
    try {
      const fnNames = AMM_POOL_STATE_READ_FNS

      const calls = fnNames.map((fn) => ({
        address: POOL_CONTRACTS.EURC_WETH_POOL as Address,
        abi: CONSTANT_PRODUCT_ABI,
        functionName: fn,
      }))

      const results = await resilientMulticall(publicClient, calls, { allowFailure: true })
      const val = (idx: number, fallback: bigint = 0n) =>
        results[idx]?.status === 'success' ? (results[idx].result as bigint) : fallback

      state[POOL_CONTRACTS.EURC_WETH_POOL] = {
        reserveA: formatUnits(val(0), 6),
        reserveB: formatUnits(val(1), 18),
        totalLp: formatUnits(val(2), 18),
        unclaimedFeeA: formatUnits(val(3), 6),
        unclaimedFeeB: formatUnits(val(4), 18),
        ...(POOL_VERSION_V4
          ? { feeReserveA: formatUnits(val(5), 6), feeReserveB: formatUnits(val(6), 18) }
          : { accumulatedFeeA: formatUnits(val(5), 6), accumulatedFeeB: formatUnits(val(6), 18) }),
        swapFeeBps: Number(val(7, 30n)),
        volume24hA: formatUnits(val(8), 6),
        volume24hB: formatUnits(val(9), 18),
      }
    } catch (err) {
      console.warn(`[usePoolsData] EURC/WETH ConstantProduct multicall state read failed:`, err)
    }
  }

  // YieldVault (ERC-4626) via Multicall3
  if (isDeployed(POOL_CONTRACTS.YIELD_VAULT)) {
    try {
      const totalYieldAbi = [
        {
          type: 'function',
          name: 'totalYieldDistributed',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ type: 'uint256' }],
        },
      ] as const

      const calls = [
        { address: POOL_CONTRACTS.YIELD_VAULT as Address, abi: YIELD_VAULT_ABI, functionName: 'totalAssets' },
        { address: POOL_CONTRACTS.YIELD_VAULT as Address, abi: YIELD_VAULT_ABI, functionName: 'totalSupply' },
        { address: POOL_CONTRACTS.YIELD_VAULT as Address, abi: totalYieldAbi, functionName: 'totalYieldDistributed' },
        { address: POOL_CONTRACTS.YIELD_VAULT as Address, abi: YIELD_VAULT_ABI, functionName: 'decimals' },
      ]

      const results = await resilientMulticall(publicClient, calls, { allowFailure: true })
      const val = (idx: number) =>
        results[idx]?.status === 'success' ? (results[idx].result as bigint) : 0n

      const shareDecimals =
        results[3]?.status === 'success' && typeof results[3].result === 'number'
          ? results[3].result
          : VAULT_SHARE_DECIMALS

      state[POOL_CONTRACTS.YIELD_VAULT] = {
        totalAssets: formatUnits(val(0), 6),
        totalSupply: formatUnits(val(1), shareDecimals),
        totalYieldDistributed: formatUnits(val(2), 6),
        shareDecimals,
        volume24h: '0',
      }
    } catch (err) {
      console.warn('[usePoolsData] YieldVault multicall state read failed:', err)
    }
  }

  if (Object.keys(state).length > 0) {
    await redisCache.set(cacheKey, state, 20)
    try {
      safeStorage.set('arcis:pools:state:last', JSON.stringify(state))
    } catch (err) {
      poolsLog.debug('Pool-state first-paint mirror could not be persisted', err)
    }
  }

  return state
}

/**
 * Eagerly prefetches global pool states and live token prices into TanStack Query in the background.
 */
export async function prefetchPoolsData(queryClient: QueryClient): Promise<void> {
  if (!queryClient) return
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: ONCHAIN_POOL_STATE_QUERY_KEY,
      queryFn: fetchOnchainPoolState,
      staleTime: 30_000,
    }),
    queryClient.prefetchQuery({
      queryKey: ['liveTokenPrices'],
      queryFn: getLiveTokenPrices,
      staleTime: 30_000,
    }),
  ])
}

/**
 * Reads real wallet token balances (USDC, EURC, cirBTC, WETH) on Arc Testnet.
 */
export async function fetchOnchainPoolBalances(
  walletAddress: string
): Promise<{ usdc: string; eurc: string; cirbtc: string; weth: string }> {
  const isAddressValid = Boolean(walletAddress && walletAddress.startsWith('0x'))
  if (!isAddressValid) {
    return { usdc: '0.00', eurc: '0.00', cirbtc: '0.0000', weth: '0.0000' }
  }

  const cacheKey = `arcis:pools:balances:${walletAddress}`
  const cached = await redisCache.get<any>(cacheKey)
  if (cached) {
    return cached
  }

  const publicClient = getArcPublicClient()
  const targetAddr = walletAddress as `0x${string}`
  let usdcFormatted = '0.00'
  let eurcFormatted = '0.00'
  let cirbtcFormatted = '0.0000'
  let wethFormatted = '0.0000'

  try {
    const usdcRaw = (await resilientReadContract(publicClient, {
      address: POOL_CONTRACTS.USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [targetAddr],
    })) as bigint
    usdcFormatted = parseFloat(formatUnits(usdcRaw, 6)).toFixed(2)
  } catch (err) {
    console.warn('[usePoolsData] USDC read failed:', err)
  }

  try {
    const eurcRaw = (await resilientReadContract(publicClient, {
      address: POOL_CONTRACTS.EURC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [targetAddr],
    })) as bigint
    eurcFormatted = parseFloat(formatUnits(eurcRaw, 6)).toFixed(2)
  } catch {
    eurcFormatted = '0.00'
  }

  try {
    const cirbtcRaw = (await resilientReadContract(publicClient, {
      address: POOL_CONTRACTS.cirBTC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [targetAddr],
    })) as bigint
    const btcVal = parseFloat(formatUnits(cirbtcRaw, 8))
    cirbtcFormatted = btcVal > 0 ? (btcVal < 0.0001 ? btcVal.toFixed(8) : btcVal.toFixed(6)) : '0.000000'
  } catch {
    cirbtcFormatted = '0.000000'
  }

  try {
    const wethRaw = (await resilientReadContract(publicClient, {
      address: POOL_CONTRACTS.WETH,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [targetAddr],
    })) as bigint
    const wethVal = parseFloat(formatUnits(wethRaw, 18))
    wethFormatted = wethVal > 0 ? (wethVal < 0.0001 ? wethVal.toFixed(6) : wethVal.toFixed(4)) : '0.0000'
  } catch {
    wethFormatted = '0.0000'
  }

  const result = {
    usdc: usdcFormatted,
    eurc: eurcFormatted,
    cirbtc: cirbtcFormatted,
    weth: wethFormatted,
  }
  await redisCache.set(cacheKey, result, 20)
  return result
}

/**
 * Reads real user pool positions (ERC-4626 YieldVault, StableSwap LP, ConstantProduct LP) on Arc Testnet.
 */
export async function fetchUserPoolPositions(
  walletAddress: string,
  passedPoolState?: Record<string, any>,
  passedPrices?: { btc?: number; eurc?: number; weth?: number; eth?: number }
): Promise<Record<string, UserPoolPosition>> {
  const isAddressValid = Boolean(walletAddress && walletAddress.startsWith('0x'))
  if (!isAddressValid) return {}
  const targetAddr = walletAddress as `0x${string}`
  const cacheKey = `arcis:pools:positions:${walletAddress.toLowerCase()}`

  const cached = await redisCache.get<Record<string, UserPoolPosition>>(cacheKey)
  if (cached && Object.keys(cached).length > 0) {
    const freshTrusted = isLivePriceAvailable()
    return Object.fromEntries(
      Object.entries(cached).map(([k, v]) => [
        k,
        v.isLpPosition ? { ...v, priceUnavailable: !freshTrusted } : v,
      ])
    )
  }

  const publicClient = getArcPublicClient()
  const onchainPoolState = passedPoolState || (await fetchOnchainPoolState())
  const liveEurcPrice =
    passedPrices?.eurc && passedPrices.eurc > 0 ? passedPrices.eurc : getCachedTokenPrice('EURC')
  const liveBtcPrice =
    passedPrices?.btc && passedPrices.btc > 0 ? passedPrices.btc : getCachedTokenPrice('BTC')
  const liveEthPrice =
    passedPrices?.weth && passedPrices.weth > 0
      ? passedPrices.weth
      : passedPrices?.eth && passedPrices.eth > 0
      ? passedPrices.eth
      : getCachedTokenPrice('WETH') || getCachedTokenPrice('ETH') || 2600
  const isValuationTrusted = isLivePriceAvailable()

  const positions: Record<string, UserPoolPosition> = {}

  // 1. YieldVault (ERC-4626)
  if (isDeployed(POOL_CONTRACTS.YIELD_VAULT)) {
    try {
      const sharesRaw = (await resilientReadContract(publicClient, {
        address: POOL_CONTRACTS.YIELD_VAULT,
        abi: YIELD_VAULT_ABI,
        functionName: 'balanceOf',
        args: [targetAddr],
      })) as bigint

      if (sharesRaw > 0n) {
        let assetsUsdc = 0
        let userEarnedUsd = 0
        const vaultStateSnapshot = onchainPoolState?.[POOL_CONTRACTS.YIELD_VAULT]
        const shareDecimals =
          typeof vaultStateSnapshot?.shareDecimals === 'number'
            ? vaultStateSnapshot.shareDecimals
            : VAULT_SHARE_DECIMALS
        const principalUsdc = parseFloat(formatUnits(sharesRaw, shareDecimals))

        let rawVaultProfit = 0
        try {
          const previewAssets = (await resilientReadContract(publicClient, {
            address: POOL_CONTRACTS.YIELD_VAULT,
            abi: YIELD_VAULT_ABI,
            functionName: 'previewRedeem',
            args: [sharesRaw],
          })) as bigint
          assetsUsdc = parseFloat(formatUnits(previewAssets, 6))
          if (assetsUsdc > principalUsdc) {
            rawVaultProfit = assetsUsdc - principalUsdc
          }
        } catch {
          let totalAssets = 0n
          let totalSupply = 0n
          try {
            const [ta, ts] = await Promise.all([
              resilientReadContract(publicClient, { address: POOL_CONTRACTS.YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalAssets' }),
              resilientReadContract(publicClient, { address: POOL_CONTRACTS.YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalSupply' }),
            ])
            totalAssets = ta as bigint
            totalSupply = ts as bigint
          } catch (e) {
            console.warn('[usePoolsData] YieldVault direct stats fetch warning:', e)
            const vaultState = onchainPoolState?.[POOL_CONTRACTS.YIELD_VAULT]
            totalAssets = vaultState?.totalAssets ? parseUnits(vaultState.totalAssets, 6) : 0n
            totalSupply = vaultState?.totalSupply ? parseUnits(vaultState.totalSupply, shareDecimals) : 0n
          }

          if (totalSupply > 0n && totalAssets > 0n) {
            const userAssetsRaw = (sharesRaw * totalAssets) / totalSupply
            assetsUsdc = parseFloat(formatUnits(userAssetsRaw, 6))
            if (assetsUsdc > principalUsdc) {
              rawVaultProfit = assetsUsdc - principalUsdc
            }
          } else {
            assetsUsdc = principalUsdc
          }
        }

        let liveTotalSupply = 0n
        try {
          liveTotalSupply = (await resilientReadContract(publicClient, {
            address: POOL_CONTRACTS.YIELD_VAULT,
            abi: YIELD_VAULT_ABI,
            functionName: 'totalSupply',
          })) as bigint
        } catch {
          const vaultState = onchainPoolState?.[POOL_CONTRACTS.YIELD_VAULT]
          liveTotalSupply = vaultState?.totalSupply ? parseUnits(vaultState.totalSupply, shareDecimals) : 0n
        }

        const poolSharePct = liveTotalSupply > 0n
          ? Math.min(100, Math.max(0, parseFloat(((Number(sharesRaw) / Number(liveTotalSupply)) * 100).toFixed(2))))
          : 0

        if (POOL_VERSION_V4) {
          try {
            const pendingRaw = (await resilientReadContract(publicClient, {
              address: POOL_CONTRACTS.YIELD_VAULT,
              abi: YIELD_VAULT_ABI,
              functionName: 'pendingYield',
              args: [targetAddr],
            })) as bigint
            userEarnedUsd = parseFloat(formatUnits(pendingRaw || 0n, 6))
          } catch (e) {
            console.warn('[usePoolsData] YieldVault pendingYield read failed:', e)
          }
        }

        positions['usdc-yield-vault'] = {
          poolId: 'usdc-yield-vault',
          stakedAmount: assetsUsdc.toFixed(2),
          stakedUsd: assetsUsdc,
          earnedRewards: userEarnedUsd > 0 ? (userEarnedUsd < 0.0001 ? userEarnedUsd.toFixed(6) : userEarnedUsd.toFixed(4)) : '0.00',
          earnedUsd: userEarnedUsd,
          lastUpdatedTimestamp: Date.now(),
          lpTokenBalance: formatUnits(sharesRaw, shareDecimals),
          poolSharePct,
          earnedFeesUsd: rawVaultProfit,
        }
      }
    } catch (err) {
      console.warn('[usePoolsData] YieldVault user balance read failed:', err)
    }
  }

  // 2. StableSwapPool (USDC / EURC LP)
  if (isDeployed(POOL_CONTRACTS.STABLE_SWAP_POOL)) {
    try {
      const lpRaw = (await resilientReadContract(publicClient, {
        address: POOL_CONTRACTS.STABLE_SWAP_POOL,
        abi: STABLE_SWAP_ABI,
        functionName: 'balanceOf',
        args: [targetAddr],
      })) as bigint

      if (lpRaw > 0n) {
        let reserveA = 0n
        let reserveB = 0n
        let totalLp = 0n
        let unclaimedA = 0n
        let unclaimedB = 0n

        try {
          const [rA, rB, tLp, uA, uB] = await Promise.all([
            resilientReadContract(publicClient, { address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }),
            resilientReadContract(publicClient, { address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }),
            resilientReadContract(publicClient, { address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }),
            resilientReadContract(publicClient, { address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'unclaimedFeeA' }),
            resilientReadContract(publicClient, { address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'unclaimedFeeB' }),
          ])
          reserveA = rA as bigint
          reserveB = rB as bigint
          totalLp = tLp as bigint
          unclaimedA = (uA as bigint) || 0n
          unclaimedB = (uB as bigint) || 0n
        } catch (e) {
          console.warn('[usePoolsData] StableSwap direct reserves fetch warning:', e)
          const poolState = onchainPoolState?.[POOL_CONTRACTS.STABLE_SWAP_POOL]
          totalLp = poolState?.totalLp ? parseUnits(poolState.totalLp, 18) : 0n
          reserveA = poolState?.reserveA ? parseUnits(poolState.reserveA, 6) : 0n
          reserveB = poolState?.reserveB ? parseUnits(poolState.reserveB, 6) : 0n
          unclaimedA = poolState?.unclaimedFeeA ? parseUnits(poolState.unclaimedFeeA, 6) : 0n
          unclaimedB = poolState?.unclaimedFeeB ? parseUnits(poolState.unclaimedFeeB, 6) : 0n
        }

        let stakedUsd = 0
        let userA = 0
        let userB = 0
        let poolSharePct = 0
        let userEarnedUsd = 0
        let rawFeeShareUsd = 0

        if (totalLp > 0n) {
          const userARaw = (reserveA * lpRaw) / totalLp
          const userBRaw = (reserveB * lpRaw) / totalLp
          userA = parseFloat(formatUnits(userARaw, 6))
          userB = parseFloat(formatUnits(userBRaw, 6))
          const exchangeRate = liveEurcPrice
          stakedUsd = userA + userB * exchangeRate
          poolSharePct = Math.min(100, Math.max(0, parseFloat(((Number(lpRaw) / Number(totalLp)) * 100).toFixed(2))))

          const ufA = parseFloat(formatUnits(unclaimedA, 6))
          const ufB = parseFloat(formatUnits(unclaimedB, 6))
          const totalPoolUnclaimedUsd = ufA + ufB * liveEurcPrice
          rawFeeShareUsd = poolSharePct > 0 ? (totalPoolUnclaimedUsd * poolSharePct) / 100 : 0

          if (POOL_VERSION_V4) {
            try {
              const pending = (await resilientReadContract(publicClient, {
                address: POOL_CONTRACTS.STABLE_SWAP_POOL,
                abi: STABLE_SWAP_ABI,
                functionName: 'pendingFees',
                args: [targetAddr],
              })) as readonly [bigint, bigint]
              const claimableUsd =
                parseFloat(formatUnits(pending?.[0] || 0n, 6)) +
                parseFloat(formatUnits(pending?.[1] || 0n, 6)) * liveEurcPrice
              rawFeeShareUsd = claimableUsd
              userEarnedUsd = claimableUsd
            } catch (e) {
              console.warn('[usePoolsData] StableSwap pendingFees read failed:', e)
            }
          }
        } else {
          stakedUsd = 0
        }

        positions['usdc-eurc-stable-pool'] = {
          poolId: 'usdc-eurc-stable-pool',
          stakedAmount: stakedUsd.toFixed(2),
          stakedUsd,
          earnedRewards: userEarnedUsd > 0 ? (userEarnedUsd < 0.0001 ? userEarnedUsd.toFixed(6) : userEarnedUsd.toFixed(4)) : '0.00',
          earnedUsd: userEarnedUsd,
          lastUpdatedTimestamp: Date.now(),
          isLpPosition: true,
          lpTokenBalance: formatUnits(lpRaw, 18),
          poolSharePct,
          tokenAStaked: userA.toFixed(2),
          tokenBStaked: userB.toFixed(2),
          earnedFeesUsd: rawFeeShareUsd,
          priceUnavailable: !isValuationTrusted || !(totalLp > 0n),
        }
      }
    } catch (err) {
      console.warn('[usePoolsData] StableSwap user balance read failed:', err)
    }
  }

  // 3. ConstantProductPool (USDC / cirBTC LP)
  const cirBtcPool = ARCIS_POOLS.find((p) => p.id === 'usdc-cirbtc-pool')
  const cpAddress = cirBtcPool?.contractAddress || POOL_CONTRACTS.CONSTANT_PRODUCT_POOL
  if (isDeployed(cpAddress)) {
    try {
      const lpRaw = (await resilientReadContract(publicClient, {
        address: cpAddress,
        abi: CONSTANT_PRODUCT_ABI,
        functionName: 'balanceOf',
        args: [targetAddr],
      })) as bigint
      if (lpRaw > 0n) {
        let reserveA = 0n
        let reserveB = 0n
        let totalLp = 0n
        let unclaimedA = 0n
        let unclaimedB = 0n

        try {
          const [rA, rB, tLp, uA, uB] = await Promise.all([
            resilientReadContract(publicClient, { address: cpAddress, abi: CONSTANT_PRODUCT_ABI, functionName: 'reserveA' }),
            resilientReadContract(publicClient, { address: cpAddress, abi: CONSTANT_PRODUCT_ABI, functionName: 'reserveB' }),
            resilientReadContract(publicClient, { address: cpAddress, abi: CONSTANT_PRODUCT_ABI, functionName: 'totalLp' }),
            resilientReadContract(publicClient, { address: cpAddress, abi: CONSTANT_PRODUCT_ABI, functionName: 'unclaimedFeeA' }),
            resilientReadContract(publicClient, { address: cpAddress, abi: CONSTANT_PRODUCT_ABI, functionName: 'unclaimedFeeB' }),
          ])
          reserveA = rA as bigint
          reserveB = rB as bigint
          totalLp = tLp as bigint
          unclaimedA = (uA as bigint) || 0n
          unclaimedB = (uB as bigint) || 0n
        } catch (e) {
          console.warn('[usePoolsData] ConstantProduct direct reserves fetch warning:', e)
          const poolState = onchainPoolState?.[cpAddress]
          totalLp = poolState?.totalLp ? parseUnits(poolState.totalLp, 18) : 0n
          reserveA = poolState?.reserveA ? parseUnits(poolState.reserveA, 6) : 0n
          reserveB = poolState?.reserveB ? parseUnits(poolState.reserveB, 8) : 0n
          unclaimedA = poolState?.unclaimedFeeA ? parseUnits(poolState.unclaimedFeeA, 6) : 0n
          unclaimedB = poolState?.unclaimedFeeB ? parseUnits(poolState.unclaimedFeeB, 8) : 0n
        }

        let stakedUsd = 0
        let userA = 0
        let userB = 0
        let poolSharePct = 0
        let userEarnedUsd = 0
        let rawFeeShareUsd = 0

        if (totalLp > 0n) {
          const userARaw = (reserveA * lpRaw) / totalLp
          const userBRaw = (reserveB * lpRaw) / totalLp
          userA = parseFloat(formatUnits(userARaw, 6))
          userB = parseFloat(formatUnits(userBRaw, 8))
          const btcPrice = liveBtcPrice
          stakedUsd = userA + userB * btcPrice
          poolSharePct = Math.min(100, Math.max(0, parseFloat(((Number(lpRaw) / Number(totalLp)) * 100).toFixed(2))))

          const ufA = parseFloat(formatUnits(unclaimedA, 6))
          const ufB = parseFloat(formatUnits(unclaimedB, 8))
          const totalPoolUnclaimedUsd = ufA + ufB * liveBtcPrice
          rawFeeShareUsd = poolSharePct > 0 ? (totalPoolUnclaimedUsd * poolSharePct) / 100 : 0

          if (POOL_VERSION_V4) {
            try {
              const pending = (await resilientReadContract(publicClient, {
                address: cpAddress,
                abi: CONSTANT_PRODUCT_ABI,
                functionName: 'pendingFees',
                args: [targetAddr],
              })) as readonly [bigint, bigint]
              const claimableUsd =
                parseFloat(formatUnits(pending?.[0] || 0n, 6)) +
                parseFloat(formatUnits(pending?.[1] || 0n, 8)) * liveBtcPrice
              rawFeeShareUsd = claimableUsd
              userEarnedUsd = claimableUsd
            } catch (e) {
              console.warn('[usePoolsData] ConstantProduct pendingFees read failed:', e)
            }
          }
        } else {
          stakedUsd = 0
        }

        const poolIdKey = cirBtcPool?.id || 'usdc-cirbtc-pool'
        positions[poolIdKey] = {
          poolId: poolIdKey,
          stakedAmount: stakedUsd.toFixed(2),
          stakedUsd,
          earnedRewards: userEarnedUsd > 0 ? (userEarnedUsd < 0.0001 ? userEarnedUsd.toFixed(6) : userEarnedUsd.toFixed(4)) : '0.00',
          earnedUsd: userEarnedUsd,
          lastUpdatedTimestamp: Date.now(),
          isLpPosition: true,
          lpTokenBalance: formatUnits(lpRaw, 18),
          poolSharePct,
          tokenAStaked: userA.toFixed(2),
          tokenBStaked: userB < 0.001 ? userB.toFixed(6) : userB.toFixed(4),
          earnedFeesUsd: rawFeeShareUsd,
          priceUnavailable: !isValuationTrusted || !(totalLp > 0n),
        }
      }
    } catch (err) {
      console.warn('[usePoolsData] ConstantProduct user balance read failed:', err)
    }
  }

  // 4. ConstantProductPool (USDC/WETH) user balance read
  const wethPoolAddress = POOL_CONTRACTS.WETH_POOL
  if (isDeployed(wethPoolAddress)) {
    try {
      const lpRaw = (await resilientReadContract(publicClient, {
        address: wethPoolAddress as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [targetAddr],
      })) as bigint

      if (lpRaw > 0n) {
        let reserveA = 0n
        let reserveB = 0n
        let totalLp = 0n
        let unclaimedA = 0n
        let unclaimedB = 0n

        try {
          const [rA, rB, tLp, uA, uB] = await Promise.all([
            resilientReadContract(publicClient, { address: wethPoolAddress as Address, abi: CONSTANT_PRODUCT_ABI, functionName: 'reserveA' }),
            resilientReadContract(publicClient, { address: wethPoolAddress as Address, abi: CONSTANT_PRODUCT_ABI, functionName: 'reserveB' }),
            resilientReadContract(publicClient, { address: wethPoolAddress as Address, abi: CONSTANT_PRODUCT_ABI, functionName: 'totalLp' }),
            resilientReadContract(publicClient, { address: wethPoolAddress as Address, abi: CONSTANT_PRODUCT_ABI, functionName: 'unclaimedFeeA' }),
            resilientReadContract(publicClient, { address: wethPoolAddress as Address, abi: CONSTANT_PRODUCT_ABI, functionName: 'unclaimedFeeB' }),
          ])
          reserveA = rA as bigint
          reserveB = rB as bigint
          totalLp = tLp as bigint
          unclaimedA = (uA as bigint) || 0n
          unclaimedB = (uB as bigint) || 0n
        } catch (e) {
          const poolState = onchainPoolState?.[wethPoolAddress]
          totalLp = poolState?.totalLp ? parseUnits(poolState.totalLp, 18) : 0n
          reserveA = poolState?.reserveA ? parseUnits(poolState.reserveA, 6) : 0n
          reserveB = poolState?.reserveB ? parseUnits(poolState.reserveB, 18) : 0n
          unclaimedA = poolState?.unclaimedFeeA ? parseUnits(poolState.unclaimedFeeA, 6) : 0n
          unclaimedB = poolState?.unclaimedFeeB ? parseUnits(poolState.unclaimedFeeB, 18) : 0n
        }

        let stakedUsd = 0
        let userA = 0
        let userB = 0
        let poolSharePct = 0
        let userEarnedUsd = 0
        let rawFeeShareUsd = 0

        if (totalLp > 0n) {
          const userARaw = (reserveA * lpRaw) / totalLp
          const userBRaw = (reserveB * lpRaw) / totalLp
          userA = parseFloat(formatUnits(userARaw, 6))
          userB = parseFloat(formatUnits(userBRaw, 18))
          stakedUsd = userA + userB * liveEthPrice
          poolSharePct = Math.min(100, Math.max(0, parseFloat(((Number(lpRaw) / Number(totalLp)) * 100).toFixed(2))))

          const ufA = parseFloat(formatUnits(unclaimedA, 6))
          const ufB = parseFloat(formatUnits(unclaimedB, 18))
          const totalPoolUnclaimedUsd = ufA + ufB * liveEthPrice
          rawFeeShareUsd = poolSharePct > 0 ? (totalPoolUnclaimedUsd * poolSharePct) / 100 : 0

          if (POOL_VERSION_V4) {
            try {
              const pending = (await resilientReadContract(publicClient, {
                address: wethPoolAddress as Address,
                abi: CONSTANT_PRODUCT_ABI,
                functionName: 'pendingFees',
                args: [targetAddr],
              })) as readonly [bigint, bigint]
              const claimableUsd =
                parseFloat(formatUnits(pending?.[0] || 0n, 6)) +
                parseFloat(formatUnits(pending?.[1] || 0n, 18)) * liveEthPrice
              rawFeeShareUsd = claimableUsd
              userEarnedUsd = claimableUsd
            } catch (e) {
              console.warn('[usePoolsData] WETH ConstantProduct pendingFees read failed:', e)
            }
          }
        }

        positions['usdc-weth-pool'] = {
          poolId: 'usdc-weth-pool',
          stakedAmount: stakedUsd.toFixed(2),
          stakedUsd,
          earnedRewards: userEarnedUsd > 0 ? (userEarnedUsd < 0.0001 ? userEarnedUsd.toFixed(6) : userEarnedUsd.toFixed(4)) : '0.00',
          earnedUsd: userEarnedUsd,
          lastUpdatedTimestamp: Date.now(),
          isLpPosition: true,
          lpTokenBalance: formatUnits(lpRaw, 18),
          poolSharePct,
          tokenAStaked: userA.toFixed(2),
          tokenBStaked: userB < 0.001 ? userB.toFixed(6) : userB.toFixed(4),
          earnedFeesUsd: rawFeeShareUsd,
          priceUnavailable: !isValuationTrusted || !(totalLp > 0n),
        }
      }
    } catch (err) {
      console.warn('[usePoolsData] WETH ConstantProduct user balance read failed:', err)
    }
  }

  // 5. ConstantProductPool (EURC/WETH) user balance read
  const eurcWethPoolAddress = POOL_CONTRACTS.EURC_WETH_POOL
  if (isDeployed(eurcWethPoolAddress)) {
    try {
      const lpRaw = (await resilientReadContract(publicClient, {
        address: eurcWethPoolAddress as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [targetAddr],
      })) as bigint

      if (lpRaw > 0n) {
        let reserveA = 0n
        let reserveB = 0n
        let totalLp = 0n
        let unclaimedA = 0n
        let unclaimedB = 0n

        try {
          const [rA, rB, tLp, uA, uB] = await Promise.all([
            resilientReadContract(publicClient, { address: eurcWethPoolAddress as Address, abi: CONSTANT_PRODUCT_ABI, functionName: 'reserveA' }),
            resilientReadContract(publicClient, { address: eurcWethPoolAddress as Address, abi: CONSTANT_PRODUCT_ABI, functionName: 'reserveB' }),
            resilientReadContract(publicClient, { address: eurcWethPoolAddress as Address, abi: CONSTANT_PRODUCT_ABI, functionName: 'totalLp' }),
            resilientReadContract(publicClient, { address: eurcWethPoolAddress as Address, abi: CONSTANT_PRODUCT_ABI, functionName: 'unclaimedFeeA' }),
            resilientReadContract(publicClient, { address: eurcWethPoolAddress as Address, abi: CONSTANT_PRODUCT_ABI, functionName: 'unclaimedFeeB' }),
          ])
          reserveA = rA as bigint
          reserveB = rB as bigint
          totalLp = tLp as bigint
          unclaimedA = (uA as bigint) || 0n
          unclaimedB = (uB as bigint) || 0n
        } catch (e) {
          const poolState = onchainPoolState?.[eurcWethPoolAddress]
          totalLp = poolState?.totalLp ? parseUnits(poolState.totalLp, 18) : 0n
          reserveA = poolState?.reserveA ? parseUnits(poolState.reserveA, 6) : 0n
          reserveB = poolState?.reserveB ? parseUnits(poolState.reserveB, 18) : 0n
          unclaimedA = poolState?.unclaimedFeeA ? parseUnits(poolState.unclaimedFeeA, 6) : 0n
          unclaimedB = poolState?.unclaimedFeeB ? parseUnits(poolState.unclaimedFeeB, 18) : 0n
        }

        let stakedUsd = 0
        let userA = 0
        let userB = 0
        let poolSharePct = 0
        let userEarnedUsd = 0
        let rawFeeShareUsd = 0

        if (totalLp > 0n) {
          const userARaw = (reserveA * lpRaw) / totalLp
          const userBRaw = (reserveB * lpRaw) / totalLp
          userA = parseFloat(formatUnits(userARaw, 6))
          userB = parseFloat(formatUnits(userBRaw, 18))
          stakedUsd = userA * liveEurcPrice + userB * liveEthPrice
          poolSharePct = Math.min(100, Math.max(0, parseFloat(((Number(lpRaw) / Number(totalLp)) * 100).toFixed(2))))

          const ufA = parseFloat(formatUnits(unclaimedA, 6))
          const ufB = parseFloat(formatUnits(unclaimedB, 18))
          const totalPoolUnclaimedUsd = ufA * liveEurcPrice + ufB * liveEthPrice
          rawFeeShareUsd = poolSharePct > 0 ? (totalPoolUnclaimedUsd * poolSharePct) / 100 : 0

          if (POOL_VERSION_V4) {
            try {
              const pending = (await resilientReadContract(publicClient, {
                address: eurcWethPoolAddress as Address,
                abi: CONSTANT_PRODUCT_ABI,
                functionName: 'pendingFees',
                args: [targetAddr],
              })) as readonly [bigint, bigint]
              const claimableUsd =
                parseFloat(formatUnits(pending?.[0] || 0n, 6)) * liveEurcPrice +
                parseFloat(formatUnits(pending?.[1] || 0n, 18)) * liveEthPrice
              rawFeeShareUsd = claimableUsd
              userEarnedUsd = claimableUsd
            } catch (e) {
              console.warn('[usePoolsData] EURC/WETH ConstantProduct pendingFees read failed:', e)
            }
          }
        }

        positions['eurc-weth-pool'] = {
          poolId: 'eurc-weth-pool',
          stakedAmount: stakedUsd.toFixed(2),
          stakedUsd,
          earnedRewards: userEarnedUsd > 0 ? (userEarnedUsd < 0.0001 ? userEarnedUsd.toFixed(6) : userEarnedUsd.toFixed(4)) : '0.00',
          earnedUsd: userEarnedUsd,
          lastUpdatedTimestamp: Date.now(),
          isLpPosition: true,
          lpTokenBalance: formatUnits(lpRaw, 18),
          poolSharePct,
          tokenAStaked: userA.toFixed(2),
          tokenBStaked: userB < 0.001 ? userB.toFixed(6) : userB.toFixed(4),
          earnedFeesUsd: rawFeeShareUsd,
          priceUnavailable: !isValuationTrusted || !(totalLp > 0n),
        }
      }
    } catch (err) {
      console.warn('[usePoolsData] EURC/WETH ConstantProduct user balance read failed:', err)
    }
  }

  if (Object.keys(positions).length > 0) {
    await redisCache.set(cacheKey, positions, 20)
  }
  return positions
}

/**
 * Eagerly prefetches user wallet token balances and staking positions into TanStack Query cache.
 */
export async function prefetchUserWalletPoolsData(
  queryClient: QueryClient,
  walletAddress: string
): Promise<void> {
  if (!queryClient || !walletAddress || !walletAddress.startsWith('0x')) return
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: ['onchainPoolBalances', walletAddress],
      queryFn: () => fetchOnchainPoolBalances(walletAddress),
      staleTime: 30_000,
    }),
    queryClient.prefetchQuery({
      queryKey: ['userPoolPositions', walletAddress],
      queryFn: () => fetchUserPoolPositions(walletAddress),
      staleTime: 20_000,
    }),
  ])
}
