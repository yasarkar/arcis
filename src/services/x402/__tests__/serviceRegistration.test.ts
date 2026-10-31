import { describe, expect, it, vi } from 'vitest'
import { recoverTypedDataAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  SERVICE_REGISTRATION_TYPES,
  X402_AUTHORIZATION_DOMAIN,
  hashServiceManifest,
  serviceRegistrationDigest,
} from '../../../config/x402/authorization'
import { createUcwChallengeSigner } from '../../ucwChallengeSigner'
import {
  SERVICE_REGISTRATION_VALIDITY_SECONDS,
  buildServiceRegistrationTypedData,
  randomRegistrationNonce,
  signServiceRegistration,
} from '../serviceRegistration'

const MANIFEST = {
  id: 'custom-arc-signal-0001',
  version: '1.0.0',
  name: 'Arc Signal',
  description: 'A community listing used to pin provider registration signing.',
  provider: { address: '0x1111111111111111111111111111111111111111' },
  listing: { kind: 'community', ownerAddress: '0x1111111111111111111111111111111111111111' },
}

const NONCE: Hex = `0x${'ab'.repeat(32)}`

describe('buildServiceRegistrationTypedData', () => {
  it('builds exactly the payload the server rebuilds for recovery', () => {
    const typedData = buildServiceRegistrationTypedData({
      owner: MANIFEST.provider.address,
      manifest: MANIFEST,
      nonce: NONCE,
      deadline: 1_800_000_000,
    })

    expect(typedData.domain).toBe(X402_AUTHORIZATION_DOMAIN)
    expect(typedData.types).toBe(SERVICE_REGISTRATION_TYPES)
    expect(typedData.primaryType).toBe('ServiceRegistration')
    expect(typedData.message).toEqual({
      owner: MANIFEST.provider.address,
      manifestHash: hashServiceManifest(MANIFEST),
      nonce: NONCE,
      deadline: 1_800_000_000n,
    })
    // The digest helper and the signed payload must describe the same authorization.
    expect(
      serviceRegistrationDigest({
        owner: MANIFEST.provider.address as `0x${string}`,
        manifest: MANIFEST,
        nonce: NONCE,
        deadline: 1_800_000_000n,
      })
    ).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('issues a 32-byte nonce and a short-lived deadline', async () => {
    expect(randomRegistrationNonce()).toMatch(/^0x[0-9a-f]{64}$/)
    expect(randomRegistrationNonce()).not.toBe(randomRegistrationNonce())

    const now = 1_800_000_000_000
    const signer = vi.fn(async () => `0x${'ab'.repeat(65)}` as Hex)
    const proof = await signServiceRegistration({ owner: MANIFEST.provider.address, manifest: MANIFEST, signTypedData: signer, now })
    expect(proof.deadline).toBe(Math.floor(now / 1000) + SERVICE_REGISTRATION_VALIDITY_SECONDS)
  })
})

describe('signServiceRegistration — payer parity', () => {
  it('signs through a Circle UCW EOA so the server recovers the provider address', async () => {
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
    const challenge = vi.fn(async ({ data }: any) => ({ success: true, signature: await account.signTypedData(data) }))

    const proof = await signServiceRegistration({
      owner: account.address,
      manifest: MANIFEST,
      signTypedData: createUcwChallengeSigner(challenge, {
        memo: 'Arcis x402 service listing: Arc Signal',
        missingSignatureError: 'Circle Wallet did not return a service listing signature.',
        invalidSignatureError: 'Circle Wallet returned a signature that is not a 65-byte EIP-712 service listing.',
      }),
    })

    // What Circle receives: declared domain type + JSON-safe uint256, same as the x402 path.
    const sent = challenge.mock.calls[0][0]
    expect(sent.memo).toBe('Arcis x402 service listing: Arc Signal')
    expect(sent.blockchain).toBe('ARC-TESTNET')
    expect(sent.data.types.EIP712Domain).toHaveLength(Object.keys(sent.data.domain).length)
    expect(sent.data.message.deadline).toBe(String(proof.deadline))
    expect(() => JSON.stringify(sent.data)).not.toThrow()

    // What the server does with the returned signature (api/x402.ts registration route).
    const recovered = await recoverTypedDataAddress({
      domain: X402_AUTHORIZATION_DOMAIN,
      types: SERVICE_REGISTRATION_TYPES,
      primaryType: 'ServiceRegistration',
      message: {
        owner: account.address,
        manifestHash: hashServiceManifest(MANIFEST),
        nonce: proof.nonce,
        deadline: BigInt(proof.deadline),
      },
      signature: proof.signature,
    })
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
  })

  it('handles an injected EVM signer with a bigint deadline', async () => {
    const account = privateKeyToAccount(`0x${'22'.repeat(32)}`)
    let seen: any

    const proof = await signServiceRegistration({
      owner: account.address,
      manifest: MANIFEST,
      signTypedData: async (typedData) => {
        seen = typedData
        return account.signTypedData(typedData as any)
      },
    })

    expect(typeof seen.message.deadline).toBe('bigint')
    const recovered = await recoverTypedDataAddress({
      domain: X402_AUTHORIZATION_DOMAIN,
      types: SERVICE_REGISTRATION_TYPES,
      primaryType: 'ServiceRegistration',
      message: {
        owner: account.address,
        manifestHash: hashServiceManifest(MANIFEST),
        nonce: proof.nonce,
        deadline: BigInt(proof.deadline),
      },
      signature: proof.signature,
    })
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
  })

  it('refuses a Circle response that is not a 65-byte signature', async () => {
    const signer = createUcwChallengeSigner(async () => ({ success: true, signature: '0x1234' }), {
      memo: 'listing',
      missingSignatureError: 'Circle Wallet did not return a service listing signature.',
      invalidSignatureError: 'Circle Wallet returned a signature that is not a 65-byte EIP-712 service listing.',
    })

    await expect(
      signServiceRegistration({ owner: MANIFEST.provider.address, manifest: MANIFEST, signTypedData: signer })
    ).rejects.toThrow(/not a 65-byte EIP-712 service listing/)
  })
})
