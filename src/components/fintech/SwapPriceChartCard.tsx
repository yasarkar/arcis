import {
  Activity,
  ArrowRightLeft,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'
import CircleIcon from '../../assets/Token-Icon/CIRCLE Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import { WethIcon, SonicIcon, PhrsIcon, XplIcon, OkbIcon } from '../../config/tokenIcons'
import { usePairChartData } from '../../hooks/usePairChartData'
import { type ChartCandlePoint } from '../../services/chartDataService'
import { Tooltip } from '../common/Tooltip'

const TOKEN_ICON_MAP: Record<string, string> = {
  USDC: UsdcIcon,
  EURC: EurcIcon,
  CIRBTC: CirBtcIcon || CircleIcon,
  BTC: CirBtcIcon || CircleIcon,
  WBTC: CirBtcIcon || CircleIcon,
  WETH: WethIcon,
  ETH: WethIcon,
  S: SonicIcon,
  SONIC: SonicIcon,
  PHRS: PhrsIcon,
  PHAROS: PhrsIcon,
  XPL: XplIcon,
  PLASMA: XplIcon,
  OKB: OkbIcon,
  XLAYER: OkbIcon,
  'X-LAYER': OkbIcon,
}

const TOKEN_COLOR_MAP: Record<string, string> = {
  BTC: '#F7931A',
  CIRBTC: '#F7931A',
  WBTC: '#F7931A',
  ETH: '#627EEA',
  WETH: '#627EEA',
  EURC: '#06B6D4',
  SOL: '#14F195',
  AVAX: '#E84142',
  USDC: '#2775CA',
  S: '#FFFFFF',
  SONIC: '#FFFFFF',
  PHRS: '#0007B9',
  PHAROS: '#0007B9',
  XPL: '#FFFFFF',
  PLASMA: '#FFFFFF',
  OKB: '#FFFFFF',
  XLAYER: '#FFFFFF',
  'X-LAYER': '#FFFFFF',
}

interface SwapPriceChartCardProps {
  tokenIn: string
  tokenOut: string
  isInline?: boolean
  className?: string
}

export const SwapPriceChartCard: React.FC<SwapPriceChartCardProps> = ({
  tokenIn,
  tokenOut,
  isInline = false,
  className = '',
}) => {
  const [timeframe, setTimeframe] = useState<'1D' | '1W' | '1M'>('1D')
  const [chartMode, setChartMode] = useState<'line' | 'candles'>('line')
  const [hoveredPoint, setHoveredPoint] = useState<ChartCandlePoint | null>(null)
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Controls the order of tokens in the route button: false = [tokenIn ⇄ tokenOut], true = [tokenOut ⇄ tokenIn]
  const [isReversed, setIsReversed] = useState(false)

  // When source tokenIn changes from the swap form, automatically reset order to tokenIn first
  useEffect(() => {
    setIsReversed(false)
  }, [tokenIn])

  const activeChartToken = isReversed ? tokenOut : tokenIn

  // Fetch live chart data focusing on activeChartToken
  const { data: chartData, isLoading, isError } = usePairChartData(
    tokenIn,
    tokenOut,
    timeframe,
    activeChartToken
  )

  const points = useMemo(() => chartData?.points || [], [chartData])
  const baseSymbol = chartData?.baseSymbol || activeChartToken
  const quoteSymbol = chartData?.quoteSymbol || (isReversed ? tokenIn : tokenOut)

  const accentColor = TOKEN_COLOR_MAP[baseSymbol.toUpperCase()] || '#F7931A'

  const toggleChartOrder = () => {
    setIsReversed((prev) => !prev)
  }

  // Current active price (either hovered or latest)
  const activePrice = useMemo(() => {
    if (hoveredPoint) return hoveredPoint.close
    return chartData?.currentPrice || 0
  }, [hoveredPoint, chartData])

  const priceChangePercent = chartData?.priceChangePercent24h ?? 0
  const isPositive = priceChangePercent >= 0

  // Format price with appropriate decimals
  const formatPrice = useCallback((price: number) => {
    if (price >= 1000) {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
    if (price >= 1) {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
    }
    return `$${price.toFixed(6)}`
  }, [])

  // Format tick price for Y-axis
  const formatYAxisTick = useCallback((price: number) => {
    if (price >= 1000) {
      return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    if (price >= 1) {
      return price.toFixed(4)
    }
    return price.toFixed(6)
  }, [])

  // Format time for X-axis
  const formatXAxisTick = useCallback((timestamp: number, tf: '1D' | '1W' | '1M') => {
    const d = new Date(timestamp)
    if (tf === '1D') {
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    }
    if (tf === '1W') {
      return d.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric' })
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }, [])

  // SVG Chart Geometry calculations
  const chartGeometry = useMemo(() => {
    const svgWidth = 460
    const svgHeight = 260
    const padding = { top: 20, right: 68, bottom: 32, left: 16 }

    const plotWidth = svgWidth - padding.left - padding.right
    const plotHeight = svgHeight - padding.top - padding.bottom

    if (!points || points.length === 0) {
      return {
        svgWidth,
        svgHeight,
        padding,
        plotWidth,
        plotHeight,
        pathD: '',
        areaD: '',
        yTicks: [],
        xTicks: [],
        pointCoords: [],
      }
    }

    let minPrice = Infinity
    let maxPrice = -Infinity

    points.forEach((p) => {
      minPrice = Math.min(minPrice, p.low, p.close, p.open)
      maxPrice = Math.max(maxPrice, p.high, p.close, p.open)
    })

    // Add padding to price range for breathing room
    const priceRange = maxPrice - minPrice > 0 ? maxPrice - minPrice : 0.0001
    const pricePadding = priceRange * 0.08
    const adjMin = Math.max(0, minPrice - pricePadding)
    const adjMax = maxPrice + pricePadding
    const adjRange = adjMax - adjMin > 0 ? adjMax - adjMin : 0.0001

    const getX = (index: number) => {
      if (points.length <= 1) return padding.left + plotWidth / 2
      return padding.left + (index / (points.length - 1)) * plotWidth
    }

    const getY = (price: number) => {
      const normalized = adjRange > 0 ? (price - adjMin) / adjRange : 0.5
      const clamped = Math.max(0, Math.min(1, normalized))
      return padding.top + (1 - clamped) * plotHeight
    }

    // Coordinates for each point
    const pointCoords = points.map((p, i) => ({
      x: getX(i),
      y: getY(p.close),
      openY: getY(p.open),
      highY: getY(p.high),
      lowY: getY(p.low),
      closeY: getY(p.close),
      point: p,
      index: i,
    }))

    // Build smooth cubic bezier curve for line mode
    let pathD = ''
    if (pointCoords.length > 0) {
      pathD = `M ${pointCoords[0].x} ${pointCoords[0].y}`
      for (let i = 0; i < pointCoords.length - 1; i++) {
        const curr = pointCoords[i]
        const next = pointCoords[i + 1]
        const cX = (curr.x + next.x) / 2
        pathD += ` C ${cX} ${curr.y}, ${cX} ${next.y}, ${next.x} ${next.y}`
      }
    }

    // Area path (closed at the bottom)
    const lastX = pointCoords[pointCoords.length - 1]?.x ?? padding.left
    const firstX = pointCoords[0]?.x ?? padding.left
    const bottomY = padding.top + plotHeight
    const areaD = pathD ? `${pathD} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z` : ''

    // Generate 5 Y-axis ticks
    const yTicks: { price: number; y: number }[] = []
    const tickCount = 5
    for (let i = 0; i < tickCount; i++) {
      const fraction = i / (tickCount - 1)
      const price = adjMax - fraction * adjRange
      const y = padding.top + fraction * plotHeight
      yTicks.push({ price, y })
    }

    // Generate 5 X-axis ticks
    const xTicks: { label: string; x: number }[] = []
    if (points.length > 0) {
      const xIndices = [
        0,
        Math.floor(points.length * 0.25),
        Math.floor(points.length * 0.5),
        Math.floor(points.length * 0.75),
        points.length - 1,
      ]
      xIndices.forEach((idx) => {
        const pt = points[idx]
        if (pt) {
          xTicks.push({
            label: formatXAxisTick(pt.time, timeframe),
            x: getX(idx),
          })
        }
      })
    }

    return {
      svgWidth,
      svgHeight,
      padding,
      plotWidth,
      plotHeight,
      pathD,
      areaD,
      yTicks,
      xTicks,
      pointCoords,
    }
  }, [points, timeframe, formatXAxisTick])

  // Mouse move handler for crosshair & tooltip
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || chartGeometry.pointCoords.length === 0) return

    const rect = svgRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    // Scale from client rect to SVG viewBox coords (460x260)
    const scaleX = chartGeometry.svgWidth / rect.width
    const scaleY = chartGeometry.svgHeight / rect.height
    const svgX = mouseX * scaleX
    const svgY = mouseY * scaleY

    // Find nearest point along X
    let closestCoord = chartGeometry.pointCoords[0]
    let minDistance = Math.abs(svgX - closestCoord.x)

    for (let i = 1; i < chartGeometry.pointCoords.length; i++) {
      const coord = chartGeometry.pointCoords[i]
      const dist = Math.abs(svgX - coord.x)
      if (dist < minDistance) {
        minDistance = dist
        closestCoord = coord
      }
    }

    setHoveredPoint(closestCoord.point)
    setHoverPosition({ x: closestCoord.x, y: closestCoord.y })
  }

  const handleMouseLeave = () => {
    setHoveredPoint(null)
    setHoverPosition(null)
  }

  const baseIcon = TOKEN_ICON_MAP[baseSymbol.toUpperCase()] || CirBtcIcon || CircleIcon
  const quoteIcon = TOKEN_ICON_MAP[quoteSymbol.toUpperCase()] || UsdcIcon
  const tokenInIcon = TOKEN_ICON_MAP[tokenIn.toUpperCase()] || CirBtcIcon || CircleIcon
  const tokenOutIcon = TOKEN_ICON_MAP[tokenOut.toUpperCase()] || UsdcIcon

  const firstToken = isReversed ? tokenOut : tokenIn
  const secondToken = isReversed ? tokenIn : tokenOut
  const firstIcon = isReversed ? tokenOutIcon : tokenInIcon
  const secondIcon = isReversed ? tokenInIcon : tokenOutIcon

  return (
    <div
      ref={containerRef}
      className={`relative w-full arc-animate-reveal flex flex-col justify-between transition-all duration-300 ${className}`}
      style={{
        maxWidth: isInline ? '600px' : '520px',
        minHeight: isInline ? '680px' : undefined,
        padding: isInline ? '32px 32px 32px 32px' : '28px 26px 30px 26px',
        borderRadius: '32px',
        background: 'linear-gradient(180deg, rgba(14, 17, 30, 0.96) 0%, rgba(10, 12, 22, 0.98) 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.05), 0 28px 56px -12px rgba(0, 0, 0, 0.7)',
        fontFamily: 'var(--font-app)',
      }}
    >
      {/* Ambient Top Glow */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-32 rounded-full blur-3xl opacity-25"
        style={{
          background: `radial-gradient(ellipse at center, ${accentColor} 0%, rgba(99, 102, 241, 0.15) 70%, transparent 100%)`,
        }}
      />

      {/* Card Header (Interactive Route Button & Close) */}
      <div className="relative z-20 flex items-center justify-between pb-3.5 mb-2 border-b border-white/[0.06]">
        {/* Interactive Swap Route Toggle Button */}
        <div className="flex items-center gap-2">
          <Tooltip
            content={`Click to switch order: ${secondToken} ⇄ ${firstToken}`}
            position="bottom"
            align="start"
          >
            <button
              type="button"
              onClick={toggleChartOrder}
              className="group relative flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/[0.18] shadow-inner transition-all duration-300 cursor-pointer select-none active:scale-95"
            >
              {/* First Token */}
              <div
                key={`first-${firstToken}`}
                className="flex items-center gap-1.5 transition-all duration-300 ease-out transform animate-fade-in"
              >
                <img
                  src={firstIcon}
                  alt={firstToken}
                  className="w-4 h-4 rounded-full object-contain transition-transform duration-300 group-hover:scale-105"
                />
                <span className="text-xs font-semibold text-white tracking-wide">{firstToken}</span>
              </div>

              {/* Direction Switch Arrow Icon */}
              <div
                className={`w-4 h-4 flex items-center justify-center text-slate-400 group-hover:text-white transition-transform duration-500 ease-in-out ${
                  isReversed ? 'rotate-180' : 'rotate-0'
                }`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
              </div>

              {/* Second Token */}
              <div
                key={`second-${secondToken}`}
                className="flex items-center gap-1.5 transition-all duration-300 ease-out transform animate-fade-in"
              >
                <img
                  src={secondIcon}
                  alt={secondToken}
                  className="w-4 h-4 rounded-full object-contain transition-transform duration-300 group-hover:scale-105"
                />
                <span className="text-xs font-semibold text-slate-300 tracking-wide">{secondToken}</span>
              </div>
            </button>
          </Tooltip>
        </div>

      </div>

      {/* Hero Price & 24h Change */}
      <div className="relative z-10 my-2 space-y-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            {formatPrice(activePrice)}
          </span>

          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${isPositive
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25'
                : 'text-rose-400 bg-rose-500/10 border-rose-500/25'
              }`}
          >
            {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            {isPositive ? '+' : ''}
            {priceChangePercent.toFixed(2)}%
          </span>
        </div>

        {/* 24h High / Low Stats */}
        <div className="flex items-center gap-3 text-[11px] text-slate-400 font-medium">
          {chartData?.highPrice && (
            <span>
              24h High: <span className="text-slate-200 font-mono">{formatPrice(chartData.highPrice)}</span>
            </span>
          )}
          {chartData?.lowPrice && (
            <span>
              24h Low: <span className="text-slate-200 font-mono">{formatPrice(chartData.lowPrice)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Interactive Chart Canvas (SVG) */}
      <div className="relative z-10 w-full my-auto py-2">
        {isLoading && points.length === 0 ? (
          <div className="w-full h-[260px] flex flex-col items-center justify-center gap-3 rounded-2xl bg-white/[0.02] border border-white/[0.04]">
            <Activity className="w-6 h-6 text-indigo-400 animate-spin" />
            <span className="text-xs text-slate-400">Fetching live market data...</span>
          </div>
        ) : (
          <div className="relative w-full select-none">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${chartGeometry.svgWidth} ${chartGeometry.svgHeight}`}
              className="w-full h-auto overflow-hidden cursor-crosshair touch-none"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            >
              <defs>
                {/* Clip Path to contain plot inside frame */}
                <clipPath id="chartPlotClip">
                  <rect
                    x={chartGeometry.padding.left}
                    y={chartGeometry.padding.top}
                    width={chartGeometry.plotWidth}
                    height={chartGeometry.plotHeight}
                  />
                </clipPath>

                {/* Area Gradient */}
                <linearGradient id="chartAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accentColor} stopOpacity="0.45" />
                  <stop offset="60%" stopColor={accentColor} stopOpacity="0.10" />
                  <stop offset="100%" stopColor={accentColor} stopOpacity="0.00" />
                </linearGradient>

                {/* Subtle Glow Filter for Line */}
                <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={accentColor} floodOpacity="0.35" />
                </filter>
              </defs>

              {/* Horizontal Grid Lines */}
              {chartGeometry.yTicks.map((tick, i) => (
                <line
                  key={`h-grid-${i}`}
                  x1={chartGeometry.padding.left}
                  y1={tick.y}
                  x2={chartGeometry.svgWidth - chartGeometry.padding.right}
                  y2={tick.y}
                  stroke="rgba(255, 255, 255, 0.05)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
              ))}

              {/* Vertical Grid Lines */}
              {chartGeometry.xTicks.map((tick, i) => (
                <line
                  key={`v-grid-${i}`}
                  x1={tick.x}
                  y1={chartGeometry.padding.top}
                  x2={tick.x}
                  y2={chartGeometry.svgHeight - chartGeometry.padding.bottom}
                  stroke="rgba(255, 255, 255, 0.03)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
              ))}

              {/* Right Y-Axis Price Labels */}
              {chartGeometry.yTicks.map((tick, i) => (
                <text
                  key={`y-tick-${i}`}
                  x={chartGeometry.svgWidth - chartGeometry.padding.right + 8}
                  y={tick.y + 3.5}
                  fill="rgba(148, 163, 184, 0.75)"
                  fontSize="9.5"
                  fontFamily="monospace"
                  textAnchor="start"
                >
                  {formatYAxisTick(tick.price)}
                </text>
              ))}

              {/* Chart Mode: Line Area */}
              {chartMode === 'line' && (
                <g clipPath="url(#chartPlotClip)">
                  {chartGeometry.areaD && (
                    <path d={chartGeometry.areaD} fill="url(#chartAreaGradient)" />
                  )}
                  {chartGeometry.pathD && (
                    <path
                      d={chartGeometry.pathD}
                      fill="none"
                      stroke={accentColor}
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      filter="url(#lineGlow)"
                    />
                  )}
                </g>
              )}

              {/* Chart Mode: Candlesticks */}
              {chartMode === 'candles' && (
                <g>
                  {chartGeometry.pointCoords.map((coord, i) => {
                    const isGreen = coord.point.close >= coord.point.open
                    const candleColor = isGreen ? '#10B981' : '#EF4444'
                    const bodyTop = Math.min(coord.openY, coord.closeY)
                    const bodyHeight = Math.max(2, Math.abs(coord.closeY - coord.openY))
                    const barWidth = Math.max(3, Math.min(10, chartGeometry.plotWidth / points.length - 2))

                    return (
                      <g key={`candle-${i}`}>
                        {/* Upper & Lower Wick */}
                        <line
                          x1={coord.x}
                          y1={coord.highY}
                          x2={coord.x}
                          y2={coord.lowY}
                          stroke={candleColor}
                          strokeWidth="1.2"
                        />
                        {/* Candle Body */}
                        <rect
                          x={coord.x - barWidth / 2}
                          y={bodyTop}
                          width={barWidth}
                          height={bodyHeight}
                          fill={candleColor}
                          rx="1"
                        />
                      </g>
                    )
                  })}
                </g>
              )}

              {/* Active Crosshair Lines */}
              {hoverPosition && (
                <g>
                  {/* Vertical Crosshair Line */}
                  <line
                    x1={hoverPosition.x}
                    y1={chartGeometry.padding.top}
                    x2={hoverPosition.x}
                    y2={chartGeometry.svgHeight - chartGeometry.padding.bottom}
                    stroke="rgba(255, 255, 255, 0.4)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  {/* Horizontal Crosshair Line */}
                  <line
                    x1={chartGeometry.padding.left}
                    y1={hoverPosition.y}
                    x2={chartGeometry.svgWidth - chartGeometry.padding.right}
                    y2={hoverPosition.y}
                    stroke="rgba(255, 255, 255, 0.4)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  {/* Dot on Line */}
                  <circle
                    cx={hoverPosition.x}
                    cy={hoverPosition.y}
                    r="4.5"
                    fill={accentColor}
                    stroke="#FFFFFF"
                    strokeWidth="2"
                  />
                </g>
              )}

              {/* Bottom X-Axis Time Labels */}
              {chartGeometry.xTicks.map((tick, i) => (
                <text
                  key={`x-tick-${i}`}
                  x={tick.x}
                  y={chartGeometry.svgHeight - 10}
                  fill="rgba(148, 163, 184, 0.65)"
                  fontSize="9.5"
                  fontFamily="var(--font-app)"
                  textAnchor="middle"
                >
                  {tick.label}
                </text>
              ))}
            </svg>

            {/* Floating Tooltip Pill */}
            {hoveredPoint && hoverPosition && (
              <div
                className="pointer-events-none absolute z-30 transform -translate-x-1/2 -translate-y-full px-3 py-1.5 rounded-xl border shadow-xl backdrop-blur-md space-y-0.5 animate-fade-in"
                style={{
                  left: `${(hoverPosition.x / chartGeometry.svgWidth) * 100}%`,
                  top: `${Math.max(10, (hoverPosition.y / chartGeometry.svgHeight) * 100 - 10)}%`,
                  background: 'rgba(15, 18, 32, 0.95)',
                  borderColor: 'rgba(255, 255, 255, 0.12)',
                  boxShadow: '0 8px 24px -4px rgba(0, 0, 0, 0.8)',
                }}
              >
                <div className="text-[10px] text-slate-400 font-mono">
                  {new Date(hoveredPoint.time).toLocaleString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
                <div className="text-xs font-bold text-white font-mono">
                  {formatPrice(hoveredPoint.close)}
                </div>
                {chartMode === 'candles' && (
                  <div className="text-[9px] text-slate-400 flex items-center gap-2 pt-0.5">
                    <span>O: {formatYAxisTick(hoveredPoint.open)}</span>
                    <span>H: {formatYAxisTick(hoveredPoint.high)}</span>
                    <span>L: {formatYAxisTick(hoveredPoint.low)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom Controls Bar (Timeframe & Mode Toggle) */}
      <div className="relative z-20 flex items-center justify-between pt-4 mt-2 border-t border-white/[0.06]">
        {/* Timeframe Selectors (1D, 1W, 1M) */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
          {(['1D', '1W', '1M'] as const).map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${timeframe === tf
                  ? 'text-white bg-white/[0.12] border border-white/[0.16] shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Chart Mode Toggle (line / candles) */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
          {(['line', 'candles'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setChartMode(mode)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all cursor-pointer ${chartMode === mode
                  ? 'text-white bg-white/[0.12] border border-white/[0.16] shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
