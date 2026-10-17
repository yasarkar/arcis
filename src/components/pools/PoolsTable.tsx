import React, { useState, useMemo } from 'react'
import { ChevronDown, Layers } from 'lucide-react'
import type { PoolConfig } from '../../config/poolsConfig'
import type { UserPoolPosition } from '../../hooks/usePoolsData'
import PoolTableRow from './PoolTableRow'

export type SortField = 'liquidity' | 'volume' | 'fees' | 'apr'
export type SortDirection = 'asc' | 'desc'

interface PoolsTableProps {
  pools: (PoolConfig & { userPosition?: UserPoolPosition })[]
  onSelectPool: (pool: PoolConfig, mode?: 'deposit' | 'withdraw' | 'swap') => void
  walletConnected: boolean
  searchQuery?: string
}

export const PoolsTable: React.FC<PoolsTableProps> = ({
  pools,
  onSelectPool,
  walletConnected,
  searchQuery = '',
}) => {
  const [sortField, setSortField] = useState<SortField>('liquidity')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const handleHeaderSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  // Sort and filter real pools directly
  const sortedPools = useMemo(() => {
    return [...pools].sort((a, b) => {
      let valA = 0
      let valB = 0

      if (sortField === 'liquidity') {
        valA = a.tvlUsd || 0
        valB = b.tvlUsd || 0
      } else if (sortField === 'volume') {
        valA = a.volume24hUsd || 0
        valB = b.volume24hUsd || 0
      } else if (sortField === 'fees') {
        valA = (a.volume24hUsd || 0) * ((a.feeTierPercent || 0.25) / 100)
        valB = (b.volume24hUsd || 0) * ((b.feeTierPercent || 0.25) / 100)
      } else if (sortField === 'apr') {
        valA = a.apy
        valB = b.apy
      }

      if (sortDirection === 'desc') {
        return valB - valA
      }
      return valA - valB
    })
  }, [pools, sortField, sortDirection])

  return (
    <div
      className="w-full rounded-[28px] overflow-hidden transition-all duration-300"
      style={{
        background: 'linear-gradient(180deg, rgba(16, 20, 36, 0.94) 0%, rgba(11, 14, 25, 0.98) 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.04), 0 20px 48px -12px rgba(0, 0, 0, 0.6)',
        fontFamily: 'var(--font-app)',
      }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[700px]">
          {/* ── Table Header Row (Matching Screenshot Columns & Sorting) ── */}
          <thead>
            <tr
              className="border-b border-white/[0.08]"
              style={{ background: 'rgba(255, 255, 255, 0.02)' }}
            >
              {/* Pool column */}
              <th className="py-4 pl-5 sm:pl-7 pr-4 text-xs font-semibold text-[var(--fp-4)] tracking-wide">
                Pool
              </th>

              {/* Liquidity sortable */}
              <th className="py-4 px-4 text-xs font-semibold text-[var(--fp-4)] tracking-wide">
                <button
                  type="button"
                  onClick={() => handleHeaderSort('liquidity')}
                  className="inline-flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
                >
                  <span>Liquidity</span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${
                      sortField === 'liquidity' && sortDirection === 'asc' ? 'rotate-180 text-[var(--purple-1)]' : ''
                    } ${sortField === 'liquidity' ? 'text-white' : 'text-[var(--fp-4)]'}`}
                  />
                </button>
              </th>

              {/* 24h Volume sortable */}
              <th className="py-4 px-4 text-xs font-semibold text-[var(--fp-4)] tracking-wide">
                <button
                  type="button"
                  onClick={() => handleHeaderSort('volume')}
                  className="inline-flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
                >
                  <span>24h Volume</span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${
                      sortField === 'volume' && sortDirection === 'asc' ? 'rotate-180 text-[var(--purple-1)]' : ''
                    } ${sortField === 'volume' ? 'text-white' : 'text-[var(--fp-4)]'}`}
                  />
                </button>
              </th>

              {/* 24h Fees sortable */}
              <th className="py-4 px-4 text-xs font-semibold text-[var(--fp-4)] tracking-wide">
                <button
                  type="button"
                  onClick={() => handleHeaderSort('fees')}
                  className="inline-flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer"
                >
                  <span>24h Fees</span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${
                      sortField === 'fees' && sortDirection === 'asc' ? 'rotate-180 text-[var(--purple-1)]' : ''
                    } ${sortField === 'fees' ? 'text-white' : 'text-[var(--fp-4)]'}`}
                  />
                </button>
              </th>

              {/* APR column */}
              <th className="py-4 px-4 text-xs font-semibold text-[var(--fp-4)] tracking-wide text-right">
                <button
                  type="button"
                  onClick={() => handleHeaderSort('apr')}
                  className="inline-flex items-center gap-1.5 hover:text-white transition-colors cursor-pointer ml-auto"
                >
                  <span>APR</span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${
                      sortField === 'apr' && sortDirection === 'asc' ? 'rotate-180 text-[var(--purple-1)]' : ''
                    } ${sortField === 'apr' ? 'text-white' : 'text-[var(--fp-4)]'}`}
                  />
                </button>
              </th>

              {/* Action column (blank header) */}
              <th className="py-4 pr-5 sm:pr-7 pl-2 w-10" />
            </tr>
          </thead>

          {/* ── Table Body ── */}
          <tbody className="divide-y divide-white/[0.03]">
            {sortedPools.map((pool) => (
              <PoolTableRow
                key={pool.id}
                pool={pool}
                onSelect={onSelectPool}
                walletConnected={walletConnected}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Empty State */}
      {sortedPools.length === 0 && (
        <div className="py-16 px-6 text-center text-[var(--fp-3)]">
          <Layers size={36} className="mx-auto mb-3 opacity-30 text-white" />
          <h4 className="text-base font-semibold text-white mb-1">No Pools Found</h4>
          <p className="text-xs text-[var(--fp-4)] max-w-sm mx-auto">
            {searchQuery
              ? `No pools matched "${searchQuery}". Try a different token or category.`
              : 'No liquidity pools available currently.'}
          </p>
        </div>
      )}
    </div>
  )
}

export default PoolsTable
