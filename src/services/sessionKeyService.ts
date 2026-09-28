// Circle Modular Wallets & Autonomous Session Key State Manager for Arcis
// Implements wallet-scoped isolation: each wallet (Circle UCW, Passkey MSCA, EOA) maintains its own independent session key settings and budget.
// Ephemeral private keys are kept strictly in memory and wallet-scoped sessionStorage (NEVER in persistent localStorage).

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { SessionKeyConfig, SessionActionType, SessionTimeRemaining } from '../types/sessionKey'
import { getStoredMscaAddress } from './modularWalletService'

const SESSION_META_STORAGE_PREFIX = 'arcis_session_meta_v3_'
const SESSION_PRIV_KEY_STORAGE_PREFIX = 'arcis_session_priv_key_v3_'
const LEGACY_STORAGE_KEY = 'arcis_autonomous_session_meta_v2'

export const SESSION_KEY_UPDATED_EVENT = 'arcis_session_key_updated'

export const DEFAULT_SESSION_KEY_CONFIG = {
  durationHours: 24,
  maxSpendUsdc: 100.0,
  maxPerTxUsdc: 50.0,
  autoExecute: true,
  allowedActions: ['swap', 'deposit', 'bridge', 'send', 'faucet', 'ai_service'] as SessionActionType[],
}

// Normalized address of the currently active wallet in session context
let currentActiveWallet: string | null = null

// Volatile in-memory key storage mapped by normalized wallet address
const inMemoryEphemeralKeys = new Map<string, string>()

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
  } catch {}
  return null
}

function resolveTargetWallet(walletAddress?: string | null): string {
  if (walletAddress && typeof walletAddress === 'string' && walletAddress.trim()) {
    return normalizeWalletAddress(walletAddress)
  }
  const active = getActiveWalletForSession()
  return active ? normalizeWalletAddress(active) : 'default'
}

function getStorageKeyForWallet(walletKey: string): string {
  return `${SESSION_META_STORAGE_PREFIX}${walletKey}`
}

function getPrivKeyStorageKeyForWallet(walletKey: string): string {
  return `${SESSION_PRIV_KEY_STORAGE_PREFIX}${walletKey}`
}

function dispatchSessionUpdateEvent(config: SessionKeyConfig): void {
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(
        new CustomEvent(SESSION_KEY_UPDATED_EVENT, {
          detail: { ...config, ephemeralPrivateKey: undefined },
        })
      )
    } catch {
      // ignore
    }
  }
}

function getEphemeralPrivateKey(walletKey: string): string | null {
  const inMem = inMemoryEphemeralKeys.get(walletKey)
  if (inMem) return inMem

  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const storageKey = getPrivKeyStorageKeyForWallet(walletKey)
      const stored = sessionStorage.getItem(storageKey)
      if (stored) {
        inMemoryEphemeralKeys.set(walletKey, stored)
        return stored
      }
    }
  } catch (e) {
    // sessionStorage might be restricted in some privacy modes
  }
  return null
}

function setEphemeralPrivateKey(key: string | null, walletKey: string): void {
  if (key) {
    inMemoryEphemeralKeys.set(walletKey, key)
  } else {
    inMemoryEphemeralKeys.delete(walletKey)
  }

  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const storageKey = getPrivKeyStorageKeyForWallet(walletKey)
      if (key) {
        sessionStorage.setItem(storageKey, key)
      } else {
        sessionStorage.removeItem(storageKey)
      }
    }
  } catch (e) {
    // ignore quota/privacy errors
  }
}

function createInitialSessionConfig(walletKey: string): SessionKeyConfig {
  const privKey = generatePrivateKey()
  const account = privateKeyToAccount(privKey)
  const msca = getStoredMscaAddress()

  // Store private key ONLY in memory + sessionStorage (never in persistent localStorage)
  setEphemeralPrivateKey(privKey, walletKey)

  return {
    sessionId: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    sessionPublicKey: account.address,
    ephemeralPrivateKey: privKey,
    walletAddress: walletKey !== 'default' ? walletKey : undefined,
    mscaAddress: msca || undefined,
    delegationType: msca ? 'msca' : 'headless',
    expiresAt: Date.now() + DEFAULT_SESSION_KEY_CONFIG.durationHours * 3600 * 1000,
    maxSpendUsdc: DEFAULT_SESSION_KEY_CONFIG.maxSpendUsdc,
    spentUsdc: 0.0,
    maxPerTxUsdc: DEFAULT_SESSION_KEY_CONFIG.maxPerTxUsdc,
    allowedActions: [...DEFAULT_SESSION_KEY_CONFIG.allowedActions],
    isActive: true, // Default active for seamless autonomous copilot experience
    autoExecute: DEFAULT_SESSION_KEY_CONFIG.autoExecute, // Zero-popup auto-execution via headless session key
    createdAt: Date.now(),
  }
}

