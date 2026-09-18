import React from 'react'
import { UnifiedSuccessReceipt } from './UnifiedSuccessReceipt'

export interface SwapSuccessReceiptProps {
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
  return (
    <UnifiedSuccessReceipt
      type="swap"
      amountIn={amountIn}
      amountOut={amountOut}
      tokenIn={tokenIn}
      tokenOut={tokenOut}
      tokenInIcon={tokenInIcon}
      tokenOutIcon={tokenOutIcon}
      sourceChain={fromChain}
      destChain={toChain}
      txHash={txHash}
      destTxHash={destTxHash}
      explorerUrl={explorerUrl}
      isCrossChain={isCrossChain}
      onActionAgain={onSwapAgain}
      onClose={onClose}
      isInline={isInline}
      recipient={recipient}
      rate={rate}
      slippage={slippage}
      speedTier={speedTier}
      fee={fee}
    />
  )
}
