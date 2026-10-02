// src/components/copilot/CopilotSuccessReceipt.tsx
// Maps a Copilot InlineExecutionReceipt onto the shared UnifiedSuccessReceipt template —
// the exact corporate receipt the Send / Swap / Bridge tabs render. Copilot-specific
// verified fee rows (actual ArcScan gas + base/priority split) and the corporate footer
// (receipt reference, settlement time, latency) are carried over, per type:
//   swap | send | bridge | deposit | faucet | ai_service
// The inline card is width-capped to its own heading (measured at runtime) so the receipt stays
// a compact block in the chat stream instead of stretching across the resizable drawer.
import React, { useState, useEffect, useLayoutEffect, useRef } from 'react'
import { UnifiedSuccessReceipt } from '../fintech/UnifiedSuccessReceipt'
import type { InlineExecutionReceipt } from '../../types/sessionKey'
import { getExplorerTxUrl } from '../../config/sendConfig'
import { resolveArcActualFeeUsdc } from '../../services/arcGasService'
import { getModularPublicClient } from '../../services/modularWalletService'

interface CopilotSuccessReceiptProps {
  receipt: InlineExecutionReceipt
}

/** Pre-formats a verified USDC fee the same way the template prints amounts. */
function formatUsdc(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 12,
    useGrouping: false,
  })
}

