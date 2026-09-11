// src/utils/passkeyErrorUtils.ts
// WebAuthn / Passkey Utilities & Environment Inspector for Circle Modular Wallets (100% English)
// Integrated with Arcis Centralized Error Architecture.

import { normalizePasskeyError } from './errorNormalizer'
import type { ParsedPasskeyError } from '../types/errors'

export type { ParsedPasskeyError }

/**
 * Checks whether the current browser and environment support WebAuthn / Passkeys.
 */
export function checkPasskeySupport(): {
  isSupported: boolean
  isSecureContext: boolean
  hasPublicKeyCredential: boolean
  reason?: string
} {
  if (typeof window === 'undefined') {
    return { isSupported: false, isSecureContext: false, hasPublicKeyCredential: false, reason: 'SSR Environment' }
  }

  const isSecureContext = window.isSecureContext === true
  const hasPublicKeyCredential = typeof window.PublicKeyCredential !== 'undefined'

  if (!isSecureContext) {
    return {
      isSupported: false,
      isSecureContext: false,
      hasPublicKeyCredential,
      reason: 'Passkey / WebAuthn requires a secure connection (HTTPS or localhost).',
    }
  }

  if (!hasPublicKeyCredential) {
    return {
      isSupported: false,
      isSecureContext: true,
      hasPublicKeyCredential: false,
      reason: 'Your browser or device does not support the WebAuthn (Passkey) standard.',
    }
  }

  return {
    isSupported: true,
    isSecureContext: true,
    hasPublicKeyCredential: true,
  }
}

/**
 * Parses raw WebAuthn, DOMExceptions, and Circle Modular SDK errors into
 * the standardized ArcisAppError structure (100% English).
 * Delegated to central errorNormalizer.
 */
export function parsePasskeyError(err: unknown): ParsedPasskeyError {
  return normalizePasskeyError(err)
}
