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

describe('Ask Arco slash command selection on Enter & Tab', () => {
  it('selects /strategy and executes template prompt when pressing Enter on /str', async () => {
    harness.input = '/str'
    vi.stubGlobal('document', { body: {} })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    const send = vi.fn(async () => {})
    const session = { isActive: false, expiresAt: 0 } as SessionKeyConfig

    renderToStaticMarkup(React.createElement(ArcCopilotDrawer, {
      isOpen: true,
      onClose: vi.fn(),
      messages: [],
      currentSteps: [],
      isAnalyzing: false,
      sessionConfig: session,
      onSendMessage: send,
      onClearChat: vi.fn(),
      onActivateSession: async () => session,
      onRevokeSession: vi.fn(),
      onToggleAutoExecute: vi.fn(),
      onExecuteInline: async () => {},
    }))

    const textbox = findElement(harness.portal, e => e.type === 'input' && e.props.placeholder?.startsWith('Type a command'))!
    expect(textbox).toBeDefined()

    const preventDefault = vi.fn()
    textbox.props.onKeyDown({ key: 'Enter', preventDefault })

    // Must prevent default form submission (which would send raw /str)
    expect(preventDefault).toHaveBeenCalled()

    // Must send the resolved /strategy prompt to the agent instead of /str
    expect(send).toHaveBeenCalledWith('Analyze my wallet portfolio and propose the optimal DeFi yield strategy.')
    expect(send).not.toHaveBeenCalledWith('/str')
  })

  it('populates command with trailing space when Tab is pressed on /str', async () => {
    harness.input = '/str'
    vi.stubGlobal('document', { body: {} })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    const send = vi.fn(async () => {})
    const session = { isActive: false, expiresAt: 0 } as SessionKeyConfig

    renderToStaticMarkup(React.createElement(ArcCopilotDrawer, {
      isOpen: true,
      onClose: vi.fn(),
      messages: [],
      currentSteps: [],
      isAnalyzing: false,
      sessionConfig: session,
      onSendMessage: send,
      onClearChat: vi.fn(),
      onActivateSession: async () => session,
      onRevokeSession: vi.fn(),
      onToggleAutoExecute: vi.fn(),
      onExecuteInline: async () => {},
    }))

    const textbox = findElement(harness.portal, e => e.type === 'input' && e.props.placeholder?.startsWith('Type a command'))!
    const preventDefault = vi.fn()
    textbox.props.onKeyDown({ key: 'Tab', preventDefault })

    expect(preventDefault).toHaveBeenCalled()
    // Tab autocompletes, should not immediately dispatch to agent
    expect(send).not.toHaveBeenCalled()
  })

  it('does not dispatch immediately for parameterized commands like /sw on Enter, instead keeps it in input', async () => {
    harness.input = '/sw'
    vi.stubGlobal('document', { body: {} })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() })
    const send = vi.fn(async () => {})
    const session = { isActive: false, expiresAt: 0 } as SessionKeyConfig

    renderToStaticMarkup(React.createElement(ArcCopilotDrawer, {
      isOpen: true,
      onClose: vi.fn(),
      messages: [],
      currentSteps: [],
      isAnalyzing: false,
      sessionConfig: session,
      onSendMessage: send,
      onClearChat: vi.fn(),
      onActivateSession: async () => session,
      onRevokeSession: vi.fn(),
      onToggleAutoExecute: vi.fn(),
      onExecuteInline: async () => {},
    }))

    const textbox = findElement(harness.portal, e => e.type === 'input' && e.props.placeholder?.startsWith('Type a command'))!
    const preventDefault = vi.fn()
    textbox.props.onKeyDown({ key: 'Enter', preventDefault })

    expect(preventDefault).toHaveBeenCalled()
    // /swap expects parameters, so it must not send immediately to agent
    expect(send).not.toHaveBeenCalled()
  })
})

