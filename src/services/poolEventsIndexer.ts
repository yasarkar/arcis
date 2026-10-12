// src/services/poolEventsIndexer.ts
//
// Direct On-Chain Event Scanner for Arcis Liquidity Pools & Yield Vaults.
// Uses resilient Viem `getLogs` queries against active pool contracts on Arc Testnet.
// Pure live on-chain discovery: zero hardcoded transaction hashes or static mock checkpoints.
// Discovers contract deployment on-chain and incrementally indexes live interaction events.

import type { Address, PublicClient } from 'viem'
import { POOL_CONTRACTS } from '../config/poolsConfig'
import { getArcPublicClient } from './rpc'
import { redisCache } from './redisCacheService'

/**
 * Standard pool action event topic signatures:
 * 1. Swapped(address,address,uint256,uint256)
 * 2. LiquidityAdded(address,uint256,uint256,uint256)
 * 3. LiquidityRemoved(address,uint256,uint256,uint256)
 * 4. FeesHarvested(address,uint256,uint256)
 * 5. Deposit(address,address,uint256,uint256)
 * 6. Withdraw(address,address,address,uint256,uint256)
 */
export const POOL_ACTION_EVENT_TOPICS = [
  [
    '0xa078c4190abe07940190effc1846be0ccf03ad6007bc9e93f9697d0b460befbb',
    '0x64b83944e79c3ce8d4c297411de637c3e102d064677aac0c163976ebdcd6f50e',
    '0x1dc8bb69df2b8e91fbdcbfcf93d951b3f0000f085a95fe3f7946d6161439245d',
    '0xf5149f5613f421a823c25e21089d7f43016d48d7f4e023f910f865a996998358',
    '0xdcbc1c05240f31ff3ad067ef1ee35ce4997762752e3a095284754544f4c709d7',
    '0xfbde797d201c681b91056529119e0b02407c7bb96a4a2c75c01fc9667232c8db',
  ],
] as const

export interface PoolIndexerState {
  lastScannedBlock: number
  totalTxCount: number
  knownHashes: string[]
  updatedAt: number
}

// In-memory runtime cache for the live scanner state
let memoryIndexerState: PoolIndexerState = {
  lastScannedBlock: 0,
  totalTxCount: 0,
  knownHashes: [],
  updatedAt: 0,
}

// In-memory cache for discovered contract creation blocks
const birthBlockCache = new Map<string, bigint>()

const REDIS_STATE_KEY = 'arcis:pools:tx_indexer:state'
const STORAGE_STATE_KEY = 'arcis_pools_tx_indexer_state'
const MAX_LOG_CHUNK = 4000n

function getActivePoolAddresses(): Address[] {
  const addrs: Address[] = []
  if (POOL_CONTRACTS.STABLE_SWAP_POOL && POOL_CONTRACTS.STABLE_SWAP_POOL.startsWith('0x')) {
    addrs.push(POOL_CONTRACTS.STABLE_SWAP_POOL as Address)
  }
  if (POOL_CONTRACTS.CONSTANT_PRODUCT_POOL && POOL_CONTRACTS.CONSTANT_PRODUCT_POOL.startsWith('0x')) {
    addrs.push(POOL_CONTRACTS.CONSTANT_PRODUCT_POOL as Address)
  }
  if (POOL_CONTRACTS.YIELD_VAULT && POOL_CONTRACTS.YIELD_VAULT.startsWith('0x')) {
    addrs.push(POOL_CONTRACTS.YIELD_VAULT as Address)
  }
  return addrs
}

function loadLocalStorageState(): PoolIndexerState | null {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_STATE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveLocalStorageState(state: PoolIndexerState): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage quota warnings
  }
}

/**
 * Dynamically discovers the deployment (birth) block of a contract on Arc Testnet
 * via on-chain binary search on `getBytecode`. Results are cached in memory/storage/Redis.
 */
export async function discoverContractBirthBlock(client: PublicClient, address: Address): Promise<bigint> {
  const norm = address.toLowerCase()
  if (birthBlockCache.has(norm)) {
    return birthBlockCache.get(norm)!
  }

  // 1. Check local storage
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(`arcis_birth_block_${norm}`)
      if (stored) {
        const parsed = BigInt(stored)
        if (parsed > 0n) {
          birthBlockCache.set(norm, parsed)
          return parsed
        }
      }
    } catch { }
  }

  // 2. Check backend Redis
  if (typeof window !== 'undefined') {
    try {
      const cached = await redisCache.get<string>(`arcis:pools:birth_block:${norm}`)
      if (cached) {
        const parsed = BigInt(cached)
        if (parsed > 0n) {
          birthBlockCache.set(norm, parsed)
          return parsed
        }
      }
    } catch { }
  }

  // 3. Perform live on-chain binary search
  const head = await client.getBlockNumber()

  // Find a reasonable lower bound where contract bytecode did not exist yet
  let low = 0n
  for (const span of [100_000n, 200_000n, 500_000n, 1_000_000n, 5_000_000n]) {
    const probe = head > span ? head - span : 0n
    const code = await client.getBytecode({ address, blockNumber: probe }).catch(() => null)
    if (!code || code === '0x') {
      low = probe
      break
    }
  }

  let high = head
  let birthBlock = head

  while (low <= high) {
    const mid = (low + high) / 2n
    const code = await client.getBytecode({ address, blockNumber: mid }).catch(() => null)
    if (code && code !== '0x') {
      birthBlock = mid
      high = mid - 1n
    } else {
      low = mid + 1n
    }
  }

  birthBlockCache.set(norm, birthBlock)

  // Persist discovered birth block so binary search is only ever executed once per contract
  if (typeof window !== 'undefined') {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(`arcis_birth_block_${norm}`, birthBlock.toString())
      }
      await redisCache.set(`arcis:pools:birth_block:${norm}`, birthBlock.toString(), 86400 * 7)
    } catch { }
  }

  return birthBlock
}

