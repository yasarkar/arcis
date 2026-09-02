import { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName } from './chainMeta'

export { CHAIN_META, CHAIN_DEFS, getChainIconId, getChainDisplayName }

// Swap focuses on Arc Testnet as primary native token swap network
export const SWAP_CHAIN_META = {
  Arc_Testnet: CHAIN_META.Arc_Testnet,
}
export const SWAP_CHAIN_DEFS = {
  Arc_Testnet: CHAIN_DEFS.Arc_Testnet,
}
export const getSwapChainIconId = (chainKey: string = 'Arc_Testnet') => getChainIconId(chainKey)

// Custom swap fee configuration.
// Values are loaded from .env (VITE_SWAP_FEE_*) with safe fallbacks.
//
// Per Arc docs: custom fee is charged as a percentage of the swap amount,
// collected before the swap executes. Arc keeps 10% of the collected fee;
// 90% goes to the configured recipient address.

export interface SwapCustomFeeConfig {
  enabled: boolean
  percentageBps: number
  recipientAddress: string
}

function isLikelyAddress(value: string | undefined): boolean {
  return !!value && /^0x[a-fA-F0-9]{40}$/.test(value)
}

// Reads fee config from Vite env (import.meta.env) with safe fallbacks.
function loadSwapFeeConfig(): SwapCustomFeeConfig {
  const envEnabled = import.meta.env.VITE_SWAP_FEE_ENABLED as string | undefined
  const envBps = Number(import.meta.env.VITE_SWAP_FEE_BPS)
  const envRecipient = import.meta.env.VITE_SWAP_FEE_RECIPIENT as string | undefined

  const bps = Number.isFinite(envBps) && envBps >= 0 ? Math.round(envBps) : 25
  const recipient = isLikelyAddress(envRecipient) ? envRecipient! : ''

  // Safety: never enable the fee without a valid recipient address.
  const enabled = envEnabled === 'true' && !!recipient

  return {
    enabled,
    percentageBps: bps,
    recipientAddress: recipient,
  }
}

export const SWAP_CUSTOM_FEE_CONFIG: SwapCustomFeeConfig = loadSwapFeeConfig()

// Returns the fee percentage in human-readable form, e.g. 25 bps -> "0.25%"
export function getSwapFeePercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

// Calculates the custom fee amount for a given input amount (used for UI preview).
// Fee is charged on the swap amount (amountIn) before the swap executes.
export function calculateSwapFeeAmount(bps: number, amountIn: string): string | null {
  const amt = parseFloat(amountIn)
  if (!Number.isFinite(amt) || amt <= 0 || bps <= 0) return null
  const fee = (amt * bps) / 10000
  return fee.toFixed(6)
}