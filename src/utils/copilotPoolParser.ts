// src/utils/copilotPoolParser.ts
// Deterministic pool & amount resolver for Ask Arco LP pool deposits (1-Click Zap & Dual-Asset).
// Mirrors the single-source-of-truth pool definitions in src/config/poolsConfig.ts and enforces
// the same strict locale-safe numeric & token-symbol safety rules as Send/Swap/Vault.

import { ARCIS_POOLS, type PoolConfig } from '../config/poolsConfig.js'
import {
  canonicalCopilotTokenSymbol,
  mentionsUnsupportedBtc,
  validateSendAmount,
  WBTC_UNSUPPORTED_MESSAGE,
} from '../config/copilotTokens.js'
import { numberToExactDecimal, parseCopilotAmount } from './copilotAmount.js'

export const COPILOT_LP_POOLS: readonly PoolConfig[] = ARCIS_POOLS.filter((p) => p.isLpPool)

export function getCopilotLpPoolById(poolId?: string | null): PoolConfig | undefined {
  if (!poolId) return undefined
  const key = poolId.trim().toLowerCase()
  return COPILOT_LP_POOLS.find((p) => p.id.toLowerCase() === key)
}

export function findCopilotLpPoolByPair(
  tokenA?: string | null,
  tokenB?: string | null
): PoolConfig | undefined {
  if (!tokenA || !tokenB) return undefined
  const a = canonicalCopilotTokenSymbol(tokenA)
  const b = canonicalCopilotTokenSymbol(tokenB)
  if (a === b) return undefined
  return COPILOT_LP_POOLS.find((pool) => {
    const syms = pool.tokens.map((t) => t.symbol)
    return (syms[0] === a && syms[1] === b) || (syms[0] === b && syms[1] === a)
  })
}

export type PoolResolutionResult =
  | { status: 'matched'; pool: PoolConfig }
  | { status: 'unsupported_wbtc'; message: string }
  | { status: 'missing' }

const LP_TOKEN_SCAN_REGEX =
  /\b(?:circle[- ]?(?:wrapped[- ]?)?(?:btc|bitcoin)|cirbtc|usdc|eurc|weth|ethereum|dolar|euro|usd|eur|eth)\b/gi

function stripMemoAndSlippage(prompt: string): string {
  return prompt
    .replace(/0x[a-fA-F0-9]{40}/gi, ' ')
    .replace(/(?:\bmemo\b|\breference\b|(?:^|\s)(?:not|açıklama)\s*[:=])[\s\S]*$/i, ' ')
    .replace(/(?:slippage|kayma|tolerance|tolerans|slip)\s*(?:of|is|to|:|=)?\s*%?\s*[+-]?\d[\d.,]*(?:[eE][+-]?\d+)?\s*%?/gi, ' ')
    .replace(/[+-]?\d[\d.,]*(?:[eE][+-]?\d+)?\s*%\s*(?:slippage|kayma|tolerance|tolerans|slip)/gi, ' ')
    .replace(/%\s*[+-]?\d[\d.,]*\s*(?:slippage|kayma|tolerance|tolerans|slip)/gi, ' ')
}

/**
 * Deterministically resolves which AMM LP pool a user prompt targets.
 * Preserves the repo's WBTC/BTC refusal invariant so plain BTC/WBTC never silently maps to cirBTC.
 */
