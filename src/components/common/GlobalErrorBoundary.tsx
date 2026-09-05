import React, { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, ShieldCheck, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'

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
    console.error('[Arcis GlobalErrorBoundary] Caught unhandled React error:', error, errorInfo)
    this.setState({ errorInfo })
  }

  private handleReload = () => {
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
      sessionStorage.clear()
      window.location.reload()
    } catch {
      window.location.reload()
    }
  }

  private handleCopy = async () => {
    const errorText = [
      `Arcis Application Error Report`,
      `Time: ${new Date().toISOString()}`,
      `URL: ${window.location.href}`,
      `Error: ${this.state.error?.name || 'Error'}: ${this.state.error?.message || 'Unknown error'}`,
      `Stack: ${this.state.error?.stack || 'N/A'}`,
      `Component Stack: ${this.state.errorInfo?.componentStack || 'N/A'}`,
    ].join('\n')

    try {
      await navigator.clipboard.writeText(errorText)
      this.setState({ copied: true })
      setTimeout(() => this.setState({ copied: false }), 2500)
    } catch {
      // Fallback if clipboard API is unavailable
    }
  }

  public render() {
    if (this.state.hasError) {
      const { isSection, fallbackTitle, fallbackMessage } = this.props
      const { error, copied, showDetails } = this.state

      // Section-level isolated error card (for tabs, drawers, cards)
      if (isSection) {
        return (
          <div className="w-full p-6 my-4 rounded-2xl bg-slate-900/90 border border-red-500/30 backdrop-blur-xl shadow-2xl text-left">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-white tracking-wide">
                  {fallbackTitle || 'Component Error'}
                </h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {fallbackMessage || error?.message || 'An unexpected error occurred while rendering this section.'}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={this.handleReset}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Try Again
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      // Full-screen application crash guard
      return (
        <div className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-4 relative overflow-hidden font-sans select-none">
          {/* Ambient Background Glows */}
          <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-[140px] pointer-events-none" />
          <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-red-600/15 rounded-full blur-[140px] pointer-events-none" />
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293710_1px,transparent_1px),linear-gradient(to_bottom,#1f293710_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

          {/* Main Error Modal Card */}
          <div className="relative w-full max-w-xl rounded-3xl bg-slate-900/80 border border-white/10 backdrop-blur-2xl p-6 sm:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.6)] flex flex-col items-center text-center z-10">
            {/* Safe Assets Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-6">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Your on-chain assets and wallet are completely safe</span>
            </div>

            {/* Glowing Error Icon */}
            <div className="relative mb-5">
              <div className="absolute inset-0 rounded-2xl bg-red-500/20 blur-xl animate-pulse" />
              <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500/20 to-amber-500/10 border border-red-500/30 flex items-center justify-center text-red-400 shadow-inner">
                <AlertTriangle className="w-8 h-8" />
              </div>
            </div>

            {/* Header Titles */}
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white mb-2">
              Something went wrong
            </h1>
            <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
              Arcis encountered an unexpected interface issue. You can safely reload the application or reset temporary session cache.
            </p>

            {/* Primary Action Buttons */}
            <div className="w-full flex flex-col sm:flex-row gap-3 mb-6">
              <button
                onClick={this.handleReload}
                className="flex-1 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-[0.99] text-white text-sm font-semibold transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)] flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Application
              </button>
              <button
                onClick={this.handleClearCacheAndReload}
                className="py-3 px-4 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 active:scale-[0.99] border border-white/10 text-slate-300 text-sm font-medium transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                Clear Cache & Restart
              </button>
            </div>

            {/* Collapsible Error Technical Details */}
            <div className="w-full border-t border-white/5 pt-4 text-left">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => this.setState((prev) => ({ showDetails: !prev.showDetails }))}
                  className="text-xs text-slate-400 hover:text-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Technical details</span>
                  {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                <button
                  onClick={this.handleCopy}
                  className="text-xs text-slate-400 hover:text-indigo-400 transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy error report</span>
                    </>
                  )}
                </button>
              </div>

              {showDetails && (
                <div className="mt-3 p-3.5 rounded-xl bg-slate-950/80 border border-white/5 text-[11px] font-mono text-slate-400 overflow-x-auto max-h-48 scrollbar-thin select-text">
                  <div className="text-red-400 font-semibold mb-1">
                    {error?.name || 'Error'}: {error?.message || 'Unknown error'}
                  </div>
                  {error?.stack && (
                    <div className="text-slate-500 text-[10px] whitespace-pre-wrap leading-tight mt-1">
                      {error.stack.split('\n').slice(0, 6).join('\n')}
                    </div>
                  )}
                </div>
              )}
            </div>
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
