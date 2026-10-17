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
  Sparkles,
} from 'lucide-react'
import { ChainIcon } from '../common/ChainIcon'
import { getChainIconId, getChainDisplayName } from '../../config/chainMeta'
import { getExplorerTxUrl, getExplorerName } from '../../config/sendConfig'
import { formatSubscriptZero } from '../../utils/formatNumber'
import { TOKEN_ICON_MAP } from '../../config/tokenIcons'

export function resolveReceiptTokenIcon(symbol?: string, explicitIcon?: string): string | undefined {
  const clean = symbol?.trim()
  const upper = clean?.toUpperCase()

  // Guard against Circle corporate logo mistakenly passed for cirBTC/BTC/WBTC
  if (upper && (upper === 'CIRBTC' || upper === 'BTC' || upper === 'WBTC')) {
    if (explicitIcon && !explicitIcon.includes('CIRCLE') && !explicitIcon.includes('circle')) {
      return explicitIcon
    }
    return TOKEN_ICON_MAP.cirBTC
  }

  if (explicitIcon) return explicitIcon
  if (!clean) return undefined

  if (TOKEN_ICON_MAP[clean]) return TOKEN_ICON_MAP[clean]
  if (upper && TOKEN_ICON_MAP[upper]) return TOKEN_ICON_MAP[upper]
  if (upper === 'WBTC' || upper === 'BTC') return TOKEN_ICON_MAP.cirBTC
  if (upper === 'WETH' || upper === 'ETH') return TOKEN_ICON_MAP.WETH
  if (upper === 'USDC') return TOKEN_ICON_MAP.USDC
  if (upper === 'EURC') return TOKEN_ICON_MAP.EURC

  const foundKey = Object.keys(TOKEN_ICON_MAP).find((k) => k.toLowerCase() === clean.toLowerCase())
  if (foundKey) return TOKEN_ICON_MAP[foundKey]

  return undefined
}

export type ReceiptOperationType = 'send' | 'swap' | 'bridge' | 'deposit' | 'ai_service' | 'faucet'
export type ReceiptVisualStatus = 'success' | 'pending'

export interface UnifiedSuccessReceiptProps {
  type: ReceiptOperationType

  // Header & Controls
  title?: string
  /**
   * Optional second headline line rendered directly beneath `title` with the
   * SAME headline styling, so a two-line pending state (e.g. "Bridge Pending" /
   * "Destination Confirmation Required") reads as one main title instead of a
   * long single line.
   */
  titleSubline?: string
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
  connectedAddress?: string
  userAddress?: string

  // Hashes & Explorers
  txHash?: string
  sourceTxHash?: string
  destTxHash?: string
  explorerUrl?: string
  sourceExplorerUrl?: string
  destExplorerUrl?: string

  // Fees & Operational Metrics
  fee?: string
  /** Platform fee for the chosen speed tier (e.g. Arcis) shown as its own row, separate from gas. */
  platformFee?: string
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

  // Real network fees read from the mined receipt (gasUsed × effectiveGasPrice).
  /** Exact fee the network charged for the primary transaction, pre-formatted with its currency. */
  networkFee?: string
  /**
   * Verified gas fee the destination chain charged for the bridge mint,
   * pre-formatted in that chain's native currency (e.g. ETH on Base, USDC on
   * Arc), read from the mint transaction's receipt — bridge receipts only.
   */
  destinationFee?: string
  /**
   * True when the source leg is an off-chain EIP-712 authorization (a Gateway
   * burn intent): no transaction is submitted on the source chain, so there is
   * no source gas to read from a receipt. Renders the source fee row as
   * 0.00 (gasless) instead of hiding it.
   */
  sourceFeeGasless?: boolean
  /** Exact fee the network charged for a separate approval transaction, when one was needed. */
  approvalFee?: string
  /** True when the gas was paid by a sponsorer (Circle Gas Station) instead of the user. */
  feeSponsored?: boolean
}