export function resolveCopilotLpPoolFromPrompt(prompt: string): PoolResolutionResult {
  const cleaned = stripMemoAndSlippage(prompt || '')
  const lower = cleaned.toLowerCase()

  if (mentionsUnsupportedBtc(cleaned)) {
    return { status: 'unsupported_wbtc', message: WBTC_UNSUPPORTED_MESSAGE }
  }

  // 1. Exact pool id match (e.g. "usdc-eurc-stable-pool", "eurc-weth-pool")
  for (const pool of COPILOT_LP_POOLS) {
    if (lower.includes(pool.id.toLowerCase())) {
      return { status: 'matched', pool }
    }
  }

  // 2. Explicit pair tokens in text (e.g. "USDC/EURC", "USDC - WETH", "EURC ve cirBTC", "cirBTC/WETH")
  const rawMatches = cleaned.match(LP_TOKEN_SCAN_REGEX) || []
  const uniqueTokens: string[] = []
  for (const raw of rawMatches) {
    const canon = canonicalCopilotTokenSymbol(raw)
    if (canon === 'WBTC' || canon === 'af-USDC') continue
    if (!uniqueTokens.includes(canon)) uniqueTokens.push(canon)
  }

  if (uniqueTokens.length >= 2) {
    // Check adjacent slash/dash pair first (e.g. "USDC/EURC" takes precedence over stray mentions)
    const pairMatch = cleaned.match(
      /\b(circle[- ]?(?:wrapped[- ]?)?(?:btc|bitcoin)|cirbtc|usdc|eurc|weth|eth|usd|eur)\s*[/\-–—]\s*(circle[- ]?(?:wrapped[- ]?)?(?:btc|bitcoin)|cirbtc|usdc|eurc|weth|eth|usd|eur)\b/i
    )
    if (pairMatch) {
      const directPool = findCopilotLpPoolByPair(pairMatch[1], pairMatch[2])
      if (directPool) return { status: 'matched', pool: directPool }
    }
    const pool = findCopilotLpPoolByPair(uniqueTokens[0], uniqueTokens[1])
    if (pool) return { status: 'matched', pool }
  }

  // 3. StableSwap shorthand
  if (/\b(?:stableswap|stable\s*pool|stabil\s*havuz)\b/i.test(lower)) {
    const stable = getCopilotLpPoolById('usdc-eurc-stable-pool')
    if (stable) return { status: 'matched', pool: stable }
  }

  return { status: 'missing' }
}

/**
 * Returns true when a prompt expresses an LP pool deposit intent (as opposed to the single-asset
 * USDC Yield Vault). Used by `classifyCopilotIntent` so Vault and LP commands never collide.
 */
export function isLpPoolPrompt(instructionText: string): boolean {
  const lower = instructionText.toLowerCase().replace(/ı/g, 'i')
  const explicitVaultOnly =
    /\b(?:vault|yield\s*vault|kasa|af-?usdc)\b/i.test(lower) &&
    !/\b(?:lp|liquidity|likidite|zap|stableswap)\b/i.test(lower) &&
    resolveCopilotLpPoolFromPrompt(instructionText).status !== 'matched'
  if (explicitVaultOnly) return false

  const poolRes = resolveCopilotLpPoolFromPrompt(instructionText)
  const hasDepositVerb =
    /\b(?:deposit|yatir|yatirmak|ekle|eklemek|add|provide|supply|stake|zap|koy)\b/i.test(lower) ||
    /\b(?:likidite|liquidity|lp)\b/i.test(lower)

  if (poolRes.status === 'matched' && hasDepositVerb) {
    return true
  }

  const hasExplicitLpTerm =
    /\b(?:zap|lp|liquidity|likidite|stableswap|havuz|havuza|havuzuna|havuzlara|pool|poola|pooluna)\b/i.test(lower)

  if (hasExplicitLpTerm && hasDepositVerb) {
    return true
  }

  return false
}

export type ParsedLpAmountsResult =
  | {
      status: 'valid'
      mode: 'zap' | 'dual'
      amountA?: number
      amountB?: number
      amountADecimal?: string
      amountBDecimal?: string
      autoMatchCounter: boolean
      anchorSide?: 'A' | 'B'
    }
  | { status: 'error'; message: string }

interface ExtractedTokenAmount {
  rawAmount: string
  amount: number
  decimal: string
  token?: string
}

/**
 * Parses one or two token amounts from an LP deposit prompt using the strict locale-safe
 * `parseCopilotAmount` validator and determines whether the operation is 1-Click Zap or Dual-Asset.
 */
