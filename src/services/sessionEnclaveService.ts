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
import { arcTestnet, ARC_METADATA } from '../config/arcChain.js'
import { POOL_CONTRACTS, ERC20_ABI } from '../config/poolsConfig.js'
import type { SessionScope } from '../types/sessionKey.js'
import { logger } from '../utils/logger.js'

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
 * Reads a valid 32-byte hex private key from a storage provider (localStorage or sessionStorage)
 */
function getValidHex(storage: Storage | undefined, key: string): Hex | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (raw && /^0x[0-9a-fA-F]{64}$/.test(raw.trim())) {
      return raw.trim() as Hex
    }
  } catch (err) {
    log.debug(`Failed reading ${key} from storage`, err)
  }
  return null
}

/**
 * Retrieves the ephemeral private key for a given wallet and scope.
 * Resilient multi-layer search:
 * 1. Direct scoped lookup in localStorage (primary for multi-tab durability)
 * 2. Direct scoped lookup in sessionStorage (legacy / fallback)
 * 3. Fallback to 'default' wallet key if rawWallet is address-specific
 * 4. Cross-scope fallback (copilot vs marketplace)
 * 5. Legacy v1 copilot key
 * 6. Smart Public Key Matcher: If targetPublicKey is provided, scans all enclave keys
 *    in both storages to locate the account whose derived address matches targetPublicKey.
 */
function readStoredPrivateKey(
  rawWallet: string,
  scope: SessionScope = 'copilot',
  targetPublicKey?: string
): Hex | null {
  if (typeof window === 'undefined') return null

  const local = typeof localStorage !== 'undefined' ? localStorage : undefined
  const session = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined

  // 1. Direct scoped lookup in localStorage (primary multi-tab storage)
  const scopedKey = getStorageKey(rawWallet, scope)
  const localDirect = getValidHex(local, scopedKey)
  if (localDirect) return localDirect

  // 2. Direct scoped lookup in sessionStorage (legacy / fallback)
  const sessionDirect = getValidHex(session, scopedKey)
  if (sessionDirect) {
    // Self-heal: propagate to localStorage for multi-tab durability
    if (local) {
      try { local.setItem(scopedKey, sessionDirect) } catch { /* ignore */ }
    }
    return sessionDirect
  }

  // 3. Fallback to 'default' wallet if rawWallet is a specific address (within the SAME scope)
  if (rawWallet !== 'default') {
    const defaultKey = getStorageKey('default', scope)
    const localDefault = getValidHex(local, defaultKey)
    if (localDefault) return localDefault

    const sessionDefault = getValidHex(session, defaultKey)
    if (sessionDefault) return sessionDefault
  }

  // 4. Legacy v1 key (copilot only)
  if (scope === 'copilot') {
    const legacyKey = `${LEGACY_STORAGE_PREFIX}${rawWallet}`
    const localLegacy = getValidHex(local, legacyKey)
    if (localLegacy) return localLegacy
    const sessionLegacy = getValidHex(session, legacyKey)
    if (sessionLegacy) return sessionLegacy
  }

  // 6. Smart Public Key Matcher: If targetPublicKey is known, scan all enclave keys in storage
  if (targetPublicKey && isAddress(targetPublicKey)) {
    const normalizedTarget = targetPublicKey.trim().toLowerCase()
    const storages = [local, session]
    for (const st of storages) {
      if (!st) continue
      try {
        const len = st.length
        for (let i = 0; i < len; i++) {
          const k = st.key(i)
          if (!k || (!k.startsWith(ENCLAVE_KEY_STORAGE_PREFIX) && !k.startsWith(LEGACY_STORAGE_PREFIX))) continue
          const candidateVal = getValidHex(st, k)
          if (candidateVal) {
            try {
              const acct = privateKeyToAccount(candidateVal)
              if (acct.address.toLowerCase() === normalizedTarget) {
                log.info(`Smart key matcher resolved private key for ${normalizedTarget} from ${k}`)
                // Self-heal to current scoped key in localStorage
                if (local) {
                  try { local.setItem(scopedKey, candidateVal) } catch { /* ignore */ }
                }
                return candidateVal
              }
            } catch {
              // ignore invalid candidate
            }
          }
        }
      } catch (scanErr) {
        log.debug('Smart key matcher scan error', scanErr)
      }
    }
  }

  return null
}

/**
 * Persists the ephemeral private key in localStorage (for multi-tab & restart resilience)
 * and in sessionStorage.
 */
function persistPrivateKey(rawWallet: string, privKey: Hex, scope: SessionScope = 'copilot'): void {
  if (typeof window === 'undefined') return
  const scopedKey = getStorageKey(rawWallet, scope)

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(scopedKey, privKey)
    } catch (err) {
      log.debug('Failed to persist ephemeral key in localStorage', err)
    }
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(scopedKey, privKey)
    } catch (err) {
      log.debug('Failed to persist ephemeral key in sessionStorage', err)
    }
  }
}

/**
 * Removes the ephemeral private key from both localStorage and sessionStorage
 */
