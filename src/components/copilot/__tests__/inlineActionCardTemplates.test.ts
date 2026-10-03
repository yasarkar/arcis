// src/components/copilot/__tests__/inlineActionCardTemplates.test.ts
// Verifies the institutionalized, standardized Copilot action card templates:
// - Unified card shell (header with badge, hero asset panel, details table, action buttons)
// - Operation-specific headers, badges, metrics, and breakdown fields for Swap, Send, Bridge, Yield, and Session

import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('../../../services/soundService', () => ({ playSound: vi.fn() }))
vi.mock('../../../services/tokenPriceService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/tokenPriceService')>()
  return {
    ...actual,
    getLiveTokenPrices: vi.fn().mockResolvedValue({
      USDC: 1,
      EURC: 1.08,
      cirBTC: 65000,
    }),
  }
})

import InlineActionCard from '../InlineActionCard'
import type { CopilotMessage, CopilotActionPayload } from '../../../types/marketplace'

function renderAction(actionPayload: CopilotActionPayload): string {
  const message: CopilotMessage = {
    id: 'msg-preview-1',
    role: 'assistant',
    content: 'Review the transaction below',
    timestamp: Date.now(),
    actionPayload,
  }

  return renderToStaticMarkup(
    React.createElement(InlineActionCard, {
      message,
      onExecuteInline: async () => {},
      onNavigateToTab: () => {},
      onCloseDrawer: () => {},
    })
  )
}

describe('InlineActionCard Institutional Templates', () => {
  it('renders a standardized Swap Order template with operation header, hero conversion and pool specs', () => {
    const html = renderAction({
      type: 'interactive_swap',
      title: 'Swap 50 USDC to EURC',
      data: {
        amount: 50,
        fromToken: 'USDC',
        toToken: 'EURC',
        estimatedOut: 46.25,
        minReceived: 45.8,
        slippage: 0.5,
        estimatedFeeUsdc: 0.00053,
      },
    })

    // Header
    expect(html).toContain('Token Swap')
    expect(html).toContain('Arc Testnet AMM')

    // Hero Panel (You Pay -> Estimated Receive)
    expect(html).toContain('You Pay')
    expect(html).toContain('50')
    expect(html).toContain('Estimated Receive')
    expect(html).toContain('~46.25')

    // Details Rows
    expect(html).toContain('Exchange Rate')
    expect(html).toContain('1 USDC ≈ 0.9250 EURC')
    expect(html).toContain('Minimum Received')
    expect(html).toContain('45.8 EURC')
    expect(html).toContain('Slippage Tolerance')
    expect(html).toContain('0.5%')
    expect(html).toContain('Network Fee')

    // Action Buttons
    expect(html).toContain('Confirm Swap')
    expect(html).toContain('Swap Page')
  })

  it('renders Quote Required when Swap quote is not available', () => {
    const html = renderAction({
      type: 'interactive_swap',
      title: 'Swap 10 USDC to EURC',
      data: {
        amount: 10,
        fromToken: 'USDC',
        toToken: 'EURC',
        estimatedOut: 0,
      },
    })

    expect(html).toContain('Quote Required')
    expect(html).toContain('disabled=""')
  })

  it('renders a standardized Direct Transfer template with recipient copy button, memo, and L1 gas note', () => {
    const html = renderAction({
      type: 'interactive_send',
      title: 'Send 25 USDC',
      data: {
        amount: 25,
        tokenSymbol: 'USDC',
        recipient: '0x5f8f4cc0403332fc9c22a23222ddb9b267bf2e70',
        memo: 'Invoice 1024',
        estimatedFeeUsdc: 0.000053,
      },
    })

    // Header
    expect(html).toContain('Token Transfer')
    expect(html).toContain('Arc Testnet')

    // Hero Panel
    expect(html).toContain('Transfer Amount')
    expect(html).toContain('25')

    // Details Rows
    expect(html).toContain('Recipient')
    expect(html).toContain('0x5f8f4c...bf2e70')
    expect(html).toContain('<button')
    expect(html).toContain('Memo')
    expect(html).toContain('&quot;Invoice 1024&quot;')
    expect(html).toContain('Network Fee')
    expect(html).toContain('Finality')
    expect(html).toContain('Instant (&lt; 1s)')

    // Buttons
    expect(html).toContain('Confirm Transfer')
    expect(html).toContain('Send Page')
  })

  it('renders a standardized Cross-Chain Bridge template with route badges, CCTP indicator and speed', () => {
    const html = renderAction({
      type: 'interactive_bridge',
      title: 'Bridge 100 USDC',
      data: {
        amount: 100,
        fromChain: 'Arc Testnet',
        toChain: 'Base Sepolia',
      },
    })

    // Header
    expect(html).toContain('Cross-Chain Bridge')
    expect(html).toContain('Circle Gateway')

    // Hero Panel
    expect(html).toContain('Bridge Amount')
    expect(html).toContain('100')
    expect(html).toContain('Base Sepolia')

    // Details Rows
    expect(html).toContain('Bridge Route')
    expect(html).toContain('Arc Testnet ➔ Base Sepolia')
    expect(html).toContain('Circle Gateway')
    expect(html).toContain('Transfer Speed')
    expect(html).toContain('&lt; 30s')
    expect(html).toContain('Protocol Fee')
    expect(html).toContain('0 USDC')

    // Buttons
    expect(html).toContain('Confirm Bridge')
    expect(html).toContain('Bridge Page')
  })

  it('renders a standardized Yield Vault Deposit template with APY, strategy and 1Y yield projection', () => {
    const html = renderAction({
      type: 'interactive_deposit',
      title: 'Deposit 200 USDC into YieldVault',
      data: {
        amount: 200,
        estimatedYieldUsdcYearly: 16.84,
      },
    })

    // Header
    expect(html).toContain('Yield Vault Deposit')
    expect(html).toContain('Continuous Compounding')

    // Hero Panel
    expect(html).toContain('Deposit Amount')
    expect(html).toContain('200')
    expect(html).toContain('Est. 1Y Yield')
    expect(html).toContain('+16.84')
    expect(html).toContain('Variable APY (~8.4% Benchmark)')

    // Details Rows
    expect(html).toContain('Vault Strategy')
    expect(html).toContain('USDC Yield Vault')
    expect(html).toContain('APY')
    expect(html).toContain('Variable (Simulated ~8.4%)')
    expect(html).toContain('Continuous (Per-Block)')
    expect(html).toContain('None (Instant Liquidity)')

    // Buttons
    expect(html).toContain('Confirm Deposit')
    expect(html).toContain('Pool Page')
  })

  it('renders a standardized Session Security Configuration template with policy rows and action button', () => {
    const html = renderAction({
      type: 'configure_session',
      title: 'Configure Autonomous Session Policy',
      data: {},
    })

    // Header
    expect(html).toContain('Session Key Authorization')
    expect(html).toContain('Smart Account Policy')

    // Hero Panel
    expect(html).toContain('Autonomous Execution')
    expect(html).toContain('Zero-Popup')

    // Details Rows
    expect(html).toContain('Execution Mode')
    expect(html).toContain('Zero-Popup Autonomous')
    expect(html).toContain('Gas Paymaster')
    expect(html).toContain('100% Circle Gas Station')
    expect(html).toContain('Spending Policy')
    expect(html).toContain('Per-Tx &amp; Daily USDC Caps')

    // Button
    expect(html).toContain('Configure Autonomous Session Policy')
  })
})