export function parseCopilotLpAmounts(
  prompt: string,
  pool: PoolConfig
): ParsedLpAmountsResult {
  const cleaned = stripMemoAndSlippage(prompt || '')
  const lower = cleaned.toLowerCase().replace(/ı/g, 'i')

  const tokenASym = pool.tokens[0].symbol
  const tokenBSym = pool.tokens[1].symbol

  // Reject spaced thousands separators (e.g. "1 000") just like parseCopilotPromptAmount
  if (/\d[\d.,]*[ \u00a0\u202f]+\d/.test(cleaned)) {
    return {
      status: 'error',
      message:
        'Ambiguous amount / Belirsiz tutar. 1 000 or 1.000 can be ambiguous. Please re-enter the amount without thousands separators.',
    }
  }

  const explicitZap = /\b(?:zap|1-?click\s*zap|tek\s*tarafli|single[- ]?sided)\b/i.test(lower)
  const explicitDual = /\b(?:dual|cift|çift|proportional|orantili|orantılı|karsiligi|karşılığı)\b/i.test(lower)

  // Extract every number token together with an immediately following or preceding token symbol.
  const tokenWord = '(?:circle[- ]?(?:wrapped[- ]?)?(?:btc|bitcoin)|cirbtc|usdc|eurc|weth|ethereum|dolar|euro|usd|eur|eth)'
  const amountRegex = new RegExp(
    `(?:(?:^|[\\s$€+])([+-]?(?:\\d[\\d.,]*|[.,]\\d+)(?:[eE][+-]?\\d+)?)(?:\\s*(${tokenWord})\\b)?)|(?:\\b(${tokenWord})\\s+([+-]?(?:\\d[\\d.,]*|[.,]\\d+)(?:[eE][+-]?\\d+)?)(?=$|[\\s$€+,;]))`,
    'gi'
  )

  const extracted: ExtractedTokenAmount[] = []
  let match: RegExpExecArray | null
  while ((match = amountRegex.exec(cleaned)) !== null) {
    const rawNum = match[1] || match[4]
    const rawTok = match[2] || match[3]
    if (!rawNum) continue

    // Ignore pool tier percentages like "0.12%" or "0.30%" if immediately followed by %
    const endIdx = match.index + match[0].length
    if (cleaned[endIdx] === '%') continue

    const parsed = parseCopilotAmount(rawNum)
    if (parsed.status !== 'valid') {
      return { status: 'error', message: parsed.message }
    }

    const token = rawTok ? canonicalCopilotTokenSymbol(rawTok) : undefined
    extracted.push({
      rawAmount: rawNum,
      amount: parsed.amount,
      decimal: parsed.decimal,
      token,
    })
  }

  if (extracted.length === 0) {
    return {
      status: 'error',
      message: `<strong>Amount required.</strong>\n\nPlease specify how much to deposit into the <strong>${pool.name}</strong> pool — e.g. ${
        pool.supportsZap
          ? `"Zap 10 USDC into ${pool.name} pool" or "Add 10 ${tokenASym} and proportional ${tokenBSym} to ${pool.name} pool"`
          : `"Add 10 ${tokenASym} to ${pool.name} pool"`
      }.`,
    }
  }

  if (extracted.length > 2) {
    return {
      status: 'error',
      message: `<strong>Too many amounts specified.</strong>\n\nPlease specify one amount (for Zap or auto-matched deposit) or two amounts (one for ${tokenASym} and one for ${tokenBSym}).`,
    }
  }

  // Case 1: Two explicit amounts supplied → Dual-Asset LP deposit
  if (extracted.length === 2) {
    if (explicitZap) {
      return {
        status: 'error',
        message: `<strong>Conflicting LP mode.</strong>\n\n1-Click Zap takes a single USDC amount. To supply both ${tokenASym} and ${tokenBSym}, remove "zap" and use Dual-Asset deposit.`,
      }
    }

    const [first, second] = extracted
    let entryA: ExtractedTokenAmount | undefined
    let entryB: ExtractedTokenAmount | undefined

    if (first.token && second.token) {
      if (first.token === second.token) {
        return {
          status: 'error',
          message: `<strong>Both pool tokens required.</strong>\n\nSpecify amounts for both ${tokenASym} and ${tokenBSym} in the ${pool.name} pool.`,
        }
      }
      if (first.token === tokenASym && second.token === tokenBSym) {
        entryA = first
        entryB = second
      } else if (first.token === tokenBSym && second.token === tokenASym) {
        entryA = second
        entryB = first
      } else {
        return {
          status: 'error',
          message: `<strong>Token mismatch for ${pool.name}.</strong>\n\nThis pool only accepts <strong>${tokenASym}</strong> and <strong>${tokenBSym}</strong>.`,
        }
      }
    } else if (first.token && !second.token) {
      if (first.token === tokenASym) {
        entryA = first
        entryB = second
      } else if (first.token === tokenBSym) {
        entryB = first
        entryA = second
      } else {
        return {
          status: 'error',
          message: `<strong>Token mismatch for ${pool.name}.</strong>\n\nThis pool only accepts <strong>${tokenASym}</strong> and <strong>${tokenBSym}</strong>.`,
        }
      }
    } else if (!first.token && second.token) {
      if (second.token === tokenBSym) {
        entryA = first
        entryB = second
      } else if (second.token === tokenASym) {
        entryB = first
        entryA = second
      } else {
        return {
          status: 'error',
          message: `<strong>Token mismatch for ${pool.name}.</strong>\n\nThis pool only accepts <strong>${tokenASym}</strong> and <strong>${tokenBSym}</strong>.`,
        }
      }
    } else {
      // Neither carries an explicit token label → map in pool order (tokenA, tokenB)
      entryA = first
      entryB = second
    }

    const checkA = validateSendAmount(entryA.amount, tokenASym)
    if (!checkA.ok) {
      return { status: 'error', message: `<strong>Invalid ${tokenASym} amount.</strong>\n\n${checkA.error}` }
    }
    const checkB = validateSendAmount(entryB.amount, tokenBSym)
    if (!checkB.ok) {
      return { status: 'error', message: `<strong>Invalid ${tokenBSym} amount.</strong>\n\n${checkB.error}` }
    }

    return {
      status: 'valid',
      mode: 'dual',
      amountA: checkA.normalized!,
      amountB: checkB.normalized!,
      amountADecimal: numberToExactDecimal(checkA.normalized!)!,
      amountBDecimal: numberToExactDecimal(checkB.normalized!)!,
      autoMatchCounter: false,
    }
  }

  // Case 2: Single amount supplied
  const single = extracted[0]
  const tok = single.token || tokenASym

  if (tok !== tokenASym && tok !== tokenBSym) {
    return {
      status: 'error',
      message: `<strong>Unsupported token for ${pool.name}.</strong>\n\nThis pool accepts <strong>${tokenASym}</strong> and <strong>${tokenBSym}</strong>.`,
    }
  }

  const checkSingle = validateSendAmount(single.amount, tok)
  if (!checkSingle.ok) {
    return { status: 'error', message: `<strong>Invalid ${tok} amount.</strong>\n\n${checkSingle.error}` }
  }

  const canZapWithThisToken = Boolean(pool.supportsZap) && tok === 'USDC' && tokenASym === 'USDC'

  if (explicitZap && !canZapWithThisToken) {
    return {
      status: 'error',
      message: `<strong>1-Click Zap is not available for ${pool.name} with ${tok}.</strong>\n\n1-Click Zap is supported with <strong>USDC</strong> on USDC-paired pools (USDC/EURC, USDC/cirBTC, USDC/WETH). For <strong>${pool.name}</strong>, use Dual-Asset deposit — e.g. "Add ${single.decimal} ${tok} to ${pool.name} pool" and I will calculate the matching ${tok === tokenASym ? tokenBSym : tokenASym} amount automatically.`,
    }
  }

  if (canZapWithThisToken && !explicitDual) {
    return {
      status: 'valid',
      mode: 'zap',
      amountA: checkSingle.normalized!,
      amountADecimal: numberToExactDecimal(checkSingle.normalized!)!,
      autoMatchCounter: false,
      anchorSide: 'A',
    }
  }

  // Dual-Asset with single-side anchor (counter amount will be auto-matched from live pool reserves)
  if (tok === tokenASym) {
    return {
      status: 'valid',
      mode: 'dual',
      amountA: checkSingle.normalized!,
      amountADecimal: numberToExactDecimal(checkSingle.normalized!)!,
      autoMatchCounter: true,
      anchorSide: 'A',
    }
  }

  return {
    status: 'valid',
    mode: 'dual',
    amountB: checkSingle.normalized!,
    amountBDecimal: numberToExactDecimal(checkSingle.normalized!)!,
    autoMatchCounter: true,
    anchorSide: 'B',
  }
}

