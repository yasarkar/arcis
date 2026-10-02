// src/services/__tests__/gatewayFlowIndexer.test.ts
// The Gateway flow surface must only ever show what the Circle Gateway contracts on Arc L1
// actually emitted. These tests pin the real read (AttestationUsed / GatewayBurned logs) and
// prove that a failed, empty or unmeasurable read can never turn into a substituted figure.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ACTIVE_GATEWAY_CONTRACTS } from '../../config/gatewayConfig'
import { gatewayIndexerManifest } from '../../config/x402/manifests/gatewayIndexer'
import {
  buildGatewayFlowServiceData,
  formatGatewayFlowReport,
  formatUsdcOrUnavailable,
  formatUsdcOutflow,
  invalidateGatewayFlowCache,
  MAX_LOG_RANGE_BLOCKS,
  readGatewayFlow,
  WHALE_TRANSFER_USDC,
} from '../gatewayFlowIndexer'

const MINTER = String(ACTIVE_GATEWAY_CONTRACTS.gatewayMinter).toLowerCase()
const WALLET = String(ACTIVE_GATEWAY_CONTRACTS.gatewayWallet).toLowerCase()

interface FakeFlow {
  inflow?: Array<{ sourceDomain: number; value: bigint; recipient?: string }>
  outflow?: Array<{ value: bigint }>
  inflowFails?: boolean
  outflowFails?: boolean
  /** Seconds between consecutive blocks; null means the probe cannot measure one. */
  secondsPerBlock?: number | null
  headBlock?: number
  headTimestamp?: number
}

function makeClient(flow: FakeFlow = {}) {
  const headBlock = flow.headBlock ?? 2_000_000
  const headTimestamp = flow.headTimestamp ?? 1_800_000_000
  const secondsPerBlock = flow.secondsPerBlock === undefined ? 1 : flow.secondsPerBlock
  const probeNumber = headBlock - 500

  return {
    getBlockNumber: vi.fn(async () => BigInt(headBlock)),
    getBlock: vi.fn(async ({ blockNumber }: any) => {
      const number = Number(blockNumber)
      if (number === headBlock) return { timestamp: BigInt(headTimestamp) }
      if (secondsPerBlock === null) return { timestamp: BigInt(headTimestamp) }
      const delta = secondsPerBlock * (headBlock - number)
      return { timestamp: BigInt(Math.round(headTimestamp - delta)) }
    }),
    getLogs: vi.fn(async (params: any) => {
      const address = String(params.address).toLowerCase()
      if (address === MINTER) {
        if (flow.inflowFails) throw new Error('arc rpc unavailable')
        return (flow.inflow ?? []).map((log) => ({
          args: {
            token: params.args.token,
            recipient: log.recipient ?? '0x00000000000000000000000000000000000000aa',
            transferSpecHash: '0x' + '11'.repeat(32),
            sourceDomain: log.sourceDomain,
            sourceDepositor: '0x' + '22'.repeat(32),
            sourceSigner: '0x' + '33'.repeat(32),
            value: log.value,
          },
        }))
      }
      if (address === WALLET) {
        if (flow.outflowFails) throw new Error('arc rpc unavailable')
        return (flow.outflow ?? []).map((log) => ({
          args: {
            token: params.args.token,
            depositor: '0x00000000000000000000000000000000000000bb',
            transferSpecHash: '0x' + '44'.repeat(32),
            destinationDomain: 0,
            destinationRecipient: '0x' + '55'.repeat(32),
            signer: '0x00000000000000000000000000000000000000cc',
            value: log.value,
            fee: 0n,
            fromAvailable: log.value,
            fromWithdrawing: 0n,
          },
        }))
      }
      return []
    }),
    probeNumber,
  }
}

const usdc = (amount: number) => BigInt(Math.round(amount * 1e6))

beforeEach(() => {
  invalidateGatewayFlowCache()
})

