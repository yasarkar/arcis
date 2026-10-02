// api/utils/redisStorage.ts
//
// Unified, serverless-optimized KV & Redis storage abstraction for Arcis Protocol.
// Supports:
// 1. Upstash REST API (Vercel KV native, HTTP-based, 0-latency connection reuse, no TCP socket limits)
// 2. ioredis TCP/TLS (via REDIS_URL or KV_URL rediss://)
// 3. Graceful in-memory fallback for offline/isolated execution

function getEnv(key: string): string {
  const localEnv = (typeof process !== 'undefined' && process.env) || {}
  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
  const val = localEnv[key] || globalEnv[key] || ''
  // Strip enclosing quotes if present in .env
  return val.replace(/^["']|["']$/g, '').trim()
}

// In-memory fallback map for offline resilience
const memoryStore = new Map<string, { value: string; expiresAt?: number }>()
const memoryCounters = new Map<string, { count: number; expiresAt: number }>()

let ioredisClient: any = null
let ioredisAttempted = false
let ioredisAvailable = false

function getRestConfig() {
  const url = getEnv('KV_REST_API_URL')
  const token = getEnv('KV_REST_API_TOKEN')
  if (url && token) {
    return { url, token }
  }
  return null
}

async function execRest(command: any[]): Promise<any> {
  const conf = getRestConfig()
  if (!conf) return null

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 4500)

  try {
    const res = await fetch(conf.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conf.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      throw new Error(`Upstash REST returned ${res.status}`)
    }
    const data = await res.json()
    return data.result
  } catch (err) {
    clearTimeout(timeoutId)
    throw err
  }
}

async function getIoredisClient(): Promise<any> {
  if (ioredisAttempted) {
    return ioredisAvailable ? ioredisClient : null
  }
  ioredisAttempted = true

  const redisUrl = getEnv('REDIS_URL') || getEnv('KV_URL') || 'redis://127.0.0.1:6379'
  try {
    const { default: Redis } = await import('ioredis')
    ioredisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 4000,
      lazyConnect: true,
      retryStrategy: () => null,
      tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
    })

    ioredisClient.on('error', () => {
      ioredisAvailable = false
    })

    await ioredisClient.connect().catch(() => {
      ioredisAvailable = false
    })

    ioredisAvailable = ioredisClient.status === 'ready' || ioredisClient.status === 'connect'
    return ioredisAvailable ? ioredisClient : null
  } catch {
    ioredisAvailable = false
    return null
  }
}

/**
 * Get a string value from storage.
 */
export async function kvGet(key: string): Promise<string | null> {
  // 1. Try Upstash REST (best for Vercel Serverless)
  if (getRestConfig()) {
    try {
      const res = await execRest(['GET', key])
      if (res !== null && res !== undefined) {
        return typeof res === 'string' ? res : JSON.stringify(res)
      }
      return null
    } catch (err) {
      console.warn(`[redisStorage] Upstash REST GET failed for "${key}", falling back:`, err)
    }
  }

  // 2. Try ioredis TCP/TLS
  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const val = await client.get(key)
      return val ?? null
    }
  } catch (err) {
    console.warn(`[redisStorage] ioredis GET failed for "${key}":`, err)
  }

  // 3. In-memory fallback
  const item = memoryStore.get(key)
  if (!item) return null
  if (item.expiresAt && item.expiresAt <= Date.now()) {
    memoryStore.delete(key)
    return null
  }
  return item.value
}

/**
 * Set a string value in storage with optional TTL in seconds.
 */
export async function kvSetIfAbsent(
  key: string,
  value: string,
  exSeconds = 3600
): Promise<'acquired' | 'exists' | 'unavailable'> {
  if (getRestConfig()) {
    try {
      const result = await execRest(['SET', key, value, 'EX', exSeconds, 'NX'])
      if (result === 'OK') return 'acquired'
      if (result === null || result === undefined) return 'exists'
    } catch (err) {
      console.warn(`[redisStorage] Upstash REST SET NX failed for "${key}":`, err)
    }
  }

  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const result = await client.set(key, value, 'EX', exSeconds, 'NX')
      return result === 'OK' ? 'acquired' : 'exists'
    }
  } catch (err) {
    console.warn(`[redisStorage] ioredis SET NX failed for "${key}":`, err)
  }

  // A process-local lock is safe only in development/test, never across production instances.
  if (getEnv('NODE_ENV') === 'production') return 'unavailable'
  const existing = memoryStore.get(key)
  if (existing && (!existing.expiresAt || existing.expiresAt > Date.now())) return 'exists'
  memoryStore.set(key, { value, expiresAt: Date.now() + exSeconds * 1000 })
  return 'acquired'
}