/**
 * Loads session key configuration scoped to the given or active wallet address.
 */
export function getSessionKeyConfig(walletAddress?: string): SessionKeyConfig {
  const walletKey = resolveTargetWallet(walletAddress)
  const storageKey = getStorageKeyForWallet(walletKey)

  try {
    let raw = localStorage.getItem(storageKey)
    
    // Migration fallback: check legacy v2 storage if not yet initialized
    if (!raw) {
      const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (legacyRaw) {
        raw = legacyRaw
      }
    }

    const activeMsca = getStoredMscaAddress()
    const activePrivKey = getEphemeralPrivateKey(walletKey)

    if (raw) {
      const parsed: SessionKeyConfig = JSON.parse(raw)
      
      // Ensure allowedActions is populated
      if (!parsed.allowedActions || !Array.isArray(parsed.allowedActions)) {
        parsed.allowedActions = [...DEFAULT_SESSION_KEY_CONFIG.allowedActions]
      }

      parsed.walletAddress = walletKey !== 'default' ? walletKey : parsed.walletAddress

      // Hydrate ephemeral private key from memory/sessionStorage if active
      if (activePrivKey) {
        parsed.ephemeralPrivateKey = activePrivKey
        const account = privateKeyToAccount(activePrivKey as `0x${string}`)
        parsed.sessionPublicKey = account.address
      }

      // Update MSCA linkage if changed
      if (activeMsca && parsed.mscaAddress !== activeMsca) {
        parsed.mscaAddress = activeMsca
        parsed.delegationType = 'msca'
      }

      // If expired, deactivate and wipe private key
      if (parsed.expiresAt <= Date.now()) {
        parsed.isActive = false
        setEphemeralPrivateKey(null, walletKey)
      }

      saveSessionKeyConfig(parsed, false, walletKey)
      return parsed
    }
  } catch (err) {
    console.error(`Failed to load session key config for wallet ${walletKey}:`, err)
  }

  // Initialize and persist default state for this specific wallet
  const initial = createInitialSessionConfig(walletKey)
  saveSessionKeyConfig(initial, true, walletKey)
  return initial
}

/**
 * Persists session metadata to localStorage, strictly omitting the unencrypted private key
 * Metadata is saved under the wallet-scoped key.
 */
export function saveSessionKeyConfig(
  config: SessionKeyConfig,
  notify: boolean = true,
  walletAddress?: string
): void {
  const walletKey = resolveTargetWallet(walletAddress || config.walletAddress)
  const storageKey = getStorageKeyForWallet(walletKey)

  try {
    // Keep ephemeral private key in memory / sessionStorage only
    if (config.ephemeralPrivateKey) {
      setEphemeralPrivateKey(config.ephemeralPrivateKey, walletKey)
    }

    // SANITIZE: Never write ephemeralPrivateKey to persistent localStorage!
    const { ephemeralPrivateKey, ...sanitizedMeta } = config
    if (walletKey !== 'default') {
      sanitizedMeta.walletAddress = walletKey
    }
    localStorage.setItem(storageKey, JSON.stringify(sanitizedMeta))
    
    if (notify) {
      dispatchSessionUpdateEvent({
        ...config,
        walletAddress: walletKey !== 'default' ? walletKey : config.walletAddress,
      })
    }
  } catch (err) {
    console.error(`Failed to save session key config for ${walletKey}:`, err)
  }
}

/**
 * Activates or refreshes an autonomous session key with custom budget, duration, and allowed actions,
 * strictly scoped to the specified or active wallet address.
 */
