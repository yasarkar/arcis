// src/utils/passkeyErrorUtils.ts
// Comprehensive WebAuthn / Passkey Error Parser & Environment Inspector for Circle Modular Wallets (100% English)

export interface ParsedPasskeyError {
  code: string
  title: string
  message: string
  isActionable: boolean
  actionHint?: string
}

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
 * Parses raw WebAuthn, DOMExceptions, and Circle Modular SDK errors into human-friendly explanations (100% English).
 */
export function parsePasskeyError(err: any): ParsedPasskeyError {
  const errName = err?.name || ''
  const rawMsg = err?.message || String(err)
  const origin = typeof window !== 'undefined' ? window.location.origin : 'current domain'

  // 1. User Canceled / Biometrics Timed Out
  if (errName === 'NotAllowedError' || rawMsg.includes('NotAllowedError') || rawMsg.includes('canceled') || rawMsg.includes('timed out')) {
    return {
      code: 'USER_CANCELED',
      title: 'Biometric Verification Canceled',
      message: 'FaceID, TouchID, or Passkey confirmation was canceled or timed out by the user.',
      isActionable: true,
      actionHint: 'Click to try again and authenticate when prompted on your device.',
    }
  }

  // 2. Already Registered on this Device
  if (errName === 'InvalidStateError' || rawMsg.includes('InvalidStateError') || rawMsg.includes('already exists')) {
    return {
      code: 'ALREADY_EXISTS',
      title: 'Passkey Already Registered',
      message: 'A passkey credential is already registered on this device and browser.',
      isActionable: true,
      actionHint: 'Please use "Login with FaceID" instead of creating a new passkey.',
    }
  }

  // 3. Security / Domain (RP ID) Mismatch
  if (errName === 'SecurityError' || rawMsg.includes('SecurityError') || rawMsg.includes('relying party') || rawMsg.includes('RP ID')) {
    return {
      code: 'SECURITY_DOMAIN_MISMATCH',
      title: 'Passkey Domain Mismatch',
      message: `The WebAuthn key does not match or is not authorized for this domain (${origin}).`,
      isActionable: true,
      actionHint: 'Verify your valid domain is configured in the Circle Developer Console.',
    }
  }

  // 4. Not Supported or Device Constraint
  if (errName === 'NotSupportedError' || errName === 'ConstraintError' || rawMsg.includes('not supported')) {
    return {
      code: 'NOT_SUPPORTED',
      title: 'Device / Browser Unsupported',
      message: 'No biometric authenticator (FaceID, Windows Hello, TouchID) is enabled on this device.',
      isActionable: false,
      actionHint: 'Enable biometric lock in your system settings or try a supported browser.',
    }
  }

  // 5. Circle Console Modular Entity Config Missing
  if (rawMsg.includes('Cannot find the entity config') || rawMsg.includes('entity config') || rawMsg.includes('EntityConfigNotFound')) {
    return {
      code: 'CIRCLE_ENTITY_CONFIG_MISSING',
      title: 'Circle Modular Config Missing',
      message: `Modular Wallets Configurator has not been completed for this domain (${origin}) in Circle Console.`,
      isActionable: true,
      actionHint: 'Go to Circle Console > Wallets > Modular Wallets > Configurator to register your domain.',
    }
  }

  // 6. Client Key / Origin Unauthorized
  if (rawMsg.includes('Invalid credentials') || rawMsg.includes('Unauthorized') || rawMsg.includes('401') || rawMsg.includes('403')) {
    return {
      code: 'CLIENT_KEY_UNAUTHORIZED',
      title: 'Circle Client Key Unauthorized',
      message: `The current domain (${origin}) is not listed under 'Allowed Domains' in Circle Developer Console.`,
      isActionable: true,
      actionHint: 'Add this origin to your Allowed Domains list in the Circle Console.',
    }
  }

  // 7. Gas Station / Paymaster Error
  if (rawMsg.includes('AA21') || rawMsg.includes('paymaster') || rawMsg.includes('Gas Station') || rawMsg.includes('prefund')) {
    return {
      code: 'PAYMASTER_SPONSORSHIP_ERROR',
      title: 'Gas Station Sponsorship Error',
      message: 'Circle Gas Station could not sponsor gas for this transaction.',
      isActionable: true,
      actionHint: 'Check your testnet Gas Station balance in the Circle Console.',
    }
  }

  // 8. WebAuthn Protocol Bad Request (Domain format or unregistered credential)
  if (rawMsg.includes('Bad request for the Webauthn protocol') || rawMsg.includes('Webauthn protocol')) {
    return {
      code: 'WEBAUTHN_PROTOCOL_BAD_REQUEST',
      title: 'WebAuthn Protocol Error',
      message: 'The WebAuthn protocol rejected the request. Passkey Domain in Circle Console must not include protocol or ports (e.g. use "localhost" directly).',
      isActionable: true,
      actionHint: '1) In Circle Console > Modular Wallets > Passkey, set the domain name to "localhost". 2) If logging in for the first time, click "Create New Passkey".',
    }
  }

  // 9. Generic / Unknown Error
  return {
    code: 'UNKNOWN_PASSKEY_ERROR',
    title: 'Passkey Operation Failed',
    message: rawMsg || 'An unknown biometric verification error occurred.',
    isActionable: true,
  }
}
