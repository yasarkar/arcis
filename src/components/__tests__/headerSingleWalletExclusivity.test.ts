import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  account: { isConnected: false, address: undefined as string | undefined },
  multiChain: {
    solana: { isConnected: false, address: '', balance: { sol: '0.0000', usdc: '0.00', isLoading: false } },
    disconnectSolana: vi.fn(),
    refreshSolanaBalance: vi.fn(),
    injective: { isConnected: false, address: '' },
    disconnectInjective: vi.fn(),
  },
}))

vi.mock('wagmi', () => ({
  useAccount: () => mocks.account,
  useSwitchChain: () => ({ switchChain: vi.fn(), chains: [] }),
}))

vi.mock('../../hooks/useMultiChainWallet', () => ({
  useMultiChainWallet: () => mocks.multiChain,
}))

vi.mock('../../config/walletConfigStore', () => ({
  requestFullWalletConnect: vi.fn(),
}))

import Header from '../Header'

describe('Header Single Wallet Exclusivity', () => {
  it('renders both triggers when no wallet is connected', () => {
    mocks.account.isConnected = false
    mocks.account.address = undefined
    mocks.multiChain.solana.isConnected = false
    mocks.multiChain.injective.isConnected = false

    const html = renderToStaticMarkup(
      React.createElement(Header, {
        activeTab: 'home',
        setActiveTab: vi.fn(),
        walletConnected: false,
        walletAddress: '',
        isUcwConnected: false,
        isPasskeyConnected: false,
        activeAuthSource: null,
      })
    )

    expect(html).toContain('Circle &amp; Passkey')
    expect(html).toContain('Connect Wallet')
  })

  it('renders only Circle UCW and completely hides Connect Wallet / EVM when Circle is connected', () => {
    mocks.account.isConnected = false
    mocks.account.address = undefined
    mocks.multiChain.solana.isConnected = false

    const ucwAddr = '0x1111222233334444555566667777888899990000'
    const html = renderToStaticMarkup(
      React.createElement(Header, {
        activeTab: 'home',
        setActiveTab: vi.fn(),
        walletConnected: true,
        walletAddress: ucwAddr,
        isUcwConnected: true,
        ucwAddress: ucwAddr,
        activeAuthSource: 'ucw',
      })
    )

    // Circle address should be visible (abbreviated 0x1111...0000)
    expect(html).toContain('0x1111...0000')
    // Connect Wallet trigger must be hidden
    expect(html).not.toContain('Connect Wallet')
    // Circle & Passkey trigger button must be hidden
    expect(html).not.toContain('Circle &amp; Passkey')
    // Solana badge must be hidden
    expect(html).not.toContain('Sol:')
  })

  it('renders only EVM and completely hides Circle triggers when EVM is connected', () => {
    mocks.account.isConnected = true
    mocks.account.address = '0x1234567890abcdef1234567890abcdef12345678'
    mocks.multiChain.solana.isConnected = false

    const html = renderToStaticMarkup(
      React.createElement(Header, {
        activeTab: 'home',
        setActiveTab: vi.fn(),
        walletConnected: true,
        walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
        isUcwConnected: false,
        isPasskeyConnected: false,
        activeAuthSource: 'evm',
      })
    )

    // EVM display name should be visible
    expect(html).toContain('0x1234...5678')
    // Circle & Passkey login trigger button must be completely hidden
    expect(html).not.toContain('Circle &amp; Passkey')
    // Connect Wallet trigger is not visible because EVM is already connected
    expect(html).not.toContain('Connect Wallet')
  })
})

