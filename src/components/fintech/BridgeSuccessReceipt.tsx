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
  pending?: boolean
  txHash?: string
  sourceTxHash?: string
  destTxHash?: string
  explorerUrl?: string
  sourceExplorerUrl?: string
  destExplorerUrl?: string
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
  pending = false,
  txHash,
  sourceTxHash,
  destTxHash,
  explorerUrl,
  sourceExplorerUrl,
  destExplorerUrl,
  fee,
  netReceived,
  onBridgeAgain,
  onClose,
  isInline = false,
}) => {
  return (
    <UnifiedSuccessReceipt
      type="bridge"
      title={pending ? 'Bridge Pending — Destination Confirmation Required' : undefined}
      subtitle={pending ? 'The source transaction was submitted. Destination mint is not yet verified; no final delivery is claimed.' : undefined}
      status={pending ? 'pending' : 'success'}
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
      destTxHash={destTxHash}
      explorerUrl={explorerUrl}
      sourceExplorerUrl={sourceExplorerUrl}
      destExplorerUrl={destExplorerUrl}
      fee={fee}
      netReceived={netReceived}
      onActionAgain={onBridgeAgain}
      onClose={onClose}
      isInline={isInline}
    />
  )
}
