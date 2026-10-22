// src/services/ucwChallengeSigner.ts
// Shared adapter for every Circle user-controlled-wallet typed-data challenge
// (`POST /api/ucw?action=signTypedData`).
//
// This app creates UCW wallets with `accountType: 'EOA'` (api/ucw.ts), so the MPC share
// signs a plain secp256k1 EIP-712 payload and the 65-byte signature recovers to the wallet
// address on the server. Callers differ only in the memo the user sees and in the wording of
// the failure; the payload preparation and the fail-closed checks must not diverge.

import type { Hex } from 'viem'
import { prepareCircleTypedData } from './ucwTypedData'

/** One EIP-712 payload signed by a Circle Wallet (domain/types/primaryType/message). */
export interface CircleTypedDataPayload {
  domain: object
  types: object
  primaryType: string
  message: object
}

export type CircleTypedDataSigner = (typedData: CircleTypedDataPayload) => Promise<Hex>

/** The subset of the UCW hook's `signTypedData` this adapter depends on. */
export type UcwTypedDataChallenge = (params: {
  data: any
  memo?: string
  blockchain?: string
  walletId?: string
}) => Promise<{ success: boolean; signature?: string; error?: string }>

/**
 * The challenge route resolves the wallet for this blockchain itself, so a signature can
 * never be requested for a chain other than the one the domain describes.
 */
export const UCW_CHALLENGE_BLOCKCHAIN = 'ARC-TESTNET'

export interface UcwChallengeSignerOptions {
  /** Shown in Circle's confirmation prompt. It never changes what is signed. */
  memo: string
  blockchain?: string
  /** Thrown when Circle reports failure without an error message of its own. */
  missingSignatureError: string
  /** Thrown when Circle answers with something that is not a 65-byte ECDSA signature. */
  invalidSignatureError: string
}

/**
 * Fails closed unless Circle returns a usable 65-byte ECDSA signature: a malformed response
 * is an authorization that cannot be verified, not one to retry blindly.
 */
export function createUcwChallengeSigner(
  challenge: UcwTypedDataChallenge,
  options: UcwChallengeSignerOptions
): CircleTypedDataSigner {
  return async (typedData) => {
    const result = await challenge({
      // Shared preparer: declares EIP712Domain and makes the payload JSON-safe (bigint → string).
      data: prepareCircleTypedData(typedData),
      memo: options.memo,
      blockchain: options.blockchain || UCW_CHALLENGE_BLOCKCHAIN,
    })

    if (!result?.success || !result.signature) {
      throw new Error(result?.error || options.missingSignatureError)
    }

    const signature = result.signature.trim()
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new Error(options.invalidSignatureError)
    }
    return signature as Hex
  }
}
