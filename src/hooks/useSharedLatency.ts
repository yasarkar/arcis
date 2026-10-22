// src/hooks/useSharedLatency.ts
// Reads the one latency figure the AI Services hero card shows.
//
// The previous value was this browser's own probe average: every visitor measured their own network
// and the card called it a protocol metric. This hook keeps the server's shared reading
// authoritative and polls it while the tab is visible.

import { useEffect, useState } from 'react'
import type { LatencySnapshot } from '../types/x402'
import {
  fetchLatency,
  latencyPollIntervalMs,
  readCachedLatency,
} from '../services/latencyClient'

export function useSharedLatency() {
  const [snapshot, setSnapshot] = useState<LatencySnapshot | null>(() => readCachedLatency())
  const [isLoading, setIsLoading] = useState<boolean>(true)

  useEffect(() => {
    let cancelled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const run = async () => {
      const next = await fetchLatency()
      if (cancelled) return
      if (next) setSnapshot(next)
      setIsLoading(false)
    }

    const startPolling = () => {
      if (pollTimer) return
      pollTimer = setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') void run()
      }, latencyPollIntervalMs())
    }

    const stopPolling = () => {
      if (!pollTimer) return
      clearInterval(pollTimer)
      pollTimer = null
    }

    const handleVisibility = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'visible') {
        void run()
        startPolling()
      } else {
        stopPolling()
      }
    }

    void run()
    startPolling()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      cancelled = true
      stopPolling()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return { snapshot, isLoading }
}
