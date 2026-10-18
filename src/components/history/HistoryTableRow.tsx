import React from 'react'
import {
  ExternalLink,
  Copy,
  Check,
  FileText,
  ArrowUpRight,
  ArrowRightLeft,
  Globe,
  ArrowDownToLine,
  Bot,
  PlusCircle,
  MinusCircle,
  Coins,
  Clock,
} from 'lucide-react'
import type { HistoryItem } from '../../utils/history'
import { historyDisplayTxHash, historyDisplayChain } from '../../utils/history'
import { Tooltip } from '../common/Tooltip'
import { RenderTokenIcon } from './HistoryTokenIcon'
import {
  formatAddress,
  formatChain,
  getExplorerLink,
  getAddressExplorerLink,
  formatUtcTime,
  getRelativeTime,
  formatAmountDisplay,
} from './historyHelpers'

export interface HistoryTableRowProps {
  item: HistoryItem
  globalPrivate: boolean
  settings: { maskSymbol: string }
  copiedId: string | null
  handleCopy: (txHash: string, itemId: string) => void
  hoveredRecipient: string | null
  setHoveredRecipient: (r: string | null) => void
  timeFormat: 'relative' | 'utc'
  onSelectReceipt: (item: HistoryItem) => void
}

export function HistoryTableRow({
  item,
  globalPrivate,
  settings,
  copiedId,
  handleCopy,
  hoveredRecipient,
  setHoveredRecipient,
  timeFormat,
  onSelectReceipt,
}: HistoryTableRowProps) {
  const getAmountDetail = () => {
    if (globalPrivate || item.isPrivate) {
      return (
        <div className="flex items-center justify-center">
          <Tooltip content="APS Encrypted Transaction" position="top">
            <span className="font-mono text-white tracking-wider font-semibold cursor-help">
              <span>{settings.maskSymbol}</span>
            </span>
          </Tooltip>
        </div>
      )
    }

    switch (item.type) {
      case 'send':
        return (
          <span className="font-bold text-white font-[var(--fonts--space-grotesk)] flex items-center justify-center gap-1.5">
            <span>{formatAmountDisplay(item.amount)}</span>
            <RenderTokenIcon symbol={item.tokenSymbol} />
          </span>
        )
      case 'swap':
        if (item.amountIn && item.amountOut) {
          return (
            <span className="font-bold text-white font-[var(--fonts--space-grotesk)] flex items-center justify-center gap-1.5">
              <span>{formatAmountDisplay(item.amountIn)}</span>
              <RenderTokenIcon symbol={item.tokenIn} />
              <span className="text-[var(--secondary-colors--sky-sync)] text-[10px]">{'→'}</span>
              <span>{formatAmountDisplay(item.amountOut)}</span>
              <RenderTokenIcon symbol={item.tokenOut} />
            </span>
          )
        }
        return (
          <span className="font-bold text-white font-[var(--fonts--space-grotesk)] flex items-center justify-center gap-1.5">
            <span>{formatAmountDisplay(item.amount)}</span>
            <RenderTokenIcon symbol={item.tokenSymbol} />
          </span>
        )
      case 'bridge':
        return (
          <span className="font-bold text-white font-[var(--fonts--space-grotesk)] flex items-center justify-center gap-1.5">
            <span>{formatAmountDisplay(item.amount)}</span>
            <RenderTokenIcon symbol={item.tokenSymbol} />
          </span>
        )
      case 'deposit':
        return (
          <span className="font-bold text-white font-[var(--fonts--space-grotesk)] flex items-center justify-center gap-1.5">
            <span>{formatAmountDisplay(item.amount)}</span>
            <RenderTokenIcon symbol={item.tokenSymbol} />
          </span>
        )
      case 'ai_service':
        return (
          <span className="font-bold text-white font-[var(--fonts--space-grotesk)] flex items-center justify-center gap-1.5">
            <span>{formatAmountDisplay(item.amount)}</span>
            <RenderTokenIcon symbol="USDC" />
            {item.serviceName && (
              <span className="text-[11px] text-cyan-300 font-mono font-medium truncate max-w-[140px]">
                ({item.serviceName})
              </span>
            )}
          </span>
        )
      case 'add_liquidity':
        if (item.amountB && item.tokenB) {
          return (
            <div className="flex flex-col items-center justify-center text-center">
              <span className="font-bold text-emerald-400 font-[var(--fonts--space-grotesk)] flex items-center justify-center gap-1">
                <span>+{formatAmountDisplay(item.amount)}</span>
                <RenderTokenIcon symbol={item.tokenSymbol} />
                <span className="text-slate-400 font-normal text-[11px]">+</span>
                <span>{formatAmountDisplay(item.amountB)}</span>
                <RenderTokenIcon symbol={item.tokenB} />
              </span>
            </div>
          )
        }
        return (
          <div className="flex flex-col items-center justify-center text-center">
            <span className="font-bold text-emerald-400 font-[var(--fonts--space-grotesk)] flex items-center justify-center gap-1.5">
              <span>+{formatAmountDisplay(item.amount)}</span>
              <RenderTokenIcon symbol={item.tokenSymbol} />
            </span>
            {item.poolName && (
              <span className="text-[10px] text-emerald-300/80 font-mono font-medium truncate max-w-[140px] text-center">
                {item.poolName}
              </span>
            )}
          </div>
        )
      case 'remove_liquidity':
        return (
          <div className="flex flex-col items-center justify-center text-center">
            <span className="font-bold text-rose-400 font-[var(--fonts--space-grotesk)] flex items-center justify-center gap-1.5">
              <span>-{formatAmountDisplay(item.amount)}</span>
              <RenderTokenIcon symbol={item.tokenSymbol} />
            </span>
          </div>
        )
      case 'harvest':
        return (
          <div className="flex flex-col items-center justify-center text-center">
            <span className="font-bold text-amber-300 font-[var(--fonts--space-grotesk)] flex items-center justify-center gap-1.5">
              <span>+{formatAmountDisplay(item.amount)}</span>
              <RenderTokenIcon symbol={item.tokenSymbol || 'USDC'} />
            </span>
          </div>
        )
    }
  }

  const getRecipientTarget = () => {
    if (globalPrivate || item.isPrivate) {
      return (
        <div className="flex items-center justify-center">
          <span className="font-mono text-white tracking-wider font-semibold truncate">*****</span>
        </div>
      )
    }
    if (
      item.poolName &&
      (item.type === 'add_liquidity' || item.type === 'remove_liquidity' || item.type === 'harvest')
    ) {
      const targetChain = item.sourceChain || 'Arc_Testnet'
      const explorerUrl = item.recipient ? getAddressExplorerLink(item.recipient, targetChain) : undefined
      return (
        <div className="flex items-center justify-center">
          <a
            href={explorerUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 px-2 py-0.5 rounded-lg font-mono text-xs text-slate-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 border border-transparent transition-all group/recip cursor-pointer truncate max-w-full"
            title={explorerUrl}
          >
            <span className="truncate max-w-[130px] font-sans font-medium text-slate-200">
              {item.poolName}
            </span>
            <ExternalLink className="w-3 h-3 text-slate-500 group-hover/recip:text-[var(--purple-1)] transition-colors opacity-70 group-hover/recip:opacity-100 shrink-0" />
          </a>
        </div>
      )
    }
    if (item.type === 'bridge' && item.destChain && !item.recipient) {
      return (
        <div className="flex items-center justify-center">
          <span className="bg-[rgba(47,87,140,0.3)] text-[var(--secondary-colors--sky-sync)] border border-[rgba(172,198,233,0.3)] text-[10px] font-bold px-2 py-0.5 rounded font-[var(--fonts--space-mono)]">
            {formatChain(item.destChain)}
          </span>
        </div>
      )
    }

    if (!item.recipient) {
      if (item.destChain) {
        return (
          <div className="flex items-center justify-center">
            <span className="bg-[rgba(47,87,140,0.3)] text-[var(--secondary-colors--sky-sync)] border border-[rgba(172,198,233,0.3)] text-[10px] font-bold px-2 py-0.5 rounded font-[var(--fonts--space-mono)]">
              {formatChain(item.destChain)}
            </span>
          </div>
        )
      }
      return (
        <div className="flex items-center justify-center">
          <span className="text-slate-500 font-mono text-xs">-</span>
        </div>
      )
    }

    const normRecipient = item.recipient.toLowerCase()
    const isMatch = Boolean(hoveredRecipient && normRecipient && hoveredRecipient === normRecipient)
    const targetChain = item.destChain || item.sourceChain || 'Arc_Testnet'
    const explorerUrl = getAddressExplorerLink(item.recipient, targetChain)

    return (
      <div className="flex items-center justify-center">
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          onMouseEnter={() => setHoveredRecipient(normRecipient)}
          onMouseLeave={() => setHoveredRecipient(null)}
          className={`inline-flex items-center justify-center gap-1.5 px-2 py-0.5 rounded-lg font-mono text-xs transition-all duration-300 select-none group/recip cursor-pointer ${
            isMatch
              ? 'text-white bg-[rgba(152,150,255,0.3)] border border-[rgba(152,150,255,0.65)] shadow-[0_0_14px_rgba(152,150,255,0.5)] ring-1 ring-[rgba(152,150,255,0.4)] scale-105 font-bold'
              : 'text-slate-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 border border-transparent'
          }`}
          title={explorerUrl}
        >
          <span>{formatAddress(item.recipient)}</span>
          <ExternalLink className="w-3 h-3 text-slate-500 group-hover/recip:text-[var(--purple-1)] transition-colors opacity-70 group-hover/recip:opacity-100 shrink-0" />
        </a>
      </div>
    )
  }

  const txHash = historyDisplayTxHash(item)
  const chainKey = historyDisplayChain(item)

  return (
    <tr className="hover:bg-white/[0.04] transition-colors group h-[52px]">
      {/* Tx Hash */}
      <td className="w-1/5 px-4 py-3 text-center">
        <div className="flex items-center justify-center gap-2 font-mono">
          <a
            href={getExplorerLink(txHash, chainKey)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-slate-200 hover:text-white font-medium transition-all group/tx select-none cursor-pointer"
            title={getExplorerLink(txHash, chainKey)}
          >
            <span className="group-hover/tx:text-white">{formatAddress(txHash)}</span>
            <ExternalLink className="w-4 h-4 text-slate-500 group-hover/tx:text-[var(--purple-1)] transition-colors opacity-70 group-hover/tx:opacity-100 shrink-0" />
          </a>

          <button
            onClick={() => handleCopy(txHash, item.id)}
            className="p-1 rounded-xl text-slate-500 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all cursor-pointer"
            title="Copy Transaction Hash"
          >
            {copiedId === item.id ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectReceipt(item)}
            className="p-1 rounded-xl text-indigo-300/70 hover:text-white hover:bg-indigo-500/15 active:scale-95 transition-all cursor-pointer"
            title="View Digital Receipt / Invoice"
          >
            <FileText className="w-3.5 h-3.5 text-[var(--purple-1)]" />
          </button>
        </div>
      </td>

      {/* Type */}
      <td className="w-1/5 px-4 py-3 text-center">
        <div className="flex items-center justify-center gap-2.5">
          <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            {item.type === 'send' && <ArrowUpRight className="w-3.5 h-3.5 text-indigo-300" />}
            {item.type === 'swap' && <ArrowRightLeft className="w-3.5 h-3.5 text-indigo-300" />}
            {item.type === 'bridge' && <Globe className="w-3.5 h-3.5 text-indigo-300" />}
            {item.type === 'deposit' && <ArrowDownToLine className="w-3.5 h-3.5 text-emerald-300" />}
            {item.type === 'ai_service' && <Bot className="w-3.5 h-3.5 text-cyan-400" />}
            {item.type === 'add_liquidity' && <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />}
            {item.type === 'remove_liquidity' && <MinusCircle className="w-3.5 h-3.5 text-rose-400" />}
            {item.type === 'harvest' && <Coins className="w-3.5 h-3.5 text-amber-400" />}
          </div>
          <span className="font-semibold text-white uppercase text-xs" style={{ fontFamily: 'var(--font-app)' }}>
            {item.type === 'ai_service'
              ? 'x402 AI'
              : item.type === 'add_liquidity'
              ? 'Add Liquidity'
              : item.type === 'remove_liquidity'
              ? 'Remove Liquidity'
              : item.type === 'harvest'
              ? 'Harvest'
              : item.type}
          </span>
        </div>
      </td>

      {/* Amount / Detail */}
      <td className="w-1/5 px-4 py-3.5 text-center truncate">{getAmountDetail()}</td>

      {/* Recipient */}
      <td className="w-1/5 px-4 py-3.5 text-center truncate">{getRecipientTarget()}</td>

      {/* Time */}
      <td className="w-1/5 px-4 py-3.5 text-slate-400 text-center" style={{ fontFamily: 'var(--font-app)' }}>
        <div
          className="flex items-center justify-center gap-1.5 select-none"
          title={
            timeFormat === 'utc'
              ? `Relative: ${getRelativeTime(item.timestamp)}`
              : `UTC: ${formatUtcTime(item.timestamp)}`
          }
        >
          <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-slate-400 text-xs">
            {timeFormat === 'utc' ? formatUtcTime(item.timestamp) : getRelativeTime(item.timestamp)}
          </span>
        </div>
      </td>
    </tr>
  )
}
