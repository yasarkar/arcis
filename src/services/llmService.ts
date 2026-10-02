// src/services/llmService.ts
// Intelligent LLM Intent Engine & Tool Calling for Arcis AI Copilot
// Supports OpenAI GPT-4o-mini with seamless, zero-latency Local NLP Fallback

import type { CopilotActionPayload, CopilotMessage } from '../types/marketplace'
import { arcTestnet } from '../config/arcChain'
import { ARC_GAS_LIMITS, calculateArcGasCostUsdc } from '../config/feeTiers'
import {
  getLiveTokenPrices,
  type TokenPriceMap,
} from './tokenPriceService'
import {
  getLivePortfolioSnapshot,
  formatPortfolioForPrompt,
  type PortfolioSnapshot,
} from './portfolioContextService'
import { availableTokenBalance } from '../utils/portfolioPrompt'
import { DEFAULT_COPILOT_SLIPPAGE, STORAGE_KEYS } from '../config/constants'
import {
  canonicalCopilotTokenSymbol,
  mentionsCirBtc,
  isUnsupportedCopilotToken,
  isSupportedCopilotSendToken,
  isValidEvmAddress,
  isZeroAddress,
  validateSendAmount,
} from '../config/copilotTokens'
import { getSwapEstimate } from './swapService'
import { calculateArcGasCostFromFee, getDynamicArcGasOptions } from './arcGasService'
import type { SwapQuoteResult } from '../types/swap'
export { DEFAULT_COPILOT_SLIPPAGE }

export interface LLMResult {
  message: string
  actionPayload?: CopilotActionPayload
  source: 'gpt-4o-mini' | 'local-nlp'
  executionTimeMs: number
}

/** Returns a live network fee; missing RPC quotes are explicitly shown as unavailable. */
function transferFeeFor(tokenSymbol: string, liveMaxFeePerGas?: bigint, hasMemo: boolean = false): string {
  // On Arc Testnet, native USDC value transfers consume 21k gas, while ERC-20 tokens
  // (EURC, cirBTC, WETH) consume ~65k gas, and memo smart contract calls consume ~75k gas.
  const isNativeUsdc = tokenSymbol.toUpperCase() === 'USDC'
  const gasLimit = hasMemo
    ? ARC_GAS_LIMITS.memoTransfer
    : isNativeUsdc
      ? ARC_GAS_LIMITS.nativeTransfer
      : ARC_GAS_LIMITS.erc20Transfer
  return liveMaxFeePerGas
    ? calculateArcGasCostFromFee(gasLimit, liveMaxFeePerGas)
    : calculateArcGasCostUsdc(gasLimit, 'fast')
}

function isKnownCopilotToken(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  const token = value.toLowerCase().replace(/[\s_-]/g, '')
  return ['usdc', 'usd', 'dolar', 'eurc', 'eur', 'euro', 'weth', 'eth', 'ethereum', 'cirbtc', 'circlebtc', 'circlebitcoin', 'circlewrappedbitcoin', 'wbtc', 'btc', 'bitcoin', 'wrappedbitcoin', 'afusdc', 'vault'].includes(token)
}

const COPILOT_TOKEN_PATTERN = String.raw`\b(?:circle[- ]?(?:wrapped[- ]?)?(?:btc|bitcoin)|af-usdc|usdc|eurc|weth|ethereum|wbtc|cirbtc|afusdc|dolar|euro|bitcoin|usd|eur|eth|btc)\b`

function unsupportedBtcGuidance(): { message: string } {
  return {
    message: `<strong>WBTC is not available on Arc Testnet.</strong>\n\nArc's Bitcoin asset is <strong>cirBTC</strong> (Circle Wrapped Bitcoin). Try again with cirBTC — e.g. "send 0.0001 cirBTC to 0x...".`,
  }
}

async function resolveLiveMaxFeePerGas(gasLimit: bigint = ARC_GAS_LIMITS.nativeTransfer): Promise<bigint | undefined> {
  try {
    const gas = await getDynamicArcGasOptions(undefined, 'fast', gasLimit)
    return gas.isDynamic ? gas.maxFeePerGas : undefined
  } catch {
    return undefined
  }
}

export function extractSlippageFromPrompt(
  prompt: string,
  fallbackSlippage: number = DEFAULT_COPILOT_SLIPPAGE
): number {
  if (!prompt) return fallbackSlippage
  const match =
    prompt.match(/(?:slippage|kayma|tolerance|tolerans|slip)\s*(?:of|is|:|=|%)?\s*(\d+(?:\.\d+)?)\s*%?/i) ||
    prompt.match(/(\d+(?:\.\d+)?)\s*%\s*(?:slippage|kayma|tolerans)/i)
  if (match && match[1]) {
    const val = parseFloat(match[1])
    if (!isNaN(val) && val > 0 && val <= 50) return Number(val.toFixed(2))
  }
  return fallbackSlippage
}

function resolveChainName(name: string): string {
  const n = (name || '').toLowerCase().trim()
  if (n.includes('base')) return 'Base Sepolia'
  if (n.includes('arbitrum') || n.includes('arb')) return 'Arbitrum Sepolia'
  if (n.includes('sepolia') || n.includes('eth') || n.includes('ethereum')) return 'Ethereum Sepolia'
  if (n.includes('solana') || n.includes('sol')) return 'Solana Devnet'
  if (n.includes('polygon') || n.includes('amoy')) return 'Polygon Amoy'
  if (n.includes('optimism') || n.includes('op')) return 'Optimism Sepolia'
  if (n.includes('avalanche') || n.includes('fuji') || n.includes('avax')) return 'Avalanche Fuji'
  if (n.includes('hyperevm')) return 'HyperEVM Testnet'
  if (n.includes('sei')) return 'Sei Testnet'
  if (n.includes('sonic')) return 'Sonic Testnet'
  if (n.includes('unichain')) return 'Unichain Sepolia'
  if (n.includes('world')) return 'World Chain Sepolia'
  if (n.includes('arc')) return 'Arc Testnet'
  return name.trim() || 'Arc Testnet'
}

