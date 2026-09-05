import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import {
  X,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Ban,
  ArrowRight,
  Wallet,
  FileText,
  Repeat,
  Layers,
  ArrowUpRightFromSquare,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import {
  CHAIN_META,
  getChainIconId,
  getChainDisplayName,
  isSolanaChain,
  isKnownChain,
} from '../config/chainMeta'

export type BroadcastStatus = 'pending' | 'success' | 'failed' | 'canceled' | 'info'
export type BroadcastType = 'send' | 'bridge' | 'swap' | 'deposit' | 'faucet' | 'system'

export interface BroadcastDetails {
  // Common / Send
  amount?: string
  tokenSymbol?: string
  tokenIcon?: string
  recipient?: string
  network?: string
  memo?: string
  isGasless?: boolean
  txHash?: string

  // Bridge
  sourceChain?: string
  destChain?: string
  sourceTxHash?: string
  bridgeMode?: 'direct' | 'gateway'

  // Swap
  fromAmount?: string
  fromSymbol?: string
  fromIcon?: string
  fromChain?: string
  toAmount?: string
  toSymbol?: string
  toIcon?: string
  toChain?: string

  // Deposit
  targetDomain?: string

  // Legacy / Faucet fields
  isBridge?: boolean
  isFaucet?: boolean
  faucetTokens?: string
}

export interface BroadcastMessage {
  id: string
  type?: BroadcastType
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

export const TOKEN_ICON_MAP: Record<string, string> = {
  USDC: UsdcIcon,
  EURC: EurcIcon,
  cirBTC: CircleIcon,
}

export { CHAIN_META, getChainDisplayName }

export function getChainIconMeta(chain?: string): { iconId: string; name: string; isSolana?: boolean } | null {
  if (!chain || !isKnownChain(chain)) return null
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
  if (!meta) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`rounded-full bg-slate-800 flex items-center justify-center shrink-0 ${className}`}
      >
        <Layers className="w-2.5 h-2.5 text-slate-400" />
      </div>
    )
  }

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

/**
 * Heuristic fallback if broadcast.type is not provided explicitly
 */
