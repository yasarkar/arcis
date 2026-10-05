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

// ABI for CCTP TokenMessengerV2 depositForBurnWithHook (8 parameters).
// The extra hookData parameter carries the Circle Forwarding Service request
// ("cctp-forward"), which makes Circle submit the destination mint itself.
export const CCTP_TOKEN_MESSENGER_HOOK_ABI = [
  {
    type: 'function',
    name: 'depositForBurnWithHook',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'destinationDomain', type: 'uint32' },
      { name: 'mintRecipient', type: 'bytes32' },
      { name: 'burnToken', type: 'address' },
      { name: 'destinationCaller', type: 'bytes32' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'minFinalityThreshold', type: 'uint32' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [{ name: '_nonce', type: 'uint64' }],
    stateMutability: 'nonpayable',
  },
] as const

/**
 * Circle Forwarding Service hook (version 0, no extra data). Circle's
 * infrastructure watches for this marker in the burn's hookData and broadcasts
 * the destination mint, so the sender does not need a funded wallet on the
 * destination chain.
 */
export const CCTP_FORWARD_HOOK_DATA: Hex =
  '0x636374702d666f72776172640000000000000000000000000000000000000000'
const CCTP_FORWARD_HOOK_PREFIX = '0x636374702d666f7277617264' // "cctp-forward"

/** True when a decoded Iris message body was burned through the Forwarding Service. */
export function isForwardedCctpMessageBody(body: any): boolean {
  return (
    typeof body?.hookData === 'string' &&
    body.hookData.toLowerCase().startsWith(CCTP_FORWARD_HOOK_PREFIX)
  )
}

/**
 * Decides whether a decoded Iris message body carries the transfer the user
 * submitted for `amountUnits`.
 *
 * A plain self-mint burn records the user's amount directly. A burn submitted
 * through the Forwarding Service (App Kit's `useForwarder`, and the UCW direct
 * bridge) instead reserves the CCTP protocol fee AND the forwarding fee on top
 * of the amount, so the message records `amount + maxFee` while the destination
 * mint delivers the requested amount (or the reserved fee's remainder).
 *
 * Correlating only the raw burn amount made every forwarded transfer stay
 * "Bridge Pending" forever even after its mint had already landed — the exact
 * bug this predicate fixes.
 */
export function cctpMessageAmountMatches(body: any, amountUnits: bigint): boolean {
  if (typeof body?.amount !== 'string' || !/^\d+$/.test(body.amount)) return false
  const burnAmount = BigInt(body.amount)
  if (burnAmount === amountUnits) return true

  if (!isForwardedCctpMessageBody(body)) return false

  const maxFee = parseSubunitAmount(body.maxFee)
  // Reserved fees burned on top of the user's amount (live App Kit behavior:
  // message amount = user amount + maxFee, feeExecuted = maxFee).
  if (maxFee !== null && burnAmount === amountUnits + maxFee) return true

  const feeExecuted = parseSubunitAmount(body.feeExecuted)
  // Fee deducted from the transfer instead of reserved on top.
  if (feeExecuted !== null && burnAmount > feeExecuted && burnAmount - feeExecuted === amountUnits) {
    return true
  }
  return false
}

