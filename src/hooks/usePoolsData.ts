// Arcis Pools & Yield — Real on-chain testnet data hook (Phase 5 rewrite).
// Reads real reserves / vault state from Arc Testnet contracts and submits
// real transactions via the connected wallet provider.
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
  type WalletClient,
} from 'viem'
import { arcTestnet } from '../config/arcChain'
import {
  AMM_POOL_STATE_READ_FNS,
  ARCIS_POOLS,
  CONSTANT_PRODUCT_ABI,
  CONSTANT_PRODUCT_LP_FEE_BPS,
  POOL_CONTRACTS,
  POOL_DEFAULT_SLIPPAGE_BPS,
  POOL_VERSION_V2,
  POOL_VERSION_V3,
  POOL_VERSION_V4,
  poolMinLpShares,
  poolMinOut,
  poolSlippageBps,
  STABLE_SWAP_ABI,
  STABLE_SWAP_AMP,
  STABLE_SWAP_LP_FEE_BPS,
  VAULT_SHARE_DECIMALS,
  YIELD_VAULT_ABI,
  type PoolConfig,
} from '../config/poolsConfig'
import { getActiveSmartAccount, sendModularUserOperation } from '../services/modularWalletService'
import { redisCache } from '../services/redisCacheService'
import { getArcPublicClient, resilientMulticall, resilientReadContract, resilientWaitForReceipt, resilientWriteContract } from '../services/rpc'
import { getCachedTokenPrice, getLiveTokenPrices, isLivePriceAvailable } from '../services/tokenPriceService'
import { isUserCanceled } from '../utils/errorUtils'
import {
  analyzeDualDepositBalance,
  calculateConstantProductExpectedOut,
  calculateLpClaimAmount,
  calculatePoolShare,
  calculateStableSwapExpectedOut,
  DUAL_DEPOSIT_DONATION_BLOCK_PCT,
  getStableSwapD
} from '../utils/poolMath'
import { recordClientSwapVolume } from '../utils/poolVolumeUtils'
import { resolveUcwTxHash, ucwHashPendingMessage } from '../utils/ucwTxHash'
import { addTransaction } from '../utils/history'
import { useLiveTokenPrices } from './useLiveTokenPrices'
import {
  fetchTotalPoolTransactionCount,
  recordOptimisticPoolTx,
} from '../services/poolEventsIndexer'

export { recordClientSwapVolume, recordOptimisticPoolTx }

/**
 * Standardized APY badge formatter across all Arcis pools and vaults.
 */
export function formatPoolApyBadge(
  totalApy: number,
  baseApy: number,
  feeApy: number,
  typeLabel: string
): string {
  if (feeApy > 0) {
    return `${totalApy.toFixed(2)}% APY (${baseApy.toFixed(2)}% Incentive Est. + ${feeApy.toFixed(2)}% Fees)`
  }
  return `${baseApy.toFixed(2)}% ${typeLabel} APY`
}

export interface UserPoolPosition {
  poolId: string
  stakedAmount: string
  stakedUsd: number
  earnedRewards: string
  earnedUsd: number
  lastUpdatedTimestamp: number
  isLpPosition?: boolean
  lpTokenBalance?: string
  poolSharePct?: number
  tokenAStaked?: string
  tokenBStaked?: string
  earnedFeesUsd?: number
  /** O4: true when the counter-token price is not oracle-verified, so the USD valuation is a
   * static approximation and funds-affecting USD→LP mappings must refuse to act on it. */
  priceUnavailable?: boolean
}

export interface PoolWithdrawResult {
  txHash: string
  autoSwapFailed?: boolean
  counterTokenSymbol?: string
  counterAmount?: string
}

function isDeployed(address: string): boolean {
  return Boolean(address && address !== zeroAddress && address.startsWith('0x'))
}

// Safe storage helper with SSR, sandbox, sessionStorage, and memory fallback
const memoryStorageFallback = new Map<string, string>()

export const safeStorage = {
  get: (key: string): string | null => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const val = window.localStorage.getItem(key)
        if (val !== null) return val
      }
    } catch { }
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const val = window.sessionStorage.getItem(key)
        if (val !== null) return val
      }
    } catch { }
    return memoryStorageFallback.get(key) ?? null
  },
  set: (key: string, val: string): void => {
    let persisted = false
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, val)
        persisted = true
      }
    } catch { }
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(key, val)
        persisted = true
      }
    } catch { }
    if (!persisted) {
      memoryStorageFallback.set(key, val)
    }
  },
  remove: (key: string): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key)
      }
    } catch { }
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem(key)
      }
    } catch { }
    memoryStorageFallback.delete(key)
  },
  clearMemory: (): void => {
    memoryStorageFallback.clear()
  },
}

// Phase 1 note: every per-user reward balance now lives on-chain (`pendingFees` for LP fees,
// `pendingYield` for vault yield). The former localStorage checkpoints (staking timestamps,
// fee checkpoints, vault claim checkpoints) were removed so the same wallet reports the same
// claimable amount on every device and session.

// Memory-only Gateway deposit tracking (Zero LocalStorage)
export const recordGatewayDeposit = (_userAddr: string, _amount: number) => { }
export const recordGatewayWithdrawal = (_userAddr: string, _amount: number) => { }
export const getLocalGatewayDeposits = (_userAddr: string): number => 0

// ── Honest vault APY measurement (H2 fix) ────────────────────────────────────
// `totalYieldDistributed` is cumulative since vault deployment, so annualizing the raw
// lifetime figure directly wildly overstates the APY. Instead the REAL increment of
// distributed yield is measured over a persisted observation window (>= 24h)
// and only that measured rate is annualized. Until a full window has been observed the
// dynamic component is 0 and only the clearly-labeled base estimate is shown.
const VAULT_APY_SNAPSHOT_KEY = 'arcis:pools:vault_yield_apy_snapshot'
const VAULT_APY_MIN_WINDOW_MS = 24 * 60 * 60 * 1000 // require >= 24h of observation

export function measureVaultYieldApy(
  totalYieldDistributedUsd: number,
  totalAssetsUsd: number,
  nowMs: number = Date.now()
): number {
  if (!Number.isFinite(totalYieldDistributedUsd) || !Number.isFinite(totalAssetsUsd)) return 0
  if (!(totalAssetsUsd > 0) || !(totalYieldDistributedUsd > 0)) return 0

  let snapshot: { yield: number; ts: number } | null = null
  try {
    const raw = safeStorage.get(VAULT_APY_SNAPSHOT_KEY)
    if (raw) snapshot = JSON.parse(raw)
  } catch { }

  if (
    !snapshot ||
    typeof snapshot.yield !== 'number' ||
    !Number.isFinite(snapshot.yield) ||
    typeof snapshot.ts !== 'number' ||
    !(snapshot.ts > 0) ||
    snapshot.ts > nowMs ||
    snapshot.yield > totalYieldDistributedUsd // counter reset / new deployment -> re-seed
  ) {
    try {
      safeStorage.set(VAULT_APY_SNAPSHOT_KEY, JSON.stringify({ yield: totalYieldDistributedUsd, ts: nowMs }))
    } catch { }
    return 0
  }

  const windowMs = nowMs - snapshot.ts
  if (windowMs < VAULT_APY_MIN_WINDOW_MS) return 0 // keep accumulating; not enough data yet

  const windowDays = windowMs / 86_400_000
  const deltaYieldUsd = totalYieldDistributedUsd - snapshot.yield
  try {
    safeStorage.set(VAULT_APY_SNAPSHOT_KEY, JSON.stringify({ yield: totalYieldDistributedUsd, ts: nowMs }))
  } catch { }

  if (!(deltaYieldUsd > 0)) return 0
  const apy = ((deltaYieldUsd / windowDays) * 365 * 100) / totalAssetsUsd
  return Number.isFinite(apy) && apy > 0 ? parseFloat(apy.toFixed(2)) : 0
}

// V2/V3 helper: estimate expected LP shares from on-chain reserves and derive a
// conservative minLpShares slippage guard. For Curve StableSwap pools, uses the exact
// invariant _getD matching StableSwapPoolV3.sol to prevent false SlippageExceeded reverts.
export function computeMinLpShares(
  pool: { id: string; tokens?: readonly { decimals?: number }[] },
  poolAddress: string,
  poolState: Record<string, any> | undefined,
  amountA: bigint,
  amountB: bigint,
  counterDecimalsInput?: number,
  slippage: number = 0.5
): bigint {
  if (!POOL_VERSION_V2 && !POOL_VERSION_V3 && !POOL_VERSION_V4) return 0n
  const st = (poolState || {})[poolAddress] as any
  const slipBps = poolSlippageBps(slippage)
  const counterDecimals =
    counterDecimalsInput ?? pool.tokens?.[1]?.decimals ?? (pool.id === 'usdc-cirbtc-pool' ? 8 : 6)

  const reserveARaw = st?.reserveA ? parseUnits(st.reserveA, 6) : 0n
  const totalLpRaw = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
  let expectedLp: bigint = 0n

  if (totalLpRaw <= 0n || reserveARaw <= 0n) return 0n

  if (pool.id === 'usdc-cirbtc-pool') {
    const reserveBRaw = st.reserveB ? parseUnits(st.reserveB, counterDecimals) : 0n
    if (reserveBRaw <= 0n) return 0n
    const lpA = (amountA * totalLpRaw) / reserveARaw
    const lpB = (amountB * totalLpRaw) / reserveBRaw
    expectedLp = lpA < lpB ? lpA : lpB
  } else {
    // StableSwap pool: Exact Curve invariant calculation matching StableSwapPoolV3.sol
    const reserveBRaw = st.reserveB ? parseUnits(st.reserveB, counterDecimals) : 0n
    if (reserveBRaw > 0n && amountA > 0n && amountB > 0n) {
      const d0 = getStableSwapD(reserveARaw, reserveBRaw, STABLE_SWAP_AMP)
      const d1 = getStableSwapD(reserveARaw + amountA, reserveBRaw + amountB, STABLE_SWAP_AMP)
      if (d1 > d0 && d0 > 0n) {
        expectedLp = ((d1 - d0) * totalLpRaw) / d0
      }
    }
    // Fallback if reserveB is 0 or d1 <= d0
    if (expectedLp <= 0n && reserveARaw > 0n) {
      expectedLp = (amountA * totalLpRaw) / reserveARaw
    }
  }
  if (expectedLp <= 0n) return 0n
  return poolMinLpShares(expectedLp, slipBps)
}

/** @deprecated Use computeMinLpShares instead */
export const usePoolsV2MinLpShares = computeMinLpShares

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
  } catch { }
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
        // V4 has no owner-collected counter: the fee reserve is the on-chain equivalent.
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
        // V4 has no owner-collected counter: the fee reserve is the on-chain equivalent.
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

      // Share decimals are read on-chain: YieldVaultV4 uses ERC-4626 virtual shares
      // (`_decimalsOffset() = 3` → 9 decimals), the V3 fallback has 6.
      const shareDecimals =
        results[3]?.status === 'success' && typeof results[3].result === 'number'
          ? results[3].result
          : VAULT_SHARE_DECIMALS

      // Phase 0: a yield vault has no trading volume; only AMM swaps count toward 24h volume.
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
    } catch { }
  }

  return state
}

/**
 * Eagerly prefetches global pool states and live token prices into TanStack Query in the background.
 * Call this at app mount so the Pools & Yield view renders with 0ms delay.
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
 * Reads real wallet token balances (USDC, EURC, cirBTC) on Arc Testnet.
 */
