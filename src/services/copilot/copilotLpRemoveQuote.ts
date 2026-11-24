// src/services/copilot/copilotLpRemoveQuote.ts
// Live on-chain LP withdrawal quote & slippage-guard engine for Ask Arco.
// Reads user's live LP share balance (`balanceOf`), pool reserves (`reserveA`, `reserveB`, `totalLp`),
// and `paused` status on Arc Testnet, computes exact expected Token A + Token B outputs and
// V4 `minOutA` / `minOutB` slippage guards, and surfaces other active LP positions if the requested pool is empty.

import { formatUnits, parseUnits, zeroAddress, type Address } from 'viem'
import {
  POOL_DEFAULT_SLIPPAGE_BPS,
  POOL_VERSION_V4,
  STABLE_SWAP_ABI,
  poolMinOut,
  poolSlippageBps,
  type PoolConfig,
} from '../../config/poolsConfig.js'
import { ARC_GAS_LIMITS, type SpeedTier } from '../../config/feeTiers.js'
import { COPILOT_LP_POOLS } from '../../utils/copilotPoolParser.js'
import { getResilientPublicClient } from '../rpc/index.js'
import { calculateArcGasCostFromFee, getDynamicArcGasOptions } from '../arcGasService.js'
import { DEFAULT_TOKEN_PRICES, getLiveTokenPrices, normalizeTokenSymbol } from '../tokenPriceService.js'

export interface LpRemoveQuoteInput {
  walletAddress: string
  pool: PoolConfig
  removeMode: 'percent' | 'lp' | 'usd'
  removePercent?: number
  lpAmount?: number
  lpAmountDecimal?: string
  usdAmount?: number
  slippageBps?: number
  speedTier?: SpeedTier
}

export interface ActiveLpPositionSummary {
  poolId: string
  poolName: string
  lpTokenSymbol: string
  lpBalanceDecimal: string
  tokenA: string
  tokenB: string
  outADecimal: string
  outBDecimal: string
  estimatedUsd: number
}

export interface LpRemoveQuoteSuccess {
  ok: true
  quote: {
    removeMode: 'percent' | 'lp' | 'usd'
    removePercent: number
    lpAmount: number
    lpAmountDecimal: string
    lpAmountRaw: string
    userLpBalanceDecimal: string
    estimatedOutA: string
    estimatedOutB: string
    minOutA: string
    minOutB: string
    minOutARaw: string
    minOutBRaw: string
    estimatedWithdrawUsd: number
    slippageBps: number
    estimatedFeeUsdc?: string
    feeEstimateSource?: string
  }
}

export interface LpRemoveQuoteFailure {
  ok: false
  empty?: boolean
  otherActivePositions?: ActiveLpPositionSummary[]
  error: string
}

export type LpRemoveQuoteResult = LpRemoveQuoteSuccess | LpRemoveQuoteFailure

function isDeployedAddress(addr?: string): addr is Address {
  return Boolean(addr && addr.startsWith('0x') && addr.toLowerCase() !== zeroAddress)
}

