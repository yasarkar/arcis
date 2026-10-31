// src/services/x402/providerAuthorization.ts
// Provider-side EIP-712 authorizations (service listing, earnings withdrawal).
//
// The server verifies both with `recoverTypedDataAddress` and no ERC-1271 path, so the signer
// must be an EOA key holder: an injected wallet or a Circle UCW wallet created as an EOA.
// `resolveProviderSigner` is the single rule for that choice — surfaces must not branch on
// wallet type themselves.

import { createWalletClient, custom, type Hex } from 'viem'
import { arcTestnet } from '../../config/arcChain'
import { PROVIDER_LEDGER_TYPES, X402_AUTHORIZATION_DOMAIN } from '../../config/x402/authorization'
import {
  createUcwChallengeSigner,
  type CircleTypedDataSigner,
  type UcwTypedDataChallenge,
} from '../ucwChallengeSigner'

/** The server rejects a deadline outside `(now, now + 15 minutes]`; five minutes is enough. */
export const PROVIDER_AUTHORIZATION_VALIDITY_SECONDS = 5 * 60

export type ProviderAuthSource = 'passkey' | 'ucw' | 'evm' | null | undefined

export type ProviderSignerFailure = 'no_wallet' | 'passkey' | 'ucw_session' | 'no_provider'

export type ProviderSignerResolution =
  | { ok: true; kind: 'evm' | 'ucw'; signer: CircleTypedDataSigner }
  | { ok: false; reason: ProviderSignerFailure }

/** Replay protection: 32 random bytes, exactly the shape the server validates. */
export function randomAuthorizationNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}` as Hex
}

export function providerSignerErrorMessage(reason: ProviderSignerFailure): string {
  if (reason === 'passkey') {
    return 'Passkey wallets cannot sign a provider authorization yet. Connect an EOA or a Circle Wallet.'
  }
  if (reason === 'ucw_session') {
    return 'The Circle Wallet session cannot sign yet. Sign in again with your Circle Wallet (PIN or biometrics) and retry.'
  }
  return 'Connect the provider wallet to authorize this ledger operation.'
}

/**
 * Chooses the signer for a provider authorization.
 *
 * `memo` is what Circle shows in its confirmation prompt; it never changes what is signed.
 * An injected provider or `window.ethereum` is used for an EVM wallet; a Circle Wallet signs
 * through its typed-data challenge. A passkey/MSCA account can do neither (no ecrecover path).
 */
export function resolveProviderSigner(params: {
  authSource: ProviderAuthSource
  walletAddress?: string
  provider?: any
  ucwSignTypedData?: UcwTypedDataChallenge
  memo: string
  /** Withdrawal keeps the historical `window.ethereum` fallback; registration passes its provider. */
  allowWindowFallback?: boolean
}): ProviderSignerResolution {
  const { walletAddress } = params
  if (!walletAddress) return { ok: false, reason: 'no_wallet' }
  if (params.authSource === 'passkey') return { ok: false, reason: 'passkey' }

  if (params.authSource === 'ucw') {
    if (!params.ucwSignTypedData) return { ok: false, reason: 'ucw_session' }
    return {
      ok: true,
      kind: 'ucw',
      signer: createUcwChallengeSigner(params.ucwSignTypedData, {
        memo: params.memo,
        missingSignatureError: 'Circle Wallet did not return a signature for this provider authorization.',
        invalidSignatureError: 'Circle Wallet returned a signature that is not a 65-byte EIP-712 provider authorization.',
      }),
    }
  }

  const injected =
    params.provider ||
    (params.allowWindowFallback !== false && typeof window !== 'undefined' ? (window as any).ethereum : null)
  if (!injected) return { ok: false, reason: 'no_provider' }

  return {
    ok: true,
    kind: 'evm',
    signer: (typedData) => {
      const walletClient = createWalletClient({
        account: walletAddress as `0x${string}`,
        chain: arcTestnet,
        transport: custom(injected),
      })
      return walletClient.signTypedData({ account: walletAddress as `0x${string}`, ...typedData } as any)
    },
  }
}

export function buildProviderLedgerTypedData(params: {
  providerAddress: string
  amountUsdc: number
  nonce: Hex
  deadline: number
}) {
  return {
    domain: X402_AUTHORIZATION_DOMAIN,
    types: PROVIDER_LEDGER_TYPES,
    primaryType: 'ProviderLedgerAuthorization' as const,
    message: {
      providerAddress: params.providerAddress,
      amountMicros: BigInt(Math.round(params.amountUsdc * 1_000_000)),
      nonce: params.nonce,
      deadline: BigInt(params.deadline),
    },
  }
}

/** Signs one withdrawal authorizing `amountUsdc` of the provider's unclaimed ledger balance. */
export async function signProviderLedgerAuthorization(params: {
  providerAddress: string
  amountUsdc: number
  signTypedData: CircleTypedDataSigner
  now?: number
}): Promise<{ nonce: Hex; deadline: number; signature: Hex }> {
  const nonce = randomAuthorizationNonce()
  const deadline =
    Math.floor((params.now ?? Date.now()) / 1000) + PROVIDER_AUTHORIZATION_VALIDITY_SECONDS
  const signature = await params.signTypedData(
    buildProviderLedgerTypedData({
      providerAddress: params.providerAddress,
      amountUsdc: params.amountUsdc,
      nonce,
      deadline,
    })
  )
  return { nonce, deadline, signature }
}
