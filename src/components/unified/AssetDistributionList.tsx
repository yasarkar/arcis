import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Layers, Plus } from 'lucide-react'
import { ChainIcon } from '../common/ChainIcon'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import { CHAIN_META, getChainDisplayName } from '../../config/chainMeta'
import { getGatewaySupportedNetworks } from '../../config/gatewayConfig'
import type { GatewayBalance } from '../../hooks/useGatewayBalance'
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
 * Stat strip + unified per-chain Gateway balance breakdown.
 * Feeds the 13 official Circle Gateway testnet networks directly from the Master Network Registry.
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

  // 1. Master 13 Gateway networks derived from centralized registry
  const supportedNetworks = useMemo(() => getGatewaySupportedNetworks(), [])

  // 2. Merge all 13 supported networks with live balance responses from Gateway
  const all13Balances = useMemo<GatewayBalance[]>(() => {
    const balanceMap = new Map<string, GatewayBalance>()
    for (const b of balances) {
      balanceMap.set(b.chainKey, b)
    }

    const merged: GatewayBalance[] = supportedNetworks.map((net) => {
      const existing = balanceMap.get(net.key)
      if (existing) {
        balanceMap.delete(net.key)
        return {
          ...existing,
          name: net.name || existing.name,
        }
      }
      return {
        domain: net.cctpDomain ?? 0,
        chainKey: net.key,
        name: net.name,
        chainName: net.name,
        balance: '0.00',
        status: 'success' as const,
      }
    })

    // Include any remaining custom rows from test fixtures
    for (const remaining of balanceMap.values()) {
      merged.push(remaining)
    }

    return merged
  }, [supportedNetworks, balances])

  // 3. Sort balances: chains with active funds first (descending), then 0-balance chains (Arc prioritized)
  const sortedBalances = useMemo(() => {
    return [...all13Balances].sort((a, b) => {
      const balA = Number.parseFloat(a.balance || '0')
      const balB = Number.parseFloat(b.balance || '0')
      if (balB !== balA) return balB - balA
      if (a.chainKey === 'Arc_Testnet') return -1
      if (b.chainKey === 'Arc_Testnet') return 1
      return a.name.localeCompare(b.name)
    })
  }, [all13Balances])

  const activeChains = sortedBalances.filter(
    (b) => Number.parseFloat(b.balance) > 0 && b.status === 'success'
  ).length

  const topChain = sortedBalances.find(
    (b) => Number.parseFloat(b.balance) > 0 && b.status === 'success'
  )

  const visibleBalances = showAll ? sortedBalances : sortedBalances.slice(0, INITIAL_SHOW)
  const hasMore = sortedBalances.length > INITIAL_SHOW
  const showSkeleton = Boolean(walletAddress) && loading && balances.length === 0

  return (
    <>
      {/* ── STAT STRIP (AAVE 3-COLUMN GLASS PILL) ── */}
      {walletAddress && (
        <div className="ub-stat-strip">
          <div className="ub-stat-item">
            <div className="ub-stat-label">Total Chains</div>
            <div className="ub-stat-value">{supportedNetworks.length}</div>
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
                  <ChainIcon
                    chainKeyOrIconId={topChain.chainKey}
                    name={topChain.name || getChainDisplayName(topChain.chainKey)}
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
            <Layers size={18} style={{ color: 'var(--purple-1)' }} aria-hidden="true" />
            <span className="arc-eyebrow" style={{ fontSize: 15, color: 'var(--base-colors--white)', fontWeight: 600 }}>
              ASSET DISTRIBUTION
            </span>
          </div>

          {walletAddress && (
            <span style={{ fontSize: 12, color: 'var(--fp-3)', fontFamily: 'var(--font-app)', fontWeight: 500 }}>
              {activeChains} of {supportedNetworks.length} chains funded
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

          {!showSkeleton && walletAddress && hasError && activeChains === 0 && (
            <div className="ub-empty-state" style={{ padding: '24px 0', textAlign: 'center' }}>
              <AlertTriangle size={24} style={{ color: '#f87171', marginBottom: 8 }} aria-hidden="true" />
              <p style={{ color: 'var(--fp-3)', fontSize: 13, fontFamily: 'var(--font-app)', margin: 0 }}>
                Gateway balance breakdown is temporarily unavailable. Your funds are safe; retry the live sync above.
              </p>
            </div>
          )}

          {!showSkeleton && walletAddress && !hasError && activeChains === 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                marginBottom: 16,
                background: 'rgba(152, 150, 255, 0.06)',
                border: '1px solid rgba(152, 150, 255, 0.15)',
                borderRadius: 12,
                fontSize: 12,
                color: 'var(--fp-3)',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <span>No active Gateway deposits yet. You can deposit USDC from any of the {supportedNetworks.length} supported networks below.</span>
              <button
                type="button"
                onClick={onDeposit}
                className="ub-action-btn"
                style={{ padding: '4px 10px', fontSize: 11, borderRadius: 99, flexShrink: 0 }}
              >
                <Plus size={11} aria-hidden="true" />
                <span>Deposit USDC</span>
              </button>
            </div>
          )}

          {!showSkeleton && walletAddress && visibleBalances.map((item) => {
            const meta = CHAIN_META[item.chainKey] || { iconId: 'ethereum', color: '#64748b', gradient: 'linear-gradient(135deg, #64748b, #475569)' }
            const balance = Number.parseFloat(item.balance || '0')
            const pct = total > 0 ? (balance / total) * 100 : 0
            const pending = pendingByChain?.[item.chainKey]
            const isZero = balance <= 0

            return (
              <div key={item.chainKey} className="ub-asset-row">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                    <div className="ub-chain-icon" style={{ opacity: isZero ? 0.75 : 1 }}>
                      <ChainIcon
                        chainKeyOrIconId={item.chainKey}
                        name={item.name || getChainDisplayName(item.chainKey)}
                        size={36}
                        className="rounded-full overflow-hidden"
                      />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <span style={{ fontFamily: 'var(--font-app)', fontSize: 14, fontWeight: 500, color: isZero ? 'var(--fp-2)' : 'var(--base-colors--white)', display: 'block', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                          <span style={{ fontFamily: 'var(--fonts--space-grotesk)', fontSize: 16, fontWeight: 600, color: isZero ? 'var(--fp-3)' : '#fff', fontVariantNumeric: 'tabular-nums' }}>
                            {formatUsdcAmount(balance)}
                          </span>
                          <img src={UsdcIcon} alt="USDC" style={{ height: '16px', width: 'auto', display: 'block', opacity: isZero ? 0.5 : 1 }} />
                        </div>
                        <span
                          className="ub-pct-badge"
                          style={{
                            opacity: isZero ? 0.45 : 1,
                            background: isZero ? 'rgba(255, 255, 255, 0.04)' : undefined,
                            borderColor: isZero ? 'rgba(255, 255, 255, 0.08)' : undefined,
                            color: isZero ? 'var(--fp-3)' : undefined,
                          }}
                        >
                          {formatPercent(pct)}
                        </span>
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

          {!walletAddress && (
            <div className="ub-empty-state" style={{ padding: '36px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }} aria-hidden="true">⬡</div>
              <p style={{ color: 'var(--fp-3)', fontSize: 13, fontFamily: 'var(--font-app)', margin: 0 }}>
                Connect wallet to view balances
              </p>
            </div>
          )}

          {hasMore && !showSkeleton && walletAddress && (
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
