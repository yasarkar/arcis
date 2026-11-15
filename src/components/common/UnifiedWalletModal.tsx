import React, { useState, useEffect, useMemo, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useConnect, useAccount } from 'wagmi'
import { X, ArrowLeft, Loader2, QrCode, ChevronRight, ExternalLink, AlertCircle, CheckCircle2, Wallet } from 'lucide-react'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import {
  closeWalletModal,
  getIsWalletModalOpen,
  subscribeWalletConfig,
} from '../../config/walletConfigStore'
import { useMultiChainWallet } from '../../hooks/useMultiChainWallet'
import {
  SOLANA_WALLET_INSTALL_URLS,
} from '../../services/solanaWalletService'
import type { SolanaWalletProvider } from '../../types/multiChainWallet'
import { PinnedNetworkIcon } from './PinnedIcons'

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
}) => {
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
  const { isConnected: isEvmConnected } = useAccount()
  const { connectors, connect, isPending: isEvmPending, error: evmError } = useConnect()
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

  // Detect installed EVM extensions safely
  const hasMetaMask = typeof window !== 'undefined' && Boolean((window as any).ethereum?.isMetaMask && !(window as any).ethereum?.isRabby)
  const hasRabby = typeof window !== 'undefined' && Boolean((window as any).ethereum?.isRabby)
  const hasOkx = typeof window !== 'undefined' && Boolean((window as any).okxwallet || (window as any).ethereum?.isOkxWallet)
  const hasPhantomEvm = typeof window !== 'undefined' && Boolean((window as any).phantom?.ethereum)
  const hasCoinbase = typeof window !== 'undefined' && Boolean((window as any).coinbaseWalletExtension || (window as any).ethereum?.isCoinbaseWallet)
  const hasBinance = typeof window !== 'undefined' && Boolean(
    (window as any).BinanceChain || (window as any).binance || (window as any).ethereum?.isBinance || (window as any).ethereum?.isBinanceWallet
  )
  const hasTrust = typeof window !== 'undefined' && Boolean(
    (window as any).trustwallet || (window as any).ethereum?.isTrust || (window as any).ethereum?.isTrustWallet
  )
  const hasRainbow = typeof window !== 'undefined' && Boolean((window as any).ethereum?.isRainbow)
  const hasZerion = typeof window !== 'undefined' && Boolean((window as any).zerionWallet || (window as any).ethereum?.isZerion)

  // Reset subView whenever modal opens or tab changes
  useEffect(() => {
    if (!isOpen) {
      setSubView('main')
    }
  }, [isOpen])

  useEffect(() => {
    setSubView('main')
  }, [activeTab])

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

  // Close modal automatically on successful EVM connection
  useEffect(() => {
    if (isOpen && isEvmConnected) {
      closeWalletModal()
    }
  }, [isOpen, isEvmConnected])

  if (!isOpen) return null

  const handleEvmConnect = (connector: any, walletKey: string) => {
    setConnectingWalletKey(walletKey)
    connect(
      { connector },
      {
        onSuccess: () => {
          try {
            localStorage.setItem(STORAGE_LAST_WALLET, walletKey)
            setRecentWallet(walletKey)
          } catch {}
          closeWalletModal()
        },
        onSettled: () => {
          setConnectingWalletKey(null)
        },
      }
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
        } catch {}
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

  // EVM Primary Wallets List (top-level)
  const evmWallets: ModalWalletItem[] = [
    {
      id: 'metamask',
      name: 'MetaMask',
      icon: <WalletIcon src={metamaskSvg} alt="MetaMask" />,
      isInstalled: hasMetaMask,
    },
    {
      id: 'okx',
      name: 'OKX Wallet',
      icon: <WalletIcon src={okxSvg} alt="OKX Wallet" />,
      isInstalled: hasOkx,
    },
    {
      id: 'phantom',
      name: 'Phantom',
      icon: <WalletIcon src={phantomSvg} alt="Phantom" />,
      isInstalled: hasPhantomEvm,
    },
    {
      id: 'rabby',
      name: 'Rabby Wallet',
      icon: <WalletIcon src={rabbySvg} alt="Rabby Wallet" />,
      isInstalled: hasRabby,
    },
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
      name: 'Coinbase Wallet',
      icon: <WalletIcon src={coinbaseSvg} alt="Coinbase Wallet" />,
      isInstalled: hasCoinbase,
    },
    {
      id: 'binance',
      name: 'Binance Wallet',
      icon: <WalletIcon src={binanceSvg} alt="Binance Wallet" />,
      isInstalled: hasBinance,
    },
    {
      id: 'trust',
      name: 'Trust Wallet',
      icon: <WalletIcon src={trustSvg} alt="Trust Wallet" />,
      isInstalled: hasTrust,
    },
    {
      id: 'rainbow',
      name: 'Rainbow',
      icon: <WalletIcon src={rainbowSvg} alt="Rainbow" />,
      isInstalled: hasRainbow,
    },
    {
      id: 'zerion',
      name: 'Zerion',
      icon: <WalletIcon src={zerionSvg} alt="Zerion" />,
      isInstalled: hasZerion,
    },
    {
      id: 'walletconnect',
      name: 'WalletConnect',
      icon: <WalletIcon src={walletconnectSvg} alt="WalletConnect" />,
      isInstalled: false,
      badgeIcon: <QrCode size={16} className="text-slate-400 group-hover:text-slate-200 transition-colors" />,
    },
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

  // Priority order for EVM: 1) Recent, 2) Detected (installed), 3) Install, 4) Navigation (Other Wallets)
  const sortedEvmWallets = useMemo(() => {
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
  }, [evmWallets, otherWallets, recentWallet])

  // Priority order for Other Wallets: 1) Recent, 2) Detected, 3) Install / WalletConnect
  const sortedOtherWallets = useMemo(() => {
    return [...otherWallets].sort((a, b) => {
      const aRecent = recentWallet === a.id
      const bRecent = recentWallet === b.id
      if (aRecent && !bRecent) return -1
      if (!aRecent && bRecent) return 1

      if (a.isInstalled && !b.isInstalled) return -1
      if (!a.isInstalled && b.isInstalled) return 1

      return 0
    })
  }, [otherWallets, recentWallet])

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
          ) : installUrl ? (
            <a
              href={installUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] font-medium text-slate-400 hover:text-white px-2 py-0.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition-all flex items-center gap-1 cursor-pointer"
            >
              <span>Install</span>
              <ExternalLink size={10} />
            </a>
          ) : null}
        </div>
      </button>
    )
  }

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
              <PinnedNetworkIcon name="ethereum" size={14} variant="branded" />
              <span>EVM</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('solana')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'solana'
                  ? 'bg-purple-900/40 text-purple-200 shadow-sm border border-purple-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]'
              }`}
            >
              <PinnedNetworkIcon name="solana" size={14} variant="branded" />
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
            <span className="leading-tight">{evmError.message || 'Wallet connection failed.'}</span>
          </div>
        )}

        {/* Solana Error Display */}
        {activeTab === 'solana' && solanaError && (
          <div className="mb-2 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 flex items-start gap-2 text-rose-300 text-xs">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="leading-tight">{solanaError}</span>
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
        <div className="space-y-1.5 max-h-[360px] overflow-y-auto no-scrollbar">
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
                    ) : installUrl ? (
                      <a
                        href={installUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] font-medium text-slate-400 hover:text-white px-2 py-0.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <span>Install</span>
                        <ExternalLink size={10} />
                      </a>
                    ) : null}
                  </div>
                </button>
              )
            })
          )}
        </div>

        {/* Legal Disclaimer */}
        <p className="text-[11px] text-slate-400 text-center leading-relaxed mt-4 px-2">
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
