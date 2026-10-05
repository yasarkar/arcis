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
  /**
   * Flat Arcis platform fee — rendered as its own receipt row. Never rendered for
   * Gateway Fast transfers, which carry no Arcis platform fee.
   */
  platformFee?: string
  /** Actual gas paid on the source transaction — rendered as the "Source Network Fee" receipt row. */
  networkFee?: string
  /**
   * True when the source leg is a gasless off-chain authorization (Gateway burn
   * intent): the source row then reads 0.00 with the reason instead of vanishing.
   */
  sourceFeeGasless?: boolean
  /** Actual gas charged on the destination chain for the mint, in its native currency (ETH on Base, USDC on Arc). */
  destinationFee?: string
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
  platformFee,
  networkFee,
  sourceFeeGasless,
  destinationFee,
  netReceived,
  onBridgeAgain,
  onClose,
  isInline = false,
}) => {
  return (
    <UnifiedSuccessReceipt
      type="bridge"
      title={pending ? 'Bridge Pending' : undefined}
      titleSubline={pending ? 'Destination Confirmation Required' : undefined}
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
      platformFee={platformFee}
      networkFee={networkFee}
      sourceFeeGasless={sourceFeeGasless}
      destinationFee={destinationFee}
      netReceived={netReceived}
      onActionAgain={onBridgeAgain}
      onClose={onClose}
      isInline={isInline}
    />
  )
}
