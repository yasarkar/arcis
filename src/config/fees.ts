// Centralized Arcis Protocol Fee, Treasury, and Speed Tiers Architecture (100% English)
// Single source of truth for:
// - Multi-Chain Treasury Addresses (EVM, Solana, Injective)
// - Transaction Speed & Priority Tiers (Standard / Fast / Turbo)
// - Arc L1 Native USDC Gas Calculations & Dynamic Options
// - Module Protocol Fee Rates (Send, Swap, Bridge) & Circle AppKit Revenue Sharing
import { parseGwei } from 'viem'
// ─────────────────────────────────────────────────────────────
// 1. MULTI-CHAIN TREASURY ADDRESSES & RESOLUTION
// ─────────────────────────────────────────────────────────────

//Circle AppKit rule: custom fee recipient MUST be on the source blockchain where the fee is debited.
export const TREASURY_ADDRESSES = {
  evm: (import.meta.env.VITE_EVM_TREASURY_ADDRESS as `0x${string}`),
  solana: ((import.meta.env.VITE_SOLANA_TREASURY_ADDRESS) as string),
  injective: ((import.meta.env.VITE_INJECTIVE_TREASURY_ADDRESS) as string),
} as const

// Backwards-compatible default (EVM)
export const TREASURY_ADDRESS = TREASURY_ADDRESSES.evm

export const TREASURY_EXPLORER_URL = `https://testnet.arcscan.app/address/${TREASURY_ADDRESS}`

/**
 * Resolves the appropriate treasury recipient address based on the source blockchain.
 */
export function getTreasuryRecipientAddress(chainKeyOrName?: string): string {
  if (!chainKeyOrName) return TREASURY_ADDRESSES.evm

  const chainLower = chainKeyOrName.toLowerCase()

  if (chainLower.includes('solana')) {
    return TREASURY_ADDRESSES.solana
  }

  if (chainLower.includes('injective')) {
    return TREASURY_ADDRESSES.injective
  }

  return TREASURY_ADDRESSES.evm
}

/**
 * Resolves the swap custom fee recipient address.
 * Chain-specific resolution strictly following Circle AppKit rule:
 * Recipient MUST be on the source blockchain where the fee is debited.
 */
export function getSwapFeeRecipient(chainKeyOrName?: string): string {
  const chainLower = (chainKeyOrName || '').toLowerCase()

  // 1. Solana Source Chain -> Must be a valid Solana address
  if (chainLower.includes('solana')) {
    return TREASURY_ADDRESSES.solana || ''
  }

  // 2. Injective Source Chain -> Must be a valid Injective Cosmos address
  if (chainLower.includes('injective')) {
    return TREASURY_ADDRESSES.injective || ''
  }

  // 3. EVM Source Chain (Arc Testnet, Base, Ethereum, etc.)
  const { enabled, recipientAddress } = SWAP_CUSTOM_FEE_CONFIG
  if (enabled && recipientAddress && isLikelyAddress(recipientAddress)) {
    return recipientAddress
  }
  return TREASURY_ADDRESSES.evm
}

/**
 * Resolves the bridge custom fee recipient address.
 * Chain-specific resolution strictly following Circle AppKit rule:
 * Recipient MUST be on the source blockchain where the fee is debited.
 */
export function getBridgeFeeRecipient(chainKeyOrName?: string): string {
  const chainLower = (chainKeyOrName || '').toLowerCase()

  // 1. Solana Source Chain -> Must be a valid Solana address
  if (chainLower.includes('solana')) {
    return TREASURY_ADDRESSES.solana || ''
  }

  // 2. Injective Source Chain -> Must be a valid Injective Cosmos address
  if (chainLower.includes('injective')) {
    return TREASURY_ADDRESSES.injective || ''
  }

  // 3. EVM Source Chain (Arc Testnet, Base, Ethereum, etc.)
  const { enabled, recipientAddress } = BRIDGE_CUSTOM_FEE_CONFIG
  if (enabled && recipientAddress && isLikelyAddress(recipientAddress)) {
    return recipientAddress
  }
  return TREASURY_ADDRESSES.evm
}

/**
 * Returns the block explorer URL for the treasury address on a given chain.
 */
