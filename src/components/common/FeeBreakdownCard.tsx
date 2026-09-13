// Standardized, transparent Fee & Route Breakdown component for Arc and Circle-powered apps.
// Compliant with Arc L1 native USDC gas (18-decimal) and Circle AppKit (90/10 revenue share).
// Reusable across BridgeModal, SwapModal, and SendModal.
import React, { useState } from 'react'
import { ChevronDown, Info } from 'lucide-react'

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
  isGaslessSponsored = false,
  isGatewayMode = false,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  if (!items || items.length === 0) return null

  return (
    <div
      className={`rounded-2xl border border-white/[0.08] transition-all duration-200 ${
        isOpen ? 'overflow-visible' : 'overflow-hidden'
      } ${className}`}
      style={{
        background: 'rgba(14, 16, 28, 0.72)',
        backdropFilter: 'blur(16px)',
      }}
    >
      {/* Clickable Header / Summary Bar */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full px-3.5 py-3 flex items-center justify-between text-slate-300 hover:text-white transition-colors cursor-pointer group"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="font-semibold tracking-wide truncate text-[13px] text-slate-200 group-hover:text-white"
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
          <ChevronDown
            className={`w-4 h-4 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-white' : 'text-slate-400 group-hover:text-slate-200'
            }`}
          />
        </div>
      </button>

      {/* Accordion Drawer Content */}
      {isOpen && (
        <div className="px-3.5 pb-3.5 pt-2 space-y-2.5 border-t border-white/[0.05] text-[13px] animate-fade-in relative z-20">
          {items.map((item, idx) => {
            return (
              <div
                key={idx}
                className={`flex items-center justify-between py-1 text-slate-300 transition-colors ${
                  item.highlight ? 'text-slate-100 font-medium' : ''
                }`}
              >
                {/* Left Label + Optional Tooltip Popover */}
                <div className="flex items-center gap-1.5 min-w-0 relative">
                  <span className="truncate text-slate-300 font-medium">{item.label}</span>

                  {item.badge && (
                    <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-300 border border-white/10 shrink-0">
                      {item.badge}
                    </span>
                  )}

                  {item.tooltip && (
                    <div className="relative group/tip flex items-center inline-flex shrink-0">
                      <Info className="w-3.5 h-3.5 text-slate-400 hover:text-indigo-300 cursor-help transition-colors" />
                      {/* Floating Micro Tooltip Popover */}
                      <div
                        className={`absolute left-0 ${
                          idx === 0 ? 'top-full mt-2' : 'bottom-full mb-2'
                        } hidden group-hover/tip:flex flex-col z-50 pointer-events-none px-3 py-2 rounded-xl text-[12px] font-normal text-slate-100 bg-[#0c0f1e]/95 backdrop-blur-md border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.6)] w-max max-w-[250px] leading-snug`}
                        role="tooltip"
                      >
                        {item.tooltip}
                        <span
                          className={`absolute left-3 border-4 border-transparent ${
                            idx === 0
                              ? 'bottom-full border-b-[#0c0f1e]'
                              : 'top-full border-t-[#0c0f1e]'
                          }`}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Right Value */}
                <div
                  className={`font-mono text-right tabular-nums text-[13px] shrink-0 ${
                    item.highlightColor
                      ? `${item.highlightColor} font-semibold`
                      : typeof item.value === 'string' && item.value.includes('Sponsored by Arcis')
                      ? 'text-indigo-400 font-semibold'
                      : item.label.toLowerCase().includes('net received') || item.label.toLowerCase().includes('recipient gets')
                      ? 'text-emerald-400 font-semibold'
                      : item.highlight
                      ? 'text-emerald-400 font-semibold'
                      : typeof item.value === 'string' &&
                        (item.value.includes('Free') || item.value.includes('Sponsored'))
                      ? 'text-emerald-400 font-medium'
                      : 'text-slate-100 font-medium'
                  }`}
                >
                  {item.value}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default FeeBreakdownCard
