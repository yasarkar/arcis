/**
 * Utility for persisting, managing, and filtering recently used / valid recipient addresses in localStorage.
 * Used across Send, Swap, and Bridge tabs with chain-family awareness.
 */

export type ChainFamily = 'evm' | 'solana' | 'injective' | 'all';

export interface SavedRecipient {
  address: string;
  chainFamily: 'evm' | 'solana' | 'injective';
  label?: string;
  lastUsedAt: number;
  useCount: number;
  sourceChain?: string;
}

export const RECENT_RECIPIENTS_STORAGE_KEY = 'arcis_recent_recipients';
export const RECENT_RECIPIENTS_UPDATED_EVENT = 'arcis_recipients_updated';
export const MAX_RECENT_RECIPIENTS = 12;

/**
 * Checks whether an address is the zero address or dead address.
 */
export function isZeroOrDeadAddress(addr?: string | null): boolean {
  if (!addr) return true;
  const lower = addr.trim().toLowerCase();
  return (
    lower === '0x0000000000000000000000000000000000000000' ||
    lower === '0x000000000000000000000000000000000000dead' ||
    /^0x0{38,40}$/i.test(lower)
  );
}

/**
 * Detects the chain family based on address structure.
 */
export function detectChainFamily(addr: string): 'evm' | 'solana' | 'injective' | null {
  const clean = addr.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(clean)) return 'evm';
  if (clean.startsWith('inj1') && clean.length >= 38) return 'injective';
  if (!clean.startsWith('0x') && clean.length >= 32 && clean.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(clean)) {
    return 'solana';
  }
  return null;
}

/**
 * Checks whether two addresses are equivalent, honoring Solana case-sensitivity.
 */
export function areAddressesEqual(
  a: string,
  b: string,
  family?: 'evm' | 'solana' | 'injective' | null
): boolean {
  if (!a || !b) return false;
  const fam = family || detectChainFamily(a) || detectChainFamily(b);
  if (fam === 'solana') {
    return a.trim() === b.trim();
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Retrieves the list of saved recipients from localStorage, filtered and sorted by lastUsedAt.
 */
export function getSavedRecipients(
  filterFamily: ChainFamily = 'all',
  excludeAddress?: string
): SavedRecipient[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const raw = localStorage.getItem(RECENT_RECIPIENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const normExclude = excludeAddress?.trim().toLowerCase();

    return parsed
      .filter((item): item is SavedRecipient => {
        if (!item || typeof item.address !== 'string') return false;
        if (isZeroOrDeadAddress(item.address)) return false;
        if (normExclude && item.address.trim().toLowerCase() === normExclude) return false;

        const fam = item.chainFamily || detectChainFamily(item.address);
        if (!fam) return false;

        if (filterFamily !== 'all' && fam !== filterFamily) return false;
        return true;
      })
      .map((item) => ({
        ...item,
        chainFamily: item.chainFamily || detectChainFamily(item.address) || 'evm',
      }))
      .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
  } catch (err) {
    console.error('[recentRecipients] Error reading from localStorage:', err);
    return [];
  }
}

/**
 * Saves or updates a recipient in localStorage.
 * Updates lastUsedAt, increments useCount, deduplicates, and limits size to MAX_RECENT_RECIPIENTS.
 */
export function saveRecipient(input: {
  address: string;
  chainFamily?: 'evm' | 'solana' | 'injective';
  label?: string;
  sourceChain?: string;
}): SavedRecipient[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  const cleanAddress = input.address.trim();
  if (!cleanAddress || isZeroOrDeadAddress(cleanAddress)) {
    return getSavedRecipients();
  }

  const detectedFamily = input.chainFamily || detectChainFamily(cleanAddress);
  if (!detectedFamily) {
    return getSavedRecipients();
  }

  try {
    const all = getSavedRecipients('all');
    const existingIndex = all.findIndex((item) =>
      areAddressesEqual(item.address, cleanAddress, detectedFamily)
    );

    let updatedEntry: SavedRecipient;
    if (existingIndex >= 0) {
      const existing = all[existingIndex];
      updatedEntry = {
        ...existing,
        address: cleanAddress,
        chainFamily: detectedFamily,
        label: input.label?.trim() || existing.label,
        sourceChain: input.sourceChain || existing.sourceChain,
        lastUsedAt: Date.now(),
        useCount: (existing.useCount || 1) + 1,
      };
      all.splice(existingIndex, 1);
    } else {
      updatedEntry = {
        address: cleanAddress,
        chainFamily: detectedFamily,
        label: input.label?.trim(),
        sourceChain: input.sourceChain,
        lastUsedAt: Date.now(),
        useCount: 1,
      };
    }

    const updated = [updatedEntry, ...all].slice(0, MAX_RECENT_RECIPIENTS);
    localStorage.setItem(RECENT_RECIPIENTS_STORAGE_KEY, JSON.stringify(updated));

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(RECENT_RECIPIENTS_UPDATED_EVENT));
    }
    return updated;
  } catch (err) {
    console.error('[recentRecipients] Error saving to localStorage:', err);
    return getSavedRecipients();
  }
}

/**
 * Removes a specific recipient address from localStorage.
 */
export function removeSavedRecipient(address: string): SavedRecipient[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const all = getSavedRecipients('all');
    const filtered = all.filter(
      (item) => !areAddressesEqual(item.address, address, item.chainFamily)
    );
    localStorage.setItem(RECENT_RECIPIENTS_STORAGE_KEY, JSON.stringify(filtered));
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(RECENT_RECIPIENTS_UPDATED_EVENT));
    }
    return filtered;
  } catch (err) {
    console.error('[recentRecipients] Error removing from localStorage:', err);
    return getSavedRecipients();
  }
}

/**
 * Clears all saved recipient addresses from localStorage.
 */
export function clearAllSavedRecipients(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    localStorage.removeItem(RECENT_RECIPIENTS_STORAGE_KEY);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(RECENT_RECIPIENTS_UPDATED_EVENT));
    }
  } catch (err) {
    console.error('[recentRecipients] Error clearing localStorage:', err);
  }
}
