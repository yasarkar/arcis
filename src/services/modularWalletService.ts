// src/services/modularWalletService.ts
// Circle Modular Wallets (ERC-4337 & ERC-6900) Engine with WebAuthn Passkey Authentication
// Supports Arc Testnet (5042002), Gas Station Paymaster, and REAL UserOps via Circle Bundler

import {
  createPublicClient,
  defineChain,
  type Hex,
  type Transport,
  parseUnits,
} from 'viem'
import {
  type P256Credential,
  type SmartAccount,
  createBundlerClient,
  toWebAuthnAccount,
} from 'viem/account-abstraction'
import {
  WebAuthnMode,
  toCircleSmartAccount,
  toModularTransport,
  toPasskeyTransport,
  toWebAuthnCredential,
  encodeTransfer,
  ContractAddress,
} from '@circle-fin/modular-wallets-core'

import { arcTestnet, ARC_TOKENS } from '../config/arcChain'
import { checkPasskeySupport, parsePasskeyError, type ParsedPasskeyError } from '../utils/passkeyErrorUtils'

// ─────────────────────────────────────────────────────────────
// 1. CHAIN CONFIGURATION & CONSTANTS
// ─────────────────────────────────────────────────────────────
export const arcTestnetChain = arcTestnet
export const ARC_TESTNET_USDC = ARC_TOKENS.USDC as Hex

const STORAGE_KEYS = {
  CREDENTIAL: 'arcis_modular_passkey_credential_v1',
  USERNAME: 'arcis_modular_passkey_username_v1',
  MSCA_ADDRESS: 'arcis_modular_msca_address_v1',
}


function getClientCredentials() {
  const key = (import.meta.env.VITE_CLIENT_KEY as string)
  const url = (import.meta.env.VITE_CLIENT_URL as string)
  return { key, url }
}

// ─────────────────────────────────────────────────────────────
// 2. CIRCLE MODULAR TRANSPORTS (Bundler + Paymaster + Passkey)
// ─────────────────────────────────────────────────────────────
let _cachedModularTransport: Transport | null = null
let _cachedPasskeyTransport: Transport | null = null

function getModularTransport(): Transport {
  if (!_cachedModularTransport) {
    const { key, url } = getClientCredentials()
    _cachedModularTransport = toModularTransport(`${url}/arcTestnet`, key) as unknown as Transport
  }
  return _cachedModularTransport
}

function getPasskeyTransport(): Transport {
  if (!_cachedPasskeyTransport) {
    const { key, url } = getClientCredentials()
    _cachedPasskeyTransport = toPasskeyTransport(url, key) as unknown as Transport
  }
  return _cachedPasskeyTransport
}

export function getModularPublicClient() {
  return createPublicClient({
    chain: arcTestnetChain,
    transport: getModularTransport(),
  })
}

/**
 * Creates a bundler client using Circle's modular transport (Bundler + Paymaster).
 * Pass account per-call in sendUserOperation, NOT here.
 */
export function getModularBundlerClient() {
  return createBundlerClient({
    chain: arcTestnetChain,
    transport: getModularTransport(),
  })
}

// Cached active smart account instance
let cachedSmartAccount: SmartAccount | null = null

// ─────────────────────────────────────────────────────────────
// 3. CREDENTIAL STORAGE HELPERS (memory-cache + localStorage)
// ─────────────────────────────────────────────────────────────
const credentialStore = new Map<string, string>()

function getStorageItem(key: string): string | null {
  const val = credentialStore.get(key)
  if (val) return val
  try {
    const item = localStorage.getItem(key)
    if (item) return item
    return null
  } catch { return null }
}

function setStorageItem(key: string, value: string): void {
  credentialStore.set(key, value)
  try { localStorage.setItem(key, value) } catch { /* quota */ }
}

function removeStorageItem(key: string): void {
  credentialStore.delete(key)
  try { localStorage.removeItem(key) } catch { /* ignore */ }
}

