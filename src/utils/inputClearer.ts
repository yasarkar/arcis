// src/utils/inputClearer.ts
// Utility to clear all form fields, text inputs, search queries, and textareas across Arcis
// when the user disconnects their wallet (EVM, Passkey, UCW, Solana, or Injective).

export const WALLET_DISCONNECT_CLEAR_EVENT = 'arcis:wallet-disconnect-clear-inputs'

/**
 * Clears all DOM input and textarea elements, dispatches change/input events so
 * controlled or uncontrolled fields reset immediately, and broadcasts the global
 * `arcis:wallet-disconnect-clear-inputs` event so React component states clear.
 */
export function clearAllAppInputs(): void {
  if (typeof window === 'undefined') return

  // 1. Dispatch custom event for React components holding internal state
  try {
    window.dispatchEvent(new CustomEvent(WALLET_DISCONNECT_CLEAR_EVENT))
  } catch (err) {
    console.warn('Error dispatching clear event:', err)
  }

  // 2. Clear all DOM inputs and textareas systematically
  if (typeof document !== 'undefined') {
    try {
      const elements = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
      elements.forEach((el) => {
        // Skip non-textual input controls
        const type = (el.getAttribute('type') || '').toLowerCase()
        if (['button', 'submit', 'reset', 'radio', 'checkbox', 'file', 'image', 'hidden'].includes(type)) {
          return
        }

        // Use native prototype setter to update React's internal value tracker
        const nativeSetter = el instanceof HTMLInputElement
          ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
          : Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set

        if (nativeSetter) {
          nativeSetter.call(el, '')
        } else {
          el.value = ''
        }

        // Dispatch events so React synthetic listeners and native listeners register the change
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      })
    } catch (err) {
      console.warn('Error clearing DOM inputs on wallet disconnect:', err)
    }
  }
}
