// src/components/marketplace/MarketplaceTab.tsx
// x402 AI Services Marketplace Tab (Arc Arbitrage & Liquidity Hub)

import React from 'react'
import {
  Zap,
  Bot,
  Layers,
  TrendingUp,
  Clock,
  ShieldCheck,
  Search,
  Code2,
  Sparkles,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Activity,
  Sliders,
  PiggyBank,
  CheckCircle2,
} from 'lucide-react'
import { useMarketplaceServices } from '../../hooks/useMarketplaceServices'
import ServicePlaygroundModal from './ServicePlaygroundModal'
import type { ServiceCategory } from '../../types/marketplace'

interface MarketplaceTabProps {
  walletAddress?: string
  walletConnected?: boolean
}

const CATEGORIES: { id: ServiceCategory; label: string; icon: any }[] = [
  { id: 'All', label: 'Tüm Servisler', icon: Layers },
  { id: 'Arbitrage', label: 'DEX Arbitrajı', icon: Zap },
  { id: 'Liquidity & Routing', label: 'Likidite & Slippage', icon: TrendingUp },
  { id: 'Yield & Flash-Loan', label: 'Flash-Loan & Tasfiye', icon: Sparkles },
  { id: 'MEV & Security', label: 'MEV & Mempool Koruması', icon: ShieldCheck },
  { id: 'Cross-Chain Gateway', label: 'Gateway Akışları', icon: Activity },
]

