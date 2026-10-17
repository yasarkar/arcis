import React from 'react'
import { ChevronRight, ArrowUpRight, Zap, CheckCircle2 } from 'lucide-react'
import { POOL_VERSION_V4, type PoolConfig } from '../../config/poolsConfig'
import type { UserPoolPosition } from '../../hooks/usePoolsData'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'
import { WethIcon } from '../../config/tokenIcons'
import CircleIcon from '../../assets/Token-Icon/CIRCLE Token.svg'

interface PoolTableRowProps {
  pool: PoolConfig & { userPosition?: UserPoolPosition }
  onSelect: (pool: PoolConfig, mode?: 'deposit' | 'withdraw' | 'swap') => void
  walletConnected: boolean
}

export const PoolTableRow: React.FC<PoolTableRowProps> = ({
  pool,
  onSelect,
}) => {
  const userStaked = parseFloat(pool.userPosition?.stakedAmount || '0')

  // Determine pair display name and tokens
  let primaryName = pool.name
  let token1Icon = UsdcIcon
  let token2Icon: string | null = null
  let feeTier = `${(pool.feeTierPercent || 0.25).toFixed(2)}%`
  let version = POOL_VERSION_V4 ? 'V4' : 'V3'

  if (pool.id === 'usdc-cirbtc-pool') {
    primaryName = 'cirBTC / USDC'
    token1Icon = CirBtcIcon
    token2Icon = UsdcIcon
    feeTier = `${(pool.feeTierPercent || 0.25).toFixed(2)}%`
    version = POOL_VERSION_V4 ? 'V4' : 'V3'
  } else if (pool.id === 'usdc-weth-pool') {
    primaryName = 'WETH / USDC'
    token1Icon = WethIcon
    token2Icon = UsdcIcon
    feeTier = `${(pool.feeTierPercent || 0.30).toFixed(2)}%`
    version = POOL_VERSION_V4 ? 'V4' : 'V3'
  } else if (pool.id === 'eurc-weth-pool') {
    primaryName = 'EURC / WETH'
    token1Icon = EurcIcon
    token2Icon = WethIcon
    feeTier = `${(pool.feeTierPercent || 0.30).toFixed(2)}%`
    version = POOL_VERSION_V4 ? 'V4' : 'V3'
  } else if (pool.id === 'usdc-eurc-stable-pool') {
    primaryName = 'EURC / USDC'
    token1Icon = EurcIcon
    token2Icon = UsdcIcon
    feeTier = `${(pool.feeTierPercent || 0.12).toFixed(2)}%`
    version = POOL_VERSION_V4 ? 'V4' : 'V3'
  } else if (pool.id === 'usdc-yield-vault') {
    primaryName = 'USDC Vault'
    token1Icon = UsdcIcon
    feeTier = 'ERC-4626'
    version = POOL_VERSION_V4 ? 'V4' : 'V3'
  } else if (pool.tokens && pool.tokens.length >= 2) {
    primaryName = `${pool.tokens[1]?.symbol || 'Token'}/${pool.tokens[0]?.symbol || 'USDC'}`
    token1Icon = pool.tokens[1]?.iconType === 'btc' ? CirBtcIcon : pool.tokens[1]?.iconType === 'eurc' ? EurcIcon : pool.tokens[1]?.iconType === 'weth' ? WethIcon : UsdcIcon
    token2Icon = UsdcIcon
  }

  // Format metrics directly from on-chain data
  const formatDollar = (val: number): string => {
    return `$${val.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`
  }

  // Format fees with 2 decimal places to prevent sub-dollar fees (e.g. $0.27) from rounding to $0
  const formatFees = (val: number): string => {
    return `$${val.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }

  // Real live values directly from contract / usePoolsData
  const displayLiquidity = pool.tvlUsd || 0
  const displayVolume = pool.volume24hUsd || 0
  const displayFees = (pool.volume24hUsd || 0) * ((pool.feeTierPercent || 0.25) / 100)

  return (
    <tr
      onClick={() => onSelect(pool)}
      className="group transition-all duration-200 cursor-pointer border-b border-white/[0.04] hover:bg-white/[0.035]"
      style={{ fontFamily: 'var(--font-app)' }}
    >
      {/* ── 1. Pool Column (Overlapping Avatars + Name + Badges) ── */}
      <td className="py-4 sm:py-5 pl-5 sm:pl-7 pr-4">
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Overlapping Token Avatars */}
          <div className="relative flex items-center shrink-0">
            {/* Token 1 */}
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#141727] border border-white/10 flex items-center justify-center p-1 shadow-md z-10 overflow-hidden">
              <img
                src={token1Icon}
                alt="Token 1"
                className="w-full h-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </div>

            {/* Token 2 (Overlapping) */}
            {token2Icon && (
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#141727] border border-white/10 flex items-center justify-center p-1 shadow-md -ml-3 z-0 overflow-hidden">
                <img
                  src={token2Icon}
                  alt="Token 2"
                  className="w-full h-full object-contain"
                />
              </div>
            )}
          </div>

          {/* Name & Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-white text-sm sm:text-base tracking-tight group-hover:text-[var(--purple-1)] transition-colors">
              {primaryName}
            </span>

            {/* Version Badge (Orange V3 pill matching screenshot) */}
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider select-none"
              style={{
                background: 'rgba(249, 115, 22, 0.18)',
                color: '#fb923c',
                border: '1px solid rgba(249, 115, 22, 0.35)',
              }}
            >
              {version}
            </span>

            {/* Fee Tier Badge (Peach/Amber pill matching screenshot) */}
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-medium select-none"
              style={{
                background: 'rgba(251, 191, 36, 0.1)',
                color: '#fde68a',
                border: '1px solid rgba(251, 191, 36, 0.22)',
              }}
            >
              {feeTier}
            </span>
          </div>
        </div>
      </td>

      {/* ── 2. Liquidity Column ── */}
      <td className="py-4 sm:py-5 px-4 text-sm font-semibold text-white/90 tabular-nums">
        {formatDollar(displayLiquidity)}
      </td>

      {/* ── 3. 24h Volume Column ── */}
      <td className="py-4 sm:py-5 px-4 text-sm font-medium text-white/80 tabular-nums">
        {formatDollar(displayVolume)}
      </td>

      {/* ── 4. 24h Fees Column ── */}
      <td className="py-4 sm:py-5 px-4 text-sm font-medium text-white/80 tabular-nums">
        {formatFees(displayFees)}
      </td>

      {/* ── 5. APR Column (Bold text matching screenshot) ── */}
      <td className="py-4 sm:py-5 px-4 text-right">
        <span
          className="text-sm sm:text-base font-bold text-white tabular-nums tracking-tight group-hover:text-[var(--earned-green)] transition-colors"
          style={{ fontFamily: 'var(--fonts--space-grotesk, var(--font-app))' }}
        >
          {pool.apy.toFixed(2)}%
        </span>
      </td>

      {/* ── 6. Chevron Action Column ── */}
      <td className="py-4 sm:py-5 pr-5 sm:pr-7 pl-2 text-right">
        <div className="inline-flex items-center justify-center w-7 h-7 rounded-xl group-hover:bg-white/[0.08] transition-all">
          <ChevronRight
            size={18}
            className="text-white/40 group-hover:text-white group-hover:translate-x-0.5 transition-all"
          />
        </div>
      </td>
    </tr>
  )
}

export default PoolTableRow
