// src/services/bridgeDeliveryPoll.ts
//
// Lifecycle registry for the bridge's *background* destination-delivery polls.
//
// A CCTP mint can take many minutes (a Standard transfer to Ethereum Sepolia is
// ~13 minutes), so the receipt keeps polling long after the click. Two things
// must be true for that work:
//
//   1. One poll per delivery. The same burn is tracked from the happy path AND
//      from the failure-recovery path; keying by the delivery makes the second
//      caller join rather than start a duplicate.
//   2. Cancellable. Closing the modal (or unmounting it) must stop the work
//      instead of leaving a 15-minute poll running against a receipt nobody is
//      looking at.
//
// The runner owns what it does with the delivery (receipt state, history,
// broadcast); this module owns *when* it runs and *how long*.

const activePolls = new Map<string, AbortController>()

export interface BridgeDeliveryHandle {
  /** Stops this poll if it is still the one registered under the key. */
  cancel: () => void
  /** True when an identical delivery was already being tracked. */
  alreadyTracked: boolean
}

/**
 * Registers a background delivery poll under `key`.
 *
 * @param key    Stable identity of the delivery (e.g. `cctp:<burnTxHash>`).
 * @param runner Receives an AbortSignal it must honour for its whole loop.
 */
export function trackBridgeDelivery(
  key: string,
  runner: (signal: AbortSignal) => Promise<void>
): BridgeDeliveryHandle {
  if (activePolls.has(key)) {
    return { cancel: () => {}, alreadyTracked: true }
  }

  const controller = new AbortController()
  activePolls.set(key, controller)

  runner(controller.signal)
    .catch(() => {
      // The runner reports its own failures; tracking must never reject.
    })
    .finally(() => {
      if (activePolls.get(key) === controller) activePolls.delete(key)
    })

  return {
    cancel: () => {
      if (activePolls.get(key) !== controller) return
      activePolls.delete(key)
      controller.abort()
    },
    alreadyTracked: false,
  }
}

/** Whether a delivery is currently being tracked. */
export function isBridgeDeliveryTracked(key: string): boolean {
  return activePolls.has(key)
}

/** Aborts every tracked delivery (e.g. a wallet disconnect). */
export function cancelAllBridgeDeliveries(): void {
  for (const controller of activePolls.values()) controller.abort()
  activePolls.clear()
}

/** Test seam. */
export function resetBridgeDeliveryTracking(): void {
  activePolls.clear()
}
