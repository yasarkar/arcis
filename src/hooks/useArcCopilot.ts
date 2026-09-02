// src/hooks/useArcCopilot.ts
// Hook for managing Arcis AI Copilot (Autonomous Agent Orchestrator & Knowledge Hub)

import { useState, useCallback, useEffect } from 'react'
import { arcTestnet, ARC_METADATA } from '../config/arcChain'
import { ARC_SERVICES_REGISTRY } from '../config/servicesRegistry'
import { executeX402Call } from '../services/x402Client'
import { queryArcisLLM } from '../services/llmService'
import { getLivePortfolioSnapshot } from '../services/portfolioContextService'
import {
  getSessionKeyConfig,
  saveSessionKeyConfig,
  activateSessionKey as activateSessionKeyService,
  revokeSessionKey as revokeSessionKeyService,
  toggleSessionAutoExecute as toggleAutoExecuteService,
  verifySessionLimits,
  SESSION_KEY_UPDATED_EVENT,
} from '../services/sessionKeyService'
import { executeDirectCopilotAction } from '../services/copilotExecutionService'
import type { CopilotMessage, CopilotStepLog, CopilotActionPayload } from '../types/marketplace'
import type { SessionKeyConfig, SessionActionType } from '../types/sessionKey'
import { formatCopilotError } from '../utils/errorUtils'

export interface TopicQuestion {
  id: string
  title: string
  prompt: string
}

export interface TopicCategory {
  id: string
  label: string
  questions: TopicQuestion[]
}

export const EXPLORE_TOPIC_CATEGORIES: TopicCategory[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    questions: [
      {
        id: 'gs-1',
        title: 'What is Arcis and what makes it unique on Arc L1?',
        prompt: 'What is Arcis and what makes it unique on Arc L1?',
      },
      {
        id: 'gs-2',
        title: 'How do I get testnet USDC & start without paying ETH gas?',
        prompt: 'How do I get testnet USDC & start without paying ETH gas?',
      },
      {
        id: 'gs-3',
        title: 'Why does Arc L1 use USDC as the native gas token?',
        prompt: 'Why does Arc L1 use USDC as the native gas token?',
      },
      {
        id: 'gs-4',
        title: 'What are the core features I can use on Arcis?',
        prompt: 'What are the core features I can use on Arcis?',
      },
      {
        id: 'gs-5',
        title: 'How does <500ms finality protect my trades from MEV & slippage?',
        prompt: 'How does <500ms finality protect my trades from MEV & slippage?',
      },
    ],
  },
  {
    id: 'swapping',
    label: 'Swapping',
    questions: [
      {
        id: 'sw-1',
        title: 'How do token swaps work on Arcis?',
        prompt: 'How do token swaps work on Arcis DEX router?',
      },
      {
        id: 'sw-2',
        title: 'What are the trading fees and gas costs for swaps?',
        prompt: 'What are the trading fees and gas costs for swaps on Arc?',
      },
      {
        id: 'sw-3',
        title: 'How does split-routing eliminate price impact & slippage?',
        prompt: 'How does split-routing and concentrated liquidity reduce slippage on Arcis?',
      },
      {
        id: 'sw-4',
        title: 'Which tokens can I swap on Arc L1?',
        prompt: 'Which tokens are supported for swapping on Arc L1?',
      },
      {
        id: 'sw-5',
        title: 'How do gasless EIP-3009 swaps work with 0 gas in wallet?',
        prompt: 'How do gasless EIP-3009 swaps work with 0 gas in wallet?',
      },
    ],
  },
  {
    id: 'liquidity',
    label: 'Yield & Pools',
    questions: [
      {
        id: 'lq-strategy',
        title: 'Analyze my portfolio & propose optimal DeFi yield strategy',
        prompt: 'Analyze my wallet portfolio and propose the optimal DeFi yield strategy.',
      },
      {
        id: 'lq-1',
        title: 'How does the Real-Yield Vault (af-USDC) earn 8.42% APY?',
        prompt: 'How does the Real-Yield Vault (af-USDC) earn 8.42% APY?',
      },
      {
        id: 'lq-2',
        title: 'Where does the protocol yield come from (Zero Token Inflation)?',
        prompt: 'Where does the protocol yield come from (Zero Token Inflation)?',
      },
      {
        id: 'lq-3',
        title: 'How do I deposit USDC to start earning streaming compound yield?',
        prompt: 'How do I deposit USDC to start earning streaming compound yield?',
      },
      {
        id: 'lq-4',
        title: 'What is af-USDC and how do I redeem it back to USDC?',
        prompt: 'What is af-USDC and how do I redeem it back to USDC?',
      },
      {
        id: 'lq-5',
        title: 'How do the Yield & Pools vaults compare (USDC, USYC, LP & Gateway)?',
        prompt: 'How do the Yield & Pools vaults compare (USDC, USYC, LP & Gateway)?',
      },
    ],
  },
  {
    id: 'ai-services',
    label: 'AI Services',
    questions: [
      {
        id: 'arb-1',
        title: 'How does the x402 Nanopayments protocol work (HTTP 402)?',
        prompt: 'How does the x402 Nanopayments protocol work (HTTP 402)?',
      },
      {
        id: 'arb-2',
        title: 'Scan live Arc DEX pools for highest arbitrage spread.',
        prompt: 'Scan live Arc DEX pools for highest arbitrage spread.',
      },
      {
        id: 'arb-3',
        title: 'What are the micro-pricing rates for x402 AI services?',
        prompt: 'What are the micro-pricing rates for x402 AI services?',
      },
      {
        id: 'arb-4',
        title: 'How can developers list & monetize their own AI models?',
        prompt: 'How can developers list and monetize their own AI models on Arcis?',
      },
      {
        id: 'arb-5',
        title: 'Which x402 AI service should I use for my use case?',
        prompt: 'Which x402 AI service should I use for my use case?',
      },
    ],
  },
  {
    id: 'send-payments',
    label: 'Send & Bulk Payouts',
    questions: [
      {
        id: 'sp-2',
        title: 'What are transaction memos and why attach one when sending?',
        prompt: 'What are transaction memos and why attach one when sending?',
      },
      {
        id: 'sp-3',
        title: 'What fees does Arcis charge on sends (Standard / Fast / Turbo)?',
        prompt: 'What fees does Arcis charge on sends (Standard / Fast / Turbo)?',
      },
      {
        id: 'sp-4',
        title: 'How does gasless sending work without holding native ETH?',
        prompt: 'How does gasless sending work without holding native ETH?',
      },
      {
        id: 'sp-5',
        title: 'How do I send USDC cross-chain from Sepolia or Base via the Gateway?',
        prompt: 'How do I send USDC cross-chain from Sepolia or Base via the Gateway?',
      },
    ],
  },
  {
    id: 'gateway',
    label: 'Circle Gateway',
    questions: [
      {
        id: 'gw-1',
        title: 'What is Circle Gateway and unified cross-chain balance?',
        prompt: 'What is Circle Gateway and unified cross-chain balance?',
      },
      {
        id: 'gw-2',
        title: 'Generate a live report of USDC inflows to Arc L1 (last 1 hour).',
        prompt: 'Generate a live report of USDC inflows to Arc L1 (last 1 hour).',
      },
      {
        id: 'gw-3',
        title: 'How does instant cross-chain transfer work with 0 bridge waiting?',
        prompt: 'How does instant cross-chain transfer work with 0 bridge waiting?',
      },
      {
        id: 'gw-4',
        title: 'How do I deposit funds into Gateway from Sepolia or Base?',
        prompt: 'How do I deposit funds into Gateway from Sepolia or Base?',
      },
      {
        id: 'gw-5',
        title: 'On which chains can I use my unified Gateway balance?',
        prompt: 'On which chains can I use my unified Gateway balance?',
      },
    ],
  },
  {
    id: 'security-faq',
    label: 'Security & FAQ',
    questions: [
      {
        id: 'faq-1',
        title: 'Is Arcis non-custodial and secure?',
        prompt: 'Is Arcis non-custodial and secure?',
      },
      {
        id: 'faq-2',
        title: 'What are the network details for Arc Testnet (RPC & Chain ID)?',
        prompt: 'What are the network details for Arc Testnet (RPC & Chain ID)?',
      },
      {
        id: 'faq-3',
        title: 'What is the session budget and how does it protect my wallet?',
        prompt: 'What is the session budget and how does it protect my wallet?',
      },
      {
        id: 'faq-4',
        title: "How does Arcis's APS privacy encryption protect my transactions?",
        prompt: "How does Arcis's APS privacy encryption protect my transactions?",
      },
      {
        id: 'faq-5',
        title: "How does Arcis's 90/10 revenue share support Arc & developers?",
        prompt: "How does Arcis's 90/10 revenue share support Arc & developers?",
      },
    ],
  },
]