describe('readGatewayFlow — real Circle Gateway reads on Arc L1', () => {
  it('sums the real AttestationUsed mints and breaks them down by source domain', async () => {
    const client = makeClient({
      inflow: [
        { sourceDomain: 0, value: usdc(2_450) }, // Ethereum Sepolia
        { sourceDomain: 6, value: usdc(1_000) }, // Base Sepolia
        { sourceDomain: 0, value: usdc(150_000) }, // whale-sized Ethereum transfer
      ],
      outflow: [{ value: usdc(50_000) }],
    })

    const read = await readGatewayFlow('1h', client as any)

    expect(read.status).toBe('LIVE')
    expect(read.source).toContain('GatewayMinter')
    expect(read.grossInflowUsdc).toBe(153_450)
    expect(read.grossOutflowUsdc).toBe(50_000)
    expect(read.netInflowUsdc).toBe(103_450)
    expect(read.transferCount).toBe(3)
    expect(read.whaleTransferCount).toBe(1)
    expect(read.flowDirection).toBe('INFLOW')
    expect(read.topSourceChains).toEqual([
      { chain: 'Ethereum Sepolia', domain: 0, inflowUsdc: 152_450, sharePct: 99.35 },
      { chain: 'Base Sepolia', domain: 6, inflowUsdc: 1_000, sharePct: 0.65 },
    ])
    expect(read.window).toMatchObject({
      requestedSeconds: 3_600,
      scannedBlocks: 3_600,
      partialWindow: false,
      coveredSeconds: 3_600,
      secondsPerBlock: 1,
    })
    expect(Number.isNaN(Date.parse(read.readAt))).toBe(false)
  })

  it('counts whale transfers against the documented $100K threshold', async () => {
    const client = makeClient({
      inflow: [
        { sourceDomain: 0, value: usdc(WHALE_TRANSFER_USDC - 1) },
        { sourceDomain: 0, value: usdc(WHALE_TRANSFER_USDC) },
        { sourceDomain: 0, value: usdc(WHALE_TRANSFER_USDC * 3) },
      ],
      outflow: [],
    })

    const read = await readGatewayFlow('1h', client as any)

    expect(read.whaleTransferCount).toBe(2)
    expect(read.transferCount).toBe(3)
  })

  it('reports the real zero when the chain emitted nothing, instead of inventing a flow', async () => {
    const client = makeClient({ inflow: [], outflow: [] })

    const read = await readGatewayFlow('1h', client as any)

    expect(read.status).toBe('LIVE')
    expect(read.grossInflowUsdc).toBe(0)
    expect(read.netInflowUsdc).toBe(0)
    expect(read.transferCount).toBe(0)
    expect(read.whaleTransferCount).toBe(0)
    // An empty list is a real reading: nothing was observed. null would mean "could not read".
    expect(read.topSourceChains).toEqual([])
    expect(read.flowDirection).toBe('BALANCED')
  })

  it('keeps the net unknown when only the outflow read fails, rather than assuming zero', async () => {
    const client = makeClient({ inflow: [{ sourceDomain: 0, value: usdc(2_000) }], outflowFails: true })

    const read = await readGatewayFlow('1h', client as any)

    expect(read.status).toBe('LIVE')
    expect(read.grossInflowUsdc).toBe(2_000)
    expect(read.grossOutflowUsdc).toBeNull()
    expect(read.netInflowUsdc).toBeNull()
    expect(read.flowDirection).toBeNull()
  })

  it('returns UNAVAILABLE with no figures at all when the on-chain read fails', async () => {
    const client = makeClient({ inflowFails: true })

    const read = await readGatewayFlow('1h', client as any)

    expect(read.status).toBe('UNAVAILABLE')
    expect(read.grossInflowUsdc).toBeNull()
    expect(read.grossOutflowUsdc).toBeNull()
    expect(read.netInflowUsdc).toBeNull()
    expect(read.transferCount).toBeNull()
    expect(read.whaleTransferCount).toBeNull()
    expect(read.topSourceChains).toBeNull()
    expect(read.flowDirection).toBeNull()
    expect(read.window).toBeNull()
    expect(read.error).toContain('arc rpc unavailable')
    expect(Number.isNaN(Date.parse(read.readAt))).toBe(false)
  })

  it('returns UNAVAILABLE when the block time needed to size the window cannot be measured', async () => {
    const client = makeClient({ secondsPerBlock: null, inflow: [{ sourceDomain: 0, value: usdc(99) }] })

    const read = await readGatewayFlow('1h', client as any)

    expect(read.status).toBe('UNAVAILABLE')
    expect(read.grossInflowUsdc).toBeNull()
    expect(read.error).toContain('block time')
  })

  it('clamps an oversized window to the scan cap and says the read is partial', async () => {
    const client = makeClient({
      secondsPerBlock: 0.002, // 2 ms blocks: 7 days would need millions of blocks
      inflow: [{ sourceDomain: 3, value: usdc(500) }],
      outflow: [],
    })

    const read = await readGatewayFlow('7d', client as any)

    expect(read.status).toBe('LIVE')
    expect(read.window?.scannedBlocks).toBe(MAX_LOG_RANGE_BLOCKS)
    expect(read.window?.partialWindow).toBe(true)
    expect(read.window?.coveredSeconds).toBeLessThan(604_800)
    expect(read.window?.toBlock).toBe(2_000_000)
    expect(read.window?.fromBlock).toBe(2_000_000 - MAX_LOG_RANGE_BLOCKS)
  })

  it('labels a replayed read as STALE with the original read time after a later failure', async () => {
    const healthy = makeClient({ inflow: [{ sourceDomain: 0, value: usdc(7_500) }], outflow: [] })
    const fresh = await readGatewayFlow('1h', healthy as any)
    expect(fresh.status).toBe('LIVE')

    const broken = makeClient({ inflowFails: true })
    const stale = await readGatewayFlow('1h', broken as any)

    expect(stale.status).toBe('STALE')
    expect(stale.readAt).toBe(fresh.readAt)
    expect(stale.grossInflowUsdc).toBe(7_500)
    expect(stale.ageSeconds).toBeGreaterThanOrEqual(0)
    expect(stale.error).toContain('arc rpc unavailable')

    invalidateGatewayFlowCache()
    const unavailable = await readGatewayFlow('1h', broken as any)
    expect(unavailable.status).toBe('UNAVAILABLE')
    expect(unavailable.grossInflowUsdc).toBeNull()
  })
})

