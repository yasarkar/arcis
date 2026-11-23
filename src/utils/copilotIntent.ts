import type { CopilotActionPayload, CopilotMessage } from '../types/marketplace.js'
import { isLpPoolPrompt, resolveCopilotLpPoolFromPrompt } from './copilotPoolParser.js'

export type TransactionIntent = 'send' | 'swap' | 'deposit' | 'lp_deposit' | 'lp_remove' | 'claim_fees' | 'bridge'
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

/**
 * True when the instruction asks to claim/harvest accrued pool fees or vault yield
 * (e.g. "claim all fees", "harvest all", "tüm fee'leri topla", "ücretleri topla").
 * Never hijacks faucet claims ("claim faucet", "claim 1000 USDC").
 */
export function isClaimFeesPrompt(instructionText: string): boolean {
  const lower = instructionText
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ç/g, 'c')

  if (/\b(?:faucet|musluk|testnet\s+usdc)\b/.test(lower)) return false

  const hasClaimVerb =
    /\b(?:claim|harvest|collect|topla[a-z]*|hasat|cek[a-z]*|al)\b/.test(lower)
  const hasRewardNoun =
    /\b(?:fee[a-z']*s?|ucret[a-z]*|reward[a-z]*|odul[a-z]*|yield[a-z]*|getiri[a-z]*|kazanc[a-z]*|earning[a-z]*|accrued|birikmis|pending)\b/.test(lower)

  if (hasClaimVerb && hasRewardNoun) return true
  if (/\b(?:claim\s+all|harvest\s+all|collect\s+all|tumunu\s+topla|hepsini\s+topla|butun\s+fee|tum\s+fee)\b/.test(lower)) {
    return true
  }
  return false
}
/**
 * True when the instruction asks to remove / withdraw LP liquidity from an AMM pool
 * (e.g. "remove 50% LP from USDC/EURC", "USDC/EURC havuzundan tüm LP'yi çek", "likidite çek").
 */
export function isLpRemovePrompt(instructionText: string): boolean {
  if (isClaimFeesPrompt(instructionText)) return false
  const lower = instructionText
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ç/g, 'c')

  // Never hijack Yield Vault withdrawals when no LP pool pair or LP keyword is mentioned
  const explicitVaultOnly =
    /\b(?:vault|yield\s*vault|kasa|af-?usdc)\b/.test(lower) &&
    !/\b(?:lp|liquidity|likidite|stableswap)\b/.test(lower) &&
    resolveCopilotLpPoolFromPrompt(instructionText).status !== 'matched'
  if (explicitVaultOnly) return false

  const hasRemoveVerb =
    /\b(?:remove|withdraw|exit|unstake|pull|cek[a-z]*|kaldir[a-z]*|cikar[a-z]*|boz[a-z]*)\b/.test(lower) ||
    /\bgeri\s+al\b/.test(lower)
  if (!hasRemoveVerb) return false

  const hasLpCue =
    /\b(?:lp[a-z']*s?|liquidity|likidite|stableswap|havuz[a-z]*|pool[a-z']*)\b/.test(lower) ||
    resolveCopilotLpPoolFromPrompt(instructionText).status === 'matched'

  return hasLpCue
}

