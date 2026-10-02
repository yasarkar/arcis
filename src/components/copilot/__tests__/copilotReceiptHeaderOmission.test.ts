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
vi.mock('../../../services/soundService', () => ({
  playSound: vi.fn(),
  soundService: { isEnabled: () => true, toggle: () => false, isMuted: () => false, toggleMute: vi.fn() },
}))
vi.mock('../../../hooks/useClearOnWalletDisconnect', () => ({
  useClearOnWalletDisconnect: vi.fn(),
}))

import ArcCopilotDrawer from '../ArcCopilotDrawer'
import type { CopilotMessage } from '../../../types/marketplace'
import type { SessionKeyConfig } from '../../../types/sessionKey'

describe('ArcCopilotDrawer receipt header omission', () => {
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

  it('renders the preparation message when an action payload exists without a receipt (initial state)', () => {
    const prepText = 'I have prepared your transfer on Arc Testnet. Available balance: 532.02 USDC. Click below to review and send.'
    const messages: CopilotMessage[] = [
      {
        id: 'msg-prep',
        role: 'assistant',
        content: prepText,
        timestamp: Date.now(),
        actionPayload: {
          type: 'send',
          title: 'Send Transfer',
          data: {
            amount: 10,
            recipient: '0x1234567890123456789012345678901234567890',
            tokenSymbol: 'USDC',
          },
        },
      },
    ]

    const html = renderToStaticMarkup(
      React.createElement(ArcCopilotDrawer, {
        isOpen: true,
        onClose: () => {},
        messages,
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

    expect(html).toContain('I have prepared your transfer on Arc Testnet.')
    expect(html).toContain('Click below to review and send.')
  })

  it('omits the preparation message above the receipt once the transaction succeeds', () => {
    const prepText = 'I have prepared your transfer on Arc Testnet. Available balance: 532.02 USDC. Click below to review and send.'
    const messages: CopilotMessage[] = [
      {
        id: 'msg-success',
        role: 'assistant',
        content: prepText,
        timestamp: Date.now(),
        actionPayload: {
          type: 'send',
          title: 'Send Transfer',
          data: {
            amount: 10,
            recipient: '0x1234567890123456789012345678901234567890',
            tokenSymbol: 'USDC',
          },
        },
        receipt: {
          id: 'rcpt-1',
          actionType: 'send',
          title: 'Send Completed Successfully',
          status: 'SUCCESS',
          txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
          amountIn: 10,
          fromToken: 'USDC',
          recipient: '0x1234567890123456789012345678901234567890',
          gasUsdc: 0.00053,
          settlementLatencyMs: 850,
          timestamp: Date.now(),
        },
      },
    ]

    const html = renderToStaticMarkup(
      React.createElement(ArcCopilotDrawer, {
        isOpen: true,
        onClose: () => {},
        messages,
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

    // Preparation text must NOT appear on top of the receipt
    expect(html).not.toContain('I have prepared your transfer on Arc Testnet.')
    expect(html).not.toContain('Click below to review and send.')
    // But the success receipt itself must be present
    expect(html).toContain('Send Completed Successfully')
    expect(html).toContain('Sent Amount')
  })

  it('omits the preparation message above the receipt when transaction fails', () => {
    const prepText = 'I have prepared your transfer on Arc Testnet. Available balance: 532.02 USDC. Click below to review and send.'
    const messages: CopilotMessage[] = [
      {
        id: 'msg-failed',
        role: 'assistant',
        content: prepText,
        timestamp: Date.now(),
        actionPayload: {
          type: 'send',
          title: 'Send Transfer',
          data: {
            amount: 10,
            recipient: '0x1234567890123456789012345678901234567890',
            tokenSymbol: 'USDC',
          },
        },
        receipt: {
          id: 'rcpt-fail',
          actionType: 'send',
          title: 'Transaction Failed',
          status: 'FAILED',
          txHash: '',
          gasUsdc: 0,
          settlementLatencyMs: 120,
          timestamp: Date.now(),
          errorMessage: 'Insufficient gas or balance on Arc Testnet',
        },
      },
    ]

    const html = renderToStaticMarkup(
      React.createElement(ArcCopilotDrawer, {
        isOpen: true,
        onClose: () => {},
        messages,
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

    // Preparation text must NOT appear on top of the failed receipt
    expect(html).not.toContain('I have prepared your transfer on Arc Testnet.')
    expect(html).not.toContain('Click below to review and send.')
    // The failed receipt must be visible
    expect(html).toContain('Transaction Failed')
    expect(html).toContain('Insufficient gas or balance on Arc Testnet')
    expect(html).toContain('Try Again')
  })
})
