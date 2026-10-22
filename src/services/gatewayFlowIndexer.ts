// src/services/gatewayFlowIndexer.ts
// Single owner of the "USDC moving into Arc L1 through Circle Gateway" read.
//
// Real source (no off-chain indexer, no invented feed): the Circle Gateway contracts
// deployed on Arc L1 itself, read with `getLogs` through the existing resilient Arc
// RPC provider.
//
//   • GatewayMinter -> `AttestationUsed(token, recipient, transferSpecHash, sourceDomain, …)`
//     is emitted whenever a signed Gateway attestation mints USDC onto Arc. It carries the
//     source domain and the minted value, so it is both the mint total and the real
//     per-source-domain breakdown. Reports therefore say "minted onto Arc", not "inflow from
//     another chain": the contract can also settle a same-domain (domain 26) transfer.
//   • GatewayWallet -> `GatewayBurned(token, depositor, transferSpecHash, destinationDomain, …)`
//     is emitted whenever USDC is burned on Arc to be minted on another domain (outflow).
//
// Nothing in this module invents a figure. A read that fails is reported as UNAVAILABLE,
// a read that only covers part of the requested window says so, and a previously successful
// read that is served after a later failure is labelled STALE — every case carries `readAt`.
//
// `buildGatewayFlowServiceData` attaches the shared institutional envelope
// (`x402/institutionalReport.ts`) to every payload: read coverage, freshness, a data-quality
// grade and a graded register of the window-truncation, flow-direction and source-concentration
// findings, each with its evidence, threshold and remediation.

import { formatUnits, parseAbiItem, type Address, type PublicClient } from 'viem'
import { ARC_TOKENS } from '../config/arcChain'
import {
  ACTIVE_GATEWAY_CONTRACTS,
  DOMAIN_TO_CHAIN,
  GATEWAY_CHAIN_NAMES,
} from '../config/gatewayConfig'
import { getArcPublicClient } from './rpc'
import {
  buildInstitutionalReport,
  formatInstitutionalReportHeader,
  formatRiskRegisterLines,
  institutionalRisk,
  type InstitutionalReport,
  type InstitutionalRisk,
} from './x402/institutionalReport'

export const GATEWAY_FLOW_SERVICE_ID = 'arc-cross-chain-gateway-flow-indexer'

export type GatewayFlowWindow = '1h' | '24h' | '7d'

export const GATEWAY_FLOW_SOURCE =
  'Circle Gateway contracts on Arc L1: GatewayMinter.AttestationUsed + GatewayWallet.GatewayBurned logs'

export const GATEWAY_FLOW_WINDOW_SECONDS: Record<GatewayFlowWindow, number> = {
  '1h': 3_600,
  '24h': 86_400,
  '7d': 604_800,
}

/** A single transfer at or above this size is counted as an institutional/whale transfer. */
export const WHALE_TRANSFER_USDC = 100_000

/** Upper bound on how many blocks a single `getLogs` scan may cover. */
export const MAX_LOG_RANGE_BLOCKS = 50_000

/** Blocks sampled to measure the chain's real block time before choosing a range. */
const BLOCK_TIME_PROBE_BLOCKS = 500

/** How long a successful read may be replayed as STALE after a later failure. */
const STALE_WINDOW_MS = 30 * 60 * 1000

export const USDC_DECIMALS = 6

const ATTESTATION_USED_EVENT = parseAbiItem(
  'event AttestationUsed(address indexed token, address indexed recipient, bytes32 indexed transferSpecHash, uint32 sourceDomain, bytes32 sourceDepositor, bytes32 sourceSigner, uint256 value)'
)

const GATEWAY_BURNED_EVENT = parseAbiItem(
  'event GatewayBurned(address indexed token, address indexed depositor, bytes32 indexed transferSpecHash, uint32 destinationDomain, bytes32 destinationRecipient, address signer, uint256 value, uint256 fee, uint256 fromAvailable, uint256 fromWithdrawing)'
)

export interface GatewayFlowChainShare {
  chain: string
  domain: number
  inflowUsdc: number
  sharePct: number
}

export interface GatewayFlowWindowInfo {
  fromBlock: number
  toBlock: number
  scannedBlocks: number
  requestedSeconds: number
  /** Measured seconds per block over the probe span, null when it could not be measured. */
  secondsPerBlock: number | null
  /** Seconds the scan actually covers, rounded from the measured block time. */
  coveredSeconds: number
  /** True when the block cap forced a shorter scan than the requested window. */
  partialWindow: boolean
}

