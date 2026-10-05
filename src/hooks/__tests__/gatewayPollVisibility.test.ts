// src/hooks/__tests__/gatewayPollVisibility.test.ts
// Contract the Gateway balance hook relies on: a hidden tab stops the 10s poll and the poll
// resumes automatically once the tab is visible again.
//
// This guards against "optimizing" the hook with `refetchInterval: () => document.hidden ?
// false : interval`: returning `false` clears the timer without recreating it (the app disables
// refetchOnWindowFocus globally), so polling would never resume.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver, environmentManager } from '@tanstack/query-core'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Gateway poll visibility contract', () => {
  it('pauses while the tab is hidden and resumes when it becomes visible', async () => {
    vi.useFakeTimers()
    // Query core treats a runtime without `window` as a server and disables intervals;
    // pretend we are in a browser so the 10s poll is scheduled.
    environmentManager.setIsServer(() => false)

    const doc = { hidden: true, visibilityState: 'hidden' as DocumentVisibilityState }
    vi.stubGlobal('document', doc)

    const queryClient = new QueryClient()
    let calls = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: ['gatewayBalanceVisibilityProbe'],
      queryFn: async () => {
        calls += 1
        return calls
      },
      staleTime: 5_000,
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
    })
    const unsubscribe = observer.subscribe(() => {})

    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls).toBe(1) // initial fetch

    await vi.advanceTimersByTimeAsync(35_000)
    expect(calls).toBe(1) // hidden tab: interval ticks are skipped

    doc.hidden = false
    doc.visibilityState = 'visible'
    await vi.advanceTimersByTimeAsync(11_000)
    expect(calls).toBe(2) // visible again: polling resumed

    unsubscribe()
  })
})
