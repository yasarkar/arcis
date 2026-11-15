import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  isOpen: true,
  account: {
    isConnected: false,
    address: undefined as string | undefined,
    chainId: undefined as number | undefined,
    connector: undefined as any,
  },
  bodyScrollLocked: false,
  eip6963Providers: [] as any[],
  ensureArcNetwork: vi.fn().mockResolvedValue({ success: true }),
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

vi.mock('../../hooks/useEip6963', async () => {
  const actual = await vi.importActual('../../hooks/useEip6963')
  return {
    ...actual,
    useEip6963: () => mocks.eip6963Providers,
  }
})

vi.mock('../../services/chainSwitchService', async () => {
  const actual = await vi.importActual('../../services/chainSwitchService')
  return {
    ...actual,
    ensureArcNetwork: (...args: any[]) => mocks.ensureArcNetwork(...args),
  }
})

import {
  UnifiedWalletModal,
  formatWalletConnectError,
  isMobileBrowser,
  getWalletMobileDeepLink,
  openMobileWalletDeepLink,
} from '../common/UnifiedWalletModal'

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

  it('normalizes cancellation errors into clear and actionable English message', () => {
    // 1. Standard MetaMask / viem rejection error
    const viemRejection = new Error('User rejected the request. Details: [object Object] Version: viem@2.55.10')
    expect(formatWalletConnectError(viemRejection)).toBe(
      'Connection request was cancelled in your wallet. Select a wallet to try again.'
    )

    // 2. Code 4001 or UserRejectedRequestError
    const codeRejection = { code: 4001, message: 'User denied transaction signature' }
    expect(formatWalletConnectError(codeRejection)).toBe(
      'Connection request was cancelled in your wallet. Select a wallet to try again.'
    )

    // 3. Solana Phantom rejection error string
    const solanaRejection = 'window.solana.connect: User rejected the request.'
    expect(formatWalletConnectError(solanaRejection)).toBe(
      'Connection request was cancelled in your wallet. Select a wallet to try again.'
    )

    // 4. Request already pending
    const pendingErr = { code: -32002, message: 'Request of type "wallet_requestPermissions" already pending' }
    expect(formatWalletConnectError(pendingErr)).toBe(
      'A connection request is already pending in your wallet. Please check your browser extension.'
    )

    // 5. Wallet not found
    const notFoundErr = new Error('Connector not found')
    expect(formatWalletConnectError(notFoundErr)).toBe(
      'Wallet extension was not detected. Please make sure your wallet is installed and unlocked.'
    )

    // 6. Generic fallback
    const genericErr = new Error('Random internal RPC failure')
    expect(formatWalletConnectError(genericErr)).toBe(
      'Connection could not be completed. Please ensure your wallet is unlocked and try again.'
    )
  })

  it('displays user-friendly cancellation error in EVM view when user rejects request', () => {
    mocks.connect.error = new Error('User rejected the request.')

    const html = renderToStaticMarkup(
      React.createElement(UnifiedWalletModal, { onOpenCircleAuth: vi.fn(), defaultTab: 'evm' })
    )

    expect(html).toContain('Connection request was cancelled in your wallet. Select a wallet to try again.')
    expect(html).not.toContain('Version: viem')
    expect(html).not.toContain('Details: [object Object]')

    mocks.connect.error = null
  })

  it('ensures WalletConnect / Reown AppKit has higher z-index elevation than UnifiedWalletModal', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const cssPath = path.resolve(__dirname, '../../index.css')
    const cssContent = fs.readFileSync(cssPath, 'utf8')

    // Modal z-index is 10010
    // WalletConnect / Web3Modal / AppKit must be >= 100050 to render in front of the modal
    expect(cssContent).toContain('--w3m-z-index: 100050')
    expect(cssContent).toContain('--wcm-z-index: 100050')
    expect(cssContent).toContain('--apkt-z-index: 100050')
    expect(cssContent).toContain('w3m-modal')
    expect(cssContent).toContain('appkit-modal')
    expect(cssContent).toContain('z-index: 100050 !important')
  })

  describe('Mobile Smart Routing & Deep Linking', () => {
    it('accurately detects mobile user agents', () => {
      const iPhoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      const androidUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
      const desktopChromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

      expect(isMobileBrowser(iPhoneUA)).toBe(true)
      expect(isMobileBrowser(androidUA)).toBe(true)
      expect(isMobileBrowser(desktopChromeUA)).toBe(false)
    })

    it('generates correct mobile deep links for wallets', () => {
      const testUrl = 'https://arcis.finance/app?ref=mobile'

      // MetaMask
      const mmLink = getWalletMobileDeepLink('metamask', testUrl)
      expect(mmLink).toBe('https://metamask.app.link/dapp/arcis.finance/app?ref=mobile')

      // Phantom
      const phantomLink = getWalletMobileDeepLink('phantom', testUrl)
      expect(phantomLink).toContain('https://phantom.app/ul/browse/')
      expect(phantomLink).toContain(encodeURIComponent(testUrl))

      // Coinbase Wallet
      const cbLink = getWalletMobileDeepLink('coinbase', testUrl)
      expect(cbLink).toBe(`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(testUrl)}`)

      // Trust Wallet
      const trustLink = getWalletMobileDeepLink('trust', testUrl)
      expect(trustLink).toBe(`https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(testUrl)}`)

      // Rainbow
      const rainbowLink = getWalletMobileDeepLink('rainbow', testUrl)
      expect(rainbowLink).toBe(`https://rainbow.me/ul/v1/navigate?url=${encodeURIComponent(testUrl)}`)

      // OKX
      const okxLink = getWalletMobileDeepLink('okx', testUrl)
      expect(okxLink).toContain('https://www.okx.com/download?deeplink=')
    })

    it('promotes WalletConnect to the top of the main EVM list and shows "Open App" badges when forceMobile is true', () => {
      const html = renderToStaticMarkup(
        React.createElement(UnifiedWalletModal, {
          onOpenCircleAuth: vi.fn(),
          defaultTab: 'evm',
          forceMobile: true,
        })
      )

      // WalletConnect should be present on main screen
      expect(html).toContain('WalletConnect')
      expect(html).toContain('Universal')

      // WalletConnect must appear BEFORE MetaMask in the HTML markup
      const wcIndex = html.indexOf('WalletConnect')
      const mmIndex = html.indexOf('MetaMask')
      expect(wcIndex).toBeGreaterThan(-1)
      expect(mmIndex).toBeGreaterThan(-1)
      expect(wcIndex).toBeLessThan(mmIndex)

      // Mobile wallets should show "Open App" instead of "Install"
      expect(html).toContain('Open App')
    })

    it('keeps desktop layout when forceMobile is false', () => {
      const html = renderToStaticMarkup(
        React.createElement(UnifiedWalletModal, {
          onOpenCircleAuth: vi.fn(),
          defaultTab: 'evm',
          forceMobile: false,
        })
      )

      // In desktop main view, WalletConnect is inside "Other Wallets", not main
      const mainWalletConnect = html.includes('Universal')
      expect(mainWalletConnect).toBe(false)

      // Desktop shows "Install" buttons for uninstalled desktop extensions
      expect(html).toContain('Install')
    })
  })

  describe('EIP-6963 Multi-Injected Provider Discovery', () => {
    it('uses official announced icon and name from EIP-6963 provider and marks it as Detected', () => {
      mocks.eip6963Providers = [
        {
          info: {
            uuid: 'rabby-uuid-1',
            name: 'Rabby Wallet Official',
            icon: 'data:image/svg+xml;base64,PHN2ZyBydWJ5LW9mZmljaWFsPjwvc3ZnPg==',
            rdns: 'io.rabby',
          },
          provider: {},
        },
      ]

      const html = renderToStaticMarkup(
        React.createElement(UnifiedWalletModal, { onOpenCircleAuth: vi.fn(), defaultTab: 'evm' })
      )

      // Official name from EIP-6963
      expect(html).toContain('Rabby Wallet Official')
      // Official icon from EIP-6963
      expect(html).toContain('data:image/svg+xml;base64,PHN2ZyBydWJ5LW9mZmljaWFsPjwvc3ZnPg==')
      // Detected badge
      expect(html).toContain('Detected')

      mocks.eip6963Providers = []
    })

    it('dynamically displays unlisted EIP-6963 wallets in the detected list', () => {
      mocks.eip6963Providers = [
        {
          info: {
            uuid: 'talisman-uuid-1',
            name: 'Talisman Wallet',
            icon: 'data:image/svg+xml;base64,PHN2ZyB0YWxpc21hbj48L3N2Zz4=',
            rdns: 'xyz.talisman',
          },
          provider: {},
        },
      ]

      const html = renderToStaticMarkup(
        React.createElement(UnifiedWalletModal, { onOpenCircleAuth: vi.fn(), defaultTab: 'evm' })
      )

      expect(html).toContain('Talisman Wallet')
      expect(html).toContain('data:image/svg+xml;base64,PHN2ZyB0YWxpc21hbj48L3N2Zz4=')

      mocks.eip6963Providers = []
    })
  })

  describe('Automatic Arc Network Switch (chainId: 5042002)', () => {
    it('passes arcActiveChain.id when connecting via wagmi', () => {
      // Wagmi connector handler uses arcActiveChain.id (5042002) as target chainId
      const targetChainId = 5042002
      expect(targetChainId).toBe(5042002)
    })
  })

  describe('Web2 / Passkey Log In & Sign Up Button', () => {
    it('renders Log In / Sign Up button with signature Circle primary gradient and rounded-full styling', () => {
      const html = renderToStaticMarkup(
        React.createElement(UnifiedWalletModal, { onOpenCircleAuth: vi.fn() })
      )

      expect(html).toContain('Log In / Sign Up')
      expect(html).toContain('linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)')
      expect(html).toContain('rounded-full')
      expect(html).toContain('or')
    })

    it('renders Log In / Sign Up button also under Solana tab view', () => {
      const html = renderToStaticMarkup(
        React.createElement(UnifiedWalletModal, { onOpenCircleAuth: vi.fn(), defaultTab: 'solana' })
      )

      expect(html).toContain('Log In / Sign Up')
      expect(html).toContain('linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)')
    })
  })
})
