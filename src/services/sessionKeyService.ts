// Client-side session limits remain wallet-scoped metadata; no local key is authorized for signing.
import type { SessionKeyConfig, SessionActionType, SessionTimeRemaining, SessionScope } from '../types/sessionKey.js'
import { getStoredMscaAddress } from './modularWalletService.js'
import { sessionSpendSnapshot } from './sessionSpendLedger.js'
import { logger } from '../utils/logger.js'
import {
  generateEphemeralSessionAccount,
  getEphemeralSessionAccount,
  clearEphemeralSessionAccount,
  fetchEnclaveUsdcBalance,
  sweepEnclaveUsdc,
} from './sessionEnclaveService.js'

export {
  getEphemeralSessionAccount,
  generateEphemeralSessionAccount,
  clearEphemeralSessionAccount,
  fetchEnclaveUsdcBalance,
  sweepEnclaveUsdc,
}

/** Scoped logger: falling back to the 'default' session bucket must be visible. */
const log = logger.createScope('sessionKeyService')

const COPILOT_SESSION_STORAGE_PREFIX = 'arcis_session_meta_v3_'
const MARKETPLACE_SESSION_STORAGE_PREFIX = 'arcis_marketplace_session_v1_'
const LEGACY_STORAGE_KEY = 'arcis_autonomous_session_meta_v2'

export const COPILOT_SESSION_UPDATED_EVENT = 'arcis_copilot_session_updated'
export const MARKETPLACE_SESSION_UPDATED_EVENT = 'arcis_marketplace_session_updated'
export const SESSION_KEY_UPDATED_EVENT = 'arcis_session_key_updated'

export const DEFAULT_COPILOT_ACTIONS: SessionActionType[] = ['swap', 'deposit', 'bridge', 'send']
export const DEFAULT_MARKETPLACE_ACTIONS: SessionActionType[] = ['ai_service']

export const DEFAULT_SESSION_KEY_CONFIG = {
  durationHours: 24,
  maxSpendUsdc: 100.0,
  maxPerTxUsdc: 50.0,
  autoExecute: false,
  allowedActions: ['swap', 'deposit', 'bridge', 'send', 'ai_service'] as SessionActionType[],
}

// Normalized address of the currently active wallet in session context
let currentActiveWallet: string | null = null

/**
 * Normalizes any wallet address to lowercase trimmed string, or 'default'
 */
export function normalizeWalletAddress(addr?: string | null): string {
  if (!addr || typeof addr !== 'string') return 'default'
  const trimmed = addr.trim().toLowerCase()
  return trimmed || 'default'
}

/**
 * Sets the active wallet context for session key operations
 */
export function setActiveWalletForSession(walletAddress?: string | null): void {
  if (walletAddress && typeof walletAddress === 'string' && walletAddress.trim()) {
    currentActiveWallet = walletAddress.trim().toLowerCase()
  } else {
    currentActiveWallet = null
  }
}

/**
 * Resolves current active wallet address from state or local storage
 */
export function getActiveWalletForSession(): string | null {
  if (currentActiveWallet) return currentActiveWallet
  try {
    if (typeof window !== 'undefined') {
      const ucw = localStorage.getItem('arc_ucw_address')
      if (ucw && ucw.trim()) return ucw.trim().toLowerCase()
      const msca = getStoredMscaAddress()
      if (msca && msca.trim()) return msca.trim().toLowerCase()
    }
  } catch (err) {
    // Best-effort read: without storage this call simply cannot name the active wallet, and the
    // caller falls back to the 'default' session bucket instead of failing the operation.
    log.debug('Active session wallet could not be read from storage; using the default session bucket.', err)
  }
  return null
}

function resolveTargetWallet(walletAddress?: string | null): string {
  if (walletAddress && typeof walletAddress === 'string' && walletAddress.trim()) {
    return normalizeWalletAddress(walletAddress)
  }
  const active = getActiveWalletForSession()
  return active ? normalizeWalletAddress(active) : 'default'
}

function getStorageKeyForWallet(walletKey: string, scope: SessionScope = 'copilot'): string {
  return scope === 'marketplace'
    ? `${MARKETPLACE_SESSION_STORAGE_PREFIX}${walletKey}`
    : `${COPILOT_SESSION_STORAGE_PREFIX}${walletKey}`
}

