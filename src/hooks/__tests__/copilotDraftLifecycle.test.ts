import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotMessage } from '../../types/marketplace'

const harness = vi.hoisted(() => ({ states: [] as any[], refs: [] as any[], stateIndex: 0, refIndex: 0, active: false, autoExecute: false }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => {
    const index = harness.stateIndex++
    if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial
    return [harness.states[index], (update: any) => { harness.states[index] = typeof update === 'function' ? update(harness.states[index]) : update }]
  },
  useRef: (initial: any) => {
    const index = harness.refIndex++
    if (!(index in harness.refs)) harness.refs[index] = { current: initial }
    return harness.refs[index]
  },
  useEffect: vi.fn(), // No mounted DOM/session event listener is needed in this orchestration harness.
  useCallback: (callback: any) => callback,
}))
vi.mock('../../services/sessionKeyService', () => ({
  getSessionKeyConfig: () => ({ isActive: harness.active, expiresAt: Date.now() + 100000, autoExecute: harness.autoExecute }),
  activateSessionKey: vi.fn(async () => { harness.active = true; return { isActive: true, expiresAt: Date.now() + 100000 } }),
  verifySessionLimits: () => ({ allowed: true }),
}))
vi.mock('../../services/copilotExecutionService', () => ({ executeDirectCopilotAction: vi.fn(async () => ({ status: 'PENDING' })) }))
vi.mock('../../services/portfolioContextService', () => ({ getLivePortfolioSnapshot: vi.fn(async () => ({ liquidUsdc: 100, liquidEurc: 100 })), formatPortfolioForPrompt: () => '' }))
vi.mock('../../services/tokenPriceService', () => ({ getLiveTokenPrices: vi.fn(async () => ({ USDC: 1, EURC: 1 })), tokenAmountToUsd: (_: string, amount: number) => amount }))
vi.mock('../../services/arcGasService', async original => ({ ...await original<typeof import('../../services/arcGasService')>(),
  getDynamicArcGasOptions: vi.fn(async () => ({ isDynamic: true, maxFeePerGas: 25_000_000_000n })),
}))
vi.mock('../../services/swapService', () => ({ getSwapEstimate: vi.fn(async () => ({ estimatedOutput: '9', stopLimit: '8', rate: '0.9' })) }))

import { useArcCopilot } from '../useArcCopilot'
import { executeDirectCopilotAction } from '../../services/copilotExecutionService'
import { getLivePortfolioSnapshot } from '../../services/portfolioContextService'

function render() {
  harness.stateIndex = 0
  harness.refIndex = 0
  return useArcCopilot()
}
function messages(): CopilotMessage[] { return render().messages }
async function query(prompt: string) {
  await render().executeQuery(prompt)
  await vi.runAllTimersAsync()
}
const RECIPIENT = '0x2222222222222222222222222222222222222222'
beforeEach(() => {
  harness.states = []; harness.refs = []; harness.active = false; harness.autoExecute = false
  vi.clearAllMocks(); vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, message: 'Prepared.' })))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('A02 hook draft lifecycle before any signer', () => {
  it('never calls the executor for negative or read-only commands even with auto-execute enabled', async () => {
    harness.active = true; harness.autoExecute = true
    for (const prompt of [`send 5 USDC to ${RECIPIENT} yapma`, 'örnek: deposit 5 USDC', 'swap 5 USDC to EURC?']) await query(prompt)
    expect(executeDirectCopilotAction).not.toHaveBeenCalled()
    expect(getLivePortfolioSnapshot).not.toHaveBeenCalled()
  })

  it('cancels an in-flight model response before it can auto-execute', async () => {
    harness.active = true; harness.autoExecute = true
    let resolveResponse!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { resolveResponse = resolve })))
    const pending = render().executeQuery('deposit 10 USDC')
    for (let i = 0; i < 20 && !resolveResponse; i++) await Promise.resolve()
    expect(resolveResponse).toBeTypeOf('function')
    await render().executeQuery('cancel')
    resolveResponse(Response.json({ success: true, message: 'Prepared.' }))
    await pending
    await vi.runAllTimersAsync()
    expect(executeDirectCopilotAction).not.toHaveBeenCalled()
    expect(messages().some(m => m.actionPayload?.type === 'interactive_deposit')).toBe(false)
  })
  it('cancels a pending session transaction and never resumes it after activation', async () => {
    await query('swap 10 USDC to EURC')
    expect(messages().some(m => m.actionPayload?.data?.pendingAction)).toBe(true)
    const calls = vi.mocked(getLivePortfolioSnapshot).mock.calls.length
    await query('iptal et')
    expect(vi.mocked(getLivePortfolioSnapshot).mock.calls).toHaveLength(calls)
    expect(messages().some(m => m.actionPayload?.data?.pendingAction)).toBe(false)
    await render().activateSession({ userApproved: true })
    await vi.runAllTimersAsync()
    expect(messages().some(m => m.id.startsWith('assistant-resume-'))).toBe(false)
    expect(executeDirectCopilotAction).not.toHaveBeenCalled()
  })

  it('replaces a swap with a new send and refuses stale swap clicks', async () => {
    harness.active = true
    await query('swap 10 USDC to EURC')
    const old = messages().find(m => m.actionPayload?.type === 'interactive_swap')!
    await query(`5 USDC gönder ${RECIPIENT}`)
    expect(messages().find(m => m.id === old.id)?.actionPayload).toBeUndefined()
    const current = messages().find(m => m.actionPayload?.type === 'interactive_send')!
    expect(current.actionPayload?.data?.amount).toBe(5)
    await render().executeInlineAction(old.id, old.actionPayload!)
    expect(executeDirectCopilotAction).not.toHaveBeenCalled()
    await render().executeInlineAction(current.id, current.actionPayload!)
    expect(executeDirectCopilotAction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(executeDirectCopilotAction).mock.calls[0][0].type).toBe('interactive_send')
  })

  it('revises a pending session draft instead of silently retaining the old amount', async () => {
    await query('deposit 10 USDC')
    await query('actually make it 5')
    const drafts = messages().filter(m => m.actionPayload?.data?.pendingAction)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].actionPayload?.data?.pendingAction).toMatchObject({ type: 'interactive_deposit', revision: 2, data: { amount: 5 } })
    await render().activateSession({ userApproved: true })
    await vi.runAllTimersAsync()
    expect(messages().find(m => m.id.startsWith('assistant-resume-'))?.actionPayload?.data?.amount).toBe(5)
    expect(executeDirectCopilotAction).not.toHaveBeenCalled()
  })

  it('cannot resurrect a card that is still streaming when canceled', async () => {
    harness.active = true
    await render().executeQuery('deposit 10 USDC')
    expect(messages().some(m => m.isStreaming)).toBe(true)
    await render().executeQuery('cancel')
    await vi.runAllTimersAsync()
    expect(messages().some(m => m.actionPayload?.type === 'interactive_deposit')).toBe(false)
    expect(executeDirectCopilotAction).not.toHaveBeenCalled()
  })
})
