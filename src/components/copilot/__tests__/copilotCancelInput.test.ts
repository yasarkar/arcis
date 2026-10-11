import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionKeyConfig } from '../../../types/sessionKey'

const harness = vi.hoisted(() => ({ input: '', portal: undefined as React.ReactNode }))
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>()
  return { ...actual, useState: (initial: any) => actual.useState(initial === '' ? harness.input : initial) }
})
vi.mock('react-dom', () => ({ createPortal: (children: React.ReactNode) => { harness.portal = children; return children } }))
vi.mock('../../../hooks/useClearOnWalletDisconnect', () => ({ useClearOnWalletDisconnect: vi.fn() }))
vi.mock('../../../services/soundService', () => ({ playSound: vi.fn(), soundService: { isEnabled: () => false, isMuted: () => true } }))

import ArcCopilotDrawer from '../ArcCopilotDrawer'

function findElement(node: React.ReactNode, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any> | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) continue
    if (predicate(child)) return child
    const found = findElement(child.props.children, predicate)
    if (found) return found
  }
  return undefined
}

afterEach(() => { vi.unstubAllGlobals(); harness.portal = undefined })

describe('A02 cancellation through the real chat form', () => {
  it.each([
    ['cancel', true], ['iptal et', true], ['send 5 USDC yapma', true],
    ['swap 5 USDC to EURC', false], ['', false],
  ])('allows only cancellation while analyzing: %s', async (input, allowed) => {
    harness.input = input
    vi.stubGlobal('document', { body: {} })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    const send = vi.fn(async () => {})
    const session = { isActive: false, expiresAt: 0 } as SessionKeyConfig
    renderToStaticMarkup(React.createElement(ArcCopilotDrawer, {
      isOpen: true, onClose: vi.fn(), messages: [], currentSteps: [], isAnalyzing: true,
      sessionConfig: session, onSendMessage: send, onClearChat: vi.fn(),
      onActivateSession: async () => session, onRevokeSession: vi.fn(), onToggleAutoExecute: vi.fn(),
      onExecuteInline: async () => {},
    }))
    const textbox = findElement(harness.portal, e => e.type === 'input' && e.props.placeholder?.startsWith('Type a command'))!
    const submit = findElement(harness.portal, e => e.type === 'button' && e.props['aria-label'] === 'Send message')!
    const form = findElement(harness.portal, e => e.type === 'form')!
    expect(textbox.props.disabled).not.toBe(true)
    expect(submit.props.disabled).toBe(!allowed)
    await form.props.onSubmit({ preventDefault: vi.fn() })
    if (allowed) expect(send).toHaveBeenCalledExactlyOnceWith(input)
    else expect(send).not.toHaveBeenCalled()
  })
})
