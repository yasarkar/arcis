// Circle Modular Wallets & Autonomous Session Key State Manager for Arcis
// Implements secure in-memory + scoped sessionStorage key isolation (NEVER plain in persistent localStorage)
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { SessionKeyConfig, SessionActionType, SessionTimeRemaining } from '../types/sessionKey'
import { getStoredMscaAddress } from './modularWalletService'

const SESSION_KEY_METADATA_STORAGE = 'arcis_autonomous_session_meta_v2'
const SESSION_STORAGE_PRIV_KEY = 'arcis_ephemeral_priv_key_v2'
export const SESSION_KEY_UPDATED_EVENT = 'arcis_session_key_updated'

export const DEFAULT_SESSION_KEY_CONFIG = {
  durationHours: 24,
  maxSpendUsdc: 100.0,
  maxPerTxUsdc: 50.0,
  autoExecute: true,
  allowedActions: ['swap', 'deposit', 'bridge', 'send', 'faucet'] as SessionActionType[],
}

// Volatile in-memory key reference (cleared on page reload / garbage collection)
let inMemoryEphemeralPrivateKey: string | null = null

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

function getEphemeralPrivateKey(): string | null {
  if (inMemoryEphemeralPrivateKey) return inMemoryEphemeralPrivateKey
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const stored = sessionStorage.getItem(SESSION_STORAGE_PRIV_KEY)
      if (stored) {
        inMemoryEphemeralPrivateKey = stored
        return stored
      }
    }
  } catch (e) {
    // sessionStorage might be restricted in some privacy modes
  }
  return null
}

function setEphemeralPrivateKey(key: string | null): void {
  inMemoryEphemeralPrivateKey = key
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      if (key) {
        sessionStorage.setItem(SESSION_STORAGE_PRIV_KEY, key)
      } else {
        sessionStorage.removeItem(SESSION_STORAGE_PRIV_KEY)
      }
    }
  } catch (e) {
    // ignore quota/privacy errors
  }
}

function createInitialSessionConfig(): SessionKeyConfig {
  const privKey = generatePrivateKey()
  const account = privateKeyToAccount(privKey)
  const msca = getStoredMscaAddress()

  // Store private key ONLY in memory + sessionStorage (never in localStorage)
  setEphemeralPrivateKey(privKey)

  return {
    sessionId: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    sessionPublicKey: account.address,
    ephemeralPrivateKey: privKey,
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

export function getSessionKeyConfig(): SessionKeyConfig {
  try {
    const raw = localStorage.getItem(SESSION_KEY_METADATA_STORAGE)
    const activeMsca = getStoredMscaAddress()
    const activePrivKey = getEphemeralPrivateKey()

    if (raw) {
      const parsed: SessionKeyConfig = JSON.parse(raw)
      
      // Ensure allowedActions is populated
      if (!parsed.allowedActions || !Array.isArray(parsed.allowedActions)) {
        parsed.allowedActions = [...DEFAULT_SESSION_KEY_CONFIG.allowedActions]
      }

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
        setEphemeralPrivateKey(null)
      }

      saveSessionKeyConfig(parsed, false)
      return parsed
    }
  } catch (err) {
    console.error('Failed to load session key config:', err)
  }

  // Initialize and persist default state
  const initial = createInitialSessionConfig()
  saveSessionKeyConfig(initial, true)
  return initial
}

/**
 * Persists session metadata to localStorage, strictly omitting the unencrypted private key
 */
export function saveSessionKeyConfig(config: SessionKeyConfig, notify: boolean = true): void {
  try {
    // Keep ephemeral private key in memory / sessionStorage only
    if (config.ephemeralPrivateKey) {
      setEphemeralPrivateKey(config.ephemeralPrivateKey)
    }

    // SANITIZE: Never write ephemeralPrivateKey to persistent localStorage!
    const { ephemeralPrivateKey, ...sanitizedMeta } = config
    localStorage.setItem(SESSION_KEY_METADATA_STORAGE, JSON.stringify(sanitizedMeta))
    
    if (notify) {
      dispatchSessionUpdateEvent(config)
    }
  } catch (err) {
    console.error('Failed to save session key config:', err)
  }
}

/**
 * Activates or refreshes an autonomous session key with custom budget, duration, and allowed actions
 */
export async function activateSessionKey(params: {
  maxSpendUsdc?: number
  durationHours?: number
  maxPerTxUsdc?: number
  autoExecute?: boolean
  allowedActions?: SessionActionType[]
  mscaAddress?: string
}): Promise<SessionKeyConfig> {
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

  // Store in memory + sessionStorage
  setEphemeralPrivateKey(privKey)

  const newConfig: SessionKeyConfig = {
    sessionId: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    sessionPublicKey: account.address,
    ephemeralPrivateKey: privKey,
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

  saveSessionKeyConfig(newConfig, true)
  return newConfig
}

/**
 * Checks whether an incoming action with an amount conforms to active session boundaries
 */
export function verifySessionLimits(
  actionType: SessionActionType,
  amountUsdc: number = 0
): { allowed: boolean; reason?: string } {
  const config = getSessionKeyConfig()

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
 * Records a successful spend against the session budget
 */
export function deductSessionSpend(amountUsdc: number): void {
  const config = getSessionKeyConfig()
  config.spentUsdc = Number((config.spentUsdc + amountUsdc).toFixed(4))
  saveSessionKeyConfig(config, true)
}

/**
 * Instantly revokes the active session key and purges it from memory/storage
 */
export function revokeSessionKey(): SessionKeyConfig {
  setEphemeralPrivateKey(null)
  const config = getSessionKeyConfig()
  config.isActive = false
  config.autoExecute = false
  config.ephemeralPrivateKey = undefined
  saveSessionKeyConfig(config, true)
  return config
}

/**
 * Toggles auto-execute (zero popup vs 1-click prompt)
 */
export function toggleSessionAutoExecute(enabled: boolean): SessionKeyConfig {
  const config = getSessionKeyConfig()
  config.autoExecute = enabled
  saveSessionKeyConfig(config, true)
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
