import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { UnifiedSuccessReceipt } from '../fintech/UnifiedSuccessReceipt'
import { SendSuccessReceipt } from '../fintech/SendSuccessReceipt'
import { SwapSuccessReceipt } from '../fintech/SwapSuccessReceipt'
import { BridgeSuccessReceipt } from '../fintech/BridgeSuccessReceipt'

describe('Receipt Recipient Visibility Rules', () => {
  const OWN_WALLET = '0x1111111111111111111111111111111111111111'
  const OTHER_WALLET = '0x2222222222222222222222222222222222222222'

  describe('SendSuccessReceipt', () => {
    it('omits recipient row when sending to the connected wallet', () => {
      const html = renderToStaticMarkup(
        React.createElement(SendSuccessReceipt, {
          amount: '10',
          tokenSymbol: 'USDC',
          recipient: OWN_WALLET,
          connectedAddress: OWN_WALLET,
          network: 'Arc_Testnet',
          onSendAgain: () => {},
        })
      )

      expect(html).toContain('Sent Amount')
      expect(html).not.toContain('Recipient')
    })

    it('renders recipient row when sending to an external/different wallet', () => {
      const html = renderToStaticMarkup(
        React.createElement(SendSuccessReceipt, {
          amount: '10',
          tokenSymbol: 'USDC',
          recipient: OTHER_WALLET,
          connectedAddress: OWN_WALLET,
          network: 'Arc_Testnet',
          onSendAgain: () => {},
        })
      )

      expect(html).toContain('Sent Amount')
      expect(html).toContain('Recipient')
      expect(html).toContain('0x222222...222222')
    })

    it('handles case-insensitive comparison correctly (same wallet in different casing)', () => {
      const html = renderToStaticMarkup(
        React.createElement(SendSuccessReceipt, {
          amount: '10',
          tokenSymbol: 'USDC',
          recipient: OWN_WALLET.toUpperCase(),
          connectedAddress: OWN_WALLET.toLowerCase(),
          network: 'Arc_Testnet',
          onSendAgain: () => {},
        })
      )

      expect(html).toContain('Sent Amount')
      expect(html).not.toContain('Recipient')
    })
  })

  describe('BridgeSuccessReceipt', () => {
    it('omits recipient row when bridging to connected wallet', () => {
      const html = renderToStaticMarkup(
        React.createElement(BridgeSuccessReceipt, {
          amount: '25',
          sourceChain: 'Arc_Testnet',
          destChain: 'Base_Sepolia',
          sourceChainName: 'Arc Testnet',
          destChainName: 'Base Sepolia',
          sourceIconId: 'arc',
          destIconId: 'base',
          recipient: OWN_WALLET,
          connectedAddress: OWN_WALLET,
          mode: 'direct',
          onBridgeAgain: () => {},
        })
      )

      expect(html).toContain('Bridged Amount')
      expect(html).not.toContain('Recipient:')
    })

    it('renders recipient row when bridging to a different external wallet', () => {
      const html = renderToStaticMarkup(
        React.createElement(BridgeSuccessReceipt, {
          amount: '25',
          sourceChain: 'Arc_Testnet',
          destChain: 'Base_Sepolia',
          sourceChainName: 'Arc Testnet',
          destChainName: 'Base Sepolia',
          sourceIconId: 'arc',
          destIconId: 'base',
          recipient: OTHER_WALLET,
          connectedAddress: OWN_WALLET,
          mode: 'direct',
          onBridgeAgain: () => {},
        })
      )

      expect(html).toContain('Bridged Amount')
      expect(html).toContain('Recipient:')
      expect(html).toContain('0x222222...222222')
    })
  })

  describe('SwapSuccessReceipt', () => {
    it('omits recipient row when swapping to own connected wallet', () => {
      const html = renderToStaticMarkup(
        React.createElement(SwapSuccessReceipt, {
          amountIn: '100',
          amountOut: '99.5',
          tokenIn: 'USDC',
          tokenOut: 'EURC',
          fromChain: 'Arc_Testnet',
          toChain: 'Arc_Testnet',
          recipient: OWN_WALLET,
          connectedAddress: OWN_WALLET,
          onSwapAgain: () => {},
        })
      )

      expect(html).toContain('You Paid')
      expect(html).toContain('You Received')
      expect(html).not.toContain('Recipient:')
    })

    it('renders recipient row when swapping to an external recipient address', () => {
      const html = renderToStaticMarkup(
        React.createElement(SwapSuccessReceipt, {
          amountIn: '100',
          amountOut: '99.5',
          tokenIn: 'USDC',
          tokenOut: 'EURC',
          fromChain: 'Arc_Testnet',
          toChain: 'Arc_Testnet',
          recipient: OTHER_WALLET,
          connectedAddress: OWN_WALLET,
          onSwapAgain: () => {},
        })
      )

      expect(html).toContain('You Paid')
      expect(html).toContain('You Received')
      expect(html).toContain('Recipient:')
      expect(html).toContain('0x222222...222222')
    })
  })

  describe('UnifiedSuccessReceipt fallback behavior', () => {
    it('renders recipient when connectedAddress is not provided and recipient is present', () => {
      const html = renderToStaticMarkup(
        React.createElement(UnifiedSuccessReceipt, {
          type: 'send',
          amount: '10',
          tokenSymbol: 'USDC',
          recipient: OTHER_WALLET,
          onActionAgain: () => {},
        })
      )

      expect(html).toContain('Recipient')
    })

    it('omits recipient when recipient is not provided', () => {
      const html = renderToStaticMarkup(
        React.createElement(UnifiedSuccessReceipt, {
          type: 'send',
          amount: '10',
          tokenSymbol: 'USDC',
          onActionAgain: () => {},
        })
      )

      expect(html).not.toContain('Recipient')
    })
  })
})
