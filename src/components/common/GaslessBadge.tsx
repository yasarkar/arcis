import React, { useState, useRef, useEffect } from 'react'
import { Zap, ShieldCheck, Sparkles, CheckCircle2, ChevronDown, ExternalLink} from 'lucide-react'
import { TREASURY_ADDRESS } from '../../config/treasuryConfig'
import { arcTestnet } from '../../config/arcChain'
import { getExplorerAddressUrl } from '../../config/sendConfig'

interface GaslessBadgeProps {
  isActive: boolean
  onToggle?: (active: boolean) => void
  remainingQuota?: number
  dailyLimit?: number
  disabled?: boolean
  isZeroGasWallet?: boolean
  relayerAddress?: string
}

export const GaslessBadge: React.FC<GaslessBadgeProps> = ({
  isActive,
  onToggle,
  remainingQuota = 5,
  dailyLimit = 5,
  disabled = false,
  isZeroGasWallet = false,
  relayerAddress = TREASURY_ADDRESS,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  const usedQuota = Math.max(0, dailyLimit - remainingQuota)

  return (
    <div className="relative inline-flex items-center" ref={containerRef}>
      {/* Interactive Trigger Capsule */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(prev => !prev)}
        className={`group relative flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide transition-all duration-300 cursor-pointer ${
          isActive
            ? 'text-white border border-emerald-400/40 shadow-[0_0_18px_rgba(16,185,129,0.22)]'
            : 'text-slate-400 bg-white/[0.03] border border-white/[0.07] hover:text-slate-200 hover:bg-white/[0.06]'
        }`}
        style={{
          fontFamily: 'var(--font-app)',
          background: isActive
            ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(99, 102, 241, 0.15) 100%)'
            : undefined,
        }}
        title="Arcis Gasless Quick-Start Details"
      >
        {/* Animated Glow Pill */}
        <div className="relative flex items-center justify-center">
          {isActive ? (
            <>
              <span className="absolute w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-60" />
              <div className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center relative z-10">
                <Zap className="w-2.5 h-2.5 text-emerald-400 fill-emerald-400" />
              </div>
            </>
          ) : (
            <div className="w-4 h-4 rounded-full bg-white/[0.05] border border-white/[0.1] flex items-center justify-center">
              <Zap className="w-2.5 h-2.5 text-slate-500" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className="font-bold tracking-wider text-[11px]"
            style={{ fontFamily: 'var(--fonts--space-mono, monospace)' }}
          >
            {isActive ? '0-GAS' : 'GASLESS OFF'}
          </span>

          {isActive && (
            <div className="flex items-center gap-1 pl-1 border-l border-emerald-500/30">
              {/* Segmented quota meter (5 visual mini-bars) */}
              <div className="flex items-center gap-0.5">
                {Array.from({ length: dailyLimit }).map((_, i) => (
                  <span
                    key={i}
                    className={`w-1 h-2 rounded-full transition-all ${
                      i < remainingQuota
                        ? 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.8)]'
                        : 'bg-white/10'
                    }`}
                  />
                ))}
              </div>
              <span className="text-[10px] font-mono text-emerald-300 font-semibold ml-0.5">
                {remainingQuota}/{dailyLimit}
              </span>
            </div>
          )}
        </div>

        {isZeroGasWallet && isActive && (
          <span className="hidden xl:inline-flex items-center gap-1 text-[9px] font-mono text-amber-300 bg-amber-400/10 px-1.5 py-0.2 rounded-full border border-amber-400/25">
            <Sparkles className="w-2.5 h-2.5" />
            Auto-Active
          </span>
        )}

        <ChevronDown
          size={12}
          className={`transition-transform duration-200 opacity-60 group-hover:opacity-100 ${
            isOpen ? 'rotate-180 text-emerald-400' : 'text-slate-400'
          }`}
        />
      </button>

      {/* Luxury Dropdown Popover */}
      {isOpen && (
        <div
          className="absolute z-[150] top-full right-0 mt-2.5 w-80 p-4.5 rounded-3xl backdrop-blur-2xl shadow-2xl space-y-3.5 animate-fade-in text-left border"
          style={{
            background: 'linear-gradient(150deg, rgba(18, 22, 38, 0.98) 0%, rgba(11, 14, 25, 0.98) 100%)',
            borderColor: 'rgba(16, 185, 129, 0.35)',
            boxShadow: '0 24px 48px -12px rgba(0, 0, 0, 0.8), 0 0 24px rgba(16, 185, 129, 0.15)',
            fontFamily: 'var(--font-app)',
          }}
        >
          {/* Popover Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.2)]">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-bold text-white tracking-wide">
                  Gasless Quick-Start
                </div>
                <div className="text-[10px] text-emerald-400/90 font-mono">
                  EIP-3009 Sponsored Mode
                </div>
              </div>
            </div>

            <span className="text-[9px] font-mono font-bold text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-400/40">
              100% SPONSORED
            </span>
          </div>

          {/* Value Prop Description */}
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Arcis Relayer transfers USDC on your behalf via off-chain{' '}
            <strong className="text-white">EIP-712 authorization</strong>. Zero native gas is deducted from your wallet balance.
          </p>

          {/* Quota Progress Card */}
          <div className="p-3 rounded-2xl bg-white/[0.025] border border-white/[0.06] space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Daily Free Quota</span>
              </span>
              <span className="text-white font-mono font-bold">
                {remainingQuota} of {dailyLimit} Free Transfers
              </span>
            </div>

            {/* Segmented Visual Meter */}
            <div className="grid grid-cols-5 gap-1.5 pt-1">
              {Array.from({ length: dailyLimit }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i < remainingQuota
                      ? 'bg-gradient-to-r from-emerald-400 to-teal-400 shadow-[0_0_8px_rgba(16,185,129,0.7)]'
                      : 'bg-white/10'
                  }`}
                />
              ))}
            </div>

            <div className="flex justify-between text-[9px] text-slate-500 font-mono pt-0.5">
              <span>Used: {usedQuota}</span>
              <span>Resets: Daily (00:00 UTC)</span>
            </div>
          </div>

          {/* Relayer & Network Details */}
          <div className="space-y-1.5 text-[10px] font-mono border-t border-white/[0.06] pt-2.5 text-slate-400">
            <div className="flex justify-between items-center">
              <span>Network:</span>
              <span className="text-white font-semibold">{arcTestnet.name} ({arcTestnet.id})</span>
            </div>
            <div className="flex justify-between items-center">
              <span>Settlement Speed:</span>
              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                &lt;400ms Sub-Second
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span>Sponsor Relayer:</span>
              <a
                href={getExplorerAddressUrl('Arc_Testnet', relayerAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-300 hover:text-emerald-400 flex items-center gap-1 transition-colors"
                title={relayerAddress}
              >
                <span>{relayerAddress.slice(0, 6)}...{relayerAddress.slice(-4)}</span>
                <ExternalLink size={10} />
              </a>
            </div>
          </div>

          {/* Mode Switch Toggle Button inside Popover */}
          <div className="pt-2 border-t border-white/[0.08] flex items-center justify-between">
            <span className="text-[11px] text-slate-300 font-medium">Toggle Gasless Mode:</span>
            <button
              type="button"
              onClick={() => {
                onToggle?.(!isActive)
              }}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                isActive
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/30'
                  : 'bg-white/10 text-slate-300 border border-white/20 hover:bg-white/20'
              }`}
            >
              {isActive ? 'Active (ON)' : 'Disabled (OFF)'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
