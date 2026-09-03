import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import {
  ArrowUpRight,
  ArrowRightLeft,
  Globe,
  ExternalLink,
  Clock,
  Search,
  Check,
  Copy,
  Filter,
  Calendar,
  Hash,
  X,
  ChevronLeft,
  ChevronRight,
  FileText
} from 'lucide-react'
import { getHistory, fetchHistory, HistoryItem } from '../utils/history'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import { TokenIcon } from '@web3icons/react/dynamic'
import { usePrivacy } from '../hooks/usePrivacy'
import { ReceiptModal } from './ReceiptModal'
import { SUPPORTED_SEND_CHAINS, getExplorerTxUrl, getExplorerAddressUrl } from '../config/sendConfig'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const DAY_HEADERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

interface CalendarPickerProps {
  initialDateStr?: string
  onApply: (dateIsoStr: string) => void
  onClear: () => void
  onClose: () => void
}

function CustomCalendarPicker({ initialDateStr, onApply, onClear, onClose }: CalendarPickerProps) {
  const initialDate = initialDateStr ? new Date(initialDateStr) : new Date()
  const validInitial = !isNaN(initialDate.getTime()) ? initialDate : new Date()

  const [viewYear, setViewYear] = useState(validInitial.getFullYear())
  const [viewMonth, setViewMonth] = useState(validInitial.getMonth())
  const [selectedDay, setSelectedDay] = useState(validInitial.getDate())

  const pad = (n: number) => n.toString().padStart(2, '0')
  const [timeStr, setTimeStr] = useState(
    `${pad(validInitial.getHours())}:${pad(validInitial.getMinutes())}:${pad(validInitial.getSeconds())}`
  )

  const dateInputStr = `${pad(viewMonth + 1)}/${pad(selectedDay)}/${viewYear}`

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(prev => prev - 1)
    } else {
      setViewMonth(prev => prev - 1)
    }
  }

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(prev => prev + 1)
    } else {
      setViewMonth(prev => prev + 1)
    }
  }

  // Generate calendar grid
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDayOfWeek = new Date(viewYear, viewMonth, 1).getDay()
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate()

  const gridDays: Array<{ day: number; isCurrentMonth: boolean; monthOffset: number }> = []

  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    gridDays.push({ day: prevMonthDays - i, isCurrentMonth: false, monthOffset: -1 })
  }
  for (let i = 1; i <= daysInMonth; i++) {
    gridDays.push({ day: i, isCurrentMonth: true, monthOffset: 0 })
  }
  const remaining = (gridDays.length > 35 ? 42 : 35) - gridDays.length
  for (let i = 1; i <= remaining; i++) {
    gridDays.push({ day: i, isCurrentMonth: false, monthOffset: 1 })
  }

  const handleDayClick = (dayObj: { day: number; isCurrentMonth: boolean; monthOffset: number }) => {
    if (dayObj.isCurrentMonth) {
      setSelectedDay(dayObj.day)
    } else {
      if (dayObj.monthOffset === -1) {
        handlePrevMonth()
        setSelectedDay(dayObj.day)
      } else if (dayObj.monthOffset === 1) {
        handleNextMonth()
        setSelectedDay(dayObj.day)
      }
    }
  }

  const handleApplyClick = () => {
    const formattedIso = `${viewYear}-${pad(viewMonth + 1)}-${pad(selectedDay)}T${timeStr.slice(0, 5)}`
    onApply(formattedIso)
  }

  const today = new Date()
  const isToday = (day: number, isCurrentMonth: boolean) =>
    isCurrentMonth && day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear()

  return (
    <div
      className="w-76 rounded-2xl p-4 shadow-2xl space-y-3 font-sans text-left normal-case tracking-normal backdrop-blur-2xl"
      style={{
        background: 'rgba(15, 18, 32, 0.98)',
        border: '1px solid rgba(152, 150, 255, 0.25)',
        boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
        fontFamily: 'var(--font-app)',
      }}
    >
      {/* Top Header Inputs: MM/dd/yyyy and HH:mm:ss */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-app)' }}>
            MM/dd/yyyy
          </label>
          <div
            className="rounded-xl px-2.5 py-1.5 text-center text-xs font-mono text-white"
            style={{
              background: 'rgba(11, 13, 24, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          >
            {dateInputStr}
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-app)' }}>
            HH:mm:ss
          </label>
          <input
            type="text"
            value={timeStr}
            onChange={(e) => setTimeStr(e.target.value)}
            placeholder="00:00:00"
            className="w-full rounded-xl px-2.5 py-1.5 text-center text-xs font-mono text-white focus:outline-none transition-all"
            style={{
              background: 'rgba(11, 13, 24, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          />
        </div>
      </div>

      {/* Month / Year Bar */}
      <div className="flex items-center justify-between px-1 pt-1">
        <button
          type="button"
          onClick={handlePrevMonth}
          className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-colors cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        <div className="flex items-center gap-2">
          <select
            value={viewMonth}
            onChange={(e) => setViewMonth(Number(e.target.value))}
            className="bg-transparent text-white font-semibold text-xs focus:outline-none cursor-pointer"
          >
            {MONTH_NAMES.map((name, idx) => (
              <option key={name} value={idx} className="bg-[#0f1220] text-white">
                {name}
              </option>
            ))}
          </select>

          <select
            value={viewYear}
            onChange={(e) => setViewYear(Number(e.target.value))}
            className="bg-transparent text-white font-semibold text-xs focus:outline-none cursor-pointer"
          >
            {Array.from({ length: 15 }, (_, i) => 2020 + i).map(y => (
              <option key={y} value={y} className="bg-[#0f1220] text-white">
                {y}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleNextMonth}
          className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-colors cursor-pointer"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Day Headers */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {DAY_HEADERS.map(d => (
          <span key={d} className="text-[11px] font-medium text-slate-400" style={{ fontFamily: 'var(--font-app)' }}>
            {d}
          </span>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {gridDays.map((dObj, idx) => {
          const isSelected = dObj.isCurrentMonth && dObj.day === selectedDay
          const isTodayDay = isToday(dObj.day, dObj.isCurrentMonth)

          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleDayClick(dObj)}
              className={`h-7 w-7 mx-auto flex items-center justify-center text-xs rounded-full font-mono transition-all cursor-pointer ${isSelected
                  ? 'bg-[rgba(152,150,255,0.25)] text-white font-bold border border-[rgba(152,150,255,0.5)] shadow-sm'
                  : isTodayDay
                    ? 'bg-white/[0.08] text-white border border-white/[0.2] font-bold'
                    : dObj.isCurrentMonth
                      ? 'text-slate-200 hover:bg-white/[0.08]'
                      : 'text-slate-600 hover:text-slate-400'
                }`}
            >
              {dObj.day}
            </button>
          )
        })}
      </div>

      {/* Bottom Actions: Clear & Apply */}
      <div className="flex items-center justify-between pt-2 border-t border-white/[0.08]">
        <button
          type="button"
          onClick={() => {
            onClear()
            onClose()
          }}
          className="ub-action-btn rounded-full px-3.5 py-1 text-xs font-semibold"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleApplyClick}
          className="ub-action-btn ub-action-btn-primary rounded-full px-4 py-1 text-xs font-semibold"
        >
          Apply
        </button>
      </div>
    </div>
  )
}

function RenderTokenIcon({ symbol }: { symbol?: string }) {
  const symUpper = symbol?.toUpperCase() || 'USDC'
  if (symUpper === 'USDC') {
    return <img src={UsdcIcon} alt="USDC" className="w-4 h-4 rounded-full inline-block shrink-0" />
  }
  if (symUpper === 'EURC') {
    return <img src={EurcIcon} alt="EURC" className="w-4 h-4 rounded-full inline-block shrink-0" />
  }
  if (symUpper === 'CIRCLE' || symUpper === 'CRCL') {
    return <img src={CircleIcon} alt="CIRCLE" className="w-4 h-4 rounded-full inline-block shrink-0" />
  }
  return <TokenIcon symbol={symbol?.toLowerCase() || 'usdc'} className="w-4 h-4 rounded-full inline-block shrink-0" size={16} />
}

const CHAIN_DISPLAY_NAMES: Record<string, string> = {
  Arc_Testnet: 'Arc Testnet',
  Ethereum_Sepolia: 'Ethereum Sepolia',
  Base_Sepolia: 'Base Sepolia',
  Arbitrum_Sepolia: 'Arbitrum Sepolia',
  Optimism_Sepolia: 'Optimism Sepolia',
  Polygon_Amoy_Testnet: 'Polygon Amoy',
  Avalanche_Fuji: 'Avalanche Fuji',
  HyperEVM_Testnet: 'HyperEVM Testnet',
  Sei_Testnet: 'Sei Testnet',
  Solana_Devnet: 'Solana Devnet',
  Sonic_Testnet: 'Sonic Testnet',
  Unichain_Sepolia: 'Unichain Sepolia',
  World_Chain_Sepolia: 'World Sepolia'
}

interface HistoryTableProps {
  walletAddress?: string
}

export default function HistoryTable({ walletAddress }: HistoryTableProps = {}) {
  const { address: wagmiAddress } = useAccount()
  const activeWalletAddress = (walletAddress || wagmiAddress || '').toLowerCase()

  const { isPrivate: globalPrivate, settings } = usePrivacy()
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'send' | 'swap' | 'bridge' | 'memo'>('all')
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

  // State to force re-render relative time tickers
  const [, setTimeTicker] = useState(0)

  // Reset to page 1 whenever any filter or search term changes
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, filter, activeAmountFilter, activeTimeFilter, activeRecipientFilter])

  const formatDisplayDate = (isoStr: string) => {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    if (isNaN(d.getTime())) return isoStr
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  // Load transactions from server environment filtered by active wallet
  useEffect(() => {
    let isMounted = true
    setIsLoading(true)

    // Immediate in-memory render
    setHistory(getHistory(activeWalletAddress))

    // Asynchronous server-side fetch
    fetchHistory(activeWalletAddress)
      .then((items) => {
        if (isMounted) {
          setHistory(items)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        console.warn('[HistoryTable] Error fetching server transactions:', err)
        if (isMounted) setIsLoading(false)
      })

    // Listen for custom events to automatically reload from server
    const handleUpdate = () => {
      fetchHistory(activeWalletAddress).then((items) => {
        if (isMounted) setHistory(items)
      })
    }
    window.addEventListener('arc_history_updated', handleUpdate)

    // Interval to refresh relative time strings every 15 seconds
    const interval = setInterval(() => {
      setTimeTicker((prev) => prev + 1)
    }, 15000)

    return () => {
      isMounted = false
      window.removeEventListener('arc_history_updated', handleUpdate)
      clearInterval(interval)
    }
  }, [activeWalletAddress])

  // Close filter dropdowns on outside click
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

  const formatChain = (chainKey: string) => {
    return CHAIN_DISPLAY_NAMES[chainKey] || chainKey.replace(/_/g, ' ')
  }

  const formatAddress = (addr?: string) => {
    if (!addr) return '-'
    if (addr.length < 12) return addr
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`
  }

  const getExplorerLink = (hash: string, chainKey: string) => {
    return getExplorerTxUrl(chainKey, hash)
  }

  const getAddressExplorerLink = (addr?: string, chainKey?: string) => {
    return getExplorerAddressUrl(chainKey, addr)
  }

  const formatUtcTime = (timestamp: number) => {
    const d = new Date(timestamp)
    const pad = (n: number) => n.toString().padStart(2, '0')
    const hours = pad(d.getUTCHours())
    const minutes = pad(d.getUTCMinutes())
    const seconds = pad(d.getUTCSeconds())
    const month = MONTH_NAMES[d.getUTCMonth()].substring(0, 3)
    const day = d.getUTCDate()
    const year = d.getUTCFullYear()
    return `${hours}:${minutes}:${seconds} ${month} ${day}, ${year}`
  }

  const getRelativeTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    if (diff < 30000) return 'Just now'

    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins} min${mins > 1 ? 's' : ''} ago`

    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`

    const days = Math.floor(hours / 24)
    return `${days} day${days > 1 ? 's' : ''} ago`
  }

  const getStatusBadge = (status: HistoryItem['status']) => {
    switch (status) {
      case 'success':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-[var(--fonts--space-mono)]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            SUCCESS
          </span>
        )
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse font-[var(--fonts--space-mono)]">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            PENDING
          </span>
        )
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 font-[var(--fonts--space-mono)]">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
            FAILED
          </span>
        )
    }
  }

  const formatAmountDisplay = (val?: string) => {
    if (!val) return '0'
    const num = parseFloat(val)
    if (isNaN(num)) return val
    return parseFloat(num.toFixed(2)).toString()
  }

  const getAmountDetail = (item: HistoryItem) => {
    if (globalPrivate || item.isPrivate) {
      return (
        <span className="font-mono text-white tracking-wider font-semibold" title="APS Encrypted Transaction">
          <span>{settings.maskSymbol}</span>
        </span>
      )
    }

    switch (item.type) {
      case 'send':
        return (
          <span className="font-bold text-rose-400 font-[var(--fonts--space-grotesk)] flex items-center gap-1.5">
            <span>-{formatAmountDisplay(item.amount)}</span>
            <RenderTokenIcon symbol={item.tokenSymbol} />
          </span>
        )
      case 'swap':
        if (item.amountIn && item.amountOut) {
          return (
            <span className="font-bold text-white font-[var(--fonts--space-grotesk)] flex items-center gap-1.5">
              <span>{formatAmountDisplay(item.amountIn)}</span>
              <RenderTokenIcon symbol={item.tokenIn} />
              <span className="text-[var(--secondary-colors--sky-sync)] text-[10px]">{"→"}</span>
              <span>{formatAmountDisplay(item.amountOut)}</span>
              <RenderTokenIcon symbol={item.tokenOut} />
            </span>
          )
        }
        return (
          <span className="font-bold text-white font-[var(--fonts--space-grotesk)] flex items-center gap-1.5">
            <span>{formatAmountDisplay(item.amount)}</span>
            <RenderTokenIcon symbol={item.tokenSymbol} />
          </span>
        )
      case 'bridge':
        return (
          <span className="font-bold text-white font-[var(--fonts--space-grotesk)] flex items-center gap-1.5">
            <span>{formatAmountDisplay(item.amount)}</span>
            <RenderTokenIcon symbol={item.tokenSymbol} />
          </span>
        )
    }
  }

  const getRecipientTarget = (item: HistoryItem) => {
    if (globalPrivate || item.isPrivate) {
      return <span className="font-mono text-white tracking-wider font-semibold w-1/5 px-8 py-3.5 truncate">*****</span>
    }
    if (item.type === 'bridge' && item.destChain && !item.recipient) {
      return (
        <span className="bg-[rgba(47,87,140,0.3)] text-[var(--secondary-colors--sky-sync)] border border-[rgba(172,198,233,0.3)] text-[10px] font-bold px-2 py-0.5 rounded font-[var(--fonts--space-mono)]">
          {formatChain(item.destChain)}
        </span>
      )
    }

    if (!item.recipient) {
      if (item.destChain) {
        return (
          <span className="bg-[rgba(47,87,140,0.3)] text-[var(--secondary-colors--sky-sync)] border border-[rgba(172,198,233,0.3)] text-[10px] font-bold px-2 py-0.5 rounded font-[var(--fonts--space-mono)]">
            {formatChain(item.destChain)}
          </span>
        )
      }
      return <span className="text-slate-500 font-mono text-xs">-</span>
    }

    const normRecipient = item.recipient.toLowerCase()
    const isMatch = Boolean(hoveredRecipient && normRecipient && hoveredRecipient === normRecipient)
    const targetChain = item.destChain || item.sourceChain || 'Arc_Testnet'
    const explorerUrl = getAddressExplorerLink(item.recipient, targetChain)

    return (
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={() => setHoveredRecipient(normRecipient)}
        onMouseLeave={() => setHoveredRecipient(null)}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg font-mono text-xs transition-all duration-300 select-none group/recip cursor-pointer ${
          isMatch
            ? 'text-white bg-[rgba(152,150,255,0.3)] border border-[rgba(152,150,255,0.65)] shadow-[0_0_14px_rgba(152,150,255,0.5)] ring-1 ring-[rgba(152,150,255,0.4)] scale-105 font-bold'
            : 'text-slate-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 border border-transparent'
        }`}
        title={explorerUrl}
      >
        <span>{formatAddress(item.recipient)}</span>
        <ExternalLink className="w-3 h-3 text-slate-500 group-hover/recip:text-[var(--purple-1)] transition-colors opacity-70 group-hover/recip:opacity-100 shrink-0" />
      </a>
    )
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

  const filteredHistory = history.filter(item => {
    if (filter === 'memo') {
      if (!item.memo) return false
    } else if (filter !== 'all' && item.type !== filter) {
      return false
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      const matchesHash = item.txHash.toLowerCase().includes(term)
      const matchesRecipient = item.recipient?.toLowerCase().includes(term)
      const matchesMemo = item.memo?.toLowerCase().includes(term)
      const matchesMemoId = item.memoId?.toLowerCase().includes(term)
      if (!matchesHash && !matchesRecipient && !matchesMemo && !matchesMemoId) return false
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
        {filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center p-6 min-h-[280px]">
            <Clock className="w-10 h-10 text-slate-600 mb-3" />
            <h4 className="text-sm font-semibold text-slate-300" style={{ fontFamily: 'var(--font-app)' }}>NO TRANSACTIONS</h4>
            <p className="text-xs text-slate-500 max-w-xs mt-1" style={{ fontFamily: 'var(--font-app)' }}>
              {history.length === 0
                ? 'Transactions initiated on this client (Send, Swap, or Cross-chain Bridge) will show up here.'
                : 'No transactions match the selected filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto flex flex-col justify-between min-h-[300px]">
            <table className="w-full table-fixed text-left border-collapse">
              <thead>
                <tr
                  className="border-b border-white/[0.08] text-xs font-semibold text-slate-400"
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    fontFamily: 'var(--font-app)',
                  }}
                >
                  <th className="w-1/5 px-5 py-3.5">TX HASH</th>

                  {/* TYPE Column Header with Filter Icon & Popover Modal */}
                  <th className="w-1/5 px-10 py-3.5 relative filter-popover-container">
                    <div className="flex items-center gap-1.5">
                      <span>TYPE</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowTypeFilter(prev => !prev)
                          setShowAmountFilter(false)
                          setShowRecipientFilter(false)
                          setShowTimeFilter(false)
                          setActivePickerTarget(null)
                        }}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${filter !== 'all'
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
                        className="absolute left-0 top-full mt-2 z-50 w-76 rounded-2xl p-4 shadow-2xl space-y-3 text-left font-sans normal-case tracking-normal backdrop-blur-2xl"
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

                        {/* Options - Horizontal row of compact buttons */}
                        <div className="grid grid-cols-4 gap-1.5">
                          {[
                            { id: 'all', label: 'All', icon: null },
                            { id: 'send', label: 'Send', icon: ArrowUpRight },
                            { id: 'swap', label: 'Swap', icon: ArrowRightLeft },
                            { id: 'bridge', label: 'Bridge', icon: Globe },
                          ].map(t => {
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
                                className={`flex-1 flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${isSelected
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
                  <th className="w-1/5 px-1 py-3.5 relative filter-popover-container">
                    <div className="flex items-center gap-1.5">
                      <span>AMOUNT</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowAmountFilter(prev => !prev)
                          setShowTypeFilter(false)
                          setShowRecipientFilter(false)
                          setShowTimeFilter(false)
                          setActivePickerTarget(null)
                        }}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${activeAmountFilter
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
                        className="absolute left-0 top-full mt-2 z-50 w-80 rounded-2xl p-4 shadow-2xl space-y-3.5 text-left font-sans normal-case tracking-normal backdrop-blur-2xl"
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
                            { id: '>1000', label: '> 1K' }
                          ].map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => handleAmountPresetSelect(p.id)}
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${amountPreset === p.id
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
                  <th className="w-1/5 px-3 py-3.5 relative filter-popover-container">
                    <div className="flex items-center gap-1.5">
                      <span>RECIPIENT</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowRecipientFilter(prev => !prev)
                          setShowTypeFilter(false)
                          setShowAmountFilter(false)
                          setShowTimeFilter(false)
                          setActivePickerTarget(null)
                        }}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${activeRecipientFilter
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
                        className="absolute left-0 top-full mt-2 z-50 w-80 rounded-2xl p-4 shadow-2xl space-y-3.5 text-left font-sans normal-case tracking-normal backdrop-blur-2xl"
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
                  <th className="w-1/5 px-5 py-3.5 relative filter-popover-container">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setTimeFormat(prev => prev === 'relative' ? 'utc' : 'relative')}
                        className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors cursor-pointer select-none"
                        title="Click to toggle between Relative Time and UTC Time"
                      >
                        <span className="font-bold">{timeFormat === 'utc' ? 'UTC TIME' : 'TIME'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowTimeFilter(prev => !prev)
                          setShowTypeFilter(false)
                          setShowAmountFilter(false)
                          setShowRecipientFilter(false)
                          setActivePickerTarget(null)
                        }}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${activeTimeFilter
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
                            { id: 'first1h', label: 'First 1H' }
                          ].map(p => (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => handleTimePresetSelect(p.id)}
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${timePreset === p.id
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
                              onClick={() => setActivePickerTarget(prev => prev === 'from' ? null : 'from')}
                              className={`flex items-center rounded-2xl px-3.5 py-2.5 cursor-pointer transition-all ${activePickerTarget === 'from' ? 'border border-[rgba(152,150,255,0.5)] shadow-md text-white' : 'border border-white/10 hover:border-white/20'
                                }`}
                              style={{
                                background: 'rgba(11, 13, 24, 0.75)',
                              }}
                            >
                              <Calendar className="w-4 h-4 text-slate-400 mr-2 shrink-0 pointer-events-none" />
                              <span className={`w-full text-xs font-mono select-none ${fromDate ? 'text-white font-semibold' : 'text-slate-500'}`}>
                                {fromDate ? formatDisplayDate(fromDate) : 'From Date'}
                              </span>
                              {fromDate && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setFromDate('')
                                    setTimePreset(null)
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
                                    setTimePreset(null)
                                    setActivePickerTarget(null)
                                  }}
                                  onClear={() => {
                                    setFromDate('')
                                    setTimePreset(null)
                                  }}
                                  onClose={() => setActivePickerTarget(null)}
                                />
                              </div>
                            )}
                          </div>

                          {/* To Date Input Field & Picker */}
                          <div className="relative">
                            <div
                              onClick={() => setActivePickerTarget(prev => prev === 'to' ? null : 'to')}
                              className={`flex items-center rounded-2xl px-3.5 py-2.5 cursor-pointer transition-all ${activePickerTarget === 'to' ? 'border border-[rgba(152,150,255,0.5)] shadow-md text-white' : 'border border-white/10 hover:border-white/20'
                                }`}
                              style={{
                                background: 'rgba(11, 13, 24, 0.75)',
                              }}
                            >
                              <Calendar className="w-4 h-4 text-slate-400 mr-2 shrink-0 pointer-events-none" />
                              <span className={`w-full text-xs font-mono select-none ${toDate ? 'text-white font-semibold' : 'text-slate-500'}`}>
                                {toDate ? formatDisplayDate(toDate) : 'To Date'}
                              </span>
                              {toDate && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setToDate('')
                                    setTimePreset(null)
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
                                    setTimePreset(null)
                                    setActivePickerTarget(null)
                                  }}
                                  onClear={() => {
                                    setToDate('')
                                    setTimePreset(null)
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
              <tbody className="divide-y divide-white/[0.04] text-xs">
                {paginatedHistory.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-white/[0.04] transition-colors group h-[52px]"
                  >
                    {/* Tx Hash */}
                    <td className="w-1/5 px-5 py-3">
                      <div className="flex items-center gap-2 font-mono">
                        <a
                          href={getExplorerLink(item.txHash, item.sourceChain || 'Arc_Testnet')}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-slate-200 hover:text-white font-medium transition-all group/tx select-none cursor-pointer"
                          title={getExplorerLink(item.txHash, item.sourceChain || 'Arc_Testnet')}
                        >
                          <span className="group-hover/tx:text-white">{formatAddress(item.txHash)}</span>
                          <ExternalLink className="w-4 h-4 text-slate-500 group-hover/tx:text-[var(--purple-1)] transition-colors opacity-70 group-hover/tx:opacity-100 shrink-0" />
                        </a>

                        <button
                          onClick={() => handleCopy(item.txHash, item.id)}
                          className="p-1 rounded-xl text-slate-500 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all cursor-pointer"
                          title="Copy Transaction Hash"
                        >
                          {copiedId === item.id ? (
                            <Check className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedReceiptItem(item)
                            setIsReceiptModalOpen(true)
                          }}
                          className="p-1 rounded-xl text-indigo-300/70 hover:text-white hover:bg-indigo-500/15 active:scale-95 transition-all cursor-pointer"
                          title="View Digital Receipt / Invoice"
                        >
                          <FileText className="w-3.5 h-3.5 text-[var(--purple-1)]" />
                        </button>
                      </div>
                    </td>

                    {/* Type */}
                    <td className="w-1/5 px-10 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                          {item.type === 'send' && <ArrowUpRight className="w-3.5 h-3.5 text-indigo-300" />}
                          {item.type === 'swap' && <ArrowRightLeft className="w-3.5 h-3.5 text-indigo-300" />}
                          {item.type === 'bridge' && <Globe className="w-3.5 h-3.5 text-indigo-300" />}
                        </div>
                        <span className="font-semibold text-white uppercase text-xs" style={{ fontFamily: 'var(--font-app)' }}>
                          {item.type}
                        </span>
                      </div>
                    </td>

                    {/* Amount / Detail */}
                    <td className="w-1/5 px-1 py-3.5 truncate">
                      {getAmountDetail(item)}
                    </td>

                    {/* Recipient*/}
                    <td className="w-1/5 px-1 py-3.5 truncate">
                      {getRecipientTarget(item)}
                    </td>

                    {/* Time */}
                    <td className="w-1/5 px-5 py-3.5 text-slate-400" style={{ fontFamily: 'var(--font-app)' }}>
                      <div
                        className="flex items-center gap-1.5 select-none"
                        title={timeFormat === 'utc' ? `Relative: ${getRelativeTime(item.timestamp)}` : `UTC: ${formatUtcTime(item.timestamp)}`}
                      >
                        <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="text-slate-400 text-xs">
                          {timeFormat === 'utc' ? formatUtcTime(item.timestamp) : getRelativeTime(item.timestamp)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}

                {/* Empty State when no transactions exist */}
                {filteredHistory.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-2 text-slate-400">
                        <Clock className="w-8 h-8 text-slate-600 mb-1" />
                        <p className="text-sm font-semibold text-slate-300">
                          {activeWalletAddress ? 'No transactions found for this wallet' : 'No transactions recorded on server'}
                        </p>
                        <p className="text-xs text-slate-500 max-w-sm">
                          {activeWalletAddress
                            ? `Transactions performed by or received by ${activeWalletAddress.slice(0, 6)}...${activeWalletAddress.slice(-4)} will appear here once executed.`
                            : 'Perform a send, swap, or bridge transaction to view your server-persisted transaction history.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Fill empty placeholder rows if paginated items are less than 5 but greater than 0 */}
                {paginatedHistory.length > 0 && paginatedHistory.length < 5 && Array.from({ length: 5 - paginatedHistory.length }).map((_, idx) => (
                  <tr key={`filler-${idx}`} className="h-[52px]">
                    <td colSpan={5} className="px-5 py-3.5">&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination Controls */}
            {filteredHistory.length > 0 && (
              <div
                className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3 py-4 border-t border-white/[0.08] text-xs"
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  fontFamily: 'var(--font-app)',
                }}
              >
                <div className="text-slate-400 font-medium">
                  Showing <span className="text-white font-bold">{filteredHistory.length > 0 ? startIndex + 1 : 0}</span> - <span className="text-white font-bold">{endIndex}</span> of <span className="text-white font-bold">{filteredHistory.length}</span> transactions
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      className="ub-action-btn rounded-full px-3.5 py-1 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-3.5 h-3.5 mr-0.5" />
                      <span>Prev</span>
                    </button>

                    <div className="flex items-center gap-1 px-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setCurrentPage(page)}
                          className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold transition-all cursor-pointer ${currentPage === page
                              ? 'bg-[rgba(152,150,255,0.25)] text-white border border-[rgba(152,150,255,0.5)] shadow-sm'
                              : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                            }`}
                        >
                          {page}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      className="ub-action-btn rounded-full px-3.5 py-1 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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
