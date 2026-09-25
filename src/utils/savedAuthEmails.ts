/**
 * Utility for persisting and managing successfully verified OTP email addresses for Circle UCW auth.
 */

export const SAVED_AUTH_EMAILS_KEY = 'arcis_saved_auth_emails';
export const MAX_SAVED_AUTH_EMAILS = 5;

/**
 * Retrieves the list of saved email addresses from localStorage.
 */
export function getSavedAuthEmails(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  try {
    const raw = localStorage.getItem(SAVED_AUTH_EMAILS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === 'string' && item.includes('@') && item.trim().length > 3)
        .map((item) => item.trim().toLowerCase());
    }
  } catch (err) {
    console.error('[savedAuthEmails] Error reading from localStorage:', err);
  }
  return [];
}

/**
 * Saves a new email address after OTP sending succeeds.
 * Moves it to the front of the list, removes duplicates, limits to MAX_SAVED_AUTH_EMAILS.
 * Returns the updated list.
 */
export function saveAuthEmail(email: string): string[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.length < 4) {
    return getSavedAuthEmails();
  }

  try {
    const current = getSavedAuthEmails();
    const filtered = current.filter((item) => item !== cleanEmail);
    const updated = [cleanEmail, ...filtered].slice(0, MAX_SAVED_AUTH_EMAILS);
    localStorage.setItem(SAVED_AUTH_EMAILS_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.error('[savedAuthEmails] Error saving to localStorage:', err);
    return getSavedAuthEmails();
  }
}

/**
 * Removes an email address from the saved list.
 * Returns the updated list.
 */
export function removeSavedAuthEmail(email: string): string[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [];
  }
  const cleanEmail = email.trim().toLowerCase();
  try {
    const current = getSavedAuthEmails();
    const updated = current.filter((item) => item !== cleanEmail);
    localStorage.setItem(SAVED_AUTH_EMAILS_KEY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.error('[savedAuthEmails] Error removing from localStorage:', err);
    return getSavedAuthEmails();
  }
}

/**
 * Clears all saved email addresses from localStorage.
 */
export function clearAllSavedAuthEmails(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    localStorage.removeItem(SAVED_AUTH_EMAILS_KEY);
  } catch (err) {
    console.error('[savedAuthEmails] Error clearing localStorage:', err);
  }
}
