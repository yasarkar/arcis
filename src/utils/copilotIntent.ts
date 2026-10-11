import type { CopilotActionPayload, CopilotMessage } from '../types/marketplace'

export type TransactionIntent = 'send' | 'swap' | 'deposit' | 'bridge'
export type CopilotIntent =
  | { kind: 'cancel' | 'read-only' | 'ambiguous'; message: string }
  | { kind: 'command'; action: TransactionIntent }
  | { kind: 'correction' | 'other' }

const NO_ACTION = 'No transaction prepared / İşlem hazırlanmadı.'

/** Memo text is data, not a second instruction. Turkish "not" requires an explicit delimiter. */
export function copilotInstructionText(prompt: string): string {
  return prompt.replace(/(?:\bmemo\b|\breference\b|(?:^|\s)(?:not|açıklama)\s*[:=])[\s\S]*$/i, '').trim()
}

export function extractCopilotMemo(prompt: string): string | undefined {
  return prompt.match(/(?:\bmemo\b|\breference\b|(?:^|\s)(?:not|açıklama)\s*[:=])\s*[:=]?\s*["']?([^"'\n]+)["']?/i)?.[1]?.trim()
}

/** Fail closed: quoted examples, questions and negation never authorize a tool call. */
export function classifyCopilotIntent(prompt: string): CopilotIntent {
  const text = copilotInstructionText(prompt).toLowerCase().replace(/ı/g, 'i').replace(/’/g, "'")
  const words = text.split(/[^a-z0-9ğüşöç]+/).filter(Boolean)
  const has = (...terms: string[]) => terms.some(term => words.includes(term))
  if (has('not', 'dont', 'never', 'cancel', 'stop', 'abort', 'iptal', 'vazgeç', 'vazgec', 'yapma',
    'gönderme', 'gonderme', 'yollama', 'ödeme', 'odeme', 'yatirma', 'aktarma', 'çevirme', 'cevirme',
    'dönüştürme', 'donusturme', 'alma', 'satma') || /\bdon['’]?t\b/.test(text) ||
    /\b(?:istemiyorum|yapmayin|göndermeyin|göndermesin|yatirmayin|aktarmayin|etme|etmeyin|durdur|vazgeçtim|vazgectim)\b/.test(text)) {
    return { kind: 'cancel', message: `${NO_ACTION} This message does not authorize execution. Unsubmitted drafts are canceled; already submitted transactions cannot be undone here.` }
  }
  if (text.includes('?') || /["“”`]/.test(text) || /(?:^|\s)'[^']+'(?:\s|$)/.test(text) ||
    has('how', 'what', 'why', 'which', 'explain', 'example', 'quote', 'quoted', 'hypothetical', 'if',
      'nasil', 'nedir', 'neden', 'örnek', 'ornek', 'alinti', 'açikla', 'acikla', 'mi', 'mı', 'mu', 'mü',
      'misin', 'misiniz', 'miyim', 'miyiz', 'musun', 'musunuz', 'müsün', 'müsünüz',
      'would', 'could', 'can', 'should', 'whether', 'analyze', 'analyse', 'analiz', 'portfolio', 'portföy', 'bakiye') ||
    /(?:read[- ]?only|dry[- ]?run|for example|örneğin|ornegin|sadece bilgi|ne olur|ne demek)/.test(text)) {
    return { kind: 'read-only', message: `${NO_ACTION} Questions, examples and quoted commands are read-only. To prepare a transaction, write a separate explicit command / İşlem için ayrı, açık bir komut yazın.` }
  }

  const actions: TransactionIntent[] = []
  if (has('send', 'transfer', 'gönder', 'gonder', 'yolla', 'pay', 'öde', 'ode')) actions.push('send')
  if (has('swap', 'takas', 'trade', 'convert', 'çevir', 'cevir', 'dönüştür', 'donustur', 'buy', 'sell', 'al', 'almak', 'sat', 'satmak')) actions.push('swap')
  if (has('deposit', 'yatir', 'stake')) actions.push('deposit')
  if (has('bridge', 'köprü', 'kopru', 'aktar')) actions.push('bridge')
  if (actions.length > 1) {
    return { kind: 'ambiguous', message: `${NO_ACTION} Please specify one transaction at a time / Her mesajda tek işlem belirtin.` }
  }
  if (actions.length === 1) return { kind: 'command', action: actions[0] }
  // A bare amount or mention of slippage is not permission to revise an old transaction.
  if (has('pardon', 'aslinda', 'değiştir', 'degistir', 'güncelle', 'guncelle', 'yerine', 'instead', 'actually', 'change', 'update', 'set') || /\bmake it\b/.test(text)) {
    return { kind: 'correction' }
  }
  return { kind: 'other' }
}

export function copilotActionIntent(action?: CopilotActionPayload): TransactionIntent | undefined {
  switch (action?.type) {
    case 'interactive_send': case 'send': return 'send'
    case 'interactive_swap': case 'trade': return 'swap'
    case 'interactive_deposit': case 'zap': return 'deposit'
    case 'interactive_bridge': case 'bridge': return 'bridge'
    default: return undefined
  }
}

/** Only the latest unresolved assistant draft is editable; never search past a cancellation/receipt. */
export function latestEditableCopilotDraft(history: CopilotMessage[] = []): CopilotActionPayload | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i]
    if (message.role === 'user') {
      const intent = classifyCopilotIntent(message.content)
      if (intent.kind === 'cancel' || intent.kind === 'command') return undefined
      continue
    }
    if (message.role !== 'assistant') continue
    if (message.receipt || message.isExecutingInline || (message.executionState && message.executionState !== 'idle')) return undefined
    const action = message.actionPayload?.type === 'configure_session'
      ? message.actionPayload.data?.pendingAction as CopilotActionPayload | undefined
      : message.actionPayload
    return copilotActionIntent(action) && Number(action?.data?.amount) > 0 ? action : undefined
  }
  return undefined
}

/** Retain receipt/in-flight evidence; remove only unsubmitted transaction/session cards. */
export function invalidateCopilotDrafts(messages: CopilotMessage[]): CopilotMessage[] {
  return messages.map(message => {
    const pending = message.actionPayload?.type === 'configure_session' && message.actionPayload.data?.pendingAction
    if (!message.receipt && !message.isExecutingInline && (pending || copilotActionIntent(message.actionPayload))) {
      return { ...message, actionPayload: undefined }
    }
    return message
  })
}
