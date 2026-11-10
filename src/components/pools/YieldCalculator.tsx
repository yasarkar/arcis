// Interactive Yield & ROI Simulator for Arcis.
// Allows users to simulate compounding interest across Real-Yield and LP pools.
import {
  Plus,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { TOKEN_ICON_MAP, UsdcIcon } from '../../config/tokenIcons'
import { ARCIS_POOLS, type PoolConfig } from '../../config/poolsConfig'
import { useClearOnWalletDisconnect } from '../../hooks/useClearOnWalletDisconnect'
import { DEFAULT_TOKEN_PRICES, normalizeTokenSymbol } from '../../services/tokenPriceService'

interface YieldCalculatorProps {
  isOpen: boolean
  onClose: () => void
  onSelectPoolToDeposit?: (pool: PoolConfig) => void
  walletBalanceUsdc?: string
  pools?: PoolConfig[]
}

function getTokenIcon(symbol: string): string {
  return TOKEN_ICON_MAP[symbol] || TOKEN_ICON_MAP[normalizeTokenSymbol(symbol)] || UsdcIcon
}

function getTokenUsdPrice(symbol: string): number {
  const norm = normalizeTokenSymbol(symbol).toUpperCase()
  return DEFAULT_TOKEN_PRICES[norm] || DEFAULT_TOKEN_PRICES[symbol.toUpperCase()] || 1.0
}

function formatTokenYield(amount: number, symbol: string): string {
  const sym = symbol.toUpperCase()
  if (sym === 'CIRBTC' || sym === 'BTC' || sym === 'WBTC') {
    if (amount < 0.0001) return amount.toFixed(6)
    if (amount < 0.01) return amount.toFixed(5)
    return amount.toFixed(4)
  }
  if (sym === 'WETH' || sym === 'ETH') {
    if (amount < 0.01) return amount.toFixed(4)
    if (amount < 1) return amount.toFixed(3)
    return amount.toFixed(2)
  }
  return amount.toFixed(2)
}

export default function YieldCalculator({
  isOpen,
  onClose,
  onSelectPoolToDeposit,
  walletBalanceUsdc,
  pools,
}: YieldCalculatorProps) {
  const activePools = pools && pools.length > 0 ? pools : ARCIS_POOLS
  const [principal, setPrincipal] = useState<string>('5000')
  const defaultPoolId = activePools.length > 0 ? activePools[0].id : ''
  const [selectedPoolId, setSelectedPoolId] = useState<string>(defaultPoolId)
  const [compoundFreq] = useState<'daily' | 'monthly' | 'yearly'>('daily')

  // Systematic input and state clearing on wallet disconnect
  const resetFormInputs = useCallback(() => {
    setPrincipal('')
  }, [])

  useClearOnWalletDisconnect(resetFormInputs)

  const principalNum = Math.max(0, parseFloat(principal) || 0)
  const selectedPool = activePools.find((p) => p.id === selectedPoolId) || activePools[0]

  if (!isOpen) return null

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
  ]

  const quickAmounts = ['500', '1000', '5000']

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      style={{
        background: 'rgba(5, 7, 15, 0.78)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative w-full max-w-[680px] my-auto rounded-3xl overflow-hidden shadow-2xl transition-all border animate-in fade-in zoom-in-95 duration-200"
        style={{
          maxHeight: 'min(90vh, 880px)',
          overflowY: 'auto',
          background: 'linear-gradient(180deg, rgba(20, 24, 44, 0.96) 0%, rgba(12, 14, 26, 0.98) 100%)',
          borderColor: 'rgba(152, 150, 255, 0.35)',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 40px rgba(99, 102, 241, 0.15)',
          borderRadius: 24,
          padding: '28px',
          position: 'relative',
          fontFamily: 'var(--font-app)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow ambient header accent */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-24 bg-gradient-to-r from-blue-500/20 via-indigo-500/30 to-purple-500/20 blur-3xl pointer-events-none" />

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
            zIndex: 10,
          }}
        >
          <X size={16} />
        </button>

        {/* Modal Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <TrendingUp size={18} style={{ color: 'var(--purple-1)' }} />
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
            Simulate real asset growth, vault revenue shares, and LP trading fee yields on Arc Network.
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
            PRINCIPAL INVESTMENT (USD VALUATION)
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
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fp-3)', fontFamily: 'var(--fonts--space-grotesk)' }}>
                USD
              </span>
            </div>
          </div>

          {/* Quick Amount Chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {walletBalanceUsdc && parseFloat(walletBalanceUsdc) > 0 && (
              <button
                type="button"
                onClick={() => setPrincipal(parseFloat(walletBalanceUsdc).toFixed(2))}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  lineHeight: 1,
                  background:
                    principal === parseFloat(walletBalanceUsdc).toFixed(2)
                      ? 'rgba(152, 150, 255, 0.25)'
                      : 'rgba(255, 255, 255, 0.04)',
                  border:
                    principal === parseFloat(walletBalanceUsdc).toFixed(2)
                      ? '1px solid rgba(152, 150, 255, 0.45)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                  color: principal === parseFloat(walletBalanceUsdc).toFixed(2) ? '#fff' : 'var(--fp-3)',
                  padding: '5px 10px',
                  borderRadius: 99,
                  fontSize: 11,
                  fontFamily: 'var(--font-app)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <Wallet size={12} style={{ flexShrink: 0, display: 'block' }} />
                <img
                  src={UsdcIcon}
                  alt="USDC"
                  style={{ width: 13, height: 13, objectFit: 'contain', flexShrink: 0, display: 'block' }}
                />
                <span style={{ lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}>
                  {parseFloat(walletBalanceUsdc).toFixed(2)} USDC
                </span>
              </button>
            )}
            {quickAmounts.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setPrincipal(amt)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  lineHeight: 1,
                  background:
                    principal === amt
                      ? 'rgba(152, 150, 255, 0.25)'
                      : 'rgba(255, 255, 255, 0.04)',
                  border:
                    principal === amt
                      ? '1px solid rgba(152, 150, 255, 0.45)'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                  color: principal === amt ? '#fff' : 'var(--fp-3)',
                  padding: '5px 12px',
                  borderRadius: 99,
                  fontSize: 11,
                  fontFamily: 'var(--font-app)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}>
                  ${parseInt(amt).toLocaleString()}
                </span>
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
            {activePools.map((p) => {
              const isSelected = selectedPoolId === p.id
              const isLp = p.isLpPool && p.tokens.length >= 2
              const shortName = isLp
                ? `${p.tokens[0].symbol} / ${p.tokens[1].symbol}`
                : p.name.replace(' Settlement Pool', ' Pool').replace(' Cross-Chain', '')

              const tokenAIcon = getTokenIcon(p.tokens[0]?.symbol || 'USDC')
              const tokenBIcon = isLp ? getTokenIcon(p.tokens[1]?.symbol || '') : null

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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
                    <img
                      src={tokenAIcon}
                      alt={p.tokens[0]?.symbol || ''}
                      style={{ width: 14, height: 14, objectFit: 'contain', display: 'block' }}
                    />
                    {tokenBIcon && (
                      <img
                        src={tokenBIcon}
                        alt={p.tokens[1]?.symbol || ''}
                        style={{ width: 14, height: 14, objectFit: 'contain', display: 'block' }}
                      />
                    )}
                  </div>
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
                  >
                    {shortName}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--fonts--space-grotesk)' }}>
                    {p.apy.toFixed(2)}% {p.apyType}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#fff', fontFamily: 'var(--font-app)', display: 'block' }}>
                Projected Returns: {selectedPool.name}
              </span>
              <span style={{ fontSize: 11, color: 'var(--fp-3)', fontFamily: 'var(--font-app)', marginTop: 2, display: 'block' }}>
                {selectedPool.isLpPool && selectedPool.tokens.length >= 2
                  ? `Real trading fee yield earned in ${selectedPool.tokens[0].symbol} + ${selectedPool.tokens[1].symbol}`
                  : `Real protocol revenue distributed in ${selectedPool.tokens[0]?.symbol || 'USDC'}`}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {periods.map((period) => {
              const res = calculateCompoundReturn(period.days, selectedPool.apy)
              const isLp = Boolean(selectedPool.isLpPool && selectedPool.tokens && selectedPool.tokens.length >= 2)

              if (!isLp) {
                // Single-asset vault (USDC)
                const token = selectedPool.tokens[0] || { symbol: 'USDC' }
                const tokenIcon = getTokenIcon(token.symbol)
                const price = getTokenUsdPrice(token.symbol)
                const tokenAmount = res.yieldEarned / price

                return (
                  <div
                    key={period.days}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: 10,
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid rgba(255, 255, 255, 0.04)',
                    }}
                  >
                    <span style={{ fontSize: 12, color: 'var(--fp-3)', fontFamily: 'var(--font-app)' }}>
                      {period.label}
                    </span>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', lineHeight: 1 }}>
                      <img
                        src={tokenIcon}
                        alt={token.symbol}
                        style={{ width: 14, height: 14, objectFit: 'contain', flexShrink: 0, display: 'block' }}
                      />
                      <span
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          fontFamily: 'var(--fonts--space-grotesk)',
                          lineHeight: 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {formatTokenYield(tokenAmount, token.symbol)} {token.symbol}
                      </span>
                    </div>
                  </div>
                )
              }

              // Dual-Asset LP pool (e.g. cirBTC / WETH, EURC / WETH, USDC / cirBTC)
              const tokenA = selectedPool.tokens[0]
              const tokenB = selectedPool.tokens[1]
              const iconA = getTokenIcon(tokenA.symbol)
              const iconB = getTokenIcon(tokenB.symbol)
              const ratioA = (selectedPool.reserves?.ratioA || 50) / 100
              const ratioB = 1 - ratioA
              const priceA = getTokenUsdPrice(tokenA.symbol)
              const priceB = getTokenUsdPrice(tokenB.symbol)
              const amountA = (res.yieldEarned * ratioA) / priceA
              const amountB = (res.yieldEarned * ratioB) / priceB

              return (
                <div
                  key={period.days}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 10,
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px solid rgba(255, 255, 255, 0.04)',
                  }}
                >
                  <span style={{ fontSize: 12, color: 'var(--fp-3)', fontFamily: 'var(--font-app)' }}>
                    {period.label}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', lineHeight: 1 }}>
                      {/* Token A Yield */}
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, lineHeight: 1 }}>
                        <img
                          src={iconA}
                          alt={tokenA.symbol}
                          style={{ width: 13, height: 13, objectFit: 'contain', flexShrink: 0, display: 'block' }}
                        />
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            fontFamily: 'var(--fonts--space-grotesk)',
                            lineHeight: 1,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {formatTokenYield(amountA, tokenA.symbol)} {tokenA.symbol}
                        </span>
                      </div>

                      <span style={{ color: 'var(--fp-4)', fontSize: 15, fontWeight: 700, lineHeight: 1 }}>+</span>

                      {/* Token B Yield */}
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, lineHeight: 1 }}>
                        <img
                          src={iconB}
                          alt={tokenB.symbol}
                          style={{ width: 13, height: 13, objectFit: 'contain', flexShrink: 0, display: 'block' }}
                        />
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            fontFamily: 'var(--fonts--space-grotesk)',
                            lineHeight: 1,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {formatTokenYield(amountB, tokenB.symbol)} {tokenB.symbol}
                        </span>
                      </div>
                    </div>

                    {/* Total USD equivalent */}
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--fp-3)',
                        fontFamily: 'var(--fonts--space-grotesk)',
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1,
                      }}
                    >
                      ≈ ${res.yieldEarned.toFixed(2)} USD
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          <p style={{ fontSize: 10.5, color: 'var(--fp-4)', margin: '14px 0 0 0', textAlign: 'center', lineHeight: 1.4 }}>
            Linear stream and compound projections assume constant base APY. LP fee rewards accumulate directly in the pool's traded pairs ({selectedPool.tokens.map((t) => t.symbol).join(' + ')}).
          </p>
        </div>

        {/* Deposit Shortcut Button */}
        {onSelectPoolToDeposit && (
          <button
            type="button"
            onClick={() => {
              onSelectPoolToDeposit(selectedPool)
              onClose()
            }}
            className="w-full py-4 px-6 rounded-full font-semibold text-sm sm:text-base tracking-wide transition-all duration-200 flex items-center justify-center gap-2 select-none text-white hover:scale-[1.01] hover:brightness-110 active:scale-[0.98] cursor-pointer"
            style={{
              fontFamily: 'var(--font-app)',
              background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
              boxShadow: '0 6px 24px rgba(152, 150, 255, 0.3)',
            }}
          >
            <Plus size={16} className="text-white" />
            <span>{selectedPool.isLpPool ? 'Add Liquidity' : 'Deposit'}</span>
          </button>
        )}
      </div>
    </div>,
    document.body
  )
}
