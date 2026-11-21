import React, { useState, useEffect, useMemo, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useConnect, useAccount } from 'wagmi'
import { X, ArrowLeft, ArrowRight, Loader2, QrCode, ChevronRight, ExternalLink, AlertCircle, CheckCircle2, Wallet } from 'lucide-react'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import {
  closeWalletModal,
  getIsWalletModalOpen,
  subscribeWalletConfig,
} from '../../config/walletConfigStore'
import { useMultiChainWallet } from '../../hooks/useMultiChainWallet'
import {
  SOLANA_WALLET_INSTALL_URLS,
} from '../../services/solanaWalletStorage'
import type { SolanaWalletProvider } from '../../types/multiChainWallet'
import { isUserCanceledError } from '../../utils/errorNormalizer'
import { PinnedNetworkIcon } from './PinnedIcons'
import {
  useEip6963,
  findEip6963Provider,
  WALLET_RDNS_MAP,
  type EIP6963ProviderDetail,
} from '../../hooks/useEip6963'
import { arcActiveChain } from '../../config/networks/networkRegistry'
import { ensureArcNetwork } from '../../services/chainSwitchService'

// Official wallet SVG icons from src/assets/wallets/
import metamaskSvg from '../../assets/wallets/metamask.svg'
import okxSvg from '../../assets/wallets/okx.svg'
import phantomSvg from '../../assets/wallets/phantom.svg'
import rabbySvg from '../../assets/wallets/rabby.svg'
import coinbaseSvg from '../../assets/wallets/coinbase.svg'
import binanceSvg from '../../assets/wallets/binance.svg'
import trustSvg from '../../assets/wallets/trust.svg'
import rainbowSvg from '../../assets/wallets/rainbow.svg'
import zerionSvg from '../../assets/wallets/zerion.svg'
import walletconnectSvg from '../../assets/wallets/walletconnect.svg'
import solflareSvg from '../../assets/wallets/solflare.svg'
import backpackSvg from '../../assets/wallets/backpack.svg'

interface UnifiedWalletModalProps {
  onOpenCircleAuth?: () => void
  defaultTab?: 'evm' | 'solana'
  initialSubView?: 'main' | 'other_wallets'
  forceMobile?: boolean
}

interface ModalWalletItem {
  id: string
  name: string
  icon: React.ReactNode
  isInstalled: boolean
  isNavigation?: boolean
  badgeIcon?: React.ReactNode
  installUrl?: string
}

const STORAGE_LAST_WALLET = 'arcis_last_connected_wallet'

export const EVM_WALLET_INSTALL_URLS: Record<string, string> = {
  metamask: 'https://metamask.io/download/',
  okx: 'https://www.okx.com/web3',
  phantom: 'https://phantom.app/download',
  rabby: 'https://rabby.io/',
  coinbase: 'https://www.coinbase.com/wallet',
  binance: 'https://www.binance.com/en/web3wallet',
  trust: 'https://trustwallet.com/download',
  rainbow: 'https://rainbow.me/',
  zerion: 'https://zerion.io/download',
}

/**
 * Detects whether the current browser session is running on a mobile or tablet device.
 * Supports passing a custom User-Agent string for deterministic test coverage.
 */
export function isMobileBrowser(customUserAgent?: string): boolean {
  if (typeof window === 'undefined' && !customUserAgent) return false
  const ua = customUserAgent || (typeof navigator !== 'undefined' ? (navigator.userAgent || navigator.vendor || '') : '')
  const isTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints && navigator.maxTouchPoints > 1
  return Boolean(
    /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua) ||
    (Boolean(isTouch) && /Macintosh/.test(ua))
  )
}

/**
 * Returns the mobile deep link / universal link for opening a dApp directly inside
 * the corresponding mobile wallet application.
 */
export function getWalletMobileDeepLink(walletId: string, currentUrl?: string): string | null {
  const fullUrl = currentUrl || (typeof window !== 'undefined' ? window.location.href : 'https://arcis.finance/')
  const urlNoProtocol = fullUrl.replace(/^https?:\/\//i, '')

  switch (walletId) {
    case 'metamask':
      // Official MetaMask Universal Link: https://metamask.app.link/dapp/<url_no_protocol>
      return `https://metamask.app.link/dapp/${urlNoProtocol}`
    case 'phantom':
      // Official Phantom Universal Link: https://phantom.app/ul/browse/<url>?ref=<ref>
      return `https://phantom.app/ul/browse/${encodeURIComponent(fullUrl)}?ref=${encodeURIComponent(fullUrl)}`
    case 'coinbase':
      // Official Coinbase Wallet Universal Link: https://go.cb-w.com/dapp?cb_url=<encoded_url>
      return `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(fullUrl)}`
    case 'trust':
      // Official Trust Wallet Universal Link: https://link.trustwallet.com/open_url?coin_id=60&url=<encoded_url>
      return `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(fullUrl)}`
    case 'rainbow':
      // Official Rainbow Universal Link: https://rainbow.me/ul/v1/navigate?url=<encoded_url>
      return `https://rainbow.me/ul/v1/navigate?url=${encodeURIComponent(fullUrl)}`
    case 'okx':
      // Official OKX Universal Deep Link
      return `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${encodeURIComponent(fullUrl)}`)}`
    case 'solflare':
      // Official Solflare Universal Link: https://solflare.com/ul/v1/browse/<url>?ref=<ref>
      return `https://solflare.com/ul/v1/browse/${encodeURIComponent(fullUrl)}?ref=${encodeURIComponent(fullUrl)}`
    case 'backpack':
      // Official Backpack Universal Link: https://backpack.app/ul/v1/browse/<url>
      return `https://backpack.app/ul/v1/browse/${encodeURIComponent(fullUrl)}`
    default:
      return null
  }
}

