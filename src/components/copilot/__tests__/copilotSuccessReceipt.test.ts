// src/components/copilot/__tests__/copilotSuccessReceipt.test.ts
// Verifies the CopilotSuccessReceipt adapter: an InlineExecutionReceipt is mapped onto the
// shared corporate UnifiedSuccessReceipt template with per-type fields, the verified fee rows,
// and the corporate footer (receipt reference, settlement time, latency).

import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The sound service touches localStorage at import time; the receipt visual does not depend on it.
vi.mock('../../../services/soundService', () => ({ playSound: vi.fn() }))
// Wallet client + chain fee resolver are only used for the async fee paths; keep them inert.
vi.mock('../../../services/modularWalletService', () => ({ getModularPublicClient: () => null }))
vi.mock('../../../services/arcGasService', () => ({
  resolveArcActualFeeUsdc: vi.fn().mockResolvedValue({
    feeUsdc: null,
    baseFeeUsdcExact: null,
    priorityFeeUsdcExact: null,
  }),
}))

import CopilotSuccessReceipt from '../CopilotSuccessReceipt'
import type { InlineExecutionReceipt } from '../../../types/sessionKey'

function render(receipt: Partial<InlineExecutionReceipt>): string {
  const full: InlineExecutionReceipt = {
    id: 'rcpt_1735689600000',
    actionType: 'send',
    title: 'Send Completed Successfully',
    status: 'SUCCESS',
    txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    gasUsdc: 0.00053,
    settlementLatencyMs: 912,
    timestamp: 1735689600000,
    ...receipt,
  }
  return renderToStaticMarkup(React.createElement(CopilotSuccessReceipt, { receipt: full }))
}

const baseSend: Partial<InlineExecutionReceipt> = {
  amountIn: 10,
  fromToken: 'USDC',
  recipient: '0x4545412345678901234567890123456789014584',
}

describe('CopilotSuccessReceipt adapter', () => {
  it('caps the template to its own heading with the compact centered width wrapper', () => {
    const html = render(baseSend)

    // Shrink-to-fit wrapper; the heading measurement (client-side) sets the inline width inside it,
    // and `max-w-full` keeps the card inside the chat bubble on narrow drawers.
    const wrapperIdx = html.indexOf('class="w-fit max-w-full mx-auto"')
    const headingIdx = html.indexOf('Send Completed Successfully')
    expect(wrapperIdx).toBeGreaterThanOrEqual(0)
    expect(headingIdx).toBeGreaterThan(wrapperIdx)
  })

  it('renders a send receipt on the shared template with amount and abbreviated recipient', () => {
    const html = render(baseSend)

    // Corporate template markers (the execution-service title passes through unchanged)
    expect(html).toContain('Send Completed Successfully')
    expect(html).toContain('Sent Amount')
    expect(html).toContain('10 USDC')

    // Abbreviated recipient in the corporate `0x454541...014584` form
    expect(html).toContain('0x454541...014584')

    // Explorer link
    expect(html).toContain('ArcScan')
  })

  it('renders a swap receipt with paid/received rows on one corporate format', () => {
    const html = render({
      actionType: 'swap',
      title: 'Swap Completed Successfully',
      fromToken: 'USDC',
      toToken: 'EURC',
      amountIn: 25,
      amountOut: 23.1,
      txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    })

    expect(html).toContain('Swap Completed Successfully')
    expect(html).toContain('You Paid')
    expect(html).toContain('You Received')
    expect(html).toContain('25 USDC')
    expect(html).toContain('23.1 EURC')
  })

  it('renders a bridge receipt with the cross-chain route', () => {
    const html = render({
      actionType: 'bridge',
      title: 'Bridge Completed Successfully',
      fromChain: 'Arc_Testnet',
      toChain: 'Base_Sepolia',
      amountIn: 100,
      txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    })

    expect(html).toContain('Bridge Completed Successfully')
    expect(html).toContain('Route:')
    expect(html).toContain('Base Sepolia')
  })

  it('renders a deposit receipt with the vault APY row', () => {
    const html = render({
      actionType: 'deposit',
      title: 'Deposit Completed Successfully',
      amountIn: 500,
      apy: '8.42%',
      txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    })

    expect(html).toContain('Deposit Completed Successfully')
    expect(html).toContain('Deposited Amount')
    expect(html).toContain('Yield Vault APY')
    expect(html).toContain('8.42%')
  })

  it('renders a faucet receipt with the claimed amount', () => {
    const html = render({
      actionType: 'faucet',
      title: 'Faucet Claim Completed Successfully',
      amountOut: 1000,
      txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    })

    expect(html).toContain('Faucet Claim Completed Successfully')
    expect(html).toContain('Claimed Amount')
    expect(html).toContain('+1000 USDC')
  })

  it('renders an ai_service receipt with the paid amount', () => {
    const html = render({
      actionType: 'ai_service',
      title: 'AI Service Completed Successfully',
      amountIn: 0.25,
      txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    })

    expect(html).toContain('AI Service Completed Successfully')
    expect(html).toContain('Amount Paid')
    expect(html).toContain('x402 AI Service Settlement')
  })

  it('carries the verified on-chain fee into the metadata card', () => {
    const html = render({
      ...baseSend,
      actualGasUsdc: 0.000053,
    })

    expect(html).toContain('Network Fee:')
    expect(html).toContain('0.000053 USDC')
  })

  it('omits the fee rows when no verified fee is available', () => {
    const html = render({ ...baseSend, actualGasUsdc: null })

    expect(html).not.toContain('Network Fee:')
    expect(html).not.toContain('0.00053 USDC')
  })

  it('omits the corporate footer when no receipt metadata exists', () => {
    const html = renderToStaticMarkup(
      React.createElement(CopilotSuccessReceipt, {
        receipt: {
          id: 'rcpt_1',
          actionType: 'send',
          title: 'Send Completed Successfully',
          status: 'SUCCESS',
          txHash: '',
          gasUsdc: 0,
          settlementLatencyMs: 0,
          timestamp: 0,
        },
      })
    )

    expect(html).not.toContain('Settlement:')
    expect(html).not.toContain('ARC-')
  })
})
