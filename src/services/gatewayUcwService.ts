import {
  parseUnits,
  zeroAddress,
  type Address,
} from 'viem'
import {
  ACTIVE_GATEWAY_API,
  ACTIVE_GATEWAY_CONTRACTS,
  GATEWAY_DOMAINS,
  GATEWAY_EIP712_DOMAIN,
  GATEWAY_EIP712_TYPES,
  USDC_ADDRESSES,
} from '../config/gatewayConfig'
import { IS_TESTNET } from '../config/arcChain'
import { getNetwork } from '../config/networks/networkRegistry'
import { getResilientPublicClient } from './rpc'
import {
  getGatewayBalances,
  verifyDestinationUsdcMint,
  gatewayTransferFeeCeiling,
  estimateGatewayMaxFee,
  MAX_BLOCK_HEIGHT,
  type GatewayTransferSpecPayload,
} from './gatewayService'
import { getExplorerTxUrl } from '../config/sendConfig'
import { normalizeCircleBlockchain } from '../utils/circleBlockchain'

// ── Types ────────────────────────────────────────────────────────────────────

export interface UcwGatewayTransferParams {
  amount: string
  sourceChain: string
  destChain: string
  recipientAddress?: string
  connectedAddress: string
  /**
   * Uses Circle's Gateway Forwarding Service (`?enableForwarder=true`).
   *
   * When enabled, Circle performs the destination-chain mint itself, so the UCW
   * user needs NO wallet and NO native gas token on the destination chain.
   * Defaults to `true` because UCW wallets are created on the source chain only.
   */
  useForwarder?: boolean
  signTypedData: (params: {
    data: any
    memo?: string
    blockchain?: string
  }) => Promise<{ success: boolean; signature?: string; error?: string }>
  executeUcwContract: (params: {
    contractAddress: string
    abiFunctionSignature?: string
    abiParameters?: any[]
    callData?: string
    amount?: string
    blockchain?: string
  }) => Promise<{ success: boolean; txHash?: string; error?: string }>
  onStepProgress?: (
    step: 'checking_balance' | 'preparing_wallet' | 'signing' | 'gateway_api' | 'forwarding' | 'minting' | 'completed'
  ) => void
}

export interface UcwGatewayTransferResult {
  mintTxHash: string
  sourceChain: string
  destChain: string
  amount: string
  recipient: string
  sourceExplorerUrl?: string
  destExplorerUrl?: string
  attestation?: string
  challengeId?: string
  /** Circle Gateway transfer id, returned when the Forwarding Service is used. */
  transferId?: string
  /** True when Circle minted on the destination chain (no client-side mint). */
  forwarded: boolean
  /** Final Gateway transfer status reported by `GET /transfer/{id}`. */
  status?: string
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toBytes32(address: string): `0x${string}` {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}` as const
}

function randomHex32(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}` as const
}

// ── Gateway burn-intent fee policy ───────────────────────────────────────────
// Circle's estimate is authoritative. Cross-chain signing fails closed when the
// endpoint cannot provide a quote; a local approximation must never authorize a burn.
// The quote itself lives in gatewayService.estimateGatewayMaxFee (imported below)
// so the UCW and injected-wallet paths sign the exact same value.

/**
 * Polls `GET /v1/transfer/{id}` until the Forwarding Service reaches a terminal
 * state. Circle mints on the destination chain itself, so this replaces the
 * client-side `gatewayMint` step.
 */