/**
 * Optimistically records a genuine pool transaction executed by the client
 * to immediately reflect in the UI before full block confirmation.
 */
export function recordOptimisticPoolTx(txHash?: string): void {
  if (!txHash || !txHash.startsWith('0x')) return
  const norm = txHash.toLowerCase()
  if (!memoryIndexerState.knownHashes.includes(norm)) {
    memoryIndexerState.knownHashes.push(norm)
    memoryIndexerState.totalTxCount = memoryIndexerState.knownHashes.length
    memoryIndexerState.updatedAt = Date.now()
    saveLocalStorageState(memoryIndexerState)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('arcis:pool-tx-indexed', { detail: { total: memoryIndexerState.totalTxCount } })
      )
    }
  }
}

/**
 * Directly scans on-chain pool event logs live from contract creation up to the current chain tip.
 * Returns the genuine, verified unique transaction count across all active liquidity pools & vaults.
 */
export async function fetchTotalPoolTransactionCount(clientOverride?: PublicClient): Promise<number> {
  // 1. Try restoring latest scan state from memory, Redis or LocalStorage
  if (typeof window !== 'undefined' && memoryIndexerState.totalTxCount === 0) {
    try {
      const cached = await redisCache.get<PoolIndexerState>(REDIS_STATE_KEY)
      if (cached && typeof cached.totalTxCount === 'number' && cached.lastScannedBlock > 0) {
        memoryIndexerState = cached
      } else {
        const local = loadLocalStorageState()
        if (local && typeof local.totalTxCount === 'number' && local.lastScannedBlock > 0) {
          memoryIndexerState = local
        }
      }
    } catch {
      // Continue with dynamic on-chain scan
    }
  }

  const client = clientOverride || getArcPublicClient()
  const poolAddresses = getActivePoolAddresses()
  if (poolAddresses.length === 0) {
    return memoryIndexerState.totalTxCount
  }

  // 2. Query chain tip block number
  let currentBlock: bigint
  try {
    currentBlock = await client.getBlockNumber()
  } catch (err) {
    console.warn('[poolEventsIndexer] Failed to query latest blockNumber:', err)
    return memoryIndexerState.totalTxCount
  }

  // 3. Determine scan start block
  let scanPointer: bigint
  if (memoryIndexerState.lastScannedBlock > 0) {
    scanPointer = BigInt(memoryIndexerState.lastScannedBlock) + 1n
  } else {
    // Dynamic on-chain discovery of pool contract creation
    try {
      const primaryPool = poolAddresses[0]
      const earliestBirth = await discoverContractBirthBlock(client, primaryPool)
      scanPointer = earliestBirth
    } catch (birthErr) {
      console.warn('[poolEventsIndexer] Contract birth block discovery note:', birthErr)
      scanPointer = currentBlock > 100_000n ? currentBlock - 100_000n : 0n
    }
  }

  // If already up to date with chain tip, return immediately
  if (currentBlock < scanPointer) {
    return memoryIndexerState.totalTxCount
  }

  // 4. Scan incremental block chunks (clamp to max 4,000 blocks per query to respect RPC limits)
  const knownSet = new Set<string>(memoryIndexerState.knownHashes.map((h) => h.toLowerCase()))
  let successfulUpTo = scanPointer > 0n ? scanPointer - 1n : 0n

  while (scanPointer <= currentBlock) {
    const chunkEnd =
      scanPointer + MAX_LOG_CHUNK - 1n > currentBlock ? currentBlock : scanPointer + MAX_LOG_CHUNK - 1n

    try {
      const logs = (await (client as any).getLogs({
        address: poolAddresses,
        topics: POOL_ACTION_EVENT_TOPICS,
        fromBlock: scanPointer,
        toBlock: chunkEnd,
      })) as any[]

      for (const log of logs) {
        if (log.transactionHash) {
          knownSet.add(log.transactionHash.toLowerCase())
        }
      }

      successfulUpTo = chunkEnd
      scanPointer = chunkEnd + 1n
    } catch (logErr) {
      console.warn(
        `[poolEventsIndexer] getLogs query note for blocks ${scanPointer.toString()} - ${chunkEnd.toString()}:`,
        logErr
      )
      // Stop on RPC error to prevent cascading rate limits; will resume next cycle from successfulUpTo
      break
    }
  }

  // 5. Update and persist fresh live state
  const updatedState: PoolIndexerState = {
    lastScannedBlock: Number(successfulUpTo),
    totalTxCount: knownSet.size,
    knownHashes: Array.from(knownSet),
    updatedAt: Date.now(),
  }

  memoryIndexerState = updatedState
  saveLocalStorageState(updatedState)

  if (typeof window !== 'undefined') {
    try {
      await redisCache.set(REDIS_STATE_KEY, updatedState, 60)
    } catch {
      // Non-critical cache write error
    }
  }

  return updatedState.totalTxCount
}
