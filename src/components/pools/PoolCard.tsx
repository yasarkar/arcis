// Minimal & Informative Pool Card for Arcis Pools & Yield Hub.
// Features a clean layout, streamlined metrics, live APY badge,
// user position overview, and collapsible technical details.
import { useState } from 'react'
import {
  Unlock,
  ChevronDown,
  ExternalLink,
  Plus,
  Minus,
  Zap,
  Globe,
  TrendingUp,
  Info,
} from 'lucide-react'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
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
  onOpenAgentBounties?: (pool: PoolConfig) => void
  onGatewayDeposit?: (pool: PoolConfig) => void
  onGatewaySpend?: (pool: PoolConfig) => void
  gatewayBalance?: string
}

export default function PoolCard({
  pool,
  walletConnected,
  onDeposit,
  onWithdraw,
  onGatewaySpend,
  gatewayBalance,
}: PoolCardProps) {
  const [showDetails, setShowDetails] = useState(false)

  const userStaked = parseFloat(pool.userPosition?.stakedAmount || '0')
  const hasDeposit = userStaked > 0

  const { formattedYield: liveCardYield, yieldPerSecond: cardYieldPerSec } = useContinuousYieldStream(
    userStaked,
    pool.apy,
    pool.userPosition?.earnedUsd || 0,
    75,
    pool.id
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
        return { bg: 'rgba(1, 208, 98, 0.14)', border: 'rgba(1, 208, 98, 0.3)', text: 'var(--earned-green)', label: 'LIQUIDITY' }
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
      id={`pool-card-${pool.id}`}
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

      {/* ── Key Metrics Grid (Sleek 4-Column Strip: TVL, 24h Vol, Fee/Risk, APY) ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 6,
          background: 'rgba(11, 13, 24, 0.55)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: 10,
          padding: '8px 12px',
          marginBottom: pool.isLpPool && pool.reserves ? 8 : 12,
        }}
      >
        <div>
          <span style={{ fontSize: 9.5, color: 'var(--fp-4)', fontFamily: 'var(--font-app)', display: 'block', marginBottom: 2 }}>
            TVL
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: '#fff',
                fontFamily: 'var(--fonts--space-grotesk)',
              }}
            >
              {pool.tvlUsd >= 1000
                ? Math.floor(pool.tvlUsd).toLocaleString('en-US')
                : pool.tvlUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span
              style={{
                fontSize: 9.5,
                color: 'var(--fp-4)',
                fontFamily: 'var(--font-app)',
                fontWeight: 500,
              }}
            >
              USDC
            </span>
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 2 }}>
            <span style={{ fontSize: 9.5, color: 'var(--fp-4)', fontFamily: 'var(--font-app)' }}>
              24H VOLUME
            </span>
            <span
              title={
                pool.category === 'vault'
                  ? 'Total 24-hour platform transaction volume feeding the 90% protocol revenue share distributed to vault depositors.'
                  : pool.category === 'crosschain'
                  ? 'Total cross-chain settlement volume routed through Circle Gateway over the last 24 hours.'
                  : pool.clientVolumeUsd && pool.clientVolumeUsd > 0
                  ? `Verified on-chain 24H pool volume: $${(pool.volume24hUsd || 0).toFixed(2)} (Your device: $${pool.clientVolumeUsd.toFixed(2)})`
                  : 'Total on-chain swap trading volume executed in this pool over the last 24 hours.'
              }
              style={{ cursor: 'help', display: 'inline-flex', alignItems: 'center', color: 'var(--fp-4)' }}
            >
              <Info size={9.5} />
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: '#fff',
                fontFamily: 'var(--fonts--space-grotesk)',
              }}
            >
              {(pool.volume24hUsd || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span
              style={{
                fontSize: 9.5,
                color: 'var(--fp-4)',
                fontFamily: 'var(--font-app)',
                fontWeight: 500,
              }}
            >
              USDC
            </span>
          </div>
        </div>

        <div>
          <span style={{ fontSize: 9.5, color: 'var(--fp-4)', fontFamily: 'var(--font-app)', display: 'block', marginBottom: 2 }}>
            FEE TIER
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
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: riskConfig.color, display: 'inline-block' }} />
            {pool.feeTierPercent ? `${pool.feeTierPercent}%` : 'RevShare'}
          </span>
        </div>

        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: 9.5, color: 'var(--fp-4)', fontFamily: 'var(--font-app)', display: 'block', marginBottom: 2 }}>
            {pool.apyType}
          </span>
          <span
            title={pool.apyBadge}
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--earned-green)',
              fontFamily: 'var(--fonts--space-grotesk)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              cursor: 'help',
            }}
          >
            {pool.apy.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* ── LP Reserve Ratio Bar (For Dual Asset Pools) ── */}
      {pool.isLpPool && pool.reserves && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--fp-4)', marginBottom: 4 }}>
            <span>
              {pool.tokens[0]?.symbol}: {pool.reserves.tokenA > 0 || pool.reserves.tokenB > 0 ? `${pool.reserves.ratioA}%` : '0.00'}
            </span>
            <span style={{ color: 'var(--fp-3)', fontWeight: 500 }}>
              {pool.reserves.tokenA > 0 || pool.reserves.tokenB > 0 ? 'Pool Composition' : 'No Reserves (0.00)'}
            </span>
            <span>
              {pool.tokens[1]?.symbol}: {pool.reserves.tokenA > 0 || pool.reserves.tokenB > 0 ? `${pool.reserves.ratioB}%` : '0.00'}
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: 4,
              borderRadius: 99,
              background: 'rgba(255, 255, 255, 0.08)',
              overflow: 'hidden',
              display: 'flex',
            }}
          >
            {pool.reserves.tokenA > 0 || pool.reserves.tokenB > 0 ? (
              <>
                <div
                  style={{
                    width: `${pool.reserves.ratioA}%`,
                    background: 'linear-gradient(90deg, #38bdf8 0%, #818cf8 100%)',
                    height: '100%',
                  }}
                />
                <div
                  style={{
                    width: `${pool.reserves.ratioB}%`,
                    background: 'linear-gradient(90deg, #c084fc 0%, #f472b6 100%)',
                    height: '100%',
                  }}
                />
              </>
            ) : (
              <div
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.04)',
                  height: '100%',
                }}
              />
            )}
          </div>
        </div>
      )}

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
              <span style={{ color: 'var(--fp-4)' }}>My Stake: </span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'var(--fonts--space-grotesk)', fontSize: 12 }}>
                  {userStaked.toFixed(2)} USDC
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
            {pool.isLpPool && pool.userPosition?.tokenAStaked && pool.userPosition?.tokenBStaked ? (() => {
              const valA = parseFloat(pool.userPosition.tokenAStaked || '0')
              const valB = parseFloat(pool.userPosition.tokenBStaked || '0') * (pool.exchangeRate || 1)
              const totalVal = valA + valB
              const pctA = totalVal > 0 ? Math.round((valA / totalVal) * 100) : (pool.reserves?.ratioA || 50)
              const pctB = totalVal > 0 ? Math.max(0, 100 - pctA) : (pool.reserves?.ratioB || 50)
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                  <span style={{ fontSize: 9.5, color: 'var(--fp-3)' }}>
                    ≈ {pool.userPosition.tokenAStaked} USDC (${valA.toFixed(2)}) + {pool.userPosition.tokenBStaked} {pool.tokens[1]?.symbol} (${valB.toFixed(2)})
                  </span>
                  <span
                    style={{
                      fontSize: 8.5,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: 'rgba(255, 255, 255, 0.07)',
                      color: 'var(--fp-3)',
                      fontFamily: 'var(--font-app)',
                      fontWeight: 600,
                      letterSpacing: '0.2px',
                    }}
                    title="Asset Value Ratio"
                  >
                    {pctA}% / {pctB}%
                  </span>
                </div>
              )
            })() : pool.userPosition?.lpTokenBalance ? (
              <span style={{ fontSize: 9.5, color: 'var(--fp-3)' }}>
                {parseFloat(pool.userPosition.lpTokenBalance).toFixed(2)} {pool.id === 'gateway-settlement-pool' ? 'USDC Gateway Liquidity' : 'af-USDC Vault Shares'}
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
                  background: pool.apy > 0 ? 'var(--earned-green)' : '#64748b',
                  display: 'inline-block',
                  boxShadow: pool.apy > 0 ? '0 0 6px var(--earned-green)' : 'none',
                  animation: pool.apy > 0 ? 'pulse 1.5s infinite' : 'none',
                }}
              />
              <span
                style={{
                  fontSize: 9.5,
                  color: pool.apy > 0 ? '#34d399' : 'var(--fp-4)',
                  fontWeight: 600,
                }}
              >
                {pool.apy > 0 ? 'Est. Yield (Linear Stream)' : 'Yield Idle (0 Vol)'}
              </span>
            </div>
            <span
              style={{
                color: pool.apy > 0 ? 'var(--earned-green)' : 'var(--fp-3)',
                fontWeight: 700,
                fontFamily: 'var(--fonts--space-grotesk)',
                fontSize: 12,
              }}
            >
              +{liveCardYield}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 9, color: 'var(--fp-4)' }}>
                {pool.apy > 0 ? `(+${(cardYieldPerSec * 86400).toFixed(4)}/d)` : '(Waiting for swaps)'}
              </span>
              <span
                title={
                  pool.isLpPool
                    ? 'Real-time linear projection of fee earnings based on current dynamic APY and your pool share (not a stream of separate on-chain transactions).'
                    : 'Real-time linear projection of earnings based on current vault APY (not a stream of separate on-chain transactions).'
                }
                style={{ cursor: 'help', display: 'inline-flex', alignItems: 'center', color: 'var(--fp-4)' }}
              >
                <Info size={10} />
              </span>
            </div>
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
          <Plus size={13} />
          <span>{pool.isLpPool || pool.id === 'gateway-settlement-pool' ? 'Add Liquidity' : 'Deposit'}</span>
        </button>

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
            <span>{pool.isLpPool || pool.id === 'gateway-settlement-pool' ? 'Remove Liquidity' : 'Withdraw'}</span>
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
          {!pool.isCrossChainPool ? (
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
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Settlement Infrastructure:</span>
              <span style={{ color: '#60a5fa', fontWeight: 500, fontSize: 11 }}>
                Circle Gateway (Sub-second Finality)
              </span>
            </div>
          )}

          <div
            style={{
              background: 'rgba(56, 189, 248, 0.08)',
              border: '1px solid rgba(56, 189, 248, 0.2)',
              borderRadius: 8,
              padding: '7px 10px',
              color: '#7dd3fc',
              fontSize: 10.5,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 4,
            }}
          >
            <Zap size={12} style={{ color: '#38bdf8', flexShrink: 0 }} />
            <span><strong>Arc Gas Benefit:</strong> Gas settled natively in USDC (~0.001) — zero ETH required.</span>
          </div>
        </div>
      )}
    </div>
  )
}
