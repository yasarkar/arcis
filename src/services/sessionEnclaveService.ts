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
import { logger } from '../utils/logger'

const log = logger.createScope('sessionEnclaveService')

const ENCLAVE_KEY_STORAGE_PREFIX = 'arcis_enclave_key_v1_'

// In-memory cache of active ephemeral accounts mapped by normalized walletKey
const inMemoryEnclaveAccounts: Map<string, PrivateKeyAccount> = new Map()

/**
 * Normalizes wallet address or returns 'default'
 */
function normalizeKey(walletAddress?: string | null): string {
  if (!walletAddress || typeof walletAddress !== 'string') return 'default'
  const trimmed = walletAddress.trim().toLowerCase()
  return trimmed || 'default'
}

function getStorageKey(walletKey: string): string {
  return `${ENCLAVE_KEY_STORAGE_PREFIX}${walletKey}`
}

/**
 * Retrieves the ephemeral private key for a given wallet, if stored in sessionStorage
 */
function readStoredPrivateKey(walletKey: string): Hex | null {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(getStorageKey(walletKey))
    if (raw && /^0x[0-9a-fA-F]{64}$/.test(raw.trim())) {
      return raw.trim() as Hex
    }
  } catch (err) {
    log.debug('Failed to read ephemeral key from sessionStorage', err)
  }
  return null
}

/**
 * Persists the ephemeral private key in sessionStorage (never localStorage)
 */
function persistPrivateKey(walletKey: string, privKey: Hex): void {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(getStorageKey(walletKey), privKey)
  } catch (err) {
    log.debug('Failed to persist ephemeral key in sessionStorage', err)
  }
}

/**
 * Removes the ephemeral private key from sessionStorage
 */
function removeStoredPrivateKey(walletKey: string): void {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(getStorageKey(walletKey))
  } catch (err) {
    log.debug('Failed to remove ephemeral key from sessionStorage', err)
  }
}

/**
 * Gets or recovers the PrivateKeyAccount for the given wallet session.
 */
export function getEphemeralSessionAccount(walletAddress?: string): PrivateKeyAccount | null {
  const walletKey = normalizeKey(walletAddress)

  // 1. Check in-memory map
  const cached = inMemoryEnclaveAccounts.get(walletKey)
  if (cached) return cached

  // 2. Re-hydrate from sessionStorage if available
  const storedKey = readStoredPrivateKey(walletKey)
  if (storedKey) {
    try {
      const account = privateKeyToAccount(storedKey)
      inMemoryEnclaveAccounts.set(walletKey, account)
      return account
    } catch (err) {
      log.error('Failed to instantiate privateKeyToAccount from stored key', err)
      removeStoredPrivateKey(walletKey)
    }
  }

  return null
}

/**
 * Generates a brand new ephemeral keypair and registers it for the wallet session.
 */
export function generateEphemeralSessionAccount(walletAddress?: string): {
  sessionPublicKey: Address
  account: PrivateKeyAccount
} {
  const walletKey = normalizeKey(walletAddress)
  const privKey = generatePrivateKey()
  const account = privateKeyToAccount(privKey)

  inMemoryEnclaveAccounts.set(walletKey, account)
  persistPrivateKey(walletKey, privKey)

  log.info(`Generated ephemeral session account ${account.address} for wallet ${walletKey}`)

  return {
    sessionPublicKey: account.address,
    account,
  }
}

/**
 * Clears the ephemeral session keypair from memory and sessionStorage.
 */
export function clearEphemeralSessionAccount(walletAddress?: string): void {
  const walletKey = normalizeKey(walletAddress)
  inMemoryEnclaveAccounts.delete(walletKey)
  removeStoredPrivateKey(walletKey)
  log.info(`Cleared ephemeral session account for wallet ${walletKey}`)
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
  walletAddress?: string
): Promise<{ success: boolean; sweptAmountUsdc: number; txHash?: string; error?: string }> {
  if (!isAddress(ownerAddress)) {
    return { success: false, sweptAmountUsdc: 0, error: 'Invalid owner address' }
  }

  const account = getEphemeralSessionAccount(walletAddress)
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
        args: [ownerAddress as Address, rawBalance],
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
