import { describe, expect, it } from 'vitest'
import { hashTypedData } from 'viem'
import { prepareCircleTypedData } from '../ucwTypedData'

const EOA = '0x1111111111111111111111111111111111111111'
const PROVIDER = '0x2222222222222222222222222222222222222222'
const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9'
const NONCE = `0x${'ab'.repeat(32)}`

const DOMAIN = {
  name: 'GatewayWalletBatched',
  version: '1',
  chainId: 5042002,
  verifyingContract: GATEWAY_WALLET,
}

const TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
}

/** The shape `BatchEvmScheme` hands to the signer: bigint uint256 fields, no domain type. */
function x402Payload() {
  return {
    domain: DOMAIN,
    types: TRANSFER_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: EOA,
      to: PROVIDER,
      value: 5000n,
      validAfter: 0n,
      validBefore: 1790000000n,
      nonce: NONCE,
    },
  }
}

/** The Gateway burn intent shape, which already declares its domain type. */
function burnIntentPayload() {
  return {
    domain: { name: 'GatewayWallet', version: '1' },
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
      ],
      BurnIntent: [
        { name: 'maxBlockHeight', type: 'uint256' },
        { name: 'maxFee', type: 'uint256' },
        { name: 'spec', type: 'TransferSpec' },
      ],
      TransferSpec: [
        { name: 'version', type: 'uint32' },
        { name: 'value', type: 'uint256' },
        { name: 'salt', type: 'bytes32' },
      ],
    },
    primaryType: 'BurnIntent',
    message: {
      maxBlockHeight: '65324520',
      maxFee: '3850',
      spec: { version: 1, value: '10000000', salt: NONCE },
    },
  }
}

describe('prepareCircleTypedData', () => {
  it('declares the canonical EIP712Domain the payload does not declare', () => {
    const prepared = prepareCircleTypedData(x402Payload())

    expect(prepared.types.EIP712Domain).toEqual([
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ])
    // go-ethereum's check: declared domain fields must cover the provided domain.
    expect(prepared.types.EIP712Domain).toHaveLength(Object.keys(prepared.domain).length)
  })

  it('serializes bigints to decimal strings while keeping the signed hash identical', () => {
    const payload = x402Payload()
    const prepared = prepareCircleTypedData(payload)

    expect(prepared.message).toEqual({
      from: EOA,
      to: PROVIDER,
      value: '5000',
      validAfter: '0',
      validBefore: '1790000000',
      nonce: NONCE,
    })
    expect(() => JSON.stringify(prepared)).not.toThrow()
    // viem derives the domain type from `domain`, so the declaration changes nothing on-chain.
    expect(hashTypedData(prepared as any)).toBe(hashTypedData(payload as any))
  })

  it('leaves an already-prepared Gateway burn intent untouched', () => {
    const payload = burnIntentPayload()
    expect(prepareCircleTypedData(payload)).toEqual(payload)
  })

  it('is idempotent', () => {
    const once = prepareCircleTypedData(x402Payload())
    expect(prepareCircleTypedData(once)).toEqual(once)
  })

  it('reports an undeclared primary type instead of Circle’s cryptic "extra data" error', () => {
    const payload = { ...x402Payload(), types: { SomethingElse: [] }, primaryType: 'TransferWithAuthorization' }
    expect(() => prepareCircleTypedData(payload as any)).toThrow(/missing the declaration for its primary type "TransferWithAuthorization"/)
  })
})
