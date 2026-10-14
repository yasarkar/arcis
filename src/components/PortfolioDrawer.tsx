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
  Globe,
  Eye,
  EyeOff,
} from 'lucide-react'
import { NetworkIcon, TokenIcon } from '@web3icons/react/dynamic'
import { ChainIcon } from './common/ChainIcon'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { useLiveTokenPrices, formatFiatEstimate } from '../hooks/useLiveTokenPrices'
import { getChainDisplayName, getChainIconId } from '../config/chainMeta'
import { EURC_ADDRESSES, CIRBTC_ADDRESSES, WETH_ADDRESSES, USYC_ADDRESSES } from '../config/gatewayConfig'
import { UsdcIcon, EurcIcon, CirBtcIcon, UsycIcon, PhrsIcon } from '../config/tokenIcons'

interface PortfolioDrawerProps {
  isOpen: boolean
  onClose: () => void
  walletAddress: string
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  onNavigateToTab?: (tab: string, chainKey?: string) => void
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

// Helper to render high-fidelity web3 icons for any token or native currency
function renderAssetIcon(symbol: string) {
  const s = symbol.toLowerCase()
  if (s === 'usdc') return <img src={UsdcIcon} alt="USDC" className="w-full h-full object-contain" />
  if (s === 'eurc') return <img src={EurcIcon} alt="EURC" className="w-full h-full object-contain" />
  if (s === 'cirbtc') return <img src={CirBtcIcon} alt="cirBTC" className="w-full h-full object-contain" />
  if (s === 'usyc') return <img src={UsycIcon} alt="USYC" className="w-full h-full object-contain" />
  if (s === 'weth' || s === 'eth') {
    return <TokenIcon symbol="eth" variant="branded" size={24} className="w-full h-full object-contain" />
  }
  if (s === 'pol' || s === 'matic') {
    return <TokenIcon symbol="pol" variant="branded" size={24} className="w-full h-full object-contain" />
  }
  if (s === 'avax') {
    return <TokenIcon symbol="avax" variant="branded" size={24} className="w-full h-full object-contain" />
  }
  if (s === 'sei') {
    return <TokenIcon symbol="sei" variant="branded" size={24} className="w-full h-full object-contain" />
  }
  if (s === 's' || s === 'sonic') {
    return <NetworkIcon name="sonic" variant="mono" size={24} className="text-white" />
  }
  if (s === 'phrs' || s === 'pharos') {
    return <img src={PhrsIcon} alt="PHRS" className="w-full h-full object-contain" />
  }
  if (s === 'xpl' || s === 'plasma') {
    return <TokenIcon symbol="xpl" variant="mono" size={24} className="text-white" />
  }
  if (s === 'okb' || s === 'xlayer' || s === 'x-layer') {
    return <TokenIcon symbol="okb" variant="mono" size={24} className="text-white" />
  }
  return <TokenIcon symbol={s} variant="branded" size={24} className="w-full h-full object-contain" />
}

export default function PortfolioDrawer({
  isOpen,
  onClose,
  walletAddress,
  onNavigateToTab,
}: PortfolioDrawerProps) {
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [onlyNonZero, setOnlyNonZero] = useState<boolean>(false)
  const [allocationFilter, setAllocationFilter] = useState<'all' | 'balance'>('all')
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
  const { walletBalances, loading, isFetching: isFetchingBalances, refetch: refetchBalances } = useWalletTestnetBalances(walletAddress)

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
    let totalUsdc = 0
    let totalEurc = 0
    let totalCirbtc = 0
    let totalWeth = 0
    let totalUsyc = 0
    let totalNativeUsd = 0
    let chainsWithBalance = 0
    const nativeAmounts: Record<string, { amount: number; networkCount: number }> = {}

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
        const sym = (item.nativeSymbol || 'ETH').toUpperCase()
        if (!nativeAmounts[sym]) {
          nativeAmounts[sym] = { amount: 0, networkCount: 0 }
        }
        nativeAmounts[sym].amount += nativeVal
        nativeAmounts[sym].networkCount++
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
      nativeAmounts,
      totalUsd,
      chainsWithBalance,
    }
  }, [walletBalances, prices])

  // Measure unmasked width of Total Estimated Portfolio Value to prevent eye icon jumping/layout shift
  const unmaskedTotalRef = useRef<HTMLSpanElement>(null)
  const [unmaskedTotalWidth, setUnmaskedTotalWidth] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (unmaskedTotalRef.current) {
      const w = unmaskedTotalRef.current.offsetWidth
      if (w > 0) setUnmaskedTotalWidth(w)
    }
  }, [portfolioStats.totalUsd, shouldRender])

  // Comprehensive multi-chain breakdown across ALL coins present in the network dropdowns
  const aggregatedAssets = useMemo(() => {
    const eurcPrice = prices?.EURC || 1.08
    const btcPrice = prices?.cirBTC || prices?.BTC || 85000
    const wethPrice = prices?.WETH || prices?.ETH || 2500
    const usycPrice = prices?.USYC || 1.05

    let usdcNetworks = 0
    let eurcNetworks = 0
    let cirbtcNetworks = 0
    let wethNetworks = 0
    let usycNetworks = 0

    ORDERED_CHAIN_KEYS.forEach((chainKey) => {
      usdcNetworks++
      if (EURC_ADDRESSES[chainKey]) eurcNetworks++
      if (CIRBTC_ADDRESSES[chainKey]) cirbtcNetworks++
      if (WETH_ADDRESSES[chainKey]) wethNetworks++
      if (USYC_ADDRESSES[chainKey]) usycNetworks++
    })

    const totalUsd = portfolioStats.totalUsd
    const nativeAmounts = portfolioStats.nativeAmounts

    // Define all known ecosystem tokens that exist across dropdown lists
    const assets = [
      {
        key: 'USDC',
        symbol: 'USDC',
        name: 'USD Coin',
        amount: portfolioStats.totalUsdc,
        formattedAmount: `${portfolioStats.totalUsdc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`,
        usdValue: portfolioStats.totalUsdc * 1.0,
        price: 1.0,
        isNative: false,
      },
      {
        key: 'EURC',
        symbol: 'EURC',
        name: 'Euro Coin',
        amount: portfolioStats.totalEurc,
        formattedAmount: `${portfolioStats.totalEurc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EURC`,
        usdValue: portfolioStats.totalEurc * eurcPrice,
        price: eurcPrice,
        isNative: false,
      },
      {
        key: 'ETH',
        symbol: 'ETH',
        name: 'Ethereum',
        amount: nativeAmounts['ETH']?.amount || 0,
        formattedAmount: `${(nativeAmounts['ETH']?.amount || 0).toFixed(4)} ETH`,
        usdValue: (nativeAmounts['ETH']?.amount || 0) * (prices?.WETH || prices?.ETH || 2500),
        price: prices?.WETH || prices?.ETH || 2500,
        isNative: true,
      },
      {
        key: 'cirBTC',
        symbol: 'cirBTC',
        name: 'Circle Bitcoin',
        amount: portfolioStats.totalCirbtc,
        formattedAmount: `${portfolioStats.totalCirbtc.toFixed(5)} cirBTC`,
        usdValue: portfolioStats.totalCirbtc * btcPrice,
        price: btcPrice,
        isNative: false,
      },
      {
        key: 'WETH',
        symbol: 'WETH',
        name: 'Wrapped Ether',
        amount: portfolioStats.totalWeth,
        formattedAmount: `${portfolioStats.totalWeth.toFixed(4)} WETH`,
        usdValue: portfolioStats.totalWeth * wethPrice,
        price: wethPrice,
        isNative: false,
      },
      {
        key: 'USYC',
        symbol: 'USYC',
        name: 'Hashnote USYC',
        amount: portfolioStats.totalUsyc,
        formattedAmount: `${portfolioStats.totalUsyc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USYC`,
        usdValue: portfolioStats.totalUsyc * usycPrice,
        price: usycPrice,
        isNative: false,
      },
      {
        key: 'POL',
        symbol: 'POL',
        name: 'Polygon',
        amount: nativeAmounts['POL']?.amount || 0,
        formattedAmount: `${(nativeAmounts['POL']?.amount || 0).toFixed(4)} POL`,
        usdValue: (nativeAmounts['POL']?.amount || 0) * getNativeGasPrice('POL', prices),
        price: getNativeGasPrice('POL', prices),
        isNative: true,
      },
      {
        key: 'AVAX',
        symbol: 'AVAX',
        name: 'Avalanche',
        amount: nativeAmounts['AVAX']?.amount || 0,
        formattedAmount: `${(nativeAmounts['AVAX']?.amount || 0).toFixed(4)} AVAX`,
        usdValue: (nativeAmounts['AVAX']?.amount || 0) * getNativeGasPrice('AVAX', prices),
        price: getNativeGasPrice('AVAX', prices),
        isNative: true,
      },
      {
        key: 'SEI',
        symbol: 'SEI',
        name: 'Sei Network',
        amount: nativeAmounts['SEI']?.amount || 0,
        formattedAmount: `${(nativeAmounts['SEI']?.amount || 0).toFixed(4)} SEI`,
        usdValue: (nativeAmounts['SEI']?.amount || 0) * getNativeGasPrice('SEI', prices),
        price: getNativeGasPrice('SEI', prices),
        isNative: true,
      },
      {
        key: 'S',
        symbol: 'S',
        name: 'Sonic',
        amount: nativeAmounts['S']?.amount || 0,
        formattedAmount: `${(nativeAmounts['S']?.amount || 0).toFixed(4)} S`,
        usdValue: (nativeAmounts['S']?.amount || 0) * getNativeGasPrice('S', prices),
        price: getNativeGasPrice('S', prices),
        isNative: true,
      },
    ]

    // Catch any other native token if present in walletBalances
    Object.entries(nativeAmounts).forEach(([sym, data]) => {
      if (!['ETH', 'POL', 'AVAX', 'SEI', 'S'].includes(sym)) {
        const p = getNativeGasPrice(sym, prices)
        assets.push({
          key: sym,
          symbol: sym,
          name: sym,
          amount: data.amount,
          formattedAmount: `${data.amount.toFixed(4)} ${sym}`,
          usdValue: data.amount * p,
          price: p,
          isNative: true,
        })
      }
    })

    // Compute percentage allocations and sort
    const withPercentages = assets.map((a) => ({
      ...a,
      percentage: totalUsd > 0 ? (a.usdValue / totalUsd) * 100 : 0,
    }))

    // Priority order for secondary tie-break
    const priority = ['USDC', 'EURC', 'ETH', 'cirBTC', 'WETH', 'USYC', 'POL', 'AVAX', 'SEI', 'S']
    return withPercentages.sort((a, b) => {
      if (Math.abs(b.usdValue - a.usdValue) > 0.001) {
        return b.usdValue - a.usdValue
      }
      if (Math.abs(b.amount - a.amount) > 0.00001) {
        return b.amount - a.amount
      }
      const idxA = priority.indexOf(a.symbol)
      const idxB = priority.indexOf(b.symbol)
      return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99)
    })
  }, [walletBalances, prices, portfolioStats])

  // Filtered assets based on the allocation filter (all vs positive balance only)
  const displayedAssets = useMemo(() => {
    if (allocationFilter === 'balance') {
      return aggregatedAssets.filter((a) => a.amount > 0)
    }
    return aggregatedAssets
  }, [aggregatedAssets, allocationFilter])

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

            {/* Hidden off-screen metric ruler to accurately measure the natural unmasked width */}
            <span
              ref={unmaskedTotalRef}
              aria-hidden="true"
              className="invisible fixed -top-[9999px] -left-[9999px] pointer-events-none text-3xl font-extrabold tracking-tight font-mono select-none"
            >
              ${portfolioStats.totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>

            <div className="mt-2.5 flex items-center gap-3">
              <div className="flex items-baseline gap-2">
                <span
                  style={unmaskedTotalWidth ? { minWidth: `${unmaskedTotalWidth}px`, display: 'inline-block' } : undefined}
                  className="text-3xl font-extrabold tracking-tight text-white font-mono"
                >
                  {hideBalances
                    ? '$••••••'
                    : `$${portfolioStats.totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </span>
                <span className="text-[18px] font-semibold text-white">USD</span>
              </div>

              <button
                type="button"
                onClick={() => setHideBalances((prev) => !prev)}
                title={hideBalances ? 'Bakiyeleri Göster' : 'Bakiyeleri Gizle'}
                aria-label={hideBalances ? 'Bakiyeleri Göster' : 'Bakiyeleri Gizle'}
                className="p-1.5 rounded-xl text-white hover:text-white/80 hover:bg-white/[0.08] transition-all cursor-pointer flex items-center justify-center shrink-0"
              >
                {hideBalances ? <EyeOff size={20} className="text-white" /> : <Eye size={20} className="text-white" />}
              </button>
            </div>

            {/* Aggregated Coins List (Sorted by USD value descending) */}
            <div className="space-y-2 max-h-[380px] overflow-y-auto custom-scrollbar pr-1 mt-4">
              {displayedAssets.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                  No assets with positive balance found.
                </div>
              ) : (
                displayedAssets.map((asset) => (
                  <div
                    key={asset.key}
                    className="p-2.5 rounded-2xl bg-white/[0.035] hover:bg-white/[0.06] border border-white/[0.06] hover:border-indigo-500/30 transition-all flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 shrink-0 flex items-center justify-center rounded-xl p-1.5 group-hover:scale-105 transition-transform overflow-hidden shadow-inner">
                        {renderAssetIcon(asset.symbol)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-s font-bold text-white tracking-wide">{asset.symbol}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 pl-3">
                      <div className="font-mono text-s font-bold text-white tracking-tight">
                        {hideBalances ? '••••••' : asset.formattedAmount}
                      </div>
                      <div className="text-[12px] text-slate-400 font-mono mt-0.5">
                        {hideBalances
                          ? '≈ $••••••'
                          : `≈ $${asset.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </div>
                    </div>
                  </div>
                ))
              )}
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

                const isExpanded = Boolean(expandedChains[chainKey])

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
                    onClick={() => toggleChain(chainKey)}
                    className={`group relative rounded-2xl transition-all duration-300 border cursor-pointer select-none overflow-hidden ${isExpanded
                      ? 'bg-white/[0.07] border-white/20 shadow-lg'
                      : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10'
                      }`}
                  >
                    {/* Primary Chain Row */}
                    <div className="p-3.5 flex items-center justify-between">
                      {/* Left: Chain Icon & Name */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="relative w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform overflow-hidden shadow-inner">
                          <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center shrink-0 shadow-sm">
                            <ChainIcon
                              chainKeyOrIconId={chainKey}
                              name={chainName}
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
                              {hideBalances
                                ? '$••••••'
                                : `$${chainTotalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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

                    {/* ── Sub-Tokens Accordion (Revealed on Click) ── */}
                    <div
                      onClick={(e) => e.stopPropagation()}
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
                                  <NetworkIcon name="sonic" variant="mono" size={24} className="text-white" />
                                ) : nativeSymbol.toLowerCase() === 'xpl' || iconId === 'plasma' ? (
                                  <TokenIcon symbol="xpl" variant="mono" size={24} className="text-white" />
                                ) : nativeSymbol.toLowerCase() === 'phrs' || iconId === 'pharos' ? (
                                  <img src={PhrsIcon} alt="PHRS" className="w-full h-full object-contain rounded-full" />
                                ) : nativeSymbol.toLowerCase() === 'okb' || iconId === 'x-layer' || iconId === 'xlayer' ? (
                                  <TokenIcon symbol="okb" variant="mono" size={24} className="text-white" />
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
                                {hideBalances ? '••••••' : `${nativeAmount} ${nativeSymbol}`}
                              </div>
                              <div className="text-[12px] text-slate-400 font-mono">
                                {hideBalances
                                  ? '≈ $••••••'
                                  : formatFiatEstimate(nativeAmount, nativeSymbol, prices) || `≈ $${(parseFloat(nativeAmount || '0') * getNativeGasPrice(nativeSymbol, prices)).toFixed(2)} USD`}
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
                              {hideBalances ? '••••••' : `${usdcAmount} USDC`}
                            </div>
                            <div className="text-[12px] text-slate-400 font-mono">
                              {hideBalances
                                ? '≈ $••••••'
                                : formatFiatEstimate(usdcAmount, 'USDC', prices) || `≈ $${parseFloat(usdcAmount || '0').toFixed(2)} USD`}
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
                                {hideBalances ? '••••••' : `${eurcAmount} EURC`}
                              </div>
                              <div className="text-[12px] text-slate-400 font-mono">
                                {hideBalances
                                  ? '≈ $••••••'
                                  : formatFiatEstimate(eurcAmount, 'EURC', prices) || `≈ ${(parseFloat(eurcAmount || '0') * (prices?.EURC || 1.08)).toFixed(2)} USD`}
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
                                {hideBalances ? '••••••' : `${cirbtcAmount} cirBTC`}
                              </div>
                              <div className="text-[12px] text-slate-400 font-mono">
                                {hideBalances
                                  ? '≈ $••••••'
                                  : formatFiatEstimate(cirbtcAmount, 'cirBTC', prices) || `≈ ${(parseFloat(cirbtcAmount || '0') * (prices?.cirBTC || prices?.BTC || 85000)).toFixed(2)} USD`}
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
                                {hideBalances ? '••••••' : `${wethAmount} WETH`}
                              </div>
                              <div className="text-[12px] text-slate-400 font-mono">
                                {hideBalances
                                  ? '≈ $••••••'
                                  : formatFiatEstimate(wethAmount, 'WETH', prices) || `≈ ${(parseFloat(wethAmount || '0') * (prices?.WETH || prices?.ETH || 2500)).toFixed(2)} USD`}
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
                                {hideBalances ? '••••••' : `${usycAmount} USYC`}
                              </div>
                              <div className="text-[12px] text-slate-400 font-mono">
                                {hideBalances
                                  ? '≈ $••••••'
                                  : formatFiatEstimate(usycAmount, 'USYC', prices) || `≈ ${(parseFloat(usycAmount || '0') * (prices?.USYC || 1.05)).toFixed(2)} USD`}
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
                                onNavigateToTab('swap', chainKey)
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
                                onNavigateToTab('send', chainKey)
                              }}
                              className="px-2.5 py-1 rounded-xl text-[12px] font-semibold text-slate-300 hover:text-white bg-white/[0.05] hover:bg-blue-600/30 border border-white/[0.08] hover:border-blue-500/40 transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <ArrowUpRight size={12} />
                              <span>Send</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onClose()
                                onNavigateToTab('bridge', chainKey)
                              }}
                              className="px-2.5 py-1 rounded-xl text-[12px] font-semibold text-slate-300 hover:text-white bg-white/[0.05] hover:bg-purple-600/30 border border-white/[0.08] hover:border-purple-500/40 transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <Globe size={12} />
                              <span>Bridge</span>
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