export type ProviderLedger = {
  totalCallsServed: number
  totalUsdcEarned: number
  unclaimedEarningsUsdc: number
  pendingUsdc: number
  withdrawnUsdc: number
}

export type ProviderLedgerDeltaResult =
  | { status: 'updated'; ledger: ProviderLedger }
  | { status: 'insufficient'; ledger: ProviderLedger }
  | { status: 'duplicate'; ledger?: ProviderLedger }
  | { status: 'unavailable' }

export type PendingProviderSettlement = {
  providerAddress: string
  payerAddress: string
  serviceId: string
  amountMicros: number
  amountUsdc: number
  nonce: string
  settlementRef?: string
  status: 'settling' | 'pending' | 'confirmed' | 'failed'
  createdAt: number
  transferId?: string
  chainTxHash?: string
  failureReason?: string
}

function isCircleTransferId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function isValidSettlementKeys(providerKey: string, pendingKey: string, nonceKey: string, settlement: PendingProviderSettlement): boolean {
  if (typeof settlement.providerAddress !== 'string' || typeof settlement.payerAddress !== 'string' || typeof settlement.nonce !== 'string') return false
  const provider = settlement.providerAddress.toLowerCase()
  const nonce = settlement.nonce.toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(provider) &&
    providerKey === `arcis:x402:provider:{${provider}}` &&
    pendingKey === `arcis:x402:pending:{${provider}}:${nonce}` &&
    nonceKey === `arcis:x402:nonce:{${provider}}:${nonce}` &&
    /^0x[0-9a-f]{40}$/.test(settlement.payerAddress) &&
    /^0x[0-9a-f]{64}$/.test(nonce) &&
    typeof settlement.serviceId === 'string' && /^[a-z0-9-]{1,100}$/.test(settlement.serviceId) &&
    Number.isSafeInteger(settlement.amountMicros) && settlement.amountMicros > 0 && settlement.amountMicros <= 1_000_000 &&
    settlement.amountUsdc === settlement.amountMicros / 1_000_000 &&
    Number.isSafeInteger(settlement.createdAt) && settlement.createdAt > 0 &&
    settlement.status === 'settling' &&
    settlement.settlementRef === undefined && settlement.transferId === undefined && settlement.chainTxHash === undefined && settlement.failureReason === undefined
}

/** Stores the payment intent before calling Circle so an ambiguous facilitator result can be reconciled by nonce. */
export async function kvCreateProviderSettlementIntent(
  providerKey: string,
  pendingKey: string,
  nonceKey: string,
  settlement: PendingProviderSettlement,
): Promise<'created' | 'duplicate' | 'unavailable'> {
  if (settlement.status !== 'settling' || !isValidSettlementKeys(providerKey, pendingKey, nonceKey, settlement)) return 'unavailable'
  const script = `
    if redis.call('EXISTS', KEYS[2]) == 1 or redis.call('EXISTS', KEYS[3]) == 1 then return 'duplicate' end
    redis.call('SET', KEYS[2], ARGV[1], 'EX', 2592000)
    redis.call('SET', KEYS[3], '1', 'EX', 2592000)
    return 'created'
  `
  if (getRestConfig()) {
    try {
      const result = await execRest(['EVAL', script, 3, providerKey, pendingKey, nonceKey, JSON.stringify(settlement)])
      if (result === 'created' || result === 'duplicate') return result
    } catch (err) { console.warn('[redisStorage] Upstash settlement intent creation failed:', err) }
  }
  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const result = await client.eval(script, 3, providerKey, pendingKey, nonceKey, JSON.stringify(settlement))
      if (result === 'created' || result === 'duplicate') return result
    }
  } catch (err) { console.warn('[redisStorage] ioredis settlement intent creation failed:', err) }
  if (getEnv('NODE_ENV') === 'production') return 'unavailable'
  for (const key of [pendingKey, nonceKey]) {
    const item = memoryStore.get(key)
    if (item && (!item.expiresAt || item.expiresAt > Date.now())) return 'duplicate'
  }
  const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
  memoryStore.set(pendingKey, { value: JSON.stringify(settlement), expiresAt })
  memoryStore.set(nonceKey, { value: '1', expiresAt })
  return 'created'
}

