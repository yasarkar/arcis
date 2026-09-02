// src/components/pools/PoolsHeroStats.tsx
//
// Hero statistics banner & control sidebar for Pools & Yield Hub.
// Displays Total Value Locked, Average APY, User Staked Assets, Claimable Rewards,
// Capital Efficiency, and Quick Actions (Auto-Rebalancer, Yield Calculator, Claim All).
import { TrendingUp, Gift, Zap, Layers, Bot, Activity } from 'lucide-react'
import { ARCFLOW_POOLS } from '../../config/poolsConfig'
import { useContinuousYieldStream } from '../../hooks/useContinuousYieldStream'

interface PoolsHeroStatsProps {
  totalTvlUsd: number
  averageApy: string
  userTotalDepositedUsd: number
  userTotalClaimableRewardsUsd: number
  dailyYieldGeneratedUsd: number
  walletConnected: boolean
  capitalEfficiencyScore?: number
  onClaimAll: () => void
  isClaiming?: boolean
  onOpenCalculator?: () => void
  onOpenRebalancer?: () => void
  onOpenAgentBounties?: () => void
}

export default function PoolsHeroStats({
  totalTvlUsd,
  averageApy,
  userTotalDepositedUsd,
  userTotalClaimableRewardsUsd,
  dailyYieldGeneratedUsd,
  walletConnected,
  capitalEfficiencyScore = 100,
  onClaimAll,
  isClaiming,
  onOpenCalculator,
  onOpenRebalancer,
  onOpenAgentBounties,
}: PoolsHeroStatsProps) {
  const apyNumber = parseFloat(averageApy) || 8.42
  const { formattedYield: liveHeroYield, yieldPerSecond: heroYieldPerSec } = useContinuousYieldStream(
    userTotalDepositedUsd,
    apyNumber,
    userTotalClaimableRewardsUsd,
    60
  )

  return (
    <div
      className="ub-hero-card"
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: '24px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      {/* Background ambient glow accents */}
      <div
        style={{
          position: 'absolute',
          top: -50,
          right: -50,
          width: 220,
          height: 220,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(152, 150, 255, 0.18) 0%, transparent 70%)',
          filter: 'blur(35px)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: -40,
          left: -40,
          width: 200,
          height: 200,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(1, 208, 98, 0.14) 0%, transparent 70%)',
          filter: 'blur(30px)',
          pointerEvents: 'none',
        }}
      />

      {/* ── 1. Card Header & Live Badges ── */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: '50%',
                flexShrink: 0,
              }}
            >
              <Layers size={16} style={{ color: 'var(--purple-1)' }} />
            </div>
            <div>
              <span
                className="arc-eyebrow"
                style={{
                  fontSize: 16,
                  color: 'var(--base-colors--white)',
                  fontWeight: 700,
                  letterSpacing: '1.8px',
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
            fontSize: 12,
            color: 'var(--fp-3)',
            fontFamily: 'var(--font-app)',
            margin: '6px 0 0 0',
            lineHeight: 1.4,
          }}
        >
          Liquidity provision, USDC yield vaults & cross-chain settlement on Arc Testnet.
        </p>
      </div>

      {/* ── 2. TVL & Average APY Showcase Block ── */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.01) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 18,
          padding: '16px 18px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-app)',
              color: 'var(--fp-4)',
              fontWeight: 600,
              letterSpacing: '0.6px',
            }}
          >
            TOTAL PROTOCOL TVL
          </span>
          <span className="ub-live-badge" title="Live Arc Testnet Protocol Average APY" style={{ padding: '3px 8px 3px 10px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.4px' }}>AVG {averageApy}%</span>
            <svg className="ub-ecg-svg" viewBox="0 0 48 16" fill="none" aria-hidden="true" style={{ width: 32, height: 12, marginLeft: 2 }}>
              <path d="M0 8h10l3-5 4 13 4-15 4 10 3-3h10" className="ub-ecg-path-bg" />
              <path d="M0 8h10l3-5 4 13 4-15 4 10 3-3h10" className="ub-ecg-path-pulse" />
            </svg>
          </span>
        </div>

        <div
          className="arc-display-hero"
          style={{
            fontSize: 'clamp(1.85rem, 3.5vw, 2.35rem)',
            lineHeight: 1.1,
            fontWeight: 500,
            color: '#fff',
            fontFamily: 'var(--fonts--space-grotesk)',
          }}
        >
          ${totalTvlUsd.toLocaleString('en-US')}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 8,
            fontSize: 11,
            color: 'var(--fp-3)',
            fontFamily: 'var(--font-app)',
          }}
        >
          <span>Active across {ARCFLOW_POOLS.length} pools on Arc Network</span>
        </div>
      </div>

      {/* ── 3. User Position & Metrics 2x2 Grid ── */}
      <div
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
        }}
      >
        {/* Metric 1: My Staked Assets */}
        <div
          style={{
            background: 'rgba(11, 13, 24, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 14,
            padding: '12px 14px',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-app)',
              color: 'var(--fp-4)',
              fontWeight: 600,
              letterSpacing: '0.4px',
              display: 'block',
              marginBottom: 4,
            }}
          >
            STAKED ASSETS
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span
              style={{
                fontSize: 16,
                fontFamily: 'var(--fonts--space-grotesk)',
                fontWeight: 700,
                color: '#fff',
              }}
            >
              {walletConnected ? `${userTotalDepositedUsd.toFixed(2)}` : '$0.00'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--fp-4)', fontFamily: 'var(--font-app)' }}>USDC</span>
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
            borderRadius: 14,
            padding: '12px 14px',
            boxShadow: walletConnected && userTotalDepositedUsd > 0
              ? '0 0 16px rgba(1, 208, 98, 0.15)'
              : 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-app)',
                color: walletConnected && userTotalDepositedUsd > 0 ? '#34d399' : 'var(--fp-4)',
                fontWeight: 700,
                letterSpacing: '0.4px',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {walletConnected && userTotalDepositedUsd > 0 && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--earned-green)',
                    boxShadow: '0 0 6px var(--earned-green)',
                    display: 'inline-block',
                    animation: 'pulse 1.5s infinite',
                  }}
                />
              )}
              LIVE STREAMING YIELD
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span
              style={{
                fontSize: 16,
                fontFamily: 'var(--fonts--space-grotesk)',
                fontWeight: 700,
                color: walletConnected && userTotalDepositedUsd > 0 ? 'var(--earned-green)' : '#fff',
              }}
            >
              {walletConnected && userTotalDepositedUsd > 0
                ? `+$${liveHeroYield}`
                : userTotalClaimableRewardsUsd > 0
                ? `+$${userTotalClaimableRewardsUsd.toFixed(3)}`
                : '$0.00'}
            </span>
            <span style={{ fontSize: 10, color: 'var(--fp-4)', fontFamily: 'var(--font-app)' }}>USDC</span>
          </div>
          {walletConnected && userTotalDepositedUsd > 0 && (
            <span style={{ fontSize: 9.5, color: '#34d399', display: 'block', marginTop: 2 }}>
              ⚡ +${(heroYieldPerSec).toFixed(6)}/sec
            </span>
          )}
        </div>

        {/* Metric 3: Est. Daily Yield */}
        <div
          style={{
            background: 'rgba(11, 13, 24, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 14,
            padding: '12px 14px',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-app)',
              color: 'var(--fp-4)',
              fontWeight: 600,
              letterSpacing: '0.4px',
              display: 'block',
              marginBottom: 4,
            }}
          >
            EST. DAILY YIELD
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span
              style={{
                fontSize: 16,
                fontFamily: 'var(--fonts--space-grotesk)',
                fontWeight: 700,
                color: 'var(--purple-1)',
              }}
            >
              {walletConnected ? `+$${dailyYieldGeneratedUsd.toFixed(3)}` : '$0.00'}
            </span>
          </div>
        </div>

        {/* Metric 4: Capital Efficiency */}
        <div
          style={{
            background: 'rgba(11, 13, 24, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 14,
            padding: '12px 14px',
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-app)',
              color: 'var(--fp-4)',
              fontWeight: 600,
              letterSpacing: '0.4px',
              display: 'block',
              marginBottom: 4,
            }}
          >
            CAPITAL EFFICIENCY
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontSize: 16,
                fontFamily: 'var(--fonts--space-grotesk)',
                fontWeight: 700,
                color: '#60a5fa',
              }}
            >
              {capitalEfficiencyScore}%
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
          gap: 9,
        }}
      >
        {/* Claim All Rewards Button (Conditional Prominent Action) */}
        {walletConnected && userTotalClaimableRewardsUsd > 0 && (
          <button
            onClick={onClaimAll}
            disabled={isClaiming}
            type="button"
            className="ub-action-btn ub-action-btn-primary"
            style={{
              width: '100%',
              justifyContent: 'center',
              padding: '10px 16px',
              background: 'linear-gradient(135deg, #01d062 0%, #059669 100%)',
              borderColor: 'rgba(1, 208, 98, 0.4)',
              boxShadow: '0 4px 18px rgba(1, 208, 98, 0.3)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Gift size={15} />
            <span>{isClaiming ? 'Claiming Rewards...' : `Claim All (${userTotalClaimableRewardsUsd.toFixed(2)} USDC)`}</span>
          </button>
        )}

        {/* 2-Button Grid for Tools */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {onOpenRebalancer && (
            <button
              onClick={onOpenRebalancer}
              type="button"
              className="ub-action-btn"
              style={{
                width: '100%',
                justifyContent: 'center',
                padding: '9px 10px',
                background: 'rgba(152, 150, 255, 0.12)',
                borderColor: 'rgba(152, 150, 255, 0.3)',
                fontSize: 12,
              }}
              title="Consolidate multi-chain testnet USDC to Arc"
            >
              <Zap size={13} style={{ color: 'var(--purple-1)' }} />
              <span>Auto-Rebalancer</span>
            </button>
          )}

          {onOpenCalculator && (
            <button
              onClick={onOpenCalculator}
              type="button"
              className="ub-action-btn"
              style={{
                width: '100%',
                justifyContent: 'center',
                padding: '9px 10px',
                fontSize: 12,
              }}
              title="Open Interactive Yield Simulator"
            >
              <TrendingUp size={13} style={{ color: 'var(--purple-1)' }} />
              <span>Calculator</span>
            </button>
          )}
        </div>

        {/* AI Agent Bounty Escrow Hub Button */}
        {onOpenAgentBounties && (
          <button
            onClick={onOpenAgentBounties}
            type="button"
            className="ub-action-btn"
            style={{
              width: '100%',
              justifyContent: 'space-between',
              padding: '9px 12px',
              background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.12) 0%, rgba(139, 92, 246, 0.12) 100%)',
              borderColor: 'rgba(236, 72, 153, 0.35)',
              fontSize: 12,
            }}
            title="Open ERC-8183 AI Agent Escrow & Bounty Hub"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Bot size={14} style={{ color: '#f472b6' }} />
              <span style={{ fontWeight: 600, color: '#fff' }}>Agent Bounty Escrows</span>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--earned-green)',
                background: 'rgba(1, 208, 98, 0.12)',
                padding: '1px 6px',
                borderRadius: 99,
                border: '1px solid rgba(1, 208, 98, 0.25)',
              }}
            >
              8.42% APY Yield
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
