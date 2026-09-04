import React, { useState } from 'react'
import { CheckCircle2, ExternalLink, Copy, Check, Globe } from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import { getExplorerTxUrl, getExplorerName } from '../../config/sendConfig'
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
  sourceTxHash?: string
  explorerUrl?: string
  sourceExplorerUrl?: string
  fee?: string
  netReceived?: string
  onBridgeAgain: () => void
  onClose?: () => void
  isInline?: boolean
}

export const BridgeSuccessReceipt: React.FC<BridgeSuccessReceiptProps> = ({
  amount,
  sourceChain,
  destChain,
  sourceChainName,
  destChainName,
  sourceIconId,
  destIconId,
  recipient,
  mode,
  txHash,
  sourceTxHash,
  explorerUrl,
  sourceExplorerUrl,
  fee,
  netReceived,
  onBridgeAgain,
  onClose,
  isInline = false,
}) => {
  const [copiedRecipient, setCopiedRecipient] = useState(false)
  const [copiedTx, setCopiedTx] = useState<string | null>(null)

  // Primary focus: Destination network explorer and structures
  const destExplorerName = getExplorerName(destChain)
  const sourceExplorerName = getExplorerName(sourceChain)

  const effectiveDestExplorerUrl = explorerUrl || (txHash ? getExplorerTxUrl(destChain, txHash) : '#')
  const effectiveSourceExplorerUrl = sourceExplorerUrl || (sourceTxHash ? getExplorerTxUrl(sourceChain, sourceTxHash) : '#')

  const handleCopyRecipient = () => {
    if (recipient) {
      navigator.clipboard.writeText(recipient)
      setCopiedRecipient(true)
      setTimeout(() => setCopiedRecipient(false), 2000)
    }
  }

  const handleCopyTx = (hash?: string) => {
    if (hash) {
      navigator.clipboard.writeText(hash)
      setCopiedTx(hash)
      setTimeout(() => setCopiedTx(null), 2000)
    }
  }

  return (
    <div className="space-y-5 animate-fade-in text-center py-2" style={{ fontFamily: 'var(--font-app)' }}>
      {/* Glowing Checkmark */}
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-full bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-300 shadow-[0_0_24px_rgba(16,185,129,0.25)]">
          <CheckCircle2 className="w-12 h-12 text-emerald-300 animate-pulse" />
        </div>
      </div>

      <div>
        <h3 className="text-2xl font-semibold text-white tracking-wide">
          Bridge Finalized!
        </h3>
        <p className="text-sm text-slate-400 mt-1">
          {mode === 'gateway'
            ? `USDC instantly minted on ${destChainName} via Circle Gateway`
            : `USDC cross-chain delivery finalized on ${destChainName} via Circle CCTP`}
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
            <span className="text-emerald-300 font-semibold">{destChainName}</span>
          </div>
        </div>

        {/* Method */}
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div className="text-xs text-slate-400">Method</div>
          <div className="text-xs font-semibold text-indigo-300">
            {mode === 'direct' ? 'Direct CCTP Bridge' : 'Circle Gateway Fast Transfer'}
          </div>
        </div>

        {/* Recipient on Destination */}
        <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div className="text-xs text-slate-400">Recipient ({destChainName})</div>
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
              {copiedRecipient ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
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

        {/* Net Received on Destination */}
        {netReceived && (
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
            <div className="text-xs text-slate-400 font-medium">Net Received ({destChainName})</div>
            <div className="text-xs font-mono font-bold text-emerald-400">
              {netReceived} USDC
            </div>
          </div>
        )}

        {/* Destination Transaction (Hero / Primary Focus) */}
        {txHash && (
          <div className="flex items-center justify-between py-1 border-b border-white/[0.06]">
            <div className="flex flex-col">
              <span className="text-xs text-slate-300 font-medium flex items-center gap-1.5">
                <span>Destination Tx</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 font-normal">
                  Mint
                </span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                {txHash.length > 18 ? `${txHash.slice(0, 8)}...${txHash.slice(-6)}` : txHash}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleCopyTx(txHash)}
                className="p-1 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Copy Destination Transaction Hash"
              >
                {copiedTx === txHash ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <a
                href={effectiveDestExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/25 text-xs text-emerald-300 hover:text-white transition-all cursor-pointer shadow-sm"
                title={`View transaction on ${destExplorerName} (${destChainName})`}
              >
                <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <NetworkIcon
                    name={destIconId}
                    variant={destIconId === 'solana' ? 'branded' : 'background'}
                    size={16}
                    className="rounded-full"
                  />
                </div>
                <span className="font-medium text-xs">
                  View on {destExplorerName}
                </span>
                <ExternalLink className="w-3 h-3 text-emerald-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>
            </div>
          </div>
        )}

        {/* Source Transaction (Optional Secondary) */}
        {sourceTxHash && sourceTxHash !== txHash && (
          <div className="flex items-center justify-between py-1">
            <div className="flex flex-col">
              <span className="text-xs text-slate-400 flex items-center gap-1.5">
                <span>Source Tx</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/[0.06] text-slate-400 font-normal">
                  Burn
                </span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono mt-0.5">
                {sourceTxHash.length > 18 ? `${sourceTxHash.slice(0, 8)}...${sourceTxHash.slice(-6)}` : sourceTxHash}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleCopyTx(sourceTxHash)}
                className="p-1 rounded text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Copy Source Transaction Hash"
              >
                {copiedTx === sourceTxHash ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <a
                href={effectiveSourceExplorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-slate-300 hover:text-white transition-all cursor-pointer"
                title={`View transaction on ${sourceExplorerName} (${sourceChainName})`}
              >
                <div className="w-3.5 h-3.5 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <NetworkIcon
                    name={sourceIconId}
                    variant={sourceIconId === 'solana' ? 'branded' : 'background'}
                    size={14}
                    className="rounded-full"
                  />
                </div>
                <span className="font-medium text-xs">
                  {sourceExplorerName}
                </span>
                <ExternalLink className="w-3 h-3 text-slate-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              </a>
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
