// src/utils/x402FailureDiagnosis.ts
// A voided paid call has three very different causes, and they need different next steps:
//   • the model produced no narrative (budget/reasoning model) — a configuration problem,
//   • an on-chain input could not be read — a data problem for this address/service,
//   • the service returned nothing at all — nothing was charged either way.
// `api/x402.ts` sends `diagnostics` on the 503 it returns, `paymentOrchestrator` sanitizes it, and
// this module turns it into the sentence the payer needs to read.

import type { X402FailureDiagnostics } from '../types/x402'

export type X402FailureKind =
  | 'model_budget'
  | 'measurement_missing'
  | 'payment_voided'
  | 'compute_failed'
  | 'payment_rejected'
  | 'payer_unsupported'
  | 'unknown'

export interface X402FailureDiagnosis {
  kind: X402FailureKind
  title: string
  detail: string
  action: string
  /** False only when the server confirms no settlement happened. */
  charged: boolean
  /** The individual missing readings/credential, when the service named them. */
  reasons: string[]
}

const MODEL_SIGNAL = /llm|narrative|model|output budget|reasoning/i

export function diagnoseX402Failure(result: {
  error?: string | null
  statusCode?: number
  costUsdc?: number
  diagnostics?: X402FailureDiagnostics | null
}): X402FailureDiagnosis | null {
  const error = typeof result.error === 'string' ? result.error.trim() : ''
  if (!error) return null

  // A client-side refusal precedes any payment: there is no authorization to explain, so it must
  // not be reported as a voided call with an unknown payment status.
  if (!result.diagnostics && /require (?:a connected )?external EOA|active Circle Wallet signing session/i.test(error)) {
    return {
      kind: 'payer_unsupported',
      title: 'No wallet can sign this call',
      detail: error,
      action: 'Connect an injected EOA or an active Circle Wallet session; passkey/MSCA wallets cannot authorize a Gateway nanopayment.',
      charged: false,
      reasons: [],
    }
  }

  const diagnostics = result.diagnostics && typeof result.diagnostics === 'object' ? result.diagnostics : null
  const charged = diagnostics ? diagnostics.charged : (result.costUsdc ?? 0) > 0
  const reasons = Array.isArray(diagnostics?.unavailable)
    ? diagnostics!.unavailable.filter((item): item is string => typeof item === 'string')
    : []
  const reason = typeof diagnostics?.reason === 'string' ? diagnostics.reason : ''

  if (diagnostics && diagnostics.resultStatus === 'UNAVAILABLE' && !charged) {
    if (reasons.some((item) => MODEL_SIGNAL.test(item)) || MODEL_SIGNAL.test(reason)) {
      return {
        kind: 'model_budget',
        title: 'The model produced no narrative',
        detail: reason || 'The LLM answered without a usable narrative, so the service had no result to return.',
        action:
          'Nothing was charged. Raise X402_LLM_MAX_OUTPUT_TOKENS or point OPENROUTER_MODEL at a JSON-mode model that does not spend the whole budget thinking, then retry.',
        charged: false,
        reasons,
      }
    }
    if (reasons.length > 0) {
      return {
        kind: 'measurement_missing',
        title: 'A required on-chain measurement failed',
        detail: reason || 'The service refused to answer because one of its readings did not come back.',
        action:
          'Nothing was charged. Check the inputs (for example the wallet address or pool pair) or retry once the read recovers.',
        charged: false,
        reasons,
      }
    }
    return {
      kind: 'payment_voided',
      title: 'The service returned no result',
      detail: reason || error,
      action: 'Nothing was charged or settled, so retrying is safe.',
      charged: false,
      reasons,
    }
  }

  if (/^service compute failed/i.test(error)) {
    return {
      kind: 'compute_failed',
      title: 'The service failed while computing',
      detail: error,
      action: 'No charge was applied. The provider must fix the failing read or upstream before this call can succeed.',
      charged,
      reasons,
    }
  }

  if (result.statusCode === 402 || result.statusCode === 409) {
    return {
      kind: 'payment_rejected',
      title: result.statusCode === 409 ? 'This authorization was already used' : 'Payment was not accepted',
      detail: error,
      action:
        result.statusCode === 409
          ? 'Do not resend the same signature; start a new call so a fresh nonce is signed.'
          : 'Authorize the Circle Gateway payment for this call and retry.',
      charged,
      reasons,
    }
  }

  return {
    kind: 'unknown',
    title: 'Execution Error',
    detail: error,
    action: 'Nothing is reported as settled for this call; check the payment status before retrying.',
    charged,
    reasons,
  }
}

/**
 * One line for a chat or a step log: what happened, whether money moved, and what to do next.
 * Returns null when there is nothing to explain (a successful call).
 */
export function formatX402FailureNote(result: {
  error?: string | null
  statusCode?: number
  costUsdc?: number
  diagnostics?: X402FailureDiagnostics | null
}): string | null {
  const diagnosis = diagnoseX402Failure(result)
  if (!diagnosis) return null
  const charge = diagnosis.charged ? '' : ' No charge was applied.'
  return `${diagnosis.title}: ${diagnosis.detail}${charge} ${diagnosis.action}`.trim()
}

/** Compact form stored on a service's telemetry so its card can show the last reason. */
export interface X402FailureSummary {
  kind: X402FailureKind
  label: string
  detail: string
}

export function summarizeX402Failure(result: {
  error?: string | null
  statusCode?: number
  costUsdc?: number
  diagnostics?: X402FailureDiagnostics | null
}): X402FailureSummary | null {
  const diagnosis = diagnoseX402Failure(result)
  if (!diagnosis) return null
  return { kind: diagnosis.kind, label: diagnosis.title, detail: diagnosis.detail }
}
