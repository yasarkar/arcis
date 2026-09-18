// src/config/memoConfig.ts
//
// Official Arc Testnet Transaction Memo configuration and ABI.
// Arc Memo contract wraps a target contract call (e.g. USDC transfer) and emits
// on-chain metadata events while preserving the user's EOA as msg.sender via CallFrom.

import { ARC_TOKENS } from './arcChain'

export const MEMO_CONTRACT_ADDRESS = '0x5294E9927c3306DcBaDb03fe70b92e01cCede505' as const
export const ARC_USDC_CONTRACT_ADDRESS = ARC_TOKENS.USDC

export const MEMO_ABI = [
  {
    type: 'function',
    name: 'memo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'memoId', type: 'bytes32' },
      { name: 'memoData', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'BeforeMemo',
    anonymous: false,
    inputs: [{ name: 'memoIndex', type: 'uint256', indexed: true }],
  },
  {
    type: 'event',
    name: 'Memo',
    anonymous: false,
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'target', type: 'address', indexed: true },
      { name: 'callDataHash', type: 'bytes32', indexed: false },
      { name: 'memoId', type: 'bytes32', indexed: true },
      { name: 'memo', type: 'bytes', indexed: false },
      { name: 'memoIndex', type: 'uint256', indexed: false },
    ],
  },
] as const

export interface MemoSendResult {
  txHash: `0x${string}`
  blockNumber: bigint
  memoIndex?: bigint
  memoId: `0x${string}`
  memoText: string
  callDataHash?: `0x${string}`
  sender: `0x${string}`
  target: `0x${string}`
  gasFeeUsdc?: string
}

export interface MemoPreset {
  id: string
  icon: string
  label: string
  text: string
  refIdPrefix?: string
}

export const MEMO_PRESETS: MemoPreset[] = [
  // B2B & Work
  { id: 'invoice', icon: '🧾', label: 'Invoice', text: 'Invoice #INV-2026-001 settlement', refIdPrefix: 'inv-2026' },
  { id: 'freelance', icon: '💼', label: 'Freelance', text: 'Milestone deliverable completion', refIdPrefix: 'job-dev' },
  { id: 'payroll', icon: '🏢', label: 'Payroll', text: 'Monthly payroll compensation', refIdPrefix: 'payroll' },
  // AI & Web3 / Arc Native
  { id: 'ai-agent', icon: '🤖', label: 'AI Agent', text: 'ERC-8183 autonomous agent settlement', refIdPrefix: 'erc8183' },
  { id: 'api-fee', icon: '⚡', label: 'API Fee', text: 'x402 pay-per-call API access fee', refIdPrefix: 'x402' },
  // Commerce & Subs
  { id: 'order', icon: '🛒', label: 'Order', text: 'Order #ORD-8492 checkout payment', refIdPrefix: 'order' },
  { id: 'subscription', icon: '🔄', label: 'Subscription', text: 'SaaS platform monthly subscription', refIdPrefix: 'sub-saas' },
  // P2P & Social
  { id: 'split', icon: '🍕', label: 'Split Bill', text: 'Dinner & drinks split payment', refIdPrefix: 'split' },
  { id: 'tip', icon: '🎁', label: 'Tip / Gift', text: 'Thank you for the support! 🎉', refIdPrefix: 'tip' },
]
