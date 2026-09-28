// Multi-Tier Dynamic Token Price Oracle & Cache for Arcis and Ask Arcis Copilot
// 1. In-Memory Micro Cache (0ms) -> 2. Redis Cache (30s TTL) -> 3. Live Oracle/DEX API -> 4. Safe Static Fallback
import { redisCache } from './redisCacheService'

export interface TokenPriceMap {
  [symbol: string]: number
}

export const DEFAULT_TOKEN_PRICES: TokenPriceMap = {
  USDC: 1.0,
  EURC: 1.08,
  WETH: 2500.0,
  ETH: 2500.0,
  WBTC: 78500.0,
  BTC: 78500.0,
  CIRBTC: 78500.0,
  POL: 0.40,
  MATIC: 0.40,
  AVAX: 26.50,
  SOL: 145.0,
  SEI: 0.35,
  S: 0.65,
  'af-USDC': 1.0842,
  AFUSDC: 1.0842,
  USYC: 1.05,
}

const CACHE_KEY = 'arcis:token_prices:v1'
const CACHE_TTL_SECONDS = 30
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000

let memoryCache: { prices: TokenPriceMap; timestamp: number } = {
  prices: { ...DEFAULT_TOKEN_PRICES },
  timestamp: 0,
}

let hasVerifiedLivePrices = false

/**
 * Returns true if prices were successfully verified from live oracles (CoinGecko/Binance/Redis)
 */
export function isLivePriceAvailable(): boolean {
  return hasVerifiedLivePrices
}

/**
 * Normalizes token symbol strings for consistent lookup (e.g. "ETH" -> "WETH", "BTC" -> "WBTC")
 */
export function normalizeTokenSymbol(symbol: string): string {
  const s = (symbol || '').toUpperCase().trim()
  if (s === 'ETH') return 'WETH'
  if (s === 'MATIC') return 'POL'
  if (s === 'BTC' || s === 'CIRBTC') return 'CIRBTC'
  if (s === 'AFUSDC' || s === 'AF-USDC') return 'af-USDC'
  return s || 'USDC'
}

