// src/services/tokenPriceService.ts
// Multi-Tier Dynamic Token Price Oracle & Cache for ArcFlow and Ask Arco Copilot
// 1. In-Memory Micro Cache (0ms) -> 2. Redis Cache (30s TTL) -> 3. Live Oracle/DEX API -> 4. Safe Static Fallback

import { redisCache } from './redisCacheService'

export interface TokenPriceMap {
  [symbol: string]: number
}

export const DEFAULT_TOKEN_PRICES: TokenPriceMap = {
  USDC: 1.0,
  EURC: 1.08,
  WETH: 2650.0,
  ETH: 2650.0,
  WBTC: 63000.0,
  BTC: 63000.0,
  CIRBTC: 63000.0,
  'af-USDC': 1.0842,
  AFUSDC: 1.0842,
}

const CACHE_KEY = 'arcflow:token_prices:v1'
const CACHE_TTL_SECONDS = 30
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000

let memoryCache: { prices: TokenPriceMap; timestamp: number } = {
  prices: { ...DEFAULT_TOKEN_PRICES },
  timestamp: 0,
}

/**
 * Normalizes token symbol strings for consistent lookup (e.g. "ETH" -> "WETH", "BTC" -> "WBTC")
 */
export function normalizeTokenSymbol(symbol: string): string {
  const s = (symbol || '').toUpperCase().trim()
  if (s === 'ETH') return 'WETH'
  if (s === 'BTC') return 'WBTC'
  if (s === 'TCIRBTC' || s === 'CIRBTC') return 'CIRBTC'
  if (s === 'AFUSDC' || s === 'AF-USDC') return 'af-USDC'
  return s || 'USDC'
}

/**
 * Fetches live token prices using multi-tiered caching:
 * Tier 1: In-memory cache (<1ms)
 * Tier 2: Redis distributed cache (30s TTL)
 * Tier 3: Public CoinGecko / Binance Oracle API (2.5s timeout)
 * Tier 4: Built-in safe fallback prices
 */
export async function getLiveTokenPrices(): Promise<TokenPriceMap> {
  const now = Date.now()

  // 1. In-Memory Cache Check
  if (now - memoryCache.timestamp < CACHE_TTL_MS) {
    return memoryCache.prices
  }

  // 2. Redis Cache Check
  try {
    const cached = await redisCache.get<TokenPriceMap>(CACHE_KEY)
    if (cached && typeof cached === 'object') {
      memoryCache = {
        prices: { ...DEFAULT_TOKEN_PRICES, ...cached },
        timestamp: now,
      }
      return memoryCache.prices
    }
  } catch (err) {
    console.warn('[tokenPriceService] Redis cache lookup error:', err)
  }

  // 3. Live Price Fetch (CoinGecko Simple Price)
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2500)

    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,euro-coin,usd-coin&vs_currencies=usd',
      {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      }
    )
    clearTimeout(timeoutId)

    if (res.ok) {
      const data = await res.json()
      const ethPrice = Number(data?.ethereum?.usd) || DEFAULT_TOKEN_PRICES.WETH
      const btcPrice = Number(data?.bitcoin?.usd) || DEFAULT_TOKEN_PRICES.WBTC
      const eurcPrice = Number(data?.['euro-coin']?.usd) || DEFAULT_TOKEN_PRICES.EURC
      const usdcPrice = Number(data?.['usd-coin']?.usd) || 1.0

      const livePrices: TokenPriceMap = {
        USDC: usdcPrice,
        EURC: eurcPrice,
        WETH: ethPrice,
        ETH: ethPrice,
        WBTC: btcPrice,
        BTC: btcPrice,
        CIRBTC: btcPrice,
        'af-USDC': 1.0842,
        AFUSDC: 1.0842,
      }

      memoryCache = {
        prices: livePrices,
        timestamp: now,
      }

      // Persist to Redis asynchronously
      redisCache.set(CACHE_KEY, livePrices, CACHE_TTL_SECONDS).catch(() => {})

      return livePrices
    }
  } catch (err) {
    console.warn('[tokenPriceService] Live price fetch failed, falling back to safe cache:', err)
  }

  // 4. Return existing memory cache or default fallback
  return memoryCache.prices || DEFAULT_TOKEN_PRICES
}

/**
 * Synchronous fast getter for cached price
 */
export function getCachedTokenPrice(symbol: string): number {
  const norm = normalizeTokenSymbol(symbol)
  return memoryCache.prices[norm] ?? DEFAULT_TOKEN_PRICES[norm] ?? 1.0
}

/**
 * Calculates conversion output and exchange rate for given pair and amount
 */
export function calculateTokenConversion(
  fromToken: string,
  toToken: string,
  amount: number,
  prices: TokenPriceMap = memoryCache.prices
): { estimatedOut: number; rate: number; fromPrice: number; toPrice: number } {
  const fromNorm = normalizeTokenSymbol(fromToken)
  const toNorm = normalizeTokenSymbol(toToken)

  const fromPrice = prices[fromNorm] ?? DEFAULT_TOKEN_PRICES[fromNorm] ?? 1.0
  const toPrice = prices[toNorm] ?? DEFAULT_TOKEN_PRICES[toNorm] ?? 1.0

  const rate = toPrice > 0 ? fromPrice / toPrice : 1.0
  const estimatedOut = Number((amount * rate).toFixed(4))

  return {
    estimatedOut,
    rate: Number(rate.toFixed(6)),
    fromPrice,
    toPrice,
  }
}
