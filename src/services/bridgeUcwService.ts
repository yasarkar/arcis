import {
  parseUnits,
  pad,
  erc20Abi,
  maxUint256,
  type Address,
  type Hex,
} from 'viem'
import { arcTestnet } from '../config/arcChain'
import { getResilientPublicClient, resilientReadContract, resilientWaitForReceipt } from './rpc'
import { GATEWAY_DOMAINS, USDC_ADDRESSES } from '../config/gatewayConfig'
import { getExplorerTxUrl } from '../config/sendConfig'
import { mapChainKeyToCircleBlockchain } from './gatewayUcwService'
import { IS_TESTNET } from '../config/networks/networkRegistry'

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

/**
 * Resolves the official CCTP TokenMessengerV2 contract address.
 */
export function getCctpTokenMessenger(_chainKey?: string): Address {
  return IS_TESTNET ? CCTP_TOKEN_MESSENGER_TESTNET : CCTP_TOKEN_MESSENGER_MAINNET
}

/**
 * Resolves the official CCTP MessageTransmitterV2 contract address.
 */
export function getCctpMessageTransmitter(_chainKey?: string): Address {
  return IS_TESTNET ? CCTP_MESSAGE_TRANSMITTER_TESTNET : CCTP_MESSAGE_TRANSMITTER_MAINNET
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

// Minimal ABI for CCTP TokenMessengerV2 depositForBurn function
export const CCTP_TOKEN_MESSENGER_ABI = [
  {
    type: 'function',
    name: 'depositForBurn',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint64' }],
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
  const {
    amount,
    sourceChain,
    destChain,
    recipientAddress,
    connectedAddress,
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
  if (trimmedRecipient.startsWith('0x') && trimmedRecipient.length === 42) {
    mintRecipientBytes32 = pad(trimmedRecipient.toLowerCase() as Address, {
      size: 32,
    })
  } else {
    mintRecipientBytes32 = (trimmedRecipient.startsWith('0x')
      ? trimmedRecipient
      : `0x${trimmedRecipient}`) as `0x${string}`
  }

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
    if (approveRes.txHash && approveRes.txHash.startsWith('0x')) {
      try {
        const publicClient = getResilientPublicClient(sourceChain)
        await resilientWaitForReceipt(publicClient, approveRes.txHash as Hex, 'USDC spending approval')
        console.log(`[bridgeUcwService] On-chain receipt confirmed for approval on ${sourceChain}`)
      } catch (receiptErr) {
        console.warn(`[bridgeUcwService] Approval receipt wait warning:`, receiptErr)
      }
    } else {
      // If txHash was not immediately returned, poll allowance briefly to confirm on-chain propagation
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((r) => setTimeout(r, 1500))
        const hasAllowance = await checkUcwAllowanceSufficient(
          connectedAddress,
          amountUnits,
          sourceChain,
          tokenMessenger,
          sourceUsdc
        )
        if (hasAllowance) {
          console.log(`[bridgeUcwService] Allowance detected on-chain on attempt ${attempt + 1}`)
          break
        }
      }
    }
  } else {
    console.log(`[bridgeUcwService] Existing allowance is sufficient on ${sourceChain}. Skipping approve step.`)
  }

  // ── Step 2: Call depositForBurn on TokenMessengerV2 ────────────────────────
  console.log(`[bridgeUcwService] Initiating UCW depositForBurn challenge on ${sourceChain} (${circleBlockchain})...`)
  onStepProgress?.('burning')

  const burnRes = await executeUcwContract({
    contractAddress: tokenMessenger,
    abiFunctionSignature: 'depositForBurn(uint256,uint32,bytes32,address)',
    abiParameters: [
      amountUnits.toString(),
      Number(destDomain),
      mintRecipientBytes32,
      sourceUsdc,
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

  if (!burnTxHash || !burnTxHash.startsWith('0x')) {
    burnTxHash = `ucw-burn-${Date.now()}`
  }

  console.log('[bridgeUcwService] CCTP burn transaction successful:', burnTxHash)
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
}

/**
 * Polls Circle Iris API and the destination chain to resolve the real on-chain mint transaction hash.
 * 1. Checks Circle Iris V2 messages endpoint for attestation completion.
 * 2. Scans destination chain USDC Transfer(0x0, recipient, amount) events emitted upon CCTP mint.
 */
export async function pollCctpDestinationTx(
  params: PollCctpDestinationParams
): Promise<{ status: string; destTxHash?: string }> {
  const {
    sourceChain,
    destChain,
    burnTxHash,
    recipientAddress,
    amount,
    maxAttempts = 40,
    intervalMs = 3000,
  } = params

  if (!burnTxHash || !burnTxHash.startsWith('0x')) {
    return { status: 'invalid_burn_hash' }
  }

  const sourceDomain = GATEWAY_DOMAINS[sourceChain]
  const destUsdc = USDC_ADDRESSES[destChain]
  if (sourceDomain === undefined || !destUsdc) {
    return { status: 'unsupported_chain' }
  }

  const irisBase = IS_TESTNET
    ? 'https://iris-api-sandbox.circle.com/v2/messages'
    : 'https://iris-api.circle.com/v2/messages'

  const cleanRecipient = (
    recipientAddress.startsWith('0x') ? recipientAddress.toLowerCase() : `0x${recipientAddress.toLowerCase()}`
  ) as Address

  const amountUnits = amount ? parseUnits(amount, 6) : undefined

  let destPublicClient: any = null
  try {
    destPublicClient = getResilientPublicClient(destChain)
  } catch (err) {
    console.warn(`[pollCctpDestinationTx] Could not initialize publicClient for ${destChain}:`, err)
  }

  // Record initial start block height on destination chain if available
  let startBlock: bigint = 0n
  if (destPublicClient) {
    try {
      const cur = await destPublicClient.getBlockNumber()
      startBlock = cur > 100n ? cur - 100n : 0n
    } catch {
      // ignore
    }
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Step A: Check Circle Iris API for message status
      const irisUrl = `${irisBase}/${sourceDomain}?transactionHash=${burnTxHash}`
      const irisRes = await fetch(irisUrl)
      if (irisRes.ok) {
        const data = await irisRes.json()
        const msg = data?.messages?.[0]
        if (msg) {
          console.log(`[pollCctpDestinationTx] Iris status=${msg.status} (attempt ${attempt}/${maxAttempts})`)
        }
      }

      // Step B: Query destination chain for USDC Transfer from zeroAddress to recipient (the mint event)
      if (destPublicClient && destUsdc) {
        try {
          const latestBlock = await destPublicClient.getBlockNumber()
          const fromBlock = startBlock > 0n ? startBlock : (latestBlock > 200n ? latestBlock - 200n : 0n)

          const logs = await destPublicClient.getLogs({
            address: destUsdc,
            event: {
              type: 'event',
              name: 'Transfer',
              inputs: [
                { type: 'address', indexed: true, name: 'from' },
                { type: 'address', indexed: true, name: 'to' },
                { type: 'uint256', indexed: false, name: 'value' },
              ],
            },
            args: {
              from: '0x0000000000000000000000000000000000000000' as Address,
              to: cleanRecipient,
            },
            fromBlock,
            toBlock: latestBlock,
          })

          if (logs && logs.length > 0) {
            let matchingLog = logs[logs.length - 1]
            if (amountUnits) {
              const exact = logs.find((l: any) => l.args?.value === amountUnits)
              if (exact) matchingLog = exact
            }
            if (matchingLog && matchingLog.transactionHash) {
              console.log(
                `[pollCctpDestinationTx] Found confirmed destination mint tx on ${destChain}:`,
                matchingLog.transactionHash
              )
              return { status: 'confirmed', destTxHash: matchingLog.transactionHash }
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
