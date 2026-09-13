// Minimal & Informative Pool Card for Arcis Pools & Yield Hub.
// Features a clean layout, streamlined metrics, live APY badge,
// user position overview, and collapsible technical details.
import { useState, useRef, useEffect } from 'react'
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
  Coins,
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
  onClaim?: (poolId: string) => void
  isClaiming?: boolean
  claimingPoolId?: string | null
}

export default function PoolCard({
  pool,
  walletConnected,
  onDeposit,
  onWithdraw,
  onClaim,
  isClaiming = false,
  claimingPoolId = null,
}: PoolCardProps) {
  const [showDetails, setShowDetails] = useState(false)

  const prevVolRef = useRef(pool.volume24hUsd)
  const [volUpdated, setVolUpdated] = useState(false)

  useEffect(() => {
    if (prevVolRef.current !== undefined && prevVolRef.current !== pool.volume24hUsd && (pool.volume24hUsd || 0) > 0) {
      setVolUpdated(true)
      const timer = setTimeout(() => setVolUpdated(false), 1400)
      return () => clearTimeout(timer)
    }
    prevVolRef.current = pool.volume24hUsd
  }, [pool.volume24hUsd])

  const userStaked = parseFloat(pool.userPosition?.stakedAmount || '0')
  const hasDeposit = userStaked > 0
  const earnedUsd = pool.userPosition?.earnedUsd || 0
  const isThisPoolClaiming = isClaiming && claimingPoolId === pool.id

  const { formattedYield: liveCardYield, yieldPerSecond: cardYieldPerSec } = useContinuousYieldStream(
    userStaked,
    pool.apy,
    pool.userPosition?.earnedUsd || 0,
    1000,
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
        return { bg: 'rgba(152, 150, 255, 0.14)', border: 'rgba(152, 150, 255, 0.3)', text: 'var(--purple-1)', label: 'LIQUIDITY' }
      case 'vault':
        return { bg: 'rgba(152, 150, 255, 0.14)', border: 'rgba(152, 150, 255, 0.3)', text: 'var(--purple-1)', label: 'VAULT' }
      default:
        return { bg: 'rgba(255, 255, 255, 0.08)', border: 'rgba(255, 255, 255, 0.15)', text: '#fff', label: 'POOL' }
    }
  }

  const categoryBadge = getCategoryBadge()
  const riskConfig = POOL_RISK_LEVELS[pool.riskLevel] || POOL_RISK_LEVELS['Low']

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
          <span style={{ fontSize: 9.5, color: 'var(--fp-4)', fontFamily: 'var(--font-app)', display: 'block', marginBottom: 6 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--fp-4)', fontFamily: 'var(--font-app)' }}>
              24H VOLUME
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: volUpdated ? '#34d399' : '#fff',
                fontFamily: 'var(--fonts--space-grotesk)',
                transition: 'color 0.4s ease, text-shadow 0.4s ease',
                textShadow: volUpdated ? '0 0 10px rgba(52, 211, 153, 0.5)' : 'none',
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
          <span style={{ fontSize: 9.5, color: 'var(--fp-4)', fontFamily: 'var(--font-app)', display: 'block' }}>
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
          <span style={{ fontSize: 9.5, color: 'var(--fp-4)', fontFamily: 'var(--font-app)', display: 'block' }}>
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
                  <span style={{ fontSize: 10, color: 'var(--fp-3)' }}>
                    ≈ {pool.userPosition.tokenAStaked} USDC + {pool.userPosition.tokenBStaked} {pool.tokens[1]?.symbol}
                  </span>
                  <span
                    style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
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
                  cursor: 'help',
                }}
                title="Estimated real-time yield accrual preview based on current APY. Actual claimable balance is verified on-chain."
              >
                {pool.apy > 0 ? 'Est. Yield' : 'Yield Idle'}
              </span>
            </div>
            <span
              style={{
                color: pool.apy > 0 ? 'var(--earned-green)' : 'var(--fp-3)',
                fontWeight: 700,
                fontFamily: 'var(--fonts--space-grotesk)',
                fontSize: 12,
              }}
              title="Real-time estimated yield accrual preview"
            >
              {pool.apy > 0 ? `≈ +${liveCardYield}` : '+0.00'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--fp-4)' }}>
                {pool.apy > 0 ? `(+${(cardYieldPerSec * 86400).toFixed(4)}/d)` : '(Waiting for swaps)'}
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
          <span>{pool.isLpPool ? 'Add Liquidity' : 'Deposit'}</span>
        </button>

        {/* Claim Button */}
        {hasDeposit && earnedUsd >= 0.01 && onClaim && (
          <button
            type="button"
            onClick={() => onClaim(pool.id)}
            disabled={isThisPoolClaiming}
            className="ub-action-btn"
            style={{
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 600,
              background: 'linear-gradient(135deg, rgba(1, 208, 98, 0.16) 0%, rgba(56, 189, 248, 0.12) 100%)',
              border: '1px solid rgba(1, 208, 98, 0.45)',
              color: 'var(--earned-green)',
              boxShadow: '0 0 12px rgba(1, 208, 98, 0.15)',
            }}
            title={`Claim ${earnedUsd.toFixed(4)} USDC in profit without unstaking principal`}
          >
            <Coins size={13} />
            <span>{isThisPoolClaiming ? 'Claiming...' : `Claim +$${earnedUsd.toFixed(4)}`}</span>
          </button>
        )}

        {/* Withdraw / Redeem Button */}
        {pool.category === 'vault' ? (
          <button
            type="button"
            onClick={() => onWithdraw(pool)}
            disabled={!hasDeposit}
            className="ub-action-btn"
            style={{
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 600,
              borderColor: hasDeposit ? 'rgba(152, 150, 255, 0.35)' : 'rgba(255, 255, 255, 0.1)',
              color: hasDeposit ? '#fff' : 'var(--fp-4)',
              opacity: hasDeposit ? 1 : 0.45,
              cursor: hasDeposit ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease',
            }}
            title={
              hasDeposit
                ? 'Redeem your af-USDC shares for USDC principal + accumulated yield'
                : 'Deposit USDC first to redeem shares and yield'
            }
          >
            <Minus size={13} />
            <span>Redeem</span>
          </button>
        ) : (
          hasDeposit && (
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
              <span>{pool.isLpPool ? 'Remove Liquidity' : 'Withdraw'}</span>
            </button>
          )
        )}

        {/* Details Toggle Button */}
        <button
          type="button"
          onClick={() => setShowDetails((prev) => !prev)}
          className="ub-action-btn"
          style={{
            padding: '8px 14px',
            fontSize: 12,
            borderColor: 'rgba(255, 255, 255, 0.15)',
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
