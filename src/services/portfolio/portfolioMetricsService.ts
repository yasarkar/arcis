import { EURC_ADDRESSES, CIRBTC_ADDRESSES, WETH_ADDRESSES } from '../../config/gatewayConfig'
import { getChainDisplayName } from '../../config/chainMeta'
import type { WalletChainBalance } from '../../hooks/useWalletTestnetBalances'

// Ordered list of priority testnet networks for optimal UX
export const ORDERED_CHAIN_KEYS = [
  'Arc_Testnet',
  'Base_Sepolia',
  'Ethereum_Sepolia',
  'Arbitrum_Sepolia',
  'Optimism_Sepolia',
  'Polygon_Amoy_Testnet',
  'Avalanche_Fuji',
  'Sei_Testnet',
  'Sonic_Testnet',
  'Unichain_Sepolia',
  'World_Chain_Sepolia',
]

export interface PortfolioStats {
  totalUsdc: number
  totalEurc: number
  totalCirbtc: number
  totalWeth: number
  totalNativeUsd: number
  nativeAmounts: Record<string, { amount: number; networkCount: number }>
  totalUsd: number
  chainsWithBalance: number
}

export interface AggregatedAsset {
  key: string
  symbol: string
  name: string
  amount: number
  formattedAmount: string
  usdValue: number
  price: number
  isNative: boolean
  percentage: number
}

export type ChainBalanceItem = Partial<WalletChainBalance>

// Helper to look up live or safe fallback price for a chain's native gas currency
export function getNativeGasPrice(symbol?: string, prices?: Record<string, number> | null): number {
  const s = (symbol || '').toUpperCase().trim()
  if (s === 'ETH') return prices?.WETH || prices?.ETH || 2500
  if (s === 'POL' || s === 'MATIC') return prices?.POL || prices?.MATIC || 0.40
  if (s === 'AVAX') return prices?.AVAX || 26.50
  if (s === 'SOL') return prices?.SOL || 145.0
  if (s === 'SEI') return prices?.SEI || 0.35
  if (s === 'S') return prices?.S || 0.65
  if (s === 'USDC') return 1.0
  return prices?.[s] || 0
}

/**
 * Calculates aggregated multi-chain portfolio metrics across all supported networks
 */
export function calculatePortfolioStats(
  walletBalances: Record<string, ChainBalanceItem>,
  prices?: Record<string, number> | null
): PortfolioStats {
  let totalUsdc = 0
  let totalEurc = 0
  let totalCirbtc = 0
  let totalWeth = 0
  let totalNativeUsd = 0
  let chainsWithBalance = 0
  const nativeAmounts: Record<string, { amount: number; networkCount: number }> = {}

  ORDERED_CHAIN_KEYS.forEach((chainKey) => {
    const item = walletBalances[chainKey] || walletBalances[chainKey.replace('_Testnet', '')]
    if (!item) return

    const isArc = chainKey === 'Arc_Testnet' || chainKey === 'Arc'
    const usdcVal = parseFloat(item.usdc || '0')
    const eurcVal = item.eurc ? parseFloat(item.eurc) : 0
    const cirbtcVal = item.cirbtc ? parseFloat(item.cirbtc) : 0
    const wethVal = item.weth ? parseFloat(item.weth) : 0
    const nativeVal = !isArc && item.nativeAmount ? parseFloat(item.nativeAmount) : 0

    if (!isNaN(usdcVal)) totalUsdc += usdcVal
    if (!isNaN(eurcVal)) totalEurc += eurcVal
    if (!isNaN(cirbtcVal)) totalCirbtc += cirbtcVal
    if (!isNaN(wethVal)) totalWeth += wethVal
    if (!isNaN(nativeVal) && nativeVal > 0) {
      const sym = (item.nativeSymbol || 'ETH').toUpperCase()
      if (!nativeAmounts[sym]) {
        nativeAmounts[sym] = { amount: 0, networkCount: 0 }
      }
      nativeAmounts[sym].amount += nativeVal
      nativeAmounts[sym].networkCount++
      totalNativeUsd += nativeVal * getNativeGasPrice(item.nativeSymbol, prices)
    }

    if (usdcVal > 0 || eurcVal > 0 || cirbtcVal > 0 || wethVal > 0 || nativeVal > 0) {
      chainsWithBalance++
    }
  })

  // Approximate total USD valuation
  const eurcPrice = prices?.EURC || 1.08
  const btcPrice = prices?.cirBTC || prices?.BTC || 85000
  const wethPrice = prices?.WETH || prices?.ETH || 2500
  const totalUsd =
    totalUsdc * 1.0 +
    totalEurc * eurcPrice +
    totalCirbtc * btcPrice +
    totalWeth * wethPrice +
    totalNativeUsd

  return {
    totalUsdc,
    totalEurc,
    totalCirbtc,
    totalWeth,
    totalNativeUsd,
    nativeAmounts,
    totalUsd,
    chainsWithBalance,
  }
}