describe('buildGatewayFlowServiceData', () => {
  it('carries nulls — never numbers — for an unread window', async () => {
    const client = makeClient({ inflowFails: true })
    const payload = buildGatewayFlowServiceData(await readGatewayFlow('1h', client as any))

    expect(payload.status).toBe('UNAVAILABLE')
    for (const field of [
      'grossInflowUsdc',
      'grossOutflowUsdc',
      'netUsdcInflowUsdc',
      'transferCount',
      'whaleTransferCount',
      'topSourceChains',
      'flowDirection',
    ]) {
      expect(payload[field]).toBeNull()
    }
    expect(payload.note).toContain('unavailable')
    expect(payload.readAt).toBeTruthy()
    expect(JSON.stringify(payload)).not.toMatch(/142500|4820500|STRONG_BULLISH|FEED_ACTIVE/)
  })

  it('exposes the real figures for a successful read', async () => {
    const client = makeClient({ inflow: [{ sourceDomain: 0, value: usdc(12.5) }], outflow: [] })
    const payload = buildGatewayFlowServiceData(await readGatewayFlow('24h', client as any))

    expect(payload.status).toBe('LIVE')
    expect(payload.timeWindow).toBe('24h')
    expect(payload.requestedWindowSeconds).toBe(86_400)
    expect(payload.grossInflowUsdc).toBe(12.5)
    expect(payload.netUsdcInflowUsdc).toBe(12.5)
    expect(payload.note).toContain(payload.readAt)
  })
})

describe('formatGatewayFlowReport', () => {
  it('states the absence, the attempt time and the reason when the read failed', () => {
    const report = formatGatewayFlowReport(
      buildGatewayFlowServiceData({
        status: 'UNAVAILABLE',
        source: 'Circle Gateway contracts on Arc L1',
        readAt: '2026-09-29T10:00:00.000Z',
        ageSeconds: 0,
        timeWindow: '1h',
        requestedWindowSeconds: 3_600,
        grossInflowUsdc: null,
        grossOutflowUsdc: null,
        netInflowUsdc: null,
        transferCount: null,
        whaleTransferCount: null,
        topSourceChains: null,
        flowDirection: null,
        window: null,
        error: 'rpc timeout',
      } as any)
    )

    expect(report).toContain('UNAVAILABLE')
    expect(report).toContain('2026-09-29T10:00:00.000Z')
    expect(report).toContain('rpc timeout')
    expect(report).not.toContain('$2.45M')
    expect(report).not.toContain('undefined')
    expect(report).not.toMatch(/\$\d/)
  })

  it('renders only the real chain breakdown for a live read', async () => {
    const client = makeClient({
      inflow: [
        { sourceDomain: 0, value: usdc(2_000) },
        { sourceDomain: 6, value: usdc(1_000) },
      ],
      outflow: [{ value: usdc(500) }],
    })
    const report = formatGatewayFlowReport(
      buildGatewayFlowServiceData(await readGatewayFlow('1h', client as any))
    )

    expect(report).toContain('+$3,000 USDC') // gross inflow (2,000 + 1,000)
    expect(report).toContain('-$500 USDC') // the burn is money leaving Arc, never a `+` figure
    expect(report).toContain('+$2,500 USDC') // net inflow after the 500 USDC burn
    expect(report).toContain('Ethereum Sepolia')
    expect(report).toContain('66.67%')
    expect(report).toContain('Base Sepolia')
    expect(report).not.toContain('undefined')
    expect(report).not.toContain('STRONG_BULLISH')
    expect(report).not.toContain('14 large transactions')
  })

  it('admits when the block cap only covered part of the requested window', () => {
    const report = formatGatewayFlowReport({
      status: 'LIVE',
      source: 'Circle Gateway contracts on Arc L1',
      readAt: '2026-09-29T09:00:00.000Z',
      ageSeconds: 0,
      timeWindow: '24h',
      requestedWindowSeconds: 86_400,
      grossInflowUsdc: 10,
      grossOutflowUsdc: 0,
      netUsdcInflowUsdc: 10,
      transferCount: 1,
      whaleTransferCount: 0,
      topSourceChains: [],
      flowDirection: 'INFLOW',
      window: {
        fromBlock: 1,
        toBlock: 50_000,
        scannedBlocks: 50_000,
        requestedSeconds: 86_400,
        secondsPerBlock: 0.51,
        coveredSeconds: 25_500,
        partialWindow: true,
      },
    })

    expect(report).toContain('Window coverage')
    expect(report).toContain('25500s')
    expect(report).toContain('86400s')
  })

  it('flags stale figures with their age and the failed refresh', () => {
    const report = formatGatewayFlowReport({
      status: 'STALE',
      source: 'Circle Gateway contracts on Arc L1',
      readAt: '2026-09-29T09:00:00.000Z',
      ageSeconds: 240,
      timeWindow: '1h',
      requestedWindowSeconds: 3_600,
      grossInflowUsdc: 100,
      grossOutflowUsdc: null,
      netUsdcInflowUsdc: null,
      transferCount: 1,
      whaleTransferCount: 0,
      topSourceChains: [],
      flowDirection: null,
      window: null,
      error: 'rpc timeout',
    })

    expect(report).toContain('STALE')
    expect(report).toContain('2026-09-29T09:00:00.000Z')
    expect(report).toContain('unavailable')
    expect(report).toContain('No Gateway attestation was observed')
    expect(report).not.toContain('undefined')
  })

  it('says nothing usable came back when the service returned no payload', () => {
    const report = formatGatewayFlowReport(null)
    expect(report).toContain('unavailable')
    expect(report).not.toMatch(/\$\d/)
  })
})