export const UnifiedSuccessReceipt: React.FC<UnifiedSuccessReceiptProps> = ({
  type,
  title,
  titleSubline,
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
  connectedAddress,
  userAddress,

  // Hashes
  txHash,
  sourceTxHash,
  destTxHash,
  explorerUrl,
  sourceExplorerUrl,
  destExplorerUrl,

  // Metrics
  fee,
  platformFee,
  gasFee,
  rate,
  slippage,
  speedTier,
  netReceived,
  memoText,

  // Verified on-chain fee + split
  actualGasUsdc,
  networkFee,
  destinationFee,
  sourceFeeGasless = false,
  approvalFee,
  feeSponsored = false,

  // Extra type-specific payload
  apy,
  serviceSummary,
}) => {
  const [copiedRecipient, setCopiedRecipient] = useState(false)

  const handleCopyRecipient = () => {
    if (recipient) {
      navigator.clipboard.writeText(recipient)
      setCopiedRecipient(true)
      setTimeout(() => setCopiedRecipient(false), 2000)
    }
  }

  // Recipient visibility rule: Only display the recipient address when sending / bridging / swapping
  // to an external destination wallet that is different from the currently connected wallet.
  const effectiveConnectedAddress = (connectedAddress || userAddress)?.trim()
  const isExternalRecipient = useMemo(() => {
    if (!recipient || !recipient.trim()) return false
    if (!effectiveConnectedAddress) return true
    return recipient.trim().toLowerCase() !== effectiveConnectedAddress.toLowerCase()
  }, [recipient, effectiveConnectedAddress])

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
              ? 'Faucet Claim Completed Successfully'
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
              ? 'Testnet funds successfully credited to your wallet'
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
            ? 'Arc Testnet Faucet Mint'
            : type === 'ai_service'
              ? 'x402 AI Service Settlement'
              : 'Arc L1 Direct Transfer')

  // Icons resolution
  const resolvedTokenIcon = resolveReceiptTokenIcon(tokenSymbol, tokenIcon)
  const resolvedTokenInIcon = resolveReceiptTokenIcon(tokenIn, tokenInIcon)
  const resolvedTokenOutIcon = resolveReceiptTokenIcon(tokenOut, tokenOutIcon)

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

  // Clean Network Fee display (strips any verbose "(Base: ... + Priority: ...)" breakdown)
  const displayGasFee = useMemo(() => {
    if (!gasFee) return null
    return String(gasFee).replace(/\s*\([^)]*Base:[^)]*\)/i, '').trim()
  }, [gasFee])

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
            : Sparkles

  // Source fee row: a real receipt-read gas value whenever one exists. A Gateway
  // route has no source-side transaction at all (off-chain EIP-712 burn intent),
  // so the row states 0.00 (gasless) with the reason instead of disappearing.
  const showSourceFeeRow = Boolean(networkFee) || (sourceFeeGasless && type === 'bridge')
  const sourceFeeLabel = type === 'bridge' ? 'Source Network Fee:' : 'Network Fee:'

  // Cap Network Fee to at most 5 decimal places (UX precision requirement)
  const formattedNetworkFee = useMemo(() => {
    if (!networkFee) return networkFee
    return networkFee.replace(/(\d+)\.(\d{6,})/g, (_m, intPart, decPart) => {
      const rounded = (Math.round(parseFloat(`${intPart}.${decPart}`) * 1e5) / 1e5).toFixed(5)
      return parseFloat(rounded).toString()
    })
  }, [networkFee])

  const sourceFeeValue = (type === 'bridge' ? networkFee : formattedNetworkFee) ?? '0.00 USDC'
  const sourceFeeTooltip = networkFee
    ? type === 'bridge'
      ? 'Actual gas paid for the source-chain bridge transaction, read from its mined receipt (gasUsed × effectiveGasPrice).'
      : 'Exact fee charged by the network for this transaction, read from the mined receipt (gasUsed × effectiveGasPrice) — matches the block explorer.'
    : 'Gateway Fast Transfer authorizes the source burn with an off-chain EIP-712 burn intent: your wallet never submits a source-chain transaction, so you pay no source gas. The mint gas actually paid on the destination chain is shown as the Destination Network Fee.'

  const formattedActualGasUsdc = useMemo(() => {
    if (actualGasUsdc == null) return null
    return String(actualGasUsdc).replace(/(\d+)\.(\d{7,})/g, (_m, intPart, decPart) => {
      const rounded = (Math.round(parseFloat(`${intPart}.${decPart}`) * 1e6) / 1e6).toFixed(6)
      return parseFloat(rounded).toString()
    })
  }, [actualGasUsdc])

  return (
    <div
      className={`flex flex-col animate-fade-in text-center ${isInline ? 'py-1' : 'py-2'}`}
      style={{ fontFamily: 'var(--font-app)' }}
    >
      <div className={isInline ? 'space-y-3.5' : 'space-y-4'}>
        {/* Status icon: pending must not use success coloring or checkmark. */}
        <div className="flex justify-center">
          <div className={status === 'pending'
            ? `${isInline ? 'w-16 h-16 sm:w-20 sm:h-20' : 'w-20 h-20'} rounded-full bg-amber-500/15 border border-amber-500/35 flex items-center justify-center text-amber-300`
            : `${isInline ? 'w-16 h-16 sm:w-20 sm:h-20 shadow-[0_0_20px_rgba(16,185,129,0.25)]' : 'w-20 h-20 shadow-[0_0_24px_rgba(16,185,129,0.25)]'} rounded-full bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-300`}>
            {status === 'pending' ? (
              <Clock3 className={`${isInline ? 'w-8 h-8 sm:w-11 sm:h-11' : 'w-12 h-12'} text-amber-300`} />
            ) : (
              <CheckCircle2 className={`${isInline ? 'w-8 h-8 sm:w-11 sm:h-11' : 'w-12 h-12'} text-emerald-300 animate-pulse`} />
            )}
          </div>
        </div>

        {/* Title & Subtitle */}
        <div>
          <h3 className={`${isInline ? 'text-xl sm:text-2xl font-bold' : 'text-2xl sm:text-3xl font-bold'} text-white tracking-wide`}>
            {defaultTitle}
            {titleSubline && <span className="block mt-1 text-sm sm:text-base font-medium">{titleSubline}</span>}
          </h3>
          <p className={`${isInline ? 'text-sm mt-1' : 'text-sm sm:text-base mt-1.5'} text-slate-300/85 leading-relaxed`}>{defaultSubtitle}</p>
        </div>

        {/* ── CARD 1: PRIMARY ASSET SUMMARY CARD ── */}
        <div className={`bg-[#121626]/90 border border-white/[0.08] ${isInline ? 'rounded-xl p-3 space-y-2' : 'rounded-2xl p-4 space-y-3'} text-left shadow-inner`}>
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
                      className="w-5 h-5 object-contain rounded-full"
                    />
                  )}
                  <span className="font-semibold text-sm text-white tabular-nums" title={amountIn ? String(amountIn) : undefined}>
                    {formatSubscriptZero(amountIn)} {tokenIn}
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
                      className="w-5 h-5 object-contain rounded-full"
                    />
                  )}
                  <span className="font-semibold text-sm text-white tabular-nums" title={amountOut ? String(amountOut) : undefined}>
                    {formatSubscriptZero(amountOut)} {tokenOut}
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
                  <span className="font-semibold text-base text-white tabular-nums" title={amount ? String(amount) : undefined}>
                    {formatSubscriptZero(amount)} {tokenSymbol}
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
                    <span className="font-semibold text-base text-white tabular-nums" title={netReceived ? String(netReceived) : undefined}>
                      {formatSubscriptZero(netReceived)} {tokenSymbol}
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
                  <span className="font-semibold text-base text-white tabular-nums" title={amount ? String(amount) : undefined}>
                    {formatSubscriptZero(amount)} {tokenSymbol}
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
                  <span className="font-semibold text-base text-white tabular-nums" title={amount ? String(amount) : undefined}>
                    {formatSubscriptZero(amount)} {tokenSymbol}
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
          ) : type === 'faucet' ? (
            <>
              {/* Faucet: Claimed Amount */}
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-400">Claimed Amount</div>
                <div className="flex items-center gap-1.5">
                  {resolvedTokenIcon && (
                    <img
                      src={resolvedTokenIcon}
                      alt={tokenSymbol}
                      className="w-5 h-5 object-contain rounded-full"
                    />
                  )}
                  <span className="font-semibold text-base text-emerald-400 tabular-nums" title={amount ? String(amount) : undefined}>
                    +{amount ? String(amount) : '0'} {tokenSymbol}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Send: Sent Amount */}
              <div className={`flex items-center justify-between ${isExternalRecipient ? (isInline ? 'pb-2 border-b border-white/[0.06]' : 'pb-3 border-b border-white/[0.06]') : ''}`}>
                <div className="text-xs text-slate-400">Sent Amount</div>
                <div className="flex items-center gap-1.5">
                  {resolvedTokenIcon && (
                    <img
                      src={resolvedTokenIcon}
                      alt={tokenSymbol}
                      className="w-5 h-5 object-contain rounded-full"
                    />
                  )}
                  <span className={`font-semibold ${isInline ? 'text-sm' : 'text-base'} text-white tabular-nums`} title={amount ? String(amount) : undefined}>
                    {formatSubscriptZero(amount)} {tokenSymbol}
                  </span>
                </div>
              </div>

              {/* Send: Recipient (shown only when sending to an external wallet) */}
              {isExternalRecipient && recipient && (
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
        <div className={`bg-[#101323]/60 border border-white/[0.05] rounded-xl ${isInline ? 'p-2.5 space-y-1.5' : 'p-3 space-y-2'} text-xs text-left`}>
          {/* Network / Route */}
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span>{isMultiChain ? 'Route:' : 'Network:'}</span>
            {isMultiChain && toChainDisplayName ? (
              <div className="flex items-center gap-1.5 text-xs text-slate-200 font-medium">
                <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <ChainIcon
                    chainKeyOrIconId={effectiveSourceChain || fromChainIcon}
                    name={fromChainDisplayName}
                    size={16}
                    className="rounded-full"
                  />
                </div>
                <span>{fromChainDisplayName}</span>
                <span className="text-indigo-400 font-bold">→</span>
                <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <ChainIcon
                    chainKeyOrIconId={effectiveDestChain || toChainIcon || 'ethereum'}
                    name={toChainDisplayName}
                    size={16}
                    className="rounded-full"
                  />
                </div>
                <span>{toChainDisplayName}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <ChainIcon
                    chainKeyOrIconId={effectiveSourceChain || fromChainIcon}
                    name={fromChainDisplayName}
                    size={16}
                    className="rounded-full"
                  />
                </div>
                <span className="text-slate-200 font-medium">{fromChainDisplayName}</span>
              </div>
            )}
          </div>

          {/* Execution Method — the mechanism the receipt actually settled through
              (e.g. "Circle Gateway Deposit", "x402 AI Service Settlement"). */}
          <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
            <span>Method:</span>
            <span className="text-slate-200 font-medium">{effectiveMethod}</span>
          </div>

          {/* Recipient in Card 2 (shown only when sending/bridging/swapping to an external wallet) */}
          {type !== 'send' && isExternalRecipient && recipient && (
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

          {/* Exchange Rate (Swap) — was declared as a prop but never rendered (fix #8) */}
          {type === 'swap' && rate && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Exchange Rate:</span>
              <span className="text-slate-200 font-mono text-[11px]">{rate}</span>
            </div>
          )}

          {/* Slippage Tolerance (Swap) */}
          {slippage && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Slippage Tolerance:</span>
              <span className="text-slate-200 font-mono text-[11px]">{slippage}</span>
            </div>
          )}

          {/* Bridge receipts never render a protocol-fee row: Circle's CCTP fee is
              already reflected in Net Received, and the Bridge Fee row was removed
              from the receipt per product decision. A bridge receipt shows at most
              Platform Fee, the source-chain Network Fee, and the verified
              Destination Network Fee read from the destination mint. */}
          {/* Protocol Fee (non-bridge receipts only) */}
          {type !== 'bridge' && feeDisplay && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Protocol Fee:</span>
              <span className="text-slate-200 font-mono text-[11px]">
                {(() => {
                  const match = feeDisplay.match(/^(.*?)\s*(\([^)]+%\))$/)
                  if (match) {
                    return (
                      <>
                        <span>{match[1]}</span>{' '}
                        <span className="text-slate-200 font-mono text-[11px]">{match[2]}</span>
                      </>
                    )
                  }
                  return feeDisplay
                })()}
              </span>
            </div>
          )}

          {/* Fallback displayGasFee if showSourceFeeRow is not active */}
          {!showSourceFeeRow && displayGasFee && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Network Fee:</span>
              <span className="text-slate-200 font-medium">{displayGasFee}</span>
            </div>
          )}

          {/* Priority Tier (Swap) — the speed tier the user paid for. */}
          {speedTier && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Priority Tier:</span>
              <span className="text-slate-200 capitalize font-medium">{speedTier}</span>
            </div>
          )}

          {/* Platform fee — its own stacked row, matching every other receipt.
              A Gateway Fast bridge never carries one: it is a route Circle and Arc
              provide end to end, so the row is suppressed here no matter which
              caller renders the receipt. */}
          {platformFee && !isGatewayBridge && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Platform Fee:</span>
              <span className="text-slate-200 font-mono text-[11px]">{platformFee}</span>
            </div>
          )}

          {/* Actual on-chain network fee (Copilot receipts) */}
          {actualGasUsdc != null && (
            <div
              className="text-slate-400 text-[11px] pt-1 border-t border-white/[0.04] space-y-1"
              title="Exact fee paid on-chain, read from the transaction receipt (gasUsed × effectiveGasPrice) — matches ArcScan. Sponsored transactions may not deduct this from your wallet."
            >
              <div className="flex items-center justify-between">
                <span>Network Fee:</span>
                <span className="text-slate-200 font-mono text-[11px]">{formattedActualGasUsdc} USDC</span>
              </div>
            </div>
          )}

          {/* Network fee — exact fee for receipt-verified sends; bridge receipts
              carry the real gas paid on the source transaction (resolved from its
              mined receipt), never an estimate. */}
          {showSourceFeeRow ? (
            <div
              className="text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]"
              title={sourceFeeTooltip}
            >
              <div className="flex items-center justify-between">
                <span>{sourceFeeLabel}</span>
                <span className="text-slate-200 font-mono text-[11px]">{sourceFeeValue}</span>
              </div>
            </div>
          ) : feeSponsored ? (
            <div
              className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]"
              title="Gas for this deposit was paid by the sponsorer (Circle Gas Station paymaster), so nothing was deducted from your wallet."
            >
              <span>Network Fee:</span>
              <span className="text-emerald-300 font-medium">Sponsored</span>
            </div>
          ) : null}

          {/* Destination-chain fee — the real gas charged for the destination
              mint, in the destination chain's native token, resolved from the
              mined mint receipt exactly like the source Network Fee. Shown only
              once the mint is verified; never an estimate. */}
          {destinationFee && (
            <div
              className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]"
              title="Actual gas the destination chain charged for the mint transaction, read from its mined receipt (gasUsed × effectiveGasPrice). Forwarded transfers have this mint submitted and paid by Circle's Forwarding Service."
            >
              <span>Destination Network Fee:</span>
              <span className="text-slate-200 font-mono text-[11px]">{destinationFee}</span>
            </div>
          )}

          {/* Real network fee paid by the separate ERC-20 approval transaction */}
          {approvalFee && (
            <div
              className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]"
              title="Exact fee charged by the network for the token approval transaction, read from its mined receipt."
            >
              <span>Approval Fee:</span>
              <span className="text-slate-200 font-mono text-[11px]">{approvalFee}</span>
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
                    <span className="font-medium text-[11px] text-slate-200 group-hover:text-indigo-400 transition-colors">
                      {destExplorerName}
                    </span>
                    <ArrowUpRightFromSquare className="w-3 h-3 text-slate-400 group-hover:text-indigo-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
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
                      className="group flex items-center gap-1 text-slate-200 hover:text-white transition-colors cursor-pointer ml-0.5"
                    >
                      <span className="font-medium text-[11px] text-slate-200 group-hover:text-indigo-400 transition-colors">
                        {sourceExplorerName}
                      </span>
                      <ArrowUpRightFromSquare className="w-3 h-3 text-slate-400 group-hover:text-indigo-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
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
                        className="group flex items-center gap-1 text-slate-200 hover:text-white transition-colors cursor-pointer ml-0.5"
                      >
                        <span className="font-medium text-[11px] text-slate-200 group-hover:text-indigo-400 transition-colors">
                          {destExplorerName}
                        </span>
                        <ArrowUpRightFromSquare className="w-3 h-3 text-slate-400 group-hover:text-indigo-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
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
      <div className={`${isInline ? 'mt-4 pt-1 space-y-1.5' : 'mt-5 pt-1 space-y-2'}`}>
        {status === 'pending' ? (
          <div className={`w-full ${isInline ? 'py-2.5 px-3' : 'py-3.5 px-4'} rounded-xl text-xs font-semibold text-amber-200 bg-amber-500/10 border border-amber-500/25 flex items-center justify-center gap-2`}>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Awaiting Destination Confirmation</span>
          </div>
        ) : <button
          type="button"
          onClick={onActionAgain}
          className={`w-full ${isInline ? 'py-2.5 px-3' : 'py-3.5 px-4'} rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer`}
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
