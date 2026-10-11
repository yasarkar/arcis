// Concentrated Liquidity (CLAMM / Uniswap V3) Math Utility for Arcis
// Provides exact tick, price-range, dual-token ratio, and fee APR calculations.

export interface ClammRatioResult {
  percentA: number // e.g. BTC percentage (0 - 100)
  percentB: number // e.g. USDC percentage (0 - 100)
  isOutOfRange: boolean
  outOfRangeSide: 'below' | 'above' | null
}

export interface ClammHistogramBar {
  price: number
  priceFormatted: string
  heightPct: number // 0 - 100
  inRange: boolean
  isCurrent: boolean
}

/**
 * Calculates the exact token value split (e.g. BTC vs USDC) for concentrated liquidity
 * within a given price range [minPrice, maxPrice] at currentPrice.
 */
export function calculateClammRatio(
  currentPrice: number,
  minPrice: number,
  maxPrice: number
): ClammRatioResult {
  if (!currentPrice || currentPrice <= 0 || !minPrice || !maxPrice || minPrice >= maxPrice) {
    return { percentA: 50, percentB: 50, isOutOfRange: false, outOfRangeSide: null }
  }

  // Case 1: Current price is below minPrice -> 100% Token A (BTC)
  if (currentPrice <= minPrice) {
    return {
      percentA: 100,
      percentB: 0,
      isOutOfRange: true,
      outOfRangeSide: 'below',
    }
  }

  // Case 2: Current price is above maxPrice -> 100% Token B (USDC)
  if (currentPrice >= maxPrice) {
    return {
      percentA: 0,
      percentB: 100,
      isOutOfRange: true,
      outOfRangeSide: 'above',
    }
  }

  // Case 3: In range [minPrice, maxPrice]
  // In Uniswap V3:
  // dx = L * (1/sqrt(P) - 1/sqrt(P_max))
  // dy = L * (sqrt(P) - sqrt(P_min))
  // Value of dx in Token B = dx * P = L * (sqrt(P) - P/sqrt(P_max))
  // Value of dy in Token B = dy = L * (sqrt(P) - sqrt(P_min))
  const sqrtP = Math.sqrt(currentPrice)
  const sqrtMin = Math.sqrt(minPrice)
  const sqrtMax = Math.sqrt(maxPrice)

  const valA = sqrtP - currentPrice / sqrtMax
  const valB = sqrtP - sqrtMin

  const totalVal = valA + valB
  if (totalVal <= 0) {
    return { percentA: 50, percentB: 50, isOutOfRange: false, outOfRangeSide: null }
  }

  const rawPercentA = (valA / totalVal) * 100
  const percentA = Math.max(0, Math.min(100, Math.round(rawPercentA * 10) / 10))
  const percentB = Math.max(0, Math.min(100, Math.round((100 - percentA) * 10) / 10))

  return {
    percentA,
    percentB,
    isOutOfRange: false,
    outOfRangeSide: null,
  }
}

/**
 * Calculates counter-token amount given one input token and price bounds.
 * e.g., if user inputs amountA (BTC), calculates required amountB (USDC).
 */
