import {
  decodeEventLog,
  formatUnits,
  parseUnits,
  pad,
  erc20Abi,
  maxUint256,
  type Address,
  type Hex,
} from 'viem'
import { IS_TESTNET } from '../config/networks/networkRegistry'
import { getNetwork } from '../config/networks/networkRegistry'
import { getResilientPublicClient, resilientReadContract, resilientWaitForReceipt } from './rpc'
import { GATEWAY_DOMAINS, USDC_ADDRESSES } from '../config/gatewayConfig'
import { getExplorerTxUrl } from '../config/sendConfig'
import { mapChainKeyToCircleBlockchain } from './gatewayUcwService'

// ── Deterministic CCTP V2 Contract Addresses ─────────────────────────────────
// Circle deploys TokenMessengerV2 and MessageTransmitterV2 at deterministic addresses
// across EVM testnets and mainnets via CREATE2.
export const ARC_CCTP_TOKEN_MESSENGER: Address =
  '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
export const ARC_USDC_ADDRESS: Address =
  '0x3600000000000000000000000000000000000000'

export const CCTP_TOKEN_MESSENGER_TESTNET: Address =
  '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA'
export const CCTP_TOKEN_MESSENGER_MAINNET: Address =
  '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d'

export const CCTP_MESSAGE_TRANSMITTER_TESTNET: Address =
  '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275'
export const CCTP_MESSAGE_TRANSMITTER_MAINNET: Address =
  '0x818fca6485888d447a16E6a26cfB4f61f744e27f'

export const CCTP_MESSAGE_RECEIVED_ABI = [
  {
    type: 'event', name: 'MessageReceived',
    inputs: [
      { type: 'address', indexed: true, name: 'caller' },
      { type: 'uint32', indexed: false, name: 'sourceDomain' },
      { type: 'bytes32', indexed: true, name: 'nonce' },
      { type: 'bytes32', indexed: false, name: 'sender' },
      { type: 'uint32', indexed: true, name: 'finalityThresholdExecuted' },
      { type: 'bytes', indexed: false, name: 'messageBody' },
    ],
  },
] as const

const CCTP_BURN_RECEIVED_ABI = [{
  type: 'event', name: 'MintAndWithdraw',
  inputs: [
    { type: 'address', indexed: true, name: 'mintRecipient' },
    { type: 'uint256', indexed: false, name: 'amount' },
    { type: 'address', indexed: true, name: 'mintToken' },
    { type: 'uint256', indexed: false, name: 'feeCollected' },
  ],
}] as const

/**
 * Resolves the official CCTP TokenMessengerV2 contract address.
 */
export function getCctpTokenMessenger(chainKey?: string): Address {
  const network = chainKey ? getNetwork(chainKey) : undefined
  const isTestnet = network ? network.testnet : IS_TESTNET
  return isTestnet ? CCTP_TOKEN_MESSENGER_TESTNET : CCTP_TOKEN_MESSENGER_MAINNET
}

/**
 * Resolves the official CCTP MessageTransmitterV2 contract address.
 */
export function getCctpMessageTransmitter(chainKey?: string): Address {
  const network = chainKey ? getNetwork(chainKey) : undefined
  const isTestnet = network ? network.testnet : IS_TESTNET
  return isTestnet ? CCTP_MESSAGE_TRANSMITTER_TESTNET : CCTP_MESSAGE_TRANSMITTER_MAINNET
}

/**
 * Resolves the official USDC contract address for a given network key.
 */
export function getSourceUsdcAddress(chainKey: string): Address {
  const configured = USDC_ADDRESSES[chainKey]
  if (configured) return configured as Address
  if (chainKey === 'Arc_Testnet') return ARC_USDC_ADDRESS
  throw new Error(`USDC contract address not found for chain: ${chainKey}`)
}

// Minimal ABI for CCTP TokenMessengerV2 depositForBurn function (7 parameters)
export const CCTP_TOKEN_MESSENGER_ABI = [
  {
    type: 'function',
    name: 'depositForBurn',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
    ],
    outputs: [{ name: '_nonce', type: 'uint64' }],
    stateMutability: 'nonpayable',
  },
] as const

