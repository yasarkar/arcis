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
import SessionKeyModal, {
  computeSingleTxPresetValue,
  resolveInitialBudgetInput,
  snapToNearestSingleTxPreset,
} from '../SessionKeyModal'
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

  it('correctly handles empty allowedActions without forcing 1 of 4', () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionKeyModal, {
        isOpen: true,
        onClose: () => {},
        sessionConfig: {
          ...mockConfig,
          allowedActions: [],
        },
        onActivateSession: async () => mockConfig,
        onRevokeSession: () => {},
        onToggleAutoExecute: () => {},
      })
    )

    expect(html).toContain('0 OF 4 ENABLED')
  })

  it('correctly reports 0 of 4 enabled when allowedActions contains non-UI action like ai_service', () => {
    const html = renderToStaticMarkup(
      React.createElement(SessionKeyModal, {
        isOpen: true,
        onClose: () => {},
        sessionConfig: {
          ...mockConfig,
          allowedActions: ['ai_service'],
        },
        onActivateSession: async () => mockConfig,
        onRevokeSession: () => {},
        onToggleAutoExecute: () => {},
      })
    )

    expect(html).toContain('0 OF 4 ENABLED')
  })

  it('renders the luxury single-tx threshold slider with preset buttons and precision track', () => {
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

    expect(html).toContain('SINGLE-TX THRESHOLD')
    expect(html).toContain('50% of cap')
    expect(html).toContain('50 USDC')
    expect(html).toContain('aria-label="Single transaction threshold in USDC"')
    expect(html).toContain('10%')
    expect(html).toContain('25%')
    expect(html).toContain('50%')
    expect(html).toContain('Max')
  })

  it('does NOT render REMAINING, TOTAL CAP, or PER-TX LIMIT telemetry strip when session is inactive', () => {
    const inactiveConfig: SessionKeyConfig = {
      ...mockConfig,
      isActive: false,
    }

    const html = renderToStaticMarkup(
      React.createElement(SessionKeyModal, {
        isOpen: true,
        onClose: () => {},
        sessionConfig: inactiveConfig,
        onActivateSession: async () => mockConfig,
        onRevokeSession: () => {},
        onToggleAutoExecute: () => {},
      })
    )

    expect(html).toContain('>INACTIVE SESSION<')
    expect(html).not.toContain('>ACTIVE SESSION<')
    expect(html).not.toContain('REMAINING')
    expect(html).not.toContain('TOTAL CAP')
    expect(html).not.toContain('PER-TX LIMIT')
    expect(html).not.toContain('Revoke Session')
    expect(html).not.toContain('Temporary Session Wallet')
  })

  it('renders REMAINING, TOTAL CAP, and PER-TX LIMIT telemetry strip when session is active', () => {
    const activeConfig: SessionKeyConfig = {
      ...mockConfig,
      isActive: true,
      expiresAt: Date.now() + 3600000,
    }

    const html = renderToStaticMarkup(
      React.createElement(SessionKeyModal, {
        isOpen: true,
        onClose: () => {},
        sessionConfig: activeConfig,
        onActivateSession: async () => mockConfig,
        onRevokeSession: () => {},
        onToggleAutoExecute: () => {},
      })
    )

    expect(html).toContain('>ACTIVE SESSION<')
    expect(html).not.toContain('>INACTIVE SESSION<')
    expect(html).toContain('REMAINING')
    expect(html).toContain('TOTAL CAP')
    expect(html).toContain('PER-TX LIMIT')
    expect(html).toContain('Revoke Session')
  })

  it('renders Save & Fund button with budget amount and Temporary Session Wallet card', () => {
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

    expect(html).toContain('Save &amp; Fund (100 USDC)')
    expect(html).toContain('SESSION ENCLAVE')
    expect(html).toContain('Autonomous Mode')
    expect(html).toContain('Zero-Popup')
  })

  it('computes exact distinct single-tx presets for 25 USDC budget (10% = 2.5, 25% = 6.25, 50% = 12.5, Max = 25) and highlights only one chip', () => {
    expect(computeSingleTxPresetValue(25, 0.1)).toBe(2.5)
    expect(computeSingleTxPresetValue(25, 0.25)).toBe(6.25)
    expect(computeSingleTxPresetValue(25, 0.5)).toBe(12.5)
    expect(computeSingleTxPresetValue(25, 1.0)).toBe(25)

    const html = renderToStaticMarkup(
      React.createElement(SessionKeyModal, {
        isOpen: true,
        onClose: () => {},
        sessionConfig: {
          ...mockConfig,
          maxSpendUsdc: 25,
          maxPerTxUsdc: 2.5,
        },
        onActivateSession: async () => mockConfig,
        onRevokeSession: () => {},
        onToggleAutoExecute: () => {},
      })
    )

    expect(html).toContain('2.5 USDC')
    expect(html).toContain('(10% of cap)')
    // Only the 10% chip should carry the active selected highlight class, not 25%
    const activeChipMatches = html.match(/bg-\[rgba\(152,150,255,0\.22\)\]/g) || []
    expect(activeChipMatches).toHaveLength(1)
  })

  it('resets 6-decimal on-chain enclave dust maxSpendUsdc (e.g. 162.952572) to a clean preset instead of Custom', () => {
    expect(resolveInitialBudgetInput(162.952572, true)).toEqual({ budgetUsdc: 25, isCustom: false })
    expect(resolveInitialBudgetInput(162.952572, false)).toEqual({ budgetUsdc: 100, isCustom: false })
    expect(resolveInitialBudgetInput(75, false)).toEqual({ budgetUsdc: 75, isCustom: true })
    expect(resolveInitialBudgetInput(100, true)).toEqual({ budgetUsdc: 100, isCustom: false })

    const html = renderToStaticMarkup(
      React.createElement(SessionKeyModal, {
        isOpen: true,
        onClose: () => {},
        sessionConfig: {
          ...mockConfig,
          isActive: true,
          maxSpendUsdc: 162.952572,
          maxPerTxUsdc: 50,
        },
        onActivateSession: async () => mockConfig,
        onRevokeSession: () => {},
        onToggleAutoExecute: () => {},
      })
    )

    expect(html).not.toContain('placeholder="Enter custom budget in USDC"')
    expect(html).not.toContain('value="162.952572"')
    expect(html).toContain('25 USDC')
  })

  it('snaps off-preset initial maxPerTxUsdc (e.g. 15% of cap) to the nearest 10/25/50/100% preset on open', () => {
    expect(snapToNearestSingleTxPreset(15, 100)).toBe(10) // 15% -> 10%
    expect(snapToNearestSingleTxPreset(20, 100)).toBe(25) // 20% -> 25%
    expect(snapToNearestSingleTxPreset(3.75, 25)).toBe(2.5) // 15% of 25 -> 10% (2.5)
    expect(snapToNearestSingleTxPreset(50, 100)).toBe(50) // exact 50%

    const html = renderToStaticMarkup(
      React.createElement(SessionKeyModal, {
        isOpen: true,
        onClose: () => {},
        sessionConfig: {
          ...mockConfig,
          maxSpendUsdc: 100,
          maxPerTxUsdc: 15,
        },
        onActivateSession: async () => mockConfig,
        onRevokeSession: () => {},
        onToggleAutoExecute: () => {},
      })
    )

    expect(html).toContain('(10% of cap)')
    expect(html).toContain('10 USDC')
    const activeChipMatches = html.match(/bg-\[rgba\(152,150,255,0\.22\)\]/g) || []
    expect(activeChipMatches).toHaveLength(1)
  })
})

