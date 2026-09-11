import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import {
  ShieldCheck,
  RefreshCw,
  Zap,
  Home,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Terminal,
  ExternalLink,
  AlertCircle,
} from 'lucide-react'
import customLogo from '../../assets/Arcis-Icon.svg'

interface Props {
  children: ReactNode
  fallbackTitle?: string
  fallbackMessage?: string
  onReset?: () => void
  isSection?: boolean
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  copied: boolean
  showDetails: boolean
}

export class GlobalErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    copied: false,
    showDetails: false,
  }

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
      copied: false,
      showDetails: false,
    }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Arcis Resilience Guard] Intercepted runtime exception:', error, errorInfo)
    this.setState({ errorInfo })
  }

  private handleReload = () => {
    if (typeof window !== 'undefined' && window.location.search.includes('testCrash=')) {
      window.location.href = window.location.pathname
      return
    }
    window.location.reload()
  }

  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
      showDetails: false,
    })
    this.props.onReset?.()
  }

  private handleClearCacheAndReload = () => {
    try {
      // 1. Clear session cache
      sessionStorage.clear()

      // 2. Clear known stale wagmi/tanstack/query cache keys
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (
          key &&
          (key.startsWith('wagmi.') ||
            key.startsWith('wc@') ||
            key.startsWith('tanstack') ||
            key.startsWith('REACT_QUERY') ||
            key.includes('cache') ||
            key.includes('quote') ||
            key.includes('swap'))
        ) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach((k) => {
        try {
          localStorage.removeItem(k)
        } catch {
          // Ignore removal errors
        }
      })

      if (typeof window !== 'undefined' && window.location.search.includes('testCrash=')) {
        window.location.href = window.location.pathname
        return
      }

      window.location.reload()
    } catch {
      window.location.reload()
    }
  }

  private handleReturnHome = () => {
    try {
      sessionStorage.clear()
      window.location.href = window.location.origin
    } catch {
      window.location.href = '/'
    }
  }

  private handleCopy = async () => {
    const errorText = [
      `==================================================`,
      `  ARCIS PROTOCOL // CLIENT DIAGNOSTIC REPORT  `,
      `==================================================`,
      `Timestamp: ${new Date().toISOString()}`,
      `Environment: ${typeof window !== 'undefined' ? window.location.hostname : 'Unknown'} (Web3 DeFi Client)`,
      `Route URL: ${typeof window !== 'undefined' ? window.location.href : 'N/A'}`,
      `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'}`,
      `Screen Viewport: ${typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'N/A'}`,
      ``,
      `[FAULT CLASSIFICATION]`,
      `Error Type: ${this.state.error?.name || 'Error'}`,
      `Error Message: ${this.state.error?.message || 'Unknown render exception'}`,
      ``,
      `[CALL TRACE]`,
      `${this.state.error?.stack || 'N/A'}`,
      ``,
      `[REACT COMPONENT STACK]`,
      `${this.state.errorInfo?.componentStack || 'N/A'}`,
      `==================================================`,
    ].join('\n')

    try {
      await navigator.clipboard.writeText(errorText)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2500)
    } catch {
      // Fallback
    }
  }

  private handleReportIssue = () => {
    const errorTitle = `[UI Fault]: ${this.state.error?.name || 'Exception'}: ${(this.state.error?.message || '').slice(0, 50)}`
    const errorBody = [
      `### Describe the bug`,
      `An unexpected UI exception was caught by Arcis GlobalErrorBoundary.`,
      ``,
      `### Error Details`,
      `\`\`\``,
      `${this.state.error?.name || 'Error'}: ${this.state.error?.message || 'Unknown'}`,
      `\`\`\``,
      ``,
      `### Environment`,
      `- URL: ${window.location.href}`,
      `- Time: ${new Date().toISOString()}`,
      `- Browser: ${navigator.userAgent}`,
    ].join('\n')

    window.open(
      `https://github.com/yasarkar/arcis/issues/new?title=${encodeURIComponent(errorTitle)}&body=${encodeURIComponent(errorBody)}`,
      '_blank',
      'noopener,noreferrer'
    )
  }

  public render() {
    if (this.state.hasError) {
      const { isSection, fallbackTitle, fallbackMessage } = this.props
      const { error, copied, showDetails } = this.state

      // ── SECTION-LEVEL ISOLATED ERROR CARD ──
      // Used for tabs, cards or modals so one component doesn't crash the whole page
      if (isSection) {
        return (
          <div className="w-full my-4 rounded-2xl bg-[#0d111d]/90 border border-indigo-500/20 backdrop-blur-2xl p-5 sm:p-6 shadow-2xl text-left relative overflow-hidden">
            {/* Ambient subtle glow */}
            <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="flex items-start gap-4 relative z-10">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0 shadow-inner">
                <AlertCircle className="w-5 h-5 text-indigo-400" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-mono uppercase tracking-wider text-indigo-300">
                    Isolated Section
                  </span>
                  <span className="text-xs text-slate-500 font-mono">
                    State Quarantined
                  </span>
                </div>

                <h3 className="text-base font-semibold text-white mt-1.5 tracking-tight">
                  {fallbackTitle || 'Component Synchronizing Issue'}
                </h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {fallbackMessage ||
                    error?.message ||
                    'An unexpected client render exception occurred in this isolated widget.'}
                </p>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={this.handleReset}
                    className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-md shadow-indigo-500/25 flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Retry Component
                  </button>
                  <button
                    onClick={this.handleReload}
                    className="px-3.5 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-300 text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    Reload Page
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      // ── FULL-SCREEN WEB3-DEFI RESILIENCE SCREEN ──
      return (
        <div className="min-h-screen w-full bg-[#07080d] text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 md:p-8 relative overflow-hidden font-sans select-none">
          {/* Ambient Cybernetic Lighting Grid & Gradients */}
          <div className="absolute -top-32 -left-32 w-[520px] h-[520px] bg-indigo-600/15 rounded-full blur-[160px] pointer-events-none" />
          <div className="absolute top-1/3 -right-32 w-[560px] h-[560px] bg-purple-600/12 rounded-full blur-[170px] pointer-events-none" />
          <div className="absolute -bottom-40 left-1/3 w-[600px] h-[600px] bg-cyan-600/10 rounded-full blur-[180px] pointer-events-none" />
          
          {/* Cybernetic Tech Grid */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:3.5rem_3.5rem] [mask-image:radial-gradient(ellipse_75%_65%_at_50%_45%,#000_60%,transparent_100%)] pointer-events-none" />

          {/* Top Brand & Network Telemetry Bar */}
          <div className="w-full max-w-2xl mb-4 flex items-center justify-between px-2 relative z-10">
            <div className="flex items-center gap-3">
              <img
                src={customLogo}
                alt="Arcis Protocol"
                className="h-15 w-auto object-contain brightness-110 drop-shadow-[0_0_12px_rgba(99,102,241,0.5)]"
              />
            </div>
          </div>

          {/* Main Titanium Glassmorphism Card */}
          <div className="relative w-full max-w-2xl rounded-[32px] bg-[#0d101e]/85 border border-white/[0.08] backdrop-blur-3xl p-10 sm:p-9 shadow-[0_30px_90px_rgba(0,0,0,0.75),0_0_0_1px_rgba(255,255,255,0.04),inset_0_1px_0_rgba(255,255,255,0.12)] flex flex-col items-center text-center z-10 transition-all">
            
            {/* Holographic Cyber Shield Centerpiece */}
            <div className="relative mb-10 mt-5 flex items-center justify-center">
              {/* Outer Dashed Orbiting Ring */}
              <div className="absolute w-40 h-40 rounded-full border border-dashed border-indigo-400/30 animate-[spin_40s_linear_infinite]" />
              
              {/* Ambient Glow Aura */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-indigo-500/30 via-purple-500/25 to-cyan-400/20 blur-xl scale-125 animate-pulse" />
              
              {/* Core Shield Emblem */}
              <div className="relative w-25 h-25 rounded-2xl bg-gradient-to-b from-[#181c31] to-[#0d101d] border border-white/15 shadow-[inset_0_1px_2px_rgba(255,255,255,0.25),0_8px_24px_rgba(0,0,0,0.5)] flex items-center justify-center">
                <ShieldCheck className="w-20 h-20 text-indigo-400 filter drop-shadow-[0_0_12px_rgba(52,211,153,0.6)]" />
              </div>
            </div>

            {/* Headline Titles */}
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white mb-2 font-display">
              Interface Safeguard Activated
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-lg mb-6 leading-relaxed">
              Arcis client resilience intercepted an unexpected view render anomaly. Your on-chain session has been cleanly isolated to protect interface consistency.
            </p>         

            {/* ── 3-TIER RECOVERY ACTION COMMAND DECK ── */}
            <div className="w-full flex flex-col sm:flex-row gap-3 mb-10">
              {/* Primary Action: Reload */}
              <button
                onClick={this.handleReload}
                className="flex-1 py-3.5 px-5 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:brightness-110 active:scale-[0.98] text-white text-xs sm:text-sm font-semibold transition-all shadow-[0_0_28px_rgba(99,102,241,0.38)] flex items-center justify-center gap-2.5 cursor-pointer group"
              >
                <RefreshCw className="w-4 h-4 transition-transform duration-300 group-hover:rotate-180" />
                <span>Reload</span>
              </button>

              {/* Secondary Action: Purge Cache & Reconnect */}
              <button
                onClick={this.handleClearCacheAndReload}
                className="py-3.5 px-5 rounded-2xl bg-white/[0.05] hover:bg-white/[0.1] active:scale-[0.98] border border-white/10 hover:border-cyan-500/40 text-slate-200 text-xs sm:text-sm font-medium transition-all flex items-center justify-center gap-2.5 cursor-pointer shadow-sm group"
                title="Clears stale RPC queries and restarts session"
              >
                <Zap className="w-4 h-4 text-cyan-400 transition-transform duration-300 group-hover:scale-110" />
                <span>Purge Cache & Restart</span>
              </button>
            </div>

            {/* Tertiary Utility Links*/}
            <div className="w-full flex items-center justify-between pt-1 pb-4 text-xs text-slate-400 border-b border-white/[0.06]">
              <button
                onClick={this.handleReturnHome}
                className="inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white transition-colors cursor-pointer"
              >
                <Home className="w-3.5 h-3.5 text-slate-400" />
                <span>Return to Safe Hub</span>
              </button>

              <button
                onClick={this.handleReportIssue}
                className="inline-flex items-center gap-1.5 hover:text-indigo-400 transition-colors cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Report to Arcis Protocol</span>
              </button>
            </div>

            {/* ── COLLAPSIBLE WEB3 DIAGNOSTIC TERMINAL ── */}
            <div className="w-full pt-4 text-left">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
                  className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-2 cursor-pointer font-mono"
                >
                  <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Error Log</span>
                  {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                <button
                  onClick={this.handleCopy}
                  className="text-sm text-slate-400 hover:text-indigo-400 transition-colors flex items-center gap-1.5 cursor-pointer font-mono"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-indigo-400" />
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>

              {/* Terminal Code Body */}
              {showDetails && (
                <div className="mt-3.5 rounded-2xl bg-[#06080f] border border-white/[0.08] p-4 text-[11px] font-mono text-slate-400 overflow-x-auto max-h-56 scrollbar-thin select-text shadow-2xl relative">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/[0.06] text-[10px] text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500/80 inline-block" />
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
                      <span className="ml-2 text-slate-400">arcis-telemetry://crash-dump.log</span>
                    </div>
                    <span>{new Date().toLocaleTimeString()}</span>
                  </div>

                  <div className="text-rose-400 font-semibold mb-2 flex items-start gap-1.5">
                    <span className="text-rose-500 shrink-0">&gt;</span>
                    <span>{error?.name || 'Error'}: {error?.message || 'Unknown runtime error'}</span>
                  </div>

                  {error?.stack && (
                    <div className="text-slate-400 text-[10px] whitespace-pre-wrap leading-relaxed mt-1 opacity-90 pl-3 border-l border-white/10">
                      {error.stack.split('\n').slice(0, 10).join('\n')}
                    </div>
                  )}

                  {this.state.errorInfo?.componentStack && (
                    <div className="mt-3 pt-2 border-t border-white/[0.06] text-slate-400 text-[10px] whitespace-pre-wrap pl-3 border-l border-purple-500/30">
                      <div className="text-purple-400 font-semibold mb-1">// Component Stack Hierarchy:</div>
                      {this.state.errorInfo.componentStack.split('\n').slice(0, 6).join('\n')}
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

          {/* Subtle Bottom System Watermark */}
          <div className="mt-5 text-center text-[12px] font-mono text-slate-400 tracking-wider">
            Arcis Protocol // Decentralized Multi-Chain Stability Mesh
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Isolated Error Boundary for specific tabs, sections or modals.
 * Prevents errors inside a tab from crashing other components.
 */
export function SectionErrorBoundary({
  children,
  title,
  message,
}: {
  children: ReactNode
  title?: string
  message?: string
}) {
  return (
    <GlobalErrorBoundary isSection fallbackTitle={title} fallbackMessage={message}>
      {children}
    </GlobalErrorBoundary>
  )
}

export default GlobalErrorBoundary
