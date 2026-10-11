import React from 'react'
import { Plus, Minus, RefreshCw } from 'lucide-react'
import type { PoolConfig } from '../../config/poolsConfig'
import type { UserPoolPosition } from '../../hooks/usePoolsData'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../../assets/Token-Icon/CIRCLE Token.svg'

export interface PositionItem {
  id: string
  poolId: string
  name: string
  token1Symbol: string
  token2Symbol: string
  token1Amount?: string
  token2Amount?: string
  version: string
  feeTier: string
  apr: number
  unclaimedFeesUsd: number
  positionUsd: number
  token1Ratio: number // e.g. 50 for 50%
  token2Ratio: number // e.g. 50 for 50%
  token1IconType: 'btc' | 'usdc' | 'eurc'
  token2IconType: 'btc' | 'usdc' | 'eurc'
  minRange: string
  maxRange: string
  currentPriceDisplay: string
  inRange: boolean
  poolConfig?: PoolConfig & { userPosition?: UserPoolPosition }
}

interface PositionCardProps {
  position: PositionItem
  isMasked: boolean
  onClaim: (poolId: string) => void
  onAddLiquidity: (pool?: PoolConfig) => void
  onRemoveLiquidity: (pool?: PoolConfig) => void
  isClaiming: boolean
  claimingPoolId: string | null
}

