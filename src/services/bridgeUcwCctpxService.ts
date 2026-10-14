// src/services/bridgeUcwCctpxService.ts
//
// Circle-UCW bridging for the CCTP-X tokens (wETH, cirBTC) — the second of the
// two mechanisms a UCW direct bridge needs. The first (USDC and EURC) rides
// standard CCTP v2 through `TokenMessengerV2.depositForBurn(WithHook)` and lives
// in `bridgeUcwService`; Circle splits the two on purpose:
//
//   "USDC and EURC bridging continues to use CCTP v2 (`cctp.v2.*`) actions,
//    not CCTPx."  — @circle-fin/adapter-viem-v2, crossChainTransfer action docs
//
// CCTP-X tokens move through the chain's CrossChainTokenService ("CCTS" proxy,
// `cctpx.serviceAddress`), which needs a per-token manager approval, an
// IRIS-signed fee quote passed verbatim, and the quoted fee as `msg.value`.
//
// This service does NOT hand-roll that calldata. It builds it with the very
// encoder App Kit uses (`adapter.prepareAction(...).getCallData()`, which signs
// nothing) and then hands the resulting call to the UCW wallet as a challenge.
// Re-deriving a 0x780c5acf `crossChainTransfer` call by hand would be a second
// implementation of a fund-moving contract call, and the two would drift.
//
// Everything the encoder needs is verified against the installed SDK: the
// prepared request exposes `{ getCallData, estimate, execute }`, `getCallData()`
// returns `{ to, data, value }` without a signer, and the adapter only asks its
// provider for `eth_chainId` / `eth_accounts` on the encode path.