function removeStoredPrivateKey(rawWallet: string, scope: SessionScope = 'copilot', targetPublicKey?: string): void {
  if (typeof window === 'undefined') return
  const scopedKey = getStorageKey(rawWallet, scope)
  const legacyKey = `${LEGACY_STORAGE_PREFIX}${rawWallet}`
  const defaultKey = getStorageKey('default', scope)

  const storages = [
    typeof localStorage !== 'undefined' ? localStorage : null,
    typeof sessionStorage !== 'undefined' ? sessionStorage : null,
  ]

  for (const st of storages) {
    if (!st) continue
    try {
      st.removeItem(scopedKey)
      st.removeItem(legacyKey)
      if (rawWallet !== 'default') {
        st.removeItem(defaultKey)
      }

      // If targetPublicKey is known, also scan and remove any orphaned keys matching that address
      if (targetPublicKey && isAddress(targetPublicKey)) {
        const normalizedTarget = targetPublicKey.trim().toLowerCase()
        const keysToRemove: string[] = []
        for (let i = 0; i < st.length; i++) {
          const k = st.key(i)
          if (k && (k.startsWith(ENCLAVE_KEY_STORAGE_PREFIX) || k.startsWith(LEGACY_STORAGE_PREFIX))) {
            const val = getValidHex(st, k)
            if (val) {
              try {
                if (privateKeyToAccount(val).address.toLowerCase() === normalizedTarget) {
                  keysToRemove.push(k)
                }
              } catch { /* ignore */ }
            }
          }
        }
        for (const k of keysToRemove) {
          st.removeItem(k)
        }
      }
    } catch (err) {
      log.debug('Failed to remove ephemeral key from storage', err)
    }
  }
}

/**
 * Gets or recovers the PrivateKeyAccount for the given wallet session and scope.
 */
export function getEphemeralSessionAccount(
  walletAddress?: string,
  scope: SessionScope = 'copilot',
  targetPublicKey?: string
): PrivateKeyAccount | null {
  const { rawWallet, cacheKey } = normalizeScopedKey(walletAddress, scope)

  // 1. Check in-memory map
  const cached = inMemoryEnclaveAccounts.get(cacheKey)
  if (cached) {
    if (!targetPublicKey || cached.address.toLowerCase() === targetPublicKey.trim().toLowerCase()) {
      return cached
    }
  }

  // 2. Re-hydrate from storage (localStorage primary, sessionStorage fallback, smart matching)
  const storedKey = readStoredPrivateKey(rawWallet, scope, targetPublicKey)
  if (storedKey) {
    try {
      const account = privateKeyToAccount(storedKey)
      inMemoryEnclaveAccounts.set(cacheKey, account)
      return account
    } catch (err) {
      log.error('Failed to instantiate privateKeyToAccount from stored key', err)
      removeStoredPrivateKey(rawWallet, scope, targetPublicKey)
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
 * Clears the ephemeral session keypair from memory and storage for the specified scope.
 */
export function clearEphemeralSessionAccount(
  walletAddress?: string,
  scope: SessionScope = 'copilot',
  targetPublicKey?: string
): void {
  const { rawWallet, cacheKey } = normalizeScopedKey(walletAddress, scope)
  inMemoryEnclaveAccounts.delete(cacheKey)
  removeStoredPrivateKey(rawWallet, scope, targetPublicKey)
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
  scope: SessionScope = 'copilot',
  targetPublicKey?: string
): Promise<{ success: boolean; sweptAmountUsdc: number; txHash?: string; error?: string }> {
  const normalizedOwner = ownerAddress?.trim().toLowerCase()
  if (!normalizedOwner || !isAddress(normalizedOwner)) {
    return { success: false, sweptAmountUsdc: 0, error: 'Invalid owner address' }
  }

  const account = getEphemeralSessionAccount(walletAddress, scope, targetPublicKey)
  if (!account) {
    return {
      success: false,
      sweptAmountUsdc: 0,
      error: 'No active session enclave signer found in client storage. The private key may have been cleared or created in an older tab before multi-tab storage was enabled.',
    }
  }

  try {
    const client = getArcClient()
    const rawBalance = (await client.readContract({
      address: POOL_CONTRACTS.USDC as Address,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    })) as bigint

    if (rawBalance <= 0n) {
      return { success: true, sweptAmountUsdc: 0 }
    }

    // Arc Testnet uses USDC as native gas, deducted directly from the account.
    // If we attempt to transfer 100% of rawBalance, the transaction will revert
    // with "transfer amount exceeds balance" because gas fee is also deducted in USDC.
    // We reserve 0.002 USDC (2,000 micro-units, ~50k gas @ 25 Gwei) for transaction gas.
    const GAS_RESERVE_MICROS = 2000n
    const transferBalance = rawBalance > GAS_RESERVE_MICROS ? rawBalance - GAS_RESERVE_MICROS : rawBalance
    const sweptAmount = Number(formatUnits(transferBalance, 6))

    if (transferBalance <= 0n || sweptAmount <= 0) {
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
        args: [normalizedOwner as Address, transferBalance],
      }),
    })

    log.info(`Broadcasting sweep of ${sweptAmount} USDC from enclave ${account.address} to owner ${ownerAddress}: ${hash}`)

    // Wait for transaction receipt confirmation on Arc Testnet
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: 30000,
    })

    if (receipt.status !== 'success') {
      throw new Error(`Sweep transaction reverted on Arc Testnet (tx: ${hash}). Funds remain in enclave.`)
    }

    log.info(`Confirmed sweep of ${sweptAmount} USDC from enclave ${account.address} to owner ${ownerAddress}: ${hash}`)

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
