// Centralized Arcis Protocol Fee, Treasury, and Speed Tiers Architecture (100% English)
// Single source of truth for:
// - Multi-Chain Treasury Addresses (EVM, Solana, Injective)
// - Transaction Speed & Priority Tiers (Standard / Fast / Turbo)
// - Arc L1 Native USDC Gas Calculations & Dynamic Options
// - Module Protocol Fee Rates (Send, Swap, Bridge) & Circle AppKit Revenue Sharing
import { parseGwei } from 'viem'

// ─────────────────────────────────────────────────────────────
// 0. ENVIRONMENT ACCESS
// `import.meta.env` is inlined by Vite in the browser bundle, but the API server loads these
// same modules through tsx (`npm run start`), where it is undefined. Read process.env first and
// guard the Vite access, the same way src/config/networks/networkRegistry.ts does.
// ─────────────────────────────────────────────────────────────
const ENV_EVM_TREASURY = (typeof process !== 'undefined' && process.env && process.env.VITE_EVM_TREASURY_ADDRESS) || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_EVM_TREASURY_ADDRESS)
const ENV_SOLANA_TREASURY = (typeof process !== 'undefined' && process.env && process.env.VITE_SOLANA_TREASURY_ADDRESS) || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SOLANA_TREASURY_ADDRESS)
const ENV_INJECTIVE_TREASURY = (typeof process !== 'undefined' && process.env && process.env.VITE_INJECTIVE_TREASURY_ADDRESS) || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_INJECTIVE_TREASURY_ADDRESS)
const ENV_BRIDGE_FEE_ENABLED = (typeof process !== 'undefined' && process.env && process.env.VITE_BRIDGE_FEE_ENABLED) || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BRIDGE_FEE_ENABLED)
const ENV_BRIDGE_FEE_VALUE = (typeof process !== 'undefined' && process.env && process.env.VITE_BRIDGE_FEE_VALUE) || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BRIDGE_FEE_VALUE)
const ENV_BRIDGE_FEE_VALUE_STANDARD = (typeof process !== 'undefined' && process.env && process.env.VITE_BRIDGE_FEE_VALUE_STANDARD) || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BRIDGE_FEE_VALUE_STANDARD)
const ENV_BRIDGE_FEE_VALUE_FAST = (typeof process !== 'undefined' && process.env && process.env.VITE_BRIDGE_FEE_VALUE_FAST) || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BRIDGE_FEE_VALUE_FAST)
const ENV_BRIDGE_FEE_VALUE_TURBO = (typeof process !== 'undefined' && process.env && process.env.VITE_BRIDGE_FEE_VALUE_TURBO) || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BRIDGE_FEE_VALUE_TURBO)
const ENV_BRIDGE_FEE_RECIPIENT = (typeof process !== 'undefined' && process.env && process.env.VITE_BRIDGE_FEE_RECIPIENT) || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BRIDGE_FEE_RECIPIENT)
const ENV_SWAP_FEE_ENABLED = (typeof process !== 'undefined' && process.env && process.env.VITE_SWAP_FEE_ENABLED) || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SWAP_FEE_ENABLED)
const ENV_SWAP_FEE_BPS = (typeof process !== 'undefined' && process.env && process.env.VITE_SWAP_FEE_BPS) || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SWAP_FEE_BPS)
const ENV_SWAP_FEE_RECIPIENT = (typeof process !== 'undefined' && process.env && process.env.VITE_SWAP_FEE_RECIPIENT) || (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SWAP_FEE_RECIPIENT)

// ─────────────────────────────────────────────────────────────
// 1. MULTI-CHAIN TREASURY ADDRESSES & RESOLUTION
// ─────────────────────────────────────────────────────────────

