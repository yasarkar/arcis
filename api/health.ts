// api/health.ts
// Arcis Protocol Healthcheck & System Status Endpoint

import { createPublicClient, http, formatUnits, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcActiveChain, ARC_TOKENS, ARC_METADATA, APP_ENV, IS_TESTNET } from '../src/config/arcChain'
import { isRedisConnected, getRedisInstance } from './rateLimiter'

const USDC_ADDRESS = ARC_TOKENS.USDC

const BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export async function GET(req: Request) {
  const startTime = Date.now()

  // 1. Check Arc RPC (Active Chain)
  let rpcStatus = {
    connected: false,
    blockNumber: null as string | null,
    latencyMs: 0,
    error: undefined as string | undefined,
  }

  const publicClient = createPublicClient({
    chain: arcActiveChain,
    transport: http(ARC_METADATA.rpcHttpUrl, { timeout: 5000 }),
  })

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
    rpcStatus.error = err.message || `Failed to connect to ${arcActiveChain.name} RPC`
  }

  // 2. Check Relayer Key Configuration & On-chain Balance
  let relayerStatus = {
    configured: false,
    address: null as string | null,
    balanceUsdc: '0.00',
    isFunded: false,
  }

  const globalEnv = (typeof globalThis !== 'undefined' && (globalThis as any).process?.env) || {}
  const localEnv = (typeof process !== 'undefined' && process.env) || {}

  try {
    const rawKey = (
      localEnv.PRIVATE_KEY ||
      globalEnv.PRIVATE_KEY ||
      localEnv.RELAYER_PRIVATE_KEY ||
      globalEnv.RELAYER_PRIVATE_KEY ||
      localEnv.VITE_RELAYER_PRIVATE_KEY ||
      globalEnv.VITE_RELAYER_PRIVATE_KEY ||
      ''
    ).trim()
    if (rawKey && rawKey.length >= 64) {
      const formattedKey: Hex = rawKey.startsWith('0x') ? (rawKey as Hex) : `0x${rawKey}`
      const account = privateKeyToAccount(formattedKey)
      
      let balanceFormatted = '0.00'
      let isFunded = false

      if (rpcStatus.connected) {
        try {
          const bal = await publicClient.readContract({
            address: USDC_ADDRESS,
            abi: BALANCE_ABI,
            functionName: 'balanceOf',
            args: [account.address],
          })
          balanceFormatted = formatUnits(bal, 6)
          isFunded = bal >= 10000n // >= 0.01 USDC
        } catch {}
      }

      relayerStatus = {
        configured: true,
        address: account.address,
        balanceUsdc: balanceFormatted,
        isFunded,
      }
    }
  } catch {}

  // 3. Check Redis Connection
  await getRedisInstance().catch(() => {})
  const redisConnected = isRedisConnected()

  // 4. Check Circle API Key Configuration
  const circleKey = localEnv.CIRCLE_API_KEY || globalEnv.CIRCLE_API_KEY || ''
  const circleConfigured = Boolean(circleKey.trim() !== '')

  // 5. Check AI Copilot Configuration
  const copilotConfigured = Boolean(
    localEnv.OPENAI_API_KEY ||
    globalEnv.OPENAI_API_KEY ||
    localEnv.OPENROUTER_API_KEY ||
    globalEnv.OPENROUTER_API_KEY ||
    localEnv.VITE_OPENAI_API_KEY ||
    globalEnv.VITE_OPENAI_API_KEY
  )

  const isHealthy = rpcStatus.connected

  const uptimeVal = typeof process?.uptime === 'function'
    ? process.uptime()
    : typeof (globalThis as any).process?.uptime === 'function'
      ? (globalThis as any).process.uptime()
      : Math.floor((Date.now() - startTime) / 1000)

  return Response.json(
    {
      status: isHealthy ? 'healthy' : 'degraded',
      service: 'Arcis Protocol API Gateway',
      version: '0.1.0',
      uptimeSeconds: Math.floor(uptimeVal),
      timestamp: Date.now(),
      totalResponseTimeMs: Date.now() - startTime,
      environment: localEnv.NODE_ENV || globalEnv.NODE_ENV || 'production',
      networkMode: APP_ENV,
      isTestnet: IS_TESTNET,
      network: {
        name: arcActiveChain.name,
        chainId: arcActiveChain.id,
        nativeCurrency: arcActiveChain.nativeCurrency.symbol,
        rpcUrl: ARC_METADATA.rpcHttpUrl,
        explorerUrl: ARC_METADATA.explorerUrl,
      },
      rpc: rpcStatus,
      relayer: relayerStatus,
      integrations: {
        circleApi: circleConfigured,
        aiCopilot: copilotConfigured,
        redisCache: redisConnected,
      },
    },
    { status: isHealthy ? 200 : 503 }
  )
}