export function getTreasuryExplorerUrl(chainKey: string = 'Arc_Testnet'): string {
  const chainLower = chainKey.toLowerCase()
  if (chainLower.includes('solana')) {
    return `https://explorer.solana.com/address/${TREASURY_ADDRESSES.solana}?cluster=devnet`
  }
  if (chainLower.includes('injective')) {
    return `https://testnet.explorer.injective.network/account/${TREASURY_ADDRESSES.injective}`
  }
  if (chainLower.includes('arc')) {
    return `https://testnet.arcscan.app/address/${TREASURY_ADDRESSES.evm}`
  }
  if (chainLower.includes('base')) {
    return `https://sepolia.basescan.org/address/${TREASURY_ADDRESSES.evm}`
  }
  if (chainLower.includes('eth') || chainLower.includes('sepolia')) {
    return `https://sepolia.etherscan.io/address/${TREASURY_ADDRESSES.evm}`
  }
  return `https://testnet.arcscan.app/address/${TREASURY_ADDRESSES.evm}`
}

/**
 * Formats a treasury address for clean UI display (e.g. 0x5f8f...2e70)
 */
export function formatTreasuryAddress(address: string = TREASURY_ADDRESS): string {
  if (!address || address.length < 10) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

/**
 * Multi-chain address format validator supporting EVM, Solana, and Injective formats.
 */
export function isValidChainAddress(address: string, chainKeyOrName?: string): boolean {
  if (!address || typeof address !== 'string') return false
  const trimmed = address.trim()
  const chainLower = (chainKeyOrName || '').toLowerCase()

  if (chainLower.includes('solana')) {
    return !trimmed.startsWith('0x') && trimmed.length >= 32 && trimmed.length <= 44
  }
  if (chainLower.includes('injective')) {
    return trimmed.startsWith('inj1') && trimmed.length >= 38
  }
  return /^0x[a-fA-F0-9]{40}$/.test(trimmed)
}

export interface ChainTreasuryInfo {
  id: 'evm' | 'solana' | 'injective'
  chainKey: string
  chainName: string
  networkType: 'EVM' | 'SVM (Solana)' | 'Cosmos (Injective)'
  address: string
  explorerUrl: string
  role: string
  activeChannels: string[]
}

/**
 * Returns structured metadata for all 3 active Arcis multi-chain treasuries.
 */
export function getAllTreasuryDetails(): ChainTreasuryInfo[] {
  return [
    {
      id: 'evm',
      chainKey: 'Arc_Testnet',
      chainName: 'Arc Testnet / EVM Ecosystem',
      networkType: 'EVM',
      address: TREASURY_ADDRESSES.evm,
      explorerUrl: getTreasuryExplorerUrl('Arc_Testnet'),
      role: 'Primary Protocol Treasury, Gasless Sponsor Relayer & EVM Fee Vault',
      activeChannels: ['Arc L1 Native DEX', 'EVM CCTP Bridges', 'Gasless Relayer Sponsor'],
    },
    {
      id: 'solana',
      chainKey: 'Solana_Devnet',
      chainName: 'Solana Devnet / Mainnet',
      networkType: 'SVM (Solana)',
      address: TREASURY_ADDRESSES.solana,
      explorerUrl: getTreasuryExplorerUrl('solana'),
      role: 'Solana Ecosystem Source Bridge & Cross-Chain Swap Fee Vault',
      activeChannels: ['Solana CCTP V2 Bridge', 'Solana AppKit Custom Fees'],
    },
    {
      id: 'injective',
      chainKey: 'Injective_Testnet',
      chainName: 'Injective Testnet',
      networkType: 'Cosmos (Injective)',
      address: TREASURY_ADDRESSES.injective,
      explorerUrl: getTreasuryExplorerUrl('injective'),
      role: 'Injective Ecosystem Source Bridge & Fee Collection Vault',
      activeChannels: ['Injective CCTP Bridge', 'IBC Cross-Chain Fee Routing'],
    },
  ]
}

// Revenue sharing model according to Circle AppKit & Arc documentation
export const REVENUE_SHARE_LABEL = '90% Dev / 10% Arc'
export const REVENUE_SHARE_TOOLTIP =
  'Circle AppKit Revenue Sharing: 90% of the protocol fee goes to the Arcis Treasury and 10% supports the Arc Network ecosystem.'

// ─────────────────────────────────────────────────────────────
// 2. WALLET SPEED & FEE TIERS (Standard / Fast / Turbo)
// ─────────────────────────────────────────────────────────────

export type SpeedTier = 'standard' | 'fast' | 'turbo'

export interface SpeedTierConfig {
  id: SpeedTier
  label: string
  shortLabel: string
  iconName: 'car' | 'zap' | 'rocket'
  badge?: string
  timeEstimate: {
    arcL1: string
    cctpBridge: string
    gateway: string
    swap: string
  }
  arcGas: {
    maxFeePerGasGwei: number
    maxPriorityFeePerGasGwei: number
    maxFeePerGas: bigint
    maxPriorityFeePerGas: bigint
    estimatedCostUsdc: string
  }
  bridge: {
    transferSpeed: 'SLOW' | 'FAST'
    mode: 'direct' | 'gateway'
    description: string
  }
}

/**
 * Arc L1 Gas Parameters:
 * - Gas unit: Native USDC (18 decimals in EVM execution, 6 decimals in ERC-20 interface)
 * - Base fee floor: 20 Gwei (Testnet protocol minimum)
 * - Standard transfer gas limit: ~21,000 gas
 * - ERC-20 / Memo transfer gas limit: ~50,000 - 80,000 gas
 */
export const SPEED_TIERS: Record<SpeedTier, SpeedTierConfig> = {
  standard: {
    id: 'standard',
    label: 'Standard',
    shortLabel: 'Eco',
    iconName: 'car',
    timeEstimate: {
      arcL1: '1-2 sec',
      cctpBridge: '1-2 min',
      gateway: '< 500 ms',
      swap: '~ 2 sec',
    },
    arcGas: {
      maxFeePerGasGwei: 20,
      maxPriorityFeePerGasGwei: 0,
      maxFeePerGas: parseGwei('20'),
      maxPriorityFeePerGas: parseGwei('0'),
      estimatedCostUsdc: '0.00042',
    },
    bridge: {
      transferSpeed: 'SLOW',
      mode: 'direct',
      description: 'Standard block confirmations (0 CCTP protocol fee)',
    },
  },
  fast: {
    id: 'fast',
    label: 'Fast',
    shortLabel: 'Fast',
    iconName: 'zap',
    badge: 'Recommended',
    timeEstimate: {
      arcL1: '< 1 sec',
      cctpBridge: '15-30 sec',
      gateway: '< 500 ms',
      swap: '< 1 sec',
    },
    arcGas: {
      maxFeePerGasGwei: 25,
      maxPriorityFeePerGasGwei: 2,
      maxFeePerGas: parseGwei('25'),
      maxPriorityFeePerGas: parseGwei('2'),
      estimatedCostUsdc: '0.00053',
    },
    bridge: {
      transferSpeed: 'FAST',
      mode: 'direct',
      description: 'CCTP Fast Attestation (15-30s soft finality)',
    },
  },
  turbo: {
    id: 'turbo',
    label: 'Turbo',
    shortLabel: 'Instant',
    iconName: 'rocket',
    badge: 'Ultra Fast',
    timeEstimate: {
      arcL1: 'Sub-second',
      cctpBridge: '< 500 ms',
      gateway: '< 500 ms',
      swap: 'Instant',
    },
    arcGas: {
      maxFeePerGasGwei: 50,
      maxPriorityFeePerGasGwei: 5,
      maxFeePerGas: parseGwei('50'),
      maxPriorityFeePerGas: parseGwei('5'),
      estimatedCostUsdc: '0.00105',
    },
    bridge: {
      transferSpeed: 'FAST',
      mode: 'gateway',
      description: 'Circle Gateway instant liquidity (<500ms finality, 0.005% fee)',
    },
  },
}

/**
 * Calculates estimated Arc L1 gas cost in USDC for a given gas limit and speed tier.
 * Formula: gasLimit * (baseFee + priorityFee) in Gwei * 10^-9
 */
export function calculateArcGasCostUsdc(
  gasLimit: number | bigint = 21000n,
  tier: SpeedTier = 'fast'
): string {
  const tierConfig = SPEED_TIERS[tier]
  const gas = BigInt(gasLimit)
  const totalGwei = BigInt(tierConfig.arcGas.maxFeePerGasGwei)

  // 1 Gwei = 10^-9 USDC. With 21,000 gas @ 25 Gwei:
  // 21000 * 25 = 525,000 Gwei = 0.000525 USDC
  const totalGweiSpent = Number(gas * totalGwei)
  const usdcCost = totalGweiSpent / 1_000_000_000

  return usdcCost < 0.00001 ? '0.00001' : usdcCost.toFixed(5)
}

/**
 * Returns static Viem transaction options (maxFeePerGas & maxPriorityFeePerGas) for a tier.
 */
export function getViemGasOptions(tier: SpeedTier = 'fast') {
  const config = SPEED_TIERS[tier]
  return {
    maxFeePerGas: config.arcGas.maxFeePerGas,
    maxPriorityFeePerGas: config.arcGas.maxPriorityFeePerGas,
  }
}

// ─────────────────────────────────────────────────────────────
// 3. PROTOCOL FEE RATES & CALCULATION HELPERS
// ─────────────────────────────────────────────────────────────

export interface ModuleProtocolFeeConfig {
  send: Record<SpeedTier, { valueUsdc: number; label: string; description: string }>
  swap: Record<SpeedTier, { bps: number; label: string; description: string }>
  bridge: Record<SpeedTier, { bps: number; valueUsdc?: number; label: string; description: string }>
}

export const PROTOCOL_FEE_RATES: ModuleProtocolFeeConfig = {
  send: {
    standard: {
      valueUsdc: 0.0,
      label: 'Free Platform Fee',
      description: 'Standard 20 Gwei Base Fee',
    },
    fast: {
      valueUsdc: 0.0,
      label: 'Free Platform Fee',
      description: 'Recommended 25 Gwei Priority',
    },
    turbo: {
      valueUsdc: 0.0,
      label: 'Free Platform Fee',
      description: 'Turbo 50 Gwei Priority',
    },
  },
  swap: {
    standard: {
      bps: 5, // 0.05%
      label: '0.05% Protocol Fee',
      description: 'Standard liquidity routing',
    },
    fast: {
      bps: 10, // 0.10%
      label: '0.10% Protocol Fee',
      description: 'Fast execution & slippage-optimized routing',
    },
    turbo: {
      bps: 20, // 0.20%
      label: '0.20% Protocol Fee',
      description: 'MEV-protected ultra-fast execution',
    },
  },
  bridge: {
    standard: {
      bps: 5, // 0.05%
      valueUsdc: 0.05,
      label: '0.05% Platform Fee',
      description: 'Eco CCTP bridge (Standard block confirmations)',
    },
    fast: {
      bps: 10, // 0.10%
      valueUsdc: 0.1,
      label: '0.10% Platform Fee',
      description: 'CCTP Fast Forwarding service acceleration',
    },
    turbo: {
      bps: 25, // 0.25%
      valueUsdc: 0.25,
      label: '0.25% Platform Fee',
      description: 'Gateway instant pool (<500ms transfer)',
    },
  },
}

// ── Send Helpers ─────────────────────────────────────────────
export function getSendProtocolFee(tier: SpeedTier): number {
  return PROTOCOL_FEE_RATES.send[tier]?.valueUsdc ?? 0.0
}

// ── Swap Helpers ─────────────────────────────────────────────
export function getSwapProtocolFeeBps(tier: SpeedTier): number {
  return PROTOCOL_FEE_RATES.swap[tier]?.bps ?? 10
}

export function getSwapProtocolFeePercent(tier: SpeedTier): string {
  const bps = getSwapProtocolFeeBps(tier)
  return `${(bps / 100).toFixed(2)}%`
}

export function calculateSwapProtocolFeeAmount(tier: SpeedTier, amountIn: string): string | null {
  const amt = parseFloat(amountIn)
  const bps = getSwapProtocolFeeBps(tier)
  if (!Number.isFinite(amt) || amt <= 0 || bps <= 0) return null
  const fee = (amt * bps) / 10000
  return fee.toFixed(6)
}

// ── Bridge Helpers ───────────────────────────────────────────
export function getBridgeProtocolFeeBps(tier: SpeedTier): number {
  return PROTOCOL_FEE_RATES.bridge[tier]?.bps ?? 10
}

export function getBridgeProtocolFee(tier: SpeedTier): number {
  return PROTOCOL_FEE_RATES.bridge[tier]?.valueUsdc ?? 0.1
}

export function getBridgeProtocolFeePercent(tier: SpeedTier): string {
  const bps = getBridgeProtocolFeeBps(tier)
  return `${(bps / 100).toFixed(2)}%`
}

export function calculateBridgeProtocolFeeAmount(tier: SpeedTier, amountIn: string): number {
  const amt = parseFloat(amountIn)
  const bps = getBridgeProtocolFeeBps(tier)
  if (!Number.isFinite(amt) || amt <= 0 || bps <= 0) return 0
  return (amt * bps) / 10000
}

// ─────────────────────────────────────────────────────────────
// 4. ENVIRONMENT-DRIVEN CUSTOM FEE OVERRIDES (Safe Fallbacks)
// ─────────────────────────────────────────────────────────────

export interface BridgeCustomFeeConfig {
  enabled: boolean
  value: string
  recipientAddress: string
}

export interface SwapCustomFeeConfig {
  enabled: boolean
  percentageBps: number
  recipientAddress: string
}

function isLikelyAddress(value: string | undefined): boolean {
  return !!value && /^0x[a-fA-F0-9]{40}$/.test(value)
}

function loadBridgeFeeConfig(): BridgeCustomFeeConfig {
  const envEnabled = import.meta.env.VITE_BRIDGE_FEE_ENABLED as string | undefined
  const envValue = import.meta.env.VITE_BRIDGE_FEE_VALUE as string | undefined
  const envRecipient = import.meta.env.VITE_BRIDGE_FEE_RECIPIENT as string | undefined

  const value = envValue && parseFloat(envValue) > 0 ? envValue : '0.10'
  const recipient = isLikelyAddress(envRecipient) ? envRecipient! : (TREASURY_ADDRESSES.evm || '')
  const hasValidTreasury = !!recipient || !!TREASURY_ADDRESSES.solana || !!TREASURY_ADDRESSES.injective
  const enabled = envEnabled === 'true' && hasValidTreasury

  return { enabled, value, recipientAddress: recipient }
}

function loadSwapFeeConfig(): SwapCustomFeeConfig {
  const envEnabled = import.meta.env.VITE_SWAP_FEE_ENABLED as string | undefined
  const envBps = Number(import.meta.env.VITE_SWAP_FEE_BPS)
  const envRecipient = import.meta.env.VITE_SWAP_FEE_RECIPIENT as string | undefined

  const bps = Number.isFinite(envBps) && envBps >= 0 ? Math.round(envBps) : 25
  const recipient = isLikelyAddress(envRecipient) ? envRecipient! : (TREASURY_ADDRESSES.evm || '')
  const hasValidTreasury = !!recipient || !!TREASURY_ADDRESSES.solana || !!TREASURY_ADDRESSES.injective
  const enabled = envEnabled === 'true' && hasValidTreasury

  return { enabled, percentageBps: bps, recipientAddress: recipient }
}

export const BRIDGE_CUSTOM_FEE_CONFIG: BridgeCustomFeeConfig = loadBridgeFeeConfig()
export const SWAP_CUSTOM_FEE_CONFIG: SwapCustomFeeConfig = loadSwapFeeConfig()

export function getSwapFeePercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`
}

export function calculateSwapFeeAmount(bps: number, amountIn: string): string | null {
  const amt = parseFloat(amountIn)
  if (!Number.isFinite(amt) || amt <= 0 || bps <= 0) return null
  const fee = (amt * bps) / 10000
  return fee.toFixed(6)
}

// ─────────────────────────────────────────────────────────────
// 5. RE-EXPORT DYNAMIC ARC GAS SERVICE HELPERS
// ─────────────────────────────────────────────────────────────
export {
  ARC_MIN_BASE_FEE_FLOOR,
  ARC_MAX_BASE_FEE_CEILING,
  ARC_GAS_LIMITS,
  extractBaseFeeFromHeaderExtraData,
  getDynamicArcGasOptions,
  calculateArcGasCostFromFee,
  type DynamicArcGasResult,
} from '../services/arcGasService'
