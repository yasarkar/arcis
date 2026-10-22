// src/hooks/__tests__/copilotPaidReportAgents.test.ts
// The Copilot routes portfolio and vault report queries to the paid analysis agents:
// every paid step is logged with its cost, the running total is reported, and an
// unavailable measurement stops the chain before a second call is charged.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CopilotMessage } from '../../types/marketplace'

const harness = vi.hoisted(() => ({
  states: [] as any[],
  refs: [] as any[],
  stateIndex: 0,
  refIndex: 0,
}))

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: any) => {
    const index = harness.stateIndex++
    if (!(index in harness.states)) {
      harness.states[index] = typeof initial === 'function' ? initial() : initial
    }
    return [
      harness.states[index],
      (update: any) => {
        harness.states[index] = typeof update === 'function' ? update(harness.states[index]) : update
      },
    ]
  },
  useRef: (initial: any) => {
    const index = harness.refIndex++
    if (!(index in harness.refs)) harness.refs[index] = { current: initial }
    return harness.refs[index]
  },
  useEffect: vi.fn(),
  useCallback: (callback: any) => callback,
}))

vi.mock('../../services/sessionKeyService', () => ({
  getSessionKeyConfig: () => ({ isActive: false, expiresAt: 0, autoExecute: false }),
  activateSessionKey: vi.fn(),
  revokeSessionKey: vi.fn(),
  toggleSessionAutoExecute: vi.fn(),
  verifySessionLimits: () => ({ allowed: true }),
  setActiveWalletForSession: vi.fn(),
  SESSION_KEY_UPDATED_EVENT: 'arcis-session-key-updated',
}))
vi.mock('../../services/copilotExecutionService', () => ({ executeDirectCopilotAction: vi.fn() }))
vi.mock('../../services/portfolioContextService', () => ({
  getLivePortfolioSnapshot: vi.fn(async () => ({ liquidUsdc: 100, liquidEurc: 0 })),
  formatPortfolioForPrompt: () => '',
}))
vi.mock('../../services/tokenPriceService', () => ({
  getLiveTokenPrices: vi.fn(async () => ({ USDC: 1 })),
  tokenAmountToUsd: (_symbol: string, amount: number) => amount,
}))
vi.mock('../../services/llmService', () => ({ queryArcisLLM: vi.fn() }))
vi.mock('../../services/gatewayFlowIndexer', async (original) => ({
  ...(await original<typeof import('../../services/gatewayFlowIndexer')>()),
  formatGatewayFlowReport: vi.fn(() => ''),
}))
vi.mock('../../services/x402Client', async (original) => ({
  ...(await original<typeof import('../../services/x402Client')>()),
  executeX402Call: vi.fn(),
}))

import { useArcCopilot } from '../useArcCopilot'
import { executeX402Call } from '../../services/x402Client'
import { isPortfolioAnalysisQuery, isVaultReportQuery } from '../../config/copilotTopics'

const WALLET = '0x1111111111111111111111111111111111111111'

const paidResult = (data: Record<string, any>, costUsdc: number) => ({
  statusCode: 200,
  success: true,
  executionTimeMs: 12,
  costUsdc,
  data,
  payment: {
    status: 'settlement_pending',
    amountUsdc: costUsdc,
    settlementRef: 'circle-ref',
  },
})

const RISK_DATA = {
  status: 'PORTFOLIO_ANALYZED',
  address: WALLET,
  totalUsd: 860,
  concentrationPct: 87.209302,
  stablecoinSharePct: 100,
  gatewayBalanceUsdc: 250,
  holdings: [{ symbol: 'USDC', balance: 750, valueUsd: 750, stablecoin: true }],
  chainExposure: [{ chain: 'Arc_Testnet', valueUsd: 610 }, { chain: 'Base_Sepolia', valueUsd: 250 }],
  riskFlags: ['HIGH_CONCENTRATION'],
  unavailable: [],
  note: 'measured',
}

const ANALYST_DATA = {
  status: 'ANALYSIS_COMPLETE',
  address: WALLET,
  measured: RISK_DATA,
  narrative: {
    headline: 'Stablecoin-heavy portfolio with one dominant holding',
    observations: ['Most measured value sits in stablecoins.'],
    risks: ['A single asset drives most of the exposure.'],
  },
  unavailable: [],
  note: 'narrative contains no figures',
}

const VAULT_DATA = {
  status: 'REPORT_READY',
  address: WALLET,
  measured: {
    shares: '1',
    currentValueUsdc: 1000,
    principalUsdc: 900,
    pendingYieldUsdc: 5,
    unrealizedYieldUsdc: 100,
  },
  narrative: {
    headline: 'Position is above its recorded principal',
    observations: ['Redeemable value exceeds the recorded principal.'],
    risks: ['Reported value depends on the vault share price at read time.'],
  },
  limitations: ['Only the vault principal recorded on-chain is used as a basis.'],
  unavailable: [],
  note: 'not a tax filing',
}

