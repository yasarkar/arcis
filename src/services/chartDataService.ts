// Live & Historical Chart Data Service for Arcis Swap
// Provides Kline (candlestick) & Line price series for pairs (e.g. cirBTC/USDC, ETH/USDC, EURC/USDC)
// Multi-tier: 1. Binance Public Klines (CORS-friendly, sub-100ms) -> 2. CoinGecko Market Chart -> 3. High-Fidelity Synthesizer

export interface ChartCandlePoint {
  time: number // ms timestamp
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export interface ChartDataResult {
  pair: string
  baseSymbol: string
  quoteSymbol: string
  timeframe: '1D' | '1W' | '1M'
  currentPrice: number
  priceChange24h: number
  priceChangePercent24h: number
  highPrice: number
  lowPrice: number
  points: ChartCandlePoint[]
  isLive: boolean
}

const BINANCE_PAIR_MAP: Record<string, string> = {
  BTC: 'BTCUSDT',
  WBTC: 'BTCUSDT',
  CIRBTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  WETH: 'ETHUSDT',
  EURC: 'EURUSDT',
  EUR: 'EURUSDT',
  SOL: 'SOLUSDT',
  AVAX: 'AVAXUSDT',
  POL: 'POLUSDT',
  MATIC: 'POLUSDT',
  USDC: 'USDCUSDT',
}

const COINGECKO_ID_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  WBTC: 'bitcoin',
  CIRBTC: 'bitcoin',
  ETH: 'ethereum',
  WETH: 'ethereum',
  EURC: 'euro-coin',
  EUR: 'euro-coin',
  SOL: 'solana',
  AVAX: 'avalanche-2',
  POL: 'polygon-ecosystem-token',
  MATIC: 'polygon-ecosystem-token',
  USDC: 'usd-coin',
}

// In-memory cache to prevent spamming
const chartMemoryCache = new Map<string, { data: ChartDataResult; timestamp: number }>()
const CACHE_TTL_MS = 30_000 // 30s cache

/**
 * Normalizes input token symbol for chart lookup
 */
export function normalizeChartSymbol(symbol: string): string {
  const s = (symbol || '').toUpperCase().trim()
  if (s === 'WETH') return 'ETH'
  if (s === 'CIRBTC' || s === 'WBTC') return 'BTC'
  if (s === 'MATIC') return 'POL'
  return s
}

/**
 * Determines primary base and quote token for the chart.
 * Defaults to the swap transaction's source coin (tokenIn), or uses focusToken if toggled.
 */
export function resolveChartPair(
  tokenIn: string,
  tokenOut: string,
  focusToken?: string
): { base: string; quote: string; isReversed: boolean } {
  const normIn = normalizeChartSymbol(tokenIn)
  const normOut = normalizeChartSymbol(tokenOut)

  const activeFocus = focusToken ? normalizeChartSymbol(focusToken) : normIn

  if (activeFocus === normOut) {
    return { base: normOut, quote: normIn, isReversed: true }
  }

  // Default: source coin (tokenIn) is the base asset for the chart
  return { base: normIn, quote: normOut, isReversed: false }
}

/**
 * Fetches chart data from Binance public API
 */
async function fetchBinanceKlines(
  baseSymbol: string,
  timeframe: '1D' | '1W' | '1M'
): Promise<ChartCandlePoint[] | null> {
  const binanceSymbol = BINANCE_PAIR_MAP[baseSymbol]
  if (!binanceSymbol) return null

  let interval = '1h'
  let limit = 24
  if (timeframe === '1W') {
    interval = '4h'
    limit = 42
  } else if (timeframe === '1M') {
    interval = '1d'
    limit = 30
  }

  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 3500)

  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) return null

    const raw = await res.json()
    if (!Array.isArray(raw) || raw.length === 0) return null

    const points: ChartCandlePoint[] = raw.map((item) => ({
      time: Number(item[0]),
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      volume: parseFloat(item[5]),
    }))

    return points
  } catch {
    clearTimeout(timeoutId)
    return null
  }
}

/**
 * Fetches historical price points from CoinGecko public API
 */
async function fetchCoinGeckoChart(
  baseSymbol: string,
  timeframe: '1D' | '1W' | '1M'
): Promise<ChartCandlePoint[] | null> {
  const coinId = COINGECKO_ID_MAP[baseSymbol]
  if (!coinId) return null

  let days = '1'
  if (timeframe === '1W') days = '7'
  if (timeframe === '1M') days = '30'

  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 4000)

  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)
    if (!res.ok) return null

    const data = await res.json()
    const prices: [number, number][] = data?.prices
    if (!Array.isArray(prices) || prices.length === 0) return null

    // Group into candle intervals
    const targetChunks = timeframe === '1D' ? 24 : timeframe === '1W' ? 42 : 30
    const chunkSize = Math.max(1, Math.floor(prices.length / targetChunks))
    const points: ChartCandlePoint[] = []

    for (let i = 0; i < prices.length; i += chunkSize) {
      const slice = prices.slice(i, i + chunkSize)
      if (slice.length === 0) continue

      const time = slice[0][0]
      const open = slice[0][1]
      const close = slice[slice.length - 1][1]
      let high = -Infinity
      let low = Infinity
      slice.forEach(([_, p]) => {
        if (p > high) high = p
        if (p < low) low = p
      })

      points.push({ time, open, high, low, close })
    }

    return points
  } catch {
    clearTimeout(timeoutId)
    return null
  }
}

