// src/hooks/useX402Config.ts
// Reads the public, secret-free x402 configuration served by GET /api/x402/config.
// A failed read is surfaced as `error` and never guessed: the readiness panel shows "unknown".

import { useCallback, useEffect, useState } from 'react'
import type { X402RuntimeConfig } from '../utils/x402Readiness'

function parseRuntimeConfig(value: unknown): X402RuntimeConfig | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, any>
  if (body.success !== true) return null

  const payoutIssues = Array.isArray(body.payoutIssues)
    ? body.payoutIssues
        .filter((issue: any) => issue && typeof issue.serviceId === 'string' && typeof issue.address === 'string')
        .map((issue: any) => ({
          serviceId: String(issue.serviceId),
          address: String(issue.address),
          reason: typeof issue.reason === 'string' ? issue.reason : 'unusable payout address',
        }))
    : []

  return {
    settlementEnabled: body.settlementEnabled === true,
    payoutsReady: body.payoutsReady === true,
    payoutsConfirmed: body.payoutsConfirmed === true,
    payoutIssues,
    storage: {
      driver: typeof body.storage?.driver === 'string' ? body.storage.driver : 'unknown',
      shared: body.storage?.shared === true,
    },
    reconciliation: {
      configured: body.reconciliation?.configured === true,
      enabled: body.reconciliation?.enabled === true,
      intervalMinutes: Number(body.reconciliation?.intervalMinutes) || 5,
    },
    chainId: Number(body.chainId) || 0,
  }
}

export function useX402Config(enabled = true) {
  const [config, setConfig] = useState<X402RuntimeConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/x402/config', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal,
      })
      const body = await response.json().catch(() => null)
      const parsed = response.ok ? parseRuntimeConfig(body) : null
      if (!parsed) {
        throw new Error(
          (body && typeof body.error === 'string' && body.error) ||
          `Settlement configuration unavailable (HTTP ${response.status}).`
        )
      }
      setConfig(parsed)
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      setError(err instanceof Error ? err.message : 'Settlement configuration unavailable.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [enabled, load])

  return {
    config,
    loading,
    error,
    refresh: () => load(),
  }
}
