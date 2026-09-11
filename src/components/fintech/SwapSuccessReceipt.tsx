import React, { useState } from 'react'
import { CheckCircle2, ArrowRightLeft, ArrowUpRightFromSquare, Copy, Check } from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import { getChainIconId, getChainDisplayName } from '../../config/chainMeta'
import { getExplorerTxUrl, getExplorerName } from '../../config/sendConfig'

interface SwapSuccessReceiptProps {
  amountIn: string
  amountOut: string
  tokenIn: string
  tokenOut: string
  tokenInIcon?: string
  tokenOutIcon?: string
  fromChain: string
  toChain: string
  txHash?: string
  destTxHash?: string
  explorerUrl?: string
  isCrossChain?: boolean
  onSwapAgain: () => void
  onClose?: () => void
  isInline?: boolean
  recipient?: string
  rate?: string
  slippage?: string
  speedTier?: string
  fee?: string
}

export const SwapSuccessReceipt: React.FC<SwapSuccessReceiptProps> = ({
  amountIn,
  amountOut,
  tokenIn,
  tokenOut,
  tokenInIcon,
  tokenOutIcon,
  fromChain,
  toChain,
  txHash,
  destTxHash,
  explorerUrl,
  isCrossChain = false,
  onSwapAgain,
  onClose,
  isInline = false,
  recipient,
  rate,
  slippage,
  speedTier,
  fee,
}) => {
  const [copiedRecipient, setCopiedRecipient] = useState(false)

  const handleCopyRecipient = () => {
    if (recipient) {
      navigator.clipboard.writeText(recipient)
      setCopiedRecipient(true)
      setTimeout(() => setCopiedRecipient(false), 2000)
    }
  }

  const fromChainIconId = getChainIconId(fromChain)
  const fromChainDisplayName = getChainDisplayName(fromChain) || fromChain.replace(/_/g, ' ')
  const toChainIconId = getChainIconId(toChain)
  const toChainDisplayName = getChainDisplayName(toChain) || toChain.replace(/_/g, ' ')

  const explorerName = getExplorerName(fromChain)
  const effectiveExplorerUrl = explorerUrl || (txHash ? getExplorerTxUrl(fromChain, txHash) : '#')

  const destExplorerName = getExplorerName(toChain)
  const effectiveDestExplorerUrl = destTxHash ? getExplorerTxUrl(toChain, destTxHash) : '#'

  const computedRate =
    rate ||
    (parseFloat(amountIn) > 0 && parseFloat(amountOut) > 0
      ? `1 ${tokenIn} ≈ ${(parseFloat(amountOut) / parseFloat(amountIn)).toFixed(4)} ${tokenOut}`
      : null)

  return (
    <div className="flex flex-col flex-1 justify-between animate-fade-in text-center py-2" style={{ fontFamily: 'var(--font-app)' }}>
      <div className="space-y-5">
        {/* Animated Glowing Success Icon */}
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-300 shadow-[0_0_24px_rgba(16,185,129,0.25)]">
            <CheckCircle2 className="w-12 h-12 text-emerald-300 animate-pulse" />
          </div>
        </div>

        <div>
          <h3 className="text-2xl font-semibold text-white tracking-wide">
            Swap Finalized!
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            {isCrossChain ? 'Cross-chain transfer initiated via CCTP' : 'Transaction successfully settled onchain'}
          </p>
        </div>

        {/* Amounts Card */}
        <div className="bg-[#121626]/90 border border-white/[0.08] rounded-2xl p-4 text-left space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
            <div className="text-xs text-slate-400">You Paid</div>
            <div className="flex items-center gap-1.5">
              {tokenInIcon && (
                <img src={tokenInIcon} alt={tokenIn} className="w-4 h-4 object-contain rounded-full" />
              )}
              <span className="font-semibold text-sm text-white tabular-nums">
                {amountIn} {tokenIn}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">You Received</div>
            <div className="flex items-center gap-1.5">
              {tokenOutIcon && (
                <img src={tokenOutIcon} alt={tokenOut} className="w-4 h-4 object-contain rounded-full" />
              )}
              <span className="font-semibold text-sm text-indigo-300 tabular-nums">
                {amountOut} {tokenOut}
              </span>
            </div>
          </div>
        </div>

        {/* Tx Details */}
        <div className="bg-[#101323]/60 border border-white/[0.05] rounded-xl p-3 text-xs space-y-2 text-left">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span>Network:</span>
            {isCrossChain ? (
              <div className="flex items-center gap-1.5 text-xs text-slate-200 font-medium">
                <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <NetworkIcon
                    name={fromChainIconId}
                    variant={fromChainIconId === 'solana' ? 'branded' : 'background'}
                    size={16}
                    className="rounded-full"
                  />
                </div>
                <span>{fromChainDisplayName}</span>
                <span className="text-indigo-400 font-bold">→</span>
                <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <NetworkIcon
                    name={toChainIconId}
                    variant={toChainIconId === 'solana' ? 'branded' : 'background'}
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
                    name={fromChainIconId}
                    variant={fromChainIconId === 'solana' ? 'branded' : 'background'}
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
            <span className="text-indigo-300 font-medium">
              {isCrossChain ? 'Cross-Chain CCTP Swap' : 'Arc L1 Direct Swap'}
            </span>
          </div>

          {/* Exchange Rate */}
          {computedRate && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Exchange Rate:</span>
              <span className="text-slate-200 font-mono text-[11px]">
                {computedRate}
              </span>
            </div>
          )}

          {/* Recipient */}
          {recipient && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Recipient:</span>
              <div className="flex items-center gap-1.5 font-mono text-slate-200">
                <span>{recipient.length > 16 ? `${recipient.slice(0, 8)}...${recipient.slice(-6)}` : recipient}</span>
                <button
                  type="button"
                  onClick={handleCopyRecipient}
                  className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Copy Recipient Address"
                >
                  {copiedRecipient ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          )}

          {/* Slippage Tolerance */}
          <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
            <span>Slippage Tolerance:</span>
            <span className="text-slate-200 font-mono text-[11px]">
              {slippage || '0.5%'}
            </span>
          </div>

          {/* Protocol Fee or Priority Tier */}
          {fee ? (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Protocol Fee:</span>
              <span className="text-slate-200 font-mono text-[11px]">
                {fee}
              </span>
            </div>
          ) : speedTier ? (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Priority Tier:</span>
              <span className="text-slate-200 capitalize font-medium">
                {speedTier}
              </span>
            </div>
          ) : null}

          {txHash && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Transaction:</span>
              <a
                href={effectiveExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-1.5 text-slate-200 hover:text-white transition-colors cursor-pointer"
                title={`View transaction on ${explorerName}`}
              >
                <span className="font-medium text-[11px] text-slate-200 group-hover:text-indigo-300 transition-colors">
                  View on {explorerName}
                </span>
                <ArrowUpRightFromSquare className="w-3 h-3 text-indigo-400 group-hover:text-indigo-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </a>
            </div>
          )}

          {destTxHash && isCrossChain && (
            <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
              <span>Dest. Transaction:</span>
              <a
                href={effectiveDestExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-1.5 text-slate-200 hover:text-white transition-colors cursor-pointer"
                title={`View destination transaction on ${destExplorerName}`}
              >
                <span className="font-medium text-[11px] text-slate-200 group-hover:text-indigo-300 transition-colors">
                  View on {destExplorerName}
                </span>
                <ArrowUpRightFromSquare className="w-3 h-3 text-indigo-400 group-hover:text-indigo-300 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mt-auto pt-6 space-y-2">
        <button
          type="button"
          onClick={onSwapAgain}
          className="w-full py-3.5 px-4 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>SWAP AGAIN</span>
        </button>

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
