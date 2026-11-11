import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
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
import CirBtcIcon from '../assets/Token-Icon/cirBTC Token.svg'
import { ChainIcon } from './common/ChainIcon'
import { generateQrMatrix } from '../utils/qrGenerator'
import { getExplorerTxUrl, getExplorerAddressUrl } from '../config/sendConfig'
import { getChainDisplayName } from '../config/chainMeta'
import { TOKEN_ICON_MAP, WethIcon, EthIcon } from '../config/tokenIcons'
import { formatAmountExact, formatUtcTime } from './history/historyHelpers'

interface ReceiptModalProps {
  isOpen: boolean
  onClose: () => void
  item: HistoryItem | null
}

const TOKEN_ICONS: Record<string, string> = {
  ...TOKEN_ICON_MAP,
  USDC: UsdcIcon,
  EURC: EurcIcon,
  cirBTC: CirBtcIcon,
  CIRBTC: CirBtcIcon,
  CRCL: CircleIcon,
  CIRCLE: CircleIcon,
  WETH: WethIcon,
  wETH: WethIcon,
  ETH: EthIcon,
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ isOpen, onClose, item }) => {
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [showQrCode, setShowQrCode] = useState(false)

  // Standard body scroll lock
  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showQrCode) {
          setShowQrCode(false)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, showQrCode, onClose])

  if (!isOpen || !item || typeof document === 'undefined') return null

  const handleCopyText = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text)
    setCopiedField(fieldId)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const sourceChain = item.sourceChain || 'Arc_Testnet'
  const destChain = item.destChain || (item.type === 'bridge' ? (sourceChain === 'Arc_Testnet' ? 'Base_Sepolia' : 'Arc_Testnet') : undefined)
  const targetChain = item.type === 'bridge' && destChain ? destChain : sourceChain
  const explorerUrl = getExplorerTxUrl(targetChain, item.txHash)
  const recipientChain = destChain || sourceChain
  const recipientExplorerUrl = item.recipient ? getExplorerAddressUrl(recipientChain, item.recipient) : '#'

  const qrMatrix = generateQrMatrix(explorerUrl)

  const renderTokenIcon = (symbol?: string) => {
    if (!symbol) return null
    const clean = symbol.replace(/\s*\(.*?\)/g, '').trim()
    const symUpper = clean.toUpperCase()

    if (TOKEN_ICONS[clean] || TOKEN_ICONS[symUpper]) {
      return <img src={TOKEN_ICONS[clean] || TOKEN_ICONS[symUpper]} alt={clean} className="w-6 h-6 object-contain shrink-0" />
    }
    if (symUpper.includes('USDC')) {
      return <img src={UsdcIcon} alt="USDC" className="w-6 h-6 object-contain shrink-0" />
    }
    if (symUpper.includes('EURC')) {
      return <img src={EurcIcon} alt="EURC" className="w-6 h-6 object-contain shrink-0" />
    }
    if (symUpper === 'BTC' || symUpper === 'WBTC' || symUpper === 'CIRBTC' || symUpper.includes('BTC')) {
      return <img src={CirBtcIcon} alt="cirBTC" className="w-6 h-6 object-contain shrink-0" />
    }
    if (symUpper === 'WETH' || symUpper === 'ETH' || symUpper.includes('WETH') || symUpper.includes('ETH')) {
      return <img src={WethIcon} alt="wETH" className="w-6 h-6 object-contain shrink-0 rounded-full" />
    }
    return (
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm border shrink-0"
        style={{
          background: 'linear-gradient(135deg, var(--color-brand-primary, #6366f1) 0%, var(--purple-1, #9896ff) 100%)',
          borderColor: 'rgba(152, 150, 255, 0.4)',
        }}
      >
        {clean.slice(0, 3).toUpperCase()}
      </div>
    )
  }

  const formatAddress = (addr?: string) => {
    if (!addr) return '-'
    if (addr.length < 16) return addr
    return `${addr.substring(0, 8)}...${addr.substring(addr.length - 8)}`
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in overscroll-contain touch-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-modal-title"
    >
      <div
        className="w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl relative border flex flex-col max-h-[88vh] m-auto"
        style={{
          background: 'linear-gradient(180deg, rgba(17, 21, 38, 0.98) 0%, rgba(11, 13, 24, 0.99) 100%)',
          borderColor: 'rgba(152, 150, 255, 0.3)',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.9), 0 0 32px rgba(152, 150, 255, 0.15)',
          fontFamily: 'var(--font-app)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/[0.08] bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center border shadow-sm"
              style={{
                background: 'rgba(152, 150, 255, 0.12)',
                borderColor: 'rgba(152, 150, 255, 0.3)',
                color: 'var(--purple-1, #9896ff)',
              }}
            >
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="receipt-modal-title"
                className="text-sm font-bold text-white tracking-wider uppercase"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                DIGITAL TRANSACTION RECEIPT
              </h2>
              <span className="text-[11px] text-[var(--secondary-colors--sky-sync)] font-medium">
                Arcis On-Chain Verified Invoice
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowQrCode(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-1)]"
              style={{
                background: 'rgba(152, 150, 255, 0.12)',
                borderColor: 'rgba(152, 150, 255, 0.3)',
                color: 'var(--purple-1, #9896ff)',
              }}
              title="Show Explorer Verification QR Code"
              aria-label="Show Explorer Verification QR Code"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Show QR</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-1)]"
              aria-label="Close receipt"
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
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border"
              style={{
                fontFamily: 'var(--fonts--space-mono)',
                background:
                  item.status === 'failed'
                    ? 'rgba(244, 63, 94, 0.1)'
                    : item.status === 'pending'
                    ? 'rgba(245, 158, 11, 0.1)'
                    : 'rgba(1, 208, 98, 0.1)',
                color:
                  item.status === 'failed'
                    ? '#f43f5e'
                    : item.status === 'pending'
                    ? '#f59e0b'
                    : 'var(--earned-green, #01d062)',
                borderColor:
                  item.status === 'failed'
                    ? 'rgba(244, 63, 94, 0.25)'
                    : item.status === 'pending'
                    ? 'rgba(245, 158, 11, 0.25)'
                    : 'rgba(1, 208, 98, 0.25)',
                letterSpacing: '0.04em',
              }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                {item.status === 'failed'
                  ? 'TRANSACTION FAILED'
                  : item.status === 'pending'
                  ? 'TRANSACTION PENDING'
                  : 'TRANSACTION SUCCESSFUL'}
              </span>
            </div>

            {/* Amount */}
            <div className="pt-1">
              {item.type === 'swap' && item.amountIn && item.amountOut ? (
                <div
                  className="flex items-center justify-center gap-2 text-2xl font-bold text-white tabular-nums"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                >
                  <div className="flex items-center gap-1.5">
                    {/* The receipt is the detail view: exact digits, never the rounded table value. */}
                    <span>{formatAmountExact(item.amountIn)}</span>
                    {renderTokenIcon(item.tokenIn)}
                  </div>
                  <span className="text-white/40 text-sm">→</span>
                  <div className="flex items-center gap-1.5 text-white">
                    <span>{formatAmountExact(item.amountOut)}</span>
                    {renderTokenIcon(item.tokenOut)}
                  </div>
                </div>
              ) : item.type === 'add_liquidity' && item.amountB && item.tokenB ? (
                <div
                  className="flex items-center justify-center gap-2 text-2xl font-bold text-white tabular-nums"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                >
                  <div className="flex items-center gap-1.5">
                    <span>+{formatAmountExact(item.amount)}</span>
                    {renderTokenIcon(item.tokenSymbol)}
                  </div>
                  <span className="text-white/40 text-sm">+</span>
                  <div className="flex items-center gap-1.5">
                    <span>{formatAmountExact(item.amountB)}</span>
                    {renderTokenIcon(item.tokenB)}
                  </div>
                </div>
              ) : (
                <div
                  className="flex items-center justify-center gap-2 text-3xl font-bold text-white tabular-nums"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                >
                  <span>
                    {item.type === 'add_liquidity' || item.type === 'harvest'
                      ? `+${formatAmountExact(item.amount)}`
                      : item.type === 'remove_liquidity'
                      ? `-${formatAmountExact(item.amount)}`
                      : formatAmountExact(item.amount)}
                  </span>
                  {renderTokenIcon(item.tokenSymbol)}
                  <span className="text-base font-semibold text-white/70" style={{ fontFamily: 'var(--font-app)' }}>{item.tokenSymbol}</span>
                </div>
              )}
            </div>

            <div className="text-[11px] text-[var(--secondary-colors--sky-sync)] flex items-center justify-center gap-1.5 font-medium">
              <Clock className="w-3.5 h-3.5 text-[var(--purple-1)] opacity-80" />
              <span>{formatUtcTime(item.timestamp)} UTC</span>
            </div>
          </div>

          {/* On-Chain Transaction Memo Card */}
          {item.memo && (
            <div
              className="p-4 rounded-2xl space-y-2.5 animate-fade-in relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(152, 150, 255, 0.1) 0%, rgba(99, 102, 241, 0.05) 100%)',
                border: '1px solid rgba(152, 150, 255, 0.28)',
                boxShadow: '0 8px 24px -6px rgba(152, 150, 255, 0.12)',
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  <FileText className="w-3.5 h-3.5 text-[var(--purple-1)]" />
                  <span style={{ fontFamily: 'var(--fonts--space-mono)', letterSpacing: '0.04em' }}>ON-CHAIN MEMO & INVOICE</span>
                </div>
                {item.memoIndex !== undefined && (
                  <span
                    className="text-[10px] px-2 py-0.5 rounded font-bold border"
                    style={{
                      fontFamily: 'var(--fonts--space-mono)',
                      background: 'rgba(152, 150, 255, 0.15)',
                      color: 'var(--purple-1, #9896ff)',
                      borderColor: 'rgba(152, 150, 255, 0.3)',
                    }}
                  >
                    Memo #{item.memoIndex}
                  </span>
                )}
              </div>

              {/* Memo Note Body */}
              <div
                className="p-3 rounded-xl text-white text-xs font-medium leading-relaxed"
                style={{
                  background: 'rgba(11, 13, 24, 0.85)',
                  border: '1px solid rgba(152, 150, 255, 0.2)',
                }}
              >
                {item.memo}
              </div>

              {/* Memo ID with Copy */}
              {item.memoId && (
                <div
                  className="flex items-center justify-between text-[11px] p-2.5 rounded-xl border"
                  style={{
                    fontFamily: 'var(--fonts--space-mono)',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderColor: 'rgba(255, 255, 255, 0.06)',
                    color: 'rgba(255, 255, 255, 0.75)',
                  }}
                >
                  <span className="truncate max-w-[240px] sm:max-w-[320px] tabular-nums">
                    Memo ID: {item.memoId}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyText(item.memoId!, 'memoId')}
                    className="text-[var(--secondary-colors--sky-sync)] hover:text-white flex items-center gap-1 ml-2 shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--purple-1)] rounded px-1"
                  >
                    {copiedField === 'memoId' ? (
                      <Check className="w-3 h-3 text-[var(--earned-green)]" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span className="text-[10px]">{copiedField === 'memoId' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Specifications Table */}
          <div
            className="p-4 rounded-2xl space-y-2 text-xs"
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
            }}
          >
            {/* Operation Type */}
            <div className="flex justify-between items-center py-1.5 border-b border-white/[0.06]">
              <span className="text-[var(--secondary-colors--sky-sync)] opacity-80">Operation</span>
              <span className="text-white font-medium capitalize">
                {item.type === 'add_liquidity' ? 'Add Liquidity' :
                 item.type === 'remove_liquidity' ? 'Remove Liquidity' :
                 item.type === 'harvest' ? 'Yield Harvest' :
                 item.type === 'ai_service' ? 'x402 AI Service' :
                 item.type === 'deposit' ? 'Gateway Deposit' : item.type}
              </span>
            </div>

            {/* Pool / Vault Name if present */}
            {item.poolName && (
              <div className="flex justify-between items-center py-1.5 border-b border-white/[0.06]">
                <span className="text-[var(--secondary-colors--sky-sync)] opacity-80">Pool / Vault</span>
                <span className="text-white font-medium">{item.poolName}</span>
              </div>
            )}

            {/* AI Service Name if present */}
            {item.serviceName && (
              <div className="flex justify-between items-center py-1.5 border-b border-white/[0.06]">
                <span className="text-[var(--secondary-colors--sky-sync)] opacity-80">Service</span>
                <span className="text-white font-medium">{item.serviceName}</span>
              </div>
            )}

            {/* LP Shares Minted if present */}
            {item.lpMinted && (
              <div className="flex justify-between items-center py-1.5 border-b border-white/[0.06]">
                <span className="text-[var(--secondary-colors--sky-sync)] opacity-80">LP Tokens Minted</span>
                <span
                  className="font-medium tabular-nums"
                  style={{
                    fontFamily: 'var(--fonts--space-mono)',
                    color: 'var(--earned-green, #01d062)',
                  }}
                >
                  {item.lpMinted}
                </span>
              </div>
            )}

            {/* Pool Share if present */}
            {item.poolShare !== undefined && item.poolShare > 0 && (
              <div className="flex justify-between items-center py-1.5 border-b border-white/[0.06]">
                <span className="text-[var(--secondary-colors--sky-sync)] opacity-80">Pool Share</span>
                <span
                  className="font-medium tabular-nums text-[var(--purple-1)]"
                  style={{ fontFamily: 'var(--fonts--space-mono)' }}
                >
                  {item.poolShare}%
                </span>
              </div>
            )}

            {/* Network */}
            <div className="flex justify-between items-center py-1.5 border-b border-white/[0.06]">
              <span className="text-[var(--secondary-colors--sky-sync)] opacity-80">Chain</span>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                  <ChainIcon
                    chainKeyOrIconId={sourceChain}
                    size={16}
                    className="rounded-full"
                  />
                </div>
                <span className="text-white font-medium">{getChainDisplayName(sourceChain)}</span>
                {destChain && destChain !== sourceChain && (
                  <>
                    <span className="text-[var(--purple-1)] font-bold text-xs">→</span>
                    <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                      <ChainIcon
                        chainKeyOrIconId={destChain}
                        size={16}
                        className="rounded-full"
                      />
                    </div>
                    <span className="text-white font-medium">{getChainDisplayName(destChain)}</span>
                  </>
                )}
              </div>
            </div>

            {/* Recipient */}
            {item.recipient && (
              <div className="flex justify-between items-center py-1.5 border-b border-white/[0.06]">
                <span className="text-[var(--secondary-colors--sky-sync)] opacity-80">Recipient</span>
                <div className="flex items-center gap-1.5">
                  <a
                    href={recipientExplorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-white hover:text-[var(--purple-1)] transition-colors font-medium cursor-pointer group/recip select-none tabular-nums"
                    style={{ fontFamily: 'var(--fonts--space-mono)' }}
                    title={recipientExplorerUrl}
                  >
                    <span>{formatAddress(item.recipient)}</span>
                    <ExternalLink className="w-3 h-3 text-[var(--secondary-colors--sky-sync)] group-hover/recip:text-[var(--purple-1)] transition-colors opacity-70 group-hover/recip:opacity-100 shrink-0" />
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCopyText(item.recipient!, 'recipient')}
                    className="p-1 text-[var(--secondary-colors--sky-sync)] hover:text-white transition-colors cursor-pointer rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--purple-1)]"
                    title="Copy Recipient"
                    aria-label="Copy recipient address"
                  >
                    {copiedField === 'recipient' ? (
                      <Check className="w-3 h-3 text-[var(--earned-green)]" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Transaction Hash */}
            <div className="flex justify-between items-center py-1.5 border-b border-white/[0.06] last:border-b-0">
              <span className="text-[var(--secondary-colors--sky-sync)] opacity-80">Tx Hash</span>
              <div className="flex items-center gap-1.5">
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-white hover:text-[var(--purple-1)] transition-colors font-medium cursor-pointer group/tx select-none tabular-nums"
                  style={{ fontFamily: 'var(--fonts--space-mono)' }}
                  title={explorerUrl}
                >
                  <span>{formatAddress(item.txHash)}</span>
                  <ExternalLink className="w-3 h-3 text-[var(--secondary-colors--sky-sync)] group-hover/tx:text-[var(--purple-1)] transition-colors opacity-70 group-hover/tx:opacity-100 shrink-0" />
                </a>
                <button
                  type="button"
                  onClick={() => handleCopyText(item.txHash, 'txHash')}
                  className="p-1 text-[var(--secondary-colors--sky-sync)] hover:text-white transition-colors cursor-pointer rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--purple-1)]"
                  title="Copy Tx Hash"
                  aria-label="Copy transaction hash"
                >
                  {copiedField === 'txHash' ? (
                    <Check className="w-3 h-3 text-[var(--earned-green)]" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>

            {/* Privacy Mode */}
            {item.isPrivate && (
              <div className="flex justify-between items-center py-1.5 border-b border-white/[0.06] last:border-b-0">
                <span className="text-[var(--secondary-colors--sky-sync)] opacity-80">Privacy Protection</span>
                <span className="text-[var(--purple-1)] font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[var(--purple-1)]" />
                  <span>APS Encrypted Send</span>
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Action Footer */}
        <div className="px-6 py-4 border-t border-white/[0.08] bg-white/[0.01]">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-3 px-4 rounded-xl text-xs font-bold tracking-wider uppercase transition-all flex items-center justify-center gap-2 cursor-pointer text-white shadow-lg group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-1)]"
            style={{
              fontFamily: 'var(--fonts--space-mono)',
              background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #7c3aed 100%)',
              boxShadow: '0 4px 20px rgba(99, 102, 241, 0.35)',
            }}
          >
            <span>View on Explorer</span>
            <ExternalLink className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        </div>
      </div>

      {/* Separate QR Code Modal Popup Window */}
      {showQrCode && (
        <div
          className="fixed inset-0 z-[180] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in"
          onClick={() => setShowQrCode(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-modal-title"
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
              <div className="flex items-center gap-2 text-white font-bold text-sm" style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}>
                <QrCode className="w-4 h-4 text-[var(--purple-1)]" />
                <span id="qr-modal-title">Verification QR Code</span>
              </div>
              <button
                type="button"
                onClick={() => setShowQrCode(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.08] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-1)]"
                aria-label="Close QR code"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* QR Code Graphic in Refined Luxury Card */}
            <div
              className="p-4 rounded-2xl shadow-xl border border-white/20"
              style={{
                background: '#f8fafc',
                boxShadow: '0 8px 32px -4px rgba(152, 150, 255, 0.25)',
              }}
            >
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
                Scan to verify on {getChainDisplayName(targetChain) || 'Arc Explorer'}
              </p>
              <p
                className="text-[11px] text-[var(--secondary-colors--sky-sync)] truncate max-w-[280px] tabular-nums"
                style={{ fontFamily: 'var(--fonts--space-mono)' }}
              >
                {formatAddress(item.txHash)}
              </p>
            </div>

            <div className="w-full pt-1">
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold tracking-wide transition-all flex items-center justify-center gap-1.5 cursor-pointer text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple-1)]"
                style={{
                  fontFamily: 'var(--fonts--space-mono)',
                  background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
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
    </div>,
    document.body
  )
}