export const QUICK_PROMPTS = [
  {
    id: 'portfolio-strategy',
    icon: '📊',
    label: 'Analyze Portfolio & DeFi Strategy',
    prompt: 'Analyze my wallet portfolio and propose the optimal DeFi yield strategy.',
    category: 'Strategy',
  },
  {
    id: 'find-arbitrage',
    icon: '⚡',
    label: 'Find Highest DEX Arbitrage',
    prompt: 'Scan Arc DEX pools for the highest arbitrage spread and net profitability.',
    category: 'Arbitrage',
  },
  {
    id: 'slippage-route',
    icon: '🌊',
    label: '50,000 USDC Slippage Optimization',
    prompt: 'Analyze liquidity depth for 50,000 USDC and calculate optimal split routing.',
    category: 'Routing',
  },
  {
    id: 'flash-liquidations',
    icon: '🎯',
    label: 'Flash-Loan Liquidation Radar',
    prompt: 'Scan under-collateralized lending positions and show liquidation premiums.',
    category: 'Yield',
  },
  {
    id: 'gateway-whales',
    icon: '🌐',
    label: 'Cross-Chain USDC Flow Report',
    prompt: 'Analyze institutional Circle Gateway USDC inflows into Arc L1 over the last hour.',
    category: 'Gateway',
  },
]

export const createArcisWelcomeMessage = (): CopilotMessage => ({
  id: 'welcome-' + Date.now(),
  role: 'assistant',
  content: "Hey! I'm Arcis 👋 Ask me anything about Arcis, DEX arbitrage opportunities, pool liquidity depth, slippage optimization, cross-chain Gateway flows, and more.",
  timestamp: Date.now(),
})

export const createArcoWelcomeMessage = createArcisWelcomeMessage

/**
 * Detects if a user query is an action, transaction command, portfolio strategy request,
 * multi-turn correction, or parameterized input that must be handled by LLM / Local NLP
 * rather than being intercepted by static educational FAQ substring matches.
 */
export function isActionOrStrategyIntent(query: string): boolean {
  if (!query) return false
  const p = query.toLowerCase().trim()

  // 1. Slash commands always route to intent/action handling
  if (p.startsWith('/')) return true

  // 2. Multi-turn corrections or parameters adjustments
  if (
    p.includes('aslında') ||
    p.includes('yerine') ||
    p.includes('pardon') ||
    p.includes('instead') ||
    p.includes('actually') ||
    p.includes('make it') ||
    p.includes('change to') ||
    p.includes('değiştir') ||
    p.includes('artır') ||
    p.includes('azalt')
  ) {
    return true
  }

  // 3. Custom slippage settings or commands
  if (
    p.includes('slippage') ||
    p.includes('kayma') ||
    p.includes('tolerans') ||
    p.includes('slip')
  ) {
    return true
  }

  // 4. Portfolio, balance and yield strategy inquiries
  if (
    p.includes('portföy') ||
    p.includes('portfolio') ||
    p.includes('strateji') ||
    p.includes('strategy') ||
    p.includes('tavsiye') ||
    p.includes('ne yapmalı') ||
    p.includes('durumum') ||
    p.includes('bakiye') ||
    p.includes('varlıklarım') ||
    p.includes('analiz et') ||
    p.includes('analyze') ||
    p.includes('yield strategy') ||
    p.includes('optimal') ||
    p.includes('sağlık skoru') ||
    p.includes('health score')
  ) {
    return true
  }

  // 5. Explicit amount or currency patterns (e.g. "100 usdc", "$50", "0.5 eth", "25 eurc", "1000", "250")
  const hasAmountWithToken =
    /\b\d+(\.\d+)?\s*(usdc|eurc|eth|weth|btc|wbtc|af-usdc|\$)/i.test(p) ||
    /(?:\$|€)\s*\d+/i.test(p) ||
    /(?:^|\s)\d+(\.\d+)?\s*(?:adet|tane|usdc|eurc|eth|weth|btc|wbtc)/i.test(p) ||
    /^\s*\$?\d+(\.\d+)?\s*$/.test(p)
  if (hasAmountWithToken) {
    return true
  }

  // 6. Swap, trade, convert intents
  const hasSwapVerb =
    p.includes('swap') ||
    p.includes('takas') ||
    p.includes('trade') ||
    p.includes('convert') ||
    p.includes('dönüştür') ||
    p.includes('çevir') ||
    p.includes('al') ||
    p.includes('sat') ||
    p.includes('buy') ||
    p.includes('sell')

  const isPureSwapFaq =
    p.includes('how do token swaps work') ||
    p.includes('how do swaps work') ||
    p.includes('how does split-routing') ||
    p.includes('trading fees and gas costs') ||
    p.includes('which tokens can i swap') ||
    p.includes('gasless eip-3009 swaps work')

  if (hasSwapVerb && !isPureSwapFaq) {
    return true
  }

  // 7. Deposit, vault, stake, yield intents
  const hasDepositVerb =
    p.includes('deposit') ||
    p.includes('yatır') ||
    p.includes('stake') ||
    p.includes('havuz') ||
    p.includes('vault') ||
    p.includes('yield') ||
    p.includes('kilitle') ||
    p.includes('compound') ||
    p.includes('kazanç') ||
    p.includes('faiz')

  const isPureDepositFaq =
    p.includes('how does the real-yield vault') ||
    p.includes('where does the protocol yield come from') ||
    p.includes('how do i deposit usdc to start earning') ||
    p.includes('what is af-usdc and how do i redeem') ||
    p.includes('how do the yield & pools vaults compare')

  if (hasDepositVerb && !isPureDepositFaq) {
    return true
  }

  // 8. Bridge, gateway, cross-chain transfer intents
  const hasBridgeVerb =
    p.includes('bridge') ||
    p.includes('köprü') ||
    p.includes('aktar') ||
    p.includes('gateway') ||
    p.includes('sepolia') ||
    p.includes('base') ||
    p.includes('arbitrum') ||
    p.includes('solana') ||
    p.includes('amoy') ||
    p.includes('polygon') ||
    p.includes('->') ||
    p.includes('➔') ||
    p.includes('=>')

  const isPureBridgeFaq =
    p.includes('what is circle gateway and unified') ||
    p.includes('how does instant cross-chain transfer work') ||
    p.includes('deposit funds into gateway from sepolia') ||
    p.includes('supported chains') ||
    p.includes('on which chains can i use')

  if (hasBridgeVerb && !isPureBridgeFaq) {
    return true
  }

  // 9. Faucet, claim intents
  const hasFaucetVerb =
    p.includes('faucet') ||
    p.includes('musluk') ||
    p.includes('claim') ||
    p.includes('talep') ||
    p.includes('free usdc') ||
    p.includes('testnet usdc') ||
    p.includes('bakiye al')

  const isPureFaucetFaq =
    p.includes('how do i get testnet usdc & start without')

  if (hasFaucetVerb && !isPureFaucetFaq) {
    return true
  }

  // 10. Send / Transfer / Payment intent
  const hasSendVerb =
    p.includes('send') ||
    p.includes('gönder') ||
    p.includes('yolla') ||
    p.includes('transfer') ||
    p.includes('pay') ||
    p.includes('öde') ||
    /0x[a-fA-F0-9]{40}/.test(p)

  const isPureSendFaq =
    p.includes('what are transaction memos') ||
    p.includes('what fees does arcis charge') ||
    p.includes('what fees does arcflow charge') ||
    p.includes('how does gasless sending work')

  if (hasSendVerb && !isPureSendFaq) {
    return true
  }

  return false
}

