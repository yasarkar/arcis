import React from 'react'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BroadcastCard,
  shortenAddress,
  type BroadcastMessage,
} from '../BroadcastNotification'

describe('BroadcastNotification Session Template & Address Formatting', () => {
  it('shortens 42-char hex addresses to 0x1234...5678 format while preserving case', () => {
    expect(shortenAddress('0x5f8f1234567890abcdef2E70')).toBe('0x5f8f...2E70')
    expect(shortenAddress('0x1234567890123456789012345678901234567890')).toBe('0x1234...7890')
  })

  it('renders session funding broadcast card with clickable shortened explorer addresses', () => {
    const broadcast: BroadcastMessage = {
      id: 'test-fund',
      type: 'session',
      title: 'Funding Session Enclave',
      status: 'pending',
      badgeText: 'Transferring',
      details: {
        sessionAction: 'fund',
        amount: '2.50',
        tokenSymbol: 'USDC',
        budgetUsdc: 2.5,
        enclaveAddress: '0x1234567890123456789012345678901234567890',
        userAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        network: 'Arc_Testnet',
        durationHours: 24,
        autoExecute: true,
        sessionScope: 'marketplace',
      },
    }

    const html = renderToStaticMarkup(
      React.createElement(BroadcastCard, {
        broadcast,
        onRemove: () => {},
      })
    )

    expect(html).toContain('Funding Session Enclave')
    expect(html).toContain('Transferring')
    expect(html).toContain('2.50')
    expect(html).toContain('USDC')
    expect(html).toContain('Arc Testnet')
    // Enclave address link with label, shortened format, and explorer url
    expect(html).toContain('Enclave (0x1234...7890)')
    expect(html).toContain('https://testnet.arcscan.app/address/0x1234567890123456789012345678901234567890')
    // User address link with shortened format and explorer url
    expect(html).toContain('0xabcd...abcd')
    expect(html).toContain('https://testnet.arcscan.app/address/0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')
    // Clickable text-white style with hover to text-indigo-400 & top-right arrow translation
    expect(html).toContain('text-white')
    expect(html).toContain('group-hover/addr:text-indigo-400')
    expect(html).toContain('group-hover/addr:translate-x-0.5')
    expect(html).toContain('group-hover/addr:-translate-y-0.5')
    expect(html).toContain('lucide-square-arrow-out-up-right')
    expect(html).not.toContain('hover:underline')
  })

  it('renders session sweep broadcast card with transaction link', () => {
    const broadcast: BroadcastMessage = {
      id: 'test-sweep',
      type: 'session',
      title: 'Enclave Funds Swept',
      status: 'success',
      badgeText: 'Success',
      details: {
        sessionAction: 'sweep',
        amount: '5.00',
        tokenSymbol: 'USDC',
        enclaveAddress: '0x1234567890123456789012345678901234567890',
        userAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        network: 'Arc_Testnet',
        txHash: '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
        sessionScope: 'copilot',
      },
    }

    const html = renderToStaticMarkup(
      React.createElement(BroadcastCard, {
        broadcast,
        onRemove: () => {},
      })
    )

    expect(html).toContain('Enclave Funds Swept')
    expect(html).toContain('+5.00')
    expect(html).toContain('USDC')
    expect(html).toContain('Arcscan')
    expect(html).toContain('testnet.arcscan.app/tx/0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff')
    expect(html).toContain('https://testnet.arcscan.app/address/0x1234567890123456789012345678901234567890')
  })

  it('renders policy update metadata pills with clickable enclave address', () => {
    const broadcast: BroadcastMessage = {
      id: 'test-update',
      type: 'session',
      title: 'Session Policy Updated',
      status: 'success',
      badgeText: 'Success',
      details: {
        sessionAction: 'update',
        budgetUsdc: 10,
        durationHours: 168,
        autoExecute: true,
        enclaveAddress: '0x1234567890123456789012345678901234567890',
        network: 'Arc_Testnet',
        sessionScope: 'marketplace',
      },
    }

    const html = renderToStaticMarkup(
      React.createElement(BroadcastCard, {
        broadcast,
        onRemove: () => {},
      })
    )

    expect(html).toContain('Session Policy Updated')
    expect(html).toContain('7d')
    expect(html).toContain('Zero-Popup')
    expect(html).toContain('x402 AI Services')
    expect(html).toContain('0x1234...7890')
    expect(html).toContain('https://testnet.arcscan.app/address/0x1234567890123456789012345678901234567890')
  })
})
