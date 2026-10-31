import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  Clock,
  Globe,
  PiggyBank,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import { OFFICIAL_MANIFESTS } from '../../config/x402/manifests'
import { useMarketplaceServices } from '../../hooks/useMarketplaceServices'
import { usePlatformStats } from '../../hooks/usePlatformStats'
import { useReportDigests } from '../../hooks/useReportDigests'
import { useServiceTelemetry } from '../../hooks/useServiceTelemetry'
import { useSharedLatency } from '../../hooks/useSharedLatency'
import {
  deriveMarketplaceHeroStats,
  WEB2_CALL_BASELINE_USD,
} from '../../services/marketplaceHeroStats'
import type { CopilotUcwHandlers } from '../../services/copilot/copilotCommon'
import type { UcwTypedDataChallenge } from '../../services/x402/ucwPaymentSigner'
import {
  getSessionKeyConfig,
  saveSessionKeyConfig,
  SESSION_KEY_UPDATED_EVENT,
  DEFAULT_SESSION_KEY_CONFIG,
} from '../../services/sessionKeyService'
import { soundService } from '../../services/soundService'
import type { SessionKeyConfig } from '../../types/sessionKey'
import type { x402Service } from '../../types/marketplace'
import NextStepRail, { LastMeasurementBadge } from './NextStepRail'
import ProviderHubModal from './ProviderHubModal'
import RegisterServiceModal from './RegisterServiceModal'
import ServicePlaygroundModal from './ServicePlaygroundModal'
import SessionBudgetModal from './SessionBudgetModal'
type SortByOption = 'default' | 'price_asc' | 'price_desc' | 'latency_asc' | 'name_asc'

const SORT_OPTIONS: Array<{
  value: SortByOption
  label: string
  icon: typeof Sparkles
  badge?: string
}> = [
  { value: 'default', label: 'Default Order', icon: Sparkles },
  { value: 'price_asc', label: 'Price: Low to High', icon: ArrowDown },
  { value: 'price_desc', label: 'Price: High to Low', icon: ArrowUp },
  { value: 'latency_asc', label: 'Latency: Fastest', icon: Zap, badge: 'SLA' },
  { value: 'name_asc', label: 'Name: A to Z', icon: ArrowUpDown },
]

interface MarketplaceTabProps {
  walletAddress?: string
  walletConnected?: boolean
  provider?: any
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  /** Circle Wallet typed-data challenge signer; enables paid calls from a UCW EOA. */
  ucwSignTypedData?: UcwTypedDataChallenge
  /** UCW executors for the post-call action card (swap/send), so payer parity is not lost there. */
  ucwHandlers?: CopilotUcwHandlers
  onNavigate?: (tab: string) => void
}