export const PositionCard: React.FC<PositionCardProps> = ({
  position,
  isMasked,
  onClaim,
  onAddLiquidity,
  onRemoveLiquidity,
  isClaiming,
  claimingPoolId,
}) => {
  const isThisClaiming = isClaiming && claimingPoolId === position.poolId

  // Render Real Token Icons
  const renderTokenIcon = (type: PositionItem['token1IconType'], isFirst: boolean) => {
    const marginClass = isFirst ? 'z-10' : '-ml-3 z-0'
    let src = UsdcIcon
    if (type === 'btc') src = CirBtcIcon || CircleIcon
    if (type === 'eurc') src = EurcIcon

    return (
      <div
        className={`w-8 h-8 rounded-full bg-[#141727] border border-white/10 flex items-center justify-center p-1 shadow-md ${marginClass} shrink-0 overflow-hidden`}
      >
        <img src={src} alt="Token" className="w-full h-full object-contain" />
      </div>
    )
  }

  // Value mask helper
  const displayUsd = (val: number, decimals: number = 2): string => {
    if (isMasked) return '••••••'
    return `$${val.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`
  }

  return (
    <div
      className="relative flex flex-col justify-between p-5 sm:p-6 rounded-[26px] transition-all duration-300 group"
      style={{
        background: 'linear-gradient(160deg, rgba(20, 24, 42, 0.94) 0%, rgba(14, 17, 30, 0.98) 100%)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.04), 0 20px 40px -12px rgba(0, 0, 0, 0.6)',
        fontFamily: 'var(--font-app)',
      }}
    >
      {/* ── 1. Top Row: Token Pair & Badges & APR ── */}
      <div className="flex items-center justify-between gap-2 pb-4">
        {/* Token Pair & Badges */}
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Overlapping Icons */}
          <div className="flex items-center shrink-0">
            {renderTokenIcon(position.token1IconType, true)}
            {renderTokenIcon(position.token2IconType, false)}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <span className="font-bold text-white text-sm sm:text-base tracking-tight truncate">
              {position.name}
            </span>

            {/* V3 Badge (Orange pill) */}
            <span
              className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider select-none shrink-0"
              style={{
                background: 'rgba(249, 115, 22, 0.2)',
                color: '#fb923c',
                border: '1px solid rgba(249, 115, 22, 0.35)',
              }}
            >
              {position.version}
            </span>

            {/* Fee Tier Badge */}
            <span
              className="px-1.5 py-0.5 rounded-full text-[10px] font-medium select-none shrink-0"
              style={{
                background: 'rgba(251, 191, 36, 0.1)',
                color: '#fde68a',
                border: '1px solid rgba(251, 191, 36, 0.22)',
              }}
            >
              {position.feeTier}
            </span>
          </div>
        </div>

        {/* APR Pill in Top-Right */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold shrink-0"
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <span className="text-[10px] font-medium text-[var(--fp-4)] uppercase">APR</span>
          <span className="font-bold text-white tabular-nums tracking-tight">
            {position.apr.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* ── 2. Unclaimed Fees Box with Vibrant Claim Button (Matching Screenshot) ── */}
      <div
        className="rounded-2xl p-4 my-2 border flex flex-col gap-3 transition-colors"
        style={{
          background: 'rgba(10, 13, 24, 0.75)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div>
          <span className="text-[11px] font-medium text-[var(--fp-4)] block leading-tight">
            Unclaimed Fees
          </span>
          <span
            className="text-2xl sm:text-[26px] font-bold text-white tracking-tight tabular-nums block mt-1"
            style={{ fontFamily: 'var(--fonts--space-grotesk, var(--font-app))' }}
          >
            {displayUsd(position.unclaimedFeesUsd, 4)}
          </span>
        </div>

        {/* Vibrant Orange Claim Button (Matching Screenshot) */}
        <button
          type="button"
          onClick={() => onClaim(position.poolId)}
          disabled={isThisClaiming || position.unclaimedFeesUsd <= 0}
          className="w-full py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm tracking-wide text-white transition-all duration-200 shadow-lg active:scale-95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 select-none"
          style={{
            background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
            boxShadow: '0 6px 18px -4px rgba(249, 115, 22, 0.45)',
          }}
          onMouseEnter={(e) => {
            if (position.unclaimedFeesUsd > 0) {
              e.currentTarget.style.filter = 'brightness(1.1)'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = 'none'
          }}
        >
          {isThisClaiming ? (
            <>
              <RefreshCw size={14} className="arcis-spin" />
              <span>Claiming...</span>
            </>
          ) : (
            <span>Claim</span>
          )}
        </button>
      </div>

      {/* ── 3. Position Balance and Mini [ - ] / [ + ] Controls ── */}
      <div className="flex items-center justify-between pt-3 pb-2">
        <div className="flex flex-col">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-[var(--fp-4)] font-medium">Position</span>
            <span
              className="text-sm sm:text-base font-bold text-white tabular-nums tracking-tight"
              style={{ fontFamily: 'var(--fonts--space-grotesk, var(--font-app))' }}
            >
              {displayUsd(position.positionUsd, 2)}
            </span>
          </div>
          {(position.token1Amount || position.token2Amount) && (
            <span className="text-[10px] sm:text-[11px] text-[var(--fp-4)] font-mono mt-0.5">
              {position.token1Amount} {position.token1Symbol} + {position.token2Amount} {position.token2Symbol}
            </span>
          )}
        </div>

        {/* Mini Liquidity Controls [ - ] and [ + ] */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onRemoveLiquidity(position.poolConfig)}
            className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/20 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer active:scale-90"
            title="Remove Liquidity"
            aria-label="Remove Liquidity"
          >
            <Minus size={13} />
          </button>
          <button
            type="button"
            onClick={() => onAddLiquidity(position.poolConfig)}
            className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/20 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer active:scale-90"
            title="Add Liquidity"
            aria-label="Add Liquidity"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* ── 4. Ratio Labels and Dual-Segment Progress Bar ── */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between text-xs font-semibold">
          {/* Token 1 Ratio */}
          <div className="flex items-center gap-1 text-amber-400">
            <span className="w-3.5 h-3.5 rounded-full bg-amber-500/20 flex items-center justify-center text-[10px]">
              ₿
            </span>
            <span className="tabular-nums">{position.token1Ratio}%</span>
          </div>

          {/* Token 2 Ratio */}
          <div className="flex items-center gap-1 text-slate-300">
            <span className="tabular-nums">{position.token2Ratio}%</span>
            <span className="w-3.5 h-3.5 rounded-full bg-white/10 flex items-center justify-center text-[9px]">
              ●
            </span>
          </div>
        </div>

        {/* Dual-color Segmented Progress Bar */}
        <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden flex">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
            style={{ width: `${position.token1Ratio}%` }}
          />
          <div
            className="h-full bg-gradient-to-r from-slate-400 to-indigo-400 transition-all duration-500"
            style={{ width: `${position.token2Ratio}%` }}
          />
        </div>
      </div>

      {/* ── 5. Min / Max Price Range ── */}
      <div className="flex items-center justify-between text-[11px] text-[var(--fp-4)] font-medium pt-2 pb-3">
        <span>Min <strong className="text-white/80 tabular-nums">{position.minRange}</strong></span>
        <span>Max <strong className="text-white/80 tabular-nums">{position.maxRange}</strong></span>
      </div>

      {/* ── 6. Bottom Price & In-Range Status Capsule ── */}
      <div
        className="rounded-xl px-3 py-2 flex items-center justify-between text-xs font-medium border transition-colors"
        style={{
          background: position.inRange ? 'rgba(1, 208, 98, 0.08)' : 'rgba(245, 158, 11, 0.08)',
          borderColor: position.inRange ? 'rgba(1, 208, 98, 0.22)' : 'rgba(245, 158, 11, 0.25)',
          color: position.inRange ? 'var(--earned-green)' : '#fbbf24',
        }}
      >
        <span className="text-[11px] sm:text-xs truncate font-medium">
          {position.currentPriceDisplay}
        </span>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <span
            className={`w-2 h-2 rounded-full ${
              position.inRange ? 'bg-[var(--earned-green)] animate-pulse' : 'bg-amber-400'
            }`}
          />
          <span className="text-[10px] font-bold uppercase tracking-wider">
            {position.inRange ? 'In Range' : 'Out of Range'}
          </span>
        </div>
      </div>
    </div>
  )
}

export default PositionCard
