// Corporate & Institutional AI Agent Playground & Specification Suite for Arcis x402 Services
import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useClearOnWalletDisconnect } from '../../hooks/useClearOnWalletDisconnect'
import {
  X,
  Zap,
  Code2,
  Terminal,
  CheckCircle2,
  Clock,
  Sparkles,
  Copy,
  Check,
  ShieldCheck,
  ArrowRight,
  AlertCircle,
  Activity,
  ExternalLink,
  Lock,
  Sliders,
  Server,
  Coins,
  Gauge,
  Info,
  ChevronRight,
  Eye,
} from 'lucide-react'
import type { x402Service, x402ExecutionResult } from '../../types/marketplace'
import {
  generateCurlCode,
  generateTypescriptCode,
  generatePythonCode,
} from '../../config/servicesRegistry'
import type { SessionBudgetState } from '../../services/x402Client'
import {
  serviceTelemetryService,
  type ServiceTelemetryData,
} from '../../services/serviceTelemetryService'
import ServiceActionCard from './ServiceActionCard'
import { soundService } from '../../services/soundService'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import { NetworkIcon } from '@web3icons/react/dynamic'
import ArcLogo from '../../assets/Arc-Icon.svg'
import { getChainIconId, getChainDisplayName } from '../../config/chainMeta'

interface ServicePlaygroundModalProps {
  isOpen: boolean
  onClose: () => void
  service: x402Service | null
  isExecuting: boolean
  executionResult: x402ExecutionResult | null
  onExecute: (service: x402Service, payload: Record<string, any>) => Promise<any>
  sessionBudget: SessionBudgetState
  walletAddress?: string
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  onNavigateTab?: (tab: string) => void
}

const DEFAULT_GATEWAY_NETWORKS = [
  { id: 'arc', name: 'Arc', fullName: 'Arc Testnet', iconId: 'arc', isArc: true, isNative: true, role: 'Settlement Network' },
  { id: 'base', name: 'Base', fullName: 'Base Sepolia', iconId: 'base-sepolia', isArc: false, isNative: false, role: 'Circle Gateway Rail' },
  { id: 'ethereum', name: 'Ethereum', fullName: 'Ethereum Sepolia', iconId: 'ethereum', isArc: false, isNative: false, role: 'Circle Gateway Rail' },
  { id: 'arbitrum', name: 'Arbitrum', fullName: 'Arbitrum Sepolia', iconId: 'arbitrum-sepolia', isArc: false, isNative: false, role: 'Circle Gateway Rail' },
  { id: 'polygon', name: 'Polygon', fullName: 'Polygon Amoy', iconId: 'polygon-amoy', isArc: false, isNative: false, role: 'Circle Gateway Rail' },
  { id: 'solana', name: 'Solana', fullName: 'Solana Devnet', iconId: 'solana', isArc: false, isNative: false, role: 'Circle Gateway Rail' },
]

