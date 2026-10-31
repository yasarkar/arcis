import { Clock } from 'lucide-react'
import type { HistoryItem } from '../../utils/history'
import {
  HistoryAmount,
  HistoryChainIcons,
  HistoryHashActions,
  HistoryRecipient,
  HistoryTypeBadge,
} from './HistoryItemCells'
import { formatUtcTime, getRelativeTime } from './historyHelpers'

export interface HistoryCardProps {
  item: HistoryItem
  globalPrivate: boolean
  settings: { maskSymbol: string }
  copiedId?: string | null
  handleCopy?: (txHash: string, itemId: string) => void
  hoveredRecipient: string | null
  setHoveredRecipient: (r: string | null) => void
  timeFormat: 'relative' | 'utc'
  onSelectReceipt: (item: HistoryItem) => void
}

/**
 * Mobile (<sm) rendering of one history row. The desktop table is unreadable at
 * phone widths (six fixed-percentage columns in a horizontal scroller), so this
 * card carries the same information in three stacked rows using the same shared
 * cell primitives as `HistoryTableRow`.
 */
export function HistoryCard({
  item,
  globalPrivate,
  settings,
  hoveredRecipient,
  setHoveredRecipient,
  timeFormat,
  onSelectReceipt,
}: HistoryCardProps) {
  return (
    <article
      className="group rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/20 transition-colors p-3.5"
      style={{ boxShadow: '0 4px 20px -8px rgba(0, 0, 0, 0.5)' }}
    >
      {/* Type + time */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <HistoryTypeBadge item={item} size="sm" />
        </div>
        <div
          className="flex items-center gap-1.5 text-slate-400 shrink-0 select-none"
          style={{ fontFamily: 'var(--font-app)' }}
        >
          <Clock className="w-3 h-3 text-slate-500 shrink-0" />
          <span className="text-[11px]">
            {timeFormat === 'utc' ? formatUtcTime(item.timestamp) : getRelativeTime(item.timestamp)}
          </span>
        </div>
      </div>

      {/* Amount + network */}
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0 truncate text-sm">
          <HistoryAmount item={item} globalPrivate={globalPrivate} maskSymbol={settings.maskSymbol} />
        </div>
        <div className="shrink-0">
          <HistoryChainIcons item={item} />
        </div>
      </div>

      {/* Recipient + hash actions */}
      <div className="mt-2.5 pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center">
          <HistoryRecipient
            item={item}
            globalPrivate={globalPrivate}
            hoveredRecipient={hoveredRecipient}
            setHoveredRecipient={setHoveredRecipient}
          />
        </div>
        <div className="shrink-0">
          <HistoryHashActions
            item={item}
            onSelectReceipt={onSelectReceipt}
          />
        </div>
      </div>
    </article>
  )
}
