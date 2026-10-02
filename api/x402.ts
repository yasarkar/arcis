// api/x402.ts
// Vite Dev Server SSR & Vercel Serverless Tollgate Endpoint for x402 AI Services & Nanopayments
// Implements F2 Tollgate Dispatcher, Invariant Guards, EIP-3009 ecrecover verification,
// Two-Phase Settlement (Commit vs Void), and F3 Provider Ledger & Withdrawal.

import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import {
  recoverTypedDataAddress,
  getAddress,
  isAddress,
  type Hex,
  type Address,
} from 'viem'
import { arcTestnet, ARC_TESTNET_TOKENS } from '../src/config/arcChain'
import { OFFICIAL_MANIFESTS } from '../src/config/x402/manifests'
import {
  GATEWAY_BATCHED_DOMAIN,
  DEFAULT_X402_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
  X402_SCHEMES,
  X402_NETWORKS,
} from '../src/config/x402/schemes'
import { usdcToBaseUnits } from '../src/config/x402/pricing'
import { generateLiveServiceData } from '../src/services/aiServicesDataProvider'
import {
  kvGet,
  kvSet,
  kvDelIfValue,
  kvSetIfAbsent,
  getStorageDriver,
  kvUpdateProviderLedger,
  kvCreateProviderSettlementIntent,
  kvMarkProviderSettlementAccepted,
  kvRejectProviderSettlementIntent,
  kvGetPendingProviderSettlement,
  kvConfirmPendingProviderSettlement,
  kvFailPendingProviderSettlement,
} from './_utils/redisStorage'
import {
  X402_AUTHORIZATION_DOMAIN,
  SERVICE_REGISTRATION_TYPES,
  PROVIDER_LEDGER_TYPES,
  hashServiceManifest,
} from '../src/config/x402/authorization'
import type {
  ServiceManifest,
  PaymentReceipt,
  X402PaymentRequirements,
  X402ExecutionReceipt,
  ProviderLedger,
} from '../src/types/x402'

// In-memory fallback stores for non-KV / isolated environments
const serverNonceStore = new Set<string>()
const serverUsedAuthorizationNonces = new Set<string>()

function providerLedgerKey(providerAddress: string): string {
  return `arcis:x402:provider:{${providerAddress.toLowerCase()}}`
}

const serverProviderStore = new Map<string, {
  totalCallsServed: number
  totalUsdcEarned: number
  unclaimedEarningsUsdc: number
  pendingUsdc: number
  withdrawnUsdc: number
}>()

function parseAuthorizationInteger(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new Error('Invalid authorization integer')
  }
  const text = String(value)
  if (!/^(0|[1-9][0-9]{0,77})$/.test(text)) throw new Error('Invalid authorization integer')
  return BigInt(text)
}

function isGatewayPaymentOption(option: unknown, providerAddress: string, amount: string): option is Record<string, any> {
  if (!isRecord(option) || !isRecord(option.extra)) return false
  return option.scheme === X402_SCHEMES.EXACT &&
    option.network === X402_NETWORKS.CAIP2_ARC_TESTNET &&
    typeof option.asset === 'string' && option.asset.toLowerCase() === ARC_TESTNET_TOKENS.USDC.toLowerCase() &&
    typeof option.payTo === 'string' && option.payTo.toLowerCase() === providerAddress.toLowerCase() &&
    String(option.amount) === amount &&
    option.maxTimeoutSeconds === CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS &&
    option.extra.name === CIRCLE_BATCHING_METADATA.NAME &&
    option.extra.version === CIRCLE_BATCHING_METADATA.VERSION &&
    typeof option.extra.verifyingContract === 'string' &&
    option.extra.verifyingContract.toLowerCase() === GATEWAY_CONTRACTS.testnet.gatewayWallet.toLowerCase()
}

function safeEqualSecret(received: string, expected: string): boolean {
  const receivedBytes = Buffer.from(received)
  const expectedBytes = Buffer.from(expected)
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
}

function pendingSettlementKey(providerAddress: string, nonce: string): string {
  return `arcis:x402:pending:{${providerAddress.toLowerCase()}}:${nonce.toLowerCase()}`
}

function parseGatewayUsdcMicros(value: unknown): number | null {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const micros = BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6))
  return micros <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(micros) : null
}

function safeChecksumAddress(addr: string): Address {
  try {
    return getAddress(addr.toLowerCase())
  } catch {
    return '0x0000000000000000000000000000000000000000' as Address
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): value is Record<string, any> {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key))
}

function validateSchemaObject(value: unknown): boolean {
  if (!hasOnlyKeys(value, ['type', 'required', 'properties', 'additionalProperties', 'description', 'title'])) return false
  if (value.type !== 'object' || value.additionalProperties !== false) return false
  if (value.required !== undefined && (!Array.isArray(value.required) || value.required.length > 20 || value.required.some((key: unknown) => typeof key !== 'string'))) return false
  if (value.properties !== undefined) {
    if (!isRecord(value.properties) || Object.keys(value.properties).length > 20) return false
    for (const [key, property] of Object.entries(value.properties)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || !hasOnlyKeys(property, ['type', 'enum', 'minimum', 'maximum', 'description', 'default'])) return false
      if (!['string', 'number', 'integer', 'boolean'].includes(property.type)) return false
      if (property.enum !== undefined && (!Array.isArray(property.enum) || property.enum.length > 50 || property.enum.some((item: unknown) => !['string', 'number', 'boolean'].includes(typeof item)))) return false
      if (property.minimum !== undefined && (typeof property.minimum !== 'number' || !Number.isFinite(property.minimum))) return false
      if (property.maximum !== undefined && (typeof property.maximum !== 'number' || !Number.isFinite(property.maximum))) return false
      if (property.minimum !== undefined && property.maximum !== undefined && property.minimum > property.maximum) return false
      if (property.description !== undefined && (typeof property.description !== 'string' || property.description.length > 500)) return false
    }
  }
  return true
}

function validateUiField(field: unknown, properties: Record<string, any>): boolean {
  if (!hasOnlyKeys(field, ['name', 'label', 'type', 'defaultValue', 'options', 'description', 'required'])) return false
  if (typeof field.name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field.name) || !Object.prototype.hasOwnProperty.call(properties, field.name)) return false
  if (typeof field.label !== 'string' || field.label.length > 100 || !['string', 'number', 'select', 'boolean'].includes(field.type)) return false
  if (typeof field.description !== 'string' || field.description.length > 500 || typeof field.required !== 'boolean') return false
  if (field.defaultValue !== undefined && !['string', 'number', 'boolean'].includes(typeof field.defaultValue)) return false
  if (field.options !== undefined) {
    if (!Array.isArray(field.options) || field.options.length === 0 || field.options.length > 50) return false
    if (!field.options.every((option: unknown) => hasOnlyKeys(option, ['label', 'value']) && typeof option.label === 'string' && ['string', 'number', 'boolean'].includes(typeof option.value))) return false
  }
  return true
}

