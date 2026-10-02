// src/services/__tests__/paidSurfaceHonestyE2E.test.ts
// Service-data rendering checks are kept separate from paid-call authorization: the x402
// client now fails closed before executing paid data until trusted settlement is available.
// This verifies data-present/data-unavailable display only, not a paid execution.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ rpcFails: false, reserves: { reserveA: 0n, reserveB: 0n } }))

// The Arc read layer the paid services depend on. Flipping `rpcFails` is how this test produces
// the two honest answers a user can actually receive: a failed read and a stale replay.
vi.mock('../rpc', () => ({
  getArcPublicClient: () => ({
    getBlockNumber: async () => {
      if (state.rpcFails) throw new Error('arc rpc unreachable')
      return 2_000_000n
    },
    getBlock: async ({ blockNumber }: any) => {
      if (state.rpcFails) throw new Error('arc rpc unreachable')
      return { timestamp: BigInt(1_800_000_000 - (2_000_000 - Number(blockNumber))) }
    },
    getGasPrice: async () => {
      if (state.rpcFails) throw new Error('arc rpc unreachable')
      return 20_000_000_000n
    },
    getLogs: async () => {
      if (state.rpcFails) throw new Error('arc rpc unreachable')
      return []
    },
    readContract: async () => {
      if (state.rpcFails) throw new Error('arc rpc unreachable')
      return 0n
    },
  }),
  resilientReadContract: vi.fn(async () => {
    if (state.rpcFails) throw new Error('arc rpc unreachable')
    return state.reserves.reserveA
  }),
  resilientGetBalance: vi.fn(async () => {
    if (state.rpcFails) throw new Error('arc rpc unreachable')
    return 0n
  }),
}))

vi.mock('../gatewayService', () => ({
  getGatewayBalances: vi.fn(async () => {
    if (state.rpcFails) throw new Error('gateway api unreachable')
    return { balances: [] }
  }),
}))

vi.mock('../tokenPriceService', () => ({
  getLiveTokenPrices: vi.fn(async () => (state.rpcFails ? {} : { USDC: 1, EURC: 1.1 })),
  normalizeTokenSymbol: (symbol: string) => symbol.toUpperCase(),
}))

vi.mock('../swapService', () => ({
  getSwapEstimate: vi.fn(async () => {
    if (state.rpcFails) throw new Error('no route')
    return { estimatedOutput: '1', rate: '1' }
  }),
}))

import { generateLiveServiceData } from '../aiServicesDataProvider'
import { formatGatewayFlowReport, invalidateGatewayFlowCache } from '../gatewayFlowIndexer'
import { sanitizeCopilotHtml } from '../../utils/sanitizeCopilotHtml'
import { gatewayIndexerManifest } from '../../config/x402/manifests/gatewayIndexer'


beforeEach(() => {
  state.rpcFails = false
  state.reserves = { reserveA: 0n, reserveB: 0n }
  invalidateGatewayFlowCache()
})

/** Exercise the live data provider without bypassing the fail-closed payment boundary. */
async function readGatewayData(): Promise<Record<string, any>> {
  return (await generateLiveServiceData(gatewayIndexerManifest, { timeWindow: '1h' })).data
}

describe('marketplace playground — live data display independent of payment authorization', () => {
  it('renders an UNAVAILABLE answer with explicit absence markers, and never a figure', async () => {
    state.rpcFails = true

    const data = await readGatewayData()

    expect(data.status).toBe('UNAVAILABLE')

    // The panel prints the payload as it is: no panel-level default may resurrect a number.
    const panel = JSON.stringify(data, null, 2)
    expect(panel).toContain('"status": "UNAVAILABLE"')
    expect(panel.toLowerCase()).toContain('unavailable')
    expect(panel).toContain(data.readAt)
    expect(panel).not.toMatch(/"grossInflowUsdc":\s*-?\d/)
    expect(panel).not.toMatch(/"netUsdcInflowUsdc":\s*-?\d/)
    expect(panel).not.toMatch(/"transferCount":\s*-?\d/)
    expect(panel).not.toMatch(/142500|4820500|STRONG_BULLISH|FEED_ACTIVE/)

    // The service's own fields name the missing read and the time it was attempted.
    expect(data.error).toContain('arc rpc unreachable')
    expect(data.source).toContain('AttestationUsed')
    expect(Number.isNaN(Date.parse(data.readAt))).toBe(false)
  }, 30_000)

  it('shows a stale answer as STALE with the read time it actually came from', async () => {
    const freshData = await readGatewayData()
    expect(freshData.status).toBe('LIVE')

    // The chain read fails on the next request: the panel must replay the read it did make.
    state.rpcFails = true
    const staleData = await readGatewayData()

    expect(staleData.status).toBe('STALE')
    expect(staleData.readAt).toBe(freshData.readAt)
    expect(staleData.ageSeconds).toBeGreaterThanOrEqual(0)
    expect(staleData.grossInflowUsdc).toBe(freshData.grossInflowUsdc)
    expect(staleData.error).toContain('arc rpc unreachable')

    const panel = JSON.stringify(staleData, null, 2)
    expect(panel).toContain('"status": "STALE"')
    expect(panel).toContain(freshData.readAt)
  }, 30_000)
})