export function extractSwapTokens(prompt: string): { fromTok: string; toTok: string } {
  const p = (prompt || '').toLowerCase()
  const normTok = (tok: string): string => canonicalCopilotTokenSymbol(tok)
  const tokRegex = COPILOT_TOKEN_PATTERN
  const fromToMatch = p.match(new RegExp(`from\\s+(${tokRegex})\\s+to\\s+(${tokRegex})`, 'i'))
  if (fromToMatch) return { fromTok: normTok(fromToMatch[1]), toTok: normTok(fromToMatch[2]) }
  const arrowMatch = p.match(new RegExp(`(${tokRegex})\\s*(?:->|➔|=>)\\s*(${tokRegex})`, 'i'))
  if (arrowMatch) return { fromTok: normTok(arrowMatch[1]), toTok: normTok(arrowMatch[2]) }
  const toMatch = p.match(new RegExp(`(${tokRegex})\\s+to\\s+(${tokRegex})`, 'i'))
  if (toMatch) return { fromTok: normTok(toMatch[1]), toTok: normTok(toMatch[2]) }
  const trVeripAlMatch = p.match(new RegExp(`(${tokRegex})\\s*(?:verip|ile|karşılığı|karsiligi)\\s*(${tokRegex})\\s*(?:al|almak|çevir|cevir|takas)`, 'i'))
  if (trVeripAlMatch) return { fromTok: normTok(trVeripAlMatch[1]), toTok: normTok(trVeripAlMatch[2]) }
  const trCevirMatch = p.match(new RegExp(`(${tokRegex})(?:'i|'yi|'ı|'yı|i|yi|ı|yı)\\s+(${tokRegex})(?:'e|'a|'ye|'ya|e|a|ye|ya|\\s+yap|\\s+çevir|\\s+cevir)`, 'i'))
  if (trCevirMatch) return { fromTok: normTok(trCevirMatch[1]), toTok: normTok(trCevirMatch[2]) }
  const buyMatch = p.match(new RegExp(`(?:buy|al|almak|satın\\s+al)\\s+(${tokRegex})|(${tokRegex})\\s+(?:al|almak|satın\\s+al)`, 'i'))
  if (buyMatch) {
    const target = normTok(buyMatch[1] || buyMatch[2])
    if (target !== 'USDC') return { fromTok: 'USDC', toTok: target }
  }
  const sellMatch = p.match(new RegExp(`(?:sell|sat|satmak)\\s+(${tokRegex})|(${tokRegex})\\s+(?:sat|satmak)`, 'i'))
  if (sellMatch) {
    const source = normTok(sellMatch[1] || sellMatch[2])
    if (source !== 'USDC') return { fromTok: source, toTok: 'USDC' }
  }
  const turkishMatch = p.match(new RegExp(`(${tokRegex})(?:'|’)?(?:den|dan|ten|tan)?\\s+(?:ile\\s+)?(${tokRegex})(?:'|’)?(?:ye|ya|e|a)?`, 'i'))
  if (turkishMatch) return { fromTok: normTok(turkishMatch[1]), toTok: normTok(turkishMatch[2]) }
  const allTokens = p.match(new RegExp(tokRegex, 'gi')) || []
  const canon = allTokens.map(normTok)
  const unique = [...new Set(canon)]
  if (unique.some((token) => token === 'WBTC')) return { fromTok: 'USDC', toTok: 'WBTC' }
  if (unique.length >= 2) return { fromTok: unique[0], toTok: unique[1] }

  const singleToken = unique[0]
  if (singleToken && singleToken !== 'USDC') {
    const isBuy = /\b(?:buy|al|almak|satın al)\b/i.test(p) || /\b(?:to|for)\s+(?:weth|eth|eurc|euro|cirbtc)\b/i.test(p)
    const isSell = /\b(?:sell|sat|satmak)\b/i.test(p)
    if (isBuy) return { fromTok: 'USDC', toTok: singleToken }
    if (isSell) return { fromTok: singleToken, toTok: 'USDC' }
  }
  return { fromTok: 'USDC', toTok: 'EURC' }
}

export function getOpenAIApiKey(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(STORAGE_KEYS.OPENAI_API_KEY)?.trim() || ''
}

export function setOpenAIApiKey(key: string): void {
  if (typeof window === 'undefined') return
  const normalizedKey = key.trim()
  if (normalizedKey) localStorage.setItem(STORAGE_KEYS.OPENAI_API_KEY, normalizedKey)
  else localStorage.removeItem(STORAGE_KEYS.OPENAI_API_KEY)
}

export function isExplicitTransactionCommand(prompt: string): boolean {
  if (!prompt) return false
  const p = prompt.toLowerCase().trim()
  if (p.includes('what is') || p.includes('how do') || p.includes('how does') || p.includes('explain') || p.includes('tell me about')) return false
  const hasAddress = /0x[a-fA-F0-9]{40}/i.test(prompt)
  const hasAmount = /\d+(?:\.\d+)?/.test(prompt)
  const words = p.replace(/[^a-z0-9ğüşöçıİ ]/gi, ' ').split(/\s+/)
  const hasAny = (...verbs: string[]) => verbs.some((verb) => words.includes(verb))
  const hasSendVerb = hasAny('send', 'transfer', 'gönder', 'yolla', 'pay', 'öde')
  const hasSwapVerb = hasAny('swap', 'takas', 'trade', 'convert', 'çevir', 'dönüştür', 'buy', 'sell', 'al', 'almak', 'sat', 'satmak') || p.includes('satın al')
  const hasDepositVerb = hasAny('deposit', 'vault', 'yatır', 'stake', 'havuz')
  const hasBridgeVerb = hasAny('bridge', 'gateway', 'köprü', 'aktar')
  if (hasSendVerb && (hasAddress || hasAmount)) return true
  if (hasSwapVerb && hasAmount) return true
  if (hasDepositVerb && hasAmount) return true
  if (hasBridgeVerb && hasAmount) return true
  return false
}

function ensureActionableTransactionResult(
  result: { message: string; actionPayload?: CopilotActionPayload },
  userPrompt: string,
  walletAddress?: string,
  livePrices?: TokenPriceMap,
  chatHistory?: CopilotMessage[],
  portfolio?: PortfolioSnapshot,
  liveMaxFeePerGas?: bigint
): { message: string; actionPayload?: CopilotActionPayload } {
  if (result.actionPayload || !isExplicitTransactionCommand(userPrompt)) return result
  const local = parseLocalIntentFallback(userPrompt, walletAddress, livePrices, chatHistory, portfolio, liveMaxFeePerGas)
  return local.actionPayload ? { message: local.message, actionPayload: local.actionPayload } : result
}

export async function queryArcisLLM(
  userPrompt: string,
  walletAddress?: string,
  chatHistory?: CopilotMessage[],
  portfolioSnapshot?: PortfolioSnapshot
): Promise<LLMResult> {
  const customApiKey = getOpenAIApiKey()
  const startTime = Date.now()
  const [livePrices, portfolio, liveMaxFeePerGas] = await Promise.all([
    getLiveTokenPrices(),
    portfolioSnapshot ? Promise.resolve(portfolioSnapshot) : getLivePortfolioSnapshot(walletAddress),
    isExplicitTransactionCommand(userPrompt) ? resolveLiveMaxFeePerGas() : Promise.resolve(undefined),
  ])

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (customApiKey) headers.Authorization = `Bearer ${customApiKey}`
    let res = await fetch('/api/copilot', {
      method: 'POST', headers,
      body: JSON.stringify({ userPrompt, walletAddress, livePrices, chatHistory, portfolio }),
    })
    // If the BYOK credential is rejected, retry through the server-owned key.
    if (!res.ok && customApiKey) {
      res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt, walletAddress, livePrices, chatHistory, portfolio }),
      })
    }
    if (res.ok) {
      const data = await res.json()
      if (data.success && data.message) {
        const safeResult = await quoteResult(
          { message: data.message, actionPayload: data.actionPayload }, userPrompt, walletAddress,
          livePrices, chatHistory, portfolio, liveMaxFeePerGas
        )
        return { ...safeResult, source: (data.source || 'gpt-4o-mini') as any, executionTimeMs: Date.now() - startTime }
      }
    } else {
      const data = await res.json().catch(() => ({}))
      if (customApiKey && !data.fallbackToLocal) {
        try {
          const gptResult = await callGPT4oMini(userPrompt, customApiKey, walletAddress, livePrices, chatHistory, portfolio)
          const safeResult = await quoteResult(
            gptResult, userPrompt, walletAddress, livePrices, chatHistory, portfolio, liveMaxFeePerGas
          )
          return { ...safeResult, source: 'gpt-4o-mini', executionTimeMs: Date.now() - startTime }
        } catch (directErr) {
          console.warn('Direct BYOK GPT-4o-mini call failed:', directErr)
        }
      }
    }
  } catch (err) {
    console.warn('Backend /api/copilot call failed, falling back to local NLP engine:', err)
  }

  const localResult = parseLocalIntentFallback(userPrompt, walletAddress, livePrices, chatHistory, portfolio, liveMaxFeePerGas)
  const quotedResult = await quoteResult(
    localResult, userPrompt, walletAddress, livePrices, chatHistory, portfolio, liveMaxFeePerGas
  )
  return { ...quotedResult, source: 'local-nlp', executionTimeMs: Date.now() - startTime }
}