function render(
  wallet: string | undefined = WALLET,
  authSource: 'evm' | 'ucw' = 'evm',
  handlers: Record<string, any> = {}
) {
  harness.stateIndex = 0
  harness.refIndex = 0
  return useArcCopilot(wallet, {} as any, { authSource, ...handlers } as any)
}

function messages(): CopilotMessage[] {
  return render().messages
}

async function query(
  prompt: string,
  wallet: string | undefined = WALLET,
  authSource: 'evm' | 'ucw' = 'evm',
  handlers: Record<string, any> = {}
) {
  await render(wallet, authSource, handlers).executeQuery(prompt)
  await vi.runAllTimersAsync()
}

beforeEach(() => {
  harness.states = []
  harness.refs = []
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.mocked(executeX402Call).mockImplementation(async (service: any) => {
    if (service.id === 'arc-portfolio-risk-exposure') return paidResult(RISK_DATA, 0.004) as any
    if (service.id === 'arc-onchain-portfolio-analyst') return paidResult(ANALYST_DATA, 0.01) as any
    if (service.id === 'arc-vault-yield-tax-report') return paidResult(VAULT_DATA, 0.012) as any
    throw new Error(`unexpected service ${service.id}`)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('paid portfolio analysis intent', () => {
  it('classifies analysis asks but leaves strategy asks on the conversational path', () => {
    expect(isPortfolioAnalysisQuery('Run a portfolio risk analysis on my wallet.')).toBe(true)
    expect(isPortfolioAnalysisQuery('portföy riskimi analiz et')).toBe(true)
    expect(isPortfolioAnalysisQuery('Analyze my wallet portfolio and propose the optimal DeFi yield strategy.')).toBe(false)
  })

  it('buys the measured risk report and then the narrative, reporting both costs', async () => {
    await query('Run a portfolio risk analysis on my wallet.')

    const calls = vi.mocked(executeX402Call).mock.calls
    expect(calls.map(([service]) => service.id)).toEqual([
      'arc-portfolio-risk-exposure',
      'arc-onchain-portfolio-analyst',
    ])
    expect(calls[0][1]).toMatchObject({ address: WALLET, includeGatewayBalance: true })

    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.content).toContain('$860.00')
    expect(final.content).toContain('Stablecoin-heavy portfolio')
    expect(final.content).toContain('HIGH CONCENTRATION')
    expect(final.totalCostUsdc).toBeCloseTo(0.014, 6)
    expect(final.steps?.map((step) => step.status)).toEqual(['completed', 'completed'])
    expect(final.steps?.map((step) => step.costUsdc)).toEqual([0.004, 0.01])
    expect(final.actionPayload?.type).toBe('ai-services')
  })

  it('stops after the risk call when the measurement is unavailable', async () => {
    vi.mocked(executeX402Call).mockResolvedValueOnce(
      paidResult(
        {
          status: 'UNAVAILABLE',
          totalUsd: null,
          holdings: [],
          riskFlags: [],
          unavailable: ['USDC wallet balance'],
          reason: 'Portfolio not computed: no holding could be read.',
        },
        0.004
      ) as any
    )

    await query('portfolio risk analysis with 0x2222222222222222222222222222222222222222')

    expect(executeX402Call).toHaveBeenCalledTimes(1)
    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.content).toContain('USDC wallet balance')
    expect(final.content).toContain('No narrative call was made')
    expect(final.totalCostUsdc).toBeCloseTo(0.004, 6)
  })

  it('does not call a paid service without a connected external EOA', async () => {
    await query('Run a portfolio risk analysis on my wallet.', '')

    expect(executeX402Call).not.toHaveBeenCalled()
    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.content).toMatch(/Connect a wallet/i)
  })

  it('refuses a Circle Wallet session without its challenge signer before charging anything', async () => {
    await query('Run a portfolio risk analysis on my wallet.', WALLET, 'ucw')

    expect(executeX402Call).not.toHaveBeenCalled()
    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.content).toMatch(/external EOA or an active Circle Wallet/i)
  })

  it('pays through a Circle Wallet EOA challenge signer instead of an injected EOA', async () => {
    const signTypedData = vi.fn(async () => ({ success: true, signature: `0x${'ab'.repeat(65)}` }))

    await query('Run a portfolio risk analysis on my wallet.', WALLET, 'ucw', { signTypedData })

    const calls = vi.mocked(executeX402Call).mock.calls
    expect(calls.map(([service]) => service.id)).toEqual([
      'arc-portfolio-risk-exposure',
      'arc-onchain-portfolio-analyst',
    ])
    expect(calls.map(([, , , , kind]) => kind)).toEqual(['ucw_eoa', 'ucw_eoa'])
    expect(calls.every(([, , , , , signer]) => typeof signer === 'function')).toBe(true)

    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.totalCostUsdc).toBeCloseTo(0.014, 6)
  })

  it('renders the institutional envelope and graded register before the narrative', async () => {
    const report = {
      reportId: 'ARX-PRX-20261022-0A1B2C3D',
      dataQuality: { grade: 'A', rationale: '9 of 9 planned reads returned.' },
      coverage: { measuredReads: 9, expectedReads: 9, coveragePct: 100, state: 'COMPLETE' },
      freshness: { state: 'CURRENT', ageSeconds: 0 },
      riskSummary: { highestSeverity: 'HIGH', counts: { CRITICAL: 0, HIGH: 1, MEDIUM: 0, LOW: 0, INFO: 0 } },
      riskRegister: [
        {
          id: 'HIGH_CONCENTRATION',
          category: 'CONCENTRATION',
          severity: 'HIGH',
          title: 'Single-asset concentration above the review threshold',
          finding: 'USDC accounts for 87.209302% of the measured 860 USD total.',
          evidence: { concentrationPct: 87.209302 },
          threshold: 'Largest single-asset share > 50% of the measured total.',
          remediation: 'The report states the measured share.',
          advisoryOnly: true,
        },
      ],
    }

    vi.mocked(executeX402Call)
      .mockImplementationOnce(async () => paidResult({ ...RISK_DATA, report }, 0.004) as any)
      .mockImplementationOnce(async () => paidResult(ANALYST_DATA, 0.01) as any)

    await query('Run a portfolio risk analysis on my wallet.')

    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.content).toContain('ARX-PRX-20261022-0A1B2C3D')
    expect(final.content).toContain('A · 9/9 reads (100%)')
    expect(final.content).toContain('[HIGH] Single-asset concentration above the review threshold')
    expect(final.content).toContain('Threshold: Largest single-asset share > 50%')
    expect(final.content).toContain('Action: The report states the measured share.')
    // Severity and evidence must be readable before the model's prose, not after it.
    expect(final.content.indexOf('Risk register')).toBeLessThan(
      final.content.indexOf('Analyst narrative')
    )
  })
})

