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
    id: 'Arbitrage',
    label: 'Arbitrage & Spreads',
    description: 'High-frequency DEX spread detection and triangular arbitrage execution',
    iconName: 'TrendingUp',
  },
  {
    id: 'Liquidity & Routing',
    label: 'Liquidity & Routing',
    description: 'Pool depth oracles, slippage estimation, and multi-hop DEX routing',
    iconName: 'Layers',
  },
  {
    id: 'Yield & Flash-Loan',
    label: 'Yield & Flash-Loan',
    description: 'Lending pool APY analytics, flash-loan cycles, and delta-neutral yield vaults',
    iconName: 'Zap',
  },
  {
    id: 'MEV & Security',
    label: 'MEV & Security',
    description: 'Mempool frontrunning defense, sandwich attack detection, and transaction simulations',
    iconName: 'ShieldCheck',
  },
  {
    id: 'Cross-Chain Gateway',
    label: 'Cross-Chain Gateway',
    description: 'Circle Gateway unified balance telemetry, CCTP routing, and instant mint scouts',
    iconName: 'GitCommit',
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
    id: 'Risk & Compliance',
    label: 'Risk & Compliance',
    description: 'Counterparty risk evaluation, smart contract anomaly detection, and AML screening',
    iconName: 'AlertTriangle',
  },
  {
    id: 'Payments & Invoicing',
    label: 'Payments & Invoicing',
    description: 'Merchant payment verification, automated streaming payroll, and invoice settlement',
    iconName: 'CreditCard',
  },
  {
    id: 'Reporting & Tax',
    label: 'Reporting & Tax',
    description: 'DeFi P&L calculation, cross-chain accounting, and tax compliance telemetry',
    iconName: 'FileText',
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