/**
 * Synthesizes high-fidelity continuous candlestick and line data when offline or network fails
 */
function generateSyntheticChartData(
  baseSymbol: string,
  quoteSymbol: string,
  timeframe: '1D' | '1W' | '1M',
  anchorPrice?: number
): ChartDataResult {
  const defaultBasePrices: Record<string, number> = {
    BTC: 82713.5,
    ETH: 2540.2,
    EURC: 1.0845,
    SOL: 142.3,
    AVAX: 26.8,
    POL: 0.395,
    USDC: 1.0,
  }

  const currentPrice = anchorPrice && anchorPrice > 0 ? anchorPrice : defaultBasePrices[baseSymbol] || 100.0

  let count = 28
  let stepMs = 3600 * 1000 // 1h
  if (timeframe === '1W') {
    count = 42
    stepMs = 4 * 3600 * 1000
  } else if (timeframe === '1M') {
    count = 30
    stepMs = 24 * 3600 * 1000
  }

  const now = Date.now()
  const startTime = now - count * stepMs
  const points: ChartCandlePoint[] = []

  // Deterministic seed based on symbol & day
  let seed = baseSymbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 42) + Math.floor(now / 86400000)
  const pseudoRandom = () => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }

  // Work backwards from currentPrice
  const volatility = baseSymbol === 'EURC' || baseSymbol === 'USDC' ? 0.002 : 0.012
  const trajectory: number[] = [currentPrice]

  for (let i = 1; i < count; i++) {
    const prev = trajectory[trajectory.length - 1]
    const delta = (pseudoRandom() - 0.485) * volatility * prev
    trajectory.push(Math.max(0.0001, prev - delta))
  }
  trajectory.reverse()

  let minPrice = Infinity
  let maxPrice = -Infinity

  for (let i = 0; i < count; i++) {
    const time = startTime + i * stepMs
    const open = trajectory[i]
    const nextVal = i < count - 1 ? trajectory[i + 1] : currentPrice
    const close = nextVal
    const spread = Math.abs(open - close) + open * (volatility * 0.4)
    const high = Math.max(open, close) + pseudoRandom() * spread
    const low = Math.min(open, close) - pseudoRandom() * spread

    if (high > maxPrice) maxPrice = high
    if (low < minPrice) minPrice = low

    points.push({
      time,
      open: Number(open.toFixed(baseSymbol === 'EURC' ? 4 : 2)),
      high: Number(high.toFixed(baseSymbol === 'EURC' ? 4 : 2)),
      low: Number(low.toFixed(baseSymbol === 'EURC' ? 4 : 2)),
      close: Number(close.toFixed(baseSymbol === 'EURC' ? 4 : 2)),
    })
  }

  const firstOpen = points[0].open
  const lastClose = points[points.length - 1].close
  const priceChange24h = lastClose - firstOpen
  const priceChangePercent24h = (priceChange24h / firstOpen) * 100

  return {
    pair: `${baseSymbol}/${quoteSymbol}`,
    baseSymbol,
    quoteSymbol,
    timeframe,
    currentPrice: lastClose,
    priceChange24h,
    priceChangePercent24h,
    highPrice: maxPrice,
    lowPrice: minPrice,
    points,
    isLive: false,
  }
}

/**
 * Main public getter for chart data: checks cache, fetches Binance / CoinGecko, falls back to safe generator
 */
export async function getPairChartData(
  tokenIn: string,
  tokenOut: string,
  timeframe: '1D' | '1W' | '1M' = '1D',
  liveAnchorPrice?: number,
  focusToken?: string
): Promise<ChartDataResult> {
  const { base, quote } = resolveChartPair(tokenIn, tokenOut, focusToken)
  const cacheKey = `${base}:${quote}:${timeframe}`
  const now = Date.now()

  const cached = chartMemoryCache.get(cacheKey)
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data
  }

  // 1. Try Binance
  let points = await fetchBinanceKlines(base, timeframe)

  // 2. Fallback to CoinGecko
  if (!points || points.length === 0) {
    points = await fetchCoinGeckoChart(base, timeframe)
  }

  if (points && points.length > 0) {
    const firstOpen = points[0].open
    const lastPoint = points[points.length - 1]
    const currentPrice = lastPoint.close

    let highPrice = -Infinity
    let lowPrice = Infinity
    points.forEach((p) => {
      highPrice = Math.max(highPrice, p.high, p.close, p.open)
      lowPrice = Math.min(lowPrice, p.low, p.close, p.open)
    })

    const priceChange24h = currentPrice - firstOpen
    const priceChangePercent24h = (priceChange24h / (firstOpen || 1)) * 100

    const result: ChartDataResult = {
      pair: `${base}/${quote}`,
      baseSymbol: base,
      quoteSymbol: quote,
      timeframe,
      currentPrice,
      priceChange24h,
      priceChangePercent24h,
      highPrice,
      lowPrice,
      points,
      isLive: true,
    }

    chartMemoryCache.set(cacheKey, { data: result, timestamp: now })
    return result
  }

  // 3. Fallback to high-fidelity synthesized generator
  const synthetic = generateSyntheticChartData(base, quote, timeframe, liveAnchorPrice)
  chartMemoryCache.set(cacheKey, { data: synthetic, timestamp: now })
  return synthetic
}