async function quoteResult<T extends { message: string; actionPayload?: CopilotActionPayload }>(
  result: T,
  userPrompt: string,
  walletAddress: string | undefined,
  livePrices: TokenPriceMap,
  chatHistory: CopilotMessage[] | undefined,
  portfolio: PortfolioSnapshot,
  liveMaxFeePerGas: bigint | undefined
): Promise<T> {
  // For clear transaction commands, local parsing is the authority for user-specified parameters.
  // The model may help with natural language, but must not alter amount, token, or recipient.
  const authoritativeResult = isExplicitTransactionCommand(userPrompt)
    ? parseLocalIntentFallback(userPrompt, walletAddress, livePrices, chatHistory, portfolio, liveMaxFeePerGas)
    : result
  const actionable = ensureActionableTransactionResult(
    authoritativeResult, userPrompt, walletAddress, livePrices, chatHistory, portfolio, liveMaxFeePerGas
  )
  return attachLiveQuote(actionable, walletAddress, portfolio)
}

export async function attachLiveQuote<T extends { message: string; actionPayload?: CopilotActionPayload }>(
  result: T,
  walletAddress?: string,
  portfolio?: PortfolioSnapshot
): Promise<T> {
  const payload = result.actionPayload
  const isSwap = payload?.type === 'interactive_swap' || payload?.type === 'trade'
  const isSend = payload?.type === 'interactive_send' || payload?.type === 'send'
  if (!payload || (!isSwap && !isSend)) return result
  const data = payload.data || {}
  const amount = Number(data.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ...result, message: '<strong>Valid amount required.</strong><br/><br/>Please provide a positive transaction amount.', actionPayload: undefined }
  }
  const fromTokenRaw = String(data.fromToken || '')
  const toTokenRaw = String(data.toToken || '')
  const fromToken = canonicalCopilotTokenSymbol(fromTokenRaw || 'USDC')
  const toToken = canonicalCopilotTokenSymbol(toTokenRaw || 'EURC')
  if (isSwap && (isUnsupportedCopilotToken(fromToken) || isUnsupportedCopilotToken(toToken))) {
    return { ...result, message: unsupportedBtcGuidance().message, actionPayload: undefined }
  }
  if (isSwap && (!isKnownCopilotToken(fromTokenRaw) || !isKnownCopilotToken(toTokenRaw) || fromToken === toToken)) {
    return { ...result, message: '<strong>Valid swap pair required.</strong><br/><br/>Please select two different supported tokens.', actionPayload: undefined }
  }
  const sendTokenRaw = String(data.tokenSymbol || data.token || 'USDC')
  const sendToken = canonicalCopilotTokenSymbol(sendTokenRaw)
  if (isSend) {
    const validation = validateSendAmount(amount, sendToken)
    const recipient = String(data.recipient || data.recipientAddress || '')
    if (isUnsupportedCopilotToken(sendToken)) return { ...result, message: unsupportedBtcGuidance().message, actionPayload: undefined }
    if (!isKnownCopilotToken(sendTokenRaw) || !isSupportedCopilotSendToken(sendToken)) {
      return { ...result, message: '<strong>Unsupported transfer token.</strong><br/><br/>Choose USDC, EURC, WETH, or cirBTC.', actionPayload: undefined }
    }
    if (!validation.ok) return { ...result, message: `<strong>Invalid amount.</strong><br/><br/>${validation.error}`, actionPayload: undefined }
    if (!isValidEvmAddress(recipient) || isZeroAddress(recipient)) {
      return { ...result, message: '<strong>Valid recipient required.</strong><br/><br/>Please provide a non-zero 20-byte Arc wallet address.', actionPayload: undefined }
    }
    if (walletAddress && recipient.toLowerCase() === walletAddress.toLowerCase()) {
      return { ...result, message: '<strong>Invalid recipient.</strong><br/><br/>That is your own wallet address — the transfer would be a no-op.', actionPayload: undefined }
    }
    const available = availableTokenBalance(portfolio, sendToken)
    if (available !== null && validation.normalized! > available) {
      return { ...result, message: `<strong>Insufficient balance.</strong><br/><br/>You have ${available} ${sendToken} available on Arc Testnet.`, actionPayload: undefined }
    }
  }

  const slippage = Number(data.slippage ?? DEFAULT_COPILOT_SLIPPAGE)
  if (isSwap && (!Number.isFinite(slippage) || slippage <= 0 || slippage > 50)) {
    return { ...result, message: '<strong>Invalid slippage.</strong><br/><br/>Choose a slippage tolerance greater than 0% and no more than 50%.', actionPayload: undefined }
  }

  let quote: SwapQuoteResult | undefined
  if (isSwap) {
    try {
      quote = await getSwapEstimate({
        fromChain: 'Arc_Testnet', tokenIn: fromToken, tokenOut: toToken, amountIn: amount.toString(),
        recipientAddress: walletAddress,
        slippageTolerance: slippage / 100,
      })
      if (!Number.isFinite(Number(quote.estimatedOutput)) || Number(quote.estimatedOutput) <= 0 ||
        !Number.isFinite(Number(quote.stopLimit)) || Number(quote.stopLimit) <= 0 || Number(quote.stopLimit) > Number(quote.estimatedOutput)) quote = undefined
    } catch (error) {
      console.warn('[llmService] Live swap quote unavailable:', error)
    }
  }

  const hasMemo = Boolean(data.memo && String(data.memo).trim().length > 0)
  // Native USDC on Arc is the gas asset: a plain USDC transfer costs 21k gas like a value send,
  // while ERC-20 tokens (EURC, cirBTC, WETH) cost ~65k and memo contract calls ~75k. Quoting
  // native USDC sends at the ERC-20 limit inflated the preview fee ~3x vs the actual ArcScan fee.
  const isNativeUsdcSend = isSend && sendToken.toUpperCase() === 'USDC'
  const gasLimit = isSend
    ? hasMemo
      ? ARC_GAS_LIMITS.memoTransfer
      : isNativeUsdcSend
        ? ARC_GAS_LIMITS.nativeTransfer
        : ARC_GAS_LIMITS.erc20Transfer
    : ARC_GAS_LIMITS.contractInteraction
  let estimatedFeeUsdc: string | undefined
  let feeEstimateSource: string | undefined
  try {
    const gas = await getDynamicArcGasOptions(undefined, 'fast', gasLimit)
    estimatedFeeUsdc = calculateArcGasCostFromFee(gasLimit, gas.maxFeePerGas)
    feeEstimateSource = gas.source
  } catch (error) {
    console.warn('[llmService] Live network fee unavailable:', error)
  }

  const estimatedOut = quote ? Number(Number(quote.estimatedOutput).toFixed(8)) : undefined
  const minReceived = quote ? Number(Number(quote.stopLimit).toFixed(8)) : undefined
  const rate = quote ? Number(quote.rate) : undefined
  const nextPayload: CopilotActionPayload = {
    ...payload,
    ...(isSwap && { title: `🔄 Confirm Swap: ${amount} ${fromToken}${estimatedOut === undefined ? '' : ` ➔ ${estimatedOut} ${toToken}`}` }),
    data: { ...data, ...(isSwap && { estimatedOut, minReceived, rate }), estimatedFeeUsdc, feeEstimateSource },
  }

  // Structured details live in the action payload (rendered by the action card and the
  // corporate success receipt); the assistant message stays a short lead-in sentence
  // so the user never sees the same data twice.
  return { ...result, actionPayload: nextPayload }
}

