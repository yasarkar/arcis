// src/hooks/useArcSwapTokenBalances.ts
// Lightweight, SSR-safe Arc Testnet ERC-20 balance reader for the 4 swap tokens
// (USDC, EURC, WETH, cirBTC). Uses a short in-memory TTL cache and refreshes on
// `arcis_portfolio_updated` without requiring a React Query provider.

import { useCallback, useEffect, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import { ARC_TESTNET_TOKENS } from '../config/arcChain'
import { ERC20_ABI } from '../config/poolsConfig'
import { getArcPublicClient, resilientReadContract } from '../services/rpc'

export type ArcSwapTokenSymbol = 'USDC' | 'EURC' | 'WETH' | 'cirBTC'

export interface ArcSwapTokenBalanceMap {
  USDC: number | null
  EURC: number | null
  WETH: number | null
  cirBTC: number | null
}

const TOKEN_META: Array<{ symbol: ArcSwapTokenSymbol; address: Address; decimals: number }> = [
  { symbol: 'USDC', address: ARC_TESTNET_TOKENS.USDC as Address, decimals: 6 },
  { symbol: 'EURC', address: ARC_TESTNET_TOKENS.EURC as Address, decimals: 6 },
  { symbol: 'WETH', address: ARC_TESTNET_TOKENS.WETH as Address, decimals: 18 },
  { symbol: 'cirBTC', address: ARC_TESTNET_TOKENS.cirBTC as Address, decimals: 8 },
]

const EMPTY_BALANCES: ArcSwapTokenBalanceMap = {
  USDC: null,
  EURC: null,
  WETH: null,
  cirBTC: null,
}

const CACHE_TTL_MS = 12_000
const balanceCache = new Map<string, { fetchedAt: number; data: ArcSwapTokenBalanceMap }>()

async function fetchArcSwapBalances(walletAddress: string): Promise<ArcSwapTokenBalanceMap> {
  const client = getArcPublicClient()
  const results = await Promise.all(
    TOKEN_META.map(async (tok) => {
      try {
        const raw = (await resilientReadContract(client, {
          address: tok.address,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [walletAddress as Address],
        })) as bigint
        const num = Number(formatUnits(raw, tok.decimals))
        return [tok.symbol, Number.isFinite(num) ? num : null] as const
      } catch {
        return [tok.symbol, null] as const
      }
    })
  )

  const next: ArcSwapTokenBalanceMap = { ...EMPTY_BALANCES }
  for (const [symbol, val] of results) {
    next[symbol] = val
  }
  return next
}

export function resolveArcSwapTokenBalance(
  balances: ArcSwapTokenBalanceMap,
  symbol: string | undefined
): number | null {
  if (!symbol) return null
  const upper = symbol.trim().toUpperCase()
  if (upper === 'USDC') return balances.USDC
  if (upper === 'EURC') return balances.EURC
  if (upper === 'WETH' || upper === 'ETH') return balances.WETH
  if (upper === 'CIRBTC' || upper === 'BTC') return balances.cirBTC
  return null
}

export function useArcSwapTokenBalances(walletAddress?: string, enabled = true) {
  const normalized = walletAddress?.trim().toLowerCase() || ''
  const [balances, setBalances] = useState<ArcSwapTokenBalanceMap>(() => {
    if (!normalized) return EMPTY_BALANCES
    const cached = balanceCache.get(normalized)
    return cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS ? cached.data : EMPTY_BALANCES
  })
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(
    async (force = false) => {
      if (!normalized || !enabled || !/^0x[a-f0-9]{40}$/.test(normalized)) {
        setBalances(EMPTY_BALANCES)
        return
      }
      const cached = balanceCache.get(normalized)
      if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        setBalances(cached.data)
        return
      }
      setLoading(true)
      try {
        const data = await fetchArcSwapBalances(normalized)
        balanceCache.set(normalized, { fetchedAt: Date.now(), data })
        setBalances(data)
      } finally {
        setLoading(false)
      }
    },
    [normalized, enabled]
  )

  useEffect(() => {
    let active = true
    if (!normalized || !enabled || !/^0x[a-f0-9]{40}$/.test(normalized)) {
      setBalances(EMPTY_BALANCES)
      return
    }
    const cached = balanceCache.get(normalized)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      setBalances(cached.data)
      return
    }
    setLoading(true)
    void fetchArcSwapBalances(normalized)
      .then((data) => {
        if (!active) return
        balanceCache.set(normalized, { fetchedAt: Date.now(), data })
        setBalances(data)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [normalized, enabled])

  useEffect(() => {
    if (!enabled || !normalized || typeof window === 'undefined') return
    const onPortfolioUpdated = () => {
      void refresh(true)
    }
    window.addEventListener('arcis_portfolio_updated', onPortfolioUpdated)
    return () => window.removeEventListener('arcis_portfolio_updated', onPortfolioUpdated)
  }, [enabled, normalized, refresh])

  return { balances, loading, refresh }
}