export function supportedLpPoolsListText(): string {
  return COPILOT_LP_POOLS.map((p) => `${p.name}${p.supportsZap ? ' (Zap/Dual)' : ' (Dual)'}`).join(', ')
}

export type ParsedLpRemoveAmountResult =
  | { status: 'percent'; percent: number }
  | { status: 'lp'; lpAmount: number; lpAmountDecimal: string }
  | { status: 'usd'; usdAmount: number }
  | { status: 'missing'; message: string }
  | { status: 'error'; message: string }

/**
 * Deterministically parses how much LP to remove from a prompt:
 * - Percentage: "50%", "%25", "100%", "all", "max", "hepsi", "tümü", "tamamı", "half", "yarısı", "quarter", "çeyrek"
 * - Exact LP token amount: "remove 10 LP", "2.5 LP çek"
 * - Explicit USD value: "remove $50", "50 USD likidite çek"
 * Rejects ambiguous locale separators and zero/negative values fail-closed.
 */
export function parseCopilotLpRemoveAmount(prompt: string, poolName?: string): ParsedLpRemoveAmountResult {
  const cleaned = stripMemoAndSlippage(prompt || '')
  const normalized = cleaned
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ç/g, 'c')

  if (/\d[\d.,]*[ \u00a0\u202f]+\d/.test(cleaned)) {
    return {
      status: 'error',
      message:
        'Ambiguous amount / Belirsiz tutar. 1 000 or 1.000 can be ambiguous. Please re-enter the amount without thousands separators.',
    }
  }

  // 1. Explicit percentage: "50%", "%50", "50 percent", "yüzde 50"
  const pctMatch =
    cleaned.match(/(?:^|\s)%\s*([+-]?\d[\d.,]*)/) ||
    cleaned.match(/([+-]?\d[\d.,]*)\s*%/) ||
    normalized.match(/\byuzde\s+([+-]?\d[\d.,]*)/) ||
    normalized.match(/([+-]?\d[\d.,]*)\s*percent\b/)
  if (pctMatch) {
    const parsed = parseCopilotAmount(pctMatch[1])
    if (parsed.status !== 'valid') return { status: 'error', message: parsed.message }
    if (parsed.amount <= 0 || parsed.amount > 100) {
      return {
        status: 'error',
        message: '<strong>Invalid percentage / Geçersiz yüzde.</strong>\n\nPlease specify a percentage between <strong>1%</strong> and <strong>100%</strong>.',
      }
    }
    return { status: 'percent', percent: parsed.amount }
  }

  // 2. Natural percentage keywords ("all", "max", "tümü", "hepsi", "half", "yarısı", "quarter", "çeyrek")
  if (/\b(?:all|max|full|entire|tum|tumu|tumunu|hepsi|hepsini|tamami|tamamini|butun)\b/.test(normalized) && !/\d/.test(cleaned)) {
    return { status: 'percent', percent: 100 }
  }
  if (/\b(?:half|yarisi|yarisini|yarim)\b/.test(normalized)) {
    return { status: 'percent', percent: 50 }
  }
  if (/\b(?:quarter|ceyrek|ceyregi|ceyregini)\b/.test(normalized)) {
    return { status: 'percent', percent: 25 }
  }

  // 3. Explicit USD value ("$50", "50 USD", "50 dolar")
  const usdMatch =
    cleaned.match(/\$\s*([+-]?\d[\d.,]*)/) ||
    normalized.match(/(?:^|\s)([+-]?\d[\d.,]*)\s*(?:usd|dolar)\b/)
  if (usdMatch) {
    const parsed = parseCopilotAmount(usdMatch[1])
    if (parsed.status !== 'valid') return { status: 'error', message: parsed.message }
    return { status: 'usd', usdAmount: parsed.amount }
  }

  // 4. Explicit LP token amount ("remove 10 LP", "2.5 LP çek", or bare positive number)
  const numMatch = cleaned.match(/(?:^|[\s])([+-]?(?:\d[\d.,]*|[.,]\d+)(?:[eE][+-]?\d+)?)(?=$|[\s]|[a-zA-Zğüşöçıİ])/i)
  if (numMatch) {
    const parsed = parseCopilotAmount(numMatch[1])
    if (parsed.status !== 'valid') return { status: 'error', message: parsed.message }
    return { status: 'lp', lpAmount: parsed.amount, lpAmountDecimal: parsed.decimal }
  }

  const label = poolName ? `<strong>${poolName}</strong>` : 'your LP pool'
  return {
    status: 'missing',
    message: `<strong>Specify how much LP to remove / Çekilecek LP miktarını belirtin.</strong>\n\nPlease include a percentage or LP amount for ${label} — e.g. <strong>"Remove 50% LP from ${poolName || 'USDC/EURC'} pool"</strong>, <strong>"Remove all LP from ${poolName || 'USDC/EURC'}"</strong>, or <strong>"Remove 10 LP from ${poolName || 'USDC/EURC'}"</strong>.`,
  }
}
