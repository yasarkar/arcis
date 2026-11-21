// src/services/x402/gatewayRouteScout.ts
// Bridge & Gateway Cost Optimizer for the priced AI service `arc-gateway-fee-route-scout`.
//
// Single source of truth for route support: `src/config/bridgeRouteMatrix.ts`.
//   - USDC: compares Circle Gateway (0.005% transfer fee, 0 source gas) vs Circle CCTP v2
//     (live Iris fee + forwarding quote + measured Arc gas).
//   - EURC: Circle Gateway is USDC-only; quotes live CCTP v2 forwarding + Arc gas on supported
//     EURC routes (Ethereum Sepolia, Base Sepolia, Avalanche Fuji).
//   - wETH / cirBTC: quotes Circle's CCTP-X relayer fee via `quoteUcwCctpxRelayerFee` (paid in
//     native Arc USDC gas — 0 haircut on the bridged token amount) on supported CCTP-X routes
//     (Ethereum Sepolia). Never uses CCTP v2's fee endpoint for CCTP-X tokens.

import { GATEWAY_DOMAINS } from '../../config/gatewayConfig.js'
import { IS_TESTNET } from '../../config/arcChain.js'
import {
  getNonUsdcRoutePartners,
  getUcwBridgeMechanism,
  isBridgeRouteSupported,
  normalizeMatrixToken,
} from '../../config/bridgeRouteMatrix.js'
import {
  ROUTE_SCOUT_DESTINATIONS,
  type RouteScoutDestination,
} from '../../config/x402/routeScoutChains.js'
import { fetchCctpForwardQuote } from '../bridgeUcwService.js'
import { quoteCctpxRelayerFee } from './cctpxQuoteClient.js'
import { estimateArcGasCostUsdc } from '../arcGasService.js'

export { ROUTE_SCOUT_DESTINATIONS }
export type { RouteScoutDestination }
export type RouteScoutUrgency = 'standard' | 'fast'
export type RouteScoutRail = 'gateway' | 'cctp' | 'cctpx'
export type RouteScoutToken = 'USDC' | 'EURC' | 'wETH' | 'cirBTC'

export const ROUTE_SCOUT_TOKENS: readonly RouteScoutToken[] = ['USDC', 'EURC', 'wETH', 'cirBTC']

/**
 * Circle Gateway's cross-chain transfer fee: 0.005% of the transferred amount (0.5 bps).
 * `gatewayService.transferFromGateway` encodes exactly this rate into the burn-intent
 * `maxFee` (`amount * 5 / 100_000`), so the scout and the executable path cannot disagree.
 */
const GATEWAY_TRANSFER_FEE_PCT = 0.005
const GATEWAY_TRANSFER_FEE_BPS = 0.5
const BPS_DENOMINATOR = 10_000

/** Arc gas used by a CCTP `depositForBurn` or CCTP-X `crossChainTransfer`. */
const CCTP_BURN_GAS_LIMIT = 120_000n
const CCTPX_TRANSFER_GAS_LIMIT = 180_000n

/** Circle enforces a 1.0 USDC minimum `maxFee` on Gateway burn intents. */
const GATEWAY_MIN_MAX_FEE_USDC = 1.0
/** Gas buffer the Gateway maxFee ceiling carries on top of the transfer fee. */
const GATEWAY_MAX_FEE_GAS_BUFFER_USDC = 0.05

/** Valid non-zero preview address passed to Circle's read-only CCTP-X quote endpoint. */
const CCTPX_PREVIEW_RECIPIENT = '0x000000000000000000000000000000000000dEaD'

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
  /** Bridge mechanism: standard CCTP v2 (USDC/EURC) or CCTP-X (wETH/cirBTC). */
  mechanism?: 'cctp-v2' | 'cctpx'
  /** Protocol fee + forwarding/relayer fee, in USDC (native gas on Arc for CCTP-X). */
  feeUsdc: number | null
  feeBps: number | null
  protocolFeeUsdc: number | null
  forwardFeeUsdc: number | null
  sourceGasUsdc: number | null
  totalCostUsdc: number | null
  finalityThreshold: number | null
  /** True for CCTP-X: fee is paid in source native gas so recipient receives 100% of bridged token. */
  recipientReceivesFullAmount?: boolean
  feeSource: string
}

