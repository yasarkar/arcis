// src/hooks/useContinuousYieldStream.ts
//
// High-Frequency Real-Time Continuous Yield Streamer for Arcis.
// Simulates sub-second per-millisecond on-chain yield accrual on Arc Testnet,
// delivering a live ticking stream of earned USDC rewards.

import { useState, useEffect, useRef } from 'react'

export function useContinuousYieldStream(
  principalUsd: number,
  apyPercent: number,
  initialBaseYieldUsd: number = 0,
  tickIntervalMs: number = 60
) {
  const [accumulatedYield, setAccumulatedYield] = useState<number>(initialBaseYieldUsd)
  const startTimeRef = useRef<number>(Date.now())
  const initialBaseRef = useRef<number>(initialBaseYieldUsd)

  useEffect(() => {
    initialBaseRef.current = initialBaseYieldUsd
    startTimeRef.current = Date.now()
    setAccumulatedYield(initialBaseYieldUsd)
  }, [initialBaseYieldUsd, principalUsd, apyPercent])

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
    formattedYield: accumulatedYield.toFixed(6),
    formattedShort: accumulatedYield.toFixed(4),
    formattedHighPrecision: accumulatedYield.toFixed(7),
  }
}
