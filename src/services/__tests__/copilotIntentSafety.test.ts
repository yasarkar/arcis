import { afterEach, describe, expect, it, vi } from 'vitest'
import { isExplicitTransactionCommand, parseLocalIntentFallback, queryArcisLLM } from '../llmService'
import { classifyCopilotIntent, invalidateCopilotDrafts, latestEditableCopilotDraft } from '../../utils/copilotIntent'
import type { CopilotActionPayload, CopilotMessage } from '../../types/marketplace'
import type { PortfolioSnapshot } from '../portfolioContextService'

vi.mock('../tokenPriceService', () => ({ getLiveTokenPrices: vi.fn(async () => ({ USDC: 1, EURC: 1 })) }))
vi.mock('../portfolioContextService', () => ({ getLivePortfolioSnapshot: vi.fn(async () => ({ liquidUsdc: 100 })), formatPortfolioForPrompt: vi.fn(() => '') }))
vi.mock('../arcGasService', async original => ({ ...await original<typeof import('../arcGasService')>(),
  getDynamicArcGasOptions: vi.fn(async () => ({ isDynamic: true, maxFeePerGas: 25_000_000_000n })),
}))
vi.mock('../swapService', () => ({ getSwapEstimate: vi.fn(async () => ({ estimatedOutput: '4.9', stopLimit: '4.8', rate: '0.98' })) }))
afterEach(() => vi.unstubAllGlobals())

const RECIPIENT = '0x2222222222222222222222222222222222222222'
const snapshot = { liquidUsdc: 100, liquidEurc: 100 } as PortfolioSnapshot
const blocked = [
  `Do not send 10 USDC to ${RECIPIENT}`, `Don't send 10 USDC to ${RECIPIENT}`,
  `never transfer 10 USDC to ${RECIPIENT}`, `send 10 USDC to ${RECIPIENT} yapma`,
  `10 USDC gönderme ${RECIPIENT}`, `10 USDC yollama ${RECIPIENT}`, 'deposit 10 USDC yatırma',
  'swap 10 USDC to EURC çevirme', 'bridge 10 USDC from Arc to Base aktarma',
  'cancel', 'iptal et', 'vazgeç', 'stop', 'do not change it to 5',
  `How do I send 10 USDC to ${RECIPIENT}?`, `Can you send 10 USDC to ${RECIPIENT}?`,
  `10 USDC nasıl gönderilir ${RECIPIENT}`, `10 USDC gönderir misin ${RECIPIENT}?`, `10 USDC gönderir misin ${RECIPIENT}`, `10 USDC göndermek istemiyorum ${RECIPIENT}`,
  'what if I swap 10 USDC to EURC', 'Explain deposit 10 USDC', 'dry run bridge 10 USDC to Base',
  `For example send 10 USDC to ${RECIPIENT}`, `örnek: send 10 USDC to ${RECIPIENT}`,
  `"send 10 USDC to ${RECIPIENT}"`, '`swap 10 USDC to EURC`',
  `'send 10 USDC to ${RECIPIENT}'`, 'swap 5 USDC to EURC and deposit 5 USDC',
]
function history(action: CopilotActionPayload): CopilotMessage[] {
  return [{ id: 'draft', role: 'assistant', content: 'Prepared.', timestamp: 0, actionPayload: action }]
}
const swap: CopilotActionPayload = { type: 'interactive_swap', title: '', draftId: 'swap-draft', revision: 2,
  data: { amount: 10, fromToken: 'EURC', toToken: 'cirBTC', slippage: 0.5 },
}

