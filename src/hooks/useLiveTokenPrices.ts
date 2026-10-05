import { useQuery } from '@tanstack/react-query'
import {
  getLiveTokenPrices,
  normalizeTokenSymbol,
  type TokenPriceMap,
} from '../services/tokenPriceService'

/**
 * Shared TanStack Query hook for real-time token prices across modals and pools.
 * Refetches every 30 seconds with 30s stale time.
 */
export function useLiveTokenPrices() {
  return useQuery({
    queryKey: ['liveTokenPrices'],
    queryFn: async () => {
      console.log('[useLiveTokenPrices] 🔄 Hook triggering live token prices query...')
      const prices = await getLiveTokenPrices()
      console.log('[useLiveTokenPrices] 🎯 Hook received live token prices:', prices)
      return prices
    },
    staleTime: 30_000,
    gcTime: 1000 * 60 * 5,
    refetchInterval: 30_000,
  })
}

/**
 * Formats a token amount into its fiat USD equivalent.
 *
 * Rules:
 * 1. If amount is empty, <= 0, or not a valid number -> returns undefined.
 * 2. If token is USDC: directly calculates amount * 1.00 USD (stablecoin).
 * 3. For floating/other tokens (cirBTC, EURC, etc.):
 *    - Uses active on-chain pool exchange rate if provided (>0).
 *    - Or uses live oracle price from tokenPrices.
 *    - If NO verified live price or pool rate exists: NEVER uses hardcoded fallbacks; returns undefined.
 * 4. Display formatting:
 *    - If totalUsd < 0.01: "< $0.01 USD"
 *    - Otherwise: "≈ $X.XX USD"
 */
export function formatFiatEstimate(
  amount: string | number | undefined | null,
  tokenSymbol: string | undefined | null,
  prices?: TokenPriceMap | null,
  poolExchangeRate?: number
): string | undefined {
  if (amount === undefined || amount === null) return undefined
  const str = amount.toString().trim()
  if (!str) return undefined
  const num = parseFloat(str)
  if (isNaN(num) || num <= 0) return undefined

  const normUpper = (tokenSymbol || '').toUpperCase().trim()
  const norm = normalizeTokenSymbol(tokenSymbol || '')

  // 1. USDC is a 1:1 USD-pegged stablecoin
  if (norm === 'USDC') {
    return `≈ $${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
  }

  // 2. LP Tokens & Vault Shares (e.g. af-USDC, af-USDC-cirBTC, af-USDC-EURC, LP)
  // LP tokens require measured valuation data; never invent a flat $1.00/share fallback.
  const isLpToken = normUpper.startsWith('AF-') || normUpper.includes('LP') || norm === 'af-USDC'
  if (isLpToken) {
    const rawPrice = prices?.[tokenSymbol || ''] ?? prices?.[norm] ?? prices?.[normUpper]
    if (typeof rawPrice !== 'number' || !Number.isFinite(rawPrice) || rawPrice <= 0) {
      return undefined
    }
    const lpPrice = rawPrice
    const totalUsd = num * lpPrice
    if (totalUsd < 0.01) {
      return '< $0.01 USD'
    }
    return `≈ $${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
  }

  // 3. Counter Tokens (cirBTC, EURC, etc.)
  // poolExchangeRate is the active on-chain reserve ratio (tokenA / tokenB, i.e. USDC per counter-token).
  // Only apply poolExchangeRate if the token is a counter-token traded against USDC.
  let unitPrice: number | undefined = undefined

  const isCounterToken =
    norm === 'CIRBTC' ||
    norm === 'BTC' ||
    norm === 'WBTC' ||
    norm === 'EURC' ||
    norm === 'WETH' ||
    norm === 'ETH' ||
    norm === 'POL' ||
    norm === 'MATIC' ||
    norm === 'AVAX' ||
    norm === 'SOL' ||
    norm === 'SEI' ||
    norm === 'S' ||
    norm === 'USYC'

  if (isCounterToken && poolExchangeRate && poolExchangeRate > 0) {
    unitPrice = poolExchangeRate
  } else if (prices && typeof prices === 'object') {
    const p = prices[norm]
    if (typeof p === 'number' && p > 0) {
      unitPrice = p
    }
  } else if (!isCounterToken && poolExchangeRate && poolExchangeRate > 0) {
    unitPrice = poolExchangeRate
  }

  // If no verified live price or valid pool rate is found, DO NOT show inaccurate fallbacks (e.g. 96500)
  if (!unitPrice || unitPrice <= 0) {
    return undefined
  }

  const totalUsd = num * unitPrice
  if (totalUsd < 0.01) {
    return '< $0.01 USD'
  }

  return `≈ $${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
}
