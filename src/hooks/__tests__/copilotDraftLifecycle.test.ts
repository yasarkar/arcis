import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotMessage } from '../../types/marketplace'

const harness = vi.hoisted(() => ({
  states: [] as any[],
  refs: [] as any[],
  effects: [] as Array<() => void | (() => void)>,
  stateIndex: 0,
  refIndex: 0,
  active: false,
  autoExecute: false,
  limitCheck: { allowed: true } as { allowed: boolean; reason?: string },
}))
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
  useEffect: vi.fn((fn: () => void | (() => void)) => { harness.effects.push(fn) }),
  useCallback: (callback: any) => callback,
}))
vi.mock('../../services/sessionKeyService', () => ({
  getSessionKeyConfig: () => ({ isActive: harness.active, expiresAt: Date.now() + 100000, autoExecute: harness.autoExecute }),
  activateSessionKey: vi.fn(async () => { harness.active = true; return { isActive: true, expiresAt: Date.now() + 100000 } }),
  verifySessionLimits: () => harness.limitCheck,
  setActiveWalletForSession: vi.fn(),
  COPILOT_SESSION_UPDATED_EVENT: 'arcis_copilot_session_updated',
  SESSION_KEY_UPDATED_EVENT: 'arcis_session_key_updated',
}))
vi.mock('../../services/copilotExecutionService', () => ({ executeDirectCopilotAction: vi.fn(async () => ({ status: 'PENDING' })) }))
vi.mock('../../services/portfolioContextService', () => ({ getLivePortfolioSnapshot: vi.fn(async () => ({ liquidUsdc: 100, liquidEurc: 100 })), formatPortfolioForPrompt: () => '' }))
vi.mock('../../services/tokenPriceService', () => ({ getLiveTokenPrices: vi.fn(async () => ({ USDC: 1, EURC: 1 })), tokenAmountToUsd: (_: string, amount: number) => amount }))
vi.mock('../../services/arcGasService', async original => ({ ...await original<typeof import('../../services/arcGasService')>(),
  getDynamicArcGasOptions: vi.fn(async () => ({ isDynamic: true, maxFeePerGas: 25_000_000_000n, source: 'rpc' })),
}))
vi.mock('../../services/swapService', () => ({ getSwapEstimate: vi.fn(async () => ({ estimatedOutput: '9', stopLimit: '8', rate: '0.9' })) }))
vi.mock('../../services/copilot/copilotLpRemoveQuote', () => ({
  getCopilotLpRemoveQuote: vi.fn(async ({ slippageBps = 50, removePercent = 50 }: any) => ({
    ok: true,
    quote: {
      removeMode: 'percent',
      removePercent,
      lpAmount: 10,
      lpAmountDecimal: '10',
      lpAmountRaw: '10000000',
      userLpBalanceDecimal: '20',
      estimatedOutA: '100',
      estimatedOutB: '100',
      minOutA: String(100 * (1 - slippageBps / 10_000)),
      minOutB: String(100 * (1 - slippageBps / 10_000)),
      minOutARaw: String(Math.round(100_000_000 * (1 - slippageBps / 10_000))),
      minOutBRaw: String(Math.round(100_000_000 * (1 - slippageBps / 10_000))),
      estimatedWithdrawUsd: 200,
      slippageBps,
      estimatedFeeUsdc: slippageBps >= 150 ? '0.00450' : '0.00300',
      feeEstimateSource: 'rpc',
    },
  })),
  scanActiveCopilotLpPositions: vi.fn(async () => []),
}))
vi.mock('../../services/copilot/copilotClaimQuote', () => ({
  scanClaimableCopilotFees: vi.fn(async () => ({
    ok: true,
    pools: [{ poolId: 'usdc-eurc-stable-pool', poolName: 'USDC / EURC', amountUsd: 5.25 }],
    totalClaimableUsd: 5.25,
    estimatedFeeUsdc: '0.00300',
    feeEstimateSource: 'rpc',
  })),
}))

