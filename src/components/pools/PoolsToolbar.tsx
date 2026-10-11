import React from 'react'
import { Search, Plus, Calculator, RefreshCw } from 'lucide-react'
import type { PoolCategory } from '../../config/poolsConfig'
import { Tooltip } from '../common/Tooltip'

interface PoolsToolbarProps {
  searchQuery: string
  onSearchChange: (q: string) => void
  activeCategory: PoolCategory | 'all'
  onCategoryChange: (cat: PoolCategory | 'all') => void
  onCreatePool: () => void
  onOpenCalculator?: () => void
  onRefresh?: () => void
  isRefreshing?: boolean
}

export const PoolsToolbar: React.FC<PoolsToolbarProps> = ({
  searchQuery,
  onSearchChange,
  activeCategory,
  onCategoryChange,
  onCreatePool,
  onOpenCalculator,
  onRefresh,
  isRefreshing = false,
}) => {
  const categories: { id: PoolCategory | 'all'; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'liquidity', label: 'Liquidity' },
    { id: 'vault', label: 'Vaults' },
  ]

  return (
    <div className="w-full flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 sm:gap-4 my-6">
      {/* ── Left Side: Full-width / Expanded Search Bar (Matching Screenshot) ── */}
      <div className="relative flex-1 min-w-0">
        <Search
          size={16}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--fp-4)] pointer-events-none transition-colors"
        />
        <input
          type="text"
          placeholder="Search for pools"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-11 pr-4 py-3 sm:py-3.5 rounded-2xl text-sm text-white placeholder-[var(--fp-4)] transition-all duration-200 outline-none"
          style={{
            background: 'rgba(15, 18, 32, 0.8)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.3)',
            fontFamily: 'var(--font-app)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'rgba(152, 150, 255, 0.4)'
            e.currentTarget.style.boxShadow = '0 0 14px rgba(152, 150, 255, 0.15)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)'
            e.currentTarget.style.boxShadow = 'inset 0 1px 3px rgba(0, 0, 0, 0.3)'
          }}
        />
      </div>

      {/* ── Right Side Controls & Action Buttons ── */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0 flex-wrap justify-between md:justify-end">
        {/* Category Filters (Pills) */}
        <div
          className="flex items-center p-1 rounded-2xl border border-white/[0.08]"
          style={{ background: 'rgba(12, 15, 26, 0.75)' }}
        >
          {categories.map((cat) => {
            const isActive = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onCategoryChange(cat.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'bg-white/[0.14] text-white border border-white/20 shadow-sm'
                    : 'text-[var(--fp-4)] hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                {cat.label}
              </button>
            )
          })}
        </div>

        {/* Quick Calculator Button */}
        {onOpenCalculator && (
          <Tooltip content="Yield Calculator" position="bottom" align="center">
            <button
              type="button"
              onClick={onOpenCalculator}
              className="p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/20 text-white/80 hover:text-white transition-all cursor-pointer active:scale-95"
              aria-label="Calculator"
            >
              <Calculator size={15} />
            </button>
          </Tooltip>
        )}

        {/* Refresh Balances Button */}
        {onRefresh && (
          <Tooltip content="Refresh Balances & State" position="bottom" align="center">
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-3 rounded-2xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/20 text-white/80 hover:text-white transition-all cursor-pointer active:scale-95 disabled:opacity-40"
              aria-label="Refresh Pools"
            >
              <RefreshCw size={15} className={isRefreshing ? 'arcis-spin' : ''} />
            </button>
          </Tooltip>
        )}

        {/* ── Main "+ CREATE POOL" Button (Matching Screenshot) ── */}
        <button
          type="button"
          onClick={onCreatePool}
          className="group relative flex items-center gap-2 px-5 py-3 sm:py-3.5 rounded-2xl font-bold text-xs tracking-wider uppercase text-white transition-all duration-300 cursor-pointer select-none active:scale-95 shadow-lg"
          style={{
            background: 'linear-gradient(135deg, #181d33 0%, #121526 100%)',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            boxShadow: '0 8px 24px -6px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(152, 150, 255, 0.5)'
            e.currentTarget.style.boxShadow = '0 10px 28px -4px rgba(152, 150, 255, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.2)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.16)'
            e.currentTarget.style.boxShadow = '0 8px 24px -6px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
          }}
        >
          <Plus size={15} className="text-[var(--purple-1)] transition-transform duration-300 group-hover:rotate-90" />
          <span>Create Pool</span>
        </button>
      </div>
    </div>
  )
}

export default PoolsToolbar
