// src/services/x402/arcDefiPositions.ts
// Shared on-chain Arc DeFi position reader used by both `arc-portfolio-risk-exposure`
// (Full Portfolio & DeFi Health Auditor) and `arc-vault-yield-tax-report` (Yield & Position Statement).
//
// Reads:
//   1. ERC-4626 USDC Yield Vault (`balanceOf`, `previewRedeem`, `pendingYield`)
//   2. All 6 deployed Arc V4 AMM pools (`balanceOf`, `pendingFees`, and when held: `totalLp`, `reserveA`, `reserveB`)
//
// Never invents a value: failed reads stay null and unpriced nonzero assets withhold USD totals.

import { formatUnits, type Address } from 'viem'
import {
  ARCIS_POOLS,
  POOL_CONTRACTS,
  STABLE_SWAP_ABI,
  VAULT_SHARE_DECIMALS,
  YIELD_VAULT_ABI,
  type PoolConfig,
} from '../../config/poolsConfig.js'
import { getArcPublicClient, resilientReadContract } from '../rpc/index.js'
import { normalizeTokenSymbol } from '../tokenPriceService.js'

const STABLE_SYMBOLS = new Set(['USDC', 'EURC'])

export interface ArcVaultPositionSummary {
  vaultAddress: string
  shares: string | null
  shareDecimals: number
  currentValueUsdc: number | null
  pendingYieldUsdc: number | null
  hasPosition: boolean
  readOk: boolean
}

export interface ArcLpPosition {
  poolId: string
  poolName: string
  contractAddress: string
  lpShares: string
  poolSharePct: number | null
  tokenA: string
  tokenB: string
  amountA: number | null
  amountB: number | null
  valueUsd: number | null
  pendingFeeA: number
  pendingFeeB: number
  pendingFeesUsd: number | null
  impermanentLossRisk: string
  isVolatile: boolean
}

export interface ArcDefiPositionsResult {
  vault: ArcVaultPositionSummary
  lpPositions: ArcLpPosition[]
  totalVaultUsd: number | null
  totalLpUsd: number | null
  totalPendingLpFeesUsd: number | null
  totalDefiUsd: number | null
  /** Underlying asset amounts across vault + active LP positions, for accurate portfolio composition. */
  underlyingAssets: Array<{ symbol: string; amount: number; valueUsd: number | null; stablecoin: boolean }>
  measuredReads: number
  expectedReads: number
  unavailable: string[]
  allReadsOk: boolean
}

const round6 = (value: number): number => Number(value.toFixed(6))

function priceOf(prices: Record<string, number>, symbol: string): number | null {
  const direct = prices[symbol] ?? prices[symbol.toUpperCase()] ?? prices[normalizeTokenSymbol(symbol)]
  return typeof direct === 'number' && Number.isFinite(direct) && direct > 0 ? direct : null
}

function parsePendingFeesTuple(raw: unknown): [bigint, bigint] {
  if (Array.isArray(raw) && raw.length >= 2 && typeof raw[0] === 'bigint' && typeof raw[1] === 'bigint') {
    return [raw[0], raw[1]]
  }
  return [0n, 0n]
}

