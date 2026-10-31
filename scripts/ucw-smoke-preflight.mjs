import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import dotenv from 'dotenv'

// Preconditions for docs/ucw-x402-smoke-test-plan.md. Static checks never touch the network;
// `--live` adds three probes that the plan depends on but cannot verify by reading `.env`:
// the echo endpoint's JSON contract, the *running* server's settlement config, and the
// reconciliation endpoint's credential.

const DEFAULT_API_BASE_URL = 'http://localhost:3000'
const MIN_SECRET_LENGTH = 32

function add(checks, name, status, detail) {
  checks.push({ name, status, detail })
}

function isSafeHostname(host) {
  const value = String(host || '').toLowerCase().replace(/\.$/, '')
  if (!value || value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value.endsWith('.internal') || value.endsWith('.test')) return false
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value) || value.includes(':')) return false
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)
}

function parseUrl(value) {
  try { return new URL(value) } catch { return null }
}

/** Placeholder detection mirrors the staging preflight: values are never printed either way. */
function looksLikePlaceholder(value) {
  return !value || /(?:your[-_ ]|placeholder|change[-_ ]?me|replace[-_ ]?me|example|\bYOUR_|\.\.\.|<[^>]+>|\btoken\b|\bpassword\b)/i.test(value)
}

function hasSharedStorage(env) {
  const restUrl = (env.KV_REST_API_URL || '').trim()
  const restToken = (env.KV_REST_API_TOKEN || '').trim()
  const redisUrl = (env.REDIS_URL || env.KV_URL || '').trim()
  const rest = parseUrl(restUrl)
  const redis = parseUrl(redisUrl)
  const validRest = Boolean(rest && rest.protocol === 'https:' && isSafeHostname(rest.hostname) && !rest.username && !rest.password && !looksLikePlaceholder(restToken))
  const validRedis = Boolean(redis && redis.protocol === 'rediss:' && isSafeHostname(redis.hostname) && redis.password && !looksLikePlaceholder(redis.password))
  return validRest || validRedis
}

function parseAllowlist(env) {
  return (env.X402_UPSTREAM_HOST_ALLOWLIST || '').split(',').map((host) => host.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean)
}

/** Validates the echo endpoint the plan's TC-2/TC-3 depend on, without contacting it. */
export function inspectSmokeEndpoint(endpoint, allowlist) {
  const url = parseUrl(String(endpoint || '').trim())
  if (!url) return { ok: false, detail: 'Echo endpoint is not a valid URL.' }
  if (url.protocol !== 'https:') return { ok: false, detail: 'Echo endpoint must be HTTPS; the server refuses plain HTTP upstreams.' }
  if (url.username || url.password) return { ok: false, detail: 'Echo endpoint must not embed credentials.' }
  if (url.port && url.port !== '443') return { ok: false, detail: 'Echo endpoint must use port 443; a custom port fails community manifest validation.' }
  if (!isSafeHostname(url.hostname)) return { ok: false, detail: 'Echo endpoint must be a public DNS hostname (no IP literals, localhost or private suffixes).' }
  if (url.hash || url.href.includes('\\')) return { ok: false, detail: 'Echo endpoint must not contain "#" or "\\".' }
  const host = url.hostname.toLowerCase()
  if (!allowlist.includes(host)) {
    return { ok: false, detail: `Echo endpoint host ${host} is not in X402_UPSTREAM_HOST_ALLOWLIST; registration and the paid call would both be refused.` }
  }
  return { ok: true, host, detail: `Echo endpoint host ${host} is allowlisted and syntactically valid.` }
}