// Minimal ABI for CCTP MessageTransmitterV2 receiveMessage function
export const CCTP_MESSAGE_TRANSMITTER_ABI = [
  {
    type: 'function',
    name: 'receiveMessage',
    inputs: [
      { name: 'message', type: 'bytes' },
      { name: 'attestation', type: 'bytes' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

export const CCTP_IRIS_API = {
  testnet: 'https://iris-api-sandbox.circle.com/v1/attestations',
  mainnet: 'https://iris-api.circle.com/v1/attestations',
} as const

export interface UcwBridgeParams {
  amount: string
  sourceChain: string
  destChain: string
  recipientAddress: string
  connectedAddress: string
  destinationCaller?: Hex
  maxFee?: bigint
  minFinalityThreshold?: number
  executeUcwContract: (params: {
    contractAddress: string
    abiFunctionSignature?: string
    abiParameters?: any[]
    callData?: string
    amount?: string
    blockchain?: string
  }) => Promise<{ success: boolean; txHash?: string; error?: string }>
  onStepProgress?: (step: 'approving' | 'burning' | 'completed') => void
}

export interface UcwBridgeResult {
  burnTxHash: string
  sourceExplorerUrl: string
  destExplorerUrl?: string
  destDomain: number
  amount: string
  mintRecipient: string
  challengeId?: string
}

/**
 * Checks on-chain allowance on the specified source chain for CCTP TokenMessengerV2.
 * Returns true if the user's existing allowance is already sufficient.
 */
export async function checkUcwAllowanceSufficient(
  ownerAddress: string,
  amountInUnits: bigint,
  sourceChain: string = 'Arc_Testnet',
  customTokenMessenger?: Address,
  customUsdcAddress?: Address
): Promise<boolean> {
  try {
    const publicClient = getResilientPublicClient(sourceChain)
    const tokenMessenger = customTokenMessenger || getCctpTokenMessenger(sourceChain)
    const usdcAddress = customUsdcAddress || getSourceUsdcAddress(sourceChain)

    const currentAllowance = (await resilientReadContract(publicClient, {
      address: usdcAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [ownerAddress as Address, tokenMessenger],
    })) as bigint

    console.log(
      `[bridgeUcwService] Checked allowance on ${sourceChain}: current=${currentAllowance.toString()}, required=${amountInUnits.toString()}`
    )
    return currentAllowance >= amountInUnits
  } catch (err) {
    console.warn(`[bridgeUcwService] Failed to read on-chain allowance on ${sourceChain}, defaulting to false:`, err)
    return false
  }
}

/**
 * Executes a CCTP V2 Bridge Transfer using Circle UCW challenges.
 * Supports multi-chain origins (Arc Testnet, Base Sepolia, Ethereum Sepolia, etc.)
 *
 * Flow:
 * 1. Validates source and destination chains, resolving destination CCTP domain ID.
 * 2. Formats recipient address into left-padded 32-byte (bytes32) hex string.
 * 3. Resolves source chain USDC address, CCTP TokenMessengerV2, and Circle blockchain code.
 * 4. Checks existing allowance; if insufficient, executes an approve challenge on source USDC.
 * 5. Executes a depositForBurn challenge on CCTP TokenMessengerV2 for the specific blockchain.
 * 6. Returns transaction hash and block explorer URLs.
 */
export async function executeUcwBridgeTransfer(
  params: UcwBridgeParams
): Promise<UcwBridgeResult> {
  if (!IS_TESTNET) {
    throw new Error('Mainnet execution is disabled until deployments and signing routes are verified.')
  }

  const {
    amount,
    sourceChain,
    destChain,
    recipientAddress,
    connectedAddress,
    destinationCaller,
    maxFee,
    minFinalityThreshold,
    executeUcwContract,
    onStepProgress,
  } = params

  if (!connectedAddress) {
    throw new Error('Circle wallet address not detected. Please verify your connection.')
  }

  if (!sourceChain || !destChain) {
    throw new Error('Please select valid source and destination networks.')
  }

  if (sourceChain === destChain) {
    throw new Error('Source and destination networks cannot be the same.')
  }

  const destDomain = GATEWAY_DOMAINS[destChain]
  if (destDomain === undefined) {
    throw new Error(
      `No valid CCTP domain found for destination chain: ${destChain}`
    )
  }

  const trimmedRecipient = recipientAddress.trim()
  if (!trimmedRecipient) {
    throw new Error('Please enter a valid recipient address.')
  }

  // Format recipient to bytes32 (CCTP specification: left-padded with zeros)
  let mintRecipientBytes32: `0x${string}`
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmedRecipient)) {
    throw new Error('A valid 20-byte EVM recipient address is required for this CCTP bridge.')
  }
  mintRecipientBytes32 = pad(trimmedRecipient.toLowerCase() as Address, { size: 32 })

  if (!/^\d+(?:\.\d{1,6})?$/.test(amount)) throw new Error('Please enter a valid USDC amount (up to 6 decimals).')
  const amountUnits = parseUnits(amount, 6)
  if (amountUnits <= 0n) {
    throw new Error('Please enter a valid USDC amount.')
  }

  const tokenMessenger = getCctpTokenMessenger(sourceChain)
  const sourceUsdc = getSourceUsdcAddress(sourceChain)
  const circleBlockchain = mapChainKeyToCircleBlockchain(sourceChain)

  // ── Step 1: Check & Approve TokenMessengerV2 ──────────────────────────────
  const isAllowanceSufficient = await checkUcwAllowanceSufficient(
    connectedAddress,
    amountUnits,
    sourceChain,
    tokenMessenger,
    sourceUsdc
  )

  if (!isAllowanceSufficient) {
    console.log(`[bridgeUcwService] Allowance insufficient on ${sourceChain}. Initiating UCW approve challenge...`)
    onStepProgress?.('approving')

    // Approve a generous high ceiling (maxUint256) so user never has to re-approve
    const approveRes = await executeUcwContract({
      contractAddress: sourceUsdc,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [tokenMessenger, maxUint256.toString()],
      blockchain: circleBlockchain,
    })

    if (!approveRes.success) {
      throw new Error(
        approveRes.error ||
          'USDC spending approval was rejected or canceled by user.'
      )
    }

    console.log(`[bridgeUcwService] USDC approval authorized on ${sourceChain}:`, approveRes.txHash)

    // CRITICAL: Wait for on-chain inclusion of the approval transaction so that:
    // 1) The wallet's transaction nonce is incremented and fully synchronized on the RPC node.
    // 2) The TokenMessenger contract allowance is confirmed on-chain before attempting depositForBurn.
    // This prevents Error -32603 (Internal transaction queue out of sync / nonce collision).
    if (approveRes.txHash && /^0x[0-9a-fA-F]{64}$/.test(approveRes.txHash)) {
      const publicClient = getResilientPublicClient(sourceChain)
      const approvalReceipt = await resilientWaitForReceipt(publicClient, approveRes.txHash as Hex, 'USDC spending approval')
      if (
        approvalReceipt.status !== 'success' ||
        !approvalReceipt.receipt ||
        approvalReceipt.receipt.transactionHash.toLowerCase() !== approveRes.txHash.toLowerCase()
      ) {
        throw new Error('USDC approval has not been confirmed with a matching on-chain receipt; bridge burn was not submitted.')
      }
      console.log(`[bridgeUcwService] On-chain receipt confirmed for approval on ${sourceChain}`)
    } else {
      // A challenge success without a valid transaction hash is not confirmation. Verify the
      // actual allowance after polling; never proceed to burn on a timeout or RPC error.
      let allowanceConfirmed = false
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((r) => setTimeout(r, 1500))
        allowanceConfirmed = await checkUcwAllowanceSufficient(
          connectedAddress,
          amountUnits,
          sourceChain,
          tokenMessenger,
          sourceUsdc
        )
        if (allowanceConfirmed) {
          console.log(`[bridgeUcwService] Allowance detected on-chain on attempt ${attempt + 1}`)
          break
        }
      }
      if (!allowanceConfirmed) throw new Error('USDC approval has not been confirmed on-chain; bridge burn was not submitted.')
    }
  } else {
    console.log(`[bridgeUcwService] Existing allowance is sufficient on ${sourceChain}. Skipping approve step.`)
  }

  // ── Step 2: Call depositForBurn on TokenMessengerV2 ────────────────────────
  console.log(`[bridgeUcwService] Initiating UCW depositForBurn challenge on ${sourceChain} (${circleBlockchain})...`)
  onStepProgress?.('burning')

  const destinationCallerBytes32 = (destinationCaller || '0x0000000000000000000000000000000000000000000000000000000000000000') as Hex
  const maxFeeUnits = maxFee ?? 0n
  const finalityThreshold = minFinalityThreshold ?? 1000

  const burnRes = await executeUcwContract({
    contractAddress: tokenMessenger,
    abiFunctionSignature: 'depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)',
    abiParameters: [
      amountUnits.toString(),
      Number(destDomain),
      mintRecipientBytes32,
      sourceUsdc,
      destinationCallerBytes32,
      maxFeeUnits.toString(),
      finalityThreshold,
    ],
    blockchain: circleBlockchain,
  })

  if (!burnRes.success) {
    throw new Error(
      burnRes.error ||
        'CCTP TokenMessenger depositForBurn transaction was canceled or rejected.'
    )
  }

  let burnTxHash = burnRes.txHash
  const challengeId = (burnRes as any).challengeId
  if (!burnTxHash || !burnTxHash.startsWith('0x')) {
    // Retry polling getLatestTransaction via UCW API if hash is still being indexed
    try {
      const uToken = localStorage.getItem('arc_ucw_user_token')
      const wId = localStorage.getItem('arc_ucw_wallet_id')
      if (uToken) {
        for (let i = 0; i < 4; i++) {
          await new Promise((r) => setTimeout(r, 1200))
          const pollRes = await fetch('/api/ucw?action=getLatestTransaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userToken: uToken,
              walletId: wId,
              challengeId,
              blockchain: circleBlockchain,
            }),
          })
          const pollData = await pollRes.json()
          if (pollData.success && pollData.txHash && pollData.txHash.startsWith('0x')) {
            burnTxHash = pollData.txHash
            break
          }
        }
      }
    } catch (pollErr) {
      console.warn('[bridgeUcwService] Polling fallback warning for burn txHash:', pollErr)
    }
  }

  if (!burnTxHash || !/^0x[0-9a-fA-F]{64}$/.test(burnTxHash)) {
    return {
      burnTxHash: '',
      sourceExplorerUrl: '',
      destExplorerUrl: undefined,
      destDomain,
      amount,
      mintRecipient: trimmedRecipient,
      challengeId,
    }
  }

  console.log('[bridgeUcwService] CCTP burn transaction submitted:', burnTxHash)
  const sourceClient = getResilientPublicClient(sourceChain)
  const burnReceipt = await resilientWaitForReceipt(sourceClient, burnTxHash as Hex, 'CCTP source burn')
  if (burnReceipt.status !== 'success' || !burnReceipt.receipt || burnReceipt.receipt.transactionHash.toLowerCase() !== burnTxHash.toLowerCase()) {
    throw new Error(burnReceipt.status === 'reverted' ? 'CCTP source burn reverted.' : 'CCTP source burn is not confirmed yet; destination settlement remains pending.')
  }
  onStepProgress?.('completed')

  const sourceExplorerUrl = getExplorerTxUrl(sourceChain, burnTxHash)
  // destExplorerUrl must remain undefined until the real mint transaction is confirmed on the destination chain
  const destExplorerUrl = undefined

  return {
    burnTxHash,
    sourceExplorerUrl,
    destExplorerUrl,
    destDomain,
    amount,
    mintRecipient: trimmedRecipient,
    challengeId,
  }
}

