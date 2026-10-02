import { describe, expect, it, vi } from 'vitest'
import { formatPreflightReport, inspectX402StagingConfig, runReadOnlyChecks } from '../x402-staging-preflight.mjs'

describe('x402 staging preflight', () => {
  it('accepts a testnet-only setup while settlement stays disabled', () => {
    const result = inspectX402StagingConfig({
      VITE_APP_ENV: 'testnet',
      KV_REST_API_URL: 'https://kv-stage.upstash.io',
      KV_REST_API_TOKEN: 'opaque-93fd4820-value',
      X402_RECONCILIATION_SECRET: 'a'.repeat(48),
      GATEWAY_FACILITATOR_URL: 'https://gateway-api-testnet.circle.com',
      VITE_ARC_RPC_URL: 'https://rpc.testnet.arc.io',
    })
    expect(result.ready).toBe(true)
    expect(result.checks.find((check) => check.name === 'Settlement safe-off')?.status).toBe('PASS')
  })

  it('blocks mainnet, enabled settlement, unsafe endpoints, missing KV, and weak secret without echoing values', () => {
    const secret = 'sensitive-placeholder-secret-value'
    const token = 'super-private-kv-token'
    const result = inspectX402StagingConfig({
      VITE_APP_ENV: 'mainnet',
      ENABLE_GATEWAY_SETTLE: 'true',
      GATEWAY_FACILITATOR_URL: 'http://gateway-api-testnet.circle.com',
      KV_REST_API_TOKEN: token,
      X402_RECONCILIATION_SECRET: secret,
      VITE_ARC_RPC_URL: 'https://rpc.arc.io',
      X402_UPSTREAM_HOST_ALLOWLIST: '127.0.0.1',
    })
    expect(result.ready).toBe(false)
    expect(result.checks.filter((check) => check.status === 'BLOCKED').length).toBeGreaterThanOrEqual(5)
    const report = formatPreflightReport(result)
    expect(report).not.toContain(secret)
    expect(report).not.toContain(token)
    expect(report).not.toContain('127.0.0.1')
  })

  it('does not make fetch/network requests during inspection or report formatting', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    inspectX402StagingConfig({
      VITE_APP_ENV: 'testnet',
      KV_REST_API_URL: 'https://kv-stage.upstash.io',
      KV_REST_API_TOKEN: 'opaque-b13a56-value',
      X402_RECONCILIATION_SECRET: 'b'.repeat(40),
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('performs only the approved chainId RPC and random-key KV GET when explicitly requested', async () => {
    const token = 'private-kv-credential-should-not-appear-in-report'
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 'arc-x402-preflight', result: '0x4cef52' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: null }) })
    const env = {
      VITE_APP_ENV: 'testnet',
      KV_REST_API_URL: 'https://kv-stage.upstash.io',
      KV_REST_API_TOKEN: token,
      X402_RECONCILIATION_SECRET: 'c'.repeat(40),
    }

    expect(inspectX402StagingConfig(env).checks.filter(({ status }) => status === 'BLOCKED')).toEqual([])
    const checks = await runReadOnlyChecks(env, { fetchImpl })

    expect(checks.map(({ status }) => status)).toEqual(['PASS', 'PASS'])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0].hostname).toBe('rpc.testnet.arc.network')
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST')
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('error')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      jsonrpc: '2.0', id: 'arc-x402-preflight', method: 'eth_chainId', params: [],
    })
    expect(fetchImpl.mock.calls[1][0].hostname).toBe('kv-stage.upstash.io')
    expect(fetchImpl.mock.calls[1][1].method).toBe('POST')
    expect(fetchImpl.mock.calls[1][1].redirect).toBe('error')
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe(`Bearer ${token}`)
    const [command, key] = JSON.parse(fetchImpl.mock.calls[1][1].body)
    expect(command).toBe('GET')
    expect(key).toMatch(/^arcis:x402:preflight:readonly:[a-f0-9]{32}$/)
    expect(JSON.stringify(fetchImpl.mock.calls)).not.toContain('SET')
    const report = formatPreflightReport(inspectX402StagingConfig(env), checks)
    expect(report).not.toContain(token)
    expect(report).not.toContain(key)
  })

  it('makes no network requests when static configuration blocks or settlement is enabled', async () => {
    const fetchImpl = vi.fn()
    const blocked = await runReadOnlyChecks({ VITE_APP_ENV: 'testnet' }, { fetchImpl })
    expect(blocked[0].status).toBe('SKIPPED')
    expect(fetchImpl).not.toHaveBeenCalled()

    const enabled = await runReadOnlyChecks({
      VITE_APP_ENV: 'testnet',
      ENABLE_GATEWAY_SETTLE: 'true',
      KV_REST_API_URL: 'https://kv-stage.upstash.io',
      KV_REST_API_TOKEN: 'opaque-abc123-value',
      X402_RECONCILIATION_SECRET: 'd'.repeat(40),
    }, { fetchImpl })
    expect(enabled[0].status).toBe('SKIPPED')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('blocks an RPC response for the wrong chain and refuses an unapproved RPC hostname', async () => {
    const env = {
      VITE_APP_ENV: 'testnet',
      KV_REST_API_URL: 'https://kv-stage.upstash.io',
      KV_REST_API_TOKEN: 'opaque-abc123-value',
      X402_RECONCILIATION_SECRET: 'e'.repeat(40),
    }
    const wrongChainFetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 'arc-x402-preflight', result: '0x1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: null }) })
    const wrongChain = await runReadOnlyChecks(env, { fetchImpl: wrongChainFetch })
    expect(wrongChain[0].status).toBe('BLOCKED')

    const unapprovedFetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ result: null }) })
    const unapproved = await runReadOnlyChecks({ ...env, VITE_ARC_RPC_URL: 'https://rpc.example.org' }, { fetchImpl: unapprovedFetch })
    expect(unapproved[0].status).toBe('BLOCKED')
    expect(unapprovedFetch).toHaveBeenCalledTimes(1)
    expect(unapprovedFetch.mock.calls[0][0].hostname).toBe('kv-stage.upstash.io')
  })

  it('refuses non-Upstash REST endpoints before attaching the token', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 'arc-x402-preflight', result: '0x4cef52' }) })
    const env = {
      VITE_APP_ENV: 'testnet',
      KV_REST_API_URL: 'https://kv.proxy-service.net',
      KV_REST_API_TOKEN: 'opaque-abc123-value',
      X402_RECONCILIATION_SECRET: 'g'.repeat(40),
    }
    expect(inspectX402StagingConfig(env).checks.filter(({ status }) => status === 'BLOCKED')).toEqual([])
    const checks = await runReadOnlyChecks(env, { fetchImpl })
    expect(checks).toHaveLength(2)
    expect(checks[1].status).toBe('BLOCKED')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0].hostname).toBe('rpc.testnet.arc.network')
  })

  it('treats missing KV REST credentials as blocked and never falls back to Redis TCP', async () => {
    const fetchImpl = vi.fn()
    const env = {
      VITE_APP_ENV: 'testnet',
      REDIS_URL: 'rediss://user:secret@redis-stage.upstash.io:6379',
      X402_RECONCILIATION_SECRET: 'f'.repeat(40),
    }
    expect(inspectX402StagingConfig(env).checks.filter(({ status }) => status === 'BLOCKED')).toEqual([])
    const checks = await runReadOnlyChecks(env, { fetchImpl })
    expect(checks[1].status).toBe('BLOCKED')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0].hostname).toBe('rpc.testnet.arc.network')
  })
})
