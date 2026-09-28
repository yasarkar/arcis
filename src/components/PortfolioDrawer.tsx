// High-fidelity Multi-Chain Portfolio Slide-over Drawer for Circle User-Controlled & Modular Wallets.
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  RotateCw,
  ChevronDown,
  ArrowRightLeft,
  ArrowUpRight,
  Search,
  Filter,
  Wallet,
} from 'lucide-react'
import { NetworkIcon, TokenIcon } from '@web3icons/react/dynamic'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { useLiveTokenPrices, formatFiatEstimate } from '../hooks/useLiveTokenPrices'
import { getChainDisplayName, getChainIconId } from '../config/chainMeta'
import { EURC_ADDRESSES, CIRBTC_ADDRESSES, WETH_ADDRESSES, USYC_ADDRESSES } from '../config/gatewayConfig'
import { UsdcIcon, EurcIcon, CirBtcIcon, UsycIcon } from '../config/tokenIcons'

interface PortfolioDrawerProps {
  isOpen: boolean
  onClose: () => void
  walletAddress: string
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  onNavigateToTab?: (tab: string) => void
  onOpenFaucet?: () => void
}

// Ordered list of priority testnet networks for optimal UX
const ORDERED_CHAIN_KEYS = [
  'Arc_Testnet',
  'Base_Sepolia',
  'Ethereum_Sepolia',
  'Arbitrum_Sepolia',
  'Optimism_Sepolia',
  'Polygon_Amoy_Testnet',
  'Avalanche_Fuji',
  'Sei_Testnet',
  'Sonic_Testnet',
  'Unichain_Sepolia',
  'World_Chain_Sepolia',
]

// Helper to look up live or safe fallback price for a chain's native gas currency
function getNativeGasPrice(symbol?: string, prices?: Record<string, number> | null): number {
  const s = (symbol || '').toUpperCase().trim()
  if (s === 'ETH') return prices?.WETH || prices?.ETH || 2500
  if (s === 'POL' || s === 'MATIC') return prices?.POL || prices?.MATIC || 0.40
  if (s === 'AVAX') return prices?.AVAX || 26.50
  if (s === 'SOL') return prices?.SOL || 145.0
  if (s === 'SEI') return prices?.SEI || 0.35
  if (s === 'S') return prices?.S || 0.65
  if (s === 'USDC') return 1.0
  return prices?.[s] || 0
}

