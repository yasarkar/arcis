// Circle Gateway service layer — deposit, balance query, and transfer.
// Gateway provides a unified USDC balance across multiple blockchains with
// instant (<500ms) crosschain transfers.
import {
  createWalletClient,
  custom,
  decodeEventLog,
  erc20Abi,
  getContract,
  maxUint256,
  parseUnits,
  formatUnits,
  zeroAddress,
  type Chain,
  type TransactionReceipt,
} from 'viem'
import { getResilientPublicClient, resilientReadContract, resilientWaitForReceipt } from './rpc'
import { checkCeilingStatus, setSpendingCeiling } from './spendingCeilingService'
import {
  ACTIVE_GATEWAY_API,
  ACTIVE_GATEWAY_CONTRACTS,
  GATEWAY_API,
  GATEWAY_CONTRACTS,
  GATEWAY_DOMAINS,
  GATEWAY_EIP712_DOMAIN,
  GATEWAY_EIP712_TYPES,
  GATEWAY_GAS_LIMITS,
  GATEWAY_MINTER_ABI,
  GATEWAY_WALLET_ABI,
  USDC_ADDRESSES,
  EURC_ADDRESSES,
} from '../config/gatewayConfig'
import { IS_TESTNET } from '../config/arcChain'
import { getNetwork } from '../config/networks/networkRegistry'

// ── Types ────────────────────────────────────────────────────────────────────

export interface GatewayBalanceItem {
  domain: number
  depositor: string
  balance: string
}

export interface GatewayBalanceResponse {
  token: string
  balances: GatewayBalanceItem[]
}

export interface GatewayDepositResult {
  approveTxHash: string
  depositTxHash: string
  amount: string
  chain: string
  /** REAL fee paid by the deposit tx, resolved from its receipt. */
  depositFee?: PaidNetworkFee
  /** REAL fee paid by the ERC-20 approval tx, when one was submitted. */
  approvalFee?: PaidNetworkFee
}

export interface GatewayTransferResult {
  burnIntent: any
  signature: string
  attestation: string
  mintSignature: string
  mintTxHash: string
  amount: string
  effectiveAmount?: string
  sourceChain: string
  destinationChain: string
  recipient: string
}

export interface GatewayTransferParams {
  provider: any // EIP-1193 provider
  sourceChain: string
  destinationChain: string
  amount: string
  recipient?: string
  sourceChainDef: Chain
  destinationChainDef: Chain
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toBytes32(address: `0x${string}`): `0x${string}` {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}` as const
}

function randomHex32(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}` as const
}

const ERC20_TRANSFER_EVENT_ABI = [{
  type: 'event', name: 'Transfer',
  inputs: [
    { type: 'address', indexed: true, name: 'from' },
    { type: 'address', indexed: true, name: 'to' },
    { type: 'uint256', indexed: false, name: 'value' },
  ],
}] as const

/**
 * Slip margin for delivery verification, sized at Circle's 0.005% transfer fee,
 * rounded up and expressed in 6-decimal USDC subunits.
 *
 * Circle charges its Gateway cost from the unified Gateway balance at burn time
 * and mints the full principal, so a Gateway mint is expected to deliver the
 * exact amount. This ceiling stays as a small tolerance so a delivery one unit
 * short can never be mistaken for a failed transfer.
 */
export function gatewayTransferFeeCeiling(amount: string): bigint {
  let units: bigint
  try {
    units = parseUnits(amount, 6)
  } catch {
    return 0n
  }
  if (units <= 0n) return 0n
  return (units * 5n + 99_999n) / 100_000n
}

/**
 * Exact USDC a Gateway mint delivered to `recipient`, in 6-decimal subunits.
 *
 * This proves what the recipient RECEIVED, which is the full bridged principal:
 * Circle debits its Gateway cost from the unified Gateway balance at burn time
 * instead of deducting it here (a live mint receipt holds exactly one USDC mint
 * and no fee movement). Returns `null` when the mint cannot be proven (malformed
 * input, failed transaction, different recipient, RPC failure) so callers omit
 * the amount instead of guessing.
 */
