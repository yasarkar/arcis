import {
  ExternalLink,
  FileText,
  ArrowUpRight,
  ArrowRightLeft,
  Globe,
  ArrowDownToLine,
  Bot,
  PlusCircle,
  MinusCircle,
  Coins,
} from 'lucide-react'
import type { HistoryItem } from '../../utils/history'
import { historyDisplayTxHash, historyDisplayChain } from '../../utils/history'
import { Tooltip } from '../common/Tooltip'
import { ChainIcon } from '../common/ChainIcon'
import { RenderTokenIcon } from './HistoryTokenIcon'
import {
  formatAddress,
  formatChain,
  getExplorerLink,
  getAddressExplorerLink,
  formatAmountDisplay,
  formatAmountExact,
} from './historyHelpers'

// Shared row content used by both the desktop table (HistoryTableRow) and the
// mobile card list (HistoryCard), so a transaction's amount/type/network/recipient
// can never render differently between the two layouts.

/** x402 provider claims are settlement inflows, not paid calls. */
export const isProviderClaimEntry = (item: HistoryItem): boolean =>
  Boolean(
    item.type === 'ai_service' &&
      (item.serviceName?.toLowerCase().includes('claim') ||
        item.serviceName?.toLowerCase().includes('settlement') ||
        item.serviceId === 'provider_claim')
  )

export interface HistoryAmountProps {
  item: HistoryItem
  globalPrivate: boolean
  maskSymbol: string
}

/** Amount/detail content for one history row (no alignment wrapper). */
export function HistoryAmount({ item, globalPrivate, maskSymbol }: HistoryAmountProps) {
  if (globalPrivate || item.isPrivate) {
    return (
      <Tooltip content="APS Encrypted Transaction" position="top">
        <span className="font-mono text-white tracking-wider font-semibold cursor-help">{maskSymbol}</span>
      </Tooltip>
    )
  }

  const amountClass = 'font-bold text-white font-[var(--fonts--space-grotesk)] flex items-center gap-1.5'

  switch (item.type) {
    case 'send':
      return (
        <span className={amountClass}>
          <span title={formatAmountExact(item.amount)}>{formatAmountDisplay(item.amount)}</span>
          <RenderTokenIcon symbol={item.tokenSymbol} />
        </span>
      )
    case 'swap':
      if (item.amountIn && item.amountOut) {
        return (
          <span className={amountClass}>
            <span title={formatAmountExact(item.amountIn)}>{formatAmountDisplay(item.amountIn)}</span>
            <RenderTokenIcon symbol={item.tokenIn} />
            <span className="text-[var(--secondary-colors--sky-sync)] text-[10px]">{'→'}</span>
            <span title={formatAmountExact(item.amountOut)}>{formatAmountDisplay(item.amountOut)}</span>
            <RenderTokenIcon symbol={item.tokenOut} />
          </span>
        )
      }
      return (
        <span className={amountClass}>
          <span title={formatAmountExact(item.amount)}>{formatAmountDisplay(item.amount)}</span>
          <RenderTokenIcon symbol={item.tokenSymbol} />
        </span>
      )
    case 'bridge':
    case 'deposit':
      return (
        <span className={amountClass}>
          <span title={formatAmountExact(item.amount)}>{formatAmountDisplay(item.amount)}</span>
          <RenderTokenIcon symbol={item.tokenSymbol} />
        </span>
      )
    case 'ai_service': {
      const isClaim = isProviderClaimEntry(item)
      return (
        <span className={`${amountClass} ${isClaim ? 'text-emerald-400' : 'text-white'}`}>
          <span title={formatAmountExact(item.amount)}>
            {isClaim ? '+' : ''}
            {formatAmountDisplay(item.amount)}
          </span>
          <RenderTokenIcon symbol={item.tokenSymbol || 'USDC'} />
        </span>
      )
    }
    case 'add_liquidity':
      if (item.amountB && item.tokenB) {
        return (
          <span className="font-bold text-white font-[var(--fonts--space-grotesk)] flex items-center gap-1">
            <span title={formatAmountExact(item.amount)}>+{formatAmountDisplay(item.amount)}</span>
            <RenderTokenIcon symbol={item.tokenSymbol} />
            <span className="text-slate-400 font-normal text-[11px]">+</span>
            <span title={formatAmountExact(item.amountB)}>{formatAmountDisplay(item.amountB)}</span>
            <RenderTokenIcon symbol={item.tokenB} />
          </span>
        )
      }
      return (
        <span className={amountClass}>
          <span title={formatAmountExact(item.amount)}>+{formatAmountDisplay(item.amount)}</span>
          <RenderTokenIcon symbol={item.tokenSymbol} />
        </span>
      )
    case 'remove_liquidity':
      return (
        <span className={amountClass}>
          <span title={formatAmountExact(item.amount)}>-{formatAmountDisplay(item.amount)}</span>
          <RenderTokenIcon symbol={item.tokenSymbol} />
        </span>
      )
    case 'harvest':
      return (
        <span className={amountClass}>
          <span title={formatAmountExact(item.amount)}>+{formatAmountDisplay(item.amount)}</span>
          <RenderTokenIcon symbol={item.tokenSymbol || 'USDC'} />
        </span>
      )
    default:
      return (
        <span className={amountClass}>
          <span title={formatAmountExact(item.amount)}>{formatAmountDisplay(item.amount)}</span>
          <RenderTokenIcon symbol={item.tokenSymbol} />
        </span>
      )
  }
}

