// src/hooks/useX402Config.ts
// Reads the public, secret-free x402 configuration served by GET /api/x402/config via TanStack Query.
// A failed read is surfaced as `error` and never guessed: the readiness panel shows "unknown".

import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { X402RuntimeConfig } from '../utils/x402Readiness'
import { X402_RUNTIME_CONFIG_QUERY_KEY } from '../config/queryKeys'

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

export async function fetchX402RuntimeConfig(signal?: AbortSignal): Promise<X402RuntimeConfig> {
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
  return parsed
}

export function useX402Config(enabled = true) {
  const { data, isLoading, isFetching, error, refetch } = useQuery<X402RuntimeConfig, Error>({
    queryKey: X402_RUNTIME_CONFIG_QUERY_KEY,
    queryFn: ({ signal }) => fetchX402RuntimeConfig(signal),
    enabled,
    staleTime: 60_000,
    gcTime: 1000 * 60 * 5,
    retry: 1,
  })

  const refresh = useCallback(async () => {
    await refetch()
  }, [refetch])

  return {
    config: data ?? null,
    loading: isLoading || (isFetching && !data),
    error: error ? error.message || 'Settlement configuration unavailable.' : null,
    refresh,
  }
}
