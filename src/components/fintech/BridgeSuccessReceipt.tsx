import React, { useState } from 'react'
import { CheckCircle2, ExternalLink, Copy, Check, Globe } from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'

interface BridgeSuccessReceiptProps {
  amount: string
  sourceChain: string
  destChain: string
  sourceChainName: string
  destChainName: string
  sourceIconId: string
  destIconId: string
  recipient: string
  mode: 'direct' | 'gateway'
  txHash?: string
  explorerUrl?: string
  fee?: string
  netReceived?: string
  onBridgeAgain: () => void
  onClose?: () => void
  isInline?: boolean
}

export const BridgeSuccessReceipt: React.FC<BridgeSuccessReceiptProps> = ({
  amount,
  sourceChainName,
  destChainName,
  sourceIconId,
  destIconId,
  recipient,
  mode,
  txHash,
  explorerUrl,
  fee,
  netReceived,
  onBridgeAgain,
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
          Bridge Finalized!
        </h3>
        <p className="text-xs text-slate-400 mt-1">
          {mode === 'gateway'
            ? 'Instant cross-chain transfer completed via Circle Gateway'
            : 'Cross-chain transfer successfully initiated via Circle CCTP'}
        </p>
      </div>

      {/* Details Card */}
      <div className="bg-[#121626]/90 border border-white/[0.08] rounded-2xl p-4 text-left space-y-3">
        {/* Amount */}
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div className="text-xs text-slate-400">Bridged Amount</div>
          <div className="flex items-center gap-1.5">
            <img src={UsdcIcon} alt="USDC" className="w-5 h-5 object-contain rounded-full" />
            <span className="font-semibold text-base text-white tabular-nums">
              {amount} USDC
            </span>
          </div>
        </div>

        {/* Route */}
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div className="text-xs text-slate-400">Route</div>
          <div className="flex items-center gap-1.5 text-xs text-white font-medium">
            <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
              <NetworkIcon
                name={sourceIconId}
                variant={sourceIconId === 'solana' ? 'branded' : 'background'}
                size={16}
                className="rounded-full"
              />
            </div>
            <span>{sourceChainName}</span>
            <span className="text-indigo-400 font-bold">→</span>
            <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
              <NetworkIcon
                name={destIconId}
                variant={destIconId === 'solana' ? 'branded' : 'background'}
                size={16}
                className="rounded-full"
              />
            </div>
            <span>{destChainName}</span>
          </div>
        </div>

        {/* Method */}
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div className="text-xs text-slate-400">Method</div>
          <div className="text-xs font-semibold text-indigo-300">
            {mode === 'direct' ? 'Direct CCTP Bridge' : 'Circle Gateway Fast Transfer'}
          </div>
        </div>

        {/* Recipient */}
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
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

        {/* Protocol / Network Fee */}
        {fee && (
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
            <div className="text-xs text-slate-400">Bridge Fee</div>
            <div className="text-xs font-mono text-slate-300">
              {fee} USDC
            </div>
          </div>
        )}

        {/* Net Received */}
        {netReceived && (
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
            <div className="text-xs text-slate-400 font-medium">Net Received</div>
            <div className="text-xs font-mono font-semibold text-indigo-300">
              {netReceived} USDC
            </div>
          </div>
        )}

        {/* Transaction Hash */}
        {txHash && (
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">Transaction</div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-300">
                {txHash.slice(0, 6)}...{txHash.slice(-4)}
              </span>
              <button
                type="button"
                onClick={handleCopyTx}
                className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Copy Transaction Hash"
              >
                {copiedTx ? <Check className="w-3 h-3 text-indigo-400" /> : <Copy className="w-3 h-3" />}
              </button>
              {explorerUrl && (
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 transition-colors"
                  title="View on Explorer"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onBridgeAgain}
          className="flex-1 py-3 px-4 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 transition-all cursor-pointer shadow-md shadow-indigo-500/20 flex items-center justify-center gap-1.5"
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Bridge Again</span>
        </button>

        {!isInline && onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-3 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] transition-all cursor-pointer"
          >
            Close
          </button>
        )}
      </div>
    </div>
  )
}
