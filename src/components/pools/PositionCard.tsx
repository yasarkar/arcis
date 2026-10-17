import React from 'react'
import { Plus, Minus, RefreshCw } from 'lucide-react'
import type { PoolConfig } from '../../config/poolsConfig'
import type { UserPoolPosition } from '../../hooks/usePoolsData'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import { WethIcon } from '../../config/tokenIcons'
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
  token1IconType: 'btc' | 'usdc' | 'eurc' | 'weth'
  token2IconType?: 'btc' | 'usdc' | 'eurc' | 'weth'
  minRange?: string
  maxRange?: string
  currentPriceDisplay?: string
  inRange?: boolean
  isVault?: boolean
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

export interface TokenAssetConfig {
  icon: string
  textColorClass: string
  barGradient: string
}

export function getTokenAssetConfig(
  symbol?: string,
  iconType?: PositionItem['token1IconType']
): TokenAssetConfig {
  const sym = (symbol || '').toUpperCase()

  // EURC: Darker Blue (Koyu mavi)
  if (sym.includes('EUR') || iconType === 'eurc') {
    return {
      icon: EurcIcon,
      textColorClass: 'text-blue-500',
      barGradient: 'linear-gradient(90deg, #1e40af 0%, #2563eb 100%)',
    }
  }

  // cirBTC: Dark Orange (Koyu turuncu)
  if (sym.includes('BTC') || iconType === 'btc') {
    return {
      icon: CirBtcIcon || CircleIcon,
      textColorClass: 'text-orange-500',
      barGradient: 'linear-gradient(90deg, #c2410c 0%, #ea580c 100%)',
    }
  }

  // WETH: Purple / Indigo (Ethereum)
  if (sym.includes('ETH') || iconType === 'weth') {
    return {
      icon: WethIcon,
      textColorClass: 'text-indigo-400',
      barGradient: 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)',
    }
  }

  // USDC: Lighter Blue (Açık mavi)
  if (sym.includes('USD') || iconType === 'usdc') {
    return {
      icon: UsdcIcon,
      textColorClass: 'text-sky-400',
      barGradient: 'linear-gradient(90deg, #0284c7 0%, #38bdf8 100%)',
    }
  }

  // Default fallback
  return {
    icon: UsdcIcon,
    textColorClass: 'text-sky-400',
    barGradient: 'linear-gradient(90deg, #0284c7 0%, #38bdf8 100%)',
  }
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

  const token1Config = getTokenAssetConfig(position.token1Symbol, position.token1IconType)
  const token2Config = getTokenAssetConfig(position.token2Symbol, position.token2IconType)

  // Render Real Token Icons
  const renderTokenIcon = (type?: PositionItem['token1IconType'], isFirst: boolean = true) => {
    if (!type) return null
    const marginClass = isFirst ? 'z-10' : '-ml-3 z-0'
    let src = UsdcIcon
    if (type === 'btc') src = CirBtcIcon || CircleIcon
    if (type === 'eurc') src = EurcIcon
    if (type === 'weth') src = WethIcon

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

  const MIN_CLAIMABLE_USD = 0.01
  const isClaimable = position.unclaimedFeesUsd >= MIN_CLAIMABLE_USD
  const hasAccruedMicroFees = position.unclaimedFeesUsd > 0 && !isClaimable

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
      {/* ── 1. Top Row: Token Pair & Badges & APR (Consistent 2-line layout) ── */}
      <div className="flex items-start justify-between gap-3 pb-4">
        {/* Token Pair & Badges */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Overlapping Icons (single icon for vault) */}
          <div className="flex items-center shrink-0">
            {renderTokenIcon(position.token1IconType, true)}
            {!position.isVault && position.token2IconType && renderTokenIcon(position.token2IconType, false)}
          </div>

          <div className="flex flex-col min-w-0 justify-center">
            {/* Title */}
            <span className="font-bold text-white text-sm sm:text-base tracking-tight truncate leading-tight">
              {position.name}
            </span>

            {/* Badges Row - Always clean on line 2, ensuring identical card heights */}
            <div className="flex items-center gap-1.5 mt-1.5">
              {/* Version Badge */}
              <span
                className="px-1.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider select-none shrink-0"
                style={{
                  background: 'rgba(249, 115, 22, 0.2)',
                  color: '#fb923c',
                  border: '1px solid rgba(249, 115, 22, 0.35)',
                }}
              >
                {position.version}
              </span>

              {/* Fee Tier or Vault Type Badge */}
              <span
                className="px-1.5 py-0.5 rounded-md text-[10px] font-medium select-none shrink-0"
                style={{
                  background: position.isVault ? 'rgba(56, 189, 248, 0.15)' : 'rgba(251, 191, 36, 0.1)',
                  color: position.isVault ? '#7dd3fc' : '#fde68a',
                  border: position.isVault ? '1px solid rgba(56, 189, 248, 0.3)' : '1px solid rgba(251, 191, 36, 0.22)',
                }}
              >
                {position.feeTier}
              </span>
            </div>
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

      {/* ── 2. Unclaimed Fees Box with Adaptive Action Button ── */}
      <div
        className="rounded-2xl p-4 my-2 border flex flex-col gap-3 transition-colors"
        style={{
          background: 'rgba(10, 13, 24, 0.75)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div>
          <span className="text-[11px] font-medium text-[var(--fp-4)] block leading-tight">
            {position.isVault ? 'Accrued Yield' : 'Unclaimed Fees'}
          </span>
          <span
            className="text-2xl sm:text-[26px] font-bold text-white tracking-tight tabular-nums block mt-1"
            style={{ fontFamily: 'var(--fonts--space-grotesk, var(--font-app))' }}
          >
            {displayUsd(position.unclaimedFeesUsd, 4)}
          </span>
        </div>

        {/* Adaptive Claim / Harvest Button: Active when >= $0.01, informative disabled state when micro */}
        {isClaimable ? (
          <button
            type="button"
            onClick={() => onClaim(position.poolId)}
            disabled={isThisClaiming}
            className="w-full py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm tracking-wide text-white transition-all duration-200 shadow-lg active:scale-95 cursor-pointer flex items-center justify-center gap-2 select-none hover:brightness-110"
            style={{
              background: position.isVault
                ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)'
                : 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
              boxShadow: position.isVault
                ? '0 6px 18px -4px rgba(2, 132, 199, 0.45)'
                : '0 6px 18px -4px rgba(249, 115, 22, 0.45)',
            }}
          >
            {isThisClaiming ? (
              <>
                <RefreshCw size={14} className="arcis-spin" />
                <span>{position.isVault ? 'Harvesting...' : 'Claiming...'}</span>
              </>
            ) : (
              <span>{position.isVault ? 'Harvest Yield' : 'Claim Fees'}</span>
            )}
          </button>
        ) : hasAccruedMicroFees ? (
          <button
            type="button"
            disabled
            className="w-full py-2.5 px-4 rounded-xl font-medium text-xs tracking-wide transition-all flex items-center justify-center gap-2 select-none cursor-not-allowed border"
            style={{
              background: 'rgba(245, 158, 11, 0.06)',
              borderColor: 'rgba(245, 158, 11, 0.22)',
              color: '#fbbf24',
            }}
            title="Accrued fees are below the minimum threshold ($0.01 USDC) to claim."
          >
            <span>Min $0.01 to Claim</span>
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="w-full py-2.5 px-4 rounded-xl font-medium text-xs sm:text-sm tracking-wide transition-all flex items-center justify-center gap-2 select-none cursor-not-allowed opacity-60"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: 'rgba(255, 255, 255, 0.45)',
            }}
          >
            <span>{position.isVault ? 'No Yield to Harvest' : 'No Fees to Claim'}</span>
          </button>
        )}
      </div>

      {/* ── 3. Position Balance and Mini [ - ] / [ + ] Controls ── */}
      <div className="flex items-center justify-between pt-3 pb-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs text-[var(--fp-4)] font-medium">Position</span>
          <span
            className="text-sm sm:text-base font-bold text-white tabular-nums tracking-tight"
            style={{ fontFamily: 'var(--fonts--space-grotesk, var(--font-app))' }}
          >
            {displayUsd(position.positionUsd, 2)}
          </span>
        </div>

        {/* Mini Liquidity Controls [ - ] and [ + ] */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onRemoveLiquidity(position.poolConfig)}
            className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/20 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer active:scale-90"
            title={position.isVault ? 'Withdraw from Vault' : 'Remove Liquidity'}
            aria-label={position.isVault ? 'Withdraw from Vault' : 'Remove Liquidity'}
          >
            <Minus size={13} />
          </button>
          <button
            type="button"
            onClick={() => onAddLiquidity(position.poolConfig)}
            className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/20 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer active:scale-90"
            title={position.isVault ? 'Deposit to Vault' : 'Add Liquidity'}
            aria-label={position.isVault ? 'Deposit to Vault' : 'Add Liquidity'}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* ── 4. Ratio Labels and Progress Bar ── */}
      {position.isVault ? (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs font-semibold">
            <div className={`flex items-center gap-1.5 ${token1Config.textColorClass}`}>
              <img
                src={token1Config.icon}
                alt={position.token1Symbol || 'USDC'}
                className="w-4 h-4 rounded-full object-contain shrink-0 shadow-sm"
              />
              <span>100% USDC Allocation</span>
            </div>
            <span className="text-[11px] text-white/50 font-medium">Single-Asset Vault</span>
          </div>

          {/* Solid Single-Asset Progress Bar */}
          <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div
              className="h-full w-full transition-all duration-500"
              style={{ background: token1Config.barGradient }}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs font-semibold">
            {/* Token 1 Ratio */}
            <div className={`flex items-center gap-1.5 ${token1Config.textColorClass}`}>
              <img
                src={token1Config.icon}
                alt={position.token1Symbol}
                className="w-4 h-4 rounded-full object-contain shrink-0 shadow-sm"
              />
              <span className="tabular-nums">
                {position.token1Ratio}% {position.token1Symbol}
              </span>
            </div>

            {/* Token 2 Ratio */}
            <div className={`flex items-center gap-1.5 ${token2Config.textColorClass}`}>
              <span className="tabular-nums">
                {position.token2Ratio}% {position.token2Symbol}
              </span>
              <img
                src={token2Config.icon}
                alt={position.token2Symbol}
                className="w-4 h-4 rounded-full object-contain shrink-0 shadow-sm"
              />
            </div>
          </div>

          {/* Dual-color Segmented Progress Bar */}
          <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden flex">
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${position.token1Ratio}%`,
                background: token1Config.barGradient,
              }}
            />
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${position.token2Ratio}%`,
                background: token2Config.barGradient,
              }}
            />
          </div>
        </div>
      )}

      {/* ── 5. Min / Max Price Range or Vault Strategy Row ── */}
      {position.isVault ? (
        <div className="flex items-center justify-between text-[11px] text-[var(--fp-4)] font-medium pt-2 pb-3">
          <span>Strategy: <strong className="text-white/80">90% Protocol Revenue</strong></span>
          <span>Lockup: <strong className="text-white/80">No Lock</strong></span>
        </div>
      ) : (
        <div className="flex items-center justify-between text-[11px] text-[var(--fp-4)] font-medium pt-2 pb-3">
          <span>Min <strong className="text-white/80 tabular-nums">{position.minRange}</strong></span>
          <span>Max <strong className="text-white/80 tabular-nums">{position.maxRange}</strong></span>
        </div>
      )}

      {/* ── 6. Bottom Price & Status Capsule ── */}
      {position.isVault ? (
        <div
          className="rounded-xl px-3 py-2 flex items-center justify-between text-xs font-medium border transition-colors"
          style={{
            background: 'rgba(56, 189, 248, 0.08)',
            borderColor: 'rgba(56, 189, 248, 0.22)',
            color: '#38bdf8',
          }}
        >
          <span className="text-[11px] sm:text-xs truncate font-medium">
            {position.currentPriceDisplay || 'Auto-Compounding USDC Vault'}
          </span>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <span className="w-2 h-2 rounded-full bg-[#38bdf8] animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wider">
              ACTIVE VAULT
            </span>
          </div>
        </div>
      ) : (
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
      )}
    </div>
  )
}

export default PositionCard