describe('A02 blocked instructions', () => {
  it.each(blocked)('never creates a card or provider call for %s', async prompt => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect(isExplicitTransactionCommand(prompt)).toBe(false)
    expect(parseLocalIntentFallback(prompt, undefined, undefined, history(swap)).actionPayload).toBeUndefined()
    expect((await queryArcisLLM(prompt, undefined, history(swap), snapshot)).actionPayload).toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('treats memo content as data and never treats English not as a memo', () => {
    const result = parseLocalIntentFallback(`send 5 USDC to ${RECIPIENT} with memo "do not swap 10"`)
    expect(result.actionPayload?.type).toBe('interactive_send')
    expect(result.actionPayload?.data?.memo).toBe('do not swap 10')
    expect(parseLocalIntentFallback(`send 5 USDC to ${RECIPIENT} not: invoice-42`).actionPayload?.data?.memo).toBe('invoice-42')
    expect(classifyCopilotIntent(`Do not send 5 USDC to ${RECIPIENT}`).kind).toBe('cancel')
  })
})

describe('A02 new commands versus draft revisions', () => {
  const commands = [
    [`5 USDC gönder ${RECIPIENT}`, 'interactive_send'],
    [`actually send 5 USDC to ${RECIPIENT}`, 'interactive_send'],
    ['swap 5 USDC to EURC', 'interactive_swap'],
    ['deposit 5 USDC', 'interactive_deposit'],
    ['bridge 5 USDC from Arc to Base', 'interactive_bridge'],
  ] as const
  it.each(commands)('starts an independent action for %s after every prior action type', (prompt, type) => {
    for (const previous of ['interactive_swap', 'interactive_send', 'interactive_deposit', 'interactive_bridge'] as const) {
      const result = parseLocalIntentFallback(prompt, undefined, undefined, history({ ...swap, type: previous }))
      expect(result.actionPayload?.type).toBe(type)
      expect(result.actionPayload?.data?.amount).toBe(5)
      expect(result.actionPayload?.draftId).not.toBe('swap-draft')
      expect(result.actionPayload?.revision).toBe(1)
      if (type === 'interactive_send') {
        expect(result.actionPayload?.data?.tokenSymbol).toBe('USDC')
        expect(result.actionPayload?.data?.recipient).toBe(RECIPIENT)
        expect(result.actionPayload?.data?.toToken).toBeUndefined()
      }
    }
  })

  it('revises only an explicit pending draft with stable ID and incremented revision', () => {
    const revised = parseLocalIntentFallback('actually make it 5', undefined, undefined, history(swap)).actionPayload
    expect(revised).toMatchObject({ type: 'interactive_swap', draftId: 'swap-draft', revision: 3,
      data: { amount: 5, fromToken: 'EURC', toToken: 'cirBTC', slippageBps: 50 } })
  })

  it.each(['5', '5 USDC', 'slippage 0.5'])('does not infer a correction from %s', prompt => {
    expect(parseLocalIntentFallback(prompt, undefined, undefined, history(swap)).actionPayload).toBeUndefined()
  })

  it('does not invent or resurrect a draft without a current editable assistant turn', () => {
    const base = history(swap)
    const suffixes: CopilotMessage[][] = [[],
      [{ id: 'cancel', role: 'user', content: 'cancel', timestamp: 1 }],
      [{ id: 'reply', role: 'assistant', content: 'No action.', timestamp: 1 }],
      [{ ...base[0], receipt: { id: 'receipt', txHash: '0x123', actionType: 'swap', title: '', status: 'SUCCESS', timestamp: 1, gasUsdc: 0, settlementLatencyMs: 0 } }],
      [{ ...base[0], isExecutingInline: true }],
      [{ ...base[0], executionState: 'pending' }],
    ]
    expect(parseLocalIntentFallback('actually make it 5').actionPayload).toBeUndefined()
    for (const suffix of suffixes.slice(1)) {
      expect(latestEditableCopilotDraft([...base, ...suffix])).toBeUndefined()
      expect(parseLocalIntentFallback('actually make it 5', undefined, undefined, [...base, ...suffix]).actionPayload).toBeUndefined()
    }
  })

  it('can revise the pending transaction inside session setup, not session settings', () => {
    const result = parseLocalIntentFallback('actually make it 5', undefined, undefined,
      history({ type: 'configure_session', title: '', data: { pendingAction: swap } })).actionPayload
    expect(result).toMatchObject({ type: 'interactive_swap', draftId: 'swap-draft', revision: 3 })
  })

  it('strips unsubmitted cards but preserves receipt and in-flight evidence', () => {
    const base = history(swap)[0]
    const messages = [base, { ...base, isExecutingInline: true },
      { ...base, receipt: { id: 'r', txHash: '0x123', actionType: 'swap' as const, title: '', status: 'PENDING' as const, gasUsdc: 0, settlementLatencyMs: 0, timestamp: 1 } },
      ...history({ type: 'configure_session', title: '', data: { pendingAction: swap } })]
    const result = invalidateCopilotDrafts(messages)
    expect(result[0].actionPayload).toBeUndefined()
    expect(result[1]).toBe(messages[1])
    expect(result[2]).toBe(messages[2])
    expect(result[3].actionPayload).toBeUndefined()
  })

  it('ignores a wrong model action and its inherited fields for a new send', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, message: 'Updated swap.', actionPayload: swap })))
    const result = await queryArcisLLM(`5 USDC gönder ${RECIPIENT}`, undefined, history(swap), snapshot)
    expect(result.actionPayload).toMatchObject({ type: 'interactive_send', revision: 1, data: { amount: 5, tokenSymbol: 'USDC', recipient: RECIPIENT } })
  })

  it('rejects a hallucinated action for a bare amount or a correction with no draft', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, message: 'Prepared swap.', actionPayload: swap })))
    expect((await queryArcisLLM('5 USDC', undefined, history(swap), snapshot)).actionPayload).toBeUndefined()
    expect((await queryArcisLLM('actually make it 5', undefined, [], snapshot)).actionPayload).toBeUndefined()
  })
})
