// src/services/copilot/copilotClaimQuote.ts
// Scans live on-chain accrued LP fees (`pendingFees`) and Yield Vault yield (`pendingYield`)
// across all deployed Arcis V4 pools for Ask Arco's "Claim All Fees" flow.

import { formatUnits, zeroAddress, type Address } from 'viem'
import {
  ARCIS_POOLS,
  POOL_CONTRACTS,
  POOL_VERSION_V4,
  STABLE_SWAP_ABI,
  YIELD_VAULT_ABI,
  type PoolConfig,
} from '../../config/poolsConfig.js'
import { ARC_GAS_LIMITS, type SpeedTier } from '../../config/feeTiers.js'
import type { CopilotClaimablePoolItem } from '../../types/marketplace.js'
import { getResilientPublicClient } from '../rpc/index.js'
import { calculateArcGasCostFromFee, getDynamicArcGasOptions } from '../arcGasService.js'
import { DEFAULT_TOKEN_PRICES, getLiveTokenPrices, normalizeTokenSymbol } from '../tokenPriceService.js'

export interface ClaimFeesScanSuccess {
  ok: true
  pools: CopilotClaimablePoolItem[]
  totalClaimableUsd: number
  estimatedFeeUsdc?: string
  feeEstimateSource?: string
}

export interface ClaimFeesScanFailure {
  ok: false
  empty?: boolean
  otherClaimablePools?: CopilotClaimablePoolItem[]
  error: string
}

export type ClaimFeesScanResult = ClaimFeesScanSuccess | ClaimFeesScanFailure

function isDeployedAddress(addr?: string): addr is Address {
  return Boolean(addr && addr.startsWith('0x') && addr.toLowerCase() !== zeroAddress)
}

