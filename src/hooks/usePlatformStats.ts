// src/hooks/usePlatformStats.ts
// Reads the protocol-wide paid-call counter that the AI Services hero card shows.
//
// The previous figure was this browser's own call tally, which reads as a protocol metric while
// being per-device. This hook keeps the shared server value authoritative and only applies a local
// optimistic increment for a call the user just paid for.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlatformStatsSnapshot } from '../types/x402'
import {
  fetchPlatformStats,
  platformStatsPollIntervalMs,
  readCachedPlatformStats,
  subscribeToPlatformCalls,
} from '../services/platformStatsClient'

export function usePlatformStats() {
  const [snapshot, setSnapshot] = useState<PlatformStatsSnapshot | null>(() => readCachedPlatformStats())
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    const next = await fetchPlatformStats()
    if (next) setSnapshot(next)
    setIsLoading(false)
  }, [])

  const refresh = useCallback(() => {
    setIsLoading(true)
    return load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const run = async () => {
      const next = await fetchPlatformStats()
      if (cancelled) return
      if (next) setSnapshot(next)
      setIsLoading(false)
    }

    const startPolling = () => {
      if (pollTimer) return
      pollTimer = setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') void run()
      }, platformStatsPollIntervalMs())
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

    const unsubscribe = subscribeToPlatformCalls(() => {
      setSnapshot((current) =>
        current && current.source !== 'unavailable'
          ? { ...current, acceptedCalls: current.acceptedCalls + 1 }
          : current
      )
      // The server writes its own increment inside the same request; a short delayed read replaces
      // the optimistic value with the ledger value instead of stacking on top of it.
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null
        void run()
      }, 1500)
    })

    return () => {
      cancelled = true
      stopPolling()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibility)
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current)
        settleTimerRef.current = null
      }
      unsubscribe()
    }
  }, [])

  return { snapshot, isLoading, refresh }
}