/**
 * Fetches live token prices using multi-tiered caching:
 * Tier 1: In-memory cache (<1ms)
 * Tier 2: Redis distributed cache (30s TTL)
 * Tier 3: Public CoinGecko Simple Price API (with Binance fallback)
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
      hasVerifiedLivePrices = true
      memoryCache = {
        prices: { ...DEFAULT_TOKEN_PRICES, ...cached },
        timestamp: now,
      }
      return memoryCache.prices
    }
  } catch (err) {
    console.warn('[tokenPriceService] Redis cache lookup error:', err)
  }

  // 3. Live Price Fetch (CoinGecko Simple Price with Binance fallback)
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2500)

    let ethPrice = DEFAULT_TOKEN_PRICES.WETH
    let btcPrice = DEFAULT_TOKEN_PRICES.WBTC
    let eurcPrice = DEFAULT_TOKEN_PRICES.EURC
    let usdcPrice = 1.0
    let usycPrice = DEFAULT_TOKEN_PRICES.USYC || 1.05
    let polPrice = DEFAULT_TOKEN_PRICES.POL || 0.15
    let avaxPrice = DEFAULT_TOKEN_PRICES.AVAX || 11.5
    let solPrice = DEFAULT_TOKEN_PRICES.SOL || 125.0
    let seiPrice = DEFAULT_TOKEN_PRICES.SEI || 0.08
    let sonicPrice = DEFAULT_TOKEN_PRICES.S || 0.05
    let fetchSuccess = false

    const coingeckoUrl =
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,euro-coin,usd-coin,polygon-ecosystem-token,avalanche-2,solana,sei-network,sonic-3,hashnote-usyc&vs_currencies=usd'

    try {
      console.log('[LivePriceOracle] 🌐 Outgoing Live Price Request (CoinGecko):', {
        url: coingeckoUrl,
        method: 'GET',
        timestamp: new Date().toISOString(),
      })

      const res = await fetch(coingeckoUrl, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })

      if (res.ok) {
        const data = await res.json()
        console.log('[LivePriceOracle] 📥 Incoming Live Price Response (CoinGecko):', {
          status: res.status,
          data,
        })
        ethPrice = Number(data?.ethereum?.usd) || ethPrice
        btcPrice = Number(data?.bitcoin?.usd) || btcPrice
        eurcPrice = Number(data?.['euro-coin']?.usd) || eurcPrice
        usdcPrice = Number(data?.['usd-coin']?.usd) || 1.0
        usycPrice = Number(data?.['hashnote-usyc']?.usd) || usycPrice
        polPrice = Number(data?.['polygon-ecosystem-token']?.usd) || polPrice
        avaxPrice = Number(data?.['avalanche-2']?.usd) || avaxPrice
        solPrice = Number(data?.solana?.usd) || solPrice
        seiPrice = Number(data?.['sei-network']?.usd) || seiPrice
        sonicPrice = Number(data?.['sonic-3']?.usd) || sonicPrice
        fetchSuccess = true
      } else {
        console.warn('[LivePriceOracle] ⚠️ CoinGecko returned non-OK status:', res.status)
      }
    } catch (cgErr) {
      console.warn('[LivePriceOracle] ⚠️ CoinGecko request failed or timed out:', cgErr)
    }

    // Secondary fallback: Binance Public Ticker if CoinGecko was throttled or unreachable
    if (!fetchSuccess) {
      try {
        console.log('[LivePriceOracle] 🌐 Outgoing Fallback Request (Binance Ticker):', {
          symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT'],
          timestamp: new Date().toISOString(),
        })
        const [binanceBtc, binanceEth, binanceSol, binanceAvax] = await Promise.all([
          fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT', { signal: controller.signal }).then((r) => r.json()).catch(() => null),
          fetch('https://api.binance.com/api/v3/ticker/price?symbol=ETHUSDT', { signal: controller.signal }).then((r) => r.json()).catch(() => null),
          fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT', { signal: controller.signal }).then((r) => r.json()).catch(() => null),
          fetch('https://api.binance.com/api/v3/ticker/price?symbol=AVAXUSDT', { signal: controller.signal }).then((r) => r.json()).catch(() => null),
        ])
        console.log('[LivePriceOracle] 📥 Incoming Fallback Response (Binance):', {
          BTCUSDT: binanceBtc,
          ETHUSDT: binanceEth,
          SOLUSDT: binanceSol,
          AVAXUSDT: binanceAvax,
        })
        if (binanceBtc?.price) {
          btcPrice = Number(binanceBtc.price) || btcPrice
          fetchSuccess = true
        }
        if (binanceEth?.price) {
          ethPrice = Number(binanceEth.price) || ethPrice
          fetchSuccess = true
        }
        if (binanceSol?.price) {
          solPrice = Number(binanceSol.price) || solPrice
          fetchSuccess = true
        }
        if (binanceAvax?.price) {
          avaxPrice = Number(binanceAvax.price) || avaxPrice
          fetchSuccess = true
        }
      } catch (binanceErr) {
        console.warn('[LivePriceOracle] ⚠️ Binance fallback request failed:', binanceErr)
      }
    }

    clearTimeout(timeoutId)

    if (fetchSuccess) {
      hasVerifiedLivePrices = true
      const livePrices: TokenPriceMap = {
        ...DEFAULT_TOKEN_PRICES,
        USDC: usdcPrice,
        EURC: eurcPrice,
        WETH: ethPrice,
        ETH: ethPrice,
        WBTC: btcPrice,
        BTC: btcPrice,
        CIRBTC: btcPrice,
        USYC: usycPrice,
        POL: polPrice,
        MATIC: polPrice,
        AVAX: avaxPrice,
        SOL: solPrice,
        SEI: seiPrice,
        S: sonicPrice,
      }

      console.log('[LivePriceOracle] ✅ Successfully resolved live token prices:', livePrices)

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
