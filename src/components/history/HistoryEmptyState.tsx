import { Clock, RotateCcw, Wallet } from 'lucide-react'

export interface HistoryEmptyStateProps {
  activeWalletAddress: string
  historyLength: number
  hasActiveFilters: boolean
  fetchError: string | null
  onClearFilters: () => void
  onRetry: () => void
  /** Opens the wallet connect flow. Omitted callers simply get no connect action. */
  onConnectWallet?: () => void
}

/**
 * Shared empty/error panel. The four cases are deliberately distinct — no wallet,
 * unreadable server, no records for this wallet, and filters that matched nothing —
 * because "no transactions" is a very different message from "we could not load it".
 * Each case gets its own heading and its own action: Connect wallet / Retry /
 * Clear filters.
 */
export function HistoryEmptyState({
  activeWalletAddress,
  historyLength,
  hasActiveFilters,
  fetchError,
  onClearFilters,
  onRetry,
  onConnectWallet,
}: HistoryEmptyStateProps) {
  const loadFailed = Boolean(fetchError) && historyLength === 0
  const needsWallet = !activeWalletAddress
  const noRecords = Boolean(activeWalletAddress) && historyLength === 0
  const filteredEmpty = Boolean(activeWalletAddress) && historyLength > 0 && hasActiveFilters

  const heading = needsWallet
    ? 'CONNECT WALLET'
    : loadFailed
    ? 'HISTORY UNAVAILABLE'
    : noRecords
    ? 'NO TRANSACTIONS'
    : 'NO MATCHES'

  return (
    <div className="flex flex-col items-center justify-center text-center p-6 min-h-[220px]">
      <Clock className="w-10 h-10 text-slate-600 mb-3" />
      <h4 className="text-sm font-semibold text-slate-300" style={{ fontFamily: 'var(--font-app)' }}>
        {heading}
      </h4>
      <p className="text-xs text-slate-500 max-w-sm mt-1" style={{ fontFamily: 'var(--font-app)' }}>
        {!activeWalletAddress
          ? 'Transactions initiated on this client (Send, Swap, or Cross-chain Bridge) will show up here. Connect your wallet to view your history.'
          : loadFailed
          ? 'Your transaction history could not be loaded. Check your connection and try again.'
          : historyLength === 0
          ? `No completed transactions for ${activeWalletAddress.slice(0, 6)}...${activeWalletAddress.slice(-4)} yet. Settled Send, Swap or Bridge activity will appear here.`
          : 'No transactions match the selected filters.'}
      </p>

      {needsWallet && onConnectWallet && (
        <button
          type="button"
          onClick={onConnectWallet}
          className="ub-action-btn ub-action-btn-primary mt-3.5 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold"
        >
          <Wallet className="w-3.5 h-3.5" />
          <span>Connect Wallet</span>
        </button>
      )}

      {loadFailed && activeWalletAddress && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono text-rose-200 hover:text-white bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 hover:border-rose-500/40 transition-all cursor-pointer shadow-sm"
        >
          <RotateCcw className="w-3 h-3 text-rose-300" />
          <span>Retry</span>
        </button>
      )}

      {filteredEmpty && (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono text-indigo-300 hover:text-white bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 hover:border-indigo-500/40 transition-all cursor-pointer shadow-sm"
        >
          <RotateCcw className="w-3 h-3 text-indigo-400" />
          <span>Clear Active Filters</span>
        </button>
      )}
    </div>
  )
}
