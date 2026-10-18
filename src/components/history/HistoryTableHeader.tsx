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
  Hash,
  Search,
  Calendar,
} from 'lucide-react'
import { Tooltip } from '../common/Tooltip'
import { CustomCalendarPicker } from './CustomCalendarPicker'

export type HistoryFilterType =
  | 'all'
  | 'send'
  | 'swap'
  | 'bridge'
  | 'deposit'
  | 'pool'
  | 'add_liquidity'
  | 'remove_liquidity'
  | 'harvest'
  | 'memo'

export interface HistoryTableHeaderProps {
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
}

export function HistoryTableHeader({
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
}: HistoryTableHeaderProps) {
  return (
    <thead>
      <tr
        className="border-b border-white/[0.08] text-xs font-semibold text-slate-400"
        style={{
          background: 'rgba(255, 255, 255, 0.02)',
          fontFamily: 'var(--font-app)',
        }}
      >
        <th className="w-1/5 px-4 py-3.5 text-center">
          <div className="flex items-center justify-center">
            <span>TX HASH</span>
          </div>
        </th>

        {/* TYPE Column Header with Filter Icon & Popover Modal */}
        <th className="w-1/5 px-4 py-3.5 text-center relative filter-popover-container">
          <div className="flex items-center justify-center gap-1.5">
            <span>TYPE</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowTypeFilter((prev) => !prev)
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
            >
              <Filter className="w-3 h-3" />
            </button>
          </div>

          {/* Type Filter Popover Modal */}
          {showTypeFilter && (
            <div
              className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-76 rounded-2xl p-4 shadow-2xl space-y-3 text-left font-sans normal-case tracking-normal backdrop-blur-2xl"
              style={{
                background: 'rgba(15, 18, 32, 0.98)',
                border: '1px solid rgba(152, 150, 255, 0.25)',
                boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
                fontFamily: 'var(--font-app)',
              }}
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <span className="font-bold text-white text-sm">Transaction Type</span>
                <button
                  type="button"
                  onClick={() => setShowTypeFilter(false)}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Options - Grid of buttons */}
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { id: 'all', label: 'All', icon: null },
                  { id: 'send', label: 'Send', icon: ArrowUpRight },
                  { id: 'swap', label: 'Swap', icon: ArrowRightLeft },
                  { id: 'bridge', label: 'Bridge', icon: Globe },
                  { id: 'deposit', label: 'Deposit', icon: ArrowDownToLine },
                  { id: 'pool', label: 'All Pools', icon: Layers },
                  { id: 'add_liquidity', label: 'Add Liquidity', icon: PlusCircle },
                  { id: 'remove_liquidity', label: 'Remove Liquidity', icon: MinusCircle },
                  { id: 'harvest', label: 'Harvest', icon: Coins },
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
                      className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                        isSelected
                          ? 'bg-[rgba(152,150,255,0.25)] text-white border border-[rgba(152,150,255,0.45)] shadow-sm'
                          : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]'
                      }`}
                    >
                      {Icon && <Icon className="w-3 h-3 shrink-0" />}
                      <span>{t.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </th>

        {/* AMOUNT Column Header with Filter Icon & Popover Modal */}
        <th className="w-1/5 px-4 py-3.5 text-center relative filter-popover-container">
          <div className="flex items-center justify-center gap-1.5">
            <span>AMOUNT</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowAmountFilter((prev) => !prev)
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
            >
              <Filter className="w-3 h-3" />
            </button>
          </div>

          {/* Amount Filter Popover Modal */}
          {showAmountFilter && (
            <div
              className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-80 rounded-2xl p-4 shadow-2xl space-y-3.5 text-left font-sans normal-case tracking-normal backdrop-blur-2xl"
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
                  className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

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
                    placeholder="Min Amount"
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
                    placeholder="Max Amount"
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
        <th className="w-1/5 px-4 py-3.5 text-center relative filter-popover-container">
          <div className="flex items-center justify-center gap-1.5">
            <span>RECIPIENT</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowRecipientFilter((prev) => !prev)
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
            >
              <Filter className="w-3 h-3" />
            </button>
          </div>

          {/* Recipient Filter Popover Modal */}
          {showRecipientFilter && (
            <div
              className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-80 rounded-2xl p-4 shadow-2xl space-y-3.5 text-left font-sans normal-case tracking-normal backdrop-blur-2xl"
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
                  className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none font-mono"
                  autoFocus
                />
                {recipientSearch && (
                  <button
                    type="button"
                    onClick={() => setRecipientSearch('')}
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

        {/* TIME / UTC TIME Column Header with Filter Icon & Popover Modal */}
        <th className="w-1/5 px-4 py-3.5 text-center relative filter-popover-container">
          <div className="flex items-center justify-center gap-1.5">
            <Tooltip content="Click to toggle between Relative Time and UTC Time" position="top">
              <button
                type="button"
                onClick={() => setTimeFormat((prev) => (prev === 'relative' ? 'utc' : 'relative'))}
                className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors cursor-pointer select-none"
              >
                <span className="font-bold">{timeFormat === 'utc' ? 'UTC TIME' : 'TIME'}</span>
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setShowTimeFilter((prev) => !prev)
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
            >
              <Filter className="w-3 h-3" />
            </button>
          </div>

          {/* Time Filter Popover Modal */}
          {showTimeFilter && (
            <div
              className="absolute right-0 top-full mt-2 z-50 w-80 rounded-2xl p-4 shadow-2xl space-y-3.5 text-left font-sans normal-case tracking-normal backdrop-blur-2xl"
              style={{
                background: 'rgba(15, 18, 32, 0.98)',
                border: '1px solid rgba(152, 150, 255, 0.25)',
                boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
                fontFamily: 'var(--font-app)',
              }}
            >
              <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
                <span className="font-bold text-white text-sm">Time</span>
                <button
                  type="button"
                  onClick={() => setShowTimeFilter(false)}
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
                    onClick={() => setActivePickerTarget((prev) => (prev === 'from' ? null : 'from'))}
                    className={`flex items-center rounded-2xl px-3.5 py-2.5 cursor-pointer transition-all ${
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
                    onClick={() => setActivePickerTarget((prev) => (prev === 'to' ? null : 'to'))}
                    className={`flex items-center rounded-2xl px-3.5 py-2.5 cursor-pointer transition-all ${
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
