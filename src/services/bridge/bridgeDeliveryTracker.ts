import { logger } from '../../utils/logger'
import { pollForwardedGatewayTransfer } from '../gatewayUcwService'
import { pollCctpDestinationTx } from '../bridgeUcwService'
import {
  verifyDestinationUsdcMint,
  gatewayTransferFeeCeiling,
  resolveDestinationUsdcMintAmount,
  gatewayDeliveredUsdc,
} from '../gatewayService'
import { getExplorerTxUrl } from '../../config/sendConfig'
import { resolveBridgeNetworkFee } from '../bridgeService'
import { applyBridgeDelivery } from '../../utils/bridgeReceipt'
import { completeBridgeTransaction } from '../../utils/history'

const bridgeLog = logger.createScope('bridgeDeliveryTracker')

export interface DestinationDeliveryPollParams {
  isGateway: boolean
  gatewayTransferId?: string
  burnTxHash?: string
  mintTxHash?: string
  sourceChain: string
  destChain: string
  targetRecipient: string
  amount: string
  deliveredTokenSymbol: string
  deliveredTokenIcon: any
  connectedAddress: string
  isPrivateBridge: boolean
  broadcastId: string
  sourceExplorerUrl?: string
  primaryExplorerUrl?: string
  signal: AbortSignal
  setSuccessReceipt: React.Dispatch<React.SetStateAction<any>>
  setIsBridgePending: (pending: boolean) => void
  updateBroadcast: (id: string, update: any) => void
  onSuccess: (amount: string, destTxHash: string) => void
}

/**
 * Polls for real destination transaction on-chain for either Circle Gateway or CCTP bridge,
 * updating the success receipt, transaction store, and floating broadcast notification in real-time.
 */
export async function pollDestinationDelivery({
  isGateway,
  gatewayTransferId,
  burnTxHash,
  mintTxHash,
  sourceChain,
  destChain,
  targetRecipient,
  amount,
  deliveredTokenSymbol,
  deliveredTokenIcon,
  connectedAddress,
  isPrivateBridge,
  broadcastId,
  sourceExplorerUrl,
  primaryExplorerUrl,
  signal,
  setSuccessReceipt,
  setIsBridgePending,
  updateBroadcast,
  onSuccess,
}: DestinationDeliveryPollParams): Promise<void> {
  try {
    let resolvedDestTx: string | undefined = undefined
    let confirmedCctpReceivedAmount: string | undefined = undefined

    if (isGateway && gatewayTransferId) {
      bridgeLog.debug('Polling Circle Gateway Forwarding for real destination tx:', gatewayTransferId)
      const forwarded = await pollForwardedGatewayTransfer(gatewayTransferId, {
        maxAttempts: 30,
        intervalMs: 2500,
        destChain,
        recipient: targetRecipient,
        amount,
        signal,
      })
      if ((forwarded.status === 'confirmed' || forwarded.status === 'finalized') && forwarded.txHash) {
        resolvedDestTx = forwarded.txHash
      }
    } else if (!isGateway && burnTxHash && burnTxHash.startsWith('0x')) {
      bridgeLog.debug('Polling Circle CCTP destination mint for real destination tx:', burnTxHash)
      const cctpDest = await pollCctpDestinationTx({
        sourceChain,
        destChain,
        burnTxHash,
        recipientAddress: targetRecipient,
        amount,
        tokenSymbol: deliveredTokenSymbol,
        mintTxHash: mintTxHash || undefined,
        maxAttempts: 300,
        intervalMs: 3000,
        signal,
      })
      if (cctpDest.status === 'confirmed' && cctpDest.destTxHash && /^0x[0-9a-fA-F]{64}$/.test(cctpDest.destTxHash)) {
        resolvedDestTx = cctpDest.destTxHash
        confirmedCctpReceivedAmount = cctpDest.receivedAmount
      } else {
        bridgeLog.warn(
          `Background CCTP destination poll ended without confirmation for burn ${burnTxHash} → status: ${cctpDest.status}`
        )
      }
    }

    if (
      resolvedDestTx &&
      isGateway &&
      !(await verifyDestinationUsdcMint(
        destChain,
        resolvedDestTx,
        targetRecipient,
        amount,
        gatewayTransferFeeCeiling(amount)
      ))
    ) {
      resolvedDestTx = undefined
    }

    if (resolvedDestTx) {
      bridgeLog.debug('Real destination tx confirmed on-chain:', resolvedDestTx)
      const resolvedExplorerUrl = getExplorerTxUrl(destChain, resolvedDestTx)
      const resolvedDestFeeText = await resolveBridgeNetworkFee(destChain, resolvedDestTx).catch(() => undefined)

      let resolvedGatewayReceivedAmount: string | undefined = undefined
      if (isGateway) {
        const mintedSubunits = await resolveDestinationUsdcMintAmount(destChain, resolvedDestTx, targetRecipient)
        resolvedGatewayReceivedAmount =
          mintedSubunits === null ? undefined : gatewayDeliveredUsdc(mintedSubunits) ?? undefined
      }

      setSuccessReceipt((prev: any) =>
        applyBridgeDelivery(prev, {
          txHash: isGateway ? resolvedDestTx : undefined,
          destTxHash: resolvedDestTx,
          explorerUrl: isGateway ? resolvedExplorerUrl : undefined,
          destExplorerUrl: resolvedExplorerUrl,
          netReceived: isGateway ? resolvedGatewayReceivedAmount : confirmedCctpReceivedAmount,
          destFee: resolvedDestFeeText,
          tokenSymbol: deliveredTokenSymbol,
          tokenIcon: deliveredTokenIcon,
        })
      )
      setIsBridgePending(false)
      completeBridgeTransaction({
        sourceTxHash: burnTxHash,
        destTxHash: resolvedDestTx,
        amount,
        tokenSymbol: deliveredTokenSymbol,
        sourceChain,
        destChain,
        recipient: targetRecipient,
        userAddress: connectedAddress,
        isPrivate: isPrivateBridge,
      })
      onSuccess(amount, resolvedDestTx)

      updateBroadcast(broadcastId, {
        title: 'Bridge Completed Successfully',
        status: 'success',
        badgeText: 'Confirmed',
        details: {
          amount,
          tokenSymbol: deliveredTokenSymbol,
          tokenIcon: deliveredTokenIcon,
          sourceChain,
          destChain,
          bridgeMode: isGateway ? 'gateway' : 'direct',
          network: isGateway ? destChain : sourceChain,
          txHash: isGateway ? resolvedDestTx : burnTxHash,
          destTxHash: resolvedDestTx,
          sourceTxHash: isGateway ? undefined : burnTxHash,
          explorerUrl: isGateway ? resolvedExplorerUrl : primaryExplorerUrl,
          destExplorerUrl: resolvedExplorerUrl,
          sourceExplorerUrl: isGateway ? undefined : sourceExplorerUrl,
        },
      })
    }
  } catch (pollingErr) {
    bridgeLog.warn('Background destination tx resolution notice:', pollingErr)
  }
}
