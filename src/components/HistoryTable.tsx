import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAccount } from 'wagmi'
import { useClearOnWalletDisconnect } from '../hooks/useClearOnWalletDisconnect'
import {
  Clock,
  Search,
  Activity,
  ArrowRightLeft,
  Globe,
  Bot,
  X,
  RotateCcw,
  Filter,
  RefreshCw,
  Download,
  ChevronDown,
  FileSpreadsheet,
  FileJson,
} from 'lucide-react'
import {
  getHistory,
  fetchHistoryResult,
  isHistoryLoaded,
  historyDisplayTxHash,
  ARCIS_HISTORY_UPDATED_EVENT,
  LEGACY_ARC_HISTORY_UPDATED_EVENT,
  type HistoryItem,
} from '../utils/history'
import { DEFAULT_TOKEN_PRICES } from '../services/tokenPriceService'
import { useLiveTokenPrices } from '../hooks/useLiveTokenPrices'
import { usePrivacy } from '../hooks/usePrivacy'
import { requestFullWalletConnect } from '../config/walletConfigStore'
import { ReceiptModal } from './ReceiptModal'
import { ChainIcon } from './common/ChainIcon'
import { getChainIconId } from '../config/chainMeta'
import {
  HistoryTableHeader,
  HistoryTableRow,
  HistoryPagination,
  type HistoryFilterType,
  type HistorySortField,
  type HistorySortDirection,
  formatDisplayDate,
  formatChain,
  getItemRawAmount,
  getItemUsdcValue,
  isDisplayableHistoryItem,
  getRelativeTime,
  readHistoryUrlState,
  writeHistoryUrlState,
  downloadHistory,
  HistoryCard,
  HistoryEmptyState,
  type HistoryExportFormat,
} from './history'

const TYPE_FILTER_LABELS: Record<HistoryFilterType, string> = {
  all: 'All Operations',
  send: 'Send',
  swap: 'Swap',
  bridge: 'Bridge',
  deposit: 'Gateway Deposit',
  ai_service: 'x402 AI Services',
  pool: 'All Pool Actions',
  add_liquidity: 'Add Liquidity',
  remove_liquidity: 'Remove Liquidity',
  harvest: 'Yield Harvest',
  memo: 'Memos',
}

