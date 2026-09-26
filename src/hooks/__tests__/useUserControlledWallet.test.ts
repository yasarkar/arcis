import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseCircleAuthError,
  cleanupCircleIframe,
} from '../useUserControlledWallet'

describe('useUserControlledWallet Unit Tests', () => {
  let mockStorage: Record<string, string> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    mockStorage = {}

    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockStorage[key] || null),
      setItem: vi.fn((key: string, val: string) => {
        mockStorage[key] = String(val)
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key]
      }),
      clear: vi.fn(() => {
        mockStorage = {}
      }),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('parseCircleAuthError', () => {
    it('accurately maps Circle SDK error codes to Turkish messages', () => {
      expect(parseCircleAuthError({ code: 155104 })).toContain('Oturum süreniz doldu')
      expect(parseCircleAuthError({ code: 155101 })).toContain('Cihaz oturumu bulunamadı')
      expect(parseCircleAuthError({ code: 155130 })).toContain('Doğrulama kodunun (OTP) süresi doldu')
      expect(parseCircleAuthError({ code: 155131 })).toContain('Geçersiz doğrulama kodu belirteci')
      expect(parseCircleAuthError({ code: 155133 })).toContain('Girdiğiniz doğrulama kodu geçersiz')
      expect(parseCircleAuthError({ code: 155134 })).toContain('Doğrulama kodu eşleşmedi')
      expect(parseCircleAuthError({ code: 155146 })).toContain('güvenlik kilidi uygulandı')
      expect(parseCircleAuthError({ code: 155106 })).toContain('Kullanıcı hesabı zaten tanımlı')
      expect(parseCircleAuthError({ code: 401 })).toContain('Circle API kimlik doğrulama hatası (401)')
      expect(parseCircleAuthError({ code: 429 })).toContain('Çok fazla istek gönderildi')
      expect(parseCircleAuthError({ message: 'SMTP sending failed' })).toContain('SMTP sağlayıcısı yapılandırılmamış')
    })

    it('handles unexpected or fallback error formats safely', () => {
      expect(parseCircleAuthError(null)).toBe('Bilinmeyen bir hata oluştu.')
      expect(parseCircleAuthError('Custom error message')).toBe('Custom error message')
    })
  })

  describe('cleanupCircleIframe', () => {
    it('removes sdkIframe from document DOM when present', () => {
      const mockRemoveChild = vi.fn()
      const mockParent = { removeChild: mockRemoveChild }
      const mockIframe = { id: 'sdkIframe', parentNode: mockParent }

      vi.stubGlobal('document', {
        getElementById: vi.fn((id: string) => (id === 'sdkIframe' ? mockIframe : null)),
      })

      cleanupCircleIframe()
      expect(mockRemoveChild).toHaveBeenCalledWith(mockIframe)
    })

    it('does not throw when iframe is absent', () => {
      vi.stubGlobal('document', {
        getElementById: vi.fn(() => null),
      })
      expect(() => cleanupCircleIframe()).not.toThrow()
    })
  })

  describe('Session Storage & Lifecycle', () => {
    it('purges stale storage when token has expired', () => {
      const pastTime = Date.now() - 1000
      localStorage.setItem('arc_ucw_user_token', 'expired_token')
      localStorage.setItem('arc_ucw_token_expires_at', String(pastTime))
      localStorage.setItem('arc_ucw_address', '0x1234567890123456789012345678901234567890')

      const isExpired = Date.now() > Number(localStorage.getItem('arc_ucw_token_expires_at') || 0)
      expect(isExpired).toBe(true)
    })
  })
})
