import { useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
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
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import customLogo from '../assets/Arcis-Icon.svg'
import walletIcon from '../assets/Wallet-Icon.svg'
import circleTokenIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import { arcTestnet } from '../config/arcChain'
import { getExplorerAddressUrl } from '../config/sendConfig'
import { useMultiChainWallet } from '../hooks/useMultiChainWallet'

type TabType = 'home' | 'unified' | 'send' | 'swap' | 'bridge' | 'pools' | 'ai-services' | 'history'

interface HeaderProps {
  activeTab: TabType
  setActiveTab: (tab: TabType) => void
  walletConnected: boolean
  walletAddress: string
  onConnect: () => void
  onDisconnect: () => void
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
}

export default function Header({
  activeTab,
  setActiveTab,
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
}: HeaderProps) {
  const { solana, disconnectSolana, injective, disconnectInjective } = useMultiChainWallet()
  const [copiedMsca, setCopiedMsca] = useState<boolean>(false)
  const [copiedSol, setCopiedSol] = useState<boolean>(false)
  const [copiedInj, setCopiedInj] = useState<boolean>(false)
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
            title="Arcis Protocol Overview"
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
                    if (!isActive) {
                      e.currentTarget.style.color = '#ffffff'
                      e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'
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
              title="Request Testnet Tokens (Circle Faucet API)"
            >
              <span>Faucet</span>
              <Droplets size={10} style={{ opacity: 0.6 }} />
            </button>

            <a
              href={arcTestnet.blockExplorers?.default?.url || 'https://testnet.arcscan.app'}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:flex ub-action-btn"
              style={{ padding: '6px 12px', fontSize: 11 }}
            >
              <span>Explorer</span>
              <ExternalLink size={10} style={{ opacity: 0.6 }} />
            </a>
          </div>

          {/* 1. Circle Modular Passkey MSCA Connected State */}
          {isPasskeyConnected && mscaAddress && (
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all animate-fade-in ${
                activeAuthSource === 'passkey'
                  ? 'bg-cyan-500/20 border-2 border-cyan-400 shadow-[0_0_16px_rgba(6,182,212,0.4)]'
                  : 'bg-cyan-950/30 border border-cyan-500/30 opacity-80 hover:opacity-100'
              }`}
            >
              <Fingerprint className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <button
                type="button"
                onClick={() => {
                  if (onSelectActiveAuthSource) onSelectActiveAuthSource('passkey')
                  navigator.clipboard.writeText(mscaAddress)
                  setCopiedMsca(true)
                  setTimeout(() => setCopiedMsca(false), 2000)
                }}
                className="flex items-center gap-1 text-xs font-extrabold text-cyan-200 hover:text-white transition cursor-pointer"
                title={activeAuthSource === 'passkey' ? 'Aktif İmzalayıcı Cüzdan (Kopyalamak İçin Tıklayın)' : 'Bu cüzdanı aktif imzalayıcı yapmak için tıklayın'}
              >
                <span>MSCA: {mscaAddress.slice(0, 6)}...{mscaAddress.slice(-4)}</span>
                {activeAuthSource === 'passkey' && (
                  <span className="text-[9px] text-cyan-300 bg-cyan-500/20 px-1 rounded font-normal">Aktif</span>
                )}
                {copiedMsca ? (
                  <span className="text-[10px] text-emerald-400 font-bold ml-0.5">Kopyalandı!</span>
                ) : (
                  <span className="text-[10px] text-cyan-400 opacity-60 hover:opacity-100">📋</span>
                )}
              </button>

              <a
                href={getExplorerAddressUrl('Arc_Testnet', mscaAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-cyan-300 p-0.5 transition"
                title="ArcScan Üzerinde Görüntüle"
              >
                <ExternalLink size={11} />
              </a>

              <button
                onClick={onDisconnectPasskey}
                className="text-[11px] text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-700 px-2 py-0.5 rounded-full transition ml-0.5 cursor-pointer"
                title="Passkey Cüzdanını Kapat"
              >
                Çıkış
              </button>
            </div>
          )}

          {/* 2. Circle UCW Connected State */}
          {isUcwConnected && ucwAddress && (
            <div
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all ${
                activeAuthSource === 'ucw'
                  ? 'bg-blue-500/20 border-2 border-blue-400 shadow-[0_0_16px_rgba(59,130,246,0.4)]'
                  : 'bg-blue-950/30 border border-blue-500/30 opacity-80 hover:opacity-100'
              }`}
            >
              <div className="w-3.5 h-3.5 rounded-full overflow-hidden shrink-0">
                <img src={circleTokenIcon} alt="Circle" className="w-full h-full object-cover" />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (onSelectActiveAuthSource) onSelectActiveAuthSource('ucw')
                  navigator.clipboard.writeText(ucwAddress)
                }}
                className="flex items-center gap-1 text-xs font-semibold text-blue-200 hover:text-white transition cursor-pointer"
                title={activeAuthSource === 'ucw' ? 'Aktif İmzalayıcı Cüzdan' : 'Bu cüzdanı aktif yapmak için tıklayın'}
              >
                <span>UCW: {ucwAddress.slice(0, 6)}...{ucwAddress.slice(-4)}</span>
                {activeAuthSource === 'ucw' && (
                  <span className="text-[9px] text-blue-300 bg-blue-500/20 px-1 rounded font-normal">Aktif</span>
                )}
              </button>
              <button
                onClick={onDisconnectUcw}
                className="text-[11px] text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 px-2 py-0.5 rounded-full transition ml-0.5 cursor-pointer"
              >
                Çıkış
              </button>
            </div>
          )}

          {/* 3. Circle Auth / Passkey Login Trigger (shown if neither is connected) */}
          {!isPasskeyConnected && !isUcwConnected && (
            isRestoring ? (
              <div
                className="flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5"
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div className="w-3.5 h-3.5 rounded-full bg-slate-600 animate-pulse" />
                <div className="hidden sm:block w-20 h-3 rounded bg-slate-700 animate-pulse" />
              </div>
            ) : (
              <button
                onClick={onOpenCircleAuth}
                type="button"
                className="ub-action-btn flex items-center justify-center gap-1.5"
                style={{ padding: '6px 13px' }}
              >
                <img src={circleTokenIcon} alt="Circle Logo Icon" className="w-4 h-4 object-contain transition-transform hover:scale-110" />
                <span className="hidden sm:inline font-semibold">Circle & Passkey</span>
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
                title="Solana Adresini Kopyala"
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
                title="Solana Explorer'da Görüntüle"
              >
                <ExternalLink size={11} />
              </a>

              <button
                onClick={disconnectSolana}
                className="text-[11px] text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-700 px-2 py-0.5 rounded-full transition ml-0.5 cursor-pointer"
                title="Solana Cüzdanını Kapat"
              >
                Çıkış
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
                title="Injective Adresini Kopyala"
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
                title="Injective Explorer'da Görüntüle"
              >
                <ExternalLink size={11} />
              </a>

              <button
                onClick={disconnectInjective}
                className="text-[11px] text-slate-300 hover:text-white bg-slate-800/90 hover:bg-slate-700 px-2 py-0.5 rounded-full transition ml-0.5 cursor-pointer"
                title="Injective Cüzdanını Kapat"
              >
                Çıkış
              </button>
            </div>
          )}

          {/* Connect Wallet Button (RainbowKit Custom with Multi-Chain Modal Support) */}
          <ConnectButton.Custom>
            {({
              account,
              chain,
              openAccountModal,
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
                          style={{ padding: '6px 16px' }}
                        >
                          <Wallet className="w-3.5 h-3.5" />
                          <span>Connect Wallet</span>
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
                            color: '#f87171'
                          }}
                        >
                          Wrong network
                        </button>
                      )
                    }

                    return (
                      <button
                        onClick={openAccountModal}
                        type="button"
                        className="ub-action-btn gap-2"
                        style={{
                          background: 'rgba(255, 255, 255, 0.08)',
                          borderColor: 'rgba(255, 255, 255, 0.15)',
                          padding: '6px 14px'
                        }}
                      >
                        <img src={walletIcon} alt="Wallet Icon" className="w-4 h-4 object-contain" />
                        <span style={{ fontFamily: 'var(--font-app)', fontWeight: 600 }}>{account.displayName}</span>
                      </button>
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