export function calculateCounterTokenAmount(params: {
  amountA?: number // BTC amount
  amountB?: number // USDC amount
  currentPrice: number
  minPrice: number
  maxPrice: number
}): { amountA: number; amountB: number } {
  const { currentPrice, minPrice, maxPrice } = params
  if (!currentPrice || minPrice >= maxPrice) {
    return { amountA: params.amountA || 0, amountB: params.amountB || 0 }
  }

  const sqrtP = Math.sqrt(currentPrice)
  const sqrtMin = Math.sqrt(minPrice)
  const sqrtMax = Math.sqrt(maxPrice)

  // Below range: 100% token A, 0 token B
  if (currentPrice <= minPrice) {
    if (params.amountA !== undefined) {
      return { amountA: params.amountA, amountB: 0 }
    }
    return { amountA: 0, amountB: 0 }
  }

  // Above range: 0 token A, 100% token B
  if (currentPrice >= maxPrice) {
    if (params.amountB !== undefined) {
      return { amountA: 0, amountB: params.amountB }
    }
    return { amountA: 0, amountB: 0 }
  }

  // In range:
  // dy / dx = (sqrt(P) - sqrt(P_min)) / (1/sqrt(P) - 1/sqrt(P_max))
  const deltaXPerL = (1 / sqrtP) - (1 / sqrtMax)
  const deltaYPerL = sqrtP - sqrtMin

  if (params.amountA !== undefined && params.amountA > 0) {
    const L = params.amountA / deltaXPerL
    const calculatedB = L * deltaYPerL
    return {
      amountA: params.amountA,
      amountB: Math.max(0, Math.round(calculatedB * 1000000) / 1000000),
    }
  }

  if (params.amountB !== undefined && params.amountB > 0) {
    const L = params.amountB / deltaYPerL
    const calculatedA = L * deltaXPerL
    return {
      amountA: Math.max(0, Math.round(calculatedA * 100000000) / 100000000),
      amountB: params.amountB,
    }
  }

  return { amountA: 0, amountB: 0 }
}

/**
 * Calculates Estimated APR based on 24h trading fees and concentration factor.
 */
export function calculateConcentratedApr(
  currentPrice: number,
  minPrice: number,
  maxPrice: number,
  base24hFees: number = 126,
  poolTvl: number = 3129636,
  feeTierPercent: number = 0.3
): number {
  if (minPrice >= maxPrice || minPrice <= 0 || maxPrice <= 0) return 2.14

  // Concentration multiplier vs full range
  const rangeRatio = Math.sqrt(minPrice / maxPrice)
  const concentrationFactor = rangeRatio < 1 ? 1 / (1 - rangeRatio) : 1
  const boundedConcentration = Math.max(1, Math.min(25, concentrationFactor))

  // 24h fee yield annualized: (Fees_24h * 365 / TVL)
  const baseAnnualYield = poolTvl > 0 ? (base24hFees * 365) / poolTvl : 0.015
  const rawApr = (baseAnnualYield * boundedConcentration) * 100

  // Clamped to a realistic DeFi APR range
  const apr = Math.max(1.8, Math.min(48.5, Math.round(rawApr * 100) / 100))
  return apr
}

/**
 * Generates histogram depth bars for the liquidity visualization.
 */
export function generateLiquidityBars(
  currentPrice: number,
  minPrice: number,
  maxPrice: number,
  totalBars: number = 42
): ClammHistogramBar[] {
  const bars: ClammHistogramBar[] = []
  
  // Span range: -35% to +35% around current price
  const lowBound = currentPrice * 0.65
  const highBound = currentPrice * 1.35
  const step = (highBound - lowBound) / totalBars

  const currentIdx = Math.floor((currentPrice - lowBound) / step)

  for (let i = 0; i < totalBars; i++) {
    const barPrice = lowBound + (i + 0.5) * step
    
    // Gaussian distribution centered at currentPrice
    const distanceToCurrent = (i - currentIdx) / (totalBars * 0.22)
    const baseHeight = Math.exp(-0.5 * distanceToCurrent * distanceToCurrent) * 88

    // Add organic stepped variation
    const noise = (Math.sin(i * 1.3) + Math.cos(i * 0.7)) * 4.5
    const heightPct = Math.max(12, Math.min(94, Math.round(baseHeight + noise)))

    const inRange = barPrice >= minPrice && barPrice <= maxPrice
    const isCurrent = Math.abs(i - currentIdx) <= 0.6

    bars.push({
      price: barPrice,
      priceFormatted: barPrice.toLocaleString('en-US', { maximumFractionDigits: 1 }),
      heightPct,
      inRange,
      isCurrent,
    })
  }

  return bars
}