export async function pollForwardedGatewayTransfer(
  transferId: string,
  options: { maxAttempts?: number; intervalMs?: number; destChain?: string; recipient?: string; amount?: string } = {}
): Promise<{ status: string; txHash?: string; failureReason?: string }> {
  const { maxAttempts = 40, intervalMs = 3000, destChain, recipient, amount } = options
  if (!transferId || !/^[a-zA-Z0-9_-]{1,160}$/.test(transferId)) return { status: 'invalid_transfer_id' }

  let lastStatus = 'pending'
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${ACTIVE_GATEWAY_API}/transfer/${transferId}`)
      if (res.ok) {
        const details: any = await res.json()
        lastStatus = details?.status || lastStatus

        if (lastStatus === 'confirmed' || lastStatus === 'finalized') {
          const forwarding = details?.forwardingDetails || {}
          const responseTransferId = details?.transferId || details?.id
          if (responseTransferId && responseTransferId !== transferId) return { status: 'pending' }
          const txHash = forwarding.transactionHash || forwarding.txHash || forwarding.mintTransactionHash || details?.transactionHash || details?.txHash
          if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash) || !destChain || !recipient || !amount) return { status: 'pending' }

          const network = getNetwork(destChain)
          if (!network?.viemChain || !USDC_ADDRESSES[destChain]) return { status: 'pending' }
          const publicClient = getResilientPublicClient(network.viemChain)
          const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` })
          if (receipt.status !== 'success' || receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) return { status: 'pending' }

          const hasExactMint = await verifyDestinationUsdcMint(destChain, txHash, recipient, amount, gatewayTransferFeeCeiling(amount))
          return hasExactMint ? { status: lastStatus, txHash } : { status: 'pending' }
        }

        if (lastStatus === 'failed') {
          return {
            status: lastStatus,
            failureReason: details?.forwardingDetails?.failureReason || 'Forwarding service failure',
          }
        }

        if (lastStatus === 'expired') {
          return { status: lastStatus, failureReason: 'Attestation expired before forwarding' }
        }
      }
    } catch (err) {
      console.warn(`[executeUcwGatewayTransfer] Forwarding status poll ${attempt} failed:`, err)
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return { status: lastStatus }
}

/**
 * Maps project internal network keys to Circle's ContractExecutionBlockchain identifier.
 *
 * Fails closed: an unknown chain throws instead of silently falling back to
 * ARC-TESTNET. A substituted identifier makes Circle UCW sign the challenge on
 * the wrong blockchain, so the transfer would be burned on the wrong chain.
 */
export function mapChainKeyToCircleBlockchain(chainKey: string): string {
  if (!chainKey || !chainKey.trim()) {
    throw new Error(
      'Circle UCW transfers require a network selection. Select a supported network and try again.'
    )
  }
  return normalizeCircleBlockchain(chainKey)
}

/**
 * Executes a Circle Gateway Fast Transfer using Circle User-Controlled Wallets (UCW).
 *
 * Architecture Flow:
 * 1. Resolves source/destination domains and USDC token contracts.
 * 2. Resolves the burn-intent fee (`maxFee`/`maxBlockHeight`) from Circle's
 *    Gateway `/estimate` endpoint (forwarding-aware); unavailable quotes fail closed.
 * 3. Pre-flights the Gateway unified balance for `value + maxFee`.
 * 4. Triggers Circle UCW signTypedData challenge (PIN / biometrics) for the EIP-712 BurnIntent.
 * 5. Submits the signed BurnIntent to Circle Gateway `/transfer`.
 * 6. If the Forwarding Service is enabled (default) Circle mints on the destination
 *    chain and the transfer is tracked through `GET /transfer/{id}`; otherwise the
 *    mint is executed on the destination chain via a UCW contract execution challenge.
 */