export async function resolveDestinationUsdcMintAmount(
  chainKey: string,
  txHash: string,
  recipient: string
): Promise<bigint | null> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash) || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) return null
  const network = getNetwork(chainKey)
  const tokenAddress = USDC_ADDRESSES[chainKey]
  if (!network?.viemChain || !tokenAddress) return null

  try {
    const publicClient = getResilientPublicClient(network.viemChain)
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` })
    if (receipt.status !== 'success' || receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()) return null
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) continue
      try {
        const decoded = decodeEventLog({ abi: ERC20_TRANSFER_EVENT_ABI, data: log.data, topics: log.topics })
        const from = String((decoded.args as any).from).toLowerCase()
        const to = String((decoded.args as any).to).toLowerCase()
        if (from === '0x0000000000000000000000000000000000000000' && to === recipient.toLowerCase()) {
          return BigInt((decoded.args as any).value)
        }
      } catch {
        continue
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * USDC (6 decimals) a proven mint delivered to the recipient. This is the whole
 * principal the transfer was signed for: Circle never deducts its fee from the
 * minted amount, so this equals the bridged amount whenever the mint proves the
 * full delivery.
 */
export function gatewayDeliveredUsdc(mintedSubunits: bigint): string | null {
  if (mintedSubunits < 0n) return null
  return formatUnits(mintedSubunits, 6)
}

/**
 * Verify a destination-chain receipt contains the exact native USDC mint/transfer.
 *
 * `feeTolerance` widens the acceptance floor to `amount − feeTolerance` as a
 * slip margin, so a delivery one unit short is not misreported as a failed
 * transfer. Callers pass `gatewayTransferFeeCeiling(amount)`; the default of 0
 * keeps the strict exact-amount check.
 */
export async function verifyDestinationUsdcMint(
  chainKey: string,
  txHash: string,
  recipient: string,
  amount: string,
  feeTolerance: bigint = 0n
): Promise<boolean> {
  if (!/^\d+(?:\.\d{1,6})?$/.test(amount)) return false
  const minted = await resolveDestinationUsdcMintAmount(chainKey, txHash, recipient)
  if (minted === null) return false
  const expectedAmount = parseUnits(amount, 6)
  const minReceived = expectedAmount > feeTolerance ? expectedAmount - feeTolerance : 0n
  return minted >= minReceived
}

import { assertNetwork } from './chainSwitchService'

export async function ensureChain(provider: any, chain: Chain): Promise<void> {
  await assertNetwork(chain, provider)
}

// ── Balance Query ────────────────────────────────────────────────────────────

// ── HTTP resilience ─────────────────────────────────────────────────────────
/** Per-attempt timeout for Circle Gateway REST reads. */
export const GATEWAY_HTTP_TIMEOUT_MS = 8_000
/** Total attempts (initial + retries) for transient Circle Gateway failures. */
export const GATEWAY_HTTP_MAX_ATTEMPTS = 3
/** Linear backoff base between retries: attempt 1 → 600ms, attempt 2 → 1200ms. */
export const GATEWAY_HTTP_RETRY_BASE_DELAY_MS = 600

export interface GatewayFetchRetryOptions {
  attempts?: number
  timeoutMs?: number
  baseDelayMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * fetch() wrapper for Circle Gateway REST **read** endpoints. Every attempt is bounded by a
 * timeout so a hung socket can never stall the 10s balance poll, and transient failures
 * (network errors, timeouts, HTTP 429/5xx) are retried with a linear backoff. Non-retryable
 * 4xx responses fail immediately, and only ok Responses are returned to the caller.
 *
 * Do NOT use this for state-changing Gateway endpoints (deposit/transfer): retrying those
 * could double-submit a transaction.
 */
export async function fetchGatewayWithRetry(
  url: string,
  init: RequestInit,
  options: GatewayFetchRetryOptions = {}
): Promise<Response> {
  const attempts = options.attempts ?? GATEWAY_HTTP_MAX_ATTEMPTS
  const timeoutMs = options.timeoutMs ?? GATEWAY_HTTP_TIMEOUT_MS
  const baseDelayMs = options.baseDelayMs ?? GATEWAY_HTTP_RETRY_BASE_DELAY_MS

  let lastError: Error = new Error('Gateway request failed')

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let retryable = true
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      if (response.ok) return response

      const errorBody = await response.text().catch(() => '')
      lastError = new Error(`Gateway API error: ${response.status} - ${errorBody}`)
      retryable = response.status === 429 || response.status >= 500
    } catch (err) {
      // Network failures and per-attempt timeouts are always worth one more try.
      lastError = err instanceof Error ? err : new Error(String(err))
    }

    if (!retryable || attempt === attempts) break
    console.warn(`[GatewayAPI] ↻ attempt ${attempt}/${attempts} failed (${lastError.message}), retrying...`)
    await sleep(baseDelayMs * attempt)
  }

  console.error('[GatewayAPI] ✗ Request failed:', lastError.message)
  throw lastError
}

/**
 * Query the Gateway unified balance for a wallet address across all supported
 * testnet chains. Returns the total confirmed balance and per-chain breakdown.
 */
export async function getGatewayBalances(
  address: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<GatewayBalanceResponse> {
  const url = `${GATEWAY_API[network]}/balances`
  const isEvmAddress = address.startsWith('0x') && address.length === 42
  const isSolanaAddress = !address.startsWith('0x') && address.length >= 32 && address.length <= 44

  // Only include domains compatible with the address format:
  // - EVM addresses (0x...) → include all domains EXCEPT Solana (5)
  // - Solana addresses (base58) → include only Solana domain (5)
  const sources = Object.entries(GATEWAY_DOMAINS)
    .filter(([chainKey, domain]) => {
      if (isEvmAddress && domain === 5) return false // Skip Solana for EVM wallets
      if (isSolanaAddress && domain !== 5) return false // Only Solana for Solana wallets
      return true
    })
    .map(([chainKey, domain]) => ({
      domain,
      depositor: address,
    }))

  console.log(`[GatewayAPI] → POST ${url}`)
  console.log(`[GatewayAPI]   Address type: ${isEvmAddress ? 'EVM' : isSolanaAddress ? 'Solana' : 'unknown'}`)
  console.log(`[GatewayAPI]   Body:`, JSON.stringify({ token: 'USDC', sources }))

  const response = await fetchGatewayWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'USDC',
      sources,
    }),
  })

  console.log(`[GatewayAPI] ← Status: ${response.status} ${response.statusText}`)

  const data = (await response.json()) as GatewayBalanceResponse
  console.log(`[GatewayAPI] ✓ Success response:`, data)
  return data
}

/**
 * Get the total confirmed Gateway balance for a wallet address.
 */
export async function getGatewayTotalBalance(
  address: string,
  network: 'testnet' | 'mainnet' = 'testnet'
): Promise<string> {
  const data = await getGatewayBalances(address, network)
  const total = (data.balances || []).reduce(
    (sum, item) => sum + parseFloat(item.balance),
    0
  )
  console.log(`[GatewayAPI] Total balance for ${address}: ${total.toFixed(6)} USDC`)
  return total.toFixed(6)
}

// ── Deposit ──────────────────────────────────────────────────────────────────

/**
 * Deposit USDC into the Gateway unified balance from a browser wallet.
 *
 * Flow:
 * 1. Approve the Gateway Wallet contract to spend USDC
 * 2. Call `deposit(token, value)` on the Gateway Wallet contract
 */
export async function depositToGateway(
  provider: any,
  chainKey: string,
  amount: string,
  chainDef: Chain,
  tokenSymbol: 'USDC'
): Promise<GatewayDepositResult> {
  const account = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[]

  if (!account?.[0]) {
    throw new Error('No wallet account returned')
  }

  const address = account[0] as `0x${string}`
  await ensureChain(provider, chainDef)

  const walletClient = createWalletClient({
    account: address,
    chain: chainDef,
    transport: custom(provider),
  })

  // Use centralized resilient RPC client with multi-endpoint fallback
  const publicClient = getResilientPublicClient(chainDef)

  const tokenAddress = USDC_ADDRESSES[chainKey]
  if (!tokenAddress) {
    throw new Error(`No ${tokenSymbol} address configured for ${chainKey}`)
  }

  const gatewayWallet = ACTIVE_GATEWAY_CONTRACTS.gatewayWallet
  if (!/^\d+(?:\.\d{1,6})?$/.test(amount) || parseUnits(amount, 6) <= 0n) {
    throw new Error('Gateway deposit amount must be greater than zero and have at most 6 decimal places.')
  }
  const amountBaseUnits = parseUnits(amount, 6)

  // Pre-flight Step 0: Check token balance and enforce Arc Testnet native gas reserve
  try {
    const userBalance = await resilientReadContract(publicClient, {
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    })

    // On Arc (testnet & mainnet), USDC is the native gas token.
    // Ensure user holds enough USDC for the deposit AND native gas fees (reserve 0.05 USDC = 50,000 units).
    const isArcChain = chainKey === 'Arc_Testnet' || chainKey === 'Arc'
    const gasReserve = isArcChain && tokenSymbol === 'USDC' ? parseUnits('0.05', 6) : 0n
    const requiredBalance = amountBaseUnits + gasReserve

    if (userBalance < requiredBalance) {
      if (isArcChain && tokenSymbol === 'USDC') {
        throw new Error(
          `Insufficient USDC balance on Arc Testnet for deposit + gas. ` +
          `Your balance is ${(Number(userBalance) / 1e6).toFixed(6)} USDC, but depositing ${amount} USDC requires at least ${(Number(requiredBalance) / 1e6).toFixed(6)} USDC (reserving 0.05 USDC for gas).`
        )
      } else {
        throw new Error(
          `Insufficient ${tokenSymbol} balance. You have ${(Number(userBalance) / 1e6).toFixed(6)} ${tokenSymbol}, but requested ${amount}.`
        )
      }
    }
  } catch (balanceErr: any) {
    if (balanceErr.message?.includes('Insufficient')) throw balanceErr
    throw new Error(`Could not verify ${tokenSymbol} balance before Gateway deposit; refusing to approve or submit: ${balanceErr?.message || 'balance read failed'}`)
  }

  // Step 1 (Circle Official Spec): Check allowance and approve Gateway Wallet if needed
  let approveTxHash = ''
  let approvalFee: PaidNetworkFee | undefined
  let currentAllowance = 0n
  try {
    currentAllowance = await resilientReadContract(publicClient, {
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [address, gatewayWallet],
    })
    console.log(`[Gateway Deposit] Current allowance for ${gatewayWallet}: ${(Number(currentAllowance) / 1e6).toFixed(6)} ${tokenSymbol}`)
  } catch (allowanceErr) {
    console.warn(`[Gateway Deposit] Could not read allowance, will attempt approve:`, allowanceErr)
  }

  const ceilingStatus = checkCeilingStatus(address, tokenSymbol, amount)
  const requiresApprove = currentAllowance < amountBaseUnits

  if (requiresApprove) {
    console.log(
      `[Gateway Deposit] Step 1/2: Approving ceiling ${ceilingStatus.suggestedCeiling} ${tokenSymbol} on ${chainKey} (Current Ceiling: ${ceilingStatus.currentCeiling})...`
    )

    // Calculate safe gas limit for approve
    let gasLimit: bigint = GATEWAY_GAS_LIMITS.approve
    try {
      const estimatedGas = await publicClient.estimateContractGas({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [gatewayWallet, maxUint256],
        account: address,
      })
      gasLimit = (estimatedGas * 130n) / 100n // +30% buffer
    } catch (gasErr) {
      console.warn(`[Gateway Deposit] Approve gas estimate fallback to 100_000:`, gasErr)
      gasLimit = 100_000n
    }

    try {
      approveTxHash = await walletClient.writeContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [gatewayWallet, maxUint256],
        chain: chainDef,
        account: address,
        gas: gasLimit,
      })
      console.log(`[Gateway Deposit] Approve tx submitted: ${approveTxHash}`)
      const approveRes = await resilientWaitForReceipt(
        publicClient,
        approveTxHash as `0x${string}`,
        'Gateway Deposit Approve',
        120_000
      )
      if (approveRes.status !== 'success' || !approveRes.receipt || approveRes.receipt.transactionHash.toLowerCase() !== approveTxHash.toLowerCase()) {
        throw new Error(approveRes.status === 'reverted' ? 'Token approval reverted on-chain.' : 'Token approval receipt is not confirmed; deposit was not submitted.')
      }
      approvalFee = paidNetworkFeeFromReceipt(approveRes.receipt, chainKey)
      setSpendingCeiling(address, tokenSymbol, ceilingStatus.suggestedCeiling, approveTxHash)
      console.log(`[Gateway Deposit] Approve confirmed in block ${approveRes.blockNumber}, ceiling recorded: ${ceilingStatus.suggestedCeiling} ${tokenSymbol}`)
    } catch (err: any) {
      console.error(`[Gateway Deposit] Approve failed:`, err)
      throw err
    }
  } else {
    if (ceilingStatus.suggestedCeiling > ceilingStatus.currentCeiling) {
      setSpendingCeiling(address, tokenSymbol, ceilingStatus.suggestedCeiling)
    }
    console.log(
      `[Gateway Deposit] Step 1/2 skipped: Allowance already sufficient on-chain (${(Number(currentAllowance) / 1e6).toFixed(2)} >= ${amount} ${tokenSymbol})`
    )
  }

  // Step 2 (Circle Official Spec): Call deposit on the Gateway Wallet contract
  let depositGasLimit: bigint = GATEWAY_GAS_LIMITS.deposit
  try {
    const estimatedGas = await publicClient.estimateContractGas({
      address: gatewayWallet,
      abi: GATEWAY_WALLET_ABI,
      functionName: 'deposit',
      args: [tokenAddress, amountBaseUnits],
      account: address,
    })
    depositGasLimit = (estimatedGas * 130n) / 100n
  } catch (gasErr) {
    console.warn(`[Gateway Deposit] Deposit gas estimate fallback to 150_000:`, gasErr)
    depositGasLimit = 150_000n
  }

  console.log(`[Gateway Deposit] Step 2/2: Depositing ${amount} ${tokenSymbol} into Gateway...`)
  const depositTxHash = await walletClient.writeContract({
    address: gatewayWallet,
    abi: GATEWAY_WALLET_ABI,
    functionName: 'deposit',
    args: [tokenAddress, amountBaseUnits],
    chain: chainDef,
    account: address,
    gas: depositGasLimit,
  })
  console.log(`[Gateway Deposit] Deposit tx submitted: ${depositTxHash}`)
  const depositRes = await resilientWaitForReceipt(
    publicClient,
    depositTxHash as `0x${string}`,
    'Gateway Deposit',
    120_000
  )
  if (depositRes.status !== 'success' || !depositRes.receipt || depositRes.receipt.transactionHash.toLowerCase() !== depositTxHash.toLowerCase()) {
    throw new Error(depositRes.status === 'reverted' ? 'Gateway deposit transaction reverted on-chain.' : 'Gateway deposit receipt is not confirmed; balance remains pending.')
  }
  const depositFee = paidNetworkFeeFromReceipt(depositRes.receipt, chainKey)
  console.log(`[Gateway Deposit] Deposit confirmed in block ${depositRes.blockNumber}`)
  console.log(`[Gateway Deposit] Deposit tx: ${depositTxHash}`)
  if (depositFee) {
    console.log(`[Gateway Deposit] Network fee paid: ${depositFee.amount} ${depositFee.symbol}`)
  }

  return {
    approveTxHash,
    depositTxHash,
    amount,
    chain: chainKey,
    depositFee,
    approvalFee,
  }
}

// ── Paid fee resolution ─────────────────────────────────────────────────────

/** Exact fee a confirmed transaction charged, in the chain's native currency. */
export interface PaidNetworkFee {
  /** Fee amount formatted from the receipt's gasUsed × effectiveGasPrice. */
  amount: string
  /** Native currency the fee was charged in (USDC on Arc, ETH on Base Sepolia, ...). */
  symbol: string
}

/** Upper bound for the post-deposit receipt read so the success card never hangs. */
const PAID_FEE_READ_TIMEOUT_MS = 6_000

/**
 * Formats the REAL paid fee from an already-fetched receipt (gasUsed × effectiveGasPrice).
 * Returns undefined when the receipt or its gas fields are missing, so callers never
 * present an estimate in place of a paid amount.
 */
export function paidNetworkFeeFromReceipt(
  receipt: TransactionReceipt | undefined,
  chainKey: string
): PaidNetworkFee | undefined {
  if (!receipt || receipt.status !== 'success') return undefined
  const gasUsed = receipt.gasUsed
  const effectiveGasPrice = (receipt as any).effectiveGasPrice ?? (receipt as any).gasPrice
  if (gasUsed == null || effectiveGasPrice == null) return undefined
  const feeWei = gasUsed * effectiveGasPrice
  if (feeWei < 0n) return undefined
  const network = getNetwork(chainKey)
  const decimals = network?.nativeCurrency?.decimals ?? 18
  const symbol = network?.nativeCurrency?.symbol || 'ETH'
  // formatUnits is exact and already drops trailing zeros; the paid value is never rounded.
  return { amount: formatUnits(feeWei, decimals), symbol }
}

/**
 * Reads the REAL network fee a mined transaction paid straight from its receipt
 * (gasUsed × effectiveGasPrice) — the same number the block explorer shows. Never
 * substitutes an estimate: when the receipt or its gas fields cannot be read, it
 * resolves to undefined so callers omit the fee row entirely.
 */
export async function resolvePaidNetworkFee(
  chainKey: string,
  txHash?: string | null
): Promise<PaidNetworkFee | undefined> {
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const network = getNetwork(chainKey)
    const client = getResilientPublicClient(network?.viemChain || chainKey)
    const receipt = await Promise.race([
      client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Network fee read timed out')), PAID_FEE_READ_TIMEOUT_MS)
      }),
    ])
    return paidNetworkFeeFromReceipt(receipt, chainKey)
  } catch {
    return undefined
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ── Transfer (Burn + Mint) ───────────────────────────────────────────────────

/**
 * Transfer USDC from the Gateway unified balance to a destination chain.
 *
 * Flow:
 * 1. Build a Gateway burn intent (EIP-712 typed data)
 * 2. Sign it with the source wallet
 * 3. Submit to the Gateway `/transfer` API
 * 4. Switch to the destination chain
 * 5. Call `gatewayMint` on the destination chain
 */
// ── Canonical Gateway burn-intent fee ─────────────────────────────────────────
// Circle's Gateway `/estimate` endpoint is the source of truth for `maxFee`.
// The UCW path already signs only quoted values; `transferFromGateway` uses the
// same quote so both flows escalate together when Circle's real fee exceeds the
// local approximation.

/**
 * The forwarding fee quote is dynamic: Circle's own `/estimate?enableForwarder=true`
 * value was a couple of subunits short in live testing ("Insufficient total maxFee
 * across intents to cover forwarding fee. Required additional: 0.000002").
 * Always apply a small safety buffer on top of the estimate.
 */
const FORWARDING_FEE_BUFFER_BPS = 500n // +5%
const FORWARDING_FEE_BUFFER_DENOMINATOR = 10_000n
const FORWARDING_FEE_MIN_BUFFER_UNITS = 2_000n // or +0.002 USDC, whichever is larger

/** Never-expiring burn-intent block-height ceiling (2^256 − 1). */
export const MAX_BLOCK_HEIGHT = 2n ** 256n - 1n

export interface GatewayTransferSpecPayload {
  version: number
  sourceDomain: number
  destinationDomain: number
  sourceContract: string
  destinationContract: string
  sourceToken: string
  destinationToken: string
  sourceDepositor: string
  destinationRecipient: string
  sourceSigner: string
  destinationCaller: string
  value: bigint
  salt: string
  hookData: string
}

/**
 * Asks Circle's Gateway `/estimate` endpoint for the canonical `maxFee` and
 * `maxBlockHeight` that must be encoded in the burn intent.
 *
 * With `useForwarder = true` the returned `maxFee` already covers the gas fee,
 * the 0.005% transfer fee and the forwarding fee, plus a small safety buffer
 * (the quote is dynamic and Circle's own value can be a few subunits short).
 *
 * Returns `null` when the endpoint is unreachable so the caller can decide how
 * to proceed without signing an intent based on an unverified local estimate.
 */
export async function estimateGatewayMaxFee(
  spec: GatewayTransferSpecPayload,
  useForwarder: boolean = false
): Promise<{ maxFee: bigint; maxBlockHeight: bigint } | null> {
  try {
    const response = await fetch(
      `${ACTIVE_GATEWAY_API}/estimate?enableForwarder=${useForwarder ? 'true' : 'false'}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ spec }], (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        ),
      }
    )

    if (!response.ok) {
      console.warn(
        `[estimateGatewayMaxFee] /estimate returned HTTP ${response.status}; no fee quote available.`
      )
      return null
    }

    const payload: any = await response.json()
    const item = Array.isArray(payload) ? payload[0] : payload?.body?.[0]
    const burnIntent = item?.burnIntent
    if (!burnIntent?.maxFee) {
      console.warn('[estimateGatewayMaxFee] /estimate response did not contain maxFee; no fee quote available.')
      return null
    }

    let maxFee = BigInt(burnIntent.maxFee)
    const maxBlockHeight = burnIntent.maxBlockHeight ? BigInt(burnIntent.maxBlockHeight) : MAX_BLOCK_HEIGHT
    if (maxFee <= 0n || maxBlockHeight <= 0n) return null
    if (useForwarder) {
      const percentBuffer = (maxFee * FORWARDING_FEE_BUFFER_BPS) / FORWARDING_FEE_BUFFER_DENOMINATOR
      const buffer =
        percentBuffer > FORWARDING_FEE_MIN_BUFFER_UNITS ? percentBuffer : FORWARDING_FEE_MIN_BUFFER_UNITS
      maxFee += buffer
    }

    return {
      maxFee,
      maxBlockHeight,
    }
  } catch (err) {
    console.warn('[estimateGatewayMaxFee] /estimate request failed; no fee quote available:', err)
    return null
  }
}