async function readSingleLpPosition(
  client: ReturnType<typeof getArcPublicClient>,
  pool: PoolConfig,
  address: Address,
  prices: Record<string, number>
): Promise<{ ok: boolean; position: ArcLpPosition | null; unavailableLabel?: string }> {
  const addr = pool.contractAddress as Address
  const tokenA = pool.tokens[0]
  const tokenB = pool.tokens[1]

  const [lpRaw, pendingRaw] = await Promise.all([
    resilientReadContract(client, {
      address: addr,
      abi: STABLE_SWAP_ABI,
      functionName: 'balanceOf',
      args: [address],
    }).catch(() => null),
    resilientReadContract(client, {
      address: addr,
      abi: STABLE_SWAP_ABI,
      functionName: 'pendingFees',
      args: [address],
    }).catch(() => [0n, 0n] as const),
  ])

  if (lpRaw === null) {
    return { ok: false, position: null, unavailableLabel: `${pool.name} LP balance` }
  }

  const lpUnits = lpRaw as bigint
  const [feeARaw, feeBRaw] = parsePendingFeesTuple(pendingRaw)
  const pendingFeeA = round6(Number(formatUnits(feeARaw, tokenA.decimals)))
  const pendingFeeB = round6(Number(formatUnits(feeBRaw, tokenB.decimals)))
  const hasPendingFees = feeARaw > 0n || feeBRaw > 0n

  if (lpUnits === 0n && !hasPendingFees) {
    return { ok: true, position: null }
  }

  const priceA = priceOf(prices, tokenA.symbol)
  const priceB = priceOf(prices, tokenB.symbol)

  const feeAUsd = pendingFeeA === 0 ? 0 : priceA !== null ? pendingFeeA * priceA : null
  const feeBUsd = pendingFeeB === 0 ? 0 : priceB !== null ? pendingFeeB * priceB : null
  const pendingFeesUsd = feeAUsd !== null && feeBUsd !== null ? round6(feeAUsd + feeBUsd) : null

  let amountA: number | null = 0
  let amountB: number | null = 0
  let poolSharePct: number | null = 0
  let valueUsd: number | null = 0

  if (lpUnits > 0n) {
    const [totalLpRaw, rARaw, rBRaw] = await Promise.all([
      resilientReadContract(client, { address: addr, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }).catch(() => null),
      resilientReadContract(client, { address: addr, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }).catch(() => null),
      resilientReadContract(client, { address: addr, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }).catch(() => null),
    ])

    if (totalLpRaw === null || rARaw === null || rBRaw === null || (totalLpRaw as bigint) === 0n) {
      amountA = null
      amountB = null
      poolSharePct = null
      valueUsd = null
    } else {
      const totalLp = totalLpRaw as bigint
      const rA = rARaw as bigint
      const rB = rBRaw as bigint
      const userUnitsA = (rA * lpUnits) / totalLp
      const userUnitsB = (rB * lpUnits) / totalLp
      amountA = round6(Number(formatUnits(userUnitsA, tokenA.decimals)))
      amountB = round6(Number(formatUnits(userUnitsB, tokenB.decimals)))
      poolSharePct = round6((Number(lpUnits) / Number(totalLp)) * 100)

      const valA = amountA === 0 ? 0 : priceA !== null ? amountA * priceA : null
      const valB = amountB === 0 ? 0 : priceB !== null ? amountB * priceB : null
      valueUsd = valA !== null && valB !== null ? round6(valA + valB) : null
    }
  }

  return {
    ok: true,
    position: {
      poolId: pool.id,
      poolName: pool.name,
      contractAddress: pool.contractAddress,
      lpShares: formatUnits(lpUnits, 18),
      poolSharePct,
      tokenA: tokenA.symbol,
      tokenB: tokenB.symbol,
      amountA,
      amountB,
      valueUsd,
      pendingFeeA,
      pendingFeeB,
      pendingFeesUsd,
      impermanentLossRisk: pool.impermanentLossRisk || 'Medium',
      isVolatile: pool.riskLevel !== 'Safe',
    },
  }
}