/**
 * Computes asset allocations across tokens and native currencies, sorted by USD value descending
 */
export function calculateAggregatedAssets(
  portfolioStats: PortfolioStats,
  prices?: Record<string, number> | null
): AggregatedAsset[] {
  const eurcPrice = prices?.EURC || 1.08
  const btcPrice = prices?.cirBTC || prices?.BTC || 85000
  const wethPrice = prices?.WETH || prices?.ETH || 2500

  const totalUsd = portfolioStats.totalUsd
  const nativeAmounts = portfolioStats.nativeAmounts

  // Define all known ecosystem tokens that exist across dropdown lists
  const assets: Omit<AggregatedAsset, 'percentage'>[] = [
    {
      key: 'USDC',
      symbol: 'USDC',
      name: 'USD Coin',
      amount: portfolioStats.totalUsdc,
      formattedAmount: `${portfolioStats.totalUsdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`,
      usdValue: portfolioStats.totalUsdc * 1.0,
      price: 1.0,
      isNative: false,
    },
    {
      key: 'EURC',
      symbol: 'EURC',
      name: 'Euro Coin',
      amount: portfolioStats.totalEurc,
      formattedAmount: `${portfolioStats.totalEurc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EURC`,
      usdValue: portfolioStats.totalEurc * eurcPrice,
      price: eurcPrice,
      isNative: false,
    },
    {
      key: 'ETH',
      symbol: 'ETH',
      name: 'Ethereum',
      amount: nativeAmounts['ETH']?.amount || 0,
      formattedAmount: `${(nativeAmounts['ETH']?.amount || 0).toFixed(4)} ETH`,
      usdValue: (nativeAmounts['ETH']?.amount || 0) * (prices?.WETH || prices?.ETH || 2500),
      price: prices?.WETH || prices?.ETH || 2500,
      isNative: true,
    },
    {
      key: 'cirBTC',
      symbol: 'cirBTC',
      name: 'Circle Bitcoin',
      amount: portfolioStats.totalCirbtc,
      formattedAmount: `${portfolioStats.totalCirbtc.toFixed(5)} cirBTC`,
      usdValue: portfolioStats.totalCirbtc * btcPrice,
      price: btcPrice,
      isNative: false,
    },
    {
      key: 'WETH',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      amount: portfolioStats.totalWeth,
      formattedAmount: `${portfolioStats.totalWeth.toFixed(4)} WETH`,
      usdValue: portfolioStats.totalWeth * wethPrice,
      price: wethPrice,
      isNative: false,
    },
    {
      key: 'POL',
      symbol: 'POL',
      name: 'Polygon',
      amount: nativeAmounts['POL']?.amount || 0,
      formattedAmount: `${(nativeAmounts['POL']?.amount || 0).toFixed(4)} POL`,
      usdValue: (nativeAmounts['POL']?.amount || 0) * getNativeGasPrice('POL', prices),
      price: getNativeGasPrice('POL', prices),
      isNative: true,
    },
    {
      key: 'AVAX',
      symbol: 'AVAX',
      name: 'Avalanche',
      amount: nativeAmounts['AVAX']?.amount || 0,
      formattedAmount: `${(nativeAmounts['AVAX']?.amount || 0).toFixed(4)} AVAX`,
      usdValue: (nativeAmounts['AVAX']?.amount || 0) * getNativeGasPrice('AVAX', prices),
      price: getNativeGasPrice('AVAX', prices),
      isNative: true,
    },
    {
      key: 'SEI',
      symbol: 'SEI',
      name: 'Sei Network',
      amount: nativeAmounts['SEI']?.amount || 0,
      formattedAmount: `${(nativeAmounts['SEI']?.amount || 0).toFixed(4)} SEI`,
      usdValue: (nativeAmounts['SEI']?.amount || 0) * getNativeGasPrice('SEI', prices),
      price: getNativeGasPrice('SEI', prices),
      isNative: true,
    },
    {
      key: 'S',
      symbol: 'S',
      name: 'Sonic',
      amount: nativeAmounts['S']?.amount || 0,
      formattedAmount: `${(nativeAmounts['S']?.amount || 0).toFixed(4)} S`,
      usdValue: (nativeAmounts['S']?.amount || 0) * getNativeGasPrice('S', prices),
      price: getNativeGasPrice('S', prices),
      isNative: true,
    },
  ]

  // Catch any other native token if present in walletBalances
  Object.entries(nativeAmounts).forEach(([sym, data]) => {
    if (!['ETH', 'POL', 'AVAX', 'SEI', 'S'].includes(sym)) {
      const p = getNativeGasPrice(sym, prices)
      assets.push({
        key: sym,
        symbol: sym,
        name: sym,
        amount: data.amount,
        formattedAmount: `${data.amount.toFixed(4)} ${sym}`,
        usdValue: data.amount * p,
        price: p,
        isNative: true,
      })
    }
  })

  // Compute percentage allocations and sort
  const withPercentages = assets.map((a) => ({
    ...a,
    percentage: totalUsd > 0 ? (a.usdValue / totalUsd) * 100 : 0,
  }))

  // Priority order for secondary tie-break
  const priority = ['USDC', 'EURC', 'ETH', 'cirBTC', 'WETH', 'POL', 'AVAX', 'SEI', 'S']
  return withPercentages.sort((a, b) => {
    if (Math.abs(b.usdValue - a.usdValue) > 0.001) {
      return b.usdValue - a.usdValue
    }
    if (Math.abs(b.amount - a.amount) > 0.00001) {
      return b.amount - a.amount
    }
    const idxA = priority.indexOf(a.symbol)
    const idxB = priority.indexOf(b.symbol)
    return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99)
  })
}

