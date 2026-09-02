// src/components/common/SpeedFeeSelector.tsx
//
// Traditional Wallet Speed & Fee Tier Selector (Standard / Fast / Turbo)
// Reusable UI component designed for BridgeModal, SwapModal, and SendModal.

import React from 'react'
import { Zap, Rocket, Gauge, Clock, Coins } from 'lucide-react'
import { SPEED_TIERS, type SpeedTier } from '../../config/feeTiers'
import {
  PROTOCOL_FEE_RATES,
  getSendProtocolFee,
  getSwapProtocolFeePercent,
  getBridgeProtocolFee,
  REVENUE_SHARE_LABEL,
  REVENUE_SHARE_TOOLTIP,
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
    const sendFee = getSendProtocolFee(tier)
    return {
      amount: sendFee === 0 ? 'Free (0.00 USDC)' : `+${sendFee.toFixed(3)} USDC`,
      desc: PROTOCOL_FEE_RATES.send[tier]?.description || 'Send platform fee',
    }
  }

  const getIcon = (tier: SpeedTier, isSelected: boolean) => {
    switch (tier) {
      case 'standard':
        return <Gauge className={`w-4 h-4 ${isSelected ? 'text-blue-400' : 'text-slate-400'}`} />
      case 'fast':
        return <Zap className={`w-4 h-4 ${isSelected ? 'text-[var(--purple-1,#9896ff)]' : 'text-slate-400'}`} />
      case 'turbo':
        return <Rocket className={`w-4 h-4 ${isSelected ? 'text-amber-400' : 'text-slate-400'}`} />
    }
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Top Header */}
      <div className="flex items-center justify-between mt-5">
        <div className="flex items-center gap-1.5 text-[14px] font-semibold tracking-wide text-slate-300">
          <span style={{ fontFamily: 'var(--font-app)' }}>SPEED & NETWORK PRIORITY</span>
        </div>
        <span
          className={`text-[14px] font-semibold font-mono flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border transition-all ${
            selectedTier === 'turbo'
              ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
              : selectedTier === 'fast'
                ? 'bg-[rgba(152,150,255,0.15)] text-[var(--purple-1,#9896ff)] border-[rgba(152,150,255,0.35)] shadow-[0_0_12px_rgba(152,150,255,0.18)]'
                : 'bg-blue-500/10 text-blue-300 border-blue-500/25'
          }`}
        >
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span>{getContextTime(selectedTier)}</span>
        </span>
      </div>

      {/* 3-Tier Buttons Grid */}
      <div
        className="grid grid-cols-3 gap-3 p-2 rounded-2xl border border-white/[0.08] mt-3.5"
        style={{
          background: 'rgba(11, 13, 24, 0.75)',
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
                  ? 'bg-white/[0.09] border border-[rgba(152,150,255,0.4)] shadow-[0_0_16px_rgba(152,150,255,0.18)] scale-[1.02]'
                  : 'bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] text-slate-400 hover:text-white'
              }`}
            >
              {/* Optional Top Badge */}
              {config.badge && (
                <span
                  className={`absolute -top-2.5 px-2 py-0.5 rounded-full font-bold tracking-wider uppercase border ${
                    isSelected
                      ? tier === 'turbo'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                        : 'bg-[rgba(152,150,255,0.25)] text-[var(--purple-1,#9896ff)] border-[rgba(152,150,255,0.5)]'
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
                  isSelected ? 'text-[var(--purple-1,#9896ff)] font-medium' : 'text-slate-400'
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
        <div
          className="p-3.5 rounded-2xl border border-white/[0.08] space-y-2.5 mt-2"
          style={{
            background: 'rgba(11, 13, 24, 0.65)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div className="flex items-center justify-between pb-1.5 border-b border-white/[0.06]">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200 tracking-wide">
              <Coins className="w-3.5 h-3.5 text-[var(--purple-1,#9896ff)]" />
              <span style={{ fontFamily: 'var(--font-app)' }}>Arcis Platform Fees</span>
            </div>
          </div>

          <div className="space-y-2 text-[11px]">
            {tiers.map((tier) => {
              const feeInfo = getFeeInfo(tier)
              const isSelected = selectedTier === tier
              return (
                <div
                  key={tier}
                  className={`flex items-start justify-between gap-2 p-2 rounded-xl border transition-all ${
                    isSelected
                      ? 'bg-white/[0.05] border-[rgba(152,150,255,0.3)] shadow-[0_0_10px_rgba(152,150,255,0.08)]'
                      : 'bg-transparent border-transparent text-slate-400'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`font-semibold capitalize ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                        {tier}
                      </span>
                      {isSelected && (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-[rgba(152,150,255,0.2)] text-[var(--purple-1,#9896ff)] border border-[rgba(152,150,255,0.35)]">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className={`text-[10.5px] leading-relaxed ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                      {feeInfo.desc}
                    </p>
                  </div>
                  <span className={`font-mono font-semibold whitespace-nowrap text-right shrink-0 ${
                    isSelected ? 'text-[var(--purple-1,#9896ff)]' : 'text-slate-400'
                  }`}>
                    {feeInfo.amount}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Revenue share footnote */}
          <div
            className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] text-slate-400"
            title={REVENUE_SHARE_TOOLTIP}
          >
            <span className="flex items-center gap-1">
              <Coins className="w-3 h-3 text-[var(--purple-1,#9896ff)]" />
              Arcis Platform Revenue Sharing
            </span>
            <span className="font-mono text-slate-300 font-medium">
              {REVENUE_SHARE_LABEL}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
export default SpeedFeeSelector

