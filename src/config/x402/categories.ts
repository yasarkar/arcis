// src/config/x402/categories.ts
// Central single source of truth for Marketplace categories

import type { ServiceCategory } from '../../types/x402'

export interface CategoryMetadata {
  id: Exclude<ServiceCategory, 'All'>
  label: string
  description: string
  iconName: string
}

export const SERVICE_CATEGORIES: CategoryMetadata[] = [
  {
    id: 'Liquidity & Routing',
    label: 'Trade Execution',
    description: 'Pool depth analysis, slippage estimation, and pre-trade execution sizing',
    iconName: 'Layers',
  },
  {
    id: 'Arbitrage',
    label: 'Spreads & Pricing',
    description: 'Arc DEX pool spread detection against live external market oracles',
    iconName: 'TrendingUp',
  },
  {
    id: 'Cross-Chain Gateway',
    label: 'Bridge & Gateway',
    description: 'Circle Gateway vs CCTP cost optimization and live cross-chain USDC flows',
    iconName: 'GitCommit',
  },
  {
    id: 'Yield & Flash-Loan',
    label: 'Yield & Pools',
    description: 'ERC-4626 USDC yield vault and Arc L1 liquidity pool analytics',
    iconName: 'Zap',
  },
  {
    id: 'Risk & Compliance',
    label: 'Portfolio & Risk',
    description: 'Multi-chain balance auditing, asset concentration, and exposure analysis',
    iconName: 'AlertTriangle',
  },
  {
    id: 'Reporting & Tax',
    label: 'Statements & AI',
    description: 'On-chain yield statements, position accounting, and AI-narrated reports',
    iconName: 'FileText',
  },
  {
    id: 'MEV & Security',
    label: 'Security',
    description: 'Execution safety checks and transaction risk analysis',
    iconName: 'ShieldCheck',
  },
  {
    id: 'Agent & Copilot',
    label: 'Agent & Copilot',
    description: 'Autonomous financial agent reasoning, tool orchestration, and LLM strategies',
    iconName: 'Bot',
  },
  {
    id: 'Automation',
    label: 'Automation',
    description: 'Trigger-based portfolio rebalancing, DCA orders, and automated limit orders',
    iconName: 'PlayCircle',
  },
  {
    id: 'Payments & Invoicing',
    label: 'Payments & Invoicing',
    description: 'Merchant payment verification, automated streaming payroll, and invoice settlement',
    iconName: 'CreditCard',
  },
  {
    id: 'Data & Oracles',
    label: 'Data & Oracles',
    description: 'Sub-second real-world feeds, price twaps, and on-chain volatility indices',
    iconName: 'Activity',
  },
]

export const ALL_CATEGORY_LABELS: ServiceCategory[] = [
  'All',
  ...SERVICE_CATEGORIES.map((c) => c.id),
]

export function getCategoryLabel(category: ServiceCategory): string {
  if (category === 'All') return 'All'
  return SERVICE_CATEGORIES.find((c) => c.id === category)?.label ?? category
}