/** Atomically marks a facilitator-accepted intent as pending provider revenue. */
export async function kvRejectProviderSettlementIntent(
  pendingKey: string,
): Promise<'failed' | 'unavailable'> {
  if (!/^arcis:x402:pending:[{]0x[0-9a-f]{40}[}]:0x[0-9a-f]{64}$/.test(pendingKey)) return 'unavailable'
  const script = `
    local raw = redis.call('GET', KEYS[1])
    if not raw then return 'unavailable' end
    local settlement = cjson.decode(raw)
    if settlement.status == 'failed' then return 'failed' end
    if settlement.status ~= 'settling' then return 'unavailable' end
    settlement.status = 'failed'
    settlement.failureReason = 'Circle facilitator rejected the payment; no provider earnings credited.'
    redis.call('SET', KEYS[1], cjson.encode(settlement), 'EX', 2592000)
    return 'failed'
  `
  if (getRestConfig()) {
    try {
      const result = await execRest(['EVAL', script, 1, pendingKey])
      if (result === 'failed' || result === 'unavailable') return result
    } catch (err) { console.warn('[redisStorage] Upstash rejected settlement update failed:', err) }
  }
  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const result = await client.eval(script, 1, pendingKey)
      if (result === 'failed' || result === 'unavailable') return result
    }
  } catch (err) { console.warn('[redisStorage] ioredis rejected settlement update failed:', err) }
  if (getEnv('NODE_ENV') === 'production') return 'unavailable'
  const pendingItem = memoryStore.get(pendingKey)
  if (!pendingItem || (pendingItem.expiresAt && pendingItem.expiresAt <= Date.now())) return 'unavailable'
  try {
    const settlement = JSON.parse(pendingItem.value) as PendingProviderSettlement
    if (settlement.status === 'failed') return 'failed'
    if (settlement.status !== 'settling') return 'unavailable'
    settlement.status = 'failed'
    settlement.failureReason = 'Circle facilitator rejected the payment; no provider earnings credited.'
    memoryStore.set(pendingKey, { value: JSON.stringify(settlement), expiresAt: pendingItem.expiresAt })
    return 'failed'
  } catch { return 'unavailable' }
}

export async function kvMarkProviderSettlementAccepted(
  providerKey: string,
  pendingKey: string,
  settlementRef: string,
): Promise<'pending' | 'already_pending' | 'unavailable'> {
  const providerMatch = providerKey.match(/^arcis:x402:provider:[{](0x[0-9a-f]{40})[}]$/)
  const pendingMatch = pendingKey.match(/^arcis:x402:pending:[{](0x[0-9a-f]{40})[}]:0x[0-9a-f]{64}$/)
  if (!providerMatch || !pendingMatch || providerMatch[1] !== pendingMatch[1] ||
      typeof settlementRef !== 'string' || settlementRef.length < 1 || settlementRef.length > 256) return 'unavailable'
  const script = `
    local raw = redis.call('GET', KEYS[2])
    if not raw then return 'unavailable' end
    local settlement = cjson.decode(raw)
    if settlement.status == 'pending' and settlement.settlementRef == ARGV[1] then return 'already_pending' end
    if settlement.status ~= 'settling' then return 'unavailable' end
    local ledgerRaw = redis.call('GET', KEYS[1])
    local data = ledgerRaw and cjson.decode(ledgerRaw) or {}
    data.totalCallsServed = (tonumber(data.totalCallsServed) or 0) + 1
    data.totalUsdcEarned = tonumber(data.totalUsdcEarned) or 0
    data.unclaimedEarningsUsdc = tonumber(data.unclaimedEarningsUsdc) or 0
    data.pendingUsdc = (tonumber(data.pendingUsdc) or 0) + tonumber(settlement.amountMicros) / 1000000
    data.withdrawnUsdc = tonumber(data.withdrawnUsdc) or 0
    settlement.status = 'pending'
    settlement.settlementRef = ARGV[1]
    redis.call('SET', KEYS[1], cjson.encode(data))
    redis.call('SET', KEYS[2], cjson.encode(settlement), 'EX', 2592000)
    return 'pending'
  `
  if (getRestConfig()) {
    try {
      const result = await execRest(['EVAL', script, 2, providerKey, pendingKey, settlementRef])
      if (result === 'pending' || result === 'already_pending') return result
    } catch (err) { console.warn('[redisStorage] Upstash accepted settlement update failed:', err) }
  }
  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const result = await client.eval(script, 2, providerKey, pendingKey, settlementRef)
      if (result === 'pending' || result === 'already_pending') return result
    }
  } catch (err) { console.warn('[redisStorage] ioredis accepted settlement update failed:', err) }
  if (getEnv('NODE_ENV') === 'production') return 'unavailable'
  const pendingItem = memoryStore.get(pendingKey)
  if (!pendingItem || (pendingItem.expiresAt && pendingItem.expiresAt <= Date.now())) return 'unavailable'
  let settlement: PendingProviderSettlement
  let ledger: ProviderLedger
  try {
    settlement = JSON.parse(pendingItem.value)
    if (settlement.status === 'pending' && settlement.settlementRef === settlementRef) return 'already_pending'
    if (settlement.status !== 'settling') return 'unavailable'
    const ledgerItem = memoryStore.get(providerKey)
    ledger = { totalCallsServed: 0, totalUsdcEarned: 0, unclaimedEarningsUsdc: 0, pendingUsdc: 0, withdrawnUsdc: 0, ...(ledgerItem ? JSON.parse(ledgerItem.value) : {}) }
  } catch { return 'unavailable' }
  ledger.totalCallsServed += 1
  ledger.pendingUsdc = Number((ledger.pendingUsdc + settlement.amountMicros / 1e6).toFixed(6))
  settlement.status = 'pending'
  settlement.settlementRef = settlementRef
  memoryStore.set(providerKey, { value: JSON.stringify(ledger) })
  memoryStore.set(pendingKey, { value: JSON.stringify(settlement), expiresAt: pendingItem.expiresAt })
  return 'pending'
}