/** Value for a `datetime-local` input at a given timestamp (local time, no seconds). */
const toDatetimeLocal = (timestamp: number) => {
  const date = new Date(timestamp)
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface HistoryTableProps {
  walletAddress?: string
}

export default function HistoryTable({ walletAddress }: HistoryTableProps = {}) {
  const { address: wagmiAddress } = useAccount()
  const activeWalletAddress = (walletAddress !== undefined ? walletAddress : (wagmiAddress || '')).toLowerCase().trim()

  const { isPrivate: globalPrivate, settings } = usePrivacy()

  // P1-1: filters are hydrated from the URL, so a reload, the back button or a
  // shared link restores the same view.
  const [initialUrlState] = useState(readHistoryUrlState)

  const [history, setHistory] = useState<HistoryItem[]>(() =>
    activeWalletAddress ? getHistory(activeWalletAddress) : []
  )
  const [isLoading, setIsLoading] = useState<boolean>(() =>
    Boolean(activeWalletAddress && !isHistoryLoaded(activeWalletAddress))
  )
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)
  const [filter, setFilter] = useState<HistoryFilterType>(initialUrlState.type)
  const [searchTerm, setSearchTerm] = useState(initialUrlState.q)
  // P1-6: without a debounce every keystroke re-filters the whole table.
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(initialUrlState.q)
  const [hoveredRecipient, setHoveredRecipient] = useState<string | null>(null)
  const [timeFormat, setTimeFormat] = useState<'relative' | 'utc'>('relative')

  // A failed server read must never masquerade as "no transactions".
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  // Live prices convert EURC / wETH / cirBTC rows into USDC-equivalent values for
  // the amount filter and amount sort. `DEFAULT_TOKEN_PRICES` covers the first paint.
  const { data: livePrices } = useLiveTokenPrices()
  const priceMap = livePrices || DEFAULT_TOKEN_PRICES

  // Receipt Modal state
  const [selectedReceiptItem, setSelectedReceiptItem] = useState<HistoryItem | null>(null)
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false)
  // P1-1: `?tx=<hash>` deep-links one transaction's receipt.
  const [deepLinkedTx, setDeepLinkedTx] = useState<string | null>(initialUrlState.tx)

  // Column Sorting state - unified atomic state for instant, two-directional toggle
  const [{ sortField, sortDirection }, setSortState] = useState<{
    sortField: HistorySortField
    sortDirection: HistorySortDirection
  }>({
    sortField: initialUrlState.sortField,
    sortDirection: initialUrlState.sortDirection,
  })

  const handleSort = useCallback((field: HistorySortField) => {
    setSortState((prev) => ({
      sortField: field,
      sortDirection:
        prev.sortField === field
          ? prev.sortDirection === 'desc'
            ? 'asc'
            : 'desc'
          : field === 'type' || field === 'network'
          ? 'asc'
          : 'desc',
    }))
  }, [])


  // Network filter modal state
  const [showNetworkFilter, setShowNetworkFilter] = useState(false)
  const [activeNetworkFilter, setActiveNetworkFilter] = useState<string>(initialUrlState.network)

  // Type filter modal state
  const [showTypeFilter, setShowTypeFilter] = useState(false)

  // Time filter modal states
  const [showTimeFilter, setShowTimeFilter] = useState(false)
  const [timePreset, setTimePreset] = useState<string | null>(null)
  const [fromDate, setFromDate] = useState(
    initialUrlState.from !== undefined ? toDatetimeLocal(initialUrlState.from) : ''
  )
  const [toDate, setToDate] = useState(
    initialUrlState.to !== undefined ? toDatetimeLocal(initialUrlState.to) : ''
  )
  const [activeTimeFilter, setActiveTimeFilter] = useState<{ from?: number; to?: number } | null>(
    initialUrlState.from !== undefined || initialUrlState.to !== undefined
      ? { from: initialUrlState.from, to: initialUrlState.to }
      : null
  )
  const [activePickerTarget, setActivePickerTarget] = useState<'from' | 'to' | null>(null)

  // Amount filter modal states
  const [showAmountFilter, setShowAmountFilter] = useState(false)
  const [amountPreset, setAmountPreset] = useState<string | null>(null)
  const [minAmount, setMinAmount] = useState(
    initialUrlState.min !== undefined ? String(initialUrlState.min) : ''
  )
  const [maxAmount, setMaxAmount] = useState(
    initialUrlState.max !== undefined ? String(initialUrlState.max) : ''
  )
  const [activeAmountFilter, setActiveAmountFilter] = useState<{ min?: number; max?: number } | null>(
    initialUrlState.min !== undefined || initialUrlState.max !== undefined
      ? { min: initialUrlState.min, max: initialUrlState.max }
      : null
  )

  // Recipient filter modal states
  const [showRecipientFilter, setShowRecipientFilter] = useState(false)
  const [recipientSearch, setRecipientSearch] = useState(initialUrlState.recipient)
  const [activeRecipientFilter, setActiveRecipientFilter] = useState<string | null>(
    initialUrlState.recipient || null
  )

  // Pagination state (10 rows per page by default, 10/25/50 selectable)
  const [currentPage, setCurrentPage] = useState(initialUrlState.page)
  const [pageSize, setPageSize] = useState(10)

  // Systematic input and state clearing on wallet disconnect
  const resetFormInputs = useCallback(() => {
    setSearchTerm('')
    setDebouncedSearchTerm('')
    setDeepLinkedTx(null)
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
    setShowNetworkFilter(false)
    setShowTimeFilter(false)
    setShowAmountFilter(false)
    setShowTypeFilter(false)
    setShowRecipientFilter(false)
    setActiveNetworkFilter('all')
    setSortState({ sortField: 'time', sortDirection: 'desc' })
    setCurrentPage(1)
  }, [])

  useClearOnWalletDisconnect(resetFormInputs)

  // Clear filters when a wallet DISCONNECTS, not on a first load without one:
  // wiping on mount would discard filters hydrated from a shared URL before the
  // visitor has connected.
  const hadWalletRef = useRef(false)
  useEffect(() => {
    if (activeWalletAddress) {
      hadWalletRef.current = true
      return
    }
    if (hadWalletRef.current) {
      hadWalletRef.current = false
      resetFormInputs()
    }
  }, [activeWalletAddress, resetFormInputs])

  // ── URL state (P1-1) ─────────────────────────────────────────────────────────
  // `filtersRef` lets popstate distinguish a filter change (which resets to page 1)
  // from a page-only change (which must be restored exactly).
  const filtersRef = useRef({
    type: filter,
    network: activeNetworkFilter,
    q: debouncedSearchTerm,
    from: activeTimeFilter?.from,
    to: activeTimeFilter?.to,
    min: activeAmountFilter?.min,
    max: activeAmountFilter?.max,
    recipient: activeRecipientFilter || '',
    sortField,
    sortDirection,
  })
  filtersRef.current = {
    type: filter,
    network: activeNetworkFilter,
    q: debouncedSearchTerm,
    from: activeTimeFilter?.from,
    to: activeTimeFilter?.to,
    min: activeAmountFilter?.min,
    max: activeAmountFilter?.max,
    recipient: activeRecipientFilter || '',
    sortField,
    sortDirection,
  }
  const pendingRestorePageRef = useRef<number | null>(null)

  // Back/forward must rebuild the filter set, not just the page number.
  useEffect(() => {
    const applyUrlState = () => {
      const next = readHistoryUrlState()
      const prev = filtersRef.current
      const filtersChanged =
        next.type !== prev.type ||
        next.network !== prev.network ||
        next.q !== prev.q ||
        next.from !== prev.from ||
        next.to !== prev.to ||
        next.min !== prev.min ||
        next.max !== prev.max ||
        next.recipient !== prev.recipient ||
        next.sortField !== prev.sortField ||
        next.sortDirection !== prev.sortDirection

      if (filtersChanged) pendingRestorePageRef.current = next.page
      else setCurrentPage(next.page)

      setFilter(next.type)
      setActiveNetworkFilter(next.network)
      setSearchTerm(next.q)
      setDebouncedSearchTerm(next.q)
      setActiveTimeFilter(
        next.from !== undefined || next.to !== undefined ? { from: next.from, to: next.to } : null
      )
      setFromDate(next.from !== undefined ? toDatetimeLocal(next.from) : '')
      setToDate(next.to !== undefined ? toDatetimeLocal(next.to) : '')
      setTimePreset(null)
      setActiveAmountFilter(
        next.min !== undefined || next.max !== undefined ? { min: next.min, max: next.max } : null
      )
      setMinAmount(next.min !== undefined ? String(next.min) : '')
      setMaxAmount(next.max !== undefined ? String(next.max) : '')
      setAmountPreset(null)
      setActiveRecipientFilter(next.recipient || null)
      setRecipientSearch(next.recipient)
      setSortState({ sortField: next.sortField, sortDirection: next.sortDirection })
      if (next.tx) setDeepLinkedTx(next.tx)
    }

    window.addEventListener('popstate', applyUrlState)
    return () => window.removeEventListener('popstate', applyUrlState)
  }, [])

  // Mirror the filter set into the URL (replaceState; no history spam).
  useEffect(() => {
    const timer = setTimeout(() => {
      writeHistoryUrlState({
        type: filter,
        network: activeNetworkFilter,
        q: debouncedSearchTerm,
        from: activeTimeFilter?.from,
        to: activeTimeFilter?.to,
        min: activeAmountFilter?.min,
        max: activeAmountFilter?.max,
        recipient: activeRecipientFilter || '',
        sortField,
        sortDirection,
        page: currentPage,
        tx: deepLinkedTx,
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [
    filter,
    activeNetworkFilter,
    debouncedSearchTerm,
    activeTimeFilter,
    activeAmountFilter,
    activeRecipientFilter,
    sortField,
    sortDirection,
    currentPage,
    deepLinkedTx,
  ])

  // P1-6: debounce the search box before re-filtering.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 200)
    return () => clearTimeout(timer)
  }, [searchTerm])

  // Reset to page 1 whenever a filter or the sort order changes — except when the
  // change came from popstate, where the URL's page must win.
  useEffect(() => {
    if (pendingRestorePageRef.current !== null) {
      const page = pendingRestorePageRef.current
      pendingRestorePageRef.current = null
      setCurrentPage(page)
      return
    }
    setCurrentPage(1)
  }, [debouncedSearchTerm, filter, activeAmountFilter, activeTimeFilter, activeRecipientFilter, sortField, sortDirection])

  // ── Freshness (P1-2) ─────────────────────────────────────────────────────────
  // "Just now" must age on its own; re-render once a minute while relative time is shown.
  const [, setClockTick] = useState(0)
  useEffect(() => {
    if (timeFormat !== 'relative') return
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      setClockTick((tick) => tick + 1)
    }, 60_000)
    return () => clearInterval(interval)
  }, [timeFormat])

  // Coming back to the tab silently revalidates, so an old list is not mistaken for current.
  useEffect(() => {
    if (!activeWalletAddress) return
    const revalidate = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      setIsRefreshing(true)
      setReloadToken((token) => token + 1)
    }
    window.addEventListener('focus', revalidate)
    document.addEventListener('visibilitychange', revalidate)
    return () => {
      window.removeEventListener('focus', revalidate)
      document.removeEventListener('visibilitychange', revalidate)
    }
  }, [activeWalletAddress])

  // `?tx=` deep link: open that transaction's receipt once the row is available.
  useEffect(() => {
    if (!deepLinkedTx || isReceiptModalOpen) return
    const target = deepLinkedTx.toLowerCase()
    const match = history.find(
      (item) =>
        item.id === deepLinkedTx ||
        item.txHash?.toLowerCase() === target ||
        item.destTxHash?.toLowerCase() === target
    )
    if (match) {
      setSelectedReceiptItem(match)
      setIsReceiptModalOpen(true)
    }
  }, [deepLinkedTx, history, isReceiptModalOpen])

  // Load transactions strictly filtered by active wallet
  useEffect(() => {
    let isMounted = true

    if (!activeWalletAddress) {
      setHistory([])
      setIsLoading(false)
      setIsRefreshing(false)
      setLastSyncedAt(null)
      return
    }

    // Immediate in-memory render strictly for active wallet
    setHistory(getHistory(activeWalletAddress))
    setIsLoading(!isHistoryLoaded(activeWalletAddress))
    setFetchError(null)

    // Asynchronous network fetch: every cursor page, not just the first one.
    fetchHistoryResult(activeWalletAddress)
      .then((result) => {
        if (!isMounted) return
        setHistory(result.items)
        setIsLoading(false)
        setIsRefreshing(false)
        setFetchError(result.ok ? null : result.error || 'History could not be loaded.')
        if (result.ok) setLastSyncedAt(Date.now())
      })
      .catch((err) => {
        console.warn('[HistoryTable] Error fetching server transactions:', err)
        if (isMounted) {
          setIsLoading(false)
          setIsRefreshing(false)
          setFetchError('History could not be loaded.')
        }
      })

    const handleUpdate = (e?: Event) => {
      if (!isMounted || !activeWalletAddress) return
      const targetUser = (e as CustomEvent<{ userAddress?: string }>)?.detail?.userAddress
      if (targetUser && targetUser.toLowerCase().trim() !== activeWalletAddress) {
        return
      }
      setHistory(getHistory(activeWalletAddress))
    }

    window.addEventListener(ARCIS_HISTORY_UPDATED_EVENT, handleUpdate)
    window.addEventListener(LEGACY_ARC_HISTORY_UPDATED_EVENT, handleUpdate)
    return () => {
      isMounted = false
      window.removeEventListener(ARCIS_HISTORY_UPDATED_EVENT, handleUpdate)
      window.removeEventListener(LEGACY_ARC_HISTORY_UPDATED_EVENT, handleUpdate)
    }
  }, [activeWalletAddress, reloadToken])

  const handleRetryFetch = useCallback(() => {
    if (!activeWalletAddress) return
    setFetchError(null)
    setIsLoading(!isHistoryLoaded(activeWalletAddress))
    setIsRefreshing(true)
    setReloadToken((token) => token + 1)
  }, [activeWalletAddress])

  // P1-2: a manual refresh keeps the current rows visible (no skeleton) and spins the icon.
  const handleRefresh = useCallback(() => {
    if (!activeWalletAddress) return
    setIsRefreshing(true)
    setReloadToken((token) => token + 1)
  }, [activeWalletAddress])

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size)
    setCurrentPage(1)
  }, [])

  // P1-1: opening a receipt makes it shareable (`?tx=`); closing clears the deep link.
  const openReceipt = useCallback((item: HistoryItem) => {
    setSelectedReceiptItem(item)
    setIsReceiptModalOpen(true)
    setDeepLinkedTx(historyDisplayTxHash(item))
  }, [])

  // Close filter popovers on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        !target.closest('.filter-popover-container') &&
        !target.closest('.calendar-picker-popover')
      ) {
        setShowNetworkFilter(false)
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

    setFromDate(toDatetimeLocal(fromTs))
    setToDate(toDatetimeLocal(toTs))
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

  const handleClearAllFilters = useCallback(() => {
    setSearchTerm('')
    setFilter('all')
    setActiveNetworkFilter('all')
    handleResetAmountFilter()
    handleResetTimeFilter()
    handleResetRecipientFilter()
  }, [])

  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
    filter !== 'all' ||
    activeNetworkFilter !== 'all' ||
    activeAmountFilter ||
    activeTimeFilter ||
    activeRecipientFilter
  )

  const amountLabel = useMemo(() => {
    if (!activeAmountFilter) return null
    const { min, max } = activeAmountFilter
    if (min !== undefined && max !== undefined) {
      return `${min} - ${max} USDC`
    }
    if (min !== undefined) {
      return `≥ ${min} USDC`
    }
    if (max !== undefined) {
      return `≤ ${max} USDC`
    }
    return null
  }, [activeAmountFilter])

  const timeLabel = useMemo(() => {
    if (!activeTimeFilter) return null
    if (timePreset === '1h') return 'Last 1 Hour'
    if (timePreset === '24h') return 'Last 24 Hours'
    if (timePreset === '7d') return 'Last 7 Days'
    if (timePreset === 'first1h') return 'First 1 Hour'

    const { from, to } = activeTimeFilter
    if (from && to) {
      const fromStr = new Date(from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      const toStr = new Date(to).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      return `${fromStr} - ${toStr}`
    }
    if (from) {
      return `From ${new Date(from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    }
    if (to) {
      return `Until ${new Date(to).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    }
    return 'Custom Range'
  }, [activeTimeFilter, timePreset])

  // Records this view can ever show (the active wallet's settled transactions).
  // Kept apart from `filteredHistory` so the empty state can tell "this wallet has
  // no completed activity" apart from "the filters matched nothing".
  const settledHistoryCount = useMemo(
    () => history.filter((item) => isDisplayableHistoryItem(item, activeWalletAddress)).length,
    [history, activeWalletAddress]
  )

  const filteredHistory = useMemo(() => {
    return history.filter((item) => {
      // Only the active wallet's settled transactions belong in the table. Pending
      // and failed rows are stored and returned truthfully (they are no longer
      // relabelled as success), but this view shows completed activity only.
      if (!isDisplayableHistoryItem(item, activeWalletAddress)) return false

      if (filter === 'memo') {
        if (!item.memo) return false
      } else if (filter === 'pool') {
        if (item.type !== 'add_liquidity' && item.type !== 'remove_liquidity' && item.type !== 'harvest') return false
      } else if (filter !== 'all' && item.type !== filter) {
        return false
      }

      if (activeNetworkFilter !== 'all') {
        const srcIcon = getChainIconId(item.sourceChain || 'Arc_Testnet')
        const dstIcon = item.destChain ? getChainIconId(item.destChain) : null
        const srcRaw = (item.sourceChain || 'Arc_Testnet').toLowerCase()
        const dstRaw = (item.destChain || '').toLowerCase()
        const filterLower = activeNetworkFilter.toLowerCase()

        const matchesSrc =
          srcIcon === filterLower ||
          srcRaw.includes(filterLower) ||
          (filterLower === 'arc' && srcRaw.includes('arc'))
        const matchesDst =
          dstIcon === filterLower ||
          dstRaw.includes(filterLower) ||
          (filterLower === 'arc' && dstRaw.includes('arc'))

        if (!matchesSrc && !matchesDst) return false
      }

      if (debouncedSearchTerm) {
        const term = debouncedSearchTerm.toLowerCase().trim()
        // P1-6: hashes, addresses, memos and pool names were searchable; token
        // symbols, chain names, service names and the operation itself were not.
        const matchesHash =
          item.txHash.toLowerCase().includes(term) ||
          Boolean(item.destTxHash && item.destTxHash.toLowerCase().includes(term))
        const matchesRecipient = Boolean(item.recipient?.toLowerCase().includes(term))
        const matchesMemo = Boolean(item.memo?.toLowerCase().includes(term))
        const matchesMemoId = Boolean(item.memoId?.toLowerCase().includes(term))
        const matchesPool = Boolean(item.poolName?.toLowerCase().includes(term))
        const matchesService = Boolean(item.serviceName?.toLowerCase().includes(term))
        const matchesType = item.type.toLowerCase().includes(term)
        const matchesToken = [item.tokenSymbol, item.tokenIn, item.tokenOut, item.tokenB].some(
          (symbol) => symbol && symbol.toLowerCase().includes(term)
        )
        const matchesChain = [item.sourceChain, item.destChain].some(
          (chain) => chain && (chain.toLowerCase().includes(term) || formatChain(chain).toLowerCase().includes(term))
        )
        if (
          !matchesHash &&
          !matchesRecipient &&
          !matchesMemo &&
          !matchesMemoId &&
          !matchesPool &&
          !matchesService &&
          !matchesType &&
          !matchesToken &&
          !matchesChain
        ) {
          return false
        }
      }

      if (activeTimeFilter) {
        if (activeTimeFilter.from && item.timestamp < activeTimeFilter.from) return false
        if (activeTimeFilter.to && item.timestamp > activeTimeFilter.to) return false
      }

      if (activeAmountFilter) {
        // Ranges are USDC-equivalent values: 0.5 wETH is ~$1.2k, not 0.5.
        const itemUsdc = getItemUsdcValue(item, priceMap)
        // A row whose asset has no price feed is never hidden by a value filter —
        // dropping it would look like the transaction disappeared.
        if (itemUsdc !== null) {
          if (activeAmountFilter.min !== undefined && !isNaN(activeAmountFilter.min) && itemUsdc < activeAmountFilter.min) return false
          if (activeAmountFilter.max !== undefined && !isNaN(activeAmountFilter.max) && itemUsdc > activeAmountFilter.max) return false
        }
      }

      if (activeRecipientFilter) {
        const rFilter = activeRecipientFilter.toLowerCase()
        const matchesRecipient = item.recipient?.toLowerCase().includes(rFilter)
        const matchesDestChain = item.destChain?.toLowerCase().includes(rFilter)
        if (!matchesRecipient && !matchesDestChain) return false
      }

      return true
    })
  }, [
    history,
    activeWalletAddress,
    filter,
    activeNetworkFilter,
    debouncedSearchTerm,
    activeTimeFilter,
    activeAmountFilter,
    activeRecipientFilter,
    priceMap,
  ])

  // Derived real KPI statistics from loaded wallet history (successful transactions only)
  const kpiStats = useMemo(() => {
    const successfulHistory = (history || []).filter((item) => (item.status ? item.status === 'success' : true))
    if (successfulHistory.length === 0) {
      return {
        totalTx: 0,
        volumeUsdc: 0,
        uniqueChainsCount: 0,
        chainNames: '',
        activeChains: [] as { id: string; name: string; rawKey: string }[],
        aiCallsCount: 0,
        aiSpentUsdc: 0,
      }
    }

    let volumeUsdc = 0
    let aiCallsCount = 0
    let aiSpentUsdc = 0

    // Rigorous network resolution & deduplication map
    const networksMap = new Map<string, { id: string; name: string; rawKey: string }>()

    const registerNetwork = (rawChain?: string) => {
      if (!rawChain || !rawChain.trim()) return
      const trimmed = rawChain.trim()
      if (trimmed.startsWith('0x') || trimmed.length > 35) return
      const iconId = getChainIconId(trimmed)
      const name = formatChain(trimmed)
      if (!networksMap.has(iconId)) {
        networksMap.set(iconId, { id: iconId, name, rawKey: trimmed })
      }
    }

    for (const item of successfulHistory) {
      registerNetwork(item.sourceChain || 'Arc_Testnet')
      if (item.destChain) registerNetwork(item.destChain)

      if (item.type === 'swap') {
        if (item.tokenIn === 'USDC' && item.amountIn) {
          const val = parseFloat(item.amountIn)
          if (!isNaN(val)) volumeUsdc += val
        } else if (item.tokenOut === 'USDC' && item.amountOut) {
          const val = parseFloat(item.amountOut)
          if (!isNaN(val)) volumeUsdc += val
        } else if ((item.tokenSymbol === 'USDC' || !item.tokenSymbol) && item.amount) {
          const val = parseFloat(item.amount)
          if (!isNaN(val)) volumeUsdc += val
        }
      } else if (item.type === 'ai_service') {
        const val = parseFloat(item.amount || '0')
        if (!isNaN(val)) volumeUsdc += val

        const isProviderClaim = Boolean(
          item.serviceName?.toLowerCase().includes('claim') ||
          item.serviceName?.toLowerCase().includes('settlement') ||
          item.serviceId === 'provider_claim'
        )

        if (!isProviderClaim) {
          aiCallsCount++
          if (!isNaN(val)) {
            aiSpentUsdc += val
          }
        }
      } else if (item.type === 'add_liquidity' || item.type === 'remove_liquidity' || item.type === 'harvest') {
        if (item.tokenSymbol === 'USDC' || !item.tokenSymbol) {
          const val = parseFloat(item.amount || '0')
          if (!isNaN(val)) volumeUsdc += val
        }
        if (item.tokenB === 'USDC' && item.amountB) {
          const valB = parseFloat(item.amountB)
          if (!isNaN(valB)) volumeUsdc += valB
        }
      } else {
        const val = parseFloat(item.amount || '0')
        if (!isNaN(val) && (item.tokenSymbol === 'USDC' || item.type === 'deposit')) {
          volumeUsdc += val
        }
      }
    }

    // Sort networks: Arc Testnet first, followed by alphabetical order
    const activeChains = Array.from(networksMap.values()).sort((a, b) => {
      if (a.id === 'arc') return -1
      if (b.id === 'arc') return 1
      return a.name.localeCompare(b.name)
    })

    const chainNamesList = activeChains.map((c) => c.name).slice(0, 2).join(', ')
    const chainNames = activeChains.length > 2
      ? `${chainNamesList} +${activeChains.length - 2}`
      : (chainNamesList || 'Arc Testnet')

    return {
      totalTx: successfulHistory.length,
      volumeUsdc,
      uniqueChainsCount: activeChains.length,
      chainNames,
      activeChains,
      aiCallsCount,
      aiSpentUsdc,
    }
  }, [history])

  // Responsive dynamic grid column sizing for KPI summary:
  // When active chains reach 6 or more, Card 3 incrementally borrows space from Cards 1, 2, and 4
  const chainCount = kpiStats.activeChains.length

  const kpiGridColumnsStyle = useMemo(() => {
    if (chainCount <= 5) return undefined

    let otherFr = 1
    let activeFr = 1

    if (chainCount === 6) {
      otherFr = 0.92
      activeFr = 1.24
    } else if (chainCount === 7) {
      otherFr = 0.87
      activeFr = 1.39
    } else if (chainCount === 8) {
      otherFr = 0.82
      activeFr = 1.54
    } else {
      otherFr = 0.78
      activeFr = 1.66
    }

    return {
      '--kpi-desktop-cols': `${otherFr}fr ${otherFr}fr ${activeFr}fr ${otherFr}fr`,
    } as React.CSSProperties
  }, [chainCount])

  const maxVisibleChains = Math.min(Math.max(4, chainCount), 8)

  // Available network options for filtering (defaults + any additional chains present in user history)
  const availableNetworks = useMemo(() => {
    const netMap = new Map<string, { id: string; name: string; rawKey: string }>()
    const defaultChains = [
      { id: 'arc', name: 'Arc Testnet', rawKey: 'Arc_Testnet' },
      { id: 'base', name: 'Base Sepolia', rawKey: 'Base_Sepolia' },
      { id: 'ethereum', name: 'Ethereum Sepolia', rawKey: 'Ethereum_Sepolia' },
      { id: 'avalanche', name: 'Avalanche Fuji', rawKey: 'Avalanche_Fuji' },
      { id: 'arbitrum', name: 'Arbitrum Sepolia', rawKey: 'Arbitrum_Sepolia' },
      { id: 'optimism', name: 'Optimism Sepolia', rawKey: 'Optimism_Sepolia' },
      { id: 'polygon', name: 'Polygon Amoy', rawKey: 'Polygon_Amoy' },
      { id: 'solana', name: 'Solana Devnet', rawKey: 'Solana_Devnet' },
    ]
    defaultChains.forEach((c) => netMap.set(c.id, c))
    kpiStats.activeChains.forEach((c) => {
      if (!netMap.has(c.id)) {
        netMap.set(c.id, c)
      }
    })
    return Array.from(netMap.values())
  }, [kpiStats.activeChains])

  const activeNetworkLabel = useMemo(() => {
    if (activeNetworkFilter === 'all') return null
    const found = availableNetworks.find((n) => n.id === activeNetworkFilter || n.rawKey === activeNetworkFilter)
    return found?.name || formatChain(activeNetworkFilter) || activeNetworkFilter
  }, [activeNetworkFilter, availableNetworks])

  // Amount sorting uses the same USDC-equivalent scale as the amount filter, so the
  // column and the filter can never disagree. Unpriced rows fall back to raw units.
  const getComparableAmount = useCallback(
    (item: HistoryItem): number => getItemUsdcValue(item, priceMap) ?? getItemRawAmount(item),
    [priceMap]
  )

  // Sort filtered history by selected column and direction
  const sortedHistory = useMemo(() => {
    const list = [...filteredHistory]
    list.sort((a, b) => {
      if (sortField === 'amount') {
        const amtA = getComparableAmount(a)
        const amtB = getComparableAmount(b)
        if (amtA !== amtB) {
          return sortDirection === 'asc' ? amtA - amtB : amtB - amtA
        }
      } else if (sortField === 'type') {
        const typeA = (a.type || '').toLowerCase()
        const typeB = (b.type || '').toLowerCase()
        const cmp = typeA.localeCompare(typeB)
        if (cmp !== 0) {
          return sortDirection === 'asc' ? cmp : -cmp
        }
      } else if (sortField === 'network') {
        const netA = (a.destChain || a.sourceChain || 'Arc_Testnet').toLowerCase()
        const netB = (b.destChain || b.sourceChain || 'Arc_Testnet').toLowerCase()
        const cmp = netA.localeCompare(netB)
        if (cmp !== 0) {
          return sortDirection === 'asc' ? cmp : -cmp
        }
      }
      // Primary/Fallback: timestamp
      const tsA = a.timestamp || 0
      const tsB = b.timestamp || 0
      return sortDirection === 'asc' ? tsA - tsB : tsB - tsA
    })
    return list
  }, [filteredHistory, sortField, sortDirection, getComparableAmount])

  // Pagination calculation (Max 10 rows per page)
  const totalPages = Math.ceil(sortedHistory.length / pageSize) || 1
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = Math.min(startIndex + pageSize, sortedHistory.length)
  const paginatedHistory = sortedHistory.slice(startIndex, startIndex + pageSize)

  // P1-5: the export always matches the screen — filtered, sorted, and masked
  // whenever privacy mode is on.
  // A shared link (?page=9) may point past the last page after the data changed.
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages)
  }, [currentPage, totalPages])

  const [isExportOpen, setIsExportOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportOpen(false)
      }
    }
    if (isExportOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isExportOpen])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isExportOpen) {
        setIsExportOpen(false)
      }
    }
    if (isExportOpen) {
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isExportOpen])

  useEffect(() => {
    if (sortedHistory.length === 0 && isExportOpen) {
      setIsExportOpen(false)
    }
  }, [sortedHistory.length, isExportOpen])

  const handleExport = useCallback(
    (format: HistoryExportFormat) => {
      downloadHistory(
        sortedHistory,
        { masked: globalPrivate, maskSymbol: settings.maskSymbol },
        format,
        activeWalletAddress
      )
    },
    [sortedHistory, globalPrivate, settings.maskSymbol, activeWalletAddress]
  )

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

        <div className="flex flex-wrap items-center gap-2">
          {lastSyncedAt !== null && (
            <span
              className="hidden md:inline text-[10px] font-mono uppercase tracking-[1.5px] text-slate-500 mr-1"
              style={{ fontFamily: 'var(--fonts--space-mono, monospace)' }}
            >
              Updated {getRelativeTime(lastSyncedAt)}
            </span>
          )}

          <button
            type="button"
            onClick={handleRefresh}
            disabled={!activeWalletAddress}
            aria-label="Refresh transaction history"
            className="ub-action-btn inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {/* Export Dropdown */}
          <div className="relative inline-block" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => setIsExportOpen((prev) => !prev)}
              disabled={sortedHistory.length === 0}
              aria-label="Export transaction history"
              aria-haspopup="menu"
              aria-expanded={isExportOpen}
              className="ub-action-btn inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-mono uppercase tracking-[1px] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-400" />
              <span>Export</span>
              <ChevronDown
                className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${
                  isExportOpen ? 'rotate-180 text-[var(--purple-1)]' : ''
                }`}
              />
            </button>

            {isExportOpen && (
              <div
                role="menu"
                aria-label="Export options"
                className="absolute right-0 top-full mt-1.5 z-50 min-w-[120px] rounded-xl p-1.5 shadow-2xl backdrop-blur-2xl border border-white/10 animate-fade-in"
                style={{
                  background: 'rgba(12, 15, 26, 0.96)',
                  boxShadow: '0 12px 32px -4px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08)',
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    handleExport('csv')
                    setIsExportOpen(false)
                  }}
                  className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-left text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                    <span className="font-mono text-[11px] font-medium tracking-wide">CSV</span>
                  </div>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    handleExport('json')
                    setIsExportOpen(false)
                  }}
                  className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-left text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    <FileJson className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                    <span className="font-mono text-[11px] font-medium tracking-wide">JSON</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4-Card Mini KPI Summary Bar */}
      <div
        className="grid grid-cols-2 history-kpi-grid gap-3.5 mb-6 transition-all duration-500 ease-out"
        style={kpiGridColumnsStyle}
      >
        {/* Card 1: Total Activity */}
        <div
          className="relative overflow-hidden p-4 rounded-2xl border border-white/[0.08] hover:border-white/20 transition-all duration-300 group"
          style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(15, 17, 26, 0.75) 100%)',
            boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.35)',
          }}
        >
          <div className="absolute top-0 left-0 right-0 h-[1px] rounded-t-2xl bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:via-[var(--purple-1)]/40 transition-all duration-500" />
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-[1.5px] text-white/50 block truncate group-hover:text-white/70 transition-colors"
              style={{ fontFamily: 'var(--fonts--space-mono, monospace)' }}
            >
              TOTAL ACTIVITY
            </span>
            <Activity className="w-4 h-4 text-indigo-300 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity" />
          </div>
          <div
            className="text-xl sm:text-2xl font-bold text-white tabular-nums tracking-tight truncate mt-1.5 flex items-baseline gap-1"
            style={{ fontFamily: 'var(--fonts--space-grotesk, sans-serif)' }}
          >
            <span>{kpiStats.totalTx}</span>
            <span className="text-xs font-normal text-slate-400">Tx</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            Settled on-chain transactions
          </div>
        </div>

        {/* Card 2: Cumulative Volume */}
        <div
          className="relative p-4 rounded-2xl border border-white/[0.08] hover:border-white/20 transition-all duration-300 group overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(15, 17, 26, 0.75) 100%)',
            boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.35)',
          }}
        >
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:via-[var(--purple-1)]/40 transition-all duration-500" />
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-[1.5px] text-white/50 block truncate group-hover:text-white/70 transition-colors"
              style={{ fontFamily: 'var(--fonts--space-mono, monospace)' }}
            >
              USDC VOLUME
            </span>
            <ArrowRightLeft className="w-4 h-4 text-indigo-300 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity" />
          </div>
          <div
            className="text-xl sm:text-2xl font-bold text-white tabular-nums tracking-tight truncate mt-1.5 flex items-baseline gap-1"
            style={{ fontFamily: 'var(--fonts--space-grotesk, sans-serif)' }}
          >
            <span>
              {kpiStats.volumeUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs font-normal text-slate-400">USDC</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            Transfers, bridge, swap & pool
          </div>
        </div>

        {/* Card 3: Active Networks */}
        <div
          className="relative p-4 rounded-2xl border border-white/[0.08] hover:border-white/20 transition-all duration-300 group overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(15, 17, 26, 0.75) 100%)',
            boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.35)',
          }}
        >
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:via-[var(--purple-1)]/40 transition-all duration-500" />
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-[1.5px] text-white/50 block truncate group-hover:text-white/70 transition-colors"
              style={{ fontFamily: 'var(--fonts--space-mono, monospace)' }}
            >
              ACTIVE NETWORKS
            </span>
            <Globe className="w-4 h-4 text-indigo-300 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 min-h-[32px]">
            <div
              className="text-xl sm:text-2xl font-bold text-white tabular-nums tracking-tight flex items-baseline gap-1 shrink-0"
              style={{ fontFamily: 'var(--fonts--space-grotesk, sans-serif)' }}
            >
              <span>{kpiStats.uniqueChainsCount}</span>
              <span className="text-xs font-normal text-slate-400">
                {kpiStats.uniqueChainsCount === 1 ? 'Chain' : 'Chains'}
              </span>
            </div>

            {/* Dynamic Overlapping Chain Icons */}
            {kpiStats.activeChains.length > 0 && (
              <div className="flex items-center -space-x-1.5 group-hover:space-x-1.5 transition-all duration-500 ease-out">
                {kpiStats.activeChains.slice(0, maxVisibleChains).map((chain, index) => (
                  <div
                    key={chain.id}
                    className="relative transition-all duration-300 ease-out rounded-full ring-2 ring-[#0c0e18] shadow-[0_4px_12px_rgba(0,0,0,0.45)] hover:scale-125 hover:z-30 cursor-pointer shrink-0"
                    style={{ zIndex: 12 - index }}
                  >
                    <div className="w-6 h-6 rounded-full flex items-center justify-center backdrop-blur-md transition-colors overflow-hidden">
                      <ChainIcon
                        chainKeyOrIconId={chain.rawKey || chain.id}
                        size={24}
                        className="w-6 h-6 rounded-full object-contain block"
                      />
                    </div>
                  </div>
                ))}
                {kpiStats.activeChains.length > maxVisibleChains && (
                  <div
                    className="w-6 h-6 rounded-full bg-[#161a2e] border border-indigo-400/30 text-[9px] font-mono font-bold text-indigo-300 flex items-center justify-center shrink-0 ring-2 ring-[#0c0e18] shadow-[0_4px_12px_rgba(0,0,0,0.45)] transition-all duration-300 hover:scale-115 cursor-pointer"
                    style={{ zIndex: 4 }}
                  >
                    +{kpiStats.activeChains.length - maxVisibleChains}
                  </div>
                )}
              </div>
            )}
          </div>
          <div
            className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5 truncate">
            <span className="truncate group-hover:text-slate-300 transition-colors">
              {kpiStats.chainNames || 'Arc Testnet'}
            </span>
          </div>
        </div>

        {/* Card 4: AI Agent Calls */}
        <div
          className="relative p-4 rounded-2xl border border-white/[0.08] hover:border-white/20 transition-all duration-300 group overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(15, 17, 26, 0.75) 100%)',
            boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.35)',
          }}
        >
          <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent group-hover:via-[var(--purple-1)]/40 transition-all duration-500" />
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-mono uppercase tracking-[1.5px] text-white/50 block truncate group-hover:text-white/70 transition-colors"
              style={{ fontFamily: 'var(--fonts--space-mono, monospace)' }}
            >
              AI AGENT CALLS
            </span>
            <Bot className="w-4 h-4 text-indigo-300 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity" />
          </div>
          <div
            className="text-xl sm:text-2xl font-bold text-white tabular-nums tracking-tight truncate mt-1.5 flex items-baseline gap-1"
            style={{ fontFamily: 'var(--fonts--space-grotesk, sans-serif)' }}
          >
            <span>{kpiStats.aiCallsCount}</span>
            <span className="text-xs font-normal text-slate-400">
              {kpiStats.aiCallsCount === 1 ? 'Call' : 'Calls'}
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-1 truncate">
            {kpiStats.aiSpentUsdc > 0
              ? `${kpiStats.aiSpentUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC · x402 settled`
              : 'x402 pay-per-call settled'}
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className={hasActiveFilters ? 'mb-3' : 'mb-6'}>
        <div className="relative w-full flex items-center">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none z-10" />
          <input
            type="text"
            placeholder="Search hash, address, memo, token, network or type..."
            aria-label="Search transactions by hash, address, memo, token, network or type"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-10 py-3 rounded-2xl text-xs text-white placeholder-slate-500 focus:outline-none transition-all font-mono"
            style={{
              background: 'rgba(11, 13, 24, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              aria-label="Clear search"
              className="absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Active Filter Chips & Clear All */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 mb-4 px-1 py-0.5 arc-animate-reveal">
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 uppercase tracking-wider mr-1 select-none">
            <Filter className="w-3 h-3 text-indigo-400 shrink-0" />
            <span>Active Filters:</span>
          </div>

          {filter !== 'all' && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.3)] text-indigo-200 transition-colors shadow-sm">
              <span>Type: <strong className="text-white font-semibold">{TYPE_FILTER_LABELS[filter] || filter}</strong></span>
              <button
                type="button"
                onClick={() => setFilter('all')}
                aria-label="Remove type filter"
                className="w-3.5 h-3.5 rounded-full hover:bg-white/20 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {activeNetworkFilter !== 'all' && activeNetworkLabel && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.3)] text-indigo-200 transition-colors shadow-sm">
              <span>Network: <strong className="text-white font-semibold">{activeNetworkLabel}</strong></span>
              <button
                type="button"
                onClick={() => setActiveNetworkFilter('all')}
                aria-label="Remove network filter"
                className="w-3.5 h-3.5 rounded-full hover:bg-white/20 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {activeAmountFilter && amountLabel && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.3)] text-indigo-200 transition-colors shadow-sm">
              <span>Amount: <strong className="text-white font-semibold">{amountLabel}</strong></span>
              <button
                type="button"
                onClick={handleResetAmountFilter}
                aria-label="Remove amount filter"
                className="w-3.5 h-3.5 rounded-full hover:bg-white/20 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {activeTimeFilter && timeLabel && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.3)] text-indigo-200 transition-colors shadow-sm">
              <span>Time: <strong className="text-white font-semibold">{timeLabel}</strong></span>
              <button
                type="button"
                onClick={handleResetTimeFilter}
                aria-label="Remove time filter"
                className="w-3.5 h-3.5 rounded-full hover:bg-white/20 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {activeRecipientFilter && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.3)] text-indigo-200 transition-colors shadow-sm">
              <span>Recipient: <strong className="text-white font-semibold truncate max-w-[120px] inline-block align-bottom">{activeRecipientFilter}</strong></span>
              <button
                type="button"
                onClick={handleResetRecipientFilter}
                aria-label="Remove recipient filter"
                className="w-3.5 h-3.5 rounded-full hover:bg-white/20 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}

          {searchTerm.trim() && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[rgba(99,102,241,0.12)] border border-[rgba(99,102,241,0.3)] text-indigo-200 transition-colors shadow-sm">
              <span>Search: <strong className="text-white font-semibold truncate max-w-[140px] inline-block align-bottom">"{searchTerm.trim()}"</strong></span>
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                aria-label="Clear search filter"
                className="w-3.5 h-3.5 rounded-full hover:bg-white/20 flex items-center justify-center text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          )}



          <button
            type="button"
            onClick={handleClearAllFilters}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono text-rose-300 hover:text-rose-100 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 hover:border-rose-500/40 transition-all cursor-pointer ml-auto sm:ml-2 shadow-sm"
          >
            <X className="w-3 h-3 text-rose-400" />
            <span>Clear</span>
          </button>
        </div>
      )}

      {/* Server-read failure: an unreadable history is NOT an empty history */}
      {fetchError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 mb-3 px-3.5 py-2.5 rounded-xl border border-rose-500/25 bg-rose-500/10 text-xs text-rose-200 transition-colors"
        >
          <span className="pr-2">
            Couldn't load your history from the server.
            {history.length > 0 ? ' Showing the last data loaded on this device.' : ''}
          </span>
          <button
            type="button"
            onClick={handleRetryFetch}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-xs text-rose-100 hover:text-white bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 hover:border-rose-500/50 transition-all cursor-pointer shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Table Content */}
      <div
        className="rounded-2xl overflow-hidden min-h-[300px]"
        style={{
          background: 'rgba(11, 13, 24, 0.65)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        {/* Mobile (<sm): the six-column fixed table is unreadable at phone widths. */}
        <div className="sm:hidden p-2.5">
          {isLoading ? (
            <div className="space-y-2.5 animate-pulse">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={`history-card-skeleton-${idx}`}
                  className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="h-4 w-24 bg-white/[0.08] rounded-md" />
                    <div className="h-3 w-14 bg-white/[0.06] rounded-md" />
                  </div>
                  <div className="h-5 w-28 bg-white/[0.08] rounded-md" />
                  <div className="h-3 w-36 bg-white/[0.06] rounded-md" />
                </div>
              ))}
            </div>
          ) : filteredHistory.length === 0 ? (
            <HistoryEmptyState
              activeWalletAddress={activeWalletAddress}
              historyLength={settledHistoryCount}
              hasActiveFilters={hasActiveFilters}
              fetchError={fetchError}
              onClearFilters={handleClearAllFilters}
              onRetry={handleRetryFetch}
              onConnectWallet={() => void requestFullWalletConnect()}
            />
          ) : (
            <div className="space-y-2.5">
              {paginatedHistory.map((item) => (
                <HistoryCard
                  key={`history-card-${item.id}`}
                  item={item}
                  globalPrivate={globalPrivate}
                  settings={settings}
                  hoveredRecipient={hoveredRecipient}
                  setHoveredRecipient={setHoveredRecipient}
                  timeFormat={timeFormat}
                  onSelectReceipt={openReceipt}
                />
              ))}
            </div>
          )}
        </div>

        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full table-fixed text-center border-collapse">
            <HistoryTableHeader
              showNetworkFilter={showNetworkFilter}
              setShowNetworkFilter={setShowNetworkFilter}
              activeNetworkFilter={activeNetworkFilter}
              setActiveNetworkFilter={setActiveNetworkFilter}
              availableNetworks={availableNetworks}
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
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
            />

            <tbody className="divide-y divide-white/[0.04] text-xs">
              {/* Skeleton Loading Rows during initial fetch / prefetch resolution */}
              {isLoading && (
                <>
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <tr key={`history-skeleton-${idx}`} className="h-[52px] animate-pulse">
                      <td className="w-[18%] px-3 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="h-4 w-24 bg-white/[0.08] rounded-md" />
                          <div className="h-4 w-4 bg-white/[0.04] rounded-md" />
                        </div>
                      </td>
                      {/* Network Skeleton */}
                      <td className="w-[13%] px-3 py-3 text-center">
                        <div className="w-10 h-10 bg-white/[0.08] rounded-xl mx-auto" />
                      </td>
                      {/* Type Skeleton */}
                      <td className="w-[16%] px-3 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-7 h-7 rounded-xl bg-white/[0.08]" />
                          <div className="h-4 w-12 bg-white/[0.08] rounded-md" />
                        </div>
                      </td>
                      <td className="w-[20%] px-3 py-3.5 text-center">
                        <div className="h-4 w-20 bg-white/[0.08] rounded-md mx-auto" />
                      </td>
                      <td className="w-[17%] px-3 py-3.5 text-center">
                        <div className="h-4 w-24 bg-white/[0.08] rounded-md mx-auto" />
                      </td>
                      <td className="w-[16%] px-3 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <div className="w-3.5 h-3.5 rounded-full bg-white/[0.06]" />
                          <div className="h-4 w-14 bg-white/[0.08] rounded-md" />
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
                    hoveredRecipient={hoveredRecipient}
                    setHoveredRecipient={setHoveredRecipient}
                    timeFormat={timeFormat}
                    onSelectReceipt={openReceipt}
                  />
                ))}

              {/* Empty State when no transactions exist and not loading */}
              {!isLoading && filteredHistory.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-20 text-center">
                    <HistoryEmptyState
                      activeWalletAddress={activeWalletAddress}
                      historyLength={settledHistoryCount}
                      hasActiveFilters={hasActiveFilters}
                      fetchError={fetchError}
                      onClearFilters={handleClearAllFilters}
                      onRetry={handleRetryFetch}
                      onConnectWallet={() => void requestFullWalletConnect()}
                    />
                  </td>
                </tr>
              )}

              {/* Fill empty placeholder rows if paginated items are less than 5 but greater than 0 */}
              {!isLoading &&
                paginatedHistory.length > 0 &&
                paginatedHistory.length < 5 &&
                Array.from({ length: 5 - paginatedHistory.length }).map((_, idx) => (
                  <tr key={`filler-${idx}`} className="h-[52px]">
                    <td colSpan={6} className="px-5 py-3.5">
                      &nbsp;
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls (shared by the table and the card list) */}
        {!isLoading && (
          <HistoryPagination
            totalItems={sortedHistory.length}
            currentPage={currentPage}
            totalPages={totalPages}
            startIndex={startIndex}
            endIndex={endIndex}
            onPageChange={setCurrentPage}
            pageSize={pageSize}
            onPageSizeChange={handlePageSizeChange}
          />
        )}
      </div>

      {/* Interactive Digital Receipt & Invoice Modal */}
      <ReceiptModal
        isOpen={isReceiptModalOpen}
        onClose={() => {
          setIsReceiptModalOpen(false)
          setSelectedReceiptItem(null)
          setDeepLinkedTx(null)
        }}
        item={selectedReceiptItem}
      />
    </div>
  )
}