function trimFeeDecimal(units: bigint, decimals: number): string {
  if (units <= 0n) return '0'
  const raw = formatUnits(units, decimals)
  const [whole, frac = ''] = raw.split('.')
  const maxFrac = decimals >= 18 ? 8 : Math.min(decimals, 6)
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

function tokenUsdPrice(symbol: string, prices: Record<string, number>): number {
  const norm = normalizeTokenSymbol(symbol)
  if (norm === 'USDC') return 1.0
  return prices[norm] || DEFAULT_TOKEN_PRICES[norm] || 1.0
}

export function formatClaimPoolSummary(item: CopilotClaimablePoolItem): string {
  const parts: string[] = []
  if (BigInt(item.feeARaw || '0') > 0n) {
    parts.push(`${item.feeADecimal} ${item.tokenA}`)
  }
  if (item.tokenB && item.feeBRaw && BigInt(item.feeBRaw) > 0n && item.feeBDecimal) {
    parts.push(`${item.feeBDecimal} ${item.tokenB}`)
  }
  return parts.join(' + ') || `0 ${item.tokenA}`
}

/** Formats claimable token amounts using inline `[[token:SYMBOL]]` icon markers for CopilotMessageContent. */
export function formatClaimPoolSummaryWithIcons(item: CopilotClaimablePoolItem): string {
  const parts: string[] = []
  if (BigInt(item.feeARaw || '0') > 0n) {
    parts.push(`${item.feeADecimal} [[token:${item.tokenA}]]`)
  }
  if (item.tokenB && item.feeBRaw && BigInt(item.feeBRaw) > 0n && item.feeBDecimal) {
    parts.push(`${item.feeBDecimal} [[token:${item.tokenB}]]`)
  }
  return parts.join(' + ') || `0 [[token:${item.tokenA}]]`
}

/**
 * Queries live on-chain `pendingFees` (AMM pools) and `pendingYield` (Yield Vault)
 * for `walletAddress` and returns every pool with non-zero claimable rewards.
 */
export async function scanClaimableCopilotFees(
  walletAddress: string,
  options?: { poolId?: string; speedTier?: SpeedTier }
): Promise<ClaimFeesScanResult> {
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return {
      ok: false,
      error: '<strong>Connect your wallet first.</strong>\n\nPlease connect an Arc wallet so I can check your accrued LP fees and vault yield on-chain.',
    }
  }

  if (!POOL_VERSION_V4) {
    return {
      ok: false,
      error: '<strong>Fee harvest unavailable.</strong>\n\nOn-chain fee harvesting requires the V4 pool contracts.',
    }
  }

  const targetPools: PoolConfig[] = options?.poolId
    ? ARCIS_POOLS.filter((p) => p.id === options.poolId && isDeployedAddress(p.contractAddress))
    : ARCIS_POOLS.filter((p) => isDeployedAddress(p.contractAddress))

  if (targetPools.length === 0) {
    return {
      ok: false,
      error: '<strong>No eligible deployed pools found.</strong>\n\nPlease check the target pool and try again.',
    }
  }

  const client = getResilientPublicClient('Arc_Testnet')
  const owner = walletAddress as Address

  const readPoolsPending = async (poolsToScan: PoolConfig[]) =>
    Promise.all(
      poolsToScan
        .map(async (pool) => {
          const isVault = pool.id === 'usdc-yield-vault'
          if (isVault) {
            const yieldRaw = (await client.readContract({
              address: POOL_CONTRACTS.YIELD_VAULT,
              abi: YIELD_VAULT_ABI,
              functionName: 'pendingYield',
              args: [owner],
            })) as bigint
            return { pool, isVault, feeA: yieldRaw, feeB: 0n }
          }
          const pending = (await client.readContract({
            address: pool.contractAddress,
            abi: STABLE_SWAP_ABI,
            functionName: 'pendingFees',
            args: [owner],
          })) as readonly [bigint, bigint]
          return { pool, isVault, feeA: pending?.[0] ?? 0n, feeB: pending?.[1] ?? 0n }
        })
        .map((p) => p.then((value) => ({ ok: true as const, value }), (err) => ({ ok: false as const, err })))
    )

  const mapClaimableItems = (
    results: Awaited<ReturnType<typeof readPoolsPending>>,
    pricesMap: Record<string, number>
  ): { items: CopilotClaimablePoolItem[]; totalUsd: number } => {
    const items: CopilotClaimablePoolItem[] = []
    let sumUsd = 0
    for (const res of results) {
      if (!res.ok) continue
      const { pool, isVault, feeA, feeB } = res.value
      if (feeA <= 0n && feeB <= 0n) continue

      const tokenA = pool.tokens[0]
      const tokenB = pool.tokens[1]
      const decA = tokenA?.decimals ?? 6
      const decB = tokenB?.decimals ?? 6

      const numA = Number(formatUnits(feeA, decA))
      const numB = tokenB && feeB > 0n ? Number(formatUnits(feeB, decB)) : 0
      const usdA = numA * tokenUsdPrice(tokenA.symbol, pricesMap)
      const usdB = tokenB ? numB * tokenUsdPrice(tokenB.symbol, pricesMap) : 0
      const estimatedUsd = Number((usdA + usdB).toFixed(6))
      sumUsd += estimatedUsd

      items.push({
        poolId: pool.id,
        poolName: pool.name,
        poolAddress: isVault ? POOL_CONTRACTS.YIELD_VAULT : pool.contractAddress,
        isVault,
        tokenA: tokenA.symbol,
        ...(tokenB && !isVault ? { tokenB: tokenB.symbol } : {}),
        feeADecimal: trimFeeDecimal(feeA, decA),
        ...(tokenB && !isVault ? { feeBDecimal: trimFeeDecimal(feeB, decB), feeBRaw: feeB.toString() } : {}),
        feeARaw: feeA.toString(),
        estimatedUsd,
      })
    }
    return { items, totalUsd: sumUsd }
  }

  const [prices, readResults] = await Promise.all([
    getLiveTokenPrices().catch(() => ({ ...DEFAULT_TOKEN_PRICES })),
    readPoolsPending(targetPools),
  ])

  const succeededReads = readResults.filter((r) => r.ok)
  if (succeededReads.length === 0) {
    return {
      ok: false,
      error: '<strong>Unable to read accrued fees.</strong>\n\nArc Testnet RPC did not return pending fee balances. Please try again in a moment.',
    }
  }

  const { items: claimable, totalUsd } = mapClaimableItems(readResults, prices)

  if (claimable.length === 0) {
    const scopeText = options?.poolId
      ? `<strong>${targetPools[0].name}</strong>`
      : 'any of the Arc AMM pools or Yield Vault'

    // When a specific pool has no claimable fees, surface other active pools that DO have pending fees.
    if (options?.poolId) {
      const otherPools = ARCIS_POOLS.filter(
        (p) => p.id !== options.poolId && isDeployedAddress(p.contractAddress)
      )
      if (otherPools.length > 0) {
        const otherResults = await readPoolsPending(otherPools)
        const { items: otherClaimable } = mapClaimableItems(otherResults, prices)
        if (otherClaimable.length > 0) {
          const lines = otherClaimable.map((item) => {
            const usdLabel =
              item.estimatedUsd > 0 && item.estimatedUsd < 0.0001
                ? '<$0.0001'
                : `$${item.estimatedUsd.toFixed(4)}`
            return `• <strong>${item.poolName}:</strong> +${formatClaimPoolSummaryWithIcons(item)} (~${usdLabel} USD)`
          })
          return {
            ok: false,
            empty: true,
            otherClaimablePools: otherClaimable,
            error: `<strong>No claimable fees yet.</strong>\n\nYou currently have <strong>0 accrued fees</strong> ready to harvest across ${scopeText}.\n\n<strong>Active pools with claimable fees:</strong>\n${lines.join('\n')}\n\nYou can say <strong>"Claim all fees"</strong> or name one of the pools above to harvest.`,
          }
        }
      }
    }

    return {
      ok: false,
      empty: true,
      error: `<strong>No claimable fees yet.</strong>\n\nYou currently have <strong>0 accrued fees</strong> ready to harvest across ${scopeText}. Fees accumulate automatically as swaps execute in pools where you hold LP tokens.`,
    }
  }

  const gasLimit = ARC_GAS_LIMITS.contractInteraction * BigInt(claimable.length)
  let estimatedFeeUsdc: string | undefined
  let feeEstimateSource: string | undefined
  try {
    const gas = await getDynamicArcGasOptions(undefined, options?.speedTier || 'fast', gasLimit)
    estimatedFeeUsdc = calculateArcGasCostFromFee(gasLimit, gas.maxFeePerGas)
    feeEstimateSource = gas.source
  } catch {
    // Non-fatal
  }

  return {
    ok: true,
    pools: claimable,
    totalClaimableUsd: Number(totalUsd.toFixed(6)),
    estimatedFeeUsdc,
    feeEstimateSource,
  }
}
