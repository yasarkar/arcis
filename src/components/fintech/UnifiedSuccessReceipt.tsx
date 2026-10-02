import React, { useState, useMemo } from 'react'
import {
  CheckCircle2,
  Clock3,
  ArrowRightLeft,
  ArrowUpRight,
  Globe,
  ArrowUpRightFromSquare,
  Copy,
  Check,
  Loader2,
  Coins,
  Droplets,
  Sparkles,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import { getChainIconId, getChainDisplayName } from '../../config/chainMeta'
import { getExplorerTxUrl, getExplorerName } from '../../config/sendConfig'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import BtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'

const DEFAULT_TOKEN_ICONS: Record<string, string> = {
  USDC: UsdcIcon,
  EURC: EurcIcon,
  cirBTC: BtcIcon,
  WBTC: BtcIcon,
}

export type ReceiptOperationType = 'send' | 'swap' | 'bridge' | 'deposit' | 'faucet' | 'ai_service'
export type ReceiptVisualStatus = 'success' | 'pending'

export interface UnifiedSuccessReceiptProps {
  type: ReceiptOperationType

  // Header & Controls
  title?: string
  subtitle?: string
  status?: ReceiptVisualStatus
  onActionAgain: () => void
  actionButtonText?: string
  onClose?: () => void
  isInline?: boolean

  // Primary Amounts (Send & Bridge)
  amount?: string
  tokenSymbol?: string
  tokenIcon?: string

  // Swap Amounts
  amountIn?: string
  amountOut?: string
  tokenIn?: string
  tokenOut?: string
  tokenInIcon?: string
  tokenOutIcon?: string

  // Networks & Route
  network?: string
  networkIconId?: string
  sourceChain?: string
  destChain?: string
  sourceChainName?: string
  destChainName?: string
  sourceIconId?: string
  destIconId?: string
  isCrossChain?: boolean

  // Method & Recipient
  method?: string
  mode?: 'direct' | 'gateway' // for bridge
  recipient?: string

  // Hashes & Explorers
  txHash?: string
  sourceTxHash?: string
  destTxHash?: string
  explorerUrl?: string
  sourceExplorerUrl?: string
  destExplorerUrl?: string

  // Fees & Operational Metrics
  fee?: string
  gasFee?: string
  rate?: string
  slippage?: string
  speedTier?: string
  netReceived?: string
  memoText?: string
  memoId?: string
  blockNumber?: string

  // Extra type-specific payload (APY row for deposits, service summary for ai_service calls)
  apy?: string
  serviceSummary?: string

  /** Verified on-chain network fee in USDC (gasUsed × effectiveGasPrice), pre-formatted. */
  actualGasUsdc?: string
}

export const UnifiedSuccessReceipt: React.FC<UnifiedSuccessReceiptProps> = ({
  type,
  title,
  subtitle,
  status = 'success',
  onActionAgain,
  actionButtonText,
  onClose,
  isInline = false,

  // Amounts
  amount,
  tokenSymbol = 'USDC',
  tokenIcon,
  amountIn,
  amountOut,
  tokenIn = 'USDC',
  tokenOut = 'USDC',
  tokenInIcon,
  tokenOutIcon,

  // Networks
  network,
  networkIconId,
  sourceChain,
  destChain,
  sourceChainName,
  destChainName,
  sourceIconId,
  destIconId,
  isCrossChain = false,

  // Method & Recipient
  method,
  mode,
  recipient,

  // Hashes
  txHash,
  sourceTxHash,
  destTxHash,
  explorerUrl,
  sourceExplorerUrl,
  destExplorerUrl,

  // Metrics
  fee,
  gasFee,
  slippage,
  speedTier,
  netReceived,
  memoText,

  // Verified on-chain fee + split
  actualGasUsdc,

  // Extra type-specific payload
  apy,
  serviceSummary,
}) => {
  const [copiedRecipient, setCopiedRecipient] = useState(false)

  const [copiedTxKey, setCopiedTxKey] = useState<string | null>(null)
  const handleCopyRecipient = () => {
    if (recipient) {
      navigator.clipboard.writeText(recipient)
      setCopiedRecipient(true)
      setTimeout(() => setCopiedRecipient(false), 2000)
    }
  }

  const handleCopyTx = (hash: string, key: string) => {
    if (hash) {
      navigator.clipboard.writeText(hash)
      setCopiedTxKey(key)
      setTimeout(() => setCopiedTxKey(null), 2000)
    }
  }

  // Network resolution
  const isGatewayBridge = type === 'bridge' && mode === 'gateway'
  const effectiveSourceChain = sourceChain || network || 'Arc_Testnet'
  const effectiveDestChain = destChain || (isCrossChain ? destChain : undefined)

  const fromChainDisplayName =
    sourceChainName ||
    (network ? getChainDisplayName(network) : null) ||
    getChainDisplayName(effectiveSourceChain) ||
    effectiveSourceChain.replace(/_/g, ' ')

  const toChainDisplayName =
    destChainName ||
    (effectiveDestChain ? getChainDisplayName(effectiveDestChain) || effectiveDestChain.replace(/_/g, ' ') : null)

  const fromChainIcon =
    sourceIconId || networkIconId || getChainIconId(effectiveSourceChain) || 'ethereum'
  const toChainIcon =
    destIconId || (effectiveDestChain ? getChainIconId(effectiveDestChain) || 'ethereum' : null)

  const isMultiChain = Boolean(type === 'bridge' || (type === 'swap' && isCrossChain && toChainDisplayName))

  // Explorers:
  // For Gateway bridge: On-chain transaction is the mint on the destination chain!
  // For Direct CCTP: Primary is the burn on source chain, secondary is mint on dest chain.
  const primaryTxHash = isGatewayBridge ? (txHash || sourceTxHash) : (sourceTxHash || txHash)
  const secondaryTxHash = isGatewayBridge ? undefined : destTxHash

  const sourceExplorerName = getExplorerName(effectiveSourceChain)
  const effectiveSourceExplorerUrl =
    sourceExplorerUrl ||
    (!isGatewayBridge ? explorerUrl : undefined) ||
    (primaryTxHash && !isGatewayBridge ? getExplorerTxUrl(effectiveSourceChain, primaryTxHash) : '#')

  const destExplorerName = effectiveDestChain ? getExplorerName(effectiveDestChain) : null
  const effectiveDestExplorerUrl =
    destExplorerUrl ||
    (isGatewayBridge ? explorerUrl : undefined) ||
    (effectiveDestChain && (isGatewayBridge ? primaryTxHash : secondaryTxHash)
      ? getExplorerTxUrl(effectiveDestChain, (isGatewayBridge ? primaryTxHash : secondaryTxHash)!)
      : '#')

  // Auto Titles and Subtitles
  const defaultTitle =
    title ||
    (type === 'send'
      ? 'Transfer Finalized!'
      : type === 'swap'
        ? 'Swap Finalized!'
        : type === 'bridge'
          ? status === 'pending' ? 'Source Burn Confirmed but Destination Mint Pending.' : 'Bridge Finalized!'
          : type === 'deposit'
            ? 'Deposit Finalized!'
            : type === 'faucet'
              ? 'Faucet Claim Finalized!'
              : 'Service Call Finalized!')

  const defaultSubtitle =
    subtitle ||
    (type === 'send'
      ? 'Transaction successfully broadcasted and confirmed onchain'
      : type === 'swap'
        ? isCrossChain
          ? 'Cross-chain transfer initiated via Circle CCTP'
          : 'Transaction successfully settled onchain'
        : type === 'bridge'
          ? status === 'pending'
            ? 'The burn transaction has been confirmed on the source network, while the mint process on the destination network is currently in progress via Circle CCTP.'
            : mode === 'gateway'
              ? `USDC minted on ${toChainDisplayName || 'destination chain'} via Circle Gateway`
              : `USDC cross-chain delivery finalized on ${toChainDisplayName || 'destination chain'} via Circle CCTP`
          : type === 'deposit'
            ? 'Yield vault deposit confirmed onchain'
            : type === 'faucet'
              ? 'Testnet USDC successfully claimed on Arc'
              : 'AI service executed and settled onchain')

  // Method string
  const effectiveMethod =
    method ||
    (type === 'swap'
      ? isCrossChain
        ? 'Cross-Chain CCTP Swap'
        : 'Arc L1 Direct Swap'
      : type === 'bridge'
        ? mode === 'direct'
          ? 'Direct CCTP Bridge'
          : 'Circle Gateway Fast Transfer'
        : type === 'deposit'
          ? 'Arc Yield Vault Deposit'
          : type === 'faucet'
            ? 'Arc Faucet Claim'
            : type === 'ai_service'
              ? 'x402 AI Service Settlement'
              : 'Arc L1 Direct Transfer')

  // Icons resolution
  const resolvedTokenIcon = tokenIcon || DEFAULT_TOKEN_ICONS[tokenSymbol]
  const resolvedTokenInIcon = tokenInIcon || DEFAULT_TOKEN_ICONS[tokenIn]
  const resolvedTokenOutIcon = tokenOutIcon || DEFAULT_TOKEN_ICONS[tokenOut]

  // Fee display resolution with token name
  const effectiveFeeToken = type === 'swap' ? tokenIn : tokenSymbol
  const feeDisplay = useMemo(() => {
    if (!fee) return null
    const trimmed = String(fee).trim()
    if (!trimmed) return null
    if (/[a-zA-Z%]/.test(trimmed)) {
      return trimmed
    }
    return `${trimmed} ${effectiveFeeToken}`
  }, [fee, effectiveFeeToken])

  // Button config
  const defaultBtnText =
    actionButtonText ||
    (type === 'send'
      ? 'SEND AGAIN'
      : type === 'swap'
        ? 'SWAP AGAIN'
        : type === 'bridge'
          ? 'BRIDGE AGAIN'
          : type === 'deposit'
            ? 'DEPOSIT AGAIN'
            : type === 'faucet'
              ? 'CLAIM AGAIN'
              : 'CALL AGAIN')

  const ActionIcon =
    type === 'send'
      ? ArrowUpRight
      : type === 'swap'
        ? ArrowRightLeft
        : type === 'bridge'
          ? Globe
          : type === 'deposit'
            ? Coins
            : type === 'faucet'
              ? Droplets
              : Sparkles

  return (
    <div
      className="flex flex-col flex-1 justify-between animate-fade-in text-center py-2"
      style={{ fontFamily: 'var(--font-app)' }}
    >
      <div className="space-y-4">
        {/* Status icon: pending must not use success coloring or checkmark. */}
        <div className="flex justify-center">
          <div className={status === 'pending'
            ? 'w-20 h-20 rounded-full bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-300'
            : 'w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-300 shadow-[0_0_24px_rgba(16,185,129,0.25)]'}>
            {status === 'pending' ? <Clock3 className="w-12 h-12 text-amber-300" /> : <CheckCircle2 className="w-12 h-12 text-emerald-300 animate-pulse" />}
          </div>
        </div>

        {/* Title & Subtitle */}
        <div>
          <h3 className="text-2xl font-semibold text-white tracking-wide">{defaultTitle}</h3>
          <p className="text-sm text-slate-400 mt-1">{defaultSubtitle}</p>
        </div>

        {/* ── CARD 1: PRIMARY ASSET SUMMARY CARD ── */}
        <div className="bg-[#121626]/90 border border-white/[0.08] rounded-2xl p-4 text-left space-y-3 shadow-inner">
          {type === 'swap' ? (
            <>
              {/* Swap: You Paid */}
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                <div className="text-xs text-slate-400">You Paid</div>
                <div className="flex items-center gap-1.5">
                  {resolvedTokenInIcon && (
                    <img
                      src={resolvedTokenInIcon}
                      alt={tokenIn}
                      className="w-4 h-4 object-contain rounded-full"
                    />
                  )}
                  <span className="font-semibold text-sm text-white tabular-nums">
                    {amountIn} {tokenIn}
                  </span>
                </div>
              </div>

              {/* Swap: You Received */}
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400">You Received</div>
                <div className="flex items-center gap-1.5">
                  {resolvedTokenOutIcon && (
                    <img
                      src={resolvedTokenOutIcon}
                      alt={tokenOut}
                      className="w-4 h-4 object-contain rounded-full"
                    />
                  )}
                  <span className="font-semibold text-sm text-white tabular-nums">
                    {amountOut} {tokenOut}
                  </span>
                </div>
              </div>
            </>
          ) : type === 'bridge' ? (
            <>
              {/* Bridge: Bridged Amount */}
              <div className={`flex items-center justify-between ${netReceived ? 'pb-3 border-b border-white/[0.06]' : ''}`}>
                <div className="text-xs text-slate-400">Bridged Amount</div>
                <div className="flex items-center gap-1.5">
                  {resolvedTokenIcon && (
                    <img
                      src={resolvedTokenIcon}
                      alt={tokenSymbol}
                      className="w-5 h-5 object-contain rounded-full"
                    />
                  )}
                  <span className="font-semibold text-base text-white tabular-nums">
                    {amount} {tokenSymbol}
                  </span>
                </div>
              </div>

              {/* Bridge: Net Received */}
              {netReceived && (
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">Net Received</div>
                  <div className="flex items-center gap-1.5">
                    {resolvedTokenIcon && (
                      <img
                        src={resolvedTokenIcon}
                        alt={tokenSymbol}
                        className="w-5 h-5 object-contain rounded-full"
                      />
                    )}
                    <span className="font-semibold text-base text-white tabular-nums">
                      {netReceived} {tokenSymbol}
                    </span>
                  </div>
                </div>
              )}
            </>
          ) : type === 'deposit' ? (
            <>
              {/* Deposit: Deposited Amount */}
              <div className={`flex items-center justify-between ${apy ? 'pb-3 border-b border-white/[0.06]' : ''}`}>
                <div className="text-xs text-slate-400">Deposited Amount</div>
                <div className="flex items-center gap-1.5">
                  {resolvedTokenIcon && (
                    <img
                      src={resolvedTokenIcon}
                      alt={tokenSymbol}
                      className="w-5 h-5 object-contain rounded-full"
                    />
                  )}
                  <span className="font-semibold text-base text-white tabular-nums">
                    {amount} {tokenSymbol}
                  </span>
                </div>
              </div>

              {/* Deposit: Vault APY */}
              {apy && (
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">Yield Vault APY</div>
                  <span className="font-semibold text-sm text-emerald-400 tabular-nums">{apy}</span>
                </div>
              )}
            </>
          ) : type === 'faucet' ? (
            <>
              {/* Faucet: Claimed Amount */}
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                <div className="text-xs text-slate-400">Claimed Amount</div>
                <div className="flex items-center gap-1.5">
                  {resolvedTokenIcon && (
                    <img
                      src={resolvedTokenIcon}
                      alt={tokenSymbol}
                      className="w-5 h-5 object-contain rounded-full"
                    />
                  )}
                  <span className="font-semibold text-base text-white tabular-nums">
                    +{amount} {tokenSymbol}
                  </span>
                </div>
              </div>

              {/* Faucet: Recipient (optional) */}
              {recipient && (
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">Recipient</div>
                  <span className="font-mono text-xs text-slate-200">
                    {recipient.length > 16 ? `${recipient.slice(0, 8)}...${recipient.slice(-6)}` : recipient}
                  </span>
                </div>
              )}
            </>
          ) : type === 'ai_service' ? (
            <>
              {/* AI Service: Amount Paid */}
              <div className={`flex items-center justify-between ${serviceSummary ? 'pb-3 border-b border-white/[0.06]' : ''}`}>
                <div className="text-xs text-slate-400">Amount Paid</div>
                <div className="flex items-center gap-1.5">
                  {resolvedTokenIcon && (
                    <img
                      src={resolvedTokenIcon}
                      alt={tokenSymbol}
                      className="w-5 h-5 object-contain rounded-full"
                    />
                  )}
                  <span className="font-semibold text-base text-white tabular-nums">
                    {amount} {tokenSymbol}
                  </span>
                </div>
              </div>

              {/* AI Service: Executed service summary */}
              {serviceSummary && (
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">Service</div>
                  <span
                    className="text-xs font-medium text-indigo-300 truncate max-w-[220px] text-right"
                    title={serviceSummary}
                  >
                    {serviceSummary}
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Send: Sent Amount */}
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                <div className="text-xs text-slate-400">Sent Amount</div>
                <div className="flex items-center gap-1.5">
                  {resolvedTokenIcon && (
                    <img
                      src={resolvedTokenIcon}
                      alt={tokenSymbol}
                      className="w-5 h-5 object-contain rounded-full"
                    />
                  )}
                  <span className="font-semibold text-base text-white tabular-nums">
                    {amount} {tokenSymbol}
                  </span>
                </div>
              </div>

              {/* Send: Recipient */}
              {recipient && (
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">Recipient</div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-slate-200">
                      {recipient.length > 16
                        ? `${recipient.slice(0, 8)}...${recipient.slice(-6)}`
                        : recipient}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyRecipient}
                      className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                      {copiedRecipient ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── CARD 2: TRANSACTION METADATA & DETAILS ── */}
        <div className="bg-[#101323]/60 border border-white/[0.05] rounded-xl p-3 text-xs space-y-2 text-left">
          {/* Network / Route */}
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span>{isMultiChain ? 'Route:' : 'Network:'}</span>
            {isMultiChain && toChainDisplayName ? (
              <div className="flex items-center gap-1.5 text-xs text-slate-200 font-medium">
                <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <NetworkIcon
                    name={fromChainIcon}
                    variant={fromChainIcon === 'solana' ? 'branded' : 'background'}
                    size={16}
                    className="rounded-full"
                  />
                </div>
                <span>{fromChainDisplayName}</span>
                <span className="text-indigo-400 font-bold">→</span>
                <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <NetworkIcon
                    name={toChainIcon || 'ethereum'}
                    variant={toChainIcon === 'solana' ? 'branded' : 'background'}
                    size={16}
                    className="rounded-full"
                  />
                </div>
                <span>{toChainDisplayName}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <NetworkIcon
                    name={fromChainIcon}
                    variant={fromChainIcon === 'solana' ? 'branded' : 'background'}
                    size={16}
                    className="rounded-full"
                  />
                </div>
                <span className="text-slate-200 font-medium">{fromChainDisplayName}</span>
              </div>
            )}
          </div>

          {/* Execution Method */}
          <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
            <span>Method:</span>
            <span className="text-indigo-300 font-medium">{effectiveMethod}</span>
          </div>

          {/* Recipient in Card 2 (for Swap & Bridge where not in Card 1) */}
          {type !== 'send' && recipient && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Recipient:</span>
              <div className="flex items-center gap-1.5 font-mono text-slate-200">
                <span>
                  {recipient.length > 16
                    ? `${recipient.slice(0, 8)}...${recipient.slice(-6)}`
                    : recipient}
                </span>
                <button
                  type="button"
                  onClick={handleCopyRecipient}
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  {copiedRecipient ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Slippage Tolerance (Swap) */}
          {slippage && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Slippage Tolerance:</span>
              <span className="text-slate-200 font-mono text-[11px]">{slippage}</span>
            </div>
          )}

          {/* Fee / Gas Fee / Speed Tier */}
          {feeDisplay ? (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>{type === 'bridge' ? 'Bridge Fee:' : 'Protocol Fee:'}</span>
              <span className="text-slate-200 font-mono text-[11px]">{feeDisplay}</span>
            </div>
          ) : gasFee ? (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Network Fee:</span>
              <span className="text-indigo-300 font-medium">{gasFee}</span>
            </div>
          ) : speedTier ? (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Priority Tier:</span>
              <span className="text-slate-200 capitalize font-medium">{speedTier}</span>
            </div>
          ) : null}

          {/* Actual on-chain network fee (Copilot receipts) */}
          {actualGasUsdc != null && (
            <div
              className="text-slate-400 text-[11px] pt-1 border-t border-white/[0.04] space-y-1"
              title="Exact fee paid on-chain, read from the transaction receipt (gasUsed × effectiveGasPrice) — matches ArcScan. Sponsored transactions may not deduct this from your wallet."
            >
              <div className="flex items-center justify-between">
                <span>Network Fee:</span>
                <span className="text-slate-200 font-mono text-[11px]">{actualGasUsdc} USDC</span>
              </div>
            </div>
          )}

          {/* Memo (Send) */}
          {memoText && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Memo:</span>
              <span
                className="text-indigo-300 font-medium truncate max-w-[220px]"
                title={memoText}
              >
                {memoText}
              </span>
            </div>
          )}

          {/* Gateway Bridge: Single Destination Mint Transaction */}
          {/* Gateway Bridge: Single Destination Mint Transaction */}
          {isGatewayBridge ? (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Transaction:</span>
              {primaryTxHash && primaryTxHash.startsWith('0x') ? (
                <div className="flex items-center gap-1.5">
                  <a
                    href={effectiveDestExplorerUrl !== '#' ? effectiveDestExplorerUrl : getExplorerTxUrl(effectiveDestChain || 'Base_Sepolia', primaryTxHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center gap-1 text-slate-200 hover:text-white transition-colors cursor-pointer ml-0.5"
                  >
                    <span className="font-medium text-[11px] text-slate-200 group-hover:text-indigo-300 transition-colors">
                      {destExplorerName}
                    </span>
                    <ArrowUpRightFromSquare className="w-3 h-3 group-hover:text-indigo-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </a>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-indigo-400 bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-500/20 font-mono">
                    <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                    Pending...
                  </span>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Primary Transaction Hash Link (Source / Single Chain) */}
              {primaryTxHash && primaryTxHash.startsWith('0x') ? (
                <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
                  <span>{isMultiChain ? (type === 'bridge' ? 'Source Burn Tx:' : 'Source Transaction:') : 'Transaction:'}</span>
                  <div className="flex items-center gap-1.5">
                    <a
                      href={effectiveSourceExplorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-center gap-1.5 text-slate-200 hover:text-white transition-colors cursor-pointer ml-0.5"
                    >
                      <span className="font-mono text-[11px] text-cyan-400 group-hover:text-cyan-300 font-semibold transition-colors">
                        {primaryTxHash.slice(0, 8)}...{primaryTxHash.slice(-6)}
                      </span>
                      <span className="font-medium text-[11px] text-slate-400 group-hover:text-indigo-300 transition-colors">
                        ({sourceExplorerName})
                      </span>
                      <ArrowUpRightFromSquare className="w-3 h-3 group-hover:text-indigo-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    </a>
                  </div>
                </div>
              ) : type === 'bridge' ? (
                <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
                  <span>Source Burn Tx:</span>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-indigo-400 bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-500/20 font-mono">
                      <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                      Pending...
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Secondary / Destination Transaction Hash Link */}
              {isMultiChain && destExplorerName && (
                <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
                  <span>{type === 'bridge' ? 'Destination Mint Tx:' : 'Destination Transaction:'}</span>
                  {secondaryTxHash && secondaryTxHash.startsWith('0x') ? (
                    <div className="flex items-center gap-1.5">
                      <a
                        href={effectiveDestExplorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex items-center gap-1.5 text-slate-200 hover:text-white transition-colors cursor-pointer ml-0.5"
                      >
                        <span className="font-mono text-[11px] text-cyan-400 group-hover:text-cyan-300 font-semibold transition-colors">
                          {secondaryTxHash.slice(0, 8)}...{secondaryTxHash.slice(-6)}
                        </span>
                        <span className="font-medium text-[11px] text-slate-400 group-hover:text-indigo-300 transition-colors">
                          ({destExplorerName})
                        </span>
                        <ArrowUpRightFromSquare className="w-3 h-3 group-hover:text-indigo-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                      </a>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-indigo-400 bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-500/20 font-mono">
                        <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                        Pending...
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── CARD FOOTER: ACTION BUTTONS ── */}
      <div className="mt-auto pt-5 space-y-2">
        {status === 'pending' ? (
          <div className="w-full py-3.5 px-4 rounded-xl text-xs font-semibold text-amber-200 bg-amber-500/10 border border-amber-500/25 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Awaiting Destination Confirmation</span>
          </div>
        ) : <button
          type="button"
          onClick={onActionAgain}
          className="w-full py-3.5 px-4 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <ActionIcon className="w-3.5 h-3.5" />
          <span>{defaultBtnText}</span>
        </button>}

        {!isInline && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-full text-center text-xs text-slate-400 hover:text-white py-1 transition-colors cursor-pointer"
          >
            Close
          </button>
        )}
      </div>
    </div>
  )
}
