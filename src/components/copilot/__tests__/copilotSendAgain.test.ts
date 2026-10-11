// src/components/copilot/__tests__/copilotSendAgain.test.ts
// Verifies that clicking "Send Again" (or action again) reconstructs the transaction command
// and dispatches it back to the chat via onSendMessage.

import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../../services/soundService', () => ({ playSound: vi.fn() }))
vi.mock('../../../services/modularWalletService', () => ({ getModularPublicClient: () => null }))
vi.mock('../../../services/arcGasService', () => ({
  resolveArcActualFeeUsdc: vi.fn().mockResolvedValue({
    feeUsdc: null,
    baseFeeUsdcExact: null,
    priorityFeeUsdcExact: null,
  }),
}))
vi.mock('../../../services/tokenPriceService', () => ({
  getLiveTokenPrices: vi.fn().mockResolvedValue({ USDC: 1, EURC: 1.08 }),
}))

import { buildActionAgainCommand } from '../InlineActionCard'
import CopilotSuccessReceipt from '../CopilotSuccessReceipt'
import type { InlineExecutionReceipt } from '../../../types/sessionKey'
import type { CopilotActionPayload } from '../../../types/marketplace'

describe('Send Again and Action Again command dispatch', () => {
  it('renders "SEND AGAIN" button in static HTML for a successful send receipt', () => {
    const receipt: InlineExecutionReceipt = {
      id: 'rcpt_send_1',
      actionType: 'send',
      title: 'Send Completed Successfully',
      status: 'SUCCESS',
      txHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      amountIn: 1,
      fromToken: 'USDC',
      recipient: '0x36176FB9EEeeEB12A48945DA7e441dc1cE6596A2',
      gasUsdc: 0.0005,
      settlementLatencyMs: 500,
      timestamp: Date.now(),
    }

    const html = renderToStaticMarkup(
      React.createElement(CopilotSuccessReceipt, {
        receipt,
        onActionAgain: () => {},
      })
    )

    expect(html).toContain('SEND AGAIN')
  })

  describe('buildActionAgainCommand helper', () => {
    it('reconstructs standard send command from receipt', () => {
      const receipt: InlineExecutionReceipt = {
        id: 'rcpt_1',
        actionType: 'send',
        title: 'Send Completed Successfully',
        status: 'SUCCESS',
        txHash: '0x123',
        amountIn: 1,
        fromToken: 'USDC',
        recipient: '0x36176FB9EEeeEB12A48945DA7e441dc1cE6596A2',
        gasUsdc: 0.0005,
        settlementLatencyMs: 500,
        timestamp: Date.now(),
      }

      const cmd = buildActionAgainCommand(receipt, null)
      expect(cmd).toBe('send 1 USDC to 0x36176FB9EEeeEB12A48945DA7e441dc1cE6596A2')
    })

    it('uses a plain decimal instead of scientific notation for tiny repeated sends', () => {
      expect(buildActionAgainCommand(null, {
        type: 'interactive_send', title: '',
        data: { amount: 1e-18, tokenSymbol: 'WETH', recipient: '0x2222222222222222222222222222222222222222' },
      })).toBe('send 0.000000000000000001 WETH to 0x2222222222222222222222222222222222222222')
    })

    it('reconstructs send command with memo from receipt', () => {
      const receipt: InlineExecutionReceipt = {
        id: 'rcpt_2',
        actionType: 'send',
        title: 'Send Completed Successfully',
        status: 'SUCCESS',
        txHash: '0x123',
        amountIn: 5,
        fromToken: 'USDC',
        recipient: '0x36176FB9EEeeEB12A48945DA7e441dc1cE6596A2',
        memo: 'invoice-42',
        gasUsdc: 0.0005,
        settlementLatencyMs: 500,
        timestamp: Date.now(),
      }

      const cmd = buildActionAgainCommand(receipt, null)
      expect(cmd).toBe('send 5 USDC to 0x36176FB9EEeeEB12A48945DA7e441dc1cE6596A2 with memo "invoice-42"')
    })

    it('falls back to actionPayload data if receipt amount or recipient is missing', () => {
      const receipt: InlineExecutionReceipt = {
        id: 'rcpt_3',
        actionType: 'send',
        title: 'Send Completed Successfully',
        status: 'SUCCESS',
        txHash: '0x123',
        gasUsdc: 0.0005,
        settlementLatencyMs: 500,
        timestamp: Date.now(),
      }

      const payload: CopilotActionPayload = {
        type: 'interactive_send',
        title: 'Send',
        data: {
          amount: 2.5,
          tokenSymbol: 'cirBTC',
          recipient: '0x5f8f4cC0403332fC9c22a23222DDb9B267BF2E70',
        },
      }

      const cmd = buildActionAgainCommand(receipt, payload)
      expect(cmd).toBe('send 2.5 cirBTC to 0x5f8f4cC0403332fC9c22a23222DDb9B267BF2E70')
    })

    it('reconstructs swap command from receipt', () => {
      const receipt: InlineExecutionReceipt = {
        id: 'rcpt_swap',
        actionType: 'swap',
        title: 'Swap Completed',
        status: 'SUCCESS',
        txHash: '0x123',
        amountIn: 25,
        fromToken: 'USDC',
        toToken: 'EURC',
        gasUsdc: 0.0005,
        settlementLatencyMs: 500,
        timestamp: Date.now(),
      }

      const cmd = buildActionAgainCommand(receipt, null)
      expect(cmd).toBe('swap 25 USDC to EURC')
    })

    it('reconstructs bridge command from receipt', () => {
      const receipt: InlineExecutionReceipt = {
        id: 'rcpt_bridge',
        actionType: 'bridge',
        title: 'Bridge Completed',
        status: 'SUCCESS',
        txHash: '0x123',
        amountIn: 50,
        fromChain: 'Arc Testnet',
        toChain: 'Ethereum Sepolia',
        gasUsdc: 0.0005,
        settlementLatencyMs: 500,
        timestamp: Date.now(),
      }

      const cmd = buildActionAgainCommand(receipt, null)
      expect(cmd).toBe('bridge 50 USDC from Arc Testnet to Ethereum Sepolia')
    })

    it('reconstructs deposit command from receipt', () => {
      const receipt: InlineExecutionReceipt = {
        id: 'rcpt_deposit',
        actionType: 'deposit',
        title: 'Deposit Completed',
        status: 'SUCCESS',
        txHash: '0x123',
        amountIn: 100,
        gasUsdc: 0.0005,
        settlementLatencyMs: 500,
        timestamp: Date.now(),
      }

      const cmd = buildActionAgainCommand(receipt, null)
      expect(cmd).toBe('deposit 100 USDC')
    })

    it('reconstructs faucet claim command', () => {
      const receipt: InlineExecutionReceipt = {
        id: 'rcpt_faucet',
        actionType: 'faucet',
        title: 'Faucet Claimed',
        status: 'SUCCESS',
        txHash: '0x123',
        gasUsdc: 0,
        settlementLatencyMs: 500,
        timestamp: Date.now(),
      }

      const cmd = buildActionAgainCommand(receipt, null)
      expect(cmd).toBe('claim faucet')
    })
  })
})