export interface GatewayFlowRead {
  status: 'LIVE' | 'STALE' | 'UNAVAILABLE'
  source: string
  /** ISO timestamp of the read that produced these figures. */
  readAt: string
  ageSeconds: number
  timeWindow: GatewayFlowWindow
  requestedWindowSeconds: number
  grossInflowUsdc: number | null
  grossOutflowUsdc: number | null
  netInflowUsdc: number | null
  transferCount: number | null
  whaleTransferCount: number | null
  topSourceChains: GatewayFlowChainShare[] | null
  flowDirection: 'INFLOW' | 'OUTFLOW' | 'BALANCED' | null
  window: GatewayFlowWindowInfo | null
  /** Present whenever a figure is missing or the figures are stale. */
  error?: string
}

interface RawGatewayFlow {
  grossInflowUsdc: number
  grossOutflowUsdc: number | null
  transferCount: number
  whaleTransferCount: number
  topSourceChains: GatewayFlowChainShare[]
  window: GatewayFlowWindowInfo
}

const staleCache = new Map<GatewayFlowWindow, { snapshot: RawGatewayFlow; readAt: number }>()

/** Clears the replay cache (used by tests and by callers that need a hard refresh). */
export function invalidateGatewayFlowCache(): void {
  staleCache.clear()
}

function toUsdc(value: bigint | undefined): number {
  const raw = value ?? 0n
  const numeric = Number(formatUnits(raw, USDC_DECIMALS))
  return Number.isFinite(numeric) ? numeric : 0
}

function chainLabel(domain: number): string {
  const chainKey = DOMAIN_TO_CHAIN[domain]
  if (!chainKey) return `Unknown domain ${domain}`
  return GATEWAY_CHAIN_NAMES[chainKey] || chainKey
}

/**
 * Measures the real block time and resolves the [fromBlock, toBlock] range that best covers
 * the requested window without exceeding the single-scan block cap.
 */
async function resolveWindow(
  client: PublicClient,
  requestedSeconds: number
): Promise<{ toBlock: bigint; fromBlock: bigint; info: GatewayFlowWindowInfo }> {
  const toBlock = await client.getBlockNumber()
  const head = await client.getBlock({ blockNumber: toBlock })

  if (toBlock <= BigInt(BLOCK_TIME_PROBE_BLOCKS)) {
    throw new Error('Arc L1 chain history is too short to measure a block time for this window.')
  }

  const probeNumber = toBlock - BigInt(BLOCK_TIME_PROBE_BLOCKS)
  const probe = await client.getBlock({ blockNumber: probeNumber })
  const elapsedSeconds = Number(head.timestamp - probe.timestamp)
  const spanBlocks = Number(toBlock - probeNumber)
  const secondsPerBlock = elapsedSeconds > 0 && spanBlocks > 0 ? elapsedSeconds / spanBlocks : null

  if (!secondsPerBlock) {
    throw new Error('Could not measure the Arc L1 block time required to size the requested window.')
  }

  const blocksNeeded = Math.ceil(requestedSeconds / secondsPerBlock)
  const scannedBlocks = Math.max(1, Math.min(blocksNeeded, MAX_LOG_RANGE_BLOCKS))
  const fromBlock = toBlock > BigInt(scannedBlocks) ? toBlock - BigInt(scannedBlocks) : 0n
  const partialWindow = scannedBlocks < blocksNeeded

  return {
    toBlock,
    fromBlock,
    info: {
      fromBlock: Number(fromBlock),
      toBlock: Number(toBlock),
      scannedBlocks,
      requestedSeconds,
      secondsPerBlock,
      coveredSeconds: Math.min(requestedSeconds, Math.round(scannedBlocks * secondsPerBlock)),
      partialWindow,
    },
  }
}

