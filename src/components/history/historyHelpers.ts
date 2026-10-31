import { getExplorerTxUrl, getExplorerAddressUrl } from '../../config/sendConfig'
import { getChainDisplayName } from '../../config/chainMeta'
import type { HistoryItem } from '../../utils/history'
import { normalizeTokenSymbol, type TokenPriceMap } from '../../services/tokenPriceService'

/**
 * True when a stored record is one this view can show: the active wallet's own,
 * settled transaction. Pending and failed rows are stored and returned truthfully
 * but the History tab deliberately shows completed activity only, so they must not
 * count as "this wallet has records" when deciding which empty state to render.
 */
export function isDisplayableHistoryItem(item: HistoryItem, walletAddress: string): boolean {
  if (!walletAddress) return false
  const address = walletAddress.toLowerCase().trim()
  const isSender = Boolean(item.userAddress) && item.userAddress!.toLowerCase().trim() === address
  const isRecipient = Boolean(item.recipient) && item.recipient!.toLowerCase().trim() === address
  if (!isSender && !isRecipient) return false
  return !item.status || item.status === 'success'
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export const CHAIN_DISPLAY_NAMES: Record<string, string> = {
  Arc_Testnet: 'Arc Testnet',
  Ethereum_Sepolia: 'Ethereum Sepolia',
  Base_Sepolia: 'Base Sepolia',
  Arbitrum_Sepolia: 'Arbitrum Sepolia',
  Optimism_Sepolia: 'Optimism Sepolia',
  Polygon_Amoy_Testnet: 'Polygon Amoy',
  Polygon_Amoy: 'Polygon Amoy',
  Avalanche_Fuji: 'Avalanche Fuji',
  HyperEVM_Testnet: 'HyperEVM Testnet',
  Sei_Testnet: 'Sei Testnet',
  Solana_Devnet: 'Solana Devnet',
  Sonic_Testnet: 'Sonic Testnet',
  Unichain_Sepolia: 'Unichain Sepolia',
  World_Chain_Sepolia: 'World Sepolia'
}

export const formatChain = (chainKey?: string) => {
  if (!chainKey || !chainKey.trim()) return 'Arc Testnet'
  return CHAIN_DISPLAY_NAMES[chainKey] || getChainDisplayName(chainKey) || chainKey.replace(/_/g, ' ')
}

export const formatShortChain = (chainKey?: string) => {
  if (!chainKey || !chainKey.trim()) return 'Arc'
  const full = formatChain(chainKey)
  if (full.startsWith('Arc')) return 'Arc'
  if (full.startsWith('Ethereum')) return 'Ethereum'
  if (full.startsWith('Base')) return 'Base'
  if (full.startsWith('Arbitrum')) return 'Arbitrum'
  if (full.startsWith('Polygon')) return 'Polygon'
  if (full.startsWith('Avalanche')) return 'Avalanche'
  if (full.startsWith('Solana')) return 'Solana'
  if (full.startsWith('Optimism')) return 'Optimism'
  return full.replace(/ Testnet| Sepolia| Devnet| Amoy| Fuji/gi, '').trim() || 'Arc'
}

export const formatAddress = (addr?: string) => {
  if (!addr) return '-'
  if (addr.length < 12) return addr
  return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`
}

export const getExplorerLink = (hash: string, chainKey: string) => {
  return getExplorerTxUrl(chainKey, hash)
}

export const getAddressExplorerLink = (addr?: string, chainKey?: string) => {
  return getExplorerAddressUrl(chainKey, addr)
}

export const formatUtcTime = (timestamp: number) => {
  const d = new Date(timestamp)
  const pad = (n: number) => n.toString().padStart(2, '0')
  const hours = pad(d.getUTCHours())
  const minutes = pad(d.getUTCMinutes())
  const seconds = pad(d.getUTCSeconds())
  const month = MONTH_NAMES[d.getUTCMonth()].substring(0, 3)
  const day = d.getUTCDate()
  const year = d.getUTCFullYear()
  return `${hours}:${minutes}:${seconds} ${month} ${day}, ${year}`
}

export const getRelativeTime = (timestamp: number) => {
  const diff = Date.now() - timestamp
  if (diff < 30000) return 'Just now'

  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`

  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`

  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? 's' : ''} ago`
}

export const formatDisplayDate = (isoStr: string) => {
  if (!isoStr) return ''
  const d = new Date(isoStr)
  if (isNaN(d.getTime())) return isoStr
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Raw on-chain amount a history row moved, in the row's own token units.
 *
 * Used only as a fallback when a row cannot be valued in USDC (an asset with no
 * price feed): comparisons must never mix token units, so anything user-facing
 * goes through {@link getItemUsdcValue} first.
 */
export const getItemRawAmount = (item: HistoryItem): number => {
  if (item.type === 'swap') {
    const valIn = item.amountIn ? parseFloat(item.amountIn) : 0
    const valOut = item.amountOut ? parseFloat(item.amountOut) : 0
    if (!isNaN(valIn) && valIn > 0) return valIn
    if (!isNaN(valOut) && valOut > 0) return valOut
  }
  if (item.type === 'add_liquidity' && item.amountB) {
    const a = parseFloat(item.amount || '0')
    const b = parseFloat(item.amountB || '0')
    return (isNaN(a) ? 0 : a) + (isNaN(b) ? 0 : b)
  }
  const val = parseFloat(item.amount || '0')
  return isNaN(val) ? 0 : val
}

/**
 * USDC-equivalent value of a history row at the supplied token prices.
 *
 * A swap is valued on the leg the wallet actually spent (input first, output as
 * the fallback); a dual-token liquidity deposit sums both priced legs. Returns
 * `null` when no part of the row can be priced, so callers can fall back to the
 * raw amount instead of treating an unknown asset as worth $1.
 */
export const getItemUsdcValue = (
  item: HistoryItem,
  prices: TokenPriceMap | null | undefined
): number | null => {
  const unitPrice = (symbol?: string): number | null => {
    if (!symbol || !symbol.trim()) return null
    const norm = normalizeTokenSymbol(symbol)
    // USDC is the numeraire: one USDC is one unit of the comparison value.
    if (norm === 'USDC') return 1
    const price = prices?.[norm]
    return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null
  }

  const parseAmount = (raw?: string): number | null => {
    if (raw === undefined || raw === null || raw === '') return null
    const value = parseFloat(raw)
    return Number.isFinite(value) && value >= 0 ? value : null
  }

  const legValue = (amount?: string, symbol?: string): number | null => {
    const parsed = parseAmount(amount)
    const price = unitPrice(symbol)
    if (parsed === null || price === null) return null
    return parsed * price
  }

  if (item.type === 'swap') {
    const spent = legValue(item.amountIn, item.tokenIn)
    if (spent !== null) return spent
    const received = legValue(item.amountOut, item.tokenOut)
    if (received !== null) return received
    return legValue(item.amount, item.tokenSymbol)
  }

  if (item.type === 'add_liquidity') {
    const parts = [legValue(item.amount, item.tokenSymbol), legValue(item.amountB, item.tokenB)]
      .filter((value): value is number => value !== null)
    if (parts.length === 0) return null
    return parts.reduce((sum, value) => sum + value, 0)
  }

  return legValue(item.amount, item.tokenSymbol)
}

export type PaginationWindowItem = number | 'gap'

/**
 * Page buttons to render for a paginated list: first and last page, the pages around
 * the current one, and a gap marker where pages are skipped.
 *
 * Rendering one button per page does not scale — 500 rows at 10 per page produced 50
 * buttons — so the window is capped by `maxButtons` (clamped to a minimum of 7, which is
 * what the first/last + gap structure needs). Inputs are clamped: a page outside the range
 * yields the same window as the nearest valid page, and an empty list still renders page 1.
 * The result never starts or ends with a gap and never repeats a page.
 */
export function getPaginationWindow(
  currentPage: number,
  totalPages: number,
  maxButtons = 7
): PaginationWindowItem[] {
  const total = Math.max(1, Math.floor(totalPages) || 1)
  const current = Math.min(Math.max(1, Math.floor(currentPage) || 1), total)
  const limit = Math.max(7, Math.floor(maxButtons) || 7)

  if (total <= limit) {
    return Array.from({ length: total }, (_, index) => index + 1)
  }

  // Leave room for the first page, the last page and up to two gap markers.
  const radius = Math.max(1, Math.floor((limit - 4) / 2))
  const start = Math.max(2, current - radius)
  const end = Math.min(total - 1, current + radius)

  const window: PaginationWindowItem[] = [1]
  if (start > 2) window.push('gap')
  for (let page = start; page <= end; page += 1) window.push(page)
  if (end < total - 1) window.push('gap')
  window.push(total)
  return window
}

/**
 * Exact, human-readable form of a stored amount: every significant digit is kept
 * and only insignificant trailing zeros are removed, so `12.345600` reads as
 * `12.3456` while `0.0000001234` never collapses to zero or to exponential
 * notation. Values that are not plain decimals (hex, transcripts) pass through.
 */
export const formatAmountExact = (val?: string | number): string => {
  if (val === undefined || val === null) return ''
  const raw = String(val).trim()
  if (!raw || !/^[+-]?\d+(\.\d+)?$/.test(raw)) return raw

  const negative = raw.startsWith('-')
  const unsigned = raw.replace(/^[+-]/, '')
  const [integerPart, fractionPart = ''] = unsigned.split('.')
  const trimmedFraction = fractionPart.replace(/0+$/, '')

  return `${negative ? '-' : ''}${integerPart}${trimmedFraction ? `.${trimmedFraction}` : ''}`
}

/**
 * Compact display value for a table/card amount. Precision is deliberately
 * limited for readability — `formatAmountExact` is the value shown on hover and
 * in the receipt, so no digit is lost, only hidden.
 */
export const formatAmountDisplay = (val?: string) => {
  if (!val) return '0'
  const cleanStr = val.toString().replace(/^-/, '').trim()
  const num = parseFloat(cleanStr)
  if (isNaN(num)) return cleanStr
  if (num === 0) return '0'
  if (num < 0.0001) {
    // `toFixed(6)` used to render every sub-micro amount as "0.000000". Keep up to
    // 10 decimals and trim, without switching to exponential notation.
    return num.toFixed(10).replace(/0+$/, '').replace(/\.$/, '') || '0'
  }
  if (num < 1) return parseFloat(num.toFixed(4)).toString()
  return parseFloat(num.toFixed(2)).toString()
}
