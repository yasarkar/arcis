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
  { id: 'invoice', icon: '🧾', label: 'Invoice', text: 'Invoice #INV-2026-001', refIdPrefix: 'inv-2026' },
  { id: 'freelance', icon: '💼', label: 'Freelance', text: 'Freelance Dev / Milestone 1 Deliverable', refIdPrefix: 'job-dev' },
  { id: 'ai-agent', icon: '🤖', label: 'AI Agent', text: 'ERC-8183 AI Agent Task Settlement', refIdPrefix: 'erc8183' },
  { id: 'rent', icon: '🏠', label: 'Rent / Sub', text: 'Monthly Office / Subscription Payment', refIdPrefix: 'sub-rent' },
  { id: 'gift', icon: '🎁', label: 'Gift / Tip', text: 'Thank You / Community Tip 🎉', refIdPrefix: 'tip' },
  { id: 'order', icon: '🛒', label: 'E-Commerce', text: 'Order #ORD-9842 Checkout Settlement', refIdPrefix: 'order' },
]