/** Reads a pending Gateway transfer record by provider and EIP-3009 nonce. */
export async function kvGetPendingProviderSettlement(key: string): Promise<PendingProviderSettlement | null> {
  let raw: string | null = null
  let remoteConfigured = false
  let remoteReadFailed = false
  if (getRestConfig()) {
    remoteConfigured = true
    try {
      const value = await execRest(['GET', key])
      raw = value === null || value === undefined ? null : typeof value === 'string' ? value : JSON.stringify(value)
    } catch (err) {
      remoteReadFailed = true
      console.warn(`[redisStorage] Upstash pending settlement GET failed for "${key}":`, err)
    }
  }
  if (!remoteConfigured || remoteReadFailed) {
    try {
      const client = await getIoredisClient()
      if (client && ioredisAvailable) {
        remoteConfigured = true
        raw = (await client.get(key)) ?? null
        remoteReadFailed = false
      }
    } catch (err) {
      remoteReadFailed = true
      console.warn(`[redisStorage] ioredis pending settlement GET failed for "${key}":`, err)
    }
  }
  if (getEnv('NODE_ENV') === 'production' && (!remoteConfigured || remoteReadFailed)) throw new Error('Durable settlement storage is unavailable')
  if (!remoteConfigured || (remoteReadFailed && getEnv('NODE_ENV') !== 'production')) {
    const item = memoryStore.get(key)
    if (item && (!item.expiresAt || item.expiresAt > Date.now())) raw = item.value
    else if (item) memoryStore.delete(key)
  }
  if (!raw) return null
  try {
    const record = JSON.parse(raw) as PendingProviderSettlement
    const provider = record?.providerAddress?.toLowerCase()
    const nonce = record?.nonce?.toLowerCase()
    const expectedKey = `arcis:x402:pending:{${provider}}:${nonce}`
    if (key !== expectedKey || !/^0x[0-9a-f]{40}$/.test(provider || '') || !/^0x[0-9a-f]{40}$/.test(record.payerAddress) || !/^0x[0-9a-f]{64}$/.test(nonce || '') || !Number.isSafeInteger(record.amountMicros) || record.amountMicros <= 0 || record.amountUsdc !== record.amountMicros / 1_000_000 || typeof record.serviceId !== 'string' || !/^[a-z0-9-]{1,100}$/.test(record.serviceId) || !Number.isFinite(record.createdAt) || !['settling', 'pending', 'confirmed', 'failed'].includes(record.status) || (['pending', 'confirmed'].includes(record.status) && (typeof record.settlementRef !== 'string' || record.settlementRef.length < 1 || record.settlementRef.length > 256)) || (record.settlementRef !== undefined && (typeof record.settlementRef !== 'string' || record.settlementRef.length < 1 || record.settlementRef.length > 256)) || (record.transferId !== undefined && (typeof record.transferId !== 'string' || !isCircleTransferId(record.transferId))) || (record.chainTxHash !== undefined && (typeof record.chainTxHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(record.chainTxHash))) || (record.failureReason !== undefined && (typeof record.failureReason !== 'string' || record.failureReason.length > 500))) return null
    return record
  } catch { return null }
}