/** Same `0x45454...4584` recipient abbreviation the tabs' receipt uses. */
function shortenRecipient(value: string): string {
  if (value.length <= 16) return value
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

// Layout effect on the client (measures before paint so the compact width never flashes wide);
// a plain effect during server/SSR rendering, where there is no DOM to measure.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

interface ReceiptTemplateProps {
  receipt: InlineExecutionReceipt
  /** Pre-formatted verified fee + Base/Priority split for the shared metadata card. */
  feeProps: {
    actualGasUsdc?: string
  }
}

export default function CopilotSuccessReceipt({ receipt }: CopilotSuccessReceiptProps) {
  // ── Verified on-chain fee (kept from the old inline card): resolved asynchronously
  // from the Arc receipt when the execution service could not verify it in time.
  const [asyncActualGasUsdc, setAsyncActualGasUsdc] = useState<number | null>(null)
  const [asyncFeeSplit, setAsyncFeeSplit] = useState<{ base: string; priority: string } | null>(null)
  const displayedActualGas = receipt.actualGasUsdc ?? asyncActualGasUsdc

  // Width of the whole template tracks its own heading (see the measurement effect below).
  const measurerRef = useRef<HTMLSpanElement>(null)
  const [headingWidth, setHeadingWidth] = useState<number | null>(null)

  useEffect(() => {
    if (receipt?.actualGasUsdc != null) return
    if (!['send', 'swap', 'deposit'].includes(receipt?.actionType)) return
    if (!receipt?.txHash || !receipt.txHash.startsWith('0x')) return

    let cancelled = false
    const pollReceipt = async () => {
      try {
        const client = getModularPublicClient() as any
        if (!client) return
        const rcpt = typeof client.waitForTransactionReceipt === 'function'
          ? await client.waitForTransactionReceipt({ hash: receipt.txHash as any, timeout: 6000 }).catch(() => null)
          : await client.getTransactionReceipt?.({ hash: receipt.txHash as any }).catch(() => null)
        if (rcpt && !cancelled) {
          const gasUsed = rcpt.gasUsed as bigint | undefined
          const gasPrice = (rcpt.effectiveGasPrice ?? rcpt.gasPrice) as bigint | undefined
          if (gasUsed != null && gasPrice != null) {
            const fee = Number(gasUsed * gasPrice) / 1e18
            if (Number.isFinite(fee) && fee >= 0) {
              setAsyncActualGasUsdc(fee)
            }
          }
        }
      } catch {
        // Silent catch
      }
    }
    pollReceipt()
    return () => {
      cancelled = true
    }
  }, [receipt?.txHash, receipt?.actualGasUsdc])

  // Resolves the exact base + priority split (the ArcScan "Transaction fee" breakdown)
  // through the shared receipt resolver once the tx hash is known.
  useEffect(() => {
    if (!['send', 'swap', 'deposit'].includes(receipt?.actionType)) return
    if (!receipt?.txHash || !receipt.txHash.startsWith('0x')) return
    let cancelled = false
    resolveArcActualFeeUsdc(receipt.txHash, getModularPublicClient() as any)
      .then((result) => {
        if (!cancelled && result.baseFeeUsdcExact && result.priorityFeeUsdcExact) {
          const base = Number(result.baseFeeUsdcExact)
          const priority = Number(result.priorityFeeUsdcExact)
          if (Number.isFinite(base) && Number.isFinite(priority)) {
            setAsyncFeeSplit({
              base: base.toFixed(5),
              priority: priority.toFixed(5),
            })
          }
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [receipt?.txHash])

  // Verified fee + split, passed straight into the shared metadata card.
  const feeProps = {
    actualGasUsdc:
      displayedActualGas != null && Number.isFinite(displayedActualGas) && displayedActualGas >= 0
        ? formatUsdc(displayedActualGas)
        : undefined,
  }

  // The inline template is capped to the width of its own heading (e.g. "Send Completed Successfully")
  // so the receipt reads as a compact card in the chat stream instead of stretching across the drawer.
  useIsomorphicLayoutEffect(() => {
    let cancelled = false

    const measureHeading = () => {
      if (cancelled) return
      // The off-flow nowrap copy below reports the heading's natural single-line width via
      // `offsetWidth` — a value in local CSS pixels that neither depends on the still
      // shrink-to-fit chat bubble around the card nor on any ancestor CSS `zoom`/transform.
      const width = measurerRef.current?.offsetWidth ?? 0
      if (width > 0) {
        // +4px keeps the measured heading itself on a single line at sub-pixel widths.
        setHeadingWidth(width + 4)
      }
    }

    measureHeading()
    // Web fonts can settle after the first paint; re-measure once they are ready.
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(measureHeading).catch(() => {})
    }

    return () => {
      cancelled = true
    }
  }, [receipt.title, receipt.actionType])

  return (
    <div
      className="w-fit max-w-full mx-auto"
      style={headingWidth != null ? { width: `${headingWidth}px` } : undefined}
    >
      {/* Hidden one-line copy of the heading that drives the card width (see the effect above). */}
      <span
        ref={measurerRef}
        aria-hidden="true"
        className="pointer-events-none absolute invisible whitespace-nowrap text-2xl font-semibold tracking-wide"
        style={{ top: 0, left: 0, fontFamily: 'var(--font-app)' }}
      >
        {receipt.title}
      </span>
      <ReceiptTemplate receipt={receipt} feeProps={feeProps}/>
    </div>
  )
}

/**
 * Per-action-type corporate template (the switch formerly inlined in the adapter):
 * swap | send | bridge | deposit | faucet | ai_service.
 */
function ReceiptTemplate({ receipt, feeProps }: ReceiptTemplateProps) {
  // ── Explorer resolution (same chain heuristic the inline card used) ──
  const targetChain =
    receipt.actionType === 'bridge'
      ? receipt.toChain?.toLowerCase().includes('arc')
        ? 'Arc_Testnet'
        : receipt.fromChain || 'Arc_Testnet'
      : 'Arc_Testnet'
  const explorerLabel = targetChain.toLowerCase().includes('arc')
    ? 'ArcScan'
    : targetChain.toLowerCase().includes('sepolia')
      ? 'Etherscan'
      : 'Explorer'
  const explorerUrl =
    receipt.explorerUrl ||
    (receipt.txHash && receipt.txHash.startsWith('0x') ? getExplorerTxUrl(targetChain, receipt.txHash) : '#')

  const amountIn = receipt.amountIn != null ? String(receipt.amountIn) : undefined
  const amountOut = receipt.amountOut != null ? String(receipt.amountOut) : undefined

  switch (receipt.actionType) {
    case 'swap':
      return (
        <UnifiedSuccessReceipt
          type="swap"
          title={receipt.title}
          amountIn={amountIn}
          amountOut={amountOut}
          tokenIn={receipt.fromToken || 'USDC'}
          tokenOut={receipt.toToken || 'USDC'}
          sourceChain={receipt.fromChain || 'Arc_Testnet'}
          destChain={receipt.toChain}
          txHash={receipt.txHash || undefined}
          explorerUrl={explorerUrl}
          onActionAgain={() => {}}
          isInline
          {...feeProps}
        />
      )

    case 'bridge':
      return (
        <UnifiedSuccessReceipt
          type="bridge"
          title={receipt.title}
          subtitle={receipt.subtitle}
          amount={amountIn}
          netReceived={receipt.amountOut != null ? String(receipt.amountOut) : undefined}
          tokenSymbol="USDC"
          sourceChain={receipt.fromChain || 'Arc_Testnet'}
          destChain={receipt.toChain}
          isCrossChain
          mode="direct"
          status={receipt.status === 'PENDING' ? 'pending' : 'success'}
          recipient={receipt.recipient ? shortenRecipient(receipt.recipient) : undefined}
          sourceTxHash={receipt.sourceTxHash || receipt.txHash || undefined}
          destTxHash={receipt.destTxHash}
          sourceExplorerUrl={receipt.sourceTxHash ? getExplorerTxUrl(receipt.fromChain || 'Arc_Testnet', receipt.sourceTxHash) : explorerUrl}
          destExplorerUrl={receipt.destTxHash ? getExplorerTxUrl(receipt.toChain || 'Arc_Testnet', receipt.destTxHash) : undefined}
          onActionAgain={() => {}}
          isInline
          {...feeProps}
        />
      )

    case 'deposit':
      return (
        <UnifiedSuccessReceipt
          type="deposit"
          title={receipt.title}
          amount={amountIn}
          tokenSymbol="USDC"
          apy={receipt.apy}
          txHash={receipt.txHash || undefined}
          explorerUrl={explorerUrl}
          onActionAgain={() => {}}
          isInline
          {...feeProps}
        />
      )

    case 'faucet':
      return (
        <UnifiedSuccessReceipt
          type="faucet"
          title={receipt.title}
          amount={amountOut}
          tokenSymbol="USDC"
          recipient={receipt.recipient ? shortenRecipient(receipt.recipient) : undefined}
          txHash={receipt.txHash || undefined}
          explorerUrl={explorerUrl}
          onActionAgain={() => {}}
          isInline
          {...feeProps}
        />
      )

    case 'ai_service':
      return (
        <UnifiedSuccessReceipt
          type="ai_service"
          title={receipt.title}
          method="x402 AI Service Settlement"
          amount={amountIn}
          tokenSymbol="USDC"
          recipient={receipt.recipient ? shortenRecipient(receipt.recipient) : undefined}
          txHash={receipt.txHash || undefined}
          explorerUrl={explorerUrl}
          onActionAgain={() => {}}
          isInline
          {...feeProps}
        />
      )

    // send + defensive default
    default:
      return (
        <UnifiedSuccessReceipt
          type="send"
          title={receipt.title}
          amount={amountIn}
          tokenSymbol={receipt.fromToken || 'USDC'}
          recipient={receipt.recipient ? shortenRecipient(receipt.recipient) : undefined}
          memoText={receipt.memo}
          network="Arc_Testnet"
          txHash={receipt.txHash || undefined}
          explorerUrl={explorerUrl}
          onActionAgain={() => {}}
          isInline
          {...feeProps}
        />
      )
  }
}
