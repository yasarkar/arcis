export type BridgeSpeed = 'FAST' | 'SLOW'

export type BridgeStepName = 'approve' | 'burn' | 'fetchAttestation' | 'mint'

export type SupportedBridgeToken = 'USDC' | 'EURC' | 'WETH' | 'cirBTC' | 'ETH'

export interface CustomFeeConfig {
  value: string
  recipientAddress: string
}

export interface BridgeExecuteParams {
  fromChain: string
  toChain: string
  amount: string
  token?: SupportedBridgeToken | string
  sourceAdapter: any
  destinationAdapter?: any
  recipientAddress?: string
  transferSpeed?: BridgeSpeed
  maxFee?: string
  useForwarder?: boolean
  customFee?: CustomFeeConfig
}

export interface BridgeStepProgress {
  name: BridgeStepName
  state: 'pending' | 'success' | 'error'
  txHash?: string
  explorerUrl?: string
  errorMessage?: string
}