export default function MarketplaceTab({
  walletAddress,
  walletConnected,
}: MarketplaceTabProps) {
  const {
    filteredServices,
    stats,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    activeService,
    isPlaygroundOpen,
    isExecuting,
    executionResult,
    sessionBudget,
    openPlayground,
    closePlayground,
    runService,
    handleResetBudget,
    toggleAutoApprove,
  } = useMarketplaceServices(walletAddress)

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
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              <span>HTTP 402 Standardı & Circle Gateway Nanopayments</span>
            </div>

            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight leading-snug">
              Arc AI Servis Pazaryeri <br />
              <span className="text-gradient">Kullandığın Kadar Öde (Pay-Per-Call)</span>
            </h1>

            <p className="text-xs md:text-sm text-slate-300 leading-relaxed">
              Aylık $50+ sabit SaaS aboneliklerine ve API Key yönetimine son. Arc L1 üzerinde milisaniyelik arbitraj sinyalleri, likidite derinliği ve slippage optimizasyonuna çağrı başına <strong className="text-emerald-400 font-mono">0.002 - 0.008 USDC</strong> ile anında erişin.
            </p>
          </div>

          {/* Session Budget Quick Controller Card */}
          <div
            className="flex-shrink-0 p-4 rounded-2xl border border-indigo-500/30 bg-slate-950/60 backdrop-blur-xl w-full lg:w-80 space-y-3"
            style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-bold text-slate-200">Oturum Bütçesi (Session Key)</span>
              </div>
              <button
                onClick={() => handleResetBudget(1.0)}
                title="Bütçeyi 1.00 USDC'ye Yenile"
                className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-lg font-extrabold text-white font-mono">
                  ${sessionBudget.spentUsdc.toFixed(4)}
                </span>
                <span className="text-xs text-slate-400 font-mono"> / ${sessionBudget.maxBudgetUsdc.toFixed(2)} USDC</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                Sıfır Onay Modu
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
              <span>Otomatik Yetkilendirme:</span>
              <button
                onClick={() => toggleAutoApprove(!sessionBudget.autoApprove)}
                className={`font-semibold transition cursor-pointer ${
                  sessionBudget.autoApprove ? 'text-emerald-400' : 'text-slate-500'
                }`}
              >
                {sessionBudget.autoApprove ? 'Aktif (Tek Tık)' : 'Manuel Onay'}
              </button>
            </div>
          </div>
        </div>

        {/* Live Ecosystem Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-800/80">
          <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/80">
            <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span>Toplam x402 Çağrısı</span>
            </span>
            <div className="text-base font-bold text-white font-mono mt-1">
              {stats.totalCallsProcessed.toLocaleString()}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/80">
            <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-indigo-400" />
              <span>Ort. Gecikme (Latency)</span>
            </span>
            <div className="text-base font-bold text-emerald-400 font-mono mt-1">
              {stats.averageResponseTimeMs} ms
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/80">
            <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <PiggyBank className="w-3.5 h-3.5 text-amber-400" />
              <span>Kullanıcı Tasarrufu</span>
            </span>
            <div className="text-base font-bold text-amber-300 font-mono mt-1">
              ${stats.savedSubscriptionCostUsd.toLocaleString()}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/80">
            <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>YieldVault Payı (%1)</span>
            </span>
            <div className="text-base font-bold text-purple-300 font-mono mt-1">
              +${stats.totalYieldGeneratedUsdc.toFixed(2)} USDC
            </div>
          </div>
        </div>
      </div>

      {/* ── FILTER & SEARCH BAR ── */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-full">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon
            const isSelected = selectedCategory === cat.id
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 border border-indigo-400/40'
                    : 'bg-slate-900/70 text-slate-400 hover:text-slate-200 border border-slate-800 hover:bg-slate-850'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-cyan-300' : 'text-slate-400'}`} />
                <span>{cat.label}</span>
              </button>
            )
          })}
        </div>

        {/* Search Box */}
        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Servis veya etiket ara..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
          />
        </div>
      </div>

      {/* ── SERVICE CARDS GRID ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredServices.map((service) => (
          <div
            key={service.id}
            className="rounded-2xl p-5 border border-slate-800/80 bg-slate-900/50 hover:border-indigo-500/40 hover:bg-slate-900/80 transition-all duration-300 flex flex-col justify-between group shadow-lg hover:shadow-indigo-500/10"
          >
            <div className="space-y-4">
              {/* Card Top: Category & Price */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase px-2.5 py-1 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  {service.category}
                </span>

                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold font-mono">
                  <Zap className="w-3 h-3 text-emerald-400" />
                  <span>{service.priceUsdc} USDC</span>
                </div>
              </div>

              {/* Title & Tagline */}
              <div>
                <h3 className="text-base font-bold text-white group-hover:text-indigo-300 transition">
                  {service.name}
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
                    className="text-[10px] px-2 py-0.5 rounded-md bg-slate-800/80 text-slate-300 font-mono"
                  >
                    #{tag}
                  </span>
                ))}
              </div>

              {/* Performance Metrics */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/60 text-[11px]">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Gecikme: <strong className="text-slate-200 font-mono">{service.latencyMs}ms</strong></span>
                </div>
                <div className="flex items-center gap-1.5 text-slate-400">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Başarı: <strong className="text-slate-200 font-mono">%{service.successRate}</strong></span>
                </div>
              </div>
            </div>

            {/* Card Footer Actions */}
            <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center gap-2">
              <button
                onClick={() => openPlayground(service)}
                className="flex-1 py-2 px-3 rounded-xl bg-indigo-600/90 hover:bg-indigo-500 text-white text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/20 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5 text-cyan-300" />
                <span>Test Et (Playground)</span>
              </button>

              <button
                onClick={() => openPlayground(service)}
                title="Entegrasyon Kodunu Al"
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
              >
                <Code2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {filteredServices.length === 0 && (
        <div className="py-16 text-center text-slate-400 space-y-3">
          <Search className="w-8 h-8 mx-auto text-slate-600" />
          <p className="text-sm">Aramanızla eşleşen bir x402 AI servisi bulunamadı.</p>
          <button
            onClick={() => {
              setSelectedCategory('All')
              setSearchQuery('')
            }}
            className="text-xs text-indigo-400 hover:underline"
          >
            Filtreleri Temizle
          </button>
        </div>
      )}

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
      />
    </div>
  )
}