function trimUnits(units: bigint, decimals: number): string {
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

/** Scans all deployed AMM LP pools (optionally excluding `excludePoolId`) for active user LP balances. */
export async function scanActiveCopilotLpPositions(
  walletAddress: string,
  excludePoolId?: string
): Promise<ActiveLpPositionSummary[]> {
  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) return []
  const client = getResilientPublicClient('Arc_Testnet')
  const owner = walletAddress as Address
  const pools = COPILOT_LP_POOLS.filter(
    (p) => p.id !== excludePoolId && isDeployedAddress(p.contractAddress)
  )
  if (pools.length === 0) return []

  const [prices, reads] = await Promise.all([
    getLiveTokenPrices().catch(() => ({ ...DEFAULT_TOKEN_PRICES })),
    Promise.all(
      pools.map(async (pool) => {
        try {
          const [lpRaw, rA, rB, totalLp] = await Promise.all([
            client.readContract({ address: pool.contractAddress, abi: STABLE_SWAP_ABI, functionName: 'balanceOf', args: [owner] }) as Promise<bigint>,
            client.readContract({ address: pool.contractAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }) as Promise<bigint>,
            client.readContract({ address: pool.contractAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }) as Promise<bigint>,
            client.readContract({ address: pool.contractAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }) as Promise<bigint>,
          ])
          return { pool, lpRaw, rA, rB, totalLp }
        } catch {
          return null
        }
      })
    ),
  ])

  const active: ActiveLpPositionSummary[] = []
  for (const row of reads) {
    if (!row || row.lpRaw <= 0n || row.totalLp <= 0n) continue
    const { pool, lpRaw, rA, rB, totalLp } = row
    const tokenA = pool.tokens[0]
    const tokenB = pool.tokens[1]
    const outA = (rA * lpRaw) / totalLp
    const outB = (rB * lpRaw) / totalLp
    const usdA = Number(formatUnits(outA, tokenA.decimals)) * tokenUsdPrice(tokenA.symbol, prices)
    const usdB = Number(formatUnits(outB, tokenB.decimals)) * tokenUsdPrice(tokenB.symbol, prices)
    active.push({
      poolId: pool.id,
      poolName: pool.name,
      lpTokenSymbol: pool.lpTokenSymbol || `af-${tokenA.symbol}-${tokenB.symbol}`,
      lpBalanceDecimal: trimUnits(lpRaw, 18),
      tokenA: tokenA.symbol,
      tokenB: tokenB.symbol,
      outADecimal: trimUnits(outA, tokenA.decimals),
      outBDecimal: trimUnits(outB, tokenB.decimals),
      estimatedUsd: Number((usdA + usdB).toFixed(4)),
    })
  }
  return active
}

export function formatActiveLpPositionsLines(positions: ActiveLpPositionSummary[]): string {
  return positions
    .map((p) => `• <strong>${p.poolName}:</strong> ${p.outADecimal} [[token:${p.tokenA}]] + ${p.outBDecimal} [[token:${p.tokenB}]] (~$${p.estimatedUsd.toFixed(2)} USD)`)
    .join('\n')
}