export interface RouteScoutResult {
  status: 'QUOTE_READY' | 'PARTIAL' | 'UNAVAILABLE'
  token: RouteScoutToken
  amountUsdc: number
  amount: number
  destinationChain: string
  destinationDomain: number | null
  urgency: RouteScoutUrgency
  recommendedRail: RouteScoutRail | null
  /** Supported destination chains for this token from Arc Testnet (from bridgeRouteMatrix). */
  supportedDestinations: string[]
  /** Absolute difference between the two total costs; null unless both rails were quoted. */
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

function normalizeScoutToken(raw?: string): RouteScoutToken {
  const matrix = normalizeMatrixToken(raw || 'USDC')
  if (matrix === 'EURC') return 'EURC'
  if (matrix === 'WETH') return 'wETH'
  if (matrix === 'cirBTC') return 'cirBTC'
  return 'USDC'
}

function emptyGateway(feeSource: string): GatewayRailQuote {
  return {
    available: false,
    feeUsdc: null,
    feeBps: null,
    maxFeeCeilingUsdc: null,
    sourceGasUsdc: null,
    totalCostUsdc: null,
    feeSource,
  }
}

function emptyCctp(feeSource: string, sourceGasUsdc: number | null = null): CctpRailQuote {
  return {
    available: false,
    feeUsdc: null,
    feeBps: null,
    protocolFeeUsdc: null,
    forwardFeeUsdc: null,
    sourceGasUsdc,
    totalCostUsdc: null,
    finalityThreshold: null,
    feeSource,
  }
}

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
 * Quotes bridge rails for one Arc Testnet outbound route (USDC, EURC, wETH, or cirBTC).
 * Read-only: nothing is signed or submitted.
 */
export async function scoutGatewayRoutes(input: {
  token?: RouteScoutToken | string
  amountUsdc: number
  destinationChain: RouteScoutDestination | string
  urgency: RouteScoutUrgency
}): Promise<RouteScoutResult> {
  const readAt = Date.now()
  const token = normalizeScoutToken(input.token)
  const amountUsdc = Number(input.amountUsdc)
  const destinationChain = String(input.destinationChain)
  const urgency: RouteScoutUrgency = input.urgency === 'fast' ? 'fast' : 'standard'
  const destinationDomain = GATEWAY_DOMAINS[destinationChain] ?? null
  const sourceChain = IS_TESTNET ? 'Arc_Testnet' : 'Arc'

  const supportedDestinations =
    token === 'USDC'
      ? [...ROUTE_SCOUT_DESTINATIONS]
      : getNonUsdcRoutePartners(token, sourceChain)

  const notes: string[] = [
    'Fee totals are expressed in USDC (Arc Testnet native gas currency). Costs exclude the x402 call price itself.',
  ]

  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0 || destinationDomain === null) {
    const reason =
      destinationDomain === null
        ? `"${destinationChain}" is not a Circle Gateway destination domain.`
        : 'A positive amount is required to quote a route.'
    return {
      status: 'UNAVAILABLE',
      token,
      amountUsdc: Number.isFinite(amountUsdc) ? amountUsdc : 0,
      amount: Number.isFinite(amountUsdc) ? amountUsdc : 0,
      destinationChain,
      destinationDomain,
      urgency,
      recommendedRail: null,
      supportedDestinations,
      savingsUsdc: null,
      estimatedArrivalMs: null,
      gateway: emptyGateway('not quoted'),
      cctp: emptyCctp('not quoted'),
      unavailable: ['both rails'],
      reason,
      readAt,
      notes,
    }
  }

