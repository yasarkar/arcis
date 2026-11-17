// src/services/sessionEnclaveService.ts
// Ephemeral Session Enclave keypair manager for Arcis x402 AI Services.
// Holds an in-memory & sessionStorage-backed ephemeral EOA that signs x402
// authorizations directly without triggering user wallet prompts.

import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatUnits,
  http,
  isAddress,
  parseUnits,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { arcTestnet, ARC_METADATA } from '../config/arcChain'
import { POOL_CONTRACTS, ERC20_ABI } from '../config/poolsConfig'
import type { SessionScope } from '../types/sessionKey'
import { logger } from '../utils/logger'

const log = logger.createScope('sessionEnclaveService')

const ENCLAVE_KEY_STORAGE_PREFIX = 'arcis_enclave_key_v2_'
const LEGACY_STORAGE_PREFIX = 'arcis_enclave_key_v1_'

// In-memory cache of active ephemeral accounts mapped by scoped key (`scope:walletKey`)
const inMemoryEnclaveAccounts: Map<string, PrivateKeyAccount> = new Map()

/**
 * Normalizes wallet address and scope into an isolated cache key
 */
function normalizeScopedKey(walletAddress?: string | null, scope: SessionScope = 'copilot'): { rawWallet: string; cacheKey: string } {
  const rawWallet = (!walletAddress || typeof walletAddress !== 'string' || !walletAddress.trim())
    ? 'default'
    : walletAddress.trim().toLowerCase()
  return {
    rawWallet,
    cacheKey: `${scope}:${rawWallet}`,
  }
}

function getStorageKey(rawWallet: string, scope: SessionScope = 'copilot'): string {
  return `${ENCLAVE_KEY_STORAGE_PREFIX}${scope}_${rawWallet}`
}

/**
 * Retrieves the ephemeral private key for a given wallet and scope from sessionStorage
 */
function readStoredPrivateKey(rawWallet: string, scope: SessionScope = 'copilot'): Hex | null {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return null
  try {
    // 1. Scoped v2 key
    const scopedKey = getStorageKey(rawWallet, scope)
    const raw = sessionStorage.getItem(scopedKey)
    if (raw && /^0x[0-9a-fA-F]{64}$/.test(raw.trim())) {
      return raw.trim() as Hex
    }

    // 2. Fallback to legacy v1 key only for copilot scope
    if (scope === 'copilot') {
      const legacyKey = `${LEGACY_STORAGE_PREFIX}${rawWallet}`
      const legacyRaw = sessionStorage.getItem(legacyKey)
      if (legacyRaw && /^0x[0-9a-fA-F]{64}$/.test(legacyRaw.trim())) {
        return legacyRaw.trim() as Hex
      }
    }
  } catch (err) {
    log.debug('Failed to read ephemeral key from sessionStorage', err)
  }
  return null
}

/**
 * Persists the ephemeral private key in sessionStorage (never localStorage)
 */
function persistPrivateKey(rawWallet: string, privKey: Hex, scope: SessionScope = 'copilot'): void {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(getStorageKey(rawWallet, scope), privKey)
  } catch (err) {
    log.debug('Failed to persist ephemeral key in sessionStorage', err)
  }
}

/**
 * Removes the ephemeral private key from sessionStorage
 */
function removeStoredPrivateKey(rawWallet: string, scope: SessionScope = 'copilot'): void {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(getStorageKey(rawWallet, scope))
    if (scope === 'copilot') {
      sessionStorage.removeItem(`${LEGACY_STORAGE_PREFIX}${rawWallet}`)
    }
  } catch (err) {
    log.debug('Failed to remove ephemeral key from sessionStorage', err)
  }
}

/**
 * Gets or recovers the PrivateKeyAccount for the given wallet session and scope.
 */
export function getEphemeralSessionAccount(
  walletAddress?: string,
  scope: SessionScope = 'copilot'
): PrivateKeyAccount | null {
  const { rawWallet, cacheKey } = normalizeScopedKey(walletAddress, scope)

  // 1. Check in-memory map
  const cached = inMemoryEnclaveAccounts.get(cacheKey)
  if (cached) return cached

  // 2. Re-hydrate from sessionStorage if available
  const storedKey = readStoredPrivateKey(rawWallet, scope)
  if (storedKey) {
    try {
      const account = privateKeyToAccount(storedKey)
      inMemoryEnclaveAccounts.set(cacheKey, account)
      return account
    } catch (err) {
      log.error('Failed to instantiate privateKeyToAccount from stored key', err)
      removeStoredPrivateKey(rawWallet, scope)
    }
  }

  return null
}

