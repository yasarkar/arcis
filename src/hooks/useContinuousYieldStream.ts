// src/hooks/useContinuousYieldStream.ts
//
// High-Frequency Real-Time Continuous Yield Streamer for Arcis (Zero LocalStorage).
// Computes real continuous yield accrual on Arc Testnet purely in memory,
// delivering a live, uninterrupted ticking stream of earned USDC rewards.

import { useState, useEffect, useRef, useCallback } from 'react'

export function useContinuousYieldStream(
  principalUsd: number,
  apyPercent: number,
  initialBaseYieldUsd: number = 0,
  tickIntervalMs: number = 1000,
  _storageKey?: string
) {
  const [accumulatedYield, setAccumulatedYield] = useState<number>(initialBaseYieldUsd)
  const startTimeRef = useRef<number>(Date.now())
  const initialBaseRef = useRef<number>(initialBaseYieldUsd)

  // Explicit reset method callable upon successful harvest / claim
  const resetStream = useCallback((newBaseYield: number = 0) => {
    initialBaseRef.current = newBaseYield
    startTimeRef.current = Date.now()
    setAccumulatedYield(newBaseYield)
  }, [])

  // Sync state when on-chain base yield, principal, or APY changes
  useEffect(() => {
    initialBaseRef.current = initialBaseYieldUsd
    startTimeRef.current = Date.now()
    setAccumulatedYield(initialBaseYieldUsd)
  }, [initialBaseYieldUsd, principalUsd, apyPercent])

  // Live real-time ticking (throttled to 1s intervals to eliminate CPU thrashing)
  useEffect(() => {
    if (principalUsd <= 0 || apyPercent <= 0) {
      setAccumulatedYield(initialBaseYieldUsd > 0 ? initialBaseYieldUsd : 0)
      return
    }

    const annualYield = principalUsd * (apyPercent / 100)
    const yieldPerMs = annualYield / (365 * 24 * 3600 * 1000)

    const timer = setInterval(() => {
      const elapsedMs = Date.now() - startTimeRef.current
      const currentYield = initialBaseRef.current + yieldPerMs * elapsedMs
      setAccumulatedYield(currentYield)
    }, tickIntervalMs)

    return () => clearInterval(timer)
  }, [principalUsd, apyPercent, tickIntervalMs, initialBaseYieldUsd])

  const yieldPerSecond = (principalUsd * (apyPercent / 100)) / (365 * 24 * 3600)
  const yieldPerDay = yieldPerSecond * 86400

  return {
    accumulatedYield,
    yieldPerSecond,
    yieldPerDay,
    resetStream,
    formattedYield: accumulatedYield.toFixed(4),
    formattedShort: accumulatedYield.toFixed(2),
    formattedHighPrecision: accumulatedYield.toFixed(6),
    formattedApprox: `≈ +${accumulatedYield.toFixed(4)}`,
  }
}

