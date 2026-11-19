import { STORAGE_KEYS } from '../config/constants'

export type AuthLoginMethod = 'passkey' | 'google' | 'apple' | 'facebook' | 'email'

const VALID_METHODS: readonly AuthLoginMethod[] = ['passkey', 'google', 'apple', 'facebook', 'email'] as const

export const LAST_AUTH_METHOD_KEY = STORAGE_KEYS.AUTH_LAST_METHOD || 'arcis_last_auth_method'

/**
 * Retrieves the last used authentication method from localStorage.
 * Returns null if not set, invalid, or during SSR.
 */
export function getLastAuthMethod(): AuthLoginMethod | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  try {
    const raw = localStorage.getItem(LAST_AUTH_METHOD_KEY)
    if (!raw) return null
    const trimmed = raw.trim().toLowerCase()
    if (VALID_METHODS.includes(trimmed as AuthLoginMethod)) {
      return trimmed as AuthLoginMethod
    }
  } catch (err) {
    console.error('[lastAuthMethod] Error reading from localStorage:', err)
  }
  return null
}

/**
 * Persists the last used authentication method in localStorage.
 */
export function setLastAuthMethod(method: AuthLoginMethod): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    if (VALID_METHODS.includes(method)) {
      localStorage.setItem(LAST_AUTH_METHOD_KEY, method)
    }
  } catch (err) {
    console.error('[lastAuthMethod] Error writing to localStorage:', err)
  }
}

/**
 * Clears the last used authentication method from localStorage.
 */
export function clearLastAuthMethod(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  try {
    localStorage.removeItem(LAST_AUTH_METHOD_KEY)
  } catch (err) {
    console.error('[lastAuthMethod] Error clearing localStorage:', err)
  }
}
