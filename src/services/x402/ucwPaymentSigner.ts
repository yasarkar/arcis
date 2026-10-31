// src/services/x402/ucwPaymentSigner.ts
// Adapts the Circle UCW typed-data challenge (`useUserControlledWallet.signTypedData`,
// served by `POST /api/ucw?action=signTypedData`) into the signer the x402 orchestrator
// hands to `BatchEvmScheme`.
//
// Why this works: this app creates UCW wallets with `accountType: 'EOA'` (api/ucw.ts), so
// the MPC share signs a plain secp256k1 EIP-712 payload and the resulting 65-byte signature
// recovers to the wallet address on the server. A passkey/MSCA wallet has no such signature
// and must never reach this adapter (Gateway nanopayments do not verify ERC-1271).

import {
  createUcwChallengeSigner,
  UCW_CHALLENGE_BLOCKCHAIN,
  type UcwTypedDataChallenge,
} from '../ucwChallengeSigner'
import type { X402PayerKind, X402TypedDataSigner } from './paymentOrchestrator'

export type { UcwTypedDataChallenge }

/** Domain separation for the Circle challenge prompt; it never changes what is signed. */
export const UCW_X402_SIGNING_MEMO = 'Arcis x402 payment authorization'
export const UCW_X402_SIGNING_BLOCKCHAIN = UCW_CHALLENGE_BLOCKCHAIN

/**
 * Resolves which payer kind a connected wallet can be for a paid x402 call.
 * Returns null when the wallet has no EOA key holder behind it (passkey/MSCA, or a
 * Circle Wallet session whose challenge signer is unavailable).
 */
export function resolveX402Payer(
  authSource: 'passkey' | 'ucw' | 'evm' | null | undefined,
  ucwSignTypedData?: UcwTypedDataChallenge
): { kind: X402PayerKind; signer?: X402TypedDataSigner } | null {
  if (authSource === 'evm') return { kind: 'external_eoa' }
  if (authSource === 'ucw' && ucwSignTypedData) {
    return { kind: 'ucw_eoa', signer: createUcwX402Signer(ucwSignTypedData) }
  }
  return null
}

/**
 * Payment-typed-data signer. The shared challenge adapter owns the payload preparation and
 * the fail-closed checks; this wrapper only supplies the payment memo and wording.
 */
export function createUcwX402Signer(challenge: UcwTypedDataChallenge): X402TypedDataSigner {
  return createUcwChallengeSigner(challenge, {
    memo: UCW_X402_SIGNING_MEMO,
    blockchain: UCW_X402_SIGNING_BLOCKCHAIN,
    missingSignatureError: 'Circle Wallet did not return a payment signature.',
    invalidSignatureError: 'Circle Wallet returned a signature that is not a 65-byte EIP-712 authorized transfer.',
  })
}
