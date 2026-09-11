// Interactive Cross-Chain Liquidity Rebalance Wizard for Arcis.
// Scans idle USDC across 12+ networks and aggregates funds into Arc Testnet via Circle Gateway in <500ms.
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Zap,
  CheckCircle2,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import { getChainIconId } from '../../config/chainMeta'
import { useGatewayBalancer } from '../../hooks/useGatewayBalancer'

interface GatewayRebalanceWizardProps {
  isOpen: boolean
  onClose: () => void
  walletAddress: string
  totalStakedUsd: number
  onSuccess?: (totalMoved: string, txHash?: string, explorerUrl?: string) => void
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
    consolidatedChains,
    totalIdleUsdc,
    capitalEfficiencyScore,
    executeRebalance,
    resetConsolidatedLedger,
    refreshAll,
  } = useGatewayBalancer(walletAddress, totalStakedUsd)

  const [selectedChainKeys, setSelectedChainKeys] = useState<string[]>(() =>
    rebalanceableChains.map((c) => c.chainKey)
  )
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successNotice, setSuccessNotice] = useState<{
    totalMoved: string
    timeMs: number
    txHash: string
    explorerUrl?: string
  } | null>(null)

  // Keep selected chains synchronized when balances update
  useEffect(() => {
    setSelectedChainKeys((prev) => {
      const validKeys = rebalanceableChains.map((c) => c.chainKey)
      return prev.filter((k) => validKeys.includes(k))
    })
  }, [rebalanceableChains])

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
      const explorerUrl = res.explorerUrl || `https://testnet.arcscan.app/tx/${res.txHash}`
      setSuccessNotice({
        totalMoved: res.totalMovedUsdc,
        timeMs: res.executionTimeMs,
        txHash: res.txHash,
        explorerUrl,
      })
      if (refreshAll) refreshAll()
      if (onSuccess) onSuccess(res.totalMovedUsdc, res.txHash, explorerUrl)
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
      className="fixed inset-0 z-[999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
      style={{
        background: 'rgba(5, 7, 15, 0.78)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) onClose()
      }}
    >
      <div
        className="relative w-full max-w-[640px] my-auto rounded-3xl overflow-hidden shadow-2xl transition-all border animate-in fade-in zoom-in-95 duration-200"
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
          disabled={isProcessing}
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

        {/* Success Feedback Banner */}
        {successNotice && (
          <div
            style={{
              padding: '14px 16px',
              background: 'linear-gradient(135deg, rgba(1, 208, 98, 0.14) 0%, rgba(16, 185, 129, 0.08) 100%)',
              border: '1px solid rgba(1, 208, 98, 0.38)',
              borderRadius: 16,
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  background: 'rgba(1, 208, 98, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--earned-green)',
                  flexShrink: 0,
                }}
              >
                <CheckCircle2 size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, color: '#fff', fontWeight: 600, display: 'block' }}>
                  Rebalanced {successNotice.totalMoved} USDC to Arc Testnet ({successNotice.timeMs}ms)
                </span>
                {successNotice.txHash && (
                  <a
                    href={successNotice.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 11,
                      color: 'var(--purple-1)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      textDecoration: 'underline',
                      marginTop: 2,
                    }}
                  >
                    <span>View on ArcScan: {successNotice.txHash.slice(0, 8)}...{successNotice.txHash.slice(-6)}</span>
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSuccessNotice(null)}
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '50%',
                width: 26,
                height: 26,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--fp-3)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
              title="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        )}
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
                    ({totalStakedUsd > 0 ? `${totalStakedUsd.toFixed(2)} active yield` : 'No active yield'})
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
                  Select Chain to Consolidate
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
                        <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                          <NetworkIcon
                            name={getChainIconId(c.chainKey)}
                            variant={getChainIconId(c.chainKey) === 'solana' ? 'branded' : 'background'}
                            size={20}
                            className="rounded-full"
                          />
                        </div>
                        <span style={{ fontSize: 13, color: isChecked ? '#fff' : 'var(--fp-3)', fontWeight: isChecked ? 600 : 500, fontFamily: 'var(--font-app)', transition: 'all 0.15s ease' }}>
                          {c.chainName}
                        </span>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: isChecked ? '#fff' : 'var(--fp-3)', fontFamily: 'var(--fonts--space-grotesk)' }}>
                          {c.balanceUsdc} USDC
                        </span>
                      </div>
                    </div>
                  )
                })}

                {rebalanceableChains.length === 0 && (
                  <div
                    style={{
                      padding: '24px 16px',
                      textAlign: 'center',
                      background: 'rgba(34, 197, 94, 0.04)',
                      border: '1px dashed rgba(34, 197, 94, 0.25)',
                      borderRadius: 12,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                      <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(34, 197, 94, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <CheckCircle2 size={20} style={{ color: '#4ade80' }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 4 }}>
                      All External Funds Consolidated!
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--fp-3)' }}>
                      No remaining idle USDC detected on external testnets. Your liquidity is concentrated on Arc Testnet.
                    </div>
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
                  <div className="w-[18px] h-[18px] rounded-full overflow-hidden flex items-center justify-center shrink-0">
                    <NetworkIcon
                      name={getChainIconId('Arc_Testnet')}
                      variant="background"
                      size={18}
                      className="rounded-full"
                    />
                  </div>
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
                  isProcessing
                    ? 'rgba(152, 150, 255, 0.25)'
                    : selectedTotalUsdc <= 0
                    ? 'rgba(255, 255, 255, 0.08)'
                    : 'linear-gradient(135deg, #9896ff 0%, #6366f1 100%)',
                color: isProcessing ? '#fff' : selectedTotalUsdc <= 0 ? 'var(--fp-3)' : '#fff',
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
              ) : selectedTotalUsdc <= 0 ? (
                <>
                  <CheckCircle2 size={16} style={{ color: consolidatedChains.length > 0 ? '#4ade80' : 'var(--fp-3)' }} />
                  <span>{consolidatedChains.length > 0 ? 'ALL NETWORKS CONSOLIDATED' : 'NO IDLE FUNDS TO REBALANCE'}</span>
                </>
              ) : (
                <>
                  <Zap size={16} />
                  <span>REBALANCE</span>
                </>
              )}
            </button>
      </div>
    </div>,
    document.body
  )
}
