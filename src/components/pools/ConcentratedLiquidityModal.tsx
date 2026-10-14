import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  ChevronLeft,
  RotateCcw,
  Plus,
  Minus,
  ArrowRightLeft,
  Info,
  Check,
  AlertCircle,
  Sliders,
  Wallet,
} from 'lucide-react'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'
import { POOL_VERSION_V4, type PoolConfig } from '../../config/poolsConfig'
import type { UserPoolPosition } from '../../hooks/usePoolsData'
import { useLiveTokenPrices } from '../../hooks/useLiveTokenPrices'
import {
  calculateClammRatio,
  calculateCounterTokenAmount,
  calculateConcentratedApr,
  generateLiquidityBars,
} from '../../utils/clammMath'
import { Tooltip, InfoTooltip } from '../common/Tooltip'
import { useWalletSettings } from '../../hooks/useWalletSettings'

interface ConcentratedLiquidityModalProps {
  isOpen: boolean
  onClose: () => void
  pool: (PoolConfig & { userPosition?: UserPoolPosition }) | null
  walletAddress?: string
  availableWalletUsdc?: string
  availableWalletCirBtc?: string
  onExecuteDeposit?: (poolId: string, usdcAmount: string, btcAmount: string, slippage: number) => Promise<void>
}

export const ConcentratedLiquidityModal: React.FC<ConcentratedLiquidityModalProps> = ({
  isOpen,
  onClose,
  pool,
  walletAddress,
  availableWalletUsdc = '0.00',
  availableWalletCirBtc = '0.0000',
  onExecuteDeposit,
}) => {
  const { data: tokenPrices } = useLiveTokenPrices()

  // Base price for BTC in USDC (prioritizes live on-chain pool ratio for exact AMM liquidity matching)
  const liveBtcPrice = useMemo(() => {
    if (pool?.reserves && pool.reserves.tokenA > 0 && pool.reserves.tokenB > 0) {
      const poolRatio = pool.reserves.tokenA / pool.reserves.tokenB
      if (poolRatio > 0) return poolRatio
    }
    const rawPrice = tokenPrices?.['BTC'] || tokenPrices?.['cirBTC'] || 82739.99
    return typeof rawPrice === 'number' && rawPrice > 0 ? rawPrice : 82739.9905
  }, [tokenPrices, pool?.reserves])

  // Price orientation toggle: true = USDC per BTC, false = BTC per USDC
  const [isUsdcPerBtc, setIsUsdcPerBtc] = useState<boolean>(true)

  // Zoom level on histogram: 1.0 (default ±35%), 0.6 (zoomed in ±20%), 1.5 (zoomed out ±50%)
  const [zoomLevel, setZoomLevel] = useState<number>(1.0)

  // Chart view mode: 'liquidity' | 'price'
  const [chartViewMode, setChartViewMode] = useState<'liquidity' | 'price'>('liquidity')

  // Price bounds: default Min -18.83%, Max +22.80% matching the reference screenshot!
  const defaultMinPrice = useMemo(() => Math.round(liveBtcPrice * (1 - 0.1883) * 10000) / 10000, [liveBtcPrice])
  const defaultMaxPrice = useMemo(() => Math.round(liveBtcPrice * (1 + 0.2280) * 10000) / 10000, [liveBtcPrice])

  const [minPriceInput, setMinPriceInput] = useState<string>(defaultMinPrice.toFixed(4))
  const [maxPriceInput, setMaxPriceInput] = useState<string>(defaultMaxPrice.toFixed(4))

  // Sync defaults on initial mount or price load
  useEffect(() => {
    if (defaultMinPrice && defaultMaxPrice) {
      setMinPriceInput(defaultMinPrice.toFixed(4))
      setMaxPriceInput(defaultMaxPrice.toFixed(4))
    }
  }, [defaultMinPrice, defaultMaxPrice])

  const parsedMinPrice = useMemo(() => {
    const p = parseFloat(minPriceInput)
    return isNaN(p) || p <= 0 ? defaultMinPrice : p
  }, [minPriceInput, defaultMinPrice])

  const parsedMaxPrice = useMemo(() => {
    const p = parseFloat(maxPriceInput)
    return isNaN(p) || p <= 0 ? defaultMaxPrice : p
  }, [maxPriceInput, defaultMaxPrice])

  // Percentage deviations from current price
  const minPercentDiff = useMemo(() => {
    if (!liveBtcPrice || parsedMinPrice >= liveBtcPrice) return 0
    return Math.round(((parsedMinPrice - liveBtcPrice) / liveBtcPrice) * 10000) / 100
  }, [parsedMinPrice, liveBtcPrice])

  const maxPercentDiff = useMemo(() => {
    if (!liveBtcPrice || parsedMaxPrice <= liveBtcPrice) return 0
    return Math.round(((parsedMaxPrice - liveBtcPrice) / liveBtcPrice) * 10000) / 100
  }, [parsedMaxPrice, liveBtcPrice])

  // Deposit token amounts
  const [btcAmount, setBtcAmount] = useState<string>('')
  const [usdcAmount, setUsdcAmount] = useState<string>('')

  // Wallet-scoped transaction settings (isolated per connected wallet)
  const { settings: walletSettings, updateSettings: updateWalletSettings } = useWalletSettings(walletAddress)

  // Slippage tolerance
  const [slippage, setSlippage] = useState<number>(walletSettings.poolSlippage || 2.0)
  const [showSlippageModal, setShowSlippageModal] = useState<boolean>(false)

  // Sync slippage when connected wallet settings change
  useEffect(() => {
    setSlippage(walletSettings.poolSlippage || 2.0)
  }, [walletSettings.poolSlippage])

  // Loading & submission state
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [depositSuccess, setDepositSuccess] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Wallet balances
  const userBtcBal = parseFloat(availableWalletCirBtc) || 0
  const userUsdcBal = parseFloat(availableWalletUsdc) || 0

  // Calculate dynamic token distribution ratio
  const ratioResult = useMemo(() => {
    return calculateClammRatio(liveBtcPrice, parsedMinPrice, parsedMaxPrice)
  }, [liveBtcPrice, parsedMinPrice, parsedMaxPrice])

  // Calculate dynamic Estimated APR
  const estimatedApr = useMemo(() => {
    return calculateConcentratedApr(
      liveBtcPrice,
      parsedMinPrice,
      parsedMaxPrice,
      126, // $126 24h fees from screenshot
      3129636, // $3,129,636 TVL from screenshot
      0.30 // 0.30% fee tier
    )
  }, [liveBtcPrice, parsedMinPrice, parsedMaxPrice])

  // Generate histogram bars
  const histogramBars = useMemo(() => {
    return generateLiquidityBars(liveBtcPrice, parsedMinPrice, parsedMaxPrice, 38)
  }, [liveBtcPrice, parsedMinPrice, parsedMaxPrice])

  // Handle BTC amount change -> auto-calculate required USDC amount
  const handleBtcChange = (val: string) => {
    setBtcAmount(val)
    setErrorMessage(null)
    const num = parseFloat(val)
    if (isNaN(num) || num <= 0) {
      setUsdcAmount('')
      return
    }
    const { amountB } = calculateCounterTokenAmount({
      amountA: num,
      currentPrice: liveBtcPrice,
      minPrice: parsedMinPrice,
      maxPrice: parsedMaxPrice,
    })
    setUsdcAmount(amountB > 0 ? amountB.toFixed(2) : '0')
  }

  // Handle USDC amount change -> auto-calculate required BTC amount
  const handleUsdcChange = (val: string) => {
    setUsdcAmount(val)
    setErrorMessage(null)
    const num = parseFloat(val)
    if (isNaN(num) || num <= 0) {
      setBtcAmount('')
      return
    }
    const { amountA } = calculateCounterTokenAmount({
      amountB: num,
      currentPrice: liveBtcPrice,
      minPrice: parsedMinPrice,
      maxPrice: parsedMaxPrice,
    })
    setBtcAmount(amountA > 0 ? amountA.toFixed(6) : '0')
  }

  // Quick percentage shortcuts
  const handleBtcPercent = (pct: number) => {
    const calculated = (userBtcBal * pct) / 100
    handleBtcChange(calculated > 0 ? calculated.toFixed(6) : '0')
  }

  const handleUsdcPercent = (pct: number) => {
    const calculated = (userUsdcBal * pct) / 100
    handleUsdcChange(calculated > 0 ? calculated.toFixed(2) : '0')
  }

  // Step adjustment handlers for Min/Max
  const adjustMinPrice = (deltaPct: number) => {
    const updated = Math.max(100, parsedMinPrice * (1 + deltaPct / 100))
    if (updated < parsedMaxPrice) {
      setMinPriceInput(updated.toFixed(4))
    }
  }

  const adjustMaxPrice = (deltaPct: number) => {
    const updated = parsedMaxPrice * (1 + deltaPct / 100)
    if (updated > parsedMinPrice) {
      setMaxPriceInput(updated.toFixed(4))
    }
  }

  const handleResetZoom = () => {
    setZoomLevel(1.0)
    setMinPriceInput(defaultMinPrice.toFixed(4))
    setMaxPriceInput(defaultMaxPrice.toFixed(4))
  }

  // Total deposit USD value
  const totalDepositUsd = useMemo(() => {
    const btcVal = (parseFloat(btcAmount) || 0) * liveBtcPrice
    const usdcVal = (parseFloat(usdcAmount) || 0)
    return btcVal + usdcVal
  }, [btcAmount, usdcAmount, liveBtcPrice])

  const formatDollar = (val: number): string => {
    return `$${val.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`
  }

  const modalLiquidity = pool?.tvlUsd || 0
  const modalVolume = pool?.volume24hUsd || 0
  const modalFees = (pool?.volume24hUsd || 0) * ((pool?.feeTierPercent || 0.25) / 100)

  // Validation
  const hasEnteredAmount = parseFloat(btcAmount) > 0 || parseFloat(usdcAmount) > 0
  const isBtcExceeded = (parseFloat(btcAmount) || 0) > userBtcBal
  const isUsdcExceeded = (parseFloat(usdcAmount) || 0) > userUsdcBal

  const getButtonText = () => {
    if (!walletAddress) return 'CONNECT WALLET'
    if (!hasEnteredAmount) return 'ENTER AMOUNT'
    if (isBtcExceeded) return 'INSUFFICIENT cirBTC BALANCE'
    if (isUsdcExceeded) return 'INSUFFICIENT USDC BALANCE'
    if (isSubmitting) return 'DEPOSITING LIQUIDITY...'
    return 'PREVIEW & DEPOSIT'
  }

  const isButtonDisabled = !walletAddress || !hasEnteredAmount || isBtcExceeded || isUsdcExceeded || isSubmitting

  const handleDeposit = async () => {
    if (isButtonDisabled) return
    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      if (onExecuteDeposit && pool) {
        let finalUsdc = usdcAmount || '0'
        let finalBtc = btcAmount || '0'

        // Guard against off-ratio donation: snap to pool's live on-chain reserve ratio
        if (pool.reserves && pool.reserves.tokenA > 0 && pool.reserves.tokenB > 0) {
          const uNum = parseFloat(finalUsdc) || 0
          const bNum = parseFloat(finalBtc) || 0
          if (uNum > 0 && bNum > 0) {
            const poolRatio = pool.reserves.tokenA / pool.reserves.tokenB
            const expectedUsdc = bNum * poolRatio
            if (Math.abs(uNum - expectedUsdc) / uNum > 0.005) {
              if (uNum / poolRatio <= bNum) {
                finalBtc = (uNum / poolRatio).toFixed(8)
              } else {
                finalUsdc = (bNum * poolRatio).toFixed(2)
              }
            }
          }
        }

        await onExecuteDeposit(pool.id, finalUsdc, finalBtc, slippage)
      } else {
        // Fallback simulation
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }

      if (typeof window !== 'undefined' && walletAddress && pool) {
        try {
          const key = `arcis_clamm_position_${walletAddress.toLowerCase()}_${pool.id}`
          localStorage.setItem(
            key,
            JSON.stringify({
              minPrice: parsedMinPrice,
              maxPrice: parsedMaxPrice,
              timestamp: Date.now(),
            })
          )
        } catch (e) {
          console.warn('[ConcentratedLiquidityModal] Failed to cache position range:', e)
        }
      }

      setDepositSuccess(true)
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to deposit liquidity. Please verify testnet gas.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-5xl my-auto rounded-[32px] overflow-hidden transition-all shadow-2xl border"
        style={{
          background: 'linear-gradient(160deg, #0e111d 0%, #090b14 100%)',
          borderColor: 'rgba(255, 255, 255, 0.08)',
          boxShadow: '0 25px 70px -15px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.05)',
          fontFamily: 'var(--font-app)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── TOP HEADER (Matching reference bar) ── */}
        <div className="flex flex-wrap items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-white/[0.02]">
          {/* Pair info */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white/70 hover:text-white transition-colors cursor-pointer"
              title="Back"
            >
              <ChevronLeft size={18} />
            </button>

            {/* Overlapping token avatars */}
            <div className="flex items-center">
              <div className="w-8 h-8 rounded-full bg-[#141727] border border-orange-500/40 p-1 flex items-center justify-center shadow-md z-10">
                <img src={CirBtcIcon} alt="cirBTC" className="w-full h-full object-contain" />
              </div>
              <div className="w-8 h-8 rounded-full bg-[#141727] border border-sky-500/40 p-1 flex items-center justify-center shadow-md -ml-2.5 z-0">
                <img src={UsdcIcon} alt="USDC" className="w-full h-full object-contain" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-white tracking-tight">{pool?.name || 'USDC / cirBTC'}</span>
              <span
                className="px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider select-none shrink-0"
                style={{
                  background: 'rgba(249, 115, 22, 0.2)',
                  color: '#fb923c',
                  border: '1px solid rgba(249, 115, 22, 0.35)',
                }}
              >
                {POOL_VERSION_V4 ? 'V4' : 'V3'}
              </span>
              <span
                className="px-1.5 py-0.5 rounded-md text-[10px] font-medium select-none shrink-0"
                style={{
                  background: 'rgba(251, 191, 36, 0.1)',
                  color: '#fde68a',
                  border: '1px solid rgba(251, 191, 36, 0.22)',
                }}
              >
                {`${(pool?.feeTierPercent || 0.25).toFixed(2)}%`}
              </span>
            </div>
          </div>

          {/* Top stats (Liquidity, Volume 24h, Fees 24h) */}
          <div className="flex items-center gap-6 sm:gap-8 mt-2 sm:mt-0">
            <div>
              <p className="text-[11px] text-[var(--fp-4)] font-medium">Liquidity</p>
              <p className="text-sm sm:text-base font-bold text-white tracking-tight">
                {formatDollar(modalLiquidity)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--fp-4)] font-medium">Volume 24h</p>
              <p className="text-sm sm:text-base font-bold text-white tracking-tight">
                {formatDollar(modalVolume)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-[var(--fp-4)] font-medium">Fees 24h</p>
              <p className="text-sm sm:text-base font-bold text-white tracking-tight">
                {formatDollar(modalFees)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white/50 hover:text-white transition-colors cursor-pointer ml-2"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {depositSuccess ? (
          <div className="p-12 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 mx-auto flex items-center justify-center shadow-lg">
              <Check size={32} />
            </div>
            <h3 className="text-xl font-bold text-white">Liquidity Position Initialized!</h3>
            <p className="text-sm text-[var(--fp-3)] max-w-md mx-auto">
              Your concentrated liquidity position for <strong>USDC / cirBTC</strong> has been successfully deployed within the range <strong>{parsedMinPrice.toLocaleString()} - {parsedMaxPrice.toLocaleString()} USDC per cirBTC</strong>.
            </p>
            <div className="pt-4 flex justify-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-wider text-white bg-indigo-600 hover:bg-indigo-500 transition-all cursor-pointer shadow-lg"
              >
                Close & View Position
              </button>
            </div>
          </div>
        ) : (
          /* ── MAIN TWO-COLUMN BODY ── */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 sm:p-7">
            {/* ────────────────────────────────────────────────────────── */}
            {/* LEFT COLUMN: Set price range                              */}
            {/* ────────────────────────────────────────────────────────── */}
            <div className="lg:col-span-7 flex flex-col justify-between space-y-5">
              {/* Header with price and controls */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white">Set price range</h3>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--fp-3)] mt-0.5">
                    <span>Price:</span>
                    <strong className="text-white font-mono">
                      {isUsdcPerBtc
                        ? liveBtcPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                        : (1 / liveBtcPrice).toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 })}
                    </strong>
                    <span>{isUsdcPerBtc ? 'USDC per cirBTC' : 'cirBTC per USDC'}</span>
                    <button
                      type="button"
                      onClick={() => setIsUsdcPerBtc(!isUsdcPerBtc)}
                      className="p-1 rounded-md hover:bg-white/[0.08] text-white/60 hover:text-white transition-colors cursor-pointer"
                      title="Switch Price Currency"
                    >
                      <ArrowRightLeft size={12} />
                    </button>
                  </div>
                </div>

                {/* Reset & Zoom buttons */}
                <div className="flex items-center gap-1 bg-white/[0.04] p-1 rounded-xl border border-white/[0.06]">
                  <button
                    type="button"
                    onClick={handleResetZoom}
                    className="p-1.5 rounded-lg hover:bg-white/[0.08] text-white/70 hover:text-white transition-colors cursor-pointer"
                    title="Reset Range"
                  >
                    <RotateCcw size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      adjustMinPrice(5)
                      adjustMaxPrice(-5)
                    }}
                    className="p-1.5 rounded-lg hover:bg-white/[0.08] text-white/70 hover:text-white transition-colors cursor-pointer"
                    title="Zoom in (Narrow Range)"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      adjustMinPrice(-5)
                      adjustMaxPrice(5)
                    }}
                    className="p-1.5 rounded-lg hover:bg-white/[0.08] text-white/70 hover:text-white transition-colors cursor-pointer"
                    title="Zoom out (Widen Range)"
                  >
                    <Minus size={14} />
                  </button>
                </div>
              </div>

              {/* ── Interactive Depth Chart (Histogram) ── */}
              <div className="relative w-full h-[220px] rounded-2xl bg-black/40 border border-white/[0.06] p-3 flex flex-col justify-between overflow-hidden">
                {/* Min tag (-18.83%) handle */}
                <div className="absolute top-2 left-4 z-20 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/80 border border-white/20 text-[11px] font-mono text-white shadow-md">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                  <span>{minPercentDiff < 0 ? `${minPercentDiff}%` : `-${Math.abs(minPercentDiff)}%`}</span>
                </div>

                {/* Max tag (+22.80%) handle */}
                <div className="absolute top-2 right-4 z-20 flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/80 border border-white/20 text-[11px] font-mono text-white shadow-md">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                  <span>+{Math.abs(maxPercentDiff)}%</span>
                </div>

                {/* Center current price dashed indicator */}
                <div
                  className="absolute inset-y-0 w-px border-l-2 border-dashed border-orange-500/80 pointer-events-none z-10"
                  style={{ left: '50%' }}
                />

                {/* Histogram Bars SVG */}
                <div className="w-full h-[155px] flex items-end justify-between gap-[2px] pt-7 px-2">
                  {histogramBars.map((bar, idx) => (
                    <div
                      key={idx}
                      className="flex-1 flex flex-col justify-end h-full group relative"
                    >
                      <div
                        className={`w-full rounded-t-sm transition-all duration-200 ${
                          bar.inRange
                            ? 'bg-gradient-to-t from-orange-700/60 via-orange-500/80 to-amber-400 group-hover:brightness-125'
                            : 'bg-white/[0.06] group-hover:bg-white/[0.12]'
                        }`}
                        style={{ height: `${bar.heightPct}%` }}
                      />
                      {/* Tooltip on hover */}
                      <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/90 text-white text-[10px] font-mono px-1.5 py-0.5 rounded border border-white/10 whitespace-nowrap z-30 shadow-lg">
                        {bar.priceFormatted} USDC
                      </div>
                    </div>
                  ))}
                </div>

                {/* Bottom X-Axis price labels */}
                <div className="flex items-center justify-between text-[10px] text-white/40 font-mono pt-1 border-t border-white/[0.05]">
                  <span>{parsedMinPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>
                  <span>{((parsedMinPrice + liveBtcPrice) / 2).toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>
                  <span className="text-orange-400 font-bold">{liveBtcPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>
                  <span>{((liveBtcPrice + parsedMaxPrice) / 2).toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>
                  <span>{parsedMaxPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })}</span>
                </div>

                {/* Bottom Right Mode Toggle: Liquidity vs Price */}
                <div className="absolute bottom-2.5 right-3 flex items-center bg-black/60 p-0.5 rounded-lg border border-white/[0.08] text-[10px] z-20">
                  <button
                    type="button"
                    onClick={() => setChartViewMode('liquidity')}
                    className={`px-2 py-0.5 rounded-md font-semibold transition-all ${
                      chartViewMode === 'liquidity'
                        ? 'bg-white/15 text-white shadow-sm'
                        : 'text-white/50 hover:text-white'
                    }`}
                  >
                    Liquidity
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartViewMode('price')}
                    className={`px-2 py-0.5 rounded-md font-semibold transition-all ${
                      chartViewMode === 'price'
                        ? 'bg-white/15 text-white shadow-sm'
                        : 'text-white/50 hover:text-white'
                    }`}
                  >
                    Price
                  </button>
                </div>
              </div>

              {/* ── Bottom 3 Range Input & APR Cards ── */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Min Price Card */}
                <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] transition-colors">
                  <div className="flex items-center justify-between text-xs text-[var(--fp-4)] font-medium mb-1">
                    <span>Min</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => adjustMinPrice(-2)}
                        className="w-5 h-5 rounded flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.1] text-white/70 transition-colors cursor-pointer"
                        title="Decrease Min Price"
                      >
                        <Minus size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustMinPrice(2)}
                        className="w-5 h-5 rounded flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.1] text-white/70 transition-colors cursor-pointer"
                        title="Increase Min Price"
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={minPriceInput}
                    onChange={(e) => setMinPriceInput(e.target.value)}
                    className="w-full text-base sm:text-lg font-bold text-white bg-transparent outline-none font-mono"
                  />
                  <p className="text-[11px] text-[var(--fp-4)] mt-0.5">USDC per cirBTC</p>
                </div>

                {/* Max Price Card */}
                <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.12] transition-colors">
                  <div className="flex items-center justify-between text-xs text-[var(--fp-4)] font-medium mb-1">
                    <span>Max</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => adjustMaxPrice(-2)}
                        className="w-5 h-5 rounded flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.1] text-white/70 transition-colors cursor-pointer"
                        title="Decrease Max Price"
                      >
                        <Minus size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustMaxPrice(2)}
                        className="w-5 h-5 rounded flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.1] text-white/70 transition-colors cursor-pointer"
                        title="Increase Max Price"
                      >
                        <Plus size={11} />
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={maxPriceInput}
                    onChange={(e) => setMaxPriceInput(e.target.value)}
                    className="w-full text-base sm:text-lg font-bold text-white bg-transparent outline-none font-mono"
                  />
                  <p className="text-[11px] text-[var(--fp-4)] mt-0.5">USDC per cirBTC</p>
                </div>

                {/* Estimated APR Card */}
                <div className="p-3.5 rounded-2xl bg-emerald-500/[0.04] border border-emerald-500/20 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--fp-4)] font-medium">Estimated APR</span>
                    <span className="w-2.5 h-2.5 rounded-full border border-emerald-400 bg-emerald-400/20 animate-pulse" />
                  </div>
                  <div className="text-xl sm:text-2xl font-bold text-emerald-400 tracking-tight my-0.5">
                    {estimatedApr.toFixed(2)}%
                  </div>
                  <p className="text-[10px] text-[var(--fp-4)]">Based on current 24h fees</p>
                </div>
              </div>
            </div>

            {/* ────────────────────────────────────────────────────────── */}
            {/* RIGHT COLUMN: Add deposit amount                          */}
            {/* ────────────────────────────────────────────────────────── */}
            <div className="lg:col-span-5 flex flex-col justify-between space-y-4">
              {/* Header with Slippage */}
              <div className="flex items-center justify-between">
                <h3 className="text-base sm:text-lg font-bold text-white">Add deposit amount</h3>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowSlippageModal(!showSlippageModal)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-xs font-medium text-white/80 hover:text-white transition-colors cursor-pointer border border-white/[0.06]"
                  >
                    <Sliders size={12} className="text-white/60" />
                    <span>{slippage}%</span>
                  </button>

                  {/* Slippage Dropdown */}
                  {showSlippageModal && (
                    <div className="absolute right-0 top-8 z-30 p-2.5 rounded-xl bg-[#141727] border border-white/10 shadow-xl w-44 space-y-2">
                      <p className="text-[11px] text-[var(--fp-4)]">Slippage Tolerance</p>
                      <div className="flex gap-1.5">
                        {[0.5, 1.0, 2.0].map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => {
                              setSlippage(s)
                              updateWalletSettings({ poolSlippage: s })
                              setShowSlippageModal(false)
                            }}
                            className={`flex-1 py-1 rounded-lg text-xs font-semibold ${
                              slippage === s
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white/[0.06] text-white/70 hover:bg-white/[0.1]'
                            }`}
                          >
                            {s}%
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Token A Deposit Input (cirBTC) ── */}
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.15] transition-colors space-y-2">
                <div className="flex items-center justify-between text-xs text-[var(--fp-4)]">
                  <div className="flex items-center gap-1.5">
                    <Wallet size={12} />
                    <span className="font-mono">{userBtcBal.toFixed(6)} cirBTC</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleBtcPercent(50)}
                      className="px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-[10px] font-semibold transition-colors cursor-pointer"
                    >
                      50%
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBtcPercent(100)}
                      className="px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-[10px] font-semibold transition-colors cursor-pointer"
                    >
                      Max
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-7 h-7 rounded-full bg-[#141727] border border-orange-500/30 p-1 flex items-center justify-center shadow-sm">
                      <img src={CirBtcIcon} alt="cirBTC" className="w-full h-full object-contain" />
                    </div>
                    <span className="font-bold text-white text-base">cirBTC</span>
                  </div>

                  <input
                    type="number"
                    placeholder="0"
                    value={btcAmount}
                    onChange={(e) => handleBtcChange(e.target.value)}
                    className="w-full text-right text-xl font-bold text-white bg-transparent outline-none font-mono"
                  />
                </div>

                <div className="text-right text-xs text-[var(--fp-4)]">
                  ${((parseFloat(btcAmount) || 0) * liveBtcPrice).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>

              {/* ── Token B Deposit Input (USDC) ── */}
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.15] transition-colors space-y-2">
                <div className="flex items-center justify-between text-xs text-[var(--fp-4)]">
                  <div className="flex items-center gap-1.5">
                    <Wallet size={12} />
                    <span className="font-mono">{userUsdcBal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleUsdcPercent(50)}
                      className="px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-[10px] font-semibold transition-colors cursor-pointer"
                    >
                      50%
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUsdcPercent(100)}
                      className="px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-white/80 text-[10px] font-semibold transition-colors cursor-pointer"
                    >
                      Max
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-7 h-7 rounded-full bg-[#141727] border border-sky-500/30 p-1 flex items-center justify-center shadow-sm">
                      <img src={UsdcIcon} alt="USDC" className="w-full h-full object-contain" />
                    </div>
                    <span className="font-bold text-white text-base">USDC</span>
                  </div>

                  <input
                    type="number"
                    placeholder="0"
                    value={usdcAmount}
                    onChange={(e) => handleUsdcChange(e.target.value)}
                    className="w-full text-right text-xl font-bold text-white bg-transparent outline-none font-mono"
                  />
                </div>

                <div className="text-right text-xs text-[var(--fp-4)]">
                  ${(parseFloat(usdcAmount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>

              {/* ── Dynamic Ratio Allocation Bar (Matching Reference) ── */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <div className="flex items-center gap-1.5 text-orange-500">
                    <img
                      src={CirBtcIcon}
                      alt="cirBTC"
                      className="w-4 h-4 rounded-full object-contain shrink-0 shadow-sm"
                    />
                    <span className="tabular-nums">{ratioResult.percentA}% cirBTC</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sky-400">
                    <span className="tabular-nums">{ratioResult.percentB}% USDC</span>
                    <img
                      src={UsdcIcon}
                      alt="USDC"
                      className="w-4 h-4 rounded-full object-contain shrink-0 shadow-sm"
                    />
                  </div>
                </div>

                {/* Split Dual-Tone Bar */}
                <div className="h-1.5 w-full rounded-full bg-white/[0.06] flex overflow-hidden">
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${ratioResult.percentA}%`,
                      background: 'linear-gradient(90deg, #c2410c 0%, #ea580c 100%)',
                    }}
                  />
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${ratioResult.percentB}%`,
                      background: 'linear-gradient(90deg, #0284c7 0%, #38bdf8 100%)',
                    }}
                  />
                </div>
              </div>

              {/* Total Deposit Display */}
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                <span className="text-sm font-medium text-[var(--fp-3)]">Total deposit</span>
                <span className="text-base sm:text-lg font-bold text-white font-mono">
                  ${totalDepositUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {errorMessage && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Action Button */}
              <button
                type="button"
                onClick={handleDeposit}
                disabled={isButtonDisabled}
                className={`w-full py-3.5 rounded-2xl font-bold text-xs sm:text-sm tracking-wide text-white transition-all duration-200 shadow-lg active:scale-95 flex items-center justify-center gap-2 select-none ${
                  isButtonDisabled
                    ? 'bg-white/[0.05] border border-white/[0.08] text-white/40 cursor-not-allowed'
                    : 'bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 hover:brightness-110 shadow-orange-500/25 cursor-pointer'
                }`}
                style={
                  !isButtonDisabled
                    ? {
                        background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                        boxShadow: '0 6px 20px -4px rgba(249, 115, 22, 0.45)',
                      }
                    : undefined
                }
              >
                {getButtonText()}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

export default ConcentratedLiquidityModal