import { AppKit } from '@circle-fin/app-kit'
import { createAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import { fetchCCTPXFeeQuote } from '@circle-fin/provider-cctpx'
import { erc20Abi, formatUnits, parseUnits, type Address, type Hex } from 'viem'
import { IS_TESTNET } from '../config/networks/networkRegistry'
import {
  CCTPX_ELIGIBLE_CHAINS,
  NON_USDC_TOKEN_DEPLOYMENTS,
  getUcwBridgeMechanism,
  isBridgeRouteSupported,
  normalizeMatrixToken,
  type NonUsdcBridgeToken,
} from '../config/bridgeRouteMatrix'
import { getExplorerTxUrl } from '../config/sendConfig'
import { CHAIN_NATIVE_MAP } from '../utils/tokenUtils'
import { getResilientPublicClient, resilientReadContract, resilientWaitForReceipt } from './rpc'
import { mapChainKeyToCircleBlockchain } from './gatewayUcwService'

/** Same challenge shape `bridgeUcwService` declares; kept structurally identical. */
export type ExecuteUcwContractFn = (params: {
  contractAddress: string
  abiFunctionSignature?: string
  abiParameters?: any[]
  callData?: string
  amount?: string
  blockchain?: string
}) => Promise<{
  success: boolean
  txHash?: string
  /** The challenge executed, but Circle has not published the broadcast hash yet. */
  hashPending?: boolean
  challengeId?: string
  error?: string
}>

export interface UcwCctpxParams {
  tokenSymbol: string
  amount: string
  sourceChain: string
  destChain: string
  recipientAddress: string
  connectedAddress: string
  executeUcwContract: ExecuteUcwContractFn
  onStepProgress?: (step: 'approving' | 'burning' | 'completed') => void
  /** Circle quotes a PRE_FINALITY fee item for FAST only; defaults to FAST. */
  speed?: 'FAST' | 'SLOW'
  /** Test seam — production uses the platform fetch. */
  fetchImpl?: typeof globalThis.fetch
}

export interface UcwCctpxResult {
  burnTxHash: string
  sourceExplorerUrl: string
  destDomain: number
  amount: string
  mintRecipient: string
  challengeId?: string
  /**
   * Always true: CCTP-X quotes include the FORWARD leg, so Circle's relayer
   * submits the destination mint and the sender needs no funded wallet there.
   */
  forwarded?: boolean
}

/** One registry row: the token's ERC-20 and manager address on a CCTP domain. */
export interface CctpxTokenDeployment {
  domainId: number
  tokenAddress: string
  tokenManagerAddress: string
}

export interface UcwCctpxQuote {
  signedQuote: string
  /** Zero address means the native currency (paid as `msg.value`). */
  feeToken: string
  /** Sum of the quote's fee items, in the fee token's smallest unit. */
  feeTotalAmount: string
  expiresAt: number
}

export interface UcwCctpxQuoteArgs {
  tokenId: string
  sourceDomain: number
  destinationDomain: number
  amountUnits: bigint
  destinationAddress: string
  speed: 'FAST' | 'SLOW'
}

export interface UcwCctpxEncodedCalls {
  approve: { to: string; data: string }
  transfer: { to: string; data: string; value: string }
}

export interface UcwCctpxEncodeArgs {
  chainKey: string
  address: string
  tokenId: string
  amountUnits: bigint
  destinationDomain: number
  destinationAddress: string
  minFinalityThreshold: number
  serviceAddress: string
  signedQuote: string
  nativeFeeAmount: bigint
  tokenAddress: string
  tokenManagerAddress: string
  getPublicClient: (chainKey: string) => any
}

export interface UcwCctpxPlan {
  tokenSymbol: NonUsdcBridgeToken
  tokenId: `0x${string}`
  decimals: number
  sourceDomain: number
  destDomain: number
  serviceAddress: string
  tokenAddress: string
  tokenManagerAddress: string
  amountUnits: bigint
  mintRecipient: string
  minFinalityThreshold: number
  approve: { to: string; data: string }
  transfer: { to: string; data: string; value: string }
  quote: { signedQuote: string; feeTotalAmount: string; expiresAt: number; speed: 'FAST' | 'SLOW' }
}

export interface UcwCctpxDeps {
  /** Test seam — both the registry and the quote call go through it. */
  fetchImpl?: typeof globalThis.fetch
  fetchTokenDeployments?: (tokenId: string, fetchImpl?: typeof globalThis.fetch) => Promise<CctpxTokenDeployment[]>
  fetchQuote?: (args: UcwCctpxQuoteArgs, fetchImpl?: typeof globalThis.fetch) => Promise<UcwCctpxQuote>
  encodeCalls?: (args: UcwCctpxEncodeArgs) => Promise<UcwCctpxEncodedCalls>
  getPublicClient?: (chainKey: string) => any
  nowSeconds?: () => number
  /** Approval-confirmation polling interval (0 in tests). */
  approvalPollIntervalMs?: number
}

export const CCTPX_IRIS_BASE = IS_TESTNET
  ? 'https://iris-api-sandbox.circle.com'
  : 'https://iris-api.circle.com'

/** Circle's minimum finality threshold per speed tier (SDK `MIN_FINALITY_THRESHOLD`). */
const MIN_FINALITY_THRESHOLD = { FAST: 1000, SLOW: 2000 } as const

/** `address(0)` = the quote is denominated in the chain's native currency. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
const BYTES32 = /^0x[0-9a-fA-F]{64}$/
const TX_HASH = /^0x[0-9a-fA-F]{64}$/
const DECIMAL_AMOUNT = /^\d+(?:\.\d+)?$/

let cachedChainDefinitions: any[] | null = null

/**
 * App Kit's bridge chain definitions. Reading them is local — no network — which
 * is what lets `serviceAddress` be resolved offline (the offline route-matrix
 * suite reads the same table).
 */
function getSdkChainDefinitions(): any[] {
  if (!cachedChainDefinitions) {
    cachedChainDefinitions = new AppKit().getSupportedChains('bridge') as any[]
  }
  return cachedChainDefinitions
}

function getSdkChainDefinition(chainKey: string): any {
  const definition = getSdkChainDefinitions().find((entry) => entry?.chain === chainKey)
  if (!definition) {
    throw new Error(`Unknown bridge chain "${chainKey}".`)
  }
  return definition
}

/**
 * The chain's CrossChainTokenService proxy — the only contract a CCTP-X token
 * can be transferred through. A chain without one can never carry these tokens.
 */
export function getCctpxServiceAddress(chainKey: string): string {
  const serviceAddress = getSdkChainDefinition(chainKey)?.cctpx?.serviceAddress
  if (typeof serviceAddress !== 'string' || !EVM_ADDRESS.test(serviceAddress)) {
    throw new Error(
      `${chainKey} has no CrossChainTokenService deployment, so it cannot carry a CCTP-X token.`
    )
  }
  return serviceAddress
}

/** Circle's registry for a CCTP-X token id: the per-domain token + manager addresses. */
async function fetchDeploymentsFromIris(
  tokenId: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): Promise<CctpxTokenDeployment[]> {
  const url = `${CCTPX_IRIS_BASE}/v2/cctpx/tokens?tokenid=${tokenId}`
  let response: any
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) } as any)
  } catch (err) {
    throw new Error(
      "Circle's CCTP-X token registry could not be reached, so the token's on-chain address could not be verified. Nothing was sent — retry shortly."
    )
  }
  if (!response?.ok) {
    throw new Error(
      `Circle's CCTP-X token registry answered HTTP ${response?.status}. The token address could not be verified, so nothing was sent — retry shortly.`
    )
  }

  const payload: any = await response.json()
  const token = Array.isArray(payload?.data) ? payload.data[0] : undefined
  const deployments = Array.isArray(token?.deployments) ? token.deployments : []
  return deployments.map((entry: any) => ({
    domainId: Number(entry?.domainId),
    tokenAddress: String(entry?.tokenAddress ?? ''),
    tokenManagerAddress: String(entry?.tokenManagerAddress ?? ''),
  }))
}

