// api/health.ts
// Arcis Protocol Healthcheck & System Status Endpoint
//
// ARC-015: this endpoint is unauthenticated, so it answers liveness for everyone and serves the
// diagnostic body — relayer address/balance, integration flags, RPC host — only to a caller that
// presents HEALTH_CHECK_TOKEN as `x-health-token`. When that secret is unset the diagnostics are
// never served (fail-closed), and the expensive relayer/Redis probes are not run at all.

import { timingSafeEqual } from 'node:crypto'
import { formatUnits } from 'viem'
import { arcActiveChain, ARC_TOKENS, APP_ENV, IS_TESTNET, ARC_METADATA } from '../src/config/arcChain'
import { getArcPublicClient, resilientReadContract } from '../src/services/rpc'
import { isRedisConnected, getRedisInstance } from './_utils/rateLimiter'
import { getServerSignerAccount } from './_utils/serverSigner'

const USDC_ADDRESS = ARC_TOKENS.USDC
const DETAIL_TOKEN_ENV = 'HEALTH_CHECK_TOKEN'

const BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

function readEnv(name: string): string {
  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
  const localEnv = (typeof process !== 'undefined' && process.env) || {}
  return String(localEnv[name] ?? globalEnv[name] ?? '').trim()
}

/** Constant-time comparison that also refuses to compare different lengths. */
function safeTokenEqual(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  } catch {
    return false
  }
}

export async function GET(req: Request) {
  const startTime = Date.now()

  // 1. Check Arc RPC (Active Chain) — the public liveness signal
  let rpcStatus = {
    connected: false,
    blockNumber: null as string | null,
    latencyMs: 0,
    error: undefined as string | undefined,
  }

  const publicClient = getArcPublicClient()

  try {
    const rpcStart = Date.now()
    const blockNum = await publicClient.getBlockNumber()
    rpcStatus = {
      connected: true,
      blockNumber: blockNum.toString(),
      latencyMs: Date.now() - rpcStart,
      error: undefined,
    }
  } catch (err: any) {
    console.error(`[Health API] RPC check failed for ${arcActiveChain.name}:`, (err?.message || '').replace(/token=[^&\\s]+/gi, 'token=[REDACTED]'))
    rpcStatus.error = `Failed to connect to ${arcActiveChain.name} RPC endpoint`
  }

  const detailToken = readEnv(DETAIL_TOKEN_ENV)
  const wantsDetails = safeTokenEqual((req.headers.get('x-health-token') || '').trim(), detailToken)

  // 2. Diagnostics — only for a caller holding HEALTH_CHECK_TOKEN
  let relayerStatus = {
    configured: false,
    address: null as string | null,
    balanceUsdc: '0.00',
    isFunded: false,
  }
  let redisConnected = false
  let circleConfigured = false
  let copilotConfigured = false

  if (wantsDetails) {
    try {
      // ARC-011: only the dedicated relayer key counts. The deploy key (PRIVATE_KEY) is ignored on
      // purpose — reporting a deployer address as "relayer configured" hid an unfunded relayer.
      const account = getServerSignerAccount()
      if (account) {
        let balanceFormatted = '0.00'
        let isFunded = false

        if (rpcStatus.connected) {
          try {
            const bal = await resilientReadContract(publicClient, {
              address: USDC_ADDRESS,
              abi: BALANCE_ABI,
              functionName: 'balanceOf',
              args: [account.address],
            })
            balanceFormatted = formatUnits(bal, 6)
            isFunded = bal >= 10000n // >= 0.01 USDC
          } catch (err) {
            // Diagnostics only: an unreadable balance is reported as 0.00/isFunded=false below.
            console.warn('[Health API] Relayer USDC balance read failed:', err)
          }
        }

        relayerStatus = {
          configured: true,
          address: account.address,
          balanceUsdc: balanceFormatted,
          isFunded,
        }
      }
    } catch (err) {
      console.error('[Health API] Relayer diagnostics failed:', err)
    }

    // 3. Check Redis Connection
    await getRedisInstance().catch((err) => {
      console.warn('[Health API] Redis probe failed:', err)
    })
    redisConnected = isRedisConnected()

    // 4. Check Circle API Key Configuration
    circleConfigured = readEnv('CIRCLE_API_KEY') !== ''

    // 5. Check AI Copilot Configuration
    copilotConfigured = readEnv('OPENAI_API_KEY') !== '' || readEnv('OPENROUTER_API_KEY') !== ''
  }

  const isHealthy = rpcStatus.connected

  const uptimeVal = typeof process?.uptime === 'function'
    ? process.uptime()
    : typeof (globalThis as any).process?.uptime === 'function'
      ? (globalThis as any).process.uptime()
      : Math.floor((Date.now() - startTime) / 1000)

  const publicBody = {
    status: isHealthy ? 'healthy' : 'degraded',
    service: 'Arcis Protocol API Gateway',
    version: '0.1.0',
    uptimeSeconds: Math.floor(uptimeVal),
    timestamp: Date.now(),
    totalResponseTimeMs: Date.now() - startTime,
    isTestnet: IS_TESTNET,
    network: { name: arcActiveChain.name },
    rpc: { connected: rpcStatus.connected, latencyMs: rpcStatus.latencyMs },
  }

  const body = wantsDetails
    ? {
        ...publicBody,
        environment: readEnv('NODE_ENV') || 'production',
        networkMode: APP_ENV,
        network: {
          name: arcActiveChain.name,
          chainId: arcActiveChain.id,
          nativeCurrency: arcActiveChain.nativeCurrency.symbol,
          rpcHost: (() => {
            try {
              return new URL(ARC_METADATA.rpcHttpUrl).hostname
            } catch {
              return 'configured'
            }
          })(),
          explorerUrl: ARC_METADATA.explorerUrl,
        },
        rpc: rpcStatus,
        relayer: relayerStatus,
        integrations: {
          circleApi: circleConfigured,
          aiCopilot: copilotConfigured,
          redisCache: redisConnected,
        },
      }
    : publicBody

  return Response.json(body, { status: isHealthy ? 200 : 503 })
}