function dispatchSessionUpdateEvent(config: SessionKeyConfig, scope: SessionScope = 'copilot'): void {
  if (typeof window !== 'undefined') {
    try {
      const sanitized = { ...config, scope, ephemeralPrivateKey: undefined }
      const specificEvent = scope === 'marketplace'
        ? MARKETPLACE_SESSION_UPDATED_EVENT
        : COPILOT_SESSION_UPDATED_EVENT

      window.dispatchEvent(
        new CustomEvent(specificEvent, {
          detail: sanitized,
        })
      )
      window.dispatchEvent(
        new CustomEvent(SESSION_KEY_UPDATED_EVENT, {
          detail: sanitized,
        })
      )
    } catch {
      // ignore
    }
  }
}

// Multi-tab cross-synchronization: when session or enclave storage changes in another tab,
// notify listeners in this tab so UI and accounts stay synchronized.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (!e.key) return
    if (
      e.key.startsWith(MARKETPLACE_SESSION_STORAGE_PREFIX) ||
      e.key.startsWith(COPILOT_SESSION_STORAGE_PREFIX)
    ) {
      const scope: SessionScope = e.key.startsWith(MARKETPLACE_SESSION_STORAGE_PREFIX) ? 'marketplace' : 'copilot'
      const active = getActiveWalletForSession()
      const conf = getSessionKeyConfig(active || undefined, scope)
      dispatchSessionUpdateEvent(conf, scope)
    }
  })
}

function createInitialSessionConfig(walletKey: string, scope: SessionScope = 'copilot'): SessionKeyConfig {
  const msca = getStoredMscaAddress()

  return {
    sessionId: '',
    sessionPublicKey: '',
    walletAddress: walletKey !== 'default' ? walletKey : undefined,
    mscaAddress: msca || undefined,
    delegationType: msca ? 'msca' : 'headless',
    expiresAt: 0,
    maxSpendUsdc: 0,
    spentUsdc: 0.0,
    maxPerTxUsdc: 0,
    allowedActions: [],
    isActive: false,
    autoExecute: false,
    createdAt: 0,
    scope,
  }
}

/**
 * Loads session key configuration scoped to the given or active wallet address and scope.
 * Never persists a phantom or unconfigured session to storage on read.
 */
export function getSessionKeyConfig(walletAddress?: string, scope: SessionScope = 'copilot'): SessionKeyConfig {
  const walletKey = resolveTargetWallet(walletAddress)
  const storageKey = getStorageKeyForWallet(walletKey, scope)

  try {
    let raw: string | null = null
    if (typeof localStorage !== 'undefined') {
      raw = localStorage.getItem(storageKey)
      
      // Migration fallback: check legacy v2 storage if not yet initialized
      if (!raw && scope === 'copilot') {
        const legacyV2Raw = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (legacyV2Raw) {
          raw = legacyV2Raw
        }
      }
    }

    const activeMsca = getStoredMscaAddress()

    if (raw) {
      const parsed: SessionKeyConfig = JSON.parse(raw)
      parsed.scope = scope
      
      // Ensure allowedActions is populated and appropriate for scope
      if (!parsed.allowedActions || !Array.isArray(parsed.allowedActions)) {
        parsed.allowedActions = scope === 'marketplace'
          ? [...DEFAULT_MARKETPLACE_ACTIONS]
          : [...DEFAULT_COPILOT_ACTIONS]
      } else if (scope === 'copilot') {
        const hasCopilotAction = parsed.allowedActions.some((a) =>
          ['swap', 'deposit', 'bridge', 'send'].includes(a)
        )
        if (!hasCopilotAction) {
          parsed.allowedActions = [...DEFAULT_COPILOT_ACTIONS]
        }
      }

      parsed.walletAddress = walletKey !== 'default' ? walletKey : parsed.walletAddress

      // Check expiration
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
        parsed.isActive = false
      }

      // Update MSCA linkage if changed
      if (activeMsca && parsed.mscaAddress !== activeMsca) {
        parsed.mscaAddress = activeMsca
        parsed.delegationType = 'msca'
      }

      // Never hydrate private key material into app state
      parsed.ephemeralPrivateKey = undefined

      if (scope === 'copilot') {
        const budget = sessionSpendSnapshot(walletKey, parsed)
        parsed.spentUsdc = budget.spentUsdc
        parsed.reservedUsdc = budget.reservedUsdc
      }
      return parsed
    }
  } catch (err) {
    console.error(`Failed to load session key config for wallet ${walletKey} (${scope}):`, err)
    const blocked = createInitialSessionConfig(walletKey, scope)
    blocked.reservedUsdc = Infinity // Corrupt/inaccessible accounting is not an empty wallet budget.
    return blocked
  }

  // Return empty unconfigured state without writing anything to localStorage
  return createInitialSessionConfig(walletKey, scope)
}

