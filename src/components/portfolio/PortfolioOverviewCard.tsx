import React, { useRef, useState, useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { PortfolioAssetIcon } from './PortfolioAssetIcon'
import type { AggregatedAsset } from '../../services/portfolio'

interface PortfolioOverviewCardProps {
  totalUsd: number
  hideBalances: boolean
  onToggleHideBalances: () => void
  displayedAssets: AggregatedAsset[]
  shouldRender?: boolean
}

export function PortfolioOverviewCard({
  totalUsd,
  hideBalances,
  onToggleHideBalances,
  displayedAssets,
  shouldRender = true,
}: PortfolioOverviewCardProps) {
  // Measure unmasked width of Total Estimated Portfolio Value to prevent eye icon jumping/layout shift
  const unmaskedTotalRef = useRef<HTMLSpanElement>(null)
  const [unmaskedTotalWidth, setUnmaskedTotalWidth] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (unmaskedTotalRef.current) {
      const w = unmaskedTotalRef.current.offsetWidth
      if (w > 0) setUnmaskedTotalWidth(w)
    }
  }, [totalUsd, shouldRender])

  return (
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
        ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>

      <div className="mt-2.5 flex items-center gap-3">
        <div className="flex items-baseline gap-2">
          <span
            style={unmaskedTotalWidth ? { minWidth: `${unmaskedTotalWidth}px`, display: 'inline-block' } : undefined}
            className="text-3xl font-extrabold tracking-tight text-white font-mono"
          >
            {hideBalances
              ? '$••••••'
              : `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
          <span className="text-[18px] font-semibold text-white">USD</span>
        </div>

        <button
          type="button"
          onClick={onToggleHideBalances}
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
                  <PortfolioAssetIcon symbol={asset.symbol} />
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
  )
}