export interface PollCctpDestinationParams {
  sourceChain: string
  destChain: string
  burnTxHash: string
  recipientAddress: string
  amount?: string
  maxAttempts?: number
  intervalMs?: number
  signal?: AbortSignal
}

/**
 * Polls Circle Iris API and the destination chain to resolve the real on-chain mint transaction hash.
 * 1. Checks Circle Iris V2 messages endpoint for attestation completion.
 * 2. Scans destination chain USDC Transfer(0x0, recipient, amount) events emitted upon CCTP mint.
 */
export async function pollCctpDestinationTx(
  params: PollCctpDestinationParams
): Promise<{ status: string; destTxHash?: string; receivedAmount?: string }> {
  const {
    sourceChain,
    destChain,
    burnTxHash,
    recipientAddress,
    amount,
    maxAttempts = 40,
    intervalMs = 3000,
    signal,
  } = params

  if (signal?.aborted) return { status: 'aborted' }

  if (!/^0x[0-9a-fA-F]{64}$/.test(burnTxHash)) {
    return { status: 'invalid_burn_hash' }
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipientAddress)) {
    return { status: 'invalid_recipient' }
  }

  const sourceDomain = GATEWAY_DOMAINS[sourceChain]
  const destDomain = GATEWAY_DOMAINS[destChain]
  const sourceUsdc = USDC_ADDRESSES[sourceChain]
  const destUsdc = USDC_ADDRESSES[destChain]
  if (sourceDomain === undefined || destDomain === undefined || !sourceUsdc || !destUsdc) {
    return { status: 'unsupported_chain' }
  }

  const irisBase = IS_TESTNET
    ? 'https://iris-api-sandbox.circle.com/v2/messages'
    : 'https://iris-api.circle.com/v2/messages'

  const cleanRecipient = recipientAddress.toLowerCase() as Address
  if (!amount || !/^\d+(?:\.\d{1,6})?$/.test(amount)) return { status: 'invalid_amount' }
  const amountUnits = parseUnits(amount, 6)
  if (amountUnits <= 0n) return { status: 'invalid_amount' }

  let destPublicClient: any = null
  try {
    destPublicClient = getResilientPublicClient(destChain)
  } catch (err) {
    console.warn(`[pollCctpDestinationTx] Could not initialize publicClient for ${destChain}:`, err)
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) return { status: 'aborted' }
    try {
      // Step A: Check Circle Iris API for message status
      const irisUrl = `${irisBase}/${sourceDomain}?transactionHash=${burnTxHash}`
      const irisRes = await fetch(irisUrl, { signal: signal ?? AbortSignal.timeout(8000) })
      let correlatedMessage: any = null
      if (!irisRes.ok) {
        if (signal?.aborted) return { status: 'aborted' }
        await new Promise((r) => setTimeout(r, intervalMs))
        continue
      }
      const data = await irisRes.json()
      const messages = Array.isArray(data?.messages) ? data.messages : []
      correlatedMessage = messages.find((candidate: any) => {
        if (typeof candidate?.message !== 'string' || !/^0x[0-9a-fA-F]+$/.test(candidate.message)) return false
        const decoded = candidate.decodedMessage
        const body = decoded?.decodedMessageBody
        // Circle Iris API V2 response does not have root sourceTxHash; if present, it must match burnTxHash
        const matchesSourceTx = !data?.sourceTxHash || data.sourceTxHash.toLowerCase() === burnTxHash.toLowerCase()
        return matchesSourceTx &&
          candidate.cctpVersion === 2 && candidate.status === 'complete' &&
          decoded?.sourceDomain === String(sourceDomain) &&
          decoded?.destinationDomain === String(destDomain) &&
          typeof decoded?.nonce === 'string' && /^\d+$/.test(decoded.nonce) &&
          typeof decoded?.messageBody === 'string' && /^0x[0-9a-fA-F]+$/.test(decoded.messageBody) &&
          body?.mintRecipient?.toLowerCase() === cleanRecipient.toLowerCase() &&
          body?.burnToken?.toLowerCase() === sourceUsdc.toLowerCase() &&
          typeof body?.amount === 'string' && /^\d+$/.test(body.amount) && BigInt(body.amount) === amountUnits
      })
      if (!correlatedMessage) {
        await new Promise((r) => setTimeout(r, intervalMs))
        continue
      }
      const messageNonce = BigInt(correlatedMessage.decodedMessage.nonce)
      console.log(`[pollCctpDestinationTx] Matched Iris CCTP message nonce=${messageNonce} (attempt ${attempt}/${maxAttempts})`)

      // Step B: require the destination MessageTransmitterV2 MessageReceived event to match
      // this exact Iris message nonce/domain/body, then require a successful destination receipt.
      if (destPublicClient && destUsdc) {
        try {
          const latestBlock = await destPublicClient.getBlockNumber()
          // The nonce topic narrows this query to one exact CCTP message; scan the full chain
          // so slow attestations do not disappear after an arbitrary 100-block lookback.
          const transmitter = getCctpMessageTransmitter(destChain)
          const receivedLogs = await destPublicClient.getLogs({
            address: transmitter,
            event: CCTP_MESSAGE_RECEIVED_ABI,
            args: {
              nonce: `0x${messageNonce.toString(16).padStart(64, '0')}` as Hex,
            },
            fromBlock: 0n, toBlock: latestBlock,
          })
          for (const entry of receivedLogs) {
            if (!entry.transactionHash || entry.args?.messageBody?.toLowerCase() !== correlatedMessage.decodedMessage.messageBody.toLowerCase()) continue
            const receipt = await destPublicClient.getTransactionReceipt({ hash: entry.transactionHash })
            if (receipt.status !== 'success' || receipt.transactionHash.toLowerCase() !== entry.transactionHash.toLowerCase()) continue

            // CCTP V2 routes MessageReceived to TokenMessengerV2. Its nested
            // MintAndWithdraw event is stronger proof than a generic USDC Transfer.
            const exactCctpMint = receipt.logs.some((log: any) => {
              if (log.address?.toLowerCase() !== getCctpTokenMessenger(destChain).toLowerCase()) return false
              try {
                const decoded = decodeEventLog({ abi: CCTP_BURN_RECEIVED_ABI, data: log.data, topics: log.topics })
                return String((decoded.args as any).mintRecipient).toLowerCase() === cleanRecipient &&
                  BigInt((decoded.args as any).amount) + BigInt((decoded.args as any).feeCollected || 0n) === amountUnits &&
                  String((decoded.args as any).mintToken).toLowerCase() === destUsdc.toLowerCase()
              } catch {
                return false
              }
            })
            if (exactCctpMint) {
              for (const mintEvent of receipt.logs) {
                if (mintEvent.address?.toLowerCase() !== getCctpTokenMessenger(destChain).toLowerCase()) continue
                try {
                  const decodedMint = decodeEventLog({ abi: CCTP_BURN_RECEIVED_ABI, data: mintEvent.data, topics: mintEvent.topics })
                  const args = decodedMint.args as any
                  if (
                    String(args.mintRecipient).toLowerCase() === cleanRecipient &&
                    BigInt(args.amount) + BigInt(args.feeCollected || 0n) === amountUnits &&
                    String(args.mintToken).toLowerCase() === destUsdc.toLowerCase()
                  ) {
                    return { status: 'confirmed', destTxHash: receipt.transactionHash, receivedAmount: formatUnits(BigInt(args.amount), 6) }
                  }
                } catch {
                  // Ignore unrelated TokenMessenger events in the same receipt.
                }
              }
            }
          }
        } catch (logErr) {
          console.warn(`[pollCctpDestinationTx] Log query notice on attempt ${attempt}:`, logErr)
        }
      }
    } catch (err) {
      console.warn(`[pollCctpDestinationTx] Attempt ${attempt} failed:`, err)
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }

  return { status: 'pending' }
}

