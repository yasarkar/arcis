import { useState, useMemo, useEffect } from 'react'
import {
  Zap,
  TrendingUp,
  Clock,
  ShieldCheck,
  Search,
  Sparkles,
  RefreshCw,
  Activity,
  PiggyBank,
  Plus,
  ArrowUpDown,
  Globe,
  Users,
  X,
} from 'lucide-react'
import { useMarketplaceServices } from '../../hooks/useMarketplaceServices'
import { useServiceTelemetry } from '../../hooks/useServiceTelemetry'
import {
  getSessionKeyConfig,
  SESSION_KEY_UPDATED_EVENT,
} from '../../services/sessionKeyService'
import type { SessionKeyConfig } from '../../types/sessionKey'
import { ecosystemStatsService } from '../../services/ecosystemStatsService'
import ServicePlaygroundModal from './ServicePlaygroundModal'
import ProviderHubModal from './ProviderHubModal'
import RegisterServiceModal from './RegisterServiceModal'
import SessionBudgetModal from './SessionBudgetModal'
import { soundService } from '../../services/soundService'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'

interface MarketplaceTabProps {
  walletAddress?: string
  walletConnected?: boolean
  provider?: any
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  onNavigate?: (tab: string) => void
}

export default function MarketplaceTab({
  walletAddress,
  walletConnected: _walletConnected,
  provider,
  authSource,
  onNavigate,
}: MarketplaceTabProps) {
  const {
    services,
    filteredServices,
    stats,
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
  } = useMarketplaceServices(walletAddress, provider, authSource)

  const [isSessionModalOpen, setIsSessionModalOpen] = useState<boolean>(false)

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

  const {
    telemetryMap,
    isProbing,
    getServiceTelemetry,
  } = useServiceTelemetry(services)

  const liveAvgLatency = useMemo(() => {
    const values = Object.values(telemetryMap)
    if (values.length === 0) return stats.averageResponseTimeMs
    const sum = values.reduce((acc, v) => acc + v.latencyMs, 0)
    return Math.round(sum / values.length)
  }, [telemetryMap, stats.averageResponseTimeMs])

  useEffect(() => {
    if (liveAvgLatency > 0) {
      ecosystemStatsService.updateLiveLatency(liveAvgLatency)
    }
  }, [liveAvgLatency])

  // Sorting and Displayed Services State
  const [sortBy, setSortBy] = useState<'default' | 'price_asc' | 'price_desc' | 'latency_asc' | 'name_asc'>('default')

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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── HERO BANNER & STATS ── */}
      <div
        className="relative rounded-3xl p-6 md:p-8 overflow-hidden border border-indigo-500/20 shadow-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(16, 18, 32, 0.95) 0%, rgba(20, 15, 38, 0.95) 50%, rgba(10, 14, 28, 0.95) 100%)',
          boxShadow: '0 20px 50px -10px rgba(99, 102, 241, 0.15)',
        }}
      >
        {/* Glow ambient spots */}
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-indigo-500/20 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-cyan-500/15 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight leading-snug">
              Arcis AI Services Marketplace <br />
              <span className="text-gradient">Pay-Per-Call Micropayments</span>
            </h1>

            <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
              Say goodbye to $50+/mo fixed SaaS subscriptions and API key overhead. Access sub-second arbitrage signals, liquidity depth, and slippage optimization on Arc L1.
            </p>

            {/* Provider & Monetization Quick Actions */}
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                onClick={() => {
                  soundService.play('pop')
                  setIsProviderHubOpen(true)
                }}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:brightness-110 text-white text-xs font-bold transition flex items-center gap-2 shadow-md shadow-indigo-600/25 cursor-pointer"
              >
                <PiggyBank className="w-3.5 h-3.5" />
                <span>Provider Hub & Earnings</span>
              </button>

              <button
                onClick={() => {
                  soundService.play('pop')
                  setIsRegisterModalOpen(true)
                }}
                className="px-4 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-850 text-indigo-300 hover:text-white border border-indigo-500/30 text-xs font-bold transition flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>List Your AI Service</span>
              </button>
            </div>
          </div>

          {/* Session Budget Quick Controller Card */}
          <div
            className="flex-shrink-0 p-4 rounded-2xl border border-indigo-500/30 bg-slate-950/60 backdrop-blur-xl w-full lg:w-80 space-y-3"
            style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-bold text-slate-200">Session Budget</span>
              </div>
              <button
                onClick={() => handleResetBudget(1.0)}
                className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-lg font-extrabold text-white font-mono">
                  {sessionBudget.spentUsdc.toFixed(4)}
                </span>
                <span className="text-xs text-slate-400 font-mono"> / {sessionBudget.maxBudgetUsdc.toFixed(2)} USDC</span>
              </div>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${sessionIsActive
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-800/80 text-slate-400 border-slate-700/70'
                  }`}
                title="A local spend ceiling for this browser. It is not an authorization: activating a Session Key is what allows unprompted calls."
              >
                Local Spend Cap
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-500 rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (sessionBudget.spentUsdc / sessionBudget.maxBudgetUsdc) * 100)}%`,
                }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
              <span>Autonomous authorization:</span>
              <span className={`font-semibold ${sessionIsActive ? 'text-emerald-400' : 'text-slate-500'}`}>
                {sessionIsActive ? 'Session Key active' : 'None — each call needs your Execute'}
              </span>
            </div>

            <button
              onClick={() => {
                soundService.play('pop')
                setIsSessionModalOpen(true)
              }}
              className="w-full py-1.5 px-3 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-white hover:text-white border border-indigo-500/30 text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              <span>Manage Key & Budget</span>
            </button>
          </div>
        </div>

        {/* Live Ecosystem Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-800/80">
          <div className="p-3.5 rounded-2xl bg-slate-900/50 border border-slate-800/80 hover:border-cyan-500/30 transition-all duration-300 shadow-sm group">
            <span className="text-[12px] text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-cyan-400" />
                <span>Total x402 Calls</span>
              </span>
            </span>
            <div className="text-base font-bold text-white font-mono mt-1 tracking-tight">
              {stats.totalCallsProcessed.toLocaleString()}
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-900/50 border border-slate-800/80 hover:border-emerald-500/30 transition-all duration-300 shadow-sm group">
            <span className="text-[12px] text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Avg. Latency</span>
              </span>
            </span>
            <div className="text-base font-bold text-emerald-400 font-mono mt-1 flex items-center gap-2 tracking-tight">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>{liveAvgLatency} ms</span>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-900/50 border border-slate-800/80 hover:border-amber-500/30 transition-all duration-300 shadow-sm group">
            <span className="text-[12px] text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <PiggyBank className="w-3.5 h-3.5 text-amber-400" />
                <span>User Savings</span>
              </span>
            </span>
            <div className="text-base font-bold text-amber-300 font-mono mt-1 tracking-tight">
              ${stats.savedSubscriptionCostUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-slate-900/50 border border-slate-800/80 hover:border-purple-500/30 transition-all duration-300 shadow-sm group">
            <span className="text-[12px] text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>YieldVault Share (1%)</span>
              </span>
            </span>
            <div className="text-base font-bold text-purple-300 font-mono mt-1 tracking-tight">
              +{stats.totalYieldGeneratedUsdc.toFixed(2)} USDC
            </div>
          </div>
        </div>
      </div>

      {/* ── UNIFIED FILTER & SEARCH COMMAND BAR ── */}
      <div className="space-y-3.5">
        {/* Top Control Strip: Search Box + Segment Tabs + Sort + Sync Status */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 p-2 md:p-2.5 rounded-2xl bg-slate-900/70 border border-slate-800/90 shadow-lg backdrop-blur-md">
          {/* Left Group: Search Input + Segmented Buttons (All / Verified / Community) */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 min-w-0">
            {/* Quick Search Input */}
            <div className="relative w-full sm:w-72 md:w-80 lg:w-72 xl:w-80 flex-shrink-0">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search AI services by name or tag..."
                className="w-full h-9 pl-9 pr-9 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition font-medium"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    soundService.play('pop')
                    setSearchQuery('')
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Source Segmented Control (All / Verified / Community) immediately to the right of search bar */}
            <div className="flex items-center gap-1 p-1 h-9 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs flex-shrink-0 overflow-x-auto">
              <button
                onClick={() => {
                  soundService.play('pop')
                  setFilterCommunity('all')
                }}
                className={`flex items-center gap-1.5 px-3 h-full rounded-lg transition font-medium text-xs cursor-pointer ${filterCommunity === 'all'
                    ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-850'
                  }`}
              >
                <Globe className="w-3 h-3 text-slate-300" />
                <span>All</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${filterCommunity === 'all' ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-800 text-slate-400'
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
                    ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-850'
                  }`}
              >
                <ShieldCheck className="w-3 h-3 text-slate-300" />
                <span>Verified</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${filterCommunity === 'verified' ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-800 text-slate-400'
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
                    ? 'bg-indigo-600 text-white shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-white hover:bg-slate-850'
                  }`}
              >
                <Users className="w-3 h-3 text-slate-300" />
                <span>Community</span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono ${filterCommunity === 'community' ? 'bg-indigo-700 text-indigo-100' : 'bg-slate-800 text-slate-400'
                    }`}
                >
                  {communityCount}
                </span>
              </button>
            </div>
          </div>

          {/* Right Group: Sort Select + Live Sync Status */}
          <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap justify-end flex-shrink-0">
            {/* Smart Sort Dropdown */}
            <div className="relative h-9">
              <select
                value={sortBy}
                onChange={(e) => {
                  soundService.play('pop')
                  setSortBy(e.target.value as any)
                }}
                className="h-9 appearance-none pl-8 pr-8 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs text-slate-300 hover:text-white focus:outline-none focus:border-indigo-500 transition cursor-pointer font-medium flex items-center"
              >
                <option value="default">Sort: Default</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="latency_asc">Latency: Fastest</option>
                <option value="name_asc">Name: A to Z</option>
              </select>
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Live Network Auto-Sync Status Indicator */}
            <div
              className="h-9 flex items-center gap-2 px-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs text-slate-400 select-none whitespace-nowrap"
              title="Physical network latency to Arc Testnet is auto-probed in real-time every 20s"
            >
              <span className="relative flex h-2 w-2">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isProbing ? 'bg-cyan-400' : 'bg-emerald-400'
                    }`}
                />
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${isProbing ? 'bg-cyan-400' : 'bg-emerald-500'
                    }`}
                />
              </span>
              <span className="text-slate-300 font-mono text-[11px]">
                {isProbing ? 'Syncing...' : 'Auto-Sync'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── SERVICE CARDS GRID ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {displayedServices.map((service) => {
          const telemetry = getServiceTelemetry(service)
          return (
            <div
              key={service.id}
              onClick={() => {
                soundService.play('pop')
                openPlayground(service)
              }}
              className="rounded-2xl p-5 border border-slate-800/80 bg-slate-900/50 hover:border-indigo-500/40 hover:bg-slate-900/80 transition-all duration-300 flex flex-col justify-between group shadow-lg hover:shadow-indigo-500/10 cursor-pointer"
            >
              <div className="space-y-4">
                {/* Card Top: Category & Institutional Price Tag */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-semibold uppercase px-2.5 py-1 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                      {service.category}
                    </span>
                    {service.listing.kind === 'community' && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                        Community
                      </span>
                    )}
                  </div>

                  {/* Clean Corporate USDC Price Tag */}
                  <div
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-950/90 border border-slate-800/90 text-xs shadow-sm group-hover:border-slate-700 group-hover:bg-slate-900/90 transition-all"
                    title={`Native Arc x402 Micropayment: ${service.pricing.priceUsdc} USDC per call`}
                  >
                    <img
                      src={UsdcIcon}
                      alt="USDC"
                      className="w-4 h-4 rounded-full flex-shrink-0 object-contain shadow-xs"
                    />
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono font-bold text-slate-100 tracking-tight">
                        {service.pricing.priceUsdc}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                        USDC
                      </span>
                      <span className="text-[10px] text-slate-500 font-normal">
                        /call
                      </span>
                    </div>
                  </div>
                </div>

                {/* Title & Tagline */}
                <div>
                  <h3 className="text-base font-bold text-white transition flex items-center justify-between">
                    <span>{service.name}</span>
                  </h3>
                  <p className="text-xs text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                    {service.description}
                  </p>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1.5">
                  {service.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded-md bg-slate-800/70 border border-slate-700/60 text-[11px] font-mono text-slate-400"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>

                {/* Live Verified Performance Metrics */}
                <div className="grid grid-cols-2 gap-8 pt-2 border-t border-slate-800/60 text-[12px]">
                  <div
                    className="flex items-center gap-1.5 text-slate-400"
                    title={`Live physical latency: ${telemetry.latencyMs}ms • Measured from browser to Arc Testnet/endpoint • Samples: ${telemetry.sampleCount}`}
                  >
                    <span className="relative flex h-2 w-2">
                      <span
                        className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${telemetry.status === 'offline'
                            ? 'bg-rose-400'
                            : telemetry.status === 'degraded'
                              ? 'bg-amber-400'
                              : 'bg-emerald-400'
                          }`}
                      />
                      <span
                        className={`relative inline-flex rounded-full h-2 w-2 ${telemetry.status === 'offline'
                            ? 'bg-rose-500'
                            : telemetry.status === 'degraded'
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                          }`}
                      />
                    </span>
                    <span>
                      Live: <strong className="text-slate-200 font-mono">{telemetry.latencyMs}ms</strong>
                    </span>
                  </div>

                  <div
                    className="flex items-center gap-1.5 text-slate-400"
                    title={`Calculated Success Rate: ${telemetry.successRate}% across ${telemetry.sampleCount} real runs/probes`}
                  >
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                    <span>
                      Success: <strong className="text-emerald-300 font-mono">{telemetry.successRate}%</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Card Footer Actions */}
              <div className="mt-5 pt-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    soundService.play('pop')
                    openPlayground(service)
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:brightness-110 text-white text-xs font-bold transition flex items-center justify-center gap-2 shadow-md shadow-indigo-600/20 cursor-pointer tracking-wide group-hover:shadow-indigo-500/30"
                >
                  <Zap className="w-3.5 h-3.5 text-cyan-300" />
                  <span>Launch Agent Console</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {displayedServices.length === 0 && (
        <div className="py-16 text-center text-slate-400 space-y-2.5 p-8 rounded-2xl bg-slate-900/40 border border-slate-800/60">
          <Search className="w-10 h-10 mx-auto text-slate-600" />
          <p className="text-sm text-slate-300 font-medium">No x402 AI services match your search or filters.</p>
          <p className="text-xs text-slate-500">Try adjusting keywords, selecting another category, or resetting all filters.</p>
          <button
            onClick={() => {
              soundService.play('pop')
              setSelectedCategory('All')
              setSearchQuery('')
              setFilterCommunity('all')
              setSortBy('default')
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition cursor-pointer shadow-md shadow-indigo-600/20"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reset All Filters</span>
          </button>
        </div>
      )}

      {/* ── PROVIDER HUB MODAL ── */}
      <ProviderHubModal
        isOpen={isProviderHubOpen}
        onClose={() => setIsProviderHubOpen(false)}
        walletAddress={walletAddress}
        provider={provider}
        services={services}
        onOpenRegister={() => setIsRegisterModalOpen(true)}
      />

      {/* ── REGISTER SERVICE MODAL ── */}
      <RegisterServiceModal
        isOpen={isRegisterModalOpen}
        onClose={() => setIsRegisterModalOpen(false)}
        walletAddress={walletAddress}
        provider={provider}
        onRegisterService={registerService}
      />

      {/* ── INTERACTIVE PLAYGROUND MODAL ── */}
      <ServicePlaygroundModal
        isOpen={isPlaygroundOpen}
        onClose={closePlayground}
        service={activeService}
        isExecuting={isExecuting}
        executionResult={executionResult}
        onExecute={runService}
        sessionBudget={sessionBudget}
        walletAddress={walletAddress}
        authSource={authSource}
        onNavigateTab={onNavigate}
      />

      {/* ── SESSION BUDGET & KEY MANAGER MODAL (ADR-004) ── */}
      <SessionBudgetModal
        isOpen={isSessionModalOpen}
        onClose={() => setIsSessionModalOpen(false)}
        walletAddress={walletAddress}
        provider={provider}
        onBudgetUpdated={(newMax) => {
          handleResetBudget(newMax)
        }}
      />
    </div>
  )
}
