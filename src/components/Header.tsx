import { useState, useRef, useEffect } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import {
  Wallet,
  ArrowRightLeft,
  ArrowUpRight,
  Globe,
  Coins,
  Clock,
  ExternalLink,
  Layers,
  Droplets,
  Bot,
  Sparkles,
  Fingerprint,
  ChevronDown,
  Copy,
  Check,
  LogOut,
  PieChart,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import customLogo from '../assets/Arcis-Icon.svg'
import walletIcon from '../assets/Wallet-Icon.svg'
import circleTokenIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import { arcTestnet } from '../config/arcChain'
import { getExplorerAddressUrl } from '../config/sendConfig'
import { useMultiChainWallet } from '../hooks/useMultiChainWallet'
import { prefetchHistory } from '../utils/history'

type TabType = 'home' | 'unified' | 'send' | 'swap' | 'bridge' | 'pools' | 'ai-services' | 'history'

interface HeaderProps {
  activeTab: TabType
  setActiveTab: (tab: TabType) => void
  walletConnected: boolean
  walletAddress: string
  onConnect?: () => void
  onDisconnect?: () => void
  isUcwConnected?: boolean
  ucwAddress?: string
  isPasskeyConnected?: boolean
  mscaAddress?: string
  activeAuthSource?: 'passkey' | 'ucw' | 'evm' | null
  onSelectActiveAuthSource?: (source: 'passkey' | 'ucw' | 'evm') => void
  onOpenCircleAuth?: () => void
  onDisconnectUcw?: () => void
  onDisconnectPasskey?: () => void
  onOpenFaucet?: () => void
  isRestoring?: boolean
  onOpenPortfolio?: () => void
}

export default function Header({
  activeTab,
  setActiveTab,
  walletConnected,
  walletAddress,
  onConnect,
  onDisconnect,
  isUcwConnected,
  ucwAddress,
  isPasskeyConnected,
  mscaAddress,
  activeAuthSource,
  onSelectActiveAuthSource,
  onOpenCircleAuth,
  onDisconnectUcw,
  onDisconnectPasskey,
  onOpenFaucet,
  isRestoring,
  onOpenPortfolio,
}: HeaderProps) {
  const { isConnected: isEvmConnected } = useAccount()
  const isEvmWalletConnected = Boolean(isEvmConnected || (walletConnected && activeAuthSource === 'evm'))

  const { solana, disconnectSolana, injective, disconnectInjective } = useMultiChainWallet()
  const [copiedMsca, setCopiedMsca] = useState<boolean>(false)
  const [copiedUcw, setCopiedUcw] = useState<boolean>(false)
  const [copiedSol, setCopiedSol] = useState<boolean>(false)
  const [copiedInj, setCopiedInj] = useState<boolean>(false)
  const [copiedEvm, setCopiedEvm] = useState<boolean>(false)
  const [isCircleMenuOpen, setIsCircleMenuOpen] = useState<boolean>(false)
  const [isPasskeyMenuOpen, setIsPasskeyMenuOpen] = useState<boolean>(false)
  const [isEvmMenuOpen, setIsEvmMenuOpen] = useState<boolean>(false)

  const circleMenuRef = useRef<HTMLDivElement>(null)
  const passkeyMenuRef = useRef<HTMLDivElement>(null)
  const evmMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (circleMenuRef.current && !circleMenuRef.current.contains(event.target as Node)) {
        setIsCircleMenuOpen(false)
      }
      if (passkeyMenuRef.current && !passkeyMenuRef.current.contains(event.target as Node)) {
        setIsPasskeyMenuOpen(false)
      }
      if (evmMenuRef.current && !evmMenuRef.current.contains(event.target as Node)) {
        setIsEvmMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  const tabs = [
    { id: 'home' as const, label: 'Overview', icon: Sparkles },
    { id: 'unified' as const, label: 'Unified Balance', icon: Coins },
    { id: 'send' as const, label: 'Send', icon: ArrowUpRight },
    { id: 'swap' as const, label: 'Swap', icon: ArrowRightLeft },
    { id: 'bridge' as const, label: 'Bridge', icon: Globe },
    { id: 'pools' as const, label: 'Pools', icon: Layers },
    { id: 'ai-services' as const, label: 'AI Services', icon: Bot },
    { id: 'history' as const, label: 'History', icon: Clock },
  ]

  return (
    <header className="sticky top-3 z-50 px-3 sm:px-6 md:px-8 lg:px-10 xl:px-12 w-full max-w-[1920px] 2xl:max-w-full mx-auto transition-all duration-300">
      {/* ── FLOATING GLASS CAPSULE ISLAND (AAVE LUXURY NAV - EXPANDED WIDTH) ── */}
      <div
        className="w-full flex items-center justify-between px-4 py-2.5 md:px-8 md:py-3.5 rounded-full transition-all duration-300"
        style={{
          background: 'rgba(16, 18, 30, 0.82)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.04), 0 12px 36px -4px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.2)'
        }}
      >
        {/* Brand Logo — Far Left */}
        <div className="flex items-center justify-start flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-3 cursor-pointer group focus:outline-none transition-transform active:scale-95"
          >
            <img
              src={customLogo}
              alt="Arcis Logo"
              className="h-8 md:h-9 w-auto object-contain transition-all duration-200 group-hover:brightness-110 group-hover:scale-105"
            />
          </button>
        </div>

        {/* Aave Segmented Capsule Navigation — Center */}
        <nav
          className="hidden lg:flex items-center justify-center flex-shrink-0 p-1 rounded-full backdrop-blur-xl mx-2"
          style={{
            background: 'rgba(255, 255, 255, 0.035)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.2)'
          }}
        >
          <div className="flex items-center gap-1">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className="relative flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs transition-all duration-200 cursor-pointer group"
                  style={{
                    fontFamily: 'var(--font-app)',
                    fontWeight: isActive ? 600 : 500,
                    letterSpacing: '0.2px',
                    color: isActive ? '#ffffff' : 'var(--fp-3)',
                    background: isActive
                      ? 'linear-gradient(135deg, rgba(152, 150, 255, 0.2) 0%, rgba(99, 102, 241, 0.25) 100%)'
                      : 'transparent',
                    border: isActive
                      ? '1px solid rgba(152, 150, 255, 0.35)'
                      : '1px solid transparent',
                    boxShadow: isActive
                      ? '0 2px 12px rgba(152, 150, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.15)'
                      : 'none',
                  }}
                  onMouseEnter={e => {
                    if (tab.id === 'history' && walletAddress) {
                      prefetchHistory(walletAddress)
                    }
                    if (!isActive) {
                      e.currentTarget.style.color = '#ffffff'
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
                    }
                  }}
                  onFocus={() => {
                    if (tab.id === 'history' && walletAddress) {
                      prefetchHistory(walletAddress)
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isActive) {
                      e.currentTarget.style.color = 'var(--fp-3)'
                      e.currentTarget.style.background = 'transparent'
                    }
                  }}
                >
                  <Icon
                    className="w-3.5 h-3.5 transition-transform duration-200 group-hover:scale-110"
                    style={{
                      color: isActive ? 'var(--purple-1)' : 'var(--fp-4)',
                      filter: isActive ? 'drop-shadow(0 0 6px rgba(152, 150, 255, 0.5))' : 'none'
                    }}
                  />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </div>
        </nav>

        {/* Right Utility Actions & Wallet Controls — Far Right */}
        <div className="flex items-center gap-2 md:gap-3 justify-end flex-1 min-w-0">

          {/* Quick Links */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpenFaucet}
              className="ub-action-btn flex items-center gap-1.5 cursor-pointer hover:border-indigo-400/50 hover:text-indigo-200 transition-all"
              style={{ padding: '6px 12px', fontSize: 11 }}
            >
              <span>Faucet</span>
              <Droplets size={14} style={{ opacity: 0.6 }} />
            </button>

            <a
              href={arcTestnet.blockExplorers?.default?.url || 'https://testnet.arcscan.app'}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:flex ub-action-btn"
              style={{ padding: '6px 12px', fontSize: 11 }}
            >
              <span>Explorer</span>
              <ExternalLink size={14} style={{ opacity: 0.6 }} />
            </a>
          </div>

          {/* 1. Circle Modular Passkey MSCA Connected State */}
          {isPasskeyConnected && mscaAddress && (
            <div className="relative" ref={passkeyMenuRef}>
              <button
                type="button"
                onClick={() => {
                  if (onSelectActiveAuthSource) onSelectActiveAuthSource('passkey')
                  setIsPasskeyMenuOpen((prev) => !prev)
                }}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 transition-all duration-200 cursor-pointer select-none ${isPasskeyMenuOpen || activeAuthSource === 'passkey'
                    ? 'bg-cyan-500/20 border-2 border-cyan-400 text-white shadow-[0_0_16px_rgba(6,182,212,0.4)]'
                    : 'bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-500/30 text-cyan-200'
                  }`}
              >
                <Fingerprint className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="text-xs font-bold text-cyan-200">
                  {mscaAddress.slice(0, 6)}...{mscaAddress.slice(-4)}
                </span>
                <ChevronDown
                  size={12}
                  className={`text-cyan-300 transition-transform duration-200 ${isPasskeyMenuOpen ? 'rotate-180 text-cyan-100' : 'opacity-70'
                    }`}
                />
              </button>

              {/* Passkey Dropdown Menu */}
              {isPasskeyMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-56 rounded-2xl p-1.5 z-50 transition-all duration-150 backdrop-blur-2xl shadow-2xl animate-fade-in"
                  style={{
                    background: 'rgba(13, 17, 28, 0.96)',
                    border: '1px solid rgba(6, 182, 212, 0.25)',
                    boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 24px rgba(6, 182, 212, 0.15)',
                  }}
                >
                  <div className="px-3 py-2 border-b border-white/[0.08] flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)] animate-pulse" />
                      <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Passkey MSCA</span>
                    </div>
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 rounded-md">
                      Arc Testnet
                    </span>
                  </div>

                  {/* Portfolio Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsPasskeyMenuOpen(false)
                      if (onOpenPortfolio) onOpenPortfolio()
                    }}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer group mt-1"
                  >
                    <div className="flex items-center gap-2.5">
                      <PieChart size={14} className="text-slate-400 group-hover:text-cyan-400 transition-colors shrink-0" />
                      <span className="font-semibold text-slate-100">Portfolio</span>
                    </div>
                    <span className="text-[10px] font-semibold text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                      Multi-Chain
                    </span>
                  </button>

                  <div className="my-1 border-t border-white/[0.08]" />

                  {/* Copy Address */}
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(mscaAddress)
                      setCopiedMsca(true)
                      setTimeout(() => {
                        setCopiedMsca(false)
                        setIsPasskeyMenuOpen(false)
                      }, 1200)
                    }}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer group mt-1"
                  >
                    <div className="flex items-center gap-2.5">
                      {copiedMsca ? (
                        <Check size={14} className="text-emerald-400 shrink-0" />
                      ) : (
                        <Copy size={14} className="text-slate-400 group-hover:text-cyan-400 transition-colors shrink-0" />
                      )}
                      <span>{copiedMsca ? 'Copied!' : 'Copy Address'}</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">
                      {mscaAddress.slice(0, 4)}...{mscaAddress.slice(-4)}
                    </span>
                  </button>

                  {/* ArcScan Explorer */}
                  <a
                    href={getExplorerAddressUrl('Arc_Testnet', mscaAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setIsPasskeyMenuOpen(false)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-2.5">
                      <ExternalLink size={14} className="text-slate-400 group-hover:text-cyan-400 transition-colors shrink-0" />
                      <span>View on ArcScan</span>
                    </div>
                    <span className="text-[10px] text-slate-500">↗</span>
                  </a>

                  <div className="my-1 border-t border-white/[0.08]" />

                  {/* Log out */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsPasskeyMenuOpen(false)
                      if (onDisconnectPasskey) onDisconnectPasskey()
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all cursor-pointer group"
                  >
                    <LogOut size={14} className="text-rose-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
                    <span>Log out</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 2. Circle UCW Connected State */}
          {isUcwConnected && ucwAddress && (
            <div className="relative" ref={circleMenuRef}>
              <button
                type="button"
                onClick={() => {
                  if (onSelectActiveAuthSource) onSelectActiveAuthSource('ucw')
                  setIsCircleMenuOpen((prev) => !prev)
                }}
                className="ub-action-btn ub-action-btn-primary"
              >
                <div className="w-3.5 h-3.5 rounded-full overflow-hidden shrink-0">
                  <img src={circleTokenIcon} alt="Circle" className="w-full h-full object-cover" />
                </div>
                <span className="text-xs font-semibold tracking-wide text-white">
                  {ucwAddress.slice(0, 6)}...{ucwAddress.slice(-4)}
                </span>
                <ChevronDown
                  size={12}
                  className={`text-white transition-transform duration-200 ${isCircleMenuOpen ? 'rotate-180 text-blue-100' : 'opacity-70'
                    }`}
                />
              </button>

              {/* Circle UCW Dropdown Menu */}
              {isCircleMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-56 rounded-2xl p-1.5 z-50 transition-all duration-150 backdrop-blur-2xl shadow-2xl animate-fade-in"
                  style={{
                    background: 'rgba(13, 17, 28, 0.96)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                    boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 24px rgba(59, 130, 246, 0.15)',
                  }}
                >
                  {/* Portfolio Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsCircleMenuOpen(false)
                      if (onOpenPortfolio) onOpenPortfolio()
                    }}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer group mt-1"
                  >
                    <div className="flex items-center gap-2.5">
                      <PieChart size={14} className="text-slate-400 group-hover:text-indigo-400 transition-colors shrink-0" />
                      <span className="font-semibold text-slate-100">Portfolio</span>
                    </div>
                  </button>

                  {/* Copy Address */}
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(ucwAddress)
                      setCopiedUcw(true)
                      setTimeout(() => {
                        setCopiedUcw(false)
                        setIsCircleMenuOpen(false)
                      }, 1200)
                    }}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer group mt-1"
                  >
                    <div className="flex items-center gap-2.5">
                      {copiedUcw ? (
                        <Check size={14} className="text-slate-400 shrink-0" />
                      ) : (
                        <Copy size={14} className="text-slate-400 group-hover:text-indigo-400 transition-colors shrink-0" />
                      )}
                      <span>{copiedUcw ? 'Copied!' : 'Copy Address'}</span>
                    </div>
                  </button>

                  {/* ArcScan Explorer */}
                  <a
                    href={getExplorerAddressUrl('Arc_Testnet', ucwAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setIsCircleMenuOpen(false)}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-2.5">
                      <ExternalLink size={14} className="text-slate-400 group-hover:text-indigo-400 transition-colors shrink-0" />
                      <span>View on ArcScan</span>
                    </div>
                  </a>

                  <div className="my-1 border-t border-white/[0.08]" />

                  {/* Log out */}
                  <button
                    type="button"
                    onClick={() => {
                      setIsCircleMenuOpen(false)
                      if (onDisconnectUcw) onDisconnectUcw()
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all cursor-pointer group"
                  >
                    <LogOut size={14} className="text-rose-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
                    <span>Log out</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 3. Circle Auth / Passkey Login Trigger (shown if neither is connected) */}
          {!isPasskeyConnected && !isUcwConnected && (
            isRestoring ? (
              <div
                className="flex items-center justify-center gap-1.5 rounded-full transition-all duration-200"
                style={{
                  padding: isEvmWalletConnected ? '6px 10px' : '6px 12px',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div className="w-3.5 h-3.5 rounded-full bg-slate-600 animate-pulse" />
                {!isEvmWalletConnected && <div className="hidden sm:block w-20 h-3 rounded bg-slate-700 animate-pulse" />}
              </div>
            ) : (
              <button
                onClick={onOpenCircleAuth}
                type="button"
                className="ub-action-btn flex items-center justify-center gap-1.5 transition-all duration-200"
                style={{ padding: isEvmWalletConnected ? '6px 10px' : '6px 13px' }}
                aria-label="Circle & Passkey"
              >
                <img src={circleTokenIcon} alt="Circle & Passkey" className="w-4 h-4 object-contain transition-transform hover:scale-110" />
                {!isEvmWalletConnected && <span className="hidden sm:inline font-semibold">Circle & Passkey</span>}
              </button>
            )
          )}

          {/* 4. Solana Connected State Badge */}
          {solana.isConnected && solana.address && (
            <div
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all animate-fade-in"
              style={{
                background: 'rgba(168, 85, 247, 0.15)',
                border: '1px solid rgba(168, 85, 247, 0.45)',
                boxShadow: '0 2px 12px rgba(168, 85, 247, 0.25)'
              }}
            >
              <NetworkIcon name="solana" size={14} variant="branded" />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(solana.address)
                  setCopiedSol(true)
                  setTimeout(() => setCopiedSol(false), 2000)
                }}
                className="flex items-center gap-1 text-xs font-bold text-purple-200 hover:text-white transition cursor-pointer"
              >
                <span>Sol: {solana.address.slice(0, 4)}...{solana.address.slice(-4)}</span>
                {copiedSol ? (
                  <span className="text-[10px] text-emerald-400 font-bold ml-0.5">✓</span>
                ) : (
                  <span className="text-[10px] text-purple-400 opacity-60 hover:opacity-100">📋</span>
                )}
              </button>

              <a
                href={`https://explorer.solana.com/address/${solana.address}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-purple-300 p-0.5 transition"
              >
                <ExternalLink size={11} />
              </a>

              <button
                onClick={disconnectSolana}
                className="text-[11px] text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-700 px-2 py-0.5 rounded-full transition ml-0.5 cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          )}

          {/* 5. Injective Connected State Badge */}
          {injective.isConnected && injective.address && (
            <div
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all animate-fade-in"
              style={{
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.45)',
                boxShadow: '0 2px 12px rgba(59, 130, 246, 0.25)'
              }}
            >
              <NetworkIcon name="injective" size={14} variant="branded" />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(injective.address)
                  setCopiedInj(true)
                  setTimeout(() => setCopiedInj(false), 2000)
                }}
                className="flex items-center gap-1 text-xs font-bold text-blue-200 hover:text-white transition cursor-pointer"
              >
                <span>Inj: {injective.address.slice(0, 6)}...{injective.address.slice(-4)}</span>
                {copiedInj ? (
                  <span className="text-[10px] text-emerald-400 font-bold ml-0.5">✓</span>
                ) : (
                  <span className="text-[10px] text-blue-400 opacity-60 hover:opacity-100">📋</span>
                )}
              </button>

              <a
                href={`https://testnet.explorer.injective.network/account/${injective.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-blue-300 p-0.5 transition"
              >
                <ExternalLink size={11} />
              </a>

              <button
                onClick={disconnectInjective}
                className="text-[11px] text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-700 px-2 py-0.5 rounded-full transition ml-0.5 cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          )}

          {/* Connect Wallet Button (RainbowKit Custom with Multi-Chain Modal Support) */}
          <ConnectButton.Custom>
            {({
              account,
              chain,
              openChainModal,
              openConnectModal,
              authenticationStatus,
              mounted,
            }) => {
              const ready = mounted && authenticationStatus !== 'loading'
              const connected =
                ready &&
                account &&
                chain &&
                (!authenticationStatus ||
                  authenticationStatus === 'authenticated')

              return (
                <div
                  {...(!ready && {
                    'aria-hidden': true,
                    style: {
                      opacity: 0,
                      pointerEvents: 'none',
                      userSelect: 'none',
                    },
                  })}
                >
                  {(() => {
                    if (!connected) {
                      return (
                        <button
                          onClick={openConnectModal}
                          type="button"
                          className="ub-action-btn ub-action-btn-primary"
                          style={{
                            padding: isUcwConnected || isPasskeyConnected ? '6px 10px' : '6px 16px',
                          }}
                          aria-label="Connect Wallet"
                        >
                          <Wallet className={isUcwConnected || isPasskeyConnected ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
                          {!(isUcwConnected || isPasskeyConnected) && <span>Connect Wallet</span>}
                        </button>
                      )
                    }

                    if (chain.unsupported) {
                      return (
                        <button
                          onClick={openChainModal}
                          type="button"
                          className="ub-action-btn"
                          style={{
                            background: 'rgba(239, 68, 68, 0.15)',
                            borderColor: 'rgba(239, 68, 68, 0.4)',
                            color: '#f87171',
                            padding: isUcwConnected || isPasskeyConnected ? '6px 10px' : undefined,
                          }}
                          aria-label="Wrong network"
                        >
                          {isUcwConnected || isPasskeyConnected ? '⚠️' : 'Wrong network'}
                        </button>
                      )
                    }

                    return (
                      <div className="relative" ref={evmMenuRef}>
                        <button
                          type="button"
                          onClick={() => {
                            if (onSelectActiveAuthSource) onSelectActiveAuthSource('evm')
                            setIsEvmMenuOpen((prev) => !prev)
                          }}
                          className={`ub-action-btn ${isUcwConnected ? '' : 'gap-2'} transition-all duration-200 cursor-pointer select-none`}>
                          <img src={walletIcon} alt="Wallet Icon" className="w-4 h-4 object-contain" />
                          {!isUcwConnected && (
                            <span style={{ fontFamily: 'var(--font-app)', fontWeight: 600 }}>{account.displayName}</span>
                          )}
                          <ChevronDown
                            size={12}
                            className={`transition-transform duration-200 ${
                              isEvmMenuOpen ? 'rotate-180 text-white' : 'opacity-70 text-slate-400'
                            }`}
                          />
                        </button>

                        {/* EVM Custom Dropdown Menu */}
                        {isEvmMenuOpen && (
                          <div
                            className="absolute right-0 top-full mt-2 w-40 rounded-2xl p-1.5 z-50 transition-all duration-150 backdrop-blur-2xl shadow-2xl animate-fade-in"
                            style={{
                              background: 'rgba(13, 17, 28, 0.96)',
                              border: '1px solid rgba(99, 102, 241, 0.25)',
                              boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 24px rgba(99, 102, 241, 0.15)',
                            }}
                          >
                            {/* Portfolio Option */}
                            <button
                              type="button"
                              onClick={() => {
                                setIsEvmMenuOpen(false)
                                if (onOpenPortfolio) onOpenPortfolio()
                              }}
                              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer group mt-1"
                            >
                              <div className="flex items-center gap-2.5">
                                <PieChart size={14} className="text-slate-400 group-hover:text-indigo-400 transition-colors shrink-0" />
                                <span className="font-semibold text-slate-100">Portfolio</span>
                              </div>
                            </button>

                            {/* Switch Network */}
                            <button
                              type="button"
                              onClick={() => {
                                setIsEvmMenuOpen(false)
                                openChainModal()
                              }}
                              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer group"
                            >
                              <div className="flex items-center gap-2.5">
                                <Globe size={14} className="text-slate-400 group-hover:text-indigo-400 transition-colors shrink-0" />
                                <span>Switch Network</span>
                              </div>
                            </button>

                            {/* Copy Address */}
                            <button
                              type="button"
                              onClick={() => {
                                if (account.address) {
                                  navigator.clipboard.writeText(account.address)
                                  setCopiedEvm(true)
                                  setTimeout(() => {
                                    setCopiedEvm(false)
                                    setIsEvmMenuOpen(false)
                                  }, 1200)
                                }
                              }}
                              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer group"
                            >
                              <div className="flex items-center gap-2.5">
                                {copiedEvm ? (
                                  <Check size={14} className="text-emerald-400 shrink-0" />
                                ) : (
                                  <Copy size={14} className="text-slate-400 group-hover:text-indigo-400 transition-colors shrink-0" />
                                )}
                                <span>{copiedEvm ? 'Copied!' : 'Copy Address'}</span>
                              </div>
                            </button>

                            {/* Explorer Link */}
                            {account.address && (
                              <a
                                href={getExplorerAddressUrl(chain?.name || 'Arc_Testnet', account.address)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setIsEvmMenuOpen(false)}
                                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium text-slate-200 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer group"
                              >
                                <div className="flex items-center gap-2.5">
                                  <ExternalLink size={14} className="text-slate-400 group-hover:text-indigo-400 transition-colors shrink-0" />
                                  <span>View on Explorer</span>
                                </div>
                              </a>
                            )}

                            <div className="my-1 border-t border-white/[0.08]" />

                            {/* Disconnect */}
                            <button
                              type="button"
                              onClick={() => {
                                setIsEvmMenuOpen(false)
                                if (onDisconnect) onDisconnect()
                              }}
                              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all cursor-pointer group"
                            >
                              <LogOut size={14} className="text-rose-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
                              <span>Disconnect</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )
            }}
          </ConnectButton.Custom>

        </div>
      </div>

      {/* Mobile Navigation Bar (below header on small screens) */}
      <div className="flex lg:hidden items-center justify-center mt-2.5 overflow-x-auto py-1 px-1">
        <nav
          className="flex items-center gap-1 p-1 rounded-full backdrop-blur-xl"
          style={{
            background: 'rgba(16, 18, 30, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)'
          }}
        >
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                onTouchStart={() => {
                  if (tab.id === 'history' && walletAddress) {
                    prefetchHistory(walletAddress)
                  }
                }}
                onMouseEnter={() => {
                  if (tab.id === 'history' && walletAddress) {
                    prefetchHistory(walletAddress)
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all whitespace-nowrap"
                style={{
                  fontFamily: 'var(--font-app)',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? '#ffffff' : 'var(--fp-3)',
                  background: isActive
                    ? 'linear-gradient(135deg, rgba(152, 150, 255, 0.25) 0%, rgba(99, 102, 241, 0.3) 100%)'
                    : 'transparent',
                  border: isActive ? '1px solid rgba(152, 150, 255, 0.35)' : '1px solid transparent',
                }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: isActive ? 'var(--purple-1)' : 'var(--fp-4)' }} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