export function inspectUcwSmokeConfig(env = {}, { endpoint } = {}) {
  const checks = []

  const settlementEnabled = (env.ENABLE_GATEWAY_SETTLE || '').trim().toLowerCase() === 'true'
  add(
    checks,
    'Gateway settlement enabled',
    settlementEnabled ? 'PASS' : 'BLOCKED',
    settlementEnabled
      ? 'ENABLE_GATEWAY_SETTLE=true; a UCW payment can reach batch settlement.'
      : 'Set ENABLE_GATEWAY_SETTLE=true, otherwise a paid call only proves the 402 challenge.'
  )

  const payoutsConfirmed = (env.X402_PAYOUT_ADDRESSES_CONFIRMED || '').trim().toLowerCase() === 'true'
  add(
    checks,
    'Payout addresses confirmed',
    payoutsConfirmed ? 'PASS' : 'BLOCKED',
    payoutsConfirmed
      ? 'X402_PAYOUT_ADDRESSES_CONFIRMED=true; readiness will not block on the payout gate.'
      : 'Set X402_PAYOUT_ADDRESSES_CONFIRMED=true after auditing every payTo with `npm run audit:x402-payouts`.'
  )

  const secret = (env.X402_RECONCILIATION_SECRET || '').trim()
  add(
    checks,
    'Reconciliation secret',
    secret.length >= MIN_SECRET_LENGTH && !looksLikePlaceholder(secret) ? 'PASS' : 'BLOCKED',
    secret.length >= MIN_SECRET_LENGTH && !looksLikePlaceholder(secret)
      ? 'A non-placeholder secret of at least 32 characters is configured; its value was not printed.'
      : 'Set a unique X402_RECONCILIATION_SECRET of at least 32 non-placeholder characters; TC-3 uses it to trigger a sweep.'
  )

  const sharedStorage = hasSharedStorage(env)
  add(
    checks,
    'Shared storage',
    sharedStorage ? 'PASS' : 'BLOCKED',
    sharedStorage
      ? 'A TLS-backed shared KV/Redis configuration is present; connectivity is not tested by the static pass.'
      : 'Configure KV_REST_API_URL + KV_REST_API_TOKEN or an authenticated rediss:// URL; a process-local store loses nonces and the ledger on restart.'
  )

  const circleApiKey = (env.CIRCLE_API_KEY || '').trim()
  add(
    checks,
    'Circle server credential',
    circleApiKey && !looksLikePlaceholder(circleApiKey) ? 'PASS' : 'BLOCKED',
    circleApiKey && !looksLikePlaceholder(circleApiKey)
      ? 'CIRCLE_API_KEY is present; /api/ucw can create a typed-data challenge.'
      : 'Set CIRCLE_API_KEY; without it the UCW challenge route cannot issue a challengeId.'
  )

  const missingBrowserKeys = ['VITE_CIRCLE_APP_ID', 'VITE_CLIENT_KEY']
    .filter((name) => looksLikePlaceholder((env[name] || '').trim()))
  add(
    checks,
    'Circle browser SDK configuration',
    missingBrowserKeys.length === 0 ? 'PASS' : 'BLOCKED',
    missingBrowserKeys.length === 0
      ? 'VITE_CIRCLE_APP_ID and VITE_CLIENT_KEY are present.'
      : `Missing or placeholder: ${missingBrowserKeys.join(', ')}. The browser cannot open a Circle challenge without them.`
  )

  const allowlist = parseAllowlist(env)
  if (allowlist.length === 0) {
    add(
      checks,
      'Community upstream allowlist',
      'BLOCKED',
      'X402_UPSTREAM_HOST_ALLOWLIST is empty; a community manifest cannot be validated, so TC-2 and TC-3 cannot run.'
    )
  } else if (allowlist.some((host) => !isSafeHostname(host))) {
    add(
      checks,
      'Community upstream allowlist',
      'BLOCKED',
      'The allowlist contains a non-hostname or local/private entry; entries were not printed.'
    )
  } else {
    add(
      checks,
      'Community upstream allowlist',
      'PASS',
      `${allowlist.length} hostname(s) are syntactically valid; entries were not printed.`
    )
  }

  if (endpoint) {
    const endpointResult = inspectSmokeEndpoint(endpoint, allowlist)
    add(checks, 'Echo endpoint', endpointResult.ok ? 'PASS' : 'BLOCKED', endpointResult.detail)
  } else {
    add(
      checks,
      'Echo endpoint',
      'WARN',
      'No endpoint supplied; pass --endpoint=https://… to verify the host is allowlisted and the URL passes community validation.'
    )
  }

  const interval = Number.parseInt((env.X402_RECONCILE_INTERVAL_MINUTES || '5').trim(), 10)
  if (!Number.isFinite(interval)) {
    add(checks, 'Reconciler cadence', 'WARN', 'X402_RECONCILE_INTERVAL_MINUTES is not a number; the server falls back to 5 minutes.')
  } else if (interval > 5) {
    add(checks, 'Reconciler cadence', 'WARN', `Every ${interval} minutes; TC-3 will wait that long unless you trigger a sweep manually.`)
  } else {
    add(checks, 'Reconciler cadence', 'PASS', `Every ${Math.max(1, interval)} minute(s); TC-3's wait stays short.`)
  }

  return { checks, ready: checks.every((check) => check.status !== 'BLOCKED'), allowlist }
}