function inferBroadcastType(broadcast: BroadcastMessage): BroadcastType {
  if (broadcast.type) return broadcast.type
  const title = (broadcast.title || '').toLowerCase()
  const badge = (broadcast.badgeText || '').toLowerCase()
  const details = broadcast.details

  if (details?.isFaucet || title.includes('faucet') || badge === 'faucet') return 'faucet'
  if (details?.isBridge || title.includes('bridg') || badge.includes('cctp')) return 'bridge'
  if (title.includes('swap') || badge.includes('swap') || badge.includes('swapped')) return 'swap'
  if (title.includes('deposit') || badge.includes('deposit')) return 'deposit'
  if (title.includes('send') || title.includes('transfer') || badge.includes('gasless') || details?.recipient) return 'send'

  return 'system'
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
      autoClose: item.autoClose ?? (item.status === 'success' || item.status === 'info' || item.status === 'canceled'),
      autoCloseDelay: item.autoCloseDelay ?? 5000,
    }

    setBroadcasts(prev => [newBroadcast, ...prev])
    return id
  }, [])

  const updateBroadcast = useCallback((id: string, updates: Partial<Omit<BroadcastMessage, 'id'>>) => {
    setBroadcasts(prev =>
      prev.map(item => {
        if (item.id !== id) return item
        const updated = { ...item, ...updates }
        if (updates.status === 'success' || updates.status === 'failed' || updates.status === 'canceled') {
          updated.autoClose = updates.autoClose ?? true
          updated.autoCloseDelay = updates.autoCloseDelay ?? 5000
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
      className="fixed bottom-6 left-6 z-[9999] flex flex-col-reverse gap-3 w-[calc(100vw-3rem)] sm:w-[460px] max-w-[460px] pointer-events-none"
      style={{ fontFamily: 'var(--fonts--dm-sans, sans-serif)' }}
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
  const opType = inferBroadcastType(broadcast)

  const [isHovered, setIsHovered] = useState(false)
  const remainingTimeRef = useRef<number>(autoCloseDelay || 5000)
  const startTimeRef = useRef<number>(Date.now())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    remainingTimeRef.current = autoCloseDelay || 5000
  }, [autoCloseDelay])

  useEffect(() => {
    if (!autoClose || status === 'pending') {
      if (timerRef.current) clearTimeout(timerRef.current)
      return
    }

    if (isHovered) {
      if (timerRef.current) clearTimeout(timerRef.current)
      return
    }

    startTimeRef.current = Date.now()
    timerRef.current = setTimeout(() => {
      onRemove(id)
    }, remainingTimeRef.current)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [id, autoClose, status, isHovered, onRemove])

  const handleMouseEnter = () => {
    if (!autoClose || status === 'pending') return
    const elapsed = Date.now() - startTimeRef.current
    remainingTimeRef.current = Math.max(200, remainingTimeRef.current - elapsed)
    setIsHovered(true)
  }

  const handleMouseLeave = () => {
    if (!autoClose || status === 'pending') return
    setIsHovered(false)
  }

  const defaultBadge =
    status === 'pending'
      ? 'Pending'
      : status === 'success'
        ? 'Success'
        : status === 'canceled'
          ? 'Canceled'
          : status === 'failed'
            ? 'Failed'
            : 'Info'

  const displayBadge = badgeText || defaultBadge

  const isPending = status === 'pending'
  const isSuccess = status === 'success'
  const isFailed = status === 'failed'
  const isCanceled = status === 'canceled'

  // Chain to display explorer for
  const explorerChain =
    details?.network ||
    details?.destChain ||
    details?.toChain ||
    details?.sourceChain ||
    details?.fromChain ||
    'Arc_Testnet'

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="pointer-events-auto animate-slide-in-left relative overflow-hidden rounded-2xl p-4 transition-all duration-300"
      style={{
        background: 'rgba(13, 19, 35, 0.96)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: isPending
          ? '1px solid rgba(56, 189, 248, 0.4)'
          : isSuccess
            ? '1px solid rgba(52, 211, 153, 0.4)'
            : isCanceled
              ? '1px solid rgba(245, 158, 11, 0.45)'
              : isFailed
                ? '1px solid rgba(248, 113, 113, 0.4)'
                : '1px solid rgba(148, 163, 184, 0.25)',
        boxShadow: isPending
          ? '0 12px 32px -4px rgba(6, 182, 212, 0.25), 0 0 16px rgba(56, 189, 248, 0.15)'
          : isSuccess
            ? '0 12px 32px -4px rgba(16, 185, 129, 0.25), 0 0 16px rgba(52, 211, 153, 0.15)'
            : isCanceled
              ? '0 12px 32px -4px rgba(245, 158, 11, 0.25), 0 0 16px rgba(251, 191, 36, 0.15)'
              : isFailed
                ? '0 12px 32px -4px rgba(239, 68, 68, 0.25), 0 0 16px rgba(248, 113, 113, 0.15)'
                : '0 12px 32px -4px rgba(0, 0, 0, 0.5)',
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
              <div className="w-6 h-6 rounded-full bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center">
                <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
              </div>
            )}
            {isSuccess && (
              <div className="w-6 h-6 rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
            )}
            {isCanceled && (
              <div className="w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
                <Ban className="w-3.5 h-3.5 text-amber-400" />
              </div>
            )}
            {isFailed && (
              <div className="w-6 h-6 rounded-full bg-rose-500/15 border border-rose-500/40 flex items-center justify-center">
                <AlertCircle className="w-4 h-4 text-rose-400" />
              </div>
            )}
            {!isPending && !isSuccess && !isFailed && !isCanceled && (
              <div className="w-6 h-6 rounded-full bg-blue-500/15 border border-blue-500/40 flex items-center justify-center">
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
                ? 'rgba(6, 182, 212, 0.15)'
                : isSuccess
                  ? 'rgba(16, 185, 129, 0.15)'
                  : isCanceled
                    ? 'rgba(245, 158, 11, 0.15)'
                    : isFailed
                      ? 'rgba(239, 68, 68, 0.15)'
                      : 'rgba(148, 163, 184, 0.15)',
              borderColor: isPending
                ? 'rgba(6, 182, 212, 0.4)'
                : isSuccess
                  ? 'rgba(16, 185, 129, 0.4)'
                  : isCanceled
                    ? 'rgba(245, 158, 11, 0.4)'
                    : isFailed
                      ? 'rgba(239, 68, 68, 0.4)'
                      : 'rgba(148, 163, 184, 0.3)',
              color: isPending
                ? '#38bdf8'
                : isSuccess
                  ? '#34d399'
                  : isCanceled
                    ? '#fbbf24'
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

      {/* DEDICATED TEMPLATE BODIES ACCORDING TO OPERATION TYPE */}
      {opType === 'send' && <SendBroadcastContent details={details} />}
      {opType === 'bridge' && <BridgeBroadcastContent details={details} status={status} />}
      {opType === 'swap' && <SwapBroadcastContent details={details} status={status} />}
      {opType === 'deposit' && <DepositBroadcastContent details={details} status={status} />}
      {opType === 'faucet' && <FaucetBroadcastContent details={details} />}
      {opType === 'system' && <SystemBroadcastContent details={details} />}

      {/* ERROR / EXPLANATION MESSAGE */}
      {message && (
        <p
          className={`mt-3 text-xs text-left leading-relaxed break-words font-sans p-2.5 rounded-xl border ${isCanceled
            ? 'text-amber-300/90 bg-amber-500/10 border-amber-500/25'
            : 'text-rose-300/90 bg-rose-500/10 border-rose-500/20'
            }`}
        >
          {message}
        </p>
      )}

      {/* BOTTOM ROW: Explorer Link */}
      {details?.txHash && (
        <div className="mt-2.5 pt-2 border-slate-800/70 flex items-center justify-between gap-2 text-[11px] pl-2.5 pr-1">
          <span className="text-slate-400 font-medium">Transaction:</span>
          <a
            href={getExplorerLink(details.txHash, explorerChain)}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-1.5 text-slate-200 hover:text-white transition-colors cursor-pointer"
            title={`View transaction on ${getExplorerName(explorerChain)}`}

          >
            <span className="font-medium text-[11px] text-slate-200 group-hover:text-indigo-300 transition-colors">
              View on {getExplorerName(explorerChain)}</span>
            <ArrowUpRightFromSquare className="w-3 h-3 text-indigo-400 group-hover:text-indigo-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
        </div>
      )}

      {/* AUTO-CLOSE COUNTDOWN PROGRESS BAR */}
      {autoClose && autoCloseDelay && status !== 'pending' && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-slate-800/50 overflow-hidden pointer-events-none">
          <div
            className="h-full origin-left pointer-events-none"
            style={{
              width: '100%',
              background: isSuccess
                ? 'linear-gradient(90deg, #10b981, #34d399)'
                : isCanceled
                  ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                  : isFailed
                    ? 'linear-gradient(90deg, #ef4444, #f87171)'
                    : 'linear-gradient(90deg, #06b6d4, #38bdf8)',
              boxShadow: isSuccess
                ? '0 0 8px rgba(52, 211, 153, 0.7)'
                : isCanceled
                  ? '0 0 8px rgba(251, 191, 36, 0.7)'
                  : isFailed
                    ? '0 0 8px rgba(248, 113, 113, 0.7)'
                    : '0 0 8px rgba(56, 189, 248, 0.7)',
              animation: `broadcastTimerShrink ${autoCloseDelay}ms linear forwards`,
              animationPlayState: isHovered ? 'paused' : 'running',
            }}
          />
        </div>
      )}
    </div>
  )
}

/* ========================================================================== */
/* 1. SEND BROADCAST TEMPLATE (Varlık + Alıcı Cüzdan + Ağ)                      */
/* ========================================================================== */
function SendBroadcastContent({ details }: { details?: BroadcastDetails }) {
  if (!details) return null

  const sendAmount = details.amount || details.fromAmount || ''
  const tokenSym = details.tokenSymbol || details.fromSymbol || 'USDC'
  const tokenIconSrc = details.tokenIcon || details.fromIcon || TOKEN_ICON_MAP[tokenSym]
  const recipientAddr = details.recipient || details.toSymbol || ''
  const network = details.network || 'Arc_Testnet'

  return (
    <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-2">
      {/* Top Row: Amount & Network */}
      <div className="flex items-center justify-between gap-2 text-xs">
        {/* Transferred Asset */}
        <div className="flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1 rounded-xl border border-slate-800">
          {tokenIconSrc ? (
            <img src={tokenIconSrc} alt={tokenSym} className="w-3.5 h-3.5 object-contain shrink-0" />
          ) : (
            <div className="w-3.5 h-3.5 rounded-full bg-cyan-500/20 flex items-center justify-center text-[9px] font-bold text-cyan-300">
              $
            </div>
          )}
          <div className="flex items-center gap-1.5 font-bold text-white">
            {sendAmount ? (
              <>
                <span className="tabular-nums">{sendAmount}</span>
                <span>{tokenSym}</span>
              </>
            ) : (
              <span>{tokenSym}</span>
            )}
          </div>
        </div>

        {/* Network Badge */}
        <div className="flex items-center gap-1.5 font-medium text-slate-300 bg-slate-900/80 px-2.5 py-1 rounded-xl border border-slate-800 shrink-0">
          <ChainIconBadge chain={network} size={14} />
          <span className="truncate max-w-[150px] text-[11px] font-semibold">
            {getChainDisplayName(network)}
          </span>
        </div>
      </div>

      {/* Recipient Row */}
      {recipientAddr && (
        <div className="flex items-center justify-between gap-2 text-xs bg-slate-900/50 px-2.5 py-1.5 rounded-xl border border-slate-800/60">
          <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1 shrink-0">
            <Wallet className="w-3 h-3 text-slate-400" />
            To:
          </span>
          <span className="font-mono text-xs text-white font-medium truncate" title={recipientAddr}>
            {recipientAddr.length > 20
              ? `${recipientAddr.slice(0, 10)}...${recipientAddr.slice(-8)}`
              : recipientAddr}
          </span>
        </div>
      )}

      {/* Memo row if present */}
      {details.memo && (
        <div className="flex items-center justify-between gap-2 text-xs pl-2.5 pr-1 pt-0.5 rounded-xl border border-slate-800/60">
          <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5 shrink-0">
            <FileText className="w-3 h-3 text-slate-400" />
            Memo:
          </span>
          <span className="text-xs text-slate-200 font-medium truncate max-w-[280px] px-1.5 py-0.5 rounded-lg">
            {details.memo}
          </span>
        </div>
      )}
    </div>
  )
}

/* ========================================================================== */
/* 2. BRIDGE BROADCAST TEMPLATE (Kaynak Ağ ➔ Hedef Ağ Rotası)                 */
/* ========================================================================== */
function BridgeBroadcastContent({ details, status }: { details?: BroadcastDetails; status?: BroadcastStatus }) {
  if (!details) return null

  const isCanceled = status === 'canceled'
  const isFailed = status === 'failed'

  const amount = details.amount || details.fromAmount
  const tokenSym = details.tokenSymbol || details.fromSymbol
  const tokenIconSrc = details.tokenIcon || details.fromIcon
  const sourceChain = details.sourceChain || details.fromChain
  const destChain = details.destChain || details.toChain

  return (
    <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-2.5">
      {/* Amount Header */}
      {amount && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-[11px] font-medium text-slate-400 ml-3">Bridge Amount</span>
          <div
            className={`flex items-center gap-1.5 font-bold px-2 py-0.5 rounded-lg border ${isFailed
                ? 'border-rose-500/25 bg-rose-500/10 text-rose-300/90'
                : 'border-slate-800 bg-slate-900/80 text-white'
              }`}
          >
            <img src={tokenIconSrc} alt={tokenSym} className="w-3.5 h-3.5 object-contain shrink-0" />
            <div className="flex items-center gap-1.5">
              <span className="tabular-nums">{amount}</span>
              <span>{tokenSym}</span>
            </div>
          </div>
        </div>
      )}

      {/* Cross-Chain Route Card */}
      <div
        className={`flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs ${isFailed
            ? 'border-rose-500/25 bg-rose-500/5'
            : 'border-slate-800 bg-slate-900/60'
          }`}
      >
        {/* Source Network */}
        <div className="flex items-center gap-1.5 min-w-0">
          <ChainIconBadge chain={sourceChain} size={18} />
          <span className="font-semibold text-slate-200 truncate max-w-[135px]" title={getChainDisplayName(sourceChain)}>
            {getChainDisplayName(sourceChain)}
          </span>
        </div>

        {/* Route Arrow */}
        <div className="flex items-center gap-1 text-slate-500 shrink-0 px-1">
          <ArrowRight
            className={`w-4 h-4 shrink-0 ${isCanceled ? 'text-amber-400' : isFailed ? 'text-rose-400' : 'text-cyan-400'
              }`}
          />
        </div>

        {/* Destination Network */}
        <div className="flex items-center gap-1.5 min-w-0 justify-end">
          <ChainIconBadge chain={destChain} size={18} />
          <span
            className={`font-semibold truncate max-w-[135px] ${isFailed ? 'text-rose-300/90' : 'text-white'
              }`}
            title={getChainDisplayName(destChain)}
          >
            {getChainDisplayName(destChain)}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ========================================================================== */
/* 3. SWAP BROADCAST TEMPLATE (Verilen Token ⇄ Alınan Token)                  */
/* ========================================================================== */
function SwapBroadcastContent({ details, status }: { details?: BroadcastDetails; status?: BroadcastStatus }) {
  if (!details) return null

  const fromAmount = details.fromAmount || ''
  const fromSym = details.fromSymbol || 'USDC'
  const fromIcon = details.fromIcon || TOKEN_ICON_MAP[fromSym]

  const toAmount = details.toAmount || ''
  const toSym = details.toSymbol || 'EURC'
  const toIcon = details.toIcon || TOKEN_ICON_MAP[toSym]

  const fromChain = details.fromChain || details.network || 'Arc_Testnet'
  const toChain = details.toChain || fromChain
  const isCrossChain = Boolean(toChain && toChain !== fromChain)

  return (
    <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-2">
      {/* Swap Pair Representation */}
      <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-slate-900/70 border border-slate-800 text-xs">
        {/* Token In */}
        <div className="flex items-center gap-1.5 min-w-0">
          {fromIcon ? (
            <img src={fromIcon} alt={fromSym} className="w-4 h-4 object-contain shrink-0" />
          ) : (
            <div className="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center text-[10px] text-white">
              $
            </div>
          )}
          <div className="flex items-center gap-1.5 font-bold text-white truncate">
            {fromAmount ? (
              <>
                <span className="tabular-nums">{fromAmount}</span>
                <span>{fromSym}</span>
              </>
            ) : (
              <span>{fromSym}</span>
            )}
          </div>
        </div>

        {/* Swap Icon */}
        <div className="shrink-0 p-1 rounded-full bg-slate-800 text-cyan-400">
          <Repeat className="w-3.5 h-3.5" />
        </div>

        {/* Token Out */}
        <div className="flex items-center gap-1.5 min-w-0 justify-end">
          {toIcon ? (
            <img src={toIcon} alt={toSym} className="w-4 h-4 object-contain shrink-0" />
          ) : (
            <div className="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center text-[10px] text-white">
              $
            </div>
          )}
          <div
            className={`flex items-center gap-1.5 font-bold truncate ${
              status === 'success' ? 'text-emerald-400' : 'text-white'
            }`}
          >
            {toAmount ? (
              <>
                <span className="tabular-nums">{toAmount}</span>
                <span>{toSym}</span>
              </>
            ) : (
              <span>{toSym}</span>
            )}
          </div>
        </div>
      </div>

      {/* Network Info */}
      <div className="flex items-center justify-between text-[12px] text-slate-400 px-0.5">
        <span className="ml-1.5">Network:</span>
        {isCrossChain ? (
          <div className="flex items-center gap-1.5 text-slate-300">
            <ChainIconBadge chain={fromChain} size={14} />
            <span>{getChainDisplayName(fromChain)}</span>
            <ArrowRight className="w-3 h-3 text-cyan-400" />
            <ChainIconBadge chain={toChain} size={14} />
            <span className="text-white font-medium">{getChainDisplayName(toChain)}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 font-medium text-slate-200">
            <ChainIconBadge chain={fromChain} size={14} />
            <span>{getChainDisplayName(fromChain)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ========================================================================== */
/* 4. DEPOSIT BROADCAST TEMPLATE (Cüzdan ➔ Circle Gateway)                    */
/* ========================================================================== */
function DepositBroadcastContent({ details, status }: { details?: BroadcastDetails; status?: BroadcastStatus }) {
  if (!details) return null

  const isFailed = status === 'failed'
  const isCanceled = status === 'canceled'

  const depositAmount = details.amount || details.fromAmount || ''
  const tokenSym = details.tokenSymbol || details.fromSymbol || 'USDC'
  const sourceChain = details.sourceChain || details.fromChain || details.network || 'Arc_Testnet'

  return (
    <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-2">
      {/* Amount Header */}
      {depositAmount && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-[11px] font-medium text-slate-400 ml-3">Deposit Amount</span>
          <div className="flex items-center gap-1.5 font-bold text-white bg-slate-900/80 px-2 py-0.5 rounded-lg border border-slate-800">
            <img src={UsdcIcon} alt={tokenSym} className="w-3.5 h-3.5 object-contain shrink-0" />
            <div className="flex items-center gap-1.5">
              <span className="tabular-nums">{depositAmount}</span>
              <span>{tokenSym}</span>
            </div>
          </div>
        </div>
      )}

      {/* Deposit Flow: Wallet Chain ➔ Circle Gateway */}
      <div
        className={`flex items-center justify-between gap-1.5 p-2 rounded-xl border text-xs ${
          isFailed
            ? 'border-rose-500/25 bg-rose-500/5'
            : 'border-slate-800 bg-slate-900/60'
        }`}
      >
        {/* Source Wallet Chain */}
        <div className="flex items-center gap-1.5 min-w-0">
          <ChainIconBadge chain={sourceChain} size={16} />
          <span className="font-semibold text-slate-200 truncate max-w-[100px]">
            {getChainDisplayName(sourceChain)}
          </span>
        </div>

        {/* Route Arrow */}
        <div className="shrink-0 flex items-center justify-center px-1">
          <ArrowRight
            className={`w-3.5 h-3.5 ${
              isCanceled ? 'text-amber-400' : isFailed ? 'text-rose-400' : 'text-cyan-400'
            }`}
          />
        </div>

        {/* Circle Gateway */}
        <div className="flex items-center gap-1.5 min-w-0 justify-end">
          <img src={CircleIcon} alt="Circle Gateway" className="w-4 h-4 object-contain shrink-0" />
          <span className="font-semibold text-indigo-300 truncate max-w-[120px]">
            Circle Gateway
          </span>
        </div>
      </div>
    </div>
  )
}

/* ========================================================================== */
/* 5. FAUCET BROADCAST TEMPLATE (Testnet Drip Varlıkları)                     */
/* ========================================================================== */
function FaucetBroadcastContent({ details }: { details?: BroadcastDetails }) {
  if (!details) return null

  const tokenSummary = details.faucetTokens || details.fromAmount || ''
  const network = details.network || details.fromChain || 'Arc_Testnet'
  const recipientAddr = details.recipient || details.toSymbol

  return (
    <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-2">
      {/* Network and Tokens Row */}
      <div className="flex items-center justify-between gap-2 text-xs">
        {/* Target Network */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-medium text-slate-400">Network:</span>
          <div className="flex items-center gap-1.5 font-semibold text-slate-200 bg-slate-900/80 px-2 py-0.5 rounded-lg border border-slate-800">
            <ChainIconBadge chain={network} size={15} />
            <span className="truncate max-w-[120px]">{getChainDisplayName(network)}</span>
          </div>
        </div>

        {/* Requested Tokens */}
        {tokenSummary && (
          <div className="flex items-center gap-1.5 font-semibold text-xs text-blue-400">
            <img src={UsdcIcon} alt="Tokens" className="w-3.5 h-3.5 object-contain shrink-0" />
            <span>{tokenSummary}</span>
          </div>
        )}
      </div>

      {/* Recipient Address */}
      {recipientAddr && (
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-[11px] font-medium text-slate-400">Recipient:</span>
          <span className="font-mono text-xs text-slate-300 font-medium truncate">
            {recipientAddr}
          </span>
        </div>
      )}
    </div>
  )
}

/* ========================================================================== */
/* 6. SYSTEM / FALLBACK TEMPLATE                                              */
/* ========================================================================== */
function SystemBroadcastContent({ details }: { details?: BroadcastDetails }) {
  if (!details) return null

  return null
}
