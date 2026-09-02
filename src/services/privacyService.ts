import { DEFAULT_PRIVACY_SETTINGS, PrivacySettings, PrivacyLevel } from '../types/privacy';

const STORAGE_KEY = 'arcflow_privacy_settings';

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
      window.dispatchEvent(new CustomEvent('arcflow_privacy_changed', { detail: settings }));
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
   * Stub for Arc Privacy Sector (APS) post-quantum encryption.
   * Will call APS RPC when APS is deployed on Arc.
   */
  async encryptBalance(amount: string): Promise<string> {
    // APS Stub: Simulated post-quantum X-Wing KEM + AES-256-GCM encryption token
    const mockCipher = `aps_pq_${btoa(amount)}_${Date.now().toString(36)}`;
    return mockCipher;
  },

  /**
   * Stub for Arc Privacy Sector (APS) post-quantum decryption.
   */
  async decryptBalance(cipherText: string): Promise<string> {
    if (!cipherText.startsWith('aps_pq_')) return cipherText;
    try {
      const parts = cipherText.split('_');
      return atob(parts[2]);
    } catch {
      return '0.00';
    }
  }
};
