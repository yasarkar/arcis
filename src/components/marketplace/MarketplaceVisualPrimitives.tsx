// src/components/marketplace/MarketplaceVisualPrimitives.tsx
// Reusable DESIGN.md visual primitives for AI Services:
// prominent Outfit section headers, semantic status pills, coin/pair/route icons, and chain badges.

import React, { useId } from 'react'
import {
  ArrowRight,
  Loader2,
} from 'lucide-react'
import { getChainDisplayName } from '../../config/chainMeta'
import { ChainIcon } from '../common/ChainIcon'
import { PortfolioAssetIcon } from '../portfolio/PortfolioAssetIcon'
import {
  getStatusToneStyle,
  parseRouteTokenSequence,
  type MarketplaceStatusTone,
} from './marketplaceDesign'

export function StatusBadge({
  tone,
  label,
  size = 'sm',
  showIcon = true,
  className = '',
}: {
  tone: MarketplaceStatusTone
  label: string
  size?: 'xs' | 'sm'
  showIcon?: boolean
  className?: string
}) {
  const style = getStatusToneStyle(tone)
  const paddingClass = size === 'xs' ? 'px-2 py-0.5 text-[9px] gap-1.5' : 'px-2.5 py-1 text-[10px] gap-1.5'
  const dotSize = size === 'xs' ? 'w-1.5 h-1.5' : 'w-[7px] h-[7px]'

  return (
    <span
      className={`inline-flex items-center rounded-full border font-mono font-semibold uppercase tracking-[0.08em] shrink-0 select-none ${paddingClass} ${className}`}
      style={{
        fontFamily: 'var(--fonts--space-mono)',
        color: style.fg,
        backgroundColor: style.pillBg,
        borderColor: style.pillBorder,
      }}
    >
      {showIcon && (
        tone === 'pending' ? (
          <Loader2
            className={`${size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'} shrink-0 animate-spin`}
            style={{ color: style.accent }}
          />
        ) : (
          <span
            className={`${dotSize} rounded-full shrink-0`}
            style={{ backgroundColor: style.dot }}
            aria-hidden="true"
          />
        )
      )}
      <span>{label}</span>
    </span>
  )
}

export function SectionHeader({
  title,
  eyebrow,
  count,
  icon: Icon,
  tone = 'info',
  rightSlot,
  compact = false,
}: {
  title: string
  eyebrow?: string
  count?: number
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  tone?: MarketplaceStatusTone
  rightSlot?: React.ReactNode
  compact?: boolean
}) {
  const style = getStatusToneStyle(tone)
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-b ${
        compact ? 'px-4 py-3' : 'px-5 py-3.5'
      }`}
      style={{
        borderColor: 'rgba(152, 150, 255, 0.12)',
        background: 'linear-gradient(90deg, rgba(22, 25, 38, 0.65) 0%, rgba(15, 17, 26, 0.4) 100%)',
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div
            className="w-8 h-8 rounded-xl border flex items-center justify-center shrink-0"
            style={{
              backgroundColor: 'rgba(22, 25, 38, 0.9)',
              borderColor: 'rgba(152, 150, 255, 0.18)',
              color: style.accent,
            }}
          >
            <Icon className="w-4 h-4" />
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <span
              className="block text-[9.5px] font-mono uppercase tracking-[1.8px] leading-none mb-1"
              style={{
                fontFamily: 'var(--fonts--space-mono)',
                color: 'var(--purple-1, #9896ff)',
              }}
            >
              {eyebrow}
            </span>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <h4
              className={`${compact ? 'text-sm sm:text-base' : 'text-base sm:text-lg'} font-semibold text-white tracking-tight truncate`}
              style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
            >
              {title}
            </h4>
            {typeof count === 'number' && (
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium tabular-nums border"
                style={{
                  fontFamily: 'var(--fonts--space-mono)',
                  color: 'var(--secondary-colors--sky-sync, #acc6e9)',
                  backgroundColor: 'rgba(22, 25, 38, 0.9)',
                  borderColor: 'rgba(152, 150, 255, 0.18)',
                }}
              >
                {count}
              </span>
            )}
          </div>
        </div>
      </div>
      {rightSlot && <div className="flex items-center gap-2 flex-wrap shrink-0">{rightSlot}</div>}
    </div>
  )
}

export function TokenIconBadge({
  symbol,
  size = 18,
  className = '',
}: {
  symbol: string
  size?: number
  className?: string
}) {
  const clean = symbol.trim()
  const boxSize = size + 6
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full shrink-0 border border-white/10 overflow-hidden ${className}`}
      style={{
        width: boxSize,
        height: boxSize,
        backgroundColor: 'rgba(11, 13, 24, 0.92)',
      }}
      title={clean}
    >
      <PortfolioAssetIcon
        symbol={clean}
        size={size}
        className="w-full h-full object-contain p-[2px]"
      />
    </span>
  )
}

