// Traditional Wallet Speed & Fee Tier Selector (Standard / Fast / Turbo)
// Reusable UI component designed for BridgeModal, SwapModal, and SendModal.
import React from 'react'
import { Zap, Rocket, Gauge } from 'lucide-react'
import { SPEED_TIERS, type SpeedTier } from '../../config/feeTiers'

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
      const tierConfig = SPEED_TIERS[tier]
      const maxFeeGwei = tierConfig.arcGas.maxFeePerGasGwei
      const priorityFeeGwei = tierConfig.arcGas.maxPriorityFeePerGasGwei
      // CCTP Bridge contract interaction gas limit is ~150,000 gas on Arc L1
      const gasCost = ((150000 * maxFeeGwei) / 1_000_000_000).toFixed(4)

      let desc = 'Standard block inclusion with 20 Gwei base fee floor and 0 Gwei tip. Standard bridge confirmation.'
      let tag = `${maxFeeGwei} Gwei (Base)`

      if (tier === 'fast') {
        desc = `Priority queue with +${priorityFeeGwei} Gwei validator tip for faster block inclusion and accelerated bridge attestation.`
        tag = `${maxFeeGwei} Gwei (+${priorityFeeGwei} Tip)`
      } else if (tier === 'turbo') {
        desc = `Maximum priority with +${priorityFeeGwei} Gwei validator tip (50 Gwei max fee) for instant next-block bridge execution.`
        tag = `${maxFeeGwei} Gwei (+${priorityFeeGwei} Tip)`
      }

      return {
        amount: `~${gasCost} USDC`,
        desc,
        tag,
      }
    }
    if (context === 'swap') {
      const tierConfig = SPEED_TIERS[tier]
      const maxFeeGwei = tierConfig.arcGas.maxFeePerGasGwei
      const priorityFeeGwei = tierConfig.arcGas.maxPriorityFeePerGasGwei
      // Swap contract interaction gas limit is ~120,000 gas on Arc L1
      const gasCost = ((120000 * maxFeeGwei) / 1_000_000_000).toFixed(4)

      let desc = 'Standard block inclusion with 20 Gwei base fee floor and 0 Gwei tip. Optimal during normal traffic.'
      let tag = `${maxFeeGwei} Gwei (Base)`

      if (tier === 'fast') {
        desc = `Priority queue with +${priorityFeeGwei} Gwei validator tip for faster pool routing.`
        tag = `${maxFeeGwei} Gwei (+${priorityFeeGwei} Tip)`
      } else if (tier === 'turbo') {
        desc = `Maximum priority with +${priorityFeeGwei} Gwei validator tip (50 Gwei max fee) for instant next-block swap execution.`
        tag = `${maxFeeGwei} Gwei (+${priorityFeeGwei} Tip)`
      }

      return {
        amount: `~${gasCost} USDC`,
        desc,
        tag,
      }
    }
    // For send: 0% Arcis platform fee; pure Arc L1 blockchain gas & validator priority tip
    const tierConfig = SPEED_TIERS[tier]
    const gasCost = tierConfig.arcGas.estimatedCostUsdc
    const maxFeeGwei = tierConfig.arcGas.maxFeePerGasGwei
    const priorityFeeGwei = tierConfig.arcGas.maxPriorityFeePerGasGwei

    let desc = 'Standard block inclusion with 20 Gwei base fee floor and 0 Gwei tip. Optimal during normal traffic.'
    let tag = `${maxFeeGwei} Gwei (Base)`

    if (tier === 'fast') {
      desc = `Priority queue with +${priorityFeeGwei} Gwei validator tip for faster inclusion during network traffic.`
      tag = `${maxFeeGwei} Gwei (+${priorityFeeGwei} Tip)`
    } else if (tier === 'turbo') {
      desc = `Maximum priority with +${priorityFeeGwei} Gwei validator tip (50 Gwei max fee) for instant next-block execution.`
      tag = `${maxFeeGwei} Gwei (+${priorityFeeGwei} Tip)`
    }

    return {
      amount: `~${gasCost} USDC`,
      desc,
      tag,
    }
  }

  const getIcon = (tier: SpeedTier, isSelected: boolean) => {
    const colorClass = isSelected ? 'text-indigo-400' : 'text-slate-400'
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
                  ? 'bg-white/[0.09] border border-indigo-500/40 shadow-[0_0_16px_rgba(99,102,241,0.18)] scale-[1.02]'
                  : 'bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] text-slate-400 hover:text-white'
              }`}
            >
              {/* Optional Top Badge */}
              {config.badge && (
                <span
                  className={`absolute -top-2.5 px-2 py-0.5 rounded-full font-bold tracking-wider uppercase border ${
                    isSelected
                      ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-[0_0_8px_rgba(99,102,241,0.3)]'
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
                  isSelected ? 'text-indigo-400 font-medium' : 'text-slate-400'
                }`}
              >
                {getContextTime(tier)}
              </span>
            </button>
          )
        })}
      </div>

      {/* Fees Breakdown Section */}
      {showFeeBreakdown && (
        <div className="space-y-2 mb-5">
          {/* Section Header */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold tracking-wide text-slate-300 ml-2 mt-4">
              <span style={{ fontFamily: 'var(--font-app)' }}>NETWORK GAS & PRIORITY (GWEI)</span>
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
                    className={`flex items-start justify-between gap-2 px-3 py-3 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-white/[0.05] border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.08)]'
                        : 'bg-transparent border-transparent text-slate-400'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold capitalize ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                          {tier}
                        </span>
                        {feeInfo.tag && (
                          <span
                            className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border ${
                              isSelected
                                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 shadow-[0_0_8px_rgba(99,102,241,0.3)]'
                                : 'text-slate-400 bg-white/[0.04] border-white/[0.08]'
                            }`}
                          >
                            {feeInfo.tag}
                          </span>
                        )}
                      </div>
                      <p className={`text-[10.5px] leading-relaxed ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {feeInfo.desc}
                      </p>
                    </div>

                    <span
                      className={`font-mono font-semibold text-[12px] whitespace-nowrap text-right shrink-0 pt-0.5 ${
                        isSelected ? 'text-indigo-400' : 'text-slate-400'
                      }`}
                    >
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