/**
 * What the copilot drawer actually prints: the assistant bubble renders
 * `sanitizeCopilotHtml(msg.content)` into a `whitespace-pre-wrap` span, and `msg.content` is the
 * report string. Composing the two is the exact text the user reads, so this function is what
 * the rendered-text assertions below check.
 */
function drawerText(report: string): string {
  return sanitizeCopilotHtml(report).replace(/<[^>]*>/g, '')
}

/**
 * What the marketplace playground's console prints: the `<pre>` block holds
 * `JSON.stringify(executionResult.data, null, 2)` for a service answer.
 */
function playgroundText(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

describe('Arco copilot — the rendered report', () => {
  it('answers a Gateway flow query with an explicit UNAVAILABLE report', async () => {
    state.rpcFails = true

    const data = await readGatewayData()
    const report = formatGatewayFlowReport(data)

    expect(report).toContain('UNAVAILABLE')
    expect(report).toContain(data.readAt)

    expect(report).toContain('arc rpc unreachable')
    expect(report).toContain('No inflow, outflow, whale or sentiment figure is shown')
    // No stray figures: the report cannot show a USDC amount it did not read.
    expect(report).not.toMatch(/\$\d/)
    expect(report).not.toContain('2.45M')
    expect(report).not.toContain('14 large transactions')
  }, 30_000)

  it('labels a replayed answer STALE and keeps the figures it really read', async () => {
    const firstData = await readGatewayData()
    expect(firstData.status).toBe('LIVE')

    state.rpcFails = true
    const secondData = await readGatewayData()
    const report = formatGatewayFlowReport(secondData)

    expect(report).toContain('STALE')
    expect(report).toContain(firstData.readAt)
    expect(report).toContain('the newest refresh failed: arc rpc unreachable')
    expect(report).toContain('No Gateway attestation was observed')
  }, 30_000)
})

describe('both paid surfaces — rendered text for an unreadable source', () => {
  it('renders an UNAVAILABLE answer as absence in the copilot bubble and the console panel', async () => {
    state.rpcFails = true

    const data = await readGatewayData()
    const readAt = String(data.readAt)

    // Copilot bubble text.
    const bubble = drawerText(formatGatewayFlowReport(data))
    expect(bubble).toContain('UNAVAILABLE')
    expect(bubble).toContain(readAt)
    expect(bubble).toContain('Source read')
    expect(bubble).toContain('arc rpc unreachable')
    expect(bubble).not.toMatch(/\$\d/)
    // The two invented figures the plan removed must be gone for good.
    expect(bubble).not.toMatch(/2\.45M|1\.32M|850K|142500|4820500|STRONG_BULLISH|14 large transactions/)

    // Marketplace console text.
    const panel = playgroundText(data)
    expect(panel).toContain('"status": "UNAVAILABLE"')
    expect(panel).toContain(`"readAt": "${readAt}"`)
    expect(panel).not.toMatch(/"grossInflowUsdc":\s*-?\d/)
    expect(panel).not.toMatch(/"netUsdcInflowUsdc":\s*-?\d/)
    expect(panel).not.toMatch(/"whaleTransferCount":\s*-?\d/)
  }, 30_000)

  it('renders a STALE answer as STALE with the old read time in both surfaces', async () => {
    const freshData = await readGatewayData()
    expect(freshData.status).toBe('LIVE')

    state.rpcFails = true
    const staleData = await readGatewayData()
    expect(staleData.status).toBe('STALE')

    const bubble = drawerText(formatGatewayFlowReport(staleData))
    expect(bubble).toContain('STALE')
    expect(bubble).toContain(String(freshData.readAt))
    expect(bubble).toContain('newest refresh failed')
    // A stale answer may repeat the figures it really read, but never a new one.
    expect(bubble).toContain(String(staleData.grossInflowUsdc))

    const panel = playgroundText(staleData)
    expect(panel).toContain('"status": "STALE"')
    expect(panel).toContain(String(freshData.readAt))
  }, 30_000)
})

