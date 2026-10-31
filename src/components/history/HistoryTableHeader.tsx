import React from 'react'
import {
  Filter,
  X,
  ArrowUpRight,
  ArrowRightLeft,
  Globe,
  ArrowDownToLine,
  Layers,
  PlusCircle,
  MinusCircle,
  Coins,
  Bot,
  Hash,
  Search,
  Calendar,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import { Tooltip } from '../common/Tooltip'
import { CustomCalendarPicker } from './CustomCalendarPicker'
import { ChainIcon } from '../common/ChainIcon'
import { getAriaSort, getSortButtonLabel } from './headerA11y'
import { usePopoverA11y } from './usePopoverA11y'

export type HistorySortField = 'time' | 'amount' | 'type' | 'network'
export type HistorySortDirection = 'asc' | 'desc'

export type HistoryFilterType =
  | 'all'
  | 'send'
  | 'swap'
  | 'bridge'
  | 'deposit'
  | 'ai_service'
  | 'pool'
  | 'add_liquidity'
  | 'remove_liquidity'
  | 'harvest'
  | 'memo'

export interface HistoryTableHeaderProps {
  showNetworkFilter: boolean
  setShowNetworkFilter: React.Dispatch<React.SetStateAction<boolean>>
  activeNetworkFilter: string
  setActiveNetworkFilter: (net: string) => void
  availableNetworks: { id: string; name: string; rawKey: string }[]

  filter: HistoryFilterType
  setFilter: (filter: HistoryFilterType) => void
  showTypeFilter: boolean
  setShowTypeFilter: React.Dispatch<React.SetStateAction<boolean>>

  showAmountFilter: boolean
  setShowAmountFilter: React.Dispatch<React.SetStateAction<boolean>>
  activeAmountFilter: { min?: number; max?: number } | null
  amountPreset: string | null
  setAmountPreset: (p: string | null) => void
  minAmount: string
  setMinAmount: (v: string) => void
  maxAmount: string
  setMaxAmount: (v: string) => void
  handleAmountPresetSelect: (presetId: string) => void
  handleApplyAmountFilter: () => void
  handleResetAmountFilter: () => void

  showRecipientFilter: boolean
  setShowRecipientFilter: React.Dispatch<React.SetStateAction<boolean>>
  activeRecipientFilter: string | null
  recipientSearch: string
  setRecipientSearch: (v: string) => void
  handleApplyRecipientFilter: () => void
  handleResetRecipientFilter: () => void

  timeFormat: 'relative' | 'utc'
  setTimeFormat: React.Dispatch<React.SetStateAction<'relative' | 'utc'>>
  showTimeFilter: boolean
  setShowTimeFilter: React.Dispatch<React.SetStateAction<boolean>>
  activeTimeFilter: { from?: number; to?: number } | null
  timePreset: string | null
  handleTimePresetSelect: (presetId: string) => void
  fromDate: string
  setFromDate: (v: string) => void
  toDate: string
  setToDate: (v: string) => void
  activePickerTarget: 'from' | 'to' | null
  setActivePickerTarget: React.Dispatch<React.SetStateAction<'from' | 'to' | null>>
  handleApplyTimeFilter: () => void
  handleResetTimeFilter: () => void
  formatDisplayDate: (isoStr: string) => string

  sortField: HistorySortField
  sortDirection: HistorySortDirection
  onSort: (field: HistorySortField) => void
}

function SortableHeaderTitle({
  field,
  currentField,
  direction,
  label,
  children,
}: {
  field: HistorySortField
  currentField: HistorySortField
  direction: HistorySortDirection
  label: string
  children?: React.ReactNode
}) {
  const isActive = currentField === field
  return (
    <div
      aria-hidden="true"
      className="inline-flex items-center gap-1.5 text-xs font-semibold select-none transition-colors"
    >
      <span className={isActive ? 'text-white font-bold' : 'text-slate-400 group-hover/col:text-white transition-colors'}>
        {children || label}
      </span>
      {isActive ? (
        direction === 'desc' ? (
          <ArrowDown className="w-3.5 h-3.5 text-[var(--purple-1)] shrink-0 transition-transform duration-150" />
        ) : (
          <ArrowUp className="w-3.5 h-3.5 text-[var(--purple-1)] shrink-0 transition-transform duration-150" />
        )
      ) : (
        <ArrowUpDown className="w-3.5 h-3.5 text-slate-600 group-hover/col:text-slate-300 opacity-60 group-hover/col:opacity-100 shrink-0 transition-all" />
      )}
    </div>
  )
}

export function HistoryTableHeader({
  showNetworkFilter,
  setShowNetworkFilter,
  activeNetworkFilter,
  setActiveNetworkFilter,
  availableNetworks,
  filter,
  setFilter,
  showTypeFilter,
  setShowTypeFilter,
  showAmountFilter,
  setShowAmountFilter,
  activeAmountFilter,
  amountPreset,
  setAmountPreset,
  minAmount,
  setMinAmount,
  maxAmount,
  setMaxAmount,
  handleAmountPresetSelect,
  handleApplyAmountFilter,
  handleResetAmountFilter,
  showRecipientFilter,
  setShowRecipientFilter,
  activeRecipientFilter,
  recipientSearch,
  setRecipientSearch,
  handleApplyRecipientFilter,
  handleResetRecipientFilter,
  timeFormat,
  setTimeFormat,
  showTimeFilter,
  setShowTimeFilter,
  activeTimeFilter,
  timePreset,
  handleTimePresetSelect,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  activePickerTarget,
  setActivePickerTarget,
  handleApplyTimeFilter,
  handleResetTimeFilter,
  formatDisplayDate,
  sortField,
  sortDirection,
  onSort,
}: HistoryTableHeaderProps) {
  // Each popover owns its focus handoff, Escape handling and Tab trap.
  const networkFilterRef = usePopoverA11y(showNetworkFilter, () => setShowNetworkFilter(false))
  const typeFilterRef = usePopoverA11y(showTypeFilter, () => setShowTypeFilter(false))
  const amountFilterRef = usePopoverA11y(showAmountFilter, () => setShowAmountFilter(false))
  const recipientFilterRef = usePopoverA11y(showRecipientFilter, () => setShowRecipientFilter(false))
  const timeFilterRef = usePopoverA11y(showTimeFilter, () => setShowTimeFilter(false))

  return (
    <thead>
      <tr
        className="border-b border-white/[0.08] text-xs font-semibold text-slate-400"
        style={{
          background: 'rgba(255, 255, 255, 0.02)',
          fontFamily: 'var(--font-app)',
        }}
      >
        <th scope="col" className="w-[18%] px-3 py-3.5 text-center">
          <div className="flex items-center justify-center">
            <span>TX HASH</span>
          </div>
        </th>

        {/* NETWORK Column Header with Sort & Filter */}
        <th
          scope="col"
          aria-sort={getAriaSort('network', sortField, sortDirection)}
          className="w-[13%] px-3 py-3.5 text-center relative filter-popover-container select-none hover:bg-white/[0.04] transition-colors group/col"
        >
          <div className="flex items-center justify-center gap-1.5">
            <button
              type="button"
              onClick={() => onSort('network')}
              title="Sort by Network"
              aria-label={getSortButtonLabel('Network', 'network', sortField, sortDirection)}
              className="inline-flex items-center rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--purple-1)]"
            >
              <SortableHeaderTitle
                field="network"
                currentField={sortField}
                direction={sortDirection}
                label="Network"
              >
                NETWORK
              </SortableHeaderTitle>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowNetworkFilter((prev) => !prev)
                setShowTypeFilter(false)
                setShowAmountFilter(false)
                setShowRecipientFilter(false)
                setShowTimeFilter(false)
                setActivePickerTarget(null)
              }}
              className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                activeNetworkFilter !== 'all'
                  ? 'text-white bg-[rgba(152,150,255,0.25)] border border-[rgba(152,150,255,0.45)] shadow-sm'
                  : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06]'
              }`}
              title="Filter by Network"
              aria-label="Filter by Network"
              aria-haspopup="dialog"
              aria-expanded={showNetworkFilter}
              aria-controls="history-network-filter"
            >
              <Filter className="w-3 h-3" />
            </button>
          </div>

          {/* Network Filter Popover Modal */}
          {showNetworkFilter && (
            <div
              ref={networkFilterRef}
              id="history-network-filter"
              role="dialog"
              aria-label="Network filter"
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-[244px] rounded-2xl p-3 shadow-2xl space-y-2.5 text-left font-sans normal-case tracking-normal backdrop-blur-2xl focus:outline-none"
              style={{
                background: 'rgba(15, 18, 32, 0.98)',
                border: '1px solid rgba(152, 150, 255, 0.25)',
                boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
                fontFamily: 'var(--font-app)',
              }}
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-white text-xs">Network</span>
                  {activeNetworkFilter !== 'all' && (
                    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[rgba(152,150,255,0.2)] text-[var(--purple-1)] border border-[rgba(152,150,255,0.3)]">
                      Active
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowNetworkFilter(false)}
                  aria-label="Close network filter"
                  className="w-5 h-5 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              {/* Network Options: Icons Only Grid */}
              <div className="grid grid-cols-4 gap-2">
                {/* All Networks Option */}
                <Tooltip content="All Networks" position="top">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveNetworkFilter('all')
                      setShowNetworkFilter(false)
                    }}
                    aria-label="All networks"
                    aria-pressed={activeNetworkFilter === 'all'}
                    className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                      activeNetworkFilter === 'all'
                        ? 'bg-[rgba(152,150,255,0.25)] text-white border border-[rgba(152,150,255,0.5)] shadow-[0_0_12px_rgba(152,150,255,0.3)] scale-105'
                        : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/20'
                    }`}
                  >
                    <Layers className="w-5 h-5 text-indigo-300" />
                  </button>
                </Tooltip>

                {/* Individual Network Icon Options */}
                {availableNetworks.map((net) => {
                  const isSelected = activeNetworkFilter === net.id || activeNetworkFilter === net.rawKey
                  return (
                    <Tooltip key={net.id} content={net.name} position="top">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveNetworkFilter(net.id)
                          setShowNetworkFilter(false)
                        }}
                        aria-label={net.name}
                        aria-pressed={isSelected}
                        className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[rgba(152,150,255,0.25)] border border-[rgba(152,150,255,0.5)] shadow-[0_0_12px_rgba(152,150,255,0.3)] scale-105'
                            : 'bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/20'
                        }`}
                      >
                        <ChainIcon chainKeyOrIconId={net.id} size={24} className="w-6 h-6 rounded-full object-contain shrink-0" />
                      </button>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          )}
        </th>

        {/* TYPE Column Header with Sort & Filter */}
        <th
          scope="col"
          aria-sort={getAriaSort('type', sortField, sortDirection)}
          className="w-[16%] px-3 py-3.5 text-center relative filter-popover-container select-none hover:bg-white/[0.04] transition-colors group/col"
        >
          <div className="flex items-center justify-center gap-1.5">
            <button
              type="button"
              onClick={() => onSort('type')}
              title="Sort by Type"
              aria-label={getSortButtonLabel('Type', 'type', sortField, sortDirection)}
              className="inline-flex items-center rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--purple-1)]"
            >
              <SortableHeaderTitle
                field="type"
                currentField={sortField}
                direction={sortDirection}
                label="Type"
              >
                TYPE
              </SortableHeaderTitle>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowTypeFilter((prev) => !prev)
                setShowNetworkFilter(false)
                setShowAmountFilter(false)
                setShowRecipientFilter(false)
                setShowTimeFilter(false)
                setActivePickerTarget(null)
              }}
              className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                filter !== 'all'
                  ? 'text-white bg-[rgba(152,150,255,0.25)] border border-[rgba(152,150,255,0.45)] shadow-sm'
                  : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06]'
              }`}
              title="Filter by Type"
              aria-label="Filter by Type"
              aria-haspopup="dialog"
              aria-expanded={showTypeFilter}
              aria-controls="history-type-filter"
            >
              <Filter className="w-3 h-3" />
            </button>
          </div>

          {/* Type Filter Popover Modal */}
          {showTypeFilter && (
            <div
              ref={typeFilterRef}
              id="history-type-filter"
              role="dialog"
              aria-label="Transaction type filter"
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-[380px] sm:w-[440px] max-w-[calc(100vw-32px)] rounded-2xl p-4 shadow-2xl space-y-3.5 text-left font-sans normal-case tracking-normal backdrop-blur-2xl focus:outline-none"
              style={{
                background: 'rgba(15, 18, 32, 0.98)',
                border: '1px solid rgba(152, 150, 255, 0.25)',
                boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
                fontFamily: 'var(--font-app)',
              }}
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-sm">Transaction Type</span>
                  {filter !== 'all' && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[rgba(152,150,255,0.2)] text-[var(--purple-1)] border border-[rgba(152,150,255,0.3)]">
                      Filtered
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowTypeFilter(false)}
                  aria-label="Close transaction type filter"
                  className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Options - Grid of buttons with ample space */}
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'all', label: 'All Operations', icon: Layers },
                  { id: 'send', label: 'Send', icon: ArrowUpRight },
                  { id: 'swap', label: 'Swap', icon: ArrowRightLeft },
                  { id: 'bridge', label: 'Bridge', icon: Globe },
                  { id: 'deposit', label: 'Gateway Deposit', icon: ArrowDownToLine },
                  { id: 'ai_service', label: 'x402 AI Services', icon: Bot },
                  { id: 'pool', label: 'All Pool Actions', icon: Layers },
                  { id: 'add_liquidity', label: 'Add Liquidity', icon: PlusCircle },
                  { id: 'remove_liquidity', label: 'Remove Liquidity', icon: MinusCircle },
                  { id: 'harvest', label: 'Yield Harvest', icon: Coins },
                ].map((t) => {
                  const Icon = t.icon
                  const isSelected = filter === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setFilter(t.id as any)
                        setShowTypeFilter(false)
                      }}
                      aria-pressed={isSelected}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                        isSelected
                          ? 'bg-[rgba(152,150,255,0.25)] text-white border border-[rgba(152,150,255,0.45)] shadow-sm'
                          : 'text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]'
                      }`}
                    >
                      {Icon && <Icon className="w-3.5 h-3.5 text-indigo-300 shrink-0" />}
                      <span className="truncate">{t.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </th>

        {/* AMOUNT Column Header with Sort & Filter */}
        <th
          scope="col"
          aria-sort={getAriaSort('amount', sortField, sortDirection)}
          className="w-[20%] px-3 py-3.5 text-center relative filter-popover-container select-none hover:bg-white/[0.04] transition-colors group/col"
        >
          <div className="flex items-center justify-center gap-1.5">
            <button
              type="button"
              onClick={() => onSort('amount')}
              title="Sort by Amount"
              aria-label={getSortButtonLabel('Amount', 'amount', sortField, sortDirection)}
              className="inline-flex items-center rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--purple-1)]"
            >
              <SortableHeaderTitle
                field="amount"
                currentField={sortField}
                direction={sortDirection}
                label="Amount"
              >
                AMOUNT
              </SortableHeaderTitle>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowAmountFilter((prev) => !prev)
                setShowNetworkFilter(false)
                setShowTypeFilter(false)
                setShowRecipientFilter(false)
                setShowTimeFilter(false)
                setActivePickerTarget(null)
              }}
              className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                activeAmountFilter
                  ? 'text-white bg-[rgba(152,150,255,0.25)] border border-[rgba(152,150,255,0.45)] shadow-sm'
                  : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06]'
              }`}
              title="Filter by Amount"
              aria-label="Filter by Amount"
              aria-haspopup="dialog"
              aria-expanded={showAmountFilter}
              aria-controls="history-amount-filter"
            >
              <Filter className="w-3 h-3" />
            </button>
          </div>

          {/* Amount Filter Popover Modal */}
          {showAmountFilter && (
            <div
              ref={amountFilterRef}
              id="history-amount-filter"
              role="dialog"
              aria-label="Amount filter"
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-80 rounded-2xl p-4 shadow-2xl space-y-3.5 text-left font-sans normal-case tracking-normal backdrop-blur-2xl focus:outline-none"
              style={{
                background: 'rgba(15, 18, 32, 0.98)',
                border: '1px solid rgba(152, 150, 255, 0.25)',
                boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
                fontFamily: 'var(--font-app)',
              }}
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <span className="font-bold text-white text-sm">Amount Range</span>
                <button
                  type="button"
                  onClick={() => setShowAmountFilter(false)}
                  aria-label="Close amount filter"
                  className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <p className="text-[10px] leading-snug text-slate-400">
                Ranges are USDC-equivalent values at live prices — EURC, wETH and cirBTC rows are converted,
                never compared in their own units.
              </p>

              {/* Presets */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {[
                  { id: '<10', label: '< 10' },
                  { id: '10-100', label: '10 - 100' },
                  { id: '100-1000', label: '100 - 1K' },
                  { id: '>1000', label: '> 1K' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleAmountPresetSelect(p.id)}
                    aria-pressed={amountPreset === p.id}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                      amountPreset === p.id
                        ? 'bg-[rgba(152,150,255,0.25)] text-white border border-[rgba(152,150,255,0.45)] shadow-sm'
                        : 'text-slate-400 hover:text-white bg-white/[0.04] border border-white/[0.06]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Inputs */}
              <div className="space-y-2">
                <div
                  className="relative flex items-center rounded-2xl px-3.5 py-2.5 transition-all"
                  style={{
                    background: 'rgba(11, 13, 24, 0.75)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  <Hash className="w-4 h-4 text-slate-400 mr-2 shrink-0 pointer-events-none" />
                  <input
                    type="number"
                    step="any"
                    value={minAmount}
                    onChange={(e) => {
                      setMinAmount(e.target.value)
                      setAmountPreset(null)
                    }}
                    placeholder="Min USDC value"
                    aria-label="Minimum USDC value"
                    className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                  />
                </div>

                <div
                  className="relative flex items-center rounded-2xl px-3.5 py-2.5 transition-all"
                  style={{
                    background: 'rgba(11, 13, 24, 0.75)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  <Hash className="w-4 h-4 text-slate-400 mr-2 shrink-0 pointer-events-none" />
                  <input
                    type="number"
                    step="any"
                    value={maxAmount}
                    onChange={(e) => {
                      setMaxAmount(e.target.value)
                      setAmountPreset(null)
                    }}
                    placeholder="Max USDC value"
                    aria-label="Maximum USDC value"
                    className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={handleResetAmountFilter}
                  className="ub-action-btn rounded-full px-4 py-1 text-xs font-semibold"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleApplyAmountFilter}
                  className="ub-action-btn ub-action-btn-primary rounded-full px-4 py-1 text-xs font-semibold"
                >
                  Filter
                </button>
              </div>
            </div>
          )}
        </th>

        {/* RECIPIENT Column Header with Filter Icon & Popover Modal */}
        <th scope="col" className="w-[17%] px-3 py-3.5 text-center relative filter-popover-container">
          <div className="flex items-center justify-center gap-1.5">
            <span>RECIPIENT</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowRecipientFilter((prev) => !prev)
                setShowNetworkFilter(false)
                setShowTypeFilter(false)
                setShowAmountFilter(false)
                setShowTimeFilter(false)
                setActivePickerTarget(null)
              }}
              className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                activeRecipientFilter
                  ? 'text-white bg-[rgba(152,150,255,0.25)] border border-[rgba(152,150,255,0.45)] shadow-sm'
                  : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06]'
              }`}
              title="Filter by Recipient Address"
              aria-label="Filter by Recipient Address"
              aria-haspopup="dialog"
              aria-expanded={showRecipientFilter}
              aria-controls="history-recipient-filter"
            >
              <Filter className="w-3 h-3" />
            </button>
          </div>

          {/* Recipient Filter Popover Modal */}
          {showRecipientFilter && (
            <div
              ref={recipientFilterRef}
              id="history-recipient-filter"
              role="dialog"
              aria-label="Recipient filter"
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-80 rounded-2xl p-4 shadow-2xl space-y-3.5 text-left font-sans normal-case tracking-normal backdrop-blur-2xl focus:outline-none"
              style={{
                background: 'rgba(15, 18, 32, 0.98)',
                border: '1px solid rgba(152, 150, 255, 0.25)',
                boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
                fontFamily: 'var(--font-app)',
              }}
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <span className="font-bold text-white text-sm">Recipient Address</span>
                <button
                  type="button"
                  onClick={() => setShowRecipientFilter(false)}
                  aria-label="Close recipient filter"
                  className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Input with Search icon */}
              <div
                className="relative flex items-center rounded-2xl px-3.5 py-2.5 transition-all"
                style={{
                  background: 'rgba(11, 13, 24, 0.75)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                <Search className="w-4 h-4 text-slate-400 mr-2 shrink-0 pointer-events-none" />
                <input
                  type="text"
                  value={recipientSearch}
                  onChange={(e) => setRecipientSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleApplyRecipientFilter()
                    }
                  }}
                  placeholder="Enter 0x... address"
                  aria-label="Recipient address"
                  className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                  autoFocus
                />
                {recipientSearch && (
                  <button
                    type="button"
                    onClick={() => setRecipientSearch('')}
                    aria-label="Clear recipient search"
                    className="text-slate-500 hover:text-white p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={handleResetRecipientFilter}
                  className="ub-action-btn rounded-full px-4 py-1 text-xs font-semibold"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleApplyRecipientFilter}
                  className="ub-action-btn ub-action-btn-primary rounded-full px-4 py-1 text-xs font-semibold"
                >
                  Filter
                </button>
              </div>
            </div>
          )}
        </th>

        {/* TIME / UTC TIME Column Header with Sort & Filter */}
        <th
          scope="col"
          aria-sort={getAriaSort('time', sortField, sortDirection)}
          className="w-[16%] px-3 py-3.5 text-center relative filter-popover-container select-none hover:bg-white/[0.04] transition-colors group/col"
        >
          <div className="flex items-center justify-center gap-1.5">
            <button
              type="button"
              onClick={() => onSort('time')}
              title="Sort by Time"
              aria-label={getSortButtonLabel('Time', 'time', sortField, sortDirection)}
              className="inline-flex items-center rounded-md cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--purple-1)]"
            >
              <SortableHeaderTitle
                field="time"
                currentField={sortField}
                direction={sortDirection}
                label="Time"
              >
                {timeFormat === 'utc' ? 'UTC TIME' : 'TIME'}
              </SortableHeaderTitle>
            </button>

            {/* Filter button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowTimeFilter((prev) => !prev)
                setShowNetworkFilter(false)
                setShowTypeFilter(false)
                setShowAmountFilter(false)
                setShowRecipientFilter(false)
                setActivePickerTarget(null)
              }}
              className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                activeTimeFilter
                  ? 'text-white bg-[rgba(152,150,255,0.25)] border border-[rgba(152,150,255,0.45)] shadow-sm'
                  : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06]'
              }`}
              title="Filter by Time"
              aria-label="Filter by Time"
              aria-haspopup="dialog"
              aria-expanded={showTimeFilter}
              aria-controls="history-time-filter"
            >
              <Filter className="w-3 h-3" />
            </button>
          </div>

          {/* Time Filter Popover Modal */}
          {showTimeFilter && (
            <div
              ref={timeFilterRef}
              id="history-time-filter"
              role="dialog"
              aria-label="Time filter"
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-full mt-2 z-50 w-80 rounded-2xl p-4 shadow-2xl space-y-3.5 text-left font-sans normal-case tracking-normal backdrop-blur-2xl focus:outline-none"
              style={{
                background: 'rgba(15, 18, 32, 0.98)',
                border: '1px solid rgba(152, 150, 255, 0.25)',
                boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
                fontFamily: 'var(--font-app)',
              }}
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-sm">Time</span>
                  <button
                    type="button"
                    onClick={() => setTimeFormat((prev) => (prev === 'relative' ? 'utc' : 'relative'))}
                    aria-label="Toggle time format"
                    className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium text-[var(--purple-1)] bg-[rgba(152,150,255,0.15)] hover:bg-[rgba(152,150,255,0.25)] border border-[rgba(152,150,255,0.3)] transition-colors cursor-pointer"
                  >
                    Format: {timeFormat === 'utc' ? 'UTC' : 'Relative'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTimeFilter(false)}
                  aria-label="Close time filter"
                  className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Presets */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {[
                  { id: '1h', label: 'Last 1H' },
                  { id: '24h', label: 'Last 24H' },
                  { id: '7d', label: 'Last 7D' },
                  { id: 'first1h', label: 'First 1H' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleTimePresetSelect(p.id)}
                    aria-pressed={timePreset === p.id}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                      timePreset === p.id
                        ? 'bg-[rgba(152,150,255,0.25)] text-white border border-[rgba(152,150,255,0.45)] shadow-sm'
                        : 'text-slate-400 hover:text-white bg-white/[0.04] border border-white/[0.06]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Inputs */}
              <div className="space-y-2 relative">
                {/* From Date Input Field & Picker */}
                <div className="relative">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Choose from date"
                    aria-expanded={activePickerTarget === 'from'}
                    onClick={() => setActivePickerTarget((prev) => (prev === 'from' ? null : 'from'))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setActivePickerTarget((prev) => (prev === 'from' ? null : 'from'))
                      }
                    }}
                    className={`flex items-center rounded-2xl px-3.5 py-2.5 cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--purple-1)] ${
                      activePickerTarget === 'from'
                        ? 'border border-[rgba(152,150,255,0.5)] shadow-md text-white'
                        : 'border border-white/10 hover:border-white/20'
                    }`}
                    style={{
                      background: 'rgba(11, 13, 24, 0.75)',
                    }}
                  >
                    <Calendar className="w-4 h-4 text-slate-400 mr-2 shrink-0 pointer-events-none" />
                    <span
                      className={`w-full text-xs font-mono select-none ${
                        fromDate ? 'text-white font-semibold' : 'text-slate-500'
                      }`}
                    >
                      {fromDate ? formatDisplayDate(fromDate) : 'From Date'}
                    </span>
                    {fromDate && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setFromDate('')
                        }}
                        aria-label="Clear from date"
                        className="text-slate-500 hover:text-white p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Custom Calendar Picker Popup for From Date */}
                  {activePickerTarget === 'from' && (
                    <div className="absolute left-0 top-full mt-2 z-[60] calendar-picker-popover">
                      <CustomCalendarPicker
                        initialDateStr={fromDate}
                        onApply={(isoStr) => {
                          setFromDate(isoStr)
                          setActivePickerTarget(null)
                        }}
                        onClear={() => {
                          setFromDate('')
                        }}
                        onClose={() => setActivePickerTarget(null)}
                      />
                    </div>
                  )}
                </div>

                {/* To Date Input Field & Picker */}
                <div className="relative">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Choose to date"
                    aria-expanded={activePickerTarget === 'to'}
                    onClick={() => setActivePickerTarget((prev) => (prev === 'to' ? null : 'to'))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setActivePickerTarget((prev) => (prev === 'to' ? null : 'to'))
                      }
                    }}
                    className={`flex items-center rounded-2xl px-3.5 py-2.5 cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--purple-1)] ${
                      activePickerTarget === 'to'
                        ? 'border border-[rgba(152,150,255,0.5)] shadow-md text-white'
                        : 'border border-white/10 hover:border-white/20'
                    }`}
                    style={{
                      background: 'rgba(11, 13, 24, 0.75)',
                    }}
                  >
                    <Calendar className="w-4 h-4 text-slate-400 mr-2 shrink-0 pointer-events-none" />
                    <span
                      className={`w-full text-xs font-mono select-none ${
                        toDate ? 'text-white font-semibold' : 'text-slate-500'
                      }`}
                    >
                      {toDate ? formatDisplayDate(toDate) : 'To Date'}
                    </span>
                    {toDate && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setToDate('')
                        }}
                        aria-label="Clear to date"
                        className="text-slate-500 hover:text-white p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Custom Calendar Picker Popup for To Date */}
                  {activePickerTarget === 'to' && (
                    <div className="absolute left-0 top-full mt-2 z-[60] calendar-picker-popover">
                      <CustomCalendarPicker
                        initialDateStr={toDate}
                        onApply={(isoStr) => {
                          setToDate(isoStr)
                          setActivePickerTarget(null)
                        }}
                        onClear={() => {
                          setToDate('')
                        }}
                        onClose={() => setActivePickerTarget(null)}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={handleResetTimeFilter}
                  className="ub-action-btn rounded-full px-4 py-1 text-xs font-semibold"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleApplyTimeFilter}
                  className="ub-action-btn ub-action-btn-primary rounded-full px-4 py-1 text-xs font-semibold"
                >
                  Filter
                </button>
              </div>
            </div>
          )}
        </th>
      </tr>
    </thead>
  )
}