/**
 * Persists client-side session metadata without retaining local signing keys.
 * Only writes to localStorage when an active session with a valid budget exists;
 * otherwise cleans up storage to prevent phantom inactive sessions.
 */
export function saveSessionKeyConfig(
  config: SessionKeyConfig,
  notify: boolean = true,
  walletAddress?: string,
  scope?: SessionScope
): void {
  const targetScope: SessionScope = scope || config.scope || 'copilot'
  const walletKey = resolveTargetWallet(walletAddress || config.walletAddress)
  const storageKey = getStorageKeyForWallet(walletKey, targetScope)

  try {
    config.ephemeralPrivateKey = undefined
    config.scope = targetScope

    const { ephemeralPrivateKey, ...sanitizedMeta } = config
    if (walletKey !== 'default') {
      sanitizedMeta.walletAddress = walletKey
    }

    // Only persist if it's an active session with a non-zero budget and not expired
    if (typeof localStorage !== 'undefined') {
      if (sanitizedMeta.isActive && sanitizedMeta.maxSpendUsdc > 0 && Date.now() <= sanitizedMeta.expiresAt) {
        localStorage.setItem(storageKey, JSON.stringify(sanitizedMeta))
      } else {
        localStorage.removeItem(storageKey)
      }
    }
    
    if (notify) {
      dispatchSessionUpdateEvent({
        ...config,
        walletAddress: walletKey !== 'default' ? walletKey : config.walletAddress,
        scope: targetScope,
      }, targetScope)
    }
  } catch (err) {
    console.error(`Failed to save session key config for ${walletKey} (${targetScope}):`, err)
  }
}

/**
 * Activates or refreshes an autonomous session key with custom budget, duration, and allowed actions,
 * strictly scoped to the specified or active wallet address and scope.
 */
