// src/services/llmService.ts
// Intelligent LLM Intent Engine & Tool Calling for Arcis AI Copilot
// Supports OpenAI GPT-4o-mini with seamless, zero-latency Local NLP Fallback

import type { CopilotActionPayload, CopilotMessage } from '../types/marketplace'
import { arcTestnet } from '../config/arcChain'
import { SPEED_TIERS } from '../config/feeTiers'
import {
  getLiveTokenPrices,
  calculateTokenConversion,
  type TokenPriceMap,
} from './tokenPriceService'
import {
  getLivePortfolioSnapshot,
  formatPortfolioForPrompt,
  type PortfolioSnapshot,
} from './portfolioContextService'

export interface LLMResult {
  message: string
  actionPayload?: CopilotActionPayload
  source: 'gpt-4o-mini' | 'local-nlp'
  executionTimeMs: number
}

export const DEFAULT_COPILOT_SLIPPAGE = 0.1 // 0.1% default slippage tolerance on Arc Testnet

/**
 * Dynamically extracts optional custom slippage tolerance from user prompt
 * (e.g. "0.5% slippage", "kayma %0.5", "slippage: 1%", "slip 0.2")
 */
export function extractSlippageFromPrompt(
  prompt: string,
  fallbackSlippage: number = DEFAULT_COPILOT_SLIPPAGE
): number {
  if (!prompt) return fallbackSlippage

  // Match patterns like "slippage 0.5%", "kayma %0.5", "0.5% slippage", "slip: 0.2"
  const match =
    prompt.match(/(?:slippage|kayma|tolerance|tolerans|slip)\s*(?:of|is|:|=|%)?\s*(\d+(?:\.\d+)?)\s*%?/i) ||
    prompt.match(/(\d+(?:\.\d+)?)\s*%\s*(?:slippage|kayma|tolerans)/i)

  if (match && match[1]) {
    const val = parseFloat(match[1])
    if (!isNaN(val) && val > 0 && val <= 50) {
      return Number(val.toFixed(2))
    }
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

/**
 * Extracts and maps input (fromToken) and target (toToken) from complex Turkish and English sentences.
 * e.g. "100 USDC verip ETH al", "50 USDC ile WETH al", "Elimdeki 200 EURC'yi USDC yap", "USDC'den WBTC'ye çevir"
 */
export function extractSwapTokens(prompt: string): { fromTok: string; toTok: string } {
  const p = (prompt || '').toLowerCase()

  const normTok = (tok: string): string => {
    const t = (tok || '').toLowerCase().trim()
    if (t === 'eth' || t === 'weth' || t === 'ethereum') return 'WETH'
    if (t === 'btc' || t === 'wbtc' || t === 'bitcoin' || t === 'cirbtc' || t === 'tcirbtc') return 'WBTC'
    if (t === 'eur' || t === 'eurc' || t === 'euro') return 'EURC'
    if (t === 'afusdc' || t === 'af-usdc' || t === 'vault') return 'af-USDC'
    if (t === 'usd' || t === 'usdc' || t === 'dolar') return 'USDC'
    return 'USDC'
  }

  const tokRegex = '(?:usdc|eurc|weth|eth|wbtc|btc|af-usdc|afusdc|dolar|euro|ethereum|bitcoin)'

  // 1. "from X to Y" (English)
  const fromToMatch = p.match(new RegExp(`from\\s+(${tokRegex})\\s+to\\s+(${tokRegex})`, 'i'))
  if (fromToMatch) {
    return { fromTok: normTok(fromToMatch[1]), toTok: normTok(fromToMatch[2]) }
  }

  // 2. "X -> Y" or "X ➔ Y" or "X => Y"
  const arrowMatch = p.match(new RegExp(`(${tokRegex})\\s*(?:->|➔|=>)\\s*(${tokRegex})`, 'i'))
  if (arrowMatch) {
    return { fromTok: normTok(arrowMatch[1]), toTok: normTok(arrowMatch[2]) }
  }

  // 3. "X to Y" (e.g. "usdc to weth", "eurc to usdc")
  const toMatch = p.match(new RegExp(`(${tokRegex})\\s+to\\s+(${tokRegex})`, 'i'))
  if (toMatch) {
    return { fromTok: normTok(toMatch[1]), toTok: normTok(toMatch[2]) }
  }

  // 4. Turkish "X'den Y'ye" / "X dan Y ye" / "X'ten Y'ye"
  const trFromToMatch = p.match(new RegExp(`(${tokRegex})(?:'den|'dan|'ten|'tan|den|dan|ten|tan)\\s+(${tokRegex})(?:'e|'a|'ye|'ya|e|a|ye|ya)`, 'i'))
  if (trFromToMatch) {
    return { fromTok: normTok(trFromToMatch[1]), toTok: normTok(trFromToMatch[2]) }
  }

  // 5. Turkish "X verip Y al" / "X ile Y al" / "X karşılığı Y al/çevir"
  const trVeripAlMatch = p.match(new RegExp(`(${tokRegex})\\s*(?:verip|ile|karşılığı|karsiligi)\\s*(${tokRegex})\\s*(?:al|almak|çevir|cevir|takas)`, 'i'))
  if (trVeripAlMatch) {
    return { fromTok: normTok(trVeripAlMatch[1]), toTok: normTok(trVeripAlMatch[2]) }
  }

  // 6. Turkish "X'i Y'ye çevir" / "X'i Y yap"
  const trCevirMatch = p.match(new RegExp(`(${tokRegex})(?:'i|'yi|'ı|'yı|i|yi|ı|yı)\\s+(${tokRegex})(?:'e|'a|'ye|'ya|e|a|ye|ya|\\s+yap|\\s+çevir|\\s+cevir)`, 'i'))
  if (trCevirMatch) {
    return { fromTok: normTok(trCevirMatch[1]), toTok: normTok(trCevirMatch[2]) }
  }

  // 7. Single token buy intent: "ETH al", "Buy WETH", "WETH almak istiyorum"
  const buyMatch = p.match(new RegExp(`(?:buy|al|almak|satın al)\\s+(${tokRegex})|(${tokRegex})\\s+(?:al|almak|satın al)`, 'i'))
  if (buyMatch) {
    const target = normTok(buyMatch[1] || buyMatch[2])
    if (target !== 'USDC') {
      return { fromTok: 'USDC', toTok: target }
    }
  }

  // 8. Single token sell intent: "ETH sat", "Sell WETH", "EURC satmak istiyorum"
  const sellMatch = p.match(new RegExp(`(?:sell|sat|satmak)\\s+(${tokRegex})|(${tokRegex})\\s+(?:sat|satmak)`, 'i'))
  if (sellMatch) {
    const source = normTok(sellMatch[1] || sellMatch[2])
    if (source !== 'USDC') {
      return { fromTok: source, toTok: 'USDC' }
    }
  }

  // Heuristic token checks
  if (p.includes('weth') || p.includes('eth')) {
    if (p.includes('eth to usdc') || p.includes('eth den usdc') || p.includes('eth sat')) {
      return { fromTok: 'WETH', toTok: 'USDC' }
    }
    return { fromTok: 'USDC', toTok: 'WETH' }
  }
  if (p.includes('wbtc') || p.includes('btc')) {
    if (p.includes('btc to usdc') || p.includes('btc den usdc') || p.includes('btc sat')) {
      return { fromTok: 'WBTC', toTok: 'USDC' }
    }
    return { fromTok: 'USDC', toTok: 'WBTC' }
  }
  if (p.includes('af-usdc') || p.includes('afusdc')) {
    if (p.includes('af-usdc to usdc') || p.includes('af-usdc sat')) {
      return { fromTok: 'af-USDC', toTok: 'USDC' }
    }
    return { fromTok: 'USDC', toTok: 'af-USDC' }
  }
  if (p.includes('eurc') || p.includes('euro')) {
    if (p.includes('eurc to usdc') || p.includes('eurc den usdc') || p.includes('eurc sat')) {
      return { fromTok: 'EURC', toTok: 'USDC' }
    }
    return { fromTok: 'USDC', toTok: 'EURC' }
  }

  return { fromTok: 'USDC', toTok: 'EURC' }
}

export function getOpenAIApiKey(): string {
  const localKey = localStorage.getItem('arcis_openai_api_key') || localStorage.getItem('arcflow_openai_api_key')
  return localKey ? localKey.trim() : ''
}

export function setOpenAIApiKey(key: string): void {
  if (!key.trim()) {
    localStorage.removeItem('arcis_openai_api_key')
    localStorage.removeItem('arcflow_openai_api_key')
  } else {
    localStorage.setItem('arcis_openai_api_key', key.trim())
  }
}

/**
 * Main query processor: Tries secure backend /api/copilot endpoint; otherwise uses resilient Local NLP engine.
 * Incorporates dynamic real-time token pricing, live portfolio snapshot, and multi-turn chat history.
 */
export async function queryArcisLLM(
  userPrompt: string,
  walletAddress?: string,
  chatHistory?: CopilotMessage[],
  portfolioSnapshot?: PortfolioSnapshot
): Promise<LLMResult> {
  const customApiKey = getOpenAIApiKey()
  const startTime = Date.now()

  // Fetch live token prices & portfolio snapshot concurrently (<1ms if cached)
  const [livePrices, portfolio] = await Promise.all([
    getLiveTokenPrices(),
    portfolioSnapshot ? Promise.resolve(portfolioSnapshot) : getLivePortfolioSnapshot(walletAddress),
  ])

  // 1. Try secure backend proxy /api/copilot endpoint (never exposes server API key to client)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (customApiKey) {
      headers['Authorization'] = `Bearer ${customApiKey}`
    }

    const res = await fetch('/api/copilot', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userPrompt,
        walletAddress,
        livePrices,
        chatHistory,
        portfolio,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      if (data.success && data.message) {
        return {
          message: data.message,
          actionPayload: data.actionPayload,
          source: (data.source || 'gpt-4o-mini') as any,
          executionTimeMs: Date.now() - startTime,
        }
      }
    } else {
      const data = await res.json().catch(() => ({}))
      if (customApiKey && !data.fallbackToLocal) {
        // Try direct call if user explicitly provided a BYOK key in browser
        try {
          const gptResult = await callGPT4oMini(userPrompt, customApiKey, walletAddress, livePrices, chatHistory, portfolio)
          return {
            ...gptResult,
            source: 'gpt-4o-mini',
            executionTimeMs: Date.now() - startTime,
          }
        } catch (directErr) {
          console.warn('Direct BYOK GPT-4o-mini call failed:', directErr)
        }
      }
    }
  } catch (err) {
    console.warn('Backend /api/copilot call failed, falling back to local NLP engine:', err)
  }

  // 2. Local Semantic NLP Fallback Engine with Live Pricing, Multi-Turn History & Live Portfolio
  const localResult = parseLocalIntentFallback(userPrompt, walletAddress, livePrices, chatHistory, portfolio)
  return {
    ...localResult,
    source: 'local-nlp',
    executionTimeMs: Date.now() - startTime,
  }
}