async function fetchQuoteFromIris(
  args: UcwCctpxQuoteArgs,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): Promise<UcwCctpxQuote> {
  const quote = await fetchCCTPXFeeQuote({
    baseUrl: CCTPX_IRIS_BASE,
    tokenId: args.tokenId as `0x${string}`,
    sourceDomain: args.sourceDomain,
    destinationDomain: args.destinationDomain,
    amount: args.amountUnits.toString(),
    destinationAddress: args.destinationAddress,
    speed: args.speed as any,
    fetchImpl,
  } as any)

  return {
    signedQuote: String(quote?.signedQuote ?? ''),
    feeToken: String(quote?.feeToken ?? ''),
    feeTotalAmount: String(quote?.feeTotalAmount ?? ''),
    expiresAt: Number(quote?.expiresAt),
  }
}

/**
 * Encodes the two source-chain calls with App Kit's own encoder. Nothing is
 * signed and no transaction is sent: `getCallData()` returns the raw calldata a
 * wallet is expected to submit, which is exactly what the UCW challenge needs.
 */
async function encodeCallsWithAppKit(args: UcwCctpxEncodeArgs): Promise<UcwCctpxEncodedCalls> {
  const chainDefinition = getSdkChainDefinition(args.chainKey)
  const publicClient = args.getPublicClient(args.chainKey)

  const provider = {
    request: async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return `0x${Number(chainDefinition.chainId).toString(16)}`
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [args.address]
      // In a browser the adapter's `switchToChain` asks the wallet to switch
      // networks. The UCW wallet is not an EIP-1193 provider to switch, and
      // encoding needs no approval at all, so these are answered as no-ops
      // rather than failing the encode: the source chain is already set by the
      // challenge's `blockchain` argument.
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
      throw new Error(
        `The CCTP-X encoder asked the wallet for ${method}; encoding must never require a signature (the UCW wallet signs the challenge instead).`
      )
    },
  }

  const adapter: any = await createAdapterFromProvider({
    provider: provider as any,
    getPublicClient: () => publicClient,
  })

  const context = { chain: chainDefinition, address: args.address }

  const approvePrepared = await adapter.prepareAction(
    'token.approve',
    {
      tokenAddress: args.tokenAddress,
      delegate: args.tokenManagerAddress,
      amount: args.amountUnits,
    },
    context
  )

  const transferPrepared = await adapter.prepareAction(
    'cctpx.crossChainTransfer',
    {
      tokenId: args.tokenId,
      amount: args.amountUnits,
      destinationDomain: args.destinationDomain,
      destinationAddress: args.destinationAddress,
      minFinalityThreshold: args.minFinalityThreshold,
      // The signed quote is passed verbatim; the contract verifies it.
      claim: { signedQuote: args.signedQuote },
      // The quote already bought the FORWARD leg, so no hook data is needed.
      autoExecuteHookData: false,
      hookData: '0x',
      serviceAddress: args.serviceAddress,
      nativeFeeAmount: args.nativeFeeAmount,
      fromChain: chainDefinition,
    },
    context
  )

  const approveCall = await approvePrepared.getCallData()
  const transferCall = await transferPrepared.getCallData()

  if (!EVM_ADDRESS.test(String(approveCall?.to)) || !String(approveCall?.data ?? '').startsWith('0x')) {
    throw new Error('The CCTP-X encoder returned no usable approve call; nothing was sent.')
  }
  if (!EVM_ADDRESS.test(String(transferCall?.to)) || !String(transferCall?.data ?? '').startsWith('0x')) {
    throw new Error('The CCTP-X encoder returned no usable transfer call; nothing was sent.')
  }

  return {
    approve: { to: String(approveCall.to), data: String(approveCall.data) },
    transfer: {
      to: String(transferCall.to),
      data: String(transferCall.data),
      value: BigInt(transferCall?.value ?? 0n).toString(),
    },
  }
}

