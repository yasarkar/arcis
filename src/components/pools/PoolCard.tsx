// src/components/pools/PoolCard.tsx
//
// Minimal & Informative Pool Card for ArcFlow Pools & Yield Hub.
// Features a clean layout, streamlined metrics, live APY badge,
// user position overview, and collapsible technical details.

import { useState } from 'react'
import {
  Unlock,
  ChevronDown,
  ExternalLink,
  Plus,
  Minus,
  Gift,
  Bot,
  Zap,
  Globe,
  TrendingUp,
  ArrowRightLeft,
  Droplets,
} from 'lucide-react'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import CircleTokenIcon from '../../assets/Token-Icon/CIRCLE Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'
import ArcLogo from '../../assets/Arc-Icon.svg'
import { POOL_RISK_LEVELS, type PoolConfig } from '../../config/poolsConfig'
import { getExplorerAddressUrl } from '../../config/sendConfig'
import type { UserPoolPosition } from '../../hooks/usePoolsData'
import { useContinuousYieldStream } from '../../hooks/useContinuousYieldStream'

interface PoolCardProps {
  pool: PoolConfig & { userPosition?: UserPoolPosition }
  walletConnected: boolean
  onDeposit: (pool: PoolConfig) => void
  onWithdraw: (pool: PoolConfig) => void
  onClaim: (poolId: string) => void
  onOpenAgentBounties?: (pool: PoolConfig) => void
  onSwap?: (pool: PoolConfig) => void
  onFaucetMint?: (pool: PoolConfig) => void
  onGatewayDeposit?: (pool: PoolConfig) => void
  onGatewaySpend?: (pool: PoolConfig) => void
  gatewayBalance?: string
  isClaiming?: boolean
}