/**
 * Triggers mobile deep link navigation or falls back to standard external URL.
 */
export function openMobileWalletDeepLink(walletId: string, fallbackUrl?: string): boolean {
  if (typeof window === 'undefined') return false
  const deepLink = getWalletMobileDeepLink(walletId)
  if (deepLink) {
    try {
      window.location.href = deepLink
      return true
    } catch {
      if (fallbackUrl) {
        window.open(fallbackUrl, '_blank', 'noopener,noreferrer')
        return true
      }
    }
  } else if (fallbackUrl) {
    window.open(fallbackUrl, '_blank', 'noopener,noreferrer')
    return true
  }
  return false
}

/**
 * Normalizes wallet connection errors into user-friendly, clear English messages,
 * preventing raw RPC stack traces, viem internal error codes, or confusing technical jargon.
 */
export function formatWalletConnectError(err: unknown): string {
  if (!err) return ''

  if (isUserCanceledError(err)) {
    return 'Connection request was cancelled in your wallet. Select a wallet to try again.'
  }

  const rawMessage = typeof err === 'string'
    ? err
    : ((err as any)?.shortMessage || (err as any)?.message || (err as any)?.details || String(err))
  const lowMsg = rawMessage.toLowerCase()

  // 1. Pending request in wallet (code -32002)
  const code = (err as any)?.code ?? (err as any)?.cause?.code
  if (
    code === -32002 ||
    lowMsg.includes('already pending') ||
    lowMsg.includes('resource unavailable') ||
    lowMsg.includes('resource not available')
  ) {
    return 'A connection request is already pending in your wallet. Please check your browser extension.'
  }

  // 2. Extension / Provider not detected
  if (
    lowMsg.includes('not found') ||
    lowMsg.includes('not installed') ||
    lowMsg.includes('connectornotfound') ||
    lowMsg.includes('provider not found')
  ) {
    return 'Wallet extension was not detected. Please make sure your wallet is installed and unlocked.'
  }

  // 3. Network / Chain issue
  if (lowMsg.includes('unsupported chain') || lowMsg.includes('wrong network') || lowMsg.includes('chain not supported')) {
    return 'Unsupported network. Please switch to Arc Testnet or another supported network.'
  }

  // 4. Clean fallback without technical jargon
  return 'Connection could not be completed. Please ensure your wallet is unlocked and try again.'
}

// Reusable official wallet icon renderer
function WalletIcon({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      className="w-7 h-7 rounded-xl object-contain shrink-0 shadow-sm"
      loading="lazy"
    />
  )
}