import { useArcCopilot } from '../useArcCopilot'
import '../../services/llmService'
import { executeDirectCopilotAction } from '../../services/copilotExecutionService'
import { getLivePortfolioSnapshot } from '../../services/portfolioContextService'
import { getDynamicArcGasOptions } from '../../services/arcGasService'
import { WALLET_SETTINGS_CHANGED_EVENT, walletSettingsService } from '../../services/walletSettingsService'

function render(walletAddress?: string) {
  harness.stateIndex = 0
  harness.refIndex = 0
  harness.effects = []
  return useArcCopilot(walletAddress)
}
function messages(walletAddress?: string): CopilotMessage[] { return render(walletAddress).messages }
async function query(prompt: string, walletAddress?: string) {
  await render(walletAddress).executeQuery(prompt)
  await vi.runAllTimersAsync()
}
const RECIPIENT = '0x2222222222222222222222222222222222222222'
const WALLET = '0x1111111111111111111111111111111111111111'
beforeEach(() => {
  harness.states = []; harness.refs = []; harness.effects = []; harness.active = false; harness.autoExecute = false; harness.limitCheck = { allowed: true }
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

  it('answers explore topic questions with educational content rather than no-transaction error', async () => {
    await query('What is Arcis and what makes it unique on Arc L1?')
    const lastMsg = messages()[messages().length - 1]
    expect(lastMsg.role).toBe('assistant')
    expect(lastMsg.content).toContain('Arcis Protocol is a next-generation decentralized capital')
    expect(lastMsg.content).not.toContain('No transaction prepared')

    await query('How do I connect my wallet and get started with 0 ETH gas?')
    const connectMsg = messages()[messages().length - 1]
    expect(connectMsg.role).toBe('assistant')
    expect(connectMsg.content).toContain('Connect Your Web3 Wallet')
    expect(connectMsg.content).not.toContain('/faucet')
    expect(connectMsg.content).not.toContain('No transaction prepared')

    await query('How do I bring USDC from Ethereum, Base, or Solana to Arc?')
    const bridgeMsg = messages()[messages().length - 1]
    expect(bridgeMsg.role).toBe('assistant')
    expect(bridgeMsg.content).toContain('Circle Gateway')
    expect(bridgeMsg.content).not.toContain('/gateway')
    expect(bridgeMsg.content).not.toContain('No transaction prepared')

    await query('What core DeFi modules can I explore on Arcis?')
    const modulesMsg = messages()[messages().length - 1]
    expect(modulesMsg.role).toBe('assistant')
    expect(modulesMsg.content).toContain('Smart DEX Router')
    expect(modulesMsg.content).not.toContain('No transaction prepared')

    await query('What can I do directly through Ask Arco copilot?')
    const arcoMsg = messages()[messages().length - 1]
    expect(arcoMsg.role).toBe('assistant')
    expect(arcoMsg.content).toContain('autonomous DeFi copilot')
    expect(arcoMsg.content).toContain('/add-lp')
    expect(arcoMsg.content).not.toContain('/faucet')
    expect(arcoMsg.content).not.toContain('/settings')
    expect(arcoMsg.content).not.toContain('No transaction prepared')

    await query('Why does Arc L1 use USDC as the native gas token?')
    const whyMsg = messages()[messages().length - 1]
    expect(whyMsg.role).toBe('assistant')
    expect(whyMsg.content).toContain('native gas currency instead of ETH')
    expect(whyMsg.content).not.toContain('No transaction prepared')

    // Swapping questions
    await query('How do token swaps work on Arcis DEX router?')
    const swapWorkMsg = messages()[messages().length - 1]
    expect(swapWorkMsg.role).toBe('assistant')
    expect(swapWorkMsg.content).toContain('Step-by-Step Swap Process')
    expect(swapWorkMsg.actionPayload).toBeUndefined()

    await query('Which tokens are supported for swapping on Arc L1?')
    const tokensMsg = messages()[messages().length - 1]
    expect(tokensMsg.role).toBe('assistant')
    expect(tokensMsg.content).toContain('cirBTC')
    expect(tokensMsg.content).toContain('WETH')
    expect(tokensMsg.actionPayload).toBeUndefined()

    await query('What are the trading fees and gas costs for swaps on Arc?')
    const feesMsg = messages()[messages().length - 1]
    expect(feesMsg.role).toBe('assistant')
    expect(feesMsg.content).toContain('Liquidity Provider (LP) Fee')
    expect(feesMsg.content).toContain('0.12%')
    expect(feesMsg.content).toContain('0.25%')
    expect(feesMsg.content).not.toContain('0.05%')
    expect(feesMsg.actionPayload).toBeUndefined()

    await query('How do I send tokens on Arc L1?')
    const sendFaqMsg = messages()[messages().length - 1]
    expect(sendFaqMsg.role).toBe('assistant')
    expect(sendFaqMsg.content).toContain('WETH')
    expect(sendFaqMsg.content).toContain('cirBTC')

    await query('How can developers list and monetize their own AI models on Arcis?')
    const devFaqMsg = messages()[messages().length - 1]
    expect(devFaqMsg.role).toBe('assistant')
    expect(devFaqMsg.content).toContain('treasury')
    expect(devFaqMsg.content).not.toContain('no USDC payout is sent')

    await query('Is Arcis non-custodial and secure?')
    const secFaqMsg = messages()[messages().length - 1]
    expect(secFaqMsg.role).toBe('assistant')
    expect(secFaqMsg.content).toContain('EIP-3009')
    expect(secFaqMsg.content).not.toContain('x402 calls are disabled')

    await query('How does split-routing protect large trades from slippage?')
    const splitMsg = messages()[messages().length - 1]
    expect(splitMsg.role).toBe('assistant')
    expect(splitMsg.content).toContain('Multi-Pool Liquidity Scanning')
    expect(splitMsg.actionPayload).toBeUndefined()

    await query('How do I customize slippage tolerance and execute fast swaps via Ask Arco?')
    const slipMsg = messages()[messages().length - 1]
    expect(slipMsg.role).toBe('assistant')
    expect(slipMsg.content).toContain('Set Slippage Tolerance')
    expect(slipMsg.actionPayload).toBeUndefined()

    // Yield & Pools questions
    await query('How does the Real-Yield Vault (af-USDC) earn ~8.42% APY?')
    const vaultApyMsg = messages()[messages().length - 1]
    expect(vaultApyMsg.role).toBe('assistant')
    expect(vaultApyMsg.content).toContain('Revenue Pillars')
    expect(vaultApyMsg.actionPayload).toBeUndefined()

    await query('What is af-USDC and are there any lockup periods or withdrawal fees?')
    const afUsdcMsg = messages()[messages().length - 1]
    expect(afUsdcMsg.role).toBe('assistant')
    expect(afUsdcMsg.content).toContain('Zero Lockup Periods')
    expect(afUsdcMsg.actionPayload).toBeUndefined()

    await query('How do I deposit USDC to start earning streaming compound yield?')
    const depMsg = messages()[messages().length - 1]
    expect(depMsg.role).toBe('assistant')
    expect(depMsg.content).toContain('How to Deposit')
    expect(depMsg.actionPayload).toBeUndefined()

    await query('How do the Yield options compare (Single-Sided Vault vs LP Pools)?')
    const compareMsg = messages()[messages().length - 1]
    expect(compareMsg.role).toBe('assistant')
    expect(compareMsg.content).toContain('Zero Impermanent Loss')
    expect(compareMsg.actionPayload).toBeUndefined()
  })

  it('processes /strategy command and portfolio analysis with chief strategist breakdown instead of no-transaction error', async () => {
    // 1. Through mocked backend API
    await query('/strategy')
    const strategyMsg = messages()[messages().length - 1]
    expect(strategyMsg.role).toBe('assistant')
    expect(strategyMsg.content).not.toContain('No transaction prepared')
    expect(strategyMsg.content).toBe('Prepared.')

    await query('Analyze my wallet portfolio and propose the optimal DeFi yield strategy.')
    const analysisMsg = messages()[messages().length - 1]
    expect(analysisMsg.role).toBe('assistant')
    expect(analysisMsg.content).not.toContain('No transaction prepared')
    expect(analysisMsg.content).toBe('Prepared.')

    // 2. Through local NLP fallback when backend API is unavailable
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('API down') }))
    await query('/strategy')
    const localStrategyMsg = messages()[messages().length - 1]
    expect(localStrategyMsg.role).toBe('assistant')
    expect(localStrategyMsg.content).not.toContain('No transaction prepared')
    expect(localStrategyMsg.content).toContain('Portfolio')
    expect(localStrategyMsg.actionPayload?.type).toBe('interactive_deposit')
    expect(localStrategyMsg.actionPayload?.data?.amount).toBe(35)
  })

  it('always presents the Confirm card template for swap and send even when autoExecute is enabled', async () => {
    harness.active = true
    harness.autoExecute = true

    await query('swap 10 USDC to EURC')
    const swapMsg = messages()[messages().length - 1]
    expect(swapMsg.actionPayload?.type).toBe('interactive_swap')
    expect(swapMsg.isExecutingInline).toBeFalsy()
    expect(executeDirectCopilotAction).not.toHaveBeenCalled()

    await query(`send 5 USDC to ${RECIPIENT}`)
    const sendMsg = messages()[messages().length - 1]
    expect(sendMsg.actionPayload?.type).toBe('interactive_send')
    expect(sendMsg.isExecutingInline).toBeFalsy()
    expect(executeDirectCopilotAction).not.toHaveBeenCalled()
  })

  it('warns immediately when maxPerTxUsdc is exceeded instead of showing a Confirm card first', async () => {
    harness.active = true
    harness.autoExecute = true
    harness.limitCheck = {
      allowed: false,
      reason: 'Amount (100 USDC) exceeds single-transaction cap (50 USDC).',
    }

    await query(`send 100 USDC to ${RECIPIENT}`)
    const limitMsg = messages()[messages().length - 1]
    expect(limitMsg.content).toContain('exceeds single-transaction cap')
    expect(limitMsg.actionPayload?.type).toBe('configure_session')
    expect(limitMsg.actionPayload?.data?.pendingAction?.type).toBe('interactive_send')
    expect(messages().some((m) => m.actionPayload?.type === 'interactive_send')).toBe(false)
    expect(executeDirectCopilotAction).not.toHaveBeenCalled()
  })

  it('advances draft revision when retrying a CANCELED or FAILED card and refuses retries after SUCCESS/PENDING (ARCO-04)', async () => {
    harness.active = true
    await query(`send 5 USDC to ${RECIPIENT}`)
    const initialMsg = messages().find((m) => m.actionPayload?.type === 'interactive_send')!
    const draftId = initialMsg.actionPayload!.draftId
    expect(initialMsg.actionPayload?.revision).toBe(1)

    // Attempt 1: user cancels in wallet
    vi.mocked(executeDirectCopilotAction).mockResolvedValueOnce({
      id: 'rcpt_cancel',
      actionType: 'send',
      title: 'Send Canceled',
      status: 'CANCELED',
      txHash: '',
      gasUsdc: 0,
      settlementLatencyMs: 10,
      timestamp: Date.now(),
      errorMessage: 'User rejected request.',
    } as any)
    await render().executeInlineAction(initialMsg.id, initialMsg.actionPayload!)
    expect(vi.mocked(executeDirectCopilotAction)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(executeDirectCopilotAction).mock.calls[0][0]).toMatchObject({ draftId, revision: 1 })

    // Attempt 2 ("Try Again"): advances revision to 2 so session spend ledger admits a fresh reservation
    const afterCancel = messages().find((m) => m.id === initialMsg.id)!
    expect(afterCancel.receipt?.status).toBe('CANCELED')
    vi.mocked(executeDirectCopilotAction).mockResolvedValueOnce({
      id: 'rcpt_fail',
      actionType: 'send',
      title: 'Send Failed',
      status: 'FAILED',
      txHash: '',
      gasUsdc: 0,
      settlementLatencyMs: 10,
      timestamp: Date.now(),
      errorMessage: 'Temporary RPC failure.',
    } as any)
    await render().executeInlineAction(afterCancel.id, afterCancel.actionPayload!)
    expect(vi.mocked(executeDirectCopilotAction)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(executeDirectCopilotAction).mock.calls[1][0]).toMatchObject({ draftId, revision: 2 })

    // Attempt 3 ("Try Again" after FAILED): advances revision to 3 and succeeds
    const afterFail = messages().find((m) => m.id === initialMsg.id)!
    expect(afterFail.receipt?.status).toBe('FAILED')
    expect(afterFail.actionPayload?.revision).toBe(2)
    vi.mocked(executeDirectCopilotAction).mockResolvedValueOnce({
      id: 'rcpt_ok',
      actionType: 'send',
      title: 'Send Completed Successfully',
      status: 'SUCCESS',
      txHash: `0x${'b'.repeat(64)}`,
      gasUsdc: 0.001,
      settlementLatencyMs: 420,
      timestamp: Date.now(),
    } as any)
    await render().executeInlineAction(afterFail.id, afterFail.actionPayload!)
    expect(vi.mocked(executeDirectCopilotAction)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(executeDirectCopilotAction).mock.calls[2][0]).toMatchObject({ draftId, revision: 3 })

    // Attempt 4: after SUCCESS, currentDraftRef is cleared so clicking again must NOT re-execute
    const afterSuccess = messages().find((m) => m.id === initialMsg.id)!
    expect(afterSuccess.receipt?.status).toBe('SUCCESS')
    await render().executeInlineAction(afterSuccess.id, afterSuccess.actionPayload!)
    expect(vi.mocked(executeDirectCopilotAction)).toHaveBeenCalledTimes(3)
  })

  it('live-syncs interactive_lp_remove and interactive_claim_fees drafts when WALLET_SETTINGS_CHANGED_EVENT fires (ARCO-06)', async () => {
    const winTarget = new EventTarget()
    vi.stubGlobal('window', {
      addEventListener: winTarget.addEventListener.bind(winTarget),
      removeEventListener: winTarget.removeEventListener.bind(winTarget),
      dispatchEvent: winTarget.dispatchEvent.bind(winTarget),
    })
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })

    const slippageSpy = vi.spyOn(walletSettingsService, 'getCopilotSlippage').mockReturnValue(0.5)
    const speedSpy = vi.spyOn(walletSettingsService, 'getCopilotSpeedTier').mockReturnValue('standard')

    render(WALLET)
    const cleanups: Array<() => void> = []
    for (const effect of harness.effects) {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    }

    try {
      // 1. Active interactive_lp_remove card must sync when slippage + speed tier change
      await query('remove 50% LP from USDC/EURC', WALLET)
      const beforeRemove = messages(WALLET).find((m) => m.actionPayload?.type === 'interactive_lp_remove')
      expect(beforeRemove?.actionPayload?.data?.slippageBps).toBe(50)
      expect(beforeRemove?.actionPayload?.data?.minOutA).toBe('99.5')

      slippageSpy.mockReturnValue(1.5)
      speedSpy.mockReturnValue('turbo')
      winTarget.dispatchEvent(new CustomEvent(WALLET_SETTINGS_CHANGED_EVENT, { detail: { walletAddress: WALLET } }))
      await Promise.resolve()
      await Promise.resolve()

      const afterRemove = messages(WALLET).find((m) => m.id === beforeRemove!.id)
      expect(afterRemove?.actionPayload?.data?.slippageBps).toBe(150)
      expect(afterRemove?.actionPayload?.data?.minOutA).toBe('98.5')
      expect(afterRemove?.actionPayload?.data?.estimatedFeeUsdc).toBe('0.00450')

      // 2. Active interactive_claim_fees card must sync gas fee when speed tier changes
      await query('claim all fees', WALLET)
      const beforeClaim = messages(WALLET).find((m) => m.actionPayload?.type === 'interactive_claim_fees')
      expect(beforeClaim?.actionPayload?.data?.estimatedFeeUsdc).toBe('0.00300')

      vi.mocked(getDynamicArcGasOptions).mockResolvedValueOnce({
        isDynamic: true,
        maxFeePerGas: 40_000_000_000n,
        source: 'rpc',
      } as any)
      winTarget.dispatchEvent(new CustomEvent(WALLET_SETTINGS_CHANGED_EVENT, { detail: { walletAddress: WALLET } }))
      await Promise.resolve()
      await Promise.resolve()

      const afterClaim = messages(WALLET).find((m) => m.id === beforeClaim!.id)
      expect(afterClaim?.actionPayload?.data?.estimatedFeeUsdc).toBe('0.00480')
    } finally {
      cleanups.forEach((fn) => fn())
      slippageSpy.mockRestore()
      speedSpy.mockRestore()
    }
  })

  it('preserves the active draft when a correction is invalid and allows a follow-up valid correction (ARCO-08)', async () => {
    harness.active = true
    await query('deposit 10 USDC')
    const initialMsg = messages().find((m) => m.actionPayload?.type === 'interactive_deposit')!
    const initialDraftId = initialMsg.actionPayload!.draftId
    expect(initialMsg.actionPayload?.data?.amount).toBe(10)

    // Invalid corrections must NOT wipe the existing valid draft
    await query('değiştir')
    expect(messages().find((m) => m.id === initialMsg.id)?.actionPayload?.data?.amount).toBe(10)

    await query('actually make it -5')
    expect(messages().find((m) => m.id === initialMsg.id)?.actionPayload?.data?.amount).toBe(10)

    // A subsequent valid correction still finds and revises the preserved draft
    await query('actually make it 5')
    expect(messages().find((m) => m.id === initialMsg.id)?.actionPayload).toBeUndefined()
    const revisedMsg = messages().find((m) => m.actionPayload?.type === 'interactive_deposit')!
    expect(revisedMsg.actionPayload).toMatchObject({
      type: 'interactive_deposit',
      draftId: initialDraftId,
      revision: 2,
      data: { amount: 5 },
    })

    // Confirming the revised draft executes cleanly
    await render().executeInlineAction(revisedMsg.id, revisedMsg.actionPayload!)
    expect(executeDirectCopilotAction).toHaveBeenCalledTimes(1)
    expect(vi.mocked(executeDirectCopilotAction).mock.calls[0][0]).toMatchObject({
      draftId: initialDraftId,
      revision: 2,
      data: { amount: 5 },
    })
  })

  it('wires AbortController signal to /api/copilot fetch and aborts cleanly on cancel without emitting an error reply (ARCO-10)', async () => {
    harness.active = true
    let capturedSignal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: any, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          capturedSignal?.addEventListener('abort', () => {
            const abortErr = new Error('Aborted')
            abortErr.name = 'AbortError'
            reject(abortErr)
          })
        })
      })
    )

    const pending = render().executeQuery('deposit 10 USDC')
    for (let i = 0; i < 20 && !capturedSignal; i++) await Promise.resolve()
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(capturedSignal?.aborted).toBe(false)

    await render().executeQuery('cancel')
    expect(capturedSignal?.aborted).toBe(true)

    await pending
    await vi.runAllTimersAsync()

    // Must not emit an "error processing your query" message or prepare the canceled draft
    expect(messages().some((m) => m.content.includes('encountered an error'))).toBe(false)
    expect(messages().some((m) => m.actionPayload?.type === 'interactive_deposit')).toBe(false)
  })

  it('flushes an active typewriter stream when a follow-up correction arrives mid-stream so the draft stays editable (ARCO-13)', async () => {
    harness.active = true
    // Start deposit 10 USDC without advancing timers so the assistant reply is still mid-stream
    await render().executeQuery('deposit 10 USDC')
    expect(messages().some((m) => m.isStreaming)).toBe(true)

    // Immediately send a correction while the first reply is still streaming
    await render().executeQuery('actually make it 5')
    await vi.runAllTimersAsync()

    const all = messages()
    expect(all.some((m) => m.isStreaming)).toBe(false)
    const revised = all.find((m) => m.actionPayload?.type === 'interactive_deposit')
    expect(revised?.actionPayload).toMatchObject({
      type: 'interactive_deposit',
      revision: 2,
      data: { amount: 5 },
    })
  })
})
