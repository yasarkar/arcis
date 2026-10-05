import { useCallback, useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { AlertTriangle, Check, Plus, RefreshCw, X } from 'lucide-react'

import { useGatewayBalance } from '../hooks/useGatewayBalance'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { UnifiedSuccessReceipt } from './fintech/UnifiedSuccessReceipt'
import DepositPanel, {
  type EvmConnectorLike,
  type SendModularUserOpFn,
  type ExecuteUcwContractFn,
} from './unified/DepositPanel'
import AssetDistributionList from './unified/AssetDistributionList'

import { addTransaction } from '../utils/history'
import { getOptimisticDelta, recordOptimisticDelta } from '../services/optimisticGatewayTracker'
import { buildDepositHistoryEntry, formatDepositFee, type DepositOutcome } from '../utils/depositFlow'
import { formatUsdcAmount } from '../utils/formatNumber'
import { GATEWAY_SUPPORTED_CHAINS } from '../config/gatewayConfig'
import { getExplorerTxUrl } from '../config/sendConfig'
import { getChainIconId } from '../config/chainMeta'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'

// ── Props ────────────────────────────────────────────────────────────────────
interface UnifiedBalanceProps {
  connector?: EvmConnectorLike
  connectedAddress?: string
  activeAuthSource?: 'passkey' | 'ucw' | 'evm' | null
  sendModularUserOp?: SendModularUserOpFn
  executeUcwContract?: ExecuteUcwContractFn
  walletConnected?: boolean
}

const SYNC_FEEDBACK_MS = 1800

// ── Component ────────────────────────────────────────────────────────────────
export default function UnifiedBalance({
  connector,
  connectedAddress,
  activeAuthSource,
  sendModularUserOp,
  executeUcwContract,
  walletConnected,
}: UnifiedBalanceProps) {
  const { address } = useAccount()
  const walletAddress = connectedAddress || address || ''

  const {
    balances,
    loading,
    hasData: gatewayHasData,
    error,
    totalBalance,
    refresh,
    dataUpdatedAt: gatewayDataUpdatedAt,
    pendingDelta,
    pendingByChain,
  } = useGatewayBalance(walletAddress)

  const [showDeposit, setShowDeposit] = useState(false)
  const [depositReceipt, setDepositReceipt] = useState<DepositOutcome | null>(null)
  const [isManualSyncing, setIsManualSyncing] = useState(false)
  const [syncSucceeded, setSyncSucceeded] = useState(false)

  const showDepositRef = useRef(showDeposit)
  const wasDepositOpenRef = useRef(false)
  const depositTriggerRef = useRef<HTMLButtonElement>(null)
  const syncFeedbackTimer = useRef<number | null>(null)

  // Wallet balances are only needed by the deposit form: fetch lazily, USDC only.
  const {
    walletBalances,
    loading: walletLoading,
    isFetching: isWalletFetching,
    hasData: walletBalancesReady,
    refetch: refetchWalletBalances,
    invalidate: invalidateWalletBalances,
  } = useWalletTestnetBalances(walletAddress, { tokens: ['USDC'], enabled: showDeposit })

  const total = Number.parseFloat(totalBalance)
  const isSyncing = loading || isManualSyncing
  const gatewayError = walletAddress ? error : null

  useEffect(() => {
    showDepositRef.current = showDeposit
  }, [showDeposit])

  // Couple the deposit form's wallet balances to the Gateway poll (10s): refresh them right after
  // each successful Gateway fetch, but only while the panel is open so no background RPC load occurs.
  useEffect(() => {
    if (!walletAddress || !gatewayDataUpdatedAt) return
    if (!showDepositRef.current) return
    void refetchWalletBalances()
  }, [gatewayDataUpdatedAt, walletAddress, refetchWalletBalances])

  useEffect(() => () => {
    if (syncFeedbackTimer.current !== null) {
      window.clearTimeout(syncFeedbackTimer.current)
    }
  }, [])

  // Close the deposit panel / receipt when the active wallet changes to avoid cross-wallet leakage.
  useEffect(() => {
    setShowDeposit(false)
    setDepositReceipt(null)
  }, [walletAddress])

  // Return keyboard focus to the deposit trigger after the panel closes.
  useEffect(() => {
    if (showDeposit) {
      wasDepositOpenRef.current = true
    } else if (wasDepositOpenRef.current) {
      wasDepositOpenRef.current = false
      depositTriggerRef.current?.focus()
    }
  }, [showDeposit])

  const handleSyncAll = useCallback(async () => {
    if (isSyncing) return
    setIsManualSyncing(true)
    try {
      await Promise.allSettled([
        refresh(),
        showDepositRef.current ? refetchWalletBalances() : Promise.resolve(),
      ])
      setSyncSucceeded(true)
      if (syncFeedbackTimer.current !== null) {
        window.clearTimeout(syncFeedbackTimer.current)
      }
      syncFeedbackTimer.current = window.setTimeout(() => {
        setSyncSucceeded(false)
        syncFeedbackTimer.current = null
      }, SYNC_FEEDBACK_MS)
    } finally {
      setIsManualSyncing(false)
    }
  }, [isSyncing, refresh, refetchWalletBalances])

  const handleDepositSuccess = useCallback((outcome: DepositOutcome) => {
    // Persist the deposit so it appears in the History tab and receipt modal.
    addTransaction(buildDepositHistoryEntry(outcome, walletAddress))

    // Optimistic delta bridges the ~20-30s Circle Gateway indexer lag so the total updates instantly.
    const displayedTotal = Number.parseFloat(totalBalance)
    const amountValue = Number.parseFloat(outcome.amount)
    if (walletAddress && Number.isFinite(displayedTotal) && Number.isFinite(amountValue)) {
      const activeDelta = getOptimisticDelta(walletAddress)
      const baselineRaw = Math.max(0, displayedTotal - activeDelta)
      recordOptimisticDelta(walletAddress, amountValue, baselineRaw, { chainKey: outcome.chainKey })
    }

    // Wallet balances are stale after a deposit; mark them for the next panel open.
    invalidateWalletBalances()

    setDepositReceipt(outcome)
    setShowDeposit(false)
    void refresh()
  }, [walletAddress, totalBalance, refresh, invalidateWalletBalances])

  const handleDepositAgain = useCallback(() => {
    setDepositReceipt(null)
    setShowDeposit(true)
  }, [])

  const handleToggleDeposit = useCallback(() => {
    if (!showDeposit) setDepositReceipt(null)
    setShowDeposit(!showDeposit)
  }, [showDeposit])

  const showBalanceSkeleton = Boolean(walletAddress) && loading && !gatewayHasData
  const displayBalance =
    !walletAddress || (gatewayError && !gatewayHasData) ? '—' : formatUsdcAmount(total)

  return (
    <div
      className="ub-screen"
      style={{
        maxWidth: 900,
        width: '100%',
        margin: '0 auto',
        padding: '24px 16px 80px',
        animation: 'arc-reveal 0.35s var(--ease-out-smooth)',
      }}
    >
      {/* Hero card: unified total, live indicator and deposit / sync quick actions. */}
      <div className="ub-hero-card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="arc-eyebrow" style={{ fontSize: 18, color: 'var(--base-colors--white)', fontWeight: 600 }}>
              UNIFIED BALANCE
            </span>
            <span className="ub-live-badge" title="Live Gateway balance, refreshed automatically every 10 seconds" aria-hidden="true">
              <svg className="ub-ecg-svg" viewBox="0 0 35 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 8h10l3-5 4 13 4-15 4 10 3-3h10" className="ub-ecg-path-bg" />
                <path d="M0 8h10l3-5 4 13 4-15 4 10 3-3h10" className="ub-ecg-path-pulse" />
              </svg>
            </span>
            {walletAddress && pendingDelta > 0 && (
              <span
                className="ub-pending-badge"
                title={`Circle Gateway is still indexing ${formatUsdcAmount(pendingDelta)} USDC. This usually takes 20–30 seconds.`}
              >
                +{formatUsdcAmount(pendingDelta)} PENDING
              </span>
            )}
          </div>

          {walletAddress && (
            <div className="ub-quick-actions">
              <button
                ref={depositTriggerRef}
                type="button"
                onClick={handleToggleDeposit}
                aria-expanded={showDeposit}
                aria-controls="ub-deposit-panel"
                className={`ub-action-btn ${showDeposit ? 'ub-action-btn-primary' : ''}`}
              >
                {showDeposit ? <X size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
                <span>{showDeposit ? 'Close' : 'Deposit'}</span>
              </button>

              <button
                type="button"
                onClick={handleSyncAll}
                disabled={isSyncing}
                className="ub-action-btn"
                aria-label={syncSucceeded ? 'Balances synced' : 'Sync balances'}
                title={syncSucceeded ? 'Balances synced' : 'Sync balances'}
                style={{
                  opacity: isSyncing ? 0.6 : 1,
                  cursor: isSyncing ? 'not-allowed' : 'pointer',
                }}
              >
                {syncSucceeded ? (
                  <Check size={13} style={{ color: 'var(--earned-green)' }} aria-hidden="true" />
                ) : (
                  <RefreshCw size={13} className={`sync-icon ${isSyncing ? 'arcis-spin' : ''}`} aria-hidden="true" />
                )}
              </button>
            </div>
          )}
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
            {showBalanceSkeleton ? (
              <span
                className="ub-skeleton"
                style={{ width: 'clamp(160px, 28vw, 260px)', height: '0.85em', borderRadius: 14 }}
                role="status"
                aria-label="Loading unified balance"
              />
            ) : (
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{displayBalance}</span>
            )}
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
            Unified cross-chain USDC balance instantly spendable across {GATEWAY_SUPPORTED_CHAINS.length} networks via Circle Gateway.
          </p>
        </div>
      </div>

      {gatewayError && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            marginBottom: 24,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            borderRadius: 12,
            fontSize: 12,
            color: '#f87171',
            fontFamily: 'var(--font-app)',
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} aria-hidden="true" />
          <span>
            {gatewayHasData
              ? 'Live Gateway refresh failed. Showing last known balances.'
              : 'Gateway balances could not be loaded. Check your connection and retry.'}
          </span>
          <button
            type="button"
            onClick={handleSyncAll}
            disabled={isSyncing}
            className="ub-action-btn"
            style={{ marginLeft: 'auto', flexShrink: 0 }}
          >
            <RefreshCw size={12} className={isSyncing ? 'arcis-spin' : ''} aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {depositReceipt && (
        <div className="ub-asset-card" style={{ marginBottom: 24, animation: 'arc-reveal 0.3s var(--ease-out-smooth)' }}>
          <UnifiedSuccessReceipt
            type="deposit"
            subtitle="USDC deposited into your Gateway unified balance via Circle Gateway"
            method="Circle Gateway Deposit"
            amount={depositReceipt.amount}
            tokenSymbol="USDC"
            network={depositReceipt.chainKey}
            networkIconId={getChainIconId(depositReceipt.chainKey)}
            txHash={depositReceipt.txHash || undefined}
            explorerUrl={
              depositReceipt.txHash
                ? getExplorerTxUrl(depositReceipt.chainKey, depositReceipt.txHash)
                : undefined
            }
            networkFee={formatDepositFee(depositReceipt.networkFee) || undefined}
            approvalFee={formatDepositFee(depositReceipt.approvalFee) || undefined}
            feeSponsored={Boolean(depositReceipt.feeSponsored && !depositReceipt.networkFee)}
            isInline
            onActionAgain={handleDepositAgain}
            onClose={() => setDepositReceipt(null)}
          />
        </div>
      )}

      {showDeposit && walletAddress && (
        <DepositPanel
          walletAddress={walletAddress}
          connector={connector}
          walletConnected={walletConnected}
          activeAuthSource={activeAuthSource}
          sendModularUserOp={sendModularUserOp}
          executeUcwContract={executeUcwContract}
          walletBalances={walletBalances}
          walletBalancesLoading={walletLoading}
          walletBalancesFetching={isWalletFetching}
          walletBalancesReady={walletBalancesReady}
          onRefetchWalletBalances={refetchWalletBalances}
          onClose={() => setShowDeposit(false)}
          onSuccess={handleDepositSuccess}
        />
      )}

      <AssetDistributionList
        balances={balances}
        total={total}
        loading={loading}
        hasError={Boolean(gatewayError)}
        walletAddress={walletAddress}
        pendingByChain={pendingByChain}
        onDeposit={() => setShowDeposit(true)}
      />
    </div>
  )
}
