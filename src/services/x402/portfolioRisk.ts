// src/services/x402/portfolioRisk.ts
// Portfolio exposure for the priced AI service `arc-portfolio-risk-exposure`.
//
// Holdings are read from Arc Testnet ERC-20 contracts; the optional Gateway leg is read from
// Circle's Gateway balance API. A failed read never becomes a zero: the field is null, the
// total is withheld, and the reason is listed. Concentration and stablecoin share are arithmetic
// on the measured total, not a risk score.
//
// The response also carries the shared institutional envelope (`institutionalReport.ts`) under
// `report`: identity, freshness, read coverage, a data-quality grade and a graded risk register
// with evidence, threshold and remediation per finding. `riskFlags` is kept for older callers.

import { formatUnits, getAddress, type Address } from 'viem'
import { ARC_TOKENS, IS_TESTNET } from '../../config/arcChain'
import { DOMAIN_TO_CHAIN } from '../../config/gatewayConfig'
import { ERC20_ABI } from '../../config/poolsConfig'
import { getGatewayBalances } from '../gatewayService'
import { getArcPublicClient, getResilientPublicClient, resilientGetBalance, resilientReadContract } from '../rpc'
import { getLiveTokenPrices, normalizeTokenSymbol } from '../tokenPriceService'
import { getNativeGasPrice } from '../portfolio/portfolioMetricsService'
import {
  buildInstitutionalReport,
  institutionalRisk,
  type InstitutionalReport,
  type InstitutionalRisk,
} from './institutionalReport'

export const PORTFOLIO_RISK_SERVICE_ID = 'arc-portfolio-risk-exposure'

const REPORT_TITLE = 'Portfolio Risk & Exposure Report'

const REPORT_LIMITATIONS = [
  'Held assets are the four Arc Testnet ERC-20 tokens plus native gas on the supported testnets; LP positions, vault shares and unlisted tokens are outside the measurement.',
  'USD values come from the application price service and are indicative feed values, not executable quotes.',
  'No historical series is read, so no drawdown, volatility or time-weighted exposure is computed.',
  'Every finding is an observation about measured exposure. The service submits no transaction and recommends no trade.',
]

export const PORTFOLIO_TOKENS = [
  { symbol: 'USDC', address: ARC_TOKENS.USDC as Address, decimals: 6, stablecoin: true },
  { symbol: 'EURC', address: ARC_TOKENS.EURC as Address, decimals: 6, stablecoin: true },
  { symbol: 'WETH', address: ARC_TOKENS.WETH as Address, decimals: 18, stablecoin: false },
  { symbol: 'cirBTC', address: ARC_TOKENS.cirBTC as Address, decimals: 8, stablecoin: false },
] as const

export interface NativeChainSpec {
  chainKey: string
  symbol: string
  name: string
  decimals: number
}

export const PORTFOLIO_NATIVE_SPECS = [
  {
    symbol: 'ETH',
    chains: [
      'Ethereum_Sepolia',
      'Base_Sepolia',
      'Arbitrum_Sepolia',
      'Optimism_Sepolia',
      'Unichain_Sepolia',
      'World_Chain_Sepolia',
    ] as const,
    decimals: 18,
    stablecoin: false,
  },
  {
    symbol: 'POL',
    chains: ['Polygon_Amoy_Testnet'] as const,
    decimals: 18,
    stablecoin: false,
  },
  {
    symbol: 'AVAX',
    chains: ['Avalanche_Fuji'] as const,
    decimals: 18,
    stablecoin: false,
  },
  {
    symbol: 'SEI',
    chains: ['Sei_Testnet'] as const,
    decimals: 18,
    stablecoin: false,
  },
  {
    symbol: 'S',
    chains: ['Sonic_Testnet'] as const,
    decimals: 18,
    stablecoin: false,
  },
] as const

export const NATIVE_SYMBOLS = ['ETH', 'POL', 'AVAX', 'SEI', 'S'] as const

export interface TokenHolding {
  symbol: string
  balance: number | null
  valueUsd: number | null
  stablecoin: boolean
}

export interface ChainExposure {
  chain: string
  valueUsd: number | null
}

