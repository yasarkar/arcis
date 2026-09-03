import React, { useState } from 'react'
import { ChevronDown, Info } from 'lucide-react'

export interface BreakdownItem {
  label: string
  value: React.ReactNode
  tooltip?: string
  highlight?: boolean
}

interface TransactionBreakdownProps {
  summaryTitle: string
  summaryBadge?: React.ReactNode
  items: BreakdownItem[]
  defaultOpen?: boolean
  className?: string
}

export const TransactionBreakdown: React.FC<TransactionBreakdownProps> = ({
  summaryTitle,
  summaryBadge,
  items,
  defaultOpen = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  if (items.length === 0) return null

  return (
    <div
      className={`rounded-2xl border border-white/[0.06] bg-[#101323]/60 transition-all duration-200 overflow-hidden ${className}`}
    >
      {/* Clickable Header / Compact Summary */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs text-slate-300 hover:text-white transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate text-[11px] text-slate-300" style={{ fontFamily: 'var(--fonts--space-grotesk)' }}>
            {summaryTitle}
          </span>
          {summaryBadge}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 text-slate-400">
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isOpen ? 'rotate-180 text-white' : ''
            }`}
          />
        </div>
      </button>

      {/* Accordion Details */}
      {isOpen && (
        <div className="px-3.5 pb-3 pt-1 space-y-2 border-t border-white/[0.04] text-[11px] animate-fade-in">
          {items.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-slate-400"
            >
              <div className="flex items-center gap-1" title={item.tooltip}>
                <span>{item.label}</span>
                {item.tooltip && (
                  <Info className="w-3 h-3 text-slate-500 hover:text-slate-300 cursor-help" />
                )}
              </div>
              <div
                className={`font-medium tabular-nums ${
                  item.highlight ? 'text-indigo-300 font-semibold' : 'text-slate-200'
                }`}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
