import { 
  DEFAULT_PRIVACY_SETTINGS, 
  PrivacySettings, 
  PrivacyLevel } 
  from '../types/privacy';

const STORAGE_KEY = 'arcis_privacy_settings';
const APS_PREFIX = 'aps_v2_';

// ─────────────────────────────────────────────────────────────
// WEB CRYPTO AES-256-GCM ENGINE FOR ARC PRIVACY SHIELD (APS)
// ─────────────────────────────────────────────────────────────

function getCryptoSubtle(): SubtleCrypto {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    return window.crypto.subtle;
  }
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error('Web Crypto API is not supported in this environment.');
}

function getRandomBytes(len: number): Uint8Array {
  const buf = new Uint8Array(len);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(buf);
  } else if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    globalThis.crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return buf;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getCryptoSubtle();
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export const privacyService = {
  /**
   * Retrieves the current privacy settings from localStorage.
   */
  getPrivacySettings(): PrivacySettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return DEFAULT_PRIVACY_SETTINGS;
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_PRIVACY_SETTINGS, ...parsed };
    } catch {
      return DEFAULT_PRIVACY_SETTINGS;
    }
  },

  /**
   * Persists privacy settings to localStorage and dispatches a custom event.
   */
  setPrivacySettings(settings: PrivacySettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      window.dispatchEvent(new CustomEvent('arcis_privacy_changed', { detail: settings }));
    } catch (e) {
      console.error('Failed to save privacy settings:', e);
    }
  },

  /**
   * Helper to check if private mode is active.
   */
  isPrivateModeEnabled(settings?: PrivacySettings): boolean {
    const s = settings || this.getPrivacySettings();
    return s.level === 'private';
  },

  /**
   * Masks a numerical or textual balance based on privacy settings.
   */
  formatBalance(value: string | number, level?: PrivacyLevel, symbol: string = 'USDC'): string {
    const currentLevel = level || this.getPrivacySettings().level;
    if (currentLevel === 'private') {
      return `•••• ${symbol}`;
    }
    const numeric = typeof value === 'number' ? value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : value;
    return `${numeric} ${symbol}`;
  },

  /**
   * Encrypts balance or payload using real Web Crypto AES-256-GCM + PBKDF2.
   */
  async encryptBalance(amount: string, userSecret: string = 'arcis_aps_default_secret'): Promise<string> {
    try {
      const subtle = getCryptoSubtle();
      const salt = getRandomBytes(16);
      const iv = getRandomBytes(12);
      const key = await deriveKey(userSecret, salt);
      const encoded = new TextEncoder().encode(amount);

      const cipherBuffer = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
      const cipherBytes = new Uint8Array(cipherBuffer);

      return `${APS_PREFIX}${bytesToHex(salt)}_${bytesToHex(iv)}_${bytesToHex(cipherBytes)}`;
    } catch (e) {
      console.warn('[privacyService] Real AES-256-GCM encryption fallback:', e);
      return `aps_v2_unencrypted_${amount}`;
    }
  },

  /**
   * Decrypts an APS v2 payload using real Web Crypto AES-256-GCM.
   */
  async decryptBalance(cipherText: string, userSecret: string = 'arcis_aps_default_secret'): Promise<string> {
    // Backward compatibility with legacy mock tokens
    if (cipherText.startsWith('aps_pq_')) {
      try {
        const parts = cipherText.split('_');
        return atob(parts[2]);
      } catch {
        return '0.00';
      }
    }

    if (cipherText.startsWith('aps_v2_unencrypted_')) {
      return cipherText.replace('aps_v2_unencrypted_', '');
    }

    if (!cipherText.startsWith(APS_PREFIX)) return cipherText;

    try {
      const subtle = getCryptoSubtle();
      const parts = cipherText.replace(APS_PREFIX, '').split('_');
      if (parts.length < 3) return '0.00';

      const salt = hexToBytes(parts[0]);
      const iv = hexToBytes(parts[1]);
      const cipherBytes = hexToBytes(parts[2]);

      const key = await deriveKey(userSecret, salt);
      const decryptedBuffer = await subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes);
      return new TextDecoder().decode(decryptedBuffer);
    } catch (e) {
      console.warn('[privacyService] AES-256-GCM decryption failed:', e);
      return '0.00';
    }
  }
};
