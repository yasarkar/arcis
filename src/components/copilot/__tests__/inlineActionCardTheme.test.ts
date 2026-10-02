// src/components/copilot/__tests__/inlineActionCardTheme.test.ts
// Verifies the transaction outcome themes: success = green, user cancel = amber, error = red.

import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
// The sound service touches localStorage at import time; the visual themes do not depend on it.
vi.mock('../../../services/soundService', () => ({ playSound: vi.fn() }))
import InlineActionCard from '../InlineActionCard'
import type { CopilotMessage } from '../../../types/marketplace'
import type { InlineExecutionReceipt } from '../../../types/sessionKey'

function render(receipt: InlineExecutionReceipt): string {
  const message: CopilotMessage = {
    id: 'msg-1',
    role: 'assistant',
    content: 'Transfer prepared',
    timestamp: Date.now(),
    receipt,
  }

  return renderToStaticMarkup(
    React.createElement(InlineActionCard, {
      message,
      onExecuteInline: async () => {},
      onCloseDrawer: () => {},
    })
  )
}

const baseReceipt: InlineExecutionReceipt = {
  id: 'rcpt-1',
  actionType: 'send',
  title: 'Send Completed Successfully',
  status: 'SUCCESS',
  txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  gasUsdc: 0.00053,
  settlementLatencyMs: 900,
  timestamp: Date.now(),
}

describe('InlineActionCard outcome themes', () => {
  it('uses the green (emerald) theme for a successful transaction', () => {
    const html = render(baseReceipt)

    // Success now renders through the shared corporate receipt template: the emerald
    // glowing status ring, with no amber (cancel) or rose (error) borders anywhere.
    expect(html).toContain('border-emerald-500/35')
    expect(html).toContain('text-emerald-300')
    expect(html).not.toContain('border-amber-500/40')
    expect(html).not.toContain('border-rose-500/50')
  })

  it('uses the orange (amber) theme and cancel copy when the user cancels a transfer', () => {
    const html = render({
      ...baseReceipt,
      title: 'Transfer Cancelled',
      status: 'CANCELED',
      txHash: '',
      errorMessage: 'Transaction canceled by user. Try again whenever you are ready.',
    })

    expect(html).toContain('border-amber-500/40')
    expect(html).not.toContain('border-rose-500/50')
    expect(html).toContain('Transfer Cancelled')
    expect(html).not.toContain('Transfer Failed')
    expect(html).toContain('Transaction canceled by user. Try again whenever you are ready.')
  })

  it('uses the red (rose) theme for other errors', () => {
    const html = render({
      ...baseReceipt,
      title: 'Transfer Failed: 10 USDC',
      status: 'FAILED',
      txHash: '',
      errorMessage: 'Insufficient USDC balance on Arc Testnet.',
    })

    expect(html).toContain('border-rose-500/50')
    expect(html).not.toContain('border-amber-500/40')
  })

  it('shows the corporate send receipt: amount row, shortened recipient and a clean explorer link', () => {
    const recipient = '0x4545412345678901234567890123456789014584'
    const html = render({
      ...baseReceipt,
      title: 'Send Completed Successfully',
      amountIn: 10,
      fromToken: 'USDC',
      recipient,
    })

    // Corporate primary card: amount + token with the icon carrying the symbol.
    expect(html).toContain('Sent Amount')
    expect(html).toContain('10 USDC')
    expect(html).toContain('alt="USDC"')

    // Recipient row with the corporate `0x454541...014584` abbreviation + copy control.
    expect(html).toContain('Recipient')
    expect(html).toContain('0x454541...014584')
    expect(html).toContain('<button')

    // The explorer link label no longer embeds the raw transaction hash (it lives in the href only).
    expect(html).toContain('ArcScan')
    expect(html).not.toContain('View on')
    expect(html).not.toContain('>0xabcdef1234567890')
  })

  it('shows only the verified on-chain fee and omits estimates when no receipt fee is available', () => {
    const html = render({ ...baseReceipt, actualGasUsdc: 0.000053 })
    expect(html).toContain('Network Fee:')
    expect(html).toContain('0.000053 USDC')

    const unavailableHtml = render({ ...baseReceipt, actualGasUsdc: null })
    expect(unavailableHtml).not.toContain('Network Fee:')
    expect(unavailableHtml).not.toContain('0.00053 USDC')
  })

  it('treats a FAILED receipt whose message reads as a cancellation as amber, not red', () => {
    const html = render({
      ...baseReceipt,
      title: 'Transfer Failed: 10 USDC',
      status: 'FAILED',
      txHash: '',
      errorMessage: 'User rejected the request',
    })

    expect(html).toContain('border-amber-500/40')
    expect(html).not.toContain('border-rose-500/50')
  })
})