/**
 * Computes a single chain's total USD valuation across all supported tokens (USDC, EURC, cirBTC, WETH, Native Gas)
 */
export function getChainTotalUsd(
  chainKey: string,
  walletBalances: Record<string, ChainBalanceItem>,
  prices?: Record<string, number> | null
): number {
  const item = walletBalances[chainKey] || walletBalances[chainKey.replace('_Testnet', '')]
  if (!item) return 0
  const usdcVal = parseFloat(item.usdc || '0')
  const eurcVal = item.eurc ? parseFloat(item.eurc) : 0
  const cirbtcVal = item.cirbtc ? parseFloat(item.cirbtc) : 0
  const wethVal = item.weth ? parseFloat(item.weth) : 0
  const eurcPrice = prices?.EURC || 1.08
  const btcPrice = prices?.cirBTC || prices?.BTC || 85000
  const wethPrice = prices?.WETH || prices?.ETH || 2500

  const safeUsdc = isNaN(usdcVal) ? 0 : usdcVal
  const safeEurc = isNaN(eurcVal) ? 0 : eurcVal
  const safeBtc = isNaN(cirbtcVal) ? 0 : cirbtcVal
  const safeWeth = isNaN(wethVal) ? 0 : wethVal

  // Native gas valuation for non-Arc chains (on Arc, native is USDC - no double count)
  const isArc = chainKey === 'Arc_Testnet' || chainKey === 'Arc'
  let nativeUsd = 0
  if (!isArc && item.nativeAmount) {
    const nativeVal = parseFloat(item.nativeAmount)
    if (!isNaN(nativeVal) && nativeVal > 0) {
      nativeUsd = nativeVal * getNativeGasPrice(item.nativeSymbol, prices)
    }
  }

  return safeUsdc * 1.0 + safeEurc * eurcPrice + safeBtc * btcPrice + safeWeth * wethPrice + nativeUsd
}

/**
 * Filters and sorts chains by search query, positive balances, and total USD valuation
 */
export function filterAndSortChains({
  chainKeys = ORDERED_CHAIN_KEYS,
  walletBalances,
  searchQuery,
  onlyNonZero,
  prices,
}: {
  chainKeys?: string[]
  walletBalances: Record<string, ChainBalanceItem>
  searchQuery: string
  onlyNonZero: boolean
  prices?: Record<string, number> | null
}): string[] {
  const filtered = chainKeys.filter((chainKey) => {
    if (chainKey === 'Arc') return false
    const item = walletBalances[chainKey] || walletBalances[chainKey.replace('_Testnet', '')]
    const name = item?.chainName || getChainDisplayName(chainKey)
    const matchesSearch =
      !searchQuery.trim() ||
      name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      chainKey.toLowerCase().includes(searchQuery.toLowerCase())

    if (!matchesSearch) return false

    if (onlyNonZero) {
      const isArc = chainKey === 'Arc_Testnet' || chainKey === 'Arc'
      const usdcVal = parseFloat(item?.usdc || '0')
      const eurcVal = item?.eurc ? parseFloat(item.eurc) : 0
      const cirbtcVal = item?.cirbtc ? parseFloat(item.cirbtc) : 0
      const wethVal = item?.weth ? parseFloat(item.weth) : 0
      const nativeVal = !isArc && item?.nativeAmount ? parseFloat(item.nativeAmount) : 0
      return usdcVal > 0 || eurcVal > 0 || cirbtcVal > 0 || wethVal > 0 || nativeVal > 0
    }

    return true
  })

  return [...filtered].sort((a, b) => {
    const totalA = getChainTotalUsd(a, walletBalances, prices)
    const totalB = getChainTotalUsd(b, walletBalances, prices)

    // 1. Sort by total chain valuation descending (en yüksek bakiye en üstte)
    if (Math.abs(totalB - totalA) > 0.000001) {
      return totalB - totalA
    }

    // 2. Secondary sort: USDC balance descending
    const usdcA = parseFloat(walletBalances[a]?.usdc || '0') || 0
    const usdcB = parseFloat(walletBalances[b]?.usdc || '0') || 0
    if (Math.abs(usdcB - usdcA) > 0.000001) {
      return usdcB - usdcA
    }

    // 3. Fallback to default priority order
    return chainKeys.indexOf(a) - chainKeys.indexOf(b)
  })
}