describe('formatUsdcOrUnavailable', () => {
  it('marks a missing figure as unavailable instead of printing zero', () => {
    expect(formatUsdcOrUnavailable(null)).toBe('unavailable')
    expect(formatUsdcOrUnavailable(undefined)).toBe('unavailable')
    expect(formatUsdcOrUnavailable(Number.NaN)).toBe('unavailable')
    expect(formatUsdcOrUnavailable(0)).toBe('$0 USDC')
  })

  it('puts the sign in front of the amount instead of between it and the $', () => {
    // A live run produced "$-0.31 USDC", which reads as a typo for a positive number.
    expect(formatUsdcOrUnavailable(-0.31)).toBe('-$0.31 USDC')
    expect(formatUsdcOrUnavailable(0.31)).toBe('+$0.31 USDC')
  })
})

describe('the manifest example this surface ships', () => {
  it('declares itself an example and carries no measured figure', () => {
    const example = gatewayIndexerManifest.examples.response as Record<string, any>

    // The console can show this payload before any call runs, so it must not impersonate a
    // live read — the earlier version shipped status 'LIVE' plus the invented 2.45M/50.83% split.
    expect(['LIVE', 'STALE', 'UNAVAILABLE']).not.toContain(example.status)
    expect(example.readAt).toBeNull()
    expect(example.grossInflowUsdc).toBeNull()
    expect(example.netUsdcInflowUsdc).toBeNull()
    expect(example.whaleTransferCount).toBeNull()
    expect(JSON.stringify(example)).not.toMatch(/48205|47005|24500|13205|50\.83|27\.39|STRONG_BULLISH/)
  })

  it('prints no figure even if it is fed straight into the report formatter', () => {
    const report = formatGatewayFlowReport(gatewayIndexerManifest.examples.response as Record<string, any>)

    for (const label of ['Net USDC flow onto Arc L1', 'Minted onto Arc', 'Burned off Arc']) {
      const line = report.split('\n').find((l) => l.includes(label))!
      expect(line).toContain('unavailable')
      expect(line).not.toMatch(/\$\d/)
    }
    // It also must not claim to be a fresh read when it carries no read time.
    expect(report).not.toContain('Read directly at')
    expect(report).toContain('No read time was reported')
  })
})

describe('formatUsdcOutflow', () => {
  it('renders an outflow as a negative figure so it cannot read as an inflow', () => {
    expect(formatUsdcOutflow(0.66)).toBe('-$0.66 USDC')
    expect(formatUsdcOutflow(0)).toBe('$0 USDC')
    expect(formatUsdcOutflow(null)).toBe('unavailable')
  })

  it('is what the Burned off Arc line uses', async () => {
    const client = makeClient({ inflow: [{ sourceDomain: 0, value: usdc(1) }], outflow: [{ value: usdc(2) }] })
    const report = formatGatewayFlowReport(
      buildGatewayFlowServiceData(await readGatewayFlow('1h', client as any))
    )
    const burnLine = report.split('\n').find((line) => line.includes('Burned off Arc'))!
    expect(burnLine).toContain('-$2 USDC')
    expect(burnLine).not.toContain('+$')
  })
})