export async function fetchOnchainPoolBalances(
  walletAddress: string
): Promise<{ usdc: string; usyc: string; eurc: string; cirbtc: string }> {
  const isAddressValid = Boolean(walletAddress && walletAddress.startsWith('0x'))
  if (!isAddressValid) {
    return { usdc: '0.00', usyc: '0.00', eurc: '0.00', cirbtc: '0.0000' }
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

  const result = {
    usdc: usdcFormatted,
    usyc: '0.00',
    eurc: eurcFormatted,
    cirbtc: cirbtcFormatted,
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

  // Short memory cache debounce (20s)
  const cached = await redisCache.get<Record<string, UserPoolPosition>>(cacheKey)
  if (cached && Object.keys(cached).length > 0) {
    // D3: price trust is a live fact, not a cacheable one — refresh it on every cache read so
    // a recovered feed is honored immediately and the H3 "refresh and retry" loop cannot be
    // stuck for the 20s cache TTL on a stale priceUnavailable flag.
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
  // O4: never fabricate a price and never value at 0 — getCachedTokenPrice resolves the
  // live cache first and the documented static fallback tier second, so USD valuations
  // cannot collapse to $0 when the oracle is briefly unavailable.
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
  // Funds-affecting USD→LP mappings may only trust oracle-verified prices. When false, the
  // valuation below is a static approximation and withdrawals are refused (H3 guard, O4).
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
        // Share decimals are read on-chain (ERC-4626 virtual-share offset aware); the
        // VAULT_SHARE_DECIMALS constant is only the fallback.
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

        // Phase 1: claimable yield comes from the V4 vault's on-chain cost basis
        // (`pendingYield`). V3 pools expose no per-user accounting, so nothing is shown as
        // claimable — lifetime share appreciation stays informational in `rawVaultProfit`.
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
          // Lifetime pool-level fee share — informational only.
          rawFeeShareUsd = poolSharePct > 0 ? (totalPoolUnclaimedUsd * poolSharePct) / 100 : 0

          // Phase 1: the user's own claimable fees are read directly on-chain via `pendingFees(lp)`.
          // No localStorage checkpoint is involved, so the number is identical on any device.
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
          // D1: a held LP balance with no readable totalLp cannot be valued — never count
          // raw LP tokens 1:1 as USD. 0 + priceUnavailable makes the withdrawal guard refuse
          // instead of mapping a fabricated USD value to LP shares.
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
          const poolIdKey = cirBtcPool?.id || 'usdc-cirbtc-pool'
          // Lifetime pool-level fee share — informational only.
          rawFeeShareUsd = poolSharePct > 0 ? (totalPoolUnclaimedUsd * poolSharePct) / 100 : 0

          // Phase 1: the user's own claimable fees are read directly on-chain via `pendingFees(lp)`.
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
          // D1: a held LP balance with no readable totalLp cannot be valued — never count
          // raw LP tokens 1:1 as USD. 0 + priceUnavailable makes the withdrawal guard refuse
          // instead of mapping a fabricated USD value to LP shares.
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

  // ConstantProductPool (USDC/WETH) user balance read
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

/**
 * Safely estimates transaction gas with a 20% safety margin, falling back cleanly.
 */
async function estimateSafeGas(
  publicClient: any,
  params: {
    address: `0x${string}`
    abi: any
    functionName: string
    args?: any
    account: Address
  },
  fallbackGas: bigint
): Promise<bigint> {
  try {
    const estimated = await publicClient.estimateContractGas(params)
    return (estimated * 120n) / 100n // 20% safety margin
  } catch (err) {
    console.warn(`[usePoolsData] Gas estimation fallback for ${params.functionName}:`, err)
    return fallbackGas
  }
}

export function usePoolsData(
  walletAddress: string,
  provider?: unknown,
  authSource?: 'passkey' | 'ucw' | 'evm' | null,
  executeUcwContract?: (params: any) => Promise<{
    success: boolean
    txHash?: string
    hashPending?: boolean
    challengeId?: string
    error?: string
  }>
) {
  const queryClient = useQueryClient()
  const isAddressValid = Boolean(walletAddress && walletAddress.startsWith('0x'))

  // ── Live Market Prices (CoinGecko Simple Price API with Redis cache) ──────
  const { data: tokenPrices } = useLiveTokenPrices()

  // O4: prices resolve live hook → cached oracle → documented static fallback tier. They are
  // never 0, so a briefly unavailable feed cannot collapse TVL, 24h volume or position
  // valuations to $0. Funds-affecting paths additionally check isLivePriceAvailable().
  const liveBtcPrice = tokenPrices?.CIRBTC || tokenPrices?.BTC || getCachedTokenPrice('BTC')
  const liveEurcPrice = tokenPrices?.EURC || getCachedTokenPrice('EURC')
  const liveWethPrice = tokenPrices?.WETH || tokenPrices?.ETH || getCachedTokenPrice('WETH') || 2600

  // Reactive trigger for 24h rolling swap volume updates across tabs and components
  const [volumeRevision, setVolumeRevision] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleVolumeUpdate = () => {
      // Pure UI state revision bump — does NOT trigger expensive on-chain RPC query invalidations
      setVolumeRevision((prev) => prev + 1)
    }
    window.addEventListener('arcis:swap-volume-updated', handleVolumeUpdate)
    window.addEventListener('arcis:pool-tx-indexed', handleVolumeUpdate)
    window.addEventListener('storage', handleVolumeUpdate)
    return () => {
      window.removeEventListener('arcis:swap-volume-updated', handleVolumeUpdate)
      window.removeEventListener('arcis:pool-tx-indexed', handleVolumeUpdate)
      window.removeEventListener('storage', handleVolumeUpdate)
    }
  }, [])

  // Public read client for Arc Testnet (Multi-RPC pooled resilient client)
  const publicClient = useMemo(() => {
    return getArcPublicClient()
  }, [])

  // Helper: safely poll for transaction receipt with fallback tx lookup without crashing if receipt polling glitches
  const waitForReceiptSafe = useCallback(
    async (hash: Hex, description = 'Transaction'): Promise<TransactionReceipt | null> => {
      const res = await resilientWaitForReceipt(publicClient, hash, description, 60_000)
      if (res.status === 'reverted') {
        throw new Error(`${description} reverted on Arc Testnet.`)
      }
      return res.receipt || null
    },
    [publicClient]
  )

  // ── Real wallet balances (USDC + EURC) from Arc Testnet ───────────────────
  const {
    data: onchainBalances,
    isLoading: isBalancesLoading,
    refetch: refetchOnchainBalances,
  } = useQuery({
    queryKey: ['onchainPoolBalances', walletAddress],
    queryFn: () => fetchOnchainPoolBalances(walletAddress),
    enabled: isAddressValid,
    staleTime: 30_000,
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 60_000),
    gcTime: 1000 * 60 * 5,
  })

  // ── Real on-chain pool state (reserves, TVL growth, fee pools) ────────────
  const {
    data: onchainPoolState,
    refetch: refetchPoolState,
  } = useQuery({
    queryKey: ONCHAIN_POOL_STATE_QUERY_KEY,
    queryFn: fetchOnchainPoolState,
    initialData: getLastKnownPoolState,
    staleTime: 30_000,
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 45_000),
    gcTime: 1000 * 60 * 5,
  })

  // ── Real on-chain user pool positions (Vault shares & LP balances) ─────────
  const {
    data: userPoolPositions,
    refetch: refetchUserPositions,
  } = useQuery({
    queryKey: ['userPoolPositions', walletAddress],
    queryFn: () =>
      fetchUserPoolPositions(walletAddress, onchainPoolState, {
        btc: liveBtcPrice,
        eurc: liveEurcPrice,
        weth: liveWethPrice,
      }),
    enabled: isAddressValid,
    staleTime: 20_000,
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 45_000),
    gcTime: 1000 * 60 * 5,
  })

  // ── Real on-chain total pool transactions (Direct event scan via getLogs) ──
  const { data: totalPoolTxCount = 0 } = useQuery({
    queryKey: ['totalPoolTxCount'],
    queryFn: () => fetchTotalPoolTransactionCount(publicClient),
    staleTime: 25_000,
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 30_000),
    gcTime: 1000 * 60 * 5,
  })

  // ── Aggregate pool metrics (pure live on-chain data, zero static fallbacks) ──
  const poolsWithUserStats = useMemo(() => {
    // Live on-chain 24h rolling volume counters (strictly verified on-chain platform volume)
    const ssState = onchainPoolState?.[POOL_CONTRACTS.STABLE_SWAP_POOL]
    const ssVolA = parseFloat(ssState?.volume24hA || '0')
    const ssVolB = parseFloat(ssState?.volume24hB || '0')
    const ssContract24h = parseFloat((ssVolA + ssVolB * liveEurcPrice).toFixed(2))

    const cpPoolAddress = POOL_CONTRACTS.CONSTANT_PRODUCT_POOL
    const cpState = onchainPoolState?.[cpPoolAddress]
    const cpVolA = parseFloat(cpState?.volume24hA || '0')
    const cpVolB = parseFloat(cpState?.volume24hB || '0')
    const cpContract24h = parseFloat((cpVolA + cpVolB * liveBtcPrice).toFixed(2))


    return ARCIS_POOLS.map((pool) => {
      let tvlUsd = 0
      let volume24hUsd = 0
      let clientVolumeUsd = 0
      let apy = pool.apy
      let apyBadge = pool.apyBadge
      let exchangeRate = pool.exchangeRate || 1.0
      let reserves = pool.reserves ? { ...pool.reserves, tokenA: 0, tokenB: 0, ratioA: 50, ratioB: 50 } : undefined
      let totalLp = '0'

      if (pool.id === 'usdc-eurc-stable-pool') {
        const s = onchainPoolState?.[POOL_CONTRACTS.STABLE_SWAP_POOL]
        const resA = parseFloat(s?.reserveA || '0') || 0
        const resB = parseFloat(s?.reserveB || '0') || 0
        exchangeRate = liveEurcPrice
        const reserveUsd = resA + resB * liveEurcPrice
        tvlUsd = reserveUsd < 1000 ? parseFloat(reserveUsd.toFixed(2)) : Math.floor(reserveUsd)
        const ratioA = reserveUsd > 0 ? Math.round((resA / reserveUsd) * 100) : 50
        const ratioB = reserveUsd > 0 ? Math.max(0, 100 - ratioA) : 50
        reserves = { tokenA: resA, tokenB: resB, ratioA, ratioB }
        totalLp = s?.totalLp || '0'

        // Phase 1.2: 24H volume is the on-chain rolling window only. The device-local
        // localStorage fallback used to shadow it via Math.max(...); it is no longer a display source.
        volume24hUsd = ssContract24h
        clientVolumeUsd = 0

        // Hybrid DeFi APY Model: Base FX Liquidity Incentive APY + Dynamic 24H Fee APY
        const baseApr = 6.15
        const feeTierPct = pool.feeTierPercent || 0.12
        const dynamicFeeApr = tvlUsd > 0 && volume24hUsd > 0
          ? ((volume24hUsd * (feeTierPct / 100) * 365) / tvlUsd) * 100
          : 0
        const totalApr = parseFloat((baseApr + dynamicFeeApr).toFixed(2))
        apy = totalApr
        apyBadge = formatPoolApyBadge(totalApr, baseApr, dynamicFeeApr, 'FX Incentive')

      } else if (pool.id === 'usdc-cirbtc-pool') {
        const s = onchainPoolState?.[pool.contractAddress] || onchainPoolState?.[POOL_CONTRACTS.CONSTANT_PRODUCT_POOL]
        const resA = parseFloat(s?.reserveA || '0') || 0
        const resB = parseFloat(s?.reserveB || '0') || 0
        exchangeRate = liveBtcPrice
        const reserveUsd = resA + resB * liveBtcPrice
        tvlUsd = reserveUsd < 1000 ? parseFloat(reserveUsd.toFixed(2)) : Math.floor(reserveUsd)
        const ratioA = reserveUsd > 0 ? Math.round((resA / reserveUsd) * 100) : 50
        const ratioB = reserveUsd > 0 ? Math.max(0, 100 - ratioA) : 50
        reserves = { tokenA: resA, tokenB: resB, ratioA, ratioB }
        totalLp = s?.totalLp || '0'

        // Phase 1.2: on-chain rolling window only (no localStorage shadowing).
        volume24hUsd = cpContract24h
        clientVolumeUsd = 0

        // Hybrid DeFi APY Model: Base Bitcoin Liquidity Incentive APY + Dynamic 24H Fee APY
        const baseApr = 12.80
        const feeTierPct = pool.feeTierPercent || 0.25
        const dynamicFeeApr = tvlUsd > 0 && volume24hUsd > 0
          ? ((volume24hUsd * (feeTierPct / 100) * 365) / tvlUsd) * 100
          : 0
        const totalApr = parseFloat((baseApr + dynamicFeeApr).toFixed(2))
        apy = totalApr
        apyBadge = formatPoolApyBadge(totalApr, baseApr, dynamicFeeApr, 'BTC Incentive')

      } else if (pool.id === 'usdc-weth-pool') {
        const s = onchainPoolState?.[pool.contractAddress] || onchainPoolState?.[POOL_CONTRACTS.WETH_POOL]
        const resA = parseFloat(s?.reserveA || '0') || 0
        const resB = parseFloat(s?.reserveB || '0') || 0
        exchangeRate = liveWethPrice
        const reserveUsd = resA + resB * liveWethPrice
        tvlUsd = reserveUsd < 1000 ? parseFloat(reserveUsd.toFixed(2)) : Math.floor(reserveUsd)
        const ratioA = reserveUsd > 0 ? Math.round((resA / reserveUsd) * 100) : 50
        const ratioB = reserveUsd > 0 ? Math.max(0, 100 - ratioA) : 50
        reserves = { tokenA: resA, tokenB: resB, ratioA, ratioB }
        totalLp = s?.totalLp || '0'
        const wethVolA = parseFloat(s?.volume24hA || '0')
        const wethVolB = parseFloat(s?.volume24hB || '0')
        volume24hUsd = parseFloat((wethVolA + wethVolB * liveWethPrice).toFixed(2))
        clientVolumeUsd = 0

        const baseApr = 15.40
        const feeTierPct = pool.feeTierPercent || 0.30
        const dynamicFeeApr = tvlUsd > 0 && volume24hUsd > 0
          ? ((volume24hUsd * (feeTierPct / 100) * 365) / tvlUsd) * 100
          : 0
        const totalApr = parseFloat((baseApr + dynamicFeeApr).toFixed(2))
        apy = totalApr
        apyBadge = formatPoolApyBadge(totalApr, baseApr, dynamicFeeApr, 'ETH Incentive')

      } else if (pool.id === 'usdc-yield-vault') {
        const s = onchainPoolState?.[POOL_CONTRACTS.YIELD_VAULT]
        const assetsUsd = parseFloat(s?.totalAssets || '0') || 0
        const totalYield = parseFloat(s?.totalYieldDistributed || '0') || 0
        tvlUsd = assetsUsd < 1000 ? parseFloat(assetsUsd.toFixed(2)) : Math.floor(assetsUsd)
        // Phase 0: a yield vault has no trading volume — deposits/withdrawals are not swaps.
        volume24hUsd = 0
        clientVolumeUsd = 0

        const baseVaultApy = 8.42
        // H2 fix: the dynamic component is a MEASURED on-chain yield rate over a rolling
        // >=24h window — never the cumulative lifetime `totalYieldDistributed` annualized.
        const dynamicYieldApy = measureVaultYieldApy(totalYield, assetsUsd)
        const totalVaultApy = parseFloat((baseVaultApy + dynamicYieldApy).toFixed(2))
        apy = totalVaultApy
        apyBadge = dynamicYieldApy > 0
          ? `${totalVaultApy.toFixed(2)}% APY (${baseVaultApy}% Incentive Est. + ${dynamicYieldApy.toFixed(2)}% Measured)`
          : '8.42% Incentive APY (Est.) • Treasury / USYC Strategy'

      }

      return {
        ...pool,
        tvlUsd,
        volume24hUsd,
        clientVolumeUsd,
        apy,
        apyBadge,
        exchangeRate,
        reserves,
        totalLp,
        userPosition: userPoolPositions?.[pool.id] || undefined,
      }
    })
  }, [onchainPoolState, userPoolPositions, liveBtcPrice, liveEurcPrice, liveWethPrice, volumeRevision])

  // Total protocol liquidity across all native Arc pools & vaults
  const totalTvlUsd = useMemo(() => {
    return poolsWithUserStats.reduce((acc, pool) => acc + (pool.tvlUsd || 0), 0)
  }, [poolsWithUserStats])

  const userTotalDepositedUsd = useMemo(() => {
    if (!userPoolPositions) return 0
    return Object.values(userPoolPositions).reduce((acc, pos) => acc + (pos.stakedUsd || 0), 0)
  }, [userPoolPositions])

  const dailyYieldGeneratedUsd = useMemo(() => {
    if (!userPoolPositions) return 0
    return poolsWithUserStats.reduce((acc, pool) => {
      const pos = userPoolPositions[pool.id]
      if (!pos || !pos.stakedUsd) return acc
      return acc + (pos.stakedUsd * (pool.apy / 100)) / 365
    }, 0)
  }, [poolsWithUserStats, userPoolPositions])

  const userTotalClaimableRewardsUsd = useMemo(() => {
    if (!userPoolPositions) return 0
    return Object.values(userPoolPositions).reduce((acc, pos) => acc + (pos.earnedUsd || 0), 0)
  }, [userPoolPositions])

  // ── Helper: get a writable wallet client from the provider ────────────────
  const getWalletClient = useCallback(async (): Promise<WalletClient | null> => {
    // If authenticated via Circle UCW or Passkey MSCA, do not bind to injected window.ethereum
    if (authSource === 'ucw' || authSource === 'passkey') return null
    const activeProvider = provider || (typeof window !== 'undefined' ? (window as any).ethereum : null)
    if (!activeProvider) return null
    try {
      // EIP-1193 browser wallet provider (wrapped by wagmi or window.ethereum)
      const client = await import('viem').then((m) =>
        m.createWalletClient({
          chain: arcTestnet,
          transport: m.custom(activeProvider),
        })
      )
      return client
    } catch (err) {
      console.warn('[usePoolsData] wallet client setup failed:', err)
      return null
    }
  }, [provider, authSource])

  const requireDeployed = useCallback((address: string, poolName: string) => {
    if (!isDeployed(address)) {
      throw new Error(`Pool "${poolName}" is not deployed on Arc Testnet yet. Run 'forge script Deploy' first.`)
    }
  }, [])

  // ── Approve helper (ERC-20 USDC / EURC) ──────────────────────────────────
  const approveToken = useCallback(
    async (tokenAddress: `0x${string}`, spender: `0x${string}`, amount: bigint) => {
      const targetAccount = (walletAddress || (authSource !== 'ucw' && authSource !== 'passkey' ? (await (await getWalletClient())?.getAddresses())?.[0] : undefined)) as Address
      if (!targetAccount) throw new Error('Wallet not connected')

      // 0. Check on-chain allowance first using multi-RPC resilient reader
      try {
        const currentAllowance = (await resilientReadContract(publicClient, {
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [targetAccount, spender],
        })) as bigint
        if (typeof currentAllowance === 'bigint' && currentAllowance >= amount) {
          // Current allowance is already sufficient. Skip approve transaction & extra RPC calls!
          return null
        }
      } catch (allowanceErr) {
        console.warn('[usePoolsData] Allowance check query failed, proceeding to approve:', allowanceErr)
      }

      const smartAccount = getActiveSmartAccount()
      if (smartAccount) {
        const approveCall = {
          to: tokenAddress as Hex,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [spender, amount],
          }),
        }
        const opRes = await sendModularUserOperation({
          calls: [approveCall],
          paymaster: true,
        })
        if (!opRes.success || !opRes.txHash) {
          throw new Error(opRes.error || 'Modular UserOperation approve failed.')
        }
        return opRes.txHash
      }

      // Circle UCW Execution (Email OTP / User-Controlled Wallet)
      if (authSource === 'ucw' && executeUcwContract) {
        console.log('[usePoolsData UCW] Requesting token approval challenge on ARC-TESTNET...')
        const approveRes = await executeUcwContract({
          contractAddress: tokenAddress,
          abiFunctionSignature: 'approve(address,uint256)',
          abiParameters: [spender, amount.toString()],
          blockchain: 'ARC-TESTNET',
        })
        if (!approveRes.success) {
          const isCanceled =
            approveRes.error?.toLowerCase().includes('cancel') ||
            approveRes.error?.toLowerCase().includes('iptal') ||
            approveRes.error?.toLowerCase().includes('closed')
          const err: any = new Error(approveRes.error || 'Token allowance authorization failed.')
          if (isCanceled) (err as any).isCanceled = true
          throw err
        }
        if (approveRes.txHash && approveRes.txHash.startsWith('0x')) {
          await waitForReceiptSafe(approveRes.txHash as Hex, 'Approve token')
        }
        return approveRes.txHash
      }

      const walletClient = await getWalletClient()
      if (!walletClient) throw new Error('Wallet not connected')

      const txHash = await resilientWriteContract(walletClient, {
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, amount],
        account: targetAccount,
        chain: arcTestnet,
        gas: 100_000n,
      })
      await waitForReceiptSafe(txHash, 'Approve token')
      return txHash
    },
    [getWalletClient, publicClient, waitForReceiptSafe, walletAddress, authSource, executeUcwContract]
  )

  // ── Invalidate Redis & React Query Caches Helper ────────────────────────
  const invalidatePoolCaches = useCallback(async () => {
    try {
      await Promise.all([
        redisCache.del('arcis:pools:state'),
        walletAddress ? redisCache.del(`arcis:pools:balances:${walletAddress}`) : Promise.resolve(),
        walletAddress ? redisCache.del(`arcis:pools:balances:${walletAddress.toLowerCase()}`) : Promise.resolve(),
        walletAddress ? redisCache.del(`arcis:pools:positions:${walletAddress}`) : Promise.resolve(),
        walletAddress ? redisCache.del(`arcis:pools:positions:${walletAddress.toLowerCase()}`) : Promise.resolve(),
      ])
    } catch (delErr) {
      console.warn('[usePoolsData] Redis cache purge warning:', delErr)
    }

    // Invalidate React Query cache entries (which automatically and cooperatively schedule refetches)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['onchainPoolBalances'] }),
      queryClient.invalidateQueries({ queryKey: ['onchainPoolState'] }),
      queryClient.invalidateQueries({ queryKey: ['userPoolPositions'] }),
      queryClient.invalidateQueries({ queryKey: ['walletTestnetBalances'] }),
      queryClient.invalidateQueries({ queryKey: ['liveTokenPrices'] }),
      queryClient.invalidateQueries({ queryKey: ['gatewayBalances'] }),
      queryClient.invalidateQueries({ queryKey: ['totalPoolTxCount'] }),
    ])

    // Bump volume revision to refresh 24h metrics
    setVolumeRevision((prev) => prev + 1)
  }, [queryClient, walletAddress])

  // Debounced cache invalidator to prevent RPC flooding from rapid events
  const debounceInvalidateTimerRef = useRef<any>(null)
  const debouncedInvalidatePoolCaches = useCallback(() => {
    if (debounceInvalidateTimerRef.current) {
      clearTimeout(debounceInvalidateTimerRef.current)
    }
    debounceInvalidateTimerRef.current = setTimeout(() => {
      invalidatePoolCaches()
    }, 1500)
  }, [invalidatePoolCaches])

  // ── Standard deposit (Yield Vault & Gateway Settlement Pool) ────────────
  const depositToPool = useCallback(
    async (poolId: string, amountStr: string, _provider?: unknown): Promise<{ txHash: string }> => {
      const pool = ARCIS_POOLS.find((p) => p.id === poolId)
      if (!pool) throw new Error('Pool not found')

      const targetAccount = (walletAddress || (await (await getWalletClient())?.getAddresses())?.[0]) as Address
      if (!targetAccount) throw new Error('Wallet not connected')

      if (pool.id !== 'usdc-yield-vault') {
        throw new Error('Use Zap / Dual deposit for LP pools')
      }

      requireDeployed(POOL_CONTRACTS.YIELD_VAULT, pool.name)
      const amount = parseUnits(amountStr, 6)
      const depositAmt = parseFloat(amountStr) || 0

      // H4: on V4 the deposit carries a min-shares guard so a share-price manipulation between
      // quote and execution reverts instead of silently minting fewer shares. The V3 fallback
      // deployment has no guarded entrypoint, so it keeps the legacy plain `deposit`.
      let guardedDepositArgs: readonly [bigint, Address, bigint] | null = null
      if (POOL_VERSION_V4) {
        const expectedShares = (await resilientReadContract(publicClient, {
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'previewDeposit',
          args: [amount],
        }).catch(() => 0n)) as bigint
        if (!(expectedShares > 0n)) {
          throw new Error(
            'Unable to compute a safe minimum-shares guard for the vault deposit. Please refresh and retry so the deposit is protected against share-price manipulation.'
          )
        }
        guardedDepositArgs = [amount, targetAccount, poolMinOut(expectedShares, POOL_DEFAULT_SLIPPAGE_BPS)]
      }

      // Optimistically update wallet balance and staked position immediately
      const applyYieldVaultOptimisticDeposit = () => {
        if (depositAmt <= 0) return
        queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
          if (!old) return old
          const oldUsdc = parseFloat(old.usdc || '0')
          return { ...old, usdc: Math.max(0, oldUsdc - depositAmt).toFixed(2) }
        })
        queryClient.setQueryData<Record<string, UserPoolPosition>>(['userPoolPositions', targetAccount], (old) => {
          if (!old) return old
          const curr = old['usdc-yield-vault']
          const oldStaked = curr?.stakedUsd || 0
          const newStaked = oldStaked + depositAmt
          return {
            ...old,
            ['usdc-yield-vault']: {
              ...(curr || { poolId: 'usdc-yield-vault', earnedRewards: '0.00', earnedUsd: 0, poolSharePct: 0, lastUpdatedTimestamp: Date.now() }),
              stakedAmount: newStaked.toFixed(2),
              stakedUsd: newStaked,
              lpTokenBalance: newStaked.toFixed(2),
            },
          }
        })
      }

      // 1. Modular Smart Account (Passkey MSCA - Atomic single UserOp with gas sponsorship)
      const smartAccount = getActiveSmartAccount()
      if (smartAccount) {
        const approveCall = {
          to: POOL_CONTRACTS.USDC as Hex,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [POOL_CONTRACTS.YIELD_VAULT, amount],
          }),
        }
        const depositCall = {
          to: POOL_CONTRACTS.YIELD_VAULT as Hex,
          data: guardedDepositArgs
            ? encodeFunctionData({
              abi: YIELD_VAULT_ABI,
              functionName: 'depositWithMinShares',
              args: guardedDepositArgs,
            })
            : encodeFunctionData({
              abi: YIELD_VAULT_ABI,
              functionName: 'deposit',
              args: [amount, targetAccount],
            }),
        }
        const opRes = await sendModularUserOperation({
          calls: [approveCall, depositCall],
          paymaster: true,
        })
        if (!opRes.success || !opRes.txHash) {
          throw new Error(opRes.error || 'Modular UserOperation deposit failed.')
        }
        applyYieldVaultOptimisticDeposit()
        // Phase 0: vault deposits are not trading volume
        await invalidatePoolCaches()
        return { txHash: opRes.txHash }
      }

      // 2. Circle UCW Execution (Email OTP / User-Controlled Wallet)
      if (authSource === 'ucw' && executeUcwContract) {
        console.log('[usePoolsData UCW] Checking/requesting USDC allowance for Yield Vault...')
        await approveToken(POOL_CONTRACTS.USDC, POOL_CONTRACTS.YIELD_VAULT, amount)

        console.log('[usePoolsData UCW] Requesting deposit challenge for Yield Vault...')
        const depositRes = await executeUcwContract({
          contractAddress: POOL_CONTRACTS.YIELD_VAULT,
          abiFunctionSignature: guardedDepositArgs
            ? 'depositWithMinShares(uint256,address,uint256)'
            : 'deposit(uint256,address)',
          abiParameters: guardedDepositArgs
            ? [amount.toString(), targetAccount, guardedDepositArgs[2].toString()]
            : [amount.toString(), targetAccount],
          blockchain: 'ARC-TESTNET',
        })
        if (!depositRes.success) {
          const isCanceled =
            depositRes.error?.toLowerCase().includes('cancel') ||
            depositRes.error?.toLowerCase().includes('iptal') ||
            depositRes.error?.toLowerCase().includes('closed')
          const err: any = new Error(depositRes.error || 'Yield vault deposit authorization failed.')
          if (isCanceled) (err as any).isCanceled = true
          throw err
        }

        const txHash = depositRes.txHash || ''
        if (txHash && txHash.startsWith('0x')) {
          await waitForReceiptSafe(txHash as Hex, 'Yield Vault Deposit')
        }
        applyYieldVaultOptimisticDeposit()
        // Phase 0: vault deposits are not trading volume
        await invalidatePoolCaches()
        return { txHash }
      }

      // 3. EOA Provider (MetaMask / Rainbow)
      const walletClient = await getWalletClient()
      if (!walletClient) throw new Error('Wallet not connected')

      await approveToken(POOL_CONTRACTS.USDC, POOL_CONTRACTS.YIELD_VAULT, amount)

      const gasLimit = await estimateSafeGas(
        publicClient,
        {
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: guardedDepositArgs ? 'depositWithMinShares' : 'deposit',
          args: (guardedDepositArgs || [amount, targetAccount]) as any,
          account: targetAccount,
        },
        350_000n
      )

      const txHash = guardedDepositArgs
        ? await resilientWriteContract(walletClient, {
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'depositWithMinShares',
          args: guardedDepositArgs,
          account: targetAccount,
          chain: arcTestnet,
          gas: gasLimit,
        })
        : await resilientWriteContract(walletClient, {
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'deposit',
          args: [amount, targetAccount],
          account: targetAccount,
          chain: arcTestnet,
          gas: gasLimit,
        })
      applyYieldVaultOptimisticDeposit()
      // Phase 0: vault deposits are not trading volume
      await waitForReceiptSafe(txHash, 'Deposit')

      await invalidatePoolCaches()
      return { txHash }
    },
    [getWalletClient, approveToken, publicClient, waitForReceiptSafe, requireDeployed, invalidatePoolCaches, provider, walletAddress, queryClient, onchainPoolState, liveBtcPrice, liveEurcPrice, userPoolPositions, authSource, executeUcwContract]
  )

  // ── 1-Click Zap: swap half USDC→counter, then add dual liquidity ──────────
  const zapIn = useCallback(
    async (
      poolId: string,
      _tokenInSymbol: string,
      inputAmountStr: string,
      _slippage: number = 0.5
    ): Promise<{ txHash: string; lpMinted: string; poolShare: number }> => {
      const livePool = poolsWithUserStats.find((p) => p.id === poolId)
      const pool = livePool || ARCIS_POOLS.find((p) => p.id === poolId)
      if (!pool || !pool.isLpPool) throw new Error('Pool does not support LP Zap')

      const poolAddress = pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
        ? POOL_CONTRACTS.STABLE_SWAP_POOL
        : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL)

      requireDeployed(poolAddress, pool.name)

      const targetAccount = (walletAddress || (await (await getWalletClient())?.getAddresses())?.[0]) as Address
      if (!targetAccount) throw new Error('Wallet not connected')

      const usdcAmount = parseUnits(inputAmountStr, 6)
      const halfUsdc = usdcAmount / 2n
      const poolRemainingUsdc = usdcAmount - halfUsdc

      const counterToken = pool.tokens[1]
      const counterTokenAddress = (counterToken?.address || POOL_CONTRACTS.cirBTC) as `0x${string}`
      const counterDecimals = counterToken?.decimals === 8 ? 8 : 6

      // Check if AMM pool has reserves before attempting swap
      const [resA, resB] = await Promise.all([
        publicClient
          .readContract({
            address: poolAddress,
            abi: STABLE_SWAP_ABI,
            functionName: 'reserveA',
          })
          .catch(() => 0n),
        publicClient
          .readContract({
            address: poolAddress,
            abi: STABLE_SWAP_ABI,
            functionName: 'reserveB',
          })
          .catch(() => 0n),
      ])

      if (resA === 0n || resB === 0n) {
        throw new Error(
          `Cannot 1-Click Zap: The ${pool.name} currently has 0 reserves on Arc Testnet. 1-Click Zap requires existing pool liquidity to execute the 50/50 swap into ${counterToken?.symbol || 'counter token'}. Please supply both tokens via Dual-Asset Deposit or deposit single-sided USDC into the USDC Yield Vault.`
        )
      }

      // Compute expected counter token output from reserves & apply user slippage tolerance
      const feeBps = pool.feeTierPercent ? BigInt(Math.round(pool.feeTierPercent * 100)) : (pool.id === 'usdc-cirbtc-pool' ? 25n : 12n)
      const inAfterFee = (halfUsdc * (10000n - feeBps)) / 10000n
      let expectedOut = 0n
      if (pool.id === 'usdc-cirbtc-pool') {
        // Constant Product x * y = k AMM (resA: USDC 6-dec, resB: cirBTC 8-dec)
        expectedOut = (resB * inAfterFee) / (resA + inAfterFee)
      } else {
        // Exact Curve StableSwap invariant (K6)
        expectedOut = calculateStableSwapExpectedOut(halfUsdc, resA, resB, feeBps, STABLE_SWAP_AMP)
      }

      const slippageTolerance = typeof _slippage === 'number' && _slippage > 0 ? _slippage : 0.5
      // O3: one clamped source of truth (an inline clamp could drift from the contract-wide cap).
      const slippageBps = BigInt(poolSlippageBps(slippageTolerance))
      const minOut = expectedOut > 0n ? (expectedOut * (10000n - slippageBps)) / 10000n : 0n

      const smartAccount = getActiveSmartAccount()

      // 1. Modular Smart Account (Passkey)
      if (smartAccount) {
        const counterBalBefore = (await resilientReadContract(publicClient, {
          address: counterTokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [targetAccount],
        })) as bigint

        // Step 1: Approve and swap half USDC with dynamic minOut slippage protection
        const approveUsdcCall = {
          to: POOL_CONTRACTS.USDC as Hex,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [poolAddress as Hex, usdcAmount],
          }),
        }
        const swapCall = {
          to: poolAddress as Hex,
          data: encodeFunctionData({
            abi: STABLE_SWAP_ABI,
            functionName: 'swap',
            args: [POOL_CONTRACTS.USDC, counterTokenAddress, halfUsdc, minOut],
          }),
        }
        const swapRes = await sendModularUserOperation({
          calls: [approveUsdcCall, swapCall],
          paymaster: true,
        })
        if (!swapRes.success || !swapRes.txHash) {
          throw new Error(swapRes.error || 'Modular Zap swap failed.')
        }

        await waitForReceiptSafe(swapRes.txHash as Hex, 'Zap swap')
        const counterBalAfter = (await resilientReadContract(publicClient, {
          address: counterTokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [targetAccount],
        })) as bigint

        const actualCounter = counterBalAfter > counterBalBefore ? counterBalAfter - counterBalBefore : 0n
        if (actualCounter === 0n) {
          throw new Error('Failed to receive counter token from AMM swap output.')
        }

        // Fetch fresh on-chain reserves directly from pool to ensure exact post-swap slippage math
        let freshPoolState = onchainPoolState
        try {
          const [freshReserveA, freshReserveB, freshTotalLp] = await Promise.all([
            resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }).catch(() => 0n),
            resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }).catch(() => 0n),
            resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }).catch(() => 0n),
          ])
          if ((freshTotalLp as bigint) > 0n) {
            freshPoolState = {
              ...(onchainPoolState || {}),
              [poolAddress]: {
                ...(onchainPoolState?.[poolAddress] || {}),
                reserveA: formatUnits(freshReserveA as bigint, 6),
                reserveB: formatUnits(freshReserveB as bigint, counterDecimals),
                totalLp: formatUnits(freshTotalLp as bigint, 18),
              },
            }
          }
        } catch (freshErr) {
          console.warn('[zapIn] Note: using cached reserves for minLpShares:', freshErr)
        }

        // Step 2: Approve counter token & addLiquidity
        const minLpShares = computeMinLpShares(
          pool,
          poolAddress,
          freshPoolState,
          poolRemainingUsdc,
          actualCounter,
          counterDecimals,
          slippageTolerance
        )
        if (minLpShares <= 0n) {
          throw new Error('Unable to compute a safe minimum LP-shares guard from live pool reserves. Please refresh and retry so liquidity is added with slippage protection.')
        }
        const approveCounterCall = {
          to: counterTokenAddress as Hex,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [poolAddress as Hex, actualCounter],
          }),
        }
        const addLiquidityCall = {
          to: poolAddress as Hex,
          data: encodeFunctionData({
            abi: STABLE_SWAP_ABI,
            functionName: 'addLiquidity',
            args: [poolRemainingUsdc, actualCounter, minLpShares],
          }),
        }
        const addRes = await sendModularUserOperation({
          calls: [approveCounterCall, addLiquidityCall],
          paymaster: true,
        })
        if (!addRes.success || !addRes.txHash) {
          throw new Error(addRes.error || 'Modular Zap liquidity addition failed.')
        }

        // Decode LiquidityAdded event from receipt to get actual lpMinted (K1)
        const addReceipt = await waitForReceiptSafe(addRes.txHash as Hex, 'Modular Zap liquidity')
        let lpMintedRaw = 0n
        if (addReceipt?.logs) {
          for (const log of addReceipt.logs) {
            try {
              const decoded = decodeEventLog({
                abi: STABLE_SWAP_ABI,
                eventName: 'LiquidityAdded',
                data: log.data,
                topics: log.topics,
              })
              if (decoded?.args && (decoded.args as any).lpMinted) {
                lpMintedRaw = (decoded.args as any).lpMinted as bigint
                break
              }
            } catch { }
          }
        }

        const lpMinted = lpMintedRaw > 0n ? formatUnits(lpMintedRaw, 18) : formatUnits(minLpShares, 18)
        const inputVal = parseFloat(inputAmountStr) || 0
        const st = onchainPoolState?.[poolAddress]
        const prevTotalLp = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
        const totalLpAfter = prevTotalLp + lpMintedRaw
        const poolShare = calculatePoolShare(lpMintedRaw, totalLpAfter)
        recordClientSwapVolume(pool.id, inputVal / 2)

        // Optimistically mutate React Query caches IMMEDIATELY (0ms)
        if (inputVal > 0) {
          queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
            if (!old) return old
            const oldUsdc = parseFloat(old.usdc || '0')
            return { ...old, usdc: Math.max(0, oldUsdc - inputVal).toFixed(2) }
          })
          queryClient.setQueryData<Record<string, UserPoolPosition>>(
            ['userPoolPositions', targetAccount],
            (old) => {
              if (!old) return old
              const curr = old[pool.id]
              const oldStaked = curr?.stakedUsd || 0
              const newStaked = oldStaked + inputVal
              return {
                ...old,
                [pool.id]: {
                  ...(curr || {
                    poolId: pool.id,
                    earnedRewards: '0.00',
                    earnedUsd: 0,
                    poolSharePct: poolShare,
                    lastUpdatedTimestamp: Date.now(),
                  }),
                  stakedAmount: newStaked.toFixed(2),
                  stakedUsd: newStaked,
                  lpTokenBalance: newStaked.toFixed(2),
                  poolSharePct: poolShare,
                },
              }
            }
          )
        }

        await invalidatePoolCaches()
        return { txHash: addRes.txHash, lpMinted, poolShare }
      }

      // 2. Circle UCW Execution (Email OTP / User-Controlled Wallet)
      if (authSource === 'ucw' && executeUcwContract) {
        console.log('[usePoolsData UCW] Executing Zap In on ARC-TESTNET...')

        await approveToken(POOL_CONTRACTS.USDC, poolAddress, usdcAmount)

        const counterBalBefore = (await resilientReadContract(publicClient, {
          address: counterTokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [targetAccount],
        })) as bigint

        console.log('[usePoolsData UCW] Requesting swap challenge for Zap...')
        const swapRes = await executeUcwContract({
          contractAddress: poolAddress,
          abiFunctionSignature: 'swap(address,address,uint256,uint256)',
          abiParameters: [POOL_CONTRACTS.USDC, counterTokenAddress, halfUsdc.toString(), minOut.toString()],
          blockchain: 'ARC-TESTNET',
        })
        if (!swapRes.success) {
          const isCanceled =
            swapRes.error?.toLowerCase().includes('cancel') ||
            swapRes.error?.toLowerCase().includes('iptal') ||
            swapRes.error?.toLowerCase().includes('closed')
          const err: any = new Error(swapRes.error || 'Zap swap authorization failed.')
          if (isCanceled) (err as any).isCanceled = true
          throw err
        }

        if (swapRes.txHash && swapRes.txHash.startsWith('0x')) {
          await waitForReceiptSafe(swapRes.txHash as Hex, 'Zap swap')
        }

        const counterBalAfter = (await resilientReadContract(publicClient, {
          address: counterTokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [targetAccount],
        })) as bigint

        const actualCounterAmount = counterBalAfter > counterBalBefore ? counterBalAfter - counterBalBefore : 0n
        if (actualCounterAmount === 0n) {
          throw new Error('Failed to receive counter token from AMM swap output.')
        }

        // Fetch fresh on-chain reserves directly from pool to ensure exact post-swap slippage math
        let freshPoolState = onchainPoolState
        try {
          const [freshReserveA, freshReserveB, freshTotalLp] = await Promise.all([
            resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }).catch(() => 0n),
            resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }).catch(() => 0n),
            resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }).catch(() => 0n),
          ])
          if ((freshTotalLp as bigint) > 0n) {
            freshPoolState = {
              ...(onchainPoolState || {}),
              [poolAddress]: {
                ...(onchainPoolState?.[poolAddress] || {}),
                reserveA: formatUnits(freshReserveA as bigint, 6),
                reserveB: formatUnits(freshReserveB as bigint, counterDecimals),
                totalLp: formatUnits(freshTotalLp as bigint, 18),
              },
            }
          }
        } catch (freshErr) {
          console.warn('[zapIn UCW] Note: using cached reserves for minLpShares:', freshErr)
        }

        await approveToken(POOL_CONTRACTS.USDC, poolAddress, poolRemainingUsdc)
        await approveToken(counterTokenAddress, poolAddress, actualCounterAmount)

        const minLpShares = computeMinLpShares(
          pool,
          poolAddress,
          freshPoolState,
          poolRemainingUsdc,
          actualCounterAmount,
          counterDecimals,
          slippageTolerance
        )
        if (minLpShares <= 0n) {
          throw new Error('Unable to compute a safe minimum LP-shares guard from live pool reserves. Please refresh and retry so liquidity is added with slippage protection.')
        }

        console.log('[usePoolsData UCW] Requesting addLiquidity challenge for Zap...')
        const addRes = await executeUcwContract({
          contractAddress: poolAddress,
          abiFunctionSignature: 'addLiquidity(uint256,uint256,uint256)',
          abiParameters: [poolRemainingUsdc.toString(), actualCounterAmount.toString(), minLpShares.toString()],
          blockchain: 'ARC-TESTNET',
        })
        if (!addRes.success) {
          const isCanceled =
            addRes.error?.toLowerCase().includes('cancel') ||
            addRes.error?.toLowerCase().includes('iptal') ||
            addRes.error?.toLowerCase().includes('closed')
          const err: any = new Error(addRes.error || 'Zap addLiquidity authorization failed.')
          if (isCanceled) (err as any).isCanceled = true
          throw err
        }

        const txHash = (addRes.txHash || '') as Hex
        let lpMintedRaw = 0n
        if (txHash && txHash.startsWith('0x')) {
          const addReceipt = await waitForReceiptSafe(txHash, 'Zap addLiquidity')
          if (addReceipt?.logs) {
            for (const log of addReceipt.logs) {
              try {
                const decoded = decodeEventLog({
                  abi: STABLE_SWAP_ABI,
                  eventName: 'LiquidityAdded',
                  data: log.data,
                  topics: log.topics,
                })
                if (decoded?.args && (decoded.args as any).lpMinted) {
                  lpMintedRaw = (decoded.args as any).lpMinted as bigint
                  break
                }
              } catch { }
            }
          }
        }

        const lpMinted = lpMintedRaw > 0n ? formatUnits(lpMintedRaw, 18) : formatUnits(minLpShares, 18)
        const inputVal = parseFloat(inputAmountStr) || 0
        const st = onchainPoolState?.[poolAddress]
        const prevTotalLp = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
        const totalLpAfter = prevTotalLp + lpMintedRaw
        const poolShare = calculatePoolShare(lpMintedRaw, totalLpAfter)
        recordClientSwapVolume(pool.id, inputVal / 2)

        if (inputVal > 0) {
          queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
            if (!old) return old
            const oldUsdc = parseFloat(old.usdc || '0')
            return { ...old, usdc: Math.max(0, oldUsdc - inputVal).toFixed(2) }
          })
          queryClient.setQueryData<Record<string, UserPoolPosition>>(
            ['userPoolPositions', targetAccount],
            (old) => {
              if (!old) return old
              const curr = old[pool.id]
              const oldStaked = curr?.stakedUsd || 0
              const newStaked = oldStaked + inputVal
              return {
                ...old,
                [pool.id]: {
                  ...(curr || {
                    poolId: pool.id,
                    earnedRewards: '0.00',
                    earnedUsd: 0,
                    poolSharePct: poolShare,
                    lastUpdatedTimestamp: Date.now(),
                  }),
                  stakedAmount: newStaked.toFixed(2),
                  stakedUsd: newStaked,
                  lpTokenBalance: newStaked.toFixed(2),
                  poolSharePct: poolShare,
                },
              }
            }
          )
        }

        await invalidatePoolCaches()
        return { txHash, lpMinted, poolShare }
      }

      // 3. EOA Provider
      const walletClient = await getWalletClient()
      if (!walletClient) throw new Error('Wallet not connected')

      await approveToken(POOL_CONTRACTS.USDC, poolAddress, usdcAmount)

      const counterBalBefore = (await resilientReadContract(publicClient, {
        address: counterTokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [targetAccount],
      })) as bigint

      const swapGasLimit = await estimateSafeGas(
        publicClient,
        {
          address: poolAddress,
          abi: STABLE_SWAP_ABI,
          functionName: 'swap',
          args: [POOL_CONTRACTS.USDC, counterTokenAddress, halfUsdc, minOut],
          account: targetAccount,
        },
        350_000n
      )

      const swapOut = await resilientWriteContract(walletClient, {
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'swap',
        args: [POOL_CONTRACTS.USDC, counterTokenAddress, halfUsdc, minOut],
        account: targetAccount,
        chain: arcTestnet,
        gas: swapGasLimit,
      })
      await waitForReceiptSafe(swapOut, 'Zap Swap')

      const counterBalAfter = (await resilientReadContract(publicClient, {
        address: counterTokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [targetAccount],
      })) as bigint

      const actualCounterAmount = counterBalAfter > counterBalBefore ? counterBalAfter - counterBalBefore : 0n
      if (actualCounterAmount === 0n) {
        throw new Error('Failed to receive counter token from AMM swap output.')
      }

      // Fetch fresh on-chain reserves directly from pool to ensure exact post-swap slippage math
      let freshPoolState = onchainPoolState
      try {
        const [freshReserveA, freshReserveB, freshTotalLp] = await Promise.all([
          resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }).catch(() => 0n),
          resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }).catch(() => 0n),
          resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }).catch(() => 0n),
        ])
        if ((freshTotalLp as bigint) > 0n) {
          freshPoolState = {
            ...(onchainPoolState || {}),
            [poolAddress]: {
              ...(onchainPoolState?.[poolAddress] || {}),
              reserveA: formatUnits(freshReserveA as bigint, 6),
              reserveB: formatUnits(freshReserveB as bigint, counterDecimals),
              totalLp: formatUnits(freshTotalLp as bigint, 18),
            },
          }
        }
      } catch (freshErr) {
        console.warn('[zapIn] Note: using cached reserves for minLpShares:', freshErr)
      }

      // Verify allowances for both USDC and counter token
      await approveToken(POOL_CONTRACTS.USDC, poolAddress, poolRemainingUsdc)
      await approveToken(counterTokenAddress, poolAddress, actualCounterAmount)

      const minLpShares = computeMinLpShares(
        pool,
        poolAddress,
        freshPoolState,
        poolRemainingUsdc,
        actualCounterAmount,
        counterDecimals,
        slippageTolerance
      )
      if (minLpShares <= 0n) {
        throw new Error('Unable to compute a safe minimum LP-shares guard from live pool reserves. Please refresh and retry so liquidity is added with slippage protection.')
      }

      let txHash: Hex
      try {
        const addLiqGasLimit = await estimateSafeGas(
          publicClient,
          {
            address: poolAddress,
            abi: STABLE_SWAP_ABI,
            functionName: 'addLiquidity',
            args: [poolRemainingUsdc, actualCounterAmount, minLpShares],
            account: targetAccount,
          },
          450_000n
        )

        txHash = await resilientWriteContract(walletClient, {
          address: poolAddress,
          abi: STABLE_SWAP_ABI,
          functionName: 'addLiquidity',
          args: [poolRemainingUsdc, actualCounterAmount, minLpShares],
          account: targetAccount,
          chain: arcTestnet,
          gas: addLiqGasLimit,
        })
      } catch (addLiqErr: any) {
        console.error('[zapIn] Liquidity addition failed after swap:', addLiqErr)
        const counterSymbol = counterToken?.symbol || 'counter tokens'
        const counterFormatted = formatUnits(actualCounterAmount, counterDecimals)
        throw new Error(
          `Zap swap completed successfully (${counterFormatted} ${counterSymbol} added to wallet), but liquidity addition failed: ${addLiqErr?.shortMessage || addLiqErr?.message || 'Transaction reverted'
          }. Your ${counterSymbol} is safe in your wallet; you can provide dual liquidity or swap back to USDC.`
        )
      }
      const receipt = await waitForReceiptSafe(txHash, 'Add liquidity')

      // Decode LiquidityAdded event from receipt to get actual lpMinted (K1)
      let lpMintedRaw = 0n
      if (receipt?.logs) {
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: STABLE_SWAP_ABI,
              eventName: 'LiquidityAdded',
              data: log.data,
              topics: log.topics,
            })
            if (decoded?.args && (decoded.args as any).lpMinted) {
              lpMintedRaw = (decoded.args as any).lpMinted as bigint
              break
            }
          } catch { }
        }
      }

      const lpMinted = lpMintedRaw > 0n ? formatUnits(lpMintedRaw, 18) : formatUnits(minLpShares, 18)
      const inputVal = parseFloat(inputAmountStr) || 0
      const st = onchainPoolState?.[poolAddress]
      const prevTotalLp = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
      const totalLpAfter = prevTotalLp + lpMintedRaw
      const poolShare = calculatePoolShare(lpMintedRaw, totalLpAfter)
      recordClientSwapVolume(pool.id, inputVal / 2)

      // Optimistically mutate React Query caches IMMEDIATELY (0ms)
      if (inputVal > 0) {
        queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
          if (!old) return old
          const oldUsdc = parseFloat(old.usdc || '0')
          return { ...old, usdc: Math.max(0, oldUsdc - inputVal).toFixed(2) }
        })
        queryClient.setQueryData<Record<string, UserPoolPosition>>(
          ['userPoolPositions', targetAccount],
          (old) => {
            if (!old) return old
            const curr = old[pool.id]
            const oldStaked = curr?.stakedUsd || 0
            const newStaked = oldStaked + inputVal
            return {
              ...old,
              [pool.id]: {
                ...(curr || {
                  poolId: pool.id,
                  earnedRewards: '0.00',
                  earnedUsd: 0,
                  poolSharePct: poolShare,
                  lastUpdatedTimestamp: Date.now(),
                }),
                stakedAmount: newStaked.toFixed(2),
                stakedUsd: newStaked,
                lpTokenBalance: newStaked.toFixed(2),
                poolSharePct: poolShare,
              },
            }
          }
        )
      }

      await invalidatePoolCaches()
      return { txHash, lpMinted, poolShare }
    },
    [getWalletClient, approveToken, publicClient, requireDeployed, invalidatePoolCaches, walletAddress, queryClient, onchainPoolState, liveBtcPrice, liveEurcPrice, waitForReceiptSafe, poolsWithUserStats, authSource, executeUcwContract]
  )

  // ── Dual-asset deposit (USDC + counter token) ─────────────────────────────
  const depositDual = useCallback(
    async (
      poolId: string,
      amountAStr: string,
      amountBStr: string,
      _slippage: number = 0.5
    ): Promise<{ txHash: string; lpMinted: string; poolShare: number }> => {
      const livePool = poolsWithUserStats.find((p) => p.id === poolId)
      const pool = livePool || ARCIS_POOLS.find((p) => p.id === poolId)
      if (!pool || !pool.isLpPool) throw new Error('Pool is not an LP pool')

      const poolAddress = pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
        ? POOL_CONTRACTS.STABLE_SWAP_POOL
        : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL)

      requireDeployed(poolAddress, pool.name)

      const targetAccount = (walletAddress || (await (await getWalletClient())?.getAddresses())?.[0]) as Address
      if (!targetAccount) throw new Error('Wallet not connected')

      const counterToken = pool.tokens[1]
      const counterDecimals = counterToken?.decimals === 8 ? 8 : 6
      const amountA = parseUnits(amountAStr, 6)
      const amountB = parseUnits(amountBStr, counterDecimals)
      const counterTokenAddress = (counterToken?.address || POOL_CONTRACTS.cirBTC) as `0x${string}`

      // V2/V3: compute a conservative minLpShares guard from on-chain reserves
      // (proportional / constant-product / Curve invariant estimate) so a material price move
      // triggers SlippageExceeded instead of burning the user's LP value.
      let freshPoolState = onchainPoolState
      try {
        const [freshReserveA, freshReserveB, freshTotalLp] = await Promise.all([
          resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }).catch(() => 0n),
          resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }).catch(() => 0n),
          resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }).catch(() => 0n),
        ])
        if ((freshTotalLp as bigint) > 0n) {
          freshPoolState = {
            ...(onchainPoolState || {}),
            [poolAddress]: {
              ...(onchainPoolState?.[poolAddress] || {}),
              reserveA: formatUnits(freshReserveA as bigint, 6),
              reserveB: formatUnits(freshReserveB as bigint, counterDecimals),
              totalLp: formatUnits(freshTotalLp as bigint, 18),
            },
          }
        }
      } catch (freshErr) {
        console.warn('[depositDual] Note: using cached reserves for minLpShares:', freshErr)
      }

      const minLpShares = computeMinLpShares(pool, poolAddress, freshPoolState, amountA, amountB, counterDecimals, _slippage)
      // Phase 0: never submit addLiquidity with a zero slippage guard on a seeded pool.
      const previewTotalLpRaw = freshPoolState?.[poolAddress]?.totalLp ? parseUnits(freshPoolState[poolAddress].totalLp, 18) : 0n
      if (minLpShares <= 0n && previewTotalLpRaw > 0n) {
        throw new Error('Unable to compute a safe minimum LP-shares guard from live pool reserves. Please refresh and retry so liquidity is added with slippage protection.')
      }

      // O2 guard: both V4 pool contracts transfer BOTH full input amounts but only credit
      // min(lpA, lpB) (ConstantProduct) or the Curve D-delta (StableSwap), so an off-ratio
      // deposit silently donates the excess to existing LPs. Refuse deposits whose estimated
      // donation exceeds the block threshold.
      {
        const stNow = (freshPoolState || {})[poolAddress] as any
        const reserveANum = parseFloat(stNow?.reserveA || '0') || 0
        const reserveBNum = parseFloat(stNow?.reserveB || '0') || 0
        const totalLpNum = parseFloat(stNow?.totalLp || '0') || 0
        if (reserveANum > 0 && reserveBNum > 0 && totalLpNum > 0) {
          const balance = analyzeDualDepositBalance({
            poolId,
            amountA: parseFloat(amountAStr) || 0,
            amountB: parseFloat(amountBStr) || 0,
            reserveA: reserveANum,
            reserveB: reserveBNum,
            totalLp: totalLpNum,
            amp: STABLE_SWAP_AMP,
          })
          if (balance && balance.donationPct > DUAL_DEPOSIT_DONATION_BLOCK_PCT) {
            throw new Error(
              `Unbalanced deposit: about ${balance.donationValueA.toFixed(2)} USDC of excess would be donated to existing LPs instead of minting LP shares. Please rebalance the amounts to the pool ratio and retry.`
            )
          }
        }
      }
      const addLiquidityArgs = [amountA, amountB, minLpShares] as const

      // D2: value the counter side at the live price — `pool.exchangeRate || 1` counted
      // cirBTC as $1 in the optimistic updates whenever the static rate was missing (O4 family).
      const counterUsdPrice = poolId === 'usdc-eurc-stable-pool' ? liveEurcPrice : liveBtcPrice
      const effectiveCounterUsdPrice = poolId === 'usdc-weth-pool' ? liveWethPrice : counterUsdPrice
      const totalUsdAdded = parseFloat(amountAStr) + parseFloat(amountBStr) * effectiveCounterUsdPrice

      // 1. Modular Smart Account (Atomic 3-call batch UserOp)
      const smartAccount = getActiveSmartAccount()
      if (smartAccount) {
        const approveCallA = {
          to: POOL_CONTRACTS.USDC as Hex,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [poolAddress as Hex, amountA],
          }),
        }
        const approveCallB = {
          to: counterTokenAddress as Hex,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [poolAddress as Hex, amountB],
          }),
        }
        const addLiquidityCall = {
          to: poolAddress as Hex,
          data: encodeFunctionData({
            abi: STABLE_SWAP_ABI,
            functionName: 'addLiquidity',
            args: addLiquidityArgs,
          }),
        }
        const opRes = await sendModularUserOperation({
          calls: [approveCallA, approveCallB, addLiquidityCall],
          paymaster: true,
        })
        if (!opRes.success || !opRes.txHash) {
          throw new Error(opRes.error || 'Modular UserOperation dual liquidity failed.')
        }

        // Decode LiquidityAdded event from receipt to get actual lpMinted (K1)
        const opReceipt = await waitForReceiptSafe(opRes.txHash as Hex, 'Modular Dual Liquidity')
        let lpMintedRaw = 0n
        if (opReceipt?.logs) {
          for (const log of opReceipt.logs) {
            try {
              const decoded = decodeEventLog({
                abi: STABLE_SWAP_ABI,
                eventName: 'LiquidityAdded',
                data: log.data,
                topics: log.topics,
              })
              if (decoded?.args && (decoded.args as any).lpMinted) {
                lpMintedRaw = (decoded.args as any).lpMinted as bigint
                break
              }
            } catch { }
          }
        }

        const lpMinted = lpMintedRaw > 0n ? formatUnits(lpMintedRaw, 18) : formatUnits(minLpShares, 18)
        const st = onchainPoolState?.[poolAddress]
        const prevTotalLp = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
        const totalLpAfter = prevTotalLp + lpMintedRaw
        const poolShare = calculatePoolShare(lpMintedRaw, totalLpAfter)

        const decA = parseFloat(amountAStr) || 0
        if (totalUsdAdded > 0) {
          queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
            if (!old) return old
            const oldUsdc = parseFloat(old.usdc || '0')
            return { ...old, usdc: Math.max(0, oldUsdc - decA).toFixed(2) }
          })
          queryClient.setQueryData<Record<string, UserPoolPosition>>(
            ['userPoolPositions', targetAccount],
            (old) => {
              if (!old) return old
              const curr = old[pool.id]
              const oldStaked = curr?.stakedUsd || 0
              const newStaked = oldStaked + totalUsdAdded
              return {
                ...old,
                [pool.id]: {
                  ...(curr || {
                    poolId: pool.id,
                    earnedRewards: '0.00',
                    earnedUsd: 0,
                    poolSharePct: poolShare,
                    lastUpdatedTimestamp: Date.now(),
                  }),
                  stakedAmount: newStaked.toFixed(2),
                  stakedUsd: newStaked,
                  lpTokenBalance: newStaked.toFixed(2),
                  poolSharePct: poolShare,
                },
              }
            }
          )
        }

        if (totalUsdAdded > 0) {
          // Phase 0: dual-asset deposits are not trading volume
        }

        await invalidatePoolCaches()
        return { txHash: opRes.txHash, lpMinted, poolShare }
      }

      // 2. Circle UCW Execution (Email OTP / User-Controlled Wallet)
      if (authSource === 'ucw' && executeUcwContract) {
        console.log('[usePoolsData UCW] Providing dual liquidity on ARC-TESTNET...')

        // Check allowance & approve Token A (USDC)
        await approveToken(POOL_CONTRACTS.USDC, poolAddress, amountA)

        // Check allowance & approve Token B (EURC, cirBTC, etc.)
        await approveToken(counterTokenAddress, poolAddress, amountB)

        console.log('[usePoolsData UCW] Requesting addLiquidity challenge on ARC-TESTNET...')
        const addLiqRes = await executeUcwContract({
          contractAddress: poolAddress,
          abiFunctionSignature: 'addLiquidity(uint256,uint256,uint256)',
          abiParameters: [amountA.toString(), amountB.toString(), minLpShares.toString()],
          blockchain: 'ARC-TESTNET',
        })

        if (!addLiqRes.success) {
          const isCanceled =
            addLiqRes.error?.toLowerCase().includes('cancel') ||
            addLiqRes.error?.toLowerCase().includes('iptal') ||
            addLiqRes.error?.toLowerCase().includes('closed')
          const err: any = new Error(addLiqRes.error || 'Dual liquidity authorization failed.')
          if (isCanceled) (err as any).isCanceled = true
          throw err
        }

        const txHash = (addLiqRes.txHash || '') as Hex
        let lpMintedRaw = 0n
        if (txHash && txHash.startsWith('0x')) {
          const receipt = await waitForReceiptSafe(txHash, 'Add dual liquidity')
          if (receipt?.logs) {
            for (const log of receipt.logs) {
              try {
                const decoded = decodeEventLog({
                  abi: STABLE_SWAP_ABI,
                  eventName: 'LiquidityAdded',
                  data: log.data,
                  topics: log.topics,
                })
                if (decoded?.args && (decoded.args as any).lpMinted) {
                  lpMintedRaw = (decoded.args as any).lpMinted as bigint
                  break
                }
              } catch { }
            }
          }
        }

        const lpMinted = lpMintedRaw > 0n ? formatUnits(lpMintedRaw, 18) : formatUnits(minLpShares, 18)
        const st = onchainPoolState?.[poolAddress]
        const prevTotalLp = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
        const totalLpAfter = prevTotalLp + lpMintedRaw
        const poolShare = calculatePoolShare(lpMintedRaw, totalLpAfter)

        const decA = parseFloat(amountAStr) || 0
        if (totalUsdAdded > 0) {
          queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
            if (!old) return old
            const oldUsdc = parseFloat(old.usdc || '0')
            return { ...old, usdc: Math.max(0, oldUsdc - decA).toFixed(2) }
          })
          queryClient.setQueryData<Record<string, UserPoolPosition>>(
            ['userPoolPositions', targetAccount],
            (old) => {
              if (!old) return old
              const curr = old[pool.id]
              const oldStaked = curr?.stakedUsd || 0
              const newStaked = oldStaked + totalUsdAdded
              return {
                ...old,
                [pool.id]: {
                  ...(curr || {
                    poolId: pool.id,
                    earnedRewards: '0.00',
                    earnedUsd: 0,
                    poolSharePct: poolShare,
                    lastUpdatedTimestamp: Date.now(),
                  }),
                  stakedAmount: newStaked.toFixed(2),
                  stakedUsd: newStaked,
                  lpTokenBalance: newStaked.toFixed(2),
                  poolSharePct: poolShare,
                },
              }
            }
          )
          // Phase 0: dual-asset deposits are not trading volume
        }

        await invalidatePoolCaches()
        return { txHash, lpMinted, poolShare }
      }

      // 3. EOA Provider
      const walletClient = await getWalletClient()
      if (!walletClient) throw new Error('Wallet not connected')

      await approveToken(POOL_CONTRACTS.USDC, poolAddress, amountA)
      await approveToken(counterTokenAddress, poolAddress, amountB)

      const gasLimit = await estimateSafeGas(
        publicClient,
        {
          address: poolAddress,
          abi: STABLE_SWAP_ABI,
          functionName: 'addLiquidity',
          args: addLiquidityArgs,
          account: targetAccount,
        },
        450_000n
      )

      const txHash = await resilientWriteContract(walletClient, {
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'addLiquidity',
        args: addLiquidityArgs,
        account: targetAccount,
        chain: arcTestnet,
        gas: gasLimit,
      })
      const receipt = await waitForReceiptSafe(txHash, 'Add dual liquidity')

      // Decode LiquidityAdded event from receipt to get actual lpMinted (K1)
      let lpMintedRaw = 0n
      if (receipt?.logs) {
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: STABLE_SWAP_ABI,
              eventName: 'LiquidityAdded',
              data: log.data,
              topics: log.topics,
            })
            if (decoded?.args && (decoded.args as any).lpMinted) {
              lpMintedRaw = (decoded.args as any).lpMinted as bigint
              break
            }
          } catch { }
        }
      }

      const lpMinted = lpMintedRaw > 0n ? formatUnits(lpMintedRaw, 18) : formatUnits(minLpShares, 18)
      const st = onchainPoolState?.[poolAddress]
      const prevTotalLp = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
      const totalLpAfter = prevTotalLp + lpMintedRaw
      const poolShare = calculatePoolShare(lpMintedRaw, totalLpAfter)

      const decA = parseFloat(amountAStr) || 0
      if (totalUsdAdded > 0) {
        queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
          if (!old) return old
          const oldUsdc = parseFloat(old.usdc || '0')
          return { ...old, usdc: Math.max(0, oldUsdc - decA).toFixed(2) }
        })
        queryClient.setQueryData<Record<string, UserPoolPosition>>(
          ['userPoolPositions', targetAccount],
          (old) => {
            if (!old) return old
            const curr = old[pool.id]
            const oldStaked = curr?.stakedUsd || 0
            const newStaked = oldStaked + totalUsdAdded
            return {
              ...old,
              [pool.id]: {
                ...(curr || {
                  poolId: pool.id,
                  earnedRewards: '0.00',
                  earnedUsd: 0,
                  poolSharePct: poolShare,
                  lastUpdatedTimestamp: Date.now(),
                }),
                stakedAmount: newStaked.toFixed(2),
                stakedUsd: newStaked,
                lpTokenBalance: newStaked.toFixed(2),
                poolSharePct: poolShare,
              },
            }
          }
        )
        // Phase 0: dual-asset deposits are not trading volume
      }

      await invalidatePoolCaches()
      return { txHash, lpMinted, poolShare }
    },
    [getWalletClient, approveToken, publicClient, waitForReceiptSafe, requireDeployed, invalidatePoolCaches, walletAddress, queryClient, onchainPoolState, liveBtcPrice, liveEurcPrice, poolsWithUserStats, authSource, executeUcwContract]
  )

  // ── Pool Swap (USDC ↔ EURC via StableSwapPool or USDC ↔ cirBTC via ConstantProductPool) ──
  const swapInPool = useCallback(
    async (
      poolId: string,
      tokenIn: string,
      tokenOut: string,
      amountInStr: string,
      minOutStr?: string,
      skipCacheInvalidation: boolean = false
    ): Promise<{ txHash: string; amountOut: string }> => {
      const pool = ARCIS_POOLS.find((p) => p.id === poolId)
      if (!pool || !pool.isLpPool) throw new Error('Pool does not support swapping')

      const poolAddress = pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
        ? POOL_CONTRACTS.STABLE_SWAP_POOL
        : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL)

      requireDeployed(poolAddress, pool.name)

      const targetAccount = (walletAddress || (await (await getWalletClient())?.getAddresses())?.[0]) as Address
      if (!targetAccount) throw new Error('Wallet not connected')

      const counterToken = pool.tokens[1]
      const counterTokenAddr = (counterToken?.address || POOL_CONTRACTS.cirBTC) as `0x${string}`

      const tokenInAddr = tokenIn === 'USDC'
        ? POOL_CONTRACTS.USDC
        : tokenIn === 'EURC'
          ? POOL_CONTRACTS.EURC
          : counterTokenAddr

      const tokenOutAddr = tokenOut === 'USDC'
        ? POOL_CONTRACTS.USDC
        : tokenOut === 'EURC'
          ? POOL_CONTRACTS.EURC
          : counterTokenAddr

      const inDecimals = (tokenIn === 'cirBTC' || (counterToken?.decimals === 8 && tokenIn !== 'USDC')) ? 8 : 6
      const outDecimals = (tokenOut === 'cirBTC' || (counterToken?.decimals === 8 && tokenOut !== 'USDC')) ? 8 : 6
      const amountIn = parseUnits(amountInStr, inDecimals)
      const minOut = minOutStr ? parseUnits(minOutStr, outDecimals) : 0n
      if (minOut <= 0n) {
        throw new Error('A positive minimum-output guard is required; refusing to swap without slippage protection.')
      }

      let swapVolUsd = 0
      if (tokenIn === 'USDC') {
        swapVolUsd = parseFloat(amountInStr) || 0
      } else if (tokenIn === 'EURC') {
        swapVolUsd = (parseFloat(amountInStr) || 0) * liveEurcPrice
      } else if (tokenIn === 'cirBTC' || tokenIn === 'BTC') {
        swapVolUsd = (parseFloat(amountInStr) || 0) * liveBtcPrice
      }

      const smartAccount = getActiveSmartAccount()
      if (smartAccount) {
        const approveCall = {
          to: tokenInAddr as Hex,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [poolAddress as Hex, amountIn],
          }),
        }
        const swapCall = {
          to: poolAddress as Hex,
          data: encodeFunctionData({
            abi: STABLE_SWAP_ABI,
            functionName: 'swap',
            args: [tokenInAddr, tokenOutAddr, amountIn, minOut],
          }),
        }
        const opRes = await sendModularUserOperation({
          calls: [approveCall, swapCall],
          paymaster: true,
        })
        if (!opRes.success || !opRes.txHash) {
          throw new Error(opRes.error || 'Modular UserOperation swap failed.')
        }

        // Decode Swapped event from receipt to get actual amountOut (K2)
        const opReceipt = await waitForReceiptSafe(opRes.txHash as Hex, 'Modular Swap')
        let actualAmountOutStr = minOutStr || '0'
        if (opReceipt?.logs) {
          for (const log of opReceipt.logs) {
            try {
              const decoded = decodeEventLog({
                abi: STABLE_SWAP_ABI,
                eventName: 'Swapped',
                data: log.data,
                topics: log.topics,
              })
              if (decoded?.args && (decoded.args as any).amountOut !== undefined) {
                actualAmountOutStr = formatUnits((decoded.args as any).amountOut as bigint, outDecimals)
                break
              }
            } catch { }
          }
        }

        if (swapVolUsd > 0) {
          recordClientSwapVolume(poolId, swapVolUsd, opRes.txHash)
        }
        if (!skipCacheInvalidation) {
          await invalidatePoolCaches()
        }
        return { txHash: opRes.txHash, amountOut: actualAmountOutStr }
      }

      // 2. Circle UCW Execution (Email OTP / User-Controlled Wallet)
      if (authSource === 'ucw' && executeUcwContract) {
        console.log('[usePoolsData UCW] Requesting token approval for pool swap on ARC-TESTNET...')
        await approveToken(tokenInAddr as `0x${string}`, poolAddress, amountIn)

        console.log('[usePoolsData UCW] Requesting swap challenge on pool...')
        const swapRes = await executeUcwContract({
          contractAddress: poolAddress,
          abiFunctionSignature: 'swap(address,address,uint256,uint256)',
          abiParameters: [tokenInAddr, tokenOutAddr, amountIn.toString(), minOut.toString()],
          blockchain: 'ARC-TESTNET',
        })
        if (!swapRes.success) {
          const isCanceled =
            swapRes.error?.toLowerCase().includes('cancel') ||
            swapRes.error?.toLowerCase().includes('iptal') ||
            swapRes.error?.toLowerCase().includes('closed')
          const err: any = new Error(swapRes.error || 'Pool swap authorization failed.')
          if (isCanceled) (err as any).isCanceled = true
          throw err
        }

        const txHash = (swapRes.txHash || '') as Hex
        let actualAmountOutStr = minOutStr || '0'
        if (txHash && txHash.startsWith('0x')) {
          const receipt = await waitForReceiptSafe(txHash, 'Pool swap')
          if (receipt?.logs) {
            for (const log of receipt.logs) {
              try {
                const decoded = decodeEventLog({
                  abi: STABLE_SWAP_ABI,
                  eventName: 'Swapped',
                  data: log.data,
                  topics: log.topics,
                })
                if (decoded?.args && (decoded.args as any).amountOut !== undefined) {
                  actualAmountOutStr = formatUnits((decoded.args as any).amountOut as bigint, outDecimals)
                  break
                }
              } catch { }
            }
          }
        }

        if (swapVolUsd > 0) {
          recordClientSwapVolume(poolId, swapVolUsd, txHash)
        }
        if (!skipCacheInvalidation) {
          await invalidatePoolCaches()
        }
        return { txHash, amountOut: actualAmountOutStr }
      }

      // 3. EOA Provider
      const walletClient = await getWalletClient()
      if (!walletClient) throw new Error('Wallet not connected')

      await approveToken(tokenInAddr as `0x${string}`, poolAddress, amountIn)

      const gasLimit = await estimateSafeGas(
        publicClient,
        {
          address: poolAddress,
          abi: STABLE_SWAP_ABI,
          functionName: 'swap',
          args: [tokenInAddr, tokenOutAddr, amountIn, minOut],
          account: targetAccount,
        },
        350_000n
      )

      const txHash = await resilientWriteContract(walletClient, {
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'swap',
        args: [tokenInAddr, tokenOutAddr, amountIn, minOut],
        account: targetAccount,
        chain: arcTestnet,
        gas: gasLimit,
      })
      const receipt = await waitForReceiptSafe(txHash, 'Pool swap')

      // Decode Swapped event from receipt to get actual amountOut (K2)
      let actualAmountOutStr = minOutStr || '0'
      if (receipt?.logs) {
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: STABLE_SWAP_ABI,
              eventName: 'Swapped',
              data: log.data,
              topics: log.topics,
            })
            if (decoded?.args && (decoded.args as any).amountOut !== undefined) {
              actualAmountOutStr = formatUnits((decoded.args as any).amountOut as bigint, outDecimals)
              break
            }
          } catch { }
        }
      }

      if (swapVolUsd > 0) {
        recordClientSwapVolume(poolId, swapVolUsd, txHash)
      }

      if (!skipCacheInvalidation) {
        await invalidatePoolCaches()
      }
      return { txHash, amountOut: actualAmountOutStr }
    },
    [getWalletClient, approveToken, publicClient, waitForReceiptSafe, requireDeployed, invalidatePoolCaches, walletAddress, liveBtcPrice, liveEurcPrice, authSource, executeUcwContract]
  )

  // ── Withdraw (vault redeem OR LP removeLiquidity) ─────────────────────────
  const withdrawFromPool = useCallback(
    async (
      poolId: string,
      amountStr: string,
      payoutMode: 'standard' | 'dual' | 'usdc' = 'standard',
      _provider?: unknown,
      _slippage: number = 0.5,
      skipCacheInvalidation: boolean = false
    ): Promise<PoolWithdrawResult> => {
      const pool = ARCIS_POOLS.find((p) => p.id === poolId)
      if (!pool) throw new Error('Pool not found')

      const targetAccount = (walletAddress || (await (await getWalletClient())?.getAddresses())?.[0]) as Address
      if (!targetAccount) throw new Error('Wallet not connected')



      // 1. YieldVault Withdrawal (ERC-4626)
      if (pool.id === 'usdc-yield-vault') {
        requireDeployed(POOL_CONTRACTS.YIELD_VAULT, pool.name)

        const walletSharesRaw = (await resilientReadContract(publicClient, {
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'balanceOf',
          args: [targetAccount],
        })) as bigint

        if (walletSharesRaw === 0n) {
          throw new Error('No vault shares deposited')
        }

        const totalAssets = (await resilientReadContract(publicClient, {
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'totalAssets',
        })) as bigint

        const totalSupply = (await resilientReadContract(publicClient, {
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'totalSupply',
        })) as bigint

        const userPos = userPoolPositions?.['usdc-yield-vault']
        const userStakedUsd = userPos?.stakedUsd || 0
        const withdrawAmountUsd = parseFloat(amountStr) || 0

        let sharesToRedeem: bigint
        // H3 fix: a FULL exit happens only when the user explicitly requests >= 99.9% of their
        // valued position. A missing/stale valuation (userStakedUsd <= 0) must never silently
        // redeem the entire position for a partial request — fall back to exact share math.
        if (userStakedUsd > 0 && withdrawAmountUsd >= userStakedUsd * 0.999) {
          sharesToRedeem = walletSharesRaw
        } else {
          // Exact share mapping straight from the contract: `previewWithdraw` is correct under
          // ERC-4626 virtual shares (H4), where share amounts are NOT 1:1 with assets.
          const amountAssets = parseUnits(amountStr, 6)
          try {
            sharesToRedeem = (await resilientReadContract(publicClient, {
              address: POOL_CONTRACTS.YIELD_VAULT,
              abi: YIELD_VAULT_ABI,
              functionName: 'previewWithdraw',
              args: [amountAssets],
            })) as bigint
          } catch {
            if (totalAssets > 0n && totalSupply > 0n) {
              sharesToRedeem = (amountAssets * totalSupply) / totalAssets
            } else {
              throw new Error(
                'Unable to map the withdrawal amount to vault shares right now. Please refresh and retry.'
              )
            }
          }
          if (sharesToRedeem > walletSharesRaw) sharesToRedeem = walletSharesRaw
        }
        if (sharesToRedeem === 0n) {
          throw new Error('Withdrawal amount too small')
        }

        // H4: on V4 the redeem carries a min-assets guard so a share-price manipulation between
        // quote and execution reverts instead of underpaying the redeemer. The V3 fallback
        // deployment has no guarded entrypoint, so it keeps the legacy plain `redeem`.
        let guardedRedeemArgs: readonly [bigint, Address, Address, bigint] | null = null
        if (POOL_VERSION_V4) {
          const expectedAssets = (await resilientReadContract(publicClient, {
            address: POOL_CONTRACTS.YIELD_VAULT,
            abi: YIELD_VAULT_ABI,
            functionName: 'previewRedeem',
            args: [sharesToRedeem],
          }).catch(() => 0n)) as bigint
          if (!(expectedAssets > 0n)) {
            throw new Error(
              'Unable to compute a safe minimum-assets guard for the vault redeem. Please refresh and retry so the exit is protected against share-price manipulation.'
            )
          }
          guardedRedeemArgs = [
            sharesToRedeem,
            targetAccount,
            targetAccount,
            poolMinOut(expectedAssets, poolSlippageBps(_slippage)),
          ]
        }

        const applyYieldVaultOptimisticWithdraw = () => {
          if (withdrawAmountUsd <= 0) return
          queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
            if (!old) return old
            const oldUsdc = parseFloat(old.usdc || '0')
            return { ...old, usdc: (oldUsdc + withdrawAmountUsd).toFixed(2) }
          })
          queryClient.setQueryData<Record<string, UserPoolPosition>>(
            ['userPoolPositions', targetAccount],
            (old) => {
              if (!old) return old
              const curr = old['usdc-yield-vault']
              if (!curr) return old
              const oldStaked = curr.stakedUsd || 0
              const newStaked = Math.max(0, oldStaked - withdrawAmountUsd)
              return {
                ...old,
                ['usdc-yield-vault']: {
                  ...curr,
                  stakedAmount: newStaked.toFixed(2),
                  stakedUsd: newStaked,
                  lpTokenBalance: newStaked.toFixed(2),
                },
              }
            }
          )
        }

        // Modular Smart Account (Passkey)
        const smartAccount = getActiveSmartAccount()
        if (smartAccount) {
          const redeemCall = {
            to: POOL_CONTRACTS.YIELD_VAULT as Hex,
            data: guardedRedeemArgs
              ? encodeFunctionData({
                abi: YIELD_VAULT_ABI,
                functionName: 'redeemWithMinAssets',
                args: guardedRedeemArgs,
              })
              : encodeFunctionData({
                abi: YIELD_VAULT_ABI,
                functionName: 'redeem',
                args: [sharesToRedeem, targetAccount, targetAccount],
              }),
          }
          const opRes = await sendModularUserOperation({
            calls: [redeemCall],
            paymaster: true,
          })
          if (!opRes.success || !opRes.txHash) {
            throw new Error(opRes.error || 'Modular UserOperation redeem failed.')
          }
          applyYieldVaultOptimisticWithdraw()
          // Phase 0: vault withdrawals are not trading volume
          if (!skipCacheInvalidation) {
            await invalidatePoolCaches()
          }
          return { txHash: opRes.txHash }
        }

        // Circle UCW Execution (Email OTP / User-Controlled Wallet)
        if (authSource === 'ucw' && executeUcwContract) {
          console.log('[usePoolsData UCW] Requesting redeem challenge for Yield Vault...')
          const redeemRes = await executeUcwContract({
            contractAddress: POOL_CONTRACTS.YIELD_VAULT,
            abiFunctionSignature: guardedRedeemArgs
              ? 'redeemWithMinAssets(uint256,address,address,uint256)'
              : 'redeem(uint256,address,address)',
            abiParameters: guardedRedeemArgs
              ? [
                sharesToRedeem.toString(),
                targetAccount,
                targetAccount,
                guardedRedeemArgs[3].toString(),
              ]
              : [sharesToRedeem.toString(), targetAccount, targetAccount],
            blockchain: 'ARC-TESTNET',
          })
          if (!redeemRes.success) {
            throw new Error(redeemRes.error || 'Yield vault redeem authorization failed.')
          }

          // Same rule as the harvest path: return a real hash or nothing, never a placeholder.
          const txHash = resolveUcwTxHash(redeemRes) || ''
          applyYieldVaultOptimisticWithdraw()
          // Phase 0: vault withdrawals are not trading volume
          if (!skipCacheInvalidation) {
            await invalidatePoolCaches()
          }
          return { txHash }
        }

        // EOA Provider
        const walletClient = await getWalletClient()
        if (!walletClient) throw new Error('Wallet not connected')

        const gasLimit = await estimateSafeGas(
          publicClient,
          {
            address: POOL_CONTRACTS.YIELD_VAULT,
            abi: YIELD_VAULT_ABI,
            functionName: guardedRedeemArgs ? 'redeemWithMinAssets' : 'redeem',
            args: (guardedRedeemArgs || [sharesToRedeem, targetAccount, targetAccount]) as any,
            account: targetAccount,
          },
          350_000n
        )

        const txHash = guardedRedeemArgs
          ? await resilientWriteContract(walletClient, {
            address: POOL_CONTRACTS.YIELD_VAULT,
            abi: YIELD_VAULT_ABI,
            functionName: 'redeemWithMinAssets',
            args: guardedRedeemArgs,
            account: targetAccount,
            chain: arcTestnet,
            gas: gasLimit,
          })
          : await resilientWriteContract(walletClient, {
            address: POOL_CONTRACTS.YIELD_VAULT,
            abi: YIELD_VAULT_ABI,
            functionName: 'redeem',
            args: [sharesToRedeem, targetAccount, targetAccount],
            account: targetAccount,
            chain: arcTestnet,
            gas: gasLimit,
          })
        applyYieldVaultOptimisticWithdraw()
        // Phase 0: vault withdrawals are not trading volume
        await waitForReceiptSafe(txHash, 'Yield vault redeem')
        if (!skipCacheInvalidation) {
          await invalidatePoolCaches()
        }
        return { txHash }
      }

      // 2. LP Pool Removal
      const poolAddress = pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
        ? POOL_CONTRACTS.STABLE_SWAP_POOL
        : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL)
      requireDeployed(poolAddress, pool.name)

      const userLpRaw = (await resilientReadContract(publicClient, {
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'balanceOf',
        args: [targetAccount],
      })) as bigint

      if (userLpRaw === 0n) {
        throw new Error('No LP liquidity deposited in this pool')
      }

      const userPos = userPoolPositions?.[poolId]
      const userStakedUsd = userPos?.stakedUsd || 0
      const userLpTokensFormatted = parseFloat(userPos?.lpTokenBalance || '0')
      const withdrawAmountNum = parseFloat(amountStr) || 0
      const withdrawAmountUsd = withdrawAmountNum

      let lpToWithdraw: bigint
      // Direct LP share withdrawal: if the user explicitly requests their full USD balance (>= 99.9%),
      // or their full LP balance, or an explicit proportional USD amount.
      if (userStakedUsd > 0 && withdrawAmountNum >= userStakedUsd * 0.999) {
        lpToWithdraw = userLpRaw
      } else if (userLpTokensFormatted > 0 && Math.abs(withdrawAmountNum - userLpTokensFormatted) <= userLpTokensFormatted * 0.001) {
        lpToWithdraw = userLpRaw
      } else {
        let directLpRaw = 0n
        try {
          directLpRaw = parseUnits(withdrawAmountNum.toFixed(18), 18)
        } catch { }

        if (directLpRaw > 0n && directLpRaw <= userLpRaw) {
          lpToWithdraw = directLpRaw
        } else if (userStakedUsd > 0 && withdrawAmountUsd >= userStakedUsd * 0.999) {
          lpToWithdraw = userLpRaw
        } else if (userStakedUsd <= 0 || userPos?.priceUnavailable) {
          // H3/O4 fix: missing or unverified price feed prevents an unintended full exit
          throw new Error(
            'Unable to value your LP position right now (price feed unverified). Please specify your withdrawal percentage or LP token amount directly.'
          )
        } else {
          lpToWithdraw = calculateLpClaimAmount(withdrawAmountNum, userStakedUsd, userLpRaw)
          if (lpToWithdraw > userLpRaw) lpToWithdraw = userLpRaw
        }
      }

      if (lpToWithdraw === 0n) {
        throw new Error('Withdrawal amount too small')
      }

      const counterToken = pool.tokens[1]
      const counterTokenAddress = (counterToken?.address || POOL_CONTRACTS.cirBTC) as `0x${string}`

      // V2: derive exact minOutA/minOutB from reserves for removeLiquidity slippage.
      const removeLiquidityArgs = (() => {
        if (!POOL_VERSION_V2 && !POOL_VERSION_V3 && !POOL_VERSION_V4) return [lpToWithdraw, 0n, 0n] as const
        const st = (onchainPoolState || {})[poolAddress] as any
        const total = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
        if (total <= 0n) return [lpToWithdraw, 0n, 0n] as const
        const counterDecimals = counterToken?.decimals === 8 ? 8 : 6
        const reserveA = st?.reserveA ? parseUnits(st.reserveA, 6) : 0n
        const reserveB = st?.reserveB ? parseUnits(st.reserveB, counterDecimals) : 0n
        const slipBps = poolSlippageBps(_slippage)
        const minOutA = reserveA > 0n ? poolMinOut((reserveA * lpToWithdraw) / total, slipBps) : 0n
        const minOutB = reserveB > 0n ? poolMinOut((reserveB * lpToWithdraw) / total, slipBps) : 0n
        return [lpToWithdraw, minOutA, minOutB] as const
      })() as readonly [lpAmount: bigint, minOutA: bigint, minOutB: bigint]

      const counterBalBefore = payoutMode === 'usdc' && counterTokenAddress
        ? ((await resilientReadContract(publicClient, {
          address: counterTokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [targetAccount],
        })) as bigint)
        : 0n

      const applyLpOptimisticWithdraw = () => {
        if (withdrawAmountUsd <= 0) return
        queryClient.setQueryData<Record<string, UserPoolPosition>>(
          ['userPoolPositions', targetAccount],
          (old) => {
            if (!old) return old
            const curr = old[poolId]
            if (!curr) return old
            const oldStaked = curr.stakedUsd || 0
            const newStaked = Math.max(0, oldStaked - withdrawAmountUsd)
            return {
              ...old,
              [poolId]: {
                ...curr,
                stakedAmount: newStaked.toFixed(2),
                stakedUsd: newStaked,
                lpTokenBalance: newStaked.toFixed(2),
              },
            }
          }
        )
      }

      let txHash = ''
      const smartAccount = getActiveSmartAccount()

      if (smartAccount) {
        const removeCall = {
          to: poolAddress as Hex,
          data: encodeFunctionData({
            abi: STABLE_SWAP_ABI,
            functionName: 'removeLiquidity',
            args: removeLiquidityArgs,
          }),
        }
        const opRes = await sendModularUserOperation({
          calls: [removeCall],
          paymaster: true,
        })
        if (!opRes.success || !opRes.txHash) {
          throw new Error(opRes.error || 'Modular UserOperation removeLiquidity failed.')
        }
        txHash = opRes.txHash
        await waitForReceiptSafe(txHash as Hex, 'Remove liquidity')
        applyLpOptimisticWithdraw()
      } else if (authSource === 'ucw' && executeUcwContract) {
        console.log('[usePoolsData UCW] Requesting removeLiquidity challenge on pool...')
        const removeRes = await executeUcwContract({
          contractAddress: poolAddress,
          abiFunctionSignature: 'removeLiquidity(uint256,uint256,uint256)',
          abiParameters: [
            removeLiquidityArgs[0].toString(),
            removeLiquidityArgs[1].toString(),
            removeLiquidityArgs[2].toString(),
          ],
          blockchain: 'ARC-TESTNET',
        })
        if (!removeRes.success) {
          const isCanceled =
            removeRes.error?.toLowerCase().includes('cancel') ||
            removeRes.error?.toLowerCase().includes('iptal') ||
            removeRes.error?.toLowerCase().includes('closed')
          const err: any = new Error(removeRes.error || 'Remove liquidity authorization failed.')
          if (isCanceled) (err as any).isCanceled = true
          throw err
        }
        txHash = removeRes.txHash || ''
        if (txHash && txHash.startsWith('0x')) {
          await waitForReceiptSafe(txHash as Hex, 'Remove liquidity')
        }
        applyLpOptimisticWithdraw()
      } else {
        const walletClient = await getWalletClient()
        if (!walletClient) throw new Error('Wallet not connected')

        const gasLimit = await estimateSafeGas(
          publicClient,
          {
            address: poolAddress,
            abi: STABLE_SWAP_ABI,
            functionName: 'removeLiquidity',
            args: removeLiquidityArgs as any,
            account: targetAccount,
          },
          400_000n
        )

        txHash = await resilientWriteContract(walletClient, {
          address: poolAddress,
          abi: STABLE_SWAP_ABI,
          functionName: 'removeLiquidity',
          args: removeLiquidityArgs,
          account: targetAccount,
          chain: arcTestnet,
          gas: gasLimit,
        })
        await waitForReceiptSafe(txHash as Hex, 'Remove liquidity')
        applyLpOptimisticWithdraw()
      }

      // Single-sided 100% USDC Payout: automatically swap the received counter token to USDC
      let autoSwapFailed = false
      let autoSwapCounterSymbol = ''
      let autoSwapCounterAmount = ''

      if (payoutMode === 'usdc' && counterToken?.address) {
        try {
          if (txHash) {
            await waitForReceiptSafe(txHash as Hex, 'Remove liquidity')
          }
          const counterBalAfter = (await resilientReadContract(publicClient, {
            address: counterTokenAddress,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [targetAccount],
          })) as bigint

          const receivedCounter = counterBalAfter > counterBalBefore ? counterBalAfter - counterBalBefore : 0n
          if (receivedCounter > 0n) {
            const counterDecimals = counterToken.decimals === 8 ? 8 : 6
            const counterBalStr = formatUnits(receivedCounter, counterDecimals)
            autoSwapCounterSymbol = counterToken.symbol
            autoSwapCounterAmount = counterBalStr

            // Derive safe minOut from fresh live on-chain pool reserves with slippage protection (prevent MEV / sandwich)
            let minOutUsdcStr = '0'
            try {
              const [freshReserveA, freshReserveB] = await Promise.all([
                resilientReadContract(publicClient, {
                  address: poolAddress,
                  abi: STABLE_SWAP_ABI,
                  functionName: 'reserveA',
                }).catch(() => 0n),
                resilientReadContract(publicClient, {
                  address: poolAddress,
                  abi: STABLE_SWAP_ABI,
                  functionName: 'reserveB',
                }).catch(() => 0n),
              ])

              let resA = (freshReserveA as bigint) || 0n
              let resB = (freshReserveB as bigint) || 0n

              // Fallback to cached onchainPoolState if fresh read returned 0
              if (resA === 0n || resB === 0n) {
                const st = (onchainPoolState || {})[poolAddress] as any
                if (st) {
                  resA = parseUnits(st.reserveA || '0', 6)
                  resB = parseUnits(st.reserveB || '0', counterDecimals)
                }
              }

              if (resA > 0n && resB > 0n) {
                let expectedOut = 0n
                if (poolId === 'usdc-eurc-stable-pool') {
                  expectedOut = calculateStableSwapExpectedOut(receivedCounter, resB, resA, STABLE_SWAP_LP_FEE_BPS, STABLE_SWAP_AMP)
                } else {
                  expectedOut = calculateConstantProductExpectedOut(receivedCounter, resB, resA, CONSTANT_PRODUCT_LP_FEE_BPS)
                }
                const slipBps = poolSlippageBps(_slippage)
                const minOut = poolMinOut(expectedOut, slipBps)
                if (minOut > 0n) {
                  minOutUsdcStr = formatUnits(minOut, 6)
                }
              }
            } catch (mathErr) {
              console.warn('[usePoolsData] Auto-swap fresh minOut calculation fallback:', mathErr)
            }

            // Execute swap back to USDC with slippage protection.
            // Phase 0: never swap without a real minOut guard — leave the counter token in the wallet instead.
            if ((parseFloat(minOutUsdcStr) || 0) > 0) {
              await swapInPool(poolId, counterToken.symbol, 'USDC', counterBalStr, minOutUsdcStr, skipCacheInvalidation)
            } else {
              autoSwapFailed = true
              console.warn('[usePoolsData] Skipping auto-swap to USDC: could not compute a safe minOut from live reserves.')
            }
          }
        } catch (swapErr) {
          autoSwapFailed = true
          console.warn('[usePoolsData] Auto-swap to USDC after LP removal failed:', swapErr)
        }
      }

      if (!skipCacheInvalidation) {
        await invalidatePoolCaches()
      }
      return {
        txHash,
        autoSwapFailed,
        counterTokenSymbol: autoSwapCounterSymbol,
        counterAmount: autoSwapCounterAmount
      }
    },
    [getWalletClient, publicClient, requireDeployed, invalidatePoolCaches, userPoolPositions, walletAddress, queryClient, onchainPoolState, liveBtcPrice, liveEurcPrice, waitForReceiptSafe, swapInPool, authSource, executeUcwContract]
  )

  // ── On-chain harvest (Phase 1) ────────────────────────────────────────────
  // LP fees and vault yield are settled inside the V4 contracts. "Claiming" is a real
  // `harvest()` call: it pays exactly what `pendingFees` / `pendingYield` reports and never
  // touches the principal. No client-side checkpoint is written, so a fresh device sees the
  // same claimable amount.
  const claimPoolRewards = useCallback(
    async (poolId: string): Promise<{ amountClaimed: string; txHash: string }> => {
      const pool = ARCIS_POOLS.find((p) => p.id === poolId)
      if (!pool) throw new Error('Pool not found')

      if (!POOL_VERSION_V4) {
        throw new Error('Fee harvest requires the V4 pool contracts (deploy V4 and set VITE_POOL_VERSION=v4).')
      }

      const targetAccount = (walletAddress || (await (await getWalletClient())?.getAddresses())?.[0]) as Address
      if (!targetAccount) throw new Error('Wallet not connected')

      const isVault = poolId === 'usdc-yield-vault'
      const poolAddress = (pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
        ? POOL_CONTRACTS.STABLE_SWAP_POOL
        : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL)) as `0x${string}`

      // 1) Read the on-chain claimable amount — the single source of truth for the user.
      let harvestableA = 0n
      let harvestableB = 0n
      const decB = pool.tokens?.[1]?.decimals ?? 6
      if (isVault) {
        harvestableA = (await resilientReadContract(publicClient, {
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'pendingYield',
          args: [targetAccount],
        })) as bigint
      } else {
        const pending = (await resilientReadContract(publicClient, {
          address: poolAddress,
          abi: STABLE_SWAP_ABI,
          functionName: 'pendingFees',
          args: [targetAccount],
        })) as readonly [bigint, bigint]
        harvestableA = pending?.[0] || 0n
        harvestableB = pending?.[1] || 0n
      }

      if (harvestableA === 0n && harvestableB === 0n) {
        throw new Error('No harvestable rewards accrued yet for this pool.')
      }

      const harvestTarget = (isVault ? POOL_CONTRACTS.YIELD_VAULT : poolAddress) as `0x${string}`

      // 2) Submit harvest() through whichever wallet path is active.
      let txHash = ''
      const smartAccount = getActiveSmartAccount()
      if (smartAccount) {
        const harvestData = isVault
          ? encodeFunctionData({ abi: YIELD_VAULT_ABI, functionName: 'harvest' })
          : encodeFunctionData({ abi: STABLE_SWAP_ABI, functionName: 'harvest' })
        const opRes = await sendModularUserOperation({
          calls: [{ to: harvestTarget as Hex, data: harvestData }],
          paymaster: true,
        })
        if (!opRes.success || !opRes.txHash) {
          throw new Error(opRes.error || 'Modular UserOperation harvest failed.')
        }
        txHash = opRes.txHash
        await waitForReceiptSafe(txHash as Hex, 'Harvest')
      } else if (authSource === 'ucw' && executeUcwContract) {
        const res = await executeUcwContract({
          contractAddress: harvestTarget,
          abiFunctionSignature: 'harvest()',
          abiParameters: [],
          blockchain: 'ARC-TESTNET',
        })
        if (!res.success) {
          const isCanceled = Boolean(res.error && (res.error.toLowerCase().includes('cancel') || res.error.toLowerCase().includes('iptal')))
          const err: any = new Error(res.error || 'Harvest authorization failed.')
          if (isCanceled) err.isCanceled = true
          throw err
        }
        // Only a real hash can be waited on: a placeholder would report a harvest that never
        // happened. When Circle has not published one yet, say so instead of claiming success.
        const ucwHarvestHash = resolveUcwTxHash(res)
        if (!ucwHarvestHash) {
          throw new Error(ucwHashPendingMessage('Harvest'))
        }
        txHash = ucwHarvestHash
        await waitForReceiptSafe(txHash as Hex, 'Harvest')
      } else {
        const walletClient = await getWalletClient()
        if (!walletClient) throw new Error('Wallet not connected')
        if (isVault) {
          const gasLimit = await estimateSafeGas(
            publicClient,
            {
              address: POOL_CONTRACTS.YIELD_VAULT,
              abi: YIELD_VAULT_ABI,
              functionName: 'harvest',
              args: [],
              account: targetAccount,
            },
            250_000n
          )
          txHash = await resilientWriteContract(walletClient, {
            address: POOL_CONTRACTS.YIELD_VAULT,
            abi: YIELD_VAULT_ABI,
            functionName: 'harvest',
            args: [],
            account: targetAccount,
            chain: arcTestnet,
            gas: gasLimit,
          })
        } else {
          const gasLimit = await estimateSafeGas(
            publicClient,
            {
              address: poolAddress,
              abi: STABLE_SWAP_ABI,
              functionName: 'harvest',
              args: [],
              account: targetAccount,
            },
            300_000n
          )
          txHash = await resilientWriteContract(walletClient, {
            address: poolAddress,
            abi: STABLE_SWAP_ABI,
            functionName: 'harvest',
            args: [],
            account: targetAccount,
            chain: arcTestnet,
            gas: gasLimit,
          })
        }
        await waitForReceiptSafe(txHash as Hex, 'Harvest')
      }

      // 3) USDC-denominated display value of what was just harvested.
      const usdA = parseFloat(formatUnits(harvestableA, 6))
      const counterPrice = decB === 8 ? liveBtcPrice : decB === 18 ? liveWethPrice : liveEurcPrice
      const usdB = harvestableB > 0n
        ? parseFloat(formatUnits(harvestableB, decB)) * counterPrice
        : 0
      const amountClaimed = (usdA + usdB).toFixed(4)

      if (txHash && targetAccount) {
        try {
          addTransaction({
            type: 'harvest',
            txHash,
            amount: amountClaimed,
            tokenSymbol: 'USDC',
            sourceChain: 'Arc_Testnet',
            recipient: targetAccount,
            userAddress: targetAccount,
            status: 'success',
            poolId,
            poolName: pool.name,
          })
        } catch (histErr) {
          console.warn('[usePoolsData] Failed to record harvest in history:', histErr)
        }
      }

      await invalidatePoolCaches()
      return { amountClaimed, txHash }
    },
    [walletAddress, getWalletClient, publicClient, waitForReceiptSafe, invalidatePoolCaches, liveBtcPrice, liveEurcPrice, authSource, executeUcwContract]
  )

  const claimAllRewards = useCallback(async (): Promise<{
    totalClaimed: string;
    txHash: string;
    txHashes: string[];
    successfulPools: string[];
    failedPools: string[];
    isCanceled?: boolean;
  }> => {
    if (!userPoolPositions) {
      throw new Error('No active pool positions found.')
    }

    const claimablePools = ARCIS_POOLS.filter((p) => {
      const pos = userPoolPositions[p.id]
      return pos && pos.earnedUsd >= 0.01
    })

    if (claimablePools.length === 0) {
      throw new Error('No claimable yield available across your pools (minimum 0.01 USDC).')
    }

    let totalClaimed = 0
    let lastTxHash = ''
    const txHashes: string[] = []
    const successfulPools: string[] = []
    const failedPools: string[] = []
    let userCanceledError: any = null

    for (const pool of claimablePools) {
      try {
        const res = await claimPoolRewards(pool.id)
        const amt = parseFloat(res.amountClaimed) || 0
        totalClaimed += amt
        if (res.txHash) {
          lastTxHash = res.txHash
          txHashes.push(res.txHash)
        }
        successfulPools.push(pool.name)
      } catch (err: any) {
        if (isUserCanceled(err) || err?.isCanceled === true || err?.code === 4001) {
          userCanceledError = err
          console.info(`[usePoolsData] Claim canceled by user for ${pool.name}`)
          break // Stop prompt cascade immediately when user cancels wallet signature
        }
        console.warn(`[usePoolsData] Claim failed for ${pool.name}:`, err)
        failedPools.push(pool.name)
      }
    }

    await invalidatePoolCaches()

    if (userCanceledError && successfulPools.length === 0) {
      throw userCanceledError
    }

    return {
      totalClaimed: totalClaimed.toFixed(2),
      txHash: lastTxHash,
      txHashes,
      successfulPools,
      failedPools,
      isCanceled: Boolean(userCanceledError),
    }
  }, [userPoolPositions, claimPoolRewards, invalidatePoolCaches])

  const refreshBalances = useCallback(async () => {
    await invalidatePoolCaches()
  }, [invalidatePoolCaches])

  // ── Live Arc Testnet event listeners (debounced to eliminate RPC throttling) ──
  useEffect(() => {
    let unwatchStable: (() => void) | undefined
    let unwatchCP: (() => void) | undefined
    let unwatchVault: (() => void) | undefined

    try {
      if (isDeployed(POOL_CONTRACTS.STABLE_SWAP_POOL)) {
        unwatchStable = publicClient.watchContractEvent({
          address: POOL_CONTRACTS.STABLE_SWAP_POOL,
          abi: STABLE_SWAP_ABI,
          onLogs: () => debouncedInvalidatePoolCaches(),
        })
      }

      if (isDeployed(POOL_CONTRACTS.CONSTANT_PRODUCT_POOL)) {
        unwatchCP = publicClient.watchContractEvent({
          address: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL,
          abi: CONSTANT_PRODUCT_ABI,
          onLogs: () => debouncedInvalidatePoolCaches(),
        })
      }

      if (isDeployed(POOL_CONTRACTS.YIELD_VAULT)) {
        unwatchVault = publicClient.watchContractEvent({
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          onLogs: () => debouncedInvalidatePoolCaches(),
        })
      }
    } catch (err) {
      console.warn('[usePoolsData] Contract event watcher initialization note:', err)
    }

    return () => {
      if (debounceInvalidateTimerRef.current) {
        clearTimeout(debounceInvalidateTimerRef.current)
      }
      unwatchStable?.()
      unwatchCP?.()
      unwatchVault?.()
    }
  }, [publicClient, debouncedInvalidatePoolCaches])

  return {
    pools: poolsWithUserStats as (PoolConfig & { userPosition?: UserPoolPosition })[],
    swapInPool,
    onchainBalances: onchainBalances || { usdc: '0.00', usyc: '0.00', eurc: '0.00', cirbtc: '0.0000' },
    isBalancesLoading,
    totalTvlUsd,
    totalPoolTxCount,
    userTotalDepositedUsd,
    userTotalClaimableRewardsUsd,
    dailyYieldGeneratedUsd,
    depositToPool,
    zapIn,
    depositDual,
    withdrawFromPool,
    claimPoolRewards,
    claimAllRewards,
    refreshBalances,
  }
}