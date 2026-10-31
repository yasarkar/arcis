import { describe, expect, it, vi } from 'vitest'
import { BatchEvmScheme } from '@circle-fin/x402-batching/client'
import { hashTypedData, recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  CIRCLE_BATCHING_METADATA,
  EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
  GATEWAY_BATCHED_DOMAIN,
  GATEWAY_CONTRACTS,
} from '../../../config/x402/schemes'
import {
  createUcwX402Signer,
  resolveX402Payer,
  UCW_X402_SIGNING_BLOCKCHAIN,
  UCW_X402_SIGNING_MEMO,
} from '../ucwPaymentSigner'

const TYPED_DATA = {
  domain: { name: 'GatewayWalletBatched', version: '1', chainId: 5042002, verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' },
  types: { TransferWithAuthorization: [{ name: 'from', type: 'address' }] },
  primaryType: 'TransferWithAuthorization',
  message: { from: '0x1111111111111111111111111111111111111111' },
}

const SIGNATURE = `0x${'ab'.repeat(65)}`

describe('createUcwX402Signer', () => {
  it('runs the Circle challenge on Arc Testnet and returns the 65-byte signature', async () => {
    const challenge = vi.fn(async () => ({ success: true, signature: SIGNATURE }))
    const signer = createUcwX402Signer(challenge)

    await expect(signer(TYPED_DATA)).resolves.toBe(SIGNATURE)
    expect(challenge).toHaveBeenCalledTimes(1)
    expect(challenge).toHaveBeenCalledWith({
      data: {
        ...TYPED_DATA,
        // go-ethereum's encoder rejects a domain with more fields than the declared type:
        // "there is extra data provided in the message (0 < 4)".
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
          ],
          ...TYPED_DATA.types,
        },
      },
      memo: UCW_X402_SIGNING_MEMO,
      blockchain: UCW_X402_SIGNING_BLOCKCHAIN,
    })
    expect(UCW_X402_SIGNING_BLOCKCHAIN).toBe('ARC-TESTNET')
  })

  it('fails closed when Circle reports an error or no signature', async () => {
    await expect(
      createUcwX402Signer(async () => ({ success: false, error: 'User rejected the request.' }))(TYPED_DATA)
    ).rejects.toThrow('User rejected the request.')

    await expect(
      createUcwX402Signer(async () => ({ success: true }))(TYPED_DATA)
    ).rejects.toThrow(/did not return a payment signature/i)
  })

  it('rejects a signature that is not a 65-byte ECDSA value', async () => {
    await expect(
      createUcwX402Signer(async () => ({ success: true, signature: '0x1234' }))(TYPED_DATA)
    ).rejects.toThrow(/not a 65-byte EIP-712/i)
  })

  it('serializes uint256 bigints as decimal strings for the Circle challenge', async () => {
    const challenge = vi.fn(async (_params: any) => ({ success: true, signature: SIGNATURE }))

    await createUcwX402Signer(challenge)({
      ...TYPED_DATA,
      message: { from: TYPED_DATA.message.from, value: 5000n, validAfter: 0n, validBefore: 1790000000n },
    })

    const sent = challenge.mock.calls[0][0]
    expect(sent.data.message).toEqual({
      from: TYPED_DATA.message.from,
      value: '5000',
      validAfter: '0',
      validBefore: '1790000000',
    })
    expect(() => JSON.stringify(sent.data)).not.toThrow()
  })

  it('satisfies the real BatchEvmScheme signer contract', async () => {
    const EOA = '0x1111111111111111111111111111111111111111'
    const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9'
    const challenge = vi.fn(async (_params: any) => ({ success: true, signature: SIGNATURE }))
    const scheme = new BatchEvmScheme({ address: EOA, signTypedData: createUcwX402Signer(challenge) })

    const payload = await scheme.createPaymentPayload(2, {
      scheme: 'exact',
      network: 'eip155:5042002',
      asset: '0x3600000000000000000000000000000000000000',
      amount: '5000',
      payTo: '0x2222222222222222222222222222222222222222',
      maxTimeoutSeconds: 604900,
      extra: { name: 'GatewayWalletBatched', version: '1', verifyingContract: GATEWAY_WALLET },
    })

    expect(payload.payload.signature).toBe(SIGNATURE)
    const sent = challenge.mock.calls[0][0].data
    expect(sent.primaryType).toBe('TransferWithAuthorization')
    expect(sent.domain).toMatchObject({ name: 'GatewayWalletBatched', version: '1', chainId: 5042002 })
    expect(sent.domain.verifyingContract.toLowerCase()).toBe(GATEWAY_WALLET.toLowerCase())
    expect(sent.message.value).toBe('5000')
    expect(sent.message.from.toLowerCase()).toBe(EOA)
    // The invariant Circle's validator enforces: the declared domain type must describe
    // every field actually sent in `domain`.
    expect(sent.types.EIP712Domain).toHaveLength(Object.keys(sent.domain).length)
    expect(sent.types.TransferWithAuthorization).toEqual(EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES.TransferWithAuthorization)
  })

  it('declares the domain type without changing the hash or the recoverable signature', async () => {
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
    const challenge = vi.fn(async ({ data }: any) => ({ success: true, signature: await account.signTypedData(data) }))
    const scheme = new BatchEvmScheme({ address: account.address, signTypedData: createUcwX402Signer(challenge) })

    const payload = await scheme.createPaymentPayload(2, {
      scheme: 'exact',
      network: 'eip155:5042002',
      asset: '0x3600000000000000000000000000000000000000',
      amount: '5000',
      payTo: '0x2222222222222222222222222222222222222222',
      maxTimeoutSeconds: CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS,
      extra: {
        name: CIRCLE_BATCHING_METADATA.NAME,
        version: CIRCLE_BATCHING_METADATA.VERSION,
        verifyingContract: GATEWAY_CONTRACTS.testnet.gatewayWallet,
      },
    })

    const sent = challenge.mock.calls[0][0].data
    const withoutDomainType = {
      domain: sent.domain,
      types: { TransferWithAuthorization: sent.types.TransferWithAuthorization },
      primaryType: sent.primaryType,
      message: sent.message,
    }
    expect(hashTypedData(sent)).toBe(hashTypedData(withoutDomainType))

    // Recovery with the exact typed data the settlement route rebuilds.
    const recovered = await recoverTypedDataAddress({
      domain: { ...GATEWAY_BATCHED_DOMAIN, verifyingContract: GATEWAY_CONTRACTS.testnet.gatewayWallet },
      types: EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: sent.message.from,
        to: sent.message.to,
        value: BigInt(sent.message.value),
        validAfter: BigInt(sent.message.validAfter),
        validBefore: BigInt(sent.message.validBefore),
        nonce: sent.message.nonce,
      },
      signature: payload.payload.signature,
    })
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
  })
})

describe('resolveX402Payer', () => {
  const challenge = async () => ({ success: true, signature: SIGNATURE })

  it('treats an injected EVM wallet as the external EOA signer', () => {
    expect(resolveX402Payer('evm', challenge)).toEqual({ kind: 'external_eoa' })
  })

  it('routes a Circle Wallet through its challenge signer', () => {
    const payer = resolveX402Payer('ucw', challenge)
    expect(payer?.kind).toBe('ucw_eoa')
    expect(typeof payer?.signer).toBe('function')
  })

  it('refuses passkey wallets and a UCW session without a challenge signer', () => {
    expect(resolveX402Payer('passkey', challenge)).toBeNull()
    expect(resolveX402Payer('ucw')).toBeNull()
    expect(resolveX402Payer(null)).toBeNull()
  })
})
