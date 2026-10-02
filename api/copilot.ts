// api/copilot.ts
// Secure Server-Side AI Copilot Orchestrator for Arcis
// Interacts with OpenAI / OpenRouter GPT-4o-mini without exposing API keys to the client browser.

import { arcTestnet } from '../src/config/arcChain'
import { ARC_GAS_LIMITS } from '../src/config/feeTiers'
import { calculateArcGasCostFromFee, getDynamicArcGasOptions } from '../src/services/arcGasService'
import { getSwapEstimate } from '../src/services/swapService'
import { apiSuccess, apiError, safeJsonParse } from './_utils/apiResponse'
import { checkRateLimit } from './_utils/rateLimiter'
// Single owner of the portfolio → prompt contract, shared with the browser so field names cannot drift.
import { formatPortfolioForPrompt, availableTokenBalance } from '../src/utils/portfolioPrompt'
import {
  canonicalCopilotTokenSymbol,
  isUnsupportedCopilotToken,
  validateSendAmount,
  isValidEvmAddress,
  isZeroAddress,
  validateSendAmount,
  WBTC_UNSUPPORTED_MESSAGE,
} from '../src/config/copilotTokens'

// ─────────────────────────────────────────────────────────────
// IP RESOLUTION HELPER
// ─────────────────────────────────────────────────────────────
function getClientIp(req: Request): string {
  const headers = req.headers
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return (
    headers.get('cf-connecting-ip') ||
    headers.get('x-real-ip') ||
    headers.get('true-client-ip') ||
    '127.0.0.1'
  )
}

// A BYOK credential is honored only when it is unmistakably an OpenAI / OpenRouter key.
// Any other Authorization value is ignored, so an arbitrary header can never be forwarded
// upstream as the provider key. Keys are never logged.
const BYOK_KEY_PATTERN = /^sk-(or-)?[A-Za-z0-9_-]{16,}$/