export interface UcwCctpxFeeQuote {
  /** Circle's quoted relayer fee, formatted in the source chain's native token. */
  feeAmount: string
  /** Source-chain native symbol the fee is paid in: `USDC` on Arc, `ETH` on the Sepolias. */
  nativeSymbol: string
  /** Quote speed the fee was priced for. */
  speed: 'FAST' | 'SLOW'
}

/**
 * Prices a CCTP-X transfer without signing anything, so a UI can show what
 * Circle charges before the user commits.
 *
 * The quoted fee is NOT deducted from the bridged amount: Circle documents that
 * non-USDC fees are "paid in native gas on the source blockchain" precisely so
 * "the recipient receives the full transferred amount". It is therefore an
 * additional source-chain cost (like gas), not a haircut on the transfer.
 */
export async function quoteUcwCctpxRelayerFee(
  params: {
    tokenSymbol: string
    amount: string
    sourceChain: string
    destChain: string
    recipientAddress: string
    speed?: 'FAST' | 'SLOW'
    fetchImpl?: typeof globalThis.fetch
  },
  deps: UcwCctpxDeps = {}
): Promise<UcwCctpxFeeQuote> {
  const token = normalizeMatrixToken(params.tokenSymbol)
  if (getUcwBridgeMechanism(token) !== 'cctpx') {
    throw new Error(`${params.tokenSymbol} does not move over CCTP-X.`)
  }

  const sourceDomain = CCTPX_ELIGIBLE_CHAINS[params.sourceChain]
  const destDomain = CCTPX_ELIGIBLE_CHAINS[params.destChain]
  if (sourceDomain === undefined || destDomain === undefined) {
    throw new Error(
      'Both chains must carry a CrossChainTokenService deployment to move a CCTP-X token.'
    )
  }
  if (!DECIMAL_AMOUNT.test(params.amount)) {
    throw new Error(`Please enter a valid ${token} amount.`)
  }

  const { tokenId, decimals } = NON_USDC_TOKEN_DEPLOYMENTS[token as NonUsdcBridgeToken]
  const amountUnits = parseUnits(params.amount, decimals)
  if (amountUnits <= 0n) {
    throw new Error(`Please enter a valid ${token} amount.`)
  }

  const speed: 'FAST' | 'SLOW' = params.speed ?? 'FAST'
  const quote = await (deps.fetchQuote ?? fetchQuoteFromIris)(
    {
      tokenId,
      sourceDomain,
      destinationDomain: destDomain,
      amountUnits,
      destinationAddress: params.recipientAddress,
      speed,
    },
    deps.fetchImpl ?? params.fetchImpl
  )

  if (!DECIMAL_AMOUNT.test(quote.feeTotalAmount)) {
    throw new Error('Circle returned an unusable CCTP-X fee quote.')
  }
  if (quote.feeToken.toLowerCase() !== ZERO_ADDRESS) {
    // An ERC-20-denominated fee needs its own allowance and its own unit; the
    // execution path refuses it, so do not quote a number the UI would mislabel.
    throw new Error('Circle quoted this CCTP-X transfer in an ERC-20 fee token.')
  }

  const native = CHAIN_NATIVE_MAP[params.sourceChain]
  const nativeDecimals = native?.decimals ?? 18
  return {
    feeAmount: formatUnits(BigInt(quote.feeTotalAmount), nativeDecimals),
    nativeSymbol: native?.symbol ?? 'ETH',
    speed,
  }
}

