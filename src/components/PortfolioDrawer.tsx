// High-fidelity Multi-Chain Portfolio Slide-over Drawer for Circle User-Controlled & Modular Wallets.
import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  RotateCw,
  Search,
  Filter,
  Wallet,
} from 'lucide-react'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { useLiveTokenPrices } from '../hooks/useLiveTokenPrices'
import {
  calculatePortfolioStats,
  calculateAggregatedAssets,
  filterAndSortChains,
  getChainTotalUsd,
} from '../services/portfolio'
import { PortfolioOverviewCard, PortfolioChainCard } from './portfolio'

export interface PortfolioDrawerProps {
  isOpen: boolean
  onClose: () => void
  walletAddress: string
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  onNavigateToTab?: (tab: string, chainKey?: string) => void
  onOpenFaucet?: () => void
}

export default function PortfolioDrawer({
  isOpen,
  onClose,
  walletAddress,
  onNavigateToTab,
}: PortfolioDrawerProps) {
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [onlyNonZero, setOnlyNonZero] = useState<boolean>(false)

  // Privacy mode: hide/mask balances across entire portfolio
  const [hideBalances, setHideBalances] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('arcis_portfolio_hide_balances') === 'true'
    }
    return false
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('arcis_portfolio_hide_balances', String(hideBalances))
    }
  }, [hideBalances])

  // Set of expanded chain keys for click-to-toggle accordion
  const [expandedChains, setExpandedChains] = useState<Record<string, boolean>>({})

  const toggleChain = (chainKey: string) => {
    setExpandedChains((prev) => ({
      ...prev,
      [chainKey]: !prev[chainKey],
    }))
  }

  // Drawer container ref for keyboard navigation & focus
  const drawerRef = useRef<HTMLDivElement>(null)

  // Smooth slide-over entry and exit animation state
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setExpandedChains({})
      setShouldRender(true)
      let frame2: number
      const frame1 = requestAnimationFrame(() => {
        frame2 = requestAnimationFrame(() => {
          setIsVisible(true)
        })
      })
      return () => {
        cancelAnimationFrame(frame1)
        if (frame2) cancelAnimationFrame(frame2)
      }
    } else {
      setIsVisible(false)
      const timer = setTimeout(() => {
        setShouldRender(false)
        setExpandedChains({})
      }, 350)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Fetch all multi-chain balances for the user address
  const { walletBalances, loading, isFetching: isFetchingBalances, refetch: refetchBalances } =
    useWalletTestnetBalances(walletAddress)

  // Live prices for fiat conversions
  const { data: prices, refetch: refetchPrices, isFetching: isFetchingPrices } = useLiveTokenPrices()

  const isRefreshing = isFetchingBalances || isFetchingPrices

  const handleRefresh = async () => {
    try {
      await Promise.allSettled([refetchBalances(), refetchPrices()])
    } catch (err) {
      console.warn('[PortfolioDrawer] Refresh error:', err)
    }
  }

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (shouldRender) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [shouldRender])

  // Calculate aggregated portfolio metrics
  const portfolioStats = useMemo(() => {
    return calculatePortfolioStats(walletBalances, prices)
  }, [walletBalances, prices])

  // Comprehensive multi-chain breakdown across ALL coins present in the network dropdowns
  const aggregatedAssets = useMemo(() => {
    return calculateAggregatedAssets(portfolioStats, prices)
  }, [portfolioStats, prices])

  // All chains filtered and sorted from highest balance to lowest
  const chainList = useMemo(() => {
    return filterAndSortChains({
      walletBalances,
      searchQuery,
      onlyNonZero,
      prices,
    })
  }, [walletBalances, searchQuery, onlyNonZero, prices])

  if (!shouldRender) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[50000] flex justify-end overflow-hidden"
      style={{ zIndex: 50000 }}
      aria-modal="true"
      role="dialog"
    >
      {/* Dimmed Backdrop with Blur */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ease-out ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <div
        ref={drawerRef}
        className={`relative w-full max-w-[550px] h-full flex flex-col bg-[#0c0f1d] border-l border-white/10 shadow-[-16px_0_48px_rgba(0,0,0,0.85)] z-10 transform transition-transform duration-350 ${
          isVisible ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{
          background: 'linear-gradient(180deg, #0e1224 0%, #080a14 100%)',
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform',
        }}
      >
        {/* Subtle Ambient Radial Light */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 left-0 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* ── Top Header ── */}
        <div className="relative px-6 pt-5 pb-4 border-b border-white/[0.08] flex items-center justify-between shrink-0 bg-[#0e1224]/80 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(59,130,246,0.3)]">
              <Wallet className="text-white w-8 h-8" />
            </div>
            <div>
              <span className="arc-eyebrow" style={{ fontSize: 18, color: 'var(--base-colors--white)', fontWeight: 600 }}>
                Portfolio
              </span>
              <p className="text-[13px] text-slate-400">Multi-Chain Assets & Real-time Balances</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Bakiyeleri ve Fiyatları Yenile"
              aria-label="Bakiyeleri ve Fiyatları Yenile"
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer disabled:opacity-50"
            >
              <RotateCw size={16} className={isRefreshing ? 'animate-spin text-blue-400' : ''} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-4 space-y-5">
          {/* ── Total Portfolio Value Card ── */}
          <PortfolioOverviewCard
            totalUsd={portfolioStats.totalUsd}
            hideBalances={hideBalances}
            onToggleHideBalances={() => setHideBalances((prev) => !prev)}
            displayedAssets={aggregatedAssets}
            shouldRender={shouldRender}
          />

          {/* ── Search & Filter Controls ── */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search Networks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500/50 transition-colors"
              />
            </div>

            <button
              type="button"
              onClick={() => setOnlyNonZero((prev) => !prev)}
              className={`flex items-center gap-1.5 px-3 py-3 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                onlyNonZero
                  ? 'bg-indigo-600/20 border-indigo-500/40 text-indigo-300'
                  : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-white'
              }`}
            >
              <Filter size={12} />
              <span>Assets ({portfolioStats.chainsWithBalance})</span>
            </button>
          </div>

          {/* ── Supported Networks & Assets List ── */}
          <div className="space-y-3">
            {loading && Object.keys(walletBalances).length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
                <RotateCw size={24} className="animate-spin text-indigo-400" />
                <span className="text-xs font-medium">Scanning Networks</span>
              </div>
            ) : chainList.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 bg-white/[0.02] border border-white/[0.05] rounded-2xl">
                Cannot Found Networks
              </div>
            ) : (
              chainList.map((chainKey) => {
                const chainData = walletBalances[chainKey] || walletBalances[chainKey.replace('_Testnet', '')]
                const isExpanded = Boolean(expandedChains[chainKey])
                const chainTotalUsd = getChainTotalUsd(chainKey, walletBalances, prices)

                return (
                  <PortfolioChainCard
                    key={chainKey}
                    chainKey={chainKey}
                    chainData={chainData}
                    isExpanded={isExpanded}
                    onToggle={() => toggleChain(chainKey)}
                    chainTotalUsd={chainTotalUsd}
                    prices={prices}
                    hideBalances={hideBalances}
                    onNavigateToTab={onNavigateToTab}
                    onClose={onClose}
                  />
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
