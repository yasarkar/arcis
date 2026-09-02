// Slash Commands Configuration for Ask Arcis Copilot
export interface SlashCommandItem {
  id: string
  command: string // e.g. '/strategy'
  title: string
  description: string
  syntax: string
  category: 'Strategy' | 'Trading' | 'Yield' | 'Bridge' | 'Tools' | 'System'
  icon: string
  templatePrompt?: string
  isDirectAction?: boolean
  directActionKey?: 'clear' | 'session' | 'faucet' | 'apiKey'
}

export const COPILOT_SLASH_COMMANDS: SlashCommandItem[] = [
  {
    id: 'slash-strategy',
    command: '/strategy',
    title: 'Portfolio & Yield Strategy',
    description: 'Analyze wallet holdings and generate optimized yield strategies with rebalancing.',
    syntax: '/strategy',
    category: 'Strategy',
    icon: '📊',
    templatePrompt: 'Analyze my wallet portfolio and propose the optimal DeFi yield strategy.',
  },
  {
    id: 'slash-swap',
    command: '/swap',
    title: 'Instant DEX Swap',
    description: 'Instantly swap tokens on Arc DEX with USDC gas optimization.',
    syntax: '/swap [amount] [token]',
    category: 'Trading',
    icon: '🔄',
    templatePrompt: 'Swap 10 USDC to EURC',
  },
  {
    id: 'slash-vault',
    command: '/vault',
    title: 'Real-Yield Vault Deposit',
    description: 'Compound real yield (8.42% APY) with automatic rebalancing.',
    syntax: '/vault [amount]',
    category: 'Yield',
    icon: '🏦',
    templatePrompt: 'Deposit 10 USDC into yield vault',
  },
  {
    id: 'slash-bridge',
    command: '/bridge',
    title: 'Circle Gateway Bridge',
    description: 'Transfer USDC between Base, Sepolia, and Solana with <500ms latency',
    syntax: '/bridge [amount] [destination]',
    category: 'Bridge',
    icon: '🌉',
    templatePrompt: 'Bridge 5 USDC to Base Sepolia',
  },
  {
    id: 'slash-send',
    command: '/send',
    title: 'Send / Batch Payments',
    description: 'Send USDC/EURC to any recipient address with optional memo on Arc Testnet.',
    syntax: '/send [amount] [token] to [0x...]',
    category: 'Tools',
    icon: '📤',
    templatePrompt: 'Send 10 USDC to ',
  },
  {
    id: 'slash-arbitrage',
    command: '/arbitrage',
    title: 'Live DEX Arbitrage Scanner',
    description: 'Arc DEX pools',
    syntax: '/arbitrage',
    category: 'Trading',
    icon: '⚡',
    templatePrompt: 'Scan Arc DEX pools for the highest arbitrage spread and net profitability.',
  },
  {
    id: 'slash-faucet',
    command: '/faucet',
    title: 'Claim 1,000 Testnet USDC',
    description: 'Claim 1,000 testnet USDC from faucet',
    syntax: '/faucet',
    category: 'Tools',
    icon: '💧',
    templatePrompt: 'Claim 1,000 testnet USDC from faucet',
    isDirectAction: true,
    directActionKey: 'faucet',
  },
  {
    id: 'slash-session',
    command: '/session',
    title: 'Session Key Settings',
    description: 'Session key spending limits',
    syntax: '/session',
    category: 'System',
    icon: '🔑',
    isDirectAction: true,
    directActionKey: 'session',
  },
  {
    id: 'slash-clear',
    command: '/clear',
    title: 'Clear Conversation',
    description: 'Clear conversation',
    syntax: '/clear',
    category: 'System',
    icon: '🧹',
    isDirectAction: true,
    directActionKey: 'clear',
  },
  {
    id: 'slash-help',
    command: '/help',
    title: 'Help & Documentation',
    description: 'Arcis protocol capabilities and documentation',
    syntax: '/help',
    category: 'Tools',
    icon: '❓',
    templatePrompt: 'What is Arcis and what makes it unique on Arc L1?',
  },
]
