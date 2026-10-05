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
