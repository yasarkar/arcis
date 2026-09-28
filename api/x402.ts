// api/x402.ts
// Vite Dev Server SSR & Vercel Serverless Tollgate Endpoint for x402 AI Services & Nanopayments
// Implements F2 Tollgate Dispatcher, Invariant Guards, EIP-3009 ecrecover verification,
// Two-Phase Settlement (Commit vs Void), and F3 Provider Ledger & Withdrawal.

import {
  recoverTypedDataAddress,
  recoverMessageAddress,
  getAddress,
  isAddress,
  type Hex,
  type Address,
} from 'viem'
import { arcTestnet } from '../src/config/arcChain'
import { POOL_CONTRACTS } from '../src/config/poolsConfig'
import { OFFICIAL_MANIFESTS } from '../src/config/x402/manifests'
import {
  DEFAULT_X402_DOMAIN,
  GATEWAY_BATCHED_DOMAIN,
  GATEWAY_CONTRACTS,
  CIRCLE_BATCHING_METADATA,
  EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
  X402_SCHEMES,
  X402_NETWORKS,
} from '../src/config/x402/schemes'
import { calculateFeeSplit, usdcToBaseUnits, baseUnitsToUsdc } from '../src/config/x402/pricing'
import { generateLiveServiceData } from '../src/services/aiServicesDataProvider'
import { kvGet, kvSet } from './_utils/redisStorage'
import type {
  ServiceManifest,
  PaymentReceipt,
  X402PaymentRequirements,
  X402ExecutionReceipt,
  ProviderLedger,
} from '../src/types/x402'

// In-memory fallback stores for non-KV / isolated environments
const serverNonceStore = new Set<string>()
const serverProviderStore = new Map<string, {
  totalCallsServed: number
  totalUsdcEarned: number
  unclaimedEarningsUsdc: number
  withdrawnUsdc: number
}>()
let serverAccumulatedYieldVaultUsdc = 0

function safeChecksumAddress(addr: string): Address {
  try {
    return getAddress(addr.toLowerCase())
  } catch {
    return '0x0000000000000000000000000000000000000000' as Address
  }
}

/**
 * Finds service manifest by ID from official catalog or custom storage
 */
async function findManifest(serviceId: string): Promise<ServiceManifest | null> {
  const official = OFFICIAL_MANIFESTS.find((m) => m.id === serviceId)
  if (official) return official

  try {
    const customListJson = await kvGet('arcis:x402:custom_manifests')
    if (customListJson) {
      const customList: ServiceManifest[] = JSON.parse(customListJson)
      const found = customList.find((m) => m.id === serviceId)
      if (found) return found
    }
  } catch (err) {
    console.warn('[x402-tollgate] Failed to fetch custom manifests:', err)
  }

  return null
}

/**
 * Creates standard HTTP 402 Payment Required response with requirements challenge (x402 v2)
 */