/** Only loopback or HTTPS is probed, so the secret is never sent over plain HTTP off-host. */
export function normalizeApiBaseUrl(value) {
  const url = parseUrl(String(value || '').trim() || DEFAULT_API_BASE_URL)
  if (!url) return null
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase())
  if (url.protocol === 'http:' && loopback) return url.origin
  if (url.protocol === 'https:') return url.origin
  return null
}

async function readJson(response) {
  try { return await response.json() } catch { return null }
}

export async function runUcwSmokeNetworkChecks(env = {}, options = {}) {
  const { fetchImpl = fetch, endpoint, apiBaseUrl = DEFAULT_API_BASE_URL, probeReconciler = true } = options
  const checks = []
  const staticResult = inspectUcwSmokeConfig(env, { endpoint })
  if (!staticResult.ready) {
    add(checks, 'Live smoke-test probes', 'SKIPPED', 'Resolve static blockers before any request is made.')
    return checks
  }

  const base = normalizeApiBaseUrl(apiBaseUrl)
  if (!base) {
    add(checks, 'Local API base URL', 'BLOCKED', 'Use the default http://localhost:3000 or an HTTPS origin; no request was made.')
    return checks
  }

  // 1. Echo contract: community services proxy to it, and the server voids a payment whose
  // upstream does not return an object with a `status` string.
  if (!endpoint) {
    add(checks, 'Echo endpoint contract', 'SKIPPED', 'No endpoint supplied; pass --endpoint=https://… to probe it.')
  } else {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'ucw-smoke-preflight' }),
        signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) throw new Error('HTTP failure')
      const body = await readJson(response)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not a JSON object')
      if (typeof body.status !== 'string') throw new Error('missing status field')
      if (body.status === 'UNAVAILABLE') throw new Error('status is UNAVAILABLE')
      add(checks, 'Echo endpoint contract', 'PASS', `Upstream returned a JSON object with status "${body.status}".`)
    } catch {
      add(
        checks,
        'Echo endpoint contract',
        'BLOCKED',
        'Upstream did not return a JSON object with a non-UNAVAILABLE `status` string; the server would void the payment and no ledger credit would appear.'
      )
    }
  }

  // 2. The *running* server must agree with the env: editing .env without a restart is the
  // most common reason a smoke test stalls at the readiness gate.
  try {
    const response = await fetchImpl(`${base}/api/x402/config`, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) throw new Error('HTTP failure')
    const config = await readJson(response)
    if (!config || typeof config !== 'object') throw new Error('invalid config body')
    const problems = []
    if (config.settlementEnabled !== true) problems.push('settlementEnabled=false')
    if (config.payoutsConfirmed !== true) problems.push('payoutsConfirmed=false')
    if (config.payoutsReady !== true) problems.push('payoutsReady=false')
    if (problems.length > 0) {
      add(checks, 'Running server configuration', 'BLOCKED', `Server reports ${problems.join(', ')}. Restart it so it picks up .env, then re-run.`)
    } else if (config.storage?.shared !== true) {
      add(checks, 'Running server configuration', 'WARN', `Server is using ${config.storage?.driver || 'unknown'} storage; the ledger and nonces will not survive a restart.`)
    } else {
      add(checks, 'Running server configuration', 'PASS', 'Running server reports settlement enabled, payouts confirmed and ready, shared storage.')
    }
  } catch {
    add(
      checks,
      'Running server configuration',
      'BLOCKED',
      `Could not read ${base}/api/x402/config. Start the app (npm run dev, or npm run build && npm start) and re-run.`
    )
  }

  // 3. Reconciler reachability. This POST runs one real sweep, which is why it is the only
  // probe with a side effect; `--no-sweep` skips it.
  if (!probeReconciler) {
    add(checks, 'Reconciler reachability', 'SKIPPED', 'Disabled with --no-sweep; no reconcile request was sent.')
  } else {
    const secret = (env.X402_RECONCILIATION_SECRET || '').trim()
    try {
      const response = await fetchImpl(`${base}/api/x402/reconcile`, {
        method: 'POST',
        redirect: 'error',
        headers: { Accept: 'application/json', 'x-x402-reconciliation-secret': secret },
        signal: AbortSignal.timeout(15_000),
      })
      if (response.status === 401 || response.status === 403) {
        add(checks, 'Reconciler reachability', 'BLOCKED', 'The server rejected the reconciliation secret. Confirm the running process reads the same .env value.')
      } else if (!response.ok) {
        add(checks, 'Reconciler reachability', 'BLOCKED', `Reconcile endpoint answered HTTP ${response.status}; the sweep did not complete.`)
      } else {
        add(checks, 'Reconciler reachability', 'PASS', 'One settlement sweep was accepted. Under `npm run dev` no background reconciler exists, so use this endpoint (or npm start) for TC-3.')
      }
    } catch {
      add(checks, 'Reconciler reachability', 'BLOCKED', 'Reconcile request failed; check that the app is running and its secret is loaded.')
    }
  }

  return checks
}

