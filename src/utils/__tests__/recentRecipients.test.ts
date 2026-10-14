import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getSavedRecipients,
  saveRecipient,
  removeSavedRecipient,
  clearAllSavedRecipients,
  detectChainFamily,
  areAddressesEqual,
  isZeroOrDeadAddress,
  MAX_RECENT_RECIPIENTS,
  RECENT_RECIPIENTS_STORAGE_KEY,
} from '../recentRecipients'

describe('recentRecipients utility', () => {
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
      dispatchEvent: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('detectChainFamily', () => {
    it('detects EVM addresses correctly', () => {
      expect(detectChainFamily('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')).toBe('evm')
      expect(detectChainFamily('0x0000000000000000000000000000000000000001')).toBe('evm')
    })

    it('detects Solana addresses correctly', () => {
      expect(detectChainFamily('DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK')).toBe('solana')
    })

    it('detects Injective addresses correctly', () => {
      expect(detectChainFamily('inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqe72n7n')).toBe('injective')
    })

    it('returns null for invalid addresses', () => {
      expect(detectChainFamily('not-an-address')).toBeNull()
      expect(detectChainFamily('0x123')).toBeNull()
    })
  })

  describe('isZeroOrDeadAddress', () => {
    it('identifies zero and dead addresses correctly', () => {
      expect(isZeroOrDeadAddress('0x0000000000000000000000000000000000000000')).toBe(true)
      expect(isZeroOrDeadAddress('0x000000000000000000000000000000000000dead')).toBe(true)
      expect(isZeroOrDeadAddress('0x000000000000000000000000000000000000dEaD')).toBe(true)
      expect(isZeroOrDeadAddress('')).toBe(true)
      expect(isZeroOrDeadAddress(null)).toBe(true)
      expect(isZeroOrDeadAddress('0x742d35Cc6634C0532925a3b844Bc454e4438f44e')).toBe(false)
    })
  })

  describe('saveRecipient & getSavedRecipients', () => {
    it('returns empty array when nothing is saved', () => {
      expect(getSavedRecipients()).toEqual([])
    })

    it('saves a valid EVM address and detects family', () => {
      const evm = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
      const res = saveRecipient({ address: evm, sourceChain: 'Arc_Testnet' })
      expect(res.length).toBe(1)
      expect(res[0].address).toBe(evm)
      expect(res[0].chainFamily).toBe('evm')
      expect(res[0].useCount).toBe(1)
      expect(res[0].sourceChain).toBe('Arc_Testnet')
    })

    it('filters by chainFamily when requested', () => {
      saveRecipient({ address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e' }) // evm
      saveRecipient({ address: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK' }) // solana
      saveRecipient({ address: 'inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqe72n7n' }) // injective

      const evmOnly = getSavedRecipients('evm')
      expect(evmOnly.length).toBe(1)
      expect(evmOnly[0].chainFamily).toBe('evm')

      const solOnly = getSavedRecipients('solana')
      expect(solOnly.length).toBe(1)
      expect(solOnly[0].chainFamily).toBe('solana')

      const all = getSavedRecipients('all')
      expect(all.length).toBe(3)
    })

    it('excludes specified address (such as connected address)', () => {
      const own = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'
      const other = '0x1111111111111111111111111111111111111111'
      saveRecipient({ address: own })
      saveRecipient({ address: other })

      const filtered = getSavedRecipients('all', own)
      expect(filtered.length).toBe(1)
      expect(filtered[0].address).toBe(other)
    })

    it('rejects zero address from being saved', () => {
      saveRecipient({ address: '0x0000000000000000000000000000000000000000' })
      expect(getSavedRecipients()).toEqual([])
    })

    it('updates existing address useCount and moves to top', () => {
      const addr1 = '0x1111111111111111111111111111111111111111'
      const addr2 = '0x2222222222222222222222222222222222222222'

      saveRecipient({ address: addr1 })
      saveRecipient({ address: addr2 })

      expect(getSavedRecipients()[0].address).toBe(addr2)

      // Re-save addr1 with different case
      saveRecipient({ address: addr1.toLowerCase() })
      const list = getSavedRecipients()
      expect(list.length).toBe(2)
      expect(list[0].address.toLowerCase()).toBe(addr1.toLowerCase())
      expect(list[0].useCount).toBe(2)
    })

    it('caps entries at MAX_RECENT_RECIPIENTS', () => {
      for (let i = 0; i < MAX_RECENT_RECIPIENTS + 5; i++) {
        const hex = i.toString(16).padStart(40, '0')
        saveRecipient({ address: `0x${hex}` })
      }
      expect(getSavedRecipients().length).toBe(MAX_RECENT_RECIPIENTS)
    })
  })

  describe('removeSavedRecipient & clearAllSavedRecipients', () => {
    it('removes a specific recipient', () => {
      const addr1 = '0x1111111111111111111111111111111111111111'
      const addr2 = '0x2222222222222222222222222222222222222222'
      saveRecipient({ address: addr1 })
      saveRecipient({ address: addr2 })

      removeSavedRecipient(addr1)
      const list = getSavedRecipients()
      expect(list.length).toBe(1)
      expect(list[0].address).toBe(addr2)
    })

    it('clears all recipients', () => {
      saveRecipient({ address: '0x1111111111111111111111111111111111111111' })
      saveRecipient({ address: '0x2222222222222222222222222222222222222222' })
      expect(getSavedRecipients().length).toBe(2)

      clearAllSavedRecipients()
      expect(getSavedRecipients()).toEqual([])
    })
  })
})