export function useArcCopilot(walletAddress?: string, provider?: any) {
  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false)
  const [currentSteps, setCurrentSteps] = useState<CopilotStepLog[]>([])
  const [messages, setMessages] = useState<CopilotMessage[]>([createArcisWelcomeMessage()])
  const [sessionConfig, setSessionConfig] = useState<SessionKeyConfig>(getSessionKeyConfig())

  useEffect(() => {
    setSessionConfig(getSessionKeyConfig())

    const handleSessionUpdate = (e: any) => {
      if (e?.detail) {
        setSessionConfig(e.detail)
      } else {
        setSessionConfig(getSessionKeyConfig())
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener(SESSION_KEY_UPDATED_EVENT, handleSessionUpdate)
      return () => {
        window.removeEventListener(SESSION_KEY_UPDATED_EVENT, handleSessionUpdate)
      }
    }
  }, [isOpen])

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const streamAssistantMessage = async (msg: CopilotMessage): Promise<void> => {
    setIsAnalyzing(false)
    const fullContent = msg.content
    const msgId = msg.id

    // 1. Insert initial message placeholder with isStreaming = true and holding actionPayload
    const initialMsg: CopilotMessage = {
      ...msg,
      content: '',
      isStreaming: true,
      actionPayload: undefined,
    }

    setMessages((prev) => [...prev, initialMsg])

    // 2. Elegant, organic typewriter cadence (chunk of 3-4 chars with natural punctuation pauses)
    const chunkSize = 4
    const delayMs = 22

    let currentText = ''
    let i = 0

    while (i < fullContent.length) {
      // If we encounter an HTML tag (e.g. <strong>, <code>), consume the entire tag atomically
      if (fullContent[i] === '<') {
        const closingIdx = fullContent.indexOf('>', i)
        if (closingIdx !== -1) {
          currentText += fullContent.slice(i, closingIdx + 1)
          i = closingIdx + 1
        } else {
          currentText += fullContent.slice(i, i + chunkSize)
          i += chunkSize
        }
      } else {
        currentText += fullContent.slice(i, i + chunkSize)
        i += chunkSize
      }

      const textToSet = currentText
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, content: textToSet } : m))
      )

      // Subtle natural breathing pause on sentence ends and line breaks
      const lastChar = currentText.slice(-1)
      const isPauseChar = lastChar === '.' || lastChar === '!' || lastChar === '?' || lastChar === '\n'
      const currentDelay = isPauseChar ? 36 : delayMs

      await new Promise((resolve) => setTimeout(resolve, currentDelay))
    }

    // 3. Finished streaming: reveal full content, stop cursor, attach actionPayload
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? {
              ...m,
              content: fullContent,
              isStreaming: false,
              actionPayload: msg.actionPayload,
            }
          : m
      )
    )
  }

  const addMessage = (msg: CopilotMessage) => {
    if (msg.role === 'assistant' && msg.content) {
      streamAssistantMessage(msg)
    } else {
      setMessages((prev) => [...prev, msg])
    }
  }

  const activateSession = async (params: {
    maxSpendUsdc?: number
    durationHours?: number
    maxPerTxUsdc?: number
    autoExecute?: boolean
    allowedActions?: SessionActionType[]
  }) => {
    const updated = await activateSessionKeyService(params)
    setSessionConfig(updated)
    return updated
  }

  const revokeSession = () => {
    const updated = revokeSessionKeyService()
    setSessionConfig(updated)
    return updated
  }

  const toggleAutoExecute = (enabled: boolean) => {
    const updated = toggleAutoExecuteService(enabled)
    setSessionConfig(updated)
    return updated
  }

  // Execute an action directly inside the chat window
  const executeInlineAction = async (msgId: string, actionPayload: CopilotActionPayload) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === msgId
          ? { ...msg, isExecutingInline: true, executionState: 'routing' }
          : msg
      )
    )

    try {
      const receipt = await executeDirectCopilotAction(
        actionPayload,
        walletAddress,
        provider,
        (progressState) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === msgId
                ? { ...msg, executionState: progressState }
                : msg
            )
          )
        }
      )

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === msgId
            ? {
                ...msg,
                isExecutingInline: false,
                executionState: receipt.status === 'SUCCESS' ? 'confirmed' : 'failed',
                receipt,
              }
            : msg
        )
      )

      setSessionConfig(getSessionKeyConfig())
    } catch (err: any) {
      const cleanErr = formatCopilotError(err)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === msgId
            ? {
                ...msg,
                isExecutingInline: false,
                executionState: 'failed',
                receipt: {
                  id: `rcpt_err_${Date.now()}`,
                  actionType: 'send',
                  title: cleanErr.title,
                  status: 'FAILED',
                  txHash: '',
                  gasUsdc: 0,
                  settlementLatencyMs: 0,
                  timestamp: Date.now(),
                  errorMessage: cleanErr.message,
                },
              }
            : msg
        )
      )
    }
  }

  // Helper to dispatch query to LLM / Local Semantic NLP Engine and handle Session Key Auto-Execution
  const handleLLMIntent = async (
    queryText: string,
    portfolioSnapshot?: any
  ): Promise<void> => {
    try {
      const llmResult = await queryArcisLLM(queryText, walletAddress, messages, portfolioSnapshot)
      const assistantMsgId = 'assistant-' + Date.now()
      const action = llmResult.actionPayload

      const liveConfig = getSessionKeyConfig()
      if (action && liveConfig.isActive) {
        const actionType = action.type.includes('swap')
          ? 'swap'
          : action.type.includes('deposit')
          ? 'deposit'
          : action.type.includes('bridge')
          ? 'bridge'
          : action.type === 'faucet'
          ? 'faucet'
          : 'send'
        const amount = Number(action.data?.amount) || 0
        const check = verifySessionLimits(actionType, amount)

        if (!check.allowed) {
          const actionName = actionType.charAt(0).toUpperCase() + actionType.slice(1)
          const reasonMsg = check.reason?.includes('not authorized')
            ? `The "${actionName}" operation is not allowed for this active session. Please check your session settings to grant permission for ${actionName}s.`
            : `${check.reason} Please adjust your session budget or limits in the Session Key settings.`

          const assistantMsg: CopilotMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: `⚠️ <strong>Session Restriction:</strong> ${reasonMsg}`,
            timestamp: Date.now(),
            actionPayload: {
              type: 'configure_session',
              title: '⚙️ Open Session Settings',
              data: {
                reason: reasonMsg,
                actionType,
              },
            },
          }
          addMessage(assistantMsg)
          return
        }

        if (liveConfig.autoExecute) {
          const assistantMsg: CopilotMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: llmResult.message,
            timestamp: Date.now(),
            actionPayload: action,
            isExecutingInline: true,
            executionState: 'routing',
          }
          addMessage(assistantMsg)

          // Auto-execute inline seamlessly with active provider
          executeDirectCopilotAction(action, walletAddress, provider, (pState) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId ? { ...msg, executionState: pState } : msg
              )
            )
          }).then((receipt) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMsgId
                  ? {
                      ...msg,
                      isExecutingInline: false,
                      executionState: receipt.status === 'SUCCESS' ? 'confirmed' : 'failed',
                      receipt,
                    }
                  : msg
              )
            )
            setSessionConfig(getSessionKeyConfig())
          })
        } else {
          // Manual 1-click mode with active session limits
          const assistantMsg: CopilotMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: llmResult.message,
            timestamp: Date.now(),
            actionPayload: action,
          }
          addMessage(assistantMsg)
        }
      } else {
        const assistantMsg: CopilotMessage = {
          id: assistantMsgId,
          role: 'assistant',
          content: llmResult.message,
          timestamp: Date.now(),
          actionPayload: action,
        }
        addMessage(assistantMsg)
      }
    } catch (err) {
      console.error('LLM Intent Execution Error:', err)
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `I encountered an error processing your query. Please try again or select one of the suggested topics above.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    }
  }

  // Orchestrate execution of natural language query or quick prompt
  const executeQuery = async (queryText: string) => {
    if (!queryText.trim() || isAnalyzing) return

    const userMsgId = 'user-' + Date.now()
    const userMsg: CopilotMessage = {
      id: userMsgId,
      role: 'user',
      content: queryText,
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setIsAnalyzing(true)

    // Fetch live on-chain portfolio snapshot concurrently with animated thinking delay
    const [portfolioSnapshot] = await Promise.all([
      getLivePortfolioSnapshot(walletAddress),
      new Promise((res) => setTimeout(res, 1800)),
    ])

    // 0. PRIORITY ACTION & STRATEGY ROUTING
    // If the query is an action, swap, bridge, deposit, faucet, portfolio analysis,
    // or multi-turn correction, directly dispatch to the LLM / Local NLP Engine.
    if (isActionOrStrategyIntent(queryText)) {
      await handleLLMIntent(queryText, portfolioSnapshot)
      setIsAnalyzing(false)
      setCurrentSteps([])
      return
    }

    const q = queryText.toLowerCase()
    const steps: CopilotStepLog[] = []
    let totalCost = 0

    // ─────────────────────────────────────────────────────────────
    // 1. GETTING STARTED HANDLERS
    // ─────────────────────────────────────────────────────────────

    if (
      q.includes('what makes it unique on arc l1') ||
      ((q.includes('what is arcis') || q.includes('what is arcflow')) && !q.includes('terms') && !q.includes('features'))
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis Protocol is a next-generation decentralized capital and DeFi operating system built natively on Arc L1.

It combines ultra-low latency execution, unified cross-chain liquidity, and an autonomous AI agent marketplace into a single frictionless ecosystem.

<strong>Key Highlights:</strong>

• <strong>Native USDC Gas Token:</strong>
All transaction fees on Arc L1 are paid directly in USDC. There is no need to hold or manage volatile gas tokens like ETH.

• <strong>Sub-Second Finality (<500ms):</strong>
Transactions settle and finalize in under 500 milliseconds, eliminating execution delays and front-running risks.

• <strong>Circle Gateway Liquidity:</strong>
Access your unified USDC balance across 13+ blockchains with instant spendability and zero bridge waiting periods.

• <strong>x402 AI Agent Marketplace:</strong>
On-demand algorithmic intelligence with sub-cent micro-payments ($0.002 to $0.008 USDC) that execute arbitrage and optimal routing in real time.

• <strong>Real-Yield Vault (af-USDC):</strong>
Earn sustainable 8.42% APY compound real-yield powered by institutional borrowing interest and protocol fee sharing.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('get testnet usdc') ||
      q.includes('start without paying eth gas') ||
      q.includes('connect my wallet')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Getting started on Arcis is instant, gas-abstracted, and free. You do not need any ETH or external native tokens.

<strong>Step-by-Step Guide:</strong>

1. <strong>Connect Your Web3 Wallet:</strong>
Click the Connect Wallet button at the top right. Supported wallets include MetaMask, Rabby, Rainbow, Coinbase Wallet, and WalletConnect.

2. <strong>Switch Network to Arc Testnet:</strong>
Your wallet will automatically prompt you to connect to ${arcTestnet.name} (Chain ID: ${arcTestnet.id}, RPC: ${ARC_METADATA.rpcHttpUrl}).

3. <strong>Claim Testnet USDC:</strong>
Navigate to the Faucet tab or click the button below to receive 1,000 free testnet USDC immediately.

4. <strong>Start Trading and Earning:</strong>
Your testnet USDC serves as both your trading balance and your gas fee token for all transactions.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'faucet',
          title: '💧 Open Faucet Page',
          data: {},
        },
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('why does arc l1 use usdc') ||
      q.includes('native gas token instead of eth') ||
      q.includes('native gas token')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arc L1 is purpose-built to use USDC as its native gas currency instead of ETH. This architectural design eliminates critical friction points in decentralized finance:

<strong>Key Advantages:</strong>

1. <strong>Predictable and Stable Costs:</strong>
Gas prices remain constant in dollar terms regardless of crypto market volatility. A standard swap consistently costs under $0.005 USDC.

2. <strong>Single-Token Simplicity:</strong>
Users and autonomous agents never have to maintain dual balances (one for gas and one for trading). A single USDC balance powers all swaps, liquidity provision, and gas payments.

3. <strong>Optimized for Autonomous AI Micro-Payments:</strong>
x402 AI agents can execute thousands of rapid micro-transactions without risk of volatile gas spikes draining their execution budget.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('core features i can use on arcis') ||
      q.includes('core features i can use on arcflow') ||
      q.includes('core features') ||
      q.includes('main modules')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis delivers a comprehensive suite of high-performance DeFi modules:

<strong>Core Ecosystem Modules:</strong>

1. <strong>Smart DEX Router (Swap & Slippage):</strong>
Execute large trades with multi-hop split routing across ArcSwap V3 and Aerodrome Arc with minimal price impact.

2. <strong>Real-Yield Vaults (Pools & af-USDC):</strong>
Deposit USDC into single-sided tokenized vaults earning 8.42% APY with continuous streaming yield.

3. <strong>x402 AI Micro-Services Marketplace:</strong>
Trigger on-demand algorithms including Arbitrage Sentinel, Liquidity Depth Predictor, Flash-Loan Radar, and Mempool MEV Shield.

4. <strong>Circle Gateway Liquidity Sweeper:</strong>
Instantly consolidate and spend USDC balances located on Ethereum, Base, Arbitrum, Polygon, and Solana.

5. <strong>Enterprise Batch Payments (Multicall3From):</strong>
Distribute payroll, contributor rewards, or multi-address transfers in a single atomic transaction.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('how does <500ms finality protect') ||
      q.includes('500ms finality') ||
      q.includes('sub-second finality')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `On traditional networks, transactions wait in a public mempool for 2 to 12 seconds, allowing predatory MEV bots to front-run, sandwich, or extract value from user trades.

Arc L1 solves this with sub-second deterministic finality:

<strong>Key Protections:</strong>

• <strong>Instant State Inclusion:</strong>
Transactions are included in blocks and finalized in under 500 milliseconds, giving sandwich bots zero time window to attack.

• <strong>Private Relayer Routing:</strong>
Arcis routes swap calls directly to block builders through encrypted private relayer tunnels.

• <strong>Price Certainty:</strong>
The quoted price on your screen matches the exact on-chain execution price with zero unexpected slippage.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    }

    // ─────────────────────────────────────────────────────────────
    // 2. SWAPPING HANDLERS
    // ─────────────────────────────────────────────────────────────
    else if (
      q.includes('how do token swaps work') ||
      (q.includes('token swaps work') && (q.includes('arcis') || q.includes('arcflow')))
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Swapping tokens on Arcis is designed to be frictionless, instant, and gas-predictable.

<strong>Step-by-Step Swap Process:</strong>

1. <strong>Select Token Pair:</strong>
Choose your input asset (e.g. USDC) and your target output asset (e.g. WETH, EURC, WBTC).

2. <strong>Automated Route Calculation:</strong>
The Arcis Smart Router queries all Arc L1 liquidity pools in parallel (<50ms) to compute the route with the highest output and lowest price impact.

3. <strong>One-Click Confirmation:</strong>
Sign the transaction with your connected wallet. With Arc L1 sub-second finality (<500ms), your swap completes and balances update in real time.

4. <strong>Direct USDC Gas Settlement:</strong>
All network fees (~$0.005 USDC) are paid directly in USDC with no need to maintain a separate ETH balance.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'trade',
          title: '🔄 Open Swap Interface',
          data: {},
        },
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('trading fees and gas costs for swaps') ||
      q.includes('trading fees and gas costs') ||
      q.includes('trading fees')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis features transparent, institutional-grade low-cost fee structures:

