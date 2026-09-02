// src/types/sessionKey.ts
// Data structures for Circle Modular Wallets & Autonomous Session Keys in ArcFlow

export type SessionActionType = 'swap' | 'deposit' | 'bridge' | 'send' | 'faucet'

export interface SessionKeyConfig {
  sessionId: string
  sessionPublicKey: string
  ephemeralPrivateKey?: string
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
  | 'confirmed'
  | 'failed'

export interface InlineExecutionReceipt {
  id: string
  actionType: 'swap' | 'deposit' | 'bridge' | 'send' | 'faucet'
  title: string
  status: 'SUCCESS' | 'FAILED'
  txHash: string
  explorerUrl?: string
  fromToken?: string
  toToken?: string
  amountIn?: number
  amountOut?: number
  rate?: number
  apy?: string
  fromChain?: string
  toChain?: string
  recipient?: string
  memo?: string
  gasUsdc: number
  settlementLatencyMs: number
  timestamp: number
  errorMessage?: string
}
