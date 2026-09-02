import React, { useState } from 'react'
import {
  X,
  Check,
  Copy,
  ExternalLink,
  ShieldCheck,
  FileText,
  Clock,
  QrCode,
  CheckCircle2
} from 'lucide-react'
import { HistoryItem } from '../utils/history'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import { NetworkIcon } from '@web3icons/react/dynamic'
import { generateQrMatrix } from '../utils/qrGenerator'
import { SUPPORTED_SEND_CHAINS, getExplorerTxUrl, getExplorerAddressUrl } from '../config/sendConfig'

interface ReceiptModalProps {
  isOpen: boolean
  onClose: () => void
  item: HistoryItem | null
}

const TOKEN_ICONS: Record<string, string> = {
  USDC: UsdcIcon,
  EURC: EurcIcon,
  cirBTC: CircleIcon,
}

import { getChainIconId, getChainDisplayName } from '../config/chainMeta'

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ isOpen, onClose, item }) => {
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [showQrCode, setShowQrCode] = useState(false)

  if (!isOpen || !item) return null

  const handleCopyText = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(fieldId)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const explorerUrl = getExplorerTxUrl(item.sourceChain, item.txHash)
  const recipientChain = item.destChain || item.sourceChain || 'Arc_Testnet'
  const recipientExplorerUrl = item.recipient ? getExplorerAddressUrl(recipientChain, item.recipient) : '#'

  const qrMatrix = generateQrMatrix(explorerUrl)

  const renderTokenIcon = (symbol?: string) => {
    if (!symbol) return null
    if (TOKEN_ICONS[symbol]) {
      return <img src={TOKEN_ICONS[symbol]} alt={symbol} className="w-6 h-6 object-contain" />
    }
    return (
      <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-500 flex items-center justify-center text-[10px] font-bold text-white shadow-sm border border-indigo-400/40 shrink-0">
        {symbol.slice(0, 3)}
      </div>
    )
  }

  const formatAddress = (addr?: string) => {
    if (!addr) return '-'
    if (addr.length < 16) return addr
    return `${addr.substring(0, 8)}...${addr.substring(addr.length - 8)}`
  }

  return (
    <div
      className="fixed inset-0 z-[160] flex items-start justify-center pt-8 sm:pt-14 p-4 bg-black/25 backdrop-blur-sm animate-fade-in overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl relative border flex flex-col max-h-[88vh]"
        style={{
          background: 'linear-gradient(180deg, rgba(17, 21, 38, 0.98) 0%, rgba(11, 13, 24, 0.99) 100%)',
          borderColor: 'rgba(152, 150, 255, 0.3)',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.9), 0 0 32px rgba(152, 150, 255, 0.15)',
          fontFamily: 'var(--font-app)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-6 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-300">
              <FileText className="w-4 h-4 text-[var(--purple-1)]" />
            </div>
            <div>
              <div className="flex items-center gap-5">
                <span className="text-s font-bold text-white tracking-wider uppercase" style={{ fontFamily: 'var(--fonts--space-grotesk)' }}>
                  DIGITAL TRANSACTION RECEIPT
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                Arcis On-Chain Verified Invoice
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowQrCode(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-indigo-300 hover:text-white bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 transition-all cursor-pointer shadow-sm"
              title="Show Explorer Verification QR Code"
            >
              <QrCode className="w-3.5 h-3.5 text-[var(--purple-1)]" />
              <span>Show QR</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Receipt Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-4 scrollbar-thin">
          {/* Status & Hero Amount Card */}
          <div
            className="p-4 rounded-2xl text-center space-y-2 relative overflow-hidden"
            style={{
              background: 'rgba(152, 150, 255, 0.05)',
              border: '1px solid rgba(152, 150, 255, 0.18)',
            }}
          >
            {/* Status Pill */}
            <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-[var(--fonts--space-mono)] uppercase">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>TRANSACTION SUCCESSFUL</span>
            </div>

            {/* Amount */}
            <div className="pt-1">
              {item.type === 'swap' && item.amountIn && item.amountOut ? (
                <div className="flex items-center justify-center gap-2 text-xl font-bold text-white font-[var(--fonts--space-grotesk)]">
                  <div className="flex items-center gap-1.5">
                    <span>{item.amountIn}</span>
                    {renderTokenIcon(item.tokenIn)}
                  </div>
                  <span className="text-slate-400 text-sm">→</span>
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <span>{item.amountOut}</span>
                    {renderTokenIcon(item.tokenOut)}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2 text-2xl font-bold text-white font-[var(--fonts--space-grotesk)]">
                  <span>{item.amount}</span>
                  {renderTokenIcon(item.tokenSymbol)}
                  <span className="text-sm font-semibold text-slate-300">{item.tokenSymbol}</span>
                </div>
              )}
            </div>

            <div className="text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
              <Clock className="w-3 h-3" />
              <span>{new Date(item.timestamp).toLocaleString()}</span>
            </div>
          </div>

          {/* On-Chain Transaction Memo Card (Star Feature) */}
          {item.memo && (
            <div
              className="p-4 rounded-2xl space-y-2.5 animate-fade-in relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(152, 150, 255, 0.12) 0%, rgba(99, 102, 241, 0.08) 100%)',
                border: '1px solid rgba(152, 150, 255, 0.35)',
                boxShadow: '0 8px 24px -6px rgba(152, 150, 255, 0.15)',
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  <FileText className="w-3.5 h-3.5 text-[var(--purple-1)]" />
                  <span>ON-CHAIN MEMO & INVOICE</span>
                </div>
                {item.memoIndex !== undefined && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold">
                    Memo #{item.memoIndex}
                  </span>
                )}
              </div>

              {/* Memo Note Body */}
              <div
                className="p-3 rounded-xl text-white text-xs font-medium"
                style={{
                  background: 'rgba(11, 13, 24, 0.85)',
                  border: '1px solid rgba(152, 150, 255, 0.25)',
                }}
              >
                {item.memo}
              </div>

              {/* Memo ID with Copy */}
              {item.memoId && (
                <div className="flex items-center justify-between text-[11px] text-slate-300 font-mono bg-white/[0.03] p-2 rounded-xl border border-white/[0.06]">
                  <span className="truncate max-w-[240px] sm:max-w-[320px]">
                    Memo ID: {item.memoId}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyText(item.memoId!, 'memoId')}
                    className="text-slate-400 hover:text-white flex items-center gap-1 ml-2 shrink-0 cursor-pointer"
                  >
                    {copiedField === 'memoId' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedField === 'memoId' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Specifications Table */}
          <div
            className="p-4 rounded-2xl space-y-2.5 text-xs text-slate-300"
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
            }}
          >
            {/* Network */}
            <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
              <span className="text-slate-400">Chain</span>
              <div className="flex items-center gap-1.5">
                <div style={{ width: 16, height: 16, borderRadius: '50%', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <NetworkIcon name={getChainIconId(item.sourceChain)} size={16} variant="background" />
                </div>
                <span className="text-white font-medium">{getChainDisplayName(item.sourceChain)}</span>
                {item.destChain && (
                  <>
                    <span className="text-slate-500">→</span>
                    <span className="text-white font-medium">{getChainDisplayName(item.destChain)}</span>
                  </>
                )}
              </div>
            </div>

            {/* Recipient */}
            {item.recipient && (
              <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
                <span className="text-slate-400">Recipient</span>
                <div className="flex items-center gap-1.5 font-mono">
                  <a
                    href={recipientExplorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-white hover:text-[var(--purple-1)] transition-colors font-medium cursor-pointer group/recip select-none"
                    title={recipientExplorerUrl}
                  >
                    <span>{formatAddress(item.recipient)}</span>
                    <ExternalLink className="w-3 h-3 text-slate-500 group-hover/recip:text-[var(--purple-1)] transition-colors opacity-70 group-hover/recip:opacity-100 shrink-0" />
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCopyText(item.recipient!, 'recipient')}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                    title="Copy Recipient"
                  >
                    {copiedField === 'recipient' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Transaction Hash */}
            <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
              <span className="text-slate-400">Tx Hash</span>
              <div className="flex items-center gap-1.5 font-mono">
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-white hover:text-[var(--purple-1)] transition-colors font-medium cursor-pointer group/tx select-none"
                  title={explorerUrl}
                >
                  <span>{formatAddress(item.txHash)}</span>
                  <ExternalLink className="w-3 h-3 text-slate-500 group-hover/tx:text-[var(--purple-1)] transition-colors opacity-70 group-hover/tx:opacity-100 shrink-0" />
                </a>
                <button
                  type="button"
                  onClick={() => handleCopyText(item.txHash, 'txHash')}
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                  title="Copy Tx Hash"
                >
                  {copiedField === 'txHash' ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>

            {/* Privacy Mode */}
            {item.isPrivate && (
              <div className="flex justify-between items-center py-1 border-b border-white/[0.05]">
                <span className="text-slate-400">Privacy Protection</span>
                <span className="text-indigo-300 font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-300" />
                  <span>APS Encrypted Send</span>
                </span>
              </div>
            )}
          </div>

        </div>

        {/* Action Footer */}
        <div className="p-3 flex items-center justify-between gap-1">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2.5 px-3.5 rounded-full text-xs font-semibold tracking-wide transition-all flex items-center justify-center gap-1.5 cursor-pointer text-white"
            style={{
              background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
              boxShadow: '0 4px 16px rgba(152, 150, 255, 0.3)',
            }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>View on Explorer</span>
          </a>
        </div>
      </div>

      {/* Separate QR Code Modal Popup Window */}
      {showQrCode && (
        <div
          className="fixed inset-0 z-[180] flex items-start justify-center pt-12 sm:pt-20 p-4 bg-black/30 backdrop-blur-sm animate-fade-in overflow-y-auto"
          onClick={() => setShowQrCode(false)}
        >
          <div
            className="w-full max-w-sm rounded-3xl p-6 shadow-2xl relative border flex flex-col items-center text-center space-y-4 animate-scale-in"
            style={{
              background: 'linear-gradient(180deg, rgba(17, 21, 38, 0.98) 0%, rgba(11, 13, 24, 0.99) 100%)',
              borderColor: 'rgba(152, 150, 255, 0.35)',
              boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.9), 0 0 32px rgba(152, 150, 255, 0.2)',
              fontFamily: 'var(--font-app)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with Close */}
            <div className="w-full flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2 text-white font-bold text-sm">
                <QrCode className="w-4 h-4 text-[var(--purple-1)]" />
                <span>Verification QR Code</span>
              </div>
              <button
                type="button"
                onClick={() => setShowQrCode(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* QR Code Graphic in White Card */}
            <div className="p-4 bg-white rounded-2xl shadow-xl border border-white/20">
              <svg
                viewBox={`0 0 ${qrMatrix.length} ${qrMatrix.length}`}
                className="w-48 h-48"
                shapeRendering="crispEdges"
              >
                {qrMatrix.map((row, r) =>
                  row.map((cell, c) =>
                    cell ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#0b0d18" /> : null
                  )
                )}
              </svg>
            </div>

            {/* Information & Explorer details */}
            <div className="space-y-1">
              <p className="text-xs font-semibold text-white">
                Scan to verify on {getChainDisplayName(item.sourceChain) || 'Arc Explorer'}
              </p>
              <p className="text-[11px] font-mono text-slate-400 truncate max-w-[280px]">
                {formatAddress(item.txHash)}
              </p>
            </div>

            <div className="w-full pt-1">
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 rounded-full text-xs font-semibold tracking-wide transition-all flex items-center justify-center gap-1.5 cursor-pointer text-white"
                style={{
                  background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                  boxShadow: '0 4px 16px rgba(152, 150, 255, 0.3)',
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in Block Explorer</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