<strong>Fee Architecture:</strong>

• <strong>Liquidity Provider (LP) Fee:</strong>
0.05% for correlated stablecoin pairs (USDC/EURC) and 0.30% for volatile asset pairs (USDC/WETH, USDC/WBTC).

• <strong>Arc L1 Gas Fee:</strong>
A flat fee of approximately $0.005 USDC per transaction, deducted directly from your USDC balance.

• <strong>Protocol Fee Sharing:</strong>
1% of all micro-fees from x402 AI queries is continuously diverted to the af-USDC YieldVault to benefit liquidity providers.

• <strong>Zero Hidden Spreads:</strong>
No opaque relayer markups or predatory MEV slippage tolerances are applied.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('split-routing eliminate price impact') ||
      q.includes('split-routing eliminate slippage') ||
      q.includes('how does split-routing')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `When executing large trades, routing 100% of an order through a single liquidity pool can cause severe price slippage.

<strong>How Arcis Split-Routing Solves Slippage:</strong>

1. <strong>Multi-Pool Liquidity Scanning:</strong>
The router analyzes concentrated liquidity ticks on both ArcSwap V3 and Aerodrome Arc simultaneously.

2. <strong>Dynamic Volume Splitting:</strong>
For an order of 50,000 USDC, the engine might route 65% ($32,500) through ArcSwap V3 and 35% ($17,500) through Aerodrome Arc.

3. <strong>Compressed Slippage:</strong>
By preventing liquidity exhaustion in any single pool, price impact is compressed from over 0.85% down to under 0.04%, saving hundreds of dollars per swap.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'trade',
          title: '🔄 Open Swap Interface',
          data: {},
        },
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('which tokens can i swap on arc l1') ||
      q.includes('which token pairs are supported') ||
      q.includes('token pairs are supported')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis supports primary decentralized liquidity pairs on Arc L1:

<strong>Supported Assets:</strong>

• <strong>USDC:</strong>
Native gas token and primary settlement base currency (Circle standard).

• <strong>EURC:</strong>
Circle 100% Euro-backed stablecoin for FX settlement and zero-spread euro swaps.

• <strong>WETH:</strong>
Wrapped Ethereum for decentralized layer-1 asset exposure.

• <strong>WBTC:</strong>
Wrapped Bitcoin for premier digital store of value trading.

• <strong>af-USDC:</strong>
Arcis Real-Yield Vault interest-bearing share token earning 8.42% APY.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'trade',
          title: '🔄 Open Swap Interface',
          data: {},
        },
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('gasless eip-3009 swaps') ||
      q.includes('eip-3009 authorization') ||
      q.includes('0 gas in wallet')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `EIP-3009 (TransferWithAuthorization) allows you to trade on Arcis even if you have zero native gas balance in your wallet.

