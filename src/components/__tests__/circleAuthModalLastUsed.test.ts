import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('react-dom', () => ({
  createPortal: (children: React.ReactNode) => children,
}))

vi.mock('../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: vi.fn(),
}))

vi.mock('../../hooks/useClearOnWalletDisconnect', () => ({
  useClearOnWalletDisconnect: vi.fn(),
}))

import CircleAuthModal from '../CircleAuthModal'
import { LAST_AUTH_METHOD_KEY } from '../../utils/lastAuthMethod'

describe('CircleAuthModal Last Used Badge & Social Buttons', () => {
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
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    vi.stubGlobal('document', {
      body: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderModal() {
    return renderToStaticMarkup(
      React.createElement(CircleAuthModal, {
        isOpen: true,
        onClose: vi.fn(),
        onRequestOtp: vi.fn().mockResolvedValue({ success: true }),
        onLoginSocial: vi.fn().mockResolvedValue({ success: true }),
        onLoginPasskey: vi.fn().mockResolvedValue({ success: true }),
        isLoading: false,
      })
    )
  }

  it('renders active buttons for Google and Passkey, while Apple and Facebook remain disabled and blurred', () => {
    const html = renderModal()
    expect(html).toContain('Continue with Google')
    expect(html).toContain('Continue with Passkey')
    expect(html).toContain('Continue with Apple')
    expect(html).toContain('Continue with Facebook')

    // Apple and Facebook should remain disabled & blurred
    expect(html).toContain('Apple Sign-In is temporarily unavailable')
    expect(html).toContain('Facebook Sign-In is temporarily unavailable')
    expect(html).toContain('filter:blur(0.8px)')
  })

  it('renders LAST USED badge when google is stored in localStorage', () => {
    store[LAST_AUTH_METHOD_KEY] = 'google'
    const html = renderModal()
    expect(html).toContain('LAST USED')
    expect(html).toContain('Continue with Google')
  })

  it('renders LAST USED badge when passkey is stored in localStorage', () => {
    store[LAST_AUTH_METHOD_KEY] = 'passkey'
    const html = renderModal()
    expect(html).toContain('LAST USED')
    expect(html).toContain('Continue with Passkey')
  })

  it('renders LAST USED badge when email is stored in localStorage', () => {
    store[LAST_AUTH_METHOD_KEY] = 'email'
    const html = renderModal()
    expect(html).toContain('LAST USED')
    expect(html).toContain('CONTINUE')
  })

  it('does not render LAST USED badge when no auth method is stored', () => {
    const html = renderModal()
    expect(html).not.toContain('LAST USED')
  })
})