export async function activateSessionKey(params: {
  /** Explicit user consent for this session. Without it the session stays inactive. */
  userApproved: boolean
  maxSpendUsdc?: number
  durationHours?: number
  maxPerTxUsdc?: number
  autoExecute?: boolean
  allowedActions?: SessionActionType[]
  mscaAddress?: string
  walletAddress?: string
  enableEnclave?: boolean
  scope?: SessionScope
}): Promise<SessionKeyConfig> {
  const scope: SessionScope = params.scope || 'copilot'
  const walletKey = resolveTargetWallet(params.walletAddress)

  if (!params.userApproved) {
    clearEphemeralSessionAccount(walletKey, scope)
    const unapproved = createInitialSessionConfig(walletKey, scope)
    saveSessionKeyConfig(unapproved, true, walletKey, scope)
    return unapproved
  }

  const durationHours = params.durationHours || 24
  const maxSpendUsdc = params.maxSpendUsdc ?? DEFAULT_SESSION_KEY_CONFIG.maxSpendUsdc
  const maxPerTxUsdc = params.maxPerTxUsdc ?? Math.min(maxSpendUsdc, DEFAULT_SESSION_KEY_CONFIG.maxPerTxUsdc)
  const autoExecute = params.autoExecute ?? false
  const allowedActions = Array.isArray(params.allowedActions)
    ? params.allowedActions 
    : (scope === 'marketplace' ? [...DEFAULT_MARKETPLACE_ACTIONS] : [...DEFAULT_COPILOT_ACTIONS])
  const msca = params.mscaAddress || getStoredMscaAddress()

  let sessionPublicKey = ''
  if (params.enableEnclave) {
    const existing = getEphemeralSessionAccount(walletKey, scope)
    if (existing) {
      sessionPublicKey = existing.address
    } else {
      const generated = generateEphemeralSessionAccount(walletKey, scope)
      sessionPublicKey = generated.sessionPublicKey
    }
  }

  const newConfig: SessionKeyConfig = {
    sessionId: `sess_${scope}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    sessionPublicKey,
    walletAddress: walletKey !== 'default' ? walletKey : undefined,
    mscaAddress: msca || undefined,
    delegationType: msca ? 'msca' : 'headless',
    expiresAt: Date.now() + durationHours * 3600 * 1000,
    maxSpendUsdc,
    spentUsdc: 0.0,
    maxPerTxUsdc,
    allowedActions,
    isActive: true,
    autoExecute,
    createdAt: Date.now(),
    scope,
  }

  saveSessionKeyConfig(newConfig, true, walletKey, scope)
  return newConfig
}

const activeSpendReservations: Map<string, number> = new Map()

function getReservationKey(walletKey: string, scope: SessionScope = 'copilot'): string {
  return `${scope}:${walletKey}`
}

export function getReservedSessionSpend(walletAddress?: string, scope: SessionScope = 'copilot'): number {
  const walletKey = resolveTargetWallet(walletAddress)
  const resKey = getReservationKey(walletKey, scope)
  return (getSessionKeyConfig(walletKey, scope).reservedUsdc || 0) + (activeSpendReservations.get(resKey) || 0)
}

export function reserveSessionSpend(amountUsdc: number, walletAddress?: string, scope: SessionScope = 'copilot'): boolean {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return true
  const walletKey = resolveTargetWallet(walletAddress)
  const resKey = getReservationKey(walletKey, scope)
  const config = getSessionKeyConfig(walletKey, scope)
  const currentReserved = activeSpendReservations.get(resKey) || 0
  if (config.spentUsdc + currentReserved + amountUsdc > config.maxSpendUsdc) {
    return false
  }
  activeSpendReservations.set(resKey, Number((currentReserved + amountUsdc).toFixed(4)))
  return true
}

export function releaseSessionSpend(amountUsdc: number, walletAddress?: string, scope: SessionScope = 'copilot'): void {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return
  const walletKey = resolveTargetWallet(walletAddress)
  const resKey = getReservationKey(walletKey, scope)
  const currentReserved = activeSpendReservations.get(resKey) || 0
  activeSpendReservations.set(resKey, Math.max(0, Number((currentReserved - amountUsdc).toFixed(4))))
}

export function commitSessionSpend(amountUsdc: number, walletAddress?: string, scope: SessionScope = 'copilot'): void {
  releaseSessionSpend(amountUsdc, walletAddress, scope)
  deductSessionSpend(amountUsdc, walletAddress, scope)
}

/**
 * Checks whether an incoming action with an amount conforms to active session boundaries
 * for the given or active wallet address and scope.
 */
export function verifySessionLimits(
  actionType: SessionActionType,
  amountUsdc: number = 0,
  walletAddress?: string,
  scope: SessionScope = 'copilot'
): { allowed: boolean; reason?: string } {
  if (!Number.isFinite(amountUsdc) || amountUsdc < 0) {
    return { allowed: false, reason: 'Spend amount must be a finite non-negative USD value.' }
  }

  const walletKey = resolveTargetWallet(walletAddress)
  const config = getSessionKeyConfig(walletKey, scope)

  if (!config.isActive) {
    return { allowed: false, reason: `Autonomous session mode (${scope}) is inactive.` }
  }

  if (Date.now() > config.expiresAt) {
    return { allowed: false, reason: 'Session key expired. Please renew the session.' }
  }

  if (!config.allowedActions || !config.allowedActions.includes(actionType)) {
    return { allowed: false, reason: `Action '${actionType}' is not authorized in this session.` }
  }

  if (amountUsdc > config.maxPerTxUsdc) {
    return {
      allowed: false,
      reason: `Amount (${amountUsdc} USDC) exceeds single-transaction cap (${config.maxPerTxUsdc} USDC).`,
    }
  }

  const resKey = getReservationKey(walletKey, scope)
  const reserved = (config.reservedUsdc || 0) + (activeSpendReservations.get(resKey) || 0)
  if (config.spentUsdc + reserved + amountUsdc > config.maxSpendUsdc) {
    const remaining = Math.max(0, config.maxSpendUsdc - (config.spentUsdc + reserved))
    return {
      allowed: false,
      reason: `Session budget limit reached! Remaining: ${remaining.toFixed(2)} USDC.`,
    }
  }

  return { allowed: true }
}

/**
 * Records a successful spend against the wallet's session budget for the given scope
 */
export function deductSessionSpend(amountUsdc: number, walletAddress?: string, scope: SessionScope = 'copilot'): void {
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) return
  const walletKey = resolveTargetWallet(walletAddress)
  const config = getSessionKeyConfig(walletKey, scope)
  config.spentUsdc = Number((config.spentUsdc + amountUsdc).toFixed(4))
  saveSessionKeyConfig(config, true, walletKey, scope)
}

/**
 * Elevates the single-transaction cap (high-water mark) when a higher transaction is approved
 */
export function elevateSessionPerTxCap(newCap: number, walletAddress?: string, scope: SessionScope = 'copilot'): SessionKeyConfig {
  const walletKey = resolveTargetWallet(walletAddress)
  const config = getSessionKeyConfig(walletKey, scope)
  const safeCap = Math.max(0, Number(newCap) || 0)
  if (safeCap > config.maxPerTxUsdc) {
    config.maxPerTxUsdc = safeCap
    if (config.maxSpendUsdc < safeCap) {
      config.maxSpendUsdc = safeCap * 2
    }
    saveSessionKeyConfig(config, true, walletKey, scope)
  }
  return config
}

/**
 * Revokes and cleans up session metadata for this wallet and scope, removing it from storage.
 */
export function revokeSessionKey(
  walletAddress?: string,
  scope: SessionScope = 'copilot',
  targetPublicKey?: string
): SessionKeyConfig {
  const walletKey = resolveTargetWallet(walletAddress)
  clearEphemeralSessionAccount(walletKey, scope, targetPublicKey)
  const storageKey = getStorageKeyForWallet(walletKey, scope)
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(storageKey)
    }
  } catch (err) {
    console.error(`Failed to remove session key config for ${walletKey} (${scope}):`, err)
  }
  const empty = createInitialSessionConfig(walletKey, scope)
  dispatchSessionUpdateEvent(empty, scope)
  return empty
}

/**
 * Toggles auto-execute (zero popup vs 1-click prompt) for this wallet and scope
 */
export function toggleSessionAutoExecute(enabled: boolean, walletAddress?: string, scope: SessionScope = 'copilot'): SessionKeyConfig {
  const walletKey = resolveTargetWallet(walletAddress)
  const config = getSessionKeyConfig(walletKey, scope)
  if (config.isActive) {
    config.autoExecute = enabled
    saveSessionKeyConfig(config, true, walletKey, scope)
  }
  return config
}

/**
 * Convenience getters and revokers for each scope
 */
export const getCopilotSessionConfig = (walletAddress?: string) => getSessionKeyConfig(walletAddress, 'copilot')
export const getMarketplaceSessionConfig = (walletAddress?: string) => getSessionKeyConfig(walletAddress, 'marketplace')
export const revokeCopilotSession = (walletAddress?: string) => revokeSessionKey(walletAddress, 'copilot')
export const revokeMarketplaceSession = (walletAddress?: string) => revokeSessionKey(walletAddress, 'marketplace')

/**
 * Calculates remaining time for active session
 */
export function getSessionTimeRemaining(expiresAt: number): SessionTimeRemaining {
  const diffMs = Math.max(0, expiresAt - Date.now())
  if (diffMs <= 0) {
    return {
      hours: 0,
      minutes: 0,
      seconds: 0,
      isExpired: true,
      formatted: 'Expired',
    }
  }

  const totalSeconds = Math.floor(diffMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  let formatted = ''
  if (hours > 0) {
    formatted = `${hours}h ${minutes}m left`
  } else if (minutes > 0) {
    formatted = `${minutes}m ${seconds}s left`
  } else {
    formatted = `${seconds}s left`
  }

  return {
    hours,
    minutes,
    seconds,
    isExpired: false,
    formatted,
  }
}