//Circle AppKit rule: custom fee recipient MUST be on the source blockchain where the fee is debited.
export const TREASURY_ADDRESSES = {
  evm: (ENV_EVM_TREASURY as `0x${string}`),
  solana: (ENV_SOLANA_TREASURY as string),
  injective: (ENV_INJECTIVE_TREASURY as string),
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

import {
  type SpeedTier,
  type SpeedTierConfig,
  SPEED_TIERS,
} from './gasTierConstants'

export {
  type SpeedTier,
  type SpeedTierConfig,
  SPEED_TIERS,
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
// NOTE on `bridge`: PROTOCOL_FEE_RATES.bridge below is a PUBLISHED rate
// schedule only — the Bridge tab does not charge it. The platform-fee ladder in
// BRIDGE_CUSTOM_FEE_CONFIG (flat value + per-speed overrides) is the single
// source of truth for what is actually charged (see isBridgePlatformFeeCharged /
// getBridgePlatformFeeValue / getBridgePlatformFeeDisplay).
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
  /** Flat fallback fee (USDC); any tier without its own env value uses this. */
  value: string
  /** Per-speed platform-fee ladder (USDC): standard / fast / turbo. */
  values: Record<SpeedTier, string>
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
  const envEnabled = ENV_BRIDGE_FEE_ENABLED as string | undefined
  const envValue = ENV_BRIDGE_FEE_VALUE as string | undefined
  const envRecipient = ENV_BRIDGE_FEE_RECIPIENT as string | undefined

  const value = envValue && parseFloat(envValue) > 0 ? envValue : '0.10'
  const recipient = isLikelyAddress(envRecipient) ? envRecipient! : (TREASURY_ADDRESSES.evm || '')
  const hasValidTreasury = !!recipient || !!TREASURY_ADDRESSES.solana || !!TREASURY_ADDRESSES.injective
  const enabled = envEnabled === 'true' && hasValidTreasury

  // Speed ladder: each tier may override the flat fee through its own env var;
  // a missing or invalid entry falls back to `value`, so single-value
  // deployments keep their old behavior.
  const tierValue = (raw: string | undefined): string => {
    if (raw === undefined || raw === '') return value
    const parsed = parseFloat(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? raw : value
  }
  const values: Record<SpeedTier, string> = {
    standard: tierValue(ENV_BRIDGE_FEE_VALUE_STANDARD),
    fast: tierValue(ENV_BRIDGE_FEE_VALUE_FAST),
    turbo: tierValue(ENV_BRIDGE_FEE_VALUE_TURBO),
  }

  return { enabled, value, values, recipientAddress: recipient }
}

function loadSwapFeeConfig(): SwapCustomFeeConfig {
  const envEnabled = ENV_SWAP_FEE_ENABLED as string | undefined
  const envBps = Number(ENV_SWAP_FEE_BPS)
  const envRecipient = ENV_SWAP_FEE_RECIPIENT as string | undefined

  const bps = Number.isFinite(envBps) && envBps >= 0 ? Math.round(envBps) : 25
  const recipient = isLikelyAddress(envRecipient) ? envRecipient! : (TREASURY_ADDRESSES.evm || '')
  const hasValidTreasury = !!recipient || !!TREASURY_ADDRESSES.solana || !!TREASURY_ADDRESSES.injective
  const enabled = envEnabled === 'true' && hasValidTreasury

  return { enabled, percentageBps: bps, recipientAddress: recipient }
}

export const BRIDGE_CUSTOM_FEE_CONFIG: BridgeCustomFeeConfig = loadBridgeFeeConfig()
export const SWAP_CUSTOM_FEE_CONFIG: SwapCustomFeeConfig = loadSwapFeeConfig()

/**
 * Single source of truth for whether the Bridge tab charges its platform fee on
 * a given execution path.
 *
 * The fee is collected through Circle App Kit's `customFee` on the Direct CCTP
 * path only: the UCW path has no custom-fee parameter and the Gateway paths
 * charge their own protocol fee. Every surface that displays or enforces the
 * fee (balance gate, transaction breakdown, settings) must ask this one
 * function — otherwise the UI demands a fee that is never charged.
 */
export function isBridgePlatformFeeCharged(params: {
  bridgeMode: 'direct' | 'gateway'
  authSource?: 'passkey' | 'ucw' | 'evm' | null
}): boolean {
  if (params.bridgeMode !== 'direct') return false
  if (params.authSource === 'ucw') return false
  if (!BRIDGE_CUSTOM_FEE_CONFIG.enabled) return false
  // Any positive value in the ladder (flat fallback or per-speed override).
  return (
    parseFloat(BRIDGE_CUSTOM_FEE_CONFIG.value) > 0 ||
    Object.values(BRIDGE_CUSTOM_FEE_CONFIG.values).some((v) => parseFloat(v) > 0)
  )
}

/**
 * Platform fee (USDC) actually collected for one speed tier on Direct CCTP.
 * This is the single number every charge surface must use — requiredDebit, the
 * MAX reserve, the App Kit `customFee`, the breakdown and the receipt — so the
 * ladder can never disagree with what is really debited.
 */
export function getBridgePlatformFeeValue(tier: SpeedTier): number {
  if (!BRIDGE_CUSTOM_FEE_CONFIG.enabled) return 0
  const raw = BRIDGE_CUSTOM_FEE_CONFIG.values[tier] ?? BRIDGE_CUSTOM_FEE_CONFIG.value
  const parsed = parseFloat(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

/**
 * Human-readable platform-fee line for one speed tier in the Bridge settings
 * panel. It reads the same BRIDGE_CUSTOM_FEE_CONFIG the execution path charges,
 * so the settings panel, the breakdown and the real charge can never disagree.
 */
export function getBridgePlatformFeeDisplay(tier: SpeedTier = 'fast'): { amount: string; description: string } {
  // Every rung — including Turbo, the fastest Direct CCTP tier — is charged on
  // the Direct route through App Kit's customFee, so the row always quotes the
  // configured value. The Gateway route itself never collects a platform fee;
  // the description discloses that, matching what isBridgePlatformFeeCharged enforces.
  const value = getBridgePlatformFeeValue(tier)
  const label = tier === 'standard' ? 'Standard' : tier === 'fast' ? 'Fast' : 'Turbo'
  return value > 0
    ? {
        amount: `${value.toFixed(2)} USDC`,
        description: `Direct CCTP platform fee · ${label} speed (UCW & Gateway routes are free)`,
      }
    : { amount: 'Free', description: 'No platform fee on this bridge route' }
}

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
  calculateStaticTierGasCostUsdc,
  arcTransferGasLimit,
  arcTransferFeeFallbackUsdc,
  resolveArcActualFeeUsdc,
  getObservedArcPriorityFee,
  type ArcActualFeeResult,
  type DynamicArcGasResult,
} from '../services/arcGasService'
