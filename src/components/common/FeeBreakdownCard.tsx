// src/components/common/FeeBreakdownCard.tsx
//
// Standardized, transparent Fee & Route Breakdown component for Arc and Circle-powered apps.
// Compliant with Arc L1 native USDC gas (18-decimal) and Circle AppKit (90/10 revenue share).
// Reusable across BridgeModal, SwapModal, and SendModal.

import React, { useState } from 'react'
import { ChevronDown, Info, Coins, Zap, ShieldCheck, Clock, CheckCircle2 } from 'lucide-react'
import { REVENUE_SHARE_LABEL, REVENUE_SHARE_TOOLTIP } from '../../config/treasuryConfig'

export interface FeeBreakdownItem {
  label: string
  value: React.ReactNode
  tooltip?: string
  highlight?: boolean
  highlightColor?: string
  category?: 'gas' | 'protocol' | 'platform' | 'net' | 'time' | 'rate' | 'route' | 'other'
  badge?: string
}

// Backward-compatible alias for existing fintech BreakdownItem
export type BreakdownItem = FeeBreakdownItem

export interface FeeBreakdownCardProps {
  summaryTitle?: string
  summaryBadge?: React.ReactNode
  items: FeeBreakdownItem[]
  defaultOpen?: boolean
  className?: string
  context?: 'bridge' | 'swap' | 'send'
  isGaslessSponsored?: boolean
  isGatewayMode?: boolean
  showRevenueShare?: boolean
  showItemIcons?: boolean
}

export const FeeBreakdownCard: React.FC<FeeBreakdownCardProps> = ({
  summaryTitle = 'Fee & Transaction Breakdown',
  summaryBadge,
  items,
  defaultOpen = false,
  className = '',
  context,
  isGaslessSponsored = false,
  isGatewayMode = false,
  showRevenueShare,
  showItemIcons = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  if (!items || items.length === 0) return null

  // Determine if revenue share footnote should be shown
  const hasPlatformFee = items.some(
    (it) => it.label.toLowerCase().includes('platform fee') || it.category === 'platform'
  )
  const shouldShowRevShare =
    showRevenueShare ?? (hasPlatformFee && (context === 'bridge' || context === 'swap'))

  const isArcSend = context === 'send'

  const getItemIcon = (item: FeeBreakdownItem) => {
    const lbl = item.label.toLowerCase()
    if (lbl.includes('gas') || item.category === 'gas') {
      return <Zap className="w-3 h-3 text-cyan-400 shrink-0" />
    }
    if (lbl.includes('platform') || item.category === 'platform') {
      return <Coins className="w-3 h-3 text-[var(--purple-1,#9896ff)] shrink-0" />
    }
    if (lbl.includes('protocol') || lbl.includes('liquidity') || item.category === 'protocol') {
      return <ShieldCheck className="w-3 h-3 text-indigo-400 shrink-0" />
    }
    if (lbl.includes('time') || lbl.includes('speed') || lbl.includes('arrival') || item.category === 'time') {
      return <Clock className="w-3 h-3 text-amber-400 shrink-0" />
    }
    if (item.highlight || item.category === 'net') {
      return <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
    }
    return null
  }

  return (
    <div
      className={`rounded-2xl border border-white/[0.08] transition-all duration-200 overflow-hidden ${className}`}
      style={{
        background: 'rgba(14, 16, 28, 0.72)',
        backdropFilter: 'blur(16px)',
      }}
    >
      {/* Clickable Header / Summary Bar */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs text-slate-300 hover:text-white transition-colors cursor-pointer group"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-semibold tracking-wide truncate text-[11.5px] text-slate-200 group-hover:text-white"
            style={{ fontFamily: 'var(--font-app)' }}
          >
            {summaryTitle}
          </span>
          {summaryBadge}
        </div>

        <div className="flex items-center gap-2 shrink-0 text-slate-400">
          {isGaslessSponsored && (
            <span className="text-[10px] font-semibold text-indigo-400 border border-indigo-500/25 px-2 py-0.5 rounded-full">
              %100 Sponsored
            </span>
          )}
          {isGatewayMode && !isGaslessSponsored && (
            <span className="text-[10px] font-semibold text-indigo-400 border border-indigo-500/25 px-2 py-0.5 rounded-full">
              &lt; 500ms Finality
            </span>
          )}
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-white' : 'text-slate-400 group-hover:text-slate-200'
            }`}
          />
        </div>
      </button>

      {/* Accordion Drawer Content */}
      {isOpen && (
        <div className="px-3.5 pb-3 pt-1.5 space-y-2 border-t border-white/[0.05] text-[11px] animate-fade-in">
          {items.map((item, idx) => {
            const icon = showItemIcons ? getItemIcon(item) : null
            return (
              <div
                key={idx}
                className={`flex items-center justify-between py-0.5 text-slate-400 transition-colors ${
                  item.highlight ? 'text-slate-200 font-medium' : ''
                }`}
              >
                {/* Left Label + Optional Category Icon + Tooltip */}
                <div className="flex items-center gap-1.5 min-w-0" title={item.tooltip}>
                  {icon}
                  <span className="truncate">{item.label}</span>
                  {item.badge && (
                    <span className="text-[9px] font-mono font-medium px-1.5 py-0.2 rounded bg-white/[0.06] text-slate-300 border border-white/10">
                      {item.badge}
                    </span>
                  )}
                  {item.tooltip && (
                    <Info className="w-3 h-3 text-slate-500 hover:text-slate-300 cursor-help shrink-0" />
                  )}
                </div>

                {/* Right Value */}
                <div
                  className={`font-mono text-right tabular-nums shrink-0 ${
                    item.highlightColor
                      ? `${item.highlightColor} font-semibold`
                      : typeof item.value === 'string' && item.value.includes('Sponsored by Arcis')
                      ? 'text-indigo-400 font-semibold'
                      : item.label.toLowerCase().includes('net received')
                      ? 'text-indigo-400 font-semibold'
                      : item.highlight
                      ? 'text-emerald-400 font-semibold'
                      : typeof item.value === 'string' &&
                        (item.value.includes('Free') || item.value.includes('Sponsored'))
                      ? 'text-emerald-400 font-medium'
                      : 'text-slate-200'
                  }`}
                >
                  {item.value}
                </div>
              </div>
            )
          })}

          {/* Revenue Share Footnote */}
          {shouldShowRevShare && (
            <div
              className="pt-2 mt-1 border-t border-white/[0.06] flex items-center justify-between text-[10px] text-slate-400"
              title={REVENUE_SHARE_TOOLTIP}
            >
              <span className="flex items-center gap-1 text-slate-400">
                {showItemIcons && <Coins className="w-3 h-3 text-[var(--purple-1,#9896ff)] shrink-0" />}
                Arcis Revenue Share
              </span>
              <span className="text-[11px] text-slate-300 font-medium px-1.5 py-0.2 rounded">
                {REVENUE_SHARE_LABEL}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default FeeBreakdownCard
