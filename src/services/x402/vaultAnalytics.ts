// src/services/x402/vaultAnalytics.ts
// Arc Yield & Pool Opportunity Finder for the priced AI service `arc-yield-vault-analytics`.
//
// Reads live on-chain state from BOTH the ERC-4626 USDC Yield Vault (`totalAssets()`,
// `totalSupply()`) AND all 6 deployed Arc Testnet V4 AMM pools (`reserveA`, `reserveB`,
// `swapFeeBps`, `volume24hA`, `volume24hB`, `paused`), plus optional wallet token balances
// to highlight opportunities the caller can enter with tokens they already hold.
//
// Every figure is derived from live contract reads and live oracle prices — never invented.
// When a read fails the field stays null and the reason is listed.
// The response carries the shared institutional envelope (`institutionalReport.ts`) under `report`.

import { formatUnits, getAddress, type Address } from 'viem'
import {
  ARCIS_POOLS,
  ERC20_ABI,
  POOL_CONTRACTS,
  STABLE_SWAP_ABI,
  VAULT_SHARE_DECIMALS,
  YIELD_VAULT_ABI,
  type PoolConfig,
  type PoolRiskLevel,
} from '../../config/poolsConfig.js'
import { ARC_TOKENS } from '../../config/arcChain.js'
import { getArcPublicClient, resilientReadContract } from '../rpc/index.js'
import { getLiveTokenPrices, normalizeTokenSymbol } from '../tokenPriceService.js'
import {
  buildInstitutionalReport,
  institutionalRisk,
  type InstitutionalReport,
  type InstitutionalRisk,
} from './institutionalReport.js'

export const VAULT_ANALYTICS_SERVICE_ID = 'arc-yield-vault-analytics'

export type YieldRiskPreference = 'all' | 'stable_only' | 'volatile_only'

export const YIELD_RISK_PREFERENCES: YieldRiskPreference[] = ['all', 'stable_only', 'volatile_only']

const REPORT_TITLE = 'Arc Yield & Pool Opportunity Report'

const REPORT_LIMITATIONS = [
  'Vault share price and TVL reflect current ERC-4626 accounting; strategy risk and future yield distribution are outside what the contract exposes.',
  'Pool 24h annualized fee run-rates are arithmetic from each pool’s rolling on-chain 24h volume counter and fee tier, not a guaranteed or historical APY.',
  'No historical time series is readable on-chain, so no multi-day drawdown or realized return is computed.',
]

const WALLET_BALANCE_TOKENS = [
  { symbol: 'USDC', address: ARC_TOKENS.USDC as Address, decimals: 6 },
  { symbol: 'EURC', address: ARC_TOKENS.EURC as Address, decimals: 6 },
  { symbol: 'WETH', address: ARC_TOKENS.WETH as Address, decimals: 18 },
  { symbol: 'cirBTC', address: ARC_TOKENS.cirBTC as Address, decimals: 8 },
] as const

export interface YieldOpportunity {
  id: string
  name: string
  kind: 'vault' | 'lp_pool'
  contractAddress: string
  tokens: string[]
  riskLevel: PoolRiskLevel
  impermanentLossRisk: string
  feeTierPct: number | null
  tvlUsd: number | null
  volume24hUsd: number | null
  /** Measured 24h on-chain volume × fee tier ÷ TVL annualized; null when unmeasurable. */
  feeRunRateAnnualizedPct: number | null
  paused: boolean
  walletEligible: boolean | null
  matchedTokens: string[]
}

export interface VaultAnalyticsResult {
  status: 'VAULT_READ' | 'VAULT_EMPTY' | 'UNAVAILABLE'
  riskPreference: YieldRiskPreference
  walletAddress: string | null
  vaultAddress: string
  totalAssetsUsdc: number | null
  totalSupplyShares: string | null
  sharePriceUsdc: number | null
  tvlUsdc: number | null
  shareDecimals: number
  poolsScannedCount: number
  poolsMeasuredCount: number
  totalProtocolTvlUsd: number | null
  opportunities: YieldOpportunity[]
  /** Institutional envelope: identity, freshness, coverage, grade, graded risk register. */
  report: InstitutionalReport
  readAt: number
  unavailable: string[]
  limitations: string[]
  reason?: string
  note: string
}

