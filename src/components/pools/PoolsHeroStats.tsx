// Hero statistics banner & control sidebar for Pools & Yield Hub.
// Displays Total Value Locked, Average APY, User Staked Assets, Claimable Rewards,
// Capital Efficiency, and Quick Actions (Auto-Rebalancer, Yield Calculator, Claim All).
import { TrendingUp, Layers, Info, Coins, RefreshCw } from 'lucide-react'
import { type PoolConfig } from '../../config/poolsConfig'
import { useContinuousYieldStream } from '../../hooks/useContinuousYieldStream'
import type { UserPoolPosition } from '../../hooks/usePoolsData'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'

interface PoolsHeroStatsProps {
  totalTvlUsd: number
  localTvlUsd?: number
  gatewayTvlUsd?: number
  pools?: (PoolConfig & { userPosition?: UserPoolPosition })[]
  userTotalDepositedUsd: number
  userTotalClaimableRewardsUsd: number
  dailyYieldGeneratedUsd: number
  walletConnected: boolean
  capitalEfficiencyScore?: number
  onClaimAll: () => void
  isClaiming?: boolean
  onOpenCalculator?: () => void
  onOpenRebalancer?: () => void
}

export default function PoolsHeroStats({
  totalTvlUsd,
  pools,
  userTotalDepositedUsd,
  userTotalClaimableRewardsUsd,
  dailyYieldGeneratedUsd,
  walletConnected,
  onOpenCalculator,
  onClaimAll,
  isClaiming = false,
}: PoolsHeroStatsProps) {
  const userPortfolioApy = userTotalDepositedUsd > 0
    ? ((dailyYieldGeneratedUsd * 365) / userTotalDepositedUsd) * 100
    : 0
  const { formattedYield: liveHeroYield, yieldPerSecond: heroYieldPerSec } = useContinuousYieldStream(
    userTotalDepositedUsd,
    userPortfolioApy,
    userTotalClaimableRewardsUsd
  )

  // Derive individual pool TVLs dynamically from live on-chain data
  const getPoolTvl = (id: string, fallback: number): number => {
    const p = pools?.find((pool) => pool.id === id)
    return p?.tvlUsd !== undefined ? p.tvlUsd : fallback
  }

  const poolItems = [
    {
      id: 'usdc-eurc-stable-pool',
      shortName: 'USDC / EURC',
      name: 'USDC / EURC Stable Pool',
      tag: 'Stable LP',
      accentColor: '#818cf8',
      icons: [UsdcIcon, EurcIcon],
      tvl: getPoolTvl('usdc-eurc-stable-pool', 0),
    },
    {
      id: 'usdc-cirbtc-pool',
      shortName: 'USDC / cirBTC',
      name: 'USDC / cirBTC Liquidity Pool',
      tag: 'AMM LP',
      accentColor: '#f59e0b',
      icons: [UsdcIcon, CirBtcIcon],
      tvl: getPoolTvl('usdc-cirbtc-pool', 0),
    },
    {
      id: 'usdc-yield-vault',
      shortName: 'USDC Vault',
      name: 'USDC Yield Vault',
      tag: 'ERC-4626',
      accentColor: '#10b981',
      icons: [UsdcIcon],
      tvl: getPoolTvl('usdc-yield-vault', 0),
    },
  ]

  const calculatedTotal = poolItems.reduce((acc, item) => acc + item.tvl, 0)
  const effectiveTotalTvl = totalTvlUsd > 0 ? totalTvlUsd : calculatedTotal

  const itemsWithMetrics = poolItems.map((item) => {
    const pct = effectiveTotalTvl > 0 ? (item.tvl / effectiveTotalTvl) * 100 : 0
    const pctLabel = pct > 0 ? (pct < 0.1 ? '<0.1%' : `${pct.toFixed(1)}%`) : '0.0%'
    return { ...item, pct, pctLabel }
  })

  return (
    <div
      className="ub-hero-card"
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: '30px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
      }}
    >
      {/* Background ambient glow accents */}
      <div
        style={{
          position: 'absolute',
          top: -60,
          right: -60,
          width: 260,
          height: 260,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(152, 150, 255, 0.2) 0%, transparent 70%)',
          filter: 'blur(40px)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -50,
          left: -50,
          width: 240,
          height: 240,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(1, 208, 98, 0.16) 0%, transparent 70%)',
          filter: 'blur(35px)',
          pointerEvents: 'none',
        }}
      />

      {/* ── 1. Card Header & Live Badges ── */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 38,
                height: 38,
                borderRadius: '12px',
                background: 'rgba(152, 150, 255, 0.12)',
                border: '1px solid rgba(152, 150, 255, 0.25)',
                boxShadow: '0 0 16px rgba(152, 150, 255, 0.15)',
                flexShrink: 0,
              }}
            >
              <Layers size={20} style={{ color: 'var(--purple-1)' }} />
            </div>
            <div>
              <span
                className="arc-eyebrow"
                style={{
                  fontSize: 18,
                  color: 'var(--base-colors--white)',
                  fontWeight: 700,
                  letterSpacing: '2px',
                  display: 'block',
                  lineHeight: 1.2,
                }}
              >
                POOLS & YIELD
              </span>
            </div>
          </div>
        </div>

        <p
          style={{
            fontSize: 13,
            color: 'var(--fp-3)',
            fontFamily: 'var(--font-app)',
            margin: '8px 0 0 0',
            lineHeight: 1.5,
          }}
        >
          Liquidity provision, USDC yield vaults & cross-chain settlement on Arc Testnet.
        </p>
      </div>

      {/* ── 2. Total Vault & Pool TVL Showcase Block ── */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.015) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.09)',
          borderRadius: 20,
          padding: '18px 20px',
          boxShadow: '0 8px 24px -6px rgba(0, 0, 0, 0.35)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span
            style={{
              fontSize: 14,
              fontFamily: 'var(--font-app)',
              color: 'var(--fp-4)',
              fontWeight: 700,
              letterSpacing: '0.8px',
            }}
          >
            TOTAL VAULT & POOL TVL
          </span>
        </div>

        <div
          className="arc-display-hero"
          style={{
            fontSize: 'clamp(2rem, 3.5vw, 2.5rem)',
            lineHeight: 1.15,
            fontWeight: 600,
            color: '#fff',
            fontFamily: 'var(--fonts--space-grotesk)',
            margin: '4px 0 4px',
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
          }}
        >
          <span>{Math.floor(effectiveTotalTvl).toLocaleString('en-US')}</span>
          <span
            style={{
              fontSize: 'clamp(1rem, 1.6vw, 1.25rem)',
              color: 'var(--fp-4)',
              fontWeight: 500,
              fontFamily: 'var(--font-app)',
            }}
          >
            USDC
          </span>
        </div>

        <div
          style={{
            fontSize: 11,
            color: 'var(--fp-3)',
            fontFamily: 'var(--font-app)',
            marginBottom: 12,
          }}
        >
          Aggregated TVL across all 3 native liquidity pools & vaults
        </div>
      </div>

      {/* ── 3. User Position & Metrics 2x2 Grid ── */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        {/* Metric 1: My Staked Assets */}
        <div
          style={{
            background: 'rgba(11, 13, 24, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 16,
            padding: '14px 16px',
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-app)',
              color: 'var(--fp-4)',
              fontWeight: 600,
              letterSpacing: '0.5px',
              display: 'block',
              marginBottom: 5,
            }}
          >
            STAKED ASSETS
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span
              style={{
                fontSize: 18,
                fontFamily: 'var(--fonts--space-grotesk)',
                fontWeight: 700,
                color: '#fff',
              }}
            >
              {walletConnected ? `${userTotalDepositedUsd.toFixed(2)}` : '0.00'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--fp-4)', fontFamily: 'var(--font-app)' }}>USDC</span>
          </div>
        </div>

        {/* Metric 2: Live Continuous Yield Stream */}
        <div
          style={{
            background: walletConnected && userTotalDepositedUsd > 0
              ? 'linear-gradient(135deg, rgba(1, 208, 98, 0.12) 0%, rgba(11, 13, 24, 0.9) 100%)'
              : 'rgba(11, 13, 24, 0.7)',
            border: walletConnected && userTotalDepositedUsd > 0
              ? '1px solid rgba(1, 208, 98, 0.45)'
              : '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 16,
            padding: '14px 16px',
            boxShadow: walletConnected && userTotalDepositedUsd > 0
              ? '0 0 16px rgba(1, 208, 98, 0.15)'
              : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-app)',
                color: walletConnected && userTotalDepositedUsd > 0 ? '#34d399' : 'var(--fp-4)',
                fontWeight: 700,
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              {walletConnected && userTotalDepositedUsd > 0 && (
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: 'var(--earned-green)',
                    boxShadow: '0 0 6px var(--earned-green)',
                    display: 'inline-block',
                    animation: 'pulse 1.5s infinite',
                  }}
                />
              )}
              EST. PROJECTED YIELD
            </span>
            <span
              title="Real-time projected yield accrual based on active deposits. ERC-4626 vault yield appreciates share value, and AMM swap fees grow pool reserves automatically."
              style={{ cursor: 'help', display: 'inline-flex', alignItems: 'center', color: 'var(--fp-4)' }}
            >
              <Info size={10} />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span
              style={{
                fontSize: 18,
                fontFamily: 'var(--fonts--space-grotesk)',
                fontWeight: 700,
                color: walletConnected && userTotalDepositedUsd > 0 ? 'var(--earned-green)' : '#fff',
              }}
            >
              {walletConnected && userTotalDepositedUsd > 0
                ? `+${liveHeroYield}`
                : userTotalClaimableRewardsUsd > 0
                ? `+${userTotalClaimableRewardsUsd.toFixed(3)}`
                : '0.00'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--fp-4)', fontFamily: 'var(--font-app)' }}>USDC</span>
          </div>
          {walletConnected && userTotalDepositedUsd > 0 && (
            <span style={{ fontSize: 10.5, color: '#34d399', display: 'block', marginTop: 3 }}>
              +{(heroYieldPerSec).toFixed(6)}/sec
            </span>
          )}
        </div>

        {/* Metric 3: Est. Daily Yield */}
        <div
          style={{
            background: 'rgba(11, 13, 24, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 16,
            padding: '14px 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-app)',
                color: 'var(--fp-4)',
                fontWeight: 600,
                letterSpacing: '0.5px',
              }}
            >
              EST. DAILY YIELD
            </span>
            <span
              title="Estimated daily earnings based on your pool shares, 24h trading volume, and protocol revenue distributions."
              style={{
                cursor: 'help',
                display: 'inline-flex',
                alignItems: 'center',
                color: 'var(--fp-4)',
              }}
            >
              <Info size={12} />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span
              style={{
                fontSize: 18,
                fontFamily: 'var(--fonts--space-grotesk)',
                fontWeight: 700,
                color: 'var(--purple-1)',
              }}
            >
              {walletConnected ? `+${dailyYieldGeneratedUsd.toFixed(3)}` : '0.00'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--fp-4)', fontFamily: 'var(--font-app)' }}>USDC</span>
          </div>
        </div>

        {/* Metric 4: Capital Efficiency */}
        {/* Metric 4: Portfolio APY */}
        <div
          style={{
            background: 'rgba(11, 13, 24, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 16,
            padding: '14px 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-app)',
                color: 'var(--fp-4)',
                fontWeight: 600,
                letterSpacing: '0.5px',
              }}
            >
              PORTFOLIO APY
            </span>
            <span
              title="Weighted average annual percentage yield across your active deposited positions on Arc."
              style={{ cursor: 'help', display: 'inline-flex', alignItems: 'center', color: 'var(--fp-4)' }}
            >
              <Info size={10} />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontSize: 18,
                fontFamily: 'var(--fonts--space-grotesk)',
                fontWeight: 700,
                color: '#60a5fa',
              }}
            >
              {walletConnected && userTotalDepositedUsd > 0 ? `${userPortfolioApy.toFixed(2)}%` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* ── 4. Quick Action Buttons ── */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 11,
        }}
      >
        {/* Claim All Rewards Button */}
        {walletConnected && userTotalClaimableRewardsUsd >= 0.01 && onClaimAll && (
          <button
            onClick={onClaimAll}
            disabled={isClaiming}
            type="button"
            className="ub-action-btn"
            style={{
              width: '100%',
              justifyContent: 'center',
              padding: '12px 14px',
              background: 'linear-gradient(135deg, rgba(1, 208, 98, 0.22) 0%, rgba(56, 189, 248, 0.18) 100%)',
              borderColor: 'rgba(1, 208, 98, 0.45)',
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              boxShadow: '0 0 16px rgba(1, 208, 98, 0.2)',
              cursor: isClaiming ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
            }}
            title="Claim all accumulated earnings directly into your USDC wallet"
          >
            {isClaiming ? (
              <RefreshCw size={15} className="arcis-spin" style={{ color: 'var(--earned-green)' }} />
            ) : (
              <Coins size={15} style={{ color: 'var(--earned-green)' }} />
            )}
            <span>
              {isClaiming
                ? 'Claiming Rewards...'
                : `Claim All Rewards (+${userTotalClaimableRewardsUsd.toFixed(2)} USDC)`}
            </span>
          </button>
        )}

        {/* Tool Button: Yield Calculator */}
        {onOpenCalculator && (
          <button
            onClick={onOpenCalculator}
            type="button"
            className="ub-action-btn"
            style={{
              width: '100%',
              justifyContent: 'center',
              padding: '11px 14px',
              background: 'rgba(152, 150, 255, 0.08)',
              borderColor: 'rgba(152, 150, 255, 0.25)',
              fontSize: 13,
              fontWeight: 500,
            }}
            title="Open Interactive Yield Simulator"
          >
            <TrendingUp size={15} style={{ color: 'var(--purple-1)' }} />
            <span>Yield Calculator</span>
          </button>
        )}
      </div>
    </div>
  )
}
