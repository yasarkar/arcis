// src/services/x402/gatewayRouteScout.ts
// Gateway vs CCTP route scout for the priced AI service `arc-gateway-fee-route-scout`.
//
// Both numbers in the comparison come from a source that actually knows them:
//   - Gateway: Circle charges a 0.005% transfer fee, which `gatewayService` already applies
//     when it builds the signed burn-intent `maxFee` (5 bps of the amount).
//   - CCTP: Circle's Iris fee endpoint is the only source of the route's protocol fee and
//     forwarding fee; it is quoted live and never replaced by a hard-coded rate.
// No rail is quoted when its source fails: the field is null and the reason is listed.

import { GATEWAY_DOMAINS } from '../../config/gatewayConfig'
import { IS_TESTNET } from '../../config/arcChain'
import {
  ROUTE_SCOUT_DESTINATIONS,
  type RouteScoutDestination,
} from '../../config/x402/routeScoutChains'
import { fetchCctpForwardQuote } from '../bridgeUcwService'
import { estimateArcGasCostUsdc } from '../arcGasService'

export { ROUTE_SCOUT_DESTINATIONS }
export type { RouteScoutDestination }
export type RouteScoutUrgency = 'standard' | 'fast'
export type RouteScoutRail = 'gateway' | 'cctp'

/**
 * Circle Gateway's cross-chain transfer fee: 0.005% of the transferred amount (0.5 bps).
 * `gatewayService.transferFromGateway` encodes exactly this rate into the burn-intent
 * `maxFee` (`amount * 5 / 100_000`), so the scout and the executable path cannot disagree.
 */
const GATEWAY_TRANSFER_FEE_PCT = 0.005
const GATEWAY_TRANSFER_FEE_BPS = 0.5
const BPS_DENOMINATOR = 10_000

/** Arc gas used by a CCTP `depositForBurn` from the payer's wallet. */
const CCTP_BURN_GAS_LIMIT = 120_000n

/** Circle enforces a 1.0 USDC minimum `maxFee` on Gateway burn intents. */
const GATEWAY_MIN_MAX_FEE_USDC = 1.0
/** Gas buffer the Gateway maxFee ceiling carries on top of the transfer fee. */
const GATEWAY_MAX_FEE_GAS_BUFFER_USDC = 0.05

export interface GatewayRailQuote {
  available: boolean
  /** Fee actually charged for the transfer, in USDC. */
  feeUsdc: number | null
  feeBps: number | null
  /**
   * Ceiling encoded in the burn intent: transfer fee + gas buffer, floored at
   * Circle's 1.0 USDC minimum. Not the amount charged; the paid fee is `feeUsdc`.
   */
  maxFeeCeilingUsdc: number | null
  /** The payer signs an intent; Circle executes the burn, so no Arc gas is paid. */
  sourceGasUsdc: number | null
  totalCostUsdc: number | null
  feeSource: string
}

export interface CctpRailQuote {
  available: boolean
  /** Protocol fee (bps of the amount) plus the forwarding fee, in USDC. */
  feeUsdc: number | null
  feeBps: number | null
  protocolFeeUsdc: number | null
  forwardFeeUsdc: number | null
  sourceGasUsdc: number | null
  totalCostUsdc: number | null
  finalityThreshold: number | null
  feeSource: string
}

export interface RouteScoutResult {
  status: 'QUOTE_READY' | 'PARTIAL' | 'UNAVAILABLE'
  amountUsdc: number
  destinationChain: string
  destinationDomain: number | null
  urgency: RouteScoutUrgency
  recommendedRail: RouteScoutRail | null
  /** Absolute difference between the two total costs; null unless both were quoted. */
  savingsUsdc: number | null
  /** Neither rail's source quotes a delivery time, so no arrival estimate is asserted. */
  estimatedArrivalMs: null
  gateway: GatewayRailQuote
  cctp: CctpRailQuote
  unavailable: string[]
  reason?: string
  readAt: number
  notes: string[]
}

const round6 = (value: number): number => Number(value.toFixed(6))

function gatewayQuote(amountUsdc: number): GatewayRailQuote {
  const feeUsdc = round6((amountUsdc * GATEWAY_TRANSFER_FEE_PCT) / 100)
  const ceiling = Math.max(feeUsdc + GATEWAY_MAX_FEE_GAS_BUFFER_USDC, GATEWAY_MIN_MAX_FEE_USDC)
  return {
    available: true,
    feeUsdc,
    feeBps: GATEWAY_TRANSFER_FEE_BPS,
    maxFeeCeilingUsdc: round6(ceiling),
    sourceGasUsdc: 0,
    totalCostUsdc: feeUsdc,
    feeSource: "Circle Gateway's 0.005% transfer fee, the same rate gatewayService encodes in maxFee",
  }
}

/**
 * Quotes both rails for one Arc Testnet route. Read-only: nothing is signed or submitted.
 */
