import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import dotenv from 'dotenv'

const TESTNET_FACILITATOR_HOST = 'gateway-api-testnet.circle.com'
const TESTNET_RPC_HOSTS = new Set(['rpc.testnet.arc.io', 'rpc.testnet.arc.network'])

function add(checks, name, status, detail) {
  checks.push({ name, status, detail })
}

function isSafeHostname(host) {
  const value = host.toLowerCase().replace(/\.$/, '')
  if (!value || value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value.endsWith('.internal')) return false
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value) || value.includes(':')) return false
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
}

function parseUrl(value) {
  try { return new URL(value) } catch { return null }
}

function looksLikePlaceholder(value) {
  return !value || /(?:your[-_ ]|placeholder|change[-_ ]?me|replace[-_ ]?me|example|\.\.\.|<[^>]+>|\btoken\b|\bpassword\b)/i.test(value)
}

export function inspectX402StagingConfig(env = {}) {
  const checks = []
  const target = (env.VITE_APP_ENV || env.VITE_NETWORK || env.APP_ENV || '').trim().toLowerCase()
  if (target === 'mainnet') add(checks, 'Network target', 'BLOCKED', 'Mainnet target detected; this preflight is testnet-only.')
  else if (target && target !== 'testnet') add(checks, 'Network target', 'BLOCKED', 'Network target is not the expected Arc Testnet setting.')
  else if (!target) add(checks, 'Network target', 'BLOCKED', 'Set VITE_APP_ENV=testnet explicitly for staging; the application default is not sufficient evidence.')
  else add(checks, 'Network target', 'PASS', 'Explicit Arc Testnet target selected.')

  if ((env.ENABLE_GATEWAY_SETTLE || '').trim().toLowerCase() === 'true') {
    add(checks, 'Settlement safe-off', 'BLOCKED', 'ENABLE_GATEWAY_SETTLE is enabled; preflight will not contact the facilitator.')
  } else {
    add(checks, 'Settlement safe-off', 'PASS', 'Gateway settlement remains disabled; no payment can be submitted by this check.')
  }

  const facilitator = (env.GATEWAY_FACILITATOR_URL || `https://${TESTNET_FACILITATOR_HOST}`).trim()
  const facilitatorUrl = parseUrl(facilitator)
  if (!facilitatorUrl || facilitatorUrl.protocol !== 'https:' || facilitatorUrl.hostname.toLowerCase() !== TESTNET_FACILITATOR_HOST || (facilitatorUrl.port && facilitatorUrl.port !== '443') || facilitatorUrl.username || facilitatorUrl.password || (facilitatorUrl.pathname !== '/' && facilitatorUrl.pathname !== '') || facilitatorUrl.search || facilitatorUrl.hash) {
    add(checks, 'Circle facilitator endpoint', 'BLOCKED', 'Expected the HTTPS Circle Gateway Testnet endpoint; URL value was not printed.')
  } else {
    add(checks, 'Circle facilitator endpoint', 'PASS', 'Configured/default endpoint is Circle Gateway Testnet; no request was made.')
  }

  const restUrl = (env.KV_REST_API_URL || '').trim()
  const restToken = (env.KV_REST_API_TOKEN || '').trim()
  const redisUrl = (env.REDIS_URL || env.KV_URL || '').trim()
  const rest = parseUrl(restUrl)
  const redis = parseUrl(redisUrl)
  const validRest = Boolean(rest && rest.protocol === 'https:' && isSafeHostname(rest.hostname) && !rest.username && !rest.password && !looksLikePlaceholder(rest.hostname) && !looksLikePlaceholder(restToken))
  const validRedis = Boolean(redis && redis.protocol === 'rediss:' && isSafeHostname(redis.hostname) && !looksLikePlaceholder(redis.hostname) && redis.password && !looksLikePlaceholder(redis.password))
  if (validRest || validRedis) {
    add(checks, 'Shared durable KV configuration', 'PASS', 'A TLS-backed shared KV/Redis configuration is present; connectivity and durability were not tested.')
  } else {
    add(checks, 'Shared durable KV configuration', 'BLOCKED', 'Configure a complete HTTPS Upstash REST pair or authenticated rediss:// URL; no storage connection was attempted.')
  }

  const reconciliationSecret = (env.X402_RECONCILIATION_SECRET || '').trim()
  if (reconciliationSecret.length >= 32 && !looksLikePlaceholder(reconciliationSecret)) {
    add(checks, 'Reconciliation secret', 'PASS', 'A non-placeholder secret of at least 32 characters is configured; only basic length/placeholder checks were made and its value was not printed.')
  } else {
    add(checks, 'Reconciliation secret', 'BLOCKED', 'Set a unique secret with at least 32 non-placeholder characters; secret values are never printed.')
  }

  const rpc = (env.VITE_ARC_RPC_URL || '').trim()
  if (!rpc) {
    add(checks, 'Arc RPC endpoint', 'PASS', 'Application testnet RPC defaults are in use; no RPC request was made.')
  } else {
    const rpcUrl = parseUrl(rpc)
    if (!rpcUrl || rpcUrl.protocol !== 'https:' || rpcUrl.username || rpcUrl.password) {
      add(checks, 'Arc RPC endpoint', 'BLOCKED', 'Custom RPC must be an HTTPS URL without embedded credentials; URL value was not printed.')
    } else if (TESTNET_RPC_HOSTS.has(rpcUrl.hostname.toLowerCase())) {
      add(checks, 'Arc RPC endpoint', 'PASS', 'Known Arc Testnet RPC configured; no chain-id request was made.')
    } else if (/mainnet|rpc\.arc\.io$/i.test(rpcUrl.hostname)) {
      add(checks, 'Arc RPC endpoint', 'BLOCKED', 'Custom RPC hostname appears to target mainnet; URL value was not printed.')
    } else {
      add(checks, 'Arc RPC endpoint', 'WARN', 'Custom HTTPS RPC configured; verify its Arc Testnet chain ID (5042002) separately.')
    }
  }

  const allowlist = (env.X402_UPSTREAM_HOST_ALLOWLIST || '').split(',').map((host) => host.trim()).filter(Boolean)
  if (allowlist.length === 0) {
    add(checks, 'Community upstream allowlist', 'WARN', 'Allowlist is empty; community proxy upstreams remain unavailable.')
  } else if (allowlist.some((host) => !isSafeHostname(host))) {
    add(checks, 'Community upstream allowlist', 'BLOCKED', 'Allowlist contains a non-hostname or local/private-looking entry; entries were not printed.')
  } else {
    add(checks, 'Community upstream allowlist', 'WARN', 'Hostnames are syntactically valid; ownership, DNS/egress policy, and public IP resolution still need review.')
  }

  return { checks, ready: checks.every((check) => check.status !== 'BLOCKED') }
}