/** Atomically moves a Gateway payment from pending to available after Circle reports confirmed/completed. */
export async function kvConfirmPendingProviderSettlement(
  providerKey: string,
  pendingKey: string,
  transferId: string,
  chainTxHash: string | undefined,
): Promise<'confirmed' | 'already_confirmed' | 'unavailable'> {
  const providerMatch = providerKey.match(/^arcis:x402:provider:[{](0x[0-9a-f]{40})[}]$/)
  const pendingMatch = pendingKey.match(/^arcis:x402:pending:[{](0x[0-9a-f]{40})[}]:0x[0-9a-f]{64}$/)
  if (!providerMatch || !pendingMatch || providerMatch[1] !== pendingMatch[1] || !isCircleTransferId(transferId) || (chainTxHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(chainTxHash))) return 'unavailable'
  const script = `
    local raw = redis.call('GET', KEYS[2])
    if not raw then return 'unavailable' end
    local settlement = cjson.decode(raw)
    if settlement.status == 'confirmed' then
      if settlement.transferId == ARGV[1] then return 'already_confirmed' end
      return 'unavailable'
    end
    if settlement.status ~= 'pending' then return 'unavailable' end
    local ledgerRaw = redis.call('GET', KEYS[1])
    if not ledgerRaw then return 'unavailable' end
    local data = cjson.decode(ledgerRaw)
    local amount = tonumber(settlement.amountMicros) / 1000000
    if (tonumber(data.pendingUsdc) or 0) + 0.0000001 < amount then return 'unavailable' end
    data.pendingUsdc = math.floor(((tonumber(data.pendingUsdc) or 0) - amount) * 1000000 + 0.5) / 1000000
    data.totalUsdcEarned = math.floor(((tonumber(data.totalUsdcEarned) or 0) + amount) * 1000000 + 0.5) / 1000000
    data.unclaimedEarningsUsdc = math.floor(((tonumber(data.unclaimedEarningsUsdc) or 0) + amount) * 1000000 + 0.5) / 1000000
    settlement.status = 'confirmed'
    settlement.transferId = ARGV[1]
    settlement.chainTxHash = ARGV[2] ~= '' and ARGV[2] or nil
    redis.call('SET', KEYS[1], cjson.encode(data))
    redis.call('SET', KEYS[2], cjson.encode(settlement), 'EX', 2592000)
    return 'confirmed'
  `
  if (getRestConfig()) {
    try {
      const result = await execRest(['EVAL', script, 2, providerKey, pendingKey, transferId, chainTxHash || ''])
      if (result === 'confirmed' || result === 'already_confirmed') return result
    } catch (err) { console.warn('[redisStorage] Upstash pending settlement confirmation failed:', err) }
  }
  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const result = await client.eval(script, 2, providerKey, pendingKey, transferId, chainTxHash || '')
      if (result === 'confirmed' || result === 'already_confirmed') return result
    }
  } catch (err) { console.warn('[redisStorage] ioredis pending settlement confirmation failed:', err) }

  if (getEnv('NODE_ENV') === 'production') return 'unavailable'
  const pendingItem = memoryStore.get(pendingKey)
  const ledgerItem = memoryStore.get(providerKey)
  if (!pendingItem || !ledgerItem) return 'unavailable'
  let settlement: PendingProviderSettlement
  let ledger: ProviderLedger
  try {
    settlement = JSON.parse(pendingItem.value)
    ledger = { totalCallsServed: 0, totalUsdcEarned: 0, unclaimedEarningsUsdc: 0, pendingUsdc: 0, withdrawnUsdc: 0, ...JSON.parse(ledgerItem.value) }
  } catch { return 'unavailable' }
  if (settlement.status === 'confirmed') return settlement.transferId === transferId ? 'already_confirmed' : 'unavailable'
  if (settlement.status !== 'pending') return 'unavailable'
  const amount = settlement.amountMicros / 1e6
  if (ledger.pendingUsdc + 1e-7 < amount) return 'unavailable'
  ledger.pendingUsdc = Number((ledger.pendingUsdc - amount).toFixed(6))
  ledger.totalUsdcEarned = Number((ledger.totalUsdcEarned + amount).toFixed(6))
  ledger.unclaimedEarningsUsdc = Number((ledger.unclaimedEarningsUsdc + amount).toFixed(6))
  settlement.status = 'confirmed'
  settlement.transferId = transferId
  settlement.chainTxHash = chainTxHash
  memoryStore.set(providerKey, { value: JSON.stringify(ledger) })
  memoryStore.set(pendingKey, { value: JSON.stringify(settlement), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 })
  return 'confirmed'
}

