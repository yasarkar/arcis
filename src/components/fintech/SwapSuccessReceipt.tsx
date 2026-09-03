import React, { useState } from 'react'
import { CheckCircle2, ExternalLink, Copy, Check, ArrowRightLeft } from 'lucide-react'

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
  explorerUrl,
  isCrossChain = false,
  onSwapAgain,
  onClose,
  isInline = false,
}) => {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    if (txHash) {
      navigator.clipboard.writeText(txHash)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in text-center py-2" style={{ fontFamily: 'var(--font-app)' }}>
      {/* Animated Glowing Success Icon */}
      <div className="flex justify-center">
        <div className="relative">
          <div className="w-16 h-16 rounded-full bg-indigo-500/15 border border-indigo-500/35 flex items-center justify-center text-indigo-300 shadow-[0_0_24px_rgba(99,102,241,0.25)]">
            <CheckCircle2 className="w-9 h-9 text-indigo-300 animate-pulse" />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-white tracking-wide">
          Swap Confirmed!
        </h3>
        <p className="text-xs text-slate-400 mt-1">
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
        <div className="flex justify-between text-slate-400 text-[11px]">
          <span>Route:</span>
          <span className="text-slate-200 font-medium">
            {isCrossChain ? `${fromChain.replace(/_/g, ' ')} → ${toChain.replace(/_/g, ' ')}` : fromChain.replace(/_/g, ' ')}
          </span>
        </div>

        {txHash && (
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span>Transaction:</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-slate-300">
                {txHash.slice(0, 6)}...{txHash.slice(-4)}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Copy Transaction Hash"
              >
                {copied ? <Check className="w-3 h-3 text-indigo-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2.5 pt-1">
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 py-3 px-3 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] transition-all flex items-center justify-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>EXPLORER</span>
          </a>
        )}
        <button
          type="button"
          onClick={onSwapAgain}
          className="flex-1 py-3 px-3 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>SWAP AGAIN</span>
        </button>
      </div>

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
  )
}