export default function PortfolioDrawer({
  isOpen,
  onClose,
  walletAddress,
  onNavigateToTab,
}: PortfolioDrawerProps) {
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [onlyNonZero, setOnlyNonZero] = useState<boolean>(false)
  const [hoveredChainKey, setHoveredChainKey] = useState<string | null>(null)
  const [expandedChainKey, setExpandedChainKey] = useState<string | null>(null)

  // Drawer container ref for keyboard navigation & focus
  const drawerRef = useRef<HTMLDivElement>(null)

  // Fetch all multi-chain balances for the user address
  const { walletBalances, loading, isFetching, refetch } = useWalletTestnetBalances(walletAddress)

  // Live prices for fiat conversions
  const { data: prices } = useLiveTokenPrices()

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
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  // Calculate aggregated portfolio metrics
  const portfolioStats = useMemo(() => {
    let totalUsdc = 0
    let totalEurc = 0
    let totalCirbtc = 0
    let totalWeth = 0
    let totalUsyc = 0
    let totalNativeUsd = 0
    let chainsWithBalance = 0

    ORDERED_CHAIN_KEYS.forEach((chainKey) => {
      const item = walletBalances[chainKey] || walletBalances[chainKey.replace('_Testnet', '')]
      if (!item) return

      const isArc = chainKey === 'Arc_Testnet' || chainKey === 'Arc'
      const usdcVal = parseFloat(item.usdc || '0')
      const eurcVal = item.eurc ? parseFloat(item.eurc) : 0
      const cirbtcVal = item.cirbtc ? parseFloat(item.cirbtc) : 0
      const wethVal = item.weth ? parseFloat(item.weth) : 0
      const usycVal = item.usyc ? parseFloat(item.usyc) : 0
      const nativeVal = !isArc && item.nativeAmount ? parseFloat(item.nativeAmount) : 0

      if (!isNaN(usdcVal)) totalUsdc += usdcVal
      if (!isNaN(eurcVal)) totalEurc += eurcVal
      if (!isNaN(cirbtcVal)) totalCirbtc += cirbtcVal
      if (!isNaN(wethVal)) totalWeth += wethVal
      if (!isNaN(usycVal)) totalUsyc += usycVal
      if (!isNaN(nativeVal) && nativeVal > 0) {
        totalNativeUsd += nativeVal * getNativeGasPrice(item.nativeSymbol, prices)
      }

      if (usdcVal > 0 || eurcVal > 0 || cirbtcVal > 0 || wethVal > 0 || usycVal > 0 || nativeVal > 0) {
        chainsWithBalance++
      }
    })

    // Approximate total USD valuation
    const eurcPrice = prices?.EURC || 1.08
    const btcPrice = prices?.cirBTC || prices?.BTC || 85000
    const wethPrice = prices?.WETH || prices?.ETH || 2500
    const usycPrice = prices?.USYC || 1.05
    const totalUsd =
      totalUsdc * 1.0 +
      totalEurc * eurcPrice +
      totalCirbtc * btcPrice +
      totalWeth * wethPrice +
      totalUsyc * usycPrice +
      totalNativeUsd

    return {
      totalUsdc,
      totalEurc,
      totalCirbtc,
      totalWeth,
      totalUsyc,
      totalNativeUsd,
      totalUsd,
      chainsWithBalance,
    }
  }, [walletBalances, prices])

  // Asset-level USD valuation and percentage allocations
  const assetMetrics = useMemo(() => {
    const eurcPrice = prices?.EURC || 1.08
    const btcPrice = prices?.cirBTC || prices?.BTC || 85000
    const wethPrice = prices?.WETH || prices?.ETH || 2500
    const usycPrice = prices?.USYC || 1.05

    const usdcUsd = portfolioStats.totalUsdc * 1.0
    const eurcUsd = portfolioStats.totalEurc * eurcPrice
    const cirbtcUsd = portfolioStats.totalCirbtc * btcPrice
    const wethUsd = portfolioStats.totalWeth * wethPrice
    const usycUsd = portfolioStats.totalUsyc * usycPrice
    const totalUsd = portfolioStats.totalUsd

    const usdcPct = totalUsd > 0 ? (usdcUsd / totalUsd) * 100 : 0
    const eurcPct = totalUsd > 0 ? (eurcUsd / totalUsd) * 100 : 0
    const cirbtcPct = totalUsd > 0 ? (cirbtcUsd / totalUsd) * 100 : 0
    const wethPct = totalUsd > 0 ? (wethUsd / totalUsd) * 100 : 0
    const usycPct = totalUsd > 0 ? (usycUsd / totalUsd) * 100 : 0

    return {
      usdcUsd,
      usdcPct,
      eurcUsd,
      eurcPct,
      cirbtcUsd,
      cirbtcPct,
      wethUsd,
      wethPct,
      usycUsd,
      usycPct,
    }
  }, [portfolioStats, prices])

  // Helper to compute a chain's total USD valuation across all supported tokens (USDC, EURC, cirBTC, WETH, USYC, Native Gas)
  const getChainTotalUsd = (chainKey: string): number => {
    const item = walletBalances[chainKey] || walletBalances[chainKey.replace('_Testnet', '')]
    if (!item) return 0
    const usdcVal = parseFloat(item.usdc || '0')
    const eurcVal = item.eurc ? parseFloat(item.eurc) : 0
    const cirbtcVal = item.cirbtc ? parseFloat(item.cirbtc) : 0
    const wethVal = item.weth ? parseFloat(item.weth) : 0
    const usycVal = item.usyc ? parseFloat(item.usyc) : 0
    const eurcPrice = prices?.EURC || 1.08
    const btcPrice = prices?.cirBTC || prices?.BTC || 85000
    const wethPrice = prices?.WETH || prices?.ETH || 2500
    const usycPrice = prices?.USYC || 1.05

    const safeUsdc = isNaN(usdcVal) ? 0 : usdcVal
    const safeEurc = isNaN(eurcVal) ? 0 : eurcVal
    const safeBtc = isNaN(cirbtcVal) ? 0 : cirbtcVal
    const safeWeth = isNaN(wethVal) ? 0 : wethVal
    const safeUsyc = isNaN(usycVal) ? 0 : usycVal

    // Native gas valuation for non-Arc chains (on Arc, native is USDC - no double count)
    const isArc = chainKey === 'Arc_Testnet' || chainKey === 'Arc'
    let nativeUsd = 0
    if (!isArc && item.nativeAmount) {
      const nativeVal = parseFloat(item.nativeAmount)
      if (!isNaN(nativeVal) && nativeVal > 0) {
        nativeUsd = nativeVal * getNativeGasPrice(item.nativeSymbol, prices)
      }
    }

    return safeUsdc * 1.0 + safeEurc * eurcPrice + safeBtc * btcPrice + safeWeth * wethPrice + safeUsyc * usycPrice + nativeUsd
  }

  // All chains filtered and sorted from highest balance to lowest
  const chainList = useMemo(() => {
    const filtered = ORDERED_CHAIN_KEYS.filter((chainKey) => {
      if (chainKey === 'Arc') return false
      const item = walletBalances[chainKey] || walletBalances[chainKey.replace('_Testnet', '')]
      const name = item?.chainName || getChainDisplayName(chainKey)
      const matchesSearch =
        !searchQuery.trim() ||
        name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        chainKey.toLowerCase().includes(searchQuery.toLowerCase())

      if (!matchesSearch) return false

      if (onlyNonZero) {
        const isArc = chainKey === 'Arc_Testnet' || chainKey === 'Arc'
        const usdcVal = parseFloat(item?.usdc || '0')
        const eurcVal = item?.eurc ? parseFloat(item.eurc) : 0
        const cirbtcVal = item?.cirbtc ? parseFloat(item.cirbtc) : 0
        const wethVal = item?.weth ? parseFloat(item.weth) : 0
        const usycVal = item?.usyc ? parseFloat(item.usyc) : 0
        const nativeVal = !isArc && item?.nativeAmount ? parseFloat(item.nativeAmount) : 0
        return usdcVal > 0 || eurcVal > 0 || cirbtcVal > 0 || wethVal > 0 || usycVal > 0 || nativeVal > 0
      }

      return true
    })

    return [...filtered].sort((a, b) => {
      const totalA = getChainTotalUsd(a)
      const totalB = getChainTotalUsd(b)

      // 1. Sort by total chain valuation descending (en yüksek bakiye en üstte)
      if (Math.abs(totalB - totalA) > 0.000001) {
        return totalB - totalA
      }

      // 2. Secondary sort: USDC balance descending
      const usdcA = parseFloat(walletBalances[a]?.usdc || '0') || 0
      const usdcB = parseFloat(walletBalances[b]?.usdc || '0') || 0
      if (Math.abs(usdcB - usdcA) > 0.000001) {
        return usdcB - usdcA
      }

      // 3. Fallback to default priority order
      return ORDERED_CHAIN_KEYS.indexOf(a) - ORDERED_CHAIN_KEYS.indexOf(b)
    })
  }, [walletBalances, searchQuery, onlyNonZero, prices])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end" aria-modal="true" role="dialog">
      {/* Dimmed Backdrop with Blur */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Drawer Panel */}
      <div
        ref={drawerRef}
        className="relative w-full max-w-[550px] h-full flex flex-col bg-[#0c0f1d] border-l border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.85)] z-10 transition-transform duration-300 ease-out animate-slide-in-right"
        style={{
          background: 'linear-gradient(180deg, #0e1224 0%, #080a14 100%)',
        }}
      >
        {/* Subtle Ambient Radial Light */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 left-0 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* ── Top Header ── */}
        <div className="relative px-6 pt-5 pb-4 border-b border-white/[0.08] flex items-center justify-between shrink-0 bg-[#0e1224]/80 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(59,130,246,0.3)]">
              <Wallet className='text-white w-8 h-8' />
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
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer disabled:opacity-50"
            >
              <RotateCw size={16} className={isFetching ? 'animate-spin text-blue-400' : ''} />
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
          <div
            className="relative p-5 rounded-3xl overflow-hidden"
            style={{
              background: 'linear-gradient(180deg, #0e1224 0%, #080a14 100%)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              boxShadow: '0 8px 32px -4px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-s font-medium text-slate-300 flex items-center gap-2">
                Total Estimated Portfolio Value
              </span>
            </div>

            <div className="mt-2.5 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold tracking-tight text-white font-mono">
                ${portfolioStats.totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[15px] font-semibold text-indigo-300">USD</span>
            </div>

            {/* Asset Allocation Breakdown */}
            <div className="pt-3.5 space-y-2">
              {/* USDC */}
              <div className="p-2.5 rounded-2xl bg-white/[0.035] hover:bg-white/[0.06] border border-white/[0.06] hover:border-blue-500/30 transition-all flex items-center justify-between group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 shrink-0 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <img src={UsdcIcon} alt="USDC" className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-s font-bold text-white tracking-wide">USDC</span>
                    </div>
                    <div className="text-[13px] text-slate-400 font-mono mt-0.5">
                      ≈ ${assetMetrics.usdcUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 pl-3">
                  <div className="font-mono text-s font-bold text-white tracking-tight">
                    {portfolioStats.totalUsdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {/* EURC */}
              <div className="p-2.5 rounded-2xl bg-white/[0.035] hover:bg-white/[0.06] border border-white/[0.06] hover:border-blue-500/30 transition-all flex items-center justify-between group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 shrink-0 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <img src={EurcIcon} alt="EURC" className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-s font-bold text-white tracking-wide">EURC</span>
                    </div>
                    <div className="text-[13px] text-slate-400 font-mono mt-0.5">
                      ≈ ${assetMetrics.eurcUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 pl-3">
                  <div className="font-mono text-s font-bold text-white tracking-tight">
                    {portfolioStats.totalEurc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {/* cirBTC */}
              <div className="p-2.5 rounded-2xl bg-white/[0.035] hover:bg-white/[0.06] border border-white/[0.06] hover:border-blue-500/30 transition-all flex items-center justify-between group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 shrink-0 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <img src={CirBtcIcon} alt="cirBTC" className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-s font-bold text-white tracking-wide">cirBTC</span>
                    </div>
                    <div className="text-[13px] text-slate-400 font-mono mt-0.5">
                      ≈ ${assetMetrics.cirbtcUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 pl-3">
                  <div className="font-mono text-s font-bold text-white tracking-tight">
                    {portfolioStats.totalCirbtc.toFixed(5)}
                  </div>
                </div>
              </div>

              {/* WETH */}
              <div className="p-2.5 rounded-2xl bg-white/[0.035] hover:bg-white/[0.06] border border-white/[0.06] hover:border-blue-500/30 transition-all flex items-center justify-between group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 shrink-0 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <TokenIcon symbol="eth" variant="branded" size={26} className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-s font-bold text-white tracking-wide">WETH</span>
                    </div>
                    <div className="text-[13px] text-slate-400 font-mono mt-0.5">
                      ≈ ${assetMetrics.wethUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 pl-3">
                  <div className="font-mono text-s font-bold text-white tracking-tight">
                    {portfolioStats.totalWeth.toFixed(4)}
                  </div>
                </div>
              </div>

              {/* USYC */}
              <div className="p-2.5 rounded-2xl bg-white/[0.035] hover:bg-white/[0.06] border border-white/[0.06] hover:border-blue-500/30 transition-all flex items-center justify-between group">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 shrink-0 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <img src={UsycIcon} alt="USYC" className="w-full h-full object-contain" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-s font-bold text-white tracking-wide">USYC</span>
                    </div>
                    <div className="text-[13px] text-slate-400 font-mono mt-0.5">
                      ≈ ${assetMetrics.usycUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0 pl-3">
                  <div className="font-mono text-s font-bold text-white tracking-tight">
                    {portfolioStats.totalUsyc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            </div>
          </div>

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
              className={`flex items-center gap-1.5 px-3 py-3 rounded-xl text-xs font-medium border transition-all cursor-pointer ${onlyNonZero
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
                const chainName = chainData?.chainName || getChainDisplayName(chainKey)
                const iconId = getChainIconId(chainKey)
                const isArc = chainKey === 'Arc_Testnet' || chainKey === 'Arc'

                const hasEurc = Boolean(EURC_ADDRESSES[chainKey])
                const hasCirbtc = Boolean(CIRBTC_ADDRESSES[chainKey])
                const hasWeth = Boolean(WETH_ADDRESSES[chainKey])
                const hasUsyc = Boolean(USYC_ADDRESSES[chainKey])

                const isHovered = hoveredChainKey === chainKey
                const isExpanded = expandedChainKey === chainKey || isHovered

                const usdcAmount = chainData?.usdc || '0.00'
                const eurcAmount = chainData?.eurc || (hasEurc ? '0.00' : undefined)
                const cirbtcAmount = chainData?.cirbtc || (hasCirbtc ? '0.00000' : undefined)
                const wethAmount = chainData?.weth || (hasWeth ? '0.0000' : undefined)
                const usycAmount = chainData?.usyc || (hasUsyc ? '0.00' : undefined)
                const nativeAmount = chainData?.nativeAmount || '0.0000'
                const nativeSymbol = chainData?.nativeSymbol || (isArc ? 'USDC' : 'ETH')
                const chainTotalUsd = getChainTotalUsd(chainKey)

                return (
                  <div
                    key={chainKey}
                    onMouseEnter={() => setHoveredChainKey(chainKey)}
                    onMouseLeave={() => setHoveredChainKey(null)}
                    onClick={() => {
                      setExpandedChainKey((prev) => (prev === chainKey ? null : chainKey))
                    }}
                    className={`group relative rounded-2xl transition-all duration-300 border cursor-pointer select-none overflow-hidden ${isExpanded
                      ? 'bg-white/[0.07] border-white/20 shadow-lg'
                      : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10'
                      }`}
                  >
                    {/* Primary Chain Row */}
                    <div className="p-3.5 flex items-center justify-between">
                      {/* Left: Chain Icon & Name */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative w-10 h-10 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform overflow-hidden shadow-inner">
                          <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center shrink-0 shadow-sm">
                            <NetworkIcon
                              name={iconId}
                              variant={iconId === 'solana' ? 'branded' : 'background'}
                              size={36}
                              className="rounded-full overflow-hidden"
                            />
                          </div>
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[14px] font-bold text-white tracking-wide truncate">
                              {chainName}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Total Chain USD Value */}
                      <div className="flex items-center gap-2.5 shrink-0 text-right">
                        <div>
                          <div className="flex items-baseline justify-end gap-1">
                            <span className="font-mono text-[18px] font-bold text-white tracking-tight">
                              ${chainTotalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            <span className="text-[12px] font-bold text-white">USD</span>
                          </div>
                        </div>

                        <ChevronDown
                          size={14}
                          className={`text-slate-400 transition-transform duration-300 shrink-0 ${isExpanded ? 'rotate-180 text-white' : 'group-hover:translate-y-0.5'
                            }`}
                        />
                      </div>
                    </div>

                    {/* ── Sub-Tokens Accordion (Revealed on Hover / Click) ── */}
                    <div
                      className={`transition-all duration-300 ease-out border-t border-white/[0.06] bg-[#070912]/80 backdrop-blur-md px-3.5 overflow-hidden ${isExpanded
                        ? 'max-h-[760px] py-3 opacity-100'
                        : 'max-h-0 py-0 opacity-0 pointer-events-none'
                        }`}
                    >
                      <div className="space-y-2">
                        {/* Native Gas Token Row (for Non-Arc Chains with distinct native token like ETH, POL, AVAX, S, SEI) */}
                        {!isArc && (
                          <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm overflow-hidden">
                                {nativeSymbol.toLowerCase() === 's' || iconId === 'sonic' ? (
                                  <NetworkIcon name="sonic" variant="background" size={36} className="rounded-full overflow-hidden" />
                                ) : (
                                  <TokenIcon
                                    symbol={nativeSymbol.toLowerCase() === 'pol' ? 'pol' : nativeSymbol.toLowerCase()}
                                    variant="branded"
                                    size={24}
                                    className="w-full h-full object-contain"
                                  />
                                )}
                              </div>
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-s font-semibold text-slate-200">{nativeSymbol}</span>
                                </div>
                              </div>
                            </div>

                            <div className="text-right">
                              <div className="font-mono text-s font-bold text-white">
                                {nativeAmount} {nativeSymbol}
                              </div>
                              <div className="text-[12px] text-slate-400 font-mono">
                                {formatFiatEstimate(nativeAmount, nativeSymbol, prices) || `≈ $${(parseFloat(nativeAmount || '0') * getNativeGasPrice(nativeSymbol, prices)).toFixed(2)} USD`}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* USDC Token Row */}
                        <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <img src={UsdcIcon} alt="USDC" className="w-8 h-8 object-contain" />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-s font-semibold text-slate-200">USDC</span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="font-mono text-s font-bold text-white">
                              {usdcAmount} USDC
                            </div>
                            <div className="text-[12px] text-slate-400 font-mono">
                              {formatFiatEstimate(usdcAmount, 'USDC', prices) || `≈ $${parseFloat(usdcAmount || '0').toFixed(2)} USD`}
                            </div>
                          </div>
                        </div>

                        {/* EURC Token Row */}
                        {hasEurc && (
                          <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <img src={EurcIcon} alt="EURC" className="w-8 h-8 object-contain" />
                              <div>
                                <div className="text-s font-semibold text-slate-200">EURC</div>
                              </div>
                            </div>

                            <div className="text-right">
                              <div className="font-mono text-s font-bold text-slate-200">
                                {eurcAmount} EURC
                              </div>
                              <div className="text-[12px] text-slate-400 font-mono">
                                {formatFiatEstimate(eurcAmount, 'EURC', prices) || `≈ ${(parseFloat(eurcAmount || '0') * (prices?.EURC || 1.08)).toFixed(2)} USD`}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* cirBTC Token Row */}
                        {hasCirbtc && (
                          <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <img src={CirBtcIcon} alt="cirBTC" className="w-8 h-8 object-contain" />
                              <div>
                                <div className="text-s font-semibold text-slate-200">cirBTC</div>
                              </div>
                            </div>

                            <div className="text-right">
                              <div className="font-mono text-s font-bold text-white">
                                {cirbtcAmount} cirBTC
                              </div>
                              <div className="text-[12px] text-slate-400 font-mono">
                                {formatFiatEstimate(cirbtcAmount, 'cirBTC', prices) || `≈ ${(parseFloat(cirbtcAmount || '0') * (prices?.cirBTC || prices?.BTC || 85000)).toFixed(2)} USD`}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* WETH Token Row */}
                        {hasWeth && (
                          <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm">
                                <TokenIcon symbol="eth" variant="branded" size={20} className="w-8 h-8 object-contain" />
                              </div>
                              <div>
                                <div className="text-s font-semibold text-slate-200">WETH</div>
                              </div>
                            </div>

                            <div className="text-right">
                              <div className="font-mono text-s font-bold text-white">
                                {wethAmount} WETH
                              </div>
                              <div className="text-[12px] text-slate-400 font-mono">
                                {formatFiatEstimate(wethAmount, 'WETH', prices) || `≈ ${(parseFloat(wethAmount || '0') * (prices?.WETH || prices?.ETH || 2500)).toFixed(2)} USD`}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* USYC Token Row */}
                        {hasUsyc && (
                          <div className="p-2 rounded-xl bg-white/[0.03] border border-white/[0.04] flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm overflow-hidden">
                                <img src={UsycIcon} alt="USYC" className="w-8 h-8 object-contain" />
                              </div>
                              <div>
                                <div className="text-s font-semibold text-slate-200">USYC</div>
                              </div>
                            </div>

                            <div className="text-right">
                              <div className="font-mono text-s font-bold text-white">
                                {usycAmount} USYC
                              </div>
                              <div className="text-[12px] text-slate-400 font-mono">
                                {formatFiatEstimate(usycAmount, 'USYC', prices) || `≈ ${(parseFloat(usycAmount || '0') * (prices?.USYC || 1.05)).toFixed(2)} USD`}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Quick Action Shortcuts */}
                      <div className="mt-2.5 pt-2 border-t border-white/[0.04] flex items-center justify-start gap-2">
                        {onNavigateToTab && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onClose()
                                onNavigateToTab('swap')
                              }}
                              className="px-2.5 py-1 rounded-xl text-[12px] font-semibold text-slate-300 hover:text-white bg-white/[0.05] hover:bg-indigo-600/30 border border-white/[0.08] hover:border-indigo-500/40 transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <ArrowRightLeft size={12} />
                              <span>Swap</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onClose()
                                onNavigateToTab('send')
                              }}
                              className="px-2.5 py-1 rounded-xl text-[12px] font-semibold text-slate-300 hover:text-white bg-white/[0.05] hover:bg-blue-600/30 border border-white/[0.08] hover:border-blue-500/40 transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <ArrowUpRight size={12} />
                              <span>Send</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
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