/**
 * Validates the request and returns the exact calls to run, without signing or
 * sending anything. Kept separate from execution so the encoding path can be
 * tested with no network and no wallet.
 */
export async function planUcwCctpxTransfer(
  params: UcwCctpxParams,
  deps: UcwCctpxDeps = {}
): Promise<UcwCctpxPlan> {
  const fetchImpl = deps.fetchImpl ?? params.fetchImpl
  const getClient = deps.getPublicClient ?? ((chainKey: string) => getResilientPublicClient(chainKey))
  const nowSeconds = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
  const speed: 'FAST' | 'SLOW' = params.speed ?? 'FAST'

  const token = normalizeMatrixToken(params.tokenSymbol)
  const mechanism = getUcwBridgeMechanism(token)
  if (mechanism === null) {
    throw new Error(`${params.tokenSymbol} is not a Circle-supported bridge token.`)
  }
  if (mechanism === 'cctp-v2') {
    throw new Error(
      `${token} moves over CCTP v2, not CCTP-X — use the CCTP v2 UCW path for it.`
    )
  }
  const tokenSymbol = token as NonUsdcBridgeToken

  if (!params.connectedAddress || !EVM_ADDRESS.test(params.connectedAddress)) {
    throw new Error('A connected wallet address is required to bridge.')
  }
  if (!params.recipientAddress || !EVM_ADDRESS.test(params.recipientAddress.trim())) {
    throw new Error('A valid 20-byte EVM recipient address is required for a CCTP-X bridge.')
  }
  if (params.sourceChain === params.destChain) {
    throw new Error('Source and destination networks cannot be the same.')
  }
  if (!isBridgeRouteSupported(tokenSymbol, params.sourceChain, params.destChain)) {
    throw new Error(
      `${tokenSymbol} cannot be bridged from ${params.sourceChain} to ${params.destChain}.`
    )
  }

  const sourceDomain = CCTPX_ELIGIBLE_CHAINS[params.sourceChain]
  const destDomain = CCTPX_ELIGIBLE_CHAINS[params.destChain]
  if (sourceDomain === undefined || destDomain === undefined) {
    throw new Error(
      'Both chains must carry a CrossChainTokenService deployment to move a CCTP-X token.'
    )
  }

  const { tokenId, decimals } = NON_USDC_TOKEN_DEPLOYMENTS[tokenSymbol]
  if (!DECIMAL_AMOUNT.test(params.amount)) {
    throw new Error(`Please enter a valid ${tokenSymbol} amount.`)
  }
  const fractionDigits = (params.amount.split('.')[1] ?? '').length
  if (fractionDigits > decimals) {
    throw new Error(`${tokenSymbol} supports at most ${decimals} decimal places.`)
  }
  const amountUnits = parseUnits(params.amount, decimals)
  if (amountUnits <= 0n) {
    throw new Error(`Please enter a valid ${tokenSymbol} amount.`)
  }

  // Addresses come from Circle's registry every time. A cached or hardcoded
  // address that drifts would send funds to the wrong contract.
  const deployments = await (deps.fetchTokenDeployments ?? fetchDeploymentsFromIris)(tokenId, fetchImpl)
  const sourceDeployment = deployments.find((entry) => Number(entry.domainId) === sourceDomain)
  const destDeployment = deployments.find((entry) => Number(entry.domainId) === destDomain)
  if (!sourceDeployment || !destDeployment) {
    throw new Error(
      `Circle's registry lists no ${tokenSymbol} deployment on both domains, so this route cannot be completed. Nothing was sent.`
    )
  }
  // The destination row is only evidence that the token is deployed on both
  // ends; the source row's token and manager are what the encoded calls target,
  // so those two are what must be a usable address.
  if (
    !EVM_ADDRESS.test(sourceDeployment.tokenAddress) ||
    !EVM_ADDRESS.test(sourceDeployment.tokenManagerAddress)
  ) {
    throw new Error(
      `Circle's registry returned no usable ${tokenSymbol} address for ${params.sourceChain}. Nothing was sent.`
    )
  }

  const serviceAddress = getCctpxServiceAddress(params.sourceChain)

  const quote = await (deps.fetchQuote ?? fetchQuoteFromIris)(
    {
      tokenId,
      sourceDomain,
      destinationDomain: destDomain,
      amountUnits,
      destinationAddress: params.recipientAddress.trim(),
      speed,
    },
    fetchImpl
  )

  if (!quote.signedQuote || !quote.signedQuote.startsWith('0x')) {
    throw new Error('Circle returned no signed CCTP-X fee quote, so nothing was sent — retry shortly.')
  }
  if (!DECIMAL_AMOUNT.test(quote.feeTotalAmount)) {
    throw new Error('Circle returned an unusable CCTP-X fee quote, so nothing was sent — retry shortly.')
  }
  if (Number.isFinite(quote.expiresAt) && quote.expiresAt <= nowSeconds()) {
    throw new Error(
      'Circle’s CCTP-X fee quote expired before it could be signed, so nothing was sent — retry to get a fresh quote.'
    )
  }
  if (quote.feeToken.toLowerCase() !== ZERO_ADDRESS) {
    throw new Error(
      'This CCTP-X quote is denominated in an ERC-20 fee token, which would need its own allowance before the transfer. That path is not implemented, so nothing was sent.'
    )
  }

  const nativeFeeAmount = BigInt(quote.feeTotalAmount)
  const minFinalityThreshold = MIN_FINALITY_THRESHOLD[speed]

  const encoded = await (deps.encodeCalls ?? encodeCallsWithAppKit)({
    chainKey: params.sourceChain,
    address: params.connectedAddress,
    tokenId,
    amountUnits,
    destinationDomain: destDomain,
    destinationAddress: params.recipientAddress.trim(),
    minFinalityThreshold,
    serviceAddress,
    signedQuote: quote.signedQuote,
    nativeFeeAmount,
    tokenAddress: sourceDeployment.tokenAddress,
    tokenManagerAddress: sourceDeployment.tokenManagerAddress,
    getPublicClient: getClient,
  })

  return {
    tokenSymbol,
    tokenId,
    decimals,
    sourceDomain,
    destDomain,
    serviceAddress,
    tokenAddress: sourceDeployment.tokenAddress,
    tokenManagerAddress: sourceDeployment.tokenManagerAddress,
    amountUnits,
    mintRecipient: params.recipientAddress.trim(),
    minFinalityThreshold,
    approve: encoded.approve,
    transfer: encoded.transfer,
    quote: {
      signedQuote: quote.signedQuote,
      feeTotalAmount: nativeFeeAmount.toString(),
      expiresAt: quote.expiresAt,
      speed,
    },
  }
}