export async function POST(req: Request) {
  try {
    const clientIp = getClientIp(req)

    // Distributed rate limit: 20 requests / 60s per IP. Protect the shared server key from
    // anonymous flooding and cost amplification.
    const rateCheck = await checkRateLimit(`copilot:${clientIp}`, 20, 60_000)
    if (!rateCheck.allowed) {
      return apiError(
        'Rate limit exceeded for Copilot requests. Please wait before trying again.',
        'RATE_LIMIT_EXCEEDED',
        429,
        null,
        { retryAfter: rateCheck.retryAfterSeconds, fallbackToLocal: true }
      )
    }

    const authHeader = req.headers.get('authorization')
    const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
    const clientKey = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : ''
    const serverKey = globalEnv.OPENAI_API_KEY || globalEnv.OPENROUTER_API_KEY || ''
    // Server key is the default; a client key is used only when it is a well-formed BYOK key.
    const apiKey = BYOK_KEY_PATTERN.test(clientKey) ? clientKey : serverKey

    if (!apiKey) {
      return apiError(
        'No OpenAI / OpenRouter API key configured on server or in request.',
        'MISSING_AI_KEY',
        401,
        null,
        { fallbackToLocal: true }
      )
    }

    const jsonResult = await safeJsonParse(req)
    if (!jsonResult.success) {
      return apiError(
        jsonResult.error || 'Invalid or malformed JSON payload in request body.',
        'INVALID_JSON',
        400,
        null,
        { fallbackToLocal: true }
      )
    }

    const body = jsonResult.data || {}
    const {
      userPrompt,
      walletAddress,
      livePrices = {},
      chatHistory = [],
      portfolio = null,
    } = body

    if (!userPrompt || typeof userPrompt !== 'string') {
      return apiError(
        'userPrompt is required.',
        'MISSING_USER_PROMPT',
        400,
        null,
        { fallbackToLocal: true }
      )
    }

    // Serialize the client snapshot through the shared contract (see src/utils/portfolioPrompt.ts).
    const portfolioText = formatPortfolioForPrompt(portfolio)

    const systemPrompt = `You are Arco, the ultra-smart autonomous AI Copilot & Chief DeFi Strategist of Arcis Protocol on Arc Testnet blockchain (Chain ID: ${arcTestnet.id}).
Arcis features:
- Gas Currency: ${arcTestnet.nativeCurrency.symbol} (no ETH needed; network fees are paid in USDC at the live Arc base fee)
- Speed: <500ms deterministic sub-second finality
- Supported Tokens: USDC, EURC, WETH, cirBTC, af-USDC (there is NO WBTC on Arc Testnet — never use WBTC; the Bitcoin asset is cirBTC)
- Real-Yield Vault (af-USDC): 8.42% APY compound real yield
- Circle Gateway: Instant cross-chain unified balance across Ethereum, Base, Arbitrum, Solana, Polygon
- Live Real-Time Market Prices: 1 EURC ≈ ${livePrices.EURC || 1.08} USDC, 1 WETH ≈ ${livePrices.WETH || 2650} USDC, 1 cirBTC ≈ ${livePrices.CIRBTC || livePrices.WBTC || 63000} USDC

${portfolioText}

CHIEF DEFI STRATEGIST & PORTFOLIO RULES:
- You act as the user's personal proactive DeFi Strategist.
- ALWAYS execute explicit user transactional commands (e.g. "send 1 usdc to 0x...", "swap 10 usdc to eurc", "deposit 50 usdc", "bridge 25 usdc") by calling their corresponding tool (execute_send, execute_swap, execute_deposit_yield, execute_bridge). NEVER refuse or block an explicit transactional command with a faucet message; the on-chain execution engine and session key limits will validate the real-time balance.
- When the user asks exploratory questions about their portfolio, balance, what to do with funds, advice, or strategy ("portföyümü analiz et", "ne yapmalıyım", "strateji öner", "portfolio status", "where to get yield"), analyze their exact real-time liquid vs staked vs cross-chain balances from the snapshot above:
  - If the user has idle USDC on Arc Testnet (> $50), recommend depositing into the Real-Yield Vault (8.42% APY) while keeping sufficient liquidity for gas/swaps, and call execute_deposit_yield.
  - If the user has cross-chain USDC on Circle Gateway, recommend bridging to Arc Testnet for instant sub-second finality, and call execute_bridge.
  - If the user has $0 balance and specifically asks how to get started or requests free testnet funds, recommend opening the faucet to claim 1,000 free testnet USDC, and call execute_faucet.
- CONTEXT & MULTI-TURN DIALOGUE:
  - You have full awareness of the recent conversation history.
  - If the user corrects or updates a previous action (e.g. "actually make it 250", "swap to WETH instead"), seamlessly resolve parameters and trigger the updated tool call.
- FORMATTING RULES:
  - Never use markdown bold asterisks (do not use **).
  - Use <strong> tags for bold headings and key bullet points.
  - NEVER repeat transaction parameters (amount, tokens, recipient, fee, network, slippage) as
    bullet lists in your message. The interactive action card and the transaction receipt already
    render every detail — your message is only a short professional lead-in sentence (one or two
    sentences) that introduces the card below it.
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
              fromToken: { type: 'string', description: 'Token symbol to swap from (e.g. USDC, EURC, cirBTC)' },
              toToken: { type: 'string', description: 'Token symbol to swap to (e.g. USDC, EURC, cirBTC)' },
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
          description: 'Send or transfer USDC/EURC/WETH/cirBTC to a recipient address on Arc Testnet with optional memo. WBTC is NOT supported on Arc.',
          parameters: {
            type: 'object',
            properties: {
              recipient: { type: 'string', description: 'Recipient EVM address (0x...) or domain' },
              amount: { type: 'number', description: 'Amount of tokens to transfer' },
              token: { type: 'string', description: 'Token symbol e.g. USDC, EURC, WETH, cirBTC (default: USDC). Never WBTC — Arc has no WBTC.' },
              memo: { type: 'string', description: 'Optional transaction memo, category, or note' },
            },
            required: ['recipient', 'amount'],
          },
        },
      },
    ]

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

    const cleanHistory = (chatHistory || [])
      .slice(-6)
      .filter((m: any) => m.content && m.content.trim() !== '')
      .map((m: any) => ({
        // CopilotMessage carries `role`, not `sender`. Client-supplied history may only be a user
        // or assistant turn — never `system`, which would hand it instruction-level authority.
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      }))

    const messages = [
      { role: 'system', content: systemPrompt },
      ...cleanHistory,
      { role: 'user', content: userPrompt },
    ]

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelName,
        messages,
        tools: ARC_COPILOT_TOOLS,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 650,
      }),
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return Response.json(
        {
          success: false,
          error: `AI Provider HTTP ${response.status}: ${errText}`,
          fallbackToLocal: true,
        },
        { status: 502 }
      )
    }

    const data = await response.json()
    const choice = data.choices?.[0]
    const message = choice?.message

    let outputMessage = message?.content || ''
    let actionPayload: any = undefined

    // Check function/tool call
    if (message?.tool_calls && message.tool_calls.length > 0) {
      const toolCall = message.tool_calls[0]
      const funcName = toolCall.function?.name
      let args: any = {}
      try {
        args = JSON.parse(toolCall.function?.arguments || '{}')
      } catch (e) {
        console.error('Failed to parse AI tool arguments:', e)
      }

      if (funcName === 'execute_swap') {
        // Preserve display casing (cirBTC, af-USDC) while looking prices up by upper-case key.
        const fromTok = args.fromToken ? canonicalCopilotTokenSymbol(args.fromToken) : 'USDC'
        const toTok = args.toToken ? canonicalCopilotTokenSymbol(args.toToken) : 'EURC'
        if (fromTok === 'WBTC' || toTok === 'WBTC') {
          return apiSuccess({
            message: WBTC_UNSUPPORTED_MESSAGE,
            source: isOpenRouter ? 'openrouter/gpt-4o-mini' : 'gpt-4o-mini',
          })
        }
        const amountCheck = validateSendAmount(args.amount, fromTok)
        if (!amountCheck.ok || amountCheck.normalized == null) {
          return apiSuccess({ message: `Invalid swap amount. ${amountCheck.error || 'Please provide an amount greater than zero.'}`, source: isOpenRouter ? 'openrouter/gpt-4o-mini' : 'gpt-4o-mini' })
        }
        const amount = amountCheck.normalized
        const slippage = Number(args.slippage) || 0.1
        let quote: Awaited<ReturnType<typeof getSwapEstimate>> | undefined
        try {
          quote = await getSwapEstimate({
            fromChain: 'Arc_Testnet',
            tokenIn: fromTok,
            tokenOut: toTok,
            amountIn: String(amount),
            slippageTolerance: slippage / 100,
          })
          if (!Number.isFinite(Number(quote.estimatedOutput)) || Number(quote.estimatedOutput) <= 0) quote = undefined
        } catch (error) {
          console.warn('[copilot] Live Arc swap quote unavailable:', error)
        }
        const estimatedOut = quote ? Number(Number(quote.estimatedOutput).toFixed(8)) : undefined
        const minReceived = quote ? Number(Number(quote.stopLimit).toFixed(8)) : undefined
        const rate = quote ? Number(quote.rate) : undefined
        const networkFee = await getEstimatedArcGasUsdc(ARC_GAS_LIMITS.contractInteraction)

        actionPayload = {
          type: 'interactive_swap',
          title: `🔄 Confirm Swap: ${amount} ${fromTok}${estimatedOut === undefined ? '' : ` ➔ ${estimatedOut} ${toTok}`}`,
          data: {
            fromToken: fromTok,
            toToken: toTok,
            amount,
            slippage,
            estimatedOut,
            minReceived,
            rate,
            estimatedFeeUsdc: networkFee.amount,
            feeEstimateSource: networkFee.source,
          },
        }

        if (!outputMessage) {
          outputMessage = `I have prepared your instant token swap on Arc Testnet. Click below to confirm and execute the trade.`
        }
      } else if (funcName === 'execute_deposit_yield') {
        const amountCheck = validateSendAmount(args.amount, 'USDC')
        if (!amountCheck.ok || amountCheck.normalized == null) {
          return apiSuccess({ message: `Invalid deposit amount. ${amountCheck.error || 'Please provide an amount greater than zero.'}`, source: isOpenRouter ? 'openrouter/gpt-4o-mini' : 'gpt-4o-mini' })
        }
        const amount = amountCheck.normalized
        const yearlyReturn = Number((amount * 0.0842).toFixed(2))
        actionPayload = {
          type: 'interactive_deposit',
          title: `🏦 Deposit ${amount} USDC into Yield Vault (8.42% APY)`,
          data: {
            amount,
            apy: '8.42%',
            estimatedYieldUsdcYearly: yearlyReturn,
          },
        }
        if (!outputMessage) {
          outputMessage = `I have prepared your Real-Yield Vault allocation. Click below to lock in your vault deposit.`
        }
      } else if (funcName === 'execute_bridge') {
        const fromChain = args.fromChain || 'Ethereum Sepolia'
        const toChain = args.toChain || 'Arc Testnet'
        const amountCheck = validateSendAmount(args.amount, 'USDC')
        if (!amountCheck.ok || amountCheck.normalized == null) {
          return apiSuccess({ message: `Invalid bridge amount. ${amountCheck.error || 'Please provide an amount greater than zero.'}`, source: isOpenRouter ? 'openrouter/gpt-4o-mini' : 'gpt-4o-mini' })
        }
        const amount = amountCheck.normalized
        actionPayload = {
          type: 'interactive_bridge',
          title: `🌉 Bridge ${amount} USDC (${fromChain} ➔ ${toChain})`,
          data: { fromChain, toChain, amount },
        }
        if (!outputMessage) {
          outputMessage = `I prepared the Circle Gateway bridge transfer. You can confirm the transfer by clicking the card below.`
        }
      } else if (funcName === 'execute_faucet') {
        actionPayload = {
          type: 'faucet',
          title: '💧 Claim 1,000 Testnet USDC',
          data: {},
        }
        if (!outputMessage) {
          outputMessage = `I have prepared your testnet balance claim. You can claim <strong>1,000 free testnet USDC</strong> below with zero gas fees.`
        }
      } else if (funcName === 'execute_send') {
        const recipient = args.recipient || ''
        const source = isOpenRouter ? 'openrouter/gpt-4o-mini' : 'gpt-4o-mini'
        // Canonical casing matters: 'cirBTC' is a real Arc ERC-20 (8 decimals), 'CIRBTC' would not
        // resolve in the App Kit / Circle transfer APIs and 'WBTC' does not exist on Arc at all.
        const token = canonicalCopilotTokenSymbol(args.token)
        if (isUnsupportedCopilotToken(token)) {
          return apiSuccess({ message: WBTC_UNSUPPORTED_MESSAGE, source })
        }
        if (!isValidEvmAddress(recipient)) {
          return apiSuccess({
            message: 'Please provide a valid Arc (EVM) wallet address (0x...) to send funds.',
            source,
          })
        }
        if (isZeroAddress(recipient)) {
          return apiSuccess({
            message: 'The zero address (0x000…000) is a burn target; refusing to send there.',
            source,
          })
        }
        // No silent `|| 1` fallback: an unspecified or zero amount must be corrected by the user.
        const amountCheck = validateSendAmount(args.amount, token)
        if (!amountCheck.ok) {
          return apiSuccess({ message: `Invalid transfer amount. ${amountCheck.error}`, source })
        }
        const amount = amountCheck.normalized!
        const available = availableTokenBalance(portfolio, token)
        if (available !== null && amount > available) {
          return apiSuccess({
            message: `Insufficient balance. You have ${available} ${token} available on Arc Testnet, but this transfer is ${amount} ${token}.`,
            source,
          })
        }
        const memo = args.memo || ''
        const shortRec = recipient ? `${recipient.slice(0, 6)}...${recipient.slice(-4)}` : 'Recipient'
        const isNativeUsdc = token.toUpperCase() === 'USDC'
        const sendGasLimit = memo.trim().length > 0
          ? ARC_GAS_LIMITS.memoTransfer
          : isNativeUsdc
            ? ARC_GAS_LIMITS.nativeTransfer
            : ARC_GAS_LIMITS.erc20Transfer
        const dynamicGas = await getEstimatedArcGasUsdc(sendGasLimit)
        actionPayload = {
          type: 'interactive_send',
          title: `📤 Send ${amount} ${token} to ${shortRec}`,
          data: {
            recipient,
            amount,
            tokenSymbol: token,
            memo,
            estimatedFeeUsdc: dynamicGas.amount,
            feeEstimateSource: dynamicGas.source,
          },
        }
        outputMessage = `I have prepared your transfer on Arc Testnet.${memo ? ` Memo: ${memo}.` : ''} Click below to sign and broadcast the transfer.`
      }
    }

    return apiSuccess({
      message: outputMessage,
      actionPayload,
      source: isOpenRouter ? 'openrouter/gpt-4o-mini' : 'gpt-4o-mini',
    })
  } catch (error: any) {
    console.error('[Copilot API Error]:', error)
    return apiError(
      error.message || 'Server error occurred in Copilot processing.',
      'COPILOT_SERVER_ERROR',
      500,
      null,
      { fallbackToLocal: true }
    )
  }
}

/**
 * Live Arc L1 network fee estimate in USDC for a specific operation.
 *
 * Reads the current base fee from the Arc RPC and applies the fast-tier multiplier with the
 * operation's real gas limit, so the quoted fee tracks the network instead of a fixed constant.
 * Falls back to the static fast-tier config only when the RPC is unreachable.
 */
async function getEstimatedArcGasUsdc(
  gasLimit: bigint = ARC_GAS_LIMITS.erc20Transfer
): Promise<{ amount?: string; source: string }> {
  try {
    const gas = await getDynamicArcGasOptions(undefined, 'fast', gasLimit)
    return {
      amount: calculateArcGasCostFromFee(gasLimit, gas.maxFeePerGas),
      source: gas.source,
    }
  } catch (error) {
    console.warn('[copilot] Live Arc network fee unavailable:', error)
    return { source: 'unavailable' }
  }
}

