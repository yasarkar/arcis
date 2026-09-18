// Traditional Wallet Speed & Fee Tier Selector (Standard / Fast / Turbo)
// Reusable UI component designed for BridgeModal, SwapModal, and SendModal.
import React from 'react'
import { Zap, Rocket, Gauge } from 'lucide-react'
import { SPEED_TIERS, type SpeedTier } from '../../config/feeTiers'
import {
  PROTOCOL_FEE_RATES,
  getSwapProtocolFeePercent,
  getBridgeProtocolFee,
} from '../../config/treasuryConfig'

interface SpeedFeeSelectorProps {
  selectedTier: SpeedTier
  onSelectTier: (tier: SpeedTier) => void
  context?: 'bridge' | 'send' | 'swap'
  disabled?: boolean
  className?: string
  showFeeBreakdown?: boolean
}

export const SpeedFeeSelector: React.FC<SpeedFeeSelectorProps> = ({
  selectedTier,
  onSelectTier,
  context = 'send',
  disabled = false,
  className = '',
  showFeeBreakdown = true,
}) => {
  const tiers: SpeedTier[] = ['standard', 'fast', 'turbo']

  const getContextTime = (tier: SpeedTier) => {
    const config = SPEED_TIERS[tier]
    switch (context) {
      case 'bridge':
        return config.timeEstimate.cctpBridge
      case 'swap':
        return config.timeEstimate.swap
      case 'send':
      default:
        return config.timeEstimate.arcL1
    }
  }

  const getFeeInfo = (tier: SpeedTier) => {
    if (context === 'bridge') {
      const fee = getBridgeProtocolFee(tier)
      return {
        amount: `${fee.toFixed(2)} USDC`,
        desc: PROTOCOL_FEE_RATES.bridge[tier]?.description || 'Bridge fee',
      }
    }
    if (context === 'swap') {
      const percent = getSwapProtocolFeePercent(tier)
      return {
        amount: `${percent} Protocol Fee`,
        desc: PROTOCOL_FEE_RATES.swap[tier]?.description || 'Swap routing fee',
      }
    }
    // For send:
    const gasCost = SPEED_TIERS[tier].arcGas.estimatedCostUsdc
    return {
      amount: `~${gasCost} USDC`,
      desc: PROTOCOL_FEE_RATES.send[tier]?.description || 'Arc L1 native gas (0% platform fee)',
    }
  }

  const TIER_COLORS = {
    standard: {
      text: 'text-cyan-400',
      border: 'border-cyan-500/40',
      shadow: 'shadow-[0_0_16px_rgba(6,182,212,0.18)]',
      badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.3)]',
      feeBorder: 'border-cyan-500/30 shadow-[0_0_10px_rgba(6,182,212,0.08)]',
    },
    fast: {
      text: 'text-indigo-400',
      border: 'border-indigo-500/40',
      shadow: 'shadow-[0_0_16px_rgba(99,102,241,0.18)]',
      badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-[0_0_8px_rgba(99,102,241,0.3)]',
      feeBorder: 'border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.08)]',
    },
    turbo: {
      text: 'text-amber-400',
      border: 'border-amber-500/40',
      shadow: 'shadow-[0_0_16px_rgba(245,158,11,0.18)]',
      badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.3)]',
      feeBorder: 'border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.08)]',
    },
  } as const

  const getIcon = (tier: SpeedTier, isSelected: boolean) => {
    const colorClass = isSelected ? TIER_COLORS[tier].text : 'text-slate-400'
    switch (tier) {
      case 'standard':
        return <Gauge className={`w-4 h-4 ${colorClass}`} />
      case 'fast':
        return <Zap className={`w-4 h-4 ${colorClass}`} />
      case 'turbo':
        return <Rocket className={`w-4 h-4 ${colorClass}`} />
    }
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-slate-300 ml-3">
          <span style={{ fontFamily: 'var(--font-app)' }}>SPEED & NETWORK PRIORITY</span>
        </div>
      </div>

      {/* 3-Tier Buttons Grid */}
      <div
        className="grid grid-cols-3 gap-3 p-2 rounded-2xl"
        style={{
          backdropFilter: 'blur(16px)',
        }}
      >
        {tiers.map((tier) => {
          const config = SPEED_TIERS[tier]
          const isSelected = selectedTier === tier

          return (
            <button
              key={tier}
              type="button"
              disabled={disabled}
              onClick={() => onSelectTier(tier)}
              className={`relative flex flex-col items-center justify-center py-3.5 px-3 rounded-xl transition-all duration-200 cursor-pointer text-center group ${
                isSelected
                  ? `bg-white/[0.09] border ${TIER_COLORS[tier].border} ${TIER_COLORS[tier].shadow} scale-[1.02]`
                  : 'bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] text-slate-400 hover:text-white'
              }`}
            >
              {/* Optional Top Badge */}
              {config.badge && (
                <span
                  className={`absolute -top-2.5 px-2 py-0.5 rounded-full font-bold tracking-wider uppercase border ${
                    isSelected
                      ? TIER_COLORS[tier].badge
                      : 'bg-white/[0.06] text-slate-400 border-white/10'
                  }`}
                  style={{ fontSize: '10px', lineHeight: '12px' }}
                >
                  {config.badge}
                </span>
              )}

              {/* Title & Icon */}
              <div className="flex items-center gap-1.5 mb-1 mt-0.5">
                {getIcon(tier, isSelected)}
                <span
                  className={`text-xs sm:text-sm font-semibold tracking-wide ${
                    isSelected ? 'text-white' : 'text-slate-200 group-hover:text-white'
                  }`}
                  style={{ fontFamily: 'var(--font-app)' }}
                >
                  {config.label}
                </span>
              </div>

              {/* Execution Time */}
              <span
                className={`text-[11px] font-mono flex items-center gap-1 ${
                  isSelected ? `${TIER_COLORS[tier].text} font-medium` : 'text-slate-400'
                }`}
              >
                {getContextTime(tier)}
              </span>
            </button>
          )
        })}
      </div>

      {/* Arcis Platform Fees Breakdown Section */}
      {showFeeBreakdown && (
        <div className="space-y-2 mb-5">
          {/* Top Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-slate-300 ml-3 mt-5">
              <span style={{ fontFamily: 'var(--font-app)' }}>ARCIS PLATFORM FEES</span>
            </div>
          </div>

          <div
            className="p-3.5 rounded-2xl border border-white/[0.08] space-y-2"
            style={{
              background: 'rgba(11, 13, 24, 0.65)',
              backdropFilter: 'blur(12px)',
            }}
          >
            <div className="space-y-2 text-[11px]">
            {tiers.map((tier) => {
              const feeInfo = getFeeInfo(tier)
              const isSelected = selectedTier === tier
              return (
                <div
                  key={tier}
                  className={`flex items-start justify-between gap-2 p-2 rounded-xl border transition-all ${
                    isSelected
                      ? `bg-white/[0.05] border ${TIER_COLORS[tier].feeBorder}`
                      : 'bg-transparent border-transparent text-slate-400'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-semibold capitalize ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                        {tier}
                      </span>
                    </div>
                    <p className={`text-[10.5px] leading-relaxed ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                      {feeInfo.desc}
                    </p>
                  </div>
                  <span className={`font-mono font-semibold text-[12px] whitespace-nowrap text-right shrink-0 ${
                    isSelected ? TIER_COLORS[tier].text : 'text-slate-400'
                  }`}>
                    {feeInfo.amount}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )}
  </div>
  )
}
export default SpeedFeeSelector