/** Removes a failed/never-charged Gateway transfer from pending without crediting provider income. */
export async function kvFailPendingProviderSettlement(
  providerKey: string,
  pendingKey: string,
  transferId: string,
): Promise<'failed' | 'already_failed' | 'already_confirmed' | 'unavailable'> {
  const providerMatch = providerKey.match(/^arcis:x402:provider:[{](0x[0-9a-f]{40})[}]$/)
  const pendingMatch = pendingKey.match(/^arcis:x402:pending:[{](0x[0-9a-f]{40})[}]:0x[0-9a-f]{64}$/)
  if (!providerMatch || !pendingMatch || providerMatch[1] !== pendingMatch[1] || !isCircleTransferId(transferId)) return 'unavailable'
  const script = `
    local raw = redis.call('GET', KEYS[2])
    if not raw then return 'unavailable' end
    local settlement = cjson.decode(raw)
    if settlement.status == 'failed' then
      if settlement.transferId == ARGV[1] then return 'already_failed' end
      return 'unavailable'
    end
    if settlement.status == 'confirmed' then
      if settlement.transferId == ARGV[1] then return 'already_confirmed' end
      return 'unavailable'
    end
    if settlement.status ~= 'pending' then return 'unavailable' end
    local ledgerRaw = redis.call('GET', KEYS[1])
    if not ledgerRaw then return 'unavailable' end
    local data = cjson.decode(ledgerRaw)
    local amount = tonumber(settlement.amountMicros) / 1000000
    if (tonumber(data.pendingUsdc) or 0) + 0.0000001 < amount then return 'unavailable' end
    data.pendingUsdc = (tonumber(data.pendingUsdc) or 0) - amount
    settlement.status = 'failed'
    settlement.transferId = ARGV[1]
    settlement.failureReason = 'Circle Gateway reported failed; no provider earnings credited.'
    redis.call('SET', KEYS[1], cjson.encode(data))
    redis.call('SET', KEYS[2], cjson.encode(settlement), 'EX', 2592000)
    return 'failed'
  `
  if (getRestConfig()) {
    try {
      const result = await execRest(['EVAL', script, 2, providerKey, pendingKey, transferId])
      if (result === 'failed' || result === 'already_failed' || result === 'already_confirmed') return result
    } catch (err) { console.warn('[redisStorage] Upstash failed settlement update failed:', err) }
  }
  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const result = await client.eval(script, 2, providerKey, pendingKey, transferId)
      if (result === 'failed' || result === 'already_failed' || result === 'already_confirmed') return result
    }
  } catch (err) { console.warn('[redisStorage] ioredis failed settlement update failed:', err) }
  if (getEnv('NODE_ENV') === 'production') return 'unavailable'

  const pendingItem = memoryStore.get(pendingKey)
  const ledgerItem = memoryStore.get(providerKey)
  if (!pendingItem || !ledgerItem) return 'unavailable'
  let settlement: PendingProviderSettlement
  let ledger: ProviderLedger
  try {
    settlement = JSON.parse(pendingItem.value)
    ledger = { totalCallsServed: 0, totalUsdcEarned: 0, unclaimedEarningsUsdc: 0, pendingUsdc: 0, withdrawnUsdc: 0, ...JSON.parse(ledgerItem.value) }
  } catch { return 'unavailable' }
  if (settlement.status === 'failed') return settlement.transferId === transferId ? 'already_failed' : 'unavailable'
  if (settlement.status === 'confirmed') return settlement.transferId === transferId ? 'already_confirmed' : 'unavailable'
  if (settlement.status !== 'pending') return 'unavailable'
  const amount = settlement.amountMicros / 1e6
  if (ledger.pendingUsdc + 1e-7 < amount) return 'unavailable'
  ledger.pendingUsdc = Number((ledger.pendingUsdc - amount).toFixed(6))
  settlement.status = 'failed'
  settlement.transferId = transferId
  settlement.failureReason = 'Circle Gateway reported failed; no provider earnings credited.'
  memoryStore.set(providerKey, { value: JSON.stringify(ledger) })
  memoryStore.set(pendingKey, { value: JSON.stringify(settlement), expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 })
  return 'failed'
}