export interface PortfolioRiskResult {
  status: 'PORTFOLIO_ANALYZED' | 'PARTIAL' | 'UNAVAILABLE' | 'INVALID_ADDRESS'
  address: string
  totalUsd: number | null
  concentrationPct: number | null
  stablecoinSharePct: number | null
  holdings: TokenHolding[]
  gatewayBalanceUsdc: number | null
  chainExposure: ChainExposure[]
  riskFlags: string[]
  /** Institutional envelope: identity, freshness, coverage, grade, graded risk register. */
  report: InstitutionalReport
  readAt: number
  unavailable: string[]
  limitations: string[]
  reason?: string
  note: string
}

const round6 = (value: number): number => Number(value.toFixed(6))

export function isValidPortfolioAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address)
}

/**
 * Canonical checksummed form of an address, or null when it is not 20 bytes.
 * Casing is normalised before checksumming so a pasted address with a wrong mixed-case
 * checksum is still read as the same account instead of failing the RPC call.
 */
function normalizeAddress(address: string): string | null {
  if (!isValidPortfolioAddress(address)) return null
  try {
    return getAddress(address.toLowerCase())
  } catch {
    return null
  }
}

function priceFor(prices: Record<string, number>, symbol: string): number | null {
  const direct = prices[symbol]
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct
  const normalized = normalizeTokenSymbol(symbol)
  const aliased = prices[normalized] ?? prices[symbol.toUpperCase()]
  if (typeof aliased === 'number' && Number.isFinite(aliased) && aliased > 0) return aliased

  const nativePrice = getNativeGasPrice(symbol, prices)
  if (typeof nativePrice === 'number' && Number.isFinite(nativePrice) && nativePrice > 0) return nativePrice

  return null
}

/**
 * Reads the address's Arc token balances, multi-chain native gas balances, and Circle Gateway unified balance.
 * Read-only: the address is public data and no other caller data is touched.
 */