/**
 * Polls Circle's Iris attestation API for destination message mint attestation.
 */
export async function fetchCctpAttestation(
  messageHash: string,
  isTestnet: boolean = IS_TESTNET,
  maxAttempts: number = 30,
  intervalMs: number = 2000
): Promise<{ status: string; attestation?: string }> {
  const baseUrl = isTestnet ? CCTP_IRIS_API.testnet : CCTP_IRIS_API.mainnet
  const cleanHash = messageHash.startsWith('0x') ? messageHash : `0x${messageHash}`

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/${cleanHash}`)
      if (response.ok) {
        const data = await response.json()
        if (data.status === 'complete' && data.attestation) {
          return { status: 'complete', attestation: data.attestation }
        }
      }
    } catch {
      // transient network error, retry
    }
    await new Promise((res) => setTimeout(res, intervalMs))
  }

  return { status: 'pending' }
}

/**
 * Submits the attestation and message to the destination chain's MessageTransmitterV2 contract.
 */
export async function executeCctpReceiveMessage(params: {
  destChain: string
  messageBytes: `0x${string}`
  attestationBytes: `0x${string}`
  executeUcwContract: (params: {
    contractAddress: string
    abiFunctionSignature?: string
    abiParameters?: any[]
    callData?: string
    blockchain?: string
  }) => Promise<{ success: boolean; txHash?: string; error?: string }>
}): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (!IS_TESTNET) {
    throw new Error('Mainnet execution is disabled until deployments and signing routes are verified.')
  }
  const { destChain, messageBytes, attestationBytes, executeUcwContract } = params
  const transmitterAddress = getCctpMessageTransmitter(destChain)
  const circleBlockchain = mapChainKeyToCircleBlockchain(destChain)

  return executeUcwContract({
    contractAddress: transmitterAddress,
    abiFunctionSignature: 'receiveMessage(bytes,bytes)',
    abiParameters: [messageBytes, attestationBytes],
    blockchain: circleBlockchain,
  })
}
