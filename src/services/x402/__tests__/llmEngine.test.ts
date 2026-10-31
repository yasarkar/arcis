// Tests for the paid `llm` engine: a missing key, provider failure, timeout or any
// model-generated figure must produce UNAVAILABLE — never a narrative.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  generateLlmNarrative,
  getOutputTokenBudget,
  getServerLlmKey,
  isLlmConfigured,
  parseNarrative,
} from '../llmEngine'

const KEY = 'sk-testserverkey0123456789'

const facts = { totalUsd: 860, concentrationPct: 58.14, riskFlags: ['HIGH_CONCENTRATION'] }

function okResponse(content: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
      usage: { prompt_tokens: 120, completion_tokens: 60 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('x402 llm engine — configuration', () => {
  it('treats a missing or placeholder key as unconfigured', () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    expect(isLlmConfigured()).toBe(false)
    expect(getServerLlmKey()).toBe('')

    vi.stubEnv('OPENROUTER_API_KEY', 'your_openrouter_key')
    expect(isLlmConfigured()).toBe(false)

    vi.stubEnv('OPENROUTER_API_KEY', KEY)
    expect(isLlmConfigured()).toBe(true)
  })

  it('returns UNAVAILABLE without calling the provider when no key is configured', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateLlmNarrative({
      serviceId: 'arc-vault-yield-tax-report',
      systemPrompt: 'system',
      facts,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.unavailable.join(' ')).toMatch(/credential/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('respects OPENROUTER_MODEL when using OpenRouter credentials', async () => {
    const OPENROUTER_KEY = 'sk-or-v1-abcdef1234567890abcdef1234567890'
    vi.stubEnv('OPENROUTER_API_KEY', OPENROUTER_KEY)
    vi.stubEnv('OPENROUTER_MODEL', 'anthropic/claude-3.5-haiku')
    const fetchMock = vi.fn(async () => okResponse({
      headline: 'Balanced portfolio',
      observations: ['Observation one.'],
      risks: ['Risk one.'],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateLlmNarrative({
      serviceId: 'arc-vault-yield-tax-report',
      systemPrompt: 'system prompt',
      facts,
    })

    expect(result.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toContain('openrouter.ai')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('anthropic/claude-3.5-haiku')
  })
})

describe('x402 llm engine — narrative contract', () => {
  it('accepts a qualitative narrative and sends measured facts only as the user message', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', KEY)
    const fetchMock = vi.fn(async () => okResponse({
      headline: 'Stablecoin-heavy portfolio with one dominant holding',
      observations: ['Most of the measured value sits in stablecoins.', 'One holding dominates the total.'],
      risks: ['A single asset drives most of the exposure.'],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateLlmNarrative({
      serviceId: 'arc-vault-yield-tax-report',
      systemPrompt: 'fixed system prompt',
      facts,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.narrative.headline).toContain('Stablecoin-heavy')
      expect(result.narrative.observations).toHaveLength(2)
      expect(result.usage.promptTokens).toBe(120)
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(url)).toContain('openrouter.ai')
    const body = JSON.parse(String(init.body))
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` })
    expect(body.tools).toBeUndefined()
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.max_tokens).toBeGreaterThan(0)
    expect(body.messages[0].content).toBe('fixed system prompt')
    expect(body.messages[1].content).toContain('"totalUsd":860')
  })

  it('rejects a narrative that contains a model-generated figure', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', KEY)
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({
      headline: 'Portfolio worth 860 USDC',
      observations: ['Most value is stablecoins.'],
      risks: ['Concentration is high.'],
    })))

    const result = await generateLlmNarrative({
      serviceId: 'arc-vault-yield-tax-report',
      systemPrompt: 'system',
      facts,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.unavailable.join(' ')).toMatch(/no-number schema/i)
      // The key must never appear in a caller-visible reason.
      expect(JSON.stringify(result)).not.toContain(KEY)
    }
  })

  it('rejects malformed JSON and addresses', () => {
    expect(parseNarrative('not json')).toBeNull()
    expect(parseNarrative(JSON.stringify({ headline: 'ok', observations: ['ok'], risks: [] }))).not.toBeNull()
    expect(parseNarrative(JSON.stringify({ headline: 'send to 0xabc', observations: ['x'], risks: [] }))).toBeNull()
    // Non-ASCII digits are figures too.
    expect(parseNarrative(JSON.stringify({ headline: 'Portföy ٨٦٠', observations: ['x'], risks: [] }))).toBeNull()
    expect(parseNarrative(JSON.stringify({ headline: 'ok', observations: [], risks: [] }))).toBeNull()
  })

  it('names an exhausted output budget when a reasoning model stops before writing anything', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', KEY)
    vi.stubEnv('X402_LLM_MAX_OUTPUT_TOKENS', '400')
    // Shape measured against `deepseek/deepseek-v4.1-flash` on OpenRouter: every completion token
    // went to hidden reasoning, the message content is null and finish_reason is "length".
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({
        choices: [{ message: { content: null }, finish_reason: 'length' }],
        usage: { prompt_tokens: 335, completion_tokens: 400, completion_tokens_details: { reasoning_tokens: 400 } },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    ))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateLlmNarrative({
      serviceId: 'arc-vault-yield-tax-report',
      systemPrompt: 'system',
      facts,
    })

    expect(result.ok).toBe(false)
    // Two attempts: one call, then the single retry an exhausted budget earns.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    if (!result.ok) {
      expect(result.reason).toMatch(/whole 400-token completion budget/)
      expect(result.reason).toMatch(/400 reasoning tokens/)
      expect(result.reason).toMatch(/2 attempt\(s\)/)
      expect(result.reason).toMatch(/X402_LLM_MAX_OUTPUT_TOKENS/)
      expect(result.unavailable.join(' ')).toMatch(/output budget/i)
      // The old wording sent operators to the prompt; the real cause is the model choice.
      expect(result.reason).not.toMatch(/schema/i)
    }
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('retries once when the budget is exhausted and returns the narrative from the second attempt', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', KEY)
    vi.stubEnv('X402_LLM_MAX_OUTPUT_TOKENS', '1600')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          choices: [{ message: { content: null }, finish_reason: 'length' }],
          usage: { prompt_tokens: 335, completion_tokens: 1600, completion_tokens_details: { reasoning_tokens: 1600 } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      ))
      .mockResolvedValueOnce(okResponse({
        headline: 'Concentrated stablecoin portfolio',
        observations: ['Most of the measured value sits in one stablecoin.'],
        risks: ['A single asset drives the exposure.'],
      }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateLlmNarrative({
      serviceId: 'arc-vault-yield-tax-report',
      systemPrompt: 'system',
      facts,
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.narrative.headline).toContain('Concentrated')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(JSON.parse(String(init.body)).max_tokens).toBe(1600)
    }
  })

  it('retries a truncated narrative but does not accept the partial JSON', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', KEY)
    vi.stubEnv('X402_LLM_MAX_OUTPUT_TOKENS', '600')
    const truncated = new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"headline":"Portfolio is high' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 300, completion_tokens: 600, completion_tokens_details: { reasoning_tokens: 200 } },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(truncated)
      .mockResolvedValueOnce(truncated.clone())
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateLlmNarrative({
      serviceId: 'arc-vault-yield-tax-report',
      systemPrompt: 'system',
      facts,
    })

    expect(result.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    if (!result.ok) expect(result.reason).toMatch(/truncated at the 600-token output budget/)
  })

  it('does not retry an answer that is complete but violates the no-number contract', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', KEY)
    const fetchMock = vi.fn(async () => okResponse({
      headline: 'Portfolio worth 860 USDC',
      observations: ['Most value is stablecoins.'],
      risks: ['Concentration is high.'],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await generateLlmNarrative({
      serviceId: 'arc-vault-yield-tax-report',
      systemPrompt: 'system',
      facts,
    })

    expect(result.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads the output budget from X402_LLM_MAX_OUTPUT_TOKENS and rejects unusable values', () => {
    vi.stubEnv('X402_LLM_MAX_OUTPUT_TOKENS', '')
    expect(getOutputTokenBudget()).toBe(1600)
    vi.stubEnv('X402_LLM_MAX_OUTPUT_TOKENS', '2400')
    expect(getOutputTokenBudget()).toBe(2400)
    vi.stubEnv('X402_LLM_MAX_OUTPUT_TOKENS', 'abc')
    expect(getOutputTokenBudget()).toBe(1600)
    vi.stubEnv('X402_LLM_MAX_OUTPUT_TOKENS', '50')
    expect(getOutputTokenBudget()).toBe(1600)
    vi.stubEnv('X402_LLM_MAX_OUTPUT_TOKENS', '9000')
    expect(getOutputTokenBudget()).toBe(1600)
    vi.stubEnv('X402_LLM_MAX_OUTPUT_TOKENS', '1200.5')
    expect(getOutputTokenBudget()).toBe(1600)
  })

  it('reports a 200 without message content as an empty response, not a schema violation', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', KEY)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 0 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )))

    const result = await generateLlmNarrative({
      serviceId: 'arc-vault-yield-tax-report',
      systemPrompt: 'system',
      facts,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/without any message content/)
      expect(result.unavailable.join(' ')).toMatch(/no content/i)
    }
  })

  it('reports a provider HTTP failure without leaking the response body or key', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', KEY)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret upstream detail', { status: 500 })))

    const result = await generateLlmNarrative({
      serviceId: 'arc-vault-yield-tax-report',
      systemPrompt: 'system',
      facts,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('HTTP 500')
      expect(result.reason).not.toContain('secret upstream detail')
    }
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('turns a provider timeout into UNAVAILABLE', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', KEY)
    vi.stubGlobal('fetch', vi.fn(async () => {
      const err = new Error('The operation was aborted due to timeout')
      err.name = 'TimeoutError'
      throw err
    }))

    const result = await generateLlmNarrative({
      serviceId: 'arc-vault-yield-tax-report',
      systemPrompt: 'system',
      facts,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toMatch(/20s budget/)
  })
})
