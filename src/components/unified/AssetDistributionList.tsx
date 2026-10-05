import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Layers, Plus } from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import { CHAIN_META, getChainDisplayName } from '../../config/chainMeta'
import type { GatewayBalance } from '../../hooks/useGatewayBalance'
import { sortGatewayBalances } from '../../utils/depositFlow'
import { formatPercent, formatUsdcAmount } from '../../utils/formatNumber'

const INITIAL_SHOW = 6

interface AssetDistributionListProps {
  balances: GatewayBalance[]
  total: number
  loading: boolean
  hasError: boolean
  walletAddress: string
  /** Pending (not yet indexed) amounts keyed by originating chain. */
  pendingByChain?: Record<string, number>
  onDeposit: () => void
}

/**
 * Stat strip + per-chain Gateway balance breakdown.
 * While the first Gateway response is in flight a skeleton list is rendered instead of a
 * misleading "no deposits" state; on error, stale data is shown honestly.
 */
export default function AssetDistributionList({
  balances,
  total,
  loading,
  hasError,
  walletAddress,
  pendingByChain,
  onDeposit,
}: AssetDistributionListProps) {
  const [showAll, setShowAll] = useState(false)

  const sortedBalances = useMemo(() => sortGatewayBalances(balances), [balances])
  const activeChains = sortedBalances.filter(
    (b) => Number.parseFloat(b.balance) > 0 && b.status === 'success'
  ).length
  const topChain = sortedBalances.find(
    (b) => Number.parseFloat(b.balance) > 0 && b.status === 'success'
  )
  const visibleBalances = showAll ? sortedBalances : sortedBalances.slice(0, INITIAL_SHOW)
  const hasMore = sortedBalances.length > INITIAL_SHOW
  const showSkeleton = Boolean(walletAddress) && loading && sortedBalances.length === 0

  return (
    <>
      {/* ── STAT STRIP (AAVE 3-COLUMN GLASS PILL) ── */}
      {walletAddress && (
        <div className="ub-stat-strip">
          <div className="ub-stat-item">
            <div className="ub-stat-label">Total Chains</div>
            <div className="ub-stat-value">{sortedBalances.length}</div>
          </div>
          <div className="ub-stat-item">
            <div className="ub-stat-label">Active Deposits</div>
            <div className="ub-stat-value">{activeChains}</div>
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
                  <span>{topChain.name || getChainDisplayName(topChain.chainKey)}</span>
                </>
              ) : '—'}
            </div>
          </div>
        </div>
      )}

      {/* ── ASSET DISTRIBUTION (AAVE SQUIRCLE CARD) ── */}
      <div className="ub-asset-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 12 }}>
            <Layers size={16} style={{ color: 'var(--purple-1)' }} aria-hidden="true" />
            <span className="arc-eyebrow" style={{ fontSize: 15, color: 'var(--base-colors--white)', fontWeight: 600 }}>
              ASSET DISTRIBUTION
            </span>
          </div>

          {walletAddress && (
            <span style={{ fontSize: 12, color: 'var(--fp-3)', fontFamily: 'var(--font-app)', fontWeight: 500 }}>
              {activeChains} of {sortedBalances.length} chains funded
            </span>
          )}
        </div>

        <div>
          {showSkeleton && (
            <>
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={`ub-skeleton-${index}`} className="ub-asset-row" aria-hidden="true">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div className="ub-skeleton" style={{ width: 36, height: 36, borderRadius: '50%' }} />
                      <div className="ub-skeleton" style={{ width: 110, height: 16 }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className="ub-skeleton" style={{ width: 72, height: 20 }} />
                      <div className="ub-skeleton" style={{ width: 44, height: 20, borderRadius: 99 }} />
                    </div>
                  </div>
                  <div className="ub-progress-track">
                    <div className="ub-skeleton" style={{ width: '60%', height: '100%', borderRadius: 99 }} />
                  </div>
                </div>
              ))}
              <span className="sr-only" role="status">Loading Gateway balances</span>
            </>
          )}

          {!showSkeleton && visibleBalances.map((item) => {
            const meta = CHAIN_META[item.chainKey] || { iconId: 'ethereum', color: '#64748b', gradient: 'linear-gradient(135deg, #64748b, #475569)' }
            const balance = Number.parseFloat(item.balance)
            const pct = total > 0 ? (balance / total) * 100 : 0
            const pending = pendingByChain?.[item.chainKey]

            return (
              <div key={item.chainKey} className="ub-asset-row">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                    <div className="ub-chain-icon">
                      <NetworkIcon
                        name={meta.iconId}
                        variant={meta.iconId === 'solana' ? 'branded' : 'background'}
                        size={36}
                        className="rounded-full overflow-hidden"
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontFamily: 'var(--font-app)', fontSize: 14, fontWeight: 500, color: 'var(--base-colors--white)', display: 'block', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.name || getChainDisplayName(item.chainKey)}
                      </span>
                      {pending ? (
                        <span
                          className="ub-pending-badge"
                          style={{ marginTop: 4 }}
                          title="Circle Gateway is still indexing this deposit."
                        >
                          +{formatUsdcAmount(pending)} PENDING
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {item.status === 'success' && (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'var(--fonts--space-grotesk)', fontSize: 16, fontWeight: 600, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                            {formatUsdcAmount(balance)}
                          </span>
                          <img src={UsdcIcon} alt="USDC" style={{ height: '16px', width: 'auto', display: 'block' }} />
                        </div>
                        <span className="ub-pct-badge">{formatPercent(pct)}</span>
                      </>
                    )}
                  </div>
                </div>

                {item.status === 'success' && (
                  <div className="ub-progress-track" role="presentation">
                    <div className="ub-progress-fill" style={{ width: `${pct}%`, background: meta.gradient }} />
                  </div>
                )}
              </div>
            )
          })}

          {!showSkeleton && walletAddress && hasError && sortedBalances.length === 0 && (
            <div className="ub-empty-state" style={{ padding: '36px 0', textAlign: 'center' }}>
              <AlertTriangle size={28} style={{ color: '#f87171', marginBottom: 8 }} aria-hidden="true" />
              <p style={{ color: 'var(--fp-3)', fontSize: 13, fontFamily: 'var(--font-app)', margin: 0 }}>
                Gateway balance breakdown is temporarily unavailable. Your funds are safe; retry the live sync above.
              </p>
            </div>
          )}

          {!showSkeleton && walletAddress && !hasError && sortedBalances.length === 0 && (
            <div className="ub-empty-state" style={{ padding: '36px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }} aria-hidden="true">⬡</div>
              <p style={{ color: 'var(--fp-3)', fontSize: 13, fontFamily: 'var(--font-app)', marginBottom: 14 }}>
                No Gateway deposits found yet.
              </p>
              <button type="button" onClick={onDeposit} className="ub-action-btn" style={{ margin: '0 auto' }}>
                <Plus size={13} aria-hidden="true" />
                <span>Deposit USDC</span>
              </button>
            </div>
          )}

          {!walletAddress && (
            <div className="ub-empty-state" style={{ padding: '36px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }} aria-hidden="true">⬡</div>
              <p style={{ color: 'var(--fp-3)', fontSize: 13, fontFamily: 'var(--font-app)', margin: 0 }}>
                Connect wallet to view balances
              </p>
            </div>
          )}

          {hasMore && !showSkeleton && (
            <div style={{ paddingTop: 16, textAlign: 'center' }}>
              <button
                type="button"
                onClick={() => setShowAll(prev => !prev)}
                aria-expanded={showAll}
                className="ub-action-btn"
                style={{ width: '100%', justifyContent: 'center', borderRadius: 99, padding: '10px 0' }}
              >
                <span>{showAll ? 'SHOW LESS' : `SHOW ALL (${sortedBalances.length})`}</span>
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  style={{ transition: 'transform 0.3s var(--ease-out-smooth)', transform: showAll ? 'rotate(180deg)' : 'rotate(0deg)' }}
                />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
