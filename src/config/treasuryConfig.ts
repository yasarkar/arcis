// src/config/treasuryConfig.ts
// Arcis Protocol Treasury & Protocol Fee Configuration Facade (100% English)
// Backed by centralized fees module (src/config/fees.ts) for backward compatibility.

export {
  TREASURY_ADDRESSES,
  TREASURY_ADDRESS,
  TREASURY_EXPLORER_URL,
  getTreasuryRecipientAddress,
  getSwapFeeRecipient,
  getBridgeFeeRecipient,
  getTreasuryExplorerUrl,
  formatTreasuryAddress,
  isValidChainAddress,
  getAllTreasuryDetails,
  type ChainTreasuryInfo,
  SWAP_CUSTOM_FEE_CONFIG,
  BRIDGE_CUSTOM_FEE_CONFIG,
  REVENUE_SHARE_LABEL,
  REVENUE_SHARE_TOOLTIP,
  PROTOCOL_FEE_RATES,
  type ModuleProtocolFeeConfig,
  type SpeedTier,
  getSendProtocolFee,
  getSwapProtocolFeeBps,
  getSwapProtocolFeePercent,
  calculateSwapProtocolFeeAmount,
  getBridgeProtocolFeeBps,
  getBridgeProtocolFee,
  getBridgeProtocolFeePercent,
  calculateBridgeProtocolFeeAmount,
} from './fees'
