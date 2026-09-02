import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { X, ExternalLink, Loader2, CheckCircle2, AlertCircle, ArrowRight, Droplets } from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'

export type BroadcastStatus = 'pending' | 'success' | 'failed' | 'info'

export interface BroadcastDetails {
  fromAmount?: string
  fromSymbol?: string
  fromIcon?: string
  fromChain?: string
  toAmount?: string
  toSymbol?: string
  toIcon?: string
  toChain?: string
  network?: string
  txHash?: string
  isBridge?: boolean
  isFaucet?: boolean
  faucetTokens?: string
  recipient?: string
}

export interface BroadcastMessage {
  id: string
  title: string
  status: BroadcastStatus
  badgeText?: string
  details?: BroadcastDetails
  message?: string
  timestamp?: number
  autoClose?: boolean
  autoCloseDelay?: number
}

interface BroadcastContextType {
  broadcasts: BroadcastMessage[]
  addBroadcast: (message: Omit<BroadcastMessage, 'id'>) => string
  updateBroadcast: (id: string, updates: Partial<Omit<BroadcastMessage, 'id'>>) => void
  removeBroadcast: (id: string) => void
  clearBroadcasts: () => void
}

const BroadcastContext = createContext<BroadcastContextType | undefined>(undefined)

export const useBroadcast = () => {
  const context = useContext(BroadcastContext)
  if (!context) {
    throw new Error('useBroadcast must be used within a BroadcastProvider')
  }
  return context
}

const TOKEN_ICON_MAP: Record<string, string> = {
  USDC: UsdcIcon,
  EURC: EurcIcon,
  cirBTC: CircleIcon,
}

import {
  CHAIN_META,
  getChainIconId,
  getChainDisplayName,
  isSolanaChain,
} from '../config/chainMeta'

export { CHAIN_META, getChainDisplayName }

export function getChainIconMeta(chain?: string): { iconId: string; name: string; isSolana?: boolean } | null {
  if (!chain) return null
  const iconId = getChainIconId(chain)
  const name = getChainDisplayName(chain)
  const isSolana = isSolanaChain(chain)
  return { iconId, name, isSolana }
}

export function ChainIconBadge({
  chain,
  size = 16,
  className = '',
}: {
  chain?: string
  size?: number
  className?: string
}) {
  const meta = getChainIconMeta(chain)
  if (!meta) return null

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        clipPath: 'circle(50% at 50% 50%)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      className={className}
      title={meta.name || chain}
    >
      <NetworkIcon
        name={meta.iconId}
        variant={meta.isSolana ? 'branded' : 'background'}
        size={size}
        className="rounded-full overflow-hidden"
      />
    </div>
  )
}

const getExplorerLink = (hash: string, network?: string) => {
  if (!hash) return '#'
  const net = (network || '').toLowerCase().replace(/_/g, '-')
  if (net.includes('arc')) return `https://testnet.arcscan.app/tx/${hash}`
  if (net.includes('base')) return `https://sepolia.basescan.org/tx/${hash}`
  if (net.includes('arbitrum')) return `https://sepolia.arbiscan.io/tx/${hash}`
  if (net.includes('optimism') || net.includes('op-sepolia')) return `https://sepolia-optimism.etherscan.io/tx/${hash}`
  if (net.includes('polygon') || net.includes('amoy')) return `https://amoy.polygonscan.com/tx/${hash}`
  if (net.includes('avalanche') || net.includes('fuji')) return `https://testnet.snowtrace.io/tx/${hash}`
  if (net.includes('monad')) return `https://testnet.monadexplorer.com/tx/${hash}`
  if (net.includes('hyper')) return `https://testnet.hyperevm.xyz/tx/${hash}`
  if (net.includes('sei')) return `https://seitrace.com/tx/${hash}`
  if (net.includes('ink')) return `https://explorer-sepolia.inkonchain.com/tx/${hash}`
  if (net.includes('plume')) return `https://testnet-explorer.plumenetwork.xyz/tx/${hash}`
  if (net.includes('sonic')) return `https://testnet.sonicscan.org/tx/${hash}`
  if (net.includes('unichain')) return `https://unichain-sepolia.blockscout.com/tx/${hash}`
  if (net.includes('world')) return `https://worldchain-sepolia.explorer.alchemy.com/tx/${hash}`
  if (net.includes('linea')) return `https://sepolia.lineascan.build/tx/${hash}`
  return `https://sepolia.etherscan.io/tx/${hash}`
}