export async function transferFromGateway(
  params: GatewayTransferParams
): Promise<GatewayTransferResult> {
  const {
    provider,
    sourceChain,
    destinationChain,
    amount,
    recipient,
    sourceChainDef,
    destinationChainDef,
  } = params

  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[]

  if (!accounts?.[0]) {
    throw new Error('No wallet account returned')
  }

  const account = accounts[0] as `0x${string}`
  const destRecipient = (recipient || account) as `0x${string}`

  if (!/^\d+(?:\.\d{1,6})?$/.test(amount) || parseUnits(amount, 6) <= 0n) {
    throw new Error('Gateway transfer amount must be greater than zero and have at most 6 decimal places.')
  }
  const sourceDomain = GATEWAY_DOMAINS[sourceChain]
  const destinationDomain = GATEWAY_DOMAINS[destinationChain]
  if (sourceDomain === undefined || destinationDomain === undefined) {
    throw new Error(`Unsupported chain: ${sourceChain} or ${destinationChain}`)
  }

  const sourceUsdc = USDC_ADDRESSES[sourceChain]
  const destUsdc = USDC_ADDRESSES[destinationChain]
  if (!sourceUsdc || !destUsdc) {
    throw new Error(`No USDC address configured for ${sourceChain} or ${destinationChain}`)
  }

  const gatewayWallet = ACTIVE_GATEWAY_CONTRACTS.gatewayWallet
  const gatewayMinter = ACTIVE_GATEWAY_CONTRACTS.gatewayMinter

  // Step 1: Switch to source chain and sign the burn intent
  await ensureChain(provider, sourceChainDef)

  const sourceWalletClient = createWalletClient({
    account,
    chain: sourceChainDef,
    transport: custom(provider),
  })

  // Dynamic maxFee calculation (Circle Gateway requirement: user balance must cover amount + maxFee):
  // For same-chain withdrawal: 0 transfer fee + 0.05 USDC gas buffer (50_000 units)
  // For cross-chain: 0.005% transfer fee + 0.05 USDC gas buffer
  // Note: Circle Gateway API enforces a minimum maxFee threshold of 1.0 USDC (1_000_000 subunits)
  const isSameChain = sourceDomain === destinationDomain
  const transferFee = isSameChain ? 0n : (parseUnits(amount, 6) * 5n) / 100_000n
  const gasBuffer = 50_000n // 0.05 USDC buffer for burn execution
  const calculatedFee = transferFee + gasBuffer
  const minGatewayMaxFee = parseUnits('1.0', 6) // Minimum 1.0 USDC enforced by Circle Gateway
  const localMaxFee = calculatedFee < minGatewayMaxFee ? minGatewayMaxFee : calculatedFee

  let burnValue = parseUnits(amount, 6)

  // The burn-intent spec is built once so the fee estimate and the signed intent
  // share the exact same payload (including the salt), mirroring the UCW path.
  // Deliberately not annotated: inference preserves the `0x${string}` literal
  // types the burn-intent signature requires (the structurally wider interface
  // still accepts this object for the fee estimate).
  const spec = {
    version: 1,
    sourceDomain,
    destinationDomain,
    sourceContract: toBytes32(gatewayWallet),
    destinationContract: toBytes32(gatewayMinter),
    sourceToken: toBytes32(sourceUsdc),
    destinationToken: toBytes32(destUsdc),
    sourceDepositor: toBytes32(account),
    destinationRecipient: toBytes32(destRecipient),
    sourceSigner: toBytes32(account),
    destinationCaller: toBytes32(zeroAddress),
    value: burnValue,
    salt: randomHex32(),
    hookData: '0x' as const,
  }

  // Circle's `/estimate` is the canonical maxFee, but the proven local formula
  // stays as a floor: an /estimate outage can never lower a ceiling that has
  // been working, while a higher canonical quote always wins so the intent is
  // not rejected when Circle's real fee grows beyond the approximation.
  let maxFee = localMaxFee
  if (!isSameChain) {
    const quote = await estimateGatewayMaxFee(spec, false)
    if (quote) {
      if (quote.maxFee > maxFee) {
        console.log(`[transferFromGateway] Adopting canonical /estimate maxFee ${quote.maxFee} (local floor was ${localMaxFee})`)
        maxFee = quote.maxFee
      }
    } else {
      console.warn(`[transferFromGateway] Gateway /estimate unavailable; signing with the local maxFee floor (${localMaxFee}).`)
    }
  }

  // Pre-flight check: Ensure user balance on source domain covers burnValue + maxFee
  try {
    const balancesResp = await getGatewayBalances(account, IS_TESTNET ? 'testnet' : 'mainnet')
    const sourceItem = balancesResp.balances?.find((b) => b.domain === sourceDomain)
    if (!sourceItem) {
      throw new Error(`No confirmed Gateway balance was found for ${sourceChain}; transfer was not signed.`)
    }
    {
      const sourceBalanceUnits = parseUnits(sourceItem.balance || '0', 6)
      if (sourceBalanceUnits < maxFee) {
        throw new Error(
          `Insufficient Gateway balance on ${sourceChain}. ` +
          `Available: ${sourceItem.balance} USDC, which is less than the required Gateway routing fee buffer (${(Number(maxFee) / 1e6).toFixed(2)} USDC).`
        )
      }
      if (burnValue + maxFee > sourceBalanceUnits) {
        throw new Error(
          `Insufficient Gateway balance on ${sourceChain}. Requested ${amount} USDC plus up to ${(Number(maxFee) / 1e6).toFixed(6)} USDC fee exceeds available ${sourceItem.balance} USDC. Reduce the transfer amount explicitly before retrying.`
        )
      }
    }
  } catch (checkErr: any) {
    if (checkErr.message?.includes('Insufficient Gateway balance')) {
      throw checkErr
    }
    throw new Error(`Could not verify Gateway balance before transfer: ${checkErr?.message || 'balance service unavailable'}`)
  }

  const burnIntent = {
    maxBlockHeight: MAX_BLOCK_HEIGHT,
    maxFee,
    spec,
  }

  const signature = await sourceWalletClient.signTypedData({
    domain: GATEWAY_EIP712_DOMAIN,
    types: GATEWAY_EIP712_TYPES,
    primaryType: 'BurnIntent',
    message: burnIntent,
  })

  // Step 2: Submit to the Gateway API
  const apiResponse = await fetch(`${ACTIVE_GATEWAY_API}/transfer`, {
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

    if (errorDetail?.toLowerCase().includes('unauthorized') || apiResponse.status === 400) {
      throw new Error(
        `Circle Gateway could not process withdrawal: ${errorDetail || 'Unauthorized'}. ` +
        `Please ensure your Gateway balance is confirmed and sufficient to cover ${amount} USDC.`
      )
    }

    throw new Error(`Gateway API request failed (${apiResponse.status}): ${errorDetail}`)
  }

  const { attestation, signature: mintSignature } = (await apiResponse.json()) as {
    attestation: `0x${string}`
    signature: `0x${string}`
  }

  // Step 3: Switch to destination chain and mint
  await ensureChain(provider, destinationChainDef)

  const destinationWalletClient = createWalletClient({
    account,
    chain: destinationChainDef,
    transport: custom(provider),
  })

  // Centralized resilient client for destination chain
  const destinationPublicClient = getResilientPublicClient(destinationChainDef)

  const gatewayMinterContract = getContract({
    address: gatewayMinter,
    abi: GATEWAY_MINTER_ABI,
    client: destinationWalletClient,
  })

  let mintGasLimit: bigint = GATEWAY_GAS_LIMITS.mint
  try {
    const estimatedGas = await destinationPublicClient.estimateContractGas({
      address: gatewayMinter,
      abi: GATEWAY_MINTER_ABI,
      functionName: 'gatewayMint',
      args: [attestation, mintSignature],
      account,
    })
    mintGasLimit = (estimatedGas * 130n) / 100n
  } catch (gasErr) {
    console.warn('[transferFromGateway] Mint gas estimate fallback to 250_000:', gasErr)
    mintGasLimit = 250_000n
  }

  const mintTxHash = await gatewayMinterContract.write.gatewayMint(
    [attestation, mintSignature],
    { account, gas: mintGasLimit }
  )
  const mintRes = await resilientWaitForReceipt(destinationPublicClient, mintTxHash as `0x${string}`, 'Gateway Mint')
  if (mintRes.status !== 'success' || !mintRes.receipt || mintRes.receipt.transactionHash.toLowerCase() !== mintTxHash.toLowerCase()) {
    throw new Error(mintRes.status === 'reverted' ? 'Gateway mint transaction reverted on-chain.' : 'Gateway mint receipt is not confirmed; destination delivery remains pending.')
  }
  if (!await verifyDestinationUsdcMint(destinationChain, mintTxHash, destRecipient, formatUnits(burnValue, 6), transferFee)) {
    throw new Error('Gateway mint receipt did not prove the exact USDC delivery to the requested recipient.')
  }

  return {
    burnIntent,
    signature,
    attestation,
    mintSignature,
    mintTxHash,
    amount,
    effectiveAmount: formatUnits(burnValue, 6),
    sourceChain,
    destinationChain,
    recipient: destRecipient,
  }
}

