// Arcis Pools & Yield — Modular on-chain data hook.
// Reads real reserves / vault state from Arc Testnet contracts and submits
// real transactions via the connected wallet provider.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  encodeFunctionData,
  erc20Abi,
  type Address,
  type Hex,
  type TransactionReceipt,
  type WalletClient,
} from 'viem'
import { arcTestnet } from '../config/arcChain'
import {
  ARCIS_POOLS,
  CONSTANT_PRODUCT_ABI,
  POOL_CONTRACTS,
  STABLE_SWAP_ABI,
  YIELD_VAULT_ABI,
  type PoolConfig,
} from '../config/poolsConfig'
import { getActiveSmartAccount, sendModularUserOperation } from '../services/modularWalletService'
import { redisCache } from '../services/redisCacheService'
import {
  getArcPublicClient,
  resilientReadContract,
  resilientWaitForReceipt,
  resilientWriteContract,
} from '../services/rpc'
import { getCachedTokenPrice } from '../services/tokenPriceService'
import { recordClientSwapVolume } from '../utils/poolVolumeUtils'
import { fetchTotalPoolTransactionCount, recordOptimisticPoolTx } from '../services/poolEventsIndexer'
import { useLiveTokenPrices } from './useLiveTokenPrices'

// Re-export all modular pool services, types, utilities and queries
export * from '../services/pools'
export { recordClientSwapVolume, recordOptimisticPoolTx }

