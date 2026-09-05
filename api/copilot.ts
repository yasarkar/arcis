// api/copilot.ts
// Secure Server-Side AI Copilot Orchestrator for Arcis
// Interacts with OpenAI / OpenRouter GPT-4o-mini without exposing API keys to the client browser.

import { arcTestnet } from '../src/config/arcChain'
import { apiSuccess, apiError, safeJsonParse } from './utils/apiResponse'

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization')
    const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
    let apiKey = (authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '') ||
      globalEnv.OPENAI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      globalEnv.OPENROUTER_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      globalEnv.VITE_OPENAI_API_KEY ||
      process.env.VITE_OPENAI_API_KEY ||
      ''

    if (!apiKey || apiKey.trim() === '') {
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
      portfolio = {},
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

    // Format portfolio summary for prompt
    const portfolioText = formatPortfolioForPrompt(portfolio)

    const systemPrompt = `You are Arcis, the ultra-smart autonomous AI Copilot & Chief DeFi Strategist of Arcis Protocol on Arc Testnet blockchain (Chain ID: ${arcTestnet.id}).
Arcis features:
- Native Gas Currency: ${arcTestnet.nativeCurrency.symbol} (no ETH needed for gas; gas is ~$0.0084 USDC per tx)
- Speed: <500ms deterministic sub-second finality
- Supported Tokens: USDC, EURC, WETH, WBTC, af-USDC
- Real-Yield Vault (af-USDC): 8.42% APY compound real yield
- Circle Gateway: Instant cross-chain unified balance across Ethereum, Base, Arbitrum, Solana, Polygon
- Enterprise Send: Multicall3From batch payments with preserved msg.sender identity
- Live Real-Time Market Prices: 1 EURC ≈ $${livePrices.EURC || 1.08} USDC, 1 WETH ≈ $${livePrices.WETH || 2650} USDC, 1 WBTC ≈ $${livePrices.WBTC || 63000} USDC

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
        role: m.sender === 'user' ? 'user' : 'assistant',
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
        const fromTok = (args.fromToken || 'USDC').toUpperCase()
        const toTok = (args.toToken || 'EURC').toUpperCase()
        const amount = Number(args.amount) || 10
        const slippage = Number(args.slippage) || 0.1
        const pIn = livePrices[fromTok] || (fromTok === 'USDC' ? 1 : fromTok === 'EURC' ? 1.08 : 2650)
        const pOut = livePrices[toTok] || (toTok === 'USDC' ? 1 : toTok === 'EURC' ? 1.08 : 2650)
        const rate = pOut > 0 ? pIn / pOut : 1
        const estimatedOut = Number((amount * rate * (1 - slippage / 100)).toFixed(4))

        actionPayload = {
          type: 'interactive_swap',
          title: `🔄 Confirm Swap: ${amount} ${fromTok} ➔ ${estimatedOut} ${toTok}`,
          data: {
            fromToken: fromTok,
            toToken: toTok,
            amount,
            slippage,
            estimatedOut,
            rate,
          },
        }

        if (!outputMessage) {
          outputMessage = `I have prepared your instant token swap on Arc Testnet:\n\n⚡ <strong>DEX Swap Overview:</strong>\n• <strong>Pay Amount:</strong> ${amount} ${fromTok}\n• <strong>Est. Receive:</strong> ~${estimatedOut} ${toTok}\n• <strong>Slippage:</strong> ${slippage}%\n• <strong>Network:</strong> Arc Testnet (USDC Native Gas: ~$0.0084)\n\nClick below to confirm and execute the trade.`
        }
      } else if (funcName === 'execute_deposit_yield') {
        const amount = Number(args.amount) || 50
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
          outputMessage = `I have prepared your Real-Yield Vault allocation:\n\n🏦 <strong>Vault Deposit Overview:</strong>\n• <strong>Deposit Amount:</strong> ${amount} USDC\n• <strong>Annual Yield (APY):</strong> 8.42% (Compound Real Yield)\n• <strong>Est. 1-Year Gain:</strong> +$${yearlyReturn} USDC\n• <strong>Lockup:</strong> None (Withdraw anytime)\n\nClick below to lock in your vault deposit.`
        }
      } else if (funcName === 'execute_bridge') {
        const fromChain = args.fromChain || 'Ethereum Sepolia'
        const toChain = args.toChain || 'Arc Testnet'
        const amount = Number(args.amount) || 25
        actionPayload = {
          type: 'interactive_bridge',
          title: `🌉 Bridge ${amount} USDC (${fromChain} ➔ ${toChain})`,
          data: { fromChain, toChain, amount },
        }
        if (!outputMessage) {
          outputMessage = `I prepared the Circle Gateway bridge transfer:\n\n🌉 <strong>Bridge Information:</strong>\n• <strong>Source Network:</strong> ${fromChain}\n• <strong>Destination Network:</strong> ${toChain}\n• <strong>Amount:</strong> ${amount} USDC\n• <strong>Finality Speed:</strong> <500ms (Gateway Instant Pool)\n\nYou can confirm the transfer by clicking the card below.`
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
        const amount = Number(args.amount) || 1
        const token = (args.token || 'USDC').toUpperCase()
        const memo = args.memo || ''
        const shortRec = recipient ? `${recipient.slice(0, 6)}...${recipient.slice(-4)}` : 'Recipient'
        actionPayload = {
          type: 'interactive_send',
          title: `📤 Send ${amount} ${token} to ${shortRec}`,
          data: { recipient, amount, tokenSymbol: token, memo },
        }
        if (!outputMessage) {
          outputMessage = `I have prepared your transfer on Arc Testnet:\n\n📤 <strong>Transfer Details:</strong>\n• <strong>Recipient:</strong> ${recipient || 'Not specified'}\n• <strong>Amount:</strong> ${amount} ${token}\n${memo ? `• <strong>Memo / Note:</strong> ${memo}\n` : ''}• <strong>Network:</strong> Arc Testnet (USDC Gas: ~$0.0084)\n\nClick below to sign and broadcast the transfer.`
        }
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

function formatPortfolioForPrompt(port: any): string {
  if (!port || typeof port !== 'object') {
    return 'USER LIVE PORTFOLIO SNAPSHOT: (Wallet not connected)'
  }

  const arcUsdc = Number(port.liquidArcUsdc || 0)
  const arcEurc = Number(port.liquidArcEurc || 0)
  const arcWeth = Number(port.liquidArcWeth || 0)
  const arcWbtc = Number(port.liquidArcWbtc || 0)
  const vaultUsdc = Number(port.vaultSharesUsdc || 0)
  const gatewayUsdc = Number(port.gatewayTotalUsdc || 0)
  const totalUsdc = Number(port.totalNetWorthUsdc || 0)

  return `USER LIVE PORTFOLIO SNAPSHOT (Real-Time Chain State):
- Liquid Arc Testnet USDC: $${arcUsdc.toFixed(2)} USDC (Available for gas & swaps)
- Liquid Arc Testnet EURC: ${arcEurc.toFixed(2)} EURC
- Liquid Arc Testnet WETH: ${arcWeth.toFixed(4)} WETH
- Liquid Arc Testnet WBTC: ${arcWbtc.toFixed(6)} WBTC
- Staked in Real-Yield Vault (af-USDC @ 8.42% APY): $${vaultUsdc.toFixed(2)} USDC
- Cross-Chain USDC on Circle Gateway: $${gatewayUsdc.toFixed(2)} USDC
- Total Net Worth Across Ecosystem: $${totalUsdc.toFixed(2)} USD`
}