export async function activateSessionKey(params: {
  maxSpendUsdc?: number
  durationHours?: number
  maxPerTxUsdc?: number
  autoExecute?: boolean
  allowedActions?: SessionActionType[]
  mscaAddress?: string
  walletAddress?: string
}): Promise<SessionKeyConfig> {
  const walletKey = resolveTargetWallet(params.walletAddress)
  const durationHours = params.durationHours || 24
  const maxSpendUsdc = params.maxSpendUsdc ?? 100.0
  const maxPerTxUsdc = params.maxPerTxUsdc ?? Math.min(maxSpendUsdc, 50.0)
  const autoExecute = params.autoExecute ?? true
  const allowedActions = params.allowedActions && params.allowedActions.length > 0 
    ? params.allowedActions 
    : [...DEFAULT_SESSION_KEY_CONFIG.allowedActions]
  const msca = params.mscaAddress || getStoredMscaAddress()

  // Generate real cryptographic ephemeral EVM keypair for the session
  const privKey = generatePrivateKey()
  const account = privateKeyToAccount(privKey)

  // Store in memory + sessionStorage for this specific wallet
  setEphemeralPrivateKey(privKey, walletKey)

  const newConfig: SessionKeyConfig = {
    sessionId: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    sessionPublicKey: account.address,
    ephemeralPrivateKey: privKey,
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
  }

  saveSessionKeyConfig(newConfig, true, walletKey)
  return newConfig
}

/**
 * Checks whether an incoming action with an amount conforms to active session boundaries
 * for the given or active wallet address.
 */
export function verifySessionLimits(
  actionType: SessionActionType,
  amountUsdc: number = 0,
  walletAddress?: string
): { allowed: boolean; reason?: string } {
  const config = getSessionKeyConfig(walletAddress)

  if (!config.isActive) {
    return { allowed: false, reason: 'Autonomous session mode is inactive.' }
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

  if (config.spentUsdc + amountUsdc > config.maxSpendUsdc) {
    return {
      allowed: false,
      reason: `Session budget limit reached! Remaining: ${(config.maxSpendUsdc - config.spentUsdc).toFixed(2)} USDC.`,
    }
  }

  return { allowed: true }
}

/**
 * Records a successful spend against the wallet's session budget
 */
export function deductSessionSpend(amountUsdc: number, walletAddress?: string): void {
  const walletKey = resolveTargetWallet(walletAddress)
  const config = getSessionKeyConfig(walletKey)
  config.spentUsdc = Number((config.spentUsdc + amountUsdc).toFixed(4))
  saveSessionKeyConfig(config, true, walletKey)
}

/**
 * Elevates the single-transaction cap (high-water mark) when a higher transaction is approved
 */
export function elevateSessionPerTxCap(newCap: number, walletAddress?: string): SessionKeyConfig {
  const walletKey = resolveTargetWallet(walletAddress)
  const config = getSessionKeyConfig(walletKey)
  const safeCap = Math.max(0, Number(newCap) || 0)
  if (safeCap > config.maxPerTxUsdc) {
    config.maxPerTxUsdc = safeCap
    if (config.maxSpendUsdc < safeCap) {
      config.maxSpendUsdc = safeCap * 2
    }
    saveSessionKeyConfig(config, true, walletKey)
  }
  return config
}

/**
 * Instantly revokes the active session key for this wallet and purges it from memory/storage
 */
export function revokeSessionKey(walletAddress?: string): SessionKeyConfig {
  const walletKey = resolveTargetWallet(walletAddress)
  setEphemeralPrivateKey(null, walletKey)
  const config = getSessionKeyConfig(walletKey)
  config.isActive = false
  config.autoExecute = false
  config.ephemeralPrivateKey = undefined
  saveSessionKeyConfig(config, true, walletKey)
  return config
}

/**
 * Toggles auto-execute (zero popup vs 1-click prompt) for this wallet
 */
export function toggleSessionAutoExecute(enabled: boolean, walletAddress?: string): SessionKeyConfig {
  const walletKey = resolveTargetWallet(walletAddress)
  const config = getSessionKeyConfig(walletKey)
  config.autoExecute = enabled
  saveSessionKeyConfig(config, true, walletKey)
  return config
}

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
