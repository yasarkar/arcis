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

  const norm = normalizeTokenSymbol(tokenSymbol || '')

  // USDC is a 1:1 USD-pegged stablecoin
  if (norm === 'USDC') {
    return `≈ $${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
  }

  // Determine rate: priority 1 = active pool reserve rate, priority 2 = live oracle price
  let unitPrice: number | undefined = undefined

  if (poolExchangeRate && poolExchangeRate > 0) {
    unitPrice = poolExchangeRate
  } else if (prices && typeof prices === 'object') {
    const p = prices[norm]
    if (typeof p === 'number' && p > 0) {
      unitPrice = p
    }
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