export async function runReadOnlyChecks(env, { fetchImpl = fetch } = {}) {
  const checks = []
  const staticResult = inspectX402StagingConfig(env)
  if (!staticResult.ready) {
    add(checks, 'Read-only network checks', 'SKIPPED', 'Resolve static blockers before any network access.')
    return checks
  }
  if ((env.ENABLE_GATEWAY_SETTLE || '').trim().toLowerCase() === 'true') {
    add(checks, 'Read-only network checks', 'SKIPPED', 'Settlement is enabled; no network requests were made.')
    return checks
  }

  const rpcConfig = (env.VITE_ARC_RPC_URL || `https://rpc.testnet.arc.network`).trim()
  const rpcUrl = parseUrl(rpcConfig)
  if (!rpcUrl || rpcUrl.protocol !== 'https:' || !TESTNET_RPC_HOSTS.has(rpcUrl.hostname.toLowerCase()) || rpcUrl.username || rpcUrl.password || (rpcUrl.port && rpcUrl.port !== '443') || (rpcUrl.pathname !== '/' && rpcUrl.pathname !== '') || rpcUrl.search || rpcUrl.hash) {
    add(checks, 'Arc Testnet chain ID (read-only)', 'BLOCKED', 'RPC endpoint is not one of the approved Arc Testnet HTTPS endpoints; no request was made.')
  } else {
    try {
      const response = await fetchImpl(rpcUrl, {
        method: 'POST',
        redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 'arc-x402-preflight', method: 'eth_chainId', params: [] }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) throw new Error('RPC HTTP failure')
      const body = await response.json()
      if (body?.jsonrpc !== '2.0' || body?.id !== 'arc-x402-preflight' || typeof body?.result !== 'string') throw new Error('RPC response invalid')
      if (!/^0x[0-9a-f]+$/i.test(body.result)) throw new Error('RPC chain ID invalid')
      const chainId = Number.parseInt(body.result, 16)
      if (chainId !== 5_042_002) {
        add(checks, 'Arc Testnet chain ID (read-only)', 'BLOCKED', 'RPC responded, but the chain ID was not Arc Testnet 5042002.')
      } else {
        add(checks, 'Arc Testnet chain ID (read-only)', 'PASS', 'eth_chainId returned Arc Testnet 5042002.')
      }
    } catch {
      add(checks, 'Arc Testnet chain ID (read-only)', 'BLOCKED', 'RPC request failed or returned an invalid response; endpoint and error details were not printed.')
    }
  }

  const restUrl = (env.KV_REST_API_URL || '').trim()
  const restToken = (env.KV_REST_API_TOKEN || '').trim()
  const rest = parseUrl(restUrl)
  if (!rest || rest.protocol !== 'https:' || !rest.hostname.toLowerCase().endsWith('.upstash.io') || !isSafeHostname(rest.hostname) || looksLikePlaceholder(rest.hostname) || looksLikePlaceholder(restToken) || rest.username || rest.password || (rest.port && rest.port !== '443')) {
    add(checks, 'Shared KV read (GET-only)', 'BLOCKED', 'A complete HTTPS Upstash REST pair is not configured; no Redis TCP connection or write probe was attempted.')
  } else {
    try {
      const key = `arcis:x402:preflight:readonly:${randomBytes(16).toString('hex')}`
      const response = await fetchImpl(rest, {
        method: 'POST',
        redirect: 'error',
        headers: { Accept: 'application/json', Authorization: `Bearer ${restToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GET', key]),
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) throw new Error('KV HTTP failure')
      const body = await response.json()
      if (!Object.prototype.hasOwnProperty.call(body || {}, 'result') || body.result !== null) throw new Error('KV response invalid')
      add(checks, 'Shared KV read (GET-only)', 'PASS', 'HTTPS KV REST accepted GET for a random nonexistent key; no data was written.')
    } catch {
      add(checks, 'Shared KV read (GET-only)', 'BLOCKED', 'KV GET failed or returned an unexpected response; endpoint, key, token, and error details were not printed.')
    }
  }
  return checks
}

export function formatPreflightReport(result, networkChecks = []) {
  const hasNetworkChecks = networkChecks.length > 0
  const lines = [
    `x402 Arc Testnet staging preflight (${hasNetworkChecks ? 'explicit read-only network checks' : 'local/static; no network calls'})`,
    ...result.checks.map(({ name, status, detail }) => `[${status}] ${name}: ${detail}`),
    ...networkChecks.map(({ name, status, detail }) => `[${status}] ${name}: ${detail}`),
    `Result: ${!result.ready ? 'BLOCKED — resolve static blockers before staging validation' : networkChecks.some((check) => check.status !== 'PASS') ? 'BLOCKED — resolve read-only connectivity blockers before staging validation' : networkChecks.length ? 'read-only checks complete; payment/staging settlement not tested' : 'no static blockers found'}`,
    'No Circle facilitator, signing, payment, transaction, or data-write request is performed by this preflight.',
  ]
  return lines.join('\n')
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  let env = { ...process.env }
  try {
    const localEnv = dotenv.parse(fs.readFileSync(path.join(root, '.env')))
    env = { ...localEnv, ...env }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  const result = inspectX402StagingConfig(env)
  const readOnlyRequested = process.argv.slice(2).includes('--read-only')
  const networkChecks = readOnlyRequested ? await runReadOnlyChecks(env) : []
  console.log(formatPreflightReport(result, networkChecks))
  if (!result.ready || networkChecks.some((check) => check.status !== 'PASS')) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('x402 preflight could not read local configuration; no values were printed.')
    process.exitCode = 1
  })
}