const getExplorerName = (network?: string) => {
  const net = (network || '').toLowerCase().replace(/_/g, '-')
  if (net.includes('arc')) return 'ArcScan'
  if (net.includes('base')) return 'Basescan'
  if (net.includes('arbitrum')) return 'Arbiscan'
  if (net.includes('optimism')) return 'OP Etherscan'
  if (net.includes('polygon') || net.includes('amoy')) return 'Polygonscan'
  if (net.includes('avalanche') || net.includes('fuji')) return 'Snowtrace'
  if (net.includes('monad')) return 'Monad Explorer'
  if (net.includes('hyper')) return 'HyperEVM'
  if (net.includes('sei')) return 'Seitrace'
  if (net.includes('ink')) return 'Ink Explorer'
  if (net.includes('plume')) return 'Plume Explorer'
  if (net.includes('sonic')) return 'Sonicscan'
  if (net.includes('unichain')) return 'Unichain Explorer'
  if (net.includes('world')) return 'Worldscan'
  if (net.includes('linea')) return 'Lineascan'
  return 'Etherscan'
}

export function BroadcastProvider({ children }: { children: React.ReactNode }) {
  const [broadcasts, setBroadcasts] = useState<BroadcastMessage[]>([])

  const removeBroadcast = useCallback((id: string) => {
    setBroadcasts(prev => prev.filter(item => item.id !== id))
  }, [])

  const addBroadcast = useCallback((item: Omit<BroadcastMessage, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 10)
    const newBroadcast: BroadcastMessage = {
      ...item,
      id,
      timestamp: Date.now(),
      autoClose: item.autoClose ?? (item.status === 'success' || item.status === 'info'),
      autoCloseDelay: item.autoCloseDelay ?? 7000,
    }

    setBroadcasts(prev => [newBroadcast, ...prev])
    return id
  }, [])

  const updateBroadcast = useCallback((id: string, updates: Partial<Omit<BroadcastMessage, 'id'>>) => {
    setBroadcasts(prev =>
      prev.map(item => {
        if (item.id !== id) return item
        const updated = { ...item, ...updates }
        if (updates.status === 'success' || updates.status === 'failed') {
          updated.autoClose = updates.autoClose ?? true
          updated.autoCloseDelay = updates.autoCloseDelay ?? 8000
        }
        return updated
      })
    )
  }, [])

  const clearBroadcasts = useCallback(() => {
    setBroadcasts([])
  }, [])

  return (
    <BroadcastContext.Provider
      value={{ broadcasts, addBroadcast, updateBroadcast, removeBroadcast, clearBroadcasts }}
    >
      {children}
      <BroadcastContainer broadcasts={broadcasts} onRemove={removeBroadcast} />
    </BroadcastContext.Provider>
  )
}

function BroadcastContainer({
  broadcasts,
  onRemove,
}: {
  broadcasts: BroadcastMessage[]
  onRemove: (id: string) => void
}) {
  if (broadcasts.length === 0) return null

  return (
    <div
      className="fixed bottom-6 left-6 z-[9999] flex flex-col-reverse gap-3 w-full max-w-sm pointer-events-none"
      style={{ fontFamily: 'var(--fonts--dm-sans)' }}
    >
      {broadcasts.map(broadcast => (
        <BroadcastCard key={broadcast.id} broadcast={broadcast} onRemove={onRemove} />
      ))}
    </div>
  )
}