function validateCommunityManifest(value: unknown): value is ServiceManifest {
  try {
    const manifest: any = value
    const topKeys = ['id', 'version', 'name', 'tagline', 'category', 'engine', 'description', 'listing', 'provider', 'pricing', 'accepts', 'serve', 'upstream', 'requestSchema', 'responseSchema', 'ui', 'examples', 'sla', 'healthcheckUrl', 'agentPrompts', 'tags']
    if (!hasOnlyKeys(manifest, topKeys) || Object.keys(manifest).length < 18 || Object.keys(manifest).some((key) => manifest[key] === undefined)) return false
    if (!isRecord(manifest.listing) || !isRecord(manifest.provider) || !isRecord(manifest.pricing) || !isRecord(manifest.serve) || !isRecord(manifest.upstream) || !isRecord(manifest.ui) || !isRecord(manifest.examples) || !isRecord(manifest.sla)) return false
    if (!hasOnlyKeys(manifest.listing, ['kind', 'ownerAddress', 'createdAt']) || manifest.listing.kind !== 'community') return false
    if (!hasOnlyKeys(manifest.provider, ['name', 'address', 'isVerified', 'reputationScore']) || manifest.provider.isVerified !== false || manifest.provider.verifiedAt !== undefined) return false
    if (!hasOnlyKeys(manifest.pricing, ['model', 'priceUsdc', 'maxAmountUsdc', 'protocolFeeBps']) || manifest.pricing.model !== 'per_call' || manifest.pricing.protocolFeeBps !== 0) return false
    if (!hasOnlyKeys(manifest.serve, ['method', 'path']) || !hasOnlyKeys(manifest.upstream, ['url', 'method'])) return false
    if (!hasOnlyKeys(manifest.ui, ['form']) || !Array.isArray(manifest.ui.form) || manifest.ui.form.length > 20) return false
    if (!Array.isArray(manifest.accepts) || manifest.accepts.length !== 1 || !isRecord(manifest.accepts[0])) return false
    const accepted = manifest.accepts[0]
    if (!hasOnlyKeys(accepted, ['scheme', 'network', 'asset', 'payTo', 'amount', 'maxTimeoutSeconds', 'extra', 'domain'])) return false
    if (!isRecord(accepted.extra) || !isRecord(accepted.domain)) return false
    if (!hasOnlyKeys(accepted.extra, ['name', 'version', 'verifyingContract']) || !hasOnlyKeys(accepted.domain, ['name', 'version', 'chainId', 'verifyingContract'])) return false
    if (typeof accepted.domain.name !== 'string' || typeof accepted.domain.version !== 'string' || typeof accepted.domain.chainId !== 'number' || typeof accepted.domain.verifyingContract !== 'string') return false
    if (typeof accepted.extra.name !== 'string' || typeof accepted.extra.version !== 'string' || typeof accepted.extra.verifyingContract !== 'string') return false
    if (!hasOnlyKeys(manifest.examples, ['request', 'response']) || !isRecord(manifest.examples.request) || !isRecord(manifest.examples.response)) return false
    if (Object.keys(manifest.examples.request).length > 50 || Object.keys(manifest.examples.response).length > 50) return false
    if (!hasOnlyKeys(manifest.sla, ['p95LatencyMs', 'uptimePct', 'successRate'])) return false
    if (!hasOnlyKeys(manifest.ui.form[0] || {}, ['name', 'label', 'type', 'defaultValue', 'options', 'description', 'required']) && manifest.ui.form.length > 0) return false
    if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(manifest.id)) return false
    if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) return false
    if (typeof manifest.name !== 'string' || manifest.name.trim().length < 2 || manifest.name.length > 100 || manifest.name.includes('<')) return false
    if (typeof manifest.tagline !== 'string' || manifest.tagline.length > 160 || manifest.tagline.includes('<')) return false
    if (typeof manifest.description !== 'string' || manifest.description.length > 2000 || /javascript:/i.test(manifest.description)) return false
    if (!['Arbitrage', 'Liquidity & Routing', 'Yield & Flash-Loan', 'MEV & Security', 'Cross-Chain Gateway', 'Agent & Copilot', 'Automation', 'Risk & Compliance', 'Payments & Invoicing', 'Reporting & Tax', 'Data & Oracles'].includes(manifest.category)) return false
    if (!isAddress(manifest.provider.address) || !isAddress(manifest.listing.ownerAddress) || manifest.provider.address.toLowerCase() !== manifest.listing.ownerAddress.toLowerCase()) return false
    if (typeof manifest.provider.name !== 'string' || manifest.provider.name.trim().length < 2 || manifest.provider.name.length > 100) return false
    if (manifest.provider.reputationScore !== undefined && (typeof manifest.provider.reputationScore !== 'number' || !Number.isFinite(manifest.provider.reputationScore) || manifest.provider.reputationScore < 0 || manifest.provider.reputationScore > 100)) return false
    if (!Number.isSafeInteger(manifest.listing.createdAt) || manifest.listing.createdAt < 0 || manifest.listing.createdAt > Date.now()) return false
    if (typeof manifest.pricing.priceUsdc !== 'number' || !Number.isFinite(manifest.pricing.priceUsdc) || manifest.pricing.priceUsdc < 0.001 || manifest.pricing.priceUsdc > 1 || Math.round(manifest.pricing.priceUsdc * 1e6) / 1e6 !== manifest.pricing.priceUsdc) return false
    if (typeof manifest.pricing.maxAmountUsdc !== 'number' || !Number.isFinite(manifest.pricing.maxAmountUsdc) || manifest.pricing.maxAmountUsdc !== manifest.pricing.priceUsdc) return false
    if (manifest.engine !== 'proxy' || manifest.serve.method !== 'POST' || manifest.serve.path !== `/api/x402/${manifest.id}` || manifest.upstream.method !== 'POST' || typeof manifest.upstream.url !== 'string' || manifest.upstream.url.length > 2048 || manifest.upstream.url.includes('#') || manifest.upstream.url.includes('\\')) return false
    if (!isSafePublicHttpsUrl(manifest.upstream.url)) return false
    if (!hasOnlyKeys(manifest.requestSchema, ['type', 'required', 'properties', 'additionalProperties', 'description', 'title']) || !validateSchemaObject(manifest.requestSchema) || (manifest.responseSchema !== undefined && (!hasOnlyKeys(manifest.responseSchema, ['type', 'required', 'properties', 'additionalProperties', 'description', 'title']) || !validateSchemaObject(manifest.responseSchema)))) return false
    if ((manifest.requestSchema.required || []).some((key: string) => !Object.prototype.hasOwnProperty.call(manifest.requestSchema.properties || {}, key))) return false
    if (new Set(manifest.requestSchema.required || []).size !== (manifest.requestSchema.required || []).length) return false
    if (Object.keys(manifest.examples.request).some((key) => !Object.prototype.hasOwnProperty.call(manifest.requestSchema.properties || {}, key))) return false
    if (Object.keys(manifest.examples.response).length > 50) return false
    if (!manifest.ui.form.every((field: unknown) => validateUiField(field, manifest.requestSchema.properties || {}))) return false
    if (!Array.isArray(manifest.tags) || manifest.tags.length === 0 || manifest.tags.length > 20 || manifest.tags.some((tag: unknown) => typeof tag !== 'string' || tag.length === 0 || tag.length > 40 || /[\r\n<>]/.test(tag))) return false
    if (manifest.agentPrompts !== undefined && (!Array.isArray(manifest.agentPrompts) || manifest.agentPrompts.length > 20 || manifest.agentPrompts.some((prompt: unknown) => typeof prompt !== 'string' || prompt.length > 300))) return false
    if (typeof manifest.sla.p95LatencyMs !== 'number' || !Number.isFinite(manifest.sla.p95LatencyMs) || manifest.sla.p95LatencyMs < 0 || manifest.sla.p95LatencyMs > 86_400_000 || typeof manifest.sla.uptimePct !== 'number' || !Number.isFinite(manifest.sla.uptimePct) || manifest.sla.uptimePct < 0 || manifest.sla.uptimePct > 100 || typeof manifest.sla.successRate !== 'number' || !Number.isFinite(manifest.sla.successRate) || manifest.sla.successRate < 0 || manifest.sla.successRate > 100) return false
    if (manifest.healthcheckUrl !== undefined && (typeof manifest.healthcheckUrl !== 'string' || !/^\/api\/x402\/health(?:\/[a-z0-9-]+)?$/.test(manifest.healthcheckUrl) || manifest.healthcheckUrl.includes('..') || manifest.healthcheckUrl.length > 256)) return false
    if (accepted.scheme !== X402_SCHEMES.EXACT || (accepted.network !== X402_NETWORKS.CAIP2_ARC_TESTNET && accepted.network !== X402_NETWORKS.ARC_TESTNET) || (accepted.asset !== 'USDC' && accepted.asset.toLowerCase() !== ARC_TESTNET_TOKENS.USDC.toLowerCase()) || !isAddress(accepted.payTo) || accepted.payTo.toLowerCase() !== manifest.provider.address.toLowerCase()) return false
    if (accepted.domain.chainId !== arcTestnet.id || accepted.domain.name !== DEFAULT_X402_DOMAIN.name || accepted.domain.version !== DEFAULT_X402_DOMAIN.version || typeof accepted.domain.verifyingContract !== 'string' || accepted.domain.verifyingContract.toLowerCase() !== ARC_TESTNET_TOKENS.USDC.toLowerCase()) return false
    if (accepted.extra.name !== CIRCLE_BATCHING_METADATA.NAME || accepted.extra.version !== CIRCLE_BATCHING_METADATA.VERSION || typeof accepted.extra.verifyingContract !== 'string' || accepted.extra.verifyingContract.toLowerCase() !== GATEWAY_CONTRACTS.testnet.gatewayWallet.toLowerCase()) return false
    if (accepted.amount !== usdcToBaseUnits(manifest.pricing.priceUsdc) || accepted.maxTimeoutSeconds !== CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS) return false
    if (JSON.stringify(manifest).length > 50_000) return false
    return true
  } catch {
    return false
  }
}

function isPublicIpAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number)
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || c === 51)) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 255 && b === 255 && c === 255)
    )
  }
  if (version === 6) {
    const normalized = address.toLowerCase().split('%')[0]
    const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mappedIpv4) return isPublicIpAddress(mappedIpv4[1])
    return /^[23][0-9a-f]{3}:/i.test(normalized) && !normalized.startsWith('2001:db8:') && !normalized.startsWith('2001:0:') && !normalized.startsWith('2002:')
  }
  return false
}

function isSafePublicHttpsUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test')) return false
    if (isIP(host) && !isPublicIpAddress(host)) return false
    const allowedHosts = (process.env.X402_UPSTREAM_HOST_ALLOWLIST || '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean)
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}

async function fetchCommunityUpstreamJson(rawUrl: string, requestBody: unknown, headers: Record<string, string>) {
  const url = new URL(rawUrl)
  if (!isSafePublicHttpsUrl(rawUrl)) throw new Error('Community upstream is not allowlisted')
  const serializedBody = JSON.stringify(requestBody)
  return await new Promise<{ ok: boolean; status: number; data: unknown }>((resolve, reject) => {
    const req = httpsRequest(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(serializedBody), 'Accept-Encoding': 'identity' },
      timeout: 10_000,
      lookup: (hostname: string, options: any, callback: (error: Error | null, address?: any, family?: number) => void) => {
        lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
          if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) return callback(new Error('Upstream DNS resolved to a non-public address'))
          const chosen = addresses[0]
          if (options?.all) callback(null, [{ address: chosen.address, family: chosen.family }])
          else callback(null, chosen.address, chosen.family)
        }).catch(callback)
      },
    } as any, (res) => {
      const chunks: Buffer[] = []
      let totalBytes = 0
      res.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        totalBytes += buffer.length
        if (totalBytes > 1_000_000) return req.destroy(new Error('Upstream response exceeds 1 MB limit'))
        chunks.push(buffer)
      })
      res.on('end', () => {
        let data: unknown
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { return reject(new Error('Upstream returned invalid JSON')) }
        const status = res.statusCode || 500
        resolve({ ok: status >= 200 && status < 300, status, data })
      })
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('Community upstream request timed out')))
    req.on('error', reject)
    req.end(serializedBody)
  })
}

function createPaymentRequirements(manifest: ServiceManifest): X402PaymentRequirements {
  const amount = usdcToBaseUnits(manifest.pricing.priceUsdc)
  const providerAddress = safeChecksumAddress(manifest.provider.address)
  const verifyingContract = safeChecksumAddress((manifest.accepts[0]?.extra?.verifyingContract as string) || GATEWAY_CONTRACTS.testnet.gatewayWallet)
  return {
    x402Version: 2,
    accepts: [{
      scheme: X402_SCHEMES.EXACT,
      network: X402_NETWORKS.CAIP2_ARC_TESTNET,
      asset: ARC_TESTNET_TOKENS.USDC,
      payTo: providerAddress,
      amount,
      maxTimeoutSeconds: CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS,
      extra: { name: CIRCLE_BATCHING_METADATA.NAME, version: CIRCLE_BATCHING_METADATA.VERSION, verifyingContract },
    }],
  }
}

export function isX402ServiceResultAvailable(data: unknown): boolean {
  return Boolean(
    data &&
      typeof data === 'object' &&
      typeof (data as Record<string, unknown>).status === 'string' &&
      (data as Record<string, unknown>).status !== 'UNAVAILABLE'
  )
}

function createUnsettledPaymentResponse(params: {
  manifest: ServiceManifest
  payerAddress: Address
  signature: Hex
  nonce: Hex
  requirements: X402PaymentRequirements
  latencyMs: number
}): Response {
  const { manifest, payerAddress, signature, nonce, requirements, latencyMs } = params
  const providerAddress = safeChecksumAddress(manifest.provider.address)
  const payment: PaymentReceipt = {
    id: `rcpt_${Date.now()}`,
    idempotencyKey: `${manifest.id}:${payerAddress.toLowerCase()}:${nonce}`,
    payer: payerAddress,
    payTo: providerAddress,
    payerAddress,
    providerAddress,
    serviceId: manifest.id,
    serviceVersion: manifest.version,
    amountUsdc: 0,
    authorizedMaxUsdc: manifest.pricing.priceUsdc,
    scheme: 'exact',
    network: arcTestnet.name,
    authorizationSignature: signature,
    protocolFeeUsdc: 0,
    providerEarnedUsdc: 0,
    latencyMs,
    status: 'authorized',
    engineMode: 'gateway_batched',
    gasSponsored: false,
    createdAt: Date.now(),
  }
  return new Response(JSON.stringify({
    statusCode: 503,
    success: false,
    error: 'Circle Gateway did not accept the payment. No service result or provider credit was recorded.',
    executionTimeMs: latencyMs,
    costUsdc: 0,
    protocolFeeUsdc: 0,
    providerEarnedUsdc: 0,
    payment,
    requirements,
  }), { status: 503, headers: { 'Content-Type': 'application/json' } })
}

async function findManifest(serviceId: string): Promise<ServiceManifest | null> {
  const official = OFFICIAL_MANIFESTS.find((manifest) => manifest.id === serviceId)
  if (official) return official
  try {
    const customListJson = await kvGet('arcis:x402:custom_manifests')
    if (customListJson) {
      const customList: unknown = JSON.parse(customListJson)
      if (!Array.isArray(customList)) return null
      const found = customList.find((item) => isRecord(item) && item.id === serviceId)
      if (found && validateCommunityManifest(found)) return found
    }
  } catch (err) {
    console.warn('[x402-tollgate] Failed to fetch custom manifests:', err)
  }
  return null
}

