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
import type { Recommendation } from '../../services/x402/nextActions'
import {
  buildInstitutionalReport,
  institutionalRisk,
} from '../../services/x402/institutionalReport'
import { executeX402Call } from '../../services/x402Client'
import {
  exploreTopicQuestions,
  isPortfolioAnalysisQuery,
  isVaultAnalyticsQuery,
  isVaultReportQuery,
} from '../../config/copilotTopics'

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

const VAULT_ANALYTICS_DATA = {
  status: 'VAULT_READ',
  windowDays: 30,
  vaultAddress: '0xb2a6D2BF896b431a77FB9198519fE334Caf39e9A',
  totalAssetsUsdc: 250000,
  totalSupplyShares: '237867.75',
  sharePriceUsdc: 1.05,
  tvlUsdc: 250000,
  shareDecimals: 9,
  readAt: 1761234567890,
  unavailable: [],
  limitations: ['No historical series is readable on-chain for this vault, so no APY is computed from windowDays.'],
  note: 'Read from the vault contract.',
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
    if (service.id === 'arc-vault-yield-tax-report') return paidResult(VAULT_DATA, 0.012) as any
    if (service.id === 'arc-yield-vault-analytics') return paidResult(VAULT_ANALYTICS_DATA, 0.002) as any
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

  it('buys the measured risk report, reporting cost', async () => {
    await query('Run a portfolio risk analysis on my wallet.')

    const calls = vi.mocked(executeX402Call).mock.calls
    expect(calls.map(([service]) => service.id)).toEqual([
      'arc-portfolio-risk-exposure',
    ])
    expect(calls[0][1]).toMatchObject({ address: WALLET, includeGatewayBalance: true })

    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.content).toContain('$860.00')
    expect(final.content).toContain('HIGH CONCENTRATION')
    expect(final.totalCostUsdc).toBeCloseTo(0.004, 6)
    expect(final.steps?.map((step) => step.status)).toEqual(['completed'])
    expect(final.steps?.map((step) => step.costUsdc)).toEqual([0.004])
    expect(final.actionPayload?.type).toBe('ai-services')
  })

  it('attaches the next step derived from the report it just bought', async () => {
    const now = Date.now()
    const report = buildInstitutionalReport({
      kind: 'PORTFOLIO_EXPOSURE',
      serviceId: 'arc-portfolio-risk-exposure',
      title: 'Portfolio Risk & Exposure Report',
      subject: { type: 'WALLET', identifier: WALLET },
      issuedAt: now,
      asOf: now,
      coverage: { measuredReads: 6, expectedReads: 7 },
      risks: [
        institutionalRisk({
          id: 'GATEWAY_BALANCE_UNAVAILABLE',
          category: 'DATA_QUALITY',
          severity: 'MEDIUM',
          title: 'Circle Gateway balance was requested but not read',
          finding: 'The Circle Gateway unified balance could not be read.',
          evidence: { gatewayRequested: true },
          threshold: 'A unified total requires a successful Gateway balance read.',
          remediation: 'Retry, or call with includeGatewayBalance=false for an Arc-only total.',
        }),
      ],
      methodology: ['read balances'],
      limitations: ['no history'],
    })
    vi.mocked(executeX402Call).mockResolvedValueOnce(
      paidResult({ ...RISK_DATA, report }, 0.004) as any
    )

    await query('Run a portfolio risk analysis on my wallet.')

    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.nextSteps?.map((step) => step.ruleId)).toEqual(['gateway-scope-fallback'])
    expect(final.nextSteps?.[0].action.params).toMatchObject({
      address: WALLET,
      includeGatewayBalance: false,
    })
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
    expect(final.content).toContain('No charge was incurred on an unmeasured portfolio')
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
    ])
    expect(calls.map(([, , , , kind]) => kind)).toEqual(['ucw_eoa'])
    expect(calls.every(([, , , , , signer]) => typeof signer === 'function')).toBe(true)

    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.totalCostUsdc).toBeCloseTo(0.004, 6)
  })

  it('renders the institutional envelope and graded register', async () => {
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

    await query('Run a portfolio risk analysis on my wallet.')

    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.content).toContain('ARX-PRX-20261022-0A1B2C3D')
    expect(final.content).toContain('A · 9/9 reads (100%)')
    expect(final.content).toContain('[HIGH] Single-asset concentration above the review threshold')
    expect(final.content).toContain('Threshold: Largest single-asset share > 50%')
    expect(final.content).toContain('Action: The report states the measured share.')
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

  it('attaches the impairment cross-check from the report it just bought', async () => {
    const now = Date.now()
    const report = buildInstitutionalReport({
      kind: 'VAULT_POSITION',
      serviceId: 'arc-vault-yield-tax-report',
      title: 'Vault Yield & Tax Report',
      subject: { type: 'WALLET', identifier: WALLET },
      issuedAt: now,
      asOf: now,
      coverage: { measuredReads: 5, expectedReads: 5 },
      risks: [
        institutionalRisk({
          id: 'PRINCIPAL_IMPAIRMENT',
          category: 'COMPOSITION',
          severity: 'HIGH',
          title: 'Redeemable value is below the recorded principal',
          finding: 'Redeemable value is 6% below principal.',
          evidence: { shortfallPct: 6 },
          threshold: 'Shortfall >= 5% is graded HIGH.',
          remediation: 'Review the position against the vault’s own read.',
        }),
      ],
      methodology: ['read vault position'],
      limitations: ['no cost basis'],
    })
    vi.mocked(executeX402Call).mockResolvedValueOnce(
      paidResult({ ...VAULT_DATA, report }, 0.012) as any
    )

    await query('Generate my vault yield report.')

    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.nextSteps?.map((step) => step.ruleId)).toEqual(['vault-impairment-cross-check'])
    expect(final.nextSteps?.[0].action.serviceId).toBe('arc-yield-vault-analytics')
    expect(final.nextSteps?.[0].action.priceUsdc).toBe(0.002)
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

describe('paid vault analytics cross-check', () => {
  const crossCheck = (windowDays: unknown = '30'): Recommendation => ({
    id: 'vault-impairment-cross-check:VAULT:test',
    ruleId: 'vault-impairment-cross-check',
    subject: { type: 'VAULT', identifier: '0xb2a6D2BF896b431a77FB9198519fE334Caf39e9A' },
    tier: 'cross_check',
    severity: 'HIGH',
    title: "Cross-check the vault's own TVL and share price",
    rationale: 'A principal-impairment finding is a claim about the vault economics.',
    triggerSignalIds: ['VAULT_POSITION:PRINCIPAL_IMPAIRMENT'],
    reportIds: ['ARX-VPR-20261022-1B2C3D4E'],
    expiresAt: null,
    action: {
      kind: 'open_service',
      serviceId: 'arc-yield-vault-analytics',
      serviceName: 'USDC Yield Vault Analytics',
      params: { windowDays },
      priceUsdc: 0.002,
    },
  })

  it('classifies vault TVL and share-price asks but not an APY explanation', () => {
    expect(isVaultAnalyticsQuery("What is the vault's TVL right now?")).toBe(true)
    expect(isVaultAnalyticsQuery('How much is one vault share worth?')).toBe(true)
    expect(isVaultAnalyticsQuery('vault pay fiyatı ne kadar')).toBe(true)
    expect(isVaultAnalyticsQuery('How does the Real-Yield Vault (af-USDC) earn APY?')).toBe(false)
    expect(isVaultAnalyticsQuery('Generate my vault yield report.')).toBe(false)
  })

  it('buys the vault read when asked for its TVL, and never for an APY explanation', async () => {
    await query("What is the vault's TVL right now?")

    const calls = vi.mocked(executeX402Call).mock.calls
    expect(calls.map(([service]) => service.id)).toEqual(['arc-yield-vault-analytics'])
    expect(calls[0][1]).toEqual({ windowDays: '30' })

    vi.mocked(executeX402Call).mockClear()
    await query('How does the Real-Yield Vault (af-USDC) earn APY?')
    expect(executeX402Call).not.toHaveBeenCalled()
  })

  it('offers a one-click chip in AI Services whose prompt buys the vault read', async () => {
    const chip = exploreTopicQuestions('ai-services', true).find((question) => /tvl/i.test(question.prompt))
    expect(chip).toBeDefined()
    expect(chip!.title).toContain('TVL')

    await query(chip!.prompt)

    expect(vi.mocked(executeX402Call).mock.calls.map(([service]) => service.id)).toEqual([
      'arc-yield-vault-analytics',
    ])
  })

  it('buys the vault read itself and reports TVL, share price and the window limit', async () => {
    const executed = await render().executeNextStep(crossCheck())
    await vi.runAllTimersAsync()

    expect(executed).toBe(true)
    const calls = vi.mocked(executeX402Call).mock.calls
    expect(calls.map(([service]) => service.id)).toEqual(['arc-yield-vault-analytics'])
    expect(calls[0][1]).toEqual({ windowDays: '30' })

    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.content).toContain('measured from the ERC-4626 vault itself')
    expect(final.content).toContain('$250,000.00')
    expect(final.content).toContain('$1.05')
    expect(final.content).toContain('237867.75 shares (9 decimals)')
    expect(final.content).toContain('30 days — echoed for traceability')
    expect(final.content).toContain('no historical series')
    expect(final.totalCostUsdc).toBeCloseTo(0.002, 6)
    expect(final.steps?.map((step) => step.status)).toEqual(['completed'])
    expect(final.steps?.[0].costUsdc).toBeCloseTo(0.002, 6)
  })

  it('falls back to the 30-day window when a card carries an invalid one', async () => {
    await render().executeNextStep(crossCheck('365'))
    await vi.runAllTimersAsync()

    expect(vi.mocked(executeX402Call).mock.calls[0][1]).toEqual({ windowDays: '30' })
  })

  it('states the empty vault instead of inventing a share price', async () => {
    vi.mocked(executeX402Call).mockResolvedValueOnce(
      paidResult(
        {
          ...VAULT_ANALYTICS_DATA,
          status: 'VAULT_EMPTY',
          totalSupplyShares: '0',
          sharePriceUsdc: null,
        },
        0.002
      ) as any
    )

    await render().executeNextStep(crossCheck())
    await vi.runAllTimersAsync()

    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.content).toContain('no shares are outstanding')
    expect(final.content).toContain('Share price:</strong> unavailable')
  })

  it('does not charge the vault read without a connected wallet', async () => {
    const executed = await render('').executeNextStep(crossCheck())
    await vi.runAllTimersAsync()

    expect(executed).toBe(true)
    expect(executeX402Call).not.toHaveBeenCalled()
    const final = messages().filter((message) => message.role === 'assistant').at(-1)!
    expect(final.content).toMatch(/Connect a wallet/i)
  })
})