export async function scoutGatewayRoutes(input: {
  amountUsdc: number
  destinationChain: RouteScoutDestination | string
  urgency: RouteScoutUrgency
}): Promise<RouteScoutResult> {
  const readAt = Date.now()
  const amountUsdc = Number(input.amountUsdc)
  const destinationChain = String(input.destinationChain)
  const urgency: RouteScoutUrgency = input.urgency === 'fast' ? 'fast' : 'standard'
  const destinationDomain = GATEWAY_DOMAINS[destinationChain] ?? null
  const sourceChain = IS_TESTNET ? 'Arc_Testnet' : 'Arc'

  const notes: string[] = [
    'Amounts are in USDC. Costs exclude the x402 call price itself.',
    'CCTP costs use the forwarding service, so destination gas is included in the quoted forwarding fee.',
  ]

  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0 || destinationDomain === null) {
    const reason =
      destinationDomain === null
        ? `"${destinationChain}" is not a Circle Gateway destination domain.`
        : 'A positive amountUsdc is required to quote a route.'
    return {
      status: 'UNAVAILABLE',
      amountUsdc: Number.isFinite(amountUsdc) ? amountUsdc : 0,
      destinationChain,
      destinationDomain,
      urgency,
      recommendedRail: null,
      savingsUsdc: null,
      estimatedArrivalMs: null,
      gateway: {
        available: false,
        feeUsdc: null,
        feeBps: null,
        maxFeeCeilingUsdc: null,
        sourceGasUsdc: null,
        totalCostUsdc: null,
        feeSource: 'not quoted',
      },
      cctp: {
        available: false,
        feeUsdc: null,
        feeBps: null,
        protocolFeeUsdc: null,
        forwardFeeUsdc: null,
        sourceGasUsdc: null,
        totalCostUsdc: null,
        finalityThreshold: null,
        feeSource: 'not quoted',
      },
      unavailable: ['both rails'],
      reason,
      readAt,
      notes,
    }
  }

  const finalityThreshold = urgency === 'fast' ? 1000 : 2000

  const [cctpForward, arcGasUsdc] = await Promise.all([
    fetchCctpForwardQuote(sourceChain, destinationChain, finalityThreshold),
    estimateArcGasCostUsdc(CCTP_BURN_GAS_LIMIT),
  ])

  const gateway = gatewayQuote(amountUsdc)

  let cctp: CctpRailQuote
  if (cctpForward === null) {
    cctp = {
      available: false,
      feeUsdc: null,
      feeBps: null,
      protocolFeeUsdc: null,
      forwardFeeUsdc: null,
      sourceGasUsdc: arcGasUsdc,
      totalCostUsdc: null,
      finalityThreshold: null,
      feeSource: 'Circle Iris fee endpoint did not quote this route',
    }
  } else {
    const protocolFeeUsdc = round6((amountUsdc * cctpForward.minimumFeeBps) / BPS_DENOMINATOR)
    const forwardFeeUsdc = round6(Number(cctpForward.forwardFeeSubunits) / 1_000_000)
    const feeUsdc = round6(protocolFeeUsdc + forwardFeeUsdc)
    cctp = {
      available: true,
      feeUsdc,
      feeBps: cctpForward.minimumFeeBps,
      protocolFeeUsdc,
      forwardFeeUsdc,
      sourceGasUsdc: arcGasUsdc,
      totalCostUsdc: arcGasUsdc === null ? null : round6(feeUsdc + arcGasUsdc),
      finalityThreshold: cctpForward.finalityThreshold,
      feeSource: 'Circle Iris CCTP fee endpoint, quoted live for this route and urgency',
    }
  }

  const unavailable: string[] = []
  if (!gateway.available) unavailable.push('Circle Gateway transfer fee')
  if (!cctp.available) unavailable.push('CCTP protocol and forwarding fee')

  const bothTotalsKnown = gateway.totalCostUsdc !== null && cctp.totalCostUsdc !== null
  let recommendedRail: RouteScoutRail | null = null
  let savingsUsdc: number | null = null
  if (bothTotalsKnown) {
    recommendedRail =
      (gateway.totalCostUsdc as number) <= (cctp.totalCostUsdc as number) ? 'gateway' : 'cctp'
    savingsUsdc = round6(
      Math.abs((gateway.totalCostUsdc as number) - (cctp.totalCostUsdc as number))
    )
  } else if (gateway.available) {
    recommendedRail = 'gateway'
  } else if (cctp.available) {
    recommendedRail = 'cctp'
  }

  if (cctp.available && arcGasUsdc === null) {
    unavailable.push('Arc L1 gas price (CCTP source gas)')
    notes.push('CCTP source gas could not be read, so its total cost and the savings comparison stay null.')
  }

  const status: RouteScoutResult['status'] =
    gateway.available && cctp.available && bothTotalsKnown
      ? 'QUOTE_READY'
      : gateway.available || cctp.available
        ? 'PARTIAL'
        : 'UNAVAILABLE'

  return {
    status,
    amountUsdc,
    destinationChain,
    destinationDomain,
    urgency,
    recommendedRail,
    savingsUsdc,
    estimatedArrivalMs: null,
    gateway,
    cctp,
    unavailable,
    ...(status === 'UNAVAILABLE'
      ? { reason: 'Neither Circle Gateway nor CCTP returned a usable quote for this route.' }
      : {}),
    readAt,
    notes,
  }
}
