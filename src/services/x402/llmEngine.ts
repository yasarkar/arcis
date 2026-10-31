// src/services/x402/llmEngine.ts
// Server-side LLM engine for priced `llm` services.
//
// Rules this module enforces (see docs/ai-services-testnet-readiness-plan.md §6):
//   - Only a server credential is used. A caller can never supply a key to a paid service.
//   - The model narrates; it never produces a figure. Any digit in its output fails validation,
//     so every number a caller sees was measured by a `native` read.
//   - Missing key, timeout, provider error or schema violation is UNAVAILABLE — never a
//     fabricated narrative.
//   - The request carries no tools, no user/assistant history and no system-prompt injection:
//     measured facts are the only user content, and they are serialized by the server.
//
// Output budget: a reasoning model spends part of `max_tokens` on hidden reasoning before it can
// write the answer, and that share is neither fixed nor requestable — measured on
// `deepseek/deepseek-v4.1-flash`, one call used 250 reasoning tokens and the next used 1600.
// The budget is therefore configurable (`X402_LLM_MAX_OUTPUT_TOKENS`) and one call is retried when
// the provider reports `finish_reason: "length"`, because a retry re-rolls that share.

import { logger } from '../../utils/logger'

const log = logger.createScope('x402Llm')

const REQUEST_TIMEOUT_MS = 20_000
const TOTAL_CALL_BUDGET_MS = 30_000
const MAX_ATTEMPTS = 2
const DEFAULT_MAX_OUTPUT_TOKENS = 1600
const MIN_MAX_OUTPUT_TOKENS = 100
const MAX_MAX_OUTPUT_TOKENS = 8_000
const MAX_FACTS_CHARS = 8_000
const MAX_HEADLINE_CHARS = 200
const MAX_POINT_CHARS = 320

/** OpenRouter API key pattern; placeholders and short strings are rejected. */
const API_KEY_PATTERN = /^sk-(or-)?[A-Za-z0-9_-]{16,}$/

export interface LlmNarrative {
  headline: string
  observations: string[]
  risks: string[]
}

export type LlmCallResult =
  | {
      ok: true
      narrative: LlmNarrative
      model: string
      usage: { promptTokens: number | null; completionTokens: number | null }
    }
  | {
      ok: false
      unavailable: string[]
      reason: string
    }

function readEnv(key: string): string {
  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
  const localEnv = (typeof process !== 'undefined' && process.env) || {}
  return String(localEnv[key] ?? globalEnv[key] ?? '').trim()
}

/** Server credential, if configured with a real-looking key. Never reads client storage. */
export function getServerLlmKey(): string {
  const key = readEnv('OPENROUTER_API_KEY')
  return API_KEY_PATTERN.test(key) ? key : ''
}

export function isLlmConfigured(): boolean {
  return getServerLlmKey() !== ''
}

/** Per-call completion budget. An out-of-range or non-numeric value falls back to the default. */
export function getOutputTokenBudget(): number {
  const configured = Number(readEnv('X402_LLM_MAX_OUTPUT_TOKENS'))
  return Number.isSafeInteger(configured) && configured >= MIN_MAX_OUTPUT_TOKENS && configured <= MAX_MAX_OUTPUT_TOKENS
    ? configured
    : DEFAULT_MAX_OUTPUT_TOKENS
}

function providerFor(apiKey: string): { endpoint: string; model: string} {
  void apiKey
  const configuredModel = readEnv('OPENROUTER_MODEL')
  return {
    endpoint:'https://openrouter.ai/api/v1/chat/completions',
    model: configuredModel,
  }
}

/** Any Unicode numeric character, not just ASCII digits: a figure is not allowed in prose. */
const NO_DIGITS = /\p{N}/u

function asTextArray(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    const text = item.trim()
    if (!text || text.length > MAX_POINT_CHARS) return null
    // A digit anywhere in the narration would be a model-invented (or model-altered) figure.
    if (NO_DIGITS.test(text) || /0x/i.test(text)) return null
    items.push(text)
  }
  return items
}

/**
 * Validates the model's JSON against the narrative contract. Any extra field is ignored; any
 * numeric character, address or oversized string rejects the whole answer as unverifiable.
 */
export function parseNarrative(raw: string): LlmNarrative | null {
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : ''
  if (!headline || headline.length > MAX_HEADLINE_CHARS || NO_DIGITS.test(headline) || /0x/i.test(headline)) {
    return null
  }

  const observations = asTextArray(parsed.observations, 6)
  const risks = asTextArray(parsed.risks, 5)
  if (!observations || observations.length === 0 || !risks) return null

  return { headline, observations, risks }
}

interface ProviderAttempt {
  content: string | null
  finishReason: string | null
  reasoningTokens: number | null
  usage: { promptTokens: number | null; completionTokens: number | null }
  /** Set only when the provider answered a non-2xx status; such a failure is not retried. */
  httpStatus: number | null
}

