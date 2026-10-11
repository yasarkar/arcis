import { afterEach, describe, it, expect, vi } from 'vitest'
import { parseLocalIntentFallback, queryArcisLLM } from '../llmService'
import type { CopilotMessage } from '../../types/marketplace'
import type { PortfolioSnapshot } from '../portfolioContextService'

vi.mock('../tokenPriceService', () => ({ getLiveTokenPrices: vi.fn(async () => ({ USDC: 1, EURC: 1 })) }))
vi.mock('../portfolioContextService', () => ({
  getLivePortfolioSnapshot: vi.fn(async () => ({ liquidUsdc: 100 })),
  formatPortfolioForPrompt: vi.fn(() => ''),
}))
vi.mock('../arcGasService', async importOriginal => ({
  ...await importOriginal<typeof import('../arcGasService')>(),
  getDynamicArcGasOptions: vi.fn(async () => ({ isDynamic: true, maxFeePerGas: 25_000_000_000n, source: 'test' })),
  calculateArcGasCostFromFee: vi.fn(() => '0.00052'),
}))
vi.mock('../swapService', () => ({ getSwapEstimate: vi.fn(async () => ({ estimatedOutput: '1.49', stopLimit: '1.48', rate: '0.993' })) }))

const RECIPIENT = '0x2222222222222222222222222222222222222222'
afterEach(() => vi.unstubAllGlobals())

const commands = [
  [`1,5 USDC gönder ${RECIPIENT}`, 'interactive_send'],
  ['swap 1,5 USDC to EURC', 'interactive_swap'],
  ['deposit 1,5 USDC', 'interactive_deposit'],
  ['bridge 1,5 USDC from Arc to Base', 'interactive_bridge'],
] as const

describe('Ask Arco local amount safety (A01)', () => {
  it.each(commands)('preserves the decimal comma in %s', (prompt, type) => {
    const result = parseLocalIntentFallback(prompt)
    expect(result.actionPayload?.type).toBe(type)
    expect(result.actionPayload?.data?.amount).toBe(1.5)
    expect(result.actionPayload?.data?.amountDecimal).toBe('1.5')
  })

  it.each(['send', 'swap', 'deposit', 'bridge'])('never creates a %s card for ambiguous grouping', verb => {
    for (const amount of ['1.000', '1,000']) {
      const result = parseLocalIntentFallback(`${verb} ${amount} USDC to EURC ${RECIPIENT}`)
      expect(result.actionPayload).toBeUndefined()
      expect(result.message).toMatch(/Belirsiz tutar/)
    }
  })

  it.each(['interactive_send', 'interactive_swap', 'interactive_deposit', 'interactive_bridge'] as const)('applies the same parsing to %s corrections', type => {
    const history: CopilotMessage[] = [{ id: 'previous', role: 'assistant', content: '', timestamp: 0,
      actionPayload: { type, title: '', data: { amount: 10, fromToken: 'USDC', toToken: 'EURC', tokenSymbol: 'USDC', recipient: RECIPIENT } },
    }]
    expect(parseLocalIntentFallback('actually make it 1,5', undefined, undefined, history).actionPayload?.data?.amount).toBe(1.5)
    expect(parseLocalIntentFallback('actually make it 1.000', undefined, undefined, history).actionPayload).toBeUndefined()
  })

  it.each(['send', 'swap', 'deposit', 'bridge'])('rejects excess precision and invalid amounts for %s', verb => {
    for (const amount of ['0.0000001', '-1,5', '1.2.3', '1e3', '9007199254740993']) {
      expect(parseLocalIntentFallback(`${verb} ${amount} USDC to EURC ${RECIPIENT}`).actionPayload).toBeUndefined()
    }
  })

  it('preserves tiny 6/8/18-decimal sends without rounding to zero', () => {
    for (const [raw, token, amount] of [
      ['0,000001', 'USDC', 0.000001], ['0,00000001', 'cirBTC', 0.00000001],
      ['0,000000000000000001', 'WETH', 1e-18],
    ] as const) {
      expect(parseLocalIntentFallback(`send ${raw} ${token} to ${RECIPIENT}`).actionPayload?.data?.amount).toBe(amount)
    }
  })
})

describe('Ask Arco LLM boundary amount safety (A01)', () => {
  it('rejects ambiguity before any provider, balance, quote or gas fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const result = await queryArcisLLM(`send 1.000 USDC to ${RECIPIENT}`)
    expect(result.actionPayload).toBeUndefined()
    expect(result.message).toMatch(/Belirsiz tutar/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps a correction amount authoritative even without an explicit transaction verb', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, message: 'Updated.',
      actionPayload: { type: 'interactive_deposit', title: '', data: { amount: 15 } },
    })))
    const history: CopilotMessage[] = [{ id: 'draft', role: 'assistant', content: 'Prepared.', timestamp: 0,
      actionPayload: { type: 'interactive_deposit', title: '', data: { amount: 10 } },
    }]
    const result = await queryArcisLLM('actually make it 1,5', undefined, history, { liquidUsdc: 100 } as PortfolioSnapshot)
    expect(result.actionPayload?.data?.amount).toBe(1.5)
  })

  it.each([200, 503])('keeps 1,5 as 1.5 through provider HTTP %s', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, message: 'Prepared.',
      actionPayload: { type: 'interactive_send', title: '', data: { amount: 15, tokenSymbol: 'USDC', recipient: RECIPIENT } },
    }, { status })))
    const result = await queryArcisLLM(`send 1,5 USDC to ${RECIPIENT}`, undefined, undefined, { liquidUsdc: 100 } as PortfolioSnapshot)
    expect(result.actionPayload?.data?.amount).toBe(1.5)
    expect(result.actionPayload?.data?.amountDecimal).toBe('1.5')
  })
})
