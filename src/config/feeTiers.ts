// src/config/feeTiers.ts
// Arcis Protocol Wallet Speed & Fee Tiers Facade (100% English)
// Backed by centralized fees module (src/config/fees.ts) for backward compatibility.

export {
  type SpeedTier,
  type SpeedTierConfig,
  SPEED_TIERS,
  calculateArcGasCostUsdc,
  getViemGasOptions,
  ARC_MIN_BASE_FEE_FLOOR,
  ARC_MAX_BASE_FEE_CEILING,
  ARC_GAS_LIMITS,
  extractBaseFeeFromHeaderExtraData,
  getDynamicArcGasOptions,
  calculateArcGasCostFromFee,
  type DynamicArcGasResult,
} from './fees'
