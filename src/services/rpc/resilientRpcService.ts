// Centralized Resilient Blockchain RPC Manager for Arcis Protocol.
// Features:
// 1. Singleton PublicClient Connection Pooling (zero socket leaks)
// 2. Automatic multi-endpoint fallback transport (instant failover on 429/timeout)
// 3. In-flight request deduplication (prevents redundant parallel RPC spam)
// 4. Safe transaction receipt polling with transaction fallback check
// 5. Latency and health monitoring
import {
  createPublicClient,
  http,
  fallback,
  type PublicClient,
  type Chain,
  type Hex,
  type Address,
  type Abi,
  type ContractFunctionName,
  type ContractFunctionArgs,
  type ReadContractParameters,
  type ReadContractReturnType,
  type GetBalanceParameters,
  type TransactionReceipt,
} from 'viem'
import { arcTestnet, arcActiveChain} from '../../config/arcChain'
import { CHAIN_DEFS } from '../../config/chainMeta'
import {
  TESTNET_RPC_FALLBACKS,
  ACTIVE_ARC_RPCS,
  RPC_DEFAULT_TIMEOUT_MS,
  RPC_DEFAULT_RETRIES,
  RPC_DEFAULT_RETRY_DELAY_MS,
  RPC_RECEIPT_TIMEOUT_MS,
} from './rpcConfig'

// ─────────────────────────────────────────────────────────────
// 1. SINGLETON CLIENT POOL & COOLDOWN CIRCUIT BREAKER
// ─────────────────────────────────────────────────────────────
const clientPool = new Map<string | number, PublicClient>()

// In-flight request deduplication cache to prevent hammering nodes with duplicate queries
const inFlightRequests = new Map<string, Promise<any>>()

// Short-term read micro-cache to instantly serve identical queries within 2.5s
interface MicroCacheEntry<T> {
  data: T
  expiresAt: number
}
const readMicroCache = new Map<string, MicroCacheEntry<any>>()
export const DEFAULT_MICRO_CACHE_TTL_MS = 2500 // 2.5 seconds

export function getFromMicroCache<T>(key: string): T | undefined {
  const entry = readMicroCache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expiresAt) {
    readMicroCache.delete(key)
    return undefined
  }
  return entry.data as T
}