describe('paid-service chips behind a connected wallet', () => {
  it('hides only the paid prompts until a wallet is connected', () => {
    const free = exploreTopicQuestions('ai-services', false)
    expect(free.some((question) => question.requiresWallet)).toBe(false)
    expect(free.map((question) => question.id)).not.toContain('arb-8')
    expect(free.map((question) => question.id)).not.toContain('arb-6')
    expect(free.length).toBeGreaterThan(0)

    const connected = exploreTopicQuestions('ai-services', true)
    expect(connected.map((question) => question.id)).toEqual(
      expect.arrayContaining(['arb-6', 'arb-7', 'arb-8'])
    )
    expect(connected.length).toBe(free.length + 3)
  })

  it('returns no questions for a topic that does not exist', () => {
    expect(exploreTopicQuestions('no-such-topic', true)).toEqual([])
  })

  it('offers them only to a session that can actually be charged', () => {
    expect(render().canPayForCalls).toBe(true)
    expect(render('').canPayForCalls).toBe(false)
    expect(render(WALLET, 'ucw').canPayForCalls).toBe(false)

    const signTypedData = vi.fn(async () => ({ success: true, signature: `0x${'ab'.repeat(65)}` }))
    expect(render(WALLET, 'ucw', { signTypedData }).canPayForCalls).toBe(true)
  })
})

