import React from 'react'
import { UnifiedSuccessReceipt } from './UnifiedSuccessReceipt'

export interface SendSuccessReceiptProps {
  amount: string
  tokenSymbol: string
  tokenIcon?: string
  recipient: string
  network: string
  networkIconId?: string
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
  networkIconId,
  txHash,
  explorerUrl,
  gasFee,
  blockNumber,
  memoText,
  memoId,
  onSendAgain,
  onClose,
  isInline = false,
}) => {
  return (
    <UnifiedSuccessReceipt
      type="send"
      amount={amount}
      tokenSymbol={tokenSymbol}
      tokenIcon={tokenIcon}
      recipient={recipient}
      network={network}
      networkIconId={networkIconId}
      txHash={txHash}
      explorerUrl={explorerUrl}
      gasFee={gasFee}
      blockNumber={blockNumber}
      memoText={memoText}
      memoId={memoId}
      onActionAgain={onSendAgain}
      onClose={onClose}
      isInline={isInline}
    />
  )
}
