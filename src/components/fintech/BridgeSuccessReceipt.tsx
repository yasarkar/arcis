import React from 'react'
import { UnifiedSuccessReceipt } from './UnifiedSuccessReceipt'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'

export interface BridgeSuccessReceiptProps {
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
  return (
    <UnifiedSuccessReceipt
      type="bridge"
      amount={amount}
      tokenSymbol="USDC"
      tokenIcon={UsdcIcon}
      sourceChain={sourceChain}
      destChain={destChain}
      sourceChainName={sourceChainName}
      destChainName={destChainName}
      sourceIconId={sourceIconId}
      destIconId={destIconId}
      recipient={recipient}
      mode={mode}
      txHash={txHash}
      sourceTxHash={sourceTxHash}
      explorerUrl={explorerUrl}
      sourceExplorerUrl={sourceExplorerUrl}
      fee={fee}
      netReceived={netReceived}
      onActionAgain={onBridgeAgain}
      onClose={onClose}
      isInline={isInline}
    />
  )
}
