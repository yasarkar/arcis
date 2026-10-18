import { parseUnits, zeroAddress, type Address } from 'viem'
import {
  POOL_VERSION_V4,
  poolSlippageBps,
  poolMinLpShares,
  STABLE_SWAP_AMP,
} from '../../config/poolsConfig'
import { getStableSwapD } from '../../utils/poolMath'
import { safeStorage, poolsLog } from './poolTypes'

/**
 * Standardized APY badge formatter across all Arcis pools and vaults.
 */
export function formatPoolApyBadge(
  totalApy: number,
  baseApy: number,
  feeApy: number,
  typeLabel: string
): string {
  if (feeApy > 0) {
    return `${totalApy.toFixed(2)}% APY (${baseApy.toFixed(2)}% Incentive Est. + ${feeApy.toFixed(2)}% Fees)`
  }
  return `${baseApy.toFixed(2)}% ${typeLabel} APY`
}

export function isDeployed(address: string): boolean {
  return Boolean(address && address !== zeroAddress && address.startsWith('0x'))
}

export function requireDeployed(address: string, poolName: string): void {
  if (!isDeployed(address)) {
    throw new Error(`Pool "${poolName}" is not deployed on Arc Testnet yet. Run 'forge script Deploy' first.`)
  }
}

// ── Honest vault APY measurement (H2 fix) ────────────────────────────────────
// `totalYieldDistributed` is cumulative since vault deployment, so annualizing the raw
// lifetime figure directly wildly overstates the APY. Instead the REAL increment of
// distributed yield is measured over a persisted observation window (>= 24h)
// and only that measured rate is annualized. Until a full window has been observed the
// dynamic component is 0 and only the clearly-labeled base estimate is shown.
const VAULT_APY_SNAPSHOT_KEY = 'arcis:pools:vault_yield_apy_snapshot'
const VAULT_APY_MIN_WINDOW_MS = 24 * 60 * 60 * 1000 // require >= 24h of observation

export function measureVaultYieldApy(
  totalYieldDistributedUsd: number,
  totalAssetsUsd: number,
  nowMs: number = Date.now()
): number {
  if (!Number.isFinite(totalYieldDistributedUsd) || !Number.isFinite(totalAssetsUsd)) return 0
  if (!(totalAssetsUsd > 0) || !(totalYieldDistributedUsd > 0)) return 0

  let snapshot: { yield: number; ts: number } | null = null
  try {
    const raw = safeStorage.get(VAULT_APY_SNAPSHOT_KEY)
    if (raw) snapshot = JSON.parse(raw)
  } catch (err) {
    poolsLog.debug('Vault APY snapshot could not be read; re-seeding it', err)
  }

  if (
    !snapshot ||
    typeof snapshot.yield !== 'number' ||
    !Number.isFinite(snapshot.yield) ||
    typeof snapshot.ts !== 'number' ||
    !(snapshot.ts > 0) ||
    snapshot.ts > nowMs ||
    snapshot.yield > totalYieldDistributedUsd
  ) {
    try {
      safeStorage.set(VAULT_APY_SNAPSHOT_KEY, JSON.stringify({ yield: totalYieldDistributedUsd, ts: nowMs }))
    } catch (err) {
      poolsLog.warn('Vault APY seed snapshot could not be persisted; the APY badge stays at 0 for now', err)
    }
    return 0
  }

  const windowMs = nowMs - snapshot.ts
  if (windowMs < VAULT_APY_MIN_WINDOW_MS) return 0

  const windowDays = windowMs / 86_400_000
  const deltaYieldUsd = totalYieldDistributedUsd - snapshot.yield
  try {
    safeStorage.set(VAULT_APY_SNAPSHOT_KEY, JSON.stringify({ yield: totalYieldDistributedUsd, ts: nowMs }))
  } catch (err) {
    poolsLog.warn('Vault APY measurement window could not be persisted; the reported APY may repeat', err)
  }

  if (!(deltaYieldUsd > 0)) return 0
  const apy = ((deltaYieldUsd / windowDays) * 365 * 100) / totalAssetsUsd
  return Number.isFinite(apy) && apy > 0 ? parseFloat(apy.toFixed(2)) : 0
}

