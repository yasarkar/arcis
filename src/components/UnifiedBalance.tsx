import { useState, useRef, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { RefreshCw, AlertTriangle, ChevronDown, Plus, X, Layers, ShieldCheck, ArrowDownRight} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'

// Import Gateway unified balance hook & Wallet Testnet Balances hook
import { useGatewayBalance } from '../hooks/useGatewayBalance'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { depositToGateway } from '../services/gatewayService'
import { useBroadcast } from './BroadcastNotification'
import { formatWalletError } from '../utils/errorUtils'
import { GATEWAY_SUPPORTED_CHAINS } from '../config/gatewayConfig'
import { CHAIN_META, CHAIN_DEFS, getChainDisplayName } from '../config/chainMeta'

const DEPOSIT_TOKEN = 'USDC' as const

// ── Props ────────────────────────────────────────────────────────────────────
interface UnifiedBalanceProps {
  connector?: any // wagmi connector for provider access
  onNavigate?: (tab: 'unified' | 'send' | 'swap' | 'bridge' | 'history') => void
}

// ── Component ────────────────────────────────────────────────────────────────
export default function UnifiedBalance({ connector, onNavigate }: UnifiedBalanceProps) {
  const { address } = useAccount()
  const walletAddress = address || ''
  const { balances, loading, totalBalance, refresh } = useGatewayBalance(walletAddress)
  const { walletBalances, loading: walletLoading, refetch: refetchWalletBalances } = useWalletTestnetBalances(walletAddress)
  const { addBroadcast, updateBroadcast } = useBroadcast()
  const total = parseFloat(totalBalance)

  // Deposit state
  const [showDeposit, setShowDeposit] = useState(false)
  const [depositChain, setDepositChain] = useState('Arc_Testnet')
  const [depositAmount, setDepositAmount] = useState('')
  const [depositing, setDepositing] = useState(false)
  const [depositError, setDepositError] = useState<string | null>(null)

  // Custom chain dropdown state
  const [showChainDropdown, setShowChainDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowChainDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedWalletItem = walletBalances[depositChain]
  const selectedWalletTokenBalance = selectedWalletItem?.usdc || '0.00'
  const isInsufficientWalletBalance = depositAmount !== '' && parseFloat(depositAmount) > parseFloat(selectedWalletTokenBalance)

  const handleSyncAll = () => {
    refresh()
    refetchWalletBalances()
  }

  const sortedBalances = [...balances].sort(
    (a, b) => parseFloat(b.balance) - parseFloat(a.balance)
  )

  const activeChains = sortedBalances.filter(
    b => parseFloat(b.balance) > 0 && b.status === 'success'
  ).length
  const topChain = sortedBalances[0]

  const [showAll, setShowAll] = useState(false)
  const INITIAL_SHOW = 6
  const visibleBalances = showAll ? sortedBalances : sortedBalances.slice(0, INITIAL_SHOW)
  const hasMore = sortedBalances.length > INITIAL_SHOW

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault()
    setDepositError(null)

    const amt = parseFloat(depositAmount)
    if (isNaN(amt) || amt <= 0) {
      setDepositError('Please enter a valid amount')
      return
    }

    if (isInsufficientWalletBalance) {
      setDepositError(`Insufficient USDC wallet balance on ${getChainDisplayName(depositChain)}. Max available: ${selectedWalletTokenBalance} USDC`)
      return
    }

    if (!connector) {
      setDepositError('Wallet not connected. Please connect your wallet first.')
      return
    }

    // Create pending broadcast notification
    const broadcastId = addBroadcast({
      title: 'Depositing to Gateway...',
      status: 'pending',
      badgeText: 'Pending',
      details: {
        fromAmount: depositAmount,
        fromSymbol: DEPOSIT_TOKEN,
        fromChain: depositChain,
        toAmount: depositAmount,
        toSymbol: `Gateway ${DEPOSIT_TOKEN}`,
        network: depositChain,
      },
    })

    setDepositing(true)
    try {
      const provider = await connector.getProvider()
      const result = await depositToGateway(
        provider,
        depositChain,
        depositAmount,
        CHAIN_DEFS[depositChain],
        DEPOSIT_TOKEN
      )

      // Update broadcast notification to success
      updateBroadcast(broadcastId, {
        title: 'Deposit Complete',
        status: 'success',
        badgeText: 'Success',
        details: {
          fromAmount: depositAmount,
          fromSymbol: DEPOSIT_TOKEN,
          fromChain: depositChain,
          toAmount: depositAmount,
          toSymbol: `Gateway ${DEPOSIT_TOKEN}`,
          network: depositChain,
          txHash: result.depositTxHash,
        },
      })

      // Clear input on success
      setDepositAmount('')

      // Refresh balances after deposit
      setTimeout(() => {
        refresh()
        refetchWalletBalances()
      }, 2000)
    } catch (err: any) {
      console.error('[Deposit] Failed:', err)
      const errorMsg = formatWalletError(err)
      setDepositError(errorMsg)

      // Update broadcast notification to failed
      updateBroadcast(broadcastId, {
        title: 'Deposit Failed',
        status: 'failed',
        badgeText: 'Failed',
        message: errorMsg,
        details: {
          fromAmount: depositAmount,
          fromSymbol: DEPOSIT_TOKEN,
          fromChain: depositChain,
          toAmount: depositAmount,
          toSymbol: `Gateway ${DEPOSIT_TOKEN}`,
          network: depositChain,
        },
      })
    } finally {
      setDepositing(false)
    }
  }

  return (
    <div className="arc-animate-reveal" style={{ maxWidth: 860, margin: '0 auto', paddingTop: 16 }}>

      {/* ── HERO CARD (AAVE LUXURY GLASS CONTAINER) ── */}
      <div className="ub-hero-card" style={{ marginBottom: 24 }}>
        {/* Header Tag & Quick Actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="arc-eyebrow" style={{ fontSize: 15, color: 'var(--base-colors--white)', fontWeight: 600, letterSpacing: '2px' }}>
              UNIFIED BALANCE
            </span>
            <span className="ub-live-badge" title="Circle Gateway Realtime Sub-Second Finality">
              <span>LIVE GATEWAY</span>
              <svg className="ub-ecg-svg" viewBox="0 0 48 16" fill="none" aria-hidden="true">
                <path
                  d="M0 8h10l3-5 4 13 4-15 4 10 3-3h10"
                  className="ub-ecg-path-bg"
                />
                <path
                  d="M0 8h10l3-5 4 13 4-15 4 10 3-3h10"
                  className="ub-ecg-path-pulse"
                />
              </svg>
            </span>
          </div>

          <div className="ub-quick-actions">
            {walletAddress && (
              <button
                onClick={() => setShowDeposit(prev => !prev)}
                className={`ub-action-btn ${showDeposit ? 'ub-action-btn-primary' : ''}`}
              >
                {showDeposit ? <X size={13} /> : <Plus size={13} />}
                <span>{showDeposit ? 'Close' : 'Deposit'}</span>
              </button>
            )}
            {walletAddress && (
              <button
                onClick={handleSyncAll}
                disabled={loading || walletLoading}
                className="ub-action-btn"
                style={{ opacity: (loading || walletLoading) ? 0.5 : 1 }}
              >
                <span>Sync</span>
                <RefreshCw
                  size={13}
                  className={`sync-icon ${(loading || walletLoading) ? 'arcflow-spin' : ''}`}
                />
              </button>
            )}
          </div>
        </div>

        {/* Large Balance Display */}
        <div style={{ marginBottom: 20 }}>
          <div
            className="arc-display-hero"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              fontSize: 'clamp(2.8rem, 6.5vw, 4.5rem)',
              marginBottom: 8,
              lineHeight: 1.05,
              fontWeight: 450,
            }}
          >
            <span>{walletAddress ? (loading ? '...' : total.toFixed(2)) : '—'}</span>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255, 255, 255, 0.05)',
                padding: '8px',
                borderRadius: '50%',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: '0 4px 20px rgba(39, 117, 202, 0.25)',
              }}
            >
              <img
                src={UsdcIcon}
                alt="USDC"
                style={{
                  height: '0.8em',
                  width: 'auto',
                  display: 'block',
                  filter: 'drop-shadow(0 0 16px rgba(152, 150, 255, 0.4))',
                }}
              />
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--fp-3)', fontFamily: 'var(--font-app)', fontWeight: 400 }}>
            Unified cross-chain USDC balance instantly spendable across 12+ networks via Circle Gateway.
          </p>
        </div>
      </div>

      {/* ── DEPOSIT FORM (AAVE GLASS PANEL) ── */}
      {showDeposit && walletAddress && (
        <div className="ub-asset-card" style={{ marginBottom: 24, animation: 'arc-reveal 0.3s var(--ease-out-smooth)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--purple-1)',
                }}
              >
                <ArrowDownRight size={18} />
              </div>
              <span className="arc-eyebrow" style={{ fontSize: 13, color: 'var(--base-colors--white)', fontWeight: 600 }}>
                DEPOSIT TO GATEWAY
              </span>
            </div>

            {walletLoading && (
              <span style={{ fontSize: 11, color: 'var(--secondary-colors--sky-sync)', display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-app)' }}>
                <RefreshCw size={11} className="arcflow-spin" /> Refreshing Wallet Balances...
              </span>
            )}
          </div>

          <form onSubmit={handleDeposit} className="space-y-4">
            {/* Custom Chain selector with icons */}
            <div style={{ position: 'relative' }} ref={dropdownRef}>
              <label style={{ fontSize: 11, fontFamily: 'var(--font-app)', fontWeight: 600, color: 'var(--fp-3)', marginBottom: 6, display: 'block', letterSpacing: '0.5px' }}>
                SOURCE CHAIN
              </label>
              <button
                type="button"
                disabled={depositing}
                onClick={() => setShowChainDropdown(prev => !prev)}
                style={{
                  width: '100%',
                  background: 'rgba(11, 13, 24, 0.75)',
                  border: showChainDropdown ? '1px solid rgba(152, 150, 255, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 14,
                  padding: '12px 16px',
                  fontSize: 14,
                  color: '#fff',
                  fontFamily: 'var(--font-app)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: depositing ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s var(--ease-out-smooth)',
                  boxShadow: showChainDropdown ? '0 0 16px rgba(152, 150, 255, 0.2)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <NetworkIcon
                    name={CHAIN_META[depositChain]?.iconId || 'ethereum'}
                    variant={CHAIN_META[depositChain]?.iconId === 'solana' ? 'branded' : 'background'}
                    size={24}
                  />
                  <span style={{ fontWeight: 500 }}>{getChainDisplayName(depositChain)}</span>
                </div>
                <ChevronDown
                  size={16}
                  style={{
                    transition: 'transform 0.25s var(--ease-out-smooth)',
                    transform: showChainDropdown ? 'rotate(180deg)' : 'rotate(0deg)',
                    color: 'var(--fp-3)',
                  }}
                />
              </button>

              {showChainDropdown && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: 8,
                    background: 'rgba(15, 18, 32, 0.96)',
                    backdropFilter: 'blur(24px)',
                    border: '1px solid rgba(152, 150, 255, 0.25)',
                    borderRadius: 16,
                    boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7), 0 4px 16px rgba(0, 0, 0, 0.4)',
                    maxHeight: 280,
                    overflowY: 'auto',
                    zIndex: 100,
                    padding: 6,
                  }}
                >
                  {GATEWAY_SUPPORTED_CHAINS.filter(c => c !== 'Solana_Devnet').map((c) => {
                    const isSelected = depositChain === c
                    const iconId = CHAIN_META[c]?.iconId || 'ethereum'
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setDepositChain(c)
                          setShowChainDropdown(false)
                        }}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '10px 14px',
                          borderRadius: 10,
                          background: isSelected ? 'rgba(152, 150, 255, 0.15)' : 'transparent',
                          border: isSelected ? '1px solid rgba(152, 150, 255, 0.3)' : '1px solid transparent',
                          color: isSelected ? '#fff' : 'var(--fp-3)',
                          fontSize: 13,
                          fontFamily: 'var(--font-app)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
                            e.currentTarget.style.color = '#fff'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.background = 'transparent'
                            e.currentTarget.style.color = 'var(--fp-3)'
                          }
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <NetworkIcon
                            name={iconId}
                            variant={iconId === 'solana' ? 'branded' : 'background'}
                            size={22}
                          />
                          <span style={{ fontWeight: isSelected ? 600 : 400 }}>{getChainDisplayName(c)}</span>
                        </div>
                        {isSelected && (
                          <span style={{ fontSize: 11, fontFamily: 'var(--font-app)', color: 'var(--purple-1)', fontWeight: 600 }}>
                            SELECTED
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Amount input with Wallet Balance & MAX Button — USDC fixed */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 11, fontFamily: 'var(--font-app)', fontWeight: 600, color: 'var(--fp-3)', display: 'block', letterSpacing: '0.5px' }}>
                  AMOUNT
                </label>
                <div style={{ fontSize: 12, fontFamily: 'var(--font-app)', color: 'var(--fp-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>Available: <strong style={{ color: selectedWalletItem?.loading ? 'var(--fp-3)' : '#fff', fontWeight: 600 }}>
                    {selectedWalletItem?.loading ? 'Loading...' : `${selectedWalletTokenBalance} USDC`}
                  </strong></span>
                  <button
                    type="button"
                    onClick={() => {
                      const rawBal = parseFloat(selectedWalletTokenBalance)
                      if (isNaN(rawBal) || rawBal <= 0) {
                        setDepositAmount('0')
                        return
                      }
                      // On Arc Testnet, reserve 0.05 USDC for native gas fees
                      if (depositChain === 'Arc_Testnet') {
                        const safeMax = Math.max(0, rawBal - 0.05)
                        setDepositAmount(safeMax > 0 ? safeMax.toFixed(2) : '0')
                      } else {
                        setDepositAmount(selectedWalletTokenBalance)
                      }
                    }}
                    disabled={depositing || selectedWalletItem?.loading || parseFloat(selectedWalletTokenBalance) <= 0}
                    style={{
                      background: 'rgba(152, 150, 255, 0.12)',
                      border: '1px solid rgba(152, 150, 255, 0.3)',
                      color: 'var(--purple-1)',
                      padding: '3px 10px',
                      borderRadius: 99,
                      fontSize: 10,
                      fontWeight: 700,
                      cursor: (depositing || selectedWalletItem?.loading || parseFloat(selectedWalletTokenBalance) <= 0) ? 'not-allowed' : 'pointer',
                      opacity: (depositing || selectedWalletItem?.loading || parseFloat(selectedWalletTokenBalance) <= 0) ? 0.5 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    MAX
                  </button>
                </div>
              </div>

              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  placeholder="0.00"
                  value={depositAmount}
                  onChange={(e) => {
                    const val = e.target.value
                    setDepositAmount(val.startsWith('-') ? '0' : val)
                  }}
                  disabled={depositing}
                  style={{
                    width: '100%',
                    background: 'rgba(11, 13, 24, 0.75)',
                    border: isInsufficientWalletBalance ? '1px solid #ef4444' : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 14,
                    padding: '12px 16px',
                    paddingRight: '50px',
                    fontSize: 16,
                    color: '#fff',
                    fontFamily: 'var(--fonts--space-grotesk)',
                    fontWeight: 500,
                    outline: 'none',
                    transition: 'border-color 0.2s ease',
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
                  <img
                    src={UsdcIcon}
                    alt="USDC"
                    style={{ width: 22, height: 22, objectFit: 'contain' }}
                  />
                </div>
              </div>
            </div>

            {isInsufficientWalletBalance && (
              <div style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 12, fontSize: 12, color: '#f87171', fontFamily: 'var(--font-app)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                <span>Deposit amount ({depositAmount} USDC) exceeds your wallet balance of {selectedWalletTokenBalance} USDC on {getChainDisplayName(depositChain)}.</span>
              </div>
            )}

            {depositError && !isInsufficientWalletBalance && (
              <div style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: 12, fontSize: 12, color: '#f87171', fontFamily: 'var(--font-app)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                <span>{depositError}</span>
              </div>
            )}

            {/* Fee Transparency Note */}
            <div style={{ padding: '8px 12px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 12, fontSize: 11, color: 'var(--fp-3)', fontFamily: 'var(--font-app)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={13} style={{ color: '#10b981' }} />
                <span>Zero Deposit Fee</span>
              </div>
              <span style={{ color: '#10b981', fontWeight: 600 }}>0.00 USDC (Free)</span>
            </div>

            <button
              type="submit"
              disabled={depositing || isInsufficientWalletBalance}
              style={{
                width: '100%',
                padding: '14px 0',
                borderRadius: 99,
                border: 'none',
                background: (depositing || isInsufficientWalletBalance)
                  ? 'rgba(152, 150, 255, 0.3)'
                  : 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                color: '#fff',
                fontSize: 14,
                fontFamily: 'var(--font-app)',
                fontWeight: 600,
                cursor: (depositing || isInsufficientWalletBalance) ? 'not-allowed' : 'pointer',
                boxShadow: (depositing || isInsufficientWalletBalance) ? 'none' : '0 6px 24px rgba(152, 150, 255, 0.3)',
                transition: 'all 0.2s var(--ease-out-smooth)',
              }}
            >
              {depositing ? 'DEPOSITING...' : 'DEPOSIT TO GATEWAY'}
            </button>
          </form>
        </div>
      )}

      {/* ── STAT STRIP (AAVE 3-COLUMN GLASS PILL) ── */}
      {walletAddress && (
        <div className="ub-stat-strip">
          <div className="ub-stat-item">
            <div className="ub-stat-label">Total Chains</div>
            <div className="ub-stat-value">{sortedBalances.length}</div>
          </div>
          <div className="ub-stat-item">
            <div className="ub-stat-label">Active Deposits</div>
            <div className="ub-stat-value" style={{ color: activeChains > 0 ? 'var(--earned-green)' : 'inherit' }}>
              {activeChains}
            </div>
          </div>
          <div className="ub-stat-item">
            <div className="ub-stat-label">Top Chain</div>
            <div className="ub-stat-value" style={{ fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {topChain ? (
                <>
                  <NetworkIcon
                    name={CHAIN_META[topChain.chainKey]?.iconId || 'ethereum'}
                    variant={CHAIN_META[topChain.chainKey]?.iconId === 'solana' ? 'branded' : 'background'}
                    size={16}
                  />
                  <span>{topChain.name}</span>
                </>
              ) : '—'}
            </div>
          </div>
        </div>
      )}

      {/* ── ASSET DISTRIBUTION (AAVE SQUIRCLE CARD) ── */}
      <div className="ub-asset-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layers size={16} style={{ color: 'var(--purple-1)' }} />
            <span className="arc-eyebrow" style={{ fontSize: 13, color: 'var(--base-colors--white)', fontWeight: 600 }}>
              ASSET DISTRIBUTION
            </span>
          </div>

          <span style={{ fontSize: 12, color: 'var(--fp-3)', fontFamily: 'var(--font-app)', fontWeight: 500 }}>
            {activeChains} of {sortedBalances.length} chains funded
          </span>
        </div>

        <div>
          {visibleBalances.map((item) => {
            const meta = CHAIN_META[item.chainKey] || { iconId: 'ethereum', color: '#64748b', gradient: 'linear-gradient(135deg, #64748b, #475569)' }
            const balance = parseFloat(item.balance)
            const pct = total > 0 ? (balance / total) * 100 : 0

            return (
              <div key={item.chainKey} className="ub-asset-row">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div className="ub-chain-icon" style={{ width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', clipPath: 'circle(50% at 50% 50%)' }}>
                      <NetworkIcon
                        name={meta.iconId}
                        variant={meta.iconId === 'solana' ? 'branded' : 'background'}
                        size={36}
                        className="rounded-full overflow-hidden"
                      />
                    </div>
                    <div>
                      <span style={{ fontFamily: 'var(--font-app)', fontSize: 14, fontWeight: 500, color: 'var(--base-colors--white)', display: 'block', lineHeight: 1.2 }}>
                        {item.name}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {item.status === 'loading' && (
                      <div className="ub-skeleton" style={{ width: 72, height: 20 }} />
                    )}
                    {item.status === 'success' && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'var(--fonts--space-grotesk)', fontSize: 16, fontWeight: 600, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                            {balance.toFixed(2)}
                          </span>
                          <img src={UsdcIcon} alt="USDC" style={{ height: '16px', width: 'auto', display: 'block' }} />
                        </div>
                        <span className="ub-pct-badge">{pct.toFixed(1)}%</span>
                      </>
                    )}
                    {item.status === 'error' && (
                      <span className="ub-error-tooltip" data-tip={item.error || 'RPC query failed'}>
                        <AlertTriangle size={12} />
                        ERROR
                      </span>
                    )}
                  </div>
                </div>

                {item.status === 'success' && (
                  <div className="ub-progress-track">
                    <div className="ub-progress-fill" style={{ width: `${pct}%`, background: meta.gradient }} />
                  </div>
                )}
                {item.status === 'loading' && (
                  <div className="ub-progress-track">
                    <div className="ub-skeleton" style={{ width: '60%', height: '100%', borderRadius: 99 }} />
                  </div>
                )}
              </div>
            )
          })}

          {balances.length === 0 && (
            <div className="ub-empty-state" style={{ padding: '36px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>⬡</div>
              <p style={{ color: 'var(--fp-3)', fontSize: 13, fontFamily: 'var(--font-app)' }}>
                {walletAddress ? 'No Gateway deposits found. Click "DEPOSIT" above to add USDC' : 'Connect wallet to view balances'}
              </p>
            </div>
          )}

          {hasMore && (
            <div style={{ paddingTop: 16, textAlign: 'center' }}>
              <button
                onClick={() => setShowAll(prev => !prev)}
                className="ub-action-btn"
                style={{ width: '100%', justifyContent: 'center', borderRadius: 99, padding: '10px 0' }}
              >
                <span>{showAll ? 'SHOW LESS' : `SHOW ALL (${sortedBalances.length})`}</span>
                <ChevronDown size={14} style={{ transition: 'transform 0.3s var(--ease-out-smooth)', transform: showAll ? 'rotate(180deg)' : 'rotate(0deg)' }} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}