/** Atomically applies provider earnings/withdrawal deltas to the shared JSON ledger record. */
export async function kvUpdateProviderLedger(
  key: string,
  delta: { calls?: number; earnedMicros?: number; withdrawMicros?: number; idempotencyKey?: string }
): Promise<ProviderLedgerDeltaResult> {
  const calls = Math.max(0, Math.trunc(delta.calls || 0))
  const earnedMicros = Math.max(0, Math.trunc(delta.earnedMicros || 0))
  const withdrawMicros = Math.max(0, Math.trunc(delta.withdrawMicros || 0))
  const idempotencyKey = delta.idempotencyKey || ''
  if (!calls && !earnedMicros && !withdrawMicros) return { status: 'unavailable' }
  if (idempotencyKey && !/^arcis:x402:settlement:\{0x[0-9a-f]{40}\}:0x[0-9a-f]{64}$/.test(idempotencyKey)) {
    return { status: 'unavailable' }
  }
  const script = `
    local raw = redis.call('GET', KEYS[1])
    if KEYS[2] and KEYS[2] ~= '' and KEYS[2] ~= KEYS[1] and redis.call('EXISTS', KEYS[2]) == 1 then
      return cjson.encode({status='duplicate'})
    end
    local data = raw and cjson.decode(raw) or {}
    local calls = tonumber(data.totalCallsServed) or 0
    local pending = math.floor((tonumber(data.pendingUsdc) or 0) * 1000000 + 0.5)
    local earned = math.floor((tonumber(data.totalUsdcEarned) or 0) * 1000000 + 0.5)
    local unclaimed = math.floor((tonumber(data.unclaimedEarningsUsdc) or 0) * 1000000 + 0.5)
    local withdrawn = math.floor((tonumber(data.withdrawnUsdc) or 0) * 1000000 + 0.5)
    if unclaimed < tonumber(ARGV[3]) then
      data.totalCallsServed = calls
      data.totalUsdcEarned = earned / 1000000
      data.pendingUsdc = pending / 1000000
      data.unclaimedEarningsUsdc = unclaimed / 1000000
      data.withdrawnUsdc = withdrawn / 1000000
      return cjson.encode({status='insufficient', ledger=data})
    end
    calls = calls + tonumber(ARGV[1])
    earned = earned + tonumber(ARGV[2])
    unclaimed = unclaimed + tonumber(ARGV[2]) - tonumber(ARGV[3])
    withdrawn = withdrawn + tonumber(ARGV[3])
    data.totalCallsServed = calls
    data.totalUsdcEarned = earned / 1000000
    data.pendingUsdc = pending / 1000000
    data.unclaimedEarningsUsdc = unclaimed / 1000000
    data.withdrawnUsdc = withdrawn / 1000000
    redis.call('SET', KEYS[1], cjson.encode(data))
    if KEYS[2] and KEYS[2] ~= '' and KEYS[2] ~= KEYS[1] then redis.call('SET', KEYS[2], '1', 'EX', 604800) end
    return cjson.encode({status='updated', ledger=data})
  `
  const parseResult = (raw: unknown): ProviderLedgerDeltaResult | null => {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (parsed?.status === 'duplicate') return { status: 'duplicate' }
      if (parsed?.status === 'updated' || parsed?.status === 'insufficient') {
        return { status: parsed.status, ledger: parsed.ledger }
      }
    } catch {}
    return null
  }

  if (getRestConfig()) {
    try {
      const result = parseResult(await execRest([
        'EVAL', script, idempotencyKey ? 2 : 1, key,
        ...(idempotencyKey ? [idempotencyKey] : []),
        calls, earnedMicros, withdrawMicros,
      ]))
      if (result) return result
    } catch (err) {
      console.warn(`[redisStorage] Upstash atomic provider update failed for "${key}":`, err)
    }
  }

  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const result = parseResult(await client.eval(
        script,
        idempotencyKey ? 2 : 1,
        key,
        ...(idempotencyKey ? [idempotencyKey] : []),
        calls,
        earnedMicros,
        withdrawMicros
      ))
      if (result) return result
    }
  } catch (err) {
    console.warn(`[redisStorage] ioredis atomic provider update failed for "${key}":`, err)
  }

  if (getEnv('NODE_ENV') === 'production') return { status: 'unavailable' }
  const item = memoryStore.get(key)
  if (idempotencyKey) {
    const idempotencyItem = memoryStore.get(idempotencyKey)
    if (idempotencyItem && (!idempotencyItem.expiresAt || idempotencyItem.expiresAt > Date.now())) return { status: 'duplicate' }
  }
  let ledger = { totalCallsServed: 0, totalUsdcEarned: 0, unclaimedEarningsUsdc: 0, pendingUsdc: 0, withdrawnUsdc: 0 }
  if (item && (!item.expiresAt || item.expiresAt > Date.now())) {
    try { ledger = { ...ledger, ...JSON.parse(item.value) } } catch {}
  }
  const unclaimedMicros = Math.round(ledger.unclaimedEarningsUsdc * 1e6)
  if (unclaimedMicros < withdrawMicros) return { status: 'insufficient', ledger }
  ledger = {
    totalCallsServed: ledger.totalCallsServed + calls,
    totalUsdcEarned: Number((ledger.totalUsdcEarned + earnedMicros / 1e6).toFixed(6)),
    pendingUsdc: Number((ledger.pendingUsdc || 0).toFixed(6)),
    unclaimedEarningsUsdc: Number(((unclaimedMicros + earnedMicros - withdrawMicros) / 1e6).toFixed(6)),
    withdrawnUsdc: Number((ledger.withdrawnUsdc + withdrawMicros / 1e6).toFixed(6)),
  }
  memoryStore.set(key, { value: JSON.stringify(ledger) })
  if (idempotencyKey) memoryStore.set(idempotencyKey, { value: '1', expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 })
  return { status: 'updated', ledger }
}

