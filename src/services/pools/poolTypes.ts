import type { QueryClient } from '@tanstack/react-query'
import type { Hex, TransactionReceipt, WalletClient } from 'viem'
import type { PoolConfig } from '../../config/poolsConfig'
import logger from '../../utils/logger'

// Scoped logger for pools services
export const poolsLog = logger.createScope('usePoolsData')

export interface UserPoolPosition {
  poolId: string
  stakedAmount: string
  stakedUsd: number
  earnedRewards: string
  earnedUsd: number
  lastUpdatedTimestamp: number
  isLpPosition?: boolean
  lpTokenBalance?: string
  poolSharePct?: number
  tokenAStaked?: string
  tokenBStaked?: string
  earnedFeesUsd?: number
  /** O4: true when the counter-token price is not oracle-verified, so the USD valuation is a
   * static approximation and funds-affecting USD→LP mappings must refuse to act on it. */
  priceUnavailable?: boolean
}

export interface PoolWithdrawResult {
  txHash: string
  autoSwapFailed?: boolean
  counterTokenSymbol?: string
  counterAmount?: string
}

export interface PoolExecutionContext {
  walletAddress: string
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  executeUcwContract?: (params: any) => Promise<{
    success: boolean
    txHash?: string
    hashPending?: boolean
    challengeId?: string
    error?: string
  }>
  publicClient: any
  queryClient: QueryClient
  getWalletClient: () => Promise<WalletClient | null>
  approveToken: (tokenAddress: `0x${string}`, spender: `0x${string}`, amount: bigint) => Promise<string | null | undefined>
  waitForReceiptSafe: (hash: Hex, description?: string) => Promise<TransactionReceipt | null>
  invalidatePoolCaches: () => Promise<void>
  livePrices: {
    btc: number
    eurc: number
    weth: number
  }
  userPoolPositions?: Record<string, UserPoolPosition>
  onchainPoolState?: Record<string, any>
  poolsWithUserStats: (PoolConfig & { userPosition?: UserPoolPosition })[]
}

// Safe storage helper with SSR, sandbox, sessionStorage, and memory fallback
const memoryStorageFallback = new Map<string, string>()

export const safeStorage = {
  get: (key: string): string | null => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const val = window.localStorage.getItem(key)
        if (val !== null) return val
      }
    } catch (err) {
      poolsLog.debug('localStorage read failed; falling back to sessionStorage/memory', err)
    }
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const val = window.sessionStorage.getItem(key)
        if (val !== null) return val
      }
    } catch (err) {
      poolsLog.debug('sessionStorage read failed; falling back to memory', err)
    }
    return memoryStorageFallback.get(key) ?? null
  },
  set: (key: string, val: string): void => {
    let persisted = false
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, val)
        persisted = true
      }
    } catch (err) {
      poolsLog.debug('localStorage write failed; falling back to sessionStorage/memory', err)
    }
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.setItem(key, val)
        persisted = true
      }
    } catch (err) {
      poolsLog.debug('sessionStorage write failed; falling back to memory', err)
    }
    if (!persisted) {
      memoryStorageFallback.set(key, val)
    }
  },
  remove: (key: string): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key)
      }
    } catch (err) {
      poolsLog.debug('localStorage removal failed', err)
    }
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem(key)
      }
    } catch (err) {
      poolsLog.debug('sessionStorage removal failed', err)
    }
    memoryStorageFallback.delete(key)
  },
  clearMemory: (): void => {
    memoryStorageFallback.clear()
  },
}

// Memory-only Gateway deposit tracking (Zero LocalStorage)
export const recordGatewayDeposit = (_userAddr: string, _amount: number) => { }
export const recordGatewayWithdrawal = (_userAddr: string, _amount: number) => { }
export const getLocalGatewayDeposits = (_userAddr: string): number => 0