describe('executing a next-step card in the chat', () => {
  const recommendation = (overrides: Partial<Recommendation['action']> = {}): Recommendation => ({
    id: 'gateway-scope-fallback:WALLET:test',
    ruleId: 'gateway-scope-fallback',
    subject: { type: 'WALLET', identifier: WALLET },
    tier: 'reparameterize',
    severity: 'MEDIUM',
    title: 'Re-run as an Arc-only total that states its scope',
    rationale: 'The Circle Gateway unified balance could not be read.',
    triggerSignalIds: ['PORTFOLIO_EXPOSURE:GATEWAY_BALANCE_UNAVAILABLE'],
    reportIds: ['ARX-PRX-20261022-ABCDEF12'],
    expiresAt: null,
    action: {
      kind: 'rerun',
      serviceId: 'arc-portfolio-risk-exposure',
      serviceName: 'Portfolio Risk & Exposure Engine',
      params: { address: WALLET, includeGatewayBalance: false },
      priceUsdc: 0.004,
      ...overrides,
    },
  })

  it('re-runs the report with the corrected input the card showed', async () => {
    const executed = await render().executeNextStep(recommendation())
    await vi.runAllTimersAsync()

    expect(executed).toBe(true)
    const calls = vi.mocked(executeX402Call).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0][0].id).toBe('arc-portfolio-risk-exposure')
    expect(calls[0][1]).toEqual({ address: WALLET, includeGatewayBalance: false })
  })

  it('keeps a refresh on the vault flow', async () => {
    const executed = await render().executeNextStep(
      recommendation({
        serviceId: 'arc-vault-yield-tax-report',
        serviceName: 'Vault Yield & Tax Reporter',
        params: { address: WALLET },
        priceUsdc: 0.012,
      })
    )
    await vi.runAllTimersAsync()

    expect(executed).toBe(true)
    const calls = vi.mocked(executeX402Call).mock.calls
    expect(calls.map(([service]) => service.id)).toEqual(['arc-vault-yield-tax-report'])
    expect(calls[0][1]).toEqual({ address: WALLET })
  })

  it('does not spend twice when the card is clicked again mid-flight', async () => {
    const copilot = render()
    const [first, second] = await Promise.all([
      copilot.executeNextStep(recommendation()),
      copilot.executeNextStep(recommendation()),
    ])
    await vi.runAllTimersAsync()

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(executeX402Call).toHaveBeenCalledTimes(1)
  })

  it('only offers in-chat execution for the flows the chat owns', () => {
    const copilot = render()

    expect(copilot.canExecuteNextStep(recommendation())).toBe(true)
    expect(
      copilot.canExecuteNextStep(recommendation({ serviceId: 'arc-vault-yield-tax-report' }))
    ).toBe(true)
    expect(
      copilot.canExecuteNextStep(
        recommendation({
          kind: 'open_service',
          serviceId: 'arc-yield-vault-analytics',
          params: { windowDays: '30' },
        })
      )
    ).toBe(true)
    expect(
      copilot.canExecuteNextStep(
        recommendation({ kind: 'open_service', serviceId: 'arc-cross-chain-gateway-flow-indexer' })
      )
    ).toBe(false)
  })

  it('declines a step the chat has no paid flow for, without spending', async () => {
    const executed = await render().executeNextStep(
      recommendation({
        kind: 'open_service',
        serviceId: 'arc-cross-chain-gateway-flow-indexer',
        serviceName: 'Cross-Chain Gateway Flow Indexer',
        params: { address: WALLET },
        priceUsdc: 0.004,
      })
    )

    expect(executed).toBe(false)
    expect(executeX402Call).not.toHaveBeenCalled()
  })
})