export function TokenPairIcons({
  symbols,
  size = 18,
}: {
  symbols: string[]
  size?: number
}) {
  if (symbols.length === 0) return null
  return (
    <span className="inline-flex items-center -space-x-1.5 shrink-0">
      {symbols.slice(0, 4).map((sym, idx) => (
        <TokenIconBadge
          key={`${sym}-${idx}`}
          symbol={sym}
          size={size}
          className="ring-2 ring-[#0c0f1c]"
        />
      ))}
    </span>
  )
}

export function InlineTokenChip({
  symbol,
  label,
  size = 14,
  className = '',
}: {
  symbol: string
  label?: string
  size?: number
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border border-white/10 text-[11px] font-mono font-semibold text-white/90 ${className}`}
      style={{
        backgroundColor: 'rgba(11, 13, 24, 0.85)',
        fontFamily: 'var(--fonts--space-mono)',
      }}
    >
      <PortfolioAssetIcon symbol={symbol} size={size} className="w-3.5 h-3.5 object-contain shrink-0" />
      <span>{label ?? symbol}</span>
    </span>
  )
}

export function RouteTokenFlow({
  path,
  symbols,
  size = 16,
}: {
  path?: string
  symbols?: string[]
  size?: number
}) {
  const list = symbols && symbols.length > 0 ? symbols : parseRouteTokenSequence(path)
  if (list.length === 0) {
    return path ? <span className="text-xs font-semibold text-white font-mono">{path}</span> : null
  }
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      {list.map((sym, idx) => (
        <span key={`${sym}-${idx}`} className="inline-flex items-center gap-1.5">
          {idx > 0 && (
            <ArrowRight
              className="w-3 h-3 shrink-0"
              style={{ color: 'var(--secondary-colors--sky-sync)' }}
            />
          )}
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border border-white/[0.08]"
            style={{ backgroundColor: 'rgba(11, 13, 24, 0.85)' }}
          >
            <PortfolioAssetIcon symbol={sym} size={size} className="w-4 h-4 object-contain shrink-0" />
            <span
              className="text-xs font-bold text-white tracking-tight"
              style={{ fontFamily: 'var(--fonts--space-mono)' }}
            >
              {sym}
            </span>
          </span>
        </span>
      ))}
    </span>
  )
}

export function ChainPill({
  chainKey,
  label,
  size = 16,
  className = '',
}: {
  chainKey: string
  label?: string
  size?: number
  className?: string
}) {
  const display = label ?? (getChainDisplayName(chainKey) || chainKey.replace(/_/g, ' '))
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-white/10 text-[11px] font-semibold text-white/90 ${className}`}
      style={{ backgroundColor: 'rgba(11, 13, 24, 0.85)' }}
      title={display}
    >
      <span className="w-4 h-4 rounded-full overflow-hidden inline-flex items-center justify-center shrink-0">
        <ChainIcon chainKeyOrIconId={chainKey} size={size} />
      </span>
      <span className="truncate">{display}</span>
    </span>
  )
}

const STAR_PATH_D =
  'M12 2.25l2.89 5.86 6.47.94-4.68 4.56 1.1 6.44L12 17.01l-5.78 3.04 1.1-6.44-4.68-4.56 6.47-.94L12 2.25z'

