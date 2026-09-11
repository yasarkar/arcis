// src/config/constants.ts
// Arcis Protocol Centralized System Constraints, Limits & Constants (100% English)
// Single source of truth for protocol floor/ceiling, transaction limits, slippage,
// RPC resilience thresholds, token precision, and persistent storage keys.

import { parseGwei } from 'viem'

// ─────────────────────────────────────────────────────────────
// 1. ARC L1 GAS & PROTOCOL BASE FEE CONSTRAINTS
// ─────────────────────────────────────────────────────────────

export const GAS_CONSTRAINTS = {
  /** Arc Testnet protocol floor: minimum allowed base fee (20 Gwei = $0.000000020 USDC/gas) */
  MIN_BASE_FEE_FLOOR_GWEI: 20,
  MIN_BASE_FEE_FLOOR: parseGwei('20'),

  /** Worst-case base fee ceiling under peak congestion (20,000 Gwei) */
  MAX_BASE_FEE_CEILING_GWEI: 20_000,
  MAX_BASE_FEE_CEILING: parseGwei('20000'),

  /** Standard gas consumption limits on Arc L1 */
  LIMITS: {
    NATIVE_TRANSFER: 21_000n,
    ERC20_TRANSFER: 65_000n,
    MEMO_TRANSFER: 75_000n,
    CONTRACT_CALL: 120_000n,
    SWAP_ESTIMATE: 250_000n,
  },
} as const

// ─────────────────────────────────────────────────────────────
// 2. DEFI & SLIPPAGE TOLERANCE CONSTRAINTS
// ─────────────────────────────────────────────────────────────

export const SLIPPAGE_CONSTRAINTS = {
  /** Default slippage tolerance for DEX swaps (0.50% / 50 BPS) */
  DEFAULT_PERCENT: 0.5,
  DEFAULT_BPS: 50,

  /** Default slippage tolerance for AI Copilot automated executions (0.10% / 10 BPS) */
  DEFAULT_COPILOT_PERCENT: 0.1,
  DEFAULT_COPILOT_BPS: 10,

  /** Minimum selectable slippage (0.01% / 1 BPS) */
  MIN_PERCENT: 0.01,
  MIN_BPS: 1,

  /** Maximum recommended slippage before warning user (5.00% / 500 BPS) */
  MAX_PERCENT: 5.0,
  MAX_BPS: 500,

  /** Threshold above which the UI displays a high price-impact alert */
  HIGH_WARNING_THRESHOLD_PERCENT: 1.0,
} as const

// ─────────────────────────────────────────────────────────────
// 3. CROSS-CHAIN BRIDGE & TRANSFER CONSTRAINTS
// ─────────────────────────────────────────────────────────────

export const BRIDGE_CONSTRAINTS = {
  /** Minimum transfer amount for direct CCTP bridge (0.10 USDC) to clear relayer forwarding fee */
  MIN_DIRECT_BRIDGE_AMOUNT_USDC: 0.1,

  /** Approximate CCTP forwarder acceleration fee on testnet (0.055 USDC) */
  CCTP_RELAYER_FORWARDING_FEE_USDC: 0.055,

  /** Minimum token transfer granularity on Arc L1 (1 micro-USDC = 0.000001) */
  MIN_TRANSFER_AMOUNT_USDC: 0.000001,

  /** Maximum allowed recipient address string length */
  MAX_RECIPIENT_ADDRESS_LENGTH: 64,
} as const

// ─────────────────────────────────────────────────────────────
// 4. RPC & NETWORK RESILIENCE CONSTRAINTS
// ─────────────────────────────────────────────────────────────

export const RPC_CONSTRAINTS = {
  /** Default RPC request timeout (15 seconds) */
  TIMEOUT_DEFAULT_MS: 15_000,

  /** Fast-path read timeout for non-critical telemetry (8 seconds) */
  TIMEOUT_FAST_READ_MS: 8_000,

  /** Transaction receipt polling timeout (60 seconds) */
  TIMEOUT_RECEIPT_MS: 60_000,

  /** Maximum automatic RPC failover attempts before throwing error */
  MAX_RETRIES: 3,

  /** Exponential backoff base delay between retries (1 second) */
  RETRY_DELAY_MS: 1_000,
} as const

