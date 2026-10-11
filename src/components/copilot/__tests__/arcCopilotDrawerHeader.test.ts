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

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom')
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  }
})

const mockPlaySound = vi.fn()
vi.mock('../../../services/soundService', () => ({
  playSound: (...args: any[]) => mockPlaySound(...args),
  soundService: { isEnabled: () => true, toggle: () => false, isMuted: () => false, toggleMute: vi.fn() },
}))

vi.mock('../../../hooks/useClearOnWalletDisconnect', () => ({
  useClearOnWalletDisconnect: vi.fn(),
}))

import ArcCopilotDrawer from '../ArcCopilotDrawer'
import type { SessionKeyConfig } from '../../../types/sessionKey'

describe('ArcCopilotDrawer Header & Dynamic Rotate-CCW Layer', () => {
  const baseSessionConfig: SessionKeyConfig = {
    sessionId: 'mock-session-id',
    sessionPublicKey: '0xmocksessionpubkey',
    expiresAt: Date.now() + 3_600_000,
    maxSpendUsdc: 100,
    spentUsdc: 0,
    maxPerTxUsdc: 50,
    allowedActions: [],
    isActive: false,
    autoExecute: false,
    createdAt: Date.now(),
  }

  it('renders Ask Arco title, AI AGENT badge, and cybernetic indicators', () => {
    const html = renderToStaticMarkup(
      React.createElement(ArcCopilotDrawer, {
        isOpen: true,
        onClose: () => {},
        messages: [],
        currentSteps: [],
        isAnalyzing: false,
        sessionConfig: baseSessionConfig,
        onSendMessage: async () => {},
        onClearChat: () => {},
        onActivateSession: async () => baseSessionConfig,
        onRevokeSession: () => {},
        onToggleAutoExecute: () => {},
        onExecuteInline: async () => {},
      })
    )

    expect(html).toContain('Ask Arco')
    expect(html).toContain('AI AGENT')
    expect(html).toContain('Arcis Autonomous Intelligence')
  })

  it('renders dynamic RotateCcw reset button with title, aria-label, and visual layer', () => {
    const html = renderToStaticMarkup(
      React.createElement(ArcCopilotDrawer, {
        isOpen: true,
        onClose: () => {},
        messages: [],
        currentSteps: [],
        isAnalyzing: false,
        sessionConfig: baseSessionConfig,
        onSendMessage: async () => {},
        onClearChat: () => {},
        onActivateSession: async () => baseSessionConfig,
        onRevokeSession: () => {},
        onToggleAutoExecute: () => {},
        onExecuteInline: async () => {},
      })
    )

    // Verify title and accessible labels
    expect(html).toContain('Sohbeti Sıfırla (Temizle)')
    expect(html).toContain('Sohbet geçmişini sıfırla')
    // Verify dynamic visual layer styling (cyber rounded-xl, gradient aura)
    expect(html).toContain('from-cyan-500/25')
  })
})