import {
  formatPoolApyBadge,
  isDeployed,
  measureVaultYieldApy,
  ONCHAIN_POOL_STATE_QUERY_KEY,
  getLastKnownPoolState,
  fetchOnchainPoolState,
  fetchOnchainPoolBalances,
  fetchUserPoolPositions,
  executeDepositToPool,
  executeZapIn,
  executeDepositDual,
  executeWithdrawFromPool,
  executeSwapInPool,
  executeClaimPoolRewards,
  executeClaimAllRewards,
  type PoolExecutionContext,
  type PoolWithdrawResult,
  type UserPoolPosition,
} from '../services/pools'

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

  const liveBtcPrice = tokenPrices?.CIRBTC || tokenPrices?.BTC || getCachedTokenPrice('BTC')
  const liveEurcPrice = tokenPrices?.EURC || getCachedTokenPrice('EURC')
  const liveWethPrice = tokenPrices?.WETH || tokenPrices?.ETH || getCachedTokenPrice('WETH') || 2600

  // Reactive trigger for 24h rolling swap volume updates across tabs and components
  const [volumeRevision, setVolumeRevision] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleVolumeUpdate = () => {
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

  // Public read client for Arc Testnet
  const publicClient = useMemo(() => {
    return getArcPublicClient()
  }, [])

  // Helper: safely poll for transaction receipt
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

  // ── Real wallet balances from Arc Testnet ─────────────────────────────────
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

  // ── Real on-chain user pool positions ─────────────────────────────────────
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

  // ── Real on-chain total pool transactions ─────────────────────────────────
  const { data: totalPoolTxCount = 0 } = useQuery({
    queryKey: ['totalPoolTxCount'],
    queryFn: () => fetchTotalPoolTransactionCount(publicClient),
    staleTime: 25_000,
    refetchInterval: () => (typeof document !== 'undefined' && document.hidden ? false : 30_000),
    gcTime: 1000 * 60 * 5,
  })

  // ── Aggregate pool metrics ────────────────────────────────────────────────
  const poolsWithUserStats = useMemo(() => {
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
        volume24hUsd = ssContract24h
        clientVolumeUsd = 0

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
        volume24hUsd = cpContract24h
        clientVolumeUsd = 0

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

      } else if (pool.id === 'eurc-weth-pool') {
        const s = onchainPoolState?.[pool.contractAddress] || onchainPoolState?.[POOL_CONTRACTS.EURC_WETH_POOL]
        const resA = parseFloat(s?.reserveA || '0') || 0
        const resB = parseFloat(s?.reserveB || '0') || 0
        const eurcPrice = liveEurcPrice || 1.08
        exchangeRate = liveWethPrice / eurcPrice
        const reserveUsd = resA * eurcPrice + resB * liveWethPrice
        tvlUsd = reserveUsd < 1000 ? parseFloat(reserveUsd.toFixed(2)) : Math.floor(reserveUsd)
        const ratioA = reserveUsd > 0 ? Math.round(((resA * eurcPrice) / reserveUsd) * 100) : 50
        const ratioB = reserveUsd > 0 ? Math.max(0, 100 - ratioA) : 50
        reserves = { tokenA: resA, tokenB: resB, ratioA, ratioB }
        totalLp = s?.totalLp || '0'
        const eurcVolA = parseFloat(s?.volume24hA || '0')
        const eurcVolB = parseFloat(s?.volume24hB || '0')
        volume24hUsd = parseFloat((eurcVolA * eurcPrice + eurcVolB * liveWethPrice).toFixed(2))
        clientVolumeUsd = 0

        const baseApr = 14.80
        const feeTierPct = pool.feeTierPercent || 0.30
        const dynamicFeeApr = tvlUsd > 0 && volume24hUsd > 0
          ? ((volume24hUsd * (feeTierPct / 100) * 365) / tvlUsd) * 100
          : 0
        const totalApr = parseFloat((baseApr + dynamicFeeApr).toFixed(2))
        apy = totalApr
        apyBadge = formatPoolApyBadge(totalApr, baseApr, dynamicFeeApr, 'EURC-ETH Incentive')

      } else if (pool.id === 'usdc-yield-vault') {
        const s = onchainPoolState?.[POOL_CONTRACTS.YIELD_VAULT]
        const assetsUsd = parseFloat(s?.totalAssets || '0') || 0
        const totalYield = parseFloat(s?.totalYieldDistributed || '0') || 0
        tvlUsd = assetsUsd < 1000 ? parseFloat(assetsUsd.toFixed(2)) : Math.floor(assetsUsd)
        // Phase 0: a yield vault has no trading volume — deposits/withdrawals are not swaps.
        volume24hUsd = 0
        clientVolumeUsd = 0

        const baseVaultApy = 8.42
        const dynamicYieldApy = measureVaultYieldApy(totalYield, assetsUsd)
        const totalVaultApy = parseFloat((baseVaultApy + dynamicYieldApy).toFixed(2))
        apy = totalVaultApy
        apyBadge = dynamicYieldApy > 0
          ? `${totalVaultApy.toFixed(2)}% APY (${baseVaultApy}% Incentive Est. + ${dynamicYieldApy.toFixed(2)}% Measured)`
          : '8.42% Incentive APY (Est.) • Arcis Revenue Strategy'
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

  // ── Helper: get a writable wallet client ──────────────────────────────────
  const getWalletClient = useCallback(async (): Promise<WalletClient | null> => {
    if (authSource === 'ucw' || authSource === 'passkey') return null
    const activeProvider = provider || (typeof window !== 'undefined' ? (window as any).ethereum : null)
    if (!activeProvider) return null
    try {
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

  // ── Approve helper (ERC-20 USDC / EURC) ──────────────────────────────────
  const approveToken = useCallback(
    async (tokenAddress: `0x${string}`, spender: `0x${string}`, amount: bigint) => {
      const targetAccount = (walletAddress || (authSource !== 'ucw' && authSource !== 'passkey' ? (await (await getWalletClient())?.getAddresses())?.[0] : undefined)) as Address
      if (!targetAccount) throw new Error('Wallet not connected')

      try {
        const currentAllowance = (await resilientReadContract(publicClient, {
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [targetAccount, spender],
        })) as bigint
        if (typeof currentAllowance === 'bigint' && currentAllowance >= amount) {
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

  // ── Invalidate Caches Helper ──────────────────────────────────────────────
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

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['onchainPoolBalances'] }),
      queryClient.invalidateQueries({ queryKey: ['onchainPoolState'] }),
      queryClient.invalidateQueries({ queryKey: ['userPoolPositions'] }),
      queryClient.invalidateQueries({ queryKey: ['walletTestnetBalances'] }),
      queryClient.invalidateQueries({ queryKey: ['liveTokenPrices'] }),
      queryClient.invalidateQueries({ queryKey: ['gatewayBalances'] }),
      queryClient.invalidateQueries({ queryKey: ['totalPoolTxCount'] }),
    ])

    setVolumeRevision((prev) => prev + 1)
  }, [queryClient, walletAddress])

  // Debounced cache invalidator
  const debounceInvalidateTimerRef = useRef<any>(null)
  const debouncedInvalidatePoolCaches = useCallback(() => {
    if (debounceInvalidateTimerRef.current) {
      clearTimeout(debounceInvalidateTimerRef.current)
    }
    debounceInvalidateTimerRef.current = setTimeout(() => {
      invalidatePoolCaches()
    }, 1500)
  }, [invalidatePoolCaches])

  // Context builder for modular operations
  const getExecutionContext = useCallback((): PoolExecutionContext => {
    return {
      walletAddress,
      authSource,
      executeUcwContract,
      publicClient,
      queryClient,
      getWalletClient,
      approveToken,
      waitForReceiptSafe,
      invalidatePoolCaches,
      livePrices: {
        btc: liveBtcPrice,
        eurc: liveEurcPrice,
        weth: liveWethPrice,
      },
      userPoolPositions,
      onchainPoolState,
      poolsWithUserStats,
    }
  }, [
    walletAddress,
    authSource,
    executeUcwContract,
    publicClient,
    queryClient,
    getWalletClient,
    approveToken,
    waitForReceiptSafe,
    invalidatePoolCaches,
    liveBtcPrice,
    liveEurcPrice,
    liveWethPrice,
    userPoolPositions,
    onchainPoolState,
    poolsWithUserStats,
  ])

  // ── Delegated Pool Actions ────────────────────────────────────────────────
  const depositToPool = useCallback(
    async (poolId: string, amountStr: string, _provider?: unknown) => {
      return executeDepositToPool(getExecutionContext(), poolId, amountStr)
    },
    [getExecutionContext]
  )

  const zapIn = useCallback(
    async (poolId: string, tokenInSymbol: string, inputAmountStr: string, slippage: number = 0.5) => {
      return executeZapIn(getExecutionContext(), poolId, tokenInSymbol, inputAmountStr, slippage)
    },
    [getExecutionContext]
  )

  const depositDual = useCallback(
    async (poolId: string, amountAStr: string, amountBStr: string, slippage: number = 0.5) => {
      return executeDepositDual(getExecutionContext(), poolId, amountAStr, amountBStr, slippage)
    },
    [getExecutionContext]
  )

  const withdrawFromPool = useCallback(
    async (
      poolId: string,
      amountStr: string,
      payoutMode: 'standard' | 'dual' | 'usdc' = 'standard',
      provider?: unknown,
      slippage: number = 0.5,
      skipCacheInvalidation: boolean = false
    ): Promise<PoolWithdrawResult> => {
      return executeWithdrawFromPool(
        getExecutionContext(),
        poolId,
        amountStr,
        payoutMode,
        provider,
        slippage,
        skipCacheInvalidation
      )
    },
    [getExecutionContext]
  )

  const swapInPool = useCallback(
    async (
      poolId: string,
      tokenIn: string,
      tokenOut: string,
      amountInStr: string,
      minOutStr?: string,
      skipCacheInvalidation: boolean = false
    ) => {
      return executeSwapInPool(
        getExecutionContext(),
        poolId,
        tokenIn,
        tokenOut,
        amountInStr,
        minOutStr,
        skipCacheInvalidation
      )
    },
    [getExecutionContext]
  )

  const claimPoolRewards = useCallback(
    async (poolId: string) => {
      return executeClaimPoolRewards(getExecutionContext(), poolId)
    },
    [getExecutionContext]
  )

  const claimAllRewards = useCallback(async () => {
    return executeClaimAllRewards(getExecutionContext())
  }, [getExecutionContext])

  const refreshBalances = useCallback(async () => {
    await Promise.all([
      refetchOnchainBalances(),
      refetchPoolState(),
      refetchUserPositions(),
    ])
  }, [refetchOnchainBalances, refetchPoolState, refetchUserPositions])

  // ── Auto-refetch on smart contract events ─────────────────────────────────
  useEffect(() => {
    let unwatchStable: (() => void) | undefined
    let unwatchCP: (() => void) | undefined
    let unwatchWeth: (() => void) | undefined
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

      if (isDeployed(POOL_CONTRACTS.WETH_POOL)) {
        unwatchWeth = publicClient.watchContractEvent({
          address: POOL_CONTRACTS.WETH_POOL,
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
      unwatchWeth?.()
      unwatchVault?.()
    }
  }, [publicClient, debouncedInvalidatePoolCaches])

  return {
    pools: poolsWithUserStats as (PoolConfig & { userPosition?: UserPoolPosition })[],
    swapInPool,
    onchainBalances: onchainBalances || { usdc: '0.00', eurc: '0.00', cirbtc: '0.0000', weth: '0.0000' },
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