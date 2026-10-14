// src/services/__tests__/bridgeDeliveryPoll.test.ts
//
// Regression guard for the background CCTP/Gateway destination polls.
//
// Before the registry existed, a burn was tracked by two independent
// `(async () => { … })()` loops (the happy path and the failure-recovery path)
// and neither could be stopped: closing the modal left up to 300 × 3s of work
// running against a receipt nobody was looking at. The contract here is:
//
//   1. One poll per delivery — a second `track` joins instead of duplicating.
//   2. Cancellable — the runner sees `signal.aborted` and the key is freed.
//   3. A joiner can never cancel the owner's poll.
//   4. A failing runner is contained and still releases its key.

import { describe, it, expect, afterEach } from 'vitest'
import {
  trackBridgeDelivery,
  isBridgeDeliveryTracked,
  cancelAllBridgeDeliveries,
  resetBridgeDeliveryTracking,
} from '../bridgeDeliveryPoll'

/** Lets the tracked runner's promise chain advance a few macrotasks. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('bridge delivery poll registry', () => {
  afterEach(() => {
    resetBridgeDeliveryTracking()
  })

  it('runs one poll per delivery and makes an identical delivery join it', async () => {
    const starts: string[] = []

    const owner = trackBridgeDelivery('cctp:0xabc', async () => {
      starts.push('owner')
      await flush()
    })
    const joiner = trackBridgeDelivery('cctp:0xabc', async () => {
      starts.push('joiner')
    })

    expect(owner.alreadyTracked).toBe(false)
    expect(joiner.alreadyTracked).toBe(true)
    expect(isBridgeDeliveryTracked('cctp:0xabc')).toBe(true)

    await flush()
    expect(starts).toEqual(['owner'])
  })

  it('aborts a cancelled delivery and frees its key for a later poll', async () => {
    let signalSeen: AbortSignal | null = null

    const handle = trackBridgeDelivery('cctp:0xdef', async (signal) => {
      signalSeen = signal
      await flush()
    })

    handle.cancel()
    await flush()

    expect((signalSeen as AbortSignal | null)?.aborted).toBe(true)
    expect(isBridgeDeliveryTracked('cctp:0xdef')).toBe(false)

    // The key is released, so the same burn can be tracked again (e.g. the user
    // reopens the modal while the mint is still in flight).
    const restarted = trackBridgeDelivery('cctp:0xdef', async () => {})
    expect(restarted.alreadyTracked).toBe(false)
    restarted.cancel()
  })

  it('treats a joiner cancel as a no-op so it cannot stop the owner poll', async () => {
    let ownerSignal: AbortSignal | null = null

    const owner = trackBridgeDelivery('gateway:transfer-1', async (signal) => {
      ownerSignal = signal
      await flush()
      await flush()
    })
    const joiner = trackBridgeDelivery('gateway:transfer-1', async () => {})

    joiner.cancel()
    await flush()

    expect((ownerSignal as AbortSignal | null)?.aborted).toBe(false)
    expect(isBridgeDeliveryTracked('gateway:transfer-1')).toBe(true)

    owner.cancel()
    await flush()
    expect(isBridgeDeliveryTracked('gateway:transfer-1')).toBe(false)
  })

  it('contains a failing runner without throwing or leaking the key', async () => {
    expect(() =>
      trackBridgeDelivery('cctp:0xfailed', async () => {
        throw new Error('runner failed')
      })
    ).not.toThrow()

    await flush()
    expect(isBridgeDeliveryTracked('cctp:0xfailed')).toBe(false)
  })

  it('aborts every tracked delivery on cancelAll (wallet disconnect)', async () => {
    const signals: AbortSignal[] = []

    trackBridgeDelivery('cctp:0x1', async (signal) => {
      signals.push(signal)
      await flush()
    })
    trackBridgeDelivery('gateway:transfer-2', async (signal) => {
      signals.push(signal)
      await flush()
    })

    cancelAllBridgeDeliveries()
    await flush()

    expect(signals).toHaveLength(2)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(isBridgeDeliveryTracked('cctp:0x1')).toBe(false)
    expect(isBridgeDeliveryTracked('gateway:transfer-2')).toBe(false)
  })
})