export const queryArcoLLM = queryArcisLLM

async function callGPT4oMini(
  userPrompt: string,
  apiKey: string,
  walletAddress?: string,
  livePrices?: TokenPriceMap,
  chatHistory?: CopilotMessage[],
  portfolio?: PortfolioSnapshot
): Promise<{ message: string; actionPayload?: CopilotActionPayload }> {
  const prices = livePrices || (await getLiveTokenPrices())
  const port = portfolio || (await getLivePortfolioSnapshot(walletAddress))
  const portfolioText = formatPortfolioForPrompt(port)
  const systemPrompt = `You are Arco, the ultra-smart autonomous AI Copilot & Chief DeFi Strategist of Arcis Protocol on Arc Testnet blockchain (Chain ID: ${arcTestnet.id}).
Arcis features:
- Gas Currency: ${arcTestnet.nativeCurrency.symbol} (no ETH needed; network fees are paid in USDC at the live Arc base fee)
- Speed: <500ms deterministic sub-second finality
- Supported Tokens: USDC, EURC, WETH, cirBTC, af-USDC (there is NO WBTC on Arc Testnet — never use WBTC; the Bitcoin asset is cirBTC)
- Real-Yield Vault (af-USDC): 8.42% APY compound real yield
- Circle Gateway: Instant cross-chain unified balance across Ethereum, Base, Arbitrum, Solana, Polygon
- Live Real-Time Market Prices: 1 EURC ≈ ${prices.EURC || 1.08} USDC, 1 WETH ≈ ${prices.WETH || 2650} USDC, 1 cirBTC ≈ ${prices.CIRBTC || prices.WBTC || 63000} USDC

${portfolioText}

CHIEF DEFI STRATEGIST & PORTFOLIO RULES:
- You act as the user's personal proactive DeFi Strategist.
- ALWAYS execute explicit user transactional commands (e.g. "send 1 usdc to 0x...", "swap 10 usdc to eurc", "deposit 50 usdc", "bridge 25 usdc") by calling their corresponding tool (execute_send, execute_swap, execute_deposit_yield, execute_bridge). NEVER refuse or block an explicit transactional command with a faucet message; the on-chain execution engine and session key limits will validate the real-time balance.
- When the user asks exploratory questions about their portfolio, balance, what to do with funds, advice, or strategy ("portföyümü analiz et", "ne yapmalıyım", "strateji öner", "portfolio status", "where to get yield"), analyze their exact real-time liquid vs staked vs cross-chain balances from the snapshot above:
  - If the user has idle USDC on Arc Testnet (> $50), recommend depositing the recommended amount (${port.recommendedVaultDeposit.toFixed(2)} USDC) into the Real-Yield Vault (8.42% APY) while keeping sufficient liquidity for gas/swaps, and call execute_deposit_yield.
  - If the user has cross-chain USDC on Circle Gateway, recommend bridging to Arc Testnet for instant sub-second finality, and call execute_bridge.
  - If the user has $0 balance and asks how to get started, advise them to connect their wallet and bridge or transfer USDC to their address on Arc Testnet.
- CONTEXT & MULTI-TURN DIALOGUE:
  - You have full awareness of the recent conversation history.
  - If the user corrects or updates a previous action (e.g. "actually make it 250", "swap to WETH instead"), seamlessly resolve parameters and trigger the updated tool call.
- FORMATTING RULES:
  - Never use markdown bold asterisks (do not use **).
  - Use <strong> tags for bold headings and key bullet points.
  - Leave generous blank lines between paragraphs.
  - Keep tone professional, welcoming, and high-tech.
  - NEVER repeat transaction parameters (amount, tokens, recipient, fee, network, slippage) as bullet lists in your message. The interactive action card and the transaction receipt already render every detail — your message is only a short professional lead-in sentence (one or two sentences) that introduces the card below it.`

  const ARC_COPILOT_TOOLS = [
    { type: 'function', function: { name: 'execute_swap', description: 'Execute instant on-chain token swap on Arc Testnet DEX with USDC native gas', parameters: { type: 'object', properties: { fromToken: { type: 'string', description: 'Token symbol to swap from (e.g. USDC, EURC, cirBTC)' }, toToken: { type: 'string', description: 'Token symbol to swap to (e.g. USDC, EURC, cirBTC)' }, amount: { type: 'number', description: 'Amount of tokens to swap' }, slippage: { type: 'number', description: 'Slippage percentage e.g. 0.1' } }, required: ['fromToken', 'toToken', 'amount'] } } },
    { type: 'function', function: { name: 'execute_deposit_yield', description: 'Deposit USDC into Arcis Real-Yield vault earning 8.42% APY', parameters: { type: 'object', properties: { amount: { type: 'number', description: 'Amount of USDC to deposit' } }, required: ['amount'] } } },
    { type: 'function', function: { name: 'execute_bridge', description: 'Bridge USDC via Circle Gateway between Arc Testnet and other chains (e.g. Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, Solana Devnet)', parameters: { type: 'object', properties: { fromChain: { type: 'string' }, toChain: { type: 'string' }, amount: { type: 'number' } }, required: ['amount'] } } },
    { type: 'function', function: { name: 'execute_send', description: 'Send or transfer USDC/EURC/WETH/cirBTC to a recipient address on Arc Testnet with optional memo. WBTC is NOT supported on Arc.', parameters: { type: 'object', properties: { recipient: { type: 'string' }, amount: { type: 'number' }, token: { type: 'string' }, memo: { type: 'string' } }, required: ['recipient', 'amount'] } } },
  ]

  const isOpenRouter = apiKey.startsWith('sk-or-')
  const endpoint = isOpenRouter ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions'
  const modelName = isOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4o-mini'
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
  if (isOpenRouter) {
    headers['HTTP-Referer'] = 'https://arcis.finance'
    headers['X-Title'] = 'Arcis Protocol'
  }
  const cleanHistory = (chatHistory || []).slice(-6).filter((m) => m.content && m.content.trim() !== '').map((m) => ({
    role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: m.content.replace(/<[^>]*>?/gm, '').trim(),
  }))
  const messagesPayload: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [{ role: 'system', content: systemPrompt }, ...cleanHistory]
  const lastItem = cleanHistory[cleanHistory.length - 1]
  if (!lastItem || lastItem.role !== 'user' || lastItem.content !== userPrompt.trim()) messagesPayload.push({ role: 'user', content: userPrompt })
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ model: modelName, messages: messagesPayload, tools: ARC_COPILOT_TOOLS, tool_choice: 'auto', temperature: 0.2 }) })
  if (!response.ok) throw new Error(`OpenAI API error (${response.status}): ${await response.text()}`)
  const data = await response.json()
  const choice = data.choices?.[0]
  if (!choice) throw new Error('No choice returned from OpenAI')
  const toolCalls = choice.message?.tool_calls
  if (toolCalls && toolCalls.length > 0) {
    const call = toolCalls[0]
    const fnName = call.function.name
    const args = JSON.parse(call.function.arguments || '{}')
    if (fnName === 'execute_swap') {
      const fromTok = args.fromToken ? canonicalCopilotTokenSymbol(args.fromToken) : ''
      const toTok = args.toToken ? canonicalCopilotTokenSymbol(args.toToken) : ''
      if (fromTok === 'WBTC' || toTok === 'WBTC') return unsupportedBtcGuidance()
      const amount = Number(args.amount)
      if (!Number.isFinite(amount) || amount <= 0) {
        return { message: '<strong>Amount required.</strong><br/><br/>Please specify a positive amount to swap.' }
      }
      if (!isKnownCopilotToken(args.fromToken) || !isKnownCopilotToken(args.toToken) || !fromTok || !toTok || fromTok === toTok) {
        return { message: '<strong>Swap pair required.</strong>\\n\\nPlease specify both tokens, for example: "swap 25 USDC to EURC".' }
      }
      const slippage = Number(args.slippage) || extractSlippageFromPrompt(userPrompt, DEFAULT_COPILOT_SLIPPAGE)
      if (!Number.isFinite(slippage) || slippage <= 0 || slippage > 50) {
        return { message: '<strong>Invalid slippage.</strong><br/><br/>Choose a slippage tolerance greater than 0% and no more than 50%.' }
      }
      return {
        message: `I have prepared your instant token swap on Arc Testnet. Review the details and confirm the trade below to execute on-chain.`,
        actionPayload: { type: 'interactive_swap', title: `🔄 Confirm Swap: ${amount} ${fromTok}`, data: { fromToken: fromTok, toToken: toTok, amount, slippage } },
      }
    }
    if (fnName === 'execute_deposit_yield') {
      const amount = Number(args.amount)
      if (!Number.isFinite(amount) || amount <= 0) return { message: '<strong>Valid amount required.</strong>\\n\\nPlease provide a positive USDC deposit amount.' }
      const yearlyYield = amount * 0.0842
      return { message: `I have calculated your compound yield allocation. Click below to allocate your USDC into the YieldVault.`, actionPayload: { type: 'interactive_deposit', title: `🏦 Deposit ${amount} USDC into YieldVault`, data: { amount, apy: '8.42%', estimatedYieldUsdcYearly: Number(yearlyYield.toFixed(2)) } } }
    }
    if (fnName === 'execute_bridge') {
      const fromChain = args.fromChain ? resolveChainName(args.fromChain) : 'Arc Testnet'
      const toChain = args.toChain ? resolveChainName(args.toChain) : (fromChain === 'Arc Testnet' ? 'Ethereum Sepolia' : 'Arc Testnet')
      const amount = Number(args.amount)
      if (!Number.isFinite(amount) || amount <= 0) return { message: '<strong>Valid amount required.</strong>\\n\\nPlease provide a positive USDC bridge amount.' }
      return { message: `I have initialized your Circle Gateway transfer. Click below to review and execute the secure transfer.`, actionPayload: { type: 'interactive_bridge', title: `🌉 Bridge ${amount} USDC (${fromChain} ➔ ${toChain})`, data: { fromChain, toChain, amount } } }
    }
    if (fnName === 'execute_send') {
      const recipient = args.recipient || ''
      const token = canonicalCopilotTokenSymbol(args.token)
      if (isUnsupportedCopilotToken(token)) return unsupportedBtcGuidance()
      if (!isKnownCopilotToken(args.token || 'USDC') || !isSupportedCopilotSendToken(token)) {
        return { message: '<strong>Unsupported transfer token.</strong>\\n\\nChoose USDC, EURC, WETH, or cirBTC.' }
      }
      const amountCheck = validateSendAmount(args.amount, token)
      if (!amountCheck.ok) return { message: `<strong>Invalid amount.</strong>\\n\\n${amountCheck.error}` }
      if (!isValidEvmAddress(recipient) || isZeroAddress(recipient)) {
        return { message: '<strong>Valid recipient required.</strong>\\n\\nPlease provide a non-zero 20-byte Arc wallet address.' }
      }
      if (walletAddress && recipient.toLowerCase() === walletAddress.toLowerCase()) {
        return { message: '<strong>Invalid recipient.</strong>\\n\\nThat is your own wallet address — the transfer would be a no-op.' }
      }
      const available = availableTokenBalance(port, token)
      if (available !== null && amountCheck.normalized! > available) {
        return { message: `<strong>Insufficient balance.</strong>\\n\\nYou have ${available} ${token} available on Arc Testnet.` }
      }
      const amount = amountCheck.normalized!
      const memo = args.memo || ''
      const hasMemo = Boolean(memo && memo.trim().length > 0)
      const shortRecipient = recipient.length >= 10 ? `${recipient.slice(0, 6)}...${recipient.slice(-4)}` : recipient
      const isNativeUsdc = token.toUpperCase() === 'USDC'
      const targetGasLimit = hasMemo
        ? ARC_GAS_LIMITS.memoTransfer
        : isNativeUsdc
          ? ARC_GAS_LIMITS.nativeTransfer
          : ARC_GAS_LIMITS.erc20Transfer
      const liveMaxFeePerGas = await resolveLiveMaxFeePerGas(targetGasLimit)
      const sendFeeUsdc = transferFeeFor(token, liveMaxFeePerGas, hasMemo)
      return {
        message: `I have prepared your transfer on Arc Testnet.${memo ? ` Memo: ${memo}.` : ''} Click below to confirm and broadcast this transaction on-chain.`,
        actionPayload: {
          type: 'interactive_send',
          title: `📤 Send ${amount} ${token} to ${shortRecipient}`,
          data: { recipient, amount, tokenSymbol: token, memo, estimatedFeeUsdc: sendFeeUsdc },
        },
      }
    }
  }
  let rawContent = choice.message?.content || 'I have analyzed your request.'
  rawContent = rawContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  return { message: rawContent }
}

