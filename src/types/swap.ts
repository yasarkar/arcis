export const SWAP_SUPPORTED_TOKENS = [
  'USDC',
  'EURC',
  'USDT',
  'USDe',
  'DAI',
  'PYUSD',
  'cirBTC',
  'NATIVE'
] as const

export type SwapSupportedToken = 
  | typeof SWAP_SUPPORTED_TOKENS[number]
  | (string & {})


export interface SwapExecuteParams {
  fromChain: string
  toChain?: string
  tokenIn: SwapSupportedToken
  tokenOut: SwapSupportedToken
  amountIn: string
  sourceAdapter?: any
  /** The wallet that signs & pays for the swap. Allowance/ceiling reads must use this address,
   *  never `recipientAddress` (which only decides where output is delivered). */
  senderAddress?: string
  recipientAddress?: string
  slippageTolerance?: number
  speedTier?: 'standard' | 'fast' | 'turbo'
  customFee?: {
    percentageBps: number
    recipientAddress: string
  }
  allowanceStrategy?: 'approve' | 'permit'
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  executeUcwContract?: (params: {
    contractAddress: string
    abiFunctionSignature?: string
    abiParameters?: any[]
    callData?: string
    amount?: string
    blockchain?: string
    walletId?: string
  }) => Promise<{ success: boolean; txHash?: string; error?: string }>
}

export interface SwapQuoteResult {
  estimatedOutput: string
  stopLimit: string
  fees: Array<{
    token: string
    amount: string
    type: 'provider' | 'gas' | 'swap' | 'developer'
    recipientAddress?: string
  }>
  rate: string
}

export interface SwapExecutionStatus {
  status: 'PENDING' | 'DONE' | 'FAILED' | 'NOT_FOUND'
  /** Which step the pending hash belongs to: the ERC-20 approval or the swap itself. */
  pendingStage?: 'approve' | 'swap'
  sourceTxHash?: string
  destinationTxHash?: string
  errorMessage?: string
  isCanceled?: boolean
}
