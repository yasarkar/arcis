// src/utils/formatNumber.ts
// Locale-aware display formatting shared by the Unified Balance surface.

/**
 * Formats a USDC amount for display: grouped thousands with exactly two decimals,
 * e.g. 1234.5 → "1,234.50". Matches the 'en-US' convention used across the app.
 */
export function formatUsdcAmount(value: number | string): string {
  const numeric = typeof value === 'string' ? Number.parseFloat(value) : value
  if (!Number.isFinite(numeric)) return '0.00'
  return numeric.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Formats a 0–100 percentage value with a single decimal, e.g. 12.34 → "12.3%". */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0.0%'
  return `${value.toFixed(1)}%`
}

const SUBSCRIPT_DIGITS: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
}

/**
 * Converts a non-negative integer to its Unicode subscript string representation.
 * e.g., 6 -> "₆", 12 -> "₁₂"
 */
export function toSubscriptDigits(num: number): string {
  return Math.abs(Math.floor(num))
    .toString()
    .split('')
    .map((d) => SUBSCRIPT_DIGITS[d] || d)
    .join('')
}

/**
 * Normalizes exponential floating-point numbers (e.g. 3.5e-7) to a standard decimal string.
 */
function toPlainDecimalString(num: number): string {
  const str = num.toString()
  if (!str.includes('e') && !str.includes('E')) return str

  const [lead, exp] = str.toLowerCase().split('e')
  const exponent = parseInt(exp, 10)
  if (exponent < 0) {
    const isNegative = lead.startsWith('-')
    const cleanLead = isNegative ? lead.slice(1) : lead
    const [intPart, decPart = ''] = cleanLead.split('.')
    const zeros = Math.abs(exponent) - 1
    const digits = intPart + decPart
    return `${isNegative ? '-' : ''}0.${'0'.repeat(zeros)}${digits}`
  }
  return num.toFixed(Math.min(20, Math.max(0, exponent)))
}

export interface SubscriptZeroOptions {
  /** Minimum consecutive zeros right after decimal point to trigger subscript notation (default: 3). */
  minLeadingZeros?: number
  /** Maximum significant digits to retain after the zeros (default: 6). */
  maxSignificantDigits?: number
}

/**
 * Formats tiny cryptocurrency amounts with repeated decimal zeros into subscript notation.
 * e.g. 0.00000035 -> "0.0₆35"
 *      0.000042   -> "0.0₄42"
 *      0.0001     -> "0.0₃1"
 *      0.05       -> "0.05"
 *      1.25       -> "1.25"
 */
export function formatSubscriptZero(
  value: number | string | undefined | null,
  options: SubscriptZeroOptions = {}
): string {
  if (value == null || value === '') return '—'
  const numeric = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : value
  if (!Number.isFinite(numeric)) return String(value)
  if (numeric === 0) return '0'

  const { minLeadingZeros = 3, maxSignificantDigits = 6 } = options

  // Numbers >= 1 or <= -1 do not have leading decimal zeros
  if (Math.abs(numeric) >= 1) {
    return typeof value === 'string' && !value.toLowerCase().includes('e')
      ? value
      : numeric.toString()
  }

  const plainStr = toPlainDecimalString(numeric)
  const isNegative = plainStr.startsWith('-')
  const positiveStr = isNegative ? plainStr.slice(1) : plainStr

  // Match 0.0000... followed by significant digits
  const match = positiveStr.match(/^0\.(0+)([1-9]\d*)$/)
  if (!match) {
    return plainStr
  }

  const zeroCount = match[1].length
  const rawSignificant = match[2]
  const significant = rawSignificant.slice(0, maxSignificantDigits).replace(/0+$/, '')

  if (zeroCount >= minLeadingZeros && significant.length > 0) {
    const subscript = toSubscriptDigits(zeroCount)
    return `${isNegative ? '-' : ''}0.0${subscript}${significant}`
  }

  return plainStr
}

/** Alias for formatSubscriptZero */
export const formatCompactCryptoAmount = formatSubscriptZero

