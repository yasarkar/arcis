// src/services/portfolioContextService.ts
// Live Portfolio Context & DeFi Strategist Engine for Arcis and Ask Arcis Copilot
// Gathers real-time multi-chain balances, Vault positions, Gateway liquidity, and Session limits

import { createPublicClient, http, erc20Abi, formatUnits, type Hex } from 'viem'
import { arcTestnet, ARC_METADATA } from '../config/arcChain'
import { POOL_CONTRACTS } from '../config/poolsConfig'
import { getGatewayBalances } from './gatewayService'
import { getSessionKeyConfig } from './sessionKeyService'
import { getLiveTokenPrices, type TokenPriceMap } from './tokenPriceService'
import { redisCache } from './redisCacheService'

import { getStoredMscaAddress } from './modularWalletService'

export interface GatewayChainBreakdown {
  domain: number
  chainName: string
  balanceUsdc: number
}

export interface PortfolioSnapshot {
  walletAddress: string
  liquidUsdc: number
  liquidEurc: number
  liquidWeth: number
  liquidWbtc: number
  vaultStakedUsdc: number
  vaultApy: number // 8.42
  estimatedYearlyYieldUsdc: number
  gatewayTotalUsdc: number
  gatewayBreakdown: GatewayChainBreakdown[]
  totalNetWorthUsd: number
  idleCapitalUsdc: number
  healthScore: number // 0 - 100
  sessionBudgetLeftUsdc: number
  hasActiveSession: boolean
  recommendedVaultDeposit: number
  timestamp: number
}

const CACHE_TTL_MS = 15_000 // 15 seconds fresh cache
let memorySnapshotCache: { snapshot: PortfolioSnapshot; timestamp: number } | null = null

export function invalidatePortfolioCache(): void {
  memorySnapshotCache = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('arcis_session_key_updated', invalidatePortfolioCache)
  window.addEventListener('arcis_portfolio_updated', invalidatePortfolioCache)
}

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_METADATA.rpcHttpUrl, { timeout: 6000 }),
})

/**
 * Fetches and computes a complete live portfolio snapshot for the connected wallet
 */
export async function getLivePortfolioSnapshot(
  walletAddress?: string
): Promise<PortfolioSnapshot> {
  const now = Date.now()
  const activeAddr = (walletAddress || getStoredMscaAddress() || '').trim()

  if (!activeAddr || !activeAddr.startsWith('0x')) {
    return createEmptyPortfolioSnapshot('0xDemo...Wallet')
  }

  // 1. In-Memory Cache Check (<1ms)
  if (
    memorySnapshotCache &&
    memorySnapshotCache.snapshot.walletAddress.toLowerCase() === activeAddr.toLowerCase() &&
    now - memorySnapshotCache.timestamp < CACHE_TTL_MS
  ) {
    return memorySnapshotCache.snapshot
  }

  // 2. Fetch Live Prices and Session Config concurrently
  const [tokenPrices, sessionConfig] = await Promise.all([
    getLiveTokenPrices(),
    Promise.resolve(getSessionKeyConfig()),
  ])

  // 3. Query Arc Testnet Balances & Vault Staked Position
  let liquidUsdc = 0
  let liquidEurc = 0
  let liquidWeth = 0
  let liquidWbtc = 0
  let vaultStakedUsdc = 0

  const target = activeAddr as Hex

  try {
    const [nativeBal, erc20UsdcBal, eurcBal, vaultBal] = await Promise.all([
      publicClient.getBalance({ address: target }).catch(() => BigInt(0)),
      publicClient.readContract({
        address: POOL_CONTRACTS.USDC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [target],
      }).catch(() => BigInt(0)),
      publicClient.readContract({
        address: POOL_CONTRACTS.EURC,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [target],
      }).catch(() => BigInt(0)),
      publicClient.readContract({
        address: POOL_CONTRACTS.YIELD_VAULT,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [target],
      }).catch(() => BigInt(0)),
    ])

    // Format native USDC (18 decimals standard on Arc L1, or 6 decimals)
    let nativeFormatted = parseFloat(formatUnits(nativeBal, 18))
    if (nativeFormatted < 0.0001 && nativeBal > BigInt(0)) {
      nativeFormatted = parseFloat(formatUnits(nativeBal, 6))
    }
    const erc20Formatted = parseFloat(formatUnits(erc20UsdcBal, 6))
    liquidUsdc = Number(Math.max(nativeFormatted, erc20Formatted).toFixed(2))
    liquidEurc = Number(parseFloat(formatUnits(eurcBal, 6)).toFixed(2))

    // Vault af-USDC share value (1 af-USDC ≈ 1.0842 USDC asset value)
    const rawVaultShares = parseFloat(formatUnits(vaultBal, 6))
    vaultStakedUsdc = Number((rawVaultShares * 1.0842).toFixed(2))
  } catch (err) {
    console.warn('[portfolioContextService] Error reading Arc Testnet balances:', err)
  }

  // 4. Query Circle Gateway Cross-Chain Balances
  let gatewayTotalUsdc = 0
  const gatewayBreakdown: GatewayChainBreakdown[] = []

  try {
    const gwRes = await getGatewayBalances(activeAddr)
    if (gwRes && gwRes.balances) {
      gwRes.balances.forEach((item) => {
        const bal = parseFloat(item.balance) || 0
        if (bal > 0) {
          gatewayTotalUsdc += bal
          gatewayBreakdown.push({
            domain: item.domain,
            chainName: `Domain ${item.domain}`,
            balanceUsdc: Number(bal.toFixed(2)),
          })
        }
      })
      gatewayTotalUsdc = Number(gatewayTotalUsdc.toFixed(2))
    }
  } catch (err) {
    console.warn('[portfolioContextService] Error reading Gateway balances:', err)
  }

  // 5. Total Net Worth & Yield Analytics
  const eurcUsdPrice = tokenPrices.EURC || 1.08
  const eurcValUsd = liquidEurc * eurcUsdPrice
  const totalNetWorthUsd = Number((liquidUsdc + eurcValUsd + vaultStakedUsdc + gatewayTotalUsdc).toFixed(2))
  const estimatedYearlyYieldUsdc = Number((vaultStakedUsdc * 0.0842).toFixed(2))
  const idleCapitalUsdc = liquidUsdc

  // 6. Portfolio Health Score Calculation (0 - 100)
  let healthScore = 75
  if (totalNetWorthUsd > 0) {
    const productiveRatio = (vaultStakedUsdc) / totalNetWorthUsd
    if (productiveRatio >= 0.5) healthScore = 98
    else if (productiveRatio >= 0.25) healthScore = 90
    else if (productiveRatio > 0) healthScore = 80
    else healthScore = 65 // All idle
  }

  // 7. Recommended Allocation (Leave $50 for instant gas/swaps, allocate 70% of remaining idle)
  const recommendedVaultDeposit = idleCapitalUsdc > 50
    ? Math.floor((idleCapitalUsdc - 50) * 0.7)
    : 0

  const sessionBudgetLeftUsdc = sessionConfig.isActive
    ? Math.max(0, sessionConfig.maxSpendUsdc - sessionConfig.spentUsdc)
    : 0

  const snapshot: PortfolioSnapshot = {
    walletAddress: activeAddr,
    liquidUsdc,
    liquidEurc,
    liquidWeth,
    liquidWbtc,
    vaultStakedUsdc,
    vaultApy: 8.42,
    estimatedYearlyYieldUsdc,
    gatewayTotalUsdc,
    gatewayBreakdown,
    totalNetWorthUsd,
    idleCapitalUsdc,
    healthScore,
    sessionBudgetLeftUsdc,
    hasActiveSession: sessionConfig.isActive,
    recommendedVaultDeposit,
    timestamp: now,
  }

  memorySnapshotCache = { snapshot, timestamp: now }
  return snapshot
}

