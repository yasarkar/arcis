import { describe, expect, it, vi } from 'vitest'
import {
  formatUcwSmokeReport,
  inspectSmokeEndpoint,
  inspectUcwSmokeConfig,
  normalizeApiBaseUrl,
  runUcwSmokeNetworkChecks,
} from '../ucw-smoke-preflight.mjs'

const ENDPOINT = 'https://ucw-smoke.example.workers.dev/echo'
const SECRET = 'k'.repeat(40)
const KV_TOKEN = 'opaque-9f3a-value'

const READY_ENV = {
  ENABLE_GATEWAY_SETTLE: 'true',
  X402_PAYOUT_ADDRESSES_CONFIRMED: 'true',
  X402_RECONCILIATION_SECRET: SECRET,
  KV_REST_API_URL: 'https://kv-smoke.upstash.io',
  KV_REST_API_TOKEN: KV_TOKEN,
  CIRCLE_API_KEY: 'TEST_API_KEY:abc123',
  VITE_CIRCLE_APP_ID: 'app-id-1234',
  VITE_CLIENT_KEY: 'client-key-5678',
  X402_UPSTREAM_HOST_ALLOWLIST: 'ucw-smoke.example.workers.dev',
  X402_RECONCILE_INTERVAL_MINUTES: '1',
}

const RUNNING_CONFIG = {
  success: true,
  settlementEnabled: true,
  payoutsConfirmed: true,
  payoutsReady: true,
  payoutIssues: [],
  storage: { driver: 'redis', shared: true },
  reconciliation: { configured: true, enabled: true, intervalMinutes: 1 },
}

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

function statuses(checks) {
  return checks.map(({ status }) => status)
}