async function readFreshGatewayFlow(
  timeWindow: GatewayFlowWindow,
  client: PublicClient
): Promise<RawGatewayFlow> {
  const requestedSeconds = GATEWAY_FLOW_WINDOW_SECONDS[timeWindow]
  const { toBlock, fromBlock, info } = await resolveWindow(client, requestedSeconds)

  const usdc = ARC_TOKENS.USDC as Address
  const inflowLogs = await client.getLogs({
    address: ACTIVE_GATEWAY_CONTRACTS.gatewayMinter,
    event: ATTESTATION_USED_EVENT,
    args: { token: usdc },
    fromBlock,
    toBlock,
  })

  let grossInflowUsdc = 0
  let whaleTransferCount = 0
  const perDomain = new Map<number, number>()

  for (const log of inflowLogs) {
    const value = toUsdc(log.args.value)
    grossInflowUsdc += value
    if (value >= WHALE_TRANSFER_USDC) whaleTransferCount += 1
    const domain = Number(log.args.sourceDomain ?? 0)
    perDomain.set(domain, (perDomain.get(domain) ?? 0) + value)
  }

  const topSourceChains: GatewayFlowChainShare[] = [...perDomain.entries()]
    .map(([domain, inflowUsdc]) => ({
      chain: chainLabel(domain),
      domain,
      inflowUsdc: Number(inflowUsdc.toFixed(6)),
      sharePct: grossInflowUsdc > 0 ? Number(((inflowUsdc / grossInflowUsdc) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.inflowUsdc - a.inflowUsdc)

  // The outflow read is a second, independent fact. If it fails we report it as unknown
  // rather than assuming zero, so the net figure stays honest (null) too.
  let grossOutflowUsdc: number | null = null
  try {
    const burnLogs = await client.getLogs({
      address: ACTIVE_GATEWAY_CONTRACTS.gatewayWallet,
      event: GATEWAY_BURNED_EVENT,
      args: { token: usdc },
      fromBlock,
      toBlock,
    })
    grossOutflowUsdc = burnLogs.reduce((sum, log) => sum + toUsdc(log.args.value), 0)
    grossOutflowUsdc = Number(grossOutflowUsdc.toFixed(6))
  } catch {
    grossOutflowUsdc = null
  }

  return {
    grossInflowUsdc: Number(grossInflowUsdc.toFixed(6)),
    grossOutflowUsdc,
    transferCount: inflowLogs.length,
    whaleTransferCount,
    topSourceChains,
    window: info,
  }
}

function directionOf(net: number): 'INFLOW' | 'OUTFLOW' | 'BALANCED' {
  if (net > 0) return 'INFLOW'
  if (net < 0) return 'OUTFLOW'
  return 'BALANCED'
}

/**
 * Reads the real Gateway flow for a window. Never throws: failures come back as
 * UNAVAILABLE (or STALE when a recent successful read exists for the same window).
 */
export async function readGatewayFlow(
  timeWindow: GatewayFlowWindow,
  client: PublicClient = getArcPublicClient()
): Promise<GatewayFlowRead> {
  const requestedWindowSeconds = GATEWAY_FLOW_WINDOW_SECONDS[timeWindow]
  const attemptedAt = Date.now()

  try {
    const fresh = await readFreshGatewayFlow(timeWindow, client)
    const readAt = Date.now()
    staleCache.set(timeWindow, { snapshot: fresh, readAt })

    const netUsdcInflowUsdc =
      fresh.grossOutflowUsdc === null ? null : Number((fresh.grossInflowUsdc - fresh.grossOutflowUsdc).toFixed(6))

    return {
      status: 'LIVE',
      source: GATEWAY_FLOW_SOURCE,
      readAt: new Date(readAt).toISOString(),
      ageSeconds: 0,
      timeWindow,
      requestedWindowSeconds,
      ...fresh,
      netInflowUsdc: netUsdcInflowUsdc,
      flowDirection: netUsdcInflowUsdc === null ? null : directionOf(netUsdcInflowUsdc),
    }
  } catch (err: any) {
    const message = err?.shortMessage || err?.message || 'Gateway flow read failed.'

    const cached = staleCache.get(timeWindow)
    if (cached && attemptedAt - cached.readAt <= STALE_WINDOW_MS) {
      const netUsdcInflowUsdc =
        cached.snapshot.grossOutflowUsdc === null
          ? null
          : Number((cached.snapshot.grossInflowUsdc - cached.snapshot.grossOutflowUsdc).toFixed(6))

      return {
        status: 'STALE',
        source: GATEWAY_FLOW_SOURCE,
        readAt: new Date(cached.readAt).toISOString(),
        ageSeconds: Math.round((attemptedAt - cached.readAt) / 1000),
        timeWindow,
        requestedWindowSeconds,
        ...cached.snapshot,
        netInflowUsdc: netUsdcInflowUsdc,
        flowDirection: netUsdcInflowUsdc === null ? null : directionOf(netUsdcInflowUsdc),
        error: message,
      }
    }

    return {
      status: 'UNAVAILABLE',
      source: GATEWAY_FLOW_SOURCE,
      readAt: new Date(attemptedAt).toISOString(),
      ageSeconds: 0,
      timeWindow,
      requestedWindowSeconds,
      grossInflowUsdc: null,
      grossOutflowUsdc: null,
      netInflowUsdc: null,
      transferCount: null,
      whaleTransferCount: null,
      topSourceChains: null,
      flowDirection: null,
      window: null,
      error: message,
    }
  }
}

/**
 * Maps a read onto the x402 service response. This is the only place the Gateway flow
 * payload shape is defined, so callers cannot reintroduce a substituted figure.
 */
export function buildGatewayFlowServiceData(read: GatewayFlowRead): Record<string, any> {
  const available = read.status !== 'UNAVAILABLE'

  // Two planned scans: mint side (AttestationUsed) and burn side (GatewayBurned). A stale replay
  // is a complete measurement that could not be refreshed, so it keeps full coverage and is
  // graded on freshness instead.
  const expectedReads = 2
  const measuredReads = available ? expectedReads : 0

  const risks: InstitutionalRisk[] = []

  if (!available) {
    risks.push(
      institutionalRisk({
        id: 'GATEWAY_FLOW_READ_FAILED',
        category: 'DATA_QUALITY',
        severity: 'HIGH',
        title: 'The Gateway flow scan returned nothing',
        finding: `${read.error || 'The on-chain read returned nothing usable'}, so no inflow, outflow or per-chain figure is published.`,
        evidence: { measuredReads, expectedReads, error: read.error ?? null },
        threshold: 'Both the mint and burn scans must return before a flow figure is published.',
        remediation:
          'Re-run once the Arc RPC answers. A failed scan is never replaced with a cached or estimated figure beyond the stale-replay window.',
      })
    )
  }

  if (read.status === 'STALE') {
    risks.push(
      institutionalRisk({
        id: 'GATEWAY_FLOW_STALE',
        category: 'DATA_QUALITY',
        severity: 'MEDIUM',
        title: 'Served flow figures are a replay, not a fresh read',
        finding: `The refresh failed, so the figures are the last successful read, ${read.ageSeconds} second(s) old.`,
        evidence: { ageSeconds: read.ageSeconds, readAt: read.readAt, error: read.error ?? null },
        threshold: 'A read older than the freshness window is served only as STALE.',
        remediation:
          'Treat the figures as historical until a refresh succeeds; the report carries the read time so the age is never implicit.',
      })
    )
  }

  if (read.window?.partialWindow) {
    risks.push(
      institutionalRisk({
        id: 'WINDOW_COVERAGE_PARTIAL',
        category: 'DATA_QUALITY',
        severity: 'MEDIUM',
        title: 'The scanned block range is shorter than the requested window',
        finding: `The single-scan block cap covers ${read.window.scannedBlocks} blocks (~${read.window.coveredSeconds}s) of the requested ${read.window.requestedSeconds}s, so totals undercount the window.`,
        evidence: {
          scannedBlocks: read.window.scannedBlocks,
          coveredSeconds: read.window.coveredSeconds,
          requestedSeconds: read.window.requestedSeconds,
        },
        threshold: 'Scanned blocks are capped at the module’s MAX_LOG_RANGE_BLOCKS limit.',
        remediation:
          'Shorten the requested window or compare consecutive calls; the reported totals describe the covered span only.',
      })
    )
  }

  if (read.flowDirection === 'OUTFLOW') {
    risks.push(
      institutionalRisk({
        id: 'NET_LIQUIDITY_OUTFLOW',
        category: 'MARKET_STRUCTURE',
        severity: 'LOW',
        title: 'Net USDC left Arc during the window',
        finding: `Burns exceeded mints by ${Math.abs(read.netInflowUsdc ?? 0)} USDC over the measured window.`,
        evidence: {
          netUsdcInflowUsdc: read.netInflowUsdc,
          grossInflowUsdc: read.grossInflowUsdc,
          grossOutflowUsdc: read.grossOutflowUsdc,
        },
        threshold: 'Net flow (minted − burned) < 0.',
        remediation:
          'The report states the measured direction and does not attribute a motive to any transfer.',
      })
    )
  }

  const topShare = read.topSourceChains?.[0]
  if (topShare && typeof topShare.sharePct === 'number' && topShare.sharePct >= 80) {
    risks.push(
      institutionalRisk({
        id: 'SINGLE_SOURCE_CONCENTRATION',
        category: 'CONCENTRATION',
        severity: 'LOW',
        title: 'Inflows came overwhelmingly from one source chain',
        finding: `${topShare.chain} accounts for ${topShare.sharePct}% of the USDC minted onto Arc in this window.`,
        evidence: {
          sourceChain: topShare.chain,
          sourceDomain: topShare.domain,
          sharePct: topShare.sharePct,
          inflowUsdc: topShare.inflowUsdc,
        },
        threshold: 'Leading source-domain share >= 80% of measured minted USDC.',
        remediation:
          'A single-source window is a measured fact about this window only; it is not a routing recommendation.',
      })
    )
  }

  if (available && read.transferCount === 0) {
    risks.push(
      institutionalRisk({
        id: 'NO_GATEWAY_ACTIVITY',
        category: 'COMPOSITION',
        severity: 'INFO',
        title: 'No Gateway transfer was observed in the window',
        finding: 'No AttestationUsed or GatewayBurned log matched the scanned range, so every figure is a true zero for that span.',
        evidence: { transferCount: 0, scannedBlocks: read.window?.scannedBlocks ?? null },
        threshold: null,
        remediation:
          'Widen the window or re-check after block production; zero activity is reported as zero, not as unavailability.',
      })
    )
  }

  const report: InstitutionalReport = buildInstitutionalReport({
    kind: 'GATEWAY_FLOW',
    serviceId: GATEWAY_FLOW_SERVICE_ID,
    title: 'Cross-Chain Gateway Flow Report',
    subject: { type: 'NETWORK', identifier: 'Arc Testnet' },
    issuedAt: Date.now(),
    asOf: read.readAt,
    freshness: {
      state: read.status === 'LIVE' ? 'CURRENT' : read.status === 'STALE' ? 'STALE' : 'UNKNOWN',
      ageSeconds: available ? read.ageSeconds : null,
    },
    coverage: { measuredReads, expectedReads },
    risks,
    methodology: [
      'GatewayMinter.AttestationUsed logs are the mint side (USDC arriving on Arc) and GatewayWallet.GatewayBurned logs are the burn side (USDC leaving Arc).',
      'Both scans use getLogs over a block range derived from the requested window and a measured block time; the covered span is stated with the totals.',
      'Net flow is signed minted − burned, so a negative net is printed as an outflow rather than as an absolute figure.',
      'Per-source-chain shares come from AttestationUsed.sourceDomain and are never extrapolated beyond the scanned window.',
    ],
    limitations: [
      'Only Circle Gateway contract activity is measured; USDC moved by other rails (direct CCTP v2 burns, exchange transfers) is outside this report.',
      'A single getLogs scan is block-capped, so a long window can cover fewer seconds than requested and says so in the window block.',
      'The report quantifies liquidity migration; it does not identify counterparties or attribute intent to any transfer.',
    ],
  })

  return {
    report,
    limitations: report.limitations,
    status: read.status,
    source: read.source,
    readAt: read.readAt,
    ageSeconds: read.ageSeconds,
    timeWindow: read.timeWindow,
    requestedWindowSeconds: read.requestedWindowSeconds,
    grossInflowUsdc: read.grossInflowUsdc,
    grossOutflowUsdc: read.grossOutflowUsdc,
    netUsdcInflowUsdc: read.netInflowUsdc,
    transferCount: read.transferCount,
    whaleTransferCount: read.whaleTransferCount,
    // null (not an empty list) means "we could not read this", which answers must say out loud.
    topSourceChains: read.topSourceChains,
    flowDirection: read.flowDirection,
    window: read.window,
    note: available
      ? read.status === 'STALE'
        ? `Live Gateway flow feed could not be refreshed; showing the last successful on-chain read from ${read.readAt}.`
        : `Read directly from the Circle Gateway contracts on Arc L1 at ${read.readAt}.`
      : `Gateway flow data is unavailable: ${read.error}`,
    ...(read.error ? { error: read.error } : {}),
  }
}

/**
 * Formats a USDC figure for display, or an explicit absence marker. The locale is pinned so
 * the English report text renders the same digits for every reader.
 */
export function formatUsdcOrUnavailable(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'unavailable'
  const magnitude = Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (value > 0) return `+$${magnitude} USDC`
  if (value < 0) return `-$${magnitude} USDC`
  return `$0 USDC`
}

/**
 * Formats an outflow so it can never read as an inflow. The GatewayBurned figure is money
 * leaving Arc, so it is printed as a negative amount rather than a bare (or worse, `+`) number.
 */
export function formatUsdcOutflow(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'unavailable'
  return formatUsdcOrUnavailable(value === 0 ? 0 : -Math.abs(value))
}

function countOrUnavailable(value: number | null | undefined): string {
  return value === null || value === undefined ? 'unavailable' : String(value)
}

const WINDOW_LABEL: Record<GatewayFlowWindow, string> = {
  '1h': 'last 1 hour',
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
}

/**
 * Renders the human-readable report from the mapped payload. Every line is derived from
 * the payload, so a fabricated number cannot be introduced by a caller without changing
 * this single function.
 */
export function formatGatewayFlowReport(data: Record<string, any> | null | undefined): string {
  if (!data || typeof data !== 'object') {
    return (
      'Circle Gateway flow report unavailable: the Gateway flow service returned no data. ' +
      'No inflow figure is shown because none could be read from Arc L1.'
    )
  }

  const timeWindow: GatewayFlowWindow =
    data.timeWindow === '24h' || data.timeWindow === '7d' ? data.timeWindow : '1h'
  const readAt = typeof data.readAt === 'string' ? data.readAt : 'unknown'
  const source = typeof data.source === 'string' ? data.source : 'unknown source'
  const reportHeader = formatInstitutionalReportHeader(data.report)
  const registerLines = formatRiskRegisterLines(data.report)

  if (data.status === 'UNAVAILABLE') {
    return [
      ...(reportHeader ? [reportHeader, ''] : []),
      `Circle Gateway USDC flow report (${WINDOW_LABEL[timeWindow]}): UNAVAILABLE`,
      '',
      `• Source read: ${source}`,
      `• Attempted at: ${readAt}`,
      `• Reason: ${data.error || 'the on-chain read returned nothing usable'}`,
      ...(registerLines.length > 0 ? ['', ...registerLines] : []),
      '',
      'No inflow, outflow, whale or sentiment figure is shown because none could be read from Arc L1.',
    ].join('\n')
  }

  const chains: GatewayFlowChainShare[] = Array.isArray(data.topSourceChains)
    ? data.topSourceChains
    : []
  const isStale = data.status === 'STALE'

  const lines: string[] = [
    ...(reportHeader ? [reportHeader, ''] : []),
    `Circle Gateway USDC flow report (${WINDOW_LABEL[timeWindow]})${isStale ? ' — STALE' : ''}:`,
    '',
    `• Net USDC flow onto Arc L1 (minted - burned): ${formatUsdcOrUnavailable(data.netUsdcInflowUsdc)}`,
    `• Minted onto Arc (AttestationUsed): ${formatUsdcOrUnavailable(data.grossInflowUsdc)} across ${countOrUnavailable(data.transferCount)} attestation(s)`,
    `• Burned off Arc (GatewayBurned): ${formatUsdcOutflow(data.grossOutflowUsdc)}`,
    `• Large transfers (>= $${WHALE_TRANSFER_USDC.toLocaleString('en-US')} USDC each): ${countOrUnavailable(data.whaleTransferCount)}`,
    `• Direction: ${typeof data.flowDirection === 'string' ? data.flowDirection : 'unavailable'}`,
    '',
    'Top source blockchains (from AttestationUsed.sourceDomain):',
  ]

  if (data.topSourceChains === null) {
    lines.push('• unavailable — the on-chain read failed, so no per-chain breakdown exists.')
  } else if (chains.length === 0) {
    lines.push('• No Gateway attestation was observed on Arc L1 in this window.')
  } else {
    chains.forEach((entry, index) => {
      lines.push(
        `${index + 1}. ${entry.chain} — ${formatUsdcOrUnavailable(entry.inflowUsdc)} (${entry.sharePct}%)`
      )
    })
  }

  if (data.window && data.window.partialWindow) {
    lines.push(
      '',
      `Window coverage: requested ${countOrUnavailable(data.requestedWindowSeconds)}s but the single-scan block cap only covers ${countOrUnavailable(data.window.scannedBlocks)} blocks (~${countOrUnavailable(data.window.coveredSeconds)}s).`
    )
  }

  if (isStale) {
    lines.push(
      '',
      `Figures are from the last successful on-chain read at ${readAt} (${countOrUnavailable(data.ageSeconds)}s old); the newest refresh failed: ${data.error || 'unknown error'}`
    )
  } else {
    lines.push(
      '',
      readAt === 'unknown'
        ? 'No read time was reported for this payload, so it is not presented as a fresh read.'
        : `Read directly at ${readAt}.`,
      `Source: ${source}`
    )
  }

  if (registerLines.length > 0) {
    lines.push('', ...registerLines)
  }

  return lines.join('\n')
}
