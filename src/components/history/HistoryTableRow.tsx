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

export interface HistoryTableRowProps {
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

export function HistoryTableRow({
  item,
  globalPrivate,
  settings,
  hoveredRecipient,
  setHoveredRecipient,
  timeFormat,
  onSelectReceipt,
}: HistoryTableRowProps) {
  return (
    <tr className="hover:bg-white/[0.04] transition-colors group h-[52px]">
      {/* Tx Hash */}
      <td className="w-[18%] px-3 py-3 text-center">
        <div className="flex items-center justify-center">
          <HistoryHashActions
            item={item}
            onSelectReceipt={onSelectReceipt}
          />
        </div>
      </td>

      {/* Network */}
      <td className="w-[13%] px-3 py-2 text-center">
        <div className="flex items-center justify-center">
          <HistoryChainIcons item={item} />
        </div>
      </td>

      {/* Type */}
      <td className="w-[16%] px-3 py-3 text-center">
        <div className="flex items-center justify-center gap-2">
          <HistoryTypeBadge item={item} />
        </div>
      </td>

      {/* Amount / Detail */}
      <td className="w-[20%] px-3 py-3 text-center truncate">
        <div className="flex items-center justify-center">
          <HistoryAmount item={item} globalPrivate={globalPrivate} maskSymbol={settings.maskSymbol} />
        </div>
      </td>

      {/* Recipient */}
      <td className="w-[17%] px-3 py-3 text-center truncate">
        <div className="flex items-center justify-center">
          <HistoryRecipient
            item={item}
            globalPrivate={globalPrivate}
            hoveredRecipient={hoveredRecipient}
            setHoveredRecipient={setHoveredRecipient}
          />
        </div>
      </td>

      {/* Time */}
      <td className="w-[16%] px-3 py-3 text-slate-400 text-center" style={{ fontFamily: 'var(--font-app)' }}>
        <div className="flex items-center justify-center gap-1.5 select-none">
          <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-slate-400 text-xs">
            {timeFormat === 'utc' ? formatUtcTime(item.timestamp) : getRelativeTime(item.timestamp)}
          </span>
        </div>
      </td>
    </tr>
  )
}