describe('inspectUcwSmokeConfig', () => {
  it('accepts a complete setup with an allowlisted echo endpoint', () => {
    const result = inspectUcwSmokeConfig(READY_ENV, { endpoint: ENDPOINT })
    expect(result.ready).toBe(true)
    expect(result.checks.find(({ name }) => name === 'Echo endpoint')?.status).toBe('PASS')
    expect(result.checks.find(({ name }) => name === 'Reconciler cadence')?.status).toBe('PASS')
  })

  it('blocks a disabled settlement gate and unconfirmed payouts', () => {
    const result = inspectUcwSmokeConfig({
      ...READY_ENV,
      ENABLE_GATEWAY_SETTLE: 'false',
      X402_PAYOUT_ADDRESSES_CONFIRMED: 'false',
    })
    expect(result.ready).toBe(false)
    expect(result.checks.find(({ name }) => name === 'Gateway settlement enabled')?.status).toBe('BLOCKED')
    expect(result.checks.find(({ name }) => name === 'Payout addresses confirmed')?.status).toBe('BLOCKED')
  })

  it('blocks a weak secret, missing storage and missing Circle credentials', () => {
    const result = inspectUcwSmokeConfig({
      ENABLE_GATEWAY_SETTLE: 'true',
      X402_PAYOUT_ADDRESSES_CONFIRMED: 'true',
      X402_RECONCILIATION_SECRET: 'short',
      X402_UPSTREAM_HOST_ALLOWLIST: 'ucw-smoke.example.workers.dev',
    })
    expect(result.ready).toBe(false)
    for (const name of ['Reconciliation secret', 'Shared storage', 'Circle server credential', 'Circle browser SDK configuration']) {
      expect(result.checks.find((check) => check.name === name)?.status).toBe('BLOCKED')
    }
    expect(result.checks.find(({ name }) => name === 'Circle browser SDK configuration')?.detail).toMatch(/VITE_CIRCLE_APP_ID, VITE_CLIENT_KEY/)
  })

  it('blocks an empty or local-looking allowlist', () => {
    const empty = inspectUcwSmokeConfig({ ...READY_ENV, X402_UPSTREAM_HOST_ALLOWLIST: '' })
    expect(empty.checks.find(({ name }) => name === 'Community upstream allowlist')?.status).toBe('BLOCKED')

    const local = inspectUcwSmokeConfig({ ...READY_ENV, X402_UPSTREAM_HOST_ALLOWLIST: 'localhost,127.0.0.1' })
    expect(local.checks.find(({ name }) => name === 'Community upstream allowlist')?.status).toBe('BLOCKED')
  })

  it('warns when no echo endpoint is supplied', () => {
    const result = inspectUcwSmokeConfig(READY_ENV)
    expect(result.checks.find(({ name }) => name === 'Echo endpoint')?.status).toBe('WARN')
  })

  it('never prints secret values', () => {
    const report = formatUcwSmokeReport(inspectUcwSmokeConfig(READY_ENV, { endpoint: ENDPOINT }))
    expect(report).not.toContain(SECRET)
    expect(report).not.toContain(KV_TOKEN)
    expect(report).not.toContain(READY_ENV.CIRCLE_API_KEY)
  })

  it('makes no network request while inspecting', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    inspectUcwSmokeConfig(READY_ENV, { endpoint: ENDPOINT })
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

describe('inspectSmokeEndpoint', () => {
  it('rejects a host outside the allowlist and non-HTTPS URLs', () => {
    const allowlist = ['ucw-smoke.example.workers.dev']
    expect(inspectSmokeEndpoint('https://other.example.workers.dev/echo', allowlist).ok).toBe(false)
    expect(inspectSmokeEndpoint('http://ucw-smoke.example.workers.dev/echo', allowlist).ok).toBe(false)
    expect(inspectSmokeEndpoint('https://ucw-smoke.example.workers.dev:8443/echo', allowlist).ok).toBe(false)
    expect(inspectSmokeEndpoint('https://127.0.0.1/echo', allowlist).ok).toBe(false)
    expect(inspectSmokeEndpoint(ENDPOINT, allowlist).ok).toBe(true)
  })
})

describe('normalizeApiBaseUrl', () => {
  it('allows loopback HTTP and any HTTPS origin only', () => {
    expect(normalizeApiBaseUrl()).toBe('http://localhost:3000')
    expect(normalizeApiBaseUrl('http://127.0.0.1:3100')).toBe('http://127.0.0.1:3100')
    expect(normalizeApiBaseUrl('https://staging.example.org')).toBe('https://staging.example.org')
    expect(normalizeApiBaseUrl('http://staging.example.org')).toBeNull()
  })
})

describe('runUcwSmokeNetworkChecks', () => {
  it('skips every probe while static blockers remain', async () => {
    const fetchImpl = vi.fn()
    const checks = await runUcwSmokeNetworkChecks({}, { fetchImpl })
    expect(statuses(checks)).toEqual(['SKIPPED'])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('passes the echo contract, the running config and one reconcile sweep', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ status: 'SUCCESS', result: 'ucw-smoke-ok' }))
      .mockResolvedValueOnce(response(RUNNING_CONFIG))
      .mockResolvedValueOnce(response({ success: true, summary: { reconciled: 0 } }))

    const checks = await runUcwSmokeNetworkChecks(READY_ENV, { fetchImpl, endpoint: ENDPOINT })
    expect(statuses(checks)).toEqual(['PASS', 'PASS', 'PASS'])

    expect(fetchImpl.mock.calls[0][0]).toBe(ENDPOINT)
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ query: 'ucw-smoke-preflight' })

    expect(fetchImpl.mock.calls[1][0]).toBe('http://localhost:3000/api/x402/config')
    expect(fetchImpl.mock.calls[1][1].method).toBe('GET')

    expect(fetchImpl.mock.calls[2][0]).toBe('http://localhost:3000/api/x402/reconcile')
    expect(fetchImpl.mock.calls[2][1].method).toBe('POST')
    expect(fetchImpl.mock.calls[2][1].headers['x-x402-reconciliation-secret']).toBe(SECRET)

    const report = formatUcwSmokeReport(inspectUcwSmokeConfig(READY_ENV, { endpoint: ENDPOINT }), checks, 'live')
    expect(report).toContain('READY')
    expect(report).not.toContain(SECRET)
  })

  it('blocks an upstream that answers without a status field', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response(RUNNING_CONFIG))
      .mockResolvedValueOnce(response({ success: true }))

    const checks = await runUcwSmokeNetworkChecks(READY_ENV, { fetchImpl, endpoint: ENDPOINT })
    expect(checks[0].status).toBe('BLOCKED')
    expect(checks[0].detail).toMatch(/status/i)
    expect(statuses(checks).slice(1)).toEqual(['PASS', 'PASS'])
  })

  it('blocks an upstream that reports UNAVAILABLE', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ status: 'UNAVAILABLE' }))
      .mockResolvedValueOnce(response(RUNNING_CONFIG))
      .mockResolvedValueOnce(response({ success: true }))

    const checks = await runUcwSmokeNetworkChecks(READY_ENV, { fetchImpl, endpoint: ENDPOINT })
    expect(checks[0].status).toBe('BLOCKED')
  })

  it('detects a running server that has not picked up .env', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ status: 'SUCCESS' }))
      .mockResolvedValueOnce(response({ ...RUNNING_CONFIG, settlementEnabled: false, payoutsConfirmed: false, payoutsReady: false }))
      .mockResolvedValueOnce(response({ success: true }))

    const checks = await runUcwSmokeNetworkChecks(READY_ENV, { fetchImpl, endpoint: ENDPOINT })
    const config = checks.find(({ name }) => name === 'Running server configuration')
    expect(config?.status).toBe('BLOCKED')
    expect(config?.detail).toMatch(/restart/i)
  })

  it('blocks when the server rejects the reconciliation secret', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ status: 'SUCCESS' }))
      .mockResolvedValueOnce(response(RUNNING_CONFIG))
      .mockResolvedValueOnce(response({ success: false }, { ok: false, status: 403 }))

    const checks = await runUcwSmokeNetworkChecks(READY_ENV, { fetchImpl, endpoint: ENDPOINT })
    expect(checks.find(({ name }) => name === 'Reconciler reachability')?.status).toBe('BLOCKED')
  })

  it('warns on process-local storage and skips the sweep when asked', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ status: 'SUCCESS' }))
      .mockResolvedValueOnce(response({ ...RUNNING_CONFIG, storage: { driver: 'memory', shared: false } }))

    const checks = await runUcwSmokeNetworkChecks(READY_ENV, { fetchImpl, endpoint: ENDPOINT, probeReconciler: false })
    expect(checks.find(({ name }) => name === 'Running server configuration')?.status).toBe('WARN')
    expect(checks.find(({ name }) => name === 'Reconciler reachability')?.status).toBe('SKIPPED')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('refuses a non-loopback HTTP API before sending the secret', async () => {
    const fetchImpl = vi.fn()
    const checks = await runUcwSmokeNetworkChecks(READY_ENV, {
      fetchImpl,
      endpoint: ENDPOINT,
      apiBaseUrl: 'http://staging.example.org',
    })
    expect(checks[0].status).toBe('BLOCKED')
    expect(checks[0].name).toBe('Local API base URL')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