  // Enforce bridgeRouteMatrix as the single source of truth for non-USDC pair support.
  if (token !== 'USDC' && !isBridgeRouteSupported(token, sourceChain, destinationChain)) {
    const readableSupported = supportedDestinations.map((c) => c.replace(/_/g, ' ')).join(', ')
    const reason =
      supportedDestinations.length > 0
        ? `${token} cannot be bridged from Arc Testnet to ${destinationChain.replace(/_/g, ' ')}. Supported destinations for ${token}: ${readableSupported}.`
        : `${token} has no supported bridge routes from Arc Testnet.`
    return {
      status: 'UNAVAILABLE',
      token,
      amountUsdc,
      amount: amountUsdc,
      destinationChain,
      destinationDomain,
      urgency,
      recommendedRail: null,
      supportedDestinations,
      savingsUsdc: null,
      estimatedArrivalMs: null,
      gateway: emptyGateway('Circle Gateway unified balance is USDC-only'),
      cctp: emptyCctp(`Route not supported for ${token} in bridgeRouteMatrix`),
      unavailable: [`${token} bridge route to ${destinationChain}`],
      reason,
      readAt,
      notes,
    }
  }

  const mechanism = getUcwBridgeMechanism(token)

  // ── PATH A: CCTP-X (wETH, cirBTC) ────────────────────────────────────────────
  if (mechanism === 'cctpx') {
    notes.push(
      'Circle Gateway unified balance is USDC-only. wETH and cirBTC bridge via CCTP-X with forwarding included.',
      'CCTP-X relayer fees are paid in native Arc USDC gas on the source chain — the recipient receives 100% of the bridged token amount (0 haircut).'
    )

    const [relayerQuote, arcGasUsdc] = await Promise.all([
      quoteCctpxRelayerFee({
        tokenSymbol: token,
        amount: String(amountUsdc),
        sourceChain,
        destChain: destinationChain,
        recipientAddress: CCTPX_PREVIEW_RECIPIENT,
        speed: urgency === 'fast' ? 'FAST' : 'SLOW',
      }).catch(() => null),
      estimateArcGasCostUsdc(CCTPX_TRANSFER_GAS_LIMIT),
    ])

    const gateway = emptyGateway(`Circle Gateway unified balance is USDC-only; ${token} bridges via CCTP-X`)

    if (!relayerQuote) {
      return {
        status: 'UNAVAILABLE',
        token,
        amountUsdc,
        amount: amountUsdc,
        destinationChain,
        destinationDomain,
        urgency,
        recommendedRail: null,
        supportedDestinations,
        savingsUsdc: null,
        estimatedArrivalMs: null,
        gateway,
        cctp: {
          ...emptyCctp('Circle IRIS CCTP-X fee quote endpoint did not quote this route', arcGasUsdc),
          mechanism: 'cctpx',
          recipientReceivesFullAmount: true,
        },
        unavailable: ['CCTP-X relayer fee quote'],
        reason: `Circle IRIS did not return a CCTP-X fee quote for ${token} to ${destinationChain.replace(/_/g, ' ')}.`,
        readAt,
        notes,
      }
    }

    const relayerFeeUsdc = round6(Number(relayerQuote.feeAmount))
    const totalCostUsdc = arcGasUsdc === null ? null : round6(relayerFeeUsdc + arcGasUsdc)
    const unavailable: string[] = []
    if (arcGasUsdc === null) {
      unavailable.push('Arc L1 gas price (CCTP-X source gas)')
    }

    return {
      status: totalCostUsdc !== null ? 'QUOTE_READY' : 'PARTIAL',
      token,
      amountUsdc,
      amount: amountUsdc,
      destinationChain,
      destinationDomain,
      urgency,
      recommendedRail: 'cctpx',
      supportedDestinations,
      savingsUsdc: null,
      estimatedArrivalMs: null,
      gateway,
      cctp: {
        available: true,
        mechanism: 'cctpx',
        feeUsdc: relayerFeeUsdc,
        feeBps: 0,
        protocolFeeUsdc: 0,
        forwardFeeUsdc: relayerFeeUsdc,
        sourceGasUsdc: arcGasUsdc,
        totalCostUsdc,
        finalityThreshold: urgency === 'fast' ? 1000 : 2000,
        recipientReceivesFullAmount: true,
        feeSource: `Circle IRIS CCTP-X relayer quote (${relayerQuote.speed}, paid in native ${relayerQuote.nativeSymbol}; 0 token haircut)`,
      },
      unavailable,
      readAt,
      notes,
    }
  }

