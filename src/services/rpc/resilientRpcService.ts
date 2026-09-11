// src/services/rpc/resilientRpcService.ts
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
  defineChain,
} from 'viem'
import { arcTestnet, arcActiveChain, IS_TESTNET, ARC_METADATA } from '../../config/arcChain'
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
// 1. SINGLETON CLIENT POOL (Map by Chain ID or Key)
// ─────────────────────────────────────────────────────────────
const clientPool = new Map<string | number, PublicClient>()

// In-flight request deduplication cache to prevent hammering nodes with duplicate queries
const inFlightRequests = new Map<string, Promise<any>>()

/**
 * Builds a robust Fallback transport from a list of HTTP RPC URLs.
 */
function buildFallbackTransport(
  rpcUrls: string[],
  timeoutMs: number = RPC_DEFAULT_TIMEOUT_MS,
  retryCount: number = RPC_DEFAULT_RETRIES
) {
  const uniqueUrls = rpcUrls.filter((u, idx, arr) => u && arr.indexOf(u) === idx)

  const httpTransports = uniqueUrls.map((url) =>
    http(url, {
      timeout: timeoutMs,
      retryCount,
      retryDelay: RPC_DEFAULT_RETRY_DELAY_MS,
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

  const client = createPublicClient({
    chain,
    transport,
    batch: { multicall: false }, // Avoid forcing Multicall3 on chains that do not support it
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
// 3. RESILIENT READ CONTRACT (With In-Flight Deduplication)
// ─────────────────────────────────────────────────────────────

/**
 * Resilient readContract with automatic in-flight deduplication.
 * If 3 components call the same function on the same contract at once,
 * only 1 RPC call is fired, and all 3 await the same result.
 */
export async function resilientReadContract<
  const abi extends Abi | readonly unknown[] = Abi,
  functionName extends ContractFunctionName<abi, 'pure' | 'view'> = ContractFunctionName<abi, 'pure' | 'view'>,
  args extends ContractFunctionArgs<abi, 'pure' | 'view', functionName> = ContractFunctionArgs<abi, 'pure' | 'view', functionName>,
>(
  client: PublicClient,
  params: ReadContractParameters<abi, functionName, args>
): Promise<ReadContractReturnType<abi, functionName, args>> {
  const chainId = client.chain?.id || 'unknown'
  const dedupeKey = `read:${chainId}:${params.address}:${params.functionName}:${JSON.stringify(
    params.args,
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v)
  )}`

  if (inFlightRequests.has(dedupeKey)) {
    return inFlightRequests.get(dedupeKey)!
  }

  const promise = (async () => {
    try {
      const res = await (client.readContract as any)(params)
      return res as ReadContractReturnType<abi, functionName, args>
    } finally {
      inFlightRequests.delete(dedupeKey)
    }
  })()

  inFlightRequests.set(dedupeKey, promise as any)
  return promise
}

// ─────────────────────────────────────────────────────────────
// 4. RESILIENT GET BALANCE (Native Token with Deduplication)
// ─────────────────────────────────────────────────────────────

export async function resilientGetBalance(
  client: PublicClient,
  params: GetBalanceParameters
): Promise<bigint> {
  const chainId = client.chain?.id || 'unknown'
  const dedupeKey = `bal:${chainId}:${params.address}:${params.blockTag || 'latest'}`

  if (inFlightRequests.has(dedupeKey)) {
    return inFlightRequests.get(dedupeKey)!
  }

  const promise = (async () => {
    try {
      const bal = await client.getBalance(params)
      return bal
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