// V2/V3 helper: estimate expected LP shares from on-chain reserves and derive a
// conservative minLpShares slippage guard. For Curve StableSwap pools, uses the exact
// invariant _getD matching StableSwapPoolV3.sol to prevent false SlippageExceeded reverts.
export function computeMinLpShares(
  pool: { id: string; tokens?: readonly { decimals?: number }[]; tags?: readonly string[] },
  poolAddress: string,
  poolState: Record<string, any> | undefined,
  amountA: bigint,
  amountB: bigint,
  counterDecimalsInput?: number,
  slippage: number = 0.5
): bigint {
  if (!POOL_VERSION_V4) return 0n
  const st = (poolState || {})[poolAddress] as any
  const slipBps = poolSlippageBps(slippage)
  const counterDecimals =
    counterDecimalsInput ?? pool.tokens?.[1]?.decimals ?? (pool.id === 'usdc-cirbtc-pool' ? 8 : pool.id === 'usdc-weth-pool' ? 18 : 6)

  const reserveARaw = st?.reserveA ? parseUnits(st.reserveA, 6) : 0n
  const totalLpRaw = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
  let expectedLp: bigint = 0n

  if (totalLpRaw <= 0n || reserveARaw <= 0n) return 0n

  const isConstantProduct = pool.id === 'usdc-cirbtc-pool' || pool.id === 'usdc-weth-pool' || pool.id === 'eurc-weth-pool' || pool.tags?.includes('Constant Product')

  if (isConstantProduct) {
    const reserveBRaw = st.reserveB ? parseUnits(st.reserveB, counterDecimals) : 0n
    if (reserveBRaw <= 0n) return 0n
    const lpA = (amountA * totalLpRaw) / reserveARaw
    const lpB = (amountB * totalLpRaw) / reserveBRaw
    expectedLp = lpA < lpB ? lpA : lpB
  } else {
    // StableSwap pool: Exact Curve invariant calculation matching StableSwapPoolV3.sol
    const reserveBRaw = st.reserveB ? parseUnits(st.reserveB, counterDecimals) : 0n
    if (reserveBRaw > 0n && amountA > 0n && amountB > 0n) {
      const d0 = getStableSwapD(reserveARaw, reserveBRaw, STABLE_SWAP_AMP)
      const d1 = getStableSwapD(reserveARaw + amountA, reserveBRaw + amountB, STABLE_SWAP_AMP)
      if (d1 > d0 && d0 > 0n) {
        expectedLp = ((d1 - d0) * totalLpRaw) / d0
      }
    }
    // Fallback if reserveB is 0 or d1 <= d0
    if (expectedLp <= 0n && reserveARaw > 0n) {
      expectedLp = (amountA * totalLpRaw) / reserveARaw
    }
  }
  if (expectedLp <= 0n) return 0n
  return poolMinLpShares(expectedLp, slipBps)
}

/** @deprecated Use computeMinLpShares instead */
export const usePoolsV2MinLpShares = computeMinLpShares

/**
 * Safely estimates transaction gas with a 20% safety margin, falling back cleanly.
 */
export async function estimateSafeGas(
  publicClient: any,
  params: {
    address: `0x${string}`
    abi: any
    functionName: string
    args?: any
    account: Address
  },
  fallbackGas: bigint
): Promise<bigint> {
  try {
    const estimated = await publicClient.estimateContractGas(params)
    return (estimated * 120n) / 100n // 20% safety margin
  } catch (err) {
    console.warn(`[usePoolsData] Gas estimation fallback for ${params.functionName}:`, err)
    return fallbackGas
  }
}