export function formatUcwSmokeReport(result, networkChecks = [], mode = 'static') {
  const lines = [
    `UCW x402 smoke-test preflight [${mode}]`,
    ...result.checks.map(({ name, status, detail }) => `[${status}] ${name}: ${detail}`),
    ...networkChecks.map(({ name, status, detail }) => `[${status}] ${name}: ${detail}`),
    `Result: ${
      !result.ready || networkChecks.some((check) => check.status === 'BLOCKED')
        ? 'BLOCKED — resolve the items above before starting docs/ucw-x402-smoke-test-plan.md'
        : 'READY — the plan\'s preconditions hold; human OTP/PIN steps remain'
    }`,
    'This script never signs, pays, registers or withdraws. The only side effect is the reconcile sweep (skip it with --no-sweep).',
  ]
  return lines.join('\n')
}

function readArgValue(args, name) {
  const prefix = `${name}=`
  const entry = args.find((arg) => arg.startsWith(prefix))
  return entry ? entry.slice(prefix.length) : undefined
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

  const args = process.argv.slice(2)
  const liveMode = args.includes('--live')
  const endpoint = readArgValue(args, '--endpoint') || (env.UCW_SMOKE_ENDPOINT || '').trim() || undefined
  const apiBaseUrl = readArgValue(args, '--api') || DEFAULT_API_BASE_URL

  const result = inspectUcwSmokeConfig(env, { endpoint })
  const networkChecks = liveMode
    ? await runUcwSmokeNetworkChecks(env, { endpoint, apiBaseUrl, probeReconciler: !args.includes('--no-sweep') })
    : []
  console.log(formatUcwSmokeReport(result, networkChecks, liveMode ? 'live' : 'static'))
  if (!result.ready || networkChecks.some((check) => check.status === 'BLOCKED')) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('UCW smoke preflight could not read local configuration; no values were printed.')
    process.exitCode = 1
  })
}