/**
 * Overlapping 5-star execution quality indicator styled in the signature Arcis violet
 * gradient (`linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)`), inspired by Google Reviews.
 * Supports full and half-star fills with dark obsidian edge separation for crisp overlap.
 */
export function ExecutionStarRating({
  rating,
  maxRating = 5,
  size = 18,
  showScore = true,
  tooltip,
  ariaLabel,
  className = '',
}: {
  rating: number
  maxRating?: number
  size?: number
  showScore?: boolean
  tooltip?: string
  ariaLabel?: string
  className?: string
}) {
  const uid = useId().replace(/:/g, '')
  const gradId = `arc-star-grad-${uid}`
  const clamped = Number.isFinite(rating) ? Math.min(maxRating, Math.max(0, rating)) : 0
  const formattedScore = clamped.toFixed(1)
  const overlapPx = Math.max(2, Math.round(size * 0.22))

  return (
    <span
      role="img"
      aria-label={ariaLabel ?? `Execution rating: ${formattedScore} out of ${maxRating} stars`}
      title={tooltip}
      className={`inline-flex items-center gap-2 shrink-0 select-none ${className}`}
    >
      <span className="inline-flex items-center" aria-hidden="true">
        {Array.from({ length: maxRating }, (_, idx) => {
          const fillFraction = Math.max(0, Math.min(1, clamped - idx))
          const starGradId = `${gradId}-${idx}`
          const clipId = `arc-star-clip-${uid}-${idx}`
          const isFilled = fillFraction > 0
          return (
            <svg
              key={idx}
              width={size}
              height={size}
              viewBox="0 0 24 24"
              className="shrink-0 overflow-visible transition-transform duration-200"
              style={{
                marginLeft: idx === 0 ? 0 : `-${overlapPx}px`,
                zIndex: maxRating - idx,
                filter: isFilled ? 'drop-shadow(0 1px 6px rgba(152, 150, 255, 0.32))' : undefined,
              }}
            >
              <defs>
                {isFilled && (
                  <linearGradient id={starGradId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#9896ff" />
                    <stop offset="100%" stopColor="#7c3aed" />
                  </linearGradient>
                )}
                {fillFraction > 0 && fillFraction < 1 && (
                  <clipPath id={clipId}>
                    <rect x="0" y="0" width={24 * fillFraction} height="24" />
                  </clipPath>
                )}
              </defs>

              {/* Obsidian halo stroke separates slightly overlapping stars cleanly */}
              <path
                d={STAR_PATH_D}
                fill="rgba(152, 150, 255, 0.14)"
                stroke="#0f111a"
                strokeWidth="2.6"
                strokeLinejoin="round"
                strokeLinecap="round"
                paintOrder="stroke fill"
              />
              {/* Subtle violet inner outline keeps empty star slots crisp against obsidian */}
              <path
                d={STAR_PATH_D}
                fill="none"
                stroke="rgba(152, 150, 255, 0.28)"
                strokeWidth="0.9"
                strokeLinejoin="round"
              />

              {/* Gradient fill (full or clipped half-star) matching linear-gradient(135deg, #9896ff 0%, #7c3aed 100%) */}
              {isFilled && (
                <path
                  d={STAR_PATH_D}
                  fill={`url(#${starGradId})`}
                  clipPath={fillFraction < 1 ? `url(#${clipId})` : undefined}
                  stroke="#0f111a"
                  strokeWidth="1.35"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  paintOrder="stroke fill"
                />
              )}
            </svg>
          )
        })}
      </span>

      {showScore && (
        <span
          className="text-xs font-bold tabular-nums leading-none tracking-tight"
          style={{ fontFamily: 'var(--fonts--space-grotesk)', color: '#f4f4fb' }}
        >
          {formattedScore}
          <span
            className="text-[10px] font-medium ml-0.5"
            style={{ color: 'var(--fp-4)' }}
          >
            /{maxRating}
          </span>
        </span>
      )}
    </span>
  )
}