function BroadcastCard({
  broadcast,
  onRemove,
}: {
  broadcast: BroadcastMessage
  onRemove: (id: string) => void
}) {
  const { id, title, status, badgeText, details, message, autoClose, autoCloseDelay } = broadcast

  useEffect(() => {
    if (autoClose && autoCloseDelay && status !== 'pending') {
      const timer = setTimeout(() => {
        onRemove(id)
      }, autoCloseDelay)
      return () => clearTimeout(timer)
    }
  }, [id, autoClose, autoCloseDelay, status, onRemove])

  const defaultBadge =
    status === 'pending'
      ? 'Pending'
      : status === 'success'
      ? 'Success'
      : status === 'failed'
      ? 'Failed'
      : 'Info'

  const displayBadge = badgeText || defaultBadge

  const fromIconSrc = details?.fromIcon || (details?.fromSymbol ? TOKEN_ICON_MAP[details.fromSymbol] : null)
  const toIconSrc = details?.toIcon || (details?.toSymbol ? TOKEN_ICON_MAP[details.toSymbol] : null)

  const fromChainMeta = details?.fromChain ? getChainIconMeta(details.fromChain) : (details?.fromSymbol ? getChainIconMeta(details.fromSymbol) : null)
  const toChainMeta = details?.toChain ? getChainIconMeta(details.toChain) : (details?.toSymbol ? getChainIconMeta(details.toSymbol) : null)

  // Identify faucet operation
  const isFaucet = Boolean(
    details?.isFaucet ||
    badgeText?.toLowerCase() === 'faucet' ||
    title.toLowerCase().includes('faucet')
  )

  // Identify bridge operation
  const isBridge = Boolean(
    !isFaucet && (
      details?.isBridge ||
      (details?.fromChain && details?.toChain && details.fromChain !== details.toChain) ||
      title.toLowerCase().includes('bridg') ||
      (details?.toSymbol && getChainIconMeta(details.toSymbol))
    )
  )

  const sourceChain = details?.fromChain || (getChainIconMeta(details?.fromSymbol) ? details?.fromSymbol : undefined) || 'Arc_Testnet'
  const destChain = details?.toChain || (getChainIconMeta(details?.toSymbol) ? details?.toSymbol : undefined) || details?.network || 'Base_Sepolia'
  const bridgeAmount = details?.fromAmount || details?.toAmount || ''
  const bridgeTokenSymbol = (!getChainIconMeta(details?.fromSymbol) && details?.fromSymbol) || (!getChainIconMeta(details?.toSymbol) && details?.toSymbol) || 'USDC'

  const isPending = status === 'pending'
  const isSuccess = status === 'success'
  const isFailed = status === 'failed'

  return (
    <div
      className="pointer-events-auto animate-slide-in-left relative overflow-hidden rounded-2xl p-4 transition-all duration-300"
      style={{
        background: 'rgba(13, 19, 35, 0.94)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: isPending
          ? '1px solid rgba(56, 189, 248, 0.35)'
          : isSuccess
          ? '1px solid rgba(52, 211, 153, 0.35)'
          : isFailed
          ? '1px solid rgba(248, 113, 113, 0.35)'
          : '1px solid rgba(148, 163, 184, 0.25)',
        boxShadow: isPending
          ? '0 12px 32px -4px rgba(6, 182, 212, 0.2), 0 0 16px rgba(56, 189, 248, 0.1)'
          : isSuccess
          ? '0 12px 32px -4px rgba(16, 185, 129, 0.2), 0 0 16px rgba(52, 211, 153, 0.1)'
          : isFailed
          ? '0 12px 32px -4px rgba(239, 68, 68, 0.2), 0 0 16px rgba(248, 113, 113, 0.1)'
          : '0 12px 32px -4px rgba(0, 0, 0, 0.4)',
      }}
    >
      {/* Pending Animated Glow Line at Top */}
      {isPending && (
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-pulse" />
      )}

      {/* TOP ROW: Icon + Title + Badge + Close Button */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Status Icon */}
          <div className="shrink-0 flex items-center justify-center">
            {isPending && (
              <div className="w-6 h-6 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
              </div>
            )}
            {isSuccess && (
              <div className="w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
            )}
            {isFailed && (
              <div className="w-6 h-6 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center">
                <AlertCircle className="w-4 h-4 text-rose-400" />
              </div>
            )}
            {!isPending && !isSuccess && !isFailed && (
              <div className="w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                <div className="w-2 h-2 rounded-full bg-blue-400" />
              </div>
            )}
          </div>

          {/* Title */}
          <span className="text-sm font-semibold text-white truncate tracking-wide">
            {title}
          </span>

          {/* Status Badge Pill */}
          <span
            className="shrink-0 px-2 py-0.5 text-[10px] font-bold rounded-full border uppercase tracking-wider"
            style={{
              background: isPending
                ? 'rgba(6, 182, 212, 0.12)'
                : isSuccess
                ? 'rgba(16, 185, 129, 0.12)'
                : isFailed
                ? 'rgba(239, 68, 68, 0.12)'
                : 'rgba(148, 163, 184, 0.12)',
              borderColor: isPending
                ? 'rgba(6, 182, 212, 0.3)'
                : isSuccess
                ? 'rgba(16, 185, 129, 0.3)'
                : isFailed
                ? 'rgba(239, 68, 68, 0.3)'
                : 'rgba(148, 163, 184, 0.3)',
              color: isPending
                ? '#38bdf8'
                : isSuccess
                ? '#34d399'
                : isFailed
                ? '#f87171'
                : '#cbd5e1',
            }}
          >
            {displayBadge}
          </span>
        </div>

        {/* Close Button */}
        <button
          onClick={() => onRemove(id)}
          className="shrink-0 p-1 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
          aria-label="Close notification"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* FAUCET OPERATIONS: Dedicated clean faucet view */}
      {isFaucet && (
        <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-2">
          {/* Target Network & Requested Tokens Row */}
          <div className="flex items-center justify-between gap-2 text-xs">
            {/* Target Network */}
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[11px] font-medium text-slate-400">Network:</span>
              <div className="flex items-center gap-1.5 font-semibold text-slate-200 bg-slate-900/80 px-2 py-0.5 rounded-lg border border-slate-800">
                <ChainIconBadge chain={details?.network || details?.fromChain || 'Arc_Testnet'} size={15} />
                <span className="truncate max-w-[120px]">
                  {getChainDisplayName(details?.network || details?.fromChain || 'Arc Testnet')}
                </span>
              </div>
            </div>

            {/* Requested Tokens with USDC Icon (No background/border) */}
            {(details?.faucetTokens || details?.fromAmount) && (
              <div className="flex items-center gap-1.5 font-semibold text-xs text-blue-400">
                <img src={UsdcIcon} alt="USDC" className="w-3.5 h-3.5 object-contain shrink-0" />
                <span>{details.faucetTokens || details.fromAmount}</span>
              </div>
            )}
          </div>

          {/* Recipient Address (Clean left-aligned) */}
          {(details?.recipient || (details?.toSymbol && details.toSymbol.startsWith('0x'))) && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[11px] font-medium text-slate-400">Recipient:</span>
              <span className="font-mono text-xs text-slate-300 font-medium truncate">
                {details?.recipient || details?.toSymbol}
              </span>
            </div>
          )}
        </div>
      )}

      {/* BRIDGE OPERATIONS: Chain Icons next to Network Names */}
      {isBridge && (
        <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-2">
          {/* Transfer Amount row (if amount provided) */}
          {bridgeAmount && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[11px] font-medium text-slate-400">Bridge Amount</span>
              <div className="flex items-center gap-1.5 font-bold text-white bg-slate-900/80 px-2 py-0.5 rounded-lg border border-slate-800">
                <img src={fromIconSrc || TOKEN_ICON_MAP[bridgeTokenSymbol] || UsdcIcon} alt={bridgeTokenSymbol} className="w-3.5 h-3.5 object-contain" />
                <span>{bridgeAmount} {bridgeTokenSymbol}</span>
              </div>
            </div>
          )}

          {/* Network Route with Chain Icons to the Left of Network Names */}
          <div className="flex items-center justify-between gap-1.5 px-2 py-1 rounded-xl border border-slate-800 text-xs">
            {/* Source Network with Icon */}
            <div className="flex items-center gap-1.5 min-w-0">
              <ChainIconBadge chain={sourceChain} size={18} />
              <span className="font-semibold text-slate-200 truncate max-w-[95px]" title={getChainDisplayName(sourceChain)}>
                {getChainDisplayName(sourceChain)}
              </span>
            </div>

            {/* Route Arrow */}
            <div className="flex items-center gap-1 text-slate-500 shrink-0 px-0.5">
              <ArrowRight className="w-4 h-4 text-cyan-400 shrink-0" />
            </div>

            {/* Destination Network with Icon */}
            <div className="flex items-center gap-1.5 min-w-0 justify-end">
              <ChainIconBadge chain={destChain} size={18} />
              <span className="font-semibold text-white truncate max-w-[95px]" title={getChainDisplayName(destChain)}>
                {getChainDisplayName(destChain)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* NON-BRIDGE FLOW: Token / Destination Details */}
      {!isBridge && !isFaucet && details && (details.fromAmount || details.fromSymbol || details.toSymbol) && (
        <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center gap-2 text-xs font-medium text-slate-200">
          {/* From token or chain */}
          <div className="flex items-center gap-1.5 bg-slate-900/60 px-2 py-1 rounded-lg border border-slate-800">
            {fromChainMeta ? (
              <ChainIconBadge chain={details.fromSymbol || details.fromChain} size={16} />
            ) : fromIconSrc ? (
              <img src={fromIconSrc} alt={details.fromSymbol || 'Token'} className="w-4 h-4 object-contain" />
            ) : null}
            <span className="font-semibold text-white">
              {details.fromAmount ? `${details.fromAmount} ` : ''}{getChainDisplayName(details.fromSymbol) || details.fromSymbol}
            </span>
          </div>

          {/* Arrow */}
          <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />

          {/* To token, recipient or destination */}
          <div className="flex items-center gap-1.5 bg-slate-900/60 px-2 py-1 rounded-lg border border-slate-800">
            {toChainMeta ? (
              <ChainIconBadge chain={details.toSymbol || details.toChain} size={16} />
            ) : toIconSrc ? (
              <img src={toIconSrc} alt={details.toSymbol || 'Token'} className="w-4 h-4 object-contain" />
            ) : null}
            <span className="font-semibold text-white truncate max-w-[140px]" title={details.toSymbol}>
              {details.toAmount ? `${details.toAmount} ` : ''}
              {details.toSymbol?.startsWith('0x') && details.toSymbol.length > 12
                ? `${details.toSymbol.slice(0, 6)}...${details.toSymbol.slice(-4)}`
                : (getChainDisplayName(details.toSymbol) || details.toSymbol || 'Gateway')}
            </span>
          </div>
        </div>
      )}

      {/* OPTIONAL MESSAGE / ERROR DESCRIPTION */}
      {message && (
        <p className="mt-3.5 text-xs text-left text-slate-300/90 leading-relaxed break-words font-sans">
          {message}
        </p>
      )}

      {/* BOTTOM ROW: TX Hash & Block Explorer Link with Network Icon */}
      {details?.txHash && (
        <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2 text-[11px]">
          <span className="font-mono text-slate-400">
            TX: <span className="text-slate-300 font-semibold">{details.txHash.slice(0, 8)}...{details.txHash.slice(-6)}</span>
          </span>
          <a
            href={getExplorerLink(details.txHash, details.network || destChain || sourceChain)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 transition-colors font-medium hover:underline"
          >
            <ChainIconBadge chain={details.network || destChain || sourceChain} size={13} />
            <span>View on {getExplorerName(details.network || destChain || sourceChain)}</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  )
}