export default function ServicePlaygroundModal({
  isOpen,
  onClose,
  service,
  isExecuting,
  executionResult,
  onExecute,
  sessionBudget,
  walletAddress,
  authSource,
  onNavigateTab,
}: ServicePlaygroundModalProps) {
  const [activeMainTab, setActiveMainTab] = useState<'console' | 'specs' | 'sdk'>('console')
  const [activeSdkTab, setActiveSdkTab] = useState<'curl' | 'typescript' | 'python'>('curl')
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [showSamplePreview, setShowSamplePreview] = useState<boolean>(false)

  const supportedNetworks = useMemo(() => {
    const list = [...DEFAULT_GATEWAY_NETWORKS]
    if (service?.accepts) {
      for (const acc of service.accepts) {
        const net = acc.network
        if (!net) continue
        const cleanNet = net.toLowerCase().replace(/[\s_-]+/g, '')
        const alreadyExists = list.some((item) => {
          const cleanId = item.id.toLowerCase().replace(/[\s_-]+/g, '')
          const cleanName = item.name.toLowerCase().replace(/[\s_-]+/g, '')
          const cleanFull = item.fullName.toLowerCase().replace(/[\s_-]+/g, '')
          return (
            cleanNet === cleanId ||
            cleanNet === cleanName ||
            cleanNet === cleanFull ||
            (cleanNet.includes('arc') && (cleanId.includes('arc') || cleanName.includes('arc'))) ||
            (cleanNet.includes('5042002') && cleanId.includes('arc')) ||
            (cleanNet.includes('base') && (cleanId.includes('base') || cleanName.includes('base'))) ||
            (cleanNet.includes('84532') && cleanId.includes('base')) ||
            (cleanNet.includes('eth') && (cleanId.includes('eth') || cleanName.includes('eth'))) ||
            (cleanNet.includes('11155111') && cleanId.includes('eth')) ||
            (cleanNet.includes('arbitrum') && (cleanId.includes('arbitrum') || cleanName.includes('arbitrum'))) ||
            (cleanNet.includes('polygon') && (cleanId.includes('polygon') || cleanName.includes('polygon'))) ||
            (cleanNet.includes('solana') && (cleanId.includes('solana') || cleanName.includes('solana')))
          )
        })
        if (!alreadyExists) {
          const iconId = getChainIconId(net)
          const fullName = getChainDisplayName(net) || net
          list.push({
            id: net,
            name: fullName.split(' ')[0] || net,
            fullName,
            iconId,
            isArc: iconId === 'arc' || cleanNet.includes('arc'),
            isNative: false,
            role: 'Accepted Network',
          })
        }
      }
    }
    return list
  }, [service?.accepts])

  // Systematic input clearing on wallet disconnect
  useClearOnWalletDisconnect(() => {
    setFormData({})
  })

  // Keyboard accessibility: Close on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, onClose])

  // Initialize form data with default values when service changes
  useEffect(() => {
    if (service) {
      const initial: Record<string, any> = {}
      service.ui.form.forEach((param) => {
        initial[param.name] = param.defaultValue
      })
      setFormData(initial)
      setShowSamplePreview(false)
    }
  }, [service])

  // Live telemetry for this specific service with reactive subscription
  const [liveTelemetry, setLiveTelemetry] = useState<ServiceTelemetryData | null>(null)

  useEffect(() => {
    if (!service) {
      setLiveTelemetry(null)
      return
    }

    setLiveTelemetry(
      serviceTelemetryService.getOrCreateServiceTelemetry(
        service.id,
        service.sla.p95LatencyMs,
        service.sla.successRate
      )
    )

    const unsubscribe = serviceTelemetryService.subscribe((map) => {
      if (service && map[service.id]) {
        setLiveTelemetry(map[service.id])
      }
    })

    return () => unsubscribe()
  }, [service])

  const telemetry: ServiceTelemetryData | null =
    liveTelemetry ??
    (service
      ? serviceTelemetryService.getOrCreateServiceTelemetry(
        service.id,
        service.sla.p95LatencyMs,
        service.sla.successRate
      )
      : null)

  if (!isOpen || !service || !telemetry) return null

  const handleInputChange = (name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleRun = async () => {
    soundService.play('pop')
    setShowSamplePreview(false)
    await onExecute(service, formData)
  }

  const displayedCostUsdc = executionResult?.payment?.status === 'settlement_pending'
    ? (executionResult.payment.amountUsdc || executionResult.costUsdc)
    : executionResult?.costUsdc ?? 0

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    soundService.play('pop')
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const curlCode = generateCurlCode(service, formData)
  const tsCode = generateTypescriptCode(service, formData)
  const pythonCode = generatePythonCode(service, formData)

  // Active displayed JSON in console
  const displayedJson = executionResult?.data || (showSamplePreview ? service.examples.response : null)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 md:p-6 overflow-y-auto">
      {/* Dark Luxury Ambient Backdrop */}
      <div
        className="fixed inset-0 bg-[#060810]/85 backdrop-blur-xl transition-all duration-300 animate-fade-in"
        onClick={() => {
          soundService.play('pop')
          onClose()
        }}
      />

      {/* Modal Container */}
      <div
        className="relative w-full max-w-6xl rounded-3xl overflow-hidden shadow-[0_25px_70px_-15px_rgba(0,0,0,0.95),0_0_50px_rgba(99,102,241,0.15)] transition-all border border-slate-800/90 my-auto flex flex-col max-h-[92vh] bg-[#0b0e17]/95 backdrop-blur-2xl z-10"
      >
        {/* Subtle Top Gradient Hairline */}
        <div className="h-[2px] w-full bg-gradient-to-r from-transparent via-indigo-500/80 to-cyan-500/80" />

        {/* ── 1. CORPORATE HEADER (EXECUTIVE AGENT IDENTITY) ── */}
        <div className="px-6 py-5 border-b border-slate-800/70 bg-slate-900/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            {/* Agent Title & Meta Badges */}
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-extrabold text-white tracking-tight flex items-center gap-2">
                  <span>{service.name}</span>
                </h2>

                <span className="text-[10px] font-semibold uppercase px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 tracking-wider">
                  {service.category}
                </span>
              </div>

              <p className="text-xs sm:text-sm text-slate-300 line-clamp-1 max-w-2xl font-normal">
                {service.tagline}
              </p>
            </div>
          </div>

          {/* Pricing Command Chip & Header Controls */}
          <div className="flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800/60">
            {/* Enterprise USDC Price Card */}
            <div
              className="flex items-center gap-3 px-3.5 py-2 rounded-2xl bg-slate-950/90 border border-slate-800 shadow-sm group-hover:border-slate-700 transition"
              title={`x402 service price: ${service.pricing.priceUsdc} USDC per call; payment requires confirmed settlement`}
            >
              <img
                src={UsdcIcon}
                alt="USDC"
                className="w-6 h-6 rounded-full flex-shrink-0 object-contain shadow-sm"
              />
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-s font-extrabold text-white tracking-tight">
                    {service.pricing.priceUsdc}
                  </span>
                  <span className="text-[12px] font-bold uppercase tracking-wider">
                    USDC
                  </span>
                  <span className="text-[11px] text-slate-300 font-medium">/call</span>
                </div>
              </div>
            </div>

            {/* Close Button with ESC Keyboard Cue */}
            <button
              onClick={() => {
                soundService.play('pop')
                onClose()
              }}
              className="p-2 rounded-xl text-slate-400 hover:text-white bg-slate-900/60 hover:bg-slate-800 border border-slate-800/80 hover:border-slate-700 transition cursor-pointer flex items-center gap-1 group shadow-sm"
              title="Close modal (Esc)"
            >
              <X className="w-4 h-4 text-slate-300 group-hover:text-white transition" />
            </button>
          </div>
        </div>

        {/* ── 2. EXECUTIVE LIVE TELEMETRY & SLA RIBBON ── */}
        <div className="bg-slate-950/70 border-b border-slate-800/60 px-6 py-2.5 flex items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-6 flex-shrink-0">
            {/* Physical Latency */}
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-slate-400 font-sans">Latency:</span>
              <span className="text-cyan-300 font-bold flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span>{telemetry.latencyMs} ms</span>
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-sans font-medium border ml-1 ${telemetry.probeTarget === 'endpoint'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                    : 'bg-cyan-500/10 text-cyan-300 border-cyan-500/25'
                  }`}
                title={
                  telemetry.probeTarget === 'endpoint'
                    ? 'Live HTTP round-trip latency to active AI service endpoint'
                    : 'Physical RPC round-trip time to Arc L1 Testnet'
                }
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${telemetry.probeTarget === 'endpoint' ? 'bg-emerald-400' : 'bg-cyan-400'
                    }`}
                />
                <span>{telemetry.probeTarget === 'endpoint' ? 'Endpoint' : 'Arc RPC'}</span>
              </span>
            </div>

            <div className="h-3 w-px bg-slate-800 hidden sm:block" />

            {/* Calculated SLA */}
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-slate-400 font-sans">Uptime SLA:</span>
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <span>{telemetry.successRate}%</span>
              </span>
            </div>

            <div className="h-3 w-px bg-slate-800 hidden md:block" />

            {/* Verified Provider */}
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-slate-400 font-sans">Provider:</span>
              <span className="text-slate-200 font-medium flex items-center gap-2">
                <span>{service.provider.name}</span>
                {service.provider.isVerified && (
                  <CheckCircle2 className="w-3 h-3 text-cyan-400" />
                )}
                <span className="text-[12px] text-indigo-300 bg-indigo-500/10 px-1.5 py-0.2 rounded border border-indigo-500/20">
                  {service.provider.reputationScore}/100
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* ── 3. SEGMENTED CORPORATE NAVIGATION CONTROLS ── */}
        <div className="px-10 pt-5 bg-slate-950/40 border-slate-800/60 flex items-center justify-between gap-3">
          <div className="inline-flex p-1 rounded-2xl bg-slate-900/80 border border-slate-800/90 shadow-inner">
            <button
              onClick={() => {
                soundService.play('pop')
                setActiveMainTab('console')
              }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${activeMainTab === 'console'
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Execution Console</span>
            </button>

            <button
              onClick={() => {
                soundService.play('pop')
                setActiveMainTab('specs')
              }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${activeMainTab === 'specs'
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
            >
              <Server className="w-3.5 h-3.5" />
              <span>Architecture & Specifications</span>
            </button>

            <button
              onClick={() => {
                soundService.play('pop')
                setActiveMainTab('sdk')
              }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${activeMainTab === 'sdk'
                  ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Developer SDK & Code</span>
            </button>
          </div>

          {/* Quick Endpoint Badge */}
          <div className="hidden lg:flex items-center gap-2 text-[12px] text-slate-400 font-mono">
            <span className="px-3 py-1 rounded bg-slate-900 border border-slate-800 text-indigo-300 font-bold">
              {service.serve.method}
            </span>
            <span className="text-slate-400 truncate max-w-md">{service.upstream?.url || service.serve.path}</span>
          </div>
        </div>

        {/* ── 4. MODAL CONTENT BODY ── */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* TAB 1: EXECUTION CONSOLE & TELEMETRY */}
          {activeMainTab === 'console' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* ─ LEFT COLUMN: PARAMETER CONFIGURATION & SESSION BUDGET ─ */}
              <div className="lg:col-span-6 flex flex-col">
                {/* Configuration Container */}
                <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800/80 backdrop-blur-sm space-y-4 shadow-sm h-full flex flex-col justify-between">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                        <Sliders className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                          Payload Configuration
                        </h3>
                        <p className="text-[10px] text-slate-400">Specify input attributes for this call</p>
                      </div>
                    </div>
                  </div>

                  {/* Form Parameters */}
                  <div className="space-y-3.5">
                    {service.ui.form.map((param) => (
                      <div key={param.name} className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-200 block">
                          {param.label}
                        </label>

                        {param.type === 'select' ? (
                          <div className="relative">
                            <select
                              value={formData[param.name] ?? param.defaultValue}
                              onChange={(e) => handleInputChange(param.name, e.target.value)}
                              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/90 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition appearance-none cursor-pointer"
                            >
                              {param.options?.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
                              <ChevronRight className="w-3.5 h-3.5 rotate-90" />
                            </div>
                          </div>
                        ) : param.type === 'number' ? (
                          <input
                            type="number"
                            value={formData[param.name] ?? param.defaultValue}
                            onChange={(e) => handleInputChange(param.name, Number(e.target.value))}
                            className="w-full px-3.5 py-2 rounded-xl bg-slate-950/90 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition font-mono"
                          />
                        ) : (
                          <input
                            type="text"
                            value={formData[param.name] ?? param.defaultValue}
                            onChange={(e) => handleInputChange(param.name, e.target.value)}
                            className="w-full px-3.5 py-2 rounded-xl bg-slate-950/90 border border-slate-800 text-xs text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition font-mono"
                          />
                        )}

                        <p className="text-[10px] text-slate-400 leading-normal">{param.description}</p>
                      </div>
                    ))}
                  </div>

                  {/* Corporate Session Budget & Fee Transparency */}
                  <div className="pt-3 border-t border-slate-800/80 space-y-1">
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-slate-300 flex items-center gap-1.5">
                        <Gauge className="w-4 h-4 text-indigo-300" />
                        <span>Session Key Budget:</span>
                      </span>
                      <span className="font-mono text-slate-200 font-semibold flex items-center gap-1">
                        <img src={UsdcIcon} alt="USDC" className="w-3 h-3 rounded-full object-contain" />
                        <span>{sessionBudget.spentUsdc.toFixed(4)} / {sessionBudget.maxBudgetUsdc.toFixed(2)} USDC</span>
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1.5 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-500 rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, (sessionBudget.spentUsdc / sessionBudget.maxBudgetUsdc) * 100)}%`,
                        }}
                      />
                    </div>

                    {/* Cost Breakdown Table (ADR-006) */}
                    <div className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1.5 text-[12px]">
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Listed price per call:</span>
                        <span className="font-mono text-slate-200 font-medium">{service.pricing.priceUsdc} USDC</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Provider receives if settled:</span>
                        <span className="font-mono text-slate-200 font-medium">
                          {service.pricing.priceUsdc} USDC
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Protocol fee currently deducted:</span>
                        <span className="font-mono text-emerald-400 font-medium">0 USDC</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400">
                        <span>Gas sponsorship:</span>
                        <span className="font-mono text-cyan-400 font-medium">Not confirmed</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2.5 pt-1">
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
                      <div className="space-y-0.5">
                        <div className="font-semibold text-amber-200">
                          {authSource === 'evm' && walletAddress ? 'Circle Gateway • Arc Testnet' : 'External EOA Required'}
                        </div>
                        <p className="text-[11px] text-amber-300/80 leading-relaxed">
                          {authSource === 'evm' && walletAddress
                            ? 'Signing requires a pre-funded Gateway balance. Facilitator acceptance serves the result; provider earnings remain pending until nonce reconciliation confirms settlement. No automatic deposit is made.'
                            : 'Select a connected external EOA on Arc Testnet. Passkey/MSCA, Circle UCW and autonomous session payments are unsupported.'}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={handleRun}
                      disabled={isExecuting || !walletAddress || authSource !== 'evm'}
                      className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/30 text-white font-bold text-xs tracking-wide flex items-center justify-center gap-2 cursor-pointer disabled:bg-slate-800/60 disabled:border-slate-700/50 disabled:text-slate-400 disabled:cursor-not-allowed"
                    >
                      {isExecuting ? <Clock className="w-4 h-4 animate-spin" /> : authSource === 'evm' ? <Zap className="w-4 h-4" /> : <Lock className="w-4 h-4 text-amber-400" />}
                      <span>{isExecuting ? 'Requesting Gateway acceptance…' : 'Sign & run paid call'}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* ─ RIGHT COLUMN: PROTOCOL PIPELINE & OUTPUT CONSOLE ─ */}
              <div className="lg:col-span-6 flex flex-col space-y-5 h-full">
                {/* Visual x402 Handshake Pipeline */}
                <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800/90 shadow-sm space-y-3 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                        <Activity className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs font-bold text-slate-200">
                        x402 Nanopayment Handshake Pipeline
                      </span>
                    </div>

                    {executionResult && (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-slate-200 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-700/80 shadow-xs">
                        <img src={UsdcIcon} alt="USDC" className="w-3 h-3 rounded-full object-contain" />
                        <span>${displayedCostUsdc} USDC{executionResult.payment?.status === 'settlement_pending' ? ' • pending' : ''}</span>
                        <span className="text-slate-600">•</span>
                        <span className="text-cyan-400 font-semibold font-sans">⚡ {executionResult.executionTimeMs}ms</span>
                      </span>
                    )}
                  </div>

                  {/* 3-Stage Pipeline Steps */}
                  <div className="grid grid-cols-3 gap-2.5">
                    {/* Step 1: Probe Challenge */}
                    <div
                      className={`p-3 rounded-xl border transition-all text-center space-y-1 ${isExecuting || executionResult
                          ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200 shadow-sm shadow-indigo-500/10'
                          : 'bg-slate-900/40 border-slate-800/80 text-slate-400'
                        }`}
                    >
                      <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Step 01</div>
                      <div className="font-bold text-xs">HTTP 402 Probe</div>
                      <div className="text-[10px] text-slate-400">Challenge Generated</div>
                    </div>

                    {/* Step 2: EIP-712 Signature */}
                    <div
                      className={`p-3 rounded-xl border transition-all text-center space-y-1 ${isExecuting || executionResult
                          ? 'bg-purple-500/15 border-purple-500/40 text-purple-200 shadow-sm shadow-purple-500/10'
                          : 'bg-slate-900/40 border-slate-800/80 text-slate-400'
                        }`}
                    >
                      <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Step 02</div>
                      <div className="font-bold text-xs">Authorization</div>
                      <div className="text-[10px] text-slate-400">Up to {service.pricing.priceUsdc} USDC</div>
                    </div>

                    {/* Step 3: Settlement is only complete when the API confirms it. */}
                    <div
                      className={`p-3 rounded-xl border transition-all text-center space-y-1 ${executionResult?.success
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 shadow-sm shadow-emerald-500/10'
                          : 'bg-slate-900/40 border-slate-800/80 text-slate-400'
                        }`}
                    >
                      <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Step 03</div>
                      <div className="font-bold text-xs">
                        {executionResult?.payment?.status === 'settlement_pending'
                          ? 'Batch Pending'
                          : executionResult?.executionMode === 'onchain_verified'
                            ? 'On-Chain Settled'
                            : executionResult?.executionMode === 'gateway_batched'
                              ? 'Gateway Batched'
                              : executionResult?.executionMode === 'session_autonomous'
                                ? 'Auto-Settled'
                                : 'Settlement Required'}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {executionResult?.payment?.status === 'settlement_pending'
                          ? 'Accepted • awaiting reconciliation'
                          : executionResult?.payment?.status === 'settled' ? 'Confirmed' : 'Not confirmed'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Intelligence Output Terminal Console */}
                <div className="rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-xl flex-1 flex flex-col min-h-[340px]">
                  {/* macOS / Corporate Styled Top Bar */}
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-900/90 border-b border-slate-800 text-xs flex-shrink-0">
                    <div className="flex items-center gap-3">
                      {/* Window Dots */}
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                        <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                      </div>

                      <div className="h-3 w-px bg-slate-800" />

                      <span className="font-mono font-semibold text-slate-200 flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${executionResult?.success
                              ? 'bg-emerald-400'
                              : isExecuting
                                ? 'bg-amber-400 animate-pulse'
                                : showSamplePreview
                                  ? 'bg-cyan-400'
                                  : 'bg-slate-600'
                            }`}
                        />
                        <span>INTELLIGENCE OUTPUT</span>
                        {executionResult?.success && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                            200 OK
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Preview Sample Button toggle */}
                      {!executionResult && (
                        <button
                          onClick={() => {
                            soundService.play('pop')
                            setShowSamplePreview(!showSamplePreview)
                          }}
                          className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center gap-1.5 text-[11px] font-medium border border-slate-700/60 transition cursor-pointer">
                          <Eye className="w-4 h-4" />
                          <span>{showSamplePreview ? 'Hide Sample' : 'Inspect Sample'}</span>
                        </button>
                      )}

                      {/* Copy JSON Action — copies only what the console is showing, so a click can
                          never put the illustrative example on the clipboard unlabelled. */}
                      <button
                        onClick={() =>
                          displayedJson && copyToClipboard(JSON.stringify(displayedJson, null, 2), 'response')
                        }
                        disabled={!displayedJson}
                        className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center gap-1.5 text-[11px] font-medium border border-slate-700/60 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {copiedKey === 'response' ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Terminal Viewport */}
                  <div className="p-4 flex-1 min-h-[240px] overflow-y-auto font-mono text-xs text-slate-300 leading-relaxed bg-[#07090e]">
                    {isExecuting ? (
                      <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-3">
                        <Clock className="w-7 h-7 animate-spin text-indigo-400" />
                        <span className="text-xs font-sans font-semibold text-slate-200">
                          Waiting for the Circle Gateway response...
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">
                          The provider returns data after facilitator acceptance; final provider accounting is reconciled separately.
                        </span>
                      </div>
                    ) : displayedJson ? (
                      <>
                        {!executionResult && (
                          <div className="mb-3 px-2.5 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/25 text-cyan-200 text-[10px] font-sans font-semibold tracking-wide">
                            SAMPLE DATA — the illustrative example from this service's manifest. It is not a paid result and no live read produced it.
                          </div>
                        )}
                        <pre className="text-emerald-300/90 whitespace-pre-wrap selection:bg-indigo-500 selection:text-white">
                          {JSON.stringify(displayedJson, null, 2)}
                        </pre>
                      </>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
                          <Terminal className="w-5 h-5" />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-slate-300">
                            Awaiting Execution Handshake
                          </p>
                          <p className="text-[11px] text-slate-400 max-w-xs">
                            Configure parameters and review the settlement requirement, or preview the illustrative response structure.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 1-Click Actionable Signal Card (Arbitrage / Route Execution) */}
                {executionResult?.success && executionResult.actionablePayload && (
                  <div className="animate-fade-in">
                    <ServiceActionCard
                      payload={executionResult.actionablePayload}
                      walletAddress={walletAddress}
                      walletConnected={Boolean(walletAddress)}
                      onNavigateTab={(tab) => {
                        onClose()
                        if (onNavigateTab) onNavigateTab(tab)
                      }}
                    />
                  </div>
                )}

                {/* Payment / Execution Error Alert */}
                {executionResult && !executionResult.success && executionResult.error && (
                  <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-3 animate-fade-in shadow-sm">
                    <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <div className="font-bold text-rose-200">Paid Execution Unavailable</div>
                      <div className="font-mono text-[11px] text-rose-300/90 leading-relaxed">
                        {executionResult.error}
                      </div>
                    </div>
                  </div>
                )}

                {executionResult?.success && executionResult.payment?.status === 'settlement_pending' && (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 animate-fade-in">
                    <Clock className="w-5 h-5 text-amber-300 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-slate-300 space-y-1">
                      <p className="font-semibold text-amber-200">Circle accepted the nanopayment; batch settlement is pending.</p>
                      <p>Service data was returned after facilitator acceptance. Provider earnings are not yet available and will be credited only after a nonce-matched Circle transfer reaches confirmed/completed.</p>
                      {executionResult.payment.settlementRef && <p className="font-mono text-[10px] break-all text-slate-400">Circle reference (not a transaction hash): {executionResult.payment.settlementRef}</p>}
                    </div>
                  </div>
                )}

                {/* Real-Yield Flywheel Notification & Tx Link */}
                {executionResult?.success && executionResult.payment?.status === 'settled' && executionResult.payment.settlementRef && (
                  <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500/10 via-cyan-500/10 to-indigo-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md animate-fade-in">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 flex-shrink-0">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div className="text-xs text-slate-300">
                        <p className="font-medium text-slate-200">
                          Confirmed payment of{' '}
                          <strong className="text-emerald-400 font-mono">
                            {service.pricing.priceUsdc} USDC
                          </strong>{' '}
                          recorded only after confirmed settlement via{' '}
                          <strong className="text-cyan-300 font-semibold">Circle Gateway Nanopayments</strong> (ADR-006)!
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          {executionResult.executionMode === 'onchain_verified' && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              On-Chain Verified {executionResult.blockNumber ? `(Block #${executionResult.blockNumber})` : ''}
                            </span>
                          )}
                          {executionResult.executionMode === 'session_autonomous' && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-medium">
                              <Zap className="w-3 h-3 text-cyan-400" />
                              Session Autonomous {executionResult.gasSponsored ? '• Gas Sponsored' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {executionResult.txHash && (
                      <a
                        href={executionResult.explorerUrl || `https://testnet.arcscan.app/tx/${executionResult.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 text-xs font-mono text-cyan-300 hover:text-cyan-200 hover:underline px-3 py-1.5 rounded-xl bg-cyan-500/15 border border-cyan-500/30 transition self-start sm:self-center cursor-pointer shadow-sm"
                      >
                        <span>ArcScan Receipt</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: ARCHITECTURE & SPECIFICATIONS (ENTERPRISE DATASHEET) */}
          {activeMainTab === 'specs' && (
            <div className="space-y-6 animate-fade-in">
              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Server className="w-4 h-4 text-indigo-400" />
                      <span>Architecture & Specification</span>
                    </h3>
                    <p className="text-xs text-slate-400">Cryptographic interface for institutional callers and agents</p>
                  </div>
                </div>

                {/* Specs Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
                    <span className="text-slate-300 block text-[12px]">Primary Endpoint URL</span>
                    <div className="flex items-center justify-between gap-2 font-mono text-white">
                      <span className="truncate">{service.upstream?.url || service.serve.path}</span>
                      <button
                        onClick={() => copyToClipboard(service.upstream?.url || service.serve.path, 'url')}
                        className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition cursor-pointer"
                      >
                        {copiedKey === 'url' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
                    <span className="text-slate-300 block text-[12px]">Settlement Scheme & Contract</span>
                    <span className="font-mono text-slate-200 font-semibold">{service.accepts[0]?.scheme || 'exact'} (x402 v2 Gateway Batched)</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-300 block text-[12px]">Supported Networks</span>
                    </div>
                    <div className="flex items-center flex-wrap gap-2 pt-0.5">
                      {supportedNetworks.map((net) => (
                        <div
                          key={net.id}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all text-xs font-medium select-none shadow-sm group bg-slate-900/90 border-slate-800/80 hover:border-slate-700/80 hover:bg-slate-800/60 text-slate-300`}
                          title={`${net.fullName} • ${net.role}`}
                        >
                          <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                            {net.isArc || net.iconId === 'arc' ? (
                              <img src={ArcLogo} alt={net.name} className="w-4 h-4 object-contain" />
                            ) : (
                              <NetworkIcon
                                name={net.iconId}
                                variant={net.iconId === 'solana' ? 'branded' : 'background'}
                                size={16}
                                className="rounded-full"
                              />
                            )}
                          </div>
                          <span className="font-sans text-[11px] font-medium text-slate-200">{net.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1">
                    <span className="text-slate-300 block text-[12px]">Provider Address</span>
                    <div className="flex items-center justify-between gap-2 font-mono text-slate-200">
                      <span className="truncate">{service.provider.address}</span>
                      <a
                        href={`https://testnet.arcscan.app/address/${service.provider.address}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline p-1 flex items-center gap-1"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                </div>                  {/* Economic Mechanism (ADR-006) */}                  <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs text-slate-300 space-y-2">
                    <div className="font-bold text-indigo-300 flex items-center gap-2">
                      <Coins className="w-4 h-4 text-indigo-400" />
                      <span>Micro-Economics & Revenue Routing (ADR-006)</span>
                    </div>
                    <p className="leading-relaxed text-slate-300">
                      Each paid call signs <strong className="text-white font-mono">{service.pricing.priceUsdc} USDC</strong> with an external EOA and a pre-funded Circle Gateway balance. A successful facilitator acceptance allows the result to be served; it is not a chain receipt. Provider earnings remain pending until nonce reconciliation reports a matching confirmed/completed Circle transfer. No protocol fee is deducted here; session spending caps are local metadata, not on-chain delegation.
                    </p>
                  </div>

              </div>

              {/* Service Detailed Description */}
              <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Service Capability Overview
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {service.description}
                </p>
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {service.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2.5 py-1 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs font-mono text-slate-300"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}              {/* TAB 3: DEVELOPER SDK & CODE EXPORT */}
          {activeMainTab === 'sdk' && (
            <div className="space-y-5 animate-fade-in">
              {/* SDK Language Switcher */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-900/40 border border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800">
                    <button
                      onClick={() => {
                        soundService.play('pop')
                        setActiveSdkTab('curl')
                      }}
                      className={`px-6 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${activeSdkTab === 'curl'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white'
                        }`}
                    >
                      cURL
                    </button>
                    <button
                      onClick={() => {
                        soundService.play('pop')
                        setActiveSdkTab('typescript')
                      }}
                      className={`px-6 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${activeSdkTab === 'typescript'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white'
                        }`}
                    >
                      TypeScript
                    </button>
                    <button
                      onClick={() => {
                        soundService.play('pop')
                        setActiveSdkTab('python')
                      }}
                      className={`px-6 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${activeSdkTab === 'python'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-400 hover:text-white'
                        }`}
                    >
                      Python
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => {
                    const code =
                      activeSdkTab === 'curl'
                        ? curlCode
                        : activeSdkTab === 'typescript'
                          ? tsCode
                          : pythonCode
                    copyToClipboard(code, activeSdkTab)
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-md shadow-indigo-600/20"
                >
                  {copiedKey === activeSdkTab ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-white" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>

              {/* Code Snippet Box */}
              <div className="rounded-2xl bg-slate-950 border border-slate-800 p-5 font-mono text-xs text-indigo-200 overflow-x-auto leading-relaxed max-h-[460px] shadow-xl">
                <pre>
                  {activeSdkTab === 'curl' && curlCode}
                  {activeSdkTab === 'typescript' && tsCode}
                  {activeSdkTab === 'python' && pythonCode}
                </pre>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-xs text-slate-400 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
                <p>
                  <strong>Circle Gateway batched payment:</strong> A connected EOA signs an EIP-3009 authorization. Service data may be served once the facilitator accepts it; that reference is not a chain receipt. Provider accounting stays pending until nonce-based Circle reconciliation reports confirmed/completed.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