const round6 = (value: number): number => Number(value.toFixed(6))
const round2 = (value: number): number => Number(value.toFixed(2))

export function normalizeRiskPreference(value: unknown): YieldRiskPreference {
  const text = String(value || '').trim().toLowerCase()
  if (text === 'stable_only' || text === 'volatile_only') return text
  return 'all'
}

function normalizeOptionalWallet(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!/^0x[a-fA-F0-9]{40}$/.test(text)) return null
  try {
    return getAddress(text.toLowerCase())
  } catch {
    return null
  }
}

function oraclePriceOf(prices: Record<string, number>, symbol: string): number | null {
  const direct = prices[symbol] ?? prices[symbol.toUpperCase()] ?? prices[normalizeTokenSymbol(symbol)]
  return typeof direct === 'number' && Number.isFinite(direct) && direct > 0 ? direct : null
}

function matchesRiskPreference(opportunity: Pick<YieldOpportunity, 'kind' | 'riskLevel'>, pref: YieldRiskPreference): boolean {
  if (pref === 'all') return true
  if (pref === 'stable_only') return opportunity.kind === 'vault' || opportunity.riskLevel === 'Safe'
  return opportunity.kind === 'lp_pool' && opportunity.riskLevel !== 'Safe'
}

interface PoolReadOutcome {
  pool: PoolConfig
  ok: boolean
  tvlUsd: number | null
  volume24hUsd: number | null
  feeTierPct: number | null
  feeRunRateAnnualizedPct: number | null
  paused: boolean
}

async function readSingleAmmPool(
  client: ReturnType<typeof getArcPublicClient>,
  pool: PoolConfig,
  prices: Record<string, number>
): Promise<PoolReadOutcome> {
  const tokenA = pool.tokens[0]
  const tokenB = pool.tokens[1]
  const addr = pool.contractAddress as Address

  const [rA, rB, feeBpsRaw, volARaw, volBRaw, pausedRaw] = await Promise.all([
    resilientReadContract(client, { address: addr, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }).catch(() => null),
    resilientReadContract(client, { address: addr, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }).catch(() => null),
    resilientReadContract(client, { address: addr, abi: STABLE_SWAP_ABI, functionName: 'swapFeeBps' }).catch(() => null),
    resilientReadContract(client, { address: addr, abi: STABLE_SWAP_ABI, functionName: 'volume24hA' }).catch(() => null),
    resilientReadContract(client, { address: addr, abi: STABLE_SWAP_ABI, functionName: 'volume24hB' }).catch(() => null),
    resilientReadContract(client, { address: addr, abi: STABLE_SWAP_ABI, functionName: 'paused' }).catch(() => false),
  ])

  if (rA === null || rB === null) {
    return {
      pool,
      ok: false,
      tvlUsd: null,
      volume24hUsd: null,
      feeTierPct: pool.feeTierPercent ?? null,
      feeRunRateAnnualizedPct: null,
      paused: Boolean(pausedRaw),
    }
  }

  const amountA = Number(formatUnits(rA as bigint, tokenA.decimals))
  const amountB = Number(formatUnits(rB as bigint, tokenB.decimals))
  const priceA = oraclePriceOf(prices, tokenA.symbol)
  const priceB = oraclePriceOf(prices, tokenB.symbol)

  const tvlUsd =
    priceA !== null && priceB !== null
      ? round2(amountA * priceA + amountB * priceB)
      : amountA === 0 && amountB === 0
        ? 0
        : null

  const volA = volARaw !== null ? Number(formatUnits(volARaw as bigint, tokenA.decimals)) : null
  const volB = volBRaw !== null ? Number(formatUnits(volBRaw as bigint, tokenB.decimals)) : null
  const volume24hUsd =
    volA !== null && volB !== null && priceA !== null && priceB !== null
      ? round2(volA * priceA + volB * priceB)
      : volA === 0 && volB === 0
        ? 0
        : null

  const feeBps =
    typeof feeBpsRaw === 'bigint' && feeBpsRaw > 0n
      ? Number(feeBpsRaw)
      : pool.feeTierPercent !== undefined
        ? Math.round(pool.feeTierPercent * 100)
        : null
  const feeTierPct = feeBps !== null ? Number((feeBps / 100).toFixed(3)) : null

  const feeRunRateAnnualizedPct =
    tvlUsd !== null && tvlUsd > 0 && volume24hUsd !== null && feeBps !== null
      ? round2(((volume24hUsd * (feeBps / 10_000)) / tvlUsd) * 365 * 100)
      : null

  return {
    pool,
    ok: true,
    tvlUsd,
    volume24hUsd,
    feeTierPct,
    feeRunRateAnnualizedPct,
    paused: Boolean(pausedRaw),
  }
}