export function parseLocalIntentFallback(
  prompt: string,
  walletAddress?: string,
  livePrices?: TokenPriceMap,
  chatHistory?: CopilotMessage[],
  portfolio?: PortfolioSnapshot,
  liveMaxFeePerGas?: bigint
): { message: string; actionPayload?: CopilotActionPayload } {
  const p = prompt.toLowerCase().trim()
  const extractedPromptSlippage = extractSlippageFromPrompt(prompt, DEFAULT_COPILOT_SLIPPAGE)
  const cleanedPromptForAmount = prompt.replace(/0x[a-fA-F0-9]{40}/gi, '')
    .replace(/(?:slippage|kayma|tolerance|tolerans|slip)\s*(?:of|is|:|=|%)?\s*(\d+(?:\.\d+)?)\s*%?/gi, '')
    .replace(/(\d+(?:\.\d+)?)\s*%\s*(?:slippage|kayma|tolerans)/gi, '')
  const amountMatch = cleanedPromptForAmount.match(/(?:^|\s|\$)([\d,]+(?:\.\d+)?)(?:\s|$|\$|[a-zA-Z])/i)
  const parsedAmount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 100
  const lastActionMsg = [...(chatHistory || [])].reverse().find((m) => m.actionPayload && m.actionPayload.data)
  const prevAction = lastActionMsg?.actionPayload
  const isCorrection = p.includes('pardon') || p.includes('yerine') || p.includes('aslında') || p.includes('bunu') ||
    p.includes('yap') || p.includes('değiştir') || p.includes('instead') || p.includes('actually') || p.includes('make it') ||
    p.includes('change') || p.includes('slippage') || p.includes('kayma') ||
    (amountMatch !== null && p.split(' ').length <= 4 && !p.includes('swap') && !p.includes('deposit') && !p.includes('bridge') && !p.includes('takas'))
  if (isCorrection && prevAction) {
    const prevData = prevAction.data || {}
    if (prevAction.type === 'interactive_swap' || prevAction.type === 'trade') {
      const newAmount = amountMatch ? parsedAmount : (prevData.amount || 0)
      if (!Number.isFinite(newAmount) || newAmount <= 0) return { message: '<strong>Valid amount required.</strong>\n\nPlease include a positive swap amount.' }
      let fromTok = prevData.fromToken || 'USDC'
      let toTok = prevData.toToken || 'EURC'
      if (mentionsCirBtc(p)) toTok = 'cirBTC'
      else if (!mentionsCirBtc(p) && (p.includes('wbtc') || p.includes('btc') || p.includes('bitcoin'))) return unsupportedBtcGuidance()
      else if (/\b(?:weth|eth|ethereum)\b/i.test(p)) toTok = 'WETH'
      else if (p.includes('eurc')) toTok = 'EURC'
      else if (p.includes('usdc')) fromTok = 'USDC'
      const slippage = extractSlippageFromPrompt(prompt, prevData.slippage !== undefined ? Number(prevData.slippage) : DEFAULT_COPILOT_SLIPPAGE)
      return {
        message: `I have updated your instant swap on Arc Testnet. Confirm below to execute this updated trade on Arc Testnet.`,
        actionPayload: { type: 'interactive_swap', title: `🔄 Confirm Swap: ${newAmount} ${fromTok}`, data: { fromToken: fromTok, toToken: toTok, amount: newAmount, slippage } },
      }
    }
    if (prevAction.type === 'interactive_deposit') {
      const newAmount = amountMatch ? parsedAmount : (prevData.amount || 0)
      if (!Number.isFinite(newAmount) || newAmount <= 0) return { message: '<strong>Valid amount required.</strong>\\n\\nPlease include a positive USDC deposit amount.' }
      const yearlyReturn = newAmount * 0.0842
      return { message: `I have updated your YieldVault deposit allocation. Click below to verify and lock in your updated deposit.`, actionPayload: { type: 'interactive_deposit', title: `🏦 Deposit ${newAmount} USDC into YieldVault (8.42% APY)`, data: { amount: newAmount, apy: '8.42%', estimatedYieldUsdcYearly: Number(yearlyReturn.toFixed(2)) } } }
    }
    if (prevAction.type === 'interactive_bridge') {
      const newAmount = amountMatch ? parsedAmount : (prevData.amount || 0)
      if (!Number.isFinite(newAmount) || newAmount <= 0) return { message: '<strong>Valid amount required.</strong>\\n\\nPlease include a positive USDC bridge amount.' }
      let fromChain = prevData.fromChain || 'Arc Testnet'
      let toChain = prevData.toChain || 'Ethereum Sepolia'
      if (p.includes('base')) toChain = 'Base Sepolia'
      else if (p.includes('arbitrum') || p.includes('arb')) toChain = 'Arbitrum Sepolia'
      else if (p.includes('solana') || p.includes('sol')) toChain = 'Solana Devnet'
      else if (p.includes('sepolia') || p.includes('eth')) toChain = 'Ethereum Sepolia'
      return { message: `I have updated your Circle Gateway transfer. Click below to verify and execute your updated transfer.`, actionPayload: { type: 'interactive_bridge', title: `🌉 Bridge ${newAmount} USDC (${fromChain} ➔ ${toChain})`, data: { fromChain, toChain, amount: newAmount } } }
    }
    if (prevAction.type === 'interactive_send' || prevAction.type === 'send') {
      let newAmount = amountMatch ? parsedAmount : (Number(prevData.amount) || 0)
      const recipient = prompt.match(/0x[a-fA-F0-9]{40}/i)?.[0] || prevData.recipient || ''
      let tokenSymbol = prevData.tokenSymbol || 'USDC'
      if (mentionsCirBtc(p)) tokenSymbol = 'cirBTC'
      else if (p.includes('eurc')) tokenSymbol = 'EURC'
      else if (/\b(?:weth|eth|ethereum)\b/i.test(p)) tokenSymbol = 'WETH'
      else if (!mentionsCirBtc(p) && (p.includes('wbtc') || p.includes('btc') || p.includes('bitcoin'))) return unsupportedBtcGuidance()
      else if (p.includes('usdc')) tokenSymbol = 'USDC'
      const memo = prompt.match(/(?:memo|not|açıklama|reference)\s*[:=]?\s*["']?([^"',\n]+)["']?/i)?.[1]?.trim() || prevData.memo
      const amountCheck = validateSendAmount(newAmount, tokenSymbol)
      if (!amountCheck.ok) return { message: `<strong>Invalid amount.</strong>\n\n${amountCheck.error}` }
      if (!isValidEvmAddress(recipient)) return { message: `<strong>Recipient required.</strong>\n\nPlease provide a valid Arc (EVM) wallet address (0x...).` }
      if (isZeroAddress(recipient)) return { message: `<strong>Invalid recipient.</strong>\n\nThat is the zero address (0x000…000); sending there would permanently burn the funds.` }
      newAmount = amountCheck.normalized!
      if (walletAddress && recipient.toLowerCase() === walletAddress.toLowerCase()) return { message: '<strong>Invalid recipient.</strong><br/><br/>That is your own wallet address — the transfer would be a no-op.' }
      const available = availableTokenBalance(portfolio, tokenSymbol)
      if (available !== null && amountCheck.normalized! > available) return { message: `<strong>Insufficient balance.</strong><br/><br/>You have ${available} ${tokenSymbol} available on Arc Testnet.` }
      const shortRecipient = `${recipient.slice(0, 6)}...${recipient.slice(-4)}`
      const hasMemo = Boolean(memo && memo.trim().length > 0)
      const feeEstimate = transferFeeFor(tokenSymbol, liveMaxFeePerGas, hasMemo)
      return {
        message: `I have updated your transfer on Arc Testnet.${memo ? ` Memo: ${memo}.` : ''} Click below to verify and broadcast this transfer.`,
        actionPayload: {
          type: 'interactive_send',
          title: `📤 Send ${newAmount} ${tokenSymbol} to ${shortRecipient}`,
          data: { recipient, amount: newAmount, tokenSymbol, memo, estimatedFeeUsdc: feeEstimate },
        },
      }
    }
  }

  const isPortfolioQuery = p.includes('portföy') || p.includes('portfolio') || p.includes('strateji') || p.includes('tavsiye') ||
    p.includes('ne yapmalı') || p.includes('durumum') || p.includes('bakiye') || p.includes('varlıklarım') ||
    p.includes('analiz et') || p.includes('analyze') || p.includes('yield strategy') || p.includes('optimal')
  if (isPortfolioQuery && portfolio) {
    const liquid = portfolio.liquidUsdc || 0
    const vault = portfolio.vaultStakedUsdc || 0
    const gateway = portfolio.gatewayTotalUsdc || 0
    const total = portfolio.totalNetWorthUsd || (liquid + vault + gateway)
    const yearly = portfolio.estimatedYearlyYieldUsdc || (vault * 0.0842)
    const recDeposit = portfolio.recommendedVaultDeposit || (liquid > 50 ? Math.floor((liquid - 50) * 0.7) : 0)
    const score = portfolio.healthScore || 85
    if (total === 0) {
      return { message: `I have analyzed your connected wallet on Arc Testnet:\n\n📊 <strong>Portfolio Snapshot:</strong>\n• <strong>Total Net Worth:</strong> $0.00 USD\n• <strong>Liquid USDC:</strong> $0.00 USDC (Empty)\n• <strong>Real-Yield Vault:</strong> $0.00 USDC\n\n💡 <strong>Chief Strategist Action Plan:</strong>\nYour wallet is currently uncapitalized. Transfer or bridge USDC to your connected wallet on Arc Testnet to fund your balance and start earning 8.42% APY compound real yield with zero native gas requirements.` }
    }
    if (recDeposit > 0) {
      const projExtraYield = (recDeposit * 0.0842).toFixed(2)
      return { message: `I have analyzed your real-time portfolio & liquidity allocation:\n\n📊 <strong>DeFi Portfolio & Capital Breakdown:</strong>\n• <strong>Total Net Worth:</strong> ${total.toFixed(2)} USD\n• <strong>Liquid (Idle 0% Yield):</strong> ${liquid.toFixed(2)} USDC\n• <strong>Real-Yield Vault (8.42% APY):</strong> ${vault.toFixed(2)} USDC (+${yearly.toFixed(2)}/yr)\n• <strong>Circle Gateway (Cross-Chain):</strong> ${gateway.toFixed(2)} USDC\n• <strong>DeFi Capital Health Score:</strong> ${score}/100\n\n💡 <strong>Chief Strategist Optimization Plan:</strong>\nYou have <strong>${liquid.toFixed(2)} USDC</strong> sitting idle earning 0%.\nI recommend depositing <strong>${recDeposit} USDC</strong> into the Real-Yield Vault to generate an additional <strong>+${projExtraYield} USDC/year</strong> in compound real yield, while keeping ${(liquid - recDeposit).toFixed(2)} USDC liquid for gas and instant swaps.`, actionPayload: { type: 'interactive_deposit', title: `🏦 Deposit ${recDeposit} USDC into YieldVault (8.42% APY)`, data: { amount: recDeposit, apy: '8.42%', estimatedYieldUsdcYearly: Number(projExtraYield) } } }
    }
    return { message: `I have analyzed your real-time portfolio on Arc Testnet:\n\n📊 <strong>DeFi Portfolio & Capital Breakdown:</strong>\n• <strong>Total Net Worth:</strong> ${total.toFixed(2)} USD\n• <strong>Active Real-Yield Vault:</strong> ${vault.toFixed(2)} USDC\n• <strong>Projected Annual Earnings:</strong> +${yearly.toFixed(2)} USDC (8.42% APY)\n• <strong>DeFi Capital Health Score:</strong> 🌟 ${score}/100 (Optimal Capital Efficiency)\n\nYour capital is efficiently deployed in the Real-Yield Vault. You are continuously earning streaming compound yield on Arc Testnet with zero token inflation.` }
  }

  const swapWords = p.replace(/[^a-z0-9ğüşöçıİ ]/gi, ' ').split(/\s+/)
  const isSwap = swapWords.some((word) => ['swap', 'takas', 'trade', 'convert', 'buy', 'sell', 'al', 'almak', 'dönüştür', 'çevir', 'sat', 'satmak'].includes(word)) || p.includes('satın al')
  if (isSwap) {
    const tokenPattern = COPILOT_TOKEN_PATTERN
    const tokenMentions = p.match(new RegExp(tokenPattern, 'gi')) || []
    const { fromTok, toTok } = extractSwapTokens(prompt)
    if (fromTok === 'WBTC' || toTok === 'WBTC') return unsupportedBtcGuidance()
    if (!amountMatch || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return { message: '<strong>Valid amount required.</strong>\n\nPlease include a positive amount to swap.' }
    const hasSingleTokenDirection = swapWords.some((word) => ['buy', 'sell', 'al', 'almak', 'sat', 'satmak'].includes(word)) || p.includes('satın al')
    if (tokenMentions.length < 2 && !hasSingleTokenDirection) {
      return { message: '<strong>Swap pair required.</strong><br/><br/>Please specify both tokens, for example: "swap 25 USDC to EURC".' }
    }
    if (fromTok === toTok) return { message: '<strong>Choose two different tokens.</strong>' }
    const slippage = extractedPromptSlippage
    return {
      message: `I have prepared your instant swap on Arc Testnet. Confirm below to execute this trade on Arc Testnet.`,
      actionPayload: { type: 'interactive_swap', title: `🔄 Confirm Swap: ${parsedAmount} ${fromTok}`, data: { fromToken: fromTok, toToken: toTok, amount: parsedAmount, slippage } },
    }
  }

  const isDeposit = p.includes('deposit') || p.includes('vault') || p.includes('yatır') || p.includes('stake') || p.includes('havuz') || p.includes('yield') || p.includes('kazanç') || p.includes('faiz')
  if (isDeposit) {
    if (!amountMatch || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return { message: '<strong>Valid amount required.</strong>\\n\\nPlease include a positive USDC amount to deposit.' }
    }
    const yearlyReturn = parsedAmount * 0.0842
    return { message: `I have prepared your yield vault allocation. Click below to verify and lock in your deposit.`, actionPayload: { type: 'interactive_deposit', title: `🏦 Deposit ${parsedAmount} USDC into YieldVault (8.42% APY)`, data: { amount: parsedAmount, apy: '8.42%', estimatedYieldUsdcYearly: Number(yearlyReturn.toFixed(2)) } } }
  }

  const isBridge = p.includes('bridge') || p.includes('gateway') || p.includes('köprü') || p.includes('aktar') ||
    (amountMatch !== null && (p.includes('sepolia') || p.includes('base') || p.includes('arbitrum') || p.includes('solana'))) ||
    ((p.includes('from') || p.includes('dan') || p.includes('den') || p.includes('tan') || p.includes('ten')) && (p.includes('to') || p.includes('ye') || p.includes('ya') || p.includes('e') || p.includes('a')))
  if (isBridge) {
    if (!amountMatch || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return { message: '<strong>Valid amount required.</strong>\\n\\nPlease include a positive USDC amount to bridge.' }
    }
    let sourceChain = 'Arc Testnet'
    let destChain = 'Ethereum Sepolia'
    const fromToMatch = p.match(/from\s+([a-zA-Z0-9_\s]+?)\s+to\s+([a-zA-Z0-9_\s]+)/i)
    const toFromMatch = !fromToMatch ? p.match(/to\s+([a-zA-Z0-9_\s]+?)\s+from\s+([a-zA-Z0-9_\s]+)/i) : null
    const trFromToMatch = !fromToMatch && !toFromMatch ? p.match(/([a-zA-Z0-9_]+)(?:'den|'dan|'ten|'tan|den|dan|ten|tan)\s+([a-zA-Z0-9_]+)(?:'e|'a|'ye|'ya|e|a|ye|ya)/i) : null
    const trToFromMatch = !fromToMatch && !toFromMatch && !trFromToMatch ? p.match(/([a-zA-Z0-9_]+)(?:'e|'a|'ye|'ya|e|a|ye|ya)\s+([a-zA-Z0-9_]+)(?:'den|'dan|'ten|'tan|den|dan|ten|tan)/i) : null
    const arrowMatch = !fromToMatch && !toFromMatch && !trFromToMatch && !trToFromMatch ? p.match(/([a-zA-Z0-9_]+)\s*(?:->|➔|=>)\s*([a-zA-Z0-9_]+)/i) : null
    const xToYMatch = !fromToMatch && !toFromMatch && !trFromToMatch && !trToFromMatch && !arrowMatch ? p.match(/(?:^|\s)(?!usdc|eurc|eth|weth|btc|wbtc)([a-zA-Z0-9_]+)\s+to\s+([a-zA-Z0-9_]+)/i) : null
    if (fromToMatch) { sourceChain = resolveChainName(fromToMatch[1]); destChain = resolveChainName(fromToMatch[2]) }
    else if (toFromMatch) { destChain = resolveChainName(toFromMatch[1]); sourceChain = resolveChainName(toFromMatch[2]) }
    else if (trFromToMatch) { sourceChain = resolveChainName(trFromToMatch[1]); destChain = resolveChainName(trFromToMatch[2]) }
    else if (trToFromMatch) { destChain = resolveChainName(trToFromMatch[1]); sourceChain = resolveChainName(trToFromMatch[2]) }
    else if (arrowMatch) { sourceChain = resolveChainName(arrowMatch[1]); destChain = resolveChainName(arrowMatch[2]) }
    else if (xToYMatch) { sourceChain = resolveChainName(xToYMatch[1]); destChain = resolveChainName(xToYMatch[2]) }
    else {
      const otherChain = p.includes('sepolia') || p.includes('ethereum') || p.includes('eth') ? 'Ethereum Sepolia' : p.includes('base') ? 'Base Sepolia' : p.includes('arbitrum') || p.includes('arb') ? 'Arbitrum Sepolia' : p.includes('solana') || p.includes('sol') ? 'Solana Devnet' : 'Ethereum Sepolia'
      if (p.includes('to arc') || p.includes('into arc') || p.includes("arc'a") || p.includes('arc ye')) { sourceChain = otherChain; destChain = 'Arc Testnet' }
      else if (p.includes('from arc') || p.includes('arc dan') || p.includes('arc tan') || p.includes('arc den')) { sourceChain = 'Arc Testnet'; destChain = otherChain }
      else if (p.includes('to ')) { sourceChain = 'Arc Testnet'; destChain = otherChain }
      else if (p.includes('from ')) { sourceChain = otherChain; destChain = 'Arc Testnet' }
    }
    if (sourceChain === destChain) { if (sourceChain === 'Arc Testnet') destChain = 'Ethereum Sepolia'; else destChain = 'Arc Testnet' }
    return { message: `I have prepared your Circle Gateway omnichain transfer. Click below to open Gateway transfer and confirm.`, actionPayload: { type: 'interactive_bridge', title: `🌉 Bridge ${parsedAmount} USDC (${sourceChain} ➔ ${destChain})`, data: { fromChain: sourceChain, toChain: destChain, amount: parsedAmount } } }
  }


  const isSend = p.includes('send') || p.includes('gönder') || p.includes('yolla') || p.includes('transfer') || p.includes('pay') || p.includes('öde') || /0x[a-fA-F0-9]{40}/i.test(prompt)
  if (isSend) {
    const recipient = prompt.match(/0x[a-fA-F0-9]{40}/i)?.[0] || ''
    let tokenSymbol = 'USDC'
    if (mentionsCirBtc(p)) tokenSymbol = 'cirBTC'
    else if (p.includes('eurc')) tokenSymbol = 'EURC'
    else if (p.includes('weth') || p.includes('eth')) tokenSymbol = 'WETH'
    else if (p.includes('wbtc') || p.includes('btc')) return unsupportedBtcGuidance()
    const memo = prompt.match(/(?:memo|not|açıklama|reference)\s*[:=]?\s*["']?([^"',\n]+)["']?/i)?.[1]?.trim()
    if (amountMatch === null) return { message: `<strong>Amount required.</strong>\n\nPlease include how much ${tokenSymbol} to send — e.g. "send 10 ${tokenSymbol} to 0x...".` }
    const amountCheck = validateSendAmount(parsedAmount, tokenSymbol)
    if (!amountCheck.ok) return { message: `<strong>Invalid amount.</strong>\n\n${amountCheck.error}` }
    if (!isValidEvmAddress(recipient)) return { message: `<strong>Recipient required.</strong>\n\nPlease provide a valid Arc (EVM) wallet address (0x...) to send ${tokenSymbol}.` }
    if (isZeroAddress(recipient)) return { message: `<strong>Invalid recipient.</strong>\n\nThat is the zero address (0x000…000); sending there would permanently burn the funds.` }
    if (walletAddress && recipient.toLowerCase() === walletAddress.toLowerCase()) return { message: `<strong>Invalid recipient.</strong>\n\nThat is your own wallet address — the transfer would be a no-op.` }
    const amount = amountCheck.normalized!
    const available = availableTokenBalance(portfolio, tokenSymbol)
    if (available !== null && amount > available) return { message: `<strong>Insufficient balance.</strong>\n\nYou have ${available} ${tokenSymbol} available on Arc Testnet, but this transfer is ${amount} ${tokenSymbol}.` }
    const shortRecipient = `${recipient.slice(0, 6)}...${recipient.slice(-4)}`
    const hasMemo = Boolean(memo && memo.trim().length > 0)
    const feeEstimate = transferFeeFor(tokenSymbol, liveMaxFeePerGas, hasMemo)
    return {
      message: `I have prepared your transfer on Arc Testnet.${available !== null ? ` Available balance: ${available} ${tokenSymbol}.` : ''}${memo ? ` Memo: ${memo}.` : ''} Click below to review and send.`,
      actionPayload: {
        type: 'interactive_send',
        title: `📤 Send ${amount} ${tokenSymbol} to ${shortRecipient}`,
        data: { recipient, amount, tokenSymbol, memo, estimatedFeeUsdc: feeEstimate },
      },
    }
  }
  return { message: `I have analyzed your request: "${prompt}"\n\n<strong>Arcis Autonomous Intelligence:</strong>\nYou can issue direct commands like:\n• <strong>Swap:</strong> "Swap 250 USDC to WETH"\n• <strong>Yield:</strong> "Deposit 1,000 USDC into yield vault"\n• <strong>Bridge:</strong> "Bridge 500 USDC from Base"\n• <strong>Arbitrage:</strong> "Scan live Arc DEX pools for highest arbitrage"\n\nHow would you like to proceed?` }
}
