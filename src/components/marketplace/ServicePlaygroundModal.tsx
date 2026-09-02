// src/components/marketplace/ServicePlaygroundModal.tsx
// Interactive Playground & Code Exporter for x402 AI Services

import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
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
  Layers,
  Cpu,
} from 'lucide-react'
import type { x402Service, x402ExecutionResult } from '../../types/marketplace'
import {
  generateCurlCode,
  generateTypescriptCode,
  generatePythonCode,
} from '../../config/servicesRegistry'
import type { SessionBudgetState } from '../../services/x402Client'

interface ServicePlaygroundModalProps {
  isOpen: boolean
  onClose: () => void
  service: x402Service | null
  isExecuting: boolean
  executionResult: x402ExecutionResult | null
  onExecute: (service: x402Service, payload: Record<string, any>) => Promise<any>
  sessionBudget: SessionBudgetState
  walletAddress?: string
}

export default function ServicePlaygroundModal({
  isOpen,
  onClose,
  service,
  isExecuting,
  executionResult,
  onExecute,
  sessionBudget,
  walletAddress,
}: ServicePlaygroundModalProps) {
  const [activeTab, setActiveTab] = useState<'tester' | 'curl' | 'typescript' | 'python'>('tester')
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Initialize form data with default values when service changes
  useEffect(() => {
    if (service) {
      const initial: Record<string, any> = {}
      service.inputParameters.forEach((param) => {
        initial[param.name] = param.defaultValue
      })
      setFormData(initial)
    }
  }, [service])

  if (!isOpen || !service) return null

  const handleInputChange = (name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleRun = async () => {
    await onExecute(service, formData)
  }

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  const curlCode = generateCurlCode(service, formData)
  const tsCode = generateTypescriptCode(service, formData)
  const pythonCode = generatePythonCode(service, formData)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity animate-fade-in"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        className="relative w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl transition-all border border-indigo-500/20 my-8 flex flex-col max-h-[90vh]"
        style={{
          background: 'linear-gradient(180deg, rgba(16, 19, 32, 0.96) 0%, rgba(10, 12, 20, 0.98) 100%)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 40px rgba(99, 102, 241, 0.15)',
        }}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80 bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Zap className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white tracking-wide">{service.name}</h3>
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {service.category}
                </span>
              </div>
              <p className="text-xs text-slate-400">{service.tagline}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Price badge */}
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
              <span>{service.priceUsdc} USDC</span>
              <span className="text-[10px] text-emerald-300/70 font-normal">/ call</span>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-slate-800/60 bg-slate-950/40">
          <button
            onClick={() => setActiveTab('tester')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 cursor-pointer ${
              activeTab === 'tester'
                ? 'text-indigo-300 border-indigo-500 bg-indigo-500/10'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Interactive Tester & Handshake</span>
          </button>
          <button
            onClick={() => setActiveTab('curl')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 cursor-pointer ${
              activeTab === 'curl'
                ? 'text-indigo-300 border-indigo-500 bg-indigo-500/10'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>cURL (x402)</span>
          </button>
          <button
            onClick={() => setActiveTab('typescript')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 cursor-pointer ${
              activeTab === 'typescript'
                ? 'text-indigo-300 border-indigo-500 bg-indigo-500/10'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>TypeScript (Viem)</span>
          </button>
          <button
            onClick={() => setActiveTab('python')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-t-lg transition border-b-2 cursor-pointer ${
              activeTab === 'python'
                ? 'text-indigo-300 border-indigo-500 bg-indigo-500/10'
                : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Python (LangChain)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'tester' ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left Column: Input Parameter Form */}
              <div className="lg:col-span-5 space-y-4">
                <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Input Parameters</span>
                    </h4>
                    <span className="text-[10px] text-slate-500 font-mono">POST JSON</span>
                  </div>

                  <div className="space-y-3">
                    {service.inputParameters.map((param) => (
                      <div key={param.name} className="space-y-1">
                        <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                          <span>{param.label}</span>
                          {param.required && <span className="text-[10px] text-indigo-400">*required</span>}
                        </label>

                        {param.type === 'select' ? (
                          <select
                            value={formData[param.name] ?? param.defaultValue}
                            onChange={(e) => handleInputChange(param.name, e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-950/80 border border-slate-700/80 text-xs text-white focus:outline-none focus:border-indigo-500 transition"
                          >
                            {param.options?.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        ) : param.type === 'number' ? (
                          <input
                            type="number"
                            value={formData[param.name] ?? param.defaultValue}
                            onChange={(e) => handleInputChange(param.name, Number(e.target.value))}
                            className="w-full px-3 py-2 rounded-lg bg-slate-950/80 border border-slate-700/80 text-xs text-white focus:outline-none focus:border-indigo-500 transition font-mono"
                          />
                        ) : (
                          <input
                            type="text"
                            value={formData[param.name] ?? param.defaultValue}
                            onChange={(e) => handleInputChange(param.name, e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-950/80 border border-slate-700/80 text-xs text-white focus:outline-none focus:border-indigo-500 transition font-mono"
                          />
                        )}
                        <p className="text-[10px] text-slate-500">{param.description}</p>
                      </div>
                    ))}
                  </div>

                  {/* Session Budget Indicator */}
                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                    <span>Session Budget:</span>
                    <span className="font-mono text-emerald-400 font-semibold">
                      ${sessionBudget.spentUsdc.toFixed(4)} / ${sessionBudget.maxBudgetUsdc.toFixed(2)} USDC
                    </span>
                  </div>

                  {/* Run Button */}
                  <button
                    onClick={handleRun}
                    disabled={isExecuting}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 hover:brightness-110 text-white font-semibold text-xs tracking-wide shadow-lg shadow-indigo-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isExecuting ? (
                      <>
                        <Clock className="w-4 h-4 animate-spin text-white" />
                        <span>Negotiating x402 Handshake...</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 text-cyan-300" />
                        <span>Pay {service.priceUsdc} USDC & Execute</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Provider Info */}
                <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/80 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Provider:</span>
                    <span className="text-slate-200 font-medium flex items-center gap-1">
                      {service.provider.name}
                      {service.provider.isVerified && <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Settlement Scheme:</span>
                    <span className="font-mono text-indigo-300 text-[11px]">{service.paymentScheme}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Average Latency:</span>
                    <span className="text-cyan-400 font-mono font-semibold">{service.latencyMs} ms</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Execution Live Terminal & Response */}
              <div className="lg:col-span-7 space-y-4">
                {/* Visual x402 Handshake Pipeline */}
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-cyan-400" />
                      <span>x402 Nanopayment Flow</span>
                    </span>
                    {executionResult && (
                      <span className="text-[10px] font-mono text-emerald-400">
                        ⚡ {executionResult.executionTimeMs}ms • Cost: ${executionResult.costUsdc} USDC
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
                    <div className={`p-2 rounded-lg border transition ${
                      isExecuting || executionResult ? 'bg-indigo-500/10 border-indigo-500/40 text-indigo-200' : 'bg-slate-900/60 border-slate-800 text-slate-500'
                    }`}>
                      <div className="font-bold">1. Probe Request</div>
                      <div className="text-[9px] text-slate-400">HTTP 402 Challenge</div>
                    </div>
                    <div className={`p-2 rounded-lg border transition ${
                      isExecuting || executionResult ? 'bg-purple-500/10 border-purple-500/40 text-purple-200' : 'bg-slate-900/60 border-slate-800 text-slate-500'
                    }`}>
                      <div className="font-bold">2. Off-Chain Sign</div>
                      <div className="text-[9px] text-slate-400">{service.priceUsdc} USDC Authorized</div>
                    </div>
                    <div className={`p-2 rounded-lg border transition ${
                      executionResult?.success ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200' : 'bg-slate-900/60 border-slate-800 text-slate-500'
                    }`}>
                      <div className="font-bold">3. Settle & Return</div>
                      <div className="text-[9px] text-slate-400">HTTP 200 OK</div>
                    </div>
                  </div>
                </div>

                {/* Response Code Block */}
                <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/80 border-b border-slate-800 text-xs">
                    <span className="font-mono text-slate-300 flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${
                        executionResult?.success ? 'bg-emerald-400' : isExecuting ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'
                      }`} />
                      <span>Response Payload</span>
                      {executionResult && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                          200 OK
                        </span>
                      )}
                    </span>

                    <button
                      onClick={() =>
                        copyToClipboard(
                          JSON.stringify(executionResult?.data || service.sampleResponseData, null, 2),
                          'response'
                        )
                      }
                      className="text-slate-400 hover:text-white flex items-center gap-1 text-[11px] transition cursor-pointer"
                    >
                      {copiedKey === 'response' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400">Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy JSON</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="p-4 max-h-[300px] overflow-y-auto font-mono text-xs text-slate-300 leading-relaxed">
                    {isExecuting ? (
                      <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-3">
                        <Clock className="w-6 h-6 animate-spin text-indigo-400" />
                        <span className="text-xs">Executing Gateway Nanopayment Authorization...</span>
                      </div>
                    ) : (
                      <pre className="text-emerald-300/90 whitespace-pre-wrap">
                        {JSON.stringify(executionResult?.data || service.sampleResponseData, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>

                {/* Real-Yield Flywheel Notification */}
                {executionResult?.success && (
                  <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-500/10 via-cyan-500/10 to-indigo-500/10 border border-emerald-500/30 flex items-center gap-3">
                    <Sparkles className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    <p className="text-xs text-slate-300">
                      Bu mikro-çağrıdan tahsil edilen <strong className="text-emerald-300 font-mono">0.00005 USDC</strong> (%1), Arcis <strong className="text-cyan-300">YieldVault (af-USDC)</strong> havuzuna doğrudan getiri olarak yönlendirildi!
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Code Export Tab */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  Bu servisi kendi AI Ajanınıza (LangChain, AutoGen, CrewAI) veya backend'inize kolayca entegre edin:
                </p>
                <button
                  onClick={() => {
                    const code =
                      activeTab === 'curl'
                        ? curlCode
                        : activeTab === 'typescript'
                        ? tsCode
                        : pythonCode
                    copyToClipboard(code, activeTab)
                  }}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                >
                  {copiedKey === activeTab ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-white" />
                      <span>Kopyalandı!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Kodu Kopyala</span>
                    </>
                  )}
                </button>
              </div>

              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-xs text-indigo-200 overflow-x-auto leading-relaxed max-h-[440px]">
                <pre>
                  {activeTab === 'curl' && curlCode}
                  {activeTab === 'typescript' && tsCode}
                  {activeTab === 'python' && pythonCode}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
