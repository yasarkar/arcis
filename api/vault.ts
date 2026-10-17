// api/vault.ts
// Arcis Protocol - USDC Yield Vault Backend Controller
// Provides vault metrics inspection, keeper diagnostics, and on-chain automated yield distribution.

import { createPublicClient, http, formatUnits, parseAbi } from 'viem'
import { apiSuccess, apiError } from './_utils/apiResponse'
import { executeYieldDistribution, getKeeperStatus } from './_utils/vaultKeeper'
import { getServerSignerAccount } from './_utils/serverSigner'

const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.VITE_ARC_RPC_URL || 'https://rpc.testnet.arc.network', 'https://rpc.testnet.arc.io'] },
  },
}

const ARC_USDC = (process.env.VITE_POOL_USDC || '0x3600000000000000000000000000000000000000') as `0x${string}`
const YIELD_VAULT = (process.env.VITE_POOL_V4_YIELD_VAULT || '0xb2a6D2BF896b431a77FB9198519fE334Caf39e9A') as `0x${string}`

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
])

const YIELD_VAULT_ABI = parseAbi([
  'function owner() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function totalYieldDistributed() view returns (uint256)',
  'function performanceFeeBps() view returns (uint256)',
  'function decimals() view returns (uint8)',
])

function getPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(arcTestnet.rpcUrls.default.http[0]),
  })
}

// ARC-011: dedicated server signer only (DISTRIBUTOR_KEY, else RELAYER_PRIVATE_KEY); the deploy key
// in PRIVATE_KEY is never used to sign vault operations.
function getRelayerAccount() {
  return getServerSignerAccount({ forVault: true })
}

/**
 * GET /api/vault
 * Returns current vault on-chain stats, relayer distributor readiness, and keeper status.
 */
export async function GET(_req: Request) {
  try {
    const client = getPublicClient()
    const relayer = getRelayerAccount()

    const [vaultOwner, totalAssets, totalDistributed, feeBps, shareDecimals] = await Promise.all([
      client.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'owner' }),
      client.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalAssets' }),
      client.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalYieldDistributed' }),
      client.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'performanceFeeBps' }),
      client.readContract({ address: YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'decimals' }),
    ])

    let relayerUsdcBal = '0'
    let isRelayerOwner = false

    if (relayer) {
      isRelayerOwner = relayer.address.toLowerCase() === vaultOwner.toLowerCase()
      try {
        const bal = await client.readContract({
          address: ARC_USDC,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [relayer.address],
        })
        relayerUsdcBal = formatUnits(bal, 6)
      } catch (e) {
        console.warn('[api/vault] Failed to read relayer USDC balance:', e)
      }
    }

    return apiSuccess({
      vaultAddress: YIELD_VAULT,
      vaultOwner,
      totalAssetsUsdc: formatUnits(totalAssets, 6),
      totalYieldDistributedUsdc: formatUnits(totalDistributed, 6),
      performanceFeePct: Number(feeBps) / 100,
      shareDecimals,
      relayerAddress: relayer ? relayer.address : null,
      isRelayerOwner,
      relayerUsdcBalance: relayerUsdcBal,
      keeper: getKeeperStatus(),
    })
  } catch (err: any) {
    return apiError(err.message || 'Failed to inspect Yield Vault', 'VAULT_QUERY_FAILED', 500)
  }
}

/**
 * POST /api/vault
 * Triggers yield injection into YieldVault via relayer.
 * Body: { amount?: number | string } (default: 5 USDC)
 */
export async function POST(req: Request) {
  try {
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      // Empty body is okay, use default
    }

    const amountNum = body.amount !== undefined ? parseFloat(String(body.amount)) : 5
    if (isNaN(amountNum) || amountNum <= 0) {
      return apiError('Invalid amount. Must be a positive number of USDC.', 'INVALID_AMOUNT', 400)
    }

    const result = await executeYieldDistribution(amountNum)
    return apiSuccess(result)
  } catch (err: any) {
    return apiError(err.shortMessage || err.message || 'Yield distribution failed', 'DISTRIBUTION_FAILED', 500)
  }
}