export default function MarketplaceTab({
  walletAddress,
  walletConnected: _walletConnected,
  provider,
  authSource,
  ucwSignTypedData,
  ucwHandlers,
  onNavigate,
}: MarketplaceTabProps) {
  const {
    services,
    filteredServices,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    filterCommunity,
    setFilterCommunity,
    activeService,
    isPlaygroundOpen,
    isExecuting,
    executionResult,
    sessionBudget,
    openPlayground,
    closePlayground,
    runService,
    handleResetBudget,
    isProviderHubOpen,
    setIsProviderHubOpen,
    isRegisterModalOpen,
    setIsRegisterModalOpen,
    registerService,
  } = useMarketplaceServices(walletAddress, provider, authSource, ucwSignTypedData)

  const [isSessionModalOpen, setIsSessionModalOpen] = useState<boolean>(false)

  // Inputs the shelf asked the playground to open with (a next-step re-run). A plain card click
  // sets this to `undefined`, so a recommendation never leaks into an unrelated call.
  const [pendingPayload, setPendingPayload] = useState<Record<string, unknown> | undefined>(
    undefined
  )

  // Every financial figure on the card is derived from the shared settlement ledger through one
  // module, so the numbers cannot disagree about their source or about what an outage means.
  // `unavailable` renders as a dash: a counter outage must not look like "zero calls" or "zero
  // savings" to a visitor.
  const { snapshot: platformStats } = usePlatformStats()

  // The wallet's own paid reports, read back from the server. A settled call re-reads the store so
  // the shelf and the card lines reflect the run that just happened, not a local tally.
  const settlementKey =
    executionResult?.payment?.settlementRef ?? executionResult?.payment?.id ?? null
  const {
    byService: digestsByService,
    recommendations: nextSteps,
  } = useReportDigests(walletAddress, settlementKey)
  const digestNow = Date.now()

  // The displayed fee must be the fee the settlement path actually deducts. It is read from the
  // official manifests (all 0 today) instead of a hardcoded marketing percentage.
  const protocolFeeBps = useMemo(
    () => Math.max(0, ...OFFICIAL_MANIFESTS.map((manifest) => manifest.pricing.protocolFeeBps ?? 0)),
    []
  )

  const heroStats = useMemo(
    () => deriveMarketplaceHeroStats(platformStats, protocolFeeBps),
    [platformStats, protocolFeeBps]
  )

  const paidCallsValue = useMemo(
    () => (heroStats.paidCalls === null ? null : heroStats.paidCalls.toLocaleString()),
    [heroStats.paidCalls]
  )
  const paidCallsDetail = useMemo(() => {
    if (!platformStats) return 'Reading the shared paid-call ledger…'
    if (platformStats.source === 'unavailable' || heroStats.pendingCalls === null) {
      return 'The shared paid-call counter is unavailable right now.'
    }
    const updated = platformStats.updatedAt
      ? new Date(platformStats.updatedAt).toLocaleTimeString()
      : 'unknown'
    const scope =
      platformStats.source === 'memory' ? ' · local development counter, not shared' : ' · shared settlement ledger'
    return `${platformStats.settledCalls.toLocaleString()} settled · ${heroStats.pendingCalls.toLocaleString()} pending reconciliation · updated ${updated}${scope}`
  }, [platformStats, heroStats.pendingCalls])

  // Savings are the ledger's own totals compared against the Web2 baseline, so this is a
  // protocol-wide figure rather than the visitor's own spending history.
  const userSavingsValue = useMemo(
    () =>
      heroStats.userSavingsUsd === null
        ? null
        : heroStats.userSavingsUsd.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
    [heroStats.userSavingsUsd]
  )
  const userSavingsDetail = useMemo(() => {
    if (heroStats.userSavingsUsd === null || heroStats.paidCalls === null) {
      return 'The shared paid-call ledger is unavailable right now.'
    }
    const volume = platformStats ? platformStats.volumeUsdc.toFixed(3) : '0.000'
    return `${heroStats.paidCalls.toLocaleString()} accepted calls × $${WEB2_CALL_BASELINE_USD.toFixed(2)} Web2 baseline − ${volume} USDC paid · shared settlement ledger`
  }, [heroStats.userSavingsUsd, heroStats.paidCalls, platformStats])

  // A per-call fee at these prices is a few hundredths of a cent, so six decimals keep the figure
  // from reading as a structural zero.
  const protocolFeeValue = useMemo(
    () =>
      heroStats.protocolFeeUsdc === null
        ? null
        : `${heroStats.protocolFeeUsdc.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 6,
          })} USDC`,
    [heroStats.protocolFeeUsdc]
  )
  const protocolFeeDetail = useMemo(() => {
    if (heroStats.protocolFeeUsdc === null) return 'The shared paid-call ledger is unavailable right now.'
    const volume = platformStats ? platformStats.volumeUsdc.toFixed(3) : '0.000'
    if (protocolFeeBps === 0) {
      return `Every official service charges 0 bps, so nothing is deducted from the ${volume} USDC settled volume.`
    }
    return `${protocolFeeBps / 100}% of the ${volume} USDC gross settled volume, held by the protocol treasury until providers withdraw their net earnings.`
  }, [heroStats.protocolFeeUsdc, platformStats, protocolFeeBps])

  // The autonomous authority is the Session Key, owned by sessionKeyService — the same state
  // the copilot shows. This panel must never claim a capability the session key does not have.
  const [sessionConfig, setSessionConfig] = useState<SessionKeyConfig>(() =>
    getSessionKeyConfig(walletAddress)
  )
  useEffect(() => {
    const syncSessionConfig = () => setSessionConfig(getSessionKeyConfig(walletAddress))
    syncSessionConfig()
    window.addEventListener(SESSION_KEY_UPDATED_EVENT, syncSessionConfig)
    return () => window.removeEventListener(SESSION_KEY_UPDATED_EVENT, syncSessionConfig)
  }, [walletAddress])

  const sessionIsActive = sessionConfig.isActive && Date.now() <= sessionConfig.expiresAt

  const averageServicePriceUsdc = useMemo(() => {
    if (!services || services.length === 0) return 0.005
    const sum = services.reduce((acc, s) => acc + (s.pricing?.priceUsdc || 0), 0)
    return Math.max(0.001, sum / services.length)
  }, [services])

  const sessionTimeRemaining = useMemo(() => {
    if (!sessionIsActive || !sessionConfig.expiresAt) return null
    const diff = sessionConfig.expiresAt - Date.now()
    if (diff <= 0) return 'Expired'
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h left`
    if (hours > 0) return `${hours}h ${minutes}m left`
    return `${minutes}m left`
  }, [sessionIsActive, sessionConfig.expiresAt])

  const {
    telemetryMap,
    isProbing,
    getServiceTelemetry,
  } = useServiceTelemetry(services)

  // One server-measured reading, shared by every visitor. A per-browser probe average would let two
  // people read different numbers off the same protocol card, so an unreadable probe renders a dash
  // instead of falling back to this browser's own measurement.
  const { snapshot: sharedLatency } = useSharedLatency()
  const latencyValue = useMemo(() => {
    if (!sharedLatency || sharedLatency.source === 'unavailable' || sharedLatency.avgLatencyMs === null) {
      return null
    }
    return `${sharedLatency.avgLatencyMs} ms`
  }, [sharedLatency])
  const latencyDetail = useMemo(() => {
    if (!sharedLatency) return 'Reading the shared latency probe…'
    if (sharedLatency.source === 'unavailable' || sharedLatency.avgLatencyMs === null) {
      return 'The shared latency probe is unavailable right now.'
    }
    const measured = sharedLatency.measuredAt
      ? new Date(sharedLatency.measuredAt).toLocaleTimeString()
      : 'unknown'
    const scope =
      sharedLatency.source === 'memory'
        ? ' · local development measurement, not shared'
        : ' · shared server measurement'
    return `Arc Testnet RPC round-trip, averaged over ${sharedLatency.sampleCount} server samples · updated ${measured}${scope}`
  }, [sharedLatency])

  // Sorting and Displayed Services State
  const [sortBy, setSortBy] = useState<SortByOption>('default')
  const [isSortOpen, setIsSortOpen] = useState(false)
  const sortDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target as Node)) {
        setIsSortOpen(false)
      }
    }
    if (isSortOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isSortOpen])

  const currentSortConfig = useMemo(
    () => SORT_OPTIONS.find((s) => s.value === sortBy) || SORT_OPTIONS[0],
    [sortBy]
  )
  const ActiveSortIcon = currentSortConfig.icon

  const verifiedCount = useMemo(() => services.filter((s) => s.provider.isVerified).length, [services])
  const communityCount = useMemo(() => services.filter((s) => s.listing.kind === 'community').length, [services])

  const displayedServices = useMemo(() => {
    const list = [...filteredServices]
    if (sortBy === 'price_asc') {
      list.sort((a, b) => a.pricing.priceUsdc - b.pricing.priceUsdc)
    } else if (sortBy === 'price_desc') {
      list.sort((a, b) => b.pricing.priceUsdc - a.pricing.priceUsdc)
    } else if (sortBy === 'latency_asc') {
      list.sort((a, b) => {
        const latA = telemetryMap[a.id]?.latencyMs ?? a.sla.p95LatencyMs
        const latB = telemetryMap[b.id]?.latencyMs ?? b.sla.p95LatencyMs
        return latA - latB
      })
    } else if (sortBy === 'name_asc') {
      list.sort((a, b) => a.name.localeCompare(b.name))
    }
    return list
  }, [filteredServices, sortBy, telemetryMap])

  const isFiltered = searchQuery !== '' || filterCommunity !== 'all' || sortBy !== 'default'

  // Envelope figures are derived once so the band, the meter and the labels can never disagree.
  const effectiveMaxSpend = sessionIsActive ? sessionConfig.maxSpendUsdc || 0 : 0
  const effectiveSpent = sessionIsActive ? sessionConfig.spentUsdc || 0 : 0
  const remainingUsdc = Math.max(0, effectiveMaxSpend - effectiveSpent)
  const spentRatio =
    effectiveMaxSpend > 0 ? Math.min(1, Math.max(0, effectiveSpent / effectiveMaxSpend)) : 0
  const perTxCapUsdc = sessionIsActive ? sessionConfig.maxPerTxUsdc || 0 : 0
  const estimatedCallCount =
    sessionIsActive && averageServicePriceUsdc > 0
      ? Math.floor(remainingUsdc / averageServicePriceUsdc)
      : 0

  /** Opens a service with the inputs a recommendation was derived for. */
  const openServiceWithParams = (
    serviceId: string,
    params?: Record<string, unknown> | undefined
  ) => {
    const service = services.find((entry) => entry.id === serviceId)
    if (!service) return
    soundService.play('pop')
    setPendingPayload(params)
    openPlayground(service)
  }

  /** A plain card open: the playground starts from the service's own defaults. */
  const openService = (service: x402Service) => {
    soundService.play('pop')
    setPendingPayload(undefined)
    openPlayground(service)
  }

  const handleResetEnvelope = () => {
    soundService.play('pop')
    const current = getSessionKeyConfig(walletAddress)
    const updated: SessionKeyConfig = {
      ...current,
      sessionId: `sess_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      isActive: true,
      expiresAt: Date.now() + 24 * 3600 * 1000,
      maxSpendUsdc: 2.0,
      spentUsdc: 0.0,
      maxPerTxUsdc: 0.5,
      allowedActions:
        current.allowedActions?.length > 0
          ? current.allowedActions
          : [...DEFAULT_SESSION_KEY_CONFIG.allowedActions],
      createdAt: Date.now(),
    }
    saveSessionKeyConfig(updated, true, walletAddress)
    setSessionConfig(updated)
    handleResetBudget(2.0)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── HERO BANNER & STATS (DESIGN.md: .ub-hero-card) ── */}
      <div className="ub-hero-card">
        <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-x-6 gap-y-6 items-center">
          {/* Left Wing: Narrative & Protocol Entry Points */}
          <div className="space-y-4 flex flex-col justify-center lg:col-span-6">
            {/* Section Eyebrow (Space Mono with wide tracking) */}
            <div className="flex items-center gap-2">
              <span className="arc-eyebrow text-xs flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--earned-green)] animate-pulse shadow-[0_0_8px_var(--earned-green)]" />
                Arcis Protocol // Autonomous AI Services
              </span>
            </div>

            {/* Headline in Outfit */}
            <h1
              className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight leading-snug"
              style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
            >
              Autonomous Intelligence <br />
              <span className="text-gradient">Pay-Per-Call Micropayments</span>
            </h1>

            {/* Narrative Subtitle in Inter */}
            <p
              className="text-xs sm:text-sm leading-relaxed max-w-xl"
              style={{ color: 'var(--fp-3, rgba(255, 255, 255, 0.65))', fontFamily: 'var(--font-app)' }}
            >
              Zero monthly subscriptions, zero API key management. Direct on-chain autonomous execution settling on Arc Testnet via Circle Gateway x402 with sub-second finality.
            </p>
            <p
              className="text-[10px] sm:text-[11px] leading-relaxed max-w-xl"
              style={{ color: 'var(--fp-4, rgba(255, 255, 255, 0.45))', fontFamily: 'var(--fonts--space-mono)' }}
            >
              Payer scope: external EOA or Circle Wallet (UCW EOA). Passkey wallets cannot authorize a Gateway nanopayment yet.
            </p>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                onClick={() => {
                  soundService.play('pop')
                  setIsProviderHubOpen(true)
                }}
                className="ub-action-btn ub-action-btn-primary px-4 py-2.5 rounded-full text-xs font-semibold flex items-center gap-2 cursor-pointer shadow-lg transition-transform hover:scale-105 active:scale-95"
                style={{ fontFamily: 'var(--fonts--space-mono)' }}
              >
                <PiggyBank className="w-3.5 h-3.5 text-[var(--purple-1)]" />
                <span>Provider Hub & Earnings</span>
              </button>

              <button
                onClick={() => {
                  soundService.play('pop')
                  setIsRegisterModalOpen(true)
                }}
                className="ub-action-btn px-4 py-2.5 rounded-full text-xs font-semibold flex items-center gap-2 cursor-pointer transition-transform hover:scale-105 active:scale-95 text-white"
                style={{ fontFamily: 'var(--fonts--space-mono)' }}
              >
                <Plus className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)]" />
                <span>List Your AI Service</span>
              </button>
            </div>
          </div>

          {/* Live Ecosystem Stats Grid (Space Grotesk + ECG Heartbeat + Space Mono) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:col-span-6 content-center">
            <div
              className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-[var(--secondary-colors--sky-sync)]/30 transition-all duration-300"
              title={paidCallsDetail}
            >
              <span className="arc-eyebrow text-[11px] flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)]" />
                <span>Paid Calls</span>
              </span>
              <div
                className="text-lg font-bold text-white mt-1.5 tabular-nums"
                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                aria-label={paidCallsValue ? `Paid calls: ${paidCallsValue}` : 'Paid calls: unavailable'}
              >
                {paidCallsValue ?? '—'}
              </div>
            </div>

            <div
              className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-[var(--earned-green)]/30 transition-all duration-300"
              title={latencyDetail}
            >
              <span className="arc-eyebrow text-[11px] flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[var(--earned-green)]">
                  <Clock className="w-3.5 h-3.5 text-[var(--earned-green)]" />
                  <span>Avg. Latency</span>
                  <div className="ub-live-badge px-2 py-0.5" title="Shared server-measured Arc Testnet RPC round-trip">
                    <svg className="ub-ecg-svg" viewBox="0 0 35 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M0 8h10l3-5 4 13 4-15 4 10 3-3h10" className="ub-ecg-path-bg" />
                      <path d="M0 8h10l3-5 4 13 4-15 4 10 3-3h10" className="ub-ecg-path-pulse" />
                    </svg>
                  </div>
                </span>

              </span>
              <div className="flex items-center justify-between mt-1.5">
                <span
                  className="text-lg font-bold tabular-nums"
                  style={{
                    fontFamily: 'var(--fonts--space-grotesk)',
                    color: 'var(--earned-green)',
                  }}
                  aria-label={latencyValue ? `Average latency: ${latencyValue}` : 'Average latency: unavailable'}
                >
                  {latencyValue ?? '—'}
                </span>
              </div>
            </div>

            <div
              className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-[var(--secondary-colors--blockstream-gold)]/30 transition-all duration-300"
              title={userSavingsDetail}
            >
              <span className="arc-eyebrow text-[11px] flex items-center gap-1.5 text-[var(--secondary-colors--blockstream-gold)]">
                <PiggyBank className="w-3.5 h-3.5 text-[var(--secondary-colors--blockstream-gold)]" />
                <span>User Savings</span>
              </span>
              <div
                className="text-lg font-bold mt-1.5 tabular-nums text-[var(--secondary-colors--blockstream-gold)]"
                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                aria-label={userSavingsValue ? `User savings: $${userSavingsValue}` : 'User savings: unavailable'}
              >
                {userSavingsValue ? `$${userSavingsValue}` : '—'}
              </div>
            </div>

            <div
              className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-[var(--purple-1)]/30 transition-all duration-300"
              title={protocolFeeDetail}
            >
              <span className="arc-eyebrow text-[11px] flex items-center gap-1.5 text-[var(--purple-1)]">
                <Sparkles className="w-3.5 h-3.5 text-[var(--purple-1)]" />
                <span>Protocol Fee ({protocolFeeBps / 100}%)</span>
              </span>
              <div
                className="text-lg font-bold mt-1.5 tabular-nums text-[var(--purple-1)]"
                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                aria-label={protocolFeeValue ? `Protocol fee: ${protocolFeeValue}` : 'Protocol fee: unavailable'}
              >
                {protocolFeeValue ?? '—'}
              </div>
            </div>
          </div>

          {/* ── SESSION ENVELOPE (single-surface statement line) ── */}
          <section
            aria-label="Session envelope"
            className="w-full lg:col-span-12 border-t border-white/[0.07] pt-6 space-y-5"
          >
            {/* Header: label, live status, window, actions */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 min-w-0">
                <span className="arc-eyebrow text-[11px]">Session Envelope</span>
                <span className="w-px h-3 bg-white/10" aria-hidden="true" />
                <span
                  className={`flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider ${
                    sessionIsActive ? 'text-[var(--earned-green)]' : 'text-[var(--fp-4)]'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      sessionIsActive
                        ? 'bg-[var(--earned-green)] animate-pulse shadow-[0_0_6px_rgba(1,208,98,0.6)]'
                        : 'bg-[var(--fp-4)]'
                    }`}
                  />
                  {sessionIsActive ? 'Active' : 'Inactive'}
                </span>
                {sessionIsActive && sessionTimeRemaining && (
                  <>
                    <span className="w-px h-3 bg-white/10" aria-hidden="true" />
                    <span className="flex items-center gap-1.5 text-[11px] font-mono text-[var(--fp-4)]">
                      <Clock className="w-3 h-3 text-[var(--secondary-colors--sky-sync)]" />
                      {sessionTimeRemaining}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    soundService.play('pop')
                    setIsSessionModalOpen(true)
                  }}
                  className={`ub-action-btn py-1.5 px-3.5 text-[11px] flex items-center gap-1.5 cursor-pointer ${
                    sessionIsActive ? '' : 'ub-action-btn-primary'
                  }`}
                  style={{ fontFamily: 'var(--fonts--space-mono)' }}
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Figure */}
            <div className="flex items-baseline gap-2.5 min-w-0">
              <span
                className={`text-[42px] sm:text-[48px] leading-none tabular-nums ${
                  sessionIsActive ? 'text-white' : 'text-[var(--fp-3)]'
                }`}
                style={{
                  fontFamily: 'var(--fonts--space-grotesk)',
                  fontWeight: 400,
                  letterSpacing: '-1.5px',
                }}
              >
                {remainingUsdc.toFixed(2)}
              </span>
              <span className="text-[11px] font-mono uppercase tracking-[2px] text-[var(--fp-3)]">
                USDC
              </span>
              <span className="text-[11px] font-mono text-[var(--fp-4)]">
                {sessionIsActive ? `of ${effectiveMaxSpend.toFixed(2)} cap` : 'Not configured'}
              </span>
            </div>

            {/* Rail + ledger line */}
            <div className="space-y-2.5">
              <div
                className="relative h-1"
                role="progressbar"
                aria-label="Session envelope spent"
                aria-valuemin={0}
                aria-valuemax={effectiveMaxSpend > 0 ? effectiveMaxSpend : 1}
                aria-valuenow={effectiveSpent}
              >
                <div className="absolute inset-0 rounded-full bg-white/[0.06]" />
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700"
                  style={{
                    width: `${spentRatio * 100}%`,
                    background:
                      'linear-gradient(90deg, var(--color-brand-secondary) 0%, var(--color-brand-primary) 50%, var(--color-brand-accent) 100%)',
                    boxShadow:
                      sessionIsActive && spentRatio > 0
                        ? '0 0 12px rgba(152, 150, 255, 0.35)'
                        : undefined,
                    transitionTimingFunction: 'var(--ease-out-smooth)',
                  }}
                />
                {sessionIsActive && spentRatio > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 -translate-y-1/2 w-[7px] h-[7px] rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.65)]"
                    style={{ left: `calc(${spentRatio * 100}% - 3.5px)` }}
                  />
                )}
                {sessionIsActive && perTxCapUsdc > 0 && effectiveMaxSpend > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-[3px] w-px h-[10px] bg-white/25"
                    style={{
                      left: `${Math.min(100, (perTxCapUsdc / effectiveMaxSpend) * 100)}%`,
                    }}
                  />
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] font-mono text-[var(--fp-4)]">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span>
                    <span className="text-[var(--fp-2)] tabular-nums">
                      {effectiveSpent.toFixed(2)}
                    </span>{' '}
                    spent
                  </span>
                  <span className="text-white/15" aria-hidden="true">
                    /
                  </span>
                  <span>
                    <span className="text-[var(--fp-2)] tabular-nums">
                      {perTxCapUsdc.toFixed(2)}
                    </span>{' '}
                    per tx
                  </span>
                  <span className="text-white/15" aria-hidden="true">
                    /
                  </span>
                  <span className="flex items-center gap-1">
                    <Zap
                      className={`w-3 h-3 ${
                        sessionIsActive ? 'text-[var(--color-brand-accent)]' : 'text-[var(--fp-4)]'
                      }`}
                    />
                    {sessionIsActive
                      ? `~${estimatedCallCount > 9999 ? '9999+' : estimatedCallCount} calls`
                      : '0 calls'}
                  </span>
                </div>
                <span
                  className={`tabular-nums ${
                    sessionIsActive ? 'text-[var(--fp-3)]' : 'text-[var(--fp-4)]'
                  }`}
                >
                  {Math.round(spentRatio * 100)}% used
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* ── NEXT STEP RAIL (derived from this wallet's own paid reports) ── */}
      {walletAddress && (
        <NextStepRail
          recommendations={nextSteps}
          onOpen={(recommendation) =>
            openServiceWithParams(recommendation.action.serviceId, recommendation.action.params)
          }
        />
      )}

      {/* ── UNIFIED FILTER & SEARCH COMMAND BAR (DESIGN.md: .glass-panel & .ub-action-btn) ── */}
      <div className={`glass-panel rounded-2xl p-2.5 sm:p-3 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 shadow-xl relative transition-all duration-200 ${isSortOpen ? 'z-30' : 'z-20'}`}>
        {/* Left Group: Search Input + Segmented Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 min-w-0">
          {/* Quick Search Input */}
          <div className="relative w-full sm:w-72 md:w-80 lg:w-72 xl:w-80 flex-shrink-0">
            <Search className="w-4 h-4 text-white/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search AI services by name or tag..."
              className="w-full h-9 pl-9 pr-9 rounded-xl border border-white/10 text-xs text-white placeholder-white/40 focus:outline-none focus:border-[var(--purple-1)] focus:ring-1 focus:ring-[var(--purple-1)]/30 transition font-medium"
              style={{ background: 'rgba(9, 11, 20, 0.85)' }}
            />
            {searchQuery && (
              <button
                onClick={() => {
                  soundService.play('pop')
                  setSearchQuery('')
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Source Segmented Control (All / Verified / Community) */}
          <div
            className="flex items-center gap-1 p-1 h-9 rounded-xl border border-white/10 text-xs flex-shrink-0 overflow-x-auto"
            style={{ background: 'rgba(9, 11, 20, 0.85)' }}
          >
            <button
              onClick={() => {
                soundService.play('pop')
                setFilterCommunity('all')
              }}
              className={`flex items-center gap-1.5 px-3 h-full rounded-lg transition font-medium text-xs cursor-pointer ${filterCommunity === 'all'
                  ? 'bg-[var(--primary-colors--validator-blue)] text-white shadow-sm font-semibold border border-[var(--secondary-colors--sky-sync)]/30'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
            >
              <Globe className="w-3 h-3 text-[var(--secondary-colors--sky-sync)]" />
              <span>All</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${filterCommunity === 'all' ? 'bg-white/20 text-white' : 'bg-white/5 text-white/50'
                  }`}
              >
                {services.length}
              </span>
            </button>

            <button
              onClick={() => {
                soundService.play('pop')
                setFilterCommunity('verified')
              }}
              className={`flex items-center gap-1.5 px-3 h-full rounded-lg transition font-medium text-xs cursor-pointer ${filterCommunity === 'verified'
                  ? 'bg-[var(--primary-colors--validator-blue)] text-white shadow-sm font-semibold border border-[var(--secondary-colors--sky-sync)]/30'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
            >
              <ShieldCheck className="w-3 h-3 text-[var(--earned-green)]" />
              <span>Verified</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${filterCommunity === 'verified' ? 'bg-white/20 text-white' : 'bg-white/5 text-white/50'
                  }`}
              >
                {verifiedCount}
              </span>
            </button>

            <button
              onClick={() => {
                soundService.play('pop')
                setFilterCommunity('community')
              }}
              className={`flex items-center gap-1.5 px-3 h-full rounded-lg transition font-medium text-xs cursor-pointer ${filterCommunity === 'community'
                  ? 'bg-[var(--primary-colors--validator-blue)] text-white shadow-sm font-semibold border border-[var(--secondary-colors--sky-sync)]/30'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
            >
              <Users className="w-3 h-3 text-[var(--secondary-colors--sky-sync)]" />
              <span>Community</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${filterCommunity === 'community' ? 'bg-white/20 text-white' : 'bg-white/5 text-white/50'
                  }`}
              >
                {communityCount}
              </span>
            </button>
          </div>
        </div>

        {/* Right Group: Sort Select + Live Sync Status */}
        <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap justify-end flex-shrink-0">
          {/* Theme-Tailored Custom Sort Dropdown */}
          <div className={`relative ${isSortOpen ? 'z-50' : 'z-10'}`} ref={sortDropdownRef}>
            <button
              type="button"
              onClick={() => {
                soundService.play('pop')
                setIsSortOpen((prev) => !prev)
              }}
              aria-haspopup="listbox"
              aria-expanded={isSortOpen}
              className={`h-9 px-3 rounded-xl border flex items-center gap-2 text-xs transition-all duration-200 cursor-pointer select-none ${
                sortBy !== 'default'
                  ? 'border-[var(--purple-1)]/50 bg-[var(--purple-1)]/10 text-white shadow-[0_0_14px_rgba(152,150,255,0.18)]'
                  : 'border-white/10 text-white/80 hover:text-white hover:border-white/20'
              }`}
              style={{
                background: sortBy !== 'default' ? undefined : 'rgba(9, 11, 20, 0.85)',
                fontFamily: 'var(--fonts--space-mono)',
              }}
            >
              <ActiveSortIcon
                className={`w-3.5 h-3.5 ${
                  sortBy !== 'default' ? 'text-[var(--purple-1)]' : 'text-white/50'
                }`}
              />
              <span className="font-medium whitespace-nowrap">{currentSortConfig.label}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-white/40 transition-transform duration-200 ${
                  isSortOpen ? 'rotate-180 text-[var(--purple-1)]' : ''
                }`}
              />
            </button>

            {isSortOpen && (
              <div
                role="listbox"
                className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 z-50 w-64 sm:w-72 max-w-[calc(100vw-2rem)] rounded-2xl p-2 shadow-2xl backdrop-blur-2xl animate-fade-in"
                style={{
                  background: 'rgba(12, 15, 26, 0.98)',
                  border: '1px solid rgba(152, 150, 255, 0.25)',
                  boxShadow: '0 20px 48px -8px rgba(0, 0, 0, 0.8), 0 0 1px 1px rgba(255, 255, 255, 0.06)',
                  fontFamily: 'var(--fonts--space-mono)',
                }}
              >
                <div className="px-3 py-2 text-[10px] text-[var(--secondary-colors--sky-sync)] font-semibold uppercase tracking-wider border-b border-white/[0.06] flex items-center justify-between mb-1.5">
                  <span>Sort Catalog</span>                </div>
                <div className="space-y-1">
                  {SORT_OPTIONS.map((opt) => {
                    const isSelected = sortBy === opt.value
                    const IconComp = opt.icon
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => {
                          soundService.play('pop')
                          setSortBy(opt.value)
                          setIsSortOpen(false)
                        }}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs transition-all cursor-pointer select-none text-left ${
                          isSelected
                            ? 'bg-[var(--purple-1)]/15 text-white border border-[var(--purple-1)]/30 shadow-[0_0_12px_rgba(152,150,255,0.15)] font-semibold'
                            : 'text-white/70 hover:text-white hover:bg-white/[0.06] border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <IconComp
                            className={`w-3.5 h-3.5 flex-shrink-0 ${
                              isSelected ? 'text-[var(--purple-1)]' : 'text-white/40'
                            }`}
                          />
                          <span className="truncate">{opt.label}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          {opt.badge && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                              {opt.badge}
                            </span>
                          )}
                          {isSelected && <Check className="w-3.5 h-3.5 text-[var(--purple-1)]" />}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Live Network Auto-Sync Status Indicator */}
          <div
            className="ub-live-badge h-9 px-3 gap-2"
            title="Physical network latency to Arc Testnet is auto-probed in real-time every 20s"
          >
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isProbing ? 'bg-cyan-400' : 'bg-[var(--earned-green)]'
                  }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${isProbing ? 'bg-cyan-400' : 'bg-[var(--earned-green)]'
                  }`}
              />
            </span>
            <span
              className="font-mono text-[10px] tracking-wider"
              style={{ color: isProbing ? '#38bdf8' : 'var(--earned-green)' }}
            >
              {isProbing ? 'PROBING...' : 'LIVE'}
            </span>
          </div>
        </div>
      </div>

      {/* ── SERVICE CARDS GRID (DESIGN.md: .arc-card & .glow-card) ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 relative z-0">
        {displayedServices.map((service) => {
          const telemetry = getServiceTelemetry(service)
          const lastMeasurement = digestsByService.get(service.id)
          return (
            <div
              key={service.id}
              onClick={() => openService(service)}
              className="arc-card glow-card flex flex-col justify-between group cursor-pointer"
              style={{
                padding: '24px',
                borderRadius: '20px',
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid rgba(47, 87, 140, 0.35)',
              }}
            >
              <div className="space-y-4">
                {/* Card Top: Category & Institutional Price Tag */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="text-[10px] font-semibold uppercase px-2.5 py-1 rounded-full border"
                      style={{
                        fontFamily: 'var(--fonts--space-mono)',
                        color: 'var(--secondary-colors--sky-sync)',
                        backgroundColor: 'rgba(172, 198, 233, 0.08)',
                        borderColor: 'rgba(172, 198, 233, 0.25)',
                        letterSpacing: '1px',
                      }}
                    >
                      {service.category}
                    </span>
                    {service.listing.kind === 'community' && (
                      <span
                        className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border"
                        style={{
                          fontFamily: 'var(--fonts--space-mono)',
                          color: '#38bdf8',
                          backgroundColor: 'rgba(56, 189, 248, 0.1)',
                          borderColor: 'rgba(56, 189, 248, 0.3)',
                        }}
                      >
                        Community
                      </span>
                    )}
                  </div>

                  {/* Clean Corporate USDC Price Tag */}
                  <div
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border border-white/10 shadow-sm transition-all group-hover:border-[var(--purple-1)]/40"
                    style={{ background: 'rgba(8, 10, 18, 0.85)' }}
                    title={`Native Arc x402 Micropayment: ${service.pricing.priceUsdc} USDC per call`}
                  >
                    <img
                      src={UsdcIcon}
                      alt="USDC"
                      className="w-4 h-4 rounded-full flex-shrink-0 object-contain shadow-xs"
                    />
                    <div className="flex items-baseline gap-1">
                      <span
                        className="font-bold text-white tracking-tight tabular-nums text-sm"
                        style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                      >
                        {service.pricing.priceUsdc}
                      </span>
                      <span
                        className="text-[10px] font-semibold text-[var(--secondary-colors--sky-sync)] uppercase tracking-wider"
                        style={{ fontFamily: 'var(--fonts--space-mono)' }}
                      >
                        USDC
                      </span>
                      <span className="text-[10px] text-white/40 font-normal">
                        /call
                      </span>
                    </div>
                  </div>
                </div>

                {/* Title & Tagline */}
                <div>
                  <h3
                    className="text-base sm:text-lg font-bold text-white transition flex items-center justify-between"
                    style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                  >
                    <span>{service.name}</span>
                  </h3>
                  <p
                    className="text-xs line-clamp-2 mt-1.5 leading-relaxed"
                    style={{ color: 'var(--fp-3, rgba(255, 255, 255, 0.65))', fontFamily: 'var(--font-app)' }}
                  >
                    {service.description}
                  </p>
                </div>

                {/* Last measurement this wallet actually bought, with its age */}
                {lastMeasurement && (
                  <LastMeasurementBadge digest={lastMeasurement} now={digestNow} />
                )}

                {/* Tags */}
                <div className="flex flex-wrap gap-1.5">
                  {service.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded-md text-[10px] font-mono border"
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        borderColor: 'rgba(255, 255, 255, 0.06)',
                        color: 'var(--secondary-colors--sky-sync)',
                      }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Card Footer: Metrics & Launch Agent Action */}
              <div className="mt-5 space-y-3 pt-3 border-t border-white/[0.06]">
                {/* Live Verified Performance Metrics (Ping on left, Success on right) */}
                <div className="flex items-center justify-between text-[11px]">
                  <div
                    className="flex items-center gap-1.5 text-white/60"
                    title={`Live physical latency: ${telemetry.latencyMs}ms • Measured from browser to Arc Testnet/endpoint • Samples: ${telemetry.sampleCount}`}
                  >
                    <span className="relative flex h-2 w-2">
                      <span
                        className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                          telemetry.status === 'offline'
                            ? 'bg-rose-400'
                            : telemetry.status === 'degraded'
                            ? 'bg-amber-400'
                            : 'bg-[var(--earned-green)]'
                        }`}
                      />
                      <span
                        className={`relative inline-flex rounded-full h-2 w-2 ${
                          telemetry.status === 'offline'
                            ? 'bg-rose-500'
                            : telemetry.status === 'degraded'
                            ? 'bg-amber-500'
                            : 'bg-[var(--earned-green)]'
                        }`}
                      />
                    </span>
                    <span style={{ fontFamily: 'var(--fonts--space-mono)' }}>
                      Ping: <strong className="text-white tabular-nums">{telemetry.latencyMs}ms</strong>
                    </span>
                  </div>

                  <div
                    className="flex items-center gap-1.5 text-white/60"
                    title={`Calculated Success Rate: ${telemetry.successRate}% across ${telemetry.sampleCount} real runs/probes`}
                  >
                    <TrendingUp className="w-3.5 h-3.5 text-[var(--earned-green)]" />
                    <span style={{ fontFamily: 'var(--fonts--space-mono)' }}>
                      Success: <strong className="text-[var(--earned-green)] tabular-nums">{telemetry.successRate}%</strong>
                    </span>
                  </div>
                </div>

                {/* Why the last paid call was voided — the same reason the playground names */}
                {telemetry.lastFailure && (
                  <div
                    title={`${telemetry.lastFailure.detail} — nothing was charged. Open the agent console for the full reason.`}
                    className="flex items-start gap-1.5 text-[10px] leading-snug rounded-lg border border-rose-500/25 bg-rose-500/[0.06] px-2 py-1.5 text-rose-200/90"
                    style={{ fontFamily: 'var(--fonts--space-mono)' }}
                  >
                    <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0 text-rose-400" />
                    <span className="min-w-0">
                      Last call voided: {telemetry.lastFailure.label} — no charge
                    </span>
                  </div>
                )}

                {/* Card Action Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    openService(service)
                  }}
                  className="arc-btn arc-btn-primary w-full py-2.5 px-4 rounded-full text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-lg tracking-wider group-hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Zap className="w-3.5 h-3.5 text-black" />
                  <span>LAUNCH AGENT</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {displayedServices.length === 0 && (
        <div className="glass-panel py-16 text-center space-y-2 p-8 rounded-2xl">
          <Search className="w-10 h-10 mx-auto text-white/20" />
          <p className="text-sm font-semibold text-white">No x402 AI services match your search or filters.</p>
          <p className="text-xs text-white/50">Try adjusting keywords, selecting another category, or resetting all filters.</p>
          <button
            onClick={() => {
              soundService.play('pop')
              setSelectedCategory('All')
              setSearchQuery('')
              setFilterCommunity('all')
              setSortBy('default')
            }}
            className="arc-btn arc-btn-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold cursor-pointer shadow-lg mt-5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>RESET ALL FILTERS</span>
          </button>
        </div>
      )}

      {/* ── PROVIDER HUB MODAL ── */}
      <ProviderHubModal
        isOpen={isProviderHubOpen}
        onClose={() => setIsProviderHubOpen(false)}
        walletAddress={walletAddress}
        provider={provider}
        authSource={authSource}
        ucwSignTypedData={ucwSignTypedData}
        services={services}
        onOpenRegister={() => setIsRegisterModalOpen(true)}
      />

      {/* ── REGISTER SERVICE MODAL ── */}
      <RegisterServiceModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        walletAddress={walletAddress}
        provider={provider}
        authSource={authSource}
        ucwSignTypedData={ucwSignTypedData}
        onRegisterService={registerService}
      />

      {/* ── INTERACTIVE PLAYGROUND MODAL ── */}
      <ServicePlaygroundModal
        isOpen={isPlaygroundOpen}
        onClose={closePlayground}
        service={activeService}
        initialPayload={pendingPayload}
        isExecuting={isExecuting}
        executionResult={executionResult}
        onExecute={runService}
        sessionBudget={sessionBudget}
        walletAddress={walletAddress}
        authSource={authSource}
        ucwSignerAvailable={Boolean(ucwSignTypedData)}
        ucwHandlers={ucwHandlers}
        onNavigateTab={onNavigate}
      />

      {/* ── SESSION BUDGET & KEY MANAGER MODAL (ADR-004) ── */}
      <SessionBudgetModal
        isOpen={isSessionModalOpen}
        onClose={() => setIsSessionModalOpen(false)}
        walletAddress={walletAddress}
        onBudgetUpdated={(newMax) => {
          handleResetBudget(newMax)
        }}
      />
    </div>
  )
}