function create402ChallengeResponse(manifest: ServiceManifest, message = 'Payment Required'): Response {
  const nonceHex: Hex = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
  const price = manifest.pricing.priceUsdc
  const baseUnits = usdcToBaseUnits(price)
  const requirements = createPaymentRequirements(manifest)
  const providerAddr = safeChecksumAddress(manifest.provider.address)
  const responseBody = {
    x402Version: 2,
    resource: { url: manifest.serve.path, description: manifest.description, mimeType: 'application/json' },
    error: message,
    statusCode: 402,
    serviceId: manifest.id,
    serviceName: manifest.name,
    pricing: manifest.pricing,
    requirements,
    challenge: {
      statusCode: 402,
      paymentRequired: true,
      token: 'USDC',
      recipient: providerAddr,
      amountUsdc: price,
      amountUnits: baseUnits.toString(),
      scheme: requirements.accepts[0].scheme,
      chainId: arcTestnet.id,
      nonce: nonceHex,
      validUntil: Date.now() + CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS * 1000,
    },
  }
  const paymentRequiredHeader = Buffer.from(JSON.stringify({
    x402Version: requirements.x402Version,
    resource: responseBody.resource,
    accepts: requirements.accepts,
  })).toString('base64')
  return new Response(JSON.stringify(responseBody), {
    status: 402,
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-REQUIRED': paymentRequiredHeader,
      'X-Payment-Required': 'true',
      'X-Payment-Token': 'USDC',
      'X-Payment-Amount': price.toString(),
      'X-Payment-Recipient': providerAddr,
      'X-Payment-Scheme': requirements.accepts[0].scheme,
      'X-Payment-ChainId': arcTestnet.id.toString(),
      'X-Payment-Nonce': nonceHex,
    },
  })
}

