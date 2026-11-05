import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  generateEphemeralSessionAccount,
  getEphemeralSessionAccount,
  clearEphemeralSessionAccount,
} from '../sessionEnclaveService'

describe('sessionEnclaveService', () => {
  const TEST_WALLET = '0x1111111111111111111111111111111111111111'

  beforeEach(() => {
    clearEphemeralSessionAccount(TEST_WALLET)
  })

  it('generates an ephemeral session account with valid address and privateKey', () => {
    const { sessionPublicKey, account } = generateEphemeralSessionAccount(TEST_WALLET)
    expect(sessionPublicKey).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(account.address.toLowerCase()).toBe(sessionPublicKey.toLowerCase())
  })

  it('retrieves the cached account from memory', () => {
    const { sessionPublicKey } = generateEphemeralSessionAccount(TEST_WALLET)
    const retrieved = getEphemeralSessionAccount(TEST_WALLET)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.address.toLowerCase()).toBe(sessionPublicKey.toLowerCase())
  })

  it('clears ephemeral account upon revoke/clear', () => {
    generateEphemeralSessionAccount(TEST_WALLET)
    clearEphemeralSessionAccount(TEST_WALLET)
    expect(getEphemeralSessionAccount(TEST_WALLET)).toBeNull()
  })

  it('signs EIP-712 typed data with ephemeral account directly', async () => {
    const { account } = generateEphemeralSessionAccount(TEST_WALLET)
    const typedData = {
      domain: {
        name: 'ArcisTest',
        version: '1',
        chainId: 5042002,
      },
      types: {
        TestMessage: [{ name: 'content', type: 'string' }],
      },
      primaryType: 'TestMessage' as const,
      message: {
        content: 'hello enclave',
      },
    }

    const signature = await account.signTypedData(typedData)
    expect(signature).toMatch(/^0x[0-9a-fA-F]{130}$/)
  })
})

