// src/hooks/usePoolsData.ts
//
// Arcis Pools & Yield — Real on-chain testnet data hook (Phase 5 rewrite).
// Reads real reserves / vault state from Arc Testnet contracts and submits
// real transactions via the connected wallet provider.

import {useEffect, useMemo, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createPublicClient,
  http,
  erc20Abi,
  formatUnits,
  parseUnits,
  zeroAddress,
  type WalletClient,
} from 'viem'
import { arcTestnet, ARC_METADATA } from '../config/arcChain'
import {
  ARCIS_POOLS,
  POOL_CONTRACTS,
  STABLE_SWAP_ABI,
  CONSTANT_PRODUCT_ABI,
  YIELD_VAULT_ABI,
  MOCK_ERC20_ABI,
  type PoolConfig,
} from '../config/poolsConfig'
import { redisCache } from '../services/redisCacheService'
import { depositToGateway } from '../services/gatewayService'

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
}

function isDeployed(address: string): boolean {
  return Boolean(address && address !== zeroAddress && address.startsWith('0x'))
}

export function usePoolsData(walletAddress: string, provider?: any) {
  const queryClient = useQueryClient()
  const isAddressValid = Boolean(walletAddress && walletAddress.startsWith('0x'))

  // Public read client for Arc Testnet
  const publicClient = useMemo(() => {
    return createPublicClient({
      chain: arcTestnet,
      transport: http(ARC_METADATA.rpcHttpUrl, { timeout: 8000 }),
      pollingInterval: 5000,
    })
  }, [])

  // ── Real wallet balances (USDC + EURC) from Arc Testnet ───────────────────
  const {
    data: onchainBalances,
    isLoading: isBalancesLoading,
    refetch: refetchOnchainBalances,
  } = useQuery({
    queryKey: ['onchainPoolBalances', walletAddress],
    queryFn: async () => {
      if (!isAddressValid) {
        return { usdc: '0.00', usyc: '0.00', eurc: '0.00', cirbtc: '0.0000', tcirbtc: '0.0000' }
      }

      const cacheKey = `arcis:pools:balances:${walletAddress}`
      const cached = await redisCache.get<any>(cacheKey)
      if (cached) {
        return cached
      }

      const targetAddr = walletAddress as `0x${string}`
      let usdcFormatted = '0.00'
      let eurcFormatted = '0.00'
      let cirbtcFormatted = '0.0000'
      let tcirbtcFormatted = '0.0000'

      try {
        const usdcRaw = await publicClient.readContract({
          address: POOL_CONTRACTS.USDC,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [targetAddr],
        })
        usdcFormatted = parseFloat(formatUnits(usdcRaw, 6)).toFixed(2)
      } catch (err) {
        console.warn('[usePoolsData] USDC read failed:', err)
      }

      try {
        const eurcRaw = await publicClient.readContract({
          address: POOL_CONTRACTS.EURC,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [targetAddr],
        })
        eurcFormatted = parseFloat(formatUnits(eurcRaw, 6)).toFixed(2)
      } catch {
        eurcFormatted = '0.00'
      }

      try {
        const cirbtcRaw = await publicClient.readContract({
          address: POOL_CONTRACTS.cirBTC,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [targetAddr],
        })
        cirbtcFormatted = parseFloat(formatUnits(cirbtcRaw, 8)).toFixed(4)
      } catch {
        cirbtcFormatted = '0.0000'
      }

      try {
        const tcirbtcRaw = await publicClient.readContract({
          address: POOL_CONTRACTS.tcirBTC,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [targetAddr],
        })
        tcirbtcFormatted = parseFloat(formatUnits(tcirbtcRaw, 8)).toFixed(4)
      } catch {
        tcirbtcFormatted = '0.0000'
      }

      const result = {
        usdc: usdcFormatted,
        usyc: '0.00',
        eurc: eurcFormatted,
        cirbtc: cirbtcFormatted,
        tcirbtc: tcirbtcFormatted,
      }
      await redisCache.set(cacheKey, result, 30)
      return result
    },
    enabled: isAddressValid,
    staleTime: 30_000,
    gcTime: 1000 * 60 * 5,
  })

  // ── Real on-chain pool state (reserves, TVL growth, fee pools) ────────────
  const {
    data: onchainPoolState,
    refetch: refetchPoolState,
  } = useQuery({
    queryKey: ['onchainPoolState', walletAddress],
    queryFn: async () => {
      const cacheKey = 'arcis:pools:state'
      const cached = await redisCache.get<Record<string, any>>(cacheKey)
      if (cached) {
        return cached
      }

      const state: Record<string, any> = {}

      // StableSwapPool (USDC/EURC)
      if (isDeployed(POOL_CONTRACTS.STABLE_SWAP_POOL)) {
        try {
          const [reserveA, reserveB, totalLp, ufA, ufB] = await Promise.all([
            publicClient.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }),
            publicClient.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }),
            publicClient.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }),
            publicClient.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'unclaimedFeeA' }),
            publicClient.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'unclaimedFeeB' }),
          ])
          state[POOL_CONTRACTS.STABLE_SWAP_POOL] = {
            reserveA: formatUnits(reserveA as bigint, 6),
            reserveB: formatUnits(reserveB as bigint, 6),
            totalLp: formatUnits(totalLp as bigint, 18),
            unclaimedFeeA: formatUnits(ufA as bigint, 6),
            unclaimedFeeB: formatUnits(ufB as bigint, 6),
          }
        } catch (err) {
          console.warn('[usePoolsData] StableSwap state read failed:', err)
        }
      }

      // ConstantProductPool (USDC/tcirBTC)
      const cpAddresses = [
        POOL_CONTRACTS.CONSTANT_PRODUCT_POOL_TCIRBTC,
        POOL_CONTRACTS.CONSTANT_PRODUCT_POOL,
      ].filter((addr, idx, arr) => isDeployed(addr) && arr.indexOf(addr) === idx)

      for (const cpAddr of cpAddresses) {
        try {
          const [reserveA, reserveB, totalLp] = await Promise.all([
            publicClient.readContract({ address: cpAddr, abi: CONSTANT_PRODUCT_ABI, functionName: 'reserveA' }),
            publicClient.readContract({ address: cpAddr, abi: CONSTANT_PRODUCT_ABI, functionName: 'reserveB' }),
            publicClient.readContract({ address: cpAddr, abi: CONSTANT_PRODUCT_ABI, functionName: 'totalLp' }),
          ])
          state[cpAddr] = {
            reserveA: formatUnits(reserveA as bigint, 6),
            reserveB: formatUnits(reserveB as bigint, 8),
            totalLp: formatUnits(totalLp as bigint, 18),
          }
        } catch (err) {
          console.warn(`[usePoolsData] ConstantProduct state read failed for ${cpAddr}:`, err)
        }
      }

      // YieldVault (ERC-4626)
      if (isDeployed(POOL_CONTRACTS.YIELD_VAULT)) {
        try {
          const totalAssets = await publicClient.readContract({
            address: POOL_CONTRACTS.YIELD_VAULT,
            abi: YIELD_VAULT_ABI,
            functionName: 'totalAssets',
          })
          const totalSupply = await publicClient.readContract({
            address: POOL_CONTRACTS.YIELD_VAULT,
            abi: YIELD_VAULT_ABI,
            functionName: 'totalSupply',
          })
          state[POOL_CONTRACTS.YIELD_VAULT] = {
            totalAssets: formatUnits(totalAssets as bigint, 6),
            totalSupply: formatUnits(totalSupply as bigint, 18),
          }
        } catch (err) {
          console.warn('[usePoolsData] YieldVault state read failed:', err)
        }
      }

      await redisCache.set(cacheKey, state, 30)
      return state
    },
    enabled: true,
    staleTime: 30_000,
    gcTime: 1000 * 60 * 5,
  })

  // ── Real on-chain user pool positions (Vault shares & LP balances) ─────────
  const {
    data: userPoolPositions,
    refetch: refetchUserPositions,
  } = useQuery({
    queryKey: ['userPoolPositions', walletAddress, onchainPoolState],
    queryFn: async () => {
      if (!isAddressValid) return {}
      const targetAddr = walletAddress as `0x${string}`
      const cacheKey = `arcis:pools:positions:${walletAddress}`

      // Check cache only if it contains active positions
      const cached = await redisCache.get<Record<string, UserPoolPosition>>(cacheKey)
      if (cached && Object.keys(cached).length > 0) {
        return cached
      }

      const positions: Record<string, UserPoolPosition> = {}

      // 1. YieldVault (ERC-4626)
      if (isDeployed(POOL_CONTRACTS.YIELD_VAULT)) {
        try {
          const sharesRaw = (await publicClient.readContract({
            address: POOL_CONTRACTS.YIELD_VAULT,
            abi: YIELD_VAULT_ABI,
            functionName: 'balanceOf',
            args: [targetAddr],
          })) as bigint

          if (sharesRaw > 0n) {
            let assetsUsdc = 0
            let vaultState = onchainPoolState?.[POOL_CONTRACTS.YIELD_VAULT]
            let totalAssets = vaultState?.totalAssets ? parseUnits(vaultState.totalAssets, 6) : 0n
            let totalSupply = vaultState?.totalSupply ? parseUnits(vaultState.totalSupply, 18) : 0n

            // Fetch live totalAssets & totalSupply if not in cache yet
            if (totalSupply === 0n || totalAssets === 0n) {
              try {
                const [ta, ts] = await Promise.all([
                  publicClient.readContract({ address: POOL_CONTRACTS.YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalAssets' }),
                  publicClient.readContract({ address: POOL_CONTRACTS.YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalSupply' }),
                ])
                totalAssets = ta as bigint
                totalSupply = ts as bigint
              } catch (e) {
                console.warn('[usePoolsData] YieldVault direct stats fetch warning:', e)
              }
            }

            if (totalSupply > 0n && totalAssets > 0n) {
              const userAssetsRaw = (sharesRaw * totalAssets) / totalSupply
              assetsUsdc = parseFloat(formatUnits(userAssetsRaw, 6))
            } else {
              // Yield vault shares have 18 decimals, 1:1 initial ratio with 6-decimal USDC assets
              assetsUsdc = parseFloat(formatUnits(sharesRaw, 18))
            }

            const poolSharePct = totalSupply > 0n
              ? parseFloat(((Number(sharesRaw) / Number(totalSupply)) * 100).toFixed(4))
              : 0

            positions['usdc-yield-vault'] = {
              poolId: 'usdc-yield-vault',
              stakedAmount: assetsUsdc.toFixed(2),
              stakedUsd: assetsUsdc,
              earnedRewards: '0.00',
              earnedUsd: 0,
              lastUpdatedTimestamp: Date.now(),
              lpTokenBalance: formatUnits(sharesRaw, 18),
              poolSharePct,
            }
          }
        } catch (err) {
          console.warn('[usePoolsData] YieldVault user balance read failed:', err)
        }
      }

      // 2. StableSwapPool (USDC / EURC LP)
      if (isDeployed(POOL_CONTRACTS.STABLE_SWAP_POOL)) {
        try {
          const lpRaw = (await publicClient.readContract({
            address: POOL_CONTRACTS.STABLE_SWAP_POOL,
            abi: STABLE_SWAP_ABI,
            functionName: 'balanceOf',
            args: [targetAddr],
          })) as bigint

          if (lpRaw > 0n) {
            let poolState = onchainPoolState?.[POOL_CONTRACTS.STABLE_SWAP_POOL]
            let totalLp = poolState?.totalLp ? parseUnits(poolState.totalLp, 18) : 0n
            let reserveA = poolState?.reserveA ? parseUnits(poolState.reserveA, 6) : 0n
            let reserveB = poolState?.reserveB ? parseUnits(poolState.reserveB, 6) : 0n

            if (totalLp === 0n) {
              try {
                const [rA, rB, tLp] = await Promise.all([
                  publicClient.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }),
                  publicClient.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }),
                  publicClient.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }),
                ])
                reserveA = rA as bigint
                reserveB = rB as bigint
                totalLp = tLp as bigint
              } catch (e) {
                console.warn('[usePoolsData] StableSwap direct reserves fetch warning:', e)
              }
            }

            let stakedUsd = 0
            let userA = 0
            let userB = 0
            let poolSharePct = 0

            if (totalLp > 0n) {
              const userARaw = (reserveA * lpRaw) / totalLp
              const userBRaw = (reserveB * lpRaw) / totalLp
              userA = parseFloat(formatUnits(userARaw, 6))
              userB = parseFloat(formatUnits(userBRaw, 6))
              const exchangeRate = ARCIS_POOLS.find((p) => p.id === 'usdc-eurc-stable-pool')?.exchangeRate || 1.082
              stakedUsd = userA + userB * exchangeRate
              poolSharePct = parseFloat(((Number(lpRaw) / Number(totalLp)) * 100).toFixed(4))
            } else {
              stakedUsd = parseFloat(formatUnits(lpRaw, 18))
            }

            positions['usdc-eurc-stable-pool'] = {
              poolId: 'usdc-eurc-stable-pool',
              stakedAmount: stakedUsd.toFixed(2),
              stakedUsd,
              earnedRewards: '0.00',
              earnedUsd: 0,
              lastUpdatedTimestamp: Date.now(),
              isLpPosition: true,
              lpTokenBalance: formatUnits(lpRaw, 18),
              poolSharePct,
              tokenAStaked: userA.toFixed(2),
              tokenBStaked: userB.toFixed(2),
            }
          }
        } catch (err) {
          console.warn('[usePoolsData] StableSwap user balance read failed:', err)
        }
      }

      // 3. ConstantProductPool (USDC / tcirBTC LP)
      const tcirBtcPool = ARCIS_POOLS.find((p) => p.id === 'usdc-tcirbtc-pool' || p.id === 'usdc-cirbtc-pool')
      const cpAddress = tcirBtcPool?.contractAddress || POOL_CONTRACTS.CONSTANT_PRODUCT_POOL_TCIRBTC || POOL_CONTRACTS.CONSTANT_PRODUCT_POOL
      if (isDeployed(cpAddress)) {
        try {
          const lpRaw = (await publicClient.readContract({
            address: cpAddress,
            abi: CONSTANT_PRODUCT_ABI,
            functionName: 'balanceOf',
            args: [targetAddr],
          })) as bigint

          if (lpRaw > 0n) {
            let poolState = onchainPoolState?.[cpAddress]
            let totalLp = poolState?.totalLp ? parseUnits(poolState.totalLp, 18) : 0n
            let reserveA = poolState?.reserveA ? parseUnits(poolState.reserveA, 6) : 0n
            let reserveB = poolState?.reserveB ? parseUnits(poolState.reserveB, 8) : 0n

            if (totalLp === 0n) {
              try {
                const [rA, rB, tLp] = await Promise.all([
                  publicClient.readContract({ address: cpAddress, abi: CONSTANT_PRODUCT_ABI, functionName: 'reserveA' }),
                  publicClient.readContract({ address: cpAddress, abi: CONSTANT_PRODUCT_ABI, functionName: 'reserveB' }),
                  publicClient.readContract({ address: cpAddress, abi: CONSTANT_PRODUCT_ABI, functionName: 'totalLp' }),
                ])
                reserveA = rA as bigint
                reserveB = rB as bigint
                totalLp = tLp as bigint
              } catch (e) {
                console.warn('[usePoolsData] ConstantProduct direct reserves fetch warning:', e)
              }
            }

            let stakedUsd = 0
            let userA = 0
            let userB = 0
            let poolSharePct = 0

            if (totalLp > 0n) {
              const userARaw = (reserveA * lpRaw) / totalLp
              const userBRaw = (reserveB * lpRaw) / totalLp
              userA = parseFloat(formatUnits(userARaw, 6))
              userB = parseFloat(formatUnits(userBRaw, 8))
              const btcPrice = tcirBtcPool?.exchangeRate || 96500
              stakedUsd = userA + userB * btcPrice
              poolSharePct = parseFloat(((Number(lpRaw) / Number(totalLp)) * 100).toFixed(4))
            } else {
              stakedUsd = parseFloat(formatUnits(lpRaw, 18))
            }

            const poolIdKey = tcirBtcPool?.id || 'usdc-tcirbtc-pool'
            positions[poolIdKey] = {
              poolId: poolIdKey,
              stakedAmount: stakedUsd.toFixed(2),
              stakedUsd,
              earnedRewards: '0.00',
              earnedUsd: 0,
              lastUpdatedTimestamp: Date.now(),
              isLpPosition: true,
              lpTokenBalance: formatUnits(lpRaw, 18),
              poolSharePct,
              tokenAStaked: userA.toFixed(2),
              tokenBStaked: userB.toFixed(4),
            }
          }
        } catch (err) {
          console.warn('[usePoolsData] ConstantProduct user balance read failed:', err)
        }
      }

      if (Object.keys(positions).length > 0) {
        await redisCache.set(cacheKey, positions, 30)
      }
      return positions
    },
    enabled: isAddressValid,
    staleTime: 30_000,
    gcTime: 1000 * 60 * 5,
  })

  // ── Aggregate pool metrics (live reserves override static TVL) ────────────
  const poolsWithUserStats = useMemo(() => {
    return ARCIS_POOLS.map((pool) => {
      let tvlUsd = pool.tvlUsd
      if (pool.id === 'usdc-eurc-stable-pool' && onchainPoolState?.[POOL_CONTRACTS.STABLE_SWAP_POOL]) {
        const s = onchainPoolState[POOL_CONTRACTS.STABLE_SWAP_POOL]
        const reserveUsd = parseFloat(s.reserveA) + parseFloat(s.reserveB) * (pool.exchangeRate || 1)
        if (reserveUsd > 10) tvlUsd = Math.round(reserveUsd)
      }
      if ((pool.id === 'usdc-tcirbtc-pool' || pool.id === 'usdc-cirbtc-pool' || pool.id === 'usdc-cirbtc-volume-pool') && (onchainPoolState?.[pool.contractAddress] || onchainPoolState?.[POOL_CONTRACTS.CONSTANT_PRODUCT_POOL_TCIRBTC] || onchainPoolState?.[POOL_CONTRACTS.CONSTANT_PRODUCT_POOL])) {
        const s = onchainPoolState[pool.contractAddress] || onchainPoolState[POOL_CONTRACTS.CONSTANT_PRODUCT_POOL_TCIRBTC] || onchainPoolState[POOL_CONTRACTS.CONSTANT_PRODUCT_POOL]
        const reserveUsd = parseFloat(s.reserveA) + parseFloat(s.reserveB) * (pool.exchangeRate || 1)
        if (reserveUsd > 10) tvlUsd = Math.round(reserveUsd)
      }
      if (pool.id === 'usdc-yield-vault' && onchainPoolState?.[POOL_CONTRACTS.YIELD_VAULT]) {
        const s = onchainPoolState[POOL_CONTRACTS.YIELD_VAULT]
        const assetsUsd = parseFloat(s.totalAssets)
        if (assetsUsd > 10) tvlUsd = Math.round(assetsUsd)
      }

      return {
        ...pool,
        tvlUsd,
        userPosition: userPoolPositions?.[pool.id] || undefined,
      }
    })
  }, [onchainPoolState, userPoolPositions])

  const totalTvlUsd = useMemo(() => {
    return poolsWithUserStats.reduce((acc, pool) => acc + pool.tvlUsd, 0)
  }, [poolsWithUserStats])

  const averageApy = useMemo(() => {
    const totalWeightedApy = poolsWithUserStats.reduce((acc, pool) => acc + pool.apy * pool.tvlUsd, 0)
    return totalTvlUsd > 0 ? (totalWeightedApy / totalTvlUsd).toFixed(2) : '6.45'
  }, [poolsWithUserStats, totalTvlUsd])

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
    if (!provider) return null
    try {
      // EIP-1193 browser wallet provider (wrapped by wagmi)
      const client = await import('viem').then((m) =>
        m.createWalletClient({
          chain: arcTestnet,
          transport: m.custom(provider),
        })
      )
      return client
    } catch (err) {
      console.warn('[usePoolsData] wallet client setup failed:', err)
      return null
    }
  }, [provider])

  const requireDeployed = useCallback((address: string, poolName: string) => {
    if (!isDeployed(address)) {
      throw new Error(`Pool "${poolName}" is not deployed on Arc Testnet yet. Run 'forge script Deploy' first.`)
    }
  }, [])

  // ── Approve helper (ERC-20 USDC / EURC) ──────────────────────────────────
  const approveToken = useCallback(
    async (tokenAddress: `0x${string}`, spender: `0x${string}`, amount: bigint) => {
      const walletClient = await getWalletClient()
      if (!walletClient) throw new Error('Wallet not connected')
      const [account] = await walletClient.getAddresses()
      if (!account) throw new Error('No wallet account')

      // Approve max to avoid repeat approvals
      const txHash = await walletClient.writeContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, amount],
        account,
        chain: arcTestnet,
      })
      await publicClient.waitForTransactionReceipt({ hash: txHash, pollingInterval: 5000 })
      return txHash
    },
    [getWalletClient, publicClient]
  )

  // ── Invalidate Redis & React Query Caches Helper ────────────────────────
  const invalidatePoolCaches = useCallback(async () => {
    await Promise.all([
      redisCache.del('arcis:pools:state'),
      walletAddress ? redisCache.del(`arcis:pools:balances:${walletAddress}`) : Promise.resolve(),
      walletAddress ? redisCache.del(`arcis:pools:positions:${walletAddress}`) : Promise.resolve(),
    ])
    refetchOnchainBalances()
    refetchPoolState()
    refetchUserPositions()
    queryClient.invalidateQueries({ queryKey: ['onchainPoolBalances'] })
    queryClient.invalidateQueries({ queryKey: ['onchainPoolState'] })
    queryClient.invalidateQueries({ queryKey: ['userPoolPositions'] })
    queryClient.invalidateQueries({ queryKey: ['walletTestnetBalances'] })
  }, [refetchOnchainBalances, refetchPoolState, refetchUserPositions, queryClient, walletAddress])

  // ── Standard deposit (Yield Vault & Gateway Settlement Pool) ────────────
  const depositToPool = useCallback(
    async (poolId: string, amountStr: string, _provider?: any): Promise<{ txHash: string }> => {
      const pool = ARCIS_POOLS.find((p) => p.id === poolId)
      if (!pool) throw new Error('Pool not found')

      // Handle Circle Gateway Settlement Pool deposit
      if (pool.id === 'gateway-settlement-pool' || pool.isCrossChainPool) {
        const p = _provider || (typeof window !== 'undefined' && (window as any).ethereum)
        if (!p) {
          throw new Error('Wallet provider required for Gateway deposit')
        }
        const result = await depositToGateway(p, 'Arc_Testnet', amountStr, arcTestnet, 'USDC')
        await invalidatePoolCaches()
        return { txHash: result.depositTxHash || result.approveTxHash || '' }
      }

      if (pool.id !== 'usdc-yield-vault') {
        throw new Error('Use Zap / Dual deposit for LP pools')
      }

      requireDeployed(POOL_CONTRACTS.YIELD_VAULT, pool.name)

      const walletClient = await getWalletClient()
      if (!walletClient) throw new Error('Wallet not connected')
      const [account] = await walletClient.getAddresses()
      if (!account) throw new Error('No wallet account')

      const amount = parseUnits(amountStr, 6)
      await approveToken(POOL_CONTRACTS.USDC, POOL_CONTRACTS.YIELD_VAULT, amount)

      const txHash = await walletClient.writeContract({
        address: POOL_CONTRACTS.YIELD_VAULT,
        abi: YIELD_VAULT_ABI,
        functionName: 'deposit',
        args: [amount, account],
        account,
        chain: arcTestnet,
      })

      await invalidatePoolCaches()
      return { txHash }
    },
    [getWalletClient, approveToken, publicClient, requireDeployed, invalidatePoolCaches]
  )

  // ── 1-Click Zap: swap half USDC→counter, then add dual liquidity ──────────
  // ── 1-Click Zap: swap half USDC→counter, then add dual liquidity ──────────
  const zapIn = useCallback(
    async (
      poolId: string,
      tokenInSymbol: string,
      inputAmountStr: string,
      _slippage: number = 0.5
    ): Promise<{ txHash: string; lpMinted: string; poolShare: number }> => {
      const pool = ARCIS_POOLS.find((p) => p.id === poolId)
      if (!pool || !pool.isLpPool) throw new Error('Pool does not support LP Zap')

      const poolAddress = pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
        ? POOL_CONTRACTS.STABLE_SWAP_POOL
        : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL_TCIRBTC)

      requireDeployed(poolAddress, pool.name)

      const walletClient = await getWalletClient()
      if (!walletClient) throw new Error('Wallet not connected')
      const [account] = await walletClient.getAddresses()
      if (!account) throw new Error('No wallet account')

      const usdcAmount = parseUnits(inputAmountStr, 6)
      const halfUsdc = usdcAmount / 2n
      const poolRemainingUsdc = usdcAmount - halfUsdc

      const counterToken = pool.tokens[1]
      const counterTokenAddress = (counterToken?.address || POOL_CONTRACTS.tcirBTC) as `0x${string}`

      // 1) Approve pool to spend entire usdcAmount
      await approveToken(POOL_CONTRACTS.USDC, poolAddress, usdcAmount)

      // Read counter balance before swap
      const counterBalBefore = await publicClient.readContract({
        address: counterTokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
      })

      // 1) Swap half USDC → counter token via pool.swap
      const swapOut = await walletClient.writeContract({
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'swap',
        args: [POOL_CONTRACTS.USDC, counterTokenAddress, halfUsdc, 0n],
        account,
        chain: arcTestnet,
      })
      await publicClient.waitForTransactionReceipt({ hash: swapOut, pollingInterval: 3000 })

      // Measure actual counter tokens received
      const counterBalAfter = await publicClient.readContract({
        address: counterTokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
      })
      const actualCounterAmount = counterBalAfter > counterBalBefore ? counterBalAfter - counterBalBefore : 0n
      if (actualCounterAmount === 0n) {
        throw new Error('Takas çıktısı olarak karşı token alınamadı.')
      }

      // Approve actual received counter tokens for liquidity addition
      await approveToken(counterTokenAddress, poolAddress, actualCounterAmount)

      // 2) Add dual liquidity with remaining USDC + actual swapped counter
      const txHash = await walletClient.writeContract({
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'addLiquidity',
        args: [poolRemainingUsdc, actualCounterAmount],
        account,
        chain: arcTestnet,
      })
      await publicClient.waitForTransactionReceipt({ hash: txHash, pollingInterval: 3000 })

      const lpMinted = (parseFloat(inputAmountStr) * 0.998).toFixed(2)
      const poolShare = parseFloat(((parseFloat(inputAmountStr) / (pool.tvlUsd + parseFloat(inputAmountStr))) * 100).toFixed(3))

      await invalidatePoolCaches()
      return { txHash, lpMinted, poolShare }
    },
    [getWalletClient, approveToken, publicClient, requireDeployed, invalidatePoolCaches]
  )

  // ── Dual-asset deposit (USDC + counter token) ─────────────────────────────
  const depositDual = useCallback(
    async (
      poolId: string,
      amountAStr: string,
      amountBStr: string,
      _slippage: number = 0.5
    ): Promise<{ txHash: string; lpMinted: string; poolShare: number }> => {
      const pool = ARCIS_POOLS.find((p) => p.id === poolId)
      if (!pool || !pool.isLpPool) throw new Error('Pool is not an LP pool')

      const poolAddress = pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
        ? POOL_CONTRACTS.STABLE_SWAP_POOL
        : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL_TCIRBTC)

      requireDeployed(poolAddress, pool.name)

      const walletClient = await getWalletClient()
      if (!walletClient) throw new Error('Wallet not connected')
      const [account] = await walletClient.getAddresses()
      if (!account) throw new Error('No wallet account')

      const counterToken = pool.tokens[1]
      const counterDecimals = counterToken?.decimals === 8 ? 8 : 6
      const amountA = parseUnits(amountAStr, 6)
      const amountB = parseUnits(amountBStr, counterDecimals)

      await approveToken(POOL_CONTRACTS.USDC, poolAddress, amountA)
      const counterTokenAddress = (counterToken?.address || POOL_CONTRACTS.tcirBTC) as `0x${string}`
      await approveToken(counterTokenAddress, poolAddress, amountB)

      const txHash = await walletClient.writeContract({
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'addLiquidity',
        args: [amountA, amountB],
        account,
        chain: arcTestnet,
      })

      const totalUsdAdded = parseFloat(amountAStr) + parseFloat(amountBStr) * (pool.exchangeRate || 1)
      const poolShare = parseFloat(((totalUsdAdded / (pool.tvlUsd + totalUsdAdded)) * 100).toFixed(3))

      await invalidatePoolCaches()
      return { txHash, lpMinted: totalUsdAdded.toFixed(2), poolShare }
    },
    [getWalletClient, approveToken, publicClient, requireDeployed, invalidatePoolCaches]
  )

  // ── Withdraw (vault redeem OR LP removeLiquidity) ─────────────────────────
  const withdrawFromPool = useCallback(
    async (
      poolId: string,
      amountStr: string,
      payoutMode: 'standard' | 'dual' | 'usdc' = 'standard',
      _provider?: any
    ): Promise<{ txHash: string }> => {
      const pool = ARCIS_POOLS.find((p) => p.id === poolId)
      if (!pool) throw new Error('Pool not found')

      const walletClient = await getWalletClient()
      if (!walletClient) throw new Error('Wallet not connected')
      const [account] = await walletClient.getAddresses()
      if (!account) throw new Error('No wallet account')

      if (pool.id === 'gateway-settlement-pool' || pool.isCrossChainPool) {
        throw new Error('Gateway balances are held in your unified cross-chain balance. Use the Spend / Rebalance button to transfer or route your balance.')
      }

      if (pool.id === 'usdc-yield-vault') {
        requireDeployed(POOL_CONTRACTS.YIELD_VAULT, pool.name)
        const walletSharesRaw = (await publicClient.readContract({
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'balanceOf',
          args: [account],
        })) as bigint

        if (walletSharesRaw === 0n) {
          throw new Error('No vault shares deposited')
        }

        const totalAssets = (await publicClient.readContract({
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'totalAssets',
        })) as bigint

        const totalSupply = (await publicClient.readContract({
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'totalSupply',
        })) as bigint

        const userPos = userPoolPositions?.['usdc-yield-vault']
        const userStakedUsd = userPos?.stakedUsd || 0
        const withdrawAmountUsd = parseFloat(amountStr) || 0

        let sharesToRedeem: bigint
        if (withdrawAmountUsd >= userStakedUsd * 0.999 || userStakedUsd <= 0) {
          sharesToRedeem = walletSharesRaw
        } else {
          const assetsPerShare = totalSupply > 0n ? (totalAssets * 10n ** 18n) / totalSupply : 10n ** 18n
          const amountAssets = parseUnits(amountStr, 6)
          sharesToRedeem = (amountAssets * 10n ** 18n) / assetsPerShare
          if (sharesToRedeem > walletSharesRaw) sharesToRedeem = walletSharesRaw
        }

        const txHash = await walletClient.writeContract({
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'redeem',
          args: [sharesToRedeem, account, account],
          account,
          chain: arcTestnet,
        })
        await invalidatePoolCaches()
        return { txHash }
      }

      // LP pool removal
      const poolAddress = pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
        ? POOL_CONTRACTS.STABLE_SWAP_POOL
        : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL_TCIRBTC)
      requireDeployed(poolAddress, pool.name)

      const userLpRaw = (await publicClient.readContract({
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'balanceOf',
        args: [account],
      })) as bigint

      if (userLpRaw === 0n) {
        throw new Error('No LP liquidity deposited in this pool')
      }

      const userPos = userPoolPositions?.[poolId]
      const userStakedUsd = userPos?.stakedUsd || 0
      const withdrawAmountUsd = parseFloat(amountStr) || 0

      let lpToWithdraw: bigint
      if (withdrawAmountUsd >= userStakedUsd * 0.999 || userStakedUsd <= 0) {
        lpToWithdraw = userLpRaw
      } else {
        const ratio = withdrawAmountUsd / userStakedUsd
        lpToWithdraw = (userLpRaw * BigInt(Math.round(ratio * 10000))) / 10000n
        if (lpToWithdraw > userLpRaw) lpToWithdraw = userLpRaw
      }

      if (lpToWithdraw === 0n) {
        throw new Error('Withdrawal amount too small')
      }

      const txHash = await walletClient.writeContract({
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'removeLiquidity',
        args: [lpToWithdraw],
        account,
        chain: arcTestnet,
      })

      await invalidatePoolCaches()
      return { txHash }
    },
    [getWalletClient, publicClient, requireDeployed, invalidatePoolCaches, userPoolPositions]
  )

  // ── Faucet: Mint test cirBTC / tcirBTC tokens ─────────────────────────────
  const faucetMint = useCallback(
    async (poolId: string): Promise<{ txHash: string }> => {
      const pool = ARCIS_POOLS.find((p) => p.id === poolId)
      if (!pool?.isFaucetToken || !pool.faucetTokenAddress) {
        throw new Error('Pool does not support faucet minting')
      }

      const walletClient = await getWalletClient()
      if (!walletClient) throw new Error('Wallet not connected')
      const [account] = await walletClient.getAddresses()
      if (!account) throw new Error('No wallet account')

      // Mint 0.01 tcirBTC (8 decimals → 10^6)
      const amount = 10n ** 6n // 0.01 tcirBTC
      const txHash = await walletClient.writeContract({
        address: pool.faucetTokenAddress as `0x${string}`,
        abi: MOCK_ERC20_ABI,
        functionName: 'mint',
        args: [account, amount],
        account,
        chain: arcTestnet,
      })
      await publicClient.waitForTransactionReceipt({ hash: txHash, pollingInterval: 5000 })

      await invalidatePoolCaches()
      return { txHash }
    },
    [getWalletClient, publicClient, invalidatePoolCaches]
  )

  // ── Pool Swap (USDC ↔ EURC via StableSwapPool or USDC ↔ tcirBTC via ConstantProductPool) ──
  const swapInPool = useCallback(
    async (
      poolId: string,
      tokenIn: string,
      tokenOut: string,
      amountInStr: string,
      minOutStr?: string
    ): Promise<{ txHash: string; amountOut: string }> => {
      const pool = ARCIS_POOLS.find((p) => p.id === poolId)
      if (!pool || !pool.isLpPool) throw new Error('Pool does not support swapping')

      const poolAddress = pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
        ? POOL_CONTRACTS.STABLE_SWAP_POOL
        : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL_TCIRBTC)

      requireDeployed(poolAddress, pool.name)

      const walletClient = await getWalletClient()
      if (!walletClient) throw new Error('Wallet not connected')
      const [account] = await walletClient.getAddresses()
      if (!account) throw new Error('No wallet account')

      const counterToken = pool.tokens[1]
      const counterTokenAddr = (counterToken?.address || POOL_CONTRACTS.tcirBTC) as `0x${string}`

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

      const inDecimals = (tokenIn === 'cirBTC' || tokenIn === 'tcirBTC' || (counterToken?.decimals === 8 && tokenIn !== 'USDC')) ? 8 : 6
      const outDecimals = (tokenOut === 'cirBTC' || tokenOut === 'tcirBTC' || (counterToken?.decimals === 8 && tokenOut !== 'USDC')) ? 8 : 6
      const amountIn = parseUnits(amountInStr, inDecimals)
      const minOut = minOutStr ? parseUnits(minOutStr, outDecimals) : 0n

      // Approve tokenIn for the pool
      await approveToken(tokenInAddr as `0x${string}`, poolAddress, amountIn)

      const txHash = await walletClient.writeContract({
        address: poolAddress,
        abi: STABLE_SWAP_ABI, // ABI identical for swap fn
        functionName: 'swap',
        args: [tokenInAddr, tokenOutAddr, amountIn, minOut],
        account,
        chain: arcTestnet,
      })

      await invalidatePoolCaches()
      return { txHash, amountOut: minOutStr || '0' }
    },
    [getWalletClient, approveToken, publicClient, requireDeployed, invalidatePoolCaches]
  )

  // ── Claim rewards ─────────────────────────────────────────────────────────
  // LP fees settle when liquidity is removed (removeLiquidity includes fee share).
  // YieldVault rewards auto-appreciate share value — no separate claim tx needed.
  const claimPoolRewards = useCallback(
    async (poolId: string): Promise<{ amountClaimed: string; txHash: string }> => {
      throw new Error(
        'LP fees settle automatically on withdrawal and vault yield auto-compounds into share value — no manual claim needed.'
      )
    },
    []
  )

  const claimAllRewards = useCallback(async (): Promise<{ totalClaimed: string; txHash: string }> => {
    throw new Error('No manual claim needed — yield auto-settles into positions.')
  }, [])

  const refreshBalances = useCallback(() => {
    invalidatePoolCaches()
  }, [invalidatePoolCaches])

  // Poll pool state and user positions every 30s for live TVL & position updates with 30s Redis cache
  useEffect(() => {
    const interval = setInterval(() => {
      refetchPoolState()
      if (isAddressValid) {
        refetchUserPositions()
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [refetchPoolState, refetchUserPositions, isAddressValid])

  return {
    pools: poolsWithUserStats as (PoolConfig & { userPosition?: UserPoolPosition })[],
    swapInPool,
    faucetMint,
    onchainBalances: onchainBalances || { usdc: '0.00', usyc: '0.00', eurc: '0.00', cirbtc: '0.00000', tcirbtc: '0.00000' },
    isBalancesLoading,
    totalTvlUsd,
    averageApy,
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