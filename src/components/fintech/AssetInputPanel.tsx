import React from 'react'
import { ChevronDown } from 'lucide-react'

interface AssetInputPanelProps {
  label: string
  amount: string
  onAmountChange?: (val: string) => void
  readOnly?: boolean
  placeholder?: string
  tokenSymbol: string
  tokenIcon?: string
  onSelectToken?: () => void
  tokenListAvailable?: boolean
  balance?: string
  onMaxClick?: () => void
  quickPercentages?: number[]
  onSelectPercentage?: (pct: number) => void
  fiatEstimate?: string
  priceImpact?: {
    value: string
    isWarning?: boolean
  }
  isLoading?: boolean
  disabled?: boolean
  error?: boolean
}

export const AssetInputPanel: React.FC<AssetInputPanelProps> = ({
  label,
  amount,
  onAmountChange,
  readOnly = false,
  placeholder = '0.00',
  tokenSymbol,
  tokenIcon,
  onSelectToken,
  tokenListAvailable = true,
  balance,
  onMaxClick,
  quickPercentages,
  onSelectPercentage,
  fiatEstimate,
  priceImpact,
  isLoading = false,
  disabled = false,
  error = false,
}) => {
  return (
    <div
      className={`rounded-2xl p-5 sm:p-5.5 transition-all duration-200 ${
        error
          ? 'bg-rose-500/[0.06] border border-rose-500/30'
          : 'bg-[#121626]/85 hover:bg-[#15192c]/90 focus-within:bg-[#15192c] border border-white/[0.06] hover:border-white/[0.12] focus-within:border-indigo-500/40'
      }`}
    >
      {/* Top Header: Label & Balance */}
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="text-[12px] font-semibold tracking-wider text-slate-400 uppercase" style={{ fontFamily: 'var(--font-app)' }}>
          {label}
        </span>
        {balance !== undefined && (
          <div className="flex items-center gap-1.5 text-xs sm:text-[13px] text-slate-400">
            <button
              type="button"
              onClick={onMaxClick}
              disabled={disabled || readOnly}
              className="font-medium text-slate-200 hover:text-indigo-300 transition-colors cursor-pointer tabular-nums disabled:cursor-default"
              title="Click to set maximum balance"
            >
              {balance} {tokenSymbol}
            </button>
          </div>
        )}
      </div>

      {/* Middle Row: Large Numeric Input & Token Pill */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="h-10 w-44 bg-white/[0.06] rounded-xl animate-pulse my-0.5" />
          ) : (
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              pattern="^[0-9]*[.,]?[0-9]*$"
              placeholder={placeholder}
              value={amount}
              readOnly={readOnly}
              disabled={disabled}
              onChange={(e) => {
                const val = e.target.value.replace(/,/g, '.')
                if (val === '' || /^\d*\.?\d*$/.test(val)) {
                  onAmountChange?.(val)
                }
              }}
              className="w-full bg-transparent border-0 p-0 text-3xl sm:text-4xl font-semibold tracking-tight text-white placeholder-slate-600 focus:outline-none tabular-nums"
              style={{
                fontFamily: 'var(--fonts--space-grotesk)',
              }}
            />
          )}
        </div>

        {/* Token Pill Button */}
        {tokenListAvailable && onSelectToken ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onSelectToken}
            className="shrink-0 flex items-center gap-2.5 px-4 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.1] hover:border-white/[0.2] transition-all cursor-pointer shadow-sm active:scale-95 text-white"
          >
            {tokenIcon && (
              <img src={tokenIcon} alt={tokenSymbol} className="w-6 h-6 object-contain rounded-full" />
            )}
            <span className="text-sm sm:text-base font-semibold tracking-wide" style={{ fontFamily: 'var(--font-app)' }}>
              {tokenSymbol}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </button>
        ) : (
          <div className="shrink-0 flex items-center gap-2.5 px-4 py-2 rounded-full bg-white/[0.04] border border-white/[0.08] text-white">
            {tokenIcon && (
              <img src={tokenIcon} alt={tokenSymbol} className="w-6 h-6 object-contain rounded-full" />
            )}
            <span className="text-sm sm:text-base font-semibold tracking-wide" style={{ fontFamily: 'var(--font-app)' }}>
              {tokenSymbol}
            </span>
          </div>
        )}
      </div>

      {/* Bottom Row: Fiat Estimate / Price Impact & Quick Percentages */}
      <div className="flex items-center justify-between gap-2 mt-2.5 pt-1 text-xs">
        <div className="flex items-center gap-2 text-slate-400">
          {fiatEstimate && (
            <span className="tabular-nums font-mono text-[11px] text-slate-400">
              {fiatEstimate}
            </span>
          )}
          {priceImpact && (
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                priceImpact.isWarning
                  ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}
            >
              {priceImpact.value}
            </span>
          )}
        </div>

        {/* Quick Percentage Chips */}
        {quickPercentages && quickPercentages.length > 0 && onSelectPercentage && (
          <div className="flex items-center gap-1">
            {quickPercentages.map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={disabled}
                onClick={() => onSelectPercentage(pct)}
                className="px-2 py-0.5 rounded-md text-[10px] font-semibold text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/15 border border-white/[0.06] hover:border-indigo-500/30 transition-all cursor-pointer active:scale-95 disabled:pointer-events-none"
              >
                {pct === 100 ? 'MAX' : `${pct}%`}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
