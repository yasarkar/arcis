if (typeof (globalThis as any).document === 'undefined') {
  ;(globalThis as any).document = { body: {} }
}
if (typeof (globalThis as any).localStorage === 'undefined') {
  ;(globalThis as any).localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }
}

import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import SessionKeyModal from '../SessionKeyModal'
import type { SessionKeyConfig } from '../../../types/sessionKey'

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom')
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  }
})

describe('SessionKeyModal Centered Screen Overlay', () => {
  const mockConfig: SessionKeyConfig = {
    sessionId: 'test-session',
    sessionPublicKey: '0xtest',
    expiresAt: Date.now() + 3600000,
    maxSpendUsdc: 100,
    spentUsdc: 0,
    maxPerTxUsdc: 50,
    allowedActions: ['swap', 'deposit'],
    isActive: true,
    autoExecute: false,
    createdAt: Date.now(),
  }

  it('renders modal in the center of the screen with fixed inset-0 and high z-index', () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionKeyModal, {
        isOpen: true,
        onClose: () => {},
        sessionConfig: mockConfig,
        onActivateSession: async () => mockConfig,
        onRevokeSession: () => {},
        onToggleAutoExecute: () => {},
      })
    )

    expect(html).toContain('Session Settings')
    expect(html).toContain('fixed inset-0')
    expect(html).toContain('z-[10000]')
    expect(html).toContain('items-center justify-center')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
  })

  it('renders nothing when isOpen is false', () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionKeyModal, {
        isOpen: false,
        onClose: () => {},
        sessionConfig: mockConfig,
        onActivateSession: async () => mockConfig,
        onRevokeSession: () => {},
        onToggleAutoExecute: () => {},
      })
    )

    expect(html).toBe('')
  })
})