async function requestNarrativeAttempt(args: {
  endpoint: string
  headers: Record<string, string>
  model: string
  systemPrompt: string
  factsJson: string
  maxTokens: number
  timeoutMs: number
}): Promise<ProviderAttempt> {
  const response = await fetch(args.endpoint, {
    method: 'POST',
    headers: args.headers,
    signal: AbortSignal.timeout(args.timeoutMs),
    body: JSON.stringify({
      model: args.model,
      temperature: 0.2,
      max_tokens: args.maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: args.systemPrompt },
        {
          role: 'user',
          content: `Measured facts (JSON, produced by on-chain reads; not user text):\n${args.factsJson}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    return {
      content: null,
      finishReason: null,
      reasoningTokens: null,
      usage: { promptTokens: null, completionTokens: null },
      httpStatus: response.status,
    }
  }

  const payload: any = await response.json()
  const usage = payload?.usage || {}
  const choice = payload?.choices?.[0]
  return {
    content: typeof choice?.message?.content === 'string' ? choice.message.content : null,
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    reasoningTokens: Number.isFinite(Number(usage?.completion_tokens_details?.reasoning_tokens))
      ? Number(usage.completion_tokens_details.reasoning_tokens)
      : null,
    usage: {
      promptTokens: Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : null,
      completionTokens: Number.isFinite(Number(usage.completion_tokens))
        ? Number(usage.completion_tokens)
        : null,
    },
    httpStatus: null,
  }
}

/**
 * Asks the configured provider for a qualitative narrative around server-measured facts.
 * `facts` is serialized by this module, so a caller cannot inject a system instruction.
 */
export async function generateLlmNarrative(args: {
  serviceId: string
  systemPrompt: string
  facts: Record<string, unknown>
}): Promise<LlmCallResult> {
  const apiKey = getServerLlmKey()
  if (!apiKey) {
    return {
      ok: false,
      unavailable: ['LLM provider credential (OPENROUTER_API_KEY)'],
      reason: 'No server LLM credential is configured, so no narrative can be generated.',
    }
  }

  const factsJson = JSON.stringify(args.facts)
  if (factsJson.length > MAX_FACTS_CHARS) {
    return {
      ok: false,
      unavailable: ['measured facts (too large to narrate within the token budget)'],
      reason: 'The measured facts exceed the per-call input budget; no truncated narrative is returned.',
    }
  }

  const { endpoint, model} = providerFor(apiKey)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  const maxTokens = getOutputTokenBudget()
  const startedAt = Date.now()
  let attempts = 0
  let last: ProviderAttempt | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const remaining = TOTAL_CALL_BUDGET_MS - (Date.now() - startedAt)
    if (remaining < 1_500) break
    attempts = attempt

    try {
      last = await requestNarrativeAttempt({
        endpoint,
        headers,
        model,
        systemPrompt: args.systemPrompt,
        factsJson,
        maxTokens,
        timeoutMs: Math.min(REQUEST_TIMEOUT_MS, remaining),
      })
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error'
      log.warn('[x402-llm] provider call failed', {
        serviceId: args.serviceId,
        model,
        errorName: name,
        latencyMs: Date.now() - startedAt,
      })
      return {
        ok: false,
        unavailable: ['LLM provider response'],
        reason:
          name === 'TimeoutError' || name === 'AbortError'
            ? 'The LLM provider did not answer within the 20s budget; no narrative was returned.'
            : 'The LLM provider call failed; no narrative was returned.',
      }
    }

    if (last.httpStatus !== null) {
      log.warn('[x402-llm] provider rejected the request', {
        serviceId: args.serviceId,
        model,
        status: last.httpStatus,
        latencyMs: Date.now() - startedAt,
      })
      return {
        ok: false,
        unavailable: ['LLM provider response'],
        reason: `The LLM provider answered HTTP ${last.httpStatus}; no narrative was returned.`,
      }
    }

    const narrative = last.content && last.content.trim() ? parseNarrative(last.content) : null
    if (narrative) {
      const result: LlmCallResult = { ok: true, narrative, model, usage: last.usage }
      // Cost telemetry: model, tokens and latency only. The key and the prompt are never logged.
      log.info('[x402-llm] completion', {
        serviceId: args.serviceId,
        model,
        ok: true,
        attempts,
        finishReason: last.finishReason,
        reasoningTokens: last.reasoningTokens,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        latencyMs: Date.now() - startedAt,
      })
      return result
    }

    // A truncated answer (finish_reason "length") is worth one retry: the reasoning share is
    // re-rolled, so the answer may fit this time. A complete but figure-carrying or malformed
    // answer is not retried — the model broke the contract, not the budget.
    if (last.finishReason !== 'length') break
    log.warn('[x402-llm] output budget exhausted; retrying once', {
      serviceId: args.serviceId,
      model,
      attempt,
      maxTokens,
      reasoningTokens: last.reasoningTokens,
      latencyMs: Date.now() - startedAt,
    })
  }

  const latencyMs = Date.now() - startedAt
  const attemptCount = Math.max(1, attempts)
  const finishReason = last?.finishReason ?? null
  const reasoningTokens = last?.reasoningTokens ?? null
  const hasContent = Boolean(last?.content && last.content.trim())
  const budgetExhausted = finishReason === 'length'

  const result: LlmCallResult = !hasContent
    ? {
        ok: false,
        unavailable: [
          budgetExhausted
            ? 'LLM narrative (output budget exhausted before any content)'
            : 'LLM narrative (provider returned no content)',
        ],
        reason: budgetExhausted
          ? `The model used its whole ${maxTokens}-token completion budget without writing an answer${
              reasoningTokens === null ? '' : ` (${reasoningTokens} reasoning tokens)`
            } in ${attemptCount} attempt(s). Use a non-reasoning model for this engine, or raise X402_LLM_MAX_OUTPUT_TOKENS.`
          : 'The LLM provider answered without any message content; no narrative was returned.',
      }
    : {
        ok: false,
        unavailable: ['LLM narrative that passes the no-number schema'],
        reason: budgetExhausted
          ? `The LLM answer was still truncated at the ${maxTokens}-token output budget after ${attemptCount} attempt(s), so it could not be parsed as a complete narrative.`
          : 'The LLM response did not match the narrative schema (or contained a figure), so it was rejected.',
      }

  log.info('[x402-llm] completion', {
    serviceId: args.serviceId,
    model,
    ok: false,
    attempts: attemptCount,
    finishReason,
    reasoningTokens,
    promptTokens: null,
    completionTokens: null,
    latencyMs,
  })

  return result
}