export const UnifiedWalletModal: React.FC<UnifiedWalletModalProps> = ({
  onOpenCircleAuth,
  defaultTab = 'evm',
  initialSubView = 'main',
  forceMobile,
}) => {
  const isMobile = forceMobile !== undefined ? forceMobile : isMobileBrowser()

  const isOpen = useSyncExternalStore(
    subscribeWalletConfig,
    getIsWalletModalOpen,
    getIsWalletModalOpen
  )

  // Apply background body scroll lock when modal is open
  useBodyScrollLock(isOpen)

  // Default to EVM as requested by the user
  const [activeTab, setActiveTab] = useState<'evm' | 'solana'>(defaultTab)
  const [subView, setSubView] = useState<'main' | 'other_wallets'>(initialSubView)
  const {
    isConnected: isEvmConnected,
    address: evmAddress,
    chainId: evmChainId,
    connector: activeConnector,
  } = useAccount()
  const { connectors, connect, isPending: isEvmPending, error: evmError, reset: resetEvmConnect } = useConnect()
  const { solana, connectSolana, isSolanaInstalled } = useMultiChainWallet()

  const [solanaInstalledState, setSolanaInstalledState] = useState<Record<string, boolean>>({})
  const [solanaConnecting, setSolanaConnecting] = useState<string | null>(null)
  const [solanaError, setSolanaError] = useState<string | null>(null)
  const [connectingWalletKey, setConnectingWalletKey] = useState<string | null>(null)

  // Track recent wallet
  const [recentWallet, setRecentWallet] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_LAST_WALLET) || 'metamask'
    } catch {
      return 'metamask'
    }
  })

  // EIP-6963 Multi-Injected Provider Discovery
  const eip6963Providers = useEip6963()

  // Match announced EIP-6963 providers (conflict-free)
  const metaMaskEip = findEip6963Provider(eip6963Providers, 'metamask')
  const rabbyEip = findEip6963Provider(eip6963Providers, 'rabby')
  const okxEip = findEip6963Provider(eip6963Providers, 'okx')
  const phantomEip = findEip6963Provider(eip6963Providers, 'phantom')
  const coinbaseEip = findEip6963Provider(eip6963Providers, 'coinbase')
  const binanceEip = findEip6963Provider(eip6963Providers, 'binance')
  const trustEip = findEip6963Provider(eip6963Providers, 'trust')
  const rainbowEip = findEip6963Provider(eip6963Providers, 'rainbow')
  const zerionEip = findEip6963Provider(eip6963Providers, 'zerion')

  // Helper to safely check window properties without throwing
  const safeCheck = (fn: () => boolean): boolean => {
    try {
      return typeof window !== 'undefined' && Boolean(fn())
    } catch {
      return false
    }
  }

  // Detect installed EVM extensions safely (EIP-6963 announced providers first, falling back to legacy window flags)
  const hasMetaMask = Boolean(metaMaskEip) || safeCheck(() => (window as any).ethereum?.isMetaMask && !(window as any).ethereum?.isRabby)
  const hasRabby = Boolean(rabbyEip) || safeCheck(() => (window as any).ethereum?.isRabby)
  const hasOkx = Boolean(okxEip) || safeCheck(() => (window as any).okxwallet || (window as any).ethereum?.isOkxWallet)
  const hasPhantomEvm = Boolean(phantomEip) || safeCheck(() => (window as any).phantom?.ethereum)
  const hasCoinbase = Boolean(coinbaseEip) || safeCheck(() => (window as any).coinbaseWalletExtension || (window as any).ethereum?.isCoinbaseWallet)
  const hasBinance = Boolean(binanceEip) || safeCheck(() =>
    (window as any).BinanceChain || (window as any).binance || (window as any).ethereum?.isBinance || (window as any).ethereum?.isBinanceWallet
  )
  const hasTrust = Boolean(trustEip) || safeCheck(() =>
    (window as any).trustwallet || (window as any).ethereum?.isTrust || (window as any).ethereum?.isTrustWallet
  )
  const hasRainbow = Boolean(rainbowEip) || safeCheck(() => (window as any).ethereum?.isRainbow)
  const hasZerion = Boolean(zerionEip) || safeCheck(() => (window as any).zerionWallet || (window as any).ethereum?.isZerion)

  // Reset subView whenever modal opens or tab changes
  useEffect(() => {
    if (!isOpen) {
      setSubView('main')
      setSolanaError(null)
      resetEvmConnect?.()
    }
  }, [isOpen, resetEvmConnect])

  useEffect(() => {
    setSubView('main')
    setSolanaError(null)
    resetEvmConnect?.()
  }, [activeTab, resetEvmConnect])

  // Check Solana extension installation when modal opens or tab changes
  useEffect(() => {
    if (!isOpen) return
    let mounted = true
    const providers: SolanaWalletProvider[] = [
      'phantom',
      'solflare',
      'backpack',
      'okx',
      'coinbase',
      'trust',
    ]

    void Promise.all(
      providers.map(async (p) => {
        const installed = await isSolanaInstalled(p)
        return [p, installed] as const
      })
    ).then((results) => {
      if (!mounted) return
      setSolanaInstalledState(Object.fromEntries(results))
    })

    return () => {
      mounted = false
    }
  }, [isOpen, isSolanaInstalled, activeTab])

  // Close modal on Escape key (or go back if in subView)
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (subView === 'other_wallets') {
          setSubView('main')
        } else {
          closeWalletModal()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, subView])

  // Close modal automatically on successful EVM connection and ensure Arc Network (chainId: 5042002)
  useEffect(() => {
    if (isOpen && isEvmConnected && evmAddress) {
      closeWalletModal()

      if (evmChainId && evmChainId !== arcActiveChain.id) {
        void (async () => {
          try {
            const provider = typeof (activeConnector as any)?.getProvider === 'function'
              ? ((await (activeConnector as any).getProvider()) as any)
              : ((window as any)?.ethereum ?? null)
            await ensureArcNetwork(provider)
          } catch (err) {
            console.warn('[UnifiedWalletModal] Auto-switch to Arc Network skipped or declined:', err)
          }
        })()
      }
    }
  }, [isOpen, isEvmConnected, evmAddress, evmChainId, activeConnector])

  const handleEvmConnect = (connector: any, walletKey: string) => {
    setConnectingWalletKey(walletKey)
    connect(
      {
        connector,
        chainId: arcActiveChain.id,
      },
      {
        onSuccess: async (data: any) => {
          try {
            localStorage.setItem(STORAGE_LAST_WALLET, walletKey)
            setRecentWallet(walletKey)
          } catch (err) {
            console.debug('[UnifiedWalletModal] Failed to persist recent wallet:', err)
          }
          closeWalletModal()

          const connectedChainId = data?.chainId || evmChainId
          if (connectedChainId && connectedChainId !== arcActiveChain.id) {
            try {
              const provider = typeof (connector as any)?.getProvider === 'function'
                ? ((await (connector as any).getProvider()) as any)
                : ((window as any)?.ethereum ?? null)
              await ensureArcNetwork(provider)
            } catch (err) {
              console.warn('[UnifiedWalletModal] Auto-switch to Arc Network skipped or declined:', err)
            }
          }
        },
        onSettled: () => {
          setConnectingWalletKey(null)
        },
      }
    )
  }

  const findConnectorForWallet = (walletId: string, eipDetail?: EIP6963ProviderDetail) => {
    if (eipDetail) {
      const rdns = eipDetail.info.rdns.toLowerCase()
      const name = eipDetail.info.name.toLowerCase()
      const match = connectors.find((c) => {
        const cId = c.id.toLowerCase()
        const cRdns = ((c as any).rdns || '').toLowerCase()
        const cName = c.name.toLowerCase()
        return cId === rdns || cRdns === rdns || cName === name
      })
      if (match) return match
    }
    // Fallback to searching connectors by walletId or name
    return connectors.find(
      (c) => c.id.toLowerCase().includes(walletId) || c.name.toLowerCase().includes(walletId)
    )
  }

  const handleEvmWalletClick = (walletId: string) => {
    if (walletId === 'walletconnect') {
      const wcConnector = connectors.find(
        (c) => c.id.toLowerCase().includes('walletconnect') || c.name.toLowerCase().includes('walletconnect')
      )
      if (wcConnector) {
        handleEvmConnect(wcConnector, 'walletconnect')
        return
      }
      const fallback = connectors[0]
      if (fallback) handleEvmConnect(fallback, 'walletconnect')
      return
    }

    // 1. Direct EIP-6963 provider resolution (conflict-free)
    const matchingEip = eip6963Providers.find(
      (p) =>
        p.info.rdns.toLowerCase() === walletId.toLowerCase() ||
        (WALLET_RDNS_MAP[walletId.toLowerCase()] || []).some((r) =>
          p.info.rdns.toLowerCase().includes(r.toLowerCase())
        )
    )

    if (matchingEip) {
      const eipConnector = findConnectorForWallet(walletId, matchingEip)
      if (eipConnector) {
        handleEvmConnect(eipConnector, walletId)
        return
      }
    }

    if (walletId === 'binance') {
      const binanceConnector = connectors.find(
        (c) => c.id.toLowerCase().includes('binance') || c.name.toLowerCase().includes('binance')
      )
      if (binanceConnector) {
        handleEvmConnect(binanceConnector, 'binance')
        return
      }
      const inj = connectors.find((c) => c.id === 'injected') || connectors[0]
      if (inj && hasBinance) {
        handleEvmConnect(inj, 'binance')
        return
      }
      if (!hasBinance && typeof window !== 'undefined') {
        if (isMobile) {
          openMobileWalletDeepLink('binance', EVM_WALLET_INSTALL_URLS.binance)
          return
        }
        window.open(EVM_WALLET_INSTALL_URLS.binance, '_blank')
        return
      }
      if (inj) {
        handleEvmConnect(inj, 'binance')
        return
      }
    }

    if (walletId === 'coinbase') {
      const cbConnector = connectors.find(
        (c) => c.id.toLowerCase().includes('coinbase') || c.name.toLowerCase().includes('coinbase')
      )
      if (cbConnector) {
        handleEvmConnect(cbConnector, 'coinbase')
        return
      }
      if (!hasCoinbase && typeof window !== 'undefined') {
        if (isMobile) {
          openMobileWalletDeepLink('coinbase', EVM_WALLET_INSTALL_URLS.coinbase)
          return
        }
        window.open(EVM_WALLET_INSTALL_URLS.coinbase, '_blank')
        return
      }
      const inj = connectors.find((c) => c.id === 'injected') || connectors[0]
      if (inj) {
        handleEvmConnect(inj, 'coinbase')
        return
      }
    }

    if (walletId === 'trust') {
      const trustConnector = connectors.find(
        (c) => c.id.toLowerCase().includes('trust') || c.name.toLowerCase().includes('trust')
      )
      if (trustConnector) {
        handleEvmConnect(trustConnector, 'trust')
        return
      }
      const inj = connectors.find((c) => c.id === 'injected') || connectors[0]
      if (inj && hasTrust) {
        handleEvmConnect(inj, 'trust')
        return
      }
      if (!hasTrust && typeof window !== 'undefined') {
        if (isMobile) {
          openMobileWalletDeepLink('trust', EVM_WALLET_INSTALL_URLS.trust)
          return
        }
        window.open(EVM_WALLET_INSTALL_URLS.trust, '_blank')
        return
      }
      if (inj) {
        handleEvmConnect(inj, 'trust')
        return
      }
    }

    if (walletId === 'rainbow') {
      const rainbowConnector = connectors.find(
        (c) => c.id.toLowerCase().includes('rainbow') || c.name.toLowerCase().includes('rainbow')
      )
      if (rainbowConnector) {
        handleEvmConnect(rainbowConnector, 'rainbow')
        return
      }
      const inj = connectors.find((c) => c.id === 'injected') || connectors[0]
      if (inj && hasRainbow) {
        handleEvmConnect(inj, 'rainbow')
        return
      }
      if (!hasRainbow && typeof window !== 'undefined') {
        if (isMobile) {
          openMobileWalletDeepLink('rainbow', EVM_WALLET_INSTALL_URLS.rainbow)
          return
        }
        window.open(EVM_WALLET_INSTALL_URLS.rainbow, '_blank')
        return
      }
      if (inj) {
        handleEvmConnect(inj, 'rainbow')
        return
      }
    }

    if (walletId === 'zerion') {
      const zerionConnector = connectors.find(
        (c) => c.id.toLowerCase().includes('zerion') || c.name.toLowerCase().includes('zerion')
      )
      if (zerionConnector) {
        handleEvmConnect(zerionConnector, 'zerion')
        return
      }
      const inj = connectors.find((c) => c.id === 'injected') || connectors[0]
      if (inj && hasZerion) {
        handleEvmConnect(inj, 'zerion')
        return
      }
      if (!hasZerion && typeof window !== 'undefined') {
        if (isMobile) {
          openMobileWalletDeepLink('zerion', EVM_WALLET_INSTALL_URLS.zerion)
          return
        }
        window.open(EVM_WALLET_INSTALL_URLS.zerion, '_blank')
        return
      }
      if (inj) {
        handleEvmConnect(inj, 'zerion')
        return
      }
    }

    if (walletId === 'metamask') {
      const mmConnector = connectors.find(
        (c) => c.id.toLowerCase().includes('metamask') || c.name.toLowerCase().includes('metamask')
      )
      if (mmConnector) {
        handleEvmConnect(mmConnector, 'metamask')
        return
      }
      const inj = connectors.find((c) => c.id === 'injected') || connectors[0]
      if (inj && hasMetaMask) {
        handleEvmConnect(inj, 'metamask')
        return
      }
      if (!hasMetaMask && typeof window !== 'undefined') {
        if (isMobile) {
          openMobileWalletDeepLink('metamask', EVM_WALLET_INSTALL_URLS.metamask)
          return
        }
        window.open(EVM_WALLET_INSTALL_URLS.metamask, '_blank')
        return
      }
      if (inj) {
        handleEvmConnect(inj, 'metamask')
        return
      }
    }

    if (walletId === 'okx') {
      const okxConnector = connectors.find(
        (c) => c.id.toLowerCase().includes('okx') || c.name.toLowerCase().includes('okx')
      )
      if (okxConnector) {
        handleEvmConnect(okxConnector, 'okx')
        return
      }
      const inj = connectors.find((c) => c.id === 'injected') || connectors[0]
      if (inj && hasOkx) {
        handleEvmConnect(inj, 'okx')
        return
      }
      if (!hasOkx && typeof window !== 'undefined') {
        if (isMobile) {
          openMobileWalletDeepLink('okx', EVM_WALLET_INSTALL_URLS.okx)
          return
        }
        window.open(EVM_WALLET_INSTALL_URLS.okx, '_blank')
        return
      }
      if (inj) {
        handleEvmConnect(inj, 'okx')
        return
      }
    }

    if (walletId === 'phantom') {
      const inj = connectors.find((c) => c.id === 'injected') || connectors[0]
      if (inj && hasPhantomEvm) {
        handleEvmConnect(inj, 'phantom')
        return
      }
      if (!hasPhantomEvm && typeof window !== 'undefined') {
        if (isMobile) {
          openMobileWalletDeepLink('phantom', EVM_WALLET_INSTALL_URLS.phantom)
          return
        }
        window.open(EVM_WALLET_INSTALL_URLS.phantom, '_blank')
        return
      }
      if (inj) {
        handleEvmConnect(inj, 'phantom')
        return
      }
    }

    if (walletId === 'rabby') {
      const inj = connectors.find((c) => c.id === 'injected') || connectors[0]
      if (inj && hasRabby) {
        handleEvmConnect(inj, 'rabby')
        return
      }
      if (!hasRabby && typeof window !== 'undefined') {
        if (isMobile) {
          openMobileWalletDeepLink('rabby', EVM_WALLET_INSTALL_URLS.rabby)
          return
        }
        window.open(EVM_WALLET_INSTALL_URLS.rabby, '_blank')
        return
      }
      if (inj) {
        handleEvmConnect(inj, 'rabby')
        return
      }
    }

    // Default / Other wallets
    const genericInj = connectors.find((c) => c.id === 'injected') || connectors[0]
    if (genericInj) {
      handleEvmConnect(genericInj, walletId)
    }
  }

  const handleSolanaConnect = async (provider: SolanaWalletProvider) => {
    setSolanaError(null)
    setSolanaConnecting(provider)
    try {
      const res = await connectSolana(provider)
      if (res.success) {
        try {
          localStorage.setItem(STORAGE_LAST_WALLET, `solana_${provider}`)
          setRecentWallet(`solana_${provider}`)
        } catch (err) {
          console.debug('[UnifiedWalletModal] Failed to persist recent Solana wallet:', err)
        }
        closeWalletModal()
      } else {
        setSolanaError(res.error || 'Connection failed.')
      }
    } catch (err: any) {
      setSolanaError(err?.message || 'Connection failed.')
    } finally {
      setSolanaConnecting(null)
    }
  }

  const walletConnectItem: ModalWalletItem = useMemo(
    () => ({
      id: 'walletconnect',
      name: 'WalletConnect',
      icon: <WalletIcon src={walletconnectSvg} alt="WalletConnect" />,
      isInstalled: false,
      badgeIcon: isMobile ? (
        <span className="text-[10px] font-semibold text-indigo-400 px-2 py-0.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 tracking-wide uppercase">
          Universal
        </span>
      ) : (
        <QrCode size={16} className="text-slate-400 group-hover:text-slate-200 transition-colors" />
      ),
    }),
    [isMobile]
  )

  // Helper to render official icon: preference to EIP-6963 announced icon, fallback to bundled SVG
  const renderWalletIcon = (eipDetail?: EIP6963ProviderDetail, fallbackSvg?: string, alt?: string) => {
    if (eipDetail?.info.icon) {
      return (
        <img
          src={eipDetail.info.icon}
          alt={eipDetail.info.name || alt || ''}
          className="w-7 h-7 rounded-xl object-contain shrink-0 shadow-sm"
          loading="lazy"
        />
      )
    }
    return <WalletIcon src={fallbackSvg || ''} alt={alt || ''} />
  }

  // Dynamically surface any newly discovered EIP-6963 wallets not in the default list (e.g. Brave, Talisman)
  const additionalEipWallets: ModalWalletItem[] = useMemo(() => {
    const knownRdns = Object.values(WALLET_RDNS_MAP).flat().map((r) => r.toLowerCase())
    return eip6963Providers
      .filter((p) => !knownRdns.some((k) => p.info.rdns.toLowerCase().includes(k)))
      .map((p) => ({
        id: p.info.rdns,
        name: p.info.name,
        icon: (
          <img
            src={p.info.icon}
            alt={p.info.name}
            className="w-7 h-7 rounded-xl object-contain shrink-0 shadow-sm"
            loading="lazy"
          />
        ),
        isInstalled: true,
      }))
  }, [eip6963Providers])

  // EVM Primary Wallets List (top-level)
  const evmWallets: ModalWalletItem[] = [
    {
      id: 'metamask',
      name: metaMaskEip?.info.name || 'MetaMask',
      icon: renderWalletIcon(metaMaskEip, metamaskSvg, 'MetaMask'),
      isInstalled: hasMetaMask,
    },
    {
      id: 'okx',
      name: okxEip?.info.name || 'OKX Wallet',
      icon: renderWalletIcon(okxEip, okxSvg, 'OKX Wallet'),
      isInstalled: hasOkx,
    },
    {
      id: 'phantom',
      name: phantomEip?.info.name || 'Phantom',
      icon: renderWalletIcon(phantomEip, phantomSvg, 'Phantom'),
      isInstalled: hasPhantomEvm,
    },
    {
      id: 'rabby',
      name: rabbyEip?.info.name || 'Rabby Wallet',
      icon: renderWalletIcon(rabbyEip, rabbySvg, 'Rabby Wallet'),
      isInstalled: hasRabby,
    },
    ...additionalEipWallets,
    {
      id: 'other',
      name: 'Other Wallets',
      icon: <Wallet size={20} className="text-slate-300" />,
      isInstalled: false,
      isNavigation: true,
      badgeIcon: <ChevronRight size={16} className="text-slate-400 group-hover:text-slate-200 transition-colors" />,
    },
  ]

  // Secondary Wallets offered under "Other Wallets"
  const otherWallets: ModalWalletItem[] = [
    {
      id: 'coinbase',
      name: coinbaseEip?.info.name || 'Coinbase Wallet',
      icon: renderWalletIcon(coinbaseEip, coinbaseSvg, 'Coinbase Wallet'),
      isInstalled: hasCoinbase,
    },
    {
      id: 'binance',
      name: binanceEip?.info.name || 'Binance Wallet',
      icon: renderWalletIcon(binanceEip, binanceSvg, 'Binance Wallet'),
      isInstalled: hasBinance,
    },
    {
      id: 'trust',
      name: trustEip?.info.name || 'Trust Wallet',
      icon: renderWalletIcon(trustEip, trustSvg, 'Trust Wallet'),
      isInstalled: hasTrust,
    },
    {
      id: 'rainbow',
      name: rainbowEip?.info.name || 'Rainbow',
      icon: renderWalletIcon(rainbowEip, rainbowSvg, 'Rainbow'),
      isInstalled: hasRainbow,
    },
    {
      id: 'zerion',
      name: zerionEip?.info.name || 'Zerion',
      icon: renderWalletIcon(zerionEip, zerionSvg, 'Zerion'),
      isInstalled: hasZerion,
    },
    walletConnectItem,
  ]

  // Solana Wallets List (Expanded with leading wallets)
  const solanaWallets: Array<{
    id: SolanaWalletProvider
    name: string
    icon: React.ReactNode
  }> = [
    {
      id: 'phantom',
      name: 'Phantom',
      icon: <WalletIcon src={phantomSvg} alt="Phantom" />,
    },
    {
      id: 'solflare',
      name: 'Solflare',
      icon: <WalletIcon src={solflareSvg} alt="Solflare" />,
    },
    {
      id: 'backpack',
      name: 'Backpack',
      icon: <WalletIcon src={backpackSvg} alt="Backpack" />,
    },
    {
      id: 'okx',
      name: 'OKX Wallet',
      icon: <WalletIcon src={okxSvg} alt="OKX Wallet" />,
    },
    {
      id: 'coinbase',
      name: 'Coinbase Wallet',
      icon: <WalletIcon src={coinbaseSvg} alt="Coinbase Wallet" />,
    },
    {
      id: 'trust',
      name: 'Trust Wallet',
      icon: <WalletIcon src={trustSvg} alt="Trust Wallet" />,
    },
  ]

  // Priority order for EVM:
  // On mobile: 1) WalletConnect, 2) Recent (if not WC), 3) Detected (installed), 4) Other options, 5) Other Wallets navigation
  // On desktop: 1) Recent, 2) Detected (installed), 3) Install, 4) Navigation (Other Wallets)
  const sortedEvmWallets = useMemo(() => {
    if (isMobile) {
      // Mobile View: WalletConnect is at the very top (#1)
      const nonWcList = evmWallets.filter((w) => w.id !== 'walletconnect' && !w.isNavigation)
      const navItem = evmWallets.find((w) => w.isNavigation)

      const sortedNonWc = [...nonWcList].sort((a, b) => {
        const aRecent = recentWallet === a.id
        const bRecent = recentWallet === b.id
        if (aRecent && !bRecent) return -1
        if (!aRecent && bRecent) return 1

        if (a.isInstalled && !b.isInstalled) return -1
        if (!a.isInstalled && b.isInstalled) return 1

        return 0
      })

      return [walletConnectItem, ...sortedNonWc, ...(navItem ? [navItem] : [])]
    }

    // Desktop View: Standard sorting
    const recentOther = otherWallets.find((w) => w.id === recentWallet)
    const baseList = recentOther
      ? [recentOther, ...evmWallets.filter((w) => w.id !== recentWallet)]
      : evmWallets

    return [...baseList].sort((a, b) => {
      if (a.isNavigation && !b.isNavigation) return 1
      if (!a.isNavigation && b.isNavigation) return -1

      const aRecent = recentWallet === a.id
      const bRecent = recentWallet === b.id
      if (aRecent && !bRecent) return -1
      if (!aRecent && bRecent) return 1

      if (a.isInstalled && !b.isInstalled) return -1
      if (!a.isInstalled && b.isInstalled) return 1

      return 0
    })
  }, [evmWallets, otherWallets, recentWallet, isMobile, walletConnectItem])

  // Priority order for Other Wallets: 1) Recent, 2) Detected, 3) Install / WalletConnect
  const sortedOtherWallets = useMemo(() => {
    const list = isMobile ? otherWallets.filter((w) => w.id !== 'walletconnect') : otherWallets
    return [...list].sort((a, b) => {
      const aRecent = recentWallet === a.id
      const bRecent = recentWallet === b.id
      if (aRecent && !bRecent) return -1
      if (!aRecent && bRecent) return 1

      if (a.isInstalled && !b.isInstalled) return -1
      if (!a.isInstalled && b.isInstalled) return 1

      return 0
    })
  }, [otherWallets, recentWallet, isMobile])

  // Priority order for Solana: 1) Recent, 2) Detected, 3) Install
  const sortedSolanaWallets = useMemo(() => {
    return [...solanaWallets].sort((a, b) => {
      const aRecent = recentWallet === `solana_${a.id}` || recentWallet === a.id
      const bRecent = recentWallet === `solana_${b.id}` || recentWallet === b.id
      if (aRecent && !bRecent) return -1
      if (!aRecent && bRecent) return 1

      const aInstalled = Boolean(solanaInstalledState[a.id])
      const bInstalled = Boolean(solanaInstalledState[b.id])
      if (aInstalled && !bInstalled) return -1
      if (!aInstalled && bInstalled) return 1

      return 0
    })
  }, [solanaWallets, solanaInstalledState, recentWallet])

  const renderWalletRow = (wallet: ModalWalletItem) => {
    const isConnecting = isEvmPending && connectingWalletKey === wallet.id
    const isRecent = recentWallet === wallet.id
    const isInstalled = wallet.isInstalled
    const installUrl = wallet.installUrl || EVM_WALLET_INSTALL_URLS[wallet.id]

    return (
      <button
        key={wallet.id}
        type="button"
        onClick={() => {
          if (wallet.isNavigation) {
            setSubView('other_wallets')
          } else if (isInstalled || wallet.id === 'walletconnect') {
            handleEvmWalletClick(wallet.id)
          } else if (isMobile) {
            openMobileWalletDeepLink(wallet.id, installUrl)
          } else if (installUrl) {
            window.open(installUrl, '_blank')
          }
        }}
        disabled={isEvmPending}
        className="w-full flex items-center justify-between p-3 rounded-2xl bg-white/[0.025] hover:bg-white/[0.06] border border-white/[0.04] hover:border-white/[0.09] transition-all duration-150 cursor-pointer group text-left disabled:opacity-50"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-transparent shrink-0">
            {wallet.icon}
          </div>
          <span className="text-[14px] font-semibold text-white group-hover:text-slate-100 transition-colors">
            {wallet.name}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {isConnecting ? (
            <Loader2 size={16} className="text-slate-300 animate-spin" />
          ) : isRecent ? (
            <span className="text-[12px] font-medium text-slate-300">Recent</span>
          ) : isInstalled ? (
            <span className="text-[12px] text-slate-400 font-normal">Detected</span>
          ) : wallet.badgeIcon ? (
            wallet.badgeIcon
          ) : isMobile && getWalletMobileDeepLink(wallet.id) ? (
            <span
              onClick={(e) => {
                e.stopPropagation()
                openMobileWalletDeepLink(wallet.id, installUrl)
              }}
              className="text-[11px] font-medium text-indigo-300 hover:text-white px-2 py-0.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 transition-all flex items-center gap-1 cursor-pointer"
            >
              <span>Open App</span>
              <ExternalLink size={10} />
            </span>
          ) : installUrl ? (
            <span
              onClick={(e) => {
                e.stopPropagation()
                window.open(installUrl, '_blank', 'noopener,noreferrer')
              }}
              className="text-[11px] font-medium text-slate-400 hover:text-white px-2 py-0.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition-all flex items-center gap-1 cursor-pointer"
            >
              <span>Install</span>
              <ExternalLink size={10} />
            </span>
          ) : null}
        </div>
      </button>
    )
  }

  if (!isOpen) return null

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unified-wallet-modal-title"
      className="fixed inset-0 z-[10010] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in overscroll-contain touch-none select-text"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          closeWalletModal()
        }
      }}
    >
      <div
        className="relative w-full max-w-[390px] sm:max-w-[410px] rounded-[28px] p-5 sm:p-6 shadow-2xl transition-all duration-200 border border-white/[0.08] bg-[#12141a]/98 text-slate-100 overflow-hidden"
        style={{
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.95), 0 0 32px rgba(255, 0, 122, 0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        {subView === 'other_wallets' ? (
          <div className="flex items-center justify-between pb-1">
            <button
              type="button"
              onClick={() => setSubView('main')}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition-all cursor-pointer"
              aria-label="Back to wallets"
            >
              <ArrowLeft size={16} />
            </button>
            <h2 id="unified-wallet-modal-title" className="text-base font-bold text-white tracking-tight text-center">
              Other Wallets
            </h2>
            <button
              onClick={closeWalletModal}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition-all cursor-pointer"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between pb-1">
            <div className="w-8" />
            <h2 id="unified-wallet-modal-title" className="text-base font-bold text-white tracking-tight text-center">
              Connect Wallet
            </h2>
            <button
              onClick={closeWalletModal}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] transition-all cursor-pointer"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* EVM vs Solana Tab Switcher (Visible in main view) */}
        {subView === 'main' && (
          <div className="flex p-1 bg-white/[0.04] rounded-2xl border border-white/[0.06] mt-4 mb-3.5">
            <button
              type="button"
              onClick={() => setActiveTab('evm')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'evm'
                  ? 'bg-white/[0.1] text-white shadow-sm border border-white/[0.08]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]'
              }`}
            >
              <PinnedNetworkIcon name="ethereum" size={18} variant="branded" />
              <span>EVM</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('solana')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'solana'
                  ? 'bg-white/[0.1] text-white shadow-sm border border-white/[0.08]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]'
              }`}
            >
              <PinnedNetworkIcon name="solana" size={18} variant="branded" />
              <span>Solana</span>
            </button>
          </div>
        )}

        {/* Sub-view Spacing when in Other Wallets view */}
        {subView === 'other_wallets' && <div className="mt-4 mb-2" />}

        {/* EVM Error Display */}
        {activeTab === 'evm' && evmError && (
          <div className="mb-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-start gap-2 text-rose-300 text-xs">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="leading-tight">{formatWalletConnectError(evmError)}</span>
          </div>
        )}

        {/* Solana Error Display */}
        {activeTab === 'solana' && solanaError && (
          <div className="mb-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-start gap-2 text-rose-300 text-xs">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="leading-tight">{formatWalletConnectError(solanaError)}</span>
          </div>
        )}

        {/* Solana Already Connected Banner */}
        {activeTab === 'solana' && solana.isConnected && (
          <div className="mb-2.5 p-2.5 rounded-2xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-between text-xs text-purple-200">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
              <span>
                Connected: <strong className="font-mono">{solana.address.slice(0, 4)}...{solana.address.slice(-4)}</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={closeWalletModal}
              className="px-2 py-0.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-semibold text-[10px] cursor-pointer"
            >
              Done
            </button>
          </div>
        )}

        {/* WALLETS LIST */}
        <div className="space-y-1.5 max-h-[300px] overflow-y-auto no-scrollbar">
          {subView === 'other_wallets' ? (
            /* Sub-screen: Other Wallets (Sorted: Recent -> Detected -> Install) */
            sortedOtherWallets.map((wallet) => renderWalletRow(wallet))
          ) : activeTab === 'evm' ? (
            /* Main EVM List (Sorted: Recent -> Detected -> Install -> Other Wallets) */
            sortedEvmWallets.map((wallet) => renderWalletRow(wallet))
          ) : (
            /* Main Solana List (Sorted: Recent -> Detected -> Install) */
            sortedSolanaWallets.map((wallet) => {
              const isInstalled = Boolean(solanaInstalledState[wallet.id])
              const isConnecting = solanaConnecting === wallet.id
              const isRecent = recentWallet === `solana_${wallet.id}` || recentWallet === wallet.id
              const installUrl = SOLANA_WALLET_INSTALL_URLS[wallet.id]

              return (
                <button
                  key={wallet.id}
                  type="button"
                  onClick={() => {
                    if (isInstalled) {
                      void handleSolanaConnect(wallet.id)
                    } else if (isMobile) {
                      openMobileWalletDeepLink(wallet.id, installUrl)
                    } else if (installUrl) {
                      window.open(installUrl, '_blank')
                    }
                  }}
                  disabled={Boolean(solanaConnecting)}
                  className="w-full flex items-center justify-between p-3 rounded-2xl bg-white/[0.025] hover:bg-white/[0.06] border border-white/[0.04] hover:border-white/[0.09] transition-all duration-150 cursor-pointer group text-left disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-transparent shrink-0">
                      {wallet.icon}
                    </div>
                    <span className="text-[14px] font-semibold text-white group-hover:text-slate-100 transition-colors">
                      {wallet.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {isConnecting ? (
                      <Loader2 size={16} className="text-purple-400 animate-spin" />
                    ) : isRecent ? (
                      <span className="text-[12px] font-medium text-pink-500">Recent</span>
                    ) : isInstalled ? (
                      <span className="text-[12px] text-slate-400 font-normal">Detected</span>
                    ) : isMobile && getWalletMobileDeepLink(wallet.id) ? (
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          openMobileWalletDeepLink(wallet.id, installUrl)
                        }}
                        className="text-[11px] font-medium text-purple-300 hover:text-white px-2 py-0.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <span>Open App</span>
                        <ExternalLink size={10} />
                      </span>
                    ) : installUrl ? (
                      <span
                        onClick={(e) => {
                          e.stopPropagation()
                          window.open(installUrl, '_blank', 'noopener,noreferrer')
                        }}
                        className="text-[11px] font-medium text-slate-400 hover:text-white px-2 py-0.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <span>Install</span>
                        <ExternalLink size={10} />
                      </span>
                    ) : null}
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Divider Line: or */}
        <div className="relative flex items-center justify-center my-3.5">
          <div className="border-t border-white/[0.08] w-full" />
          <span className="bg-[#12141a] px-3 text-[11px] text-slate-400 lowercase font-medium">or</span>
          <div className="border-t border-white/[0.08] w-full" />
        </div>

        {/* Web2 / Passkey Log In / Sign Up Button (Circle Primary Gradient Style) */}
        <button
          type="button"
          onClick={() => {
            closeWalletModal()
            onOpenCircleAuth?.()
          }}
          className="w-full py-3.5 px-6 rounded-full font-semibold text-xs sm:text-sm tracking-wide transition-all duration-200 flex items-center justify-center gap-2 select-none uppercase text-white hover:scale-[1.01] hover:brightness-110 active:scale-[0.98] cursor-pointer shadow-lg"
          style={{
            fontFamily: 'var(--font-app)',
            background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
            boxShadow: '0 6px 24px rgba(152, 150, 255, 0.3)',
          }}
          aria-label="Log In / Sign Up"
        >
          <span>Log In / Sign Up</span>
          <ArrowRight className="w-3.5 h-3.5 text-white shrink-0 ml-0.5" />
        </button>

        {/* Legal Disclaimer */}
        <p className="text-[11px] text-slate-400 text-center leading-relaxed mt-3.5 px-2">
          By connecting a wallet, you agree to Arcis' Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  )

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body)
  }

  return modalContent
}

export default UnifiedWalletModal
