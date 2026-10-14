// src/utils/bridgeReceipt.ts
//
// Pure builders for the Bridge success receipt.
//
// The receipt is the one surface where "what actually arrives" is stated as a
// number, and four different paths feed it: Gateway, injected-wallet CCTP, UCW
// CCTP, and the post-failure recovery of a burn whose mint is still in flight.
// Keeping the field selection pure and here — instead of inline in a 2,300-line
// modal — is what makes those paths testable without a wallet, an RPC or a
// rendered component.
//
// Two rules the shape below encodes, both learned the hard way:
//
//   1. Nothing is ever *estimated* into `netReceived`. It is `undefined` until a
//      destination receipt (or, for Gateway, the mint's own amount) proves a
//      delivered number.
//   2. A pending transfer still carries its source burn hash, so the receipt can
//      point at the transaction the user actually signed.

export type BridgeReceiptMode = 'direct' | 'gateway'

export interface BridgeReceipt {
  /** Primary hash the receipt links to (destination mint on Gateway, burn otherwise). */
  txHash?: string
  sourceTxHash?: string
  destTxHash?: string
  explorerUrl?: string
  sourceExplorerUrl?: string
  destExplorerUrl?: string
  amount: string
  tokenSymbol: string
  tokenIcon?: string
  sourceChain: string
  destChain: string
  networkFee?: string
  destFee?: string
  netReceived?: string
  mode: BridgeReceiptMode
}

export interface BridgeReceiptInputs {
  mode: BridgeReceiptMode
  amount: string
  tokenSymbol: string
  tokenIcon?: string
  sourceChain: string
  destChain: string
  /** True only when the destination mint's receipt proved the delivery. */
  destinationConfirmed: boolean
  /** Source burn hash, present as soon as the source transaction landed. */
  burnTxHash?: string
  /** Destination mint hash, when one is known. */
  mintTxHash?: string
  sourceExplorerUrl?: string
  destExplorerUrl?: string
  networkFee?: string
  destFee?: string
  /** Already resolved by `resolveBridgeNetReceived`; `undefined` means unknown. */
  netReceived?: string
}

/**
 * Net Received for a completed transfer — the delivered amount, or `undefined`
 * while the destination is unconfirmed. Never a guess: an unconfirmed transfer
 * shows no net amount rather than a fee-derived estimate presented as fact.
 *
 * Precedence: a measured delivery beats a measured fee-derived amount, which
 * beats the quoted fee.
 */
export function resolveBridgeNetReceived(params: {
  destinationConfirmed: boolean
  mode: BridgeReceiptMode
  amount: string
  /** Gateway only: what the destination mint receipt proved was minted. */
  gatewayReceivedAmount?: string
  /** CCTP only: what the decoded message/mint proved was received. */
  confirmedCctpReceivedAmount?: string
  /** CCTP fee deducted from the transfer, used only when nothing is measured. */
  fallbackFee?: string
}): string | undefined {
  const { destinationConfirmed, mode, amount, gatewayReceivedAmount, confirmedCctpReceivedAmount } = params

  if (!destinationConfirmed) return undefined
  // Gateway mints the full principal: Circle bills its own cost from the unified
  // balance, so the fallback is the full bridged amount, never a haircut.
  if (mode === 'gateway') return gatewayReceivedAmount ?? amount

  if (confirmedCctpReceivedAmount) return confirmedCctpReceivedAmount

  const parsedAmount = Number.parseFloat(amount)
  if (!Number.isFinite(parsedAmount)) return undefined
  const fee = Number.parseFloat(params.fallbackFee ?? '')
  const net = parsedAmount - (Number.isFinite(fee) ? fee : 0)
  return Math.max(0, net).toFixed(6)
}

/**
 * The receipt for a submitted transfer. A transfer whose destination is not yet
 * confirmed keeps its source hash and reports no net amount.
 */
export function buildBridgeReceipt(inputs: BridgeReceiptInputs): BridgeReceipt {
  const { mode, destinationConfirmed, burnTxHash, mintTxHash, sourceExplorerUrl, destExplorerUrl } = inputs
  const isGateway = mode === 'gateway'

  // A mint hash only counts when the delivery was *proved*; a candidate hash from
  // a forwarded transfer is evidence, not confirmation.
  const confirmedMintTxHash = destinationConfirmed ? mintTxHash : undefined
  const hasRealDestTx = Boolean(destinationConfirmed && confirmedMintTxHash)

  return {
    txHash: destinationConfirmed
      ? isGateway
        ? confirmedMintTxHash
        : burnTxHash
      : isGateway
        ? undefined
        : burnTxHash,
    sourceTxHash: isGateway ? undefined : burnTxHash,
    destTxHash: hasRealDestTx ? confirmedMintTxHash : undefined,
    // Gateway's primary transaction is the destination mint; a CCTP transfer's is
    // the source burn while the mint is still pending.
    explorerUrl: isGateway
      ? hasRealDestTx
        ? destExplorerUrl
        : undefined
      : burnTxHash && sourceExplorerUrl
        ? sourceExplorerUrl
        : hasRealDestTx
          ? destExplorerUrl
          : undefined,
    sourceExplorerUrl: isGateway || !burnTxHash ? undefined : sourceExplorerUrl,
    destExplorerUrl: hasRealDestTx ? destExplorerUrl : undefined,
    amount: inputs.amount,
    tokenSymbol: inputs.tokenSymbol,
    tokenIcon: inputs.tokenIcon,
    sourceChain: inputs.sourceChain,
    destChain: inputs.destChain,
    networkFee: inputs.networkFee,
    destFee: inputs.destFee,
    netReceived: inputs.netReceived,
    mode,
  }
}

/**
 * Fields a background destination poll can add to a receipt already on screen.
 * `undefined` means "keep what the receipt has" — a poll that could not read the
 * destination fee must not blank the fee the receipt already showed.
 */
export interface BridgeDeliveryPatch {
  /** Gateway only: the mint becomes the primary transaction. */
  txHash?: string
  destTxHash?: string
  /** Gateway only: the mint becomes the primary explorer link. */
  explorerUrl?: string
  destExplorerUrl?: string
  netReceived?: string
  destFee?: string
  tokenSymbol?: string
  tokenIcon?: string
}

/** Applies a resolved delivery to the receipt on screen, keeping unknown fields. */
export function applyBridgeDelivery(
  receipt: BridgeReceipt | null | undefined,
  patch: BridgeDeliveryPatch
): BridgeReceipt | null {
  if (!receipt) return null

  const defined = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  ) as Partial<BridgeDeliveryPatch>

  return { ...receipt, ...defined }
}
