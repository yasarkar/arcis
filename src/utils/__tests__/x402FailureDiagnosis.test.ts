import { describe, expect, it } from 'vitest'
import { diagnoseX402Failure, formatX402FailureNote, summarizeX402Failure } from '../x402FailureDiagnosis'

const VOID = {
  error: 'The service has no available result to return. The authorization was not settled or charged.',
  statusCode: 503,
  costUsdc: 0,
}

describe('diagnoseX402Failure', () => {
  it('returns null when there is nothing to explain', () => {
    expect(diagnoseX402Failure({ statusCode: 200, costUsdc: 0 })).toBeNull()
    expect(diagnoseX402Failure({ error: '   ' })).toBeNull()
  })

  it('separates a model that produced no narrative from a failed measurement', () => {
    const model = diagnoseX402Failure({
      ...VOID,
      diagnostics: {
        serviceId: 'arc-vault-yield-tax-report',
        engine: 'llm',
        resultStatus: 'UNAVAILABLE',
        unavailable: ['LLM narrative (output budget exhausted before any content)'],
        reason:
          'The model used its whole 1600-token completion budget without writing an answer (1600 reasoning tokens) in 2 attempt(s).',
        charged: false,
      },
    })
    expect(model?.kind).toBe('model_budget')
    expect(model?.charged).toBe(false)
    expect(model?.action).toMatch(/X402_LLM_MAX_OUTPUT_TOKENS/)
    expect(model?.reasons).toEqual(['LLM narrative (output budget exhausted before any content)'])

    const measurement = diagnoseX402Failure({
      ...VOID,
      diagnostics: {
        serviceId: 'arc-portfolio-risk-exposure',
        engine: 'native',
        resultStatus: 'UNAVAILABLE',
        unavailable: ['USDC balance', 'arc price feed'],
        reason: null,
        charged: false,
      },
    })
    expect(measurement?.kind).toBe('measurement_missing')
    expect(measurement?.reasons).toEqual(['USDC balance', 'arc price feed'])
    expect(measurement?.action).toMatch(/nothing was charged/i)
  })

  it('reports a voided call with no named cause as a plain void rather than guessing', () => {
    const result = diagnoseX402Failure({
      ...VOID,
      diagnostics: { resultStatus: 'UNAVAILABLE', unavailable: [], reason: null, charged: false },
    })
    expect(result?.kind).toBe('payment_voided')
    expect(result?.detail).toBe(VOID.error)
  })

  it('keeps the server wording for a compute failure and marks it uncharged', () => {
    const result = diagnoseX402Failure({
      statusCode: 500,
      costUsdc: 0,
      error: 'Service compute failed: Upstream engine error: HTTP 502. Payment authorization voided with 0 charge.',
    })
    expect(result?.kind).toBe('compute_failed')
    expect(result?.detail).toContain('HTTP 502')
    expect(result?.charged).toBe(false)
  })

  it('distinguishes a rejected payment from a replay', () => {
    expect(diagnoseX402Failure({ statusCode: 402, costUsdc: 0, error: 'Payment required' })?.kind).toBe('payment_rejected')
    const replay = diagnoseX402Failure({ statusCode: 409, costUsdc: 0, error: 'Nonce replay detected.' })
    expect(replay?.kind).toBe('payment_rejected')
    expect(replay?.action).toMatch(/do not resend/i)
  })

  it('separates a client-side payer refusal from a voided payment', () => {
    const result = diagnoseX402Failure({
      statusCode: 503,
      costUsdc: 0,
      error: 'Paid x402 calls require a connected external EOA or an active Circle Wallet signing session. No authorization or charge was created.',
    })
    expect(result?.kind).toBe('payer_unsupported')
    expect(result?.charged).toBe(false)
    expect(result?.action).toMatch(/passkey/i)
  })

  it('formats one line for chat and a compact summary for a service card', () => {
    const voided = {
      ...VOID,
      diagnostics: {
        resultStatus: 'UNAVAILABLE',
        unavailable: ['LLM narrative (output budget exhausted before any content)'],
        reason: 'The model used its whole 1600-token completion budget.',
        charged: false,
      },
    }
    const note = formatX402FailureNote(voided)
    expect(note).toContain('The model produced no narrative')
    expect(note).toContain('No charge was applied.')
    expect(note).toContain('X402_LLM_MAX_OUTPUT_TOKENS')
    expect(summarizeX402Failure(voided)).toMatchObject({ kind: 'model_budget', label: 'The model produced no narrative' })
    expect(formatX402FailureNote({ statusCode: 200, costUsdc: 0 })).toBeNull()
    expect(summarizeX402Failure({ statusCode: 200, costUsdc: 0 })).toBeNull()
  })

  it('never claims a refund: without diagnostics it falls back to the reported cost', () => {
    expect(diagnoseX402Failure({ statusCode: 500, costUsdc: 0.01, error: 'boom' })?.charged).toBe(true)
    expect(diagnoseX402Failure({ statusCode: 500, error: 'boom' })?.charged).toBe(false)
    expect(diagnoseX402Failure({ statusCode: 500, error: 'boom' })?.kind).toBe('unknown')
  })
})