/** On-chain allowance of `owner` for the token manager, or 0 when it cannot be read. */
async function readManagerAllowance(
  client: any,
  tokenAddress: string,
  owner: string,
  manager: string
): Promise<bigint> {
  try {
    const allowance = (await resilientReadContract(client, {
      address: tokenAddress as Address,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [owner as Address, manager as Address],
    })) as bigint
    return typeof allowance === 'bigint' ? allowance : 0n
  } catch (err) {
    console.warn('[bridgeUcwCctpxService] Could not read the token-manager allowance:', err)
    return 0n
  }
}

/**
 * Runs a plan through the UCW wallet: approve the token manager first (when the
 * allowance does not already cover the amount), then the transfer.
 *
 * The transfer's quoted fee is sent as the challenge's native `amount`, because
 * `crossChainTransfer` pulls it as `msg.value`; on Arc that native currency is
 * USDC (18 decimals), on the Sepolias it is ETH — so the decimals come from the
 * chain's native-token entry rather than a hardcoded 18.
 */
export async function executeUcwCctpxBridge(
  params: UcwCctpxParams,
  deps: UcwCctpxDeps = {}
): Promise<UcwCctpxResult> {
  const plan = await planUcwCctpxTransfer(params, deps)

  const getClient = deps.getPublicClient ?? ((chainKey: string) => getResilientPublicClient(chainKey))
  const blockchain = mapChainKeyToCircleBlockchain(params.sourceChain)
  const nativeDecimals = CHAIN_NATIVE_MAP[params.sourceChain]?.decimals ?? 18
  const pollIntervalMs = deps.approvalPollIntervalMs ?? 1500
  const client = getClient(params.sourceChain)

  const allowance = await readManagerAllowance(
    client,
    plan.tokenAddress,
    params.connectedAddress,
    plan.tokenManagerAddress
  )

  if (allowance < plan.amountUnits) {
    params.onStepProgress?.('approving')

    const approveRes = await params.executeUcwContract({
      contractAddress: plan.approve.to,
      callData: plan.approve.data,
      blockchain,
    })

    if (!approveRes.success) {
      throw new Error(approveRes.error || `${plan.tokenSymbol} spending approval was rejected or canceled.`)
    }

    // A challenge success is not an on-chain allowance. Confirm the real receipt,
    // and when Circle has not published the hash yet, confirm by re-reading the
    // allowance — never by assuming the approval landed.
    if (approveRes.txHash && TX_HASH.test(approveRes.txHash)) {
      const approveReceipt = await resilientWaitForReceipt(
        client,
        approveRes.txHash as Hex,
        `${plan.tokenSymbol} spending approval`
      )
      if (
        approveReceipt.status !== 'success' ||
        !approveReceipt.receipt ||
        approveReceipt.receipt.transactionHash?.toLowerCase() !== approveRes.txHash.toLowerCase()
      ) {
        throw new Error(
          `${plan.tokenSymbol} approval has not been confirmed with a matching on-chain receipt; the CCTP-X transfer was not submitted.`
        )
      }
    } else {
      let confirmed = false
      for (let attempt = 0; attempt < 6; attempt++) {
        if (pollIntervalMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
        }
        confirmed =
          (await readManagerAllowance(
            client,
            plan.tokenAddress,
            params.connectedAddress,
            plan.tokenManagerAddress
          )) >= plan.amountUnits
        if (confirmed) break
      }
      if (!confirmed) {
        throw new Error(
          `${plan.tokenSymbol} approval has not been confirmed on-chain; the CCTP-X transfer was not submitted.`
        )
      }
    }
  }

  params.onStepProgress?.('burning')

  const transferValue = BigInt(plan.transfer.value || '0')
  const transferRes = await params.executeUcwContract({
    contractAddress: plan.transfer.to,
    callData: plan.transfer.data,
    ...(transferValue > 0n ? { amount: formatUnits(transferValue, nativeDecimals) } : {}),
    blockchain,
  })

  if (!transferRes.success) {
    throw new Error(transferRes.error || 'CCTP-X crossChainTransfer was canceled or rejected.')
  }

  const burnTxHash = transferRes.txHash
  if (!burnTxHash || !TX_HASH.test(burnTxHash)) {
    // The challenge succeeded but Circle has not published the hash yet. Report
    // that state instead of inventing a transaction that cannot be verified.
    return {
      burnTxHash: '',
      sourceExplorerUrl: '',
      destDomain: plan.destDomain,
      amount: params.amount,
      mintRecipient: plan.mintRecipient,
      challengeId: transferRes.challengeId,
      forwarded: true,
    }
  }

  const burnReceipt = await resilientWaitForReceipt(
    client,
    burnTxHash as Hex,
    `CCTP-X source transfer of ${plan.tokenSymbol}`
  )
  if (
    burnReceipt.status !== 'success' ||
    !burnReceipt.receipt ||
    burnReceipt.receipt.transactionHash?.toLowerCase() !== burnTxHash.toLowerCase()
  ) {
    throw new Error(
      burnReceipt.status === 'reverted'
        ? 'CCTP-X source transfer reverted.'
        : 'CCTP-X source transfer is not confirmed yet; destination settlement remains pending.'
    )
  }

  params.onStepProgress?.('completed')

  return {
    burnTxHash,
    sourceExplorerUrl: getExplorerTxUrl(params.sourceChain, burnTxHash),
    destDomain: plan.destDomain,
    amount: params.amount,
    mintRecipient: plan.mintRecipient,
    challengeId: transferRes.challengeId,
    forwarded: true,
  }
}