export function setInMicroCache<T>(key: string, data: T, ttlMs: number = DEFAULT_MICRO_CACHE_TTL_MS): void {
  if (readMicroCache.size > 1000) {
    const oldestKey = readMicroCache.keys().next().value
    if (oldestKey) readMicroCache.delete(oldestKey)
  }
  readMicroCache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

/**
 * Invalidates read micro-cache (optionally matching a key substring).
 */
export function invalidateRpcCache(pattern?: string): void {
  if (!pattern) {
    readMicroCache.clear()
    return
  }
  const clean = pattern.toLowerCase()
  for (const key of readMicroCache.keys()) {
    if (key.toLowerCase().includes(clean)) {
      readMicroCache.delete(key)
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ENDPOINT COOLDOWN & CIRCUIT BREAKER
// ─────────────────────────────────────────────────────────────
const endpointCooldowns = new Map<string, number>()
export const RPC_COOLDOWN_DURATION_MS = 30_000 // 30 seconds quarantine

export function markEndpointCooldown(url: string, durationMs: number = RPC_COOLDOWN_DURATION_MS): void {
  if (!url) return
  endpointCooldowns.set(url, Date.now() + durationMs)
}

export function isEndpointInCooldown(url: string): boolean {
  const expiresAt = endpointCooldowns.get(url)
  if (!expiresAt) return false
  if (Date.now() > expiresAt) {
    endpointCooldowns.delete(url)
    return false
  }
  return true
}

export function resetEndpointCooldowns(): void {
  endpointCooldowns.clear()
}

/**
 * Returns RPC URLs reordered so healthy (non-cooldown) endpoints appear first.
 */
export function getOrderedRpcUrls(urls: string[]): string[] {
  const now = Date.now()
  const healthy: string[] = []
  const cooldown: string[] = []

  for (const url of urls) {
    const expiresAt = endpointCooldowns.get(url)
    if (expiresAt && expiresAt > now) {
      cooldown.push(url)
    } else {
      if (expiresAt) endpointCooldowns.delete(url)
      healthy.push(url)
    }
  }

  return healthy.length > 0 ? [...healthy, ...cooldown] : urls
}

/**
 * Builds a robust Fallback transport from a list of HTTP RPC URLs.
 */
function buildFallbackTransport(
  rpcUrls: string[],
  timeoutMs: number = RPC_DEFAULT_TIMEOUT_MS,
  retryCount: number = RPC_DEFAULT_RETRIES
) {
  const uniqueUrls = rpcUrls.filter((u, idx, arr) => u && arr.indexOf(u) === idx)
  const orderedUrls = getOrderedRpcUrls(uniqueUrls)

  const httpTransports = orderedUrls.map((url) =>
    http(url, {
      timeout: timeoutMs,
      retryCount,
      retryDelay: RPC_DEFAULT_RETRY_DELAY_MS,
      onFetchResponse(response) {
        if (response && (response.status === 429 || response.status === 503)) {
          markEndpointCooldown(url)
        }
      },
    })
  )

  return fallback(httpTransports, {
    rank: false, // Maintain priority order (primary first)
    retryCount: 1,
  })
}

/**
 * Resolves a chain representation (string key, chain ID, or Viem Chain object)
 * into a valid Viem Chain and its associated fallback RPC URLs.
 */
export function resolveChainAndFallbacks(chainInput: any): {
  chain: Chain
  rpcUrls: string[]
  poolKey: string | number
} {
  // A. Arc Active Chain
  if (
    !chainInput ||
    chainInput === 'Arc_Testnet' ||
    chainInput === arcTestnet.id ||
    chainInput?.id === arcTestnet.id ||
    chainInput?.name === arcTestnet.name ||
    String(chainInput).toLowerCase().includes('arc')
  ) {
    return {
      chain: arcActiveChain,
      rpcUrls: ACTIVE_ARC_RPCS,
      poolKey: arcActiveChain.id,
    }
  }

  // B. String Key matching TESTNET_RPC_FALLBACKS or CHAIN_DEFS
  if (typeof chainInput === 'string') {
    const directFallback = TESTNET_RPC_FALLBACKS[chainInput]
    const def = CHAIN_DEFS[chainInput]

    if (directFallback && def) {
      return {
        chain: def,
        rpcUrls: directFallback.urls,
        poolKey: def.id,
      }
    }

    // Fuzzy search through CHAIN_DEFS
    const cleanKey = chainInput.toLowerCase().replace(/[\s_-]+/g, '')
    for (const [key, chainDef] of Object.entries(CHAIN_DEFS)) {
      if (key.toLowerCase().replace(/[\s_-]+/g, '') === cleanKey) {
        const fallbacks = TESTNET_RPC_FALLBACKS[key]?.urls ||
          chainDef?.rpcUrls?.default?.http ||
          ['https://rpc.ankr.com/eth']
        return {
          chain: chainDef,
          rpcUrls: fallbacks,
          poolKey: chainDef.id,
        }
      }
    }
  }

  // C. Chain object with id
  if (typeof chainInput === 'object' && chainInput?.id) {
    const chainId = chainInput.id
    // Search in fallback list by chainId
    for (const [, config] of Object.entries(TESTNET_RPC_FALLBACKS)) {
      if (config.chainId === chainId) {
        return {
          chain: chainInput,
          rpcUrls: config.urls,
          poolKey: chainId,
        }
      }
    }

    const defaultUrls: string[] =
      chainInput.rpcUrls?.default?.http ||
      chainInput.rpcUrls?.public?.http ||
      ['https://rpc.ankr.com/eth']

    return {
      chain: chainInput,
      rpcUrls: defaultUrls,
      poolKey: chainId,
    }
  }

  // D. Number chainId
  if (typeof chainInput === 'number') {
    for (const [key, config] of Object.entries(TESTNET_RPC_FALLBACKS)) {
      if (config.chainId === chainInput) {
        const chainDef = CHAIN_DEFS[key] || arcActiveChain
        return {
          chain: chainDef,
          rpcUrls: config.urls,
          poolKey: chainInput,
        }
      }
    }
  }

  // Fallback default
  return {
    chain: arcActiveChain,
    rpcUrls: ACTIVE_ARC_RPCS,
    poolKey: arcActiveChain.id,
  }
}

// ─────────────────────────────────────────────────────────────
// 2. CENTRAL PUBLIC CLIENT POOL GETTERS
// ─────────────────────────────────────────────────────────────

/**
 * Returns or initializes the singleton Resilient PublicClient for any chain.
 * Reuses active instances to avoid connection/socket leaks.
 */
export function getResilientPublicClient(chainInput?: any): PublicClient {
  const { chain, rpcUrls, poolKey } = resolveChainAndFallbacks(chainInput)

  if (clientPool.has(poolKey)) {
    return clientPool.get(poolKey)!
  }

  const transport = buildFallbackTransport(rpcUrls, RPC_DEFAULT_TIMEOUT_MS, RPC_DEFAULT_RETRIES)

  const hasMulticall = Boolean((chain as any)?.contracts?.multicall3?.address)

  const client = createPublicClient({
    chain,
    transport,
    batch: {
      multicall: hasMulticall ? { batchSize: 64, wait: 20 } : false,
    },
    pollingInterval: chain.id === arcTestnet.id ? 4000 : 8000,
  })

  clientPool.set(poolKey, client)
  return client
}

/**
 * Convenience getter for the primary Arc PublicClient (Arc Testnet / Mainnet).
 * Backed by all configured Arc RPC mirrors.
 */
export function getArcPublicClient(): PublicClient {
  return getResilientPublicClient(arcActiveChain.id)
}

// ─────────────────────────────────────────────────────────────
// 3. RESILIENT READ CONTRACT (With In-Flight Deduplication & Rate Limit Retry)
// ─────────────────────────────────────────────────────────────

/**
 * Resilient readContract with automatic in-flight deduplication and rate-limit backoff.
 * If 3 components call the same function on the same contract at once,
 * only 1 RPC call is fired, and all 3 await the same result.
 * Automatically retries with exponential backoff on HTTP 429 / -32005 / rate limits.
 */
export async function resilientReadContract<
  const abi extends Abi | readonly unknown[] = Abi,
  functionName extends ContractFunctionName<abi, 'pure' | 'view'> = ContractFunctionName<abi, 'pure' | 'view'>,
  args extends ContractFunctionArgs<abi, 'pure' | 'view', functionName> = ContractFunctionArgs<abi, 'pure' | 'view', functionName>,
>(
  client: PublicClient,
  params: ReadContractParameters<abi, functionName, args>,
  maxRetries: number = 3
): Promise<ReadContractReturnType<abi, functionName, args>> {
  const chainId = client.chain?.id || 'unknown'
  const dedupeKey = `read:${chainId}:${params.address}:${params.functionName}:${JSON.stringify(
    params.args,
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v)
  )}`

  // 1. Check Micro-cache
  const cached = getFromMicroCache<ReadContractReturnType<abi, functionName, args>>(dedupeKey)
  if (cached !== undefined) {
    return cached
  }

  // 2. Check In-Flight Deduplication
  if (inFlightRequests.has(dedupeKey)) {
    return inFlightRequests.get(dedupeKey)!
  }

  const promise = (async () => {
    let attempt = 0
    try {
      while (true) {
        try {
          const res = await (client.readContract as any)(params)
          setInMicroCache(dedupeKey, res, DEFAULT_MICRO_CACHE_TTL_MS)
          return res as ReadContractReturnType<abi, functionName, args>
        } catch (err: any) {
          attempt++
          const msg = (
            err?.shortMessage ||
            err?.details ||
            err?.message ||
            err?.cause?.message ||
            err?.cause?.details ||
            ''
          ).toLowerCase()

          const isRateLimited =
            msg.includes('rate limit') ||
            msg.includes('rate-limited') ||
            msg.includes('limit exceeded') ||
            msg.includes('limitexceeded') ||
            msg.includes('too many requests') ||
            msg.includes('request is being rate limited') ||
            err?.code === -32005 ||
            err?.code === 429 ||
            err?.cause?.code === -32005 ||
            err?.cause?.code === 429

          if (isRateLimited && attempt <= maxRetries) {
            const delayMs = attempt * 800 + Math.floor(Math.random() * 200)
            console.warn(
              `[resilientRpc] readContract rate-limited by RPC node (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms...`
            )
            await new Promise((resolve) => setTimeout(resolve, delayMs))
            continue
          }
          throw err
        }
      }
    } finally {
      inFlightRequests.delete(dedupeKey)
    }
  })()

  inFlightRequests.set(dedupeKey, promise as any)
  return promise
}

// ─────────────────────────────────────────────────────────────
// 4. RESILIENT GET BALANCE (Native Token with Deduplication & Micro-Cache)
// ─────────────────────────────────────────────────────────────

export async function resilientGetBalance(
  client: PublicClient,
  params: GetBalanceParameters
): Promise<bigint> {
  const chainId = client.chain?.id || 'unknown'
  const dedupeKey = `bal:${chainId}:${params.address}:${params.blockTag || 'latest'}`

  // 1. Check Micro-cache
  const cached = getFromMicroCache<bigint>(dedupeKey)
  if (cached !== undefined) {
    return cached
  }

  // 2. Check In-Flight Deduplication
  if (inFlightRequests.has(dedupeKey)) {
    return inFlightRequests.get(dedupeKey)!
  }

  const promise = (async () => {
    try {
      const bal = await client.getBalance(params)
      setInMicroCache(dedupeKey, bal, DEFAULT_MICRO_CACHE_TTL_MS)
      return bal
    } finally {
      inFlightRequests.delete(dedupeKey)
    }
  })()

  inFlightRequests.set(dedupeKey, promise)
  return promise
}

// ─────────────────────────────────────────────────────────────
// 5. RESILIENT MULTICALL3 (Batched Contract Reads with Partial Fault Tolerance)
// ─────────────────────────────────────────────────────────────

export type MulticallItem = {
  address: Address
  abi: Abi | readonly unknown[]
  functionName: string
  args?: readonly unknown[]
}

export type MulticallItemResult<T = any> =
  | { error: Error; result?: undefined; status: 'failure' }
  | { error?: undefined; result: T; status: 'success' }

/**
 * Batches multiple contract read calls into a single Multicall3 RPC query.
 * Benefits:
 * - Aggregates N contract queries into 1 single HTTP request.
 * - allowFailure = true guarantees partial reverts do not fail the entire batch.
 * - In-flight deduplication and short-term micro-caching prevent redundant node stress.
 */
export async function resilientMulticall<T = any>(
  client: PublicClient,
  contracts: readonly MulticallItem[],
  options?: {
    allowFailure?: boolean
    maxRetries?: number
    ttlMs?: number
  }
): Promise<MulticallItemResult<T>[]> {
  if (!contracts || contracts.length === 0) {
    return []
  }

  const allowFailure = options?.allowFailure ?? true
  const maxRetries = options?.maxRetries ?? 3
  const ttlMs = options?.ttlMs ?? DEFAULT_MICRO_CACHE_TTL_MS
  const chainId = client.chain?.id || 'unknown'

  const dedupeKey = `multicall:${chainId}:${JSON.stringify(
    contracts.map((c) => [c.address, c.functionName, c.args]),
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v)
  )}`

  // 1. Check Micro-cache
  const cached = getFromMicroCache<MulticallItemResult<T>[]>(dedupeKey)
  if (cached !== undefined) {
    return cached
  }

  // 2. In-flight request deduplication
  if (inFlightRequests.has(dedupeKey)) {
    return inFlightRequests.get(dedupeKey)!
  }

  const promise = (async () => {
    let attempt = 0
    try {
      while (true) {
        try {
          const res = await (client.multicall as any)({
            contracts,
            allowFailure,
          })
          setInMicroCache(dedupeKey, res, ttlMs)
          return res as MulticallItemResult<T>[]
        } catch (err: any) {
          attempt++
          const msg = (
            err?.shortMessage ||
            err?.details ||
            err?.message ||
            err?.cause?.message ||
            err?.cause?.details ||
            ''
          ).toLowerCase()

          const isRateLimited =
            msg.includes('rate limit') ||
            msg.includes('rate-limited') ||
            msg.includes('limit exceeded') ||
            msg.includes('limitexceeded') ||
            msg.includes('too many requests') ||
            msg.includes('request is being rate limited') ||
            err?.code === -32005 ||
            err?.code === 429 ||
            err?.cause?.code === -32005 ||
            err?.cause?.code === 429

          if (isRateLimited && attempt <= maxRetries) {
            const delayMs = attempt * 800 + Math.floor(Math.random() * 200)
            console.warn(
              `[resilientRpc] multicall rate-limited by RPC node (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms...`
            )
            await new Promise((resolve) => setTimeout(resolve, delayMs))
            continue
          }
          throw err
        }
      }
    } finally {
      inFlightRequests.delete(dedupeKey)
    }
  })()

  inFlightRequests.set(dedupeKey, promise)
  return promise
}

// ─────────────────────────────────────────────────────────────
// 5. RESILIENT TRANSACTION RECEIPT POLLING
// ─────────────────────────────────────────────────────────────

export interface SafeReceiptResult {
  receipt?: TransactionReceipt
  transactionHash: Hex
  status: 'success' | 'reverted' | 'unknown'
  blockNumber?: bigint
}

/**
 * Polls for transaction receipt with generous timeouts, retries, and a fallback
 * transaction lookup if the node stalls on getTransactionReceipt.
 */
export async function resilientWaitForReceipt(
  client: PublicClient,
  hash: Hex,
  description = 'Transaction',
  timeoutMs: number = RPC_RECEIPT_TIMEOUT_MS
): Promise<SafeReceiptResult> {
  try {
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: timeoutMs,
      pollingInterval: 3500,
      retryCount: 4,
      retryDelay: 1200,
    })

    return {
      receipt,
      transactionHash: hash,
      status: receipt.status === 'reverted' ? 'reverted' : 'success',
      blockNumber: receipt.blockNumber,
    }
  } catch (receiptErr: any) {
    console.warn(`[ResilientRpc] ${description} receipt polling fallback check for ${hash}:`, receiptErr)

    // Fallback: verify if transaction was already confirmed in a mined block
    try {
      const tx = await client.getTransaction({ hash })
      if (tx && tx.blockNumber) {
        return {
          transactionHash: hash,
          status: 'success',
          blockNumber: tx.blockNumber,
        }
      }
    } catch (txErr) {
      console.warn(`[ResilientRpc] getTransaction secondary check note:`, txErr)
    }

    return {
      transactionHash: hash,
      status: 'unknown',
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 6. HEALTH & LATENCY MONITORING
// ─────────────────────────────────────────────────────────────

export interface RpcHealthResult {
  url: string
  healthy: boolean
  latencyMs: number
  blockNumber?: string
  error?: string
}

/**
 * Probes an individual RPC endpoint to measure latency and block height.
 */
export async function pingRpcEndpoint(url: string, timeoutMs = 5000): Promise<RpcHealthResult> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      return {
        url,
        healthy: false,
        latencyMs: Date.now() - start,
        error: `HTTP ${res.status}`,
      }
    }

    const data = await res.json()
    const blockNum = data.result ? parseInt(data.result, 16).toString() : undefined

    return {
      url,
      healthy: Boolean(blockNum),
      latencyMs: Date.now() - start,
      blockNumber: blockNum,
    }
  } catch (err: any) {
    return {
      url,
      healthy: false,
      latencyMs: Date.now() - start,
      error: err?.message || 'Connection failed',
    }
  }
}

/**
 * Checks health of all active Arc RPC mirrors.
 */
export async function checkArcNetworkHealth(): Promise<RpcHealthResult[]> {
  return Promise.all(ACTIVE_ARC_RPCS.map((url) => pingRpcEndpoint(url)))
}

/**
 * Resilient writeContract with automatic retry on RPC rate limits (HTTP 429 / -32005 / -32603).
 * Shields browser wallets from transient RPC throttling during user transactions.
 */
export async function resilientWriteContract(
  walletClient: any,
  params: any,
  maxRetries: number = 3
): Promise<Hex> {
  let attempt = 0
  while (true) {
    try {
      const txHash = await walletClient.writeContract(params)
      // On successful transaction broadcast, bust the read micro-cache
      invalidateRpcCache()
      return txHash
    } catch (err: any) {
      attempt++
      const msg = (
        err?.shortMessage ||
        err?.details ||
        err?.message ||
        err?.cause?.message ||
        err?.cause?.details ||
        ''
      ).toLowerCase()

      const isRateLimited =
        msg.includes('rate limit') ||
        msg.includes('rate-limited') ||
        msg.includes('limit exceeded') ||
        msg.includes('limitexceeded') ||
        msg.includes('too many requests') ||
        msg.includes('request is being rate limited') ||
        err?.code === -32005 ||
        err?.code === -32603 ||
        err?.cause?.code === -32005 ||
        err?.cause?.code === -32603

      if (isRateLimited && attempt <= maxRetries) {
        const delayMs = attempt * 1200 + Math.floor(Math.random() * 300)
        console.warn(
          `[resilientRpc] writeContract rate-limited by RPC node (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms...`
        )
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        continue
      }
      throw err
    }
  }
}

// Invalidate micro-cache on window state changes
if (typeof window !== 'undefined') {
  window.addEventListener('arcis_session_key_updated', () => invalidateRpcCache())
  window.addEventListener('arcis_portfolio_updated', () => invalidateRpcCache())
  window.addEventListener('arcis:swap-volume-updated', () => invalidateRpcCache())
}

