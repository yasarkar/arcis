// Interactive Cross-Chain Liquidity Rebalance Wizard for Arcis.
// Scans idle USDC across 12+ networks and aggregates funds into Arc Testnet via Circle Gateway in <500ms.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Zap,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react'
import ArcLogo from '../../assets/Arc-Icon.svg'
import { useGatewayBalancer} from '../../hooks/useGatewayBalancer'

interface GatewayRebalanceWizardProps {
  isOpen: boolean
  onClose: () => void
  walletAddress: string
  totalStakedUsd: number
  onSuccess?: (totalMoved: string) => void
}

export default function GatewayRebalanceWizard({
  isOpen,
  onClose,
  walletAddress,
  totalStakedUsd,
  onSuccess,
}: GatewayRebalanceWizardProps) {
  const {
    rebalanceableChains,
    totalIdleUsdc,
    capitalEfficiencyScore,
    executeRebalance,
  } = useGatewayBalancer(walletAddress, totalStakedUsd)

  const [selectedChainKeys, setSelectedChainKeys] = useState<string[]>(() =>
    rebalanceableChains.map((c) => c.chainKey)
  )
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [completedResult, setCompletedResult] = useState<{
    totalMoved: string
    timeMs: number
    txHash: string
  } | null>(null)

  if (!isOpen) return null

  // Toggle selection of an individual chain
  const toggleChain = (chainKey: string) => {
    setSelectedChainKeys((prev) =>
      prev.includes(chainKey) ? prev.filter((k) => k !== chainKey) : [...prev, chainKey]
    )
    setErrorMsg(null)
  }

  const selectAll = () => {
    setSelectedChainKeys(rebalanceableChains.map((c) => c.chainKey))
  }

  const deselectAll = () => {
    setSelectedChainKeys([])
  }

  // Calculate selected amount to move
  const selectedTotalUsdc = rebalanceableChains
    .filter((c) => selectedChainKeys.includes(c.chainKey))
    .reduce((acc, c) => acc + c.balanceNum, 0)

  // Potential annual yield increase if moved to USYC (4.95%) or Real-Yield (8.42%)
  const estYieldBoostUsd = (selectedTotalUsdc * 0.065) // ~6.5% blended yield

  const handleExecute = async () => {
    if (selectedChainKeys.length === 0 || selectedTotalUsdc <= 0) {
      setErrorMsg('Please select at least one network with a positive USDC balance.')
      return
    }

    setIsProcessing(true)
    setErrorMsg(null)
    try {
      const res = await executeRebalance(selectedChainKeys, 'Arc_Testnet')
      setCompletedResult({
        totalMoved: res.totalMovedUsdc,
        timeMs: res.executionTimeMs,
        txHash: res.txHash,
      })
      if (onSuccess) onSuccess(res.totalMovedUsdc)
    } catch (err: any) {
      console.error('[GatewayRebalanceWizard] Error:', err)
      setErrorMsg(err.message || 'Rebalancing failed. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

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
        if (e.target === e.currentTarget && !isProcessing) onClose()
      }}
    >
      <div
        className="ub-hero-card"
        style={{
          width: '100%',
          maxWidth: 640,
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
          disabled={isProcessing}
          type="button"
          className="ub-action-btn"
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            padding: 8,
            borderRadius: '50%',
          }}
          title="Close Rebalancer"
        >
          <X size={16} />
        </button>

        {/* Modal Header */}
        <div style={{ marginBottom: 20, paddingRight: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span
              className="arc-eyebrow"
              style={{ fontSize: 12, color: 'var(--purple-1)', fontWeight: 600, letterSpacing: '1.5px' }}
            >
              CIRCLE GATEWAY AUTO-REBALANCER
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
            Multi-Chain Liquidity Balancer
          </h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 13, color: 'var(--fp-3)', fontFamily: 'var(--font-app)' }}>
            Consolidate idle testnet USDC across 8 official testnets to Arc Testnet in &lt;500ms with zero slippage.
          </p>
        </div>

        {/* Success State View */}
        {completedResult ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(1, 208, 98, 0.15)',
                border: '1px solid rgba(1, 208, 98, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto',
                color: 'var(--earned-green)',
              }}
            >
              <CheckCircle2 size={32} />
            </div>

            <h3 style={{ fontSize: 20, color: '#fff', margin: '0 0 6px 0', fontFamily: 'var(--fonts--space-grotesk)' }}>
              Rebalance Complete!
            </h3>
            <p style={{ fontSize: 14, color: 'var(--fp-3)', margin: '0 0 20px 0' }}>
              Successfully consolidated <strong>{completedResult.totalMoved} USDC</strong> to Arc Testnet in{' '}
              <span style={{ color: 'var(--purple-1)', fontWeight: 600 }}>{completedResult.timeMs}ms</span>.
            </p>

            <button
              type="button"
              onClick={onClose}
              className="ub-action-btn ub-action-btn-primary"
              style={{ padding: '12px 32px', borderRadius: 99, fontSize: 14 }}
            >
              Back to Pools & Yield
            </button>
          </div>
        ) : (
          <>
            {/* ── Capital Efficiency Header Card ── */}
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(152, 150, 255, 0.12) 0%, rgba(99, 102, 241, 0.08) 100%)',
                border: '1px solid rgba(152, 150, 255, 0.3)',
                borderRadius: 16,
                padding: '16px 20px',
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 14,
              }}
            >
              <div>
                <span style={{ fontSize: 11, color: 'var(--fp-4)', fontFamily: 'var(--font-app)', display: 'block' }}>
                  Capital Efficiency Score
                </span>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: capitalEfficiencyScore >= 80 ? 'var(--earned-green)' : '#fbbf24',
                      fontFamily: 'var(--fonts--space-grotesk)',
                    }}
                  >
                    {capitalEfficiencyScore}%
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--fp-3)' }}>
                    ({totalStakedUsd > 0 ? `$${totalStakedUsd.toFixed(2)} active yield` : 'No active yield'})
                  </span>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 11, color: 'var(--fp-4)', fontFamily: 'var(--font-app)', display: 'block' }}>
                  Idle USDC Across Chains
                </span>
                <span style={{ fontSize: 18, fontWeight: 600, color: '#fff', fontFamily: 'var(--fonts--space-grotesk)' }}>
                  {totalIdleUsdc.toFixed(2)} USDC
                </span>
              </div>
            </div>

            {/* ── Source Chains List ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', fontFamily: 'var(--font-app)' }}>
                  Select Source Chains to Consolidate
                </span>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    onClick={selectAll}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--purple-1)',
                      fontSize: 11,
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Select All
                  </button>
                  <span style={{ color: 'var(--fp-4)' }}>•</span>
                  <button
                    type="button"
                    onClick={deselectAll}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--fp-3)',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxHeight: 220,
                  overflowY: 'auto',
                  background: 'rgba(11, 13, 24, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 14,
                  padding: '10px',
                }}
              >
                {rebalanceableChains.map((c) => {
                  const isChecked = selectedChainKeys.includes(c.chainKey)
                  return (
                    <div
                      key={c.chainKey}
                      onClick={() => toggleChain(c.chainKey)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderRadius: 10,
                        background: isChecked ? 'rgba(152, 150, 255, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                        border: isChecked ? '1px solid rgba(152, 150, 255, 0.3)' : '1px solid transparent',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {}} // Handled by parent div
                          style={{ cursor: 'pointer', accentColor: '#6366f1' }}
                        />
                        <span style={{ fontSize: 13, color: '#fff', fontWeight: 500, fontFamily: 'var(--font-app)' }}>
                          {c.chainName}
                        </span>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: isChecked ? '#fff' : 'var(--fp-3)', fontFamily: 'var(--fonts--space-grotesk)' }}>
                          {c.balanceUsdc} USDC
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--fp-4)', display: 'block' }}>
                          ~{c.depthInfo?.avgSettlementMs || 420}ms speed
                        </span>
                      </div>
                    </div>
                  )
                })}

                {rebalanceableChains.length === 0 && (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--fp-3)', fontSize: 13 }}>
                    No idle USDC found on other chains. All funds are already concentrated or earning yield!
                  </div>
                )}
              </div>
            </div>

            {/* ── Destination Preview Box ── */}
            <div
              style={{
                background: 'rgba(15, 18, 32, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 14,
                padding: '14px 16px',
                marginBottom: 20,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--fp-3)' }}>Destination Network:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <img src={ArcLogo} alt="Arc" style={{ width: 18, height: 18 }} />
                  <strong style={{ color: '#fff', fontSize: 13 }}>Arc Testnet</strong>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--fp-3)' }}>Total Amount to Consolidate:</span>
                <strong style={{ color: 'var(--purple-1)', fontSize: 16, fontFamily: 'var(--fonts--space-grotesk)' }}>
                  {selectedTotalUsdc.toFixed(2)} USDC
                </strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--fp-3)' }}>Est. Annual Yield Boost:</span>
                <strong style={{ color: 'var(--earned-green)', fontSize: 13 }}>
                  +${estYieldBoostUsd.toFixed(2)} / year
                </strong>
              </div>
            </div>

            {/* Error Message */}
            {errorMsg && (
              <div
                style={{
                  padding: '10px 14px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 12,
                  fontSize: 12,
                  color: '#f87171',
                  marginBottom: 16,
                }}
              >
                {errorMsg}
              </div>
            )}

            {/* Rebalance Action Button */}
            <button
              type="button"
              onClick={handleExecute}
              disabled={isProcessing || selectedTotalUsdc <= 0}
              style={{
                width: '100%',
                padding: '14px 0',
                borderRadius: 99,
                border: 'none',
                background:
                  isProcessing || selectedTotalUsdc <= 0
                    ? 'rgba(152, 150, 255, 0.25)'
                    : 'linear-gradient(135deg, #9896ff 0%, #6366f1 100%)',
                color: '#fff',
                fontSize: 14,
                fontFamily: 'var(--font-app)',
                fontWeight: 600,
                cursor: isProcessing || selectedTotalUsdc <= 0 ? 'not-allowed' : 'pointer',
                boxShadow:
                  isProcessing || selectedTotalUsdc <= 0
                    ? 'none'
                    : '0 6px 24px rgba(152, 150, 255, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 0.2s var(--ease-out-smooth)',
              }}
            >
              {isProcessing ? (
                <>
                  <RefreshCw size={15} className="arcis-spin" />
                  <span>CONSOLIDATING VIA GATEWAY (&lt;500MS)...</span>
                </>
              ) : (
                <>
                  <Zap size={16} />
                  <span>REBALANCE ${selectedTotalUsdc.toFixed(2)} TO ARC TESTNET</span>
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
