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
import CopilotSettingsModal from '../CopilotSettingsModal'
import ArcCopilotDrawer from '../ArcCopilotDrawer'
import InlineActionCard from '../InlineActionCard'
import type { SessionKeyConfig } from '../../../types/sessionKey'
import type { CopilotMessage } from '../../../types/marketplace'

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom')
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  }
})

vi.mock('../../../services/soundService', () => ({
  playSound: vi.fn(),
  soundService: { isEnabled: () => true, toggle: () => false, isMuted: () => false, toggleMute: vi.fn() },
}))

vi.mock('../../../hooks/useClearOnWalletDisconnect', () => ({
  useClearOnWalletDisconnect: vi.fn(),
}))

describe('CopilotSettingsModal & Ask Arco Execution Settings', () => {
  it('renders Ask Arco Settings modal with slippage presets and gas speed selector', () => {
    const html = renderToStaticMarkup(
      React.createElement(CopilotSettingsModal, {
        isOpen: true,
        onClose: () => {},
        slippage: 1.0,
        slippageType: '1.0',
        customSlippage: '',
        speedTier: 'fast',
        onSave: () => {},
      })
    )

    expect(html).toContain('Ask Arco Settings')
    expect(html).toContain('SLIPPAGE TOLERANCE')
    expect(html).toContain('1.0%')
    expect(html).toContain('0.1%')
    expect(html).toContain('0.5%')
    expect(html).toContain('Custom')
    expect(html).toContain('GAS &amp; EXECUTION SPEED')
    expect(html).toContain('Save Preferences')
  })

  it('renders Ask Arco execution settings button in the drawer header with slippage badge', () => {
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

    expect(html).toContain('aria-label="Ask Arco transaction settings"')
    expect(html).toContain('lucide-sliders-horizontal')
    expect(html).toContain('1.0%')
  })

  it('renders edit settings button next to Slippage Tolerance on the swap action card', () => {
    const swapMessage: CopilotMessage = {
      id: 'msg-swap-1',
      role: 'assistant',
      content: 'Here is your swap quote',
      timestamp: Date.now(),
      actionPayload: {
        type: 'interactive_swap',
        title: 'Confirm Swap: 10 USDC',
        data: {
          fromToken: 'USDC',
          toToken: 'EURC',
          amount: 10,
          estimatedOut: 9.85,
          minReceived: '9.75',
          slippageBps: 100,
          estimatedFeeUsdc: 0.00005,
        },
      },
    }

    const html = renderToStaticMarkup(
      React.createElement(InlineActionCard, {
        message: swapMessage,
        onExecuteInline: async () => {},
        onCloseDrawer: () => {},
        onOpenExecutionSettings: () => {},
      })
    )

    expect(html).toContain('Slippage Tolerance')
    expect(html).toContain('1%')
    expect(html).toContain('aria-label="Slippage ayarını aç"')
    expect(html).toContain('title="Toleransı ve Gaz Ayarlarını Düzenle"')
  })
})

