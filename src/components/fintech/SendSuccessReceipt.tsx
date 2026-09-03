import React, { useState } from 'react'
import { CheckCircle2, ExternalLink, Copy, Check, ArrowUpRight } from 'lucide-react'

interface SendSuccessReceiptProps {
  amount: string
  tokenSymbol: string
  tokenIcon?: string
  recipient: string
  network: string
  txHash?: string
  explorerUrl?: string
  gasFee?: string
  blockNumber?: string
  memoText?: string
  memoId?: string
  onSendAgain: () => void
  onClose?: () => void
  isInline?: boolean
}

export const SendSuccessReceipt: React.FC<SendSuccessReceiptProps> = ({
  amount,
  tokenSymbol,
  tokenIcon,
  recipient,
  network,
  txHash,
  explorerUrl,
  gasFee,
  memoText,
  memoId,
  onSendAgain,
  onClose,
  isInline = false,
}) => {
  const [copiedTx, setCopiedTx] = useState(false)
  const [copiedRecipient, setCopiedRecipient] = useState(false)

  const handleCopyTx = () => {
    if (txHash) {
      navigator.clipboard.writeText(txHash)
      setCopiedTx(true)
      setTimeout(() => setCopiedTx(false), 2000)
    }
  }

  const handleCopyRecipient = () => {
    if (recipient) {
      navigator.clipboard.writeText(recipient)
      setCopiedRecipient(true)
      setTimeout(() => setCopiedRecipient(false), 2000)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in text-center py-2" style={{ fontFamily: 'var(--font-app)' }}>
      {/* Glowing Checkmark */}
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full bg-indigo-500/15 border border-indigo-500/35 flex items-center justify-center text-indigo-300 shadow-[0_0_24px_rgba(99,102,241,0.25)]">
          <CheckCircle2 className="w-9 h-9 text-indigo-300 animate-pulse" />
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-white tracking-wide">
          Transfer Finalized!
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          Transaction successfully broadcasted and confirmed onchain
        </p>
      </div>

      {/* Amount Card */}
      <div className="bg-[#121626]/90 border border-white/[0.08] rounded-2xl p-4 text-left space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div className="text-xs text-slate-400">Sent Amount</div>
          <div className="flex items-center gap-1.5">
            {tokenIcon && (
              <img src={tokenIcon} alt={tokenSymbol} className="w-5 h-5 object-contain rounded-full" />
            )}
            <span className="font-semibold text-base text-white tabular-nums">
              {amount} {tokenSymbol}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-400">Recipient</div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-slate-200">
              {recipient.length > 16 ? `${recipient.slice(0, 8)}...${recipient.slice(-6)}` : recipient}
            </span>
            <button
              type="button"
              onClick={handleCopyRecipient}
              className="text-slate-400 hover:text-white transition-colors cursor-pointer"
              title="Copy Recipient Address"
            >
              {copiedRecipient ? <Check className="w-3 h-3 text-indigo-400" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
        </div>
      </div>

      {/* Details Box */}
      <div className="bg-[#101323]/60 border border-white/[0.05] rounded-xl p-3 text-xs space-y-2 text-left">
        <div className="flex justify-between text-slate-400 text-[11px]">
          <span>Network:</span>
          <span className="text-slate-200 font-medium">{network.replace(/_/g, ' ')}</span>
        </div>

        {gasFee && (
          <div className="flex justify-between text-slate-400 text-[11px]">
            <span>Network Fee:</span>
            <span className="text-indigo-300 font-medium">{gasFee}</span>
          </div>
        )}

        {memoText && (
          <div className="flex justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
            <span>Memo:</span>
            <span className="text-indigo-300 font-medium truncate max-w-[200px]">
              {memoText} {memoId ? `(${memoId})` : ''}
            </span>
          </div>
        )}

        {txHash && (
          <div className="flex items-center justify-between text-slate-400 text-[11px] pt-1 border-t border-white/[0.04]">
            <span>Transaction:</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-slate-300">
                {txHash.slice(0, 8)}...{txHash.slice(-6)}
              </span>
              <button
                type="button"
                onClick={handleCopyTx}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Copy Transaction Hash"
              >
                {copiedTx ? <Check className="w-3 h-3 text-indigo-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
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
          onClick={onSendAgain}
          className="flex-1 py-3 px-3 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 shadow-md shadow-indigo-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <ArrowUpRight className="w-3.5 h-3.5" />
          <span>SEND AGAIN</span>
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
