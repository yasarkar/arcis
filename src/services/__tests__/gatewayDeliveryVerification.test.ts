import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { encodeEventTopics, encodeAbiParameters, zeroAddress, parseUnits } from 'viem'
import {
  verifyDestinationUsdcMint,
  gatewayTransferFeeCeiling,
  resolveDestinationUsdcMintAmount,
  gatewayDeliveredUsdc,
} from '../gatewayService'
import * as rpcModule from '../rpc'
import { USDC_ADDRESSES } from '../../config/gatewayConfig'

// Destination-delivery proof must accept a delivery that is a hair short (slip
// margin) without ever accepting one short by more than the documented 0.005%
// ceiling. Circle charges its Gateway cost from the unified Gateway balance and
// mints the full principal, so an exact delivery is the expected case.

const chainKey = 'Base_Sepolia'
const usdcAddress = USDC_ADDRESSES[chainKey]
const recipient = '0x1111111111111111111111111111111111111111'
const txHash = `0x${'b'.repeat(64)}`

const TRANSFER_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { type: 'address', indexed: true, name: 'from' },
      { type: 'address', indexed: true, name: 'to' },
      { type: 'uint256', indexed: false, name: 'value' },
    ],
  },
] as const

function mockMintReceipt(value: bigint) {
  const topics = encodeEventTopics({
    abi: TRANSFER_ABI,
    eventName: 'Transfer',
    args: { from: zeroAddress, to: recipient as `0x${string}` },
  })
  const data = encodeAbiParameters([{ type: 'uint256' }], [value])
  const log = { address: usdcAddress, topics, data }
  vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status: 'success',
      transactionHash: txHash,
      logs: [log],
    }),
  } as any)
}

describe('gatewayTransferFeeCeiling', () => {
  it('returns the 0.005% fee ceiling in 6-decimal subunits', () => {
    expect(gatewayTransferFeeCeiling('100')).toBe(5_000n) // 0.005 USDC
    expect(gatewayTransferFeeCeiling('0.1')).toBe(5n) // 0.000005 USDC
  })

  it('rounds up so sub-unit amounts still get a non-zero floor', () => {
    // 0.01 * 0.00005 = 0.0000005 → 1 subunit (floor would be 0 and would
    // silently disable the tolerance)
    expect(gatewayTransferFeeCeiling('0.01')).toBe(1n)
  })

  it('returns 0 for invalid or non-positive amounts', () => {
    expect(gatewayTransferFeeCeiling('abc')).toBe(0n)
    expect(gatewayTransferFeeCeiling('0')).toBe(0n)
  })
})

describe('verifyDestinationUsdcMint', () => {
  const amount = '25'
  const expected = parseUnits(amount, 6)
  const ceiling = gatewayTransferFeeCeiling(amount)

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts an exact full-amount delivery with the default strict check', async () => {
    mockMintReceipt(expected)
    await expect(
      verifyDestinationUsdcMint(chainKey, txHash, recipient, amount)
    ).resolves.toBe(true)
  })

  it('accepts a slightly short delivery only within the fee ceiling', async () => {
    mockMintReceipt(expected - ceiling)

    // Strict check (previous behavior) would misreport this as a failure...
    await expect(
      verifyDestinationUsdcMint(chainKey, txHash, recipient, amount)
    ).resolves.toBe(false)

    // ...while the fee-aware check proves delivery happened.
    await expect(
      verifyDestinationUsdcMint(chainKey, txHash, recipient, amount, ceiling)
    ).resolves.toBe(true)
  })

  it('rejects a delivery short by more than the fee ceiling', async () => {
    mockMintReceipt(expected - ceiling - 1n)
    await expect(
      verifyDestinationUsdcMint(chainKey, txHash, recipient, amount, ceiling)
    ).resolves.toBe(false)
  })

  it('rejects a mint delivered to a different recipient', async () => {
    mockMintReceipt(expected)
    await expect(
      verifyDestinationUsdcMint(chainKey, txHash, '0x2222222222222222222222222222222222222222', amount, ceiling)
    ).resolves.toBe(false)
  })
})

// The mint receipt proves what the recipient RECEIVED: the full principal.
// Circle charges its own Gateway cost from the unified Gateway balance at burn
// time instead, and Arcis charges no platform fee on that route, so the Gateway
// receipt reports delivery as a settled value and no Gateway fee at all.
describe('resolveDestinationUsdcMintAmount', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the exact amount minted to the recipient', async () => {
    mockMintReceipt(parseUnits('24.99875', 6))
    await expect(resolveDestinationUsdcMintAmount(chainKey, txHash, recipient)).resolves.toBe(
      parseUnits('24.99875', 6)
    )
  })

  it('returns null instead of guessing when nothing was minted to the recipient', async () => {
    mockMintReceipt(parseUnits('25', 6))
    await expect(
      resolveDestinationUsdcMintAmount(chainKey, txHash, '0x2222222222222222222222222222222222222222')
    ).resolves.toBeNull()
  })

  it('returns null for malformed input', async () => {
    await expect(resolveDestinationUsdcMintAmount(chainKey, '0x123', recipient)).resolves.toBeNull()
    await expect(resolveDestinationUsdcMintAmount(chainKey, txHash, '0x123')).resolves.toBeNull()
  })
})

describe('gatewayDeliveredUsdc', () => {
  it('formats the proven minted amount', () => {
    expect(gatewayDeliveredUsdc(parseUnits('25', 6))).toBe('25')
    expect(gatewayDeliveredUsdc(parseUnits('24.99875', 6))).toBe('24.99875')
  })

  it('returns null for an impossible amount', () => {
    expect(gatewayDeliveredUsdc(-1n)).toBeNull()
  })
})