export async function kvSet(key: string, value: string, exSeconds?: number): Promise<boolean> {
  let saved = false

  // 1. Try Upstash REST
  if (getRestConfig()) {
    try {
      const cmd = exSeconds && exSeconds > 0
        ? ['SET', key, value, 'EX', exSeconds]
        : ['SET', key, value]
      const res = await execRest(cmd)
      if (res === 'OK') {
        saved = true
      }
    } catch (err) {
      console.warn(`[redisStorage] Upstash REST SET failed for "${key}":`, err)
    }
  }

  // 2. Try ioredis TCP/TLS if not saved
  if (!saved) {
    try {
      const client = await getIoredisClient()
      if (client && ioredisAvailable) {
        if (exSeconds && exSeconds > 0) {
          await client.setex(key, exSeconds, value)
        } else {
          await client.set(key, value)
        }
        saved = true
      }
    } catch (err) {
      console.warn(`[redisStorage] ioredis SET failed for "${key}":`, err)
    }
  }

  // 3. Always mirror to in-memory store for resilience
  const expiresAt = exSeconds && exSeconds > 0 ? Date.now() + exSeconds * 1000 : undefined
  memoryStore.set(key, { value, expiresAt })

  return saved
}

/**
 * Delete a key from storage.
 */
/** Deletes a lock key only if its value still matches the caller's token. */
export async function kvDelIfValue(key: string, expectedValue: string): Promise<boolean> {
  const script = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end"
  if (getRestConfig()) {
    try {
      const result = await execRest(['EVAL', script, 1, key, expectedValue])
      if (typeof result === 'number') return result === 1
    } catch (err) {
      console.warn(`[redisStorage] Upstash compare-and-delete failed for \"${key}\":`, err)
    }
  }
  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) return (await client.eval(script, 1, key, expectedValue)) === 1
  } catch (err) {
    console.warn(`[redisStorage] ioredis compare-and-delete failed for \"${key}\":`, err)
  }
  if (getEnv('NODE_ENV') === 'production') return false
  const item = memoryStore.get(key)
  if (item?.value === expectedValue) {
    memoryStore.delete(key)
    return true
  }
  return false
}

export async function kvDel(key: string): Promise<boolean> {
  let deleted = false

  if (getRestConfig()) {
    try {
      await execRest(['DEL', key])
      deleted = true
    } catch {}
  }

  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      await client.del(key)
      deleted = true
    }
  } catch {}

  memoryStore.delete(key)
  return deleted
}

/**
 * Get remaining TTL for a key in seconds (-1 if no expiry, -2 if not found).
 */
export async function kvTtl(key: string): Promise<number> {
  if (getRestConfig()) {
    try {
      const res = await execRest(['TTL', key])
      return typeof res === 'number' ? res : -1
    } catch {}
  }

  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const ttl = await client.ttl(key)
      return ttl
    }
  } catch {}

  const item = memoryStore.get(key)
  if (!item) return -2
  if (!item.expiresAt) return -1
  const remaining = Math.max(0, Math.round((item.expiresAt - Date.now()) / 1000))
  return remaining
}

/**
 * Atomic increment for rate-limiting.
 */
export async function kvIncr(
  key: string,
  expireSeconds = 60
): Promise<{ current: number; ttl: number }> {
  if (getRestConfig()) {
    try {
      const current = await execRest(['INCR', key])
      if (current === 1 && expireSeconds > 0) {
        await execRest(['EXPIRE', key, expireSeconds])
      }
      const ttl = await execRest(['TTL', key])
      return {
        current: Number(current) || 1,
        ttl: typeof ttl === 'number' && ttl > 0 ? ttl : expireSeconds,
      }
    } catch (err) {
      console.warn(`[redisStorage] Upstash REST INCR failed for "${key}":`, err)
    }
  }

  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      const current = await client.incr(key)
      if (current === 1 && expireSeconds > 0) {
        await client.expire(key, expireSeconds)
      }
      const ttl = await client.ttl(key)
      return {
        current: Number(current) || 1,
        ttl: ttl > 0 ? ttl : expireSeconds,
      }
    }
  } catch {}

  // In-memory fallback
  const now = Date.now()
  let entry = memoryCounters.get(key)
  if (!entry || entry.expiresAt <= now) {
    entry = { count: 1, expiresAt: now + expireSeconds * 1000 }
    memoryCounters.set(key, entry)
    return { current: 1, ttl: expireSeconds }
  }

  entry.count += 1
  const ttl = Math.max(1, Math.round((entry.expiresAt - now) / 1000))
  return { current: entry.count, ttl }
}

/**
 * Check whether a live remote storage (Upstash REST or ioredis) is available.
 */
export async function isStorageAvailable(): Promise<boolean> {
  if (getRestConfig()) {
    try {
      const pong = await execRest(['PING'])
      if (pong === 'PONG') return true
    } catch {}
  }

  try {
    const client = await getIoredisClient()
    if (client && ioredisAvailable) {
      return true
    }
  } catch {}

  return false
}

export function getStorageDriver(): 'upstash-rest' | 'ioredis' | 'memory' {
  if (getRestConfig()) return 'upstash-rest'
  if (ioredisAvailable) return 'ioredis'
  return 'memory'
}
