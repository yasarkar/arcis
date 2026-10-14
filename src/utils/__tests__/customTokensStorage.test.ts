import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getStoredCustomTokens,
  saveCustomToken,
  removeCustomToken,
  clearCustomTokens,
  CUSTOM_TOKENS_STORAGE_KEY,
} from '../customTokensStorage'

describe('customTokensStorage', () => {
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

  it('returns empty array when nothing is stored', () => {
    expect(getStoredCustomTokens('Arc_Testnet')).toEqual([])
    expect(getStoredCustomTokens()).toEqual([])
  })

  it('saves and retrieves custom tokens scoped by chain', () => {
    const token1 = {
      address: '0x1111111111111111111111111111111111111111',
      symbol: 'TEST1',
      decimals: 18,
      chainKey: 'Arc_Testnet',
    }

    const token2 = {
      address: '0x2222222222222222222222222222222222222222',
      symbol: 'TEST2',
      decimals: 6,
      chainKey: 'Ethereum_Sepolia',
    }

    saveCustomToken(token1)
    saveCustomToken(token2)

    const arcTokens = getStoredCustomTokens('Arc_Testnet')
    expect(arcTokens).toHaveLength(1)
    expect(arcTokens[0].symbol).toBe('TEST1')
    expect(arcTokens[0].address).toBe('0x1111111111111111111111111111111111111111')

    const ethTokens = getStoredCustomTokens('Ethereum_Sepolia')
    expect(ethTokens).toHaveLength(1)
    expect(ethTokens[0].symbol).toBe('TEST2')

    const allTokens = getStoredCustomTokens()
    expect(allTokens).toHaveLength(2)
  })

  it('prevents duplicate addresses (case-insensitive) and moves to front', () => {
    const tokenLower = {
      address: '0x3333333333333333333333333333333333333333',
      symbol: 'LOWER',
      decimals: 18,
      chainKey: 'Arc_Testnet',
    }
    const tokenUpper = {
      address: '0x3333333333333333333333333333333333333333'.toUpperCase().replace('0X', '0x'),
      symbol: 'UPPER',
      decimals: 18,
      chainKey: 'Arc_Testnet',
    }

    saveCustomToken(tokenLower)
    const updated = saveCustomToken(tokenUpper)

    expect(updated).toHaveLength(1)
    expect(updated[0].symbol).toBe('UPPER')
  })

  it('removes custom token by address', () => {
    const token = {
      address: '0x4444444444444444444444444444444444444444',
      symbol: 'DEL',
      decimals: 18,
      chainKey: 'Arc_Testnet',
    }
    saveCustomToken(token)
    expect(getStoredCustomTokens('Arc_Testnet')).toHaveLength(1)

    removeCustomToken('Arc_Testnet', token.address)
    expect(getStoredCustomTokens('Arc_Testnet')).toHaveLength(0)
  })

  it('handles invalid addresses gracefully', () => {
    const invalidToken = {
      address: 'invalid-address',
      symbol: 'BAD',
      decimals: 18,
      chainKey: 'Arc_Testnet',
    }
    const res = saveCustomToken(invalidToken)
    expect(res).toEqual([])
  })

  it('handles corrupted localStorage data without throwing', () => {
    store[CUSTOM_TOKENS_STORAGE_KEY] = '{invalid-json'
    expect(getStoredCustomTokens('Arc_Testnet')).toEqual([])
  })
})