// ─────────────────────────────────────────────────────────────
// 5. TOKEN PRECISION & DECIMALS
// ─────────────────────────────────────────────────────────────

export const TOKEN_DECIMALS = {
  USDC: 6,
  EURC: 6,
  cirBTC: 8,
  ARC_NATIVE: 18,
  EVM_NATIVE: 18,
  SOLANA_NATIVE: 9,
} as const

// ─────────────────────────────────────────────────────────────
// 6. PERSISTENT STORAGE KEYS (LocalStorage Namespace)
// ─────────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  TX_HISTORY: 'arc_unified_history',
  LEGACY_BRIDGE_HISTORY: 'cctp_bridge_history',
  COPILOT_SFX: 'arcis_copilot_sfx_enabled',
  OPENAI_API_KEY: 'arcis_openai_api_key',
  PRIVACY_SETTINGS: 'arcis_privacy_settings',
  SESSION_BUDGET: 'arcis_session_budget',
  SESSION_KEYS: 'arcis_session_keys',

  // Wallet Specifics
  SOLANA_ADDRESS: 'arcis_solana_address',
  SOLANA_PROVIDER: 'arcis_solana_provider',
  INJECTIVE_ADDRESS: 'arcis_injective_address',
  INJECTIVE_PROVIDER: 'arcis_injective_provider',
  PASSKEY_CREDENTIAL: 'arcis_passkey_credential',
  PASSKEY_USERNAME: 'arcis_passkey_username',
  PASSKEY_MSCA_ADDRESS: 'arcis_passkey_msca_address',
  UCW_USER_TOKEN: 'arc_ucw_user_token',
  UCW_ADDRESS: 'arc_ucw_address',
  UCW_ENCRYPTION_KEY: 'arc_ucw_encryption_key',
  UCW_AUTH_METHOD: 'arc_ucw_auth_method',
  UCW_TOKEN_EXPIRES_AT: 'arc_ucw_token_expires_at',
} as const

// ─────────────────────────────────────────────────────────────
// 7. UI TIMING & PRESENTATION LIMITS
// ─────────────────────────────────────────────────────────────

export const UI_CONSTRAINTS = {
  /** Toast / Drawer notification auto-close delay (5 seconds) */
  NOTIFICATION_AUTO_CLOSE_MS: 5_000,

  /** Extended notification auto-close delay for warnings (8 seconds) */
  NOTIFICATION_EXTENDED_AUTO_CLOSE_MS: 8_000,

  /** Maximum recent transactions preserved in local history */
  MAX_TRANSACTION_HISTORY_ITEMS: 50,
} as const

// ─────────────────────────────────────────────────────────────
// 8. TOP-LEVEL CONVENIENCE EXPORTS (For backward-compatible direct imports)
// ─────────────────────────────────────────────────────────────

export const MIN_DIRECT_BRIDGE_AMOUNT = BRIDGE_CONSTRAINTS.MIN_DIRECT_BRIDGE_AMOUNT_USDC
export const DEFAULT_SLIPPAGE_BPS = SLIPPAGE_CONSTRAINTS.DEFAULT_BPS
export const DEFAULT_COPILOT_SLIPPAGE = SLIPPAGE_CONSTRAINTS.DEFAULT_COPILOT_PERCENT
export const RPC_DEFAULT_TIMEOUT_MS: number = RPC_CONSTRAINTS.TIMEOUT_DEFAULT_MS
export const RPC_FAST_READ_TIMEOUT_MS: number = RPC_CONSTRAINTS.TIMEOUT_FAST_READ_MS
export const RPC_RECEIPT_TIMEOUT_MS: number = RPC_CONSTRAINTS.TIMEOUT_RECEIPT_MS
export const RPC_DEFAULT_RETRIES: number = RPC_CONSTRAINTS.MAX_RETRIES
export const RPC_DEFAULT_RETRY_DELAY_MS: number = RPC_CONSTRAINTS.RETRY_DELAY_MS
