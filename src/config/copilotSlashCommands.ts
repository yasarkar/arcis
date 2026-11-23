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
  directActionKey?: 'clear' | 'session'
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
    id: 'slash-send',
    command: '/send',
    title: 'Send Payments',
    description: 'Send USDC/EURC to any recipient address with optional memo on Arc Testnet.',
    syntax: '/send [amount] [token] to [0x...]',
    category: 'Tools',
    icon: '📤',
    templatePrompt: 'Send 10 USDC to [recipient address]',
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
    id: 'slash-bridge',
    command: '/bridge',
    title: 'Circle CCTP Bridge',
    description: 'Bridge USDC between Arc Testnet and supported EVM testnets (Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche)',
    syntax: '/bridge [amount] [destination]',
    category: 'Bridge',
    icon: '🌉',
    templatePrompt: 'Bridge 5 USDC to Base Sepolia',
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
    id: 'slash-add-lp',
    command: '/add-lp',
    title: 'Add Liquidity',
    description: 'Deposit into Arc AMM pools via 1-Click Zap or Dual-Asset liquidity.',
    syntax: '/add-lp [amount] [pool]',
    category: 'Yield',
    icon: '💧',
    templatePrompt: 'Zap 10 USDC into USDC/EURC pool',
  },
  {
    id: 'slash-remove-lp',
    command: '/remove-lp',
    title: 'Remove Liquidity',
    description: 'Withdraw LP shares from any Arc AMM pool by percentage or LP amount.',
    syntax: '/remove-lp [percent|amount] [pool]',
    category: 'Yield',
    icon: '📤',
    templatePrompt: 'Remove 10% LP from USDC/EURC pool',
  },
  {
    id: 'slash-claim',
    command: '/claim',
    title: 'Claim All Fees & Yield',
    description: 'Harvest all accrued LP swap fees and vault yield across every Arc pool in one command.',
    syntax: '/claim',
    category: 'Yield',
    icon: '✨',
    templatePrompt: 'Claim all fees',
  },
  {
    id: 'slash-arbitrage',
    command: '/arbitrage',
    title: 'All-Pools Spread & Mispricing Scanner',
    description: 'Scan all 6 Arc V4 pools vs live market oracles after USDC gas.',
    syntax: '/arbitrage',
    category: 'Trading',
    icon: '⚡',
    templatePrompt: 'Scan Arc DEX pools for the highest arbitrage spread and net profitability.',
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