async function reconcileGatewaySettlement(req: Request, match: RegExpMatchArray): Promise<Response> {
  const expectedSecret = process.env.X402_RECONCILIATION_SECRET || ''
  const suppliedSecret = req.headers.get('x-x402-reconciliation-secret') || ''
  const authorization = req.headers.get('authorization') || ''
  const providedSecret = suppliedSecret || (authorization.startsWith('Bearer ') ? authorization.slice(7) : '')
  if (!expectedSecret || !providedSecret || !safeEqualSecret(providedSecret, expectedSecret)) {
    return new Response(JSON.stringify({ success: false, error: 'Reconciliation is unavailable without valid internal authorization.' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }
  const rawProvider = match[1]
  const rawNonce = match[2]
  if (!isAddress(rawProvider) || !/^0x[0-9a-fA-F]{64}$/.test(rawNonce)) return new Response(JSON.stringify({ success: false, error: 'Invalid provider address or authorization nonce.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  const providerAddress = safeChecksumAddress(rawProvider).toLowerCase()
  const nonce = rawNonce.toLowerCase()
  const providerKey = providerLedgerKey(providerAddress)
  const pendingKey = pendingSettlementKey(providerAddress, nonce)
  let pending: Awaited<ReturnType<typeof kvGetPendingProviderSettlement>>
  try { pending = await kvGetPendingProviderSettlement(pendingKey) } catch { return new Response(JSON.stringify({ success: false, error: 'Shared settlement storage is unavailable; no reconciliation was attempted.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }) }
  if (!pending || pending.providerAddress !== providerAddress || pending.nonce !== nonce) return new Response(JSON.stringify({ success: false, error: 'No matching Gateway settlement intent was found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  if (pending.status === 'confirmed' || pending.status === 'failed') return new Response(JSON.stringify({ success: true, status: pending.status, idempotent: true, pendingUsdc: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  try {
    const gatewayApi = 'https://gateway-api-testnet.circle.com'
    const query = new URLSearchParams({ nonce, network: X402_NETWORKS.CAIP2_ARC_TESTNET, token: 'USDC' })
    const transferResponse = await fetch(`${gatewayApi}/v1/x402/transfers?${query}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
    if (!transferResponse.ok) return new Response(JSON.stringify({ success: false, error: 'Circle transfer status is temporarily unavailable; pending balance was not changed.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    const transferBody = await transferResponse.json()
    const transfers = Array.isArray(transferBody?.transfers) ? transferBody.transfers : []
    const matching = transfers.filter((transfer: any) => isRecord(transfer) && typeof transfer.nonce === 'string' && transfer.nonce.toLowerCase() === nonce)
    if (matching.length !== 1) return new Response(JSON.stringify({ success: true, status: 'pending', pendingUsdc: pending.amountUsdc, transferFound: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    const transfer = matching[0]
    if (!['received', 'batched', 'confirmed', 'completed', 'failed'].includes(transfer.status)) return new Response(JSON.stringify({ success: false, error: 'Circle transfer status was not recognized; ledger was not changed.' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    const transferAmountMicros = parseGatewayUsdcMicros(transfer.amount)
    const exactMatch = transfer.token === 'USDC' && transfer.sendingNetwork === X402_NETWORKS.CAIP2_ARC_TESTNET && transfer.recipientNetwork === X402_NETWORKS.CAIP2_ARC_TESTNET && transfer.fromAddress?.toLowerCase() === pending.payerAddress && transfer.toAddress?.toLowerCase() === pending.providerAddress && transferAmountMicros === pending.amountMicros && typeof transfer.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transfer.id) && (!pending.settlementRef || pending.settlementRef === transfer.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pending.settlementRef))
    if (!exactMatch) return new Response(JSON.stringify({ success: false, error: 'Circle returned a transfer that does not exactly match the pending authorization; no ledger credit was applied.' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
    if (pending.status === 'settling') {
      const accepted = await kvMarkProviderSettlementAccepted(providerKey, pendingKey, transfer.id)
      if (accepted === 'unavailable') return new Response(JSON.stringify({ success: false, error: 'Circle transfer exists but durable provider accounting is unavailable; no balance was credited.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      pending = { ...pending, status: 'pending', settlementRef: transfer.id }
    }
    if (transfer.status === 'confirmed' || transfer.status === 'completed') {
      const result = await kvConfirmPendingProviderSettlement(providerKey, pendingKey, transfer.id, typeof transfer.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(transfer.txHash) ? transfer.txHash : undefined)
      if (result === 'unavailable') return new Response(JSON.stringify({ success: false, error: 'Shared atomic ledger storage is unavailable; reconciliation was not confirmed.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ success: true, status: 'confirmed', idempotent: result === 'already_confirmed', transferId: transfer.id, txHash: typeof transfer.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(transfer.txHash) ? transfer.txHash : undefined, pendingUsdc: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (transfer.status === 'failed') {
      const result = await kvFailPendingProviderSettlement(providerKey, pendingKey, transfer.id)
      if (result === 'unavailable') return new Response(JSON.stringify({ success: false, error: 'Shared atomic ledger storage is unavailable; failed settlement remains pending for manual review.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      return new Response(JSON.stringify({ success: true, status: result === 'already_confirmed' ? 'confirmed' : 'failed', pendingUsdc: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (!['received', 'batched'].includes(transfer.status)) return new Response(JSON.stringify({ success: false, error: 'Circle transfer status was not recognized; ledger was not changed.' }), { status: 502, headers: { 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ success: true, status: 'pending', circleStatus: transfer.status, pendingUsdc: pending.amountUsdc }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Circle transfer reconciliation failed; pending balance was not changed.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const pathname = url.pathname
  const reconcileMatch = pathname.match(/\/provider\/([^/]+)\/reconcile\/([^/]+)/)
  if (reconcileMatch) return new Response(JSON.stringify({ success: false, error: 'Reconciliation requires an authorized POST request.' }), { status: 405, headers: { 'Content-Type': 'application/json' } })
  if (pathname.endsWith('/services') || pathname.endsWith('/manifests')) {
    let allManifests = [...OFFICIAL_MANIFESTS]
    try {
      const customListJson = await kvGet('arcis:x402:custom_manifests')
      if (customListJson) {
        const customList: unknown = JSON.parse(customListJson)
        if (Array.isArray(customList)) allManifests = [...allManifests, ...customList.filter(validateCommunityManifest)]
      }
    } catch {}
    return new Response(JSON.stringify({ success: true, protocol: 'x402-Gateway-V1', chainId: arcTestnet.id, gasToken: arcTestnet.nativeCurrency.symbol, count: allManifests.length, services: allManifests }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (pathname.endsWith('/health')) {
    return new Response(JSON.stringify({ status: 'healthy', protocol: 'x402-Gateway-V1', network: arcTestnet.name, chainId: arcTestnet.id, timestamp: Date.now() }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const providerMatch = pathname.match(/\/provider\/([^/]+)/)
  if (providerMatch?.[1]) {
    const rawAddr = providerMatch[1]
    if (!isAddress(rawAddr)) return new Response(JSON.stringify({ error: 'Invalid provider address' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    const providerAddr = safeChecksumAddress(rawAddr).toLowerCase()
    let stats = serverProviderStore.get(providerAddr)
    try {
      const kvData = await kvGet(providerLedgerKey(providerAddr))
      if (kvData) stats = JSON.parse(kvData)
    } catch {}
    const ledger: ProviderLedger = {
      providerAddress: safeChecksumAddress(providerAddr),
      // The atomic provider ledger is wallet-wide. Until per-service dimensions are stored
      // atomically, do not copy provider totals onto every listed service.
      services: [],
      pendingUsdc: stats?.pendingUsdc || 0,
      availableUsdc: stats?.unclaimedEarningsUsdc || 0,
      withdrawnUsdc: stats?.withdrawnUsdc || 0,
    }
    return new Response(JSON.stringify({ success: true, ledger }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const serviceId = pathname.split('/').filter(Boolean).pop()
  if (serviceId) {
    const manifest = await findManifest(serviceId)
    if (manifest) return create402ChallengeResponse(manifest, 'Payment Required. Unpaid probe returned requirements.')
  }
  return new Response(JSON.stringify({ error: 'Endpoint not found', statusCode: 404 }), { status: 404, headers: { 'Content-Type': 'application/json' } })
}

export async function POST(req: Request): Promise<Response> {
  const startTime = performance.now()
  const pathname = new URL(req.url).pathname
  const reconcileMatch = pathname.match(/\/provider\/([^/]+)\/reconcile\/([^/]+)/)
  if (reconcileMatch) return reconcileGatewaySettlement(req, reconcileMatch)

  if (pathname.endsWith('/services') || pathname.endsWith('/register')) {
    try {
      const body: any = await req.json()
      if (!isRecord(body) || Object.keys(body).some((key) => !['manifest', 'owner', 'nonce', 'deadline', 'signature'].includes(key))) return new Response(JSON.stringify({ success: false, error: 'Unexpected registration fields are not allowed' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      const { manifest, owner: rawOwner, nonce: registrationNonce, deadline: rawDeadline, signature: registrationSignature } = body
      if (manifest !== undefined && !validateCommunityManifest(manifest)) return new Response(JSON.stringify({ success: false, error: 'Invalid or unsafe community manifest' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      if (manifest === undefined) return new Response(JSON.stringify({ success: false, error: 'Invalid or unsafe community manifest' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      if (!isAddress(rawOwner) || !registrationNonce || !/^0x[0-9a-fA-F]{64}$/.test(registrationNonce) || !/^0x[0-9a-fA-F]{130}$/.test(registrationSignature || '')) return new Response(JSON.stringify({ success: false, error: 'A valid provider registration signature is required' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      const owner = safeChecksumAddress(rawOwner)
      const deadline = Number(rawDeadline)
      if (!Number.isSafeInteger(deadline) || deadline <= Math.floor(Date.now() / 1000) || deadline > Math.floor(Date.now() / 1000) + 15 * 60) return new Response(JSON.stringify({ success: false, error: 'Registration signature has expired or has an invalid deadline' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      if (owner.toLowerCase() !== manifest.listing.ownerAddress.toLowerCase() || owner.toLowerCase() !== manifest.provider.address.toLowerCase()) return new Response(JSON.stringify({ success: false, error: 'Registration owner must match the service owner and provider address' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      let recoveredOwner: Address
      try {
        recoveredOwner = await recoverTypedDataAddress({ domain: X402_AUTHORIZATION_DOMAIN, types: SERVICE_REGISTRATION_TYPES, primaryType: 'ServiceRegistration', message: { owner, manifestHash: hashServiceManifest(manifest), nonce: registrationNonce, deadline: BigInt(deadline) }, signature: registrationSignature })
      } catch {
        return new Response(JSON.stringify({ success: false, error: 'Invalid registration signature' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      }
      if (recoveredOwner.toLowerCase() !== owner.toLowerCase()) return new Response(JSON.stringify({ success: false, error: 'Registration signer does not own this provider address' }), { status: 401, headers: { 'Content-Type': 'application/json' } })

      const lockKey = 'arcis:x402:custom-manifests:lock'
      const lockToken = `${owner.toLowerCase()}:${manifest.id}:${registrationNonce.toLowerCase()}`
      const lockResult = await kvSetIfAbsent(lockKey, lockToken, 60)
      if (lockResult !== 'acquired') return new Response(JSON.stringify({ success: false, error: lockResult === 'exists' ? 'Service registry is busy; retry shortly' : 'Shared registry storage is unavailable' }), { status: lockResult === 'exists' ? 409 : 503, headers: { 'Content-Type': 'application/json' } })
      const nonceKey = `arcis:x402:registration-nonce:${owner.toLowerCase()}:${registrationNonce.toLowerCase()}`
      try {
        if (OFFICIAL_MANIFESTS.some((item) => item.id === manifest.id)) return new Response(JSON.stringify({ success: false, error: 'Official service IDs cannot be registered as community services' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
        let existing: ServiceManifest[] = []
        const savedJson = await kvGet('arcis:x402:custom_manifests')
        if (savedJson) {
          const parsed: unknown = JSON.parse(savedJson)
          if (!Array.isArray(parsed)) return new Response(JSON.stringify({ success: false, error: 'Stored service registry is invalid' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
          existing = parsed.filter(validateCommunityManifest)
        }
        if (existing.some((item) => item.id === manifest.id && item.listing.ownerAddress.toLowerCase() !== owner.toLowerCase())) return new Response(JSON.stringify({ success: false, error: 'This service ID belongs to another provider' }), { status: 409, headers: { 'Content-Type': 'application/json' } })
        const reserved = await kvSetIfAbsent(nonceKey, '1', Math.max(1, deadline - Math.floor(Date.now() / 1000)))
        if (reserved !== 'acquired') return new Response(JSON.stringify({ success: false, error: reserved === 'exists' ? 'Registration nonce was already used' : 'Shared nonce-protection storage is unavailable' }), { status: reserved === 'exists' ? 409 : 503, headers: { 'Content-Type': 'application/json' } })
        const next = [manifest, ...existing.filter((item) => item.id !== manifest.id)]
        const driver = getStorageDriver()
        const persisted = await kvSet('arcis:x402:custom_manifests', JSON.stringify(next))
        if (!persisted && driver !== 'memory') {
          await kvDelIfValue(nonceKey, '1')
          return new Response(JSON.stringify({ success: false, error: 'Shared manifest storage is unavailable; registration was not confirmed' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
        }
        return new Response(JSON.stringify({ success: true, manifest, persisted, storageMode: persisted ? 'shared' : 'process-local-development' }), { status: 201, headers: { 'Content-Type': 'application/json' } })
      } finally {
        await kvDelIfValue(lockKey, lockToken)
      }
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: err.message || 'Service registration failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
  }

  if (pathname.endsWith('/withdraw')) {
    try {
      const body: any = await req.json()
      if (!isRecord(body) || Object.keys(body).some((key) => !['providerAddress', 'amountUsdc', 'signature', 'nonce', 'deadline'].includes(key))) return new Response(JSON.stringify({ success: false, error: 'Invalid withdrawal payload' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      const { providerAddress, amountUsdc, signature, nonce, deadline } = body
      if (!isAddress(providerAddress) || typeof amountUsdc !== 'number' || !Number.isFinite(amountUsdc) || amountUsdc <= 0 || amountUsdc > 1_000_000 || Math.round(amountUsdc * 1e6) / 1e6 !== amountUsdc) return new Response(JSON.stringify({ success: false, error: 'Invalid withdrawal payload. Amount must be positive and have at most 6 decimal places.' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      if (!signature || !/^0x[0-9a-fA-F]{130}$/.test(signature) || typeof nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(nonce)) return new Response(JSON.stringify({ success: false, error: 'A valid provider ledger signature and nonce are required' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      const lower = safeChecksumAddress(providerAddress).toLowerCase()
      const resolvedDeadline = Number(deadline)
      if (!Number.isSafeInteger(resolvedDeadline) || resolvedDeadline <= Math.floor(Date.now() / 1000) || resolvedDeadline > Math.floor(Date.now() / 1000) + 15 * 60) return new Response(JSON.stringify({ success: false, error: 'Withdrawal authorization has expired or has an invalid deadline' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      const recovered = await recoverTypedDataAddress({ domain: X402_AUTHORIZATION_DOMAIN, types: PROVIDER_LEDGER_TYPES, primaryType: 'ProviderLedgerAuthorization', message: { providerAddress: lower as Address, amountMicros: BigInt(Math.round(amountUsdc * 1_000_000)), nonce: nonce as Hex, deadline: BigInt(resolvedDeadline) }, signature: signature as Hex })
      if (recovered.toLowerCase() !== lower) return new Response(JSON.stringify({ success: false, error: 'Withdrawal signer does not match the provider address' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
      const nonceKey = `arcis:x402:withdrawal-nonce:${lower}:${nonce.toLowerCase()}`
      const reservation = await kvSetIfAbsent(nonceKey, '1', Math.max(1, resolvedDeadline - Math.floor(Date.now() / 1000)))
      if (reservation !== 'acquired') return new Response(JSON.stringify({ success: false, error: reservation === 'exists' ? 'Withdrawal nonce was already used' : 'Shared nonce-protection storage is unavailable' }), { status: reservation === 'exists' ? 409 : 503, headers: { 'Content-Type': 'application/json' } })
      const update = await kvUpdateProviderLedger(providerLedgerKey(lower), { withdrawMicros: Math.round(amountUsdc * 1_000_000) })
      if (update.status === 'unavailable') {
        // The ledger update may have committed even if its response was lost; retain the nonce
        // reservation so a retry cannot withdraw twice. The provider can retry with a fresh signature.
        return new Response(JSON.stringify({ success: false, error: 'Shared atomic ledger storage is unavailable; authorization nonce remains reserved to prevent replay' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
      }
      if (update.status === 'insufficient') return new Response(JSON.stringify({ success: false, error: 'Insufficient unclaimed earnings' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      serverProviderStore.set(lower, update.ledger)
      return new Response(JSON.stringify({ success: true, providerAddress: safeChecksumAddress(providerAddress), amountUsdc, remainingBalanceUsdc: update.ledger.unclaimedEarningsUsdc, totalWithdrawnUsdc: update.ledger.withdrawnUsdc, settlementStatus: 'offchain_ledger_only', message: 'This only moves the internal provider ledger. No USDC payout was sent to a wallet.', timestamp: Date.now() }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: err.message || 'Provider ledger operation failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }
  }

  const serviceId = pathname.split('/').filter(Boolean).pop()
  if (!serviceId) return new Response(JSON.stringify({ error: 'Missing service ID', statusCode: 400 }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  const manifest = await findManifest(serviceId)
  if (!manifest) return new Response(JSON.stringify({ error: `Service "${serviceId}" not found`, statusCode: 404 }), { status: 404, headers: { 'Content-Type': 'application/json' } })
  const requiredBaseUnits = usdcToBaseUnits(manifest.pricing.priceUsdc)
  const providerChecksum = safeChecksumAddress(manifest.provider.address)
  const verifyingContract = safeChecksumAddress((manifest.accepts[0]?.extra?.verifyingContract as string) || GATEWAY_CONTRACTS.testnet.gatewayWallet)
  const requirements = createPaymentRequirements(manifest)
  const facilitatorRequirements = {
    scheme: X402_SCHEMES.EXACT,
    network: X402_NETWORKS.CAIP2_ARC_TESTNET,
    asset: ARC_TESTNET_TOKENS.USDC,
    payTo: providerChecksum,
    amount: requiredBaseUnits,
    maxTimeoutSeconds: CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS,
    extra: { name: CIRCLE_BATCHING_METADATA.NAME, version: CIRCLE_BATCHING_METADATA.VERSION, verifyingContract },
  }

  let bodyJson: Record<string, any> = {}
  try { const parsed: unknown = await req.json(); if (isRecord(parsed)) bodyJson = parsed } catch {}
  const requestPayload = isRecord(bodyJson.payload) ? bodyJson.payload : bodyJson
  const payloadProperties = isRecord(manifest.requestSchema?.properties) ? manifest.requestSchema.properties : {}
  const payloadRequired = Array.isArray(manifest.requestSchema?.required) ? manifest.requestSchema.required : []
  if (!isRecord(requestPayload) || Object.keys(requestPayload).length > 50 || (manifest.requestSchema?.additionalProperties === false && Object.keys(requestPayload).some((key) => !Object.prototype.hasOwnProperty.call(payloadProperties, key))) || payloadRequired.some((key: string) => !Object.prototype.hasOwnProperty.call(requestPayload, key))) {
    return new Response(JSON.stringify({ success: false, error: 'Request payload does not match the service schema', statusCode: 400 }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  for (const [key, value] of Object.entries(requestPayload)) {
    const property = payloadProperties[key]
    if (!isRecord(property)) return new Response(JSON.stringify({ success: false, error: `Unknown request field: ${key}`, statusCode: 400 }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    const validType = property.type === 'integer' ? Number.isSafeInteger(value) : property.type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === property.type
    if (!validType || (property.enum && (!Array.isArray(property.enum) || !property.enum.includes(value))) || (typeof value === 'number' && ((typeof property.minimum === 'number' && value < property.minimum) || (typeof property.maximum === 'number' && value > property.maximum))) || (typeof value === 'string' && value.length > 4096)) {
      return new Response(JSON.stringify({ success: false, error: `Request field does not match the service schema: ${key}`, statusCode: 400 }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }
  }
  const rawAuthHeader = req.headers.get('payment-signature') || req.headers.get('authorization')
  let signature: Hex | null = null
  let payerAddress: Address | null = null
  let nonce: Hex | null = null
  let explicitValidBefore: bigint | null = null
  let validBefore = 0n
  let validAfter: bigint | null = null
  let acceptedPaymentOption: Record<string, any> | undefined
  let paymentResource: Record<string, any> | undefined
  let authFieldsMalformed = false
  if (rawAuthHeader) {
    try {
      let headerStr = rawAuthHeader.trim()
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(headerStr) || headerStr.length % 4 === 1) throw new Error('Invalid base64 payment header')
      const decodedBytes = Buffer.from(headerStr, 'base64')
      if (decodedBytes.toString('base64').replace(/=+$/, '') !== headerStr.replace(/=+$/, '')) throw new Error('Non-canonical base64 payment header')
      headerStr = decodedBytes.toString('utf8')
      const parsed = JSON.parse(headerStr)
      const auth = parsed?.payload?.authorization
      if (!isRecord(parsed) || parsed.x402Version !== 2 || !isRecord(parsed.payload) || !isRecord(auth) || !hasOnlyKeys(parsed, ['x402Version', 'payload', 'accepted', 'resource']) || !hasOnlyKeys(parsed.payload, ['signature', 'authorization']) || !hasOnlyKeys(auth, ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce']) || typeof parsed.payload.signature !== 'string') throw new Error('Malformed x402 v2 payment payload')
      signature = parsed.payload.signature as Hex
      if (isAddress(auth.from)) payerAddress = safeChecksumAddress(auth.from)
      else throw new Error('Invalid payer address')
      nonce = typeof auth.nonce === 'string' ? auth.nonce as Hex : null
      validAfter = parseAuthorizationInteger(auth.validAfter)
      explicitValidBefore = parseAuthorizationInteger(auth.validBefore)
      if (auth.to?.toLowerCase() !== providerChecksum.toLowerCase() || parseAuthorizationInteger(auth.value) !== BigInt(requiredBaseUnits)) throw new Error('Payment authorization does not match price/provider')
      if (!isGatewayPaymentOption(parsed.accepted, providerChecksum, requiredBaseUnits)) throw new Error('Accepted payment option does not match the Arc Testnet challenge')
      if (!isRecord(parsed.resource) || !hasOnlyKeys(parsed.resource, ['url', 'description', 'mimeType']) || parsed.resource.url !== manifest.serve.path || parsed.resource.description !== manifest.description || parsed.resource.mimeType !== 'application/json') throw new Error('Payment resource does not match this service')
      acceptedPaymentOption = parsed.accepted
      paymentResource = parsed.resource
    } catch {
      authFieldsMalformed = true
    }
  }
  if (explicitValidBefore !== null) validBefore = explicitValidBefore
  const now = BigInt(Math.floor(Date.now() / 1000))
  if (authFieldsMalformed || !signature || !/^0x[0-9a-fA-F]{130}$/.test(signature) || !payerAddress || !nonce || !/^0x[0-9a-fA-F]{64}$/.test(nonce) || validAfter === null || explicitValidBefore === null || validAfter < 0n || validAfter > now || explicitValidBefore <= now || explicitValidBefore <= validAfter || explicitValidBefore < now + BigInt(CIRCLE_BATCHING_METADATA.MIN_AUTH_VALIDITY_SECONDS)) return create402ChallengeResponse(manifest, 'A complete x402 v2 Gateway authorization with sufficient validity is required.')

  const resolvedNonce = nonce
  const candidateDomains = [
    { ...GATEWAY_BATCHED_DOMAIN, verifyingContract: safeChecksumAddress(GATEWAY_CONTRACTS.testnet.gatewayWallet) },
  ]
  let recoveredAddress: Address | null = null
  for (const domain of candidateDomains) {
    try {
      const recovered = await recoverTypedDataAddress({ domain, types: EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES, primaryType: 'TransferWithAuthorization', message: { from: payerAddress, to: providerChecksum, value: BigInt(requiredBaseUnits), validAfter: validAfter!, validBefore: explicitValidBefore!, nonce: resolvedNonce }, signature })
      if (recovered.toLowerCase() === payerAddress.toLowerCase()) { recoveredAddress = recovered; break }
    } catch {}
  }
  if (!recoveredAddress) return new Response(JSON.stringify({ error: 'Cryptographic verification failed: signature does not match payer authorization.', statusCode: 402 }), { status: 402, headers: { 'Content-Type': 'application/json' } })
  payerAddress = recoveredAddress

  const nonceIdentity = `${payerAddress.toLowerCase()}:${resolvedNonce.toLowerCase()}`
  const pendingKey = pendingSettlementKey(providerChecksum, resolvedNonce)
  const scopedNonceKey = `arcis:x402:nonce:{${providerChecksum.toLowerCase()}}:${resolvedNonce.toLowerCase()}`
  const scopedReservationKey = `arcis:x402:reservation:{${providerChecksum.toLowerCase()}}:${resolvedNonce.toLowerCase()}`
  if (!acceptedPaymentOption || !paymentResource) return create402ChallengeResponse(manifest, 'A complete Circle Gateway x402 payment payload is required.')
  if (serverNonceStore.has(nonceIdentity) || serverUsedAuthorizationNonces.has(nonceIdentity)) return new Response(JSON.stringify({ error: 'Nonce replay detected. Authorization signature has already been consumed.', statusCode: 409 }), { status: 409, headers: { 'Content-Type': 'application/json' } })
  if (process.env.ENABLE_GATEWAY_SETTLE !== 'true') return createUnsettledPaymentResponse({ manifest, payerAddress, signature, nonce: resolvedNonce, requirements, latencyMs: Math.round(performance.now() - startTime) })
  const reservation = await kvSetIfAbsent(scopedReservationKey, `${manifest.id}:${providerChecksum.toLowerCase()}`, CIRCLE_BATCHING_METADATA.FULL_VALIDITY_SECONDS)
  if (reservation !== 'acquired') {
    if (reservation === 'exists') {
      let pending: Awaited<ReturnType<typeof kvGetPendingProviderSettlement>>
      try { pending = await kvGetPendingProviderSettlement(pendingKey) } catch { return new Response(JSON.stringify({ success: false, error: 'Shared settlement storage is unavailable; do not retry this authorization.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }) }
      if (pending?.status === 'pending' && pending.payerAddress === payerAddress.toLowerCase() && pending.serviceId === manifest.id) {
        const pendingReceipt: PaymentReceipt = { id: `rcpt_${pending.createdAt}`, idempotencyKey: `${manifest.id}:${payerAddress.toLowerCase()}:${resolvedNonce}`, payer: payerAddress, payTo: providerChecksum, payerAddress, providerAddress: providerChecksum, serviceId: manifest.id, serviceVersion: manifest.version, amountUsdc: pending.amountUsdc, authorizedMaxUsdc: pending.amountUsdc, scheme: 'exact', network: X402_NETWORKS.CAIP2_ARC_TESTNET, authorizationSignature: signature, settlementRef: pending.settlementRef, protocolFeeUsdc: 0, providerEarnedUsdc: 0, latencyMs: 0, status: 'settlement_pending', engineMode: 'gateway_batched', gasSponsored: false, createdAt: pending.createdAt }
        return new Response(JSON.stringify({ statusCode: 200, success: true, error: 'Payment already accepted; Circle batch settlement remains pending. Do not retry.', costUsdc: pending.amountUsdc, providerEarnedUsdc: 0, payment: pendingReceipt, requirements }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response(JSON.stringify({ error: reservation === 'exists' ? 'Nonce is already being processed, pending reconciliation, or consumed.' : 'Shared replay-protection storage is unavailable.', statusCode: reservation === 'exists' ? 409 : 503 }), { status: reservation === 'exists' ? 409 : 503, headers: { 'Content-Type': 'application/json' } })
  }

  let serviceData: any = null
  let actionablePayload: any = null
  try {
    if (manifest.engine === 'proxy' && manifest.upstream?.url) {
      const upstreamRes = await fetchCommunityUpstreamJson(manifest.upstream.url, bodyJson.payload || bodyJson, { 'Content-Type': 'application/json', 'X-Payer-Address': payerAddress })
      if (!upstreamRes.ok) throw new Error(`Upstream engine error: HTTP ${upstreamRes.status}`)
      serviceData = upstreamRes.data
    } else {
      const computed = await generateLiveServiceData(manifest, bodyJson.payload || bodyJson)
      serviceData = computed.data
      actionablePayload = computed.actionablePayload
    }
  } catch (error: any) {
    await kvDelIfValue(scopedReservationKey, `${manifest.id}:${providerChecksum.toLowerCase()}`)
    return new Response(JSON.stringify({ statusCode: 500, success: false, error: `Service compute failed: ${error.message}. Payment authorization voided with 0 charge.`, costUsdc: 0, status: 'voided' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  if (!isX402ServiceResultAvailable(serviceData)) {
    await kvDelIfValue(scopedReservationKey, `${manifest.id}:${providerChecksum.toLowerCase()}`)
    return new Response(JSON.stringify({
      statusCode: 503,
      success: false,
      error: 'The service has no available result to return. The authorization was not settled or charged.',
      executionTimeMs: Math.round(performance.now() - startTime),
      costUsdc: 0,
      data: undefined,
      status: 'voided',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }

  const settlementIntent = {
    providerAddress: providerChecksum.toLowerCase(),
    payerAddress: payerAddress.toLowerCase(),
    serviceId: manifest.id,
    amountMicros: Number(requiredBaseUnits),
    amountUsdc: manifest.pricing.priceUsdc,
    nonce: resolvedNonce.toLowerCase(),
    status: 'settling' as const,
    createdAt: Date.now(),
  }
  const intentSaved = await kvCreateProviderSettlementIntent(providerLedgerKey(providerChecksum), pendingKey, scopedNonceKey, settlementIntent)
  if (intentSaved !== 'created') {
    if (intentSaved === 'unavailable') await kvDelIfValue(scopedReservationKey, `${manifest.id}:${providerChecksum.toLowerCase()}`)
    return new Response(JSON.stringify({ statusCode: intentSaved === 'duplicate' ? 409 : 503, success: false, error: intentSaved === 'duplicate' ? 'A durable settlement intent already exists for this nonce; do not retry.' : 'Durable settlement storage is unavailable; payment was not submitted to Circle.' }), { status: intentSaved === 'duplicate' ? 409 : 503, headers: { 'Content-Type': 'application/json' } })
  }

  let settlementRef: string | undefined
  let facilitatorAccepted = false
  let facilitatorResponse: any
  try {
    const { BatchFacilitatorClient } = await import('@circle-fin/x402-batching/server')
    const facilitator = new BatchFacilitatorClient({ url: process.env.GATEWAY_FACILITATOR_URL || 'https://gateway-api-testnet.circle.com' })
    const paymentPayload = {
      x402Version: 2,
      payload: { signature, authorization: { from: payerAddress, to: providerChecksum, value: requiredBaseUnits, validAfter: validAfter!.toString(), validBefore: validBefore.toString(), nonce: resolvedNonce } },
      accepted: facilitatorRequirements,
      resource: paymentResource,
    }
    const settleResult = await facilitator.settle(paymentPayload as any, facilitatorRequirements as any)
    facilitatorResponse = settleResult
    settlementRef = typeof settleResult?.transaction === 'string' && settleResult.transaction.length > 0 && settleResult.transaction.length <= 256
      ? settleResult.transaction
      : undefined
    facilitatorAccepted = settleResult?.success === true &&
      settleResult?.network === X402_NETWORKS.CAIP2_ARC_TESTNET &&
      (settleResult?.payer === undefined || (typeof settleResult.payer === 'string' && settleResult.payer.toLowerCase() === payerAddress.toLowerCase())) &&
      Boolean(settlementRef)
    if (!facilitatorAccepted) settlementRef = undefined
  } catch (error) {
    console.warn('[x402-tollgate] Facilitator/receipt verification notice:', error)
  }
  if (facilitatorResponse?.success === false) {
    await kvRejectProviderSettlementIntent(pendingKey)
    await kvSet(scopedReservationKey, 'settlement_failed', CIRCLE_BATCHING_METADATA.FULL_VALIDITY_SECONDS)
    return createUnsettledPaymentResponse({ manifest, payerAddress, signature, nonce: resolvedNonce, requirements, latencyMs: Math.round(performance.now() - startTime) })
  }
  if (!facilitatorAccepted || !settlementRef) {
    // Keep the durable nonce intent reserved: Circle may have accepted the transfer despite a
    // network/response failure. Reconciliation can recover it by nonce without a second settle.
    await kvSet(scopedReservationKey, 'settlement_unknown', CIRCLE_BATCHING_METADATA.FULL_VALIDITY_SECONDS)
    const unknownReceipt: PaymentReceipt = { id: `rcpt_${Date.now()}`, idempotencyKey: `${manifest.id}:${payerAddress.toLowerCase()}:${resolvedNonce}`, payer: payerAddress, payTo: providerChecksum, payerAddress, providerAddress: providerChecksum, serviceId: manifest.id, serviceVersion: manifest.version, amountUsdc: 0, authorizedMaxUsdc: manifest.pricing.priceUsdc, scheme: 'exact', network: X402_NETWORKS.CAIP2_ARC_TESTNET, authorizationSignature: signature, protocolFeeUsdc: 0, providerEarnedUsdc: 0, latencyMs: Math.round(performance.now() - startTime), status: 'settlement_pending', engineMode: 'gateway_batched', gasSponsored: false, createdAt: Date.now() }
    return new Response(JSON.stringify({ statusCode: 503, success: false, error: 'Gateway settlement outcome is unknown. Do not retry this authorization; reconcile it by nonce before any further action.', costUsdc: 0, payment: unknownReceipt, requirements }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }

  const pendingSaved = await kvMarkProviderSettlementAccepted(providerLedgerKey(providerChecksum), pendingKey, settlementRef)
  if (pendingSaved === 'unavailable') {
    await kvSet(scopedReservationKey, `settlement_unknown:${settlementRef}`, CIRCLE_BATCHING_METADATA.FULL_VALIDITY_SECONDS)
    console.error('[x402-tollgate] Gateway accepted payment but pending ledger transition failed; reconcile by nonce', { provider: providerChecksum, nonce: resolvedNonce, settlementRef })
    return new Response(JSON.stringify({ statusCode: 503, success: false, error: 'Gateway accepted the payment but durable provider accounting is unavailable. Do not retry; reconcile by nonce before taking action.', settlementRef, costUsdc: 0, requirements }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
  serverNonceStore.add(nonceIdentity)
  serverUsedAuthorizationNonces.add(nonceIdentity)
  await kvSet(scopedReservationKey, `settlement_pending:${settlementRef}`, 30 * 24 * 60 * 60)
  const providerEarnedUsdc = 0
  const paymentReceipt: PaymentReceipt = { id: `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, idempotencyKey: `${manifest.id}:${payerAddress.toLowerCase()}:${resolvedNonce}`, payer: payerAddress, payTo: providerChecksum, payerAddress, providerAddress: providerChecksum, serviceId: manifest.id, serviceVersion: manifest.version, amountUsdc: manifest.pricing.priceUsdc, authorizedMaxUsdc: manifest.pricing.priceUsdc, scheme: 'exact', network: X402_NETWORKS.CAIP2_ARC_TESTNET, authorizationSignature: signature, settlementRef, protocolFeeUsdc: 0, providerEarnedUsdc, latencyMs: Math.round(performance.now() - startTime), status: 'settlement_pending', engineMode: 'gateway_batched', gasSponsored: false, createdAt: Date.now() }
  const executionReceipt: X402ExecutionReceipt = { statusCode: 200, success: true, data: serviceData, executionTimeMs: Math.round(performance.now() - startTime), costUsdc: manifest.pricing.priceUsdc, protocolFeeUsdc: 0, providerEarnedUsdc, payment: paymentReceipt, actionablePayload, authProof: { signature, payerAddress, timestamp: Date.now() }, engineMode: 'gateway_batched', gasSponsored: false }
  return new Response(JSON.stringify(executionReceipt), { status: 200, headers: { 'Content-Type': 'application/json', 'PAYMENT-RESPONSE': Buffer.from(JSON.stringify(paymentReceipt)).toString('base64') } })
}