function parseSubunitAmount(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

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

/** Circle Iris V2 REST base — the fee and message endpoints live under /v2. */
export const CCTP_IRIS_V2_BASE = IS_TESTNET
  ? 'https://iris-api-sandbox.circle.com'
  : 'https://iris-api.circle.com'

/**
 * Reads Circle's live Fast Transfer fee for a route (in basis points) from
 * `GET /v2/burn/USDC/fees/{sourceDomain}/{destDomain}`.
 *
 * Circle explicitly says "Do not hardcode fee values. Fees can change at any
 * time" — so every place that needs a CCTP fee (burn maxFee, UI estimates)
 * quotes this endpoint first. Returns `null` whenever the quote is unavailable
 * so callers can fall back to their static estimate instead of failing.
 */
export async function fetchCctpFastFeeBps(
  sourceChain: string,
  destChain: string
): Promise<number | null> {
  const sourceDomain = GATEWAY_DOMAINS[sourceChain]
  const destDomain = GATEWAY_DOMAINS[destChain]
  if (sourceDomain === undefined || destDomain === undefined) return null

  try {
    const response = await fetch(
      `${CCTP_IRIS_V2_BASE}/v2/burn/USDC/fees/${sourceDomain}/${destDomain}`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!response.ok) return null

    const payload: any = await response.json()
    const fees = Array.isArray(payload) ? payload : payload?.fees
    const minimumFee = Number(fees?.[0]?.minimumFee)
    if (!Number.isFinite(minimumFee) || minimumFee < 0) return null
    return minimumFee
  } catch (err) {
    console.warn('[bridgeUcwService] CCTP fast-fee quote unavailable:', err)
    return null
  }
}

/**
 * Converts a quoted fee (basis points) into USDC subunits for `maxFee`, with the
 * 20% buffer Circle recommends so a small fee fluctuation cannot revert the burn.
 */
export function cctpFastFeeSubunits(amountUnits: bigint, feeBps: number): bigint {
  if (amountUnits <= 0n || !Number.isFinite(feeBps) || feeBps <= 0) return 0n
  const protocolFee = (amountUnits * BigInt(Math.round(feeBps * 100))) / 1_000_000n
  return (protocolFee * 120n) / 100n
}

export interface CctpForwardQuote {
  finalityThreshold: number
  /** Live CCTP Fast Transfer fee for the route, in basis points (0 = Standard). */
  minimumFeeBps: number
  /** Forwarding Service fee in USDC subunits (6 decimals), covering destination gas. */
  forwardFeeSubunits: bigint
}

/**
 * Reads Circle's live Forwarding Service quote for a route from
 * `GET /v2/burn/USDC/fees/{sourceDomain}/{destDomain}?forward=true`.
 *
 * The response carries per-finality entries with `minimumFee` (CCTP protocol
 * fee, bps) and `forwardFee` (destination gas + service fee, USDC subunits).
 * A missing `forwardFee` means the route cannot be forwarded, so callers can
 * fail closed before burning funds that nothing would mint on the destination.
 */
export async function fetchCctpForwardQuote(
  sourceChain: string,
  destChain: string,
  finalityThreshold: number = 1000
): Promise<CctpForwardQuote | null> {
  const sourceDomain = GATEWAY_DOMAINS[sourceChain]
  const destDomain = GATEWAY_DOMAINS[destChain]
  if (sourceDomain === undefined || destDomain === undefined) return null

  try {
    const response = await fetch(
      `${CCTP_IRIS_V2_BASE}/v2/burn/USDC/fees/${sourceDomain}/${destDomain}?forward=true`,
      { signal: AbortSignal.timeout(8000) }
    )
    if (!response.ok) return null

    const payload: any = await response.json()
    const fees = Array.isArray(payload) ? payload : payload?.fees
    if (!Array.isArray(fees) || fees.length === 0) return null

    const numeric = (value: unknown): number | null => {
      const n = Number(value)
      return Number.isFinite(n) && n >= 0 ? n : null
    }

    const entry =
      fees.find((f: any) => numeric(f?.finalityThreshold) === finalityThreshold) ?? fees[0]
    if (!entry || typeof entry !== 'object') return null

    const minimumFeeBps = numeric(entry.minimumFee) ?? 0
    const forwardFee = entry.forwardFee
    const forwardFeeRaw =
      numeric(forwardFee?.med) ?? numeric(forwardFee?.low) ?? numeric(forwardFee?.high)
    if (forwardFeeRaw === null || !Number.isInteger(forwardFeeRaw)) return null
    const forwardFeeSubunits = BigInt(forwardFeeRaw)
    if (forwardFeeSubunits <= 0n) return null

    return {
      finalityThreshold: numeric(entry.finalityThreshold) ?? finalityThreshold,
      minimumFeeBps,
      forwardFeeSubunits,
    }
  } catch (err) {
    console.warn('[bridgeUcwService] CCTP forwarding quote unavailable:', err)
    return null
  }
}

/**
 * Lookback (in destination blocks) used as the floor when scanning for the
 * MessageReceived event. The mint cannot be emitted before this poll starts,
 * so a single floor captured on the first attempt keeps every later attempt
 * from rescanning the whole destination chain, while the buffer still covers
 * blocks that were already mined when the poll began.
 */
export const CCTP_DEST_SCAN_LOOKBACK_BLOCKS = 2000n

/**
 * Parses the CCTP message nonce returned by Circle's Iris API.
 *
 * Circle documents the nonce as a decimal string ("569"), but the live API
 * returns a 0x-prefixed 32-byte hex string ("0xb89321…") for current CCTP V2
 * messages — correlation that only accepted decimal digits silently never
 * matched, leaving bridges stuck on "Bridge Pending" forever. Both shapes
 * encode the same bytes32 nonce, so either is accepted; anything else
 * returns null so a malformed payload can never correlate (fail-closed).
 */
export function parseCctpMessageNonce(nonce: unknown): bigint | null {
  if (typeof nonce !== 'string' || !/^(?:0x[0-9a-fA-F]+|\d+)$/.test(nonce)) return null
  try {
    const value = BigInt(nonce)
    return value >= 0n && value < 2n ** 256n ? value : null
  } catch {
    return null
  }
}

export interface UcwBridgeParams {
  amount: string
  sourceChain: string
  destChain: string
  recipientAddress: string
  connectedAddress: string
  destinationCaller?: Hex
  maxFee?: bigint
  minFinalityThreshold?: number
  /**
   * Route the burn through Circle's Forwarding Service (default true) so
   * Circle submits the destination mint. Without it nothing mints on the
   * destination and the transfer stays pending forever.
   */
  useForwarder?: boolean
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
  /** True when the burn carried the Circle Forwarding Service hook. */
  forwarded?: boolean
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
 * 4. Resolves the Forwarding Service fee quote (fail-closed when unavailable) so
 *    Circle submits the destination mint.
 * 5. Checks existing allowance; if insufficient, executes an approve challenge on source USDC.
 * 6. Executes a depositForBurnWithHook challenge on CCTP TokenMessengerV2 for the specific blockchain.
 * 7. Returns transaction hash and block explorer URLs.
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

  const finalityThreshold = minFinalityThreshold ?? 1000
  const useForwarder = params.useForwarder ?? true

  // ── Step 0: Resolve the Forwarding Service intent and burn fee ────────────
  // Done BEFORE any approval challenge so a route that cannot be forwarded
  // never prompts the user and never burns funds that nothing would mint on
  // the destination. A plain depositForBurn (destinationCaller = 0) has no
  // relayer: the destination would stay pending until someone manually calls
  // receiveMessage, which is exactly the stuck state being fixed here.
  let forwardingHookData: Hex | null = null
  let maxFeeUnits = maxFee ?? 0n
  if (useForwarder) {
    const forwardQuote = await fetchCctpForwardQuote(sourceChain, destChain, finalityThreshold)
    if (!forwardQuote) {
      throw new Error(
        'Circle Forwarding Service is unavailable for this route right now, so the destination mint cannot be guaranteed. No funds were burned — please retry shortly.'
      )
    }
    if (maxFee === undefined) {
      // `maxFee` must cover the CCTP protocol fee AND the Forwarding Service
      // fee; Circle degrades to a Standard Transfer when it is too low.
      const protocolFee = cctpFastFeeSubunits(amountUnits, forwardQuote.minimumFeeBps)
      maxFeeUnits = protocolFee + forwardQuote.forwardFeeSubunits
    }
    forwardingHookData = CCTP_FORWARD_HOOK_DATA
    console.log(
      `[bridgeUcwService] Forwarding Service enabled for ${sourceChain}→${destChain}: maxFee=${maxFeeUnits} subunits (threshold ${finalityThreshold})`
    )
  } else if (maxFee === undefined && finalityThreshold <= 1000) {
    // Fast transfers (finalityThreshold <= 1000) revert on the SOURCE chain when
    // the live Circle fee exceeds the signed maxFee, so signing maxFee = 0 only
    // works while the route's fee happens to be zero. Quote the current fee
    // (plus Circle's recommended 20% buffer) instead of hardcoding a guess; when
    // the quote is unavailable keep the previous maxFee = 0 behavior.
    const feeBps = await fetchCctpFastFeeBps(sourceChain, destChain)
    if (feeBps !== null) {
      maxFeeUnits = cctpFastFeeSubunits(amountUnits, feeBps)
      console.log(
        `[bridgeUcwService] Quoted CCTP fast fee ${feeBps} bps → maxFee=${maxFeeUnits} subunits`
      )
    } else {
      console.warn('[bridgeUcwService] CCTP fee quote unavailable; signing depositForBurn with maxFee=0.')
    }
  }

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

  // ── Step 2: Burn on TokenMessengerV2 (with Forwarding Service hook) ───────
  console.log(
    `[bridgeUcwService] Initiating UCW ${forwardingHookData ? 'depositForBurnWithHook' : 'depositForBurn'} challenge on ${sourceChain} (${circleBlockchain})...`
  )
  onStepProgress?.('burning')

  const destinationCallerBytes32 = (destinationCaller || '0x0000000000000000000000000000000000000000000000000000000000000000') as Hex

  const burnArgs = [
    amountUnits.toString(),
    Number(destDomain),
    mintRecipientBytes32,
    sourceUsdc,
    destinationCallerBytes32,
    maxFeeUnits.toString(),
    finalityThreshold,
  ]

  const burnRes = await executeUcwContract({
    contractAddress: tokenMessenger,
    abiFunctionSignature: forwardingHookData
      ? 'depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)'
      : 'depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)',
    abiParameters: forwardingHookData ? [...burnArgs, forwardingHookData] : burnArgs,
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
    forwarded: Boolean(forwardingHookData),
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

  // Destination block floor captured once on the first attempt; see
  // CCTP_DEST_SCAN_LOOKBACK_BLOCKS for why a bounded window is safe here.
  let scanFromBlock: bigint | null = null
  // Attempts where Iris answered with a non-OK status (message not indexed
  // yet, transient errors). Reported in the exhaustion warning so a stuck
  // pending state is diagnosable instead of silent.
  let irisMisses = 0
  // Attempts where the destination log scan itself failed (RPC error/misuse).
  // Counted separately from "no mint found" so a broken scan is visible.
  let scanFailures = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) return { status: 'aborted' }
    try {
      // Step A: Check Circle Iris API for message status
      const irisUrl = `${irisBase}/${sourceDomain}?transactionHash=${burnTxHash}`
      const irisRes = await fetch(irisUrl, { signal: signal ?? AbortSignal.timeout(8000) })
      let correlatedMessage: any = null
      if (!irisRes.ok) {
        irisMisses++
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
        const matchesEnvelope =
          matchesSourceTx &&
          candidate.cctpVersion === 2 && candidate.status === 'complete' &&
          decoded?.sourceDomain === String(sourceDomain) &&
          decoded?.destinationDomain === String(destDomain) &&
          parseCctpMessageNonce(decoded?.nonce) !== null &&
          typeof decoded?.messageBody === 'string' && /^0x[0-9a-fA-F]+$/.test(decoded.messageBody) &&
          body?.mintRecipient?.toLowerCase() === cleanRecipient.toLowerCase() &&
          body?.burnToken?.toLowerCase() === sourceUsdc.toLowerCase()
        if (!matchesEnvelope) return false
        // Amount correlation accepts both self-mint burns (amount == user amount)
        // and Forwarding Service burns (amount == user amount + reserved fees).
        return cctpMessageAmountMatches(body, amountUnits)
      })
      if (!correlatedMessage) {
        await new Promise((r) => setTimeout(r, intervalMs))
        continue
      }
      const messageNonce = parseCctpMessageNonce(correlatedMessage.decodedMessage?.nonce)
      if (messageNonce === null) {
        await new Promise((r) => setTimeout(r, intervalMs))
        continue
      }
      // The correlated Iris message is the ground truth for the burn: for a
      // forwarded transfer it records the user's amount PLUS the reserved
      // protocol/forwarding fees, so the destination mint must be verified
      // against this gross amount — comparing against the user's amount made
      // every forwarded mint invisible and the receipt stuck on "Pending".
      const correlatedBurnAmount = BigInt(
        correlatedMessage.decodedMessage.decodedMessageBody.amount
      )
      console.log(
        `[pollCctpDestinationTx] Matched Iris CCTP message nonce=0x${messageNonce.toString(16)} (attempt ${attempt}/${maxAttempts})`
      )

      // Step B: require the destination MessageTransmitterV2 MessageReceived event to match
      // this exact Iris message nonce/domain/body, then require a successful destination receipt.
      if (destPublicClient && destUsdc) {
        try {
          const latestBlock = await destPublicClient.getBlockNumber()
          // The nonce topic narrows this query to one exact CCTP message. The
          // MessageReceived event can only be emitted after this poll started,
          // so the scan window is a bounded lookback captured on the first
          // attempt instead of a full-chain rescan on every poll cycle.
          if (scanFromBlock === null) {
            scanFromBlock =
              latestBlock > CCTP_DEST_SCAN_LOOKBACK_BLOCKS
                ? latestBlock - CCTP_DEST_SCAN_LOOKBACK_BLOCKS
                : 0n
          }
          const transmitter = getCctpMessageTransmitter(destChain)
          // viem's getLogs accepts a SINGLE AbiEvent here. Passing the ABI array
          // made every real scan throw AbiEventNotFoundError, which the catch
          // below swallowed as a warning — so a mint that had already landed on
          // the destination never confirmed and the receipt stayed "Pending".
          const receivedLogs = await destPublicClient.getLogs({
            address: transmitter,
            event: CCTP_MESSAGE_RECEIVED_ABI[0],
            args: {
              nonce: `0x${messageNonce.toString(16).padStart(64, '0')}` as Hex,
            },
            fromBlock: scanFromBlock,
            toBlock: latestBlock,
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
                  BigInt((decoded.args as any).amount) + BigInt((decoded.args as any).feeCollected || 0n) === correlatedBurnAmount &&
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
                    BigInt(args.amount) + BigInt(args.feeCollected || 0n) === correlatedBurnAmount &&
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
          scanFailures++
          console.warn(`[pollCctpDestinationTx] Log query notice on attempt ${attempt}:`, logErr)
        }
      }
    } catch (err) {
      console.warn(`[pollCctpDestinationTx] Attempt ${attempt} failed:`, err)
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }

  // Exhausting the budget without a confirmed mint is an expected outcome for
  // the single-attempt pre-check (maxAttempts: 1) but a real failure for a
  // background poll — log it so a stranded pending receipt can be diagnosed.
  if (maxAttempts > 1) {
    console.warn(
      `[pollCctpDestinationTx] Destination mint still unconfirmed after ${maxAttempts} attempts for burn ${burnTxHash} ` +
        `(Iris HTTP misses: ${irisMisses}/${maxAttempts}, destination scan failures: ${scanFailures}/${maxAttempts}); returning pending.`
    )
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
