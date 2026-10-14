import { SpeedTier } from '../config/feeTiers'

export type SlippagePreset = '0.1' | '0.5' | '1.0' | 'custom'

export interface WalletTransactionSettings {
  // Transaction Settings (SendModal)
  sendSpeedTier: SpeedTier

  // Swap Settings (SwapModal)
  swapSpeedTier: SpeedTier
  swapSlippageType: SlippagePreset
  swapCustomSlippage: string

  // Bridge Settings (BridgeModal)
  bridgeSpeedTier: SpeedTier

  // Pools Settings (PoolActionModal / ConcentratedLiquidityModal)
  poolSlippageType: SlippagePreset
  poolCustomSlippage: string
  poolSlippage: number
}

export const DEFAULT_WALLET_TRANSACTION_SETTINGS: WalletTransactionSettings = {
  sendSpeedTier: 'fast',
  swapSpeedTier: 'fast',
  swapSlippageType: '0.5',
  swapCustomSlippage: '',
  bridgeSpeedTier: 'fast',
  poolSlippageType: '0.5',
  poolCustomSlippage: '',
  poolSlippage: 0.5,
}