<strong>How Gasless Swaps Work:</strong>

1. <strong>Cryptographic Signature:</strong>
You sign an EIP-712 structured authorization message in your wallet. This step does not execute an on-chain transaction or consume any gas.

2. <strong>Relayer Broadcast:</strong>
The Arcis relayer picks up your signed payload and submits it to the Arc L1 consensus engine.

3. <strong>Automatic Gas Settlement:</strong>
The tiny $0.005 USDC gas fee is paid by the relayer and automatically reconciled from the output swap amount upon execution.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    }

    // ─────────────────────────────────────────────────────────────
    // 3. YIELD & POOLS HANDLERS
    // ─────────────────────────────────────────────────────────────
    else if (
      q.includes('earn 8.42% apy') ||
      q.includes('real-yield vault (af-usdc)')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `The Arcis YieldVault (af-USDC) generates sustainable real yield compliant with ERC-4626 standards:

<strong>Yield Composition (8.42% APY):</strong>

• <strong>Institutional Credit Demand (7.42% APY):</strong>
Over-collateralized borrowing facilities provided to algorithmic market makers and liquidity routers on Arc L1.

• <strong>x402 AI Marketplace Protocol Surcharge (1.00% APY):</strong>
A 1% protocol fee share collected from thousands of automated daily x402 AI agent queries.

• <strong>Streaming Auto-Compounding:</strong>
Interest accrues on-chain every single second. As the pool expands, each af-USDC share token redeems for an increasing amount of underlying USDC.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'view_pool',
          title: '🏦 Open Yield & Pools Tab',
          data: {},
        },
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('where does the protocol yield come from') ||
      q.includes('zero token inflation') ||
      q.includes('protocol yield come from')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis generates pure Real Yield without inflationary token emissions:

<strong>Revenue Pillars:</strong>

1. <strong>100% Real Economic Activity:</strong>
Returns originate exclusively from institutional borrower interest and x402 AI micro-service fees.

2. <strong>No Governance Token Dilution:</strong>
You are never paid in temporary farm tokens that lose value over time. All returns are 100% backed and denominated in native USDC.

3. <strong>Fully Transparent On-Chain Proof:</strong>
Vault reserves, utilization rates, and streaming earnings are verifiable in real time directly on the ArcScan block explorer.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'view_pool',
          title: '🏦 Open Yield & Pools Tab',
          data: {},
        },
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('deposit usdc to start earning streaming') ||
      q.includes('how do i deposit usdc')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Depositing USDC into the YieldVault:

<strong>Step-by-Step Guide:</strong>

1. <strong>Open Pools & Yield Tab:</strong>
Click the action button below to navigate to the YieldVault dashboard.

2. <strong>Enter Allocation Amount:</strong>
Specify the amount of USDC you want to deposit (e.g. 1,000 USDC).

3. <strong>Approve & Deposit:</strong>
Click Deposit & Earn. Your wallet signs the transaction with sub-second finality.

4. <strong>Receive af-USDC Shares:</strong>
Your wallet instantly receives af-USDC interest-bearing tokens. Real-yield rewards begin streaming second by second immediately.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'view_pool',
          title: '🏦 Open Yield & Pools Tab',
          data: {},
        },
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('what is af-usdc and how do i redeem') ||
      q.includes('af-usdc')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Understanding the af-USDC Yield-Bearing Share:

<strong>Token Mechanics:</strong>

• <strong>ERC-4626 Standard:</strong>
af-USDC represents your exact proportional ownership of the total liquidity pool plus all accumulated interest.

• <strong>Continuous Price Growth:</strong>
The exchange rate (USDC per af-USDC) moves only upward as interest flows into the vault ($1.0000 ➔ $1.0842).

• <strong>Instant Zero-Penalty Redemption:</strong>
You can redeem af-USDC for the underlying principal and all earned yield at any time with no lockup periods or withdrawal penalties.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'view_pool',
          title: '🏦 Open Yield & Pools Tab',
          data: {},
        },
      }
      addMessage(assistantMsg)
    }
      else if (
        q.includes('vaults compare')
      ) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Comparing Arcis's Yield & Pools:

• <strong>USDC Real-Yield Vault (8.42% APY):</strong>
Single-asset USDC deposit earning institutional borrower interest + protocol fees. Zero impermanent loss — the flagship 'set & forget' option.

• <strong>Gateway Cross-Chain Settlement Pool (7.25% APR):</strong>
USDC routed through Circle Gateway earns routing yield while staying instantly spendable across 13+ chains.

• <strong>USDC / EURC Stable Pool (6.15% APR):</strong>
Stablecoin LP pair with near-zero impermanent loss, earning FX fees from euro (EURC) swaps.

• <strong>USDC / tcirBTC Test Pool (12.8% APR):</strong>
Volatile BTC pair with the highest yield but Medium impermanent-loss risk.

Use the Yield Calculator in the Pools tab to simulate compounding before you deposit.`,
          timestamp: Date.now(),
          actionPayload: {
            type: 'view_pool',
            title: '🏦 Open Yield & Pools Tab',
            data: {},
          },
        }
        addMessage(assistantMsg)
      }


    // ─────────────────────────────────────────────────────────────
    // 4. AI SERVICES HANDLERS
    // ─────────────────────────────────────────────────────────────
    else if (
      q.includes('x402 nanopayments protocol work') ||
      q.includes('http 402')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `The x402 Protocol standardizes HTTP 402 Payment Required for autonomous AI agents:

<strong>Three-Step Execution Lifecycle:</strong>

1. <strong>Initial Query Probe:</strong>
An AI agent requests data from an analytical endpoint. The server returns HTTP 402 with price ($0.005 USDC) and recipient details.

2. <strong>Gasless Micro-Settlement (<150ms):</strong>
The agent wallet signs an off-chain EIP-712 authorization from its pre-funded session budget without requiring manual gas popups.

3. <strong>Instant Verified Payload (HTTP 200 OK):</strong>
The payment is verified on Arc L1 and algorithmic market alpha is returned in under 150 milliseconds.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('scan live arc dex pools') ||
      q.includes('highest arbitrage spread') ||
      q.includes('arbitrage')
    ) {
      // Step 1: Deep Liquidity Depth
      const s1 = ARC_SERVICES_REGISTRY.find((s) => s.id === 'arc-deep-liquidity-slippage-optimizer')!
      steps.push({
        stepNumber: 1,
        serviceId: s1.id,
        serviceName: s1.name,
        status: 'executing',
        costUsdc: s1.priceUsdc,
        durationMs: 0,
        detail: 'Scanning ArcSwap V3 and Aerodrome liquidity depth...',
      })
      setCurrentSteps([...steps])

      const r1 = await executeX402Call(s1, { fromToken: 'USDC', toToken: 'WETH', amount: 25000 }, walletAddress)
      totalCost += s1.priceUsdc
      steps[0].status = 'completed'
      steps[0].durationMs = r1.executionTimeMs
      steps[0].resultSummary = 'Pool depth $14.2M, base slippage 0.042%.'
      setCurrentSteps([...steps])

      // Step 2: Arbitrage Sentinel
      const s2 = ARC_SERVICES_REGISTRY.find((s) => s.id === 'arc-cross-dex-arbitrage-sentinel')!
      steps.push({
        stepNumber: 2,
        serviceId: s2.id,
        serviceName: s2.name,
        status: 'executing',
        costUsdc: s2.priceUsdc,
        durationMs: 0,
        detail: 'Calculating cross-pool price spread and net yield...',
      })
      setCurrentSteps([...steps])

      const r2 = await executeX402Call(s2, { pair: 'USDC/WETH', tradeSizeUsdc: 25000, minNetProfitPct: 0.35 }, walletAddress)
      totalCost += s2.priceUsdc
      steps[1].status = 'completed'
      steps[1].durationMs = r2.executionTimeMs
      steps[1].resultSummary = `Net Profit: $${r2.data?.bestRoute?.netProfitUsdc} USDC (${r2.data?.bestRoute?.netProfitPct}%)`
      setCurrentSteps([...steps])

      // Step 3: MEV Risk Check
      const s3 = ARC_SERVICES_REGISTRY.find((s) => s.id === 'arc-mempool-mev-shield')!
      steps.push({
        stepNumber: 3,
        serviceId: s3.id,
        serviceName: s3.name,
        status: 'executing',
        costUsdc: s3.priceUsdc,
        durationMs: 0,
        detail: 'Inspecting mempool sandwich risks and private relayer tunnel...',
      })
      setCurrentSteps([...steps])

      const r3 = await executeX402Call(s3, { targetTxAmountUsdc: 25000, slippageTolerancePct: 0.2 }, walletAddress)
      totalCost += s3.priceUsdc
      steps[2].status = 'completed'
      steps[2].durationMs = r3.executionTimeMs
      steps[2].resultSummary = 'MEV risk low, private relayer armed.'
      setCurrentSteps([...steps])

      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arbitrage Scan Completed!

An optimal cross-DEX cycle on Arc L1 has been detected for a 25,000 USDC trade:

• <strong>Buy Pool:</strong> ${r2.data?.bestRoute?.buyDex} @ $${r2.data?.bestRoute?.buyPriceUsdc}
• <strong>Sell Pool:</strong> ${r2.data?.bestRoute?.sellDex} @ $${r2.data?.bestRoute?.sellPriceUsdc}
• <strong>Gross Spread:</strong> ${r2.data?.bestRoute?.grossSpreadPct}%
• <strong>Arc L1 Gas Cost:</strong> $${r2.data?.bestRoute?.estimatedGasCostUsdc} USDC
• <strong>Estimated Net Profit:</strong> +$${r2.data?.bestRoute?.netProfitUsdc} USDC (${r2.data?.bestRoute?.netProfitPct}%)

<strong>MEV Shielding:</strong>
Execution is secured via private Arcis relayer tunnels to ensure zero sandwich exploitation.`,
        timestamp: Date.now(),
        steps: [...steps],
        totalCostUsdc: totalCost,
        actionPayload: {
          type: 'trade',
          title: '⚡ Simulate Arbitrage Execution',
          data: r2.data?.bestRoute,
        },
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('micro-pricing rates for x402') ||
      q.includes('micro-pricing rates')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `x402 AI Services Pricing Directory:

<strong>Available Micro-Services:</strong>

1. <strong>Arc Cross-DEX Arbitrage Sentinel:</strong>
Price: $0.005 USDC per query
Output: Real-time price spread, optimal route, net profit estimation.

2. <strong>Deep Liquidity Depth & Slippage Predictor:</strong>
Price: $0.002 USDC per query
Output: Orderbook depth, concentrated tick map, multi-hop split ratios.

3. <strong>Flash-Loan Yield & Liquidation Radar:</strong>
Price: $0.008 USDC per query
Output: Unhealthy loan positions, liquidation premiums, flash liquidity availability.

4. <strong>Arc Mempool & MEV Shield Simulator:</strong>
Price: $0.004 USDC per query
Output: Front-running risk score, private relayer validation.

5. <strong>Cross-Chain Gateway Flow Indexer:</strong>
Price: $0.003 USDC per query
Output: Institutional USDC migration metrics across 13+ chains.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('monetize their own ai models') ||
      q.includes('monetize their own ai services') ||
      q.includes('list & monetize')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Monetizing Developer AI Services via x402:

<strong>Developer Onboarding Steps:</strong>

1. <strong>Integrate x402 Middleware:</strong>
Wrap any Python (FastAPI/LangChain) or Node.js service with Circle x402 HTTP validation headers.

2. <strong>Register in Service Registry:</strong>
Publish your endpoint schema, query parameters, and per-call USDC price to the Arcis registry contract.

3. <strong>Receive Instant Streaming Revenue:</strong>
Every AI agent or user query triggers an automated on-chain USDC payment directly into your developer wallet.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    }
      else if (
        q.includes('which x402 ai service')
      ) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Choosing the Right x402 AI Service:

• <strong>Live arbitrage across DEX pools?</strong>
Use the Arc Cross-DEX Arbitrage Sentinel ($0.005/query) to scan spreads and net profit across Arc L1.

• <strong>Worried about slippage before a big swap?</strong>
The Deep Liquidity Slippage Predictor ($0.002/query) estimates optimal routing and price impact.

• <strong>Hunting liquidation or flash-loan yield?</strong>
The Flash-Loan Yield & Liquidation Radar ($0.008/query) surfaces top lending opportunities.

• <strong>Protecting a trade from MEV and front-running?</strong>
The Mempool & MEV Shield Simulator ($0.004/query) predicts sandwich and front-run risk.

• <strong>Tracking capital moving into Arc?</strong>
The Cross-Chain Gateway Flow Indexer ($0.003/query) reports USDC inflows across 13+ chains.

Open the AI Services tab to run any of these services live.`,
          timestamp: Date.now(),
          actionPayload: {
            type: 'ai-services',
            title: '🤖 Open AI Services Tab',
            data: {},
          },
        }
        addMessage(assistantMsg)
      }

      // ─────────────── 4B. SEND & BULK PAYOUTS HANDLERS ───────────────
      else if (q.includes('transaction memos')) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Arc Testnet Transaction Memos:

• <strong>What is a memo?</strong>
A memo is an on-chain structured note (invoice #, milestone, or reference ID) attached to your USDC transfer via the Arc Memo contract.

• <strong>Why attach one?</strong>
It turns a plain transfer into an auditable, categorized record — ideal for freelance invoicing, rent, AI-agent settlements, gifts, and e-commerce orders.

• <strong>Preserved Sender Identity:</strong>
The memo wraps your transfer using CallFrom so the recipient sees your real wallet address (msg.sender) together with the metadata.

Use the Send tab and pick a preset (Invoice, Freelance, AI Agent, Rent, Gift, E-Commerce) to attach a memo.`,
          timestamp: Date.now(),
          actionPayload: {
            type: 'send',
            title: '📤 Open Send Tab (Memos)',
            data: {},
          },
        }
        addMessage(assistantMsg)
      } else if (q.includes('fees does arcis charge') || q.includes('fees does arcflow charge')) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Arcis Send Fees (Speed & Priority Tiers):

• <strong>Standard (Eco):</strong> 0 USDC platform fee — only the ~$0.00042 L1 USDC gas cost, settling in 1-2 seconds.

• <strong>Fast (Recommended):</strong> 0.005 USDC platform fee — priority queue routing + fast memo processing, < 1 second.

• <strong>Turbo (Instant):</strong> 0.010 USDC platform fee — highest-priority execution with sub-second settlement.

All network gas is paid directly in USDC — no ETH wallet balance is ever required. 90% of protocol fees go to the Arcis Treasury and 10% supports the Arc ecosystem.`,
          timestamp: Date.now(),
          actionPayload: {
            type: 'send',
            title: '📤 Open Send Tab (Speed Tiers)',
            data: {},
          },
        }
        addMessage(assistantMsg)
      } else if (q.includes('gasless sending')) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Gasless Sending on Arc:

• <strong>EIP-3009 TransferWithAuthorization:</strong>
Arcis signs a gasless USDC authorization off-chain so a relayer can execute the transfer on your behalf.

• <strong>Zero Native Balance Needed:</strong>
You can send USDC without holding ETH or any helper gas token — the sponsored relayer covers the network fee.

• <strong>Daily Sponsored Quota:</strong>
Each wallet receives a gasless quota; once exhausted, fall back to paying the tiny ~$0.0005 USDC gas directly.

Open the Send tab and toggle Gasless to send with 0 gas in your wallet.`,
          timestamp: Date.now(),
          actionPayload: {
            type: 'send',
            title: '📤 Open Send Tab (Gasless)',
            data: {},
          },
        }
        addMessage(assistantMsg)
      }


    // ─────────────────────────────────────────────────────────────
    // 5. CIRCLE GATEWAY HANDLERS
    // ─────────────────────────────────────────────────────────────
    else if (
      q.includes('what is circle gateway and unified') ||
      q.includes('circle gateway and unified cross-chain balance')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Circle Gateway is an omnichain liquidity protocol that unites USDC balances:

<strong>Key Advantages:</strong>

• <strong>Unified Balance:</strong>
Consolidates USDC balances held across Ethereum, Base, Arbitrum, Polygon, and Solana into a single balance.

• <strong>Zero Bridge Waiting Time (<500ms):</strong>
Replaces traditional 15-to-30 minute bridge delays with instant cryptographic deposit-and-mint attestations.

• <strong>Maximized Capital Efficiency:</strong>
Deposit USDC on Base or Ethereum and spend it immediately on Arc L1 in the very next block.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'bridge',
          title: '🌉 Open Bridge Tab',
          data: {},
        },
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('report of usdc inflows to arc l1') ||
      q.includes('usdc inflows to arc l1')
    ) {
      const s = ARC_SERVICES_REGISTRY.find((s) => s.id === 'arc-cross-chain-gateway-flow-indexer')!
      steps.push({
        stepNumber: 1,
        serviceId: s.id,
        serviceName: s.name,
        status: 'executing',
        costUsdc: s.priceUsdc,
        durationMs: 0,
        detail: 'Querying Circle Gateway deposit attestations across 13+ chains...',
      })
      setCurrentSteps([...steps])

      const r = await executeX402Call(s, { timeWindow: '1h' }, walletAddress)
      totalCost += s.priceUsdc
      steps[0].status = 'completed'
      steps[0].durationMs = r.executionTimeMs
      steps[0].resultSummary = `Net Inflow: ${r.data?.netUsdcInflowToArc}`
      setCurrentSteps([...steps])

      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Circle Gateway Liquidity Migration Report (Last 1 Hour):

• <strong>Net USDC Inflow to Arc L1:</strong> ${r.data?.netUsdcInflowToArc}

<strong>Top Source Blockchains:</strong>
1. <strong>Ethereum Sepolia/Mainnet:</strong> $2.45M (50.8%)
2. <strong>Base:</strong> $1.32M (27.4%)
3. <strong>Arbitrum:</strong> $850K (17.6%)

• <strong>Institutional Whale Transfers:</strong> 14 large transactions (> $100K USDC each)

• <strong>Market Signal:</strong> Bullish Institutional Inflow into Arc L1`,
        timestamp: Date.now(),
        steps: [...steps],
        totalCostUsdc: totalCost,
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('instant cross-chain transfer work') ||
      q.includes('0 bridge waiting')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `How Instant Cross-Chain Transfer Works in Circle Gateway:

<strong>Execution Lifecycle:</strong>

1. <strong>Deposit Attestation:</strong>
When you deposit USDC on Ethereum or Base, Circle Gateway minters produce a signed attestation in milliseconds.

2. <strong>Instant Mint on Arc L1:</strong>
The attestation is submitted to Arc L1, minting genuine native USDC into your recipient address in <500ms.

3. <strong>Zero Liquidity Risk:</strong>
No wrapped tokens (wUSDC) or risky lock-and-mint pools are involved. You always hold authentic Circle USDC.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'bridge',
          title: '🌉 Open Bridge Tab',
          data: {},
        },
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('deposit funds into gateway from sepolia') ||
      q.includes('deposit funds into gateway')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Depositing into Circle Gateway:

<strong>Step-by-Step Instructions:</strong>

1. <strong>Open Bridge Tab:</strong>
Click the action button below to access the Gateway interface.

2. <strong>Select Origin Network:</strong>
Choose Ethereum Sepolia, Base, or Arbitrum as your source chain.

3. <strong>Enter USDC Amount:</strong>
Specify the amount of USDC you want to bridge into Arc L1.

4. <strong>Confirm Deposit:</strong>
Approve and confirm. Your unified USDC balance becomes available on Arc L1 in under 500 milliseconds.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'bridge',
          title: '🌉 Open Bridge Tab',
          data: {},
        },
      }
      addMessage(assistantMsg)
    }
      else if (
        q.includes('unified gateway balance')
      ) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Circle Gateway Supported Chains:

<strong>13+ Testnet Chains:</strong>
Your unified USDC balance works across Arc Testnet, Ethereum Sepolia, Base, Arbitrum, Optimism, Polygon Amoy, Avalanche Fuji, HyperEVM, Sei, Solana Devnet, Sonic, Unichain, and World Chain.

<strong>How It Works:</strong>

• <strong>Single Deposit, Everywhere:</strong>
Deposit USDC once into the Gateway and the smart-contract vault tracks your liquidity across every chain.

• <strong>Instant Movement:</strong>
Move or spend liquidity across any network in under 500 ms with zero bridge confirmation waiting.

Use the Send or Bridge tab to move your unified balance between chains.`,
          timestamp: Date.now(),
          actionPayload: {
            type: 'send',
            title: '📤 Open Send / Bridge Tab',
            data: {},
          },
        }
        addMessage(assistantMsg)
      }


    // ─────────────────────────────────────────────────────────────
    // 6. FAQ HANDLERS
    // ─────────────────────────────────────────────────────────────
    else if (
      q.includes('non-custodial and secure') ||
      q.includes('secure')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Arcis Security & Custody Architecture:

<strong>Security Pillars:</strong>

• <strong>Non-Custodial Smart Contracts:</strong>
You maintain 100% control of your private keys and assets at all times. Neither Arcis nor relayers have access to user funds.

• <strong>Audited ERC Standards:</strong>
Vaults comply strictly with ERC-4626 tokenized vault standards with built-in emergency recovery logic.

• <strong>Bounded Copilot Budgets:</strong>
x402 AI queries are strictly bounded by hard user-configured spending allowances ($0.50 USDC default), preventing unauthorized balance deductions.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('network details for arc testnet') ||
      q.includes('rpc & chain id') ||
      q.includes(arcTestnet.id.toString())
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `${arcTestnet.name} Network Configuration:

<strong>Network Details:</strong>

• <strong>Network Name:</strong> ${arcTestnet.name}
• <strong>Chain ID:</strong> ${arcTestnet.id}
• <strong>RPC URL:</strong> ${ARC_METADATA.rpcHttpUrl}
• <strong>Native Gas Token:</strong> ${arcTestnet.nativeCurrency.name} (${arcTestnet.nativeCurrency.decimals} decimals)
• <strong>Block Explorer:</strong> ${arcTestnet.blockExplorers.default.url}`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('session budget and how does it protect') ||
      q.includes('session budget')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Session Budget & Safety Limits:

<strong>Budget Protection:</strong>

• <strong>Default Session Allowance:</strong> $0.50 USDC
• <strong>Cost Per AI Query:</strong> $0.002 to $0.008 USDC
• <strong>Live Spend Bar:</strong> Monitored in real time in the budget bar at the top of the chat window.
• <strong>Automatic Auto-Stop:</strong> Once the budget limit is reached, all AI queries pause automatically until renewed by the user.`,
        timestamp: Date.now(),
      }
      addMessage(assistantMsg)
    } else if (
      q.includes('automated batch payouts work via multicall3from') ||
      q.includes('batch payouts') ||
      q.includes('multicall3from')
    ) {
      const assistantMsg: CopilotMessage = {
        id: 'assistant-' + Date.now(),
        role: 'assistant',
        content: `Automated Batch Payouts via Multicall3From:

<strong>Key Capabilities:</strong>

• <strong>Single Atomic Transaction:</strong>
Disburse USDC salaries, contributor grants, or vendor payments to up to 100 recipients in a single click.

• <strong>Preserved msg.sender Identity:</strong>
Unlike traditional forwarder proxies, Multicall3From preserves the true caller identity for downstream contracts.

• <strong>78% Gas Savings:</strong>
Reduces cumulative transaction fees by up to 78% compared to executing individual single transfers.`,
        timestamp: Date.now(),
        actionPayload: {
          type: 'send',
          title: '📤 Open Mass Payouts / Send Tab',
          data: {},
        },
      }
      addMessage(assistantMsg)
    }
      else if (
        q.includes('privacy encryption')
      ) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Arcis APS Privacy Encryption:

<strong>APS (Arc Privacy Shield):</strong>
An optional post-quantum privacy layer that encrypts your transaction metadata on-chain when enabled.

<strong>Two Modes:</strong>

• <strong>EVM-Transparent:</strong>
Default state where transfer metadata is publicly readable on the explorer.

• <strong>APS-Locked (Encrypted):</strong>
On-chain metadata is encrypted so outsiders cannot read message details.

<strong>Always Your Choice:</strong>
APS is fully optional and never removes custody of your funds — it only controls who can read the attached metadata.

Look for the privacy lock badge (APS) in the app to lock or unlock encryption on any transaction.`,
          timestamp: Date.now(),
        }
        addMessage(assistantMsg)
      } else if (
        q.includes('revenue share')
      ) {
        const assistantMsg: CopilotMessage = {
          id: 'assistant-' + Date.now(),
          role: 'assistant',
          content: `Arcis 90/10 Revenue Share:

• <strong>90% to Protocol Developers:</strong>
The majority of every protocol fee (from Send, Swap, and Bridge) flows into the Arcis Treasury to fund the roadmap and contributors.

• <strong>10% to the Arc Ecosystem:</strong>
A fixed share supports the Arc Network ecosystem per the Circle AppKit revenue-sharing model.

• <strong>Transparent Treasury:</strong>
The treasury address is public and verifiable on ArcScan, so you can inspect every inbound fee in real time.

This model keeps Arcis sustainable while rewarding builders on Arc L1.`,
          timestamp: Date.now(),
        }
        addMessage(assistantMsg)
      }


    // ─────────────────────────────────────────────────────────────
    // FALLBACK: GPT-4o-mini & SMART LOCAL NLP INTENT PARSER
    // ─────────────────────────────────────────────────────────────
    else {
      await handleLLMIntent(queryText, portfolioSnapshot)
    }

    setIsAnalyzing(false)
    setCurrentSteps([])
  }

  const clearChat = () => {
    setMessages([createArcisWelcomeMessage()])
  }

  return {
    isOpen,
    toggleOpen,
    setIsOpen,
    isAnalyzing,
    messages,
    currentSteps,
    sessionConfig,
    executeInlineAction,
    activateSession,
    revokeSession,
    toggleAutoExecute,
    executeQuery,
    clearChat,
  }
}