  // ── PATH B: EURC (CCTP v2 only — Gateway is USDC-only) ───────────────────────
  const finalityThreshold = urgency === 'fast' ? 1000 : 2000
  notes.push(
    'CCTP costs use the forwarding service, so destination gas is included in the quoted forwarding fee.'
  )

  if (token === 'EURC') {
    notes.push('Circle Gateway unified balance is USDC-only; EURC bridges directly via Circle CCTP v2.')

    const [cctpForward, arcGasUsdc] = await Promise.all([
      fetchCctpForwardQuote(sourceChain, destinationChain, finalityThreshold),
      estimateArcGasCostUsdc(CCTP_BURN_GAS_LIMIT),
    ])

    const gateway = emptyGateway('Circle Gateway unified balance is USDC-only; EURC bridges via CCTP v2')

    if (cctpForward === null) {
      return {
        status: 'UNAVAILABLE',
        token,
        amountUsdc,
        amount: amountUsdc,
        destinationChain,
        destinationDomain,
        urgency,
        recommendedRail: null,
        supportedDestinations,
        savingsUsdc: null,
        estimatedArrivalMs: null,
        gateway,
        cctp: {
          ...emptyCctp('Circle Iris fee endpoint did not quote this EURC route', arcGasUsdc),
          mechanism: 'cctp-v2',
        },
        unavailable: ['CCTP protocol and forwarding fee'],
        reason: `Circle Iris did not return a CCTP v2 quote for EURC to ${destinationChain.replace(/_/g, ' ')}.`,
        readAt,
        notes,
      }
    }

    const protocolFeeUsdc = round6((amountUsdc * cctpForward.minimumFeeBps) / BPS_DENOMINATOR)
    const forwardFeeUsdc = round6(Number(cctpForward.forwardFeeSubunits) / 1_000_000)
    const feeUsdc = round6(protocolFeeUsdc + forwardFeeUsdc)
    const totalCostUsdc = arcGasUsdc === null ? null : round6(feeUsdc + arcGasUsdc)
    const unavailable: string[] = []
    if (arcGasUsdc === null) unavailable.push('Arc L1 gas price (CCTP source gas)')

    return {
      status: totalCostUsdc !== null ? 'QUOTE_READY' : 'PARTIAL',
      token,
      amountUsdc,
      amount: amountUsdc,
      destinationChain,
      destinationDomain,
      urgency,
      recommendedRail: 'cctp',
      supportedDestinations,
      savingsUsdc: null,
      estimatedArrivalMs: null,
      gateway,
      cctp: {
        available: true,
        mechanism: 'cctp-v2',
        feeUsdc,
        feeBps: cctpForward.minimumFeeBps,
        protocolFeeUsdc,
        forwardFeeUsdc,
        sourceGasUsdc: arcGasUsdc,
        totalCostUsdc,
        finalityThreshold: cctpForward.finalityThreshold,
        feeSource: 'Circle Iris CCTP v2 fee endpoint, quoted live for EURC on this route and urgency',
      },
      unavailable,
      readAt,
      notes,
    }
  }

  // ── PATH C: USDC (Circle Gateway vs CCTP v2 comparison) ──────────────────────
  const [cctpForward, arcGasUsdc] = await Promise.all([
    fetchCctpForwardQuote(sourceChain, destinationChain, finalityThreshold),
    estimateArcGasCostUsdc(CCTP_BURN_GAS_LIMIT),
  ])

  const gateway = gatewayQuote(amountUsdc)

  let cctp: CctpRailQuote
  if (cctpForward === null) {
    cctp = {
      ...emptyCctp('Circle Iris fee endpoint did not quote this route', arcGasUsdc),
      mechanism: 'cctp-v2',
    }
  } else {
    const protocolFeeUsdc = round6((amountUsdc * cctpForward.minimumFeeBps) / BPS_DENOMINATOR)
    const forwardFeeUsdc = round6(Number(cctpForward.forwardFeeSubunits) / 1_000_000)
    const feeUsdc = round6(protocolFeeUsdc + forwardFeeUsdc)
    cctp = {
      available: true,
      mechanism: 'cctp-v2',
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
    token,
    amountUsdc,
    amount: amountUsdc,
    destinationChain,
    destinationDomain,
    urgency,
    recommendedRail,
    supportedDestinations,
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