export default function PoolCard({
  pool,
  walletConnected,
  onDeposit,
  onWithdraw,
  onSwap,
  onFaucetMint,
  onGatewaySpend,
  gatewayBalance,
}: PoolCardProps) {
  const [showDetails, setShowDetails] = useState(false)

  const userStaked = parseFloat(pool.userPosition?.stakedAmount || '0')
  const hasDeposit = userStaked > 0

  const { formattedYield: liveCardYield, yieldPerSecond: cardYieldPerSec } = useContinuousYieldStream(
    userStaked,
    pool.apy,
    0,
    75
  )

  // Meaningful Right-Aligned Pool Icon Renderer (Clean, Prominent, No Border, No Background)
  const renderPoolRightIcon = () => {
    // Dual LP pools (e.g. USDC/EURC, USDC/cirBTC)
    if (pool.isLpPool && pool.tokens && pool.tokens.length >= 2) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {pool.tokens.map((t, idx) => {
            let src = UsdcIcon
            let alt = t.name || 'Token'
            if (t.iconType === 'eurc') src = EurcIcon
            else if (t.iconType === 'arc') src = ArcLogo
            else if (t.iconType === 'btc') src = CirBtcIcon

            return (
              <div
                key={idx}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <img src={src} alt={alt} style={{ width: 24, height: 24, objectFit: 'contain' }} />
              </div>
            )
          })}
        </div>
      )
    }

    // Single pool icons: Pure, crisp, and prominent (No border, no background)
    if (pool.category === 'vault') {
      return (
        <img
          src={UsdcIcon}
          alt="USDC Vault"
          style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }}
        />
      )
    }

    if (pool.category === 'crosschain') {
      return <Globe size={24} style={{ color: '#60a5fa', flexShrink: 0 }} />
    }

    return (
      <img
        src={UsdcIcon}
        alt="USDC"
        style={{ width: 24, height: 24, objectFit: 'contain', flexShrink: 0 }}
      />
    )
  }

  // Category badge style
  const getCategoryBadge = () => {
    switch (pool.category) {
      case 'liquidity':
        return { bg: 'rgba(1, 208, 98, 0.14)', border: 'rgba(1, 208, 98, 0.3)', text: 'var(--earned-green)', label: 'LIKIDITE' }
      case 'vault':
        return { bg: 'rgba(152, 150, 255, 0.14)', border: 'rgba(152, 150, 255, 0.3)', text: 'var(--purple-1)', label: 'VAULT' }
      case 'crosschain':
        return { bg: 'rgba(99, 102, 241, 0.15)', border: 'rgba(99, 102, 241, 0.35)', text: '#a5b4fc', label: 'CROSS-CHAIN' }
      default:
        return { bg: 'rgba(255, 255, 255, 0.08)', border: 'rgba(255, 255, 255, 0.15)', text: '#fff', label: 'POOL' }
    }
  }

  const categoryBadge = getCategoryBadge()
  const riskConfig = POOL_RISK_LEVELS[pool.riskLevel] || POOL_RISK_LEVELS['Low']

  // Mini token icon for inline displays (e.g., Staked balance)
  const renderInlineTokenIcon = (iconType: string) => {
    if (iconType === 'eurc') {
      return <img src={EurcIcon} alt="EURC" style={{ width: 13, height: 13, objectFit: 'contain' }} />
    } else if (iconType === 'arc') {
      return <img src={ArcLogo} alt="Arc" style={{ width: 13, height: 13, objectFit: 'contain' }} />
    } else if (iconType === 'btc') {
      return <img src={CirBtcIcon} alt="cirBTC" style={{ width: 13, height: 13, objectFit: 'contain' }} />
    } else if (iconType === 'gateway') {
      return <Globe size={12} style={{ color: '#60a5fa' }} />
    }
    return <img src={UsdcIcon} alt="USDC" style={{ width: 13, height: 13, objectFit: 'contain' }} />
  }

  return (
    <div
      className="ub-asset-card glow-card"
      style={{
        marginBottom: 12,
        padding: '16px 18px',
        position: 'relative',
        borderRadius: 16,
        transition: 'all 0.25s var(--ease-out-smooth)',
        border: hasDeposit
          ? '1px solid rgba(152, 150, 255, 0.35)'
          : '1px solid rgba(255, 255, 255, 0.07)',
        boxShadow: hasDeposit
          ? '0 0 14px rgba(152, 150, 255, 0.08), 0 4px 20px rgba(0, 0, 0, 0.3)'
          : '0 3px 14px rgba(0, 0, 0, 0.2)',
      }}
    >
      {/* ── Top Header Row ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 8,
        }}
      >
        {/* Left: Title, Category Badge & 1-Sentence Subtitle */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <h3
              style={{
                margin: 0,
                fontSize: 14.5,
                fontFamily: 'var(--fonts--space-grotesk)',
                fontWeight: 600,
                color: '#fff',
                lineHeight: 1.2,
              }}
            >
              {pool.name}
            </h3>
            <span
              style={{
                fontSize: 9,
                fontFamily: 'var(--font-app)',
                fontWeight: 700,
                letterSpacing: '0.3px',
                background: categoryBadge.bg,
                border: `1px solid ${categoryBadge.border}`,
                color: categoryBadge.text,
                padding: '1px 6px',
                borderRadius: 99,
              }}
            >
              {categoryBadge.label}
            </span>
          </div>
          <span
            style={{
              fontSize: 11.5,
              color: 'var(--fp-3)',
              fontFamily: 'var(--font-app)',
              marginTop: 3,
              display: 'block',
              lineHeight: 1.35,
            }}
          >
            {pool.subtitle}
          </span>
        </div>

        {/* Right: Meaningful Pool Icon Badge */}
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {renderPoolRightIcon()}
        </div>
      </div>

      {/* ── Key Metrics Grid (Sleek 3-Column Strip: TVL, Risk, APY) ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          background: 'rgba(11, 13, 24, 0.55)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: 10,
          padding: '8px 14px',
          marginBottom: 12,
        }}
      >
        <div>
          <span style={{ fontSize: 9.5, color: 'var(--fp-4)', fontFamily: 'var(--font-app)', display: 'block', marginBottom: 2 }}>
            TVL
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              fontFamily: 'var(--fonts--space-grotesk)',
            }}
          >
            ${pool.tvlUsd.toLocaleString('en-US')}
          </span>
        </div>

        <div>
          <span style={{ fontSize: 9.5, color: 'var(--fp-4)', fontFamily: 'var(--font-app)', display: 'block', marginBottom: 2 }}>
            Risk Level
          </span>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: riskConfig.color,
              fontFamily: 'var(--font-app)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: riskConfig.color, display: 'inline-block' }} />
            {riskConfig.shortLabel}
          </span>
        </div>

        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 9.5, color: 'var(--fp-4)', fontFamily: 'var(--font-app)', display: 'block', marginBottom: 2 }}>
            {pool.apyType}
          </span>
          <span
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              color: 'var(--earned-green)',
              fontFamily: 'var(--fonts--space-grotesk)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
            }}
          >
            {pool.apy.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* ── User Position Strip (When User Has Active Balance) ── */}
      {walletConnected && hasDeposit && (
        <div
          style={{
            padding: '10px 12px',
            marginBottom: 12,
            background: 'linear-gradient(135deg, rgba(152, 150, 255, 0.1) 0%, rgba(1, 208, 98, 0.06) 100%)',
            border: '1px solid rgba(1, 208, 98, 0.25)',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 11,
            fontFamily: 'var(--font-app)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--fp-4)' }}>My Stake:</span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'var(--fonts--space-grotesk)', fontSize: 12 }}>
                  ${userStaked.toFixed(2)}
                </span>
                {pool.userPosition?.poolSharePct !== undefined && pool.userPosition.poolSharePct > 0 && (
                  <span
                    style={{
                      fontSize: 9.5,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      fontWeight: 600,
                    }}
                  >
                    {pool.userPosition.poolSharePct}% Pool Share
                  </span>
                )}
              </div>
            </div>
            {pool.isLpPool && pool.userPosition?.tokenAStaked && pool.userPosition?.tokenBStaked ? (
              <span style={{ fontSize: 9.5, color: 'var(--fp-3)' }}>
                ≈ {pool.userPosition.tokenAStaked} USDC + {pool.userPosition.tokenBStaked} {pool.tokens[1]?.symbol}
              </span>
            ) : pool.userPosition?.lpTokenBalance ? (
              <span style={{ fontSize: 9.5, color: 'var(--fp-3)' }}>
                {parseFloat(pool.userPosition.lpTokenBalance).toFixed(2)} af-USDC Vault Shares
              </span>
            ) : null}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: 'var(--earned-green)',
                  display: 'inline-block',
                  boxShadow: '0 0 6px var(--earned-green)',
                  animation: 'pulse 1.5s infinite',
                }}
              />
              <span style={{ fontSize: 9.5, color: '#34d399', fontWeight: 600 }}>Streaming Yield</span>
            </div>
            <span style={{ color: 'var(--earned-green)', fontWeight: 700, fontFamily: 'var(--fonts--space-grotesk)', fontSize: 12 }}>
              +${liveCardYield}
            </span>
            <span style={{ fontSize: 9, color: 'var(--fp-4)' }}>
              (+${(cardYieldPerSec * 86400).toFixed(4)}/d)
            </span>
          </div>
        </div>
      )}

      {/* ── Action Buttons ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Deposit Button */}
        <button
          type="button"
          onClick={() => onDeposit(pool)}
          className="ub-action-btn ub-action-btn-primary"
          style={{
            flex: 1,
            justifyContent: 'center',
            padding: '8px 14px',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {pool.isLpPool ? <Zap size={13} /> : <Plus size={13} />}
          <span>{pool.isLpPool ? 'Add Liquidity' : `Deposit ${pool.depositTokenSymbol}`}</span>
        </button>

        {/* Faucet Button (only for pools with isFaucetToken) */}
        {pool.isFaucetToken && onFaucetMint && (
          <button
            type="button"
            onClick={() => onFaucetMint(pool)}
            className="ub-action-btn"
            style={{
              padding: '8px 12px',
              fontSize: 11,
              borderColor: 'rgba(251, 191, 36, 0.35)',
              color: '#fbbf24',
            }}
          >
            <Droplets size={13} />
            <span>Get {pool.tokens[1]?.symbol || 'tcirBTC'}</span>
          </button>
        )}

        {/* Swap Button (only for LP pools) */}
        {pool.isLpPool && onSwap && (
          <button
            type="button"
            onClick={() => onSwap(pool)}
            className="ub-action-btn"
            style={{
              padding: '8px 12px',
              fontSize: 12,
              borderColor: 'rgba(99, 102, 241, 0.3)',
              color: 'var(--purple-1)',
            }}
          >
            <ArrowRightLeft size={13} />
            <span>Swap</span>
          </button>
        )}

        {/* Gateway Action Buttons */}
        {pool.isCrossChainPool && onGatewaySpend && (
          <button
            type="button"
            onClick={() => onGatewaySpend(pool)}
            className="ub-action-btn"
            style={{
              padding: '8px 12px',
              fontSize: 11,
              borderColor: 'rgba(99, 102, 241, 0.35)',
              color: '#60a5fa',
            }}
          >
            <span>Spend</span>
          </button>
        )}

        {/* Withdraw Button */}
        {hasDeposit && (
          <button
            type="button"
            onClick={() => onWithdraw(pool)}
            className="ub-action-btn"
            style={{
              padding: '8px 14px',
              fontSize: 12,
              borderColor: 'rgba(255, 255, 255, 0.15)',
            }}
          >
            <Minus size={13} />
            <span>Withdraw</span>
          </button>
        )}

        {/* Details Toggle Button */}
        <button
          type="button"
          onClick={() => setShowDetails((prev) => !prev)}
          className="ub-action-btn"
          style={{
            padding: '8px 12px',
            fontSize: 11,
            color: 'var(--fp-3)',
          }}
          title="Show Details"
        >
          <span>Details</span>
          <ChevronDown
            size={12}
            style={{
              transition: 'transform 0.2s ease',
              transform: showDetails ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </button>
      </div>

      {/* ── Collapsible Details Section ── */}
      {showDetails && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid rgba(255, 255, 255, 0.06)',
            fontSize: 11,
            fontFamily: 'var(--font-app)',
            color: 'var(--fp-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <p style={{ margin: 0, lineHeight: 1.45, color: 'var(--fp-3)' }}>
            {pool.description}
          </p>

          {/* Yield Origin & Mechanics Box */}
          {pool.yieldOriginDetails && (
            <div
              style={{
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                borderRadius: 8,
                padding: '8px 12px',
                color: '#bfdbfe',
                fontSize: 10.5,
                lineHeight: 1.4,
              }}
            >
              <div style={{ fontWeight: 600, color: '#60a5fa', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                <TrendingUp size={12} />
                <span>Yield Mechanism:</span>
              </div>
              {pool.yieldOriginDetails}
            </div>
          )}

          {/* How It Works Steps */}
          {pool.howItWorksSteps && pool.howItWorksSteps.length > 0 && (
            <div style={{ marginTop: 2 }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: '#fff', display: 'block', marginBottom: 5 }}>
                How It Works
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                {pool.howItWorksSteps.map((s) => (
                  <div
                    key={s.step}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: 6,
                      padding: '6px 8px',
                      fontSize: 10,
                    }}
                  >
                    <span style={{ color: 'var(--purple-1)', fontWeight: 700, marginRight: 4 }}>
                      {s.step}. {s.title}:
                    </span>
                    <span style={{ color: 'var(--fp-4)' }}>{s.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span>Fee Distribution:</span>
            <span style={{ color: '#fff', fontWeight: 500 }}>{pool.feeShare}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Lock / Withdrawal:</span>
            <span style={{ color: '#60a5fa', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 3 }}>
              <Unlock size={11} />
              {pool.lockPeriod}
            </span>
          </div>

          {pool.isCrossChainPool && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Gateway Balance:</span>
              <span style={{ color: '#60a5fa', fontWeight: 500 }}>{gatewayBalance || '—'}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Contract Address:</span>
            <a
              href={getExplorerAddressUrl('Arc_Testnet', pool.contractAddress)}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'var(--purple-1)',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                textDecoration: 'none',
              }}
            >
              <span>{pool.contractAddress.slice(0, 8)}...{pool.contractAddress.slice(-6)}</span>
              <ExternalLink size={10} />
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
