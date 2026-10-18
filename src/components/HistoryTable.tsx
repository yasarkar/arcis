import { useState, useEffect, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { useClearOnWalletDisconnect } from '../hooks/useClearOnWalletDisconnect'
import { Clock, Search } from 'lucide-react'
import {
  getHistory,
  fetchHistory,
  isHistoryLoaded,
  type HistoryItem,
} from '../utils/history'
import { usePrivacy } from '../hooks/usePrivacy'
import { ReceiptModal } from './ReceiptModal'
import {
  HistoryTableHeader,
  HistoryTableRow,
  HistoryPagination,
  type HistoryFilterType,
  formatDisplayDate,
} from './history'

interface HistoryTableProps {
  walletAddress?: string
}

export default function HistoryTable({ walletAddress }: HistoryTableProps = {}) {
  const { address: wagmiAddress } = useAccount()
  const activeWalletAddress = (walletAddress !== undefined ? walletAddress : (wagmiAddress || '')).toLowerCase().trim()

  const { isPrivate: globalPrivate, settings } = usePrivacy()
  const [history, setHistory] = useState<HistoryItem[]>(() =>
    activeWalletAddress ? getHistory(activeWalletAddress) : []
  )
  const [isLoading, setIsLoading] = useState<boolean>(() =>
    Boolean(activeWalletAddress && !isHistoryLoaded(activeWalletAddress))
  )
  const [filter, setFilter] = useState<HistoryFilterType>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [hoveredRecipient, setHoveredRecipient] = useState<string | null>(null)
  const [timeFormat, setTimeFormat] = useState<'relative' | 'utc'>('relative')

  // Receipt Modal state
  const [selectedReceiptItem, setSelectedReceiptItem] = useState<HistoryItem | null>(null)
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false)

  // Type filter modal state
  const [showTypeFilter, setShowTypeFilter] = useState(false)

  // Time filter modal states
  const [showTimeFilter, setShowTimeFilter] = useState(false)
  const [timePreset, setTimePreset] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [activeTimeFilter, setActiveTimeFilter] = useState<{ from?: number; to?: number } | null>(null)
  const [activePickerTarget, setActivePickerTarget] = useState<'from' | 'to' | null>(null)

  // Amount filter modal states
  const [showAmountFilter, setShowAmountFilter] = useState(false)
  const [amountPreset, setAmountPreset] = useState<string | null>(null)
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [activeAmountFilter, setActiveAmountFilter] = useState<{ min?: number; max?: number } | null>(null)

  // Recipient filter modal states
  const [showRecipientFilter, setShowRecipientFilter] = useState(false)
  const [recipientSearch, setRecipientSearch] = useState('')
  const [activeRecipientFilter, setActiveRecipientFilter] = useState<string | null>(null)

  // Pagination state (Max 10 rows per page)
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  // Systematic input and state clearing on wallet disconnect
  const resetFormInputs = useCallback(() => {
    setSearchTerm('')
    setFromDate('')
    setToDate('')
    setMinAmount('')
    setMaxAmount('')
    setRecipientSearch('')
    setActiveTimeFilter(null)
    setActiveAmountFilter(null)
    setActiveRecipientFilter(null)
    setTimePreset(null)
    setAmountPreset(null)
    setShowTimeFilter(false)
    setShowAmountFilter(false)
    setShowTypeFilter(false)
    setShowRecipientFilter(false)
  }, [])

  useClearOnWalletDisconnect(resetFormInputs)

  useEffect(() => {
    if (!activeWalletAddress) {
      resetFormInputs()
    }
  }, [activeWalletAddress, resetFormInputs])

  // Reset to page 1 whenever any filter or search term changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, filter, activeAmountFilter, activeTimeFilter, activeRecipientFilter])

  // Load transactions strictly filtered by active wallet
  useEffect(() => {
    let isMounted = true

    if (!activeWalletAddress) {
      setHistory([])
      setIsLoading(false)
      return
    }

    // Immediate in-memory render strictly for active wallet
    setHistory(getHistory(activeWalletAddress))
    setIsLoading(!isHistoryLoaded(activeWalletAddress))

    // Asynchronous network fetch
    fetchHistory(activeWalletAddress)
      .then((data) => {
        if (isMounted) {
          setHistory(data)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        console.warn('[HistoryTable] Error fetching server transactions:', err)
        if (isMounted) {
          setIsLoading(false)
        }
      })

    const handleUpdate = () => {
      if (isMounted && activeWalletAddress) {
        setHistory(getHistory(activeWalletAddress))
      }
    }

    window.addEventListener('arcis_history_updated', handleUpdate)
    return () => {
      isMounted = false
      window.removeEventListener('arcis_history_updated', handleUpdate)
    }
  }, [activeWalletAddress])

  // Close filter popovers on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.filter-popover-container') && !target.closest('.calendar-picker-popover')) {
        setShowTimeFilter(false)
        setShowAmountFilter(false)
        setShowTypeFilter(false)
        setShowRecipientFilter(false)
        setActivePickerTarget(null)
      }
    }
    window.addEventListener('click', handleOutsideClick)
    return () => window.removeEventListener('click', handleOutsideClick)
  }, [])

  const handleCopy = (txHash: string, itemId: string) => {
    navigator.clipboard.writeText(txHash)
    setCopiedId(itemId)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Preset Handlers
  const handleTimePresetSelect = (presetId: string) => {
    setTimePreset(presetId)
    const now = Date.now()
    let fromTs = 0
    let toTs = now

    if (presetId === '1h') {
      fromTs = now - 3600 * 1000
    } else if (presetId === '24h') {
      fromTs = now - 24 * 3600 * 1000
    } else if (presetId === '7d') {
      fromTs = now - 7 * 24 * 3600 * 1000
    } else if (presetId === 'first1h') {
      if (history.length > 0) {
        const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp)
        fromTs = sorted[0].timestamp
        toTs = fromTs + 3600 * 1000
      } else {
        fromTs = now - 3600 * 1000
      }
    }

    const formatToDatetimeLocal = (ts: number) => {
      const d = new Date(ts)
      const pad = (n: number) => n.toString().padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    setFromDate(formatToDatetimeLocal(fromTs))
    setToDate(formatToDatetimeLocal(toTs))
  }

  const handleApplyTimeFilter = () => {
    const fromTs = fromDate ? new Date(fromDate).getTime() : undefined
    const toTs = toDate ? new Date(toDate).getTime() : undefined
    if (fromTs || toTs) {
      setActiveTimeFilter({ from: fromTs, to: toTs })
    } else {
      setActiveTimeFilter(null)
    }
    setShowTimeFilter(false)
  }

  const handleResetTimeFilter = () => {
    setFromDate('')
    setToDate('')
    setTimePreset(null)
    setActiveTimeFilter(null)
    setShowTimeFilter(false)
  }

  const handleAmountPresetSelect = (presetId: string) => {
    setAmountPreset(presetId)
    if (presetId === '<10') {
      setMinAmount('')
      setMaxAmount('10')
    } else if (presetId === '10-100') {
      setMinAmount('10')
      setMaxAmount('100')
    } else if (presetId === '100-1000') {
      setMinAmount('100')
      setMaxAmount('1000')
    } else if (presetId === '>1000') {
      setMinAmount('1000')
      setMaxAmount('')
    }
  }

  const handleApplyAmountFilter = () => {
    const minVal = minAmount !== '' ? parseFloat(minAmount) : undefined
    const maxVal = maxAmount !== '' ? parseFloat(maxAmount) : undefined
    if ((minVal !== undefined && !isNaN(minVal)) || (maxVal !== undefined && !isNaN(maxVal))) {
      setActiveAmountFilter({ min: minVal, max: maxVal })
    } else {
      setActiveAmountFilter(null)
    }
    setShowAmountFilter(false)
  }

  const handleResetAmountFilter = () => {
    setMinAmount('')
    setMaxAmount('')
    setAmountPreset(null)
    setActiveAmountFilter(null)
    setShowAmountFilter(false)
  }

  const handleApplyRecipientFilter = () => {
    if (recipientSearch.trim()) {
      setActiveRecipientFilter(recipientSearch.trim())
    } else {
      setActiveRecipientFilter(null)
    }
    setShowRecipientFilter(false)
  }

  const handleResetRecipientFilter = () => {
    setRecipientSearch('')
    setActiveRecipientFilter(null)
    setShowRecipientFilter(false)
  }

  const filteredHistory = history.filter((item) => {
    // Strict isolation guard: only show records belonging to the currently active wallet
    if (!activeWalletAddress) return false
    const normActive = activeWalletAddress.toLowerCase().trim()
    const isSender = item.userAddress && item.userAddress.toLowerCase().trim() === normActive
    const isRecipient = item.recipient && item.recipient.toLowerCase().trim() === normActive
    if (!isSender && !isRecipient) return false

    if (filter === 'memo') {
      if (!item.memo) return false
    } else if (filter === 'pool') {
      if (item.type !== 'add_liquidity' && item.type !== 'remove_liquidity' && item.type !== 'harvest') return false
    } else if (filter !== 'all' && item.type !== filter) {
      return false
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      const matchesHash =
        item.txHash.toLowerCase().includes(term) ||
        Boolean(item.destTxHash && item.destTxHash.toLowerCase().includes(term))
      const matchesRecipient = item.recipient?.toLowerCase().includes(term)
      const matchesMemo = item.memo?.toLowerCase().includes(term)
      const matchesMemoId = item.memoId?.toLowerCase().includes(term)
      const matchesPool = item.poolName?.toLowerCase().includes(term)
      if (!matchesHash && !matchesRecipient && !matchesMemo && !matchesMemoId && !matchesPool) return false
    }

    if (activeTimeFilter) {
      if (activeTimeFilter.from && item.timestamp < activeTimeFilter.from) return false
      if (activeTimeFilter.to && item.timestamp > activeTimeFilter.to) return false
    }

    if (activeAmountFilter) {
      const itemAmt = parseFloat(item.amount || item.amountIn || '0')
      if (activeAmountFilter.min !== undefined && !isNaN(activeAmountFilter.min) && itemAmt < activeAmountFilter.min) return false
      if (activeAmountFilter.max !== undefined && !isNaN(activeAmountFilter.max) && itemAmt > activeAmountFilter.max) return false
    }

    if (activeRecipientFilter) {
      const rFilter = activeRecipientFilter.toLowerCase()
      const matchesRecipient = item.recipient?.toLowerCase().includes(rFilter)
      const matchesDestChain = item.destChain?.toLowerCase().includes(rFilter)
      if (!matchesRecipient && !matchesDestChain) return false
    }

    return true
  })

  // Pagination calculation (Max 10 rows per page)
  const totalPages = Math.ceil(filteredHistory.length / pageSize) || 1
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, filteredHistory.length)
  const paginatedHistory = filteredHistory.slice(startIndex, startIndex + pageSize)

  return (
    <div
      className="w-full max-w-6xl mx-auto ub-asset-card arc-animate-reveal relative overflow-hidden"
      style={{
        padding: '32px 36px',
        borderRadius: '28px',
        boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.08), 0 24px 64px -12px rgba(0, 0, 0, 0.6)',
      }}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              color: 'var(--purple-1)',
            }}
          >
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <span className="arc-eyebrow" style={{ fontSize: 16, color: '#ffffff', fontWeight: 600, letterSpacing: '2px' }}>
              TRANSACTION HISTORY
            </span>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative w-full flex items-center">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none z-10" />
          <input
            type="text"
            placeholder="Search by Tx Hash, Recipient Address, or Memo / Reference ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-3 rounded-2xl text-xs text-white placeholder-slate-500 focus:outline-none transition-all font-mono"
            style={{
              background: 'rgba(11, 13, 24, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          />
        </div>
      </div>

      {/* Table Content */}
      <div
        className="rounded-2xl overflow-hidden min-h-[300px]"
        style={{
          background: 'rgba(11, 13, 24, 0.65)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <div className="overflow-x-auto flex flex-col justify-between min-h-[300px]">
          <table className="w-full table-fixed text-center border-collapse">
            <HistoryTableHeader
              filter={filter}
              setFilter={setFilter}
              showTypeFilter={showTypeFilter}
              setShowTypeFilter={setShowTypeFilter}
              showAmountFilter={showAmountFilter}
              setShowAmountFilter={setShowAmountFilter}
              activeAmountFilter={activeAmountFilter}
              amountPreset={amountPreset}
              setAmountPreset={setAmountPreset}
              minAmount={minAmount}
              setMinAmount={setMinAmount}
              maxAmount={maxAmount}
              setMaxAmount={setMaxAmount}
              handleAmountPresetSelect={handleAmountPresetSelect}
              handleApplyAmountFilter={handleApplyAmountFilter}
              handleResetAmountFilter={handleResetAmountFilter}
              showRecipientFilter={showRecipientFilter}
              setShowRecipientFilter={setShowRecipientFilter}
              activeRecipientFilter={activeRecipientFilter}
              recipientSearch={recipientSearch}
              setRecipientSearch={setRecipientSearch}
              handleApplyRecipientFilter={handleApplyRecipientFilter}
              handleResetRecipientFilter={handleResetRecipientFilter}
              timeFormat={timeFormat}
              setTimeFormat={setTimeFormat}
              showTimeFilter={showTimeFilter}
              setShowTimeFilter={setShowTimeFilter}
              activeTimeFilter={activeTimeFilter}
              timePreset={timePreset}
              handleTimePresetSelect={handleTimePresetSelect}
              fromDate={fromDate}
              setFromDate={setFromDate}
              toDate={toDate}
              setToDate={setToDate}
              activePickerTarget={activePickerTarget}
              setActivePickerTarget={setActivePickerTarget}
              handleApplyTimeFilter={handleApplyTimeFilter}
              handleResetTimeFilter={handleResetTimeFilter}
              formatDisplayDate={formatDisplayDate}
            />

            <tbody className="divide-y divide-white/[0.04] text-xs">
              {/* Skeleton Loading Rows during initial fetch / prefetch resolution */}
              {isLoading && (
                <>
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <tr key={`history-skeleton-${idx}`} className="h-[52px] animate-pulse">
                      <td className="w-1/5 px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="h-4 w-28 bg-white/[0.08] rounded-md" />
                          <div className="h-4 w-4 bg-white/[0.04] rounded-md" />
                        </div>
                      </td>
                      <td className="w-1/5 px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2.5">
                          <div className="w-7 h-7 rounded-xl bg-white/[0.08]" />
                          <div className="h-4 w-12 bg-white/[0.08] rounded-md" />
                        </div>
                      </td>
                      <td className="w-1/5 px-4 py-3.5 text-center">
                        <div className="h-4 w-24 bg-white/[0.08] rounded-md mx-auto" />
                      </td>
                      <td className="w-1/5 px-4 py-3.5 text-center">
                        <div className="h-4 w-28 bg-white/[0.08] rounded-md mx-auto" />
                      </td>
                      <td className="w-1/5 px-4 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="w-3.5 h-3.5 rounded-full bg-white/[0.06]" />
                          <div className="h-4 w-16 bg-white/[0.08] rounded-md" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </>
              )}

              {/* Actual Transaction Rows */}
              {!isLoading &&
                paginatedHistory.map((item) => (
                  <HistoryTableRow
                    key={item.id}
                    item={item}
                    globalPrivate={globalPrivate}
                    settings={settings}
                    copiedId={copiedId}
                    handleCopy={handleCopy}
                    hoveredRecipient={hoveredRecipient}
                    setHoveredRecipient={setHoveredRecipient}
                    timeFormat={timeFormat}
                    onSelectReceipt={(selected) => {
                      setSelectedReceiptItem(selected)
                      setIsReceiptModalOpen(true)
                    }}
                  />
                ))}

              {/* Empty State when no transactions exist and not loading */}
              {!isLoading && filteredHistory.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-20 text-center">
                    <div className="flex flex-col items-center justify-center text-center p-6 min-h-[220px]">
                      <Clock className="w-10 h-10 text-slate-600 mb-3" />
                      <h4 className="text-sm font-semibold text-slate-300" style={{ fontFamily: 'var(--font-app)' }}>
                        NO TRANSACTIONS
                      </h4>
                      <p className="text-xs text-slate-500 max-w-sm mt-1" style={{ fontFamily: 'var(--font-app)' }}>
                        {!activeWalletAddress
                          ? 'Transactions initiated on this client (Send, Swap, or Cross-chain Bridge) will show up here. Connect your wallet to view your history.'
                          : history.length === 0
                          ? `No transactions recorded in database for ${activeWalletAddress.slice(0, 6)}...${activeWalletAddress.slice(-4)}. Transactions initiated with this wallet will appear here.`
                          : 'No transactions match the selected filters.'}
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {/* Fill empty placeholder rows if paginated items are less than 5 but greater than 0 */}
              {!isLoading &&
                paginatedHistory.length > 0 &&
                paginatedHistory.length < 5 &&
                Array.from({ length: 5 - paginatedHistory.length }).map((_, idx) => (
                  <tr key={`filler-${idx}`} className="h-[52px]">
                    <td colSpan={5} className="px-5 py-3.5">
                      &nbsp;
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>

          {/* Pagination Controls */}
          {!isLoading && (
            <HistoryPagination
              totalItems={filteredHistory.length}
              currentPage={currentPage}
              totalPages={totalPages}
              startIndex={startIndex}
              endIndex={endIndex}
              onPageChange={setCurrentPage}
            />
          )}
        </div>
      </div>

      {/* Interactive Digital Receipt & Invoice Modal */}
      <ReceiptModal
        isOpen={isReceiptModalOpen}
        onClose={() => {
          setIsReceiptModalOpen(false)
          setSelectedReceiptItem(null)
        }}
        item={selectedReceiptItem}
      />
    </div>
  )
}
