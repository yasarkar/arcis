export type BridgeSpeed = 'FAST' | 'SLOW'

export type BridgeStepName = 'approve' | 'burn' | 'fetchAttestation' | 'mint'

export interface CustomFeeConfig {
  value: string
  recipientAddress: string
}

export interface BridgeExecuteParams {
  fromChain: string
  toChain: string
  amount: string
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

export enum BridgeChain {
  Arbitrum_Sepolia = 'Arbitrum_Sepolia',
  Avalanche_Fuji = 'Avalanche_Fuji',
  Base_Sepolia = 'Base_Sepolia',
  Ethereum_Sepolia = 'Ethereum_Sepolia',
  HyperEVM_Testnet = 'HyperEVM_Testnet',
  Injective_Testnet = 'Injective_Testnet',
  Ink_Testnet = 'Ink_Testnet',
  Linea_Sepolia = 'Linea_Sepolia',
  Monad_Testnet = 'Monad_Testnet',
  Optimism_Sepolia = 'Optimism_Sepolia',
  Plume_Testnet = 'Plume_Testnet',
  Polygon_Amoy_Testnet = 'Polygon_Amoy_Testnet',
  Sei_Testnet = 'Sei_Testnet',
  Solana_Devnet = 'Solana_Devnet',
  Sonic_Testnet = 'Sonic_Testnet',
  Unichain_Sepolia = 'Unichain_Sepolia',
  World_Chain_Sepolia = 'World_Chain_Sepolia',
  XDC_Apothem = 'XDC_Apothem',
  Arc_Testnet = 'Arc_Testnet'
}

export const BRIDGE_CHAIN_DISPLAY_NAMES: Record<string, string> = {
  [BridgeChain.Arbitrum_Sepolia]: 'Arbitrum Sepolia',
  [BridgeChain.Avalanche_Fuji]: 'Avalanche Fuji',
  [BridgeChain.Base_Sepolia]: 'Base Sepolia',
  [BridgeChain.Ethereum_Sepolia]: 'Ethereum Sepolia',
  [BridgeChain.HyperEVM_Testnet]: 'HyperEVM Testnet',
  [BridgeChain.Injective_Testnet]: 'Injective Testnet',
  [BridgeChain.Ink_Testnet]: 'Ink Sepolia',
  [BridgeChain.Linea_Sepolia]: 'Linea Sepolia',
  [BridgeChain.Monad_Testnet]: 'Monad Testnet',
  [BridgeChain.Optimism_Sepolia]: 'OP Sepolia',
  [BridgeChain.Plume_Testnet]: 'Plume Testnet',
  [BridgeChain.Polygon_Amoy_Testnet]: 'Polygon PoS Amoy',
  [BridgeChain.Sei_Testnet]: 'Sei Testnet',
  [BridgeChain.Solana_Devnet]: 'Solana Devnet',
  [BridgeChain.Sonic_Testnet]: 'Sonic Testnet',
  [BridgeChain.Unichain_Sepolia]: 'Unichain Sepolia',
  [BridgeChain.World_Chain_Sepolia]: 'World Chain Sepolia',
  [BridgeChain.XDC_Apothem]: 'Apothem Network',
  [BridgeChain.Arc_Testnet]: 'Arc Testnet'
}