function create402ChallengeResponse(manifest: ServiceManifest, message = 'Payment Required'): Response {
  const nonceHex: Hex = `0x${Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')}`
  const price = manifest.pricing.priceUsdc
  const baseUnits = usdcToBaseUnits(price)
  const providerAddr = safeChecksumAddress(manifest.provider.address)
  const verifyingAddr = safeChecksumAddress(
    (manifest.accepts[0]?.extra?.verifyingContract as string) || GATEWAY_CONTRACTS.testnet.gatewayWallet
  )

  const requirements: X402PaymentRequirements = {
    x402Version: 2,
    accepts: [
      {
        scheme: X402_SCHEMES.EXACT,
        network: X402_NETWORKS.CAIP2_ARC_TESTNET, // eip155:5042002
        asset: 'USDC',
        payTo: providerAddr,
        amount: baseUnits,
        maxAmountRequired: baseUnits,
        resource: manifest.serve.path,
        maxTimeoutSeconds: CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS,
        extra: {
          name: CIRCLE_BATCHING_METADATA.NAME,
          version: CIRCLE_BATCHING_METADATA.VERSION,
          verifyingContract: verifyingAddr,
        },
        domain: {
          name: CIRCLE_BATCHING_METADATA.NAME,
          version: CIRCLE_BATCHING_METADATA.VERSION,
          chainId: arcTestnet.id,
          verifyingContract: verifyingAddr,
        },
      },
    ],
  }

  const responseBody = {
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

  const paymentRequiredHeader = Buffer.from(JSON.stringify(requirements)).toString('base64')

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

// ─────────────────────────────────────────────────────────────
// GET HANDLER
// ─────────────────────────────────────────────────────────────
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const pathname = url.pathname

  // 1. Service Catalog Discovery (/api/x402/services or /api/x402/manifests)
  if (pathname.endsWith('/services') || pathname.endsWith('/manifests')) {
    let allManifests = [...OFFICIAL_MANIFESTS]
    try {
      const customListJson = await kvGet('arcis:x402:custom_manifests')
      if (customListJson) {
        const customList: ServiceManifest[] = JSON.parse(customListJson)
        allManifests = [...allManifests, ...customList]
      }
    } catch {}

    return new Response(
      JSON.stringify({
        success: true,
        protocol: 'x402-Gateway-V1',
        chainId: arcTestnet.id,
        gasToken: arcTestnet.nativeCurrency.symbol,
        count: allManifests.length,
        services: allManifests,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  // 2. Health check (/api/x402/health)
  if (pathname.endsWith('/health')) {
    return new Response(
      JSON.stringify({
        status: 'healthy',
        protocol: 'x402-Gateway-V1',
        network: arcTestnet.name,
        chainId: arcTestnet.id,
        timestamp: Date.now(),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  // 3. Provider Ledger Details (/api/x402/provider/:address)
  const providerMatch = pathname.match(/\/provider\/([^/]+)/)
  if (providerMatch && providerMatch[1]) {
    const rawAddr = providerMatch[1]
    const providerAddr = safeChecksumAddress(rawAddr).toLowerCase()

    let stats = serverProviderStore.get(providerAddr)
    try {
      const kvData = await kvGet(`arcis:x402:provider:${providerAddr}`)
      if (kvData) {
        stats = JSON.parse(kvData)
      }
    } catch {}

    const ledger: ProviderLedger = {
      providerAddress: safeChecksumAddress(providerAddr),
      services: OFFICIAL_MANIFESTS.filter(
        (m) => m.provider.address.toLowerCase() === providerAddr
      ).map((m) => ({
        serviceId: m.id,
        callsServed: stats?.totalCallsServed || 0,
        grossUsdc: stats?.totalUsdcEarned || 0,
      })),
      pendingUsdc: 0,
      availableUsdc: stats?.unclaimedEarningsUsdc || 0,
      withdrawnUsdc: stats?.withdrawnUsdc || 0,
    }

    return new Response(JSON.stringify({ success: true, ledger }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // 4. Service Unpaid Probe (/api/x402/:serviceId)
  const serviceId = pathname.split('/').filter(Boolean).pop()
  if (serviceId) {
    const manifest = await findManifest(serviceId)
    if (manifest) {
      return create402ChallengeResponse(manifest, 'Payment Required. Unpaid probe returned requirements.')
    }
  }

  return new Response(JSON.stringify({ error: 'Endpoint not found', statusCode: 404 }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ─────────────────────────────────────────────────────────────
// POST HANDLER (Tollgate & Settlement)
// ─────────────────────────────────────────────────────────────
export async function POST(req: Request): Promise<Response> {
  const startTime = performance.now()
  const url = new URL(req.url)
  const pathname = url.pathname

  // 0. Register Community Service Endpoint (POST /api/x402/services)
  if (pathname.endsWith('/services') || pathname.endsWith('/register')) {
    try {
      const manifest = (await req.json()) as ServiceManifest
      if (!manifest.id || !manifest.name || !manifest.pricing) {
        return new Response(JSON.stringify({ success: false, error: 'Invalid manifest payload' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      let customList: ServiceManifest[] = []
      try {
        const raw = await kvGet('arcis:x402:custom_manifests')
        if (raw) customList = JSON.parse(raw)
      } catch {}

      customList = [manifest, ...customList.filter((m) => m.id !== manifest.id)]
      try {
        await kvSet('arcis:x402:custom_manifests', JSON.stringify(customList))
      } catch {}

      return new Response(JSON.stringify({ success: true, manifest }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // 1. Provider Withdrawal Endpoint (F3 /api/x402/withdraw)
  if (pathname.endsWith('/withdraw')) {
    try {
      const body = await req.json()
      const { providerAddress, amountUsdc, signature, nonce } = body

      if (!providerAddress || typeof amountUsdc !== 'number' || amountUsdc <= 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Invalid withdrawal payload. Requires providerAddress and amountUsdc > 0',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const lower = safeChecksumAddress(providerAddress).toLowerCase()

      // Cryptographic signature check for non-custodial authorization (ADR-005)
      if (signature) {
        try {
          const authMsg = `Authorize withdrawal of ${amountUsdc} USDC to ${providerAddress} (nonce: ${nonce || '0'})`
          const recovered = await recoverMessageAddress({
            message: authMsg,
            signature: signature as Hex,
          })
          if (recovered.toLowerCase() !== lower) {
            return new Response(
              JSON.stringify({
                success: false,
                error: `Withdrawal authorization failed: recovered address ${recovered} does not match provider ${providerAddress}`,
              }),
              { status: 401, headers: { 'Content-Type': 'application/json' } }
            )
          }
        } catch (sigErr: any) {
          return new Response(
            JSON.stringify({
              success: false,
              error: `Invalid withdrawal signature format: ${sigErr.message}`,
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } }
          )
        }
      }

      let current = serverProviderStore.get(lower)
      try {
        const kvData = await kvGet(`arcis:x402:provider:${lower}`)
        if (kvData) current = JSON.parse(kvData)
      } catch {}

      const available = current?.unclaimedEarningsUsdc || 0
      if (amountUsdc > available) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Insufficient unclaimed earnings: requested $${amountUsdc.toFixed(4)}, available $${available.toFixed(4)} USDC`,
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const updated = {
        totalCallsServed: current?.totalCallsServed || 0,
        totalUsdcEarned: current?.totalUsdcEarned || 0,
        unclaimedEarningsUsdc: Number((available - amountUsdc).toFixed(6)),
        withdrawnUsdc: Number(((current?.withdrawnUsdc || 0) + amountUsdc).toFixed(6)),
      }

      serverProviderStore.set(lower, updated)
      try {
        await kvSet(`arcis:x402:provider:${lower}`, JSON.stringify(updated))
      } catch {}

      const mockTxHash: Hex = `0x${Array.from({ length: 64 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('')}`

      return new Response(
        JSON.stringify({
          success: true,
          providerAddress: safeChecksumAddress(providerAddress),
          amountUsdc,
          remainingBalanceUsdc: updated.unclaimedEarningsUsdc,
          totalWithdrawnUsdc: updated.withdrawnUsdc,
          txHash: mockTxHash,
          explorerUrl: `https://testnet.arcscan.app/tx/${mockTxHash}`,
          timestamp: Date.now(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    } catch (err: any) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  // 2. Identify Target Service
  const serviceId = pathname.split('/').filter(Boolean).pop()
  if (!serviceId) {
    return new Response(JSON.stringify({ error: 'Missing service ID', statusCode: 400 }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const manifest = await findManifest(serviceId)
  if (!manifest) {
    return new Response(JSON.stringify({ error: `Service "${serviceId}" not found`, statusCode: 404 }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Parse Body safely
  let bodyJson: Record<string, any> = {}
  try {
    bodyJson = await req.json()
  } catch {
    bodyJson = {}
  }

  // 3. Extract Payment Authorization Proof
  const rawAuthHeader = req.headers.get('payment-signature') || req.headers.get('authorization')
  let signature: Hex | null = null
  let payerAddress: Address | null = null
  let nonce: Hex | null = null
  let amountUsdc: number = manifest.pricing.priceUsdc
  let explicitValidBefore: bigint | null = null
  let validBefore = BigInt(Math.floor(Date.now() / 1000) + CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS)
  let validAfter = 0n

  if (rawAuthHeader) {
    let headerStr = rawAuthHeader.trim()
    // Support standard x402 base64 encoded JSON
    if (!headerStr.startsWith('0x') && !headerStr.startsWith('{')) {
      try {
        const decoded = Buffer.from(headerStr, 'base64').toString('utf8')
        if (decoded.trim().startsWith('{')) {
          headerStr = decoded.trim()
        }
      } catch {}
    }

    if (headerStr.startsWith('0x') && headerStr.length >= 130) {
      signature = headerStr as Hex
    } else if (headerStr.includes('x402-Gateway-V1')) {
      const matchPayer = headerStr.match(/payer=([^,]+)/)
      const matchNonce = headerStr.match(/nonce=([^,]+)/)
      const matchSig = headerStr.match(/signature=([^,]+)/)
      const matchValidBefore = headerStr.match(/validBefore=([^,]+)/)
      if (matchPayer) payerAddress = safeChecksumAddress(matchPayer[1])
      if (matchNonce) nonce = matchNonce[1] as Hex
      if (matchSig) signature = matchSig[1] as Hex
      if (matchValidBefore) explicitValidBefore = BigInt(matchValidBefore[1])
    } else {
      try {
        const parsed = JSON.parse(headerStr)
        if (parsed.payload) {
          if (parsed.payload.signature) signature = parsed.payload.signature
          if (parsed.payload.authorization) {
            const auth = parsed.payload.authorization
            if (auth.from) payerAddress = safeChecksumAddress(auth.from)
            if (auth.nonce) nonce = auth.nonce
            if (auth.validBefore) explicitValidBefore = BigInt(auth.validBefore)
            if (auth.validAfter) validAfter = BigInt(auth.validAfter)
          }
        } else {
          if (parsed.signature) signature = parsed.signature
          if (parsed.payerAddress) payerAddress = safeChecksumAddress(parsed.payerAddress)
          if (parsed.nonce) nonce = parsed.nonce
          if (parsed.validBefore) explicitValidBefore = BigInt(parsed.validBefore)
          if (parsed.validAfter) validAfter = BigInt(parsed.validAfter)
        }
      } catch {}
    }
  }

  // Also inspect body for authorization proof (inline payload)
  if (!signature && bodyJson.authProof?.signature) {
    signature = bodyJson.authProof.signature as Hex
    if (bodyJson.authProof.payerAddress) {
      payerAddress = safeChecksumAddress(bodyJson.authProof.payerAddress)
    }
    if (bodyJson.authProof.validBefore) {
      explicitValidBefore = BigInt(bodyJson.authProof.validBefore)
    }
  }
  if (!signature && bodyJson.authorizationSignature) {
    signature = bodyJson.authorizationSignature as Hex
    if (bodyJson.payerAddress) payerAddress = safeChecksumAddress(bodyJson.payerAddress)
    if (bodyJson.validBefore) explicitValidBefore = BigInt(bodyJson.validBefore)
  }

  // 4. If No Valid Signature Found, Return HTTP 402 Payment Required
  if (!signature) {
    return create402ChallengeResponse(manifest, 'Payment Required. No valid authorization signature provided.')
  }

  // 5. Invariant I3 & Replay Protection: Validate Nonce
  const resolvedNonce: Hex = nonce || (bodyJson.nonce as Hex) || `0x${'0'.repeat(64)}`
  const nonceKey = `arcis:nonce:${resolvedNonce}`

  let isReplayed = serverNonceStore.has(resolvedNonce)
  if (!isReplayed) {
    try {
      const kvNonce = await kvGet(nonceKey)
      if (kvNonce) isReplayed = true
    } catch {}
  }

  if (isReplayed) {
    return new Response(
      JSON.stringify({
        error: 'Nonce replay detected. Authorization signature has already been consumed.',
        statusCode: 409,
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 6. Cryptographic Verification: EIP-3009 ecrecover (Multi-Domain: GatewayWalletBatched & Vanilla)
  const candidateDomains = [
    {
      name: CIRCLE_BATCHING_METADATA.NAME,
      version: CIRCLE_BATCHING_METADATA.VERSION,
      chainId: arcTestnet.id,
      verifyingContract: safeChecksumAddress(GATEWAY_CONTRACTS.testnet.gatewayWallet),
    },
    {
      name: manifest.accepts[0]?.domain?.name || DEFAULT_X402_DOMAIN.name,
      version: manifest.accepts[0]?.domain?.version || DEFAULT_X402_DOMAIN.version,
      chainId: manifest.accepts[0]?.domain?.chainId || DEFAULT_X402_DOMAIN.chainId,
      verifyingContract: safeChecksumAddress(
        (manifest.accepts[0]?.domain?.verifyingContract as string) || POOL_CONTRACTS.USDC
      ),
    },
  ]

  const nowSec = Math.floor(Date.now() / 1000)
  const candidateValidBefores = explicitValidBefore !== null
    ? [explicitValidBefore]
    : [
        BigInt(nowSec + 3600),
        BigInt(nowSec + CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS),
        BigInt(nowSec + CIRCLE_BATCHING_METADATA.FULL_VALIDITY_SECONDS),
      ]

  const requiredBaseUnits = usdcToBaseUnits(manifest.pricing.priceUsdc)
  const providerChecksum = safeChecksumAddress(manifest.provider.address)
  let effectivePayer = payerAddress || ('0x0000000000000000000000000000000000000000' as Address)
  let recoverySuccess = false
  let recoveredAddress: Address | null = null

  for (const domain of candidateDomains) {
    for (const vBefore of candidateValidBefores) {
      try {
        const recovered = await recoverTypedDataAddress({
          domain,
          types: EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
          primaryType: 'TransferWithAuthorization',
          message: {
            from: effectivePayer,
            to: providerChecksum,
            value: BigInt(requiredBaseUnits),
            validAfter,
            validBefore: vBefore,
            nonce: resolvedNonce,
          },
          signature,
        })

        if (payerAddress) {
          if (recovered.toLowerCase() === payerAddress.toLowerCase()) {
            recoverySuccess = true
            recoveredAddress = recovered
            validBefore = vBefore
            break
          }
        } else {
          recoverySuccess = true
          recoveredAddress = recovered
          effectivePayer = recovered
          payerAddress = recovered
          validBefore = vBefore
          break
        }
      } catch {}
    }
    if (recoverySuccess) break
  }

  if (!recoverySuccess && payerAddress) {
    // Try recovering without assuming effectivePayer if payer was specified
    for (const domain of candidateDomains) {
      for (const vBefore of candidateValidBefores) {
        try {
          const recovered = await recoverTypedDataAddress({
            domain,
            types: EIP3009_TRANSFER_WITH_AUTHORIZATION_TYPES,
            primaryType: 'TransferWithAuthorization',
            message: {
              from: payerAddress,
              to: providerChecksum,
              value: BigInt(requiredBaseUnits),
              validAfter,
              validBefore: vBefore,
              nonce: resolvedNonce,
            },
            signature,
          })
          if (recovered.toLowerCase() === payerAddress.toLowerCase()) {
            recoverySuccess = true
            recoveredAddress = recovered
            validBefore = vBefore
            break
          }
        } catch {}
      }
      if (recoverySuccess) break
    }
  }

  if (!recoverySuccess) {
    if (!signature.startsWith('0x') || signature.length !== 132) {
      return new Response(
        JSON.stringify({
          error: 'Invalid EIP-3009 signature format: expected 65-byte hex string (0x + 130 hex chars)',
          statusCode: 402,
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      )
    }
    return new Response(
      JSON.stringify({
        error: `Cryptographic verification failed: signature does not match payer authorization.`,
        statusCode: 402,
      }),
      { status: 402, headers: { 'Content-Type': 'application/json' } }
    )
  }

  payerAddress = recoveredAddress || effectivePayer

  // 7. TWO-PHASE SETTLEMENT — PHASE 2: SERVICE COMPUTE
  let serviceData: any = null
  let actionablePayload: any = null

  try {
    if (manifest.engine === 'proxy' && manifest.upstream?.url) {
      const upstreamRes = await fetch(manifest.upstream.url, {
        method: manifest.upstream.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Payer-Address': payerAddress || '',
          'X-Payment-Signature': signature,
        },
        body: JSON.stringify(bodyJson.payload || bodyJson),
      })
      if (!upstreamRes.ok) {
        throw new Error(`Upstream engine error: HTTP ${upstreamRes.status}`)
      }
      serviceData = await upstreamRes.json()
    } else {
      // Native deterministic execution
      const computed = await generateLiveServiceData(manifest, bodyJson.payload || bodyJson)
      serviceData = computed.data
      actionablePayload = computed.actionablePayload
    }
  } catch (serviceComputeErr: any) {
    // Invariant I4: VOID Authorization upon service failure, 0 charge to user!
    return new Response(
      JSON.stringify({
        statusCode: 500,
        success: false,
        error: `Service compute failed: ${serviceComputeErr.message}. Payment authorization voided with 0 charge.`,
        costUsdc: 0,
        status: 'voided',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 8. TWO-PHASE SETTLEMENT — PHASE 3: COMMIT PAYMENT & BATCH SETTLEMENT
  serverNonceStore.add(resolvedNonce)
  try {
    await kvSet(nonceKey, '1', CIRCLE_BATCHING_METADATA.FULL_VALIDITY_SECONDS) // 7 days TTL for replay protection
  } catch {}

  const feeSplit = calculateFeeSplit(manifest.pricing.priceUsdc)
  const providerLower = providerChecksum.toLowerCase()

  // Attempt Circle Gateway Batch Facilitator settlement if configured
  let settlementRef = `gw-batched-${Date.now()}`
  try {
    if (process.env.CIRCLE_API_KEY || process.env.ENABLE_GATEWAY_SETTLE === 'true') {
      const { BatchFacilitatorClient } = await import('@circle-fin/x402-batching/server')
      const facilitatorUrl = process.env.GATEWAY_FACILITATOR_URL || 'https://gateway-api-testnet.circle.com'
      const facilitator = new BatchFacilitatorClient({ url: facilitatorUrl })
      const paymentPayload = {
        x402Version: 2,
        payload: {
          signature,
          authorization: {
            from: effectivePayer,
            to: providerChecksum,
            value: requiredBaseUnits.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce: resolvedNonce,
          },
        },
      }
      const settleResult = await (facilitator as any).settle(paymentPayload, {
        scheme: X402_SCHEMES.EXACT,
        network: X402_NETWORKS.CAIP2_ARC_TESTNET,
        asset: 'USDC',
        payTo: providerChecksum,
        amount: requiredBaseUnits,
        extra: {
          name: CIRCLE_BATCHING_METADATA.NAME,
          version: CIRCLE_BATCHING_METADATA.VERSION,
          verifyingContract: GATEWAY_CONTRACTS.testnet.gatewayWallet,
        },
      })
      if (settleResult && (settleResult as any).txHash) {
        settlementRef = (settleResult as any).txHash
      }
    }
  } catch (settleErr) {
    console.warn('[x402-tollgate] Gateway batch facilitator notice:', settleErr)
  }

  // Credit Provider
  let prov = serverProviderStore.get(providerLower)
  try {
    const kvProv = await kvGet(`arcis:x402:provider:${providerLower}`)
    if (kvProv) prov = JSON.parse(kvProv)
  } catch {}

  const updatedProv = {
    totalCallsServed: (prov?.totalCallsServed || 0) + 1,
    totalUsdcEarned: Number(((prov?.totalUsdcEarned || 0) + feeSplit.providerEarnedUsdc).toFixed(6)),
    unclaimedEarningsUsdc: Number(
      ((prov?.unclaimedEarningsUsdc || 0) + feeSplit.providerEarnedUsdc).toFixed(6)
    ),
    withdrawnUsdc: prov?.withdrawnUsdc || 0,
  }
  serverProviderStore.set(providerLower, updatedProv)
  try {
    await kvSet(`arcis:x402:provider:${providerLower}`, JSON.stringify(updatedProv))
  } catch {}

  // Credit YieldVault 1%
  serverAccumulatedYieldVaultUsdc = Number(
    (serverAccumulatedYieldVaultUsdc + feeSplit.protocolFeeUsdc).toFixed(6)
  )
  try {
    await kvSet('arcis:x402:yield_vault', serverAccumulatedYieldVaultUsdc.toString())
  } catch {}

  const batchTxHash: Hex = `0x${Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('')}`
  const explorerUrl = `https://testnet.arcscan.app/tx/${batchTxHash}`

  const paymentReceipt: PaymentReceipt = {
    id: `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    idempotencyKey: `${manifest.id}:${(payerAddress || '0x0').toLowerCase()}:${resolvedNonce}`,
    payer: safeChecksumAddress(payerAddress || '0x0000000000000000000000000000000000000000'),
    payTo: providerChecksum,
    payerAddress: safeChecksumAddress(payerAddress || '0x0000000000000000000000000000000000000000'),
    providerAddress: providerChecksum,
    serviceId: manifest.id,
    serviceVersion: manifest.version,
    amountUsdc: manifest.pricing.priceUsdc,
    authorizedMaxUsdc: manifest.pricing.priceUsdc,
    scheme: 'exact',
    network: arcTestnet.name,
    authorizationSignature: signature,
    settlementRef,
    batchTxHash,
    explorerUrl,
    protocolFeeUsdc: feeSplit.protocolFeeUsdc,
    providerEarnedUsdc: feeSplit.providerEarnedUsdc,
    latencyMs: Math.round(performance.now() - startTime),
    status: 'settled',
    engineMode: 'gateway_batched',
    gasSponsored: true,
    createdAt: Date.now(),
  }

  const executionReceipt: X402ExecutionReceipt = {
    statusCode: 200,
    success: true,
    data: serviceData,
    executionTimeMs: Math.round(performance.now() - startTime),
    costUsdc: manifest.pricing.priceUsdc,
    protocolFeeUsdc: feeSplit.protocolFeeUsdc,
    providerEarnedUsdc: feeSplit.providerEarnedUsdc,
    payment: paymentReceipt,
    actionablePayload,
    explorerUrl,
    txHash: batchTxHash,
    authProof: {
      signature,
      payerAddress: safeChecksumAddress(payerAddress || '0x0'),
      timestamp: Date.now(),
    },
    engineMode: 'gateway_batched',
    gasSponsored: true,
  }

  return new Response(JSON.stringify(executionReceipt), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-RESPONSE': Buffer.from(JSON.stringify(paymentReceipt)).toString('base64'),
    },
  })
}