export interface HistoryTypeBadgeProps {
  item: HistoryItem
  /** `sm` renders the compact card variant. */
  size?: 'sm' | 'md'
}

/** Type icon + label ("Bridge", "x402 AI", "Provider Claim", …). */
export function HistoryTypeBadge({ item, size = 'md' }: HistoryTypeBadgeProps) {
  const claim = isProviderClaimEntry(item)
  const iconClass = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'
  const boxClass = size === 'sm' ? 'w-6 h-6 rounded-lg' : 'w-7 h-7 rounded-xl'

  const label =
    item.type === 'ai_service'
      ? claim
        ? 'Provider Claim'
        : 'x402 AI'
      : item.type === 'add_liquidity'
      ? 'Add Liquidity'
      : item.type === 'remove_liquidity'
      ? 'Remove Liquidity'
      : item.type === 'harvest'
      ? 'Harvest'
      : item.type

  return (
    <>
      <div
        className={`${boxClass} flex items-center justify-center shrink-0 bg-indigo-500/15 text-indigo-300 border border-indigo-500/30`}
      >
        {item.type === 'send' && <ArrowUpRight className={`${iconClass} text-indigo-300`} />}
        {item.type === 'swap' && <ArrowRightLeft className={`${iconClass} text-indigo-300`} />}
        {item.type === 'bridge' && <Globe className={`${iconClass} text-indigo-300`} />}
        {item.type === 'deposit' && <ArrowDownToLine className={`${iconClass} text-indigo-300`} />}
        {item.type === 'ai_service' &&
          (claim ? <Coins className={`${iconClass} text-emerald-400`} /> : <Bot className={`${iconClass} text-indigo-300`} />)}
        {item.type === 'add_liquidity' && <PlusCircle className={`${iconClass} text-indigo-300`} />}
        {item.type === 'remove_liquidity' && <MinusCircle className={`${iconClass} text-indigo-300`} />}
        {item.type === 'harvest' && <Coins className={`${iconClass} text-indigo-300`} />}
      </div>
      <span
        className={`font-semibold text-white uppercase tracking-wide ${size === 'sm' ? 'text-[11px]' : 'text-xs'}`}
        style={{ fontFamily: 'var(--font-app)' }}
      >
        {label}
      </span>
    </>
  )
}

export interface HistoryChainIconsProps {
  item: HistoryItem
}

/** Source chain, or both ends of a bridge, as an icon pill. */
export function HistoryChainIcons({ item }: HistoryChainIconsProps) {
  const chainKey = historyDisplayChain(item)

  if (item.type === 'bridge' && item.destChain) {
    return (
      <Tooltip
        content={`${formatChain(item.sourceChain || 'Arc_Testnet')} → ${formatChain(item.destChain)}`}
        position="top"
      >
        <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] group-hover:border-white/20 group-hover:bg-white/[0.08] transition-all shadow-sm">
          <ChainIcon
            chainKeyOrIconId={item.sourceChain || 'arc'}
            size={24}
            className="w-6 h-6 rounded-full object-contain shrink-0"
          />
          <span className="text-indigo-400 font-bold text-sm leading-none">→</span>
          <ChainIcon chainKeyOrIconId={item.destChain} size={24} className="w-6 h-6 rounded-full object-contain shrink-0" />
        </div>
      </Tooltip>
    )
  }

  return (
    <Tooltip content={formatChain(chainKey)} position="top">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] group-hover:border-white/20 group-hover:bg-white/[0.08] transition-all shadow-sm">
        <ChainIcon
          chainKeyOrIconId={chainKey}
          size={26}
          className="w-[26px] h-[26px] rounded-full object-contain shrink-0"
        />
      </div>
    </Tooltip>
  )
}

export interface HistoryRecipientProps {
  item: HistoryItem
  globalPrivate: boolean
  hoveredRecipient: string | null
  setHoveredRecipient: (recipient: string | null) => void
}

