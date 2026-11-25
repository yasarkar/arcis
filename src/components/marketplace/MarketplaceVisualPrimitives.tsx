// src/components/marketplace/MarketplaceVisualPrimitives.tsx
// Reusable DESIGN.md visual primitives for AI Services:
// prominent Outfit section headers, semantic status pills, coin/pair/route icons, and chain badges.

import React from 'react'
import {
  AlertCircle,
  ArrowRight,
  Ban,
  CheckCircle2,
  Info,
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

const STATUS_ICON: Record<MarketplaceStatusTone, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  cancelled: Ban,
  info: Info,
  pending: Loader2,
}

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
  const Icon = STATUS_ICON[tone]
  const paddingClass = size === 'xs' ? 'px-2 py-0.5 text-[9px] gap-1' : 'px-2.5 py-1 text-[10px] gap-1.5'
  const iconSize = size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'

  return (
    <span
      className={`inline-flex items-center rounded-full border font-mono font-bold uppercase tracking-wider shrink-0 select-none ${paddingClass} ${className}`}
      style={{
        fontFamily: 'var(--fonts--space-mono)',
        color: style.fg,
        backgroundColor: style.pillBg,
        borderColor: style.pillBorder,
      }}
    >
      {showIcon && (
        <Icon className={`${iconSize} shrink-0 ${tone === 'pending' ? 'animate-spin' : ''}`} />
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
      className={`flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] ${
        compact ? 'px-4 py-3' : 'px-5 py-3.5'
      }`}
      style={{
        background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.025) 0%, rgba(15, 17, 26, 0.2) 100%)',
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div
            className="w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 shadow-inner"
            style={{
              backgroundColor: style.bg,
              borderColor: style.border,
              color: style.accent,
            }}
          >
            <Icon className="w-4 h-4" />
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <span
              className="block text-[9px] font-mono uppercase tracking-[2px] leading-none mb-1"
              style={{
                fontFamily: 'var(--fonts--space-mono)',
                color: style.accent,
              }}
            >
              {eyebrow}
            </span>
          )}
          <div className="flex items-center gap-2 min-w-0">
            <h4
              className={`${compact ? 'text-sm sm:text-base' : 'text-base sm:text-lg'} font-bold text-white tracking-tight truncate`}
              style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
            >
              {title}
            </h4>
            {typeof count === 'number' && (
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold tabular-nums border"
                style={{
                  fontFamily: 'var(--fonts--space-mono)',
                  color: style.fg,
                  backgroundColor: style.bg,
                  borderColor: style.border,
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
