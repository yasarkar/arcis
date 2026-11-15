import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  isOpen: true,
  account: { isConnected: false },
  bodyScrollLocked: false,
  connect: {
    connectors: [
      { id: 'injected', name: 'Injected' },
      { id: 'metaMask', name: 'MetaMask' },
      { id: 'coinbaseWalletSDK', name: 'Coinbase Wallet' },
      { id: 'walletConnect', name: 'WalletConnect' },
    ],
    connect: vi.fn(),
    isPending: false,
    error: null as any,
  },
  multiChain: {
    solana: {
      isConnected: false,
      address: '',
      providerName: 'phantom' as const,
      isConnecting: false,
      error: null,
      balance: { sol: '0', usdc: '0', isLoading: false },
    },
    connectSolana: vi.fn(),
    isSolanaInstalled: vi.fn().mockResolvedValue(true),
  },
}))

vi.mock('wagmi', () => ({
  useAccount: () => mocks.account,
  useConnect: () => mocks.connect,
}))

vi.mock('../../hooks/useMultiChainWallet', () => ({
  useMultiChainWallet: () => mocks.multiChain,
}))

vi.mock('../../hooks/useBodyScrollLock', () => ({
  useBodyScrollLock: (locked: boolean) => {
    mocks.bodyScrollLocked = locked
  },
}))

vi.mock('../../config/walletConfigStore', () => ({
  closeWalletModal: vi.fn(),
  getIsWalletModalOpen: () => mocks.isOpen,
  subscribeWalletConfig: (listener: () => void) => () => {},
}))

import { UnifiedWalletModal } from '../common/UnifiedWalletModal'

describe('UnifiedWalletModal (Uniswap inspired layout)', () => {
  it('renders Connect Wallet header and EVM tab by default', () => {
    const html = renderToStaticMarkup(
      React.createElement(UnifiedWalletModal, { onOpenCircleAuth: vi.fn() })
    )

    // Top Header
    expect(html).toContain('Connect Wallet')

    // Backdrop blur and styling
    expect(html).toContain('backdrop-blur-md')
    expect(html).toContain('bg-black/80')
    expect(mocks.bodyScrollLocked).toBe(true)

    // Segmented Switcher
    expect(html).toContain('EVM')
    expect(html).toContain('Solana')

    // Default EVM Wallets list
    expect(html).toContain('MetaMask')
    expect(html).toContain('OKX Wallet')
    expect(html).toContain('Phantom')
    expect(html).toContain('Rabby Wallet')
    expect(html).toContain('Other Wallets')

    // Excluded items from main view
    expect(html).not.toContain('Uniswap Mobile')
    expect(html).not.toContain('Hesap oluştur')
    expect(html).not.toContain('Giriş yap')
    expect(html).not.toContain('>veya<')

    // Legal terms disclaimer
    expect(html).toContain("Terms of Service")
    expect(html).toContain("Privacy Policy")
  })

  it('renders Coinbase, Binance, Trust, Rainbow, Zerion and WalletConnect under Other Wallets view', () => {
    const html = renderToStaticMarkup(
      React.createElement(UnifiedWalletModal, {
        onOpenCircleAuth: vi.fn(),
        initialSubView: 'other_wallets',
      })
    )

    expect(html).toContain('Other Wallets')
    expect(html).toContain('Coinbase Wallet')
    expect(html).toContain('Binance Wallet')
    expect(html).toContain('Trust Wallet')
    expect(html).toContain('Rainbow')
    expect(html).toContain('Zerion')
    expect(html).toContain('WalletConnect')
    expect(html).toContain('Install')
  })

  it('does not render when closed', () => {
    mocks.isOpen = false
    const html = renderToStaticMarkup(
      React.createElement(UnifiedWalletModal, { onOpenCircleAuth: vi.fn() })
    )
    expect(html).toBe('')
    mocks.isOpen = true
  })

  it('renders expanded Solana wallets when in Solana mode', () => {
    const html = renderToStaticMarkup(
      React.createElement(UnifiedWalletModal, { onOpenCircleAuth: vi.fn(), defaultTab: 'solana' })
    )

    expect(html).toContain('Connect Wallet')
    expect(html).toContain('Phantom')
    expect(html).toContain('Solflare')
    expect(html).toContain('Backpack')
    expect(html).toContain('OKX Wallet')
    expect(html).toContain('Coinbase Wallet')
    expect(html).toContain('Trust Wallet')
  })

  it('renders official SVG icon images for all wallet options', () => {
    const evmHtml = renderToStaticMarkup(
      React.createElement(UnifiedWalletModal, { onOpenCircleAuth: vi.fn(), defaultTab: 'evm' })
    )
    expect(evmHtml).toContain('alt="MetaMask"')
    expect(evmHtml).toContain('alt="OKX Wallet"')
    expect(evmHtml).toContain('alt="Phantom"')
    expect(evmHtml).toContain('alt="Rabby Wallet"')
    expect(evmHtml).toContain('text-slate-300')

    const otherHtml = renderToStaticMarkup(
      React.createElement(UnifiedWalletModal, { onOpenCircleAuth: vi.fn(), initialSubView: 'other_wallets' })
    )
    expect(otherHtml).toContain('alt="Coinbase Wallet"')
    expect(otherHtml).toContain('alt="Binance Wallet"')
    expect(otherHtml).toContain('alt="Trust Wallet"')
    expect(otherHtml).toContain('alt="Rainbow"')
    expect(otherHtml).toContain('alt="Zerion"')
    expect(otherHtml).toContain('alt="WalletConnect"')

    const solanaHtml = renderToStaticMarkup(
      React.createElement(UnifiedWalletModal, { onOpenCircleAuth: vi.fn(), defaultTab: 'solana' })
    )
    expect(solanaHtml).toContain('alt="Phantom"')
    expect(solanaHtml).toContain('alt="Solflare"')
    expect(solanaHtml).toContain('alt="Backpack"')
    expect(solanaHtml).toContain('alt="OKX Wallet"')
    expect(solanaHtml).toContain('alt="Coinbase Wallet"')
    expect(solanaHtml).toContain('alt="Trust Wallet"')
  })

  it('orders EVM wallets by Recent -> Detected -> Install -> Other Wallets', () => {
    const html = renderToStaticMarkup(
      React.createElement(UnifiedWalletModal, { onOpenCircleAuth: vi.fn(), defaultTab: 'evm' })
    )

    // MetaMask is default recent, so it must appear before uninstalled and before Other Wallets
    const metaMaskIdx = html.indexOf('MetaMask')
    const otherWalletsIdx = html.indexOf('Other Wallets')

    expect(metaMaskIdx).toBeGreaterThan(-1)
    expect(otherWalletsIdx).toBeGreaterThan(metaMaskIdx)
  })
})
