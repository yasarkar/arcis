import { formatFeeDecimals } from '../../utils/tokenUtils'
import { fetchCctpFastFeeBps, fetchCctpForwardQuote } from '../bridgeUcwService'
import type { SpeedTier } from '../../config/feeTiers'

/**
 * Direct CCTP fee fallback: Circle's Fast Transfer fee is route-specific and
 * changes over time, so quote the live fee API first and only fall back to
 * static 0.20 when the quote itself is unavailable. Standard is 0.00 (free).
 */
export async function quoteDirectCctpFee(
  speedTier: SpeedTier,
  sourceChain: string,
  destChain: string,
  amount?: string
): Promise<string> {
  if (speedTier === 'standard') return '0.00'
  try {
    const feeBps = await fetchCctpFastFeeBps(sourceChain, destChain)
    if (feeBps !== null) {
      return formatFeeDecimals((parseFloat(amount || '0') * feeBps) / 10000)
    }
  } catch {
    // Quote unavailable → keep the static fallback below.
  }
  return '0.20'
}

/**
 * UCW direct CCTP transfers are submitted through Circle's Forwarding Service:
 * displayed cost is protocol fee (Fast tier only; Standard is free) PLUS the
 * live forwarding fee that covers destination gas.
 */
export async function quoteUcwDirectBridgeFee(
  speedTier: SpeedTier,
  sourceChain: string,
  destChain: string,
  amount?: string
): Promise<string> {
  const threshold = speedTier === 'standard' ? 2000 : 1000
  try {
    const quote = await fetchCctpForwardQuote(sourceChain, destChain, threshold)
    if (quote) {
      const protocolFee = (parseFloat(amount || '0') * quote.minimumFeeBps) / 10000
      const forwardFee = Number(quote.forwardFeeSubunits) / 1_000_000
      return formatFeeDecimals(protocolFee + forwardFee)
    }
  } catch {
    // Quote unavailable → fall back to the direct estimate.
  }
  return quoteDirectCctpFee(speedTier, sourceChain, destChain, amount)
}