/** Fail closed: quoted examples, questions and negation never authorize a tool call. */
export function classifyCopilotIntent(prompt: string): CopilotIntent {
  const text = copilotInstructionText(prompt).toLowerCase().replace(/ı/g, 'i').replace(/’/g, "'")
  const words = text.split(/[^a-z0-9ğüşöç]+/).filter(Boolean)
  const has = (...terms: string[]) => terms.some(term => words.includes(term))
  if (has('not', 'dont', 'never', 'cancel', 'stop', 'abort', 'iptal', 'vazgeç', 'vazgec', 'yapma',
    'gönderme', 'gonderme', 'yollama', 'ödeme', 'odeme', 'yatirma', 'aktarma', 'çevirme', 'cevirme',
    'dönüştürme', 'donusturme', 'alma', 'satma', 'ekleme', 'toplama', 'çekme', 'cekme',
    'kaldırma', 'kaldirma', 'çıkarma', 'çikarma', 'cikarma', 'bozma') || /\bdon['’]?t\b/.test(text) ||
    /\b(?:istemiyorum|yapmayin|göndermeyin|göndermesin|yatirmayin|aktarmayin|eklemeyin|toplamayin|çekmeyin|cekmeyin|kaldırmayın|kaldirmayin|çikarmayin|cikarmayin|etme|etmeyin|durdur|vazgeçtim|vazgectim)\b/.test(text)) {
    return { kind: 'cancel', message: `${NO_ACTION} This message does not authorize execution. Unsubmitted drafts are canceled; already submitted transactions cannot be undone here.` }
  }
  const isStrategyOrPortfolio =
    text.includes('portfolio') ||
    text.includes('portfoy') ||
    text.includes('strategy') ||
    text.includes('strateji') ||
    text.includes('bakiye') ||
    text.includes('varliklarim')

  const isQuestionOrExample = text.includes('?') || /["“”`]/.test(text) || /(?:^|\s)'[^']+'(?:\s|$)/.test(text) ||
    has('how', 'what', 'why', 'which', 'explain', 'example', 'quote', 'quoted', 'hypothetical', 'if',
      'nasil', 'nedir', 'neden', 'örnek', 'ornek', 'alinti', 'açikla', 'acikla', 'mi', 'mı', 'mu', 'mü',
      'misin', 'misiniz', 'miyim', 'miyiz', 'musun', 'musunuz', 'müsün', 'müsünüz',
      'would', 'could', 'can', 'should', 'whether') ||
    /(?:read[- ]?only|dry[- ]?run|for example|örneğin|ornegin|sadece bilgi|ne olur|ne demek)/.test(text)

  if (!isStrategyOrPortfolio && isQuestionOrExample) {
    return { kind: 'read-only', message: `${NO_ACTION} Questions, examples and quoted commands are read-only. To prepare a transaction, write a separate explicit command / İşlem için ayrı, açık bir komut yazın.` }
  }

  const actions: TransactionIntent[] = []
  const instruction = copilotInstructionText(prompt)
  const isClaim = isClaimFeesPrompt(instruction)
  const isLpRemove = !isClaim && isLpRemovePrompt(instruction)
  if (has('send', 'transfer', 'gönder', 'gonder', 'yolla', 'pay', 'öde', 'ode')) actions.push('send')
  if (
    has('swap', 'takas', 'trade', 'convert', 'çevir', 'cevir', 'dönüştür', 'donustur', 'buy', 'sell', 'sat', 'satmak') ||
    (!isClaim && !isLpRemove && has('al', 'almak'))
  ) {
    actions.push('swap')
  }
  if (isClaim) {
    actions.push('claim_fees')
  } else if (isLpRemove) {
    actions.push('lp_remove')
  } else if (isLpPoolPrompt(instruction)) {
    actions.push('lp_deposit')
  } else if (has('deposit', 'yatir', 'stake', 'vault', 'kasa')) {
    actions.push('deposit')
  }
  if (has('bridge', 'köprü', 'kopru', 'köprüle', 'koprule', 'aktar')) actions.push('bridge')

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
    case 'interactive_lp_deposit': return 'lp_deposit'
    case 'interactive_lp_remove': return 'lp_remove'
    case 'interactive_claim_fees': return 'claim_fees'
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
    if (
      message.preservesActiveDraft &&
      !message.actionPayload &&
      !message.receipt &&
      !message.isExecutingInline
    ) {
      continue
    }
    if (message.receipt || message.isExecutingInline || (message.executionState && message.executionState !== 'idle')) return undefined
    const action = message.actionPayload?.type === 'configure_session'
      ? message.actionPayload.data?.pendingAction as CopilotActionPayload | undefined
      : message.actionPayload
    const hasDraftMagnitude =
      Number(action?.data?.amount) > 0 ||
      Number(action?.data?.removePercent) > 0 ||
      Number(action?.data?.lpAmount) > 0
    return copilotActionIntent(action) && hasDraftMagnitude ? action : undefined
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