export function getStoredCredential(): P256Credential | null {
  try {
    const raw = getStorageItem(STORAGE_KEYS.CREDENTIAL)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function getStoredMscaAddress(): string {
  return getStorageItem(STORAGE_KEYS.MSCA_ADDRESS) || ''
}

export function getStoredUsername(): string {
  return getStorageItem(STORAGE_KEYS.USERNAME) || ''
}

export function clearStoredCredential() {
  removeStorageItem(STORAGE_KEYS.CREDENTIAL)
  removeStorageItem(STORAGE_KEYS.USERNAME)
  removeStorageItem(STORAGE_KEYS.MSCA_ADDRESS)
  cachedSmartAccount = null
}
// ─────────────────────────────────────────────────────────────
// 4. PASSKEY REGISTRATION / LOGIN VIA CIRCLE SDK + SMART ACCOUNT
// ─────────────────────────────────────────────────────────────

async function buildSmartAccount(credential: P256Credential) {
  const client = getModularPublicClient()
  const ownerAccount = toWebAuthnAccount({ credential })
  const account = await toCircleSmartAccount({
    client: client as any,
    owner: ownerAccount as any,
    name: getStoredUsername() || undefined,
  })
  cachedSmartAccount = account as unknown as SmartAccount
  return account as unknown as SmartAccount
}

export async function registerPasskey(username: string): Promise<{
  success: boolean; smartAccountAddress?: string; credential?: P256Credential; error?: string; parsedError?: ParsedPasskeyError
}> {
  try {
    // 0. Environment inspection
    const envSupport = checkPasskeySupport()
    if (!envSupport.isSupported) {
      return { success: false, error: envSupport.reason }
    }

    const safeUsername = username.trim() || `arcis_user_${Math.floor(Math.random() * 10000)}`
    const passkeyTransport = getPasskeyTransport()
    const credential = await toWebAuthnCredential({
      transport: passkeyTransport as any, mode: WebAuthnMode.Register, username: safeUsername,
    })
    if (!credential) throw new Error('Biyometrik doğrulama oluşturulamadı.')
    setStorageItem(STORAGE_KEYS.CREDENTIAL, JSON.stringify(credential))
    setStorageItem(STORAGE_KEYS.USERNAME, safeUsername)
    const account = await buildSmartAccount(credential)
    if (account?.address) {
      setStorageItem(STORAGE_KEYS.MSCA_ADDRESS, account.address)
      return { success: true, smartAccountAddress: account.address, credential }
    }
    return { success: false, error: 'Smart account adresi alınamadı.' }
  } catch (err: any) {
    console.error('[ModularWallet] Registration error:', err)
    const parsed = parsePasskeyError(err)
    return { success: false, error: parsed.message, parsedError: parsed }
  }
}

export async function loginPasskey(): Promise<{
  success: boolean; smartAccountAddress?: string; credential?: P256Credential; error?: string; parsedError?: ParsedPasskeyError
}> {
  try {
    // 0. Environment inspection
    const envSupport = checkPasskeySupport()
    if (!envSupport.isSupported) {
      return { success: false, error: envSupport.reason }
    }

    let credential = getStoredCredential()
    const existingUsername = getStoredUsername() || 'Arcis Passkey User'
    if (!credential) {
      try {
        const passkeyTransport = getPasskeyTransport()
        credential = await toWebAuthnCredential({ transport: passkeyTransport as any, mode: WebAuthnMode.Login })
      } catch (authErr: any) {
        const raw = authErr?.message || String(authErr)
        if (raw.includes('Bad request for the Webauthn protocol') || raw.includes('Webauthn protocol') || raw.includes('No credential')) {
          return {
            success: false,
            error: 'Bu cihazda kayıtlı bir Passkey bulunamadı. Lütfen önce "Yeni Passkey Aç" butonuna tıklayarak ilk cüzdanınızı oluşturun.',
            parsedError: {
              code: 'NO_STORED_PASSKEY',
              title: 'Kayıtlı Passkey Bulunamadı',
              message: 'Bu cihazda henüz bir Passkey kaydı oluşturulmamış.',
              isActionable: true,
              actionHint: 'Lütfen "Yeni Passkey Aç" butonuna tıklayın, bir cüzdan adı belirleyin ve biyometrik onay verin.',
            },
          }
        }
        throw authErr
      }
    }
    if (!credential) throw new Error('Kayıtlı Passkey bulunamadı. Önce "Yeni Passkey Aç"a tıklayın.')
    setStorageItem(STORAGE_KEYS.CREDENTIAL, JSON.stringify(credential))
    setStorageItem(STORAGE_KEYS.USERNAME, existingUsername)
    const account = await buildSmartAccount(credential)
    if (account?.address) {
      setStorageItem(STORAGE_KEYS.MSCA_ADDRESS, account.address)
      return { success: true, smartAccountAddress: account.address, credential }
    }
    return { success: false, error: 'Smart account adresi kurtarılamadı.' }
  } catch (err: any) {
    console.error('[ModularWallet] Login error:', err)
    const parsed = parsePasskeyError(err)
    return { success: false, error: parsed.message, parsedError: parsed }
  }
}

export async function restoreSmartAccount(): Promise<SmartAccount | null> {
  if (cachedSmartAccount) return cachedSmartAccount
  const credential = getStoredCredential()
  if (!credential) return null
  try { return await buildSmartAccount(credential) }
  catch (err) { console.error('[ModularWallet] restoreSmartAccount error:', err); return null }
}

export function getActiveSmartAccount() { return cachedSmartAccount }
// ─────────────────────────────────────────────────────────────
// 5. USER OPERATION DISPATCHER (REAL Bundler + Paymaster)
// ─────────────────────────────────────────────────────────────

export interface UserOpCall {
  to: Hex
  data?: Hex
  value?: bigint
}

async function getOrRestoreSmartAccount() {
  if (cachedSmartAccount) return cachedSmartAccount
  return restoreSmartAccount()
}

/**
 * Sends a REAL ERC-4337 UserOperation via Circle's bundler + paymaster.
 * Signs with the passkey owner (WebAuthn). Gas sponsored via Gas Station.
 */
export async function sendModularUserOperation(params: {
  calls: UserOpCall[]
  paymaster?: boolean
}): Promise<{ success: boolean; txHash?: string; userOpHash?: string; error?: string }> {
  try {
    const smartAccount = await getOrRestoreSmartAccount()
    if (!smartAccount) {
      return { success: false, error: 'Smart account bulunamadı. Passkey ile giriş yapın.' }
    }

    const bundlerClient = getModularBundlerClient()

    // Submit via Circle Bundler — paymaster: true sponsors gas via Gas Station
    const userOpHash = await bundlerClient.sendUserOperation({
      account: smartAccount,
      calls: params.calls as any[],
      paymaster: params.paymaster !== false,
    } as any)

    // Wait for inclusion (Circle paymaster + Arc sub-second finality)
    const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash } as any)
    const txHash = (receipt as any).receipt?.transactionHash || userOpHash

    return { success: true, txHash, userOpHash }
  } catch (err: any) {
    console.error('[ModularWallet] sendModularUserOperation error:', err)
    const parsed = parsePasskeyError(err)
    return { success: false, error: parsed.message }
  }
}

/**
 * Prepares an ERC-20 USDC transfer call using Circle SDK encodeTransfer.
 */
export function createModularUsdcTransferCall(recipient: Hex, amountUsdc: number): UserOpCall {
  const parsedAmount = parseUnits(amountUsdc.toString(), 6)
  const result = encodeTransfer(recipient, ContractAddress.ArcTestnet_USDC, parsedAmount)
  return { to: result.to as Hex, data: result.data as Hex }
}