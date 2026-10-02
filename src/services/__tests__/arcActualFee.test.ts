// src/services/__tests__/arcActualFee.test.ts
// Pins the ACTUAL paid-fee contract end to end:
// 1. resolveArcActualFeeUsdc → gasUsed × effectiveGasPrice from the receipt (ArcScan's number),
//    including the Base + Priority split ArcScan displays.
// 2. getObservedArcPriorityFee → the eth_feeHistory probe that "listens to the chain".
// 3. getDynamicArcGasOptions → display estimate priced at the EXPECTED charge
//    (base fee + observed tip), not the maxFee ceiling.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseGwei } from 'viem'
import {
  resolveArcActualFeeUsdc,
  getObservedArcPriorityFee,
  getDynamicArcGasOptions,
  ARC_GAS_LIMITS,
} from '../arcGasService'

const TX = '0x4a1f2d76dbe6274bd2afd9215d5e4053cc2d830297001ffa79be6eca2a58b26a'

/** Mutable transport shared with the hoisted ../rpc mock. */
const rpcState: { transport: any } = { transport: null }

vi.mock('../rpc', () => ({
  getArcPublicClient: () => (rpcState.transport ? ({ transport: rpcState.transport } as any) : null),
}))

beforeEach(() => {
  rpcState.transport = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Client whose waitForTransactionReceipt always throws (forces the direct-read fallback). */
function clientWithFailingWait(receipt: any, block: any = null) {
  return {
    waitForTransactionReceipt: async () => {
      throw new Error('not mined within window')
    },
    getTransactionReceipt: async () => receipt,
    getBlock: async () => block,
  }
}

describe('resolveArcActualFeeUsdc', () => {
  it('returns nulls for empty or non-hex hashes without touching the client', async () => {
    let clientTouched = false
    const client = {
      waitForTransactionReceipt: async () => {
        clientTouched = true
        return {}
      },
    }

    const empty = {
      feeUsdc: null,
      feeUsdcExact: null,
      baseFeeUsdcExact: null,
      priorityFeeUsdcExact: null,
      gasUsed: null,
      effectiveGasPriceGwei: null,
      blockNumber: null,
      txHash: '',
    }
    expect(await resolveArcActualFeeUsdc('', client)).toEqual(empty)
    expect(await resolveArcActualFeeUsdc(null, client)).toEqual(empty)
    expect(await resolveArcActualFeeUsdc('not-a-hash', client)).toEqual(empty)
    expect(clientTouched).toBe(false)
  })

  it('extracts the exact paid fee from the receipt — the real ArcScan tx numbers', async () => {
    // Real Arc Testnet tx: gasUsed 21,000 × effectiveGasPrice 37,755,525,000 wei
    // → fee.value 792,866,025,000,000 wei = 0.000792866025 USDC (matches explorer.testnet.arc.io).
    const client = clientWithFailingWait({
      gasUsed: 21000n,
      effectiveGasPrice: 37755525000n,
    })

    const result = await resolveArcActualFeeUsdc(TX, client)
    expect(result.txHash).toBe(TX)
    expect(result.feeUsdcExact).toBe('0.000792866025')
    expect(result.feeUsdc).toBeCloseTo(0.000792866025, 15)
  })

  it('splits the fee into Base + Priority exactly like ArcScan', async () => {
    // Real tx mined in a 20 Gwei base-fee block:
    // Base 21,000 × 20 Gwei = 0.00042 · Priority = total − base = 0.000372866025.
    const client = clientWithFailingWait(
      { gasUsed: 21000n, effectiveGasPrice: 37755525000n, blockNumber: 64_736_534n },
      { baseFeePerGas: 20_000_000_000n }
    )

    const result = await resolveArcActualFeeUsdc(TX, client)
    expect(result.feeUsdcExact).toBe('0.000792866025')
    expect(result.baseFeeUsdcExact).toBe('0.00042')
    expect(result.priorityFeeUsdcExact).toBe('0.000372866025')
    expect(result.gasUsed).toBe(21000)
    expect(result.effectiveGasPriceGwei).toBeCloseTo(37.755525, 9)
    expect(result.blockNumber).toBe(64_736_534)
  })

  it('prefers effectiveGasPrice over the legacy gasPrice field', async () => {
    const client = clientWithFailingWait({
      gasUsed: 21000n,
      effectiveGasPrice: 37755525000n,
      gasPrice: 999999999n, // must be ignored
    })

    const result = await resolveArcActualFeeUsdc(TX, client)
    expect(result.feeUsdcExact).toBe('0.000792866025')
  })

  it('falls back to gasPrice when effectiveGasPrice is absent', async () => {
    const client = clientWithFailingWait({
      gasUsed: 21000n,
      gasPrice: 20000000000n,
    })

    const result = await resolveArcActualFeeUsdc(TX, client)
    expect(result.feeUsdcExact).toBe('0.00042')
  })

  it('waits for the receipt via waitForTransactionReceipt when available', async () => {
    let waitCalled = false
    const client = {
      waitForTransactionReceipt: async () => {
        waitCalled = true
        return { gasUsed: 21000n, effectiveGasPrice: 37755525000n }
      },
    }

    const result = await resolveArcActualFeeUsdc(TX, client)
    expect(waitCalled).toBe(true)
    expect(result.feeUsdcExact).toBe('0.000792866025')
  })

  it('returns nulls when the receipt is missing or lacks gas fields', async () => {
    const noReceipt = await resolveArcActualFeeUsdc(TX, clientWithFailingWait(null))
    expect(noReceipt.feeUsdc).toBeNull()

    const missingPrice = await resolveArcActualFeeUsdc(TX, clientWithFailingWait({ gasUsed: 21000n }))
    expect(missingPrice.feeUsdc).toBeNull()

    const missingUsed = await resolveArcActualFeeUsdc(TX, clientWithFailingWait({ effectiveGasPrice: 1n }))
    expect(missingUsed.feeUsdc).toBeNull()
  })

  it('never throws — client failures resolve to nulls', async () => {
    const client = {
      waitForTransactionReceipt: async () => {
        throw new Error('rpc down')
      },
      getTransactionReceipt: async () => {
        throw new Error('rpc down')
      },
    }
    const result = await resolveArcActualFeeUsdc(TX, client)
    expect(result.feeUsdc).toBeNull()
  })
})

describe('getObservedArcPriorityFee (eth_feeHistory chain listener)', () => {
  it('returns the median of the actually-paid tips from recent blocks', async () => {
    // Shape mirrors a live eth_feeHistory reply (single reward percentile per block).
    rpcState.transport = {
      request: async ({ method, params }: any) => {
        expect(method).toBe('eth_feeHistory')
        expect(params[0]).toBe('0xa')
        expect(params[2]).toEqual([25]) // fast tier probes the 25th percentile
        return {
          reward: [
            ['0x12a05f200'], // 5 Gwei
            ['0x2e90edd00'], // 12.5 Gwei
            ['0x46c7cfe00'], // 19 Gwei
            ['0x46c7cfe00'],
            ['0x46c7cfe00'],
            ['0x46c7cfe00'],
            ['0x7a1a15dad'], // 32.5 Gwei
            ['0x8f6c76100'], // 38.5 Gwei
            ['0xcce416600'], // 57.5 Gwei
            ['0x904979a6e'], // 38.75 Gwei
          ],
        }
      },
    }

    const tip = await getObservedArcPriorityFee(10, 25)
    expect(tip).toBe(19_000_000_000n)
  })

  it('returns null when the transport, history or rewards are unavailable', async () => {
    expect(await getObservedArcPriorityFee()).toBeNull() // no transport

    rpcState.transport = { request: async () => ({}) }
    expect(await getObservedArcPriorityFee()).toBeNull()

    rpcState.transport = {
      request: async () => {
        throw new Error('method not supported')
      },
    }
    expect(await getObservedArcPriorityFee()).toBeNull()
  })
})

describe('getDynamicArcGasOptions — honest expected-cost pricing', () => {
  it('prices the display estimate at base + OBSERVED tip, not the maxFee ceiling', async () => {
    // Live-measured Arc Testnet conditions: 20 Gwei base fee, ~17.5 Gwei sequencer tip.
    rpcState.transport = {
      request: async () => ({
        reward: [
          ['0x12a05f200'],
          ['0x2e90edd00'],
          ['0x46c7cfe00'],
          ['0x46c7cfe00'],
          ['0x46c7cfe00'],
          ['0x46c7cfe00'],
          ['0x7a1a15dad'],
          ['0x8f6c76100'],
          ['0xcce416600'],
          ['0x904979a6e'],
        ],
      }),
    }
    const client = {
      getBlock: async () => ({ baseFeePerGas: 20_000_000_000n, extraData: '0x' }),
    }

    const gas = await getDynamicArcGasOptions(client, 'fast', ARC_GAS_LIMITS.nativeTransfer)

    // Expected charge: (20 + 19) Gwei median probe → 21,000 × 39 Gwei = 0.000819 USDC.
    // (Median of the fixture is 19 Gwei.) The old code quoted the 20×1.3+2=28 Gwei ceiling
    // → 0.00059, which is what made the UI disagree with ArcScan.
    expect(gas.observedPriorityFee).toBe(19_000_000_000n)
    expect(gas.expectedFeePerGas).toBe(39_000_000_000n)
    expect(gas.estimatedCostUsdc).toBe('0.00082')

    // The split mirrors ArcScan's Base fee / Priority fee rows.
    expect(gas.estimatedBaseFeeUsdc).toBe('0.00042')
    expect(gas.estimatedPriorityUsdc).toBe('0.00040')

    // maxFeePerGas remains a signing-only headroom ABOVE the expected charge.
    expect(gas.maxFeePerGas).toBe(parseGwei('20') * 130n / 100n + 19_000_000_000n)
    expect(gas.maxFeePerGas > gas.expectedFeePerGas).toBe(true)
  })

  it('falls back to the tier tip constant when the chain cannot be listened to', async () => {
    const client = {
      getBlock: async () => ({ baseFeePerGas: 20_000_000_000n, extraData: '0x' }),
    }

    const gas = await getDynamicArcGasOptions(client, 'fast', ARC_GAS_LIMITS.nativeTransfer)

    expect(gas.observedPriorityFee).toBeNull()
    expect(gas.maxPriorityFeePerGas).toBe(parseGwei('2')) // legacy fast-tier fallback
    expect(gas.expectedFeePerGas).toBe(22_000_000_000n)
    expect(gas.estimatedCostUsdc).toBe('0.00046')
  })
})
