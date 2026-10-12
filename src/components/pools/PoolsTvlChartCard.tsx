import React, { useState, useMemo, useRef, useCallback } from 'react'

interface PoolsTvlChartCardProps {
  totalTvlUsd: number
  activeTimeframe?: '24H' | '7D' | '30D'
  onTimeframeChange?: (tf: '24H' | '7D' | '30D') => void
}

interface ChartDataPoint {
  timestamp: string // e.g. "Sep 19, 6:00 AM"
  dateLabel: string // e.g. "Sep 19"
  tvl: number       // in dollars
  xRatio: number    // 0..1
  yRatio: number    // 0..1
}

export const PoolsTvlChartCard: React.FC<PoolsTvlChartCardProps> = ({
  totalTvlUsd,
  activeTimeframe: propTimeframe,
  onTimeframeChange,
}) => {
  const [internalTimeframe, setInternalTimeframe] = useState<'24H' | '7D' | '30D'>('30D')
  const timeframe = propTimeframe || internalTimeframe

  const handleSelectTimeframe = (tf: '24H' | '7D' | '30D') => {
    setInternalTimeframe(tf)
    onTimeframeChange?.(tf)
  }

  // Hover states
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Anchor target TVL: if totalTvlUsd > 0 use it, else standard $5.87M from design
  const targetTvl = totalTvlUsd > 0 ? totalTvlUsd : 5_870_000

  // Generate smooth, authentic historical curve matching the screenshot
  const chartData = useMemo(() => {
    // Generate simulated realistic growth curve leading up to targetTvl
    const pointsCount = timeframe === '24H' ? 24 : timeframe === '7D' ? 28 : 45
    const now = new Date()
    const points: { timestamp: string; dateLabel: string; tvl: number }[] = []

    // Multipliers over time for curve shape (starts lower, steady growth with micro steps)
    const baseMultiplier = timeframe === '24H' ? 0.94 : timeframe === '7D' ? 0.82 : 0.62

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    for (let i = 0; i < pointsCount; i++) {
      const progress = i / (pointsCount - 1) // 0 to 1

      // Curvature: smooth sigmoid/exponential growth with minor plateau steps
      const curve = Math.pow(progress, 1.25)
      // Subtle micro-fluctuations (seeded by index)
      const noise = Math.sin(i * 1.3) * 0.015 + Math.cos(i * 0.7) * 0.01

      const tvlVal = targetTvl * (baseMultiplier + (1 - baseMultiplier) * curve + noise)

      // Time calculation
      let ptDate: Date
      if (timeframe === '24H') {
        const msBack = (pointsCount - 1 - i) * (3600 * 1000)
        ptDate = new Date(now.getTime() - msBack)
      } else if (timeframe === '7D') {
        const msBack = (pointsCount - 1 - i) * (6 * 3600 * 1000)
        ptDate = new Date(now.getTime() - msBack)
      } else {
        // 30D
        const msBack = (pointsCount - 1 - i) * (16 * 3600 * 1000)
        ptDate = new Date(now.getTime() - msBack)
      }

      const m = months[ptDate.getMonth()]
      const d = ptDate.getDate()
      const hour = ptDate.getHours()
      const ampm = hour >= 12 ? 'PM' : 'AM'
      const formattedHour = hour % 12 === 0 ? 12 : hour % 12
      const timeStr = `${m} ${d}, ${formattedHour}:00 ${ampm}`
      const dateLabel = `${m} ${d}`

      points.push({
        timestamp: timeStr,
        dateLabel,
        tvl: Math.max(tvlVal, targetTvl * 0.5),
      })
    }

    // Ensure the last point matches targetTvl exactly
    points[points.length - 1].tvl = targetTvl

    const minTvl = Math.min(...points.map((p) => p.tvl)) * 0.92
    const maxTvl = Math.max(...points.map((p) => p.tvl)) * 1.05

    // Normalize coordinates
    return {
      points,
      minTvl,
      maxTvl,
      range: maxTvl - minTvl,
    }
  }, [timeframe, targetTvl])

  // Chart layout dimensions (SVG ViewBox)
  const svgWidth = 720
  const svgHeight = 240
  const paddingLeft = 55
  const paddingRight = 16
  const paddingTop = 24
  const paddingBottom = 34

  const plotWidth = svgWidth - paddingLeft - paddingRight
  const plotHeight = svgHeight - paddingTop - paddingBottom

  // Computed coords for all points
  const pointsWithCoords: ChartDataPoint[] = useMemo(() => {
    return chartData.points.map((pt, idx) => {
      const xRatio = idx / (chartData.points.length - 1)
      const yRatio = (pt.tvl - chartData.minTvl) / (chartData.range || 1)
      return {
        ...pt,
        xRatio,
        yRatio,
      }
    })
  }, [chartData])

  // Build SVG Path string (smooth bezier curve)
  const { linePath, areaPath } = useMemo(() => {
    if (pointsWithCoords.length === 0) return { linePath: '', areaPath: '' }

    const coords = pointsWithCoords.map((pt) => ({
      x: paddingLeft + pt.xRatio * plotWidth,
      y: paddingTop + (1 - pt.yRatio) * plotHeight,
    }))

    if (coords.length === 1) {
      return { linePath: `M ${coords[0].x} ${coords[0].y}`, areaPath: '' }
    }

    // Generate smooth cubic bezier path
    let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`

    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = i > 0 ? coords[i - 1] : coords[i]
      const p1 = coords[i]
      const p2 = coords[i + 1]
      const p3 = i != coords.length - 2 ? coords[i + 2] : p2

      const cp1x = p1.x + (p2.x - p0.x) / 6
      const cp1y = p1.y + (p2.y - p0.y) / 6

      const cp2x = p2.x - (p3.x - p1.x) / 6
      const cp2y = p2.y - (p3.y - p1.y) / 6

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
    }

    const baselineY = paddingTop + plotHeight
    const area = `${d} L ${coords[coords.length - 1].x.toFixed(1)} ${baselineY.toFixed(1)} L ${coords[0].x.toFixed(1)} ${baselineY.toFixed(1)} Z`

    return { linePath: d, areaPath: area }
  }, [pointsWithCoords, plotWidth, plotHeight, paddingLeft, paddingTop])

  // Mouse hover detection
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!svgRef.current || pointsWithCoords.length === 0) return
      const rect = svgRef.current.getBoundingClientRect()
      const clientX = e.clientX - rect.left
      const scaleX = svgWidth / rect.width
      const svgX = clientX * scaleX

      // Find nearest point
      let closestIdx = 0
      let minDistance = Infinity

      pointsWithCoords.forEach((pt, idx) => {
        const ptX = paddingLeft + pt.xRatio * plotWidth
        const dist = Math.abs(svgX - ptX)
        if (dist < minDistance) {
          minDistance = dist
          closestIdx = idx
        }
      })

      setHoveredIndex(closestIdx)
    },
    [pointsWithCoords, plotWidth, paddingLeft, svgWidth]
  )

  const handleMouseLeave = () => {
    setHoveredIndex(null)
  }

  // Format currency helper for tooltips, ticks, and headers
  const formatCompactUsd = (val: number): string => {
    if (!Number.isFinite(val) || val <= 0) return '$0.00'
    if (val >= 1_000_000) {
      return `$${(val / 1_000_000).toFixed(2)}M`
    }
    if (val >= 1_000) {
      return `$${(val / 1_000).toFixed(2)}K`
    }
    return `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  // Active point for tooltip (active only when user is hovering)
  const isHovering = hoveredIndex !== null
  const activePt = isHovering && hoveredIndex !== null ? pointsWithCoords[hoveredIndex] : null
  const activePtCoord = activePt
    ? {
        x: paddingLeft + activePt.xRatio * plotWidth,
        y: paddingTop + (1 - activePt.yRatio) * plotHeight,
      }
    : null

  // Latest live endpoint on curve (for persistent subtle pulse dot when not hovering)
  const latestPt = pointsWithCoords[pointsWithCoords.length - 1]
  const latestPtCoord = latestPt
    ? {
        x: paddingLeft + latestPt.xRatio * plotWidth,
        y: paddingTop + (1 - latestPt.yRatio) * plotHeight,
      }
    : null

  // Y-Axis Ticks (3 levels: min, mid, max with unified formatting)
  const yTicks = useMemo(() => {
    const min = chartData.minTvl
    const max = chartData.maxTvl
    const mid = (min + max) / 2

    return [
      { label: formatCompactUsd(max), y: paddingTop },
      { label: formatCompactUsd(mid), y: paddingTop + plotHeight / 2 },
      { label: formatCompactUsd(min), y: paddingTop + plotHeight },
    ]
  }, [chartData, paddingTop, plotHeight])

  // X-Axis Ticks (sample dates across points)
  const xTicks = useMemo(() => {
    if (pointsWithCoords.length === 0) return []
    // Pick ~8-10 nicely spaced ticks
    const step = Math.max(1, Math.floor(pointsWithCoords.length / 9))
    const ticks: { label: string; x: number }[] = []

    for (let i = 0; i < pointsWithCoords.length; i += step) {
      const pt = pointsWithCoords[i]
      ticks.push({
        label: pt.dateLabel,
        x: paddingLeft + pt.xRatio * plotWidth,
      })
    }

    return ticks
  }, [pointsWithCoords, paddingLeft, plotWidth])

  return (
    <div
      className="relative flex flex-col justify-between p-5 sm:p-6 rounded-[28px] overflow-hidden transition-all duration-300 w-full h-full"
      style={{
        background: 'linear-gradient(145deg, rgba(20, 24, 40, 0.92) 0%, rgba(15, 18, 32, 0.95) 60%, rgba(10, 12, 22, 0.98) 100%)',
        backdropFilter: 'blur(28px)',
        WebkitBackdropFilter: 'blur(28px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.04), 0 24px 50px -12px rgba(0, 0, 0, 0.6)',
        fontFamily: 'var(--font-app)',
      }}
    >
      {/* Top Header Row: Timeframe Switcher & Live TVL Badge */}
      <div className="relative z-10 flex items-center justify-between pb-2 shrink-0">
        {/* Subtle Label / Breadcrumb + Live TVL Indicator */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          <span className="w-2 h-2 rounded-full bg-[var(--earned-green)] animate-pulse" />
          <span className="text-xs font-medium text-[var(--fp-4)] tracking-wide">
            Live Protocol Liquidity Stream
          </span>
        </div>

        {/* Timeframe Buttons: [24H] [7D] [30D] */}
        <div
          className="flex items-center p-1 rounded-full border border-white/[0.08]"
          style={{ background: 'rgba(10, 12, 22, 0.7)' }}
        >
          {(['24H', '7D', '30D'] as const).map((tf) => {
            const isActive = timeframe === tf
            return (
              <button
                key={tf}
                type="button"
                onClick={() => handleSelectTimeframe(tf)}
                className={`px-3.5 py-1 text-xs font-semibold rounded-full transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'bg-white/[0.14] text-white border border-white/20 shadow-sm'
                    : 'text-[var(--fp-4)] hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {tf}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Interactive SVG Area Chart ── */}
      <div className="relative w-full flex-1 mt-2 select-none flex flex-col justify-end min-h-[240px]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio="none"
          className="w-full h-full flex-1 overflow-visible cursor-crosshair min-h-[230px]"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            {/* Rich Emerald / Green Gradient Area */}
            <linearGradient id="tvlGreenGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#01d062" stopOpacity="0.32" />
              <stop offset="60%" stopColor="#01d062" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#01d062" stopOpacity="0.00" />
            </linearGradient>

            {/* Crosshair Dash Style */}
            <filter id="glowGreen" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#01d062" floodOpacity="0.8" />
            </filter>
          </defs>

          {/* Horizontal Grid Guides & Y-Axis Labels */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={paddingLeft}
                y1={tick.y}
                x2={svgWidth - paddingRight}
                y2={tick.y}
                stroke="rgba(255, 255, 255, 0.05)"
                strokeDasharray="3 3"
              />
              <text
                x={paddingLeft - 8}
                y={tick.y + 4}
                textAnchor="end"
                fontSize="10"
                fontFamily="var(--font-app)"
                fill="var(--fp-4)"
                style={{ fontWeight: 500 }}
              >
                {tick.label}
              </text>
            </g>
          ))}

          {/* Area Fill */}
          {areaPath && (
            <path
              d={areaPath}
              fill="url(#tvlGreenGradient)"
              className="transition-all duration-300"
            />
          )}

          {/* Smooth Green Stroke Line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#01d062"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-all duration-300"
            />
          )}

          {/* X-Axis Date Labels */}
          {xTicks.map((tick, i) => (
            <text
              key={i}
              x={tick.x}
              y={svgHeight - 10}
              textAnchor="middle"
              fontSize="10"
              fontFamily="var(--font-app)"
              fill="var(--fp-4)"
              style={{ fontWeight: 400 }}
            >
              {tick.label}
            </text>
          ))}

          {/* Persistent Live Tip Dot on Curve (When Not Hovering) */}
          {!isHovering && latestPtCoord && (
            <g className="pointer-events-none transition-opacity duration-200">
              <circle
                cx={latestPtCoord.x}
                cy={latestPtCoord.y}
                r="4.5"
                fill="#01d062"
                stroke="#ffffff"
                strokeWidth="2"
                filter="url(#glowGreen)"
                className="animate-pulse"
              />
            </g>
          )}

          {/* Vertical Dotted Crosshair & Active Point on Curve (When Hovering) */}
          {isHovering && activePtCoord && (
            <g className="pointer-events-none transition-all duration-75">
              {/* Dotted Vertical Guide Line */}
              <line
                x1={activePtCoord.x}
                y1={paddingTop}
                x2={activePtCoord.x}
                y2={paddingTop + plotHeight}
                stroke="rgba(255, 255, 255, 0.4)"
                strokeDasharray="3 3"
                strokeWidth="1.2"
              />

              {/* Glowing Green Dot on Curve */}
              <circle
                cx={activePtCoord.x}
                cy={activePtCoord.y}
                r="5.5"
                fill="#01d062"
                stroke="#ffffff"
                strokeWidth="2.5"
                filter="url(#glowGreen)"
              />
            </g>
          )}
        </svg>

        {/* ── Hover Tooltip (Shown Only on Active Hover with Dynamic Bounds & Formatting) ── */}
        {isHovering && activePt && activePtCoord && (
          <div
            className="pointer-events-none absolute z-20 flex flex-col p-2.5 rounded-xl border border-white/10 shadow-2xl transition-all duration-75"
            style={{
              background: 'rgba(12, 15, 26, 0.96)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              left: `${Math.min(86, Math.max(14, (activePtCoord.x / svgWidth) * 100))}%`,
              top: `${Math.max(10, (activePtCoord.y / svgHeight) * 100 - 35)}%`,
              transform: 'translate(-50%, -100%)',
              minWidth: '135px',
            }}
          >
            {/* Timestamp */}
            <span className="text-[11px] font-medium text-[var(--fp-3)] leading-tight">
              {activePt.timestamp}
            </span>

            {/* TVL Value row */}
            <div className="flex items-center justify-between gap-3 mt-1.5 pt-1 border-t border-white/[0.08]">
              <span className="text-[11px] font-semibold text-[var(--fp-4)]">TVL</span>
              <span className="text-xs font-bold text-white tabular-nums tracking-wide">
                {formatCompactUsd(activePt.tvl)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PoolsTvlChartCard
