// src/types/sessionKey.ts
// Data structures for Circle Modular Wallets & Autonomous Session Keys in Arcis

export type SessionActionType = 'swap' | 'deposit' | 'bridge' | 'send' | 'faucet' | 'ai_service'

export interface SessionKeyConfig {
  sessionId: string
  sessionPublicKey: string
  ephemeralPrivateKey?: string
  walletAddress?: string // The owner wallet address this session is bound to
  mscaAddress?: string // Linked Circle Modular Smart Account address if connected
  delegationType?: 'msca' | 'eoa' | 'headless'
  expiresAt: number // Timestamp in ms
  maxSpendUsdc: number // Total budget cap e.g. 100 USDC
  spentUsdc: number // Total spent so far
  maxPerTxUsdc: number // Single-tx threshold e.g. 25 USDC
  allowedActions: SessionActionType[]
  isActive: boolean
  autoExecute: boolean // When true, commands matching session parameters execute with zero pop-ups
  createdAt: number
}

export interface SessionTimeRemaining {
  hours: number
  minutes: number
  seconds: number
  isExpired: boolean
  formatted: string
}

export type ExecutionProgressState = 
  | 'idle'
  | 'routing'
  | 'signing'
  | 'broadcasting'
  | 'pending'
  | 'confirmed'
  | 'failed'

export interface InlineExecutionReceipt {
  id: string
  actionType: 'swap' | 'deposit' | 'bridge' | 'send' | 'faucet' | 'ai_service'
  title: string
  subtitle?: string
  status: 'SUCCESS' | 'PENDING' | 'FAILED' | 'CANCELED'
  txHash: string
  /** Bundler operation identifier when an ERC-4337 operation is still awaiting inclusion. */
  userOpHash?: string
  explorerUrl?: string
  /** Source-chain transaction for cross-chain bridge receipts. */
  sourceTxHash?: string
  /** Destination-chain settlement transaction for cross-chain bridge receipts. */
  destTxHash?: string
  fromToken?: string
  toToken?: string
  amountIn?: number
  amountOut?: number
  rate?: number
  apy?: string
  fromChain?: string
  toChain?: string
  recipient?: string
  userAddress?: string
  sender?: string
  memo?: string
  gasUsdc: number
  /** Actual Arc receipt gas cost in USDC; null/undefined when it could not be verified. */
  actualGasUsdc?: number | null
  /** Exact Base-fee component of actualGasUsdc (gasUsed × block baseFeePerGas) — ArcScan's split. */
  baseFeeUsdc?: string | null
  /** Exact Priority-tip component of actualGasUsdc (total − base) — ArcScan's split. */
  priorityFeeUsdc?: string | null
  settlementLatencyMs: number
  timestamp: number
  errorMessage?: string
}