export async function readPortfolioRisk(input: {
  address: string
  includeGatewayBalance?: boolean
}): Promise<PortfolioRiskResult> {
  const readAt = Date.now()
  const requestedAddress = String(input.address || '').trim()
  const address = normalizeAddress(requestedAddress)
  const includeGatewayBalance = input.includeGatewayBalance === true
  const note = includeGatewayBalance
    ? 'Balances are read from Arc Testnet token contracts, multi-chain native gas balances, and Circle Gateway at call time; USD values use the app price service. Concentration and stablecoin share reflect unified asset exposure across Arc wallet, connected testnets, and Gateway balances.'
    : 'Balances are read from Arc Testnet token contracts and multi-chain native gas balances at call time; USD values use the app price service. Concentration and stablecoin share are arithmetic on the measured total, not a risk score.'

  const expectedReads =
    PORTFOLIO_TOKENS.length + PORTFOLIO_NATIVE_SPECS.length + (includeGatewayBalance ? 1 : 0)

  const reportFor = (args: {
    subject: string
    measuredReads: number
    risks: InstitutionalRisk[]
    issuedAt: number
  }): InstitutionalReport =>
    buildInstitutionalReport({
      kind: 'PORTFOLIO_EXPOSURE',
      serviceId: PORTFOLIO_RISK_SERVICE_ID,
      title: REPORT_TITLE,
      subject: { type: 'WALLET', identifier: args.subject },
      issuedAt: args.issuedAt,
      asOf: args.issuedAt,
      coverage: { measuredReads: args.measuredReads, expectedReads },
      risks: args.risks,
      methodology: [
        'Wallet token balances are read with eth_call balanceOf() against the Arc Testnet ERC-20 contracts (USDC, EURC, WETH, cirBTC).',
        'Native gas balances are read from the configured Sepolia, Amoy, Fuji, Sei and Sonic RPC endpoints.',
        'USD values apply the application price service; an unpriced nonzero balance withholds the total instead of contributing zero.',
        includeGatewayBalance
          ? 'The Circle Gateway unified USDC balance is read from Circle’s balance API and folded into the USDC leg.'
          : 'The Circle Gateway unified balance is excluded because includeGatewayBalance is false.',
        'Concentration is the largest single holding over the measured total and stablecoin share is the stablecoin value over that same total; neither is a modelled risk score.',
      ],
      limitations: REPORT_LIMITATIONS,
    })

  if (address === null) {
    return {
      status: 'INVALID_ADDRESS',
      address: requestedAddress,
      totalUsd: null,
      concentrationPct: null,
      stablecoinSharePct: null,
      holdings: [],
      gatewayBalanceUsdc: null,
      chainExposure: [],
      riskFlags: ['INVALID_ADDRESS'],
      report: reportFor({
        subject: requestedAddress,
        measuredReads: 0,
        issuedAt: readAt,
        risks: [
          institutionalRisk({
            id: 'INVALID_ADDRESS',
            category: 'DATA_QUALITY',
            severity: 'HIGH',
            title: 'Subject address is not a 20-byte hex account',
            finding: 'No read was attempted because the supplied subject is not a 20-byte hex address.',
            evidence: { address: requestedAddress },
            threshold: 'Subject must match ^0x[a-fA-F0-9]{40}$.',
            remediation: 'Re-issue the call with a checksummed or lowercase 20-byte address.',
          }),
        ],
      }),
      readAt,
      unavailable: [
        ...PORTFOLIO_TOKENS.map((token) => `${token.symbol} balance`),
        ...PORTFOLIO_NATIVE_SPECS.map((spec) => `${spec.symbol} balance`),
      ],
      limitations: REPORT_LIMITATIONS,
      reason: 'A 20-byte hex address is required to read a portfolio.',
      note,
    }
  }

  let prices: Record<string, number> = {}
  try {
    prices = await getLiveTokenPrices()
  } catch {
    prices = {}
  }

  // 1. Read Arc token contracts
  const client = getArcPublicClient()
  const reads = await Promise.all(
    PORTFOLIO_TOKENS.map((token) =>
      resilientReadContract(client, {
        address: token.address,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address as Address],
      })
        .then((raw) => ({ symbol: token.symbol, raw: raw as bigint }))
        .catch(() => ({ symbol: token.symbol, raw: null }))
    )
  )

  // 2. Read Multi-Chain Native Gas Balances (ETH, POL, AVAX, SEI, S)
  const nativeChainExposure: Array<{ chain: string; valueUsd: number }> = []
  const nativeResults = await Promise.all(
    PORTFOLIO_NATIVE_SPECS.map(async (spec) => {
      const chainReads = await Promise.all(
        spec.chains.map(async (chainKey) => {
          try {
            const chainClient = typeof getResilientPublicClient === 'function' ? getResilientPublicClient(chainKey) : null
            if (!chainClient || typeof resilientGetBalance !== 'function') {
              return { chainKey, raw: null }
            }
            const raw = await resilientGetBalance(chainClient, { address: address as Address })
            return { chainKey, raw }
          } catch {
            return { chainKey, raw: null }
          }
        })
      )

      const allFailed = chainReads.every((r) => r.raw === null)

      if (allFailed) {
        return {
          symbol: spec.symbol,
          totalBalance: null,
          stablecoin: spec.stablecoin,
        }
      }

      let totalBal = 0
      for (const r of chainReads) {
        if (r.raw !== null && r.raw > 0n) {
          const bal = Number(formatUnits(r.raw, spec.decimals))
          if (Number.isFinite(bal) && bal > 0) {
            totalBal += bal
            const p = priceFor(prices, spec.symbol) ?? 0
            const usd = round6(bal * p)
            if (usd > 0) {
              nativeChainExposure.push({ chain: r.chainKey, valueUsd: usd })
            }
          }
        }
      }

      return {
        symbol: spec.symbol,
        totalBalance: round6(totalBal),
        stablecoin: spec.stablecoin,
      }
    })
  )

  const unavailable: string[] = []
  const holdings: TokenHolding[] = PORTFOLIO_TOKENS.map((token) => {
    const read = reads.find((item) => item.symbol === token.symbol)
    if (!read || read.raw === null) {
      unavailable.push(`${token.symbol} wallet balance`)
      return { symbol: token.symbol, balance: null, valueUsd: null, stablecoin: token.stablecoin }
    }
    const balance = Number(formatUnits(read.raw, token.decimals))
    const price = priceFor(prices, token.symbol)
    if (price === null && balance > 0) unavailable.push(`${token.symbol} USD price`)
    return {
      symbol: token.symbol,
      balance: round6(balance),
      valueUsd: price === null ? null : round6(balance * price),
      stablecoin: token.stablecoin,
    }
  })

  // Append native multi-chain holdings (ETH, POL, AVAX, SEI, S)
  for (const n of nativeResults) {
    if (n.totalBalance === null) {
      unavailable.push(`${n.symbol} wallet balance`)
      holdings.push({ symbol: n.symbol, balance: null, valueUsd: null, stablecoin: n.stablecoin })
    } else {
      const price = priceFor(prices, n.symbol)
      if (price === null && n.totalBalance > 0) unavailable.push(`${n.symbol} USD price`)
      holdings.push({
        symbol: n.symbol,
        balance: n.totalBalance,
        valueUsd: price === null ? null : round6(n.totalBalance * price),
        stablecoin: n.stablecoin,
      })
    }
  }

  let gatewayBalanceUsdc: number | null = null
  let gatewayExposure: ChainExposure[] = []
  if (includeGatewayBalance) {
    try {
      const response = await getGatewayBalances(address, IS_TESTNET ? 'testnet' : 'mainnet')
      const balances = Array.isArray(response?.balances) ? response.balances : []
      const parsed = balances.map((item) => ({
        chain: DOMAIN_TO_CHAIN[Number(item.domain)] || `domain:${item.domain}`,
        balance: Number(item.balance),
      }))
      if (parsed.some((item) => !Number.isFinite(item.balance))) {
        throw new Error('Gateway returned an unparseable balance')
      }
      gatewayBalanceUsdc = round6(parsed.reduce((sum, item) => sum + item.balance, 0))
      gatewayExposure = parsed.map((item) => ({ chain: item.chain, valueUsd: round6(item.balance) }))
    } catch {
      unavailable.push('Circle Gateway unified balance')
    }
  }

  const balancesComplete = holdings.every((holding) => holding.balance !== null)
  const pricesComplete = holdings.every((holding) => holding.valueUsd !== null || (holding.balance ?? 0) === 0)
  const gatewayComplete = !includeGatewayBalance || gatewayBalanceUsdc !== null

  // Arc wallet tokens total
  const arcWalletTokens = holdings.filter((h) => PORTFOLIO_TOKENS.some((t) => t.symbol === h.symbol))
  const arcWalletTotal = arcWalletTokens.reduce((sum, holding) => sum + (holding.valueUsd ?? 0), 0)

  // Native multi-chain tokens total
  const nativeWalletTokens = holdings.filter((h) => NATIVE_SYMBOLS.includes(h.symbol as any))
  const nativeWalletTotal = nativeWalletTokens.reduce((sum, holding) => sum + (holding.valueUsd ?? 0), 0)

  // Total wallet value across Arc and connected native testnets
  const walletTotal = round6(arcWalletTotal + nativeWalletTotal)

  // When Gateway is included and available, unify Gateway USDC into the USDC holding
  // so that asset-level concentration, stablecoin share, and holdings breakdown are consistent.
  const usdcHoldingIndex = holdings.findIndex((h) => h.symbol === 'USDC')
  if (
    includeGatewayBalance &&
    gatewayComplete &&
    gatewayBalanceUsdc !== null &&
    usdcHoldingIndex !== -1 &&
    holdings[usdcHoldingIndex].balance !== null
  ) {
    const usdcHolding = holdings[usdcHoldingIndex]
    const currentBalance = usdcHolding.balance ?? 0
    const unifiedBalance = round6(currentBalance + gatewayBalanceUsdc)
    const price = priceFor(prices, 'USDC') ?? 1
    holdings[usdcHoldingIndex] = {
      ...usdcHolding,
      balance: unifiedBalance,
      valueUsd: round6(unifiedBalance * price),
    }
  }

  const complete = balancesComplete && pricesComplete && gatewayComplete
  const totalUsd = complete ? round6(walletTotal + (gatewayBalanceUsdc ?? 0)) : null

  // True asset-level concentration across all holdings
  const measuredValues = holdings
    .filter((holding) => holding.valueUsd !== null)
    .map((holding) => holding.valueUsd as number)

  const concentrationPct =
    totalUsd !== null && totalUsd > 0 && measuredValues.length > 0
      ? round6((Math.max(...measuredValues) / totalUsd) * 100)
      : null

  const stablecoinUsd = holdings
    .filter((holding) => holding.stablecoin)
    .reduce((sum, holding) => sum + (holding.valueUsd ?? 0), 0)
  const stablecoinSharePct =
    totalUsd !== null && totalUsd > 0 ? round6((stablecoinUsd / totalUsd) * 100) : null

  // One row per chain: Arc wallet receives arcWalletTotal.
  // Gateway and native gas exposures are tracked per individual chain.
  const exposureByChain = new Map<string, number | null>()
  exposureByChain.set(
    IS_TESTNET ? 'Arc_Testnet' : 'Arc',
    balancesComplete && pricesComplete ? round6(arcWalletTotal) : null
  )
  for (const entry of gatewayExposure) {
    const current = exposureByChain.get(entry.chain)
    if (current === undefined) {
      exposureByChain.set(entry.chain, entry.valueUsd)
    } else {
      exposureByChain.set(
        entry.chain,
        current === null || entry.valueUsd === null ? null : round6(current + entry.valueUsd)
      )
    }
  }
  for (const entry of nativeChainExposure) {
    const current = exposureByChain.get(entry.chain)
    if (current === undefined) {
      exposureByChain.set(entry.chain, entry.valueUsd)
    } else {
      exposureByChain.set(
        entry.chain,
        current === null || entry.valueUsd === null ? null : round6(current + entry.valueUsd)
      )
    }
  }

  const chainExposure: ChainExposure[] = Array.from(exposureByChain, ([chain, valueUsd]) => ({
    chain,
    valueUsd,
  })).sort((a, b) => {
    const valA = typeof a.valueUsd === 'number' ? a.valueUsd : -1
    const valB = typeof b.valueUsd === 'number' ? b.valueUsd : -1
    return valB - valA
  })

  // Priority order matching the portfolio drawer
  const priority = ['USDC', 'EURC', 'ETH', 'cirBTC', 'WETH', 'POL', 'AVAX', 'SEI', 'S']
  const sortedHoldings = [...holdings].sort((a, b) => {
    const valA = typeof a.valueUsd === 'number' ? a.valueUsd : -1
    const valB = typeof b.valueUsd === 'number' ? b.valueUsd : -1
    if (Math.abs(valB - valA) > 0.001) {
      return valB - valA
    }
    const balA = typeof a.balance === 'number' ? a.balance : -1
    const balB = typeof b.balance === 'number' ? b.balance : -1
    if (Math.abs(balB - balA) > 0.00001) {
      return balB - balA
    }
    const idxA = priority.indexOf(a.symbol)
    const idxB = priority.indexOf(b.symbol)
    return (idxA !== -1 ? idxA : 99) - (idxB !== -1 ? idxB : 99)
  })

  const tokenReadsReturned = reads.filter((read) => read.raw !== null).length
  const nativeReadsReturned = nativeResults.filter((entry) => entry.totalBalance !== null).length
  const measuredReads =
    tokenReadsReturned + nativeReadsReturned + (includeGatewayBalance && gatewayBalanceUsdc !== null ? 1 : 0)

  const unpricedPositions = holdings.filter(
    (holding) => holding.valueUsd === null && (holding.balance ?? 0) > 0
  ).length

  const dominantHolding =
    concentrationPct === null
      ? null
      : (sortedHoldings.find((holding) => holding.valueUsd !== null) ?? null)

  const risks: InstitutionalRisk[] = []

  if (!balancesComplete) {
    risks.push(
      institutionalRisk({
        id: 'BALANCE_READ_FAILED',
        category: 'DATA_QUALITY',
        severity: 'HIGH',
        title: 'One or more balance reads returned nothing',
        finding: `${measuredReads} of ${expectedReads} planned reads returned; the portfolio total is withheld rather than published on partial balances.`,
        evidence: {
          measuredReads,
          expectedReads,
          totalWithheld: totalUsd === null,
        },
        threshold: 'Every planned balance read must return before a total is published.',
        remediation:
          'Re-run the call once the RPC reads recover. A failed read is never treated as a zero balance.',
      })
    )
  }

  if (!pricesComplete) {
    risks.push(
      institutionalRisk({
        id: 'PRICE_UNAVAILABLE',
        category: 'DATA_QUALITY',
        severity: 'HIGH',
        title: 'A nonzero holding could not be priced',
        finding: `${unpricedPositions} position(s) with a nonzero balance have no USD price, so a full valuation is not available.`,
        evidence: { unpricedPositions, totalWithheld: totalUsd === null },
        threshold: 'Every nonzero holding must carry a price before a USD total is published.',
        remediation:
          'Re-run once the price service answers for those symbols; an unpriced position is never valued at zero.',
      })
    )
  }

  if (!gatewayComplete) {
    risks.push(
      institutionalRisk({
        id: 'GATEWAY_BALANCE_UNAVAILABLE',
        category: 'DATA_QUALITY',
        severity: 'MEDIUM',
        title: 'Circle Gateway balance was requested but not read',
        finding:
          'The Circle Gateway unified balance could not be read, so the unified total excludes whatever USDC is held there.',
        evidence: { gatewayRequested: true, gatewayBalanceUsdc },
        threshold: 'A unified total requires a successful Gateway balance read.',
        remediation:
          'Retry the Gateway read, or call with includeGatewayBalance=false for an Arc-only total that states its scope.',
      })
    )
  }

  if (totalUsd !== null && totalUsd === 0) {
    risks.push(
      institutionalRisk({
        id: 'NO_BALANCES',
        category: 'COMPOSITION',
        severity: 'INFO',
        title: 'No measured balance is held',
        finding:
          'Every readable balance on the measured chains and the Gateway leg is zero, so concentration and stablecoin share carry no information.',
        evidence: { totalUsd: 0 },
        threshold: null,
        remediation: 'Fund the address before an exposure assessment becomes meaningful.',
      })
    )
  }

  if (concentrationPct !== null && concentrationPct > 50) {
    risks.push(
      institutionalRisk({
        id: 'HIGH_CONCENTRATION',
        category: 'CONCENTRATION',
        severity: concentrationPct >= 75 ? 'HIGH' : 'MEDIUM',
        title: 'Single-asset concentration above the review threshold',
        finding: `${dominantHolding?.symbol ?? 'The largest holding'} accounts for ${concentrationPct}% of the measured ${totalUsd ?? 0} USD total.`,
        evidence: {
          dominantAsset: dominantHolding?.symbol ?? null,
          concentrationPct,
          totalUsd,
        },
        threshold: 'Largest single-asset share > 50% of the measured total (>= 75% is graded HIGH).',
        remediation:
          'The report states the measured share; it does not instruct a trade. Diversification decisions belong to the reader’s own mandate.',
      })
    )
  }

  if (stablecoinSharePct !== null && stablecoinSharePct < 50) {
    risks.push(
      institutionalRisk({
        id: 'LOW_STABLECOIN_SHARE',
        category: 'COMPOSITION',
        severity: stablecoinSharePct < 25 ? 'MEDIUM' : 'LOW',
        title: 'Stablecoin share below the review threshold',
        finding: `${stablecoinSharePct}% of the measured total is held in stablecoins; the remainder is exposed to non-stablecoin price movement.`,
        evidence: { stablecoinSharePct, totalUsd },
        threshold: 'Stablecoin share < 50% of the measured total (< 25% is graded MEDIUM).',
        remediation:
          'The report states the measured composition; it does not recommend an allocation change.',
      })
    )
  }

  const riskFlags = risks.map((entry) => entry.id)

  const everyBalanceFailed = holdings.every((holding) => holding.balance === null) && gatewayBalanceUsdc === null
  const status: PortfolioRiskResult['status'] = everyBalanceFailed
    ? 'UNAVAILABLE'
    : complete
      ? 'PORTFOLIO_ANALYZED'
      : 'PARTIAL'

  return {
    status,
    address,
    totalUsd,
    concentrationPct,
    stablecoinSharePct,
    holdings: sortedHoldings,
    gatewayBalanceUsdc,
    chainExposure,
    riskFlags,
    report: reportFor({ subject: address, measuredReads, risks, issuedAt: readAt }),
    readAt,
    unavailable,
    limitations: REPORT_LIMITATIONS,
    ...(status === 'UNAVAILABLE'
      ? { reason: 'Portfolio not computed: no holding could be read.' }
      : status === 'PARTIAL'
        ? { reason: `Portfolio total withheld: ${unavailable.join(', ')} could not be read.` }
        : {}),
    note,
  }
}