export async function getCopilotLpRemoveQuote(
  input: LpRemoveQuoteInput
): Promise<LpRemoveQuoteResult> {
  const { walletAddress, pool, removeMode } = input

  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return {
      ok: false,
      error: '<strong>Connect your wallet first.</strong>\n\nPlease connect an Arc wallet so I can check your LP position on-chain.',
    }
  }

  if (!isDeployedAddress(pool.contractAddress)) {
    return {
      ok: false,
      error: `<strong>Pool unavailable.</strong>\n\nThe <strong>${pool.name}</strong> pool is not deployed on Arc Testnet yet.`,
    }
  }

  const client = getResilientPublicClient('Arc_Testnet')
  const owner = walletAddress as Address
  const poolAddress = pool.contractAddress as Address
  const tokenA = pool.tokens[0]
  const tokenB = pool.tokens[1]

  const slipBps =
    typeof input.slippageBps === 'number' && Number.isFinite(input.slippageBps) && input.slippageBps > 0
      ? poolSlippageBps(input.slippageBps / 100)
      : POOL_DEFAULT_SLIPPAGE_BPS

  let userLpRaw: bigint
  let reserveA: bigint
  let reserveB: bigint
  let totalLp: bigint
  let paused: boolean
  let prices: Record<string, number>

  try {
    const [lpBal, rA, rB, tLp, p, livePrices] = await Promise.all([
      client.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'balanceOf', args: [owner] }) as Promise<bigint>,
      client.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }) as Promise<bigint>,
      client.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }) as Promise<bigint>,
      client.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }) as Promise<bigint>,
      client.readContract({ address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'paused' }).catch(() => false) as Promise<boolean>,
      getLiveTokenPrices().catch(() => ({ ...DEFAULT_TOKEN_PRICES })),
    ])
    userLpRaw = lpBal
    reserveA = rA
    reserveB = rB
    totalLp = tLp
    paused = Boolean(p)
    prices = livePrices
  } catch (err) {
    console.warn('[copilotLpRemoveQuote] Failed to read pool position:', err)
    return {
      ok: false,
      error: `<strong>Pool position unavailable.</strong>\n\nCould not read your <strong>${pool.name}</strong> LP balance from Arc Testnet. Please try again in a moment.`,
    }
  }

  if (paused) {
    return {
      ok: false,
      error: `<strong>Pool paused.</strong>\n\nThe <strong>${pool.name}</strong> pool is currently paused on-chain.`,
    }
  }

  if (userLpRaw <= 0n) {
    const otherActive = await scanActiveCopilotLpPositions(walletAddress, pool.id)
    if (otherActive.length > 0) {
      return {
        ok: false,
        empty: true,
        otherActivePositions: otherActive,
        error: `<strong>No LP position in ${pool.name}.</strong>\n\nYou currently hold <strong>0 LP tokens</strong> in <strong>${pool.name}</strong>.\n\n<strong>Your active LP positions:</strong>\n${formatActiveLpPositionsLines(otherActive)}\n\nSpecify one of the pools above — e.g. <strong>"Remove 50% LP from ${otherActive[0].poolName} pool"</strong>.`,
      }
    }
    return {
      ok: false,
      empty: true,
      error: `<strong>No LP position in ${pool.name}.</strong>\n\nYou currently hold <strong>0 LP tokens</strong> in <strong>${pool.name}</strong> and no active LP positions across other Arc pools.`,
    }
  }

  if (totalLp <= 0n || reserveA <= 0n || reserveB <= 0n) {
    return {
      ok: false,
      error: `<strong>Pool reserves unavailable.</strong>\n\nThe <strong>${pool.name}</strong> pool reserves cannot be verified right now.`,
    }
  }

  const userOutAFull = (reserveA * userLpRaw) / totalLp
  const userOutBFull = (reserveB * userLpRaw) / totalLp
  const userPositionUsd =
    Number(formatUnits(userOutAFull, tokenA.decimals)) * tokenUsdPrice(tokenA.symbol, prices) +
    Number(formatUnits(userOutBFull, tokenB.decimals)) * tokenUsdPrice(tokenB.symbol, prices)
  const userLpBalanceDecimal = trimUnits(userLpRaw, 18)

  let lpToRemoveRaw: bigint

  if (removeMode === 'percent') {
    const pct = Number(input.removePercent)
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return { ok: false, error: '<strong>Invalid percentage.</strong>\n\nChoose a removal percentage between 1% and 100%.' }
    }
    lpToRemoveRaw = pct >= 100 ? userLpRaw : (userLpRaw * BigInt(Math.round(pct * 100))) / 10000n
  } else if (removeMode === 'usd') {
    const targetUsd = Number(input.usdAmount)
    if (!Number.isFinite(targetUsd) || targetUsd <= 0) {
      return { ok: false, error: '<strong>Valid USD amount required.</strong>\n\nPlease specify a positive USD amount to remove.' }
    }
    if (userPositionUsd <= 0) {
      return {
        ok: false,
        error: '<strong>Unable to value LP position in USD.</strong>\n\nPlease specify a percentage (e.g. 50%) or LP token amount directly.',
      }
    }
    if (targetUsd > userPositionUsd * 1.001) {
      return {
        ok: false,
        error: `<strong>Insufficient LP position value.</strong>\n\nYour <strong>${pool.name}</strong> LP position is worth about <strong>$${userPositionUsd.toFixed(2)} USD</strong> (${userLpBalanceDecimal} LP), which is less than $${targetUsd.toFixed(2)}.`,
      }
    }
    lpToRemoveRaw =
      targetUsd >= userPositionUsd * 0.999
        ? userLpRaw
        : BigInt(Math.floor((targetUsd / userPositionUsd) * Number(userLpRaw)))
    if (lpToRemoveRaw > userLpRaw) lpToRemoveRaw = userLpRaw
  } else {
    const decStr = input.lpAmountDecimal || (input.lpAmount ? String(input.lpAmount) : '')
    if (!decStr) {
      return { ok: false, error: '<strong>Valid LP amount required.</strong>\n\nPlease specify how many LP tokens to remove.' }
    }
    try {
      lpToRemoveRaw = parseUnits(decStr, 18)
    } catch {
      return { ok: false, error: '<strong>Invalid LP token amount.</strong>\n\nPlease enter a valid positive LP token amount.' }
    }
    if (lpToRemoveRaw > userLpRaw) {
      return {
        ok: false,
        error: `<strong>Insufficient LP balance.</strong>\n\nYou hold <strong>${userLpBalanceDecimal} ${pool.lpTokenSymbol || 'LP'}</strong> (~$${userPositionUsd.toFixed(2)} USD) in <strong>${pool.name}</strong>. Use a smaller amount or say <strong>"Remove 100% LP from ${pool.name} pool"</strong>.`,
      }
    }
  }

  if (lpToRemoveRaw <= 0n) {
    return {
      ok: false,
      error: '<strong>Withdrawal amount too small.</strong>\n\nPlease specify a larger percentage or LP amount.',
    }
  }

  const expectedOutA = (reserveA * lpToRemoveRaw) / totalLp
  const expectedOutB = (reserveB * lpToRemoveRaw) / totalLp
  const minOutARaw = POOL_VERSION_V4 ? poolMinOut(expectedOutA, slipBps) : 0n
  const minOutBRaw = POOL_VERSION_V4 ? poolMinOut(expectedOutB, slipBps) : 0n

  if (POOL_VERSION_V4 && minOutARaw <= 0n && minOutBRaw <= 0n) {
    return {
      ok: false,
      error: '<strong>Withdrawal amount too small for slippage guard.</strong>\n\nPlease specify a larger LP removal amount.',
    }
  }

  const outANum = Number(formatUnits(expectedOutA, tokenA.decimals))
  const outBNum = Number(formatUnits(expectedOutB, tokenB.decimals))
  const estimatedWithdrawUsd = Number(
    (outANum * tokenUsdPrice(tokenA.symbol, prices) + outBNum * tokenUsdPrice(tokenB.symbol, prices)).toFixed(4)
  )
  const computedPercent =
    lpToRemoveRaw >= userLpRaw
      ? 100
      : Math.max(0.01, Number(((lpToRemoveRaw * 10000n) / userLpRaw)) / 100)
  const lpAmountDecimal = trimUnits(lpToRemoveRaw, 18)

  const gasLimit = ARC_GAS_LIMITS.contractInteraction
  let estimatedFeeUsdc: string | undefined
  let feeEstimateSource: string | undefined
  try {
    const gas = await getDynamicArcGasOptions(undefined, input.speedTier || 'fast', gasLimit)
    estimatedFeeUsdc = calculateArcGasCostFromFee(gasLimit, gas.maxFeePerGas)
    feeEstimateSource = gas.source
  } catch {
    // Non-fatal
  }

  return {
    ok: true,
    quote: {
      removeMode,
      removePercent: computedPercent,
      lpAmount: Number(lpAmountDecimal),
      lpAmountDecimal,
      lpAmountRaw: lpToRemoveRaw.toString(),
      userLpBalanceDecimal,
      estimatedOutA: trimUnits(expectedOutA, tokenA.decimals),
      estimatedOutB: trimUnits(expectedOutB, tokenB.decimals),
      minOutA: trimUnits(minOutARaw, tokenA.decimals),
      minOutB: trimUnits(minOutBRaw, tokenB.decimals),
      minOutARaw: minOutARaw.toString(),
      minOutBRaw: minOutBRaw.toString(),
      estimatedWithdrawUsd,
      slippageBps: slipBps,
      estimatedFeeUsdc,
      feeEstimateSource,
    },
  }
}