/**
 * Recipient column content: pool name, x402 service, destination chain pill or the
 * recipient address, with the cross-row hover highlight on shared addresses.
 */
export function HistoryRecipient({
  item,
  globalPrivate,
  hoveredRecipient,
  setHoveredRecipient,
}: HistoryRecipientProps) {
  if (globalPrivate || item.isPrivate) {
    return <span className="font-mono text-white tracking-wider font-semibold truncate">*****</span>
  }

  if (
    item.poolName &&
    (item.type === 'add_liquidity' || item.type === 'remove_liquidity' || item.type === 'harvest')
  ) {
    const targetChain = item.sourceChain || 'Arc_Testnet'
    const explorerUrl = item.recipient ? getAddressExplorerLink(item.recipient, targetChain) : undefined
    return (
      <a
        href={explorerUrl || '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-1.5 px-2 py-0.5 rounded-lg font-mono text-xs text-slate-300 hover:text-white hover:bg-white/[0.08] hover:border-white/20 border border-transparent transition-all group/recip cursor-pointer truncate max-w-full"
      >
        <span className="truncate max-w-[130px] font-sans font-medium text-slate-200">{item.poolName}</span>
        <ExternalLink className="w-3 h-3 text-slate-500 group-hover/recip:text-[var(--purple-1)] transition-colors opacity-70 group-hover/recip:opacity-100 shrink-0" />
      </a>
    )
  }

  if (item.type === 'ai_service' && item.serviceName) {
    const isClaim = isProviderClaimEntry(item)
    return (
      <span
        className={`truncate max-w-[150px] font-sans font-medium text-xs ${
          isClaim ? 'text-emerald-400' : 'text-indigo-300'
        }`}
      >
        {item.serviceName}
      </span>
    )
  }

  if (item.type === 'bridge' && item.destChain && !item.recipient) {
    return (
      <span className="bg-[rgba(47,87,140,0.3)] text-[var(--secondary-colors--sky-sync)] border border-[rgba(172,198,233,0.3)] text-[10px] font-bold px-2 py-0.5 rounded font-[var(--fonts--space-mono)]">
        {formatChain(item.destChain)}
      </span>
    )
  }

  if (!item.recipient) {
    if (item.destChain) {
      return (
        <span className="bg-[rgba(47,87,140,0.3)] text-[var(--secondary-colors--sky-sync)] border border-[rgba(172,198,233,0.3)] text-[10px] font-bold px-2 py-0.5 rounded font-[var(--fonts--space-mono)]">
          {formatChain(item.destChain)}
        </span>
      )
    }
    return <span className="text-slate-500 font-mono text-xs">-</span>
  }

  const normRecipient = item.recipient.toLowerCase()
  const isMatch = Boolean(hoveredRecipient && normRecipient && hoveredRecipient === normRecipient)
  const targetChain = item.destChain || item.sourceChain || 'Arc_Testnet'
  const explorerUrl = getAddressExplorerLink(item.recipient, targetChain)

  return (
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
    >
      <span>{formatAddress(item.recipient)}</span>
      <ExternalLink className="w-3 h-3 text-slate-500 group-hover/recip:text-[var(--purple-1)] transition-colors opacity-70 group-hover/recip:opacity-100 shrink-0" />
    </a>
  )
}

export interface HistoryHashActionsProps {
  item: HistoryItem
  copiedId?: string | null
  handleCopy?: (txHash: string, itemId: string) => void
  onSelectReceipt: (item: HistoryItem) => void
}

/** Explorer link + receipt button for a row's displayed hash. */
export function HistoryHashActions({ item, onSelectReceipt }: HistoryHashActionsProps) {
  const txHash = historyDisplayTxHash(item)
  const chainKey = historyDisplayChain(item)

  return (
    <div className="flex items-center gap-2 font-mono">
      <a
        href={getExplorerLink(txHash, chainKey)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-slate-200 hover:text-white font-medium transition-all group/tx select-none cursor-pointer"
      >
        <span className="group-hover/tx:text-white">{formatAddress(txHash)}</span>
        <ExternalLink className="w-4 h-4 text-slate-500 group-hover/tx:text-[var(--purple-1)] transition-colors opacity-70 group-hover/tx:opacity-100 shrink-0" />
      </a>

      <button
        type="button"
        onClick={() => onSelectReceipt(item)}
        aria-label="Open transaction receipt"
        className="p-1 rounded-xl text-indigo-300/70 hover:text-white hover:bg-indigo-500/15 active:scale-95 transition-all cursor-pointer"
      >
        <FileText className="w-3.5 h-3.5 text-[var(--purple-1)]" />
      </button>
    </div>
  )
}