/**
 * Reads live state from the ERC-4626 USDC Yield Vault and all 6 deployed Arc V4 AMM pools,
 * optionally matching them against a connected wallet's live Arc token balances.
 */
export async function readVaultAnalytics(input: {
  riskPreference?: unknown
  walletAddress?: unknown
  /** Legacy unused alias kept optional for older callers; never echoed as a fake APY window. */
  windowDays?: unknown
}): Promise<VaultAnalyticsResult> {
  const readAt = Date.now()
  const riskPreference = normalizeRiskPreference(input.riskPreference)
  const walletAddress = normalizeOptionalWallet(input.walletAddress)
  const vaultAddress = String(POOL_CONTRACTS.YIELD_VAULT)
  const liveAmmPools = ARCIS_POOLS.filter((p) => p.isLpPool && p.isLiveOnChain)
  const note =
    'Vault TVL/share price and all 6 Arc V4 AMM pool reserves, 24h volumes and fee tiers are read live on-chain. No historical APY series exists on-chain; pool run-rates reflect 24h rolling volume only.'

  const expectedReads = 2 + liveAmmPools.length + (walletAddress ? WALLET_BALANCE_TOKENS.length : 0)

  const reportFor = (measuredReads: number, risks: InstitutionalRisk[]): InstitutionalReport =>
    buildInstitutionalReport({
      kind: 'VAULT_ANALYTICS',
      serviceId: VAULT_ANALYTICS_SERVICE_ID,
      title: REPORT_TITLE,
      subject: { type: 'VAULT', identifier: vaultAddress },
      issuedAt: readAt,
      asOf: readAt,
      coverage: { measuredReads, expectedReads },
      risks: [
        ...risks,
        institutionalRisk({
          id: 'NO_HISTORICAL_SERIES',
          category: 'DISCLOSURE',
          severity: 'INFO',
          title: 'On-chain snapshot — no historical APY series',
          finding:
            'Vault accounting and pool 24h volume counters reflect live state at call time; no multi-day historical APY series is readable on-chain.',
          evidence: { riskPreference, poolsScannedCount: liveAmmPools.length },
          threshold: null,
          remediation:
            'Use 24h fee run-rates as a point-in-time activity indicator, not a guaranteed yield forecast.',
        }),
      ],
      methodology: [
        'totalAssets() and totalSupply() are read via eth_call against the ERC-4626 USDC Yield Vault.',
        'All 6 Arc V4 AMM pools are queried in parallel for reserveA, reserveB, swapFeeBps, volume24hA, volume24hB and paused().',
        'Pool TVL and 24h volume are valued in USD with live oracle prices; unpriced non-zero reserves stay null.',
        walletAddress
          ? 'Wallet Arc ERC-20 balances (USDC, EURC, WETH, cirBTC) are read to tag immediately enterable opportunities.'
          : 'No wallet address was supplied, so wallet-balance matching is omitted.',
      ],
      limitations: REPORT_LIMITATIONS,
    })

  try {
    const client = getArcPublicClient()
    const [prices, assets, supply] = await Promise.all([
      getLiveTokenPrices().catch(() => ({} as Record<string, number>)),
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

    const [poolOutcomes, walletTokenReads] = await Promise.all([
      Promise.all(liveAmmPools.map((pool) => readSingleAmmPool(client, pool, prices))),
      walletAddress
        ? Promise.all(
            WALLET_BALANCE_TOKENS.map((tok) =>
              resilientReadContract(client, {
                address: tok.address,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [walletAddress as Address],
              })
                .then((raw) => ({
                  symbol: tok.symbol,
                  balance: Number(formatUnits(raw as bigint, tok.decimals)),
                }))
                .catch(() => ({ symbol: tok.symbol, balance: null }))
            )
          )
        : Promise.resolve([]),
    ])

    const heldSymbols = new Set<string>(
      walletTokenReads
        .filter((entry) => entry.balance !== null && entry.balance > 0)
        .map((entry) => entry.symbol)
    )
    const walletReadsReturned = walletTokenReads.filter((entry) => entry.balance !== null).length
    const poolsMeasuredCount = poolOutcomes.filter((o) => o.ok).length

    const unavailable: string[] = []
    if (assets === null) unavailable.push('vault totalAssets()')
    if (supply === null) unavailable.push('vault totalSupply()')
    for (const outcome of poolOutcomes) {
      if (!outcome.ok) unavailable.push(`${outcome.pool.name} pool reserves`)
    }

    const vaultReadsReturned = (assets !== null ? 1 : 0) + (supply !== null ? 1 : 0)
    const measuredReads = vaultReadsReturned + poolsMeasuredCount + walletReadsReturned

    // Build pool opportunity rows
    const poolOpportunities: YieldOpportunity[] = poolOutcomes.map((o) => {
      const symbols = o.pool.tokens.map((t) => t.symbol)
      const matched = walletAddress ? symbols.filter((sym) => heldSymbols.has(sym)) : []
      return {
        id: o.pool.id,
        name: `${o.pool.name} LP`,
        kind: 'lp_pool',
        contractAddress: o.pool.contractAddress,
        tokens: symbols,
        riskLevel: o.pool.riskLevel,
        impermanentLossRisk: o.pool.impermanentLossRisk || 'Medium',
        feeTierPct: o.feeTierPct,
        tvlUsd: o.tvlUsd,
        volume24hUsd: o.volume24hUsd,
        feeRunRateAnnualizedPct: o.feeRunRateAnnualizedPct,
        paused: o.paused,
        walletEligible: walletAddress ? matched.length > 0 : null,
        matchedTokens: matched,
      }
    })

    const pausedPools = poolOpportunities.filter((p) => p.paused)

    if (assets === null || supply === null) {
      const filteredPools = poolOpportunities.filter((op) => matchesRiskPreference(op, riskPreference))
      return {
        status: 'UNAVAILABLE',
        riskPreference,
        walletAddress,
        vaultAddress,
        totalAssetsUsdc: assets === null ? null : Number(formatUnits(assets as bigint, 6)),
        totalSupplyShares: supply === null ? null : formatUnits(supply as bigint, VAULT_SHARE_DECIMALS),
        sharePriceUsdc: null,
        tvlUsdc: null,
        shareDecimals: VAULT_SHARE_DECIMALS,
        poolsScannedCount: liveAmmPools.length,
        poolsMeasuredCount,
        totalProtocolTvlUsd: null,
        opportunities: filteredPools,
        report: reportFor(measuredReads, [
          institutionalRisk({
            id: 'VAULT_READ_FAILED',
            category: 'DATA_QUALITY',
            severity: 'HIGH',
            title: 'Vault accounting read did not return',
            finding: `${unavailable.filter((u) => u.startsWith('vault')).join(' and ')} returned nothing, so TVL and share price are withheld rather than derived from a partial read.`,
            evidence: {
              measuredReads,
              expectedReads,
              unavailableReads: unavailable.join(', '),
            },
            threshold: 'Both totalAssets() and totalSupply() must return before TVL or share price is published.',
            remediation: 'Re-run the call once the Arc RPC answers; a failed read is never substituted with zero.',
          }),
        ]),
        readAt,
        unavailable,
        limitations: REPORT_LIMITATIONS,
        reason: `Vault analytics not computed: could not read ${unavailable.filter((u) => u.startsWith('vault')).join(' and ')}.`,
        note,
      }
    }

    const totalAssetsUsdc = Number(formatUnits(assets as bigint, 6))
    const totalSupplyShares = formatUnits(supply as bigint, VAULT_SHARE_DECIMALS)
    const supplyNumber = Number(totalSupplyShares)
    const isVaultEmpty = supply === 0n || !Number.isFinite(supplyNumber) || supplyNumber <= 0
    const sharePriceUsdc = isVaultEmpty ? null : round6(totalAssetsUsdc / supplyNumber)

    const vaultMatched = walletAddress && heldSymbols.has('USDC') ? ['USDC'] : []
    const vaultOpportunity: YieldOpportunity = {
      id: 'usdc-yield-vault',
      name: 'USDC Yield Vault (ERC-4626)',
      kind: 'vault',
      contractAddress: vaultAddress,
      tokens: ['USDC'],
      riskLevel: 'Low',
      impermanentLossRisk: 'Zero (Single-Asset)',
      feeTierPct: 0,
      tvlUsd: round2(totalAssetsUsdc),
      volume24hUsd: 0,
      feeRunRateAnnualizedPct: null,
      paused: false,
      walletEligible: walletAddress ? vaultMatched.length > 0 : null,
      matchedTokens: vaultMatched,
    }

    const allOpportunities = [vaultOpportunity, ...poolOpportunities]
      .filter((op) => matchesRiskPreference(op, riskPreference))
      .sort((a, b) => {
        if (a.paused !== b.paused) return a.paused ? 1 : -1
        if (walletAddress && a.walletEligible !== b.walletEligible) return a.walletEligible ? -1 : 1
        const runA = a.feeRunRateAnnualizedPct ?? -1
        const runB = b.feeRunRateAnnualizedPct ?? -1
        if (runA !== runB) return runB - runA
        const tvlA = a.tvlUsd ?? -1
        const tvlB = b.tvlUsd ?? -1
        return tvlB - tvlA
      })

    const allTvlsKnown = poolOpportunities.every((p) => p.tvlUsd !== null)
    const totalProtocolTvlUsd = allTvlsKnown
      ? round2(totalAssetsUsdc + poolOpportunities.reduce((sum, p) => sum + (p.tvlUsd ?? 0), 0))
      : null

    const risks: InstitutionalRisk[] = []

    if (isVaultEmpty) {
      const assetsWithoutShares = totalAssetsUsdc > 0
      risks.push(
        institutionalRisk({
          id: assetsWithoutShares ? 'VAULT_ASSETS_WITHOUT_SHARES' : 'VAULT_NO_SHARES',
          category: 'COMPOSITION',
          severity: assetsWithoutShares ? 'HIGH' : 'LOW',
          title: assetsWithoutShares
            ? 'Vault reports assets but no shares outstanding'
            : 'Vault has no shares outstanding',
          finding: assetsWithoutShares
            ? `The vault reports ${totalAssetsUsdc} USDC of assets against zero shares, so no holder has a claim measured by a share price.`
            : 'The vault reports zero shares outstanding, so an assets-per-share figure is undefined and is not published.',
          evidence: { totalAssetsUsdc, totalSupplyShares },
          threshold: 'Share price requires totalSupply() > 0.',
          remediation: assetsWithoutShares
            ? 'Treat the vault accounting as inconsistent until the contract’s supply and assets reconcile; no share price is issued.'
            : 'A vault without shares has no per-share economics to report. Re-run after the first deposit.',
        })
      )
    } else {
      risks.push(
        institutionalRisk({
          id: 'VAULT_ACTIVE_RESERVES',
          category: 'COMPOSITION',
          severity: 'INFO',
          title: 'USDC Yield Vault & Arc Pools Measured Live',
          finding: `Vault holds ${totalAssetsUsdc} USDC across ${totalSupplyShares} shares (${sharePriceUsdc} USDC/share); ${poolsMeasuredCount}/${liveAmmPools.length} AMM pools read on-chain.`,
          evidence: {
            totalAssetsUsdc,
            totalSupplyShares,
            sharePriceUsdc: sharePriceUsdc!,
            poolsMeasuredCount,
            totalProtocolTvlUsd,
          },
          threshold: 'Vault totalAssets() > 0 and totalSupply() > 0.',
          remediation: 'Compare the ranked vault and pool opportunities in the Pools tab before depositing.',
        })
      )
    }

    if (pausedPools.length > 0) {
      risks.push(
        institutionalRisk({
          id: 'POOL_PAUSED',
          category: 'MARKET_STRUCTURE',
          severity: 'MEDIUM',
          title: `${pausedPools.length} Arc AMM Pool(s) Currently Paused`,
          finding: `${pausedPools.map((p) => p.name).join(', ')} reported paused=true on-chain and cannot accept swaps or new liquidity.`,
          evidence: { pausedPools: pausedPools.map((p) => p.name).join(', ') },
          threshold: 'Active liquidity opportunities must report paused() == false.',
          remediation: 'Exclude paused pools and use active pools or the USDC Yield Vault instead.',
        })
      )
    }

    if (walletAddress) {
      const eligibleCount = allOpportunities.filter((o) => o.walletEligible).length
      risks.push(
        institutionalRisk({
          id: eligibleCount > 0 ? 'WALLET_OPPORTUNITIES_MATCHED' : 'NO_WALLET_MATCHED_TOKENS',
          category: 'COMPOSITION',
          severity: 'INFO',
          title:
            eligibleCount > 0
              ? `${eligibleCount} Opportunity(ies) Match Your Wallet Balances`
              : 'No Held Arc Tokens Match Filtered Opportunities',
          finding:
            eligibleCount > 0
              ? `Wallet holds ${Array.from(heldSymbols).join(', ')} matching ${eligibleCount} of ${allOpportunities.length} filtered yield opportunities.`
              : 'Connected wallet holds zero balance of the tokens required by the filtered opportunities.',
          evidence: { eligibleCount, filteredCount: allOpportunities.length },
          threshold: 'Wallet ERC-20 balanceOf() > 0 for at least one deposit asset.',
          remediation:
            eligibleCount > 0
              ? 'Open the Pools tab to deposit directly into any wallet-matched pool or vault.'
              : 'Acquire USDC/EURC via Faucet or Bridge before entering a yield position.',
        })
      )
    }

    return {
      status: isVaultEmpty ? 'VAULT_EMPTY' : 'VAULT_READ',
      riskPreference,
      walletAddress,
      vaultAddress,
      totalAssetsUsdc,
      totalSupplyShares,
      sharePriceUsdc,
      tvlUsdc: totalAssetsUsdc,
      shareDecimals: VAULT_SHARE_DECIMALS,
      poolsScannedCount: liveAmmPools.length,
      poolsMeasuredCount,
      totalProtocolTvlUsd,
      opportunities: allOpportunities,
      report: reportFor(measuredReads, risks),
      readAt,
      unavailable: isVaultEmpty
        ? ['share price (vault has no shares outstanding)', ...unavailable]
        : unavailable,
      limitations: REPORT_LIMITATIONS,
      note,
    }
  } catch (err) {
    return {
      status: 'UNAVAILABLE',
      riskPreference,
      walletAddress,
      vaultAddress,
      totalAssetsUsdc: null,
      totalSupplyShares: null,
      sharePriceUsdc: null,
      tvlUsdc: null,
      shareDecimals: VAULT_SHARE_DECIMALS,
      poolsScannedCount: liveAmmPools.length,
      poolsMeasuredCount: 0,
      totalProtocolTvlUsd: null,
      opportunities: [],
      report: reportFor(0, [
        institutionalRisk({
          id: 'VAULT_READ_FAILED',
          category: 'DATA_QUALITY',
          severity: 'HIGH',
          title: 'Vault & pool accounting read threw',
          finding: 'The on-chain yield read failed before any figure was measured, so no TVL or share price is published.',
          evidence: { measuredReads: 0, expectedReads, error: err instanceof Error ? err.message : 'unknown error' },
          threshold: 'Both totalAssets() and totalSupply() must return before TVL or share price is published.',
          remediation: 'Re-run the call once the Arc RPC answers; a failed read is never substituted with zero.',
        }),
      ]),
      readAt,
      unavailable: ['vault totalAssets() and totalSupply()'],
      limitations: REPORT_LIMITATIONS,
      reason: `Vault analytics not computed: the vault read failed (${err instanceof Error ? err.message : 'unknown error'}).`,
      note,
    }
  }
}
