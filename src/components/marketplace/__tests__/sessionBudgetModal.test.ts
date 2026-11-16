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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import SessionBudgetModal from '../SessionBudgetModal'
import * as sessionKeyService from '../../../services/sessionKeyService'
import type { SessionKeyConfig } from '../../../types/sessionKey'

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom')
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  }
})

describe('SessionBudgetModal Inactive/Active State Parity with Ask Arco Session Settings', () => {
  const mockActiveConfig: SessionKeyConfig = {
    sessionId: 'test-session-enclave',
    sessionPublicKey: '0x1234567890123456789012345678901234567890',
    expiresAt: Date.now() + 3600000,
    maxSpendUsdc: 2.0,
    spentUsdc: 0.5,
    maxPerTxUsdc: 2.0,
    allowedActions: ['ai_service'],
    isActive: true,
    autoExecute: true,
    createdAt: Date.now(),
  }

  const mockInactiveConfig: SessionKeyConfig = {
    sessionId: '',
    sessionPublicKey: '',
    expiresAt: 0,
    maxSpendUsdc: 0,
    spentUsdc: 0,
    maxPerTxUsdc: 0,
    allowedActions: [],
    isActive: false,
    autoExecute: false,
    createdAt: 0,
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders modal with role="dialog" and correct accessibility attributes when open', () => {
    vi.spyOn(sessionKeyService, 'getSessionKeyConfig').mockReturnValue(mockActiveConfig)

    const html = renderToStaticMarkup(
      React.createElement(SessionBudgetModal, {
        isOpen: true,
        onClose: () => {},
      })
    )

    expect(html).toContain('Session Key &amp; Autonomous Enclave')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Session Key &amp; Autonomous Enclave"')
  })

  it('renders nothing when isOpen is false', () => {
    vi.spyOn(sessionKeyService, 'getSessionKeyConfig').mockReturnValue(mockActiveConfig)

    const html = renderToStaticMarkup(
      React.createElement(SessionBudgetModal, {
        isOpen: false,
        onClose: () => {},
      })
    )

    expect(html).toBe('')
  })

  it('does NOT render REMAINING, TOTAL ENVELOPE, or SPENT VOLUME telemetry strip when session is inactive', () => {
    vi.spyOn(sessionKeyService, 'getSessionKeyConfig').mockReturnValue(mockInactiveConfig)

    const html = renderToStaticMarkup(
      React.createElement(SessionBudgetModal, {
        isOpen: true,
        onClose: () => {},
      })
    )

    // Should indicate inactive status and no active policy
    expect(html).toContain('>INACTIVE SESSION<')
    expect(html).not.toContain('>ACTIVE SESSION<')
    expect(html).toContain('No active policy')

    // Telemetry parameter cards must be hidden in inactive state
    expect(html).not.toContain('REMAINING')
    expect(html).not.toContain('TOTAL ENVELOPE')
    expect(html).not.toContain('SPENT VOLUME')
    expect(html).not.toContain('Envelope Consumption')
  })

  it('renders REMAINING, TOTAL ENVELOPE, SPENT VOLUME and progress bar when session is active', () => {
    vi.spyOn(sessionKeyService, 'getSessionKeyConfig').mockReturnValue(mockActiveConfig)

    const html = renderToStaticMarkup(
      React.createElement(SessionBudgetModal, {
        isOpen: true,
        onClose: () => {},
      })
    )

    // Should indicate active status
    expect(html).toContain('>ACTIVE SESSION<')
    expect(html).not.toContain('>INACTIVE SESSION<')
    expect(html).not.toContain('No active policy')

    // Telemetry parameter cards must be visible in active state
    expect(html).toContain('REMAINING')
    expect(html).toContain('TOTAL ENVELOPE')
    expect(html).toContain('SPENT VOLUME')
    expect(html).toContain('Envelope Consumption')
    expect(html).toContain('UPDATE SESSION')
  })

  it('renders SPEND ENVELOPE with 4 preset buttons (1, 2, 5, 10 USDC) and Custom button', () => {
    vi.spyOn(sessionKeyService, 'getSessionKeyConfig').mockReturnValue(mockActiveConfig)

    const html = renderToStaticMarkup(
      React.createElement(SessionBudgetModal, {
        isOpen: true,
        onClose: () => {},
      })
    )

    expect(html).toContain('SPEND ENVELOPE')
    expect(html).toContain('1 USDC')
    expect(html).toContain('2 USDC')
    expect(html).toContain('5 USDC')
    expect(html).toContain('10 USDC')
    expect(html).toContain('Custom')
  })

  it('renders Autonomous Mode with switch checkbox and Zero-Popup badge like Session Settings', () => {
    vi.spyOn(sessionKeyService, 'getSessionKeyConfig').mockReturnValue(mockActiveConfig)

    const html = renderToStaticMarkup(
      React.createElement(SessionBudgetModal, {
        isOpen: true,
        onClose: () => {},
      })
    )

    expect(html).toContain('Autonomous Mode')
    expect(html).toContain('Zero-Popup')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('Execute authorized transactions within caps without pop-up prompts')
  })
})