export const queryArcoLLM = queryArcisLLM

/**
 * Calls OpenAI GPT-4o-mini API with Chief DeFi Strategist system prompt, structured function calling tools, live pricing, and portfolio awareness.
 */
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

  const systemPrompt = `You are Arcis, the ultra-smart autonomous AI Copilot & Chief DeFi Strategist of Arcis Protocol on Arc Testnet blockchain (Chain ID: ${arcTestnet.id}).
Arcis features:
- Native Gas Currency: ${arcTestnet.nativeCurrency.symbol} (no ETH needed for gas; gas is ~$${SPEED_TIERS.fast.arcGas.estimatedCostUsdc} USDC per tx)
- Speed: <500ms deterministic sub-second finality
- Supported Tokens: USDC, EURC, WETH, WBTC, af-USDC
- Real-Yield Vault (af-USDC): 8.42% APY compound real yield
- Circle Gateway: Instant cross-chain unified balance across Ethereum, Base, Arbitrum, Solana, Polygon
- Enterprise Send: Multicall3From batch payments with preserved msg.sender identity
- Live Real-Time Market Prices: 1 EURC ≈ $${prices.EURC || 1.08} USDC, 1 WETH ≈ $${prices.WETH || 2650} USDC, 1 WBTC ≈ $${prices.WBTC || 63000} USDC

${portfolioText}

CHIEF DEFI STRATEGIST & PORTFOLIO RULES:
- You act as the user's personal proactive DeFi Strategist.
- ALWAYS execute explicit user transactional commands (e.g. "send 1 usdc to 0x...", "swap 10 usdc to eurc", "deposit 50 usdc", "bridge 25 usdc") by calling their corresponding tool (execute_send, execute_swap, execute_deposit_yield, execute_bridge). NEVER refuse or block an explicit transactional command with a faucet message; the on-chain execution engine and session key limits will validate the real-time balance.
- When the user asks exploratory questions about their portfolio, balance, what to do with funds, advice, or strategy ("portföyümü analiz et", "ne yapmalıyım", "strateji öner", "portfolio status", "where to get yield"), analyze their exact real-time liquid vs staked vs cross-chain balances from the snapshot above:
  - If the user has idle USDC on Arc Testnet (> $50), recommend depositing the recommended amount ($${port.recommendedVaultDeposit.toFixed(2)} USDC) into the Real-Yield Vault (8.42% APY) while keeping sufficient liquidity for gas/swaps, and call execute_deposit_yield.
  - If the user has cross-chain USDC on Circle Gateway, recommend bridging to Arc Testnet for instant sub-second finality, and call execute_bridge.
  - If the user has $0 balance and specifically asks how to get started or requests free testnet funds, recommend opening the faucet to claim 1,000 free testnet USDC, and call execute_faucet.
- CONTEXT & MULTI-TURN DIALOGUE:
  - You have full awareness of the recent conversation history.
  - If the user corrects or updates a previous action (e.g. "actually make it 250", "swap to WETH instead"), seamlessly resolve parameters and trigger the updated tool call.
- FORMATTING RULES:
  - Never use markdown bold asterisks (do not use **).
  - Use <strong> tags for bold headings and key bullet points.
  - Leave generous blank lines between paragraphs.
  - Keep tone professional, welcoming, and high-tech.`

  const ARC_COPILOT_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'execute_swap',
        description: 'Execute instant on-chain token swap on Arc Testnet DEX with USDC native gas',
        parameters: {
          type: 'object',
          properties: {
            fromToken: { type: 'string', description: 'Token symbol to swap from (e.g. USDC, EURC)' },
            toToken: { type: 'string', description: 'Token symbol to swap to (e.g. USDC, EURC)' },
            amount: { type: 'number', description: 'Amount of tokens to swap' },
            slippage: { type: 'number', description: 'Slippage percentage e.g. 0.1' },
          },
          required: ['fromToken', 'toToken', 'amount'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'execute_deposit_yield',
        description: 'Deposit USDC into Arcis Real-Yield vault earning 8.42% APY',
        parameters: {
          type: 'object',
          properties: {
            amount: { type: 'number', description: 'Amount of USDC to deposit' },
          },
          required: ['amount'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'execute_bridge',
        description: 'Bridge USDC via Circle Gateway between Arc Testnet and other chains (e.g. Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, Solana Devnet)',
        parameters: {
          type: 'object',
          properties: {
            fromChain: { type: 'string', description: 'Source chain name e.g. Arc Testnet, Ethereum Sepolia, Base Sepolia, Arbitrum Sepolia, Solana Devnet' },
            toChain: { type: 'string', description: 'Destination chain name e.g. Ethereum Sepolia, Arc Testnet, Base Sepolia, Arbitrum Sepolia, Solana Devnet' },
            amount: { type: 'number', description: 'Amount of USDC to transfer' },
          },
          required: ['amount'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'execute_faucet',
        description: 'Open Faucet to claim 1,000 testnet USDC',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'execute_send',
        description: 'Send or transfer USDC/EURC/WETH/WBTC to a recipient address on Arc Testnet with optional memo',
        parameters: {
          type: 'object',
          properties: {
            recipient: { type: 'string', description: 'Recipient EVM address (0x...) or domain' },
            amount: { type: 'number', description: 'Amount of tokens to transfer' },
            token: { type: 'string', description: 'Token symbol e.g. USDC, EURC, WETH, WBTC (default: USDC)' },
            memo: { type: 'string', description: 'Optional transaction memo, category, or note' },
          },
          required: ['recipient', 'amount'],
        },
      },
    },
  ]

  // Auto-detect OpenRouter vs direct OpenAI
  const isOpenRouter = apiKey.startsWith('sk-or-')
  const endpoint = isOpenRouter
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions'
  const modelName = isOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4o-mini'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }

  if (isOpenRouter) {
    headers['HTTP-Referer'] = 'https://arcis.finance'
    headers['X-Title'] = 'Arcis Protocol'
  }

  // Build multi-turn chat history messages sequence
  const cleanHistory = (chatHistory || [])
    .slice(-6)
    .filter((m) => m.content && m.content.trim() !== '')
    .map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content.replace(/<[^>]*>?/gm, '').trim(),
    }))

  const messagesPayload: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...cleanHistory,
  ]

  const lastItem = cleanHistory[cleanHistory.length - 1]
  if (!lastItem || lastItem.role !== 'user' || lastItem.content !== userPrompt.trim()) {
    messagesPayload.push({ role: 'user', content: userPrompt })
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: modelName,
      messages: messagesPayload,
      tools: ARC_COPILOT_TOOLS,
      tool_choice: 'auto',
      temperature: 0.2,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`OpenAI API error (${response.status}): ${errText}`)
  }

  const data = await response.json()
  const choice = data.choices?.[0]
  if (!choice) throw new Error('No choice returned from OpenAI')

  const toolCalls = choice.message?.tool_calls
  if (toolCalls && toolCalls.length > 0) {
    const call = toolCalls[0]
    const fnName = call.function.name
    const args = JSON.parse(call.function.arguments || '{}')

    if (fnName === 'execute_swap') {
      const fromTok = args.fromToken?.toUpperCase() || 'USDC'
      const toTok = args.toToken?.toUpperCase() || 'WETH'
      const amount = Number(args.amount) || 100
      const extractedSlippage = extractSlippageFromPrompt(userPrompt, DEFAULT_COPILOT_SLIPPAGE)
      const slippage = Number(args.slippage) || extractedSlippage
      const conversion = calculateTokenConversion(fromTok, toTok, amount, prices)
      const estOut = conversion.estimatedOut * (1 - slippage / 100)

      return {
        message: `I have prepared your instant token swap on Arc Testnet:

⚡ <strong>DEX Swap Overview:</strong>
• <strong>Network:</strong> Arc Testnet
• <strong>Pay Amount:</strong> ${amount} ${fromTok}
• <strong>Est. Receive:</strong> ~${estOut.toFixed(4)} ${toTok}
• <strong>Slippage:</strong> ${slippage}%

Review and confirm the trade below to execute on-chain.`,
        actionPayload: {
          type: 'interactive_swap',
          title: `🔄 Confirm Swap: ${amount} ${fromTok} ➔ ${estOut.toFixed(4)} ${toTok}`,
          data: {
            fromToken: fromTok,
            toToken: toTok,
            amount,
            slippage,
            estimatedOut: Number(estOut.toFixed(4)),
            rate: conversion.rate,
          },
        },
      }
    } else if (fnName === 'execute_deposit_yield') {
      const amount = Number(args.amount) || 500
      const yearlyYield = amount * 0.0842
      return {
        message: `I have calculated your compound yield allocation:

🏦 <strong>Vault Deposit Overview:</strong>
• <strong>Network:</strong> Arc Testnet
• <strong>APY:</strong> 8.42%
• <strong>Est. 1-Year Gain:</strong> +$${yearlyYield.toFixed(2)} USDC
• <strong>Amount:</strong> ${amount} USDC

Click below to allocate your USDC into the YieldVault.`,
        actionPayload: {
          type: 'interactive_deposit',
          title: `🏦 Deposit ${amount} USDC into YieldVault`,
          data: {
            amount,
            apy: '8.42%',
            estimatedYieldUsdcYearly: Number(yearlyYield.toFixed(2)),
          },
        },
      }
    } else if (fnName === 'execute_bridge') {
      const fromChain = args.fromChain ? resolveChainName(args.fromChain) : 'Arc Testnet'
      const toChain = args.toChain ? resolveChainName(args.toChain) : (fromChain === 'Arc Testnet' ? 'Ethereum Sepolia' : 'Arc Testnet')
      const amount = Number(args.amount) || 250
      return {
        message: `I have initialized your Circle Gateway transfer:

🌉 <strong>Gateway Bridge Overview:</strong>
• <strong>Source Network:</strong> ${fromChain}
• <strong>Destination Network:</strong> ${toChain}
• <strong>Transfer Amount:</strong> ${amount} USDC

Click below to verify and deposit into Circle Gateway.`,
        actionPayload: {
          type: 'interactive_bridge',
          title: `🌉 Bridge ${amount} USDC (${fromChain} ➔ ${toChain})`,
          data: {
            fromChain,
            toChain,
            amount,
          },
        },
      }
    } else if (fnName === 'execute_faucet') {
      return {
        message: `Claim 1,000 testnet USDC on Arc Testnet with zero gas fees.`,
        actionPayload: {
          type: 'faucet',
          title: '💧 Open Faucet Page',
          data: {},
        },
      }
    } else if (fnName === 'execute_send') {
      const recipient = args.recipient || ''
      const amount = Number(args.amount) || 10
      const token = (args.token || 'USDC').toUpperCase()
      const memo = args.memo || ''
      const shortRecipient = recipient.length >= 10 ? `${recipient.slice(0, 6)}...${recipient.slice(-4)}` : recipient

      return {
        message: `I have prepared your transfer on Arc Testnet:

⚡ <strong>Send Payment Overview:</strong>
• <strong>Network:</strong> Arc Testnet
• <strong>Recipient:</strong> <code>${recipient}</code>
• <strong>Amount:</strong> ${amount} ${token}
${memo ? `• <strong>Memo:</strong> ${memo}\n` : ''}• <strong>Gas Fee:</strong> ~$0.00042 USDC (Native Gas)

Click below to confirm and broadcast this transaction on-chain.`,
        actionPayload: {
          type: 'interactive_send',
          title: `📤 Send ${amount} ${token} to ${shortRecipient}`,
          data: {
            recipient,
            amount,
            tokenSymbol: token,
            memo,
          },
        },
      }
    }
  }

  // Plain conversational response
  let rawContent = choice.message?.content || 'I have analyzed your request.'
  // Clean markdown asterisks if any slipped through
  rawContent = rawContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')

  return {
    message: rawContent,
  }
}

