import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getSavedAuthEmails,
  saveAuthEmail,
  removeSavedAuthEmail,
  clearAllSavedAuthEmails,
  SAVED_AUTH_EMAILS_KEY,
  MAX_SAVED_AUTH_EMAILS,
} from '../savedAuthEmails'

describe('savedAuthEmails utility', () => {
  let store: Record<string, string> = {}

  beforeEach(() => {
    store = {}
    const localStorageMock = {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        store = {}
      },
    }

    vi.stubGlobal('localStorage', localStorageMock)
    vi.stubGlobal('window', {
      localStorage: localStorageMock,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns empty array when nothing is saved', () => {
    expect(getSavedAuthEmails()).toEqual([])
  })

  it('saves an email address in lowercase and trimmed format', () => {
    const list = saveAuthEmail('  Test@Domain.COM  ')
    expect(list).toEqual(['test@domain.com'])
    expect(getSavedAuthEmails()).toEqual(['test@domain.com'])
  })

  it('moves existing email to the top without duplicates', () => {
    saveAuthEmail('first@domain.com')
    saveAuthEmail('second@domain.com')
    expect(getSavedAuthEmails()).toEqual(['second@domain.com', 'first@domain.com'])

    // Re-save first
    const updated = saveAuthEmail('first@domain.com')
    expect(updated).toEqual(['first@domain.com', 'second@domain.com'])
    expect(getSavedAuthEmails()).toEqual(['first@domain.com', 'second@domain.com'])
  })

  it('respects MAX_SAVED_AUTH_EMAILS limit', () => {
    for (let i = 1; i <= 7; i++) {
      saveAuthEmail(`user${i}@domain.com`)
    }
    const saved = getSavedAuthEmails()
    expect(saved.length).toBe(MAX_SAVED_AUTH_EMAILS)
    expect(saved[0]).toBe('user7@domain.com')
    expect(saved).not.toContain('user1@domain.com')
  })

  it('ignores invalid email inputs', () => {
    saveAuthEmail('valid@email.com')
    saveAuthEmail('')
    saveAuthEmail('   ')
    saveAuthEmail('notanemail')
    expect(getSavedAuthEmails()).toEqual(['valid@email.com'])
  })

  it('removes a specific saved email', () => {
    saveAuthEmail('one@domain.com')
    saveAuthEmail('two@domain.com')
    const updated = removeSavedAuthEmail('one@domain.com')
    expect(updated).toEqual(['two@domain.com'])
    expect(getSavedAuthEmails()).toEqual(['two@domain.com'])
  })

  it('clears all saved emails', () => {
    saveAuthEmail('one@domain.com')
    saveAuthEmail('two@domain.com')
    clearAllSavedAuthEmails()
    expect(getSavedAuthEmails()).toEqual([])
  })

  it('gracefully handles corrupted JSON in localStorage', () => {
    localStorage.setItem(SAVED_AUTH_EMAILS_KEY, 'invalid-json{{{')
    expect(getSavedAuthEmails()).toEqual([])
  })
})
