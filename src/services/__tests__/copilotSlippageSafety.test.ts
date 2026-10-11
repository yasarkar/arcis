import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseLocalIntentFallback, queryArcisLLM } from '../llmService'
import { getSwapEstimate } from '../swapService'
import type { CopilotMessage } from '../../types/marketplace'
vi.mock('../tokenPriceService', () => ({ getLiveTokenPrices: vi.fn(async () => ({ USDC: 1, EURC: 1 })) }))
vi.mock('../portfolioContextService', () => ({ getLivePortfolioSnapshot: vi.fn(async () => ({ liquidUsdc: 100 })), formatPortfolioForPrompt: () => '' }))
vi.mock('../arcGasService', async original => ({ ...await original<typeof import('../arcGasService')>(), getDynamicArcGasOptions: vi.fn(async () => ({ isDynamic: true, maxFeePerGas: 25_000_000_000n })) }))
vi.mock('../swapService', () => ({ getSwapEstimate: vi.fn(async () => ({ estimatedOutput: '0.00000123', stopLimit: '0.00000121', rate: '0.000000123' })) }))
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('A03 chat canonical slippage boundary', () => {
  it.each([['0.1', 10], ['0,1', 10], ['0.5', 50], ['1', 100], ['2', 200]])('normalizes %s%% exactly once', async (percent, bps) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, message: 'Ready' })))
    const prompt = `swap 10 USDC to cirBTC slippage ${percent}%`
    const local = parseLocalIntentFallback(prompt)
    expect(local.actionPayload?.data).toMatchObject({ slippageBps: bps, amount: 10 })
    expect(local.actionPayload?.data?.slippage).toBeUndefined()
    const result = await queryArcisLLM(prompt)
    expect(getSwapEstimate).toHaveBeenCalledWith(expect.objectContaining({ slippageBps: bps }))
    expect(result.actionPayload?.data).toMatchObject({ slippageBps: bps, estimatedOut: '0.00000123', minReceived: '0.00000121' })
  })
  it.each(['0', '-1', '0.01', '2.01', '50', '0.101', '1e-1', 'oops'])('rejects %s without a fallback tolerance', percent => {
    expect(parseLocalIntentFallback(`swap 10 USDC to EURC slippage ${percent}%`).actionPayload).toBeUndefined()
  })
  it('parses percent-first Turkish tolerance and leaves memo data alone', () => {
    expect(parseLocalIntentFallback('swap 10 USDC to EURC %0,5 tolerans').actionPayload?.data?.slippageBps).toBe(50)
    expect(parseLocalIntentFallback('swap 10 USDC to EURC memo slippage 50%').actionPayload?.data?.slippageBps).toBe(100)
  })
  it('revisions retain or explicitly replace bps, never carry an old minimum quote', () => {
    const draft = parseLocalIntentFallback('swap 10 USDC to EURC slippage 0.1%').actionPayload!
    const history: CopilotMessage[] = [{ id: 'a', role: 'assistant', content: 'Prepared', timestamp: 0, actionPayload: { ...draft, data: { ...draft.data, minReceived: '9.9' } } }]
    expect(parseLocalIntentFallback('actually make it 5', undefined, undefined, history).actionPayload?.data).toMatchObject({ amount: 5, slippageBps: 10 })
    expect(parseLocalIntentFallback('change slippage to 2%', undefined, undefined, history).actionPayload?.data?.slippageBps).toBe(200)
    const revised = parseLocalIntentFallback('change slippage 0,5%', undefined, undefined, history).actionPayload
    expect(revised?.data?.slippageBps).toBe(50)
    expect(revised?.data?.minReceived).toBeUndefined()
  })
})