function createEmptyPortfolioSnapshot(addr: string): PortfolioSnapshot {
  return {
    walletAddress: addr,
    liquidUsdc: 0,
    liquidEurc: 0,
    liquidWeth: 0,
    liquidWbtc: 0,
    vaultStakedUsdc: 0,
    vaultApy: 8.42,
    estimatedYearlyYieldUsdc: 0,
    gatewayTotalUsdc: 0,
    gatewayBreakdown: [],
    totalNetWorthUsd: 0,
    idleCapitalUsdc: 0,
    healthScore: 60,
    sessionBudgetLeftUsdc: 100,
    hasActiveSession: false,
    recommendedVaultDeposit: 0,
    timestamp: Date.now(),
  }
}

/**
 * Formats a PortfolioSnapshot into a structured prompt block for LLM System Prompt injection
 */
export function formatPortfolioForPrompt(p: PortfolioSnapshot): string {
  const gatewayInfo = p.gatewayTotalUsdc > 0
    ? `$${p.gatewayTotalUsdc.toFixed(2)} USDC (${p.gatewayBreakdown.map((g) => `${g.chainName}: $${g.balanceUsdc}`).join(', ')})`
    : '$0.00 USDC'

  return `LIVE USER ON-CHAIN PORTFOLIO SNAPSHOT:
- Connected Address: ${p.walletAddress}
- Liquid USDC (Arc Testnet): $${p.liquidUsdc.toFixed(2)} USDC (0% idle yield)
- Liquid EURC (Arc Testnet): €${p.liquidEurc.toFixed(2)} EURC
- Real-Yield Vault (af-USDC): $${p.vaultStakedUsdc.toFixed(2)} USDC allocated (Earning 8.42% APY = +$${p.estimatedYearlyYieldUsdc.toFixed(2)}/year passive yield)
- Circle Gateway Omnichain USDC: ${gatewayInfo}
- Total Net Worth: $${p.totalNetWorthUsd.toFixed(2)} USD
- Portfolio DeFi Health Score: ${p.healthScore}/100
- Recommended Vault Allocation: $${p.recommendedVaultDeposit.toFixed(2)} USDC
- Autonomous Session Budget Remaining: $${p.sessionBudgetLeftUsdc.toFixed(2)} USDC (Session ${p.hasActiveSession ? 'Active' : 'Inactive'})`
}
