import type { QueryClient } from '@tanstack/react-query'
import {
  formatUnits,
  parseUnits,
  erc20Abi,
  type Abi,
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
import { normalizeWalletAddress } from '../../utils/address'
import {
  LIVE_TOKEN_PRICES_QUERY_KEY,
  ONCHAIN_POOL_STATE_QUERY_KEY,
  onchainPoolBalancesQueryKey,
  userPoolPositionsQueryKey,
} from '../../config/queryKeys'

export {
  ONCHAIN_POOL_STATE_QUERY_KEY,
  onchainPoolBalancesQueryKey,
  userPoolPositionsQueryKey,
}

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

  // ConstantProductPool (EURC/cirBTC) via Multicall3
  if (isDeployed(POOL_CONTRACTS.EURC_CIRBTC_POOL)) {
    try {
      const fnNames = AMM_POOL_STATE_READ_FNS

      const calls = fnNames.map((fn) => ({
        address: POOL_CONTRACTS.EURC_CIRBTC_POOL as Address,
        abi: CONSTANT_PRODUCT_ABI,
        functionName: fn,
      }))

      const results = await resilientMulticall(publicClient, calls, { allowFailure: true })
      const val = (idx: number, fallback: bigint = 0n) =>
        results[idx]?.status === 'success' ? (results[idx].result as bigint) : fallback

      state[POOL_CONTRACTS.EURC_CIRBTC_POOL] = {
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
      console.warn(`[usePoolsData] EURC/cirBTC ConstantProduct multicall state read failed:`, err)
    }
  }

  // ConstantProductPool (cirBTC/WETH) via Multicall3
  if (isDeployed(POOL_CONTRACTS.CIRBTC_WETH_POOL)) {
    try {
      const fnNames = AMM_POOL_STATE_READ_FNS

      const calls = fnNames.map((fn) => ({
        address: POOL_CONTRACTS.CIRBTC_WETH_POOL as Address,
        abi: CONSTANT_PRODUCT_ABI,
        functionName: fn,
      }))

      const results = await resilientMulticall(publicClient, calls, { allowFailure: true })
      const val = (idx: number, fallback: bigint = 0n) =>
        results[idx]?.status === 'success' ? (results[idx].result as bigint) : fallback

      state[POOL_CONTRACTS.CIRBTC_WETH_POOL] = {
        reserveA: formatUnits(val(0), 8),
        reserveB: formatUnits(val(1), 18),
        totalLp: formatUnits(val(2), 18),
        unclaimedFeeA: formatUnits(val(3), 8),
        unclaimedFeeB: formatUnits(val(4), 18),
        ...(POOL_VERSION_V4
          ? { feeReserveA: formatUnits(val(5), 8), feeReserveB: formatUnits(val(6), 18) }
          : { accumulatedFeeA: formatUnits(val(5), 8), accumulatedFeeB: formatUnits(val(6), 18) }),
        swapFeeBps: Number(val(7, 30n)),
        volume24hA: formatUnits(val(8), 8),
        volume24hB: formatUnits(val(9), 18),
      }
    } catch (err) {
      console.warn(`[usePoolsData] cirBTC/WETH ConstantProduct multicall state read failed:`, err)
    }
  }

  // YieldVault (ERC-4626) via Multicall3
  if (isDeployed(POOL_CONTRACTS.YIELD_VAULT)) {
    try {
      const totalYieldAbi = [
        {
          name: 'totalYieldDistributed',
          type: 'function',
          stateMutability: 'view',
          inputs: [],
          outputs: [{ name: '', type: 'uint256' }],
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
      queryKey: LIVE_TOKEN_PRICES_QUERY_KEY,
      queryFn: getLiveTokenPrices,
      staleTime: 30_000,
    }),
  ])
}

/**
 * Reads real wallet token balances (USDC, EURC, cirBTC, WETH) on Arc Testnet
 * in a single Multicall3 round-trip.
 */
export async function fetchOnchainPoolBalances(
  walletAddress: string
): Promise<{ usdc: string; eurc: string; cirbtc: string; weth: string }> {
  const normalizedAddress = normalizeWalletAddress(walletAddress)
  const isAddressValid = Boolean(normalizedAddress && normalizedAddress.startsWith('0x'))
  if (!isAddressValid) {
    return { usdc: '0.00', eurc: '0.00', cirbtc: '0.0000', weth: '0.0000' }
  }

  const publicClient = getArcPublicClient()
  const targetAddr = normalizedAddress as `0x${string}`

  const calls = [
    { address: POOL_CONTRACTS.USDC as Address, abi: erc20Abi, functionName: 'balanceOf', args: [targetAddr] },
    { address: POOL_CONTRACTS.EURC as Address, abi: erc20Abi, functionName: 'balanceOf', args: [targetAddr] },
    { address: POOL_CONTRACTS.cirBTC as Address, abi: erc20Abi, functionName: 'balanceOf', args: [targetAddr] },
    { address: POOL_CONTRACTS.WETH as Address, abi: erc20Abi, functionName: 'balanceOf', args: [targetAddr] },
  ]

  let usdcFormatted = '0.00'
  let eurcFormatted = '0.00'
  let cirbtcFormatted = '0.000000'
  let wethFormatted = '0.0000'

  try {
    const results = await resilientMulticall<bigint>(publicClient, calls, { allowFailure: true })

    if (results[0]?.status === 'success') {
      usdcFormatted = parseFloat(formatUnits(results[0].result, 6)).toFixed(2)
    } else if (results[0]?.error) {
      console.warn('[usePoolsData] USDC balance read failed:', results[0].error)
    }

    if (results[1]?.status === 'success') {
      eurcFormatted = parseFloat(formatUnits(results[1].result, 6)).toFixed(2)
    } else if (results[1]?.error) {
      console.warn('[usePoolsData] EURC balance read failed:', results[1].error)
    }

    if (results[2]?.status === 'success') {
      const btcVal = parseFloat(formatUnits(results[2].result, 8))
      cirbtcFormatted = btcVal > 0 ? (btcVal < 0.0001 ? btcVal.toFixed(8) : btcVal.toFixed(6)) : '0.000000'
    } else if (results[2]?.error) {
      console.warn('[usePoolsData] cirBTC balance read failed:', results[2].error)
    }

    if (results[3]?.status === 'success') {
      const wethVal = parseFloat(formatUnits(results[3].result, 18))
      wethFormatted = wethVal > 0 ? (wethVal < 0.0001 ? wethVal.toFixed(6) : wethVal.toFixed(4)) : '0.0000'
    } else if (results[3]?.error) {
      console.warn('[usePoolsData] WETH balance read failed:', results[3].error)
    }
  } catch (err) {
    console.warn('[usePoolsData] Arc Testnet token balance multicall failed:', err)
  }

  return {
    usdc: usdcFormatted,
    eurc: eurcFormatted,
    cirbtc: cirbtcFormatted,
    weth: wethFormatted,
  }
}

interface AmmPositionSpec {
  poolId: string
  label: string
  address: Address
  abi: Abi
  decimalsA: number
  decimalsB: number
  priceA: number
  priceB: number
  formatA: (val: number) => string
  formatB: (val: number) => string
}

function formatEarnedRewards(earnedUsd: number): string {
  if (earnedUsd <= 0) return '0.00'
  return earnedUsd < 0.0001 ? earnedUsd.toFixed(6) : earnedUsd.toFixed(4)
}

function formatHighPrecisionToken(val: number): string {
  return val < 0.001 ? val.toFixed(6) : val.toFixed(4)
}

/**
 * Reads real user pool positions (ERC-4626 YieldVault, StableSwap LP, ConstantProduct LP)
 * on Arc Testnet in a single atomic Multicall3 round-trip (plus one conditional `previewRedeem`
 * call only when the wallet actually holds YieldVault shares).
 */
export async function fetchUserPoolPositions(
  walletAddress: string,
  passedPoolState?: Record<string, any>,
  passedPrices?: { btc?: number; eurc?: number; weth?: number; eth?: number }
): Promise<Record<string, UserPoolPosition>> {
  const normalizedAddress = normalizeWalletAddress(walletAddress)
  const isAddressValid = Boolean(normalizedAddress && normalizedAddress.startsWith('0x'))
  if (!isAddressValid) return {}

  const targetAddr = normalizedAddress as Address
  const publicClient = getArcPublicClient()

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

  const cirBtcPool = ARCIS_POOLS.find((p) => p.id === 'usdc-cirbtc-pool')
  const cpAddress = (cirBtcPool?.contractAddress || POOL_CONTRACTS.CONSTANT_PRODUCT_POOL) as Address

  const allAmmSpecs: AmmPositionSpec[] = [
    {
      poolId: 'usdc-eurc-stable-pool',
      label: 'StableSwap',
      address: POOL_CONTRACTS.STABLE_SWAP_POOL as Address,
      abi: STABLE_SWAP_ABI as Abi,
      decimalsA: 6,
      decimalsB: 6,
      priceA: 1,
      priceB: liveEurcPrice,
      formatA: (v: number) => v.toFixed(2),
      formatB: (v: number) => v.toFixed(2),
    },
    {
      poolId: cirBtcPool?.id || 'usdc-cirbtc-pool',
      label: 'ConstantProduct',
      address: cpAddress,
      abi: CONSTANT_PRODUCT_ABI as Abi,
      decimalsA: 6,
      decimalsB: 8,
      priceA: 1,
      priceB: liveBtcPrice,
      formatA: (v: number) => v.toFixed(2),
      formatB: formatHighPrecisionToken,
    },
    {
      poolId: 'usdc-weth-pool',
      label: 'WETH ConstantProduct',
      address: POOL_CONTRACTS.WETH_POOL as Address,
      abi: CONSTANT_PRODUCT_ABI as Abi,
      decimalsA: 6,
      decimalsB: 18,
      priceA: 1,
      priceB: liveEthPrice,
      formatA: (v: number) => v.toFixed(2),
      formatB: formatHighPrecisionToken,
    },
    {
      poolId: 'eurc-weth-pool',
      label: 'EURC/WETH ConstantProduct',
      address: POOL_CONTRACTS.EURC_WETH_POOL as Address,
      abi: CONSTANT_PRODUCT_ABI as Abi,
      decimalsA: 6,
      decimalsB: 18,
      priceA: liveEurcPrice,
      priceB: liveEthPrice,
      formatA: (v: number) => v.toFixed(2),
      formatB: formatHighPrecisionToken,
    },
    {
      poolId: 'eurc-cirbtc-pool',
      label: 'EURC/cirBTC ConstantProduct',
      address: POOL_CONTRACTS.EURC_CIRBTC_POOL as Address,
      abi: CONSTANT_PRODUCT_ABI as Abi,
      decimalsA: 6,
      decimalsB: 8,
      priceA: liveEurcPrice,
      priceB: liveBtcPrice,
      formatA: (v: number) => v.toFixed(2),
      formatB: formatHighPrecisionToken,
    },
    {
      poolId: 'cirbtc-weth-pool',
      label: 'cirBTC/WETH ConstantProduct',
      address: POOL_CONTRACTS.CIRBTC_WETH_POOL as Address,
      abi: CONSTANT_PRODUCT_ABI as Abi,
      decimalsA: 8,
      decimalsB: 18,
      priceA: liveBtcPrice,
      priceB: liveEthPrice,
      formatA: formatHighPrecisionToken,
      formatB: formatHighPrecisionToken,
    },
  ]
  const ammSpecs = allAmmSpecs.filter((spec) => isDeployed(spec.address))

  const hasVault = isDeployed(POOL_CONTRACTS.YIELD_VAULT)

  const calls: Array<{
    address: Address
    abi: Abi
    functionName: string
    args?: readonly unknown[]
  }> = []

  // Slot layout for YieldVault (if deployed)
  let vaultSlots:
    | {
        balanceOf: number
        totalAssets: number
        totalSupply: number
        decimals: number
        pendingYield?: number
      }
    | null = null

  if (hasVault) {
    const base = calls.length
    calls.push(
      { address: POOL_CONTRACTS.YIELD_VAULT as Address, abi: YIELD_VAULT_ABI as Abi, functionName: 'balanceOf', args: [targetAddr] },
      { address: POOL_CONTRACTS.YIELD_VAULT as Address, abi: YIELD_VAULT_ABI as Abi, functionName: 'totalAssets' },
      { address: POOL_CONTRACTS.YIELD_VAULT as Address, abi: YIELD_VAULT_ABI as Abi, functionName: 'totalSupply' },
      { address: POOL_CONTRACTS.YIELD_VAULT as Address, abi: YIELD_VAULT_ABI as Abi, functionName: 'decimals' }
    )
    vaultSlots = {
      balanceOf: base,
      totalAssets: base + 1,
      totalSupply: base + 2,
      decimals: base + 3,
    }
    if (POOL_VERSION_V4) {
      vaultSlots.pendingYield = calls.length
      calls.push({
        address: POOL_CONTRACTS.YIELD_VAULT as Address,
        abi: YIELD_VAULT_ABI as Abi,
        functionName: 'pendingYield',
        args: [targetAddr],
      })
    }
  }

  // Slot layout for every deployed AMM pool
  const ammSlotLayouts = ammSpecs.map((spec) => {
    const base = calls.length
    calls.push(
      { address: spec.address, abi: spec.abi, functionName: 'balanceOf', args: [targetAddr] },
      { address: spec.address, abi: spec.abi, functionName: 'reserveA' },
      { address: spec.address, abi: spec.abi, functionName: 'reserveB' },
      { address: spec.address, abi: spec.abi, functionName: 'totalLp' },
      { address: spec.address, abi: spec.abi, functionName: 'unclaimedFeeA' },
      { address: spec.address, abi: spec.abi, functionName: 'unclaimedFeeB' }
    )
    let pendingFees: number | undefined
    if (POOL_VERSION_V4) {
      pendingFees = calls.length
      calls.push({
        address: spec.address,
        abi: spec.abi,
        functionName: 'pendingFees',
        args: [targetAddr],
      })
    }
    return {
      spec,
      balanceOf: base,
      reserveA: base + 1,
      reserveB: base + 2,
      totalLp: base + 3,
      unclaimedFeeA: base + 4,
      unclaimedFeeB: base + 5,
      pendingFees,
    }
  })

  if (calls.length === 0) return {}

  let results: Array<{ status: 'success' | 'failure'; result?: any; error?: Error }> = []
  try {
    results = await resilientMulticall<any>(publicClient, calls, { allowFailure: true })
  } catch (err) {
    console.warn('[usePoolsData] User pool positions multicall failed:', err)
    return {}
  }

  const positions: Record<string, UserPoolPosition> = {}
  const now = Date.now()

  // 1. YieldVault (ERC-4626)
  if (vaultSlots) {
    const sharesEntry = results[vaultSlots.balanceOf]
    if (sharesEntry?.status !== 'success') {
      if (sharesEntry?.error) {
        console.warn('[usePoolsData] YieldVault user balance read failed:', sharesEntry.error)
      }
    } else {
      const sharesRaw = sharesEntry.result as bigint
      if (sharesRaw > 0n) {
        const vaultStateSnapshot = passedPoolState?.[POOL_CONTRACTS.YIELD_VAULT]
        const decimalsEntry = results[vaultSlots.decimals]
        const shareDecimals =
          decimalsEntry?.status === 'success' && typeof decimalsEntry.result === 'number'
            ? decimalsEntry.result
            : typeof vaultStateSnapshot?.shareDecimals === 'number'
            ? vaultStateSnapshot.shareDecimals
            : VAULT_SHARE_DECIMALS

        const principalUsdc = parseFloat(formatUnits(sharesRaw, shareDecimals))
        const totalAssetsEntry = results[vaultSlots.totalAssets]
        const totalSupplyEntry = results[vaultSlots.totalSupply]

        const liveTotalAssets =
          totalAssetsEntry?.status === 'success'
            ? (totalAssetsEntry.result as bigint)
            : vaultStateSnapshot?.totalAssets
            ? parseUnits(vaultStateSnapshot.totalAssets, 6)
            : 0n
        const liveTotalSupply =
          totalSupplyEntry?.status === 'success'
            ? (totalSupplyEntry.result as bigint)
            : vaultStateSnapshot?.totalSupply
            ? parseUnits(vaultStateSnapshot.totalSupply, shareDecimals)
            : 0n

        let assetsUsdc = 0
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
        } catch (previewErr) {
          console.warn('[usePoolsData] YieldVault previewRedeem fallback to share ratio:', previewErr)
          if (liveTotalSupply > 0n && liveTotalAssets > 0n) {
            const userAssetsRaw = (sharesRaw * liveTotalAssets) / liveTotalSupply
            assetsUsdc = parseFloat(formatUnits(userAssetsRaw, 6))
            if (assetsUsdc > principalUsdc) {
              rawVaultProfit = assetsUsdc - principalUsdc
            }
          } else {
            assetsUsdc = principalUsdc
          }
        }

        const poolSharePct =
          liveTotalSupply > 0n
            ? Math.min(100, Math.max(0, parseFloat(((Number(sharesRaw) / Number(liveTotalSupply)) * 100).toFixed(2))))
            : 0

        let userEarnedUsd = 0
        if (vaultSlots.pendingYield !== undefined) {
          const pendingEntry = results[vaultSlots.pendingYield]
          if (pendingEntry?.status === 'success') {
            userEarnedUsd = parseFloat(formatUnits((pendingEntry.result as bigint) || 0n, 6))
          } else if (pendingEntry?.error) {
            console.warn('[usePoolsData] YieldVault pendingYield read failed:', pendingEntry.error)
          }
        }

        positions['usdc-yield-vault'] = {
          poolId: 'usdc-yield-vault',
          stakedAmount: assetsUsdc.toFixed(2),
          stakedUsd: assetsUsdc,
          earnedRewards: formatEarnedRewards(userEarnedUsd),
          earnedUsd: userEarnedUsd,
          lastUpdatedTimestamp: now,
          lpTokenBalance: formatUnits(sharesRaw, shareDecimals),
          poolSharePct,
          earnedFeesUsd: rawVaultProfit,
        }
      }
    }
  }

  // 2. Deployed AMM Pools (decoded from the same single Multicall3 response)
  for (const layout of ammSlotLayouts) {
    const { spec } = layout
    const lpEntry = results[layout.balanceOf]
    if (lpEntry?.status !== 'success') {
      if (lpEntry?.error) {
        console.warn(`[usePoolsData] ${spec.label} user balance read failed:`, lpEntry.error)
      }
      continue
    }

    const lpRaw = lpEntry.result as bigint
    if (lpRaw <= 0n) continue

    const poolState = passedPoolState?.[spec.address]
    const reserveAEntry = results[layout.reserveA]
    const reserveBEntry = results[layout.reserveB]
    const totalLpEntry = results[layout.totalLp]
    const unclaimedAEntry = results[layout.unclaimedFeeA]
    const unclaimedBEntry = results[layout.unclaimedFeeB]

    const reservesComplete =
      reserveAEntry?.status === 'success' &&
      reserveBEntry?.status === 'success' &&
      totalLpEntry?.status === 'success'

    let reserveA = 0n
    let reserveB = 0n
    let totalLp = 0n
    let unclaimedA = 0n
    let unclaimedB = 0n

    if (reservesComplete) {
      reserveA = reserveAEntry.result as bigint
      reserveB = reserveBEntry.result as bigint
      totalLp = totalLpEntry.result as bigint
      unclaimedA = unclaimedAEntry?.status === 'success' ? ((unclaimedAEntry.result as bigint) || 0n) : 0n
      unclaimedB = unclaimedBEntry?.status === 'success' ? ((unclaimedBEntry.result as bigint) || 0n) : 0n
    } else {
      console.warn(`[usePoolsData] ${spec.label} multicall reserves incomplete; falling back to cached pool state`)
      totalLp = poolState?.totalLp ? parseUnits(poolState.totalLp, 18) : 0n
      reserveA = poolState?.reserveA ? parseUnits(poolState.reserveA, spec.decimalsA) : 0n
      reserveB = poolState?.reserveB ? parseUnits(poolState.reserveB, spec.decimalsB) : 0n
      unclaimedA = poolState?.unclaimedFeeA ? parseUnits(poolState.unclaimedFeeA, spec.decimalsA) : 0n
      unclaimedB = poolState?.unclaimedFeeB ? parseUnits(poolState.unclaimedFeeB, spec.decimalsB) : 0n
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
      userA = parseFloat(formatUnits(userARaw, spec.decimalsA))
      userB = parseFloat(formatUnits(userBRaw, spec.decimalsB))
      stakedUsd = userA * spec.priceA + userB * spec.priceB
      poolSharePct = Math.min(100, Math.max(0, parseFloat(((Number(lpRaw) / Number(totalLp)) * 100).toFixed(2))))

      const ufA = parseFloat(formatUnits(unclaimedA, spec.decimalsA))
      const ufB = parseFloat(formatUnits(unclaimedB, spec.decimalsB))
      const totalPoolUnclaimedUsd = ufA * spec.priceA + ufB * spec.priceB
      rawFeeShareUsd = poolSharePct > 0 ? (totalPoolUnclaimedUsd * poolSharePct) / 100 : 0

      if (layout.pendingFees !== undefined) {
        const pendingEntry = results[layout.pendingFees]
        if (pendingEntry?.status === 'success') {
          const pending = pendingEntry.result as readonly [bigint, bigint]
          const claimableUsd =
            parseFloat(formatUnits(pending?.[0] || 0n, spec.decimalsA)) * spec.priceA +
            parseFloat(formatUnits(pending?.[1] || 0n, spec.decimalsB)) * spec.priceB
          rawFeeShareUsd = claimableUsd
          userEarnedUsd = claimableUsd
        } else if (pendingEntry?.error) {
          console.warn(`[usePoolsData] ${spec.label} pendingFees read failed:`, pendingEntry.error)
        }
      }
    }

    positions[spec.poolId] = {
      poolId: spec.poolId,
      stakedAmount: stakedUsd.toFixed(2),
      stakedUsd,
      earnedRewards: formatEarnedRewards(userEarnedUsd),
      earnedUsd: userEarnedUsd,
      lastUpdatedTimestamp: now,
      isLpPosition: true,
      lpTokenBalance: formatUnits(lpRaw, 18),
      poolSharePct,
      tokenAStaked: spec.formatA(userA),
      tokenBStaked: spec.formatB(userB),
      earnedFeesUsd: rawFeeShareUsd,
      priceUnavailable: !isValuationTrusted || !(totalLp > 0n),
    }
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
  const normalizedAddress = normalizeWalletAddress(walletAddress)
  if (!queryClient || !normalizedAddress || !normalizedAddress.startsWith('0x')) return
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: onchainPoolBalancesQueryKey(normalizedAddress),
      queryFn: () => fetchOnchainPoolBalances(normalizedAddress),
      staleTime: 30_000,
    }),
    queryClient.prefetchQuery({
      queryKey: userPoolPositionsQueryKey(normalizedAddress),
      queryFn: () => fetchUserPoolPositions(normalizedAddress),
      staleTime: 20_000,
    }),
  ])
}
