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
  sourceAdapter: any
  recipientAddress?: string
  slippageTolerance?: number
  customFee?: {
    percentageBps: number
    recipientAddress: string
  }
  allowanceStrategy?: 'approve' | 'permit'
}

export interface SwapQuoteResult {
  estimatedOutput: string
  stopLimit: string
  fees: Array<{
    token: string
    amount: string
    type: 'provider' | 'gas' | 'swap' | 'developer'
  }>
  rate: string
}

export interface SwapExecutionStatus {
  status: 'PENDING' | 'DONE' | 'FAILED' | 'NOT_FOUND'
  sourceTxHash?: string
  destinationTxHash?: string
  errorMessage?: string
}
