import { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName, resolveCanonicalChainKey, type ChainMetaItem } from './chainMeta'

export { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName, resolveCanonicalChainKey }
export const BRIDGE_CHAIN_META = CHAIN_META
export const BRIDGE_CHAIN_DEFS = CHAIN_DEFS
export const getBridgeChainIconId = getChainIconId
export const getBridgeChainDisplayName = getChainDisplayName
export const resolveBridgeChainKey = resolveCanonicalChainKey

// Custom bridge fee configuration.
// Values are loaded from .env (VITE_BRIDGE_FEE_*) with safe fallbacks.
//
// Per Arc docs: custom fee is a fixed USDC amount added on top of the bridge
// amount. Arc keeps 10% of the collected fee; 90% goes to the configured
// recipient address.

export interface BridgeCustomFeeConfig {
  enabled: boolean
  value: string
  recipientAddress: string
}

function isLikelyAddress(value: string | undefined): boolean {
  return !!value && /^0x[a-fA-F0-9]{40}$/.test(value)
}

// Reads fee config from Vite env (import.meta.env) with safe fallbacks.
function loadBridgeFeeConfig(): BridgeCustomFeeConfig {
  const envEnabled = import.meta.env.VITE_BRIDGE_FEE_ENABLED as string | undefined
  const envValue = import.meta.env.VITE_BRIDGE_FEE_VALUE as string | undefined
  const envRecipient = import.meta.env.VITE_BRIDGE_FEE_RECIPIENT as string | undefined

  const value = envValue && parseFloat(envValue) > 0 ? envValue : '0.10'
  const recipient = isLikelyAddress(envRecipient) ? envRecipient! : ''

  // Safety: never enable the fee without a valid recipient address.
  const enabled = envEnabled === 'true' && !!recipient

  return {
    enabled,
    value,
    recipientAddress: recipient,
  }
}

export const BRIDGE_CUSTOM_FEE_CONFIG: BridgeCustomFeeConfig = loadBridgeFeeConfig()