/**
 * Generates a brand new ephemeral keypair and registers it for the wallet session and scope.
 */
export function generateEphemeralSessionAccount(
  walletAddress?: string,
  scope: SessionScope = 'copilot'
): {
  sessionPublicKey: Address
  account: PrivateKeyAccount
} {
  const { rawWallet, cacheKey } = normalizeScopedKey(walletAddress, scope)
  const privKey = generatePrivateKey()
  const account = privateKeyToAccount(privKey)

  inMemoryEnclaveAccounts.set(cacheKey, account)
  persistPrivateKey(rawWallet, privKey, scope)

  log.info(`Generated ephemeral ${scope} session account ${account.address} for wallet ${rawWallet}`)

  return {
    sessionPublicKey: account.address,
    account,
  }
}

/**
 * Clears the ephemeral session keypair from memory and sessionStorage for the specified scope.
 */
export function clearEphemeralSessionAccount(
  walletAddress?: string,
  scope: SessionScope = 'copilot'
): void {
  const { rawWallet, cacheKey } = normalizeScopedKey(walletAddress, scope)
  inMemoryEnclaveAccounts.delete(cacheKey)
  removeStoredPrivateKey(rawWallet, scope)
  log.info(`Cleared ephemeral ${scope} session account for wallet ${rawWallet}`)
}

/**
 * Creates an Arc Testnet public client for reading token balances and state.
 */
function getArcClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_METADATA.rpcHttpUrl),
  })
}

/**
 * Queries the live USDC balance of the session enclave on Arc Testnet.
 */
export async function fetchEnclaveUsdcBalance(sessionPublicKey?: string): Promise<number> {
  if (!sessionPublicKey || !isAddress(sessionPublicKey)) return 0

  try {
    const client = getArcClient()
    const rawBalance = (await client.readContract({
      address: POOL_CONTRACTS.USDC as Address,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [sessionPublicKey as Address],
    })) as bigint

    const usdc = Number(formatUnits(rawBalance, 6))
    return Number.isFinite(usdc) ? usdc : 0
  } catch (err) {
    log.debug(`Failed to fetch enclave USDC balance for ${sessionPublicKey}`, err)
    return 0
  }
}

/**
 * Sweeps all remaining USDC from the session enclave account back to the owner wallet address.
 */
export async function sweepEnclaveUsdc(
  ownerAddress: string,
  walletAddress?: string,
  scope: SessionScope = 'copilot'
): Promise<{ success: boolean; sweptAmountUsdc: number; txHash?: string; error?: string }> {
  const normalizedOwner = ownerAddress?.trim().toLowerCase()
  if (!normalizedOwner || !isAddress(normalizedOwner)) {
    return { success: false, sweptAmountUsdc: 0, error: 'Invalid owner address' }
  }

  const account = getEphemeralSessionAccount(walletAddress, scope)
  if (!account) {
    return { success: false, sweptAmountUsdc: 0, error: 'No active session enclave signer found in client memory' }
  }

  try {
    const client = getArcClient()
    const rawBalance = (await client.readContract({
      address: POOL_CONTRACTS.USDC as Address,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    })) as bigint

    const sweptAmount = Number(formatUnits(rawBalance, 6))
    if (rawBalance <= 0n || sweptAmount <= 0) {
      return { success: true, sweptAmountUsdc: 0 }
    }

    // Broadcast transfer from the ephemeral account to ownerAddress
    const walletClient = createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(ARC_METADATA.rpcHttpUrl),
    })

    const hash = await walletClient.sendTransaction({
      to: POOL_CONTRACTS.USDC as Address,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [normalizedOwner as Address, rawBalance],
      }),
    })

    log.info(`Swept ${sweptAmount} USDC from enclave ${account.address} to owner ${ownerAddress}: ${hash}`)

    return {
      success: true,
      sweptAmountUsdc: sweptAmount,
      txHash: hash,
    }
  } catch (err: any) {
    log.error('Failed to sweep enclave balance', err)
    return {
      success: false,
      sweptAmountUsdc: 0,
      error: err?.message || 'Sweep transaction failed',
    }
  }
}