export async function executeUcwGatewayTransfer(
  params: UcwGatewayTransferParams
): Promise<UcwGatewayTransferResult> {
  const {
    amount,
    sourceChain,
    destChain,
    recipientAddress,
    connectedAddress,
    useForwarder = true,
    signTypedData,
    executeUcwContract,
    onStepProgress,
  } = params

  if (!IS_TESTNET) {
    throw new Error('Mainnet execution is disabled until deployments and signing routes are verified.')
  }

  if (!connectedAddress) {
    throw new Error('Circle UCW wallet address was not found. Please check your session.')
  }

  const sourceDomain = GATEWAY_DOMAINS[sourceChain]
  const destinationDomain = GATEWAY_DOMAINS[destChain]
  if (sourceDomain === undefined || destinationDomain === undefined) {
    throw new Error(`Unsupported network selected: ${sourceChain} or ${destChain}`)
  }

  const sourceUsdc = USDC_ADDRESSES[sourceChain]
  const destUsdc = USDC_ADDRESSES[destChain]
  if (!sourceUsdc || !destUsdc) {
    throw new Error(`USDC contract address is not configured for ${sourceChain} or ${destChain}.`)
  }

  // Resolve both Circle UCW blockchain identifiers BEFORE any signature or
  // Gateway API submission. Unsupported chains must fail closed here: a guessed
  // identifier would sign the burn intent for the wrong blockchain.
  const sourceBlockchainCircle = mapChainKeyToCircleBlockchain(sourceChain)
  const destBlockchainCircle = mapChainKeyToCircleBlockchain(destChain)

  const gatewayWallet = ACTIVE_GATEWAY_CONTRACTS.gatewayWallet
  const gatewayMinter = ACTIVE_GATEWAY_CONTRACTS.gatewayMinter
  const destRecipient = (recipientAddress?.trim() || connectedAddress) as Address

  if (!/^\d+(?:\.\d{1,6})?$/.test(amount) || parseUnits(amount, 6) <= 0n) {
    throw new Error('Gateway transfer amount must be greater than zero and have at most 6 decimal places.')
  }
  const burnValue = parseUnits(amount, 6)
  const isSameChain = sourceDomain === destinationDomain
  const salt = randomHex32()

  // Step 1: Build the TransferSpec (shared by the fee estimate and the EIP-712 payload)
  const spec: GatewayTransferSpecPayload = {
    version: 1,
    sourceDomain,
    destinationDomain,
    sourceContract: toBytes32(gatewayWallet),
    destinationContract: toBytes32(gatewayMinter),
    sourceToken: toBytes32(sourceUsdc),
    destinationToken: toBytes32(destUsdc),
    sourceDepositor: toBytes32(connectedAddress),
    destinationRecipient: toBytes32(destRecipient),
    sourceSigner: toBytes32(connectedAddress),
    destinationCaller: toBytes32(zeroAddress),
    value: burnValue,
    salt,
    hookData: '0x',
  }

  // Step 2: Resolve `maxFee` / `maxBlockHeight`.
  // Circle requires `maxFee >= gas fee + (transfer amount * 0.00005)`; the Gateway
  // /estimate endpoint is the source of truth; the transfer must fail closed if unavailable.
  // With the Forwarding Service the maxFee also covers the forwarding fee.
  onStepProgress?.('checking_balance')
  let maxFee = 0n
  let maxBlockHeight = MAX_BLOCK_HEIGHT

  if (!isSameChain) {
    const estimate = await estimateGatewayMaxFee(spec, useForwarder)
    if (!estimate) {
      throw new Error('Circle Gateway fee estimate is unavailable. Transfer was not signed; retry when the fee quote is available.')
    }
    maxFee = estimate.maxFee
    maxBlockHeight = estimate.maxBlockHeight
  }

  console.log(
    `[executeUcwGatewayTransfer] Burn intent fee: maxFee=${(Number(maxFee) / 1e6).toFixed(6)} USDC, ` +
    `maxBlockHeight=${maxBlockHeight.toString()}, forwarder=${useForwarder}`
  )

  // Step 3: Pre-flight the unified balance.
  // A burn requires `value + fee` on the source domain. When the balance is short we
  // fail loudly instead of silently shrinking the requested transfer amount.
  try {
    const balancesResp = await getGatewayBalances(connectedAddress, IS_TESTNET ? 'testnet' : 'mainnet')
    const sourceItem = balancesResp.balances?.find((b) => b.domain === sourceDomain)

    if (sourceItem) {
      const sourceBalanceUnits = parseUnits(sourceItem.balance || '0', 6)
      const requiredUnits = burnValue + maxFee

      if (sourceBalanceUnits < requiredUnits) {
        throw new Error(
          `Circle Gateway unified balance is insufficient. ` +
          `Available: ${sourceItem.balance} USDC. ` +
          `Required: ${(Number(requiredUnits) / 1e6).toFixed(6)} USDC ` +
          `(${amount} USDC transfer + ${(Number(maxFee) / 1e6).toFixed(6)} USDC Gateway fee). ` +
          `Deposit to the ${sourceChain} network from the Gateway tab and try again.`
        )
      }
    } else {        throw new Error(
          `No deposited unified Gateway balance was found for the ${sourceChain} network. ` +
          `To use Gateway Fast transfer, first deposit a balance from the Gateway tab, or bridge with Direct CCTP instead.`
        )
    }
  } catch (checkErr: any) {
    if (checkErr.message?.includes('Circle Gateway')) {
      throw checkErr
    }
    throw new Error(`Circle Gateway balance could not be verified; refusing to sign transfer: ${checkErr?.message || 'unknown error'}`)
  }

  // Step 4: Build the BurnIntent + EIP-712 payload
  const burnIntent = {
    maxBlockHeight,
    maxFee,
    spec,
  }

  const typedData = {
    types: GATEWAY_EIP712_TYPES,
    domain: GATEWAY_EIP712_DOMAIN,
    primaryType: 'BurnIntent',
    message: {
      maxBlockHeight: maxBlockHeight.toString(),
      maxFee: maxFee.toString(),
      spec: {
        ...spec,
        value: burnValue.toString(),
      },
    },
  }

  // Step 3: Sign BurnIntent via Circle UCW Challenge
  onStepProgress?.('signing')
  console.log(`[executeUcwGatewayTransfer] Requesting signTypedData challenge on ${sourceBlockchainCircle}...`)

  const signRes = await signTypedData({
    data: typedData,
    memo: `Gateway Transfer ${amount} USDC`,
    blockchain: sourceBlockchainCircle,
  })

  if (!signRes.success || !signRes.signature) {
    throw new Error(signRes.error || 'Gateway transfer signature authorization failed.')
  }

  const signature = signRes.signature
  console.log('[executeUcwGatewayTransfer] Signature acquired successfully:', signature.slice(0, 16) + '...')

  // Step 4: Submit to Circle Gateway API
  onStepProgress?.('gateway_api')
  const transferUrl = `${ACTIVE_GATEWAY_API}/transfer?enableForwarder=${useForwarder ? 'true' : 'false'}`
  console.log(`[executeUcwGatewayTransfer] Submitting to Gateway API: ${transferUrl}...`)

  const apiResponse = await fetch(transferUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      [{ burnIntent, signature }],
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value)
    ),
  })

  if (!apiResponse.ok) {
    let errorDetail = ''
    try {
      const errJson = await apiResponse.json()
      errorDetail = errJson.message || errJson.error || JSON.stringify(errJson)
    } catch {
      errorDetail = await apiResponse.text().catch(() => '')
    }

    throw new Error(`Circle Gateway API request failed (${apiResponse.status}): ${errorDetail}`)
  }

  const apiPayload = (await apiResponse.json()) as {
    attestation?: `0x${string}`
    signature?: `0x${string}`
    transferId?: string
  }

  // ── Step 5a: Forwarding Service path ──────────────────────────────────────
  // Circle mints on the destination chain itself, so the UCW user needs neither a
  // wallet nor a native gas balance on the destination chain.
  if (useForwarder) {
    const transferId = apiPayload.transferId
    if (!transferId) {
      throw new Error(
        'Circle Gateway forwarding response did not include a transferId. Please retry the transfer.'
      )
    }

    onStepProgress?.('forwarding')
    console.log(`[executeUcwGatewayTransfer] Forwarding Service transferId: ${transferId}. Polling status...`)

    const forwarded = await pollForwardedGatewayTransfer(transferId, {
      destChain,
      recipient: destRecipient,
      amount,
    })

    if (forwarded.status === 'failed' || forwarded.status === 'expired') {
      throw new Error(
        `Gateway Forwarding Service could not complete (${forwarded.status}): ${forwarded.failureReason || 'unknown reason'}`
      )
    }

    const forwardedTxHash = forwarded.txHash || ''
    if ((forwarded.status === 'confirmed' || forwarded.status === 'finalized') && !/^0x[0-9a-fA-F]{64}$/.test(forwardedTxHash)) {
      throw new Error('Gateway reported completion without a valid destination transaction hash.')
    }
    console.log(
      `[executeUcwGatewayTransfer] Forwarding status=${forwarded.status}, destTxHash=${forwardedTxHash || '(pending)'}`
    )

    onStepProgress?.('completed')

    return {
      mintTxHash: forwardedTxHash,
      sourceChain,
      destChain,
      amount,
      recipient: destRecipient,
      destExplorerUrl: forwardedTxHash ? getExplorerTxUrl(destChain, forwardedTxHash) : undefined,
      forwarded: true,
      transferId,
      status: forwarded.status,
    }
  }

  // ── Step 5b: Client-side mint path (self-funded destination wallet) ────────
  const { attestation, signature: mintSignature } = apiPayload
  if (!attestation || !mintSignature) {
    throw new Error('Circle Gateway response did not include an attestation or mint signature.')
  }

  console.log('[executeUcwGatewayTransfer] Gateway API returned attestation & mintSignature.')

  onStepProgress?.('minting')
  console.log(`[executeUcwGatewayTransfer] Executing gatewayMint on ${destBlockchainCircle} at minter: ${gatewayMinter}...`)

  const mintRes = await executeUcwContract({
    contractAddress: gatewayMinter,
    abiFunctionSignature: 'gatewayMint(bytes,bytes)',
    abiParameters: [attestation, mintSignature],
    blockchain: destBlockchainCircle,
  })

  if (!mintRes.success) {
    throw new Error(mintRes.error || 'Gateway mint could not be executed on the destination chain.')
  }

  let mintTxHash = mintRes.txHash || ''
  const challengeId = (mintRes as any).challengeId
  if (!mintTxHash || !mintTxHash.startsWith('0x')) {
    try {
      const uToken = localStorage.getItem('arc_ucw_user_token')
      const wId = localStorage.getItem('arc_ucw_wallet_id')
      if (uToken) {
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 1200))
          const pollRes = await fetch('/api/ucw?action=getLatestTransaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userToken: uToken,
              walletId: wId,
              challengeId,
              blockchain: destBlockchainCircle,
            }),
          })
          const pollData = await pollRes.json()
          if (pollData.success && pollData.txHash && pollData.txHash.startsWith('0x')) {
            mintTxHash = pollData.txHash
            break
          }
        }
      }
    } catch (pollErr) {
      console.warn('[executeUcwGatewayTransfer] Polling fallback warning for mint txHash:', pollErr)
    }
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(mintTxHash)) throw new Error('Gateway mint challenge did not return a valid destination transaction hash.')
  if (!await verifyDestinationUsdcMint(destChain, mintTxHash, destRecipient, amount, gatewayTransferFeeCeiling(amount))) {
    throw new Error('Gateway mint receipt did not prove the exact USDC delivery to the requested recipient.')
  }
  onStepProgress?.('completed')

  return {
    mintTxHash,
    sourceChain,
    destChain,
    amount,
    recipient: destRecipient,
    destExplorerUrl: mintTxHash ? getExplorerTxUrl(destChain, mintTxHash) : undefined,
    attestation,
    challengeId,
    forwarded: false,
  }
}