export async function readArcDefiPositions(
  address: Address,
  prices: Record<string, number>
): Promise<ArcDefiPositionsResult> {
  const client = getArcPublicClient()
  const vaultAddress = String(POOL_CONTRACTS.YIELD_VAULT)
  const livePools = ARCIS_POOLS.filter((p) => p.isLpPool && p.isLiveOnChain)
  const expectedReads = 1 + livePools.length
  const unavailable: string[] = []

  // 1. Vault balance + 2. All 6 LP pool balances in parallel
  const [vaultSharesRaw, poolResults] = await Promise.all([
    resilientReadContract(client, {
      address: vaultAddress as Address,
      abi: YIELD_VAULT_ABI,
      functionName: 'balanceOf',
      args: [address],
    }).catch(() => null),
    Promise.all(livePools.map((pool) => readSingleLpPosition(client, pool, address, prices))),
  ])

  let vault: ArcVaultPositionSummary
  let vaultReadOk = false

  if (vaultSharesRaw === null) {
    unavailable.push('USDC Yield Vault balance')
    vault = {
      vaultAddress,
      shares: null,
      shareDecimals: VAULT_SHARE_DECIMALS,
      currentValueUsdc: null,
      pendingYieldUsdc: null,
      hasPosition: false,
      readOk: false,
    }
  } else {
    vaultReadOk = true
    const sharesUnits = vaultSharesRaw as bigint
    if (sharesUnits === 0n) {
      vault = {
        vaultAddress,
        shares: '0',
        shareDecimals: VAULT_SHARE_DECIMALS,
        currentValueUsdc: 0,
        pendingYieldUsdc: 0,
        hasPosition: false,
        readOk: true,
      }
    } else {
      const [redeemRaw, pendingRaw, assetsRaw, supplyRaw] = await Promise.all([
        resilientReadContract(client, {
          address: vaultAddress as Address,
          abi: YIELD_VAULT_ABI,
          functionName: 'previewRedeem',
          args: [sharesUnits],
        }).catch(() => null),
        resilientReadContract(client, {
          address: vaultAddress as Address,
          abi: YIELD_VAULT_ABI,
          functionName: 'pendingYield',
          args: [address],
        }).catch(() => null),
        resilientReadContract(client, {
          address: vaultAddress as Address,
          abi: YIELD_VAULT_ABI,
          functionName: 'totalAssets',
        }).catch(() => null),
        resilientReadContract(client, {
          address: vaultAddress as Address,
          abi: YIELD_VAULT_ABI,
          functionName: 'totalSupply',
        }).catch(() => null),
      ])

      let currentValueUsdc: number | null = null
      if (redeemRaw !== null) {
        currentValueUsdc = round6(Number(formatUnits(redeemRaw as bigint, 6)))
      } else if (assetsRaw !== null && supplyRaw !== null && (supplyRaw as bigint) > 0n) {
        currentValueUsdc = round6(
          Number(formatUnits(((assetsRaw as bigint) * sharesUnits) / (supplyRaw as bigint), 6))
        )
      }

      const pendingYieldUsdc =
        pendingRaw !== null ? round6(Number(formatUnits(pendingRaw as bigint, 6))) : null

      vault = {
        vaultAddress,
        shares: formatUnits(sharesUnits, VAULT_SHARE_DECIMALS),
        shareDecimals: VAULT_SHARE_DECIMALS,
        currentValueUsdc,
        pendingYieldUsdc,
        hasPosition: true,
        readOk: true,
      }
    }
  }

  const lpPositions: ArcLpPosition[] = []
  let lpReadsOk = 0
  for (const res of poolResults) {
    if (res.ok) {
      lpReadsOk += 1
      if (res.position) lpPositions.push(res.position)
    } else if (res.unavailableLabel) {
      unavailable.push(res.unavailableLabel)
    }
  }

  // Sort active LP positions by USD value descending
  lpPositions.sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1))

  const measuredReads = (vaultReadOk ? 1 : 0) + lpReadsOk
  const allReadsOk = vaultReadOk && lpReadsOk === livePools.length

  const usdcPrice = priceOf(prices, 'USDC') ?? 1
  const totalVaultUsd =
    vault.currentValueUsdc !== null ? round6(vault.currentValueUsdc * usdcPrice) : null

  const allLpValued = lpPositions.every((p) => p.valueUsd !== null)
  const totalLpUsd = allLpValued
    ? round6(lpPositions.reduce((sum, p) => sum + (p.valueUsd ?? 0), 0))
    : null

  const allFeesValued = lpPositions.every((p) => p.pendingFeesUsd !== null)
  const totalPendingLpFeesUsd = allFeesValued
    ? round6(lpPositions.reduce((sum, p) => sum + (p.pendingFeesUsd ?? 0), 0))
    : null

  const totalDefiUsd =
    totalVaultUsd !== null && totalLpUsd !== null ? round6(totalVaultUsd + totalLpUsd) : null

  // Aggregate underlying tokens held inside Vault + LP pools so portfolio composition stays honest
  const underlyingMap = new Map<string, number>()
  if (vault.currentValueUsdc !== null && vault.currentValueUsdc > 0) {
    underlyingMap.set('USDC', (underlyingMap.get('USDC') ?? 0) + vault.currentValueUsdc)
  }
  for (const lp of lpPositions) {
    if (lp.amountA !== null && lp.amountA > 0) {
      underlyingMap.set(lp.tokenA, (underlyingMap.get(lp.tokenA) ?? 0) + lp.amountA)
    }
    if (lp.amountB !== null && lp.amountB > 0) {
      underlyingMap.set(lp.tokenB, (underlyingMap.get(lp.tokenB) ?? 0) + lp.amountB)
    }
  }

  const underlyingAssets = Array.from(underlyingMap.entries()).map(([symbol, amount]) => {
    const p = priceOf(prices, symbol)
    return {
      symbol,
      amount: round6(amount),
      valueUsd: p !== null ? round6(amount * p) : null,
      stablecoin: STABLE_SYMBOLS.has(symbol.toUpperCase()),
    }
  })

  return {
    vault,
    lpPositions,
    totalVaultUsd,
    totalLpUsd,
    totalPendingLpFeesUsd,
    totalDefiUsd,
    underlyingAssets,
    measuredReads,
    expectedReads,
    unavailable,
    allReadsOk,
  }
}
