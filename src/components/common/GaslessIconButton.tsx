import React, { useState } from 'react'
import { Zap } from 'lucide-react'

interface GaslessIconButtonProps {
  isActive: boolean
  onToggle: () => void
  disabled?: boolean
  remainingQuota?: number
  dailyLimit?: number
  size?: 'sm' | 'md' | 'lg'
  className?: string
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right'
}

export const GaslessIconButton: React.FC<GaslessIconButtonProps> = ({
  isActive,
  onToggle,
  disabled = false,
  remainingQuota = 5,
  dailyLimit = 5,
  size = 'md',
  className = '',
  tooltipPosition = 'bottom',
}) => {
  const [showTooltip, setShowTooltip] = useState(false)

  const sizeClasses = {
    sm: 'w-7 h-7 rounded-full',
    md: 'w-8 h-8 rounded-full',
    lg: 'w-9 h-9 rounded-full',
  }

  const iconSizes = {
    sm: 13,
    md: 15,
    lg: 17,
  }

  const tooltipPosClasses = {
    top: 'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 right-0',
    left: 'right-full mr-2 top-1/2 -translate-y-1/2',
    right: 'left-full ml-2 top-1/2 -translate-y-1/2',
  }

  return (
    <div
      className={`relative inline-flex items-center select-none ${className}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        aria-label={isActive ? '0-Gas Mode Active (Click to disable)' : '0-Gas Mode Off (Click to enable)'}
        className={`group relative flex items-center justify-center transition-all duration-200 cursor-pointer outline-none ${
          sizeClasses[size]
        } ${
          disabled ? 'opacity-40 cursor-not-allowed' : 'active:scale-95 hover:scale-105'
        } ${
          isActive
            ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-400/40 shadow-[0_0_14px_rgba(16,185,129,0.3)]'
            : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] hover:border-white/[0.15]'
        }`}
      >
        {/* Subtle emerald glow orb behind icon when active */}
        {isActive && (
          <span className="absolute inset-0 rounded-full bg-emerald-500/20 blur-md pointer-events-none animate-pulse" />
        )}

        {/* Zap Icon with micro-transition */}
        <div className="relative z-10 transition-transform duration-200 group-hover:scale-110">
          {isActive ? (
            <Zap
              size={iconSizes[size]}
              className="text-emerald-400 fill-emerald-400 transition-colors"
            />
          ) : (
            <Zap
              size={iconSizes[size]}
              className="text-slate-400 group-hover:text-slate-200 transition-colors"
            />
          )}
        </div>
      </button>

      {/* Floating Micro Tooltip */}
      {showTooltip && (
        <div
          className={`absolute z-[150] pointer-events-none px-3 py-2 rounded-xl text-[11px] font-sans font-medium whitespace-nowrap shadow-2xl backdrop-blur-xl border transition-all duration-150 animate-fade-in ${
            tooltipPosClasses[tooltipPosition]
          } ${
            isActive
              ? 'bg-[#0a151b]/95 text-white border-emerald-500/35 shadow-[0_4px_20px_rgba(0,0,0,0.5)]'
              : 'bg-[#0f131f]/95 text-slate-300 border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.5)]'
          }`}
        >
          <div className="flex items-center gap-1.5 font-bold">
            <Zap className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-400 fill-emerald-400' : 'text-slate-400'}`} />
            <span>{isActive ? '0-Gas Quick-Start (Active)' : 'Standard Gas Mode'}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
            {isActive ? (
              <>
                <span className="text-emerald-300 font-semibold">{remainingQuota}/{dailyLimit} Free sends left</span>
                <span>• Subsidized (EIP-3009)</span>
              </>
            ) : (
              <span>Click to activate free sponsored sends</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