describe('paid vault report intent', () => {
  it('classifies report asks but not vault explanations', () => {
    expect(isVaultReportQuery('Generate my vault yield report.')).toBe(true)
    expect(isVaultReportQuery('vault getiri raporumu çıkar')).toBe(true)
    expect(isVaultReportQuery('How does the Real-Yield Vault (af-USDC) earn APY?')).toBe(false)
  })

  it('buys one report and shows measured values, narrative and limitations', async () => {
    await query('Generate my vault yield report.')

    expect(executeX402Call).toHaveBeenCalledTimes(1)
    expect(vi.mocked(executeX402Call).mock.calls[0][0].id).toBe('arc-vault-yield-tax-report')

    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.content).toContain('Redeemable value')
    expect(final.content).toContain('$1,000.00')
    expect(final.content).toContain('Position is above its recorded principal')
    expect(final.content).toContain('not a tax filing')
    expect(final.content).toContain('Only the vault principal')
    expect(final.totalCostUsdc).toBeCloseTo(0.012, 6)
    expect(final.steps?.[0].costUsdc).toBeCloseTo(0.012, 6)
  })

  it('shows the graded position findings when the report carries an envelope', async () => {
    const report = {
      reportId: 'ARX-VPR-20261022-1B2C3D4E',
      dataQuality: { grade: 'A', rationale: '5 of 5 planned reads returned.' },
      coverage: { measuredReads: 5, expectedReads: 5, coveragePct: 100, state: 'COMPLETE' },
      freshness: { state: 'CURRENT', ageSeconds: 0 },
      riskSummary: { highestSeverity: 'INFO', counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 3 } },
      riskRegister: [
        {
          id: 'UNREALIZED_YIELD_UNSETTLED',
          category: 'MARKET_STRUCTURE',
          severity: 'INFO',
          title: 'Measured gain is unrealized',
          finding: 'Redeemable value exceeds principal by 100 USDC.',
          evidence: { unrealizedYieldUsdc: 100 },
          threshold: null,
          remediation: 'The gain is not a settled return.',
          advisoryOnly: true,
        },
      ],
    }

    vi.mocked(executeX402Call).mockResolvedValueOnce(
      paidResult({ ...VAULT_DATA, report }, 0.012) as any
    )

    await query('Generate my vault yield report.')

    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.content).toContain('ARX-VPR-20261022-1B2C3D4E')
    expect(final.content).toContain('[INFO] Measured gain is unrealized')
    expect(final.content).toContain('Redeemable value exceeds principal by 100 USDC.')
  })
})
