// src/services/x402/serviceRegistration.ts
// Provider registration proof: the EIP-712 payload the server verifies with
// `recoverTypedDataAddress` (api/x402.ts) plus a signer-agnostic signing step.
//
// The server never learns which wallet type signed — it only checks that the signature
// recovers to `owner` and that `owner` matches the manifest's listing/provider address. So
// an injected EVM wallet and a Circle UCW EOA share this exact path; the only difference is
// the signer handed in.

import type { Hex } from 'viem'
import {
  SERVICE_REGISTRATION_TYPES,
  X402_AUTHORIZATION_DOMAIN,
  hashServiceManifest,
} from '../../config/x402/authorization'
import type { CircleTypedDataSigner } from '../ucwChallengeSigner'

/** The server rejects a deadline outside `(now, now + 15 minutes]`; five minutes is enough. */
export const SERVICE_REGISTRATION_VALIDITY_SECONDS = 5 * 60

export interface ServiceRegistrationProof {
  owner: string
  nonce: Hex
  deadline: number
  signature: Hex
}

export interface ServiceRegistrationTypedData {
  domain: typeof X402_AUTHORIZATION_DOMAIN
  types: typeof SERVICE_REGISTRATION_TYPES
  primaryType: 'ServiceRegistration'
  message: {
    owner: string
    manifestHash: Hex
    nonce: Hex
    deadline: bigint
  }
}

/** Replay protection: 32 random bytes, exactly the shape the server validates. */
export function randomRegistrationNonce(): Hex {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}` as Hex
}

export function buildServiceRegistrationTypedData(params: {
  owner: string
  manifest: unknown
  nonce: Hex
  deadline: number
}): ServiceRegistrationTypedData {
  return {
    domain: X402_AUTHORIZATION_DOMAIN,
    types: SERVICE_REGISTRATION_TYPES,
    primaryType: 'ServiceRegistration',
    message: {
      owner: params.owner,
      manifestHash: hashServiceManifest(params.manifest),
      nonce: params.nonce,
      deadline: BigInt(params.deadline),
    },
  }
}

/**
 * Signs one listing. The owner must be the wallet that signs: the server rejects a proof whose
 * recoverer differs from `manifest.listing.ownerAddress`, so a payout address cannot be
 * substituted for the signer here.
 */
export async function signServiceRegistration(params: {
  owner: string
  manifest: unknown
  signTypedData: CircleTypedDataSigner
  now?: number
}): Promise<ServiceRegistrationProof> {
  const nonce = randomRegistrationNonce()
  const deadline = Math.floor((params.now ?? Date.now()) / 1000) + SERVICE_REGISTRATION_VALIDITY_SECONDS
  const signature = await params.signTypedData(
    buildServiceRegistrationTypedData({
      owner: params.owner,
      manifest: params.manifest,
      nonce,
      deadline,
    })
  )
  return { owner: params.owner, nonce, deadline, signature }
}
