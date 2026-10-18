import type { CopilotMessage } from '../types/marketplace'

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
        title: 'How do the Yield & Pools vaults compare (USDC Vault, LP Pools & Gateway)?',
        prompt: 'How do the Yield & Pools vaults compare (USDC Vault, LP Pools & Gateway)?',
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
  content: "Hey! I'm Arco 👋 Ask me anything about Arcis, DEX arbitrage opportunities, pool liquidity depth, slippage optimization, cross-chain Gateway flows, and more.",
  timestamp: Date.now(),
})

export const createArcoWelcomeMessage = createArcisWelcomeMessage

/**
 * True for queries that must be answered by the paid Circle Gateway flow report,
 * which reads the real AttestationUsed / GatewayBurned logs on Arc L1.
 * Kept next to the router so the action-intent shortcuts can never shadow it.
 */
export function isGatewayFlowReportQuery(query: string): boolean {
  if (!query) return false
  const p = query.toLowerCase()
  return (
    p.includes('inflows to arc l1') ||
    p.includes('inflows into arc l1') ||
    p.includes('cross-chain usdc flow') ||
    p.includes('usdc flow report')
  )
}

/**
 * Detects if a user query is an action, transaction command, portfolio strategy request,
 * multi-turn correction, or parameterized input that must be handled by LLM / Local NLP
 * rather than being intercepted by static educational FAQ substring matches.
 */
export function isActionOrStrategyIntent(query: string): boolean {
  if (!query) return false

  // Analytics report queries are answered by the Gateway flow service, not an action intent.
  if (isGatewayFlowReportQuery(query)) return false
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

  // 9. Send / Transfer / Payment intent
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
    p.includes('how does gasless sending work')

  if (hasSendVerb && !isPureSendFaq) {
    return true
  }

  return false
}
