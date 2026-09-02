// src/components/pools/YieldCalculator.tsx
//
// Interactive Yield & ROI Simulator for Arcis.
// Allows users to simulate compounding interest across USYC, Real-Yield, and LP pools.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Calculator,
  X,
  Zap,
  Activity,
} from 'lucide-react'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import { ARCIS_POOLS, type PoolConfig } from '../../config/poolsConfig'
import { useContinuousYieldStream } from '../../hooks/useContinuousYieldStream'

interface YieldCalculatorProps {
  isOpen: boolean
  onClose: () => void
  onSelectPoolToDeposit?: (pool: PoolConfig) => void
}

export default function YieldCalculator({
  isOpen,
  onClose,
  onSelectPoolToDeposit,
}: YieldCalculatorProps) {
  const [principal, setPrincipal] = useState<string>('5000')
  const defaultPoolId = ARCIS_POOLS.length > 0 ? ARCIS_POOLS[0].id : ''
  const [selectedPoolId, setSelectedPoolId] = useState<string>(defaultPoolId)
  const [compoundFreq] = useState<'daily' | 'monthly' | 'yearly'>('daily')

  if (!isOpen) return null

  const principalNum = Math.max(0, parseFloat(principal) || 0)
  const selectedPool = ARCIS_POOLS.find((p) => p.id === selectedPoolId) || ARCIS_POOLS[0]

  const { formattedYield: simLiveYield, yieldPerSecond: simYieldPerSec } = useContinuousYieldStream(
    principalNum,
    selectedPool.apy,
    0,
    70
  )

  // Compounding math: A = P * (1 + r/n)^(n*t)
  const calculateCompoundReturn = (days: number, apyPercent: number) => {
    const r = apyPercent / 100
    const t = days / 365
    let n = 365
    if (compoundFreq === 'monthly') n = 12
    if (compoundFreq === 'yearly') n = 1

    const finalAmount = principalNum * Math.pow(1 + r / n, n * t)
    const yieldEarned = Math.max(0, finalAmount - principalNum)
    return {
      finalAmount,
      yieldEarned,
    }
  }

  const periods = [
    { label: '30 Days (1 Mo)', days: 30 },
    { label: '90 Days (3 Mo)', days: 90 },
    { label: '180 Days (6 Mo)', days: 180 },
    { label: '1 Year (365 D)', days: 365 },
    { label: '3 Years', days: 365 * 3 },
  ]

  const quickAmounts = ['500', '1000', '5000']

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        animation: 'arc-reveal 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="ub-hero-card"
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'linear-gradient(180deg, rgba(17, 21, 38, 0.98) 0%, rgba(11, 13, 24, 0.99) 100%)',
          border: '1px solid rgba(152, 150, 255, 0.35)',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.9), 0 0 32px rgba(152, 150, 255, 0.15)',
          borderRadius: 24,
          padding: '28px',
          position: 'relative',
          fontFamily: 'var(--font-app)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          type="button"
          className="ub-action-btn"
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            padding: 8,
            borderRadius: '50%',
          }}
          title="Close Simulator"
        >
          <X size={16} />
        </button>

        {/* Modal Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Calculator size={18} style={{ color: 'var(--purple-1)' }} />
            <span
              className="arc-eyebrow"
              style={{ fontSize: 12, color: 'var(--purple-1)', fontWeight: 600, letterSpacing: '1.5px' }}
            >
              YIELD SIMULATOR & ROI PROJECTION
            </span>
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: 22,
              fontFamily: 'var(--fonts--space-grotesk)',
              fontWeight: 600,
              color: '#fff',
            }}
          >
            Compound Interest Calculator
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--fp-3)', fontFamily: 'var(--font-app)' }}>
            Simulate liquidity fees, vault revenue shares, and cross-chain routing returns on Arc Network.
          </p>
        </div>

        {/* Principal Input */}
        <div style={{ marginBottom: 20 }}>
          <label
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-app)',
              fontWeight: 600,
              color: 'var(--fp-3)',
              display: 'block',
              marginBottom: 8,
              letterSpacing: '0.5px',
            }}
          >
            PRINCIPAL INVESTMENT
          </label>

          <div style={{ position: 'relative', marginBottom: 10 }}>
            <input
              type="number"
              min="0"
              step="any"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              placeholder="5000"
              style={{
                width: '100%',
                background: 'rgba(11, 13, 24, 0.85)',
                border: '1px solid rgba(152, 150, 255, 0.3)',
                borderRadius: 14,
                padding: '14px 18px',
                paddingRight: '60px',
                fontSize: 20,
                color: '#fff',
                fontFamily: 'var(--fonts--space-grotesk)',
                fontWeight: 600,
                outline: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                right: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                pointerEvents: 'none',
              }}
            >
              <img src={UsdcIcon} alt="USDC" style={{ width: 22, height: 22, objectFit: 'contain' }} />
            </div>
          </div>

          {/* Quick Amount Chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {quickAmounts.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setPrincipal(amt)}
                style={{
                  background:
                    principal === amt
                      ? 'rgba(152, 150, 255, 0.25)'
                      : 'rgba(255, 255, 255, 0.04)',
                  border:
                    principal === amt
                      ? '1px solid rgba(152, 150, 255, 0.45)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                  color: principal === amt ? '#fff' : 'var(--fp-3)',
                  padding: '4px 12px',
                  borderRadius: 99,
                  fontSize: 11,
                  fontFamily: 'var(--font-app)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                ${parseInt(amt).toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        {/* Select Target Pool */}
        <div style={{ marginBottom: 20 }}>
          <label
            style={{
              fontSize: 11,
              fontFamily: 'var(--font-app)',
              fontWeight: 600,
              color: 'var(--fp-3)',
              display: 'block',
              marginBottom: 8,
              letterSpacing: '0.5px',
            }}
          >
            TARGET POOL STRATEGY
          </label>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: 8,
            }}
          >
            {ARCIS_POOLS.map((p) => {
              const isSelected = selectedPoolId === p.id
              const shortName = p.isLpPool && p.tokens.length >= 2
                ? `${p.tokens[0].symbol} / ${p.tokens[1].symbol}`
                : p.name.replace(' Settlement Pool', ' Pool').replace(' Cross-Chain', '')

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPoolId(p.id)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    background: isSelected
                      ? 'linear-gradient(135deg, rgba(152, 150, 255, 0.2) 0%, rgba(99, 102, 241, 0.25) 100%)'
                      : 'rgba(255, 255, 255, 0.03)',
                    border: isSelected
                      ? '1px solid rgba(152, 150, 255, 0.45)'
                      : '1px solid rgba(255, 255, 255, 0.06)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: isSelected ? '#fff' : 'var(--fp-3)',
                      marginBottom: 2,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={p.name}
                  >
                    {shortName}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--earned-green)', fontFamily: 'var(--fonts--space-grotesk)' }}>
                    {p.apy}% {p.apyType}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Compounding Projections Table ── */}
        <div
          style={{
            background: 'rgba(11, 13, 24, 0.75)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: 16,
            padding: '16px',
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', fontFamily: 'var(--font-app)' }}>
              Projected Returns: {selectedPool.name}
            </span>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-app)',
                color: 'var(--earned-green)',
                background: 'rgba(1, 208, 98, 0.12)',
                padding: '2px 8px',
                borderRadius: 99,
                fontWeight: 600,
              }}
            >
              {selectedPool.apy}% APY (Daily Accrual)
            </span>
          </div>

          {/* Live Continuous Accrual Simulator Bar */}
          {principalNum > 0 && (
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(1, 208, 98, 0.1) 0%, rgba(56, 189, 248, 0.08) 100%)',
                border: '1px solid rgba(1, 208, 98, 0.25)',
                borderRadius: 12,
                padding: '10px 14px',
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600, fontFamily: 'var(--font-app)' }}>
                  Sub-Second Real-Time Yield Accrual:
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ color: 'var(--earned-green)', fontWeight: 700, fontFamily: 'var(--fonts--space-grotesk)', fontSize: 13 }}>
                  +${simLiveYield} USDC
                </span>
                <span style={{ fontSize: 9.5, color: 'var(--fp-4)', display: 'block' }}>
                  (+${(simYieldPerSec).toFixed(6)}/sec)
                </span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {periods.map((period) => {
              const res = calculateCompoundReturn(period.days, selectedPool.apy)
              return (
                <div
                  key={period.days}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.04)',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--fp-3)', fontFamily: 'var(--font-app)' }}>
                    {period.label}
                  </span>
                  <div style={{ textAlign: 'right' }}>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: 'var(--earned-green)',
                        fontFamily: 'var(--fonts--space-grotesk)',
                        display: 'block',
                      }}
                    >
                      +${res.yieldEarned.toFixed(2)} USDC
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--fp-4)', fontFamily: 'var(--font-app)' }}>
                      Total: ${res.finalAmount.toFixed(2)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Deposit Shortcut Button */}
        {onSelectPoolToDeposit && (
          <button
            type="button"
            onClick={() => {
              onSelectPoolToDeposit(selectedPool)
              onClose()
            }}
            className="ub-action-btn ub-action-btn-primary"
            style={{
              width: '100%',
              justifyContent: 'center',
              padding: '14px 0',
              fontSize: 14,
              borderRadius: 99,
            }}
          >
            <Zap size={16} />
            <span>Deposit ${principalNum.toLocaleString()} to {selectedPool.name}</span>
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}