/**
 * High-performance semantic fallback NLP parser when OpenAI API key is unavailable or fails.
 * Utilizes dynamic live price oracle cache for precision quotes.
 */
export function parseLocalIntentFallback(
  prompt: string,
  _walletAddress?: string,
  livePrices?: TokenPriceMap,
  chatHistory?: CopilotMessage[],
  portfolio?: PortfolioSnapshot
): { message: string; actionPayload?: CopilotActionPayload } {
  const p = prompt.toLowerCase().trim()

  // Extract custom slippage if present in user prompt (e.g. "0.5% slippage", "kayma %0.5")
  const extractedPromptSlippage = extractSlippageFromPrompt(prompt, DEFAULT_COPILOT_SLIPPAGE)

  // Strip EVM hex addresses and slippage phrases before extracting amount to avoid misidentifying addresses/percentages as amounts
  const cleanedPromptForAmount = prompt
    .replace(/0x[a-fA-F0-9]{40}/gi, '')
    .replace(/(?:slippage|kayma|tolerance|tolerans|slip)\s*(?:of|is|:|=|%)?\s*(\d+(?:\.\d+)?)\s*%?/gi, '')
    .replace(/(\d+(?:\.\d+)?)\s*%\s*(?:slippage|kayma|tolerans)/gi, '')

  // Match numerical amounts (e.g., "100", "0.5", "1,000", "$50")
  const amountMatch = cleanedPromptForAmount.match(/(?:^|\s|\$)([\d,]+(?:\.\d+)?)(?:\s|$|\$|[a-zA-Z])/i)
  const parsedAmount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 100

  // 0. MULTI-TURN CONTEXT & PARAMETER CORRECTION HANDLER
  const lastActionMsg = [...(chatHistory || [])]
    .reverse()
    .find((m) => m.actionPayload && m.actionPayload.data)
  const prevAction = lastActionMsg?.actionPayload

  const isCorrection =
    p.includes('pardon') ||
    p.includes('yerine') ||
    p.includes('aslında') ||
    p.includes('bunu') ||
    p.includes('yap') ||
    p.includes('değiştir') ||
    p.includes('instead') ||
    p.includes('actually') ||
    p.includes('make it') ||
    p.includes('change') ||
    p.includes('slippage') ||
    p.includes('kayma') ||
    (amountMatch !== null && p.split(' ').length <= 4 && !p.includes('swap') && !p.includes('deposit') && !p.includes('bridge') && !p.includes('takas'))

  if (isCorrection && prevAction) {
    const prevData = prevAction.data || {}

    // A.1 CORRECTION FOR PREVIOUS SWAP
    if (prevAction.type === 'interactive_swap' || prevAction.type === 'trade') {
      const newAmount = amountMatch ? parsedAmount : (prevData.amount || 100)
      let fromTok = prevData.fromToken || 'USDC'
      let toTok = prevData.toToken || 'EURC'

      if (p.includes('weth') || p.includes('eth')) toTok = 'WETH'
      else if (p.includes('wbtc') || p.includes('btc')) toTok = 'WBTC'
      else if (p.includes('eurc')) toTok = 'EURC'
      else if (p.includes('usdc')) fromTok = 'USDC'

      const defaultSlip = prevData.slippage !== undefined ? Number(prevData.slippage) : DEFAULT_COPILOT_SLIPPAGE
      const slippage = extractSlippageFromPrompt(prompt, defaultSlip)
      const conversion = calculateTokenConversion(fromTok, toTok, newAmount, livePrices)
      const estOut = conversion.estimatedOut * (1 - slippage / 100)

      return {
        message: `I have updated your instant swap on Arc Testnet based on our conversation:

⚡ <strong>Updated DEX Swap Overview:</strong>
• <strong>Network:</strong> Arc Testnet
• <strong>Pay Amount:</strong> ${newAmount} ${fromTok}
• <strong>Est. Receive:</strong> ~${estOut.toFixed(4)} ${toTok}
• <strong>Slippage:</strong> ${slippage}%

Confirm below to execute this updated trade on Arc Testnet.`,
        actionPayload: {
          type: 'interactive_swap',
          title: `🔄 Confirm Swap: ${newAmount} ${fromTok} ➔ ${estOut.toFixed(4)} ${toTok}`,
          data: {
            fromToken: fromTok,
            toToken: toTok,
            amount: newAmount,
            estimatedOut: Number(estOut.toFixed(4)),
            slippage,
            rate: conversion.rate,
          },
        },
      }
    }

    // A.2 CORRECTION FOR PREVIOUS DEPOSIT
    if (prevAction.type === 'interactive_deposit') {
      const newAmount = amountMatch ? parsedAmount : (prevData.amount || 500)
      const yearlyReturn = newAmount * 0.0842

      return {
        message: `I have updated your YieldVault deposit allocation:

🏦 <strong>Updated Vault Deposit Overview:</strong>
• <strong>Network:</strong> Arc Testnet
• <strong>APY:</strong> 8.42%
• <strong>Est. 1-Year Gain:</strong> +$${yearlyReturn.toFixed(2)} USDC
• <strong>Deposit Amount:</strong> ${newAmount} USDC

Click below to verify and lock in your updated deposit.`,
        actionPayload: {
          type: 'interactive_deposit',
          title: `🏦 Deposit ${newAmount} USDC into YieldVault (8.42% APY)`,
          data: {
            amount: newAmount,
            apy: '8.42%',
            estimatedYieldUsdcYearly: Number(yearlyReturn.toFixed(2)),
          },
        },
      }
    }

    // A.3 CORRECTION FOR PREVIOUS BRIDGE
    if (prevAction.type === 'interactive_bridge') {
      const newAmount = amountMatch ? parsedAmount : (prevData.amount || 250)
      let fromChain = prevData.fromChain || 'Arc Testnet'
      let toChain = prevData.toChain || 'Ethereum Sepolia'

      if (p.includes('base')) toChain = 'Base Sepolia'
      else if (p.includes('arbitrum') || p.includes('arb')) toChain = 'Arbitrum Sepolia'
      else if (p.includes('solana') || p.includes('sol')) toChain = 'Solana Devnet'
      else if (p.includes('sepolia') || p.includes('eth')) toChain = 'Ethereum Sepolia'

      return {
        message: `I have updated your Circle Gateway transfer:

🌉 <strong>Updated Gateway Bridge Overview:</strong>
• <strong>Source Network:</strong> ${fromChain}
• <strong>Destination Network:</strong> ${toChain}
• <strong>Transfer Amount:</strong> ${newAmount} USDC

Click below to verify and deposit into Circle Gateway.`,
        actionPayload: {
          type: 'interactive_bridge',
          title: `🌉 Bridge ${newAmount} USDC (${fromChain} ➔ ${toChain})`,
          data: {
            fromChain,
            toChain,
            amount: newAmount,
          },
        },
      }
    }

    // A.4 CORRECTION FOR PREVIOUS SEND
    if (prevAction.type === 'interactive_send' || prevAction.type === 'send') {
      const newAmount = amountMatch ? parsedAmount : (prevData.amount || 10)
      const addressMatch = prompt.match(/0x[a-fA-F0-9]{40}/i)
      let recipient = addressMatch ? addressMatch[0] : (prevData.recipient || '')
      let tokenSymbol = prevData.tokenSymbol || 'USDC'

      if (p.includes('eurc')) tokenSymbol = 'EURC'
      else if (p.includes('weth') || p.includes('eth')) tokenSymbol = 'WETH'
      else if (p.includes('wbtc') || p.includes('btc')) tokenSymbol = 'WBTC'
      else if (p.includes('usdc')) tokenSymbol = 'USDC'

      const memoMatch = prompt.match(/(?:memo|not|açıklama|reference)\s*[:=]?\s*["']?([^"',\n]+)["']?/i)
      const memo = memoMatch && memoMatch[1] ? memoMatch[1].trim() : prevData.memo

      const shortRecipient = recipient ? (recipient.length >= 10 ? `${recipient.slice(0, 6)}...${recipient.slice(-4)}` : recipient) : 'Recipient'

      return {
        message: `I have updated your transfer on Arc Testnet:

📤 <strong>Updated Transfer Details:</strong>
• <strong>Recipient:</strong> <code>${recipient || 'Please specify recipient address (0x...)'}</code>
• <strong>Amount:</strong> ${newAmount} ${tokenSymbol}
${memo ? `• <strong>Memo:</strong> ${memo}\n` : ''}• <strong>Gas Fee:</strong> ~$0.00042 USDC (Native Gas)

Click below to verify and broadcast this transfer.`,
        actionPayload: {
          type: 'interactive_send',
          title: `📤 Send ${newAmount} ${tokenSymbol} to ${shortRecipient}`,
          data: {
            recipient,
            amount: newAmount,
            tokenSymbol,
            memo,
          },
        },
      }
    }
  }

  // 0.B CHIEF DEFI STRATEGIST & PORTFOLIO ANALYSIS INTENT
  const isPortfolioQuery =
    p.includes('portföy') ||
    p.includes('portfolio') ||
    p.includes('strateji') ||
    p.includes('tavsiye') ||
    p.includes('ne yapmalı') ||
    p.includes('durumum') ||
    p.includes('bakiye') ||
    p.includes('varlıklarım') ||
    p.includes('analiz et') ||
    p.includes('analyze') ||
    p.includes('yield strategy') ||
    p.includes('optimal')

  if (isPortfolioQuery && portfolio) {
    const liquid = portfolio.liquidUsdc || 0
    const vault = portfolio.vaultStakedUsdc || 0
    const gateway = portfolio.gatewayTotalUsdc || 0
    const total = portfolio.totalNetWorthUsd || (liquid + vault + gateway)
    const yearly = portfolio.estimatedYearlyYieldUsdc || (vault * 0.0842)
    const recDeposit = portfolio.recommendedVaultDeposit || (liquid > 50 ? Math.floor((liquid - 50) * 0.7) : 0)
    const score = portfolio.healthScore || 85

    if (total === 0) {
      return {
        message: `I have analyzed your connected wallet on Arc Testnet:

📊 <strong>Portfolio Snapshot:</strong>
• <strong>Total Net Worth:</strong> $0.00 USD
• <strong>Liquid USDC:</strong> $0.00 USDC (Empty)
• <strong>Real-Yield Vault:</strong> $0.00 USDC

💡 <strong>Chief Strategist Action Plan:</strong>
Your wallet is currently uncapitalized. Claim 1,000 free testnet USDC from the Circle Faucet below to fund your wallet and start earning 8.42% APY compound real yield with zero gas fees.`,
        actionPayload: {
          type: 'faucet',
          title: '💧 Claim 1,000 Testnet USDC on Arc',
          data: {},
        },
      }
    }

    if (recDeposit > 0) {
      const projExtraYield = (recDeposit * 0.0842).toFixed(2)
      return {
        message: `I have analyzed your real-time portfolio & liquidity allocation:

📊 <strong>DeFi Portfolio & Capital Breakdown:</strong>
• <strong>Total Net Worth:</strong> $${total.toFixed(2)} USD
• <strong>Liquid (Idle 0% Yield):</strong> $${liquid.toFixed(2)} USDC
• <strong>Real-Yield Vault (8.42% APY):</strong> $${vault.toFixed(2)} USDC (+$${yearly.toFixed(2)}/yr)
• <strong>Circle Gateway (Cross-Chain):</strong> $${gateway.toFixed(2)} USDC
• <strong>DeFi Capital Health Score:</strong> ${score}/100

💡 <strong>Chief Strategist Optimization Plan:</strong>
You have <strong>$${liquid.toFixed(2)} USDC</strong> sitting idle earning 0%. 
I recommend depositing <strong>$${recDeposit} USDC</strong> into the Real-Yield Vault to generate an additional <strong>+$${projExtraYield} USDC/year</strong> in compound real yield, while keeping $${(liquid - recDeposit).toFixed(2)} USDC liquid for gas and instant swaps.`,
        actionPayload: {
          type: 'interactive_deposit',
          title: `🏦 Deposit ${recDeposit} USDC into YieldVault (8.42% APY)`,
          data: {
            amount: recDeposit,
            apy: '8.42%',
            estimatedYieldUsdcYearly: Number(projExtraYield),
          },
        },
      }
    }

    return {
      message: `I have analyzed your real-time portfolio on Arc Testnet:

📊 <strong>DeFi Portfolio & Capital Breakdown:</strong>
• <strong>Total Net Worth:</strong> $${total.toFixed(2)} USD
• <strong>Active Real-Yield Vault:</strong> $${vault.toFixed(2)} USDC
• <strong>Projected Annual Earnings:</strong> +$${yearly.toFixed(2)} USDC (8.42% APY)
• <strong>DeFi Capital Health Score:</strong> 🌟 ${score}/100 (Optimal Capital Efficiency)

Your capital is efficiently deployed in the Real-Yield Vault. You are continuously earning streaming compound yield on Arc Testnet with zero token inflation.`,
    }
  }

  // A. SWAP INTENT
  const isSwap =
    p.includes('swap') ||
    p.includes('takas') ||
    p.includes('trade') ||
    p.includes('convert') ||
    p.includes('dönüştür') ||
    p.includes('çevir') ||
    p.includes('al') ||
    p.includes('sat')

  if (isSwap) {
    const { fromTok, toTok } = extractSwapTokens(prompt)
    const slippage = extractedPromptSlippage
    const conversion = calculateTokenConversion(fromTok, toTok, parsedAmount, livePrices)
    const estOut = conversion.estimatedOut * (1 - slippage / 100)

    return {
      message: `I have prepared your instant swap on Arc Testnet:

⚡ <strong>DEX Swap Overview:</strong>
• <strong>Network:</strong> Arc Testnet
• <strong>Pay Amount:</strong> ${parsedAmount} ${fromTok}
• <strong>Est. Receive:</strong> ~${estOut.toFixed(4)} ${toTok}
• <strong>Slippage:</strong> ${slippage}%

Confirm below to execute this trade on Arc Testnet.`,
      actionPayload: {
        type: 'interactive_swap',
        title: `🔄 Confirm Swap: ${parsedAmount} ${fromTok} ➔ ${estOut.toFixed(4)} ${toTok}`,
        data: {
          fromToken: fromTok,
          toToken: toTok,
          amount: parsedAmount,
          estimatedOut: Number(estOut.toFixed(4)),
          slippage,
          rate: conversion.rate,
        },
      },
    }
  }

  // B. VAULT YIELD DEPOSIT INTENT
  const isDeposit =
    p.includes('deposit') ||
    p.includes('vault') ||
    p.includes('yatır') ||
    p.includes('stake') ||
    p.includes('havuz') ||
    p.includes('yield') ||
    p.includes('kazanç') ||
    p.includes('faiz')

  if (isDeposit) {
    const yearlyReturn = parsedAmount * 0.0842

    return {
      message: `I have prepared your yield vault allocation:

🏦 <strong>Vault Deposit Overview:</strong>
• <strong>Network:</strong> Arc Testnet
• <strong>APY:</strong> 8.42%
• <strong>Est. 1-Year Gain:</strong> +$${yearlyReturn.toFixed(2)} USDC
• <strong>Deposit Amount:</strong> ${parsedAmount} USDC

Click below to verify and lock in your deposit.`,
      actionPayload: {
        type: 'interactive_deposit',
        title: `🏦 Deposit ${parsedAmount} USDC into YieldVault (8.42% APY)`,
        data: {
          amount: parsedAmount,
          apy: '8.42%',
          estimatedYieldUsdcYearly: Number(yearlyReturn.toFixed(2)),
        },
      },
    }
  }

  // C. GATEWAY BRIDGE INTENT
  const isBridge =
    p.includes('bridge') ||
    p.includes('gateway') ||
    p.includes('köprü') ||
    p.includes('aktar') ||
    p.includes('sepolia') ||
    p.includes('base') ||
    p.includes('arbitrum') ||
    p.includes('solana') ||
    ((p.includes('from') || p.includes('dan') || p.includes('den') || p.includes('tan') || p.includes('ten')) &&
      (p.includes('to') || p.includes('ye') || p.includes('ya') || p.includes('e') || p.includes('a')))

  if (isBridge) {
    let sourceChain = 'Arc Testnet'
    let destChain = 'Ethereum Sepolia'

    // Check for explicit "from X to Y" (English) e.g. "from Sepolia to Arc"
    const fromToMatch = p.match(/from\s+([a-zA-Z0-9_\s]+?)\s+to\s+([a-zA-Z0-9_\s]+)/i)
    // Check for explicit "to X from Y" (English) e.g. "to Arc from Sepolia"
    const toFromMatch = !fromToMatch ? p.match(/to\s+([a-zA-Z0-9_\s]+?)\s+from\s+([a-zA-Z0-9_\s]+)/i) : null
    // Check for Turkish "X'den Y'ye" / "X dan Y ye" (Source -> Dest)
    const trFromToMatch =
      !fromToMatch && !toFromMatch
        ? p.match(/([a-zA-Z0-9_]+)(?:'den|'dan|'ten|'tan|den|dan|ten|tan)\s+([a-zA-Z0-9_]+)(?:'e|'a|'ye|'ya|e|a|ye|ya)/i)
        : null
    // Check for Turkish "Y'ye X'den" / "Y ye X dan" (Dest <- Source)
    const trToFromMatch =
      !fromToMatch && !toFromMatch && !trFromToMatch
        ? p.match(/([a-zA-Z0-9_]+)(?:'e|'a|'ye|'ya|e|a|ye|ya)\s+([a-zA-Z0-9_]+)(?:'den|'dan|'ten|'tan|den|dan|ten|tan)/i)
        : null
    // Check for "X -> Y" (e.g. "sepolia -> arc")
    const arrowMatch = !fromToMatch && !toFromMatch && !trFromToMatch && !trToFromMatch ? p.match(/([a-zA-Z0-9_]+)\s*(?:->|➔|=>)\s*([a-zA-Z0-9_]+)/i) : null
    // Check for "X to Y" (e.g. "sepolia to arc", but excluding token names like "usdc to arc")
    const xToYMatch = !fromToMatch && !toFromMatch && !trFromToMatch && !trToFromMatch && !arrowMatch
      ? p.match(/(?:^|\s)(?!usdc|eurc|eth|weth|btc|wbtc)([a-zA-Z0-9_]+)\s+to\s+([a-zA-Z0-9_]+)/i)
      : null

    if (fromToMatch) {
      sourceChain = resolveChainName(fromToMatch[1])
      destChain = resolveChainName(fromToMatch[2])
    } else if (toFromMatch) {
      destChain = resolveChainName(toFromMatch[1])
      sourceChain = resolveChainName(toFromMatch[2])
    } else if (trFromToMatch) {
      sourceChain = resolveChainName(trFromToMatch[1])
      destChain = resolveChainName(trFromToMatch[2])
    } else if (trToFromMatch) {
      destChain = resolveChainName(trToFromMatch[1])
      sourceChain = resolveChainName(trToFromMatch[2])
    } else if (arrowMatch) {
      sourceChain = resolveChainName(arrowMatch[1])
      destChain = resolveChainName(arrowMatch[2])
    } else if (xToYMatch) {
      sourceChain = resolveChainName(xToYMatch[1])
      destChain = resolveChainName(xToYMatch[2])
    } else {
      const mentionsSepolia = p.includes('sepolia') || p.includes('ethereum') || p.includes('eth')
      const mentionsBase = p.includes('base')
      const mentionsArb = p.includes('arbitrum') || p.includes('arb')
      const mentionsSol = p.includes('solana') || p.includes('sol')

      const otherChain = mentionsSepolia
        ? 'Ethereum Sepolia'
        : mentionsBase
          ? 'Base Sepolia'
          : mentionsArb
            ? 'Arbitrum Sepolia'
            : mentionsSol
              ? 'Solana Devnet'
              : 'Ethereum Sepolia'

      if (
        p.includes('to arc') ||
        p.includes('into arc') ||
        p.includes('arc a') ||
        p.includes('arc\'a') ||
        p.includes('arc ye') ||
        p.includes('arc\'ye')
      ) {
        sourceChain = otherChain
        destChain = 'Arc Testnet'
      } else if (
        p.includes('from arc') ||
        p.includes('arc dan') ||
        p.includes('arc\'tan') ||
        p.includes('arc tan') ||
        p.includes('arc den') ||
        p.includes('arc\'den')
      ) {
        sourceChain = 'Arc Testnet'
        destChain = otherChain
      } else if (p.includes('to ') || p.includes('e ') || p.includes('a ')) {
        // e.g. "bridge 5 usdc to sepolia" -> Arc Testnet -> Sepolia
        sourceChain = 'Arc Testnet'
        destChain = otherChain
      } else if (p.includes('from ')) {
        // e.g. "bridge 5 usdc from sepolia" -> Sepolia -> Arc Testnet
        sourceChain = otherChain
        destChain = 'Arc Testnet'
      }
    }

    if (sourceChain === destChain) {
      if (sourceChain === 'Arc Testnet') destChain = 'Ethereum Sepolia'
      else destChain = 'Arc Testnet'
    }

    return {
      message: `I have prepared your Circle Gateway omnichain transfer:

🌉 <strong>Gateway Bridge Overview:</strong>
• <strong>Source Network:</strong> ${sourceChain}
• <strong>Destination Network:</strong> ${destChain}
• <strong>Transfer Amount:</strong> ${parsedAmount} USDC

Click below to open Gateway transfer and confirm.`,
      actionPayload: {
        type: 'interactive_bridge',
        title: `🌉 Bridge ${parsedAmount} USDC (${sourceChain} ➔ ${destChain})`,
        data: {
          fromChain: sourceChain,
          toChain: destChain,
          amount: parsedAmount,
        },
      },
    }
  }

  // D. FAUCET INTENT
  const isFaucet =
    p.includes('faucet') ||
    p.includes('musluk') ||
    p.includes('testnet usdc') ||
    p.includes('free usdc') ||
    p.includes('bakiye al')

  if (isFaucet) {
    return {
      message: `Claim 1,000 testnet USDC on Arc Testnet with zero gas fees.`,
      actionPayload: {
        type: 'faucet',
        title: '💧 Open Faucet Page',
        data: {},
      },
    }
  }

  // E. SEND / TRANSFER INTENT
  const isSend =
    p.includes('send') ||
    p.includes('gönder') ||
    p.includes('yolla') ||
    p.includes('transfer') ||
    p.includes('pay') ||
    p.includes('öde') ||
    /0x[a-fA-F0-9]{40}/i.test(prompt)

  if (isSend) {
    // Extract recipient address (0x...) or recipient name
    const addressMatch = prompt.match(/0x[a-fA-F0-9]{40}/i)
    let recipient = addressMatch ? addressMatch[0] : ''

    // Detect token symbol (USDC, EURC, WETH, WBTC)
    let tokenSymbol = 'USDC'
    if (p.includes('eurc')) tokenSymbol = 'EURC'
    else if (p.includes('weth') || p.includes('eth')) tokenSymbol = 'WETH'
    else if (p.includes('wbtc') || p.includes('btc')) tokenSymbol = 'WBTC'

    // Detect optional memo if provided (e.g. "memo: Invoice #12", "not: kira ödemesi")
    const memoMatch = prompt.match(/(?:memo|not|açıklama|reference)\s*[:=]?\s*["']?([^"',\n]+)["']?/i)
    const memo = memoMatch && memoMatch[1] ? memoMatch[1].trim() : undefined

    if (!recipient) {
      const recipientMatch = prompt.match(/(?:to|alici|adrese|kisiye)\s+([a-zA-Z0-9_.-]+)/i)
      if (recipientMatch && recipientMatch[1] && !['usdc', 'eurc', 'eth', 'weth', 'btc', 'wbtc', 'arc'].includes(recipientMatch[1].toLowerCase())) {
        recipient = recipientMatch[1]
      }
    }

    const shortRecipient = recipient ? (recipient.length >= 10 ? `${recipient.slice(0, 6)}...${recipient.slice(-4)}` : recipient) : 'Recipient'

    return {
      message: `I have prepared your payment on Arc Testnet:

⚡ <strong>Send Payment Overview:</strong>
• <strong>Network:</strong> Arc Testnet
• <strong>Recipient:</strong> <code>${recipient || 'Please specify recipient address (0x...)'}</code>
• <strong>Amount:</strong> ${parsedAmount} ${tokenSymbol}
${memo ? `• <strong>Memo:</strong> ${memo}\n` : ''}• <strong>Gas Fee:</strong> ~$0.00042 USDC (Native Gas)

${recipient ? 'Click below to review and send.' : 'Please provide a valid recipient address (0x...) to execute.'}`,
      actionPayload: {
        type: 'interactive_send',
        title: `📤 Send ${parsedAmount} ${tokenSymbol} to ${shortRecipient}`,
        data: {
          recipient,
          amount: parsedAmount,
          tokenSymbol,
          memo,
        },
      },
    }
  }

  // E. GENERAL NATURAL LANGUAGE FALLBACK
  return {
    message: `I have analyzed your request: "${prompt}"

<strong>Arcis Autonomous Intelligence:</strong>
You can issue direct commands like:
• <strong>Swap:</strong> "Swap 250 USDC to WETH"
• <strong>Yield:</strong> "Deposit 1,000 USDC into yield vault"
• <strong>Bridge:</strong> "Bridge 500 USDC from Base"
• <strong>Arbitrage:</strong> "Scan live Arc DEX pools for highest arbitrage"

How would you like to proceed?`,
  }
}
