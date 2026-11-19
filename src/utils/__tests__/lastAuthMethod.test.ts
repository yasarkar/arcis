import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getLastAuthMethod,
  setLastAuthMethod,
  clearLastAuthMethod,
  LAST_AUTH_METHOD_KEY,
  AuthLoginMethod,
} from '../lastAuthMethod'

describe('lastAuthMethod utility', () => {
  let store: Record<string, string> = {}
  let localStorageMock: any

  beforeEach(() => {
    store = {}
    localStorageMock = {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key]
      }),
      clear: vi.fn(() => {
        store = {}
      }),
    }

    vi.stubGlobal('localStorage', localStorageMock)
    vi.stubGlobal('window', {
      localStorage: localStorageMock,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when no method has been stored', () => {
    expect(getLastAuthMethod()).toBeNull()
  })

  it('stores and retrieves passkey method', () => {
    setLastAuthMethod('passkey')
    expect(store[LAST_AUTH_METHOD_KEY]).toBe('passkey')
    expect(getLastAuthMethod()).toBe('passkey')
  })

  it('stores and retrieves social providers (google, apple, facebook)', () => {
    const providers: AuthLoginMethod[] = ['google', 'apple', 'facebook']
    for (const provider of providers) {
      setLastAuthMethod(provider)
      expect(getLastAuthMethod()).toBe(provider)
    }
  })

  it('stores and retrieves email method', () => {
    setLastAuthMethod('email')
    expect(getLastAuthMethod()).toBe('email')
  })

  it('ignores invalid or unknown methods in localStorage', () => {
    store[LAST_AUTH_METHOD_KEY] = 'unknown_oauth'
    expect(getLastAuthMethod()).toBeNull()
  })

  it('clears stored auth method', () => {
    setLastAuthMethod('google')
    expect(getLastAuthMethod()).toBe('google')
    clearLastAuthMethod()
    expect(getLastAuthMethod()).toBeNull()
    expect(store[LAST_AUTH_METHOD_KEY]).toBeUndefined()
  })

  it('gracefully handles localStorage exceptions', () => {
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new Error('Access denied')
    })
    expect(getLastAuthMethod()).toBeNull()

    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceeded')
    })
    expect(() => setLastAuthMethod('passkey')).not.toThrow()
  })
})
