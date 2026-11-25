// Corporate & Institutional AI Agent Playground & Specification Suite for Arcis x402 Services
// Redesigned under Konsept B: "Linear Command / Step-by-Step Focus"
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Ban,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Compass,
  Copy,
  Download,
  FileJson,
  FileSpreadsheet,
  GitBranch,
  Info,
  Layers,
  Lock,
  Shield,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import { getChainDisplayName, getChainIconId, isKnownChain } from '../../config/chainMeta'
import { POOL_MAX_SLIPPAGE_BPS, POOL_MIN_SLIPPAGE_BPS } from '../../config/poolsConfig'
import { getCategoryLabel } from '../../config/x402/categories'
import {
  resolveArcSwapTokenBalance,
  useArcSwapTokenBalances,
} from '../../hooks/useArcSwapTokenBalances'
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock'
import { useChainSwitch } from '../../hooks/useChainSwitch'
import { useClearOnWalletDisconnect } from '../../hooks/useClearOnWalletDisconnect'
import { useGatewayBalance } from '../../hooks/useGatewayBalance'
import { useX402Config } from '../../hooks/useX402Config'
import type { CopilotUcwHandlers } from '../../services/copilot/copilotCommon'
import {
  serviceTelemetryService,
  type ServiceTelemetryData,
} from '../../services/serviceTelemetryService'
import {
  getSessionKeyConfig,
  MARKETPLACE_SESSION_UPDATED_EVENT,
  SESSION_KEY_UPDATED_EVENT,
} from '../../services/sessionKeyService'
import { soundService } from '../../services/soundService'
import type { SessionBudgetState } from '../../services/x402Client'
import type { x402ExecutionResult, x402Service } from '../../types/marketplace'
import type { SessionKeyConfig } from '../../types/sessionKey'
import { buildReportCsv, triggerFileDownload } from '../../utils/reportExport'
import { diagnoseX402Failure } from '../../utils/x402FailureDiagnosis'
import { evaluateX402Readiness } from '../../utils/x402Readiness'
import { ChainIcon } from '../common/ChainIcon'
import { PortfolioAssetIcon } from '../portfolio/PortfolioAssetIcon'
import {
  extractTokenSymbols,
  getServiceTokenSymbols,
  getStatusToneStyle,
  inferMetricAccentTone,
  inferMetricTokenSymbol,
  isUserCanceledMessage,
  resolveFailurePresentation,
  resolveRiskSeverityTone,
  resolveServiceStatusMeta,
  STATUS_TONES,
} from './marketplaceDesign'
import MarketplaceSelect from './MarketplaceSelect'
import {
  ChainPill,
  InlineTokenChip,
  RouteTokenFlow,
  SectionHeader,
  StatusBadge,
  TokenIconBadge,
  TokenPairIcons,
} from './MarketplaceVisualPrimitives'
import { resolveTradeExecutionVerdict } from '../../services/x402/tradeExecutionAdvisor'
import ServiceActionCard from './ServiceActionCard'
import TradeExecutionTicketReport from './TradeExecutionTicketReport'

interface ServicePlaygroundModalProps {
  isOpen: boolean
  onClose: () => void
  service: x402Service | null
  /** Inputs to pre-fill instead of the service defaults (a re-run proposed by the shelf). */
  initialPayload?: Record<string, unknown>
  isExecuting: boolean
  executionResult: x402ExecutionResult | null
  onExecute: (service: x402Service, payload: Record<string, any>) => Promise<any>
  sessionBudget: SessionBudgetState
  walletAddress?: string
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  /** True when the active Circle Wallet can sign its typed-data challenge. */
  ucwSignerAvailable?: boolean
  /** UCW executors for the action card, so post-call execution matches the payer's wallet. */
  ucwHandlers?: CopilotUcwHandlers
  onNavigateTab?: (tab: string) => void
}

const DEFAULT_GATEWAY_NETWORKS = [
  { id: 'arc', name: 'Arc', fullName: 'Arc Testnet', iconId: 'arc', isArc: true, isNative: true, role: 'Settlement Network' },
  { id: 'base', name: 'Base', fullName: 'Base Sepolia', iconId: 'base-sepolia', isArc: false, isNative: false, role: 'Circle Gateway Rail' },
  { id: 'ethereum', name: 'Ethereum', fullName: 'Ethereum Sepolia', iconId: 'ethereum', isArc: false, isNative: false, role: 'Circle Gateway Rail' },
  { id: 'arbitrum', name: 'Arbitrum', fullName: 'Arbitrum Sepolia', iconId: 'arbitrum-sepolia', isArc: false, isNative: false, role: 'Circle Gateway Rail' },
  { id: 'polygon', name: 'Polygon', fullName: 'Polygon Amoy', iconId: 'polygon-amoy', isArc: false, isNative: false, role: 'Circle Gateway Rail' },
  { id: 'solana', name: 'Solana', fullName: 'Solana Devnet', iconId: 'solana', isArc: false, isNative: false, role: 'Circle Gateway Rail' },
]

interface HumanDiagnosis {
  humanTitle: string
  titlePrefix?: string
  pctStr?: string
  assetSymbol?: string
  problemText: string
  riskText?: string
  solutionText?: string
  actionLabel?: string
  actionTab?: string
}

function getHumanDiagnosis(entry: any): HumanDiagnosis {
  const id = String(entry?.id ?? '')
  const evidence = entry?.evidence && typeof entry.evidence === 'object' ? entry.evidence : {}
  const concentration = typeof evidence.concentrationPct === 'number' ? evidence.concentrationPct : null
  const stablecoinShare = typeof evidence.stablecoinSharePct === 'number' ? evidence.stablecoinSharePct : null
  const dominant = typeof evidence.dominantAsset === 'string' ? evidence.dominantAsset : null
  const totalUsd = typeof evidence.totalUsd === 'number' ? evidence.totalUsd : null

  const formattedTotal = totalUsd !== null
    ? `$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : ''

  if (id === 'HIGH_CONCENTRATION') {
    const pctStr = concentration !== null ? `${concentration.toFixed(1)}%` : 'a significant portion'
    const assetStr = dominant ?? 'a single asset'
    return {
      humanTitle: `High Asset Concentration (${pctStr} ${assetStr})`,
      titlePrefix: 'High Asset Concentration',
      pctStr,
      assetSymbol: dominant ?? undefined,
      problemText: `${pctStr} of the measured ${formattedTotal} portfolio is concentrated in a single asset (${assetStr}).`,
      riskText: `Price volatility in ${assetStr} directly and heavily impacts your total portfolio valuation.`,
      solutionText: `Rebalance your holdings across chains via Circle Gateway or deploy liquidity into Arc USDC yield pools to diversify risk.`,
      actionLabel: 'Rebalance via Circle Gateway',
      actionTab: 'unified',
    }
  }

  if (id === 'LOW_STABLECOIN_SHARE') {
    const pctStr = stablecoinShare !== null ? `${stablecoinShare.toFixed(1)}%` : 'low level'
    return {
      humanTitle: `Low Stablecoin Reserve (${pctStr} USDC)`,
      titlePrefix: 'Low Stablecoin Reserve',
      pctStr,
      assetSymbol: 'USDC',
      problemText: `Only ${pctStr} of your portfolio is held in stablecoins; the remainder is fully exposed to market volatility.`,
      riskText: `During market pullbacks, limited cash reserves increase drawdown risk and lack defensive downside protection.`,
      solutionText: `Consider rebalancing your stablecoin reserve toward 25%–50% to shield your portfolio against sharp drawdowns.`,
      actionLabel: 'Swap to USDC',
      actionTab: 'swap',
    }
  }

  if (id === 'PRICE_UNAVAILABLE') {
    return {
      humanTitle: 'Unpriced Asset Detected',
      problemText: 'Real-time market price for one or more wallet assets could not be retrieved from the active oracle feed.',
      riskText: 'Due to missing price data, the total portfolio valuation may be temporarily understated.',
      solutionText: 'Re-run the risk scan once oracle feeds and price aggregators refresh.',
    }
  }

  if (id === 'BALANCE_READ_FAILED') {
    return {
      humanTitle: 'On-Chain Balance Read Delay',
      problemText: 'One or more token balances could not be verified on the Arc L1 RPC node.',
      riskText: 'The total portfolio valuation is withheld to prevent inaccurate figures.',
      solutionText: 'Retry the query once RPC node connectivity stabilizes.',
    }
  }

  if (id === 'PRINCIPAL_IMPAIRMENT') {
    return {
      humanTitle: 'Vault Principal Impairment',
      problemText: 'Current redeemable vault assets have dipped below the deposited principal amount.',
      riskText: 'The position is experiencing unrealized negative yield or temporary vault impairment.',
      solutionText: 'Review your vault allocation, lockup parameters, and current pool performance.',
      actionLabel: 'Inspect Yield Vault',
      actionTab: 'pools',
    }
  }

  if (id === 'UNREALIZED_YIELD_UNSETTLED') {
    return {
      humanTitle: 'Accrued Redeemable Yield',
      problemText: 'Current redeemable balance exceeds deposited principal; net yield is available for withdrawal.',
      solutionText: 'You can claim or compound your earned yield anytime via the Arc USDC yield vault.',
      actionLabel: 'Open Yield Vault',
      actionTab: 'pools',
    }
  }

  if (id === 'NET_LIQUIDITY_OUTFLOW') {
    return {
      humanTitle: 'Net Liquidity Outflow',
      problemText: 'Outbound cross-chain volume exceeded inbound volume during the observation period.',
      riskText: 'Pool depth and DEX trade slippage may temporarily increase in the short term.',
      solutionText: 'Inspect route slippage and bridge depth before submitting large block orders.',
      actionLabel: 'Manage Gateway Transfers',
      actionTab: 'unified',
    }
  }

  if (id === 'GATEWAY_NET_INFLOW') {
    const netUsdc = typeof evidence.netUsdcInflowUsdc === 'number'
      ? `+$${evidence.netUsdcInflowUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : 'positive'
    return {
      humanTitle: `Net Liquidity Expansion (${netUsdc} USDC)`,
      problemText: `Inbound cross-chain Gateway mints exceeded outbound burns by ${netUsdc} USDC during the observation window.`,
      solutionText: 'On-chain DEX liquidity and pool depth are expanding. You can provide liquidity or execute trades on Arc.',
      actionLabel: 'Manage Unified Balance',
      actionTab: 'unified',
    }
  }

  if (id === 'NO_GATEWAY_ACTIVITY') {
    return {
      humanTitle: 'No Gateway Activity in Window',
      problemText: 'No cross-chain mint or burn transactions occurred during the scanned block range.',
      solutionText: 'Deposit or transfer USDC via Circle Gateway to establish unified cross-chain balance.',
      actionLabel: 'Open Circle Gateway',
      actionTab: 'unified',
    }
  }

  if (id === 'SINGLE_SOURCE_CONCENTRATION') {
    return {
      humanTitle: 'Single-Source Inflow Concentration',
      problemText: 'Over 80% of inbound capital to Arc originated from a single source blockchain network.',
      riskText: 'Network congestion or fee spikes on the origin network could bottleneck cross-chain liquidity inflows.',
      solutionText: 'Diversify gateway deposit routes across secondary origin networks.',
      actionLabel: 'Manage Gateway Deposits',
      actionTab: 'unified',
    }
  }

  if (id === 'VAULT_ACTIVE_RESERVES') {
    const sharePrice = evidence.sharePriceUsdc !== null && evidence.sharePriceUsdc !== undefined
      ? `${evidence.sharePriceUsdc} USDC`
      : 'active'
    const tvl = typeof evidence.totalAssetsUsdc === 'number'
      ? `$${evidence.totalAssetsUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : 'verified'
    return {
      humanTitle: `Active Yield Vault Reserves (${sharePrice} / share)`,
      problemText: `The ERC-4626 vault holds ${tvl} in verified on-chain assets, establishing an active exchange rate of 1 share = ${sharePrice}.`,
      solutionText: `You can deposit USDC into this automated yield vault to earn on-chain returns or inspect existing allocations.`,
      actionLabel: 'Open USDC Yield Vault',
      actionTab: 'pools',
    }
  }

  if (id === 'VAULT_NO_SHARES') {
    return {
      humanTitle: 'Vault Awaiting Initial Liquidity',
      problemText: 'The ERC-4626 yield vault is active on Arc Testnet but currently reports zero shares outstanding.',
      solutionText: 'Deposit initial USDC liquidity to bootstrap share minting and activate vault yield generation.',
      actionLabel: 'Initialize Vault Liquidity',
      actionTab: 'pools',
    }
  }

  if (id === 'VAULT_ASSETS_WITHOUT_SHARES') {
    return {
      humanTitle: 'Vault Accounting Discrepancy',
      problemText: 'The vault reports assets held while zero shares are outstanding.',
      riskText: 'Share redemption value cannot be mathematically derived without active share supply.',
      solutionText: 'Review vault contract state before committing new deposits.',
      actionLabel: 'Inspect Vault State',
      actionTab: 'pools',
    }
  }

  if (id === 'VAULT_READ_FAILED') {
    return {
      humanTitle: 'Vault RPC Accounting Query Interrupted',
      problemText: 'Unable to query totalAssets or totalSupply from the Arc ERC-4626 smart contract.',
      riskText: 'Share price and TVL figures are temporarily withheld to prevent inaccurate metrics.',
      solutionText: 'Re-run the scan once Arc Testnet RPC node connectivity normalizes.',
    }
  }

  if (id === 'NO_HISTORICAL_SERIES') {
    return {
      humanTitle: 'Real-Time State Read (No Historical Series)',
      problemText: 'The requested observation window is recorded for correlation; ERC-4626 contracts expose instantaneous balances.',
      solutionText: 'Successive independent scans can be compared to establish historical return trajectories.',
    }
  }

  if (id === 'NO_VAULT_POSITION') {
    return {
      humanTitle: 'No Active Vault Position',
      problemText: 'The scanned address currently holds zero shares in the Arc USDC yield vault.',
      solutionText: 'Deposit USDC into the automated yield vault to begin earning verified on-chain yields.',
      actionLabel: 'Deposit into USDC Vault',
      actionTab: 'pools',
    }
  }

  if (id === 'ROUTE_RECOMMENDATION') {
    const railName = evidence.recommendedRail === 'gateway' ? 'Circle Gateway' : 'CCTP Bridge'
    const savings =
      typeof evidence.savingsUsdc === 'number' && evidence.savingsUsdc > 0
        ? `saves $${evidence.savingsUsdc.toFixed(2)} USDC`
        : 'lowest fee'
    const dest = String(evidence.destinationChain || 'destination').replace(/_/g, ' ')
    return {
      humanTitle: `${railName} Optimal Bridge Rail (${savings})`,
      problemText: `${railName} delivers the lowest verified cost for transferring ${evidence.amountUsdc || ''} USDC to ${dest}.`,
      solutionText: `Proceed with bridging via ${railName} to minimize fees and guarantee reliable settlement.`,
      actionLabel: `Bridge via ${railName}`,
      actionTab: 'bridge',
    }
  }

  if (id === 'ROUTE_UNAVAILABLE') {
    return {
      humanTitle: 'Bridge Route Unavailable',
      problemText: 'The requested destination chain or transfer amount could not be quoted on live bridge rails.',
      solutionText: 'Select a verified destination chain supported by Circle Gateway or CCTP on testnet.',
      actionLabel: 'Open Bridge',
      actionTab: 'bridge',
    }
  }

  if (id === 'ROUTE_PARTIAL') {
    return {
      humanTitle: 'Partial Route Pricing',
      problemText: 'Only one bridge rail returned pricing; direct comparative savings are held back.',
      solutionText: 'Review individual rail fee breakdown before initiating the cross-chain transfer.',
      actionLabel: 'Open Bridge',
      actionTab: 'bridge',
    }
  }

  if (id === 'ARBITRAGE_OPPORTUNITY') {
    const profit = typeof evidence.netProfitUsdc === 'number' ? `+$${evidence.netProfitUsdc.toFixed(2)} USDC` : 'Net Profit'
    const spread = typeof evidence.spreadPct === 'number' ? `${evidence.spreadPct.toFixed(2)}%` : 'spread'
    return {
      humanTitle: `Arbitrage Opportunity Detected (${profit})`,
      problemText: `Verified ${spread} price divergence between Arc pool rate and oracle external benchmark.`,
      solutionText: `You can capture approx. ${profit} net profit after deducting estimated gas execution costs.`,
      actionLabel: 'Execute Arbitrage Swap',
      actionTab: 'swap',
    }
  }

  if (id === 'SPREAD_BELOW_THRESHOLD') {
    const spread = typeof evidence.spreadPct === 'number' ? `${evidence.spreadPct.toFixed(2)}%` : 'measured spread'
    return {
      humanTitle: 'Tight DEX Spread (Below Hurdle)',
      problemText: `The pool spread of ${spread} does not exceed transaction gas and fee hurdles.`,
      solutionText: 'Monitor the pair or widen price tolerance thresholds before submitting orders.',
      actionLabel: 'Inspect Pair Pool',
      actionTab: 'swap',
    }
  }

  if (id === 'ARBITRAGE_READ_UNAVAILABLE') {
    return {
      humanTitle: 'Arbitrage Scanner Interrupted',
      problemText: 'On-chain pool reserves or external oracle feeds could not be retrieved for this pair.',
      solutionText: 'Verify that the pair has deployed liquidity on Arc Testnet and retry.',
      actionLabel: 'Open DEX Swaps',
      actionTab: 'swap',
    }
  }

  if (id === 'HIGH_SLIPPAGE_RISK') {
    const ammImpact = typeof evidence.ammPriceImpactPct === 'number' ? evidence.ammPriceImpactPct : null
    const oracleImpact = typeof evidence.priceImpactPct === 'number' ? evidence.priceImpactPct : null
    const primaryImpact = ammImpact !== null && oracleImpact !== null
      ? Math.max(ammImpact, oracleImpact)
      : (ammImpact ?? oracleImpact)
    const impact = primaryImpact !== null ? `${primaryImpact.toFixed(2)}%` : 'elevated'
    return {
      humanTitle: `High Slippage Warning (${impact} impact)`,
      problemText:
        ammImpact !== null && typeof evidence.signedPriceImpactPct === 'number' && evidence.signedPriceImpactPct < 0
          ? `Order moves the AMM pool curve by ${ammImpact.toFixed(2)}% even though the pool quotes ${Math.abs(evidence.signedPriceImpactPct).toFixed(2)}% better than the external oracle.`
          : `Trade size causes ${impact} price impact against live pool depth.`,
      riskText: 'Large single-block orders in shallow pools incur severe AMM curve slippage and unfavorable execution.',
      solutionText: 'Space the order across smaller batches over time (TWAP) or reduce total trade size.',
      actionLabel: 'Inspect Swap Route',
      actionTab: 'swap',
    }
  }

  if (id === 'OPTIMAL_SLIPPAGE_ROUTE') {
    const ammImpact = typeof evidence.ammPriceImpactPct === 'number' ? evidence.ammPriceImpactPct : null
    const oracleImpact = typeof evidence.priceImpactPct === 'number' ? evidence.priceImpactPct : null
    const impactVal = ammImpact ?? oracleImpact
    const impact = impactVal !== null ? `${impactVal.toFixed(2)}%` : 'low'
    return {
      humanTitle: `Deep Liquidity Route Verified (${impact} impact)`,
      problemText: `Verified tight execution price with only ${impact} AMM price impact on Arc Testnet DEX.`,
      solutionText: 'The pool depth accommodates this trade size efficiently with minimal slippage.',
      actionLabel: 'Execute Swap',
      actionTab: 'swap',
    }
  }

  if (id === 'TWO_HOP_ROUTE_ADVANTAGE') {
    const gain = typeof evidence.twoHopOutputGainPct === 'number' ? `+${evidence.twoHopOutputGainPct.toFixed(2)}%` : 'higher'
    const path = typeof evidence.recommendedPath === 'string' ? evidence.recommendedPath : '2-hop route'
    return {
      humanTitle: `2-Hop Route Advantage (${gain} vs Direct)`,
      problemText: `Routing through ${path} produces ${gain} more output than the direct pool even after deducting extra Arc gas.`,
      solutionText: 'Use the guided 2-step execution card below — Step 2 quotes automatically from your confirmed Step 1 output.',
      actionLabel: 'Open Swap Terminal',
      actionTab: 'swap',
    }
  }

  if (id === 'SLIPPAGE_QUOTE_UNAVAILABLE') {
    return {
      humanTitle: 'Slippage Route Query Interrupted',
      problemText: 'Could not obtain a live swap quote or price benchmark for this token pair.',
      solutionText: 'Ensure the pool is active on Arc Testnet and retry with an adjusted trade size.',
      actionLabel: 'Open DEX Swaps',
      actionTab: 'swap',
    }
  }

  if (id === 'MEV_SANDWICH_EXPOSURE' || id === 'HIGH_RESERVE_SANDWICH_EXPOSURE') {
    const exp = typeof evidence.tradeReserveExposurePct === 'number' ? `${evidence.tradeReserveExposurePct.toFixed(1)}%` : 'elevated'
    return {
      humanTitle: `High Pool Depth Pressure (${exp} of pool)`,
      problemText: `Trade size consumes ${exp} of the pool's available liquidity reserve.`,
      riskText: 'Large single-block orders in shallow pools cause steep AMM curve slippage and unfavorable execution.',
      solutionText: 'Split the order into smaller batches and keep max slippage tight on Arc L1 FIFO execution.',
      actionLabel: 'Adjust Slippage on Swap',
      actionTab: 'swap',
    }
  }

  if (id === 'LOW_MEV_RISK' || id === 'LOW_RESERVE_EXPOSURE') {
    const exp = typeof evidence.tradeReserveExposurePct === 'number' ? `${evidence.tradeReserveExposurePct.toFixed(2)}%` : 'minimal'
    return {
      humanTitle: `Healthy Pool Depth Profile (${exp} of pool)`,
      problemText: `Trade size is modest (${exp} of pool depth) and well within safe AMM reserve thresholds.`,
      solutionText: 'Single-order execution fits comfortably on Arc L1 deterministic FIFO ordering.',
      actionLabel: 'Open Swap Terminal',
      actionTab: 'swap',
    }
  }

  if (id === 'MEV_ANALYSIS_UNAVAILABLE') {
    return {
      humanTitle: 'MEV Shield Query Interrupted',
      problemText: 'On-chain reserve depth or token valuation could not be verified for this trade.',
      solutionText: 'Select an active Arc DEX pair with positive pool depth.',
      actionLabel: 'Open DEX Swaps',
      actionTab: 'swap',
    }
  }

  if (id === 'FLASH_LOAN_UNAVAILABLE') {
    return {
      humanTitle: 'Liquidation Feed Unavailable',
      problemText: 'No on-chain liquidation engine is currently deployed on Arc Testnet.',
      solutionText: 'Arcis monitors verified contract state only and does not synthesize liquidation signals.',
      actionLabel: 'Explore Services',
      actionTab: 'ai-services',
    }
  }

  const rawFinding = String(entry?.finding ?? '')
  const cleanFinding = rawFinding.replace(/(\d+\.\d{3,})/g, (match) => {
    const num = parseFloat(match)
    return isNaN(num) ? match : num.toFixed(2)
  })

  return {
    humanTitle: String(entry?.title ?? 'Risk Finding'),
    problemText: cleanFinding,
  }
}

function getTechnicalExplanation(entry: any): string {
  const id = String(entry?.id ?? '')
  const evidence = entry?.evidence && typeof entry.evidence === 'object' ? entry.evidence : {}
  const concentration = typeof evidence.concentrationPct === 'number' ? `${evidence.concentrationPct.toFixed(1)}%` : 'an elevated percentage'
  const dominant = typeof evidence.dominantAsset === 'string' ? evidence.dominantAsset : 'a single token'

  switch (id) {
    case 'HIGH_CONCENTRATION':
      return `This automated risk audit continuously tracks portfolio allocation across all connected token contracts on Arc. It triggered because ${dominant} reached ${concentration} of total assets, surpassing the 50% institutional safety threshold. All evaluations are derived directly from verified RPC contract balances to deliver transparent, advisory-only risk intelligence.`

    case 'LOW_STABLECOIN_SHARE':
      return `This capital preservation rule analyzes the proportion of liquid, USD-pegged stablecoins compared to volatile asset exposure. The monitor flagged this wallet because stablecoin reserves dropped below the recommended downside cushion. Maintaining an adequate stablecoin buffer protects capital during high market volatility and ensures liquid reserves for rebalancing.`

    case 'PRICE_UNAVAILABLE':
      return `This data integrity monitor verifies that every token holding with a positive balance has an active, verifiable price feed from connected oracles. It was flagged because real-time market pricing was temporarily unreachable for one or more detected assets. Dependent portfolio calculations are safely adjusted to avoid misleading valuations until oracle connectivity restores.`

    case 'BALANCE_READ_FAILED':
      return `This infrastructure health check verifies that all on-chain ERC-20 token queries complete successfully against Arc L1 RPC nodes. The scanner detected latency or transient node query failures when inspecting balances. Aggregated valuation figures are held back to preserve data accuracy until a complete on-chain state read is confirmed.`

    case 'PRINCIPAL_IMPAIRMENT':
      return `This yield surveillance rule compares current redeemable vault position value against the original deposited capital. The alert engaged because net position value fell below initial principal, indicating unrealized negative yield or temporary vault impairment. It highlights positions that warrant careful review before adding further capital or extending lockup terms.`

    case 'UNREALIZED_YIELD_UNSETTLED':
      return `This reward tracking rule inspects automated yield accrual and redeemable profit balances within Arc smart vaults. It confirms that the current position has generated positive surplus beyond the initial deposited principal. Accrued yield remains safely secured within the vault contract and is immediately available to redeem or compound.`

    case 'NET_LIQUIDITY_OUTFLOW':
      return `This cross-chain gateway monitor measures flow differentials between incoming and outgoing Circle CCTP bridge transfers. It registered an observation window where total capital leaving Arc exceeded incoming liquidity transfers. Significant net outflows can temporarily alter local pool depth and increase execution slippage on decentralized exchanges.`

    case 'SINGLE_SOURCE_CONCENTRATION':
      return `This gateway routing rule audits the origin network diversity of incoming cross-chain liquidity transfers to Arc. It was triggered because over 80% of recent inbound capital was routed from a single source blockchain rail. Heavy reliance on a single external chain introduces shared dependency on that specific network's confirmation times and gas fees.`

    case 'GATEWAY_NET_INFLOW':
      return `This cross-chain monitor calculates net liquidity expansion by subtracting Gateway burned volume from attestation mints. A positive differential confirms organic capital accumulation on Arc L1.`

    case 'NO_GATEWAY_ACTIVITY':
      return `This telemetry probe audits GatewayMinter and GatewayWallet event logs across the target block window. Zero matched events indicates dormancy in the selected timeframe without implying RPC communication errors.`

    case 'VAULT_ACTIVE_RESERVES':
      return `This automated surveillance audit inspects live accounting state from the Arc ERC-4626 USDC Yield Vault. It confirms that totalAssets() and totalSupply() are positive and reconcilable, establishing a deterministic share exchange rate. Findings are advisory-only reads derived directly from on-chain RPC calls.`

    case 'VAULT_NO_SHARES':
      return `This heuristic audits vault share minting state. When totalSupply() is 0, ERC-4626 accounting mathematics cannot compute a share price ratio (totalAssets / totalSupply). The vault is fully functional and ready for initial liquidity provision.`

    case 'VAULT_ASSETS_WITHOUT_SHARES':
      return `This consistency check flags when totalAssets() > 0 but totalSupply() == 0. Such states can occur during migration or unbacked donation transfers. Per-share economics cannot be computed until shares are minted against the balance.`

    case 'VAULT_READ_FAILED':
      return `This protocol health monitor requires complete responses for both totalAssets() and totalSupply() before calculating TVL or share price. Partial reads are safely rejected to prevent fabricated zero-value states.`

    case 'NO_HISTORICAL_SERIES':
      return `Standard ERC-4626 vault smart contracts do not store historical time-series data on-chain. Real-time reserves and exchange rates are read via eth_call, and window parameters are logged for client correlation without projecting unverified past APY.`

    case 'NO_VAULT_POSITION':
      return `This surveillance check inspects the ERC-4626 balanceOf balance for the requested address. With zero shares held, no principal or accrued yield is attributed to the account. Depositing USDC activates share issuance and yield compounding.`

    case 'ROUTE_RECOMMENDATION':
      return `This cross-chain routing algorithm evaluates live quotes between Circle Gateway (unified balance burn-intents) and CCTP v2 forwarders. The selected rail delivers the lowest net cost (protocol fee + source gas) to the destination network.`

    case 'ROUTE_UNAVAILABLE':
      return `This check confirms whether the target destination network is supported by Circle Gateway domains and CCTP token messagers on Arc Testnet. Unregistered networks are rejected to prevent unfulfillable transfers.`

    case 'ROUTE_PARTIAL':
      return `When one rail query times out or is unsupported on the destination, single-rail pricing is preserved without computing synthetic comparative savings.`

    case 'ARBITRAGE_OPPORTUNITY':
      return `This scanner compares constant-product pool reserves against external aggregated oracle benchmarks. When price divergence exceeds pool trading fees and gas costs, an actionable cross-venue opportunity is flagged.`

    case 'SPREAD_BELOW_THRESHOLD':
      return `When net profit margin after deducting Arc gas fees falls below the user's minNetProfitPct parameter, trades are not recommended to prevent negative net return.`

    case 'ARBITRAGE_READ_UNAVAILABLE':
      return `Requires active on-chain contract reserves and validated external oracle feeds. Synthesized or mocked quotes are rejected.`

    case 'HIGH_SLIPPAGE_RISK':
      return `This liquidity rule audits marginal price impact against constant-product or StableSwap invariants. Price impacts exceeding 1.0% indicate order sizes disproportionate to local pool reserves.`

    case 'OPTIMAL_SLIPPAGE_ROUTE':
      return `This optimizer models pool invariant curve slope against current reserves. The trade volume executes within the linear, low-slippage region of the pool.`

    case 'SLIPPAGE_QUOTE_UNAVAILABLE':
      return `Queries require both an active pool swap quote from the router and valid oracle spot pricing to measure relative price impact.`

    case 'MEV_SANDWICH_EXPOSURE':
    case 'HIGH_RESERVE_SANDWICH_EXPOSURE':
      return `This surveillance monitor compares trade size against live sold-side pool reserve depth across direct and 2-hop bottleneck pools. Orders exceeding 5% of pool reserves move the AMM curve steeply and create significant execution pressure.`

    case 'LOW_MEV_RISK':
    case 'LOW_RESERVE_EXPOSURE':
      return `When trade-to-reserve exposure stays within healthy bounds (< 5% of pool depth), single-transaction execution on Arc L1 deterministic FIFO ordering incurs low curve pressure.`

    case 'TWO_HOP_ROUTE_ADVANTAGE':
      return `The router simulates every direct and 2-hop pool combination across Arc V4 pools, deducts measured Arc gas per hop, and recommends a 2-hop path only when gas-adjusted net output strictly beats the direct pool.`

    case 'MEV_ANALYSIS_UNAVAILABLE':
      return `MEV risk evaluation requires verifying both on-chain pool reserves and oracle exchange rates to compute real trade-to-liquidity ratios without guessing.`

    case 'FLASH_LOAN_UNAVAILABLE':
      return `Arcis interfaces exclusively with verified smart contract accounting. In the absence of an on-chain liquidation protocol on Arc Testnet, liquidation metrics are withheld.`

    default: {
      const category = String(entry?.category ?? 'RISK').replace(/_/g, ' ').toLowerCase()
      const thresholdNote = entry?.threshold ? ` Evaluated against rule threshold: "${entry.threshold}".` : ''
      return `This institutional heuristic assesses live on-chain parameters for ${category} management.${thresholdNote} Findings are verified server-side observations designed to guide risk mitigation without taking custody or executing trades.`
    }
  }
}

function RiskRegisterCard({
  entry,
  index,
  onNavigateTab,
}: {
  entry: any
  index: number
  onNavigateTab?: (tab: string) => void
}) {
  const [isTechOpen, setIsTechOpen] = useState(false)
  const diagnosis = getHumanDiagnosis(entry)
  const severity = String(entry?.severity ?? 'INFO').toUpperCase()
  const severityTone = resolveRiskSeverityTone(severity)
  const toneStyle = getStatusToneStyle(severityTone)

  const inferredSymbols = diagnosis.assetSymbol
    ? [diagnosis.assetSymbol]
    : extractTokenSymbols(`${diagnosis.humanTitle} ${diagnosis.problemText}`, 2)

  return (
    <div
      key={`${String(entry?.id ?? 'risk')}-${index}`}
      className="p-4 sm:p-5 rounded-2xl border transition-all duration-200 hover:border-white/20 relative overflow-hidden"
      style={{
        background: 'linear-gradient(145deg, rgba(20, 24, 42, 0.72) 0%, rgba(11, 14, 24, 0.92) 100%)',
        borderColor: toneStyle.border,
        borderLeftWidth: '3px',
        borderLeftColor: toneStyle.accent,
        boxShadow: '0 6px 20px -6px rgba(0, 0, 0, 0.45)',
      }}
    >
      {/* Heading-First Top Row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {inferredSymbols.length > 0 && (
            <TokenPairIcons symbols={inferredSymbols} size={18} />
          )}
          <h5
            className="text-sm sm:text-base font-bold text-white tracking-tight leading-snug inline-flex items-center gap-1.5 flex-wrap"
            style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
          >
            {diagnosis.titlePrefix && diagnosis.assetSymbol ? (
              <>
                <span>{diagnosis.titlePrefix}</span>
                <span
                  className="text-xs sm:text-sm font-semibold inline-flex items-center gap-1 tabular-nums"
                  style={{
                    color: toneStyle.fg,
                    fontFamily: 'var(--fonts--space-grotesk)',
                  }}
                >
                  <span>({diagnosis.pctStr}</span>
                  <span>{diagnosis.assetSymbol})</span>
                </span>
              </>
            ) : (
              <span>{diagnosis.humanTitle}</span>
            )}
          </h5>
        </div>

        <StatusBadge tone={severityTone} label={severity} size="xs" />
      </div>

      {/* Narrative: Problem / Risk / Advisory Solution */}
      <div className="mt-3 space-y-2 text-xs leading-relaxed">
        <p style={{ color: 'var(--fp-2, rgba(255, 255, 255, 0.9))' }}>{diagnosis.problemText}</p>

        {diagnosis.riskText && (
          <p
            className="px-3 py-2 rounded-xl border text-[11px] leading-relaxed"
            style={{
              backgroundColor: STATUS_TONES.error.bg,
              borderColor: STATUS_TONES.error.border,
              color: STATUS_TONES.error.fg,
            }}
          >
            {diagnosis.riskText}
          </p>
        )}

        {diagnosis.solutionText && (
          <div
            className="flex items-start gap-2 pt-1 text-xs"
            style={{ color: 'var(--secondary-colors--static-ether)' }}
          >
            <ArrowRight
              className="w-3.5 h-3.5 shrink-0 mt-0.5"
              style={{ color: 'var(--secondary-colors--sky-sync)' }}
            />
            <p className="flex-1 leading-relaxed">{diagnosis.solutionText}</p>
          </div>
        )}
      </div>

      {/* Actionable Button + Technical Specifications Button Row */}
      <div className="mt-3.5 pt-3 border-t border-white/[0.06] flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {diagnosis.actionLabel && diagnosis.actionTab && onNavigateTab && (
            <button
              type="button"
              onClick={() => onNavigateTab(diagnosis.actionTab!)}
              className="ai-focus-ring inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-white text-xs font-semibold transition-all duration-200 cursor-pointer shadow-sm group shrink-0 hover:brightness-110"
              style={{
                backgroundColor: toneStyle.pillBg,
                borderColor: toneStyle.pillBorder,
                fontFamily: 'var(--font-app)',
              }}
            >
              <span>{diagnosis.actionLabel}</span>
              <ArrowRight className="w-3.5 h-3.5 text-white/75 group-hover:translate-x-0.5 transition-transform" />
            </button>
          )}

          {/* Info Icon Button - expands Technical Specifications */}
          <button
            type="button"
            onClick={() => setIsTechOpen(!isTechOpen)}
            className="ai-focus-ring group/specs inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-transparent hover:border-white/10 hover:bg-white/[0.04] transition-all duration-200 cursor-pointer select-none"
            style={{ color: isTechOpen ? STATUS_TONES.info.accent : 'var(--fp-3)' }}
            aria-expanded={isTechOpen}
          >
            <Info
              className="w-3.5 h-3.5 shrink-0 transition-colors duration-200"
              style={{ color: isTechOpen ? STATUS_TONES.info.accent : 'var(--secondary-colors--sky-sync)' }}
            />
            <span
              className="text-[11px] font-mono font-medium tracking-wide"
              style={{ fontFamily: 'var(--fonts--space-mono)' }}
            >
              Technical Specifications
            </span>
            <ChevronRight
              className={`w-3 h-3 shrink-0 transition-transform duration-200 ${isTechOpen ? 'rotate-90' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Expanded Technical Specifications Panel */}
      <div
        className={`mt-2.5 p-3.5 rounded-xl border transition-all ${isTechOpen ? 'block' : 'hidden'}`}
        style={{
          backgroundColor: STATUS_TONES.info.bg,
          borderColor: STATUS_TONES.info.border,
        }}
      >
        <p className="text-xs leading-relaxed font-sans" style={{ color: 'var(--fp-2)' }}>
          {getTechnicalExplanation(entry)}
        </p>
      </div>
    </div>
  )
}

/**
 * Universal Visual Data Dashboard for AI Services
 * Extracts key metrics, holdings, risk flags, routes, and recommendations cleanly
 */
export function VisualDataDashboard({
  data,
  outputViewMode = 'visual',
  onToggleViewMode,
  onCopy,
  isCopied,
  onNavigateTab,
  actionablePayload,
  walletAddress,
  walletConnected,
  ucwHandlers,
  generatedAt,
}: {
  data: any
  outputViewMode?: 'visual' | 'raw'
  onToggleViewMode?: () => void
  onCopy?: () => void
  isCopied?: boolean
  onNavigateTab?: (tab: string) => void
  actionablePayload?: x402ExecutionResult['actionablePayload']
  walletAddress?: string
  walletConnected?: boolean
  ucwHandlers?: CopilotUcwHandlers
  generatedAt?: number | string | null
}) {
  if (!data || typeof data !== 'object') {
    return <div className="text-white/40 text-xs font-mono">No structured data available</div>
  }

  const status = typeof data.status === 'string' ? data.status : null
  const note = typeof data.note === 'string' ? data.note : typeof data.summary === 'string' ? data.summary : null

  // `llm` services keep every measured figure under `measured` and their prose under
  // `narrative`. Flatten the measured block so the visual report shows the numbers the
  // caller paid for, while the top-level fields keep precedence.
  const measured: Record<string, any> =
    data.measured && typeof data.measured === 'object' && !Array.isArray(data.measured)
      ? (data.measured as Record<string, any>)
      : {}
  const view: Record<string, any> = Object.keys(measured).length > 0 ? { ...measured, ...data } : data

  const narrative: { headline?: unknown; observations?: unknown; risks?: unknown } | null =
    data.narrative && typeof data.narrative === 'object' && !Array.isArray(data.narrative)
      ? (data.narrative as { headline?: unknown; observations?: unknown; risks?: unknown })
      : null
  const narrativeHeadline = typeof narrative?.headline === 'string' ? narrative.headline : null
  const narrativeObservations: string[] = Array.isArray(narrative?.observations)
    ? narrative.observations.filter((item): item is string => typeof item === 'string')
    : []
  const narrativeRisks: string[] = Array.isArray(narrative?.risks)
    ? narrative.risks.filter((item): item is string => typeof item === 'string')
    : []

  const unavailableList: string[] = Array.isArray(data.unavailable)
    ? data.unavailable.filter((item: unknown): item is string => typeof item === 'string')
    : []
  const reason = typeof data.reason === 'string' ? data.reason : null
  // Institutional envelope or direct riskRegister/register on service results.
  const report: Record<string, any> | null =
    data.report && typeof data.report === 'object' && !Array.isArray(data.report)
      ? (data.report as Record<string, any>)
      : null
  const rawRegister: any[] = Array.isArray(report?.riskRegister)
    ? report!.riskRegister
    : Array.isArray(data?.riskRegister)
      ? data.riskRegister
      : Array.isArray(data?.register)
        ? data.register
        : []
  const riskRegister: any[] = rawRegister
  const reportSummary =
    report?.riskSummary ??
    (rawRegister.length > 0
      ? {
        highestSeverity: rawRegister[0]?.severity ?? 'INFO',
        counts: rawRegister.reduce(
          (acc: Record<string, number>, r: any) => {
            const sev = String(r?.severity ?? 'INFO')
            acc[sev] = (acc[sev] || 0) + 1
            return acc
          },
          {} as Record<string, number>
        ),
      }
      : null)

  const statusMeta = resolveServiceStatusMeta(status)
  const statusTone = statusMeta ? getStatusToneStyle(statusMeta.tone) : null

  const bestRoute: Record<string, any> | null =
    data.bestRoute && typeof data.bestRoute === 'object' && !Array.isArray(data.bestRoute)
      ? (data.bestRoute as Record<string, any>)
      : null
  const shieldAction: Record<string, any> | null =
    data.recommendedShieldAction &&
      typeof data.recommendedShieldAction === 'object' &&
      !Array.isArray(data.recommendedShieldAction)
      ? (data.recommendedShieldAction as Record<string, any>)
      : null

  const riskFlags: string[] = Array.isArray(view.riskFlags)
    ? view.riskFlags
    : Array.isArray(view.flags)
      ? view.flags
      : []

  // Extract numeric headline metrics
  const numericMetrics: {
    key: string
    label: string
    value: string
    rawValue: number
    tokenSymbol: string | null
    accentTone: ReturnType<typeof inferMetricAccentTone>
    isCurrency?: boolean
    isPct?: boolean
  }[] = []

  const knownMetrics: Record<string, { label: string; isCurrency?: boolean; isPct?: boolean; smallCurrency?: boolean }> = {
    totalUsd: { label: 'Total Value', isCurrency: true },
    totalValueUsd: { label: 'Total Portfolio', isCurrency: true },
    totalProtocolTvlUsd: { label: 'Total Protocol TVL', isCurrency: true },
    concentrationPct: { label: 'Asset Concentration', isPct: true },
    stablecoinSharePct: { label: 'Stablecoin Share', isPct: true },
    apy: { label: 'Annual Yield (APY)', isPct: true },
    yieldApy: { label: 'Vault APY', isPct: true },
    spreadPct: { label: 'Arb Spread', isPct: true },
    priceImpactPct: { label: 'Price Impact', isPct: true },
    ammPriceImpactPct: { label: 'AMM Price Impact', isPct: true },
    poolFeePct: { label: 'Pool LP Fee', isPct: true },
    estimatedProfitUsdc: { label: 'Est. Profit', isCurrency: true },
    savingsUsdc: { label: 'Rail Fee Savings', isCurrency: true, smallCurrency: true },
    latencyMs: { label: 'Execution Ping' },
    // `llm` services report their measured block under these keys.
    currentValueUsdc: { label: 'Redeemable Value', isCurrency: true },
    principalUsdc: { label: 'Principal', isCurrency: true },
    pendingYieldUsdc: { label: 'Pending Yield', isCurrency: true },
    unrealizedYieldUsdc: { label: 'Unrealized Yield', isCurrency: true },
    vaultTotalAssetsUsdc: { label: 'Vault Total Assets', isCurrency: true },
    tvlUsdc: { label: 'Vault TVL', isCurrency: true },
    sharePriceUsdc: { label: 'Share Price', isCurrency: true },
    totalLpValueUsd: { label: 'Active LP Value', isCurrency: true },
    totalPendingLpFeesUsd: { label: 'Pending LP Fees', isCurrency: true },
    totalHarvestableYieldAndFeesUsd: { label: 'Harvestable Total', isCurrency: true },
    gatewayBalanceUsdc: { label: 'Gateway Balance', isCurrency: true },
    gasCostUsdc: { label: 'Gas Cost', isCurrency: true, smallCurrency: true },
    estimatedGasCostUsdc: { label: 'Est. Gas Cost', isCurrency: true, smallCurrency: true },
    netProfitUsdc: { label: 'Net Profit', isCurrency: true },
    grossSpreadPct: { label: 'Gross Spread', isPct: true },
    netProfitPct: { label: 'Net Profit Margin', isPct: true },
    tradeReserveExposurePct: { label: 'Reserve Exposure', isPct: true },
    overallPriceImpactPct: { label: 'vs. Oracle Impact', isPct: true },
    poolReserveUsdc: { label: 'Pool Reserve Depth', isCurrency: true },
    grossInflowUsdc: { label: 'Gross Inflow', isCurrency: true },
    grossOutflowUsdc: { label: 'Gross Outflow', isCurrency: true },
    netUsdcInflowUsdc: { label: 'Net USDC Inflow', isCurrency: true },
  }

  const hasTradeExecutionSummary =
    status === 'ROUTE_OPTIMIZED' &&
    typeof data.inputAmount === 'string' &&
    typeof data.expectedOutput === 'string'

  const tradeExecutionVerdict = hasTradeExecutionSummary
    ? data.executionVerdict &&
      typeof data.executionVerdict === 'object' &&
      typeof data.executionVerdict.label === 'string' &&
      typeof data.executionVerdict.tone === 'string'
      ? (data.executionVerdict as ReturnType<typeof resolveTradeExecutionVerdict>)
      : resolveTradeExecutionVerdict({
          ammPriceImpactPct: typeof data.ammPriceImpactPct === 'number' ? data.ammPriceImpactPct : null,
          signedPriceImpactPct: typeof data.signedPriceImpactPct === 'number' ? data.signedPriceImpactPct : null,
          overallPriceImpactPct: typeof data.overallPriceImpactPct === 'number' ? data.overallPriceImpactPct : null,
          tradeReserveExposurePct: typeof data.tradeReserveExposurePct === 'number' ? data.tradeReserveExposurePct : null,
          recommendedBatchCount:
            typeof data.executionSizing?.recommendedBatchCount === 'number'
              ? data.executionSizing.recommendedBatchCount
              : 1,
          perBatchAmmPriceImpactPct:
            typeof data.executionSizing?.perBatchAmmPriceImpactPct === 'number'
              ? data.executionSizing.perBatchAmmPriceImpactPct
              : null,
        })
    : null

  const TRADE_SUMMARY_HANDLED_KEYS = new Set([
    'recommendedHops',
    'effectiveExecutionPrice',
    'ammPriceImpactPct',
    'poolFeePct',
    'overallPriceImpactPct',
    'signedPriceImpactPct',
    'twoHopOutputGainPct',
    'tradeReserveExposurePct',
    'poolReserveUsdc',
    'flashReserveDepthUsdc',
    'estimatedGasCostUsdc',
  ])

  for (const [k, v] of Object.entries(view)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (k === 'readAt' || k === 'timestamp' || k === 'shareDecimals' || k === 'decimals') continue
      if (hasTradeExecutionSummary && TRADE_SUMMARY_HANDLED_KEYS.has(k)) continue
      const meta = knownMetrics[k] || { label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()) }
      let formatted =
        Math.abs(v) > 0 && Math.abs(v) < 0.01
          ? v.toLocaleString(undefined, { maximumFractionDigits: 6 })
          : v.toLocaleString(undefined, { maximumFractionDigits: 4 })
      if (meta.isCurrency) {
        if (meta.smallCurrency && Math.abs(v) > 0 && Math.abs(v) < 0.01) {
          formatted = `$${v.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
        } else {
          formatted = `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        }
      } else if (meta.isPct) {
        formatted = `${v.toFixed(2)}%`
      }
      numericMetrics.push({
        key: k,
        label: meta.label,
        value: formatted,
        rawValue: v,
        tokenSymbol: inferMetricTokenSymbol(k),
        accentTone: inferMetricAccentTone(k, v),
        isCurrency: meta.isCurrency,
        isPct: meta.isPct,
      })
    }
  }

  const sortByValue = (list: any[]): any[] =>
    [...list].sort((a, b) => {
      const valA = typeof a?.valueUsd === 'number' ? a.valueUsd : -1
      const valB = typeof b?.valueUsd === 'number' ? b.valueUsd : -1
      return valB - valA
    })

  const holdings: any[] = sortByValue(Array.isArray(view.holdings) ? view.holdings : [])
  const chainExposure: any[] = sortByValue(Array.isArray(view.chainExposure) ? view.chainExposure : [])
  const routes: any[] = Array.isArray(view.routes) ? view.routes : []
  const routeComparison: any[] = Array.isArray(data.routeComparison) ? data.routeComparison : []
  const scannedPools: any[] = Array.isArray(data.scannedPools) ? data.scannedPools : []
  const yieldOpportunities: any[] = Array.isArray(data.opportunities) ? data.opportunities : []
  const defiLpPositions: any[] = Array.isArray(data.lpPositions)
    ? data.lpPositions
    : Array.isArray(data.defiPositions?.lpPools)
      ? data.defiPositions.lpPools
      : []
  const defiVaultSummary: Record<string, any> | null =
    data.defiPositions?.vault && typeof data.defiPositions.vault === 'object'
      ? (data.defiPositions.vault as Record<string, any>)
      : null
  const bridgeRailQuote: {
    token: string
    destinationChain: string
    recommendedRail: string | null
    gateway: Record<string, any>
    cctp: Record<string, any>
    supportedDestinations: string[]
  } | null =
    data.gateway && typeof data.gateway === 'object' && data.cctp && typeof data.cctp === 'object'
      ? {
        token: typeof data.token === 'string' ? data.token : 'USDC',
        destinationChain: typeof data.destinationChain === 'string' ? data.destinationChain : '',
        recommendedRail: typeof data.recommendedRail === 'string' ? data.recommendedRail : null,
        gateway: data.gateway as Record<string, any>,
        cctp: data.cctp as Record<string, any>,
        supportedDestinations: Array.isArray(data.supportedDestinations) ? data.supportedDestinations : [],
      }
      : null
  const executionSizing: Record<string, any> | null =
    data.executionSizing && typeof data.executionSizing === 'object' && !Array.isArray(data.executionSizing)
      ? (data.executionSizing as Record<string, any>)
      : null
  const recommendations: string[] = Array.isArray(view.recommendations) ? view.recommendations : []

  const [copiedAddress, setCopiedAddress] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  const reportUtcStamp = (() => {
    const raw =
      data?.generatedAt ??
      data?.report?.issuedAt ??
      data?.report?.asOf ??
      data?.timestamp ??
      data?.readAt ??
      generatedAt
    if (raw === null || raw === undefined || raw === '') return null
    const d = typeof raw === 'number' ? new Date(raw) : new Date(String(raw))
    if (Number.isNaN(d.getTime())) return null
    const yyyy = d.getUTCFullYear()
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const hh = String(d.getUTCHours()).padStart(2, '0')
    const min = String(d.getUTCMinutes()).padStart(2, '0')
    const ss = String(d.getUTCSeconds()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} UTC`
  })()

  useEffect(() => {
    if (!isExportOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsExportOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isExportOpen])

  const handleCopyAddress = async () => {
    if (!data?.address) return
    try {
      await navigator.clipboard.writeText(String(data.address))
      soundService.play('pop')
      setCopiedAddress(true)
      setTimeout(() => setCopiedAddress(false), 2000)
    } catch (err) {
      console.error('Failed to copy address', err)
    }
  }

  return (
    <div className="space-y-4 text-xs font-sans">
      {/* Top Status Masthead — Export/Raw controls + Execution Verdict badge for Trade Ticket, full masthead otherwise */}
      <div className={`flex flex-wrap items-center justify-between gap-3 ${hasTradeExecutionSummary ? 'pb-0.5' : 'items-start gap-4 pb-4 border-b border-white/[0.08]'}`}>
        {!hasTradeExecutionSummary && (
        <div className="space-y-2 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            {statusMeta && (
              <>
                <h3
                  className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-none"
                  style={{
                    fontFamily: 'var(--font-display, Outfit, sans-serif)',
                    color: statusMeta.tone === 'error' ? STATUS_TONES.error.fg : '#ffffff',
                  }}
                >
                  {statusMeta.heading}
                </h3>
                <StatusBadge tone={statusMeta.tone} label={statusMeta.badgeLabel} size="sm" />
              </>
            )}

            {note && (
              <div className="relative group/note inline-flex">
                <div
                  className="inline-flex items-center justify-center p-1.5 rounded-xl border text-[11px] font-mono font-bold tracking-tight transition cursor-help select-none hover:brightness-125"
                  style={{
                    color: STATUS_TONES.info.accent,
                    backgroundColor: STATUS_TONES.info.bg,
                    borderColor: STATUS_TONES.info.border,
                  }}
                >
                  <Info className="w-3.5 h-3.5 flex-shrink-0" />
                </div>

                {/* Note Content Tooltip */}
                <div
                  className="absolute left-0 top-full mt-2 hidden group-hover/note:flex flex-col z-50 w-80 sm:w-96 p-3.5 rounded-2xl shadow-2xl backdrop-blur-2xl animate-fade-in pointer-events-none border"
                  style={{
                    backgroundColor: 'rgba(9, 12, 24, 0.98)',
                    borderColor: STATUS_TONES.info.border,
                  }}
                >
                  <div
                    className="flex items-center gap-1.5 mb-1.5 text-[11px] font-mono font-bold uppercase tracking-wider"
                    style={{ color: STATUS_TONES.info.accent }}
                  >
                    <Info className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Protocol Verification Note</span>
                  </div>
                  <p className="text-xs font-mono leading-relaxed text-white/90">{note}</p>
                </div>
              </div>
            )}
          </div>

          {data.address && (
            <div className="text-xs font-mono text-white/55 flex items-center gap-2 pt-0.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-[var(--fp-4)]">
                <Wallet className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)]" />
                <span>Target:</span>
              </span>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-white/[0.04] border border-white/10 hover:border-white/20 transition group">
                <button
                  type="button"
                  onClick={handleCopyAddress}
                  className="ai-focus-ring p-0.5 rounded hover:bg-white/10 text-white/55 hover:text-white transition cursor-pointer"
                  aria-label="Copy target wallet address"
                >
                  {copiedAddress ? (
                    <Check className="w-3.5 h-3.5 text-[var(--earned-green)]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-white/60 group-hover:text-white" />
                  )}
                </button>
                <span className="text-white/90 font-medium select-all">
                  {String(data.address).slice(0, 8)}…{String(data.address).slice(-6)}
                </span>
                {copiedAddress && (
                  <span
                    className="text-[10px] font-semibold animate-fade-in"
                    style={{ color: 'var(--earned-green)' }}
                  >
                    Copied
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        )}

        {/* Right side controls: Export Dropdown (CSV / JSON) & Raw JSON toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative inline-block" ref={exportMenuRef}>
            <button
              type="button"
              onClick={() => {
                soundService.play('pop')
                setIsExportOpen((prev) => !prev)
              }}
              aria-label="Export report"
              aria-haspopup="menu"
              aria-expanded={isExportOpen}
              className="ai-focus-ring ub-action-btn inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-mono uppercase tracking-[1px] cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)]" />
              <span>Export</span>
              <ChevronDown
                className={`w-3 h-3 transition-transform duration-200 ${
                  isExportOpen ? 'rotate-180 text-[var(--purple-1)]' : 'text-white/55'
                }`}
              />
            </button>

            {isExportOpen && (
              <div
                role="menu"
                aria-label="Export options"
                className="absolute right-0 top-full mt-1.5 z-50 min-w-[124px] rounded-xl p-1.5 shadow-2xl backdrop-blur-2xl border border-white/10 animate-fade-in"
                style={{
                  background: 'rgba(12, 15, 26, 0.96)',
                  boxShadow: '0 12px 32px -4px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08)',
                }}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    soundService.play('pop')
                    const slug = String(data?.report?.serviceId || data?.serviceId || 'arcis-report')
                    const csv = buildReportCsv(slug, data)
                    triggerFileDownload(`${slug}-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8;')
                    setIsExportOpen(false)
                  }}
                  className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-left text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet
                      className="w-4 h-4 group-hover:scale-110 transition-transform"
                      style={{ color: STATUS_TONES.success.fg }}
                    />
                    <span className="font-mono text-[11px] font-medium tracking-wide">CSV</span>
                  </div>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    soundService.play('pop')
                    const slug = String(data?.report?.serviceId || data?.serviceId || 'arcis-report')
                    triggerFileDownload(`${slug}-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json')
                    setIsExportOpen(false)
                  }}
                  className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg text-left text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    <FileJson
                      className="w-4 h-4 group-hover:scale-110 transition-transform"
                      style={{ color: STATUS_TONES.cancelled.fg }}
                    />
                    <span className="font-mono text-[11px] font-medium tracking-wide">JSON</span>
                  </div>
                </button>
              </div>
            )}
          </div>
          {onToggleViewMode && (
            <button
              type="button"
              onClick={onToggleViewMode}
              className="ai-focus-ring inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-semibold transition cursor-pointer shadow-sm"
              style={
                outputViewMode === 'raw'
                  ? {
                    backgroundColor: STATUS_TONES.pending.pillBg,
                    borderColor: STATUS_TONES.pending.pillBorder,
                    color: '#ffffff',
                  }
                  : {
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    color: 'rgba(255, 255, 255, 0.8)',
                  }
              }
              title={outputViewMode === 'raw' ? 'Switch to Visual Report' : 'View Raw JSON Payload'}
            >
              <FileJson className="w-4 h-4 flex-shrink-0" />
            </button>
          )}
          {reportUtcStamp && (
            <span
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] text-[12px] font-mono tabular-nums tracking-[0.4px] select-none"
              style={{
                fontFamily: 'var(--fonts--space-mono)',
                color: 'var(--fp-3)',
              }}
            >
              <Clock className="w-4 h-4 shrink-0 text-[var(--secondary-colors--sky-sync)]" />
              <span>{reportUtcStamp}</span>
            </span>
          )}
        </div>

        {/* Clear Go / Caution / Do-Not-Execute Verdict Badge at far right of the Export row */}
        {tradeExecutionVerdict && (() => {
          const verdictStyle = getStatusToneStyle(tradeExecutionVerdict.tone)
          const VerdictIcon =
            tradeExecutionVerdict.code === 'DO_NOT_EXECUTE'
              ? Ban
              : tradeExecutionVerdict.code === 'CAUTION_SPLIT'
                ? AlertTriangle
                : CheckCircle2
          return (
            <span
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-mono font-bold uppercase tracking-[0.6px] shrink-0 select-none shadow-sm"
              style={{
                fontFamily: 'var(--fonts--space-mono)',
                color: verdictStyle.fg,
                backgroundColor: verdictStyle.pillBg,
                borderColor: verdictStyle.pillBorder,
                boxShadow: `0 0 18px ${verdictStyle.glow}`,
              }}
              title={tradeExecutionVerdict.reason}
              aria-label={`Execution verdict: ${tradeExecutionVerdict.label}`}
            >
              <VerdictIcon className="w-3.5 h-3.5 shrink-0" style={{ color: verdictStyle.accent }} />
              <span>{tradeExecutionVerdict.label}</span>
            </span>
          )
        })()}
      </div>

      {outputViewMode === 'raw' ? (
        <div className="relative pt-1 animate-fade-in group">
          {/* Floating Copy Button in Top-Right of JSON Container */}
          {onCopy && (
            <div className="absolute top-3 right-3 z-10">
              <button
                type="button"
                onClick={onCopy}
                className="ai-focus-ring inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 hover:border-white/30 bg-black/75 hover:bg-black/90 backdrop-blur-md text-white/80 hover:text-white text-xs font-mono transition cursor-pointer shadow-lg"
              >
                {isCopied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[var(--earned-green)]" />
                    <span className="text-[var(--earned-green)] font-semibold">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-white/70" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          )}

          <pre
            className="whitespace-pre-wrap selection:bg-[var(--purple-1)] selection:text-white font-mono text-xs leading-relaxed max-h-[500px] overflow-y-auto p-4 pt-5 rounded-xl bg-black/45 border border-white/[0.08]"
            style={{ color: 'var(--status-success-fg)' }}
          >
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      ) : hasTradeExecutionSummary ? (
        <TradeExecutionTicketReport
          data={data}
          actionablePayload={actionablePayload}
          walletAddress={walletAddress}
          walletConnected={walletConnected}
          ucwHandlers={ucwHandlers}
          onNavigateTab={onNavigateTab}
        />
      ) : (
        <>

          {/* Headline Metric Cards Grid — Prominent Space Grotesk KPIs with Coin Icons */}
          {numericMetrics.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
              {numericMetrics.map((m) => {
                const accentStyle = m.accentTone ? getStatusToneStyle(m.accentTone) : null
                return (
                  <div
                    key={m.key}
                    className="relative p-4 rounded-2xl border transition-all duration-300 group overflow-hidden"
                    style={{
                      background:
                        'linear-gradient(155deg, rgba(22, 26, 44, 0.84) 0%, rgba(12, 15, 26, 0.92) 100%)',
                      borderColor: accentStyle ? accentStyle.border : 'rgba(172, 198, 233, 0.12)',
                      boxShadow: '0 6px 20px -6px rgba(0, 0, 0, 0.45)',
                    }}
                  >
                    <div
                      className="absolute top-0 left-0 right-0 h-[2px] opacity-65 group-hover:opacity-100 transition-opacity duration-300"
                      style={{
                        background: accentStyle
                          ? `linear-gradient(90deg, transparent, ${accentStyle.accent}, transparent)`
                          : 'linear-gradient(90deg, transparent, rgba(152, 150, 255, 0.45), transparent)',
                      }}
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="text-[10px] font-mono uppercase tracking-[1.4px] truncate"
                        style={{
                          fontFamily: 'var(--fonts--space-mono, monospace)',
                          color: 'var(--secondary-colors--sky-sync)',
                        }}
                      >
                        {m.label}
                      </span>
                      {m.tokenSymbol && (
                        <span className="shrink-0 inline-flex items-center" title={m.tokenSymbol}>
                          <PortfolioAssetIcon
                            symbol={m.tokenSymbol}
                            size={15}
                            className="w-3.5 h-3.5 object-contain"
                          />
                        </span>
                      )}
                    </div>
                    <div
                      className="text-xl sm:text-2xl font-bold tabular-nums tracking-tight truncate mt-2"
                      style={{
                        fontFamily: 'var(--fonts--space-grotesk, sans-serif)',
                        color: accentStyle ? accentStyle.fg : '#ffffff',
                      }}
                    >
                      {m.value}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Route comparison & execution sizing (Smart Trade & Execution Advisor) */}
          {(routeComparison.length > 0 || executionSizing) && (
            <div className="ai-section-card">
              <SectionHeader
                title="Route Comparison & Execution Sizing"
                icon={GitBranch}
                tone="info"
                count={routeComparison.length > 0 ? routeComparison.length : undefined}
              />
              <div className="p-4 space-y-3">
                {routeComparison.length > 0 && (
                  <div className="space-y-2.5">
                    {routeComparison.map((route: any, idx: number) => {
                      const impactPct = typeof route.priceImpactPct === 'number' ? route.priceImpactPct : null
                      const ammPct = typeof route.ammPriceImpactPct === 'number' ? route.ammPriceImpactPct : null
                      const feePct = typeof route.poolFeePct === 'number' ? route.poolFeePct : null
                      const ammColor =
                        ammPct === null
                          ? 'var(--fp-2)'
                          : ammPct >= 2
                            ? STATUS_TONES.error.fg
                            : ammPct >= 1
                              ? STATUS_TONES.cancelled.fg
                              : STATUS_TONES.success.fg
                      const impactColor =
                        impactPct === null
                          ? 'var(--fp-2)'
                          : impactPct >= 2
                            ? STATUS_TONES.error.fg
                            : impactPct >= 1
                              ? STATUS_TONES.cancelled.fg
                              : STATUS_TONES.success.fg
                      return (
                        <div
                          key={route.path || idx}
                          className="p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 transition-colors"
                          style={
                            route.recommended
                              ? {
                                backgroundColor: STATUS_TONES.success.bg,
                                borderColor: STATUS_TONES.success.border,
                              }
                              : {
                                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                                borderColor: 'rgba(255, 255, 255, 0.07)',
                              }
                          }
                        >
                          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
                            <RouteTokenFlow path={route.path} size={15} />
                            <StatusBadge
                              tone="info"
                              label={route.hops === 2 ? '2-Hop' : 'Direct'}
                              size="xs"
                              showIcon={false}
                            />
                            {route.recommended && (
                              <StatusBadge tone="success" label="Best Output" size="xs" />
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-3.5 text-[11px] font-mono text-white/75 tabular-nums">
                            <span>
                              Out:{' '}
                              <strong
                                className="text-white"
                                style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                              >
                                {Number(route.expectedOutput).toLocaleString(undefined, {
                                  maximumFractionDigits: Number(route.expectedOutput) < 0.1 ? 6 : 4,
                                })}
                              </strong>
                            </span>
                            {ammPct !== null && (
                              <span>
                                AMM: <strong style={{ color: ammColor }}>{ammPct.toFixed(2)}%</strong>
                              </span>
                            )}
                            {feePct !== null && (
                              <span>
                                Fee: <strong className="text-white/90">{feePct.toFixed(2)}%</strong>
                              </span>
                            )}
                            {typeof route.signedPriceImpactPct === 'number' && route.signedPriceImpactPct < 0 ? (
                              <span>
                                Oracle:{' '}
                                <strong style={{ color: STATUS_TONES.success.fg }}>
                                  +{Math.abs(route.signedPriceImpactPct).toFixed(2)}% better
                                </strong>
                              </span>
                            ) : impactPct !== null ? (
                              <span>
                                Oracle: <strong style={{ color: impactColor }}>-{impactPct.toFixed(2)}%</strong>
                              </span>
                            ) : null}
                            {typeof route.estimatedGasUsdc === 'number' && (
                              <span className="inline-flex items-center gap-1">
                                Gas:
                                <PortfolioAssetIcon symbol="USDC" size={12} className="w-3 h-3 object-contain" />
                                <strong className="text-white/90">
                                  ${route.estimatedGasUsdc < 0.01 ? route.estimatedGasUsdc.toFixed(4) : route.estimatedGasUsdc.toFixed(2)}
                                </strong>
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {executionSizing && (
                  <div
                    className="p-3.5 rounded-xl border space-y-2"
                    style={{
                      backgroundColor: STATUS_TONES.info.bg,
                      borderColor: STATUS_TONES.info.border,
                    }}
                  >
                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] font-mono text-white/75 tabular-nums">
                      <span>
                        Batches:{' '}
                        <strong className="text-white">{executionSizing.recommendedBatchCount}×</strong>
                      </span>
                      <span>
                        Per batch:{' '}
                        <strong className="text-white">
                          {Number(executionSizing.perBatchInputAmount).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                        </strong>
                      </span>
                      {executionSizing.recommendedBatchCount > 1 &&
                        typeof executionSizing.perBatchExpectedOutput === 'number' && (
                          <span>
                            Batch 1 Out:{' '}
                            <strong style={{ color: STATUS_TONES.success.fg }}>
                              {executionSizing.perBatchExpectedOutput.toLocaleString(undefined, {
                                maximumFractionDigits: executionSizing.perBatchExpectedOutput < 0.1 ? 6 : 4,
                              })}
                            </strong>
                          </span>
                        )}
                      {executionSizing.recommendedBatchCount > 1 &&
                        typeof executionSizing.singleSwapAmmPriceImpactPct === 'number' &&
                        typeof executionSizing.perBatchAmmPriceImpactPct === 'number' && (
                          <span>
                            Batch 1 AMM Impact:{' '}
                            <strong style={{ color: STATUS_TONES.success.fg }}>
                              {executionSizing.singleSwapAmmPriceImpactPct.toFixed(2)}% → {executionSizing.perBatchAmmPriceImpactPct.toFixed(2)}%
                            </strong>
                          </span>
                        )}
                      <span>
                        Max slippage:{' '}
                        <strong style={{ color: STATUS_TONES.info.accent }}>
                          {executionSizing.suggestedMaxSlippagePct}%
                        </strong>
                        {typeof executionSizing.slippageClampedFromPct === 'number' && (
                          <span className="text-white/45 ml-1">
                            (clamped from {executionSizing.slippageClampedFromPct}%)
                          </span>
                        )}
                      </span>
                      {typeof executionSizing.estimatedTotalGasUsdc === 'number' && (
                        <span className="inline-flex items-center gap-1">
                          Est. gas:
                          <PortfolioAssetIcon symbol="USDC" size={12} className="w-3 h-3 object-contain" />
                          <strong className="text-white">
                            ${executionSizing.estimatedTotalGasUsdc < 0.01 ? executionSizing.estimatedTotalGasUsdc.toFixed(4) : executionSizing.estimatedTotalGasUsdc.toFixed(2)} USDC
                          </strong>
                        </span>
                      )}
                    </div>
                    {typeof executionSizing.note === 'string' && (
                      <p className="text-[11px] font-mono text-white/60 leading-relaxed">
                        {executionSizing.note}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Scanned Pools Table (All-Pools Spread & Mispricing Scanner) */}
          {scannedPools.length > 0 && (
            <div className="ai-section-card">
              <SectionHeader
                title="Scanned Arc Pools"
                eyebrow="Ranked by Net Spread"
                icon={BarChart3}
                tone="info"
                count={scannedPools.length}
              />
              <div className="p-3.5 space-y-2.5 max-h-80 overflow-y-auto">
                {scannedPools.map((pool: any) => {
                  const pairSymbols = extractTokenSymbols(pool.pair, 2)
                  return (
                    <div
                      key={pool.pair}
                      className="p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 transition-colors"
                      style={
                        pool.meetsThreshold
                          ? {
                            backgroundColor: STATUS_TONES.success.bg,
                            borderColor: STATUS_TONES.success.border,
                          }
                          : {
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            borderColor: 'rgba(255, 255, 255, 0.07)',
                          }
                      }
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <TokenPairIcons symbols={pairSymbols} size={18} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-sm font-bold text-white tracking-tight"
                              style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                            >
                              {pool.pair}
                            </span>
                            {pool.meetsThreshold ? (
                              <StatusBadge tone="success" label="Above Hurdle" size="xs" />
                            ) : (
                              <StatusBadge tone="info" label="Below Hurdle" size="xs" showIcon={false} />
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-white/50 block mt-0.5 tabular-nums">
                            Pool: {pool.poolRate} · Oracle: {pool.oracleRate} ({pool.quoteUnit})
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-[11px] font-mono tabular-nums">
                        <span className="text-white/70">
                          Spread: <strong className="text-white">{pool.grossSpreadPct}%</strong>
                        </span>
                        <span
                          className="inline-flex items-center gap-1 font-bold"
                          style={{
                            color: pool.meetsThreshold ? STATUS_TONES.success.fg : 'var(--fp-3)',
                          }}
                        >
                          <PortfolioAssetIcon symbol="USDC" size={12} className="w-3 h-3 object-contain" />
                          <span>
                            Net: ${pool.netProfitUsdc} ({pool.netProfitPct}%)
                          </span>
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Yield & Pool Opportunities Table (Arc Yield & Pool Opportunity Finder) */}
          {yieldOpportunities.length > 0 && (
            <div className="ai-section-card">
              <SectionHeader
                title="Arc Yield & Pool Opportunities"
                eyebrow="Live On-Chain State"
                icon={TrendingUp}
                tone="success"
                count={yieldOpportunities.length}
              />
              <div className="p-3.5 space-y-2.5 max-h-84 overflow-y-auto">
                {yieldOpportunities.map((op: any) => {
                  const opSymbols =
                    op.kind === 'vault' ? ['USDC'] : extractTokenSymbols(op.name, 2)
                  const riskUpper = String(op.riskLevel || '').toUpperCase()
                  const riskTone =
                    riskUpper === 'HIGH'
                      ? 'error'
                      : riskUpper === 'MEDIUM'
                        ? 'cancelled'
                        : 'info'
                  const cardTone = op.paused
                    ? STATUS_TONES.cancelled
                    : op.walletEligible
                      ? STATUS_TONES.success
                      : null

                  return (
                    <div
                      key={op.id || op.name}
                      className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 transition-colors ${op.paused ? 'opacity-80' : ''
                        }`}
                      style={
                        cardTone
                          ? {
                            backgroundColor: cardTone.bg,
                            borderColor: cardTone.border,
                          }
                          : {
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            borderColor: 'rgba(255, 255, 255, 0.07)',
                          }
                      }
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <TokenPairIcons symbols={opSymbols.length > 0 ? opSymbols : ['USDC']} size={18} />
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className="text-sm font-bold text-white tracking-tight"
                              style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                            >
                              {op.name}
                            </span>
                            <StatusBadge
                              tone="info"
                              label={op.kind === 'vault' ? 'ERC-4626 Vault' : 'AMM Pool'}
                              size="xs"
                              showIcon={false}
                            />
                            <StatusBadge
                              tone={riskTone}
                              label={`${op.riskLevel} Risk`}
                              size="xs"
                              showIcon={false}
                            />
                            {op.walletEligible && (
                              <StatusBadge
                                tone="success"
                                label={`Wallet Match${Array.isArray(op.matchedTokens) && op.matchedTokens.length > 0
                                    ? ` (${op.matchedTokens.join(', ')})`
                                    : ''
                                  }`}
                                size="xs"
                              />
                            )}
                            {op.paused && <StatusBadge tone="cancelled" label="Paused" size="xs" />}
                          </div>
                          <span className="text-[10px] font-mono text-white/50 block">
                            IL: {op.impermanentLossRisk}
                            {typeof op.feeTierPct === 'number' && op.feeTierPct > 0
                              ? ` · Swap Fee: ${op.feeTierPct}%`
                              : ''}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono tabular-nums">
                        <span className="text-white/70">
                          TVL:{' '}
                          <strong
                            className="text-white"
                            style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                          >
                            {typeof op.tvlUsd === 'number'
                              ? `$${op.tvlUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'}
                          </strong>
                        </span>
                        {op.kind === 'lp_pool' && (
                          <span className="text-white/70">
                            24h Vol:{' '}
                            <strong
                              className="text-white"
                              style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                            >
                              {typeof op.volume24hUsd === 'number'
                                ? `$${op.volume24hUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : '—'}
                            </strong>
                          </span>
                        )}
                        {typeof op.feeRunRateAnnualizedPct === 'number' && (
                          <span className="font-bold" style={{ color: STATUS_TONES.success.fg }}>
                            24h Fee Run-Rate: {op.feeRunRateAnnualizedPct.toFixed(2)}%
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Bridge & Gateway Rail Comparison (USDC, EURC, wETH, cirBTC) */}
          {bridgeRailQuote && (
            <div className="ai-section-card">
              <SectionHeader
                title="Bridge & Gateway Rail Comparison"
                eyebrow="Cross-Chain Quote"
                icon={Compass}
                tone="info"
                rightSlot={
                  onNavigateTab && bridgeRailQuote.recommendedRail ? (
                    <button
                      type="button"
                      onClick={() => {
                        soundService.play('pop')
                        onNavigateTab(bridgeRailQuote.recommendedRail === 'gateway' ? 'unified' : 'bridge')
                      }}
                      className="ai-focus-ring inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-semibold text-white cursor-pointer transition hover:brightness-110"
                      style={{
                        background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                        boxShadow: '0 4px 16px rgba(152, 150, 255, 0.25)',
                      }}
                    >
                      <span>
                        {bridgeRailQuote.recommendedRail === 'gateway' ? 'Open Unified Balance' : 'Open Bridge'}
                      </span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  ) : undefined
                }
              />

              <div className="p-4 space-y-3.5">
                {/* Asset & Route Visual Bar */}
                <div
                  className="flex flex-wrap items-center gap-2.5 p-2.5 rounded-xl border border-white/[0.06]"
                  style={{ backgroundColor: 'rgba(8, 10, 18, 0.65)' }}
                >
                  <InlineTokenChip symbol={bridgeRailQuote.token} />
                  <span className="text-white/30 text-xs">·</span>
                  <ChainPill chainKey="Arc_Testnet" label="Arc Testnet" />
                  <ArrowRight className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)] shrink-0" />
                  <ChainPill chainKey={bridgeRailQuote.destinationChain} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Circle Gateway Rail */}
                  <div
                    className="p-3.5 rounded-xl border space-y-2"
                    style={
                      bridgeRailQuote.recommendedRail === 'gateway'
                        ? {
                          backgroundColor: STATUS_TONES.success.bg,
                          borderColor: STATUS_TONES.success.border,
                        }
                        : !bridgeRailQuote.gateway.available
                          ? {
                            backgroundColor: STATUS_TONES.info.bg,
                            borderColor: STATUS_TONES.info.border,
                          }
                          : {
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            borderColor: 'rgba(255, 255, 255, 0.07)',
                          }
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="text-sm font-bold text-white"
                        style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                      >
                        Circle Gateway
                      </span>
                      {bridgeRailQuote.recommendedRail === 'gateway' ? (
                        <StatusBadge tone="success" label="Recommended" size="xs" />
                      ) : !bridgeRailQuote.gateway.available ? (
                        <StatusBadge tone="info" label="Not Eligible" size="xs" showIcon={false} />
                      ) : null}
                    </div>
                    {bridgeRailQuote.gateway.available ? (
                      <div className="text-[11px] font-mono text-white/75 space-y-1 tabular-nums">
                        <div className="inline-flex items-center gap-1.5">
                          <span>Total Cost:</span>
                          <PortfolioAssetIcon symbol="USDC" size={13} className="w-3.5 h-3.5 object-contain" />
                          <strong className="text-white">${bridgeRailQuote.gateway.totalCostUsdc} USDC</strong>
                        </div>
                        <div className="text-white/50">
                          Transfer fee: {bridgeRailQuote.gateway.feeBps} bps · Source gas: $0
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] font-mono text-white/55">{bridgeRailQuote.gateway.feeSource}</p>
                    )}
                  </div>

                  {/* CCTP v2 / CCTP-X Rail */}
                  <div
                    className="p-3.5 rounded-xl border space-y-2"
                    style={
                      bridgeRailQuote.recommendedRail === 'cctp' ||
                        bridgeRailQuote.recommendedRail === 'cctpx'
                        ? {
                          backgroundColor: STATUS_TONES.success.bg,
                          borderColor: STATUS_TONES.success.border,
                        }
                        : !bridgeRailQuote.cctp.available
                          ? {
                            backgroundColor: STATUS_TONES.cancelled.bg,
                            borderColor: STATUS_TONES.cancelled.border,
                          }
                          : {
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            borderColor: 'rgba(255, 255, 255, 0.07)',
                          }
                    }
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="text-sm font-bold text-white"
                        style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                      >
                        {bridgeRailQuote.cctp.mechanism === 'cctpx' ? 'Circle CCTP-X' : 'Circle CCTP v2'}
                      </span>
                      {bridgeRailQuote.recommendedRail === 'cctp' ||
                        bridgeRailQuote.recommendedRail === 'cctpx' ? (
                        <StatusBadge tone="success" label="Recommended" size="xs" />
                      ) : !bridgeRailQuote.cctp.available ? (
                        <StatusBadge tone="cancelled" label="Unavailable" size="xs" showIcon={false} />
                      ) : null}
                    </div>
                    {bridgeRailQuote.cctp.available ? (
                      <div className="text-[11px] font-mono text-white/75 space-y-1 tabular-nums">
                        <div className="inline-flex items-center gap-1.5">
                          <span>Total Cost:</span>
                          <PortfolioAssetIcon symbol="USDC" size={13} className="w-3.5 h-3.5 object-contain" />
                          <strong className="text-white">
                            {typeof bridgeRailQuote.cctp.totalCostUsdc === 'number'
                              ? `$${bridgeRailQuote.cctp.totalCostUsdc} USDC`
                              : `$${bridgeRailQuote.cctp.feeUsdc} USDC + gas`}
                          </strong>
                        </div>
                        <div className="text-white/50">
                          {bridgeRailQuote.cctp.recipientReceivesFullAmount
                            ? `Relayer fee: $${bridgeRailQuote.cctp.feeUsdc} USDC (0 token haircut — recipient receives 100%)`
                            : `Protocol + Forward: $${bridgeRailQuote.cctp.feeUsdc} USDC · Arc gas: $${bridgeRailQuote.cctp.sourceGasUsdc ?? '—'}`}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] font-mono text-white/55">{bridgeRailQuote.cctp.feeSource}</p>
                    )}
                  </div>
                </div>

                {bridgeRailQuote.supportedDestinations.length > 0 && !bridgeRailQuote.recommendedRail && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] font-mono text-white/60">
                    <span>Supported destinations for {bridgeRailQuote.token}:</span>
                    {bridgeRailQuote.supportedDestinations.map((dest) => (
                      <ChainPill key={dest} chainKey={dest} size={13} className="py-0.5 px-2 text-[10px]" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Best route (arbitrage sentinel) */}
          {bestRoute && (
            <div className="ai-section-card">
              <SectionHeader
                title="Best Spread Route"
                eyebrow="Oracle Benchmark"
                icon={Zap}
                tone="success"
                rightSlot={
                  typeof bestRoute.pair === 'string' ? (
                    <div className="inline-flex items-center gap-2">
                      <TokenPairIcons symbols={extractTokenSymbols(bestRoute.pair, 2)} size={15} />
                      <span className="text-xs font-mono font-bold text-white">{bestRoute.pair}</span>
                    </div>
                  ) : undefined
                }
              />
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl bg-white/[0.025] border border-white/[0.07] space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--secondary-colors--sky-sync)] block">
                      Buy Venue
                    </span>
                    <div
                      className="text-sm font-bold text-white"
                      style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                    >
                      {typeof bestRoute.buyDex === 'string' ? bestRoute.buyDex : 'Unavailable'}
                    </div>
                    <div className="text-xs font-mono text-white/80 tabular-nums inline-flex items-center gap-1.5">
                      <PortfolioAssetIcon symbol="USDC" size={13} className="w-3.5 h-3.5 object-contain" />
                      <span>{typeof bestRoute.buyPriceUsdc === 'number' ? `${bestRoute.buyPriceUsdc} USDC` : '—'}</span>
                    </div>
                  </div>
                  <div className="p-3.5 rounded-xl bg-white/[0.025] border border-white/[0.07] space-y-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--secondary-colors--sky-sync)] block">
                      Sell Reference
                    </span>
                    <div
                      className="text-sm font-bold text-white"
                      style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                    >
                      {typeof bestRoute.sellDex === 'string' ? bestRoute.sellDex : 'Unavailable'}
                    </div>
                    <div className="text-xs font-mono text-white/80 tabular-nums inline-flex items-center gap-1.5">
                      <PortfolioAssetIcon symbol="USDC" size={13} className="w-3.5 h-3.5 object-contain" />
                      <span>{typeof bestRoute.sellPriceUsdc === 'number' ? `${bestRoute.sellPriceUsdc} USDC` : '—'}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] font-mono text-white/65">
                  {typeof bestRoute.grossSpreadPct === 'number' && (
                    <span>
                      Spread: <strong className="text-white tabular-nums">{bestRoute.grossSpreadPct}%</strong>
                    </span>
                  )}
                  {typeof bestRoute.netProfitUsdc === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      Net:
                      <PortfolioAssetIcon symbol="USDC" size={12} className="w-3 h-3 object-contain" />
                      <strong className="tabular-nums" style={{ color: STATUS_TONES.success.fg }}>
                        {bestRoute.netProfitUsdc} USDC
                      </strong>
                    </span>
                  )}
                  {typeof bestRoute.estimatedGasCostUsdc === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      Gas:
                      <PortfolioAssetIcon symbol="USDC" size={12} className="w-3 h-3 object-contain" />
                      <strong className="text-white tabular-nums">{bestRoute.estimatedGasCostUsdc} USDC</strong>
                    </span>
                  )}
                </div>
                <p className="text-[10px] font-mono text-white/45 leading-relaxed">
                  Analysis only. The sell side is an external price reference, not a second DEX venue, and no trade is executed.
                </p>
              </div>
            </div>
          )}

          {/* Recommended MEV shield action (advisory only) */}
          {shieldAction && (
            <div className="ai-section-card">
              <SectionHeader
                title="Recommended Shield Action"
                eyebrow="Advisory Only"
                icon={Shield}
                tone="info"
                compact
              />
              <div className="p-4 space-y-2">
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono text-white/70">
                  {typeof shieldAction.adjustedMaxSlippagePct === 'number' && (
                    <span>
                      Max slippage: <strong className="text-white tabular-nums">{shieldAction.adjustedMaxSlippagePct}%</strong>
                    </span>
                  )}
                  {typeof shieldAction.estimatedGasCostUsdc === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      Est. gas:
                      <PortfolioAssetIcon symbol="USDC" size={12} className="w-3 h-3 object-contain" />
                      <strong className="text-white tabular-nums">{shieldAction.estimatedGasCostUsdc} USDC</strong>
                    </span>
                  )}
                  {typeof shieldAction.bundleType === 'string' && <span>{shieldAction.bundleType}</span>}
                </div>
                <p className="text-[10px] font-mono text-white/45 leading-relaxed">
                  No private relay, bundle or transaction protection is submitted by this service.
                </p>
              </div>
            </div>
          )}

          {/* Unavailable measurements and the reason they are missing */}
          {(unavailableList.length > 0 || reason) && (() => {
            const unavailTone = status === 'UNAVAILABLE' ? STATUS_TONES.error : STATUS_TONES.cancelled
            return (
              <div
                className="rounded-2xl border overflow-hidden"
                style={{
                  backgroundColor: unavailTone.bg,
                  borderColor: unavailTone.border,
                }}
              >
                <SectionHeader
                  title="Unavailable Measurements"
                  eyebrow="Coverage Notice"
                  icon={AlertCircle}
                  tone={status === 'UNAVAILABLE' ? 'error' : 'cancelled'}
                  compact
                />
                <div className="p-4 space-y-2.5">
                  {unavailableList.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {unavailableList.map((item) => (
                        <span
                          key={item}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-mono border"
                          style={{
                            borderColor: unavailTone.pillBorder,
                            color: unavailTone.fg,
                            backgroundColor: unavailTone.pillBg,
                          }}
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                  {reason && (
                    <p
                      className="text-[11px] font-mono leading-relaxed"
                      style={{ color: unavailTone.fg }}
                    >
                      {reason}
                    </p>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Active Arc DeFi Positions (Vault & LP Pools with Pending Fees) */}
          {(defiLpPositions.length > 0 || defiVaultSummary?.hasPosition) && (
            <div className="ai-section-card">
              <SectionHeader
                title="Arc DeFi Positions"
                eyebrow="Vault + LP Fees"
                icon={Layers}
                tone="pending"
              />
              <div className="p-3.5 space-y-2.5 max-h-72 overflow-y-auto">
                {defiVaultSummary?.hasPosition && (
                  <div
                    className="p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3"
                    style={{
                      backgroundColor: STATUS_TONES.pending.bg,
                      borderColor: STATUS_TONES.pending.border,
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <TokenIconBadge symbol="USDC" size={20} />
                      <div>
                        <span
                          className="text-sm font-bold text-white block"
                          style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                        >
                          USDC Yield Vault (ERC-4626)
                        </span>
                        <span className="text-[10px] font-mono text-white/50 block">
                          Shares: {defiVaultSummary.shares}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-[14px] font-mono tabular-nums">
                      <span className="text-white/75">
                        {' '}
                        <strong
                          className="text-white"
                          style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                        >
                          {typeof defiVaultSummary.currentValueUsdc === 'number'
                            ? `$${defiVaultSummary.currentValueUsdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : '—'}
                        </strong>
                      </span>
                      {typeof defiVaultSummary.pendingYieldUsdc === 'number' && defiVaultSummary.pendingYieldUsdc > 0 && (
                        <span className="font-bold" style={{ color: STATUS_TONES.success.fg }}>
                          Pending Yield: +${defiVaultSummary.pendingYieldUsdc.toFixed(4)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {defiLpPositions.map((lp: any) => {
                  const lpSymbols = [lp.tokenA, lp.tokenB].filter(Boolean)
                  return (
                    <div
                      key={lp.poolId || lp.poolName}
                      className="p-3.5 rounded-xl bg-white/[0.025] border border-white/[0.07] flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <TokenPairIcons
                          symbols={lpSymbols.length > 0 ? lpSymbols : extractTokenSymbols(lp.poolName, 2)}
                          size={18}
                        />
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-sm font-bold text-white"
                              style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                            >
                              {lp.poolName}
                            </span>
                            {typeof lp.poolSharePct === 'number' && lp.poolSharePct > 0 && (
                              <StatusBadge
                                tone="info"
                                label={`${lp.poolSharePct.toFixed(2)}%`}
                                size="xs"
                                showIcon={false}
                              />
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-white/50 block mt-0.5 tabular-nums">
                            {lp.amountA ?? '—'} {lp.tokenA} + {lp.amountB ?? '—'} {lp.tokenB} · IL: {lp.impermanentLossRisk}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-[14px] font-mono tabular-nums">
                        <span className="text-white/75">
                          {' '}
                          <strong
                            className="text-white"
                            style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                          >
                            {typeof lp.valueUsd === 'number'
                              ? `$${lp.valueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'}
                          </strong>
                        </span>
                        {typeof lp.pendingFeesUsd === 'number' && lp.pendingFeesUsd > 0 && (
                          <span className="font-bold" style={{ color: STATUS_TONES.success.fg }}>
                            Pending Fees: +${lp.pendingFeesUsd.toFixed(4)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Side-by-Side: Portfolio Assets & Chain Exposure */}
          {(holdings.length > 0 || chainExposure.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
              {/* Left Column: Holdings Breakdown Table */}
              {holdings.length > 0 && (
                <div className="ai-section-card flex flex-col h-full">
                  <SectionHeader
                    title="Portfolio Assets"
                    eyebrow="On-Chain Holdings"
                    icon={Coins}
                    tone="info"
                    compact
                  />
                  <div className="p-3 max-h-72 overflow-y-auto flex-1 flex flex-col gap-2">
                    {holdings.map((h, i) => {
                      const symbol = h.symbol || 'ASSET'
                      const formattedBalance = typeof h.balance === 'number'
                        ? h.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })
                        : h.balance
                      const formattedUsd = typeof h.valueUsd === 'number'
                        ? `≈ $${h.valueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : h.valueUsd !== null && h.valueUsd !== undefined
                          ? `≈ $${h.valueUsd}`
                          : null

                      return (
                        <div
                          key={i}
                          className="p-2.5 rounded-xl bg-white/[0.025] hover:bg-white/[0.05] border border-white/[0.06] hover:border-white/15 transition-all flex items-center justify-between gap-3 group"
                        >
                          {/* Left: Token Icon & Symbol */}
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl p-1 bg-white/[0.04] border border-white/[0.08] group-hover:scale-105 transition-transform overflow-hidden shadow-inner">
                              <PortfolioAssetIcon symbol={symbol} size={24} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="text-sm font-bold text-white tracking-tight"
                                  style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                                >
                                  {symbol}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Right: Balance & USD Value */}
                          <div className="text-right shrink-0 pl-2">
                            <div
                              className="text-sm font-bold text-white tracking-tight tabular-nums"
                              style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                            >
                              {formattedBalance}{' '}
                              <span className="text-[11px] font-mono text-white/45">{symbol}</span>
                            </div>
                            {formattedUsd && (
                              <div
                                className="text-[11px] font-mono mt-0.5 tabular-nums"
                                style={{ color: 'var(--fp-4)' }}
                              >
                                {formattedUsd}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Right Column: Chain Exposure Matrix */}
              {chainExposure.length > 0 && (
                <div className="ai-section-card flex flex-col h-full">
                  <SectionHeader
                    title="Chain Exposure"
                    eyebrow="Network Breakdown"
                    icon={Compass}
                    tone="info"
                    compact
                  />
                  <div className="p-3 max-h-72 overflow-y-auto flex-1 flex flex-col gap-2">
                    {chainExposure.map((c, i) => {
                      const chainKey = String(c.chain || 'Network')
                      const displayName = getChainDisplayName(chainKey) || chainKey.replace(/_/g, ' ')
                      return (
                        <div
                          key={i}
                          className="p-2.5 rounded-xl bg-white/[0.025] hover:bg-white/[0.05] border border-white/[0.06] hover:border-white/15 transition-all flex items-center justify-between gap-2.5 group"
                        >
                          {/* Left: Chain Icon & Name */}
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden group-hover:scale-105 transition-transform shadow-inner">
                              <ChainIcon chainKeyOrIconId={chainKey} size={24} />
                            </div>
                            <div className="min-w-0">
                              <div
                                className="text-sm font-semibold text-white truncate"
                                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                                title={displayName}
                              >
                                {displayName}
                              </div>
                            </div>
                          </div>

                          {/* Right: Value in USD */}
                          <div className="text-right shrink-0">
                            <div
                              className="text-sm font-bold text-white tabular-nums"
                              style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                            >
                              {typeof c.valueUsd === 'number'
                                ? `$${c.valueUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : c.valueUsd !== null && c.valueUsd !== undefined
                                  ? `$${c.valueUsd}`
                                  : '—'}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Analyst narrative (llm services): executive intelligence card */}
          {(narrativeHeadline || narrativeObservations.length > 0 || narrativeRisks.length > 0) && (
            <div
              className="ai-section-card"
              style={{
                borderColor: STATUS_TONES.pending.border,
              }}
            >
              <SectionHeader
                title="Analyst Narrative"
                eyebrow="AI Executive Brief"
                icon={Sparkles}
                tone="pending"
              />
              <div className="p-5 space-y-4">
                {narrativeHeadline && (
                  <h4
                    className="text-lg sm:text-xl font-bold text-white leading-snug tracking-tight"
                    style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                  >
                    {narrativeHeadline}
                  </h4>
                )}

                {narrativeObservations.length > 0 && (
                  <div className="space-y-2">
                    {narrativeObservations.map((observation, i) => (
                      <div key={`observation-${i}`} className="flex items-start gap-2.5 text-xs text-white/90 leading-relaxed">
                        <div
                          className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                          style={{
                            backgroundColor: STATUS_TONES.info.accent,
                            boxShadow: '0 0 8px rgba(172, 198, 233, 0.7)',
                          }}
                        />
                        <p>{observation}</p>
                      </div>
                    ))}
                  </div>
                )}

                {narrativeRisks.length > 0 && (
                  <div
                    className="p-3.5 rounded-xl border space-y-2"
                    style={{
                      backgroundColor: STATUS_TONES.cancelled.bg,
                      borderColor: STATUS_TONES.cancelled.border,
                    }}
                  >
                    <span
                      className="text-[10px] font-mono uppercase tracking-[1.5px] font-bold block"
                      style={{ color: STATUS_TONES.cancelled.accent }}
                    >
                      RISKS &amp; ADVISORIES
                    </span>
                    <ul className="space-y-1.5 text-xs text-white/90">
                      {narrativeRisks.map((risk, i) => (
                        <li key={`risk-${i}`} className="leading-relaxed flex items-start gap-2">
                          <AlertCircle
                            className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                            style={{ color: STATUS_TONES.cancelled.accent }}
                          />
                          <span>{risk}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Available Routes */}
          {routes.length > 0 && (
            <div className="ai-section-card">
              <SectionHeader
                title="Gateway Routes"
                eyebrow="Cross-Chain Rails"
                icon={Compass}
                tone="info"
                count={routes.length}
                compact
              />
              <div className="p-3.5 space-y-2">
                {routes.map((r, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-white/[0.025] border border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <ChainPill chainKey={String(r.sourceChain || 'Arc_Testnet')} />
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)]" />
                      <ChainPill chainKey={String(r.targetChain || 'Base_Sepolia')} />
                    </div>
                    {r.estimatedFee && (
                      <span
                        className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold tabular-nums"
                        style={{ color: STATUS_TONES.success.fg }}
                      >
                        <PortfolioAssetIcon symbol="USDC" size={12} className="w-3 h-3 object-contain" />
                        <span>Fee: {r.estimatedFee} USDC</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Narrative Recommendations */}
          {recommendations.length > 0 && (
            <div className="ai-section-card">
              <SectionHeader
                title="AI Recommendations"
                eyebrow="Advisory Guidance"
                icon={Sparkles}
                tone="info"
                count={recommendations.length}
                compact
              />
              <ul className="p-4 space-y-2 text-xs text-white/85">
                {recommendations.map((rec, i) => (
                  <li key={i} className="leading-relaxed flex items-start gap-2">
                    <ArrowRight
                      className="w-3.5 h-3.5 mt-0.5 shrink-0"
                      style={{ color: STATUS_TONES.info.accent }}
                    />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Graded risk register: Human-Centric Actionable Diagnoses */}
          {riskRegister.length > 0 && (
            <div className="ai-section-card">
              <SectionHeader
                title={`Risk Register`}
                icon={ShieldAlert}
                tone={resolveRiskSeverityTone(reportSummary?.highestSeverity)}
                rightSlot={
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const)
                      .filter((severity) => (reportSummary?.counts?.[severity] ?? 0) > 0)
                      .map((severity) => (
                        <StatusBadge
                          key={severity}
                          tone={resolveRiskSeverityTone(severity)}
                          label={`${severity} ${reportSummary.counts[severity]}`}
                          size="xs"
                          showIcon={false}
                        />
                      ))}
                  </div>
                }
              />

              <div className="p-4 space-y-3">
                {riskRegister.map((entry, index) => (
                  <RiskRegisterCard
                    key={`${String(entry?.id ?? 'risk')}-${index}`}
                    entry={entry}
                    index={index}
                    onNavigateTab={onNavigateTab}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Protocol Risk Warnings — only for services without a graded register */}
          {riskFlags.length > 0 && riskRegister.length === 0 && (
            <div
              className="p-4 rounded-2xl border flex items-start gap-3 transition-all"
              style={{
                backgroundColor: STATUS_TONES.cancelled.bg,
                borderColor: STATUS_TONES.cancelled.border,
                boxShadow: `0 6px 20px -6px ${STATUS_TONES.cancelled.glow}`,
              }}
            >
              <div
                className="shrink-0 w-9 h-9 rounded-xl border flex items-center justify-center"
                style={{
                  backgroundColor: STATUS_TONES.cancelled.pillBg,
                  borderColor: STATUS_TONES.cancelled.pillBorder,
                  color: STATUS_TONES.cancelled.accent,
                }}
              >
                <AlertCircle className="w-4 h-4 stroke-[2.2]" />
              </div>
              <div className="space-y-2 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="text-sm font-bold tracking-tight"
                    style={{
                      fontFamily: 'var(--font-display, Outfit, sans-serif)',
                      color: STATUS_TONES.cancelled.fg,
                    }}
                  >
                    Protocol Risk Flags
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {riskFlags.map((flag) => (
                    <StatusBadge
                      key={flag}
                      tone="cancelled"
                      label={flag.replace(/_/g, ' ')}
                      size="sm"
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * A voided paid call is not one failure: user cancellations and uncharged voids use Blockstream Gold
 * (Cancelled), wallet scope messages use Sky Sync (Info), and hard failures use Obsidian Crimson (Error).
 */
function ServiceFailureBanner({ result }: { result: x402ExecutionResult }) {
  const diagnosis = diagnoseX402Failure(result)
  const presentation = resolveFailurePresentation(diagnosis, result)
  const toneStyle = getStatusToneStyle(presentation.tone)
  const HeadingIcon =
    presentation.tone === 'cancelled'
      ? Ban
      : presentation.tone === 'info'
        ? Info
        : AlertCircle

  return (
    <div
      className="p-4 sm:p-5 rounded-2xl border text-xs flex items-start gap-3.5 animate-fade-in"
      style={{
        backgroundColor: toneStyle.bg,
        borderColor: toneStyle.border,
        borderLeftWidth: '3px',
        borderLeftColor: toneStyle.accent,
        boxShadow: `0 8px 24px -8px ${toneStyle.glow}`,
      }}
    >
      <div
        className="w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 mt-0.5"
        style={{
          backgroundColor: toneStyle.pillBg,
          borderColor: toneStyle.pillBorder,
          color: toneStyle.accent,
        }}
      >
        <HeadingIcon className="w-4 h-4" />
      </div>
      <div className="space-y-2 min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4
            className="text-sm sm:text-base font-bold text-white tracking-tight"
            style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
          >
            {diagnosis?.title ?? presentation.defaultTitle}
          </h4>
          <StatusBadge tone={presentation.tone} label={presentation.badgeLabel} size="xs" />
        </div>
        {diagnosis?.detail && (
          <p className="text-xs leading-relaxed" style={{ color: toneStyle.fg }}>
            {diagnosis.detail}
          </p>
        )}
        {diagnosis && diagnosis.reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {diagnosis.reasons.map((item) => (
              <span
                key={item}
                className="px-2.5 py-0.5 rounded-lg text-[10px] font-mono border"
                style={{
                  borderColor: toneStyle.pillBorder,
                  color: toneStyle.fg,
                  backgroundColor: toneStyle.pillBg,
                }}
              >
                {item}
              </span>
            ))}
          </div>
        )}
        {diagnosis?.action && (
          <p
            className="font-mono text-[11px] leading-relaxed"
            style={{ color: 'var(--fp-3)' }}
          >
            {diagnosis.action}
          </p>
        )}
        {result.error && result.error !== diagnosis?.detail && (
          <p
            className="font-mono text-[10px] leading-relaxed break-words opacity-75"
            style={{ color: toneStyle.fg }}
          >
            {result.error}
          </p>
        )}
      </div>
    </div>
  )
}

export default function ServicePlaygroundModal({
  isOpen,
  onClose,
  service,
  initialPayload,
  isExecuting,
  executionResult,
  onExecute,
  walletAddress,
  authSource,
  ucwSignerAvailable,
  ucwHandlers,
  onNavigateTab,
}: ServicePlaygroundModalProps) {
  // Step state for Linear Command flow: 'configure' | 'executing' | 'result'
  const [userWantsConfigure, setUserWantsConfigure] = useState<boolean>(false)
  const [outputViewMode, setOutputViewMode] = useState<'visual' | 'raw'>('visual')
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Session key authority for autonomous agent spending limits (scoped to 'marketplace')
  const [sessionConfig, setSessionConfig] = useState<SessionKeyConfig>(() =>
    getSessionKeyConfig(walletAddress, 'marketplace')
  )

  // Standard body scroll lock
  useBodyScrollLock(isOpen)
  useEffect(() => {
    const syncSessionConfig = (e?: any) => {
      if (e?.detail && e.detail.scope && e.detail.scope !== 'marketplace') return
      setSessionConfig(getSessionKeyConfig(walletAddress, 'marketplace'))
    }
    syncSessionConfig()
    window.addEventListener(MARKETPLACE_SESSION_UPDATED_EVENT, syncSessionConfig)
    window.addEventListener(SESSION_KEY_UPDATED_EVENT, syncSessionConfig)
    return () => {
      window.removeEventListener(MARKETPLACE_SESSION_UPDATED_EVENT, syncSessionConfig)
      window.removeEventListener(SESSION_KEY_UPDATED_EVENT, syncSessionConfig)
    }
  }, [walletAddress])

  const sessionIsActive = sessionConfig.isActive && Date.now() <= sessionConfig.expiresAt
  const remainingSessionUsdc = Math.max(0, sessionConfig.maxSpendUsdc - (sessionConfig.spentUsdc || 0))

  // Detect wallet-cancelled x402 settlement so we stay in the compact Settlement screen
  // instead of opening an empty Report screen.
  const isWalletCanceledSettlement = Boolean(
    !isExecuting &&
    executionResult &&
    !executionResult.success &&
    !userWantsConfigure &&
    (isUserCanceledMessage(executionResult.error) ||
      isUserCanceledMessage(diagnoseX402Failure(executionResult)?.detail))
  )

  // Derive current step
  const currentStep = isExecuting
    ? 'executing'
    : isWalletCanceledSettlement
      ? 'canceled'
      : executionResult && !userWantsConfigure
        ? 'result'
        : 'configure'

  const supportedNetworks = useMemo(() => {
    const list = [...DEFAULT_GATEWAY_NETWORKS]
    if (service?.accepts) {
      for (const acc of service.accepts) {
        const net = acc.network
        if (!net) continue
        const cleanNet = net.toLowerCase().replace(/[\s_-]+/g, '')
        const alreadyExists = list.some((item) => {
          const cleanId = item.id.toLowerCase().replace(/[\s_-]+/g, '')
          const cleanName = item.name.toLowerCase().replace(/[\s_-]+/g, '')
          const cleanFull = item.fullName.toLowerCase().replace(/[\s_-]+/g, '')
          return (
            cleanNet === cleanId ||
            cleanNet === cleanName ||
            cleanNet === cleanFull ||
            (cleanNet.includes('arc') && (cleanId.includes('arc') || cleanName.includes('arc'))) ||
            (cleanNet.includes('5042002') && cleanId.includes('arc')) ||
            (cleanNet.includes('base') && (cleanId.includes('base') || cleanName.includes('base'))) ||
            (cleanNet.includes('84532') && cleanId.includes('base')) ||
            (cleanNet.includes('eth') && (cleanId.includes('eth') || cleanName.includes('eth'))) ||
            (cleanNet.includes('11155111') && cleanId.includes('eth')) ||
            (cleanNet.includes('arbitrum') && (cleanId.includes('arbitrum') || cleanName.includes('arbitrum'))) ||
            (cleanNet.includes('polygon') && (cleanId.includes('polygon') || cleanName.includes('polygon'))) ||
            (cleanNet.includes('solana') && (cleanId.includes('solana') || cleanName.includes('solana')))
          )
        })
        if (!alreadyExists) {
          const iconId = getChainIconId(net)
          const fullName = getChainDisplayName(net) || net
          list.push({
            id: net,
            name: fullName.split(' ')[0] || net,
            fullName,
            iconId,
            isArc: iconId === 'arc' || cleanNet.includes('arc'),
            isNative: false,
            role: 'Accepted Network',
          })
        }
      }
    }
    return list
  }, [service?.accepts])

  // Clear inputs on wallet disconnect
  useClearOnWalletDisconnect(() => {
    setFormData({})
  })

  // Keyboard accessibility: ESC key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  // Initialize form data cleanly whenever the service, active wallet, or recommendation payload changes.
  // Never leaks field values across different services and never leaves the zero-address placeholder when a wallet is connected.
  const lastServiceIdRef = useRef<string | null>(null)
  const lastWalletRef = useRef<string | undefined>(walletAddress)
  useEffect(() => {
    if (service) {
      const serviceChanged = lastServiceIdRef.current !== service.id
      const walletChanged = lastWalletRef.current !== walletAddress
      lastServiceIdRef.current = service.id
      lastWalletRef.current = walletAddress

      setFormData((prev) => {
        const next: Record<string, any> = {}
        const ZERO_ADDR = '0x0000000000000000000000000000000000000000'
        service.ui.form.forEach((param) => {
          const isAddressParam =
            param.name === 'address' ||
            param.name === 'walletAddress' ||
            param.label?.toLowerCase().includes('wallet address')

          if (isAddressParam) {
            const currentVal = serviceChanged ? undefined : prev[param.name]
            if (walletAddress) {
              if (
                walletChanged ||
                !currentVal ||
                currentVal === ZERO_ADDR ||
                currentVal === param.defaultValue
              ) {
                next[param.name] = walletAddress
                return
              }
              next[param.name] = currentVal
              return
            }
            // Disconnected: avoid showing the dead zero address as a prefilled input
            const fallback = param.defaultValue === ZERO_ADDR ? '' : param.defaultValue
            next[param.name] = currentVal !== undefined && currentVal !== ZERO_ADDR ? currentVal : fallback
            return
          }

          next[param.name] =
            !serviceChanged && prev[param.name] !== undefined ? prev[param.name] : param.defaultValue
        })

        // A shelf recommendation supplies the inputs it was derived for (the parameter a re-run
        // must change, for example). Only declared form fields are accepted, so an unknown key can
        // never reach a paid request.
        if (initialPayload) {
          for (const [key, value] of Object.entries(initialPayload)) {
            if (Object.prototype.hasOwnProperty.call(next, key)) next[key] = value
          }
        }

        return next
      })
      setUserWantsConfigure(false)
    }
  }, [service, walletAddress, initialPayload])

  // Live telemetry
  const [liveTelemetry, setLiveTelemetry] = useState<ServiceTelemetryData | null>(null)

  useEffect(() => {
    if (!service) {
      setLiveTelemetry(null)
      return
    }

    setLiveTelemetry(
      serviceTelemetryService.getOrCreateServiceTelemetry(
        service.id,
        service.sla.p95LatencyMs,
        service.sla.successRate
      )
    )

    const unsubscribe = serviceTelemetryService.subscribe((map) => {
      if (service && map[service.id]) {
        setLiveTelemetry(map[service.id])
      }
    })

    return () => unsubscribe()
  }, [service])

  const telemetry: ServiceTelemetryData | null =
    liveTelemetry ??
    (service
      ? serviceTelemetryService.getOrCreateServiceTelemetry(
        service.id,
        service.sla.p95LatencyMs,
        service.sla.successRate
      )
      : null)

  // Readiness signals
  const { currentChainId, switchToArc, isSwitching } = useChainSwitch()
  const gateway = useGatewayBalance(isOpen && service ? walletAddress || '' : '')
  const isTradeAdvisorService = service?.id === 'arc-deep-liquidity-slippage-optimizer'
  const { balances: arcSwapBalances } = useArcSwapTokenBalances(
    walletAddress,
    Boolean(isOpen && isTradeAdvisorService && walletAddress)
  )
  const {
    config: x402Config,
    loading: x402ConfigLoading,
    error: x402ConfigError,
  } = useX402Config(isOpen)

  const [faucetState, setFaucetState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [faucetMessage, setFaucetMessage] = useState<string | null>(null)

  const arcGatewayBalance = useMemo(() => {
    const row = gateway.balances.find((balance) => balance.chainKey === 'Arc_Testnet')
    if (row?.balance !== undefined) {
      const parsed = Number.parseFloat(row.balance)
      return Number.isFinite(parsed) ? parsed : null
    }
    return gateway.hasData ? 0 : null
  }, [gateway.balances, gateway.hasData])

  const readiness = useMemo(
    () =>
      evaluateX402Readiness({
        walletAddress,
        authSource,
        ucwSignerAvailable,
        chainId: currentChainId,
        gatewayBalanceUsdc: arcGatewayBalance,
        gatewayBalanceLoading: gateway.loading || gateway.isFetching,
        priceUsdc: service?.pricing.priceUsdc ?? 0,
        serviceId: service?.id,
        config: x402Config,
        configLoading: x402ConfigLoading,
        configError: Boolean(x402ConfigError),
      }),
    [
      walletAddress,
      authSource,
      ucwSignerAvailable,
      currentChainId,
      arcGatewayBalance,
      gateway.loading,
      gateway.isFetching,
      service?.pricing.priceUsdc,
      service?.id,
      x402Config,
      x402ConfigLoading,
      x402ConfigError,
    ]
  )

  const handleSwitchNetwork = async () => {
    soundService.play('pop')
    await switchToArc()
  }

  const handleRequestFaucet = async () => {
    if (!walletAddress) return
    soundService.play('pop')
    setFaucetState('sending')
    setFaucetMessage(null)
    try {
      const response = await fetch('/api/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: walletAddress, blockchain: 'ARC-TESTNET', usdc: true, native: true }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.success === false) {
        throw new Error(body?.error || `Faucet request failed (HTTP ${response.status}).`)
      }
      setFaucetState('sent')
      setFaucetMessage('Faucet sent! Next, deposit USDC into Circle Gateway.')
      void gateway.refresh()
    } catch (err: any) {
      setFaucetState('error')
      setFaucetMessage(err?.message || 'Faucet request failed.')
    }
  }

  const handleOpenGatewayDeposit = () => {
    soundService.play('pop')
    onClose()
    onNavigateTab?.('unified')
  }

  if (!isOpen || !service || !telemetry) return null

  const handleInputChange = (name: string, value: any) => {
    setFormData((prev) => {
      if (isTradeAdvisorService) {
        if (name === 'fromToken' && typeof value === 'string' && value === prev.toToken) {
          const fallbackTo =
            typeof prev.fromToken === 'string' && prev.fromToken !== value
              ? prev.fromToken
              : value === 'USDC'
                ? 'WETH'
                : 'USDC'
          return { ...prev, fromToken: value, toToken: fallbackTo }
        }
        if (name === 'toToken' && typeof value === 'string' && value === prev.fromToken) {
          const fallbackFrom =
            typeof prev.toToken === 'string' && prev.toToken !== value
              ? prev.toToken
              : value === 'USDC'
                ? 'WETH'
                : 'USDC'
          return { ...prev, fromToken: fallbackFrom, toToken: value }
        }
      }
      return { ...prev, [name]: value }
    })
  }

  const minSlippagePct = POOL_MIN_SLIPPAGE_BPS / 100
  const maxSlippagePct = POOL_MAX_SLIPPAGE_BPS / 100

  const selectedSellToken = isTradeAdvisorService
    ? String(formData.fromToken || 'USDC')
    : undefined
  const selectedSellBalance = isTradeAdvisorService
    ? resolveArcSwapTokenBalance(arcSwapBalances, selectedSellToken)
    : null
  const parsedTradeAmount = isTradeAdvisorService ? Number(formData.amount) : Number.NaN
  const exceedsArcWalletBalance =
    isTradeAdvisorService &&
    selectedSellBalance !== null &&
    Number.isFinite(parsedTradeAmount) &&
    parsedTradeAmount > 0 &&
    parsedTradeAmount > selectedSellBalance + 1e-9

  const formValidationError: string | null = (() => {
    if (!isTradeAdvisorService) return null
    const fromT = String(formData.fromToken || '').toUpperCase()
    const toT = String(formData.toToken || '').toUpperCase()
    if (fromT && toT && fromT === toT) {
      return `Sell Token and Buy Token must differ — you cannot swap ${formData.fromToken} for itself.`
    }
    const amt = formData.amount === '' ? Number.NaN : Number(formData.amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      return 'Enter a trade amount greater than 0 before running the advisor.'
    }
    if (formData.slippageTolerancePct !== '' && formData.slippageTolerancePct !== undefined) {
      const slip = Number(formData.slippageTolerancePct)
      if (!Number.isFinite(slip) || slip < minSlippagePct || slip > maxSlippagePct) {
        return `Max Slippage Tolerance must be between ${minSlippagePct}% and ${maxSlippagePct}% (Arc DEX bounds).`
      }
    }
    return null
  })()

  const handleRun = async () => {
    if (formValidationError) return
    soundService.play('pop')
    setUserWantsConfigure(false)
    setOutputViewMode('visual')
    const sanitizedPayload: Record<string, any> = { ...formData }
    for (const param of service.ui.form) {
      if (param.type === 'number') {
        const raw = sanitizedPayload[param.name]
        if (raw === '' || raw === undefined || raw === null) {
          if (param.required) {
            sanitizedPayload[param.name] = Number(param.defaultValue)
          } else {
            delete sanitizedPayload[param.name]
          }
        } else {
          sanitizedPayload[param.name] = Number(raw)
        }
      }
    }
    try {
      await onExecute(service, sanitizedPayload)
    } catch {
      // Execution errors handled in parent
    }
  }

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text)
    soundService.play('pop')
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  // Active displayed JSON in console
  const displayedJson = executionResult?.data || null

  const renderSelectOptionIcon = (paramName: string, optValue: string): React.ReactNode => {
    if (paramName.toLowerCase().includes('chain') || isKnownChain(optValue)) {
      return (
        <span className="w-5 h-5 rounded-full overflow-hidden inline-flex items-center justify-center shrink-0">
          <ChainIcon chainKeyOrIconId={optValue} size={20} />
        </span>
      )
    }
    const symbols = extractTokenSymbols(optValue, 2)
    if (symbols.length >= 2) {
      return <TokenPairIcons symbols={symbols} size={18} />
    }
    if (symbols.length === 1) {
      return <TokenIconBadge symbol={symbols[0]} size={20} />
    }
    return undefined
  }

  const serviceSymbols = getServiceTokenSymbols(service)

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 md:p-6 overflow-y-auto">
      {/* Dark Luxury Ambient Backdrop (Modal can only be closed via top-right 'X' button) */}
      <div className="fixed inset-0 bg-[#060810]/85 backdrop-blur-[28px] transition-all duration-300 animate-fade-in" />

      {/* Main Container: Linear Command Box */}
      <div
        className={`relative w-full rounded-[28px] overflow-hidden transition-all duration-300 my-auto flex flex-col max-h-[92vh] z-10 ${currentStep === 'result' ? 'max-w-3xl' : 'max-w-2xl'
          }`}
        style={{
          background: 'linear-gradient(145deg, rgba(16, 20, 36, 0.98) 0%, rgba(10, 13, 24, 0.99) 100%)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 32px 80px -16px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.04), 0 0 40px rgba(152, 150, 255, 0.12)',
        }}
      >
        {/* Top Gradient Hairline */}
        <div
          className="h-[2px] w-full"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, var(--purple-1) 35%, var(--secondary-colors--sky-sync) 70%, transparent 100%)',
          }}
        />

        {/* ── PERSISTENT COMMAND HEADER & LINEAR STEPPER ── */}
        <div
          className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between gap-4"
          style={{ background: 'rgba(15, 18, 32, 0.72)' }}
        >
          {/* Service Identity & Asset Icons */}
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="hidden sm:flex items-center shrink-0">
              <TokenPairIcons symbols={serviceSymbols} size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="arc-eyebrow text-[10px] text-[var(--secondary-colors--sky-sync)] font-semibold">
                  ARCIS AI // {getCategoryLabel(service.category)}
                </span>
              </div>
              <h2
                className="text-lg sm:text-xl font-bold text-white tracking-tight truncate mt-0.5"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                {service.name}
              </h2>
            </div>
          </div>

          {/* Right Controls: Price Per Call & Close */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            {/* Price Per Call Capsule */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-white/[0.04] select-none shadow-sm"
              title={`Service Fee: ${service.pricing.priceUsdc} USDC per autonomous call`}
            >
              <img src={UsdcIcon} alt="USDC" className="w-4 h-4 rounded-full flex-shrink-0" />
              <div className="flex items-baseline gap-1 font-mono">
                <span
                  className="text-xs sm:text-sm font-bold text-white tabular-nums"
                  style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                >
                  {service.pricing.priceUsdc}
                </span>
                <span className="text-[10px] text-[var(--secondary-colors--sky-sync)] font-semibold">
                  USDC
                </span>
                <span className="text-[10px] text-white/40 font-normal">/ call</span>
              </div>
            </div>

            <button
              onClick={() => {
                soundService.play('pop')
                onClose()
              }}
              aria-label="Close service playground"
              className="ai-focus-ring p-2 rounded-xl text-white/50 hover:text-white border border-white/10 hover:border-white/25 transition cursor-pointer flex items-center gap-1 group shadow-sm text-xs font-mono"
            >
              <X className="w-4 h-4 text-white/65 group-hover:text-white transition" />
            </button>
          </div>
        </div>

        {/* ── STEP 1: CONFIGURE PAYLOAD (FOCUSED & UNCLUTTERED) ── */}
        {currentStep === 'configure' && (
          <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 animate-fade-in w-full">
            <div className="space-y-1.5 text-left">
              <span className="arc-eyebrow text-[10px] block">Step 01 · Parameters</span>
              <h3
                className="text-xl sm:text-2xl font-bold text-white tracking-tight"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                Configure Analysis Parameters
              </h3>
              <p className="text-xs sm:text-sm font-sans leading-relaxed" style={{ color: 'var(--fp-3)' }}>
                {service.description}
              </p>
            </div>

            {/* Inputs Card */}
            <div
              className="p-5 sm:p-6 rounded-2xl border border-white/[0.08] space-y-4 shadow-sm"
              style={{ background: 'rgba(13, 16, 28, 0.65)' }}
            >
              {/* Form Parameter Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {service.ui.form.map((param) => {
                  const hasTokenPairFields =
                    service.ui.form.some((p) => p.name === 'fromToken') &&
                    service.ui.form.some((p) => p.name === 'toToken')
                  const isSideBySideTokenField =
                    hasTokenPairFields && (param.name === 'fromToken' || param.name === 'toToken')
                  const isAddressParam =
                    param.name === 'address' ||
                    param.name === 'walletAddress' ||
                    param.label?.toLowerCase().includes('wallet address')
                  const effectiveDefault = isAddressParam && walletAddress ? walletAddress : param.defaultValue
                  const currentValue = formData[param.name] ?? effectiveDefault
                  const numberTokenSymbol =
                    param.type === 'number'
                      ? /usdc/i.test(param.name) || /usdc/i.test(param.label || '')
                        ? 'USDC'
                        : param.name === 'amount' && typeof formData.fromToken === 'string'
                          ? formData.fromToken
                          : param.name === 'amountUsdc' && typeof formData.token === 'string'
                            ? formData.token
                            : null
                      : null

                  return (
                    <div
                      key={param.name}
                      className={`space-y-1.5 ${isSideBySideTokenField ? 'sm:col-span-1' : 'sm:col-span-2'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label
                          className="text-xs font-semibold text-white/95 block"
                          style={{ fontFamily: 'var(--font-app)' }}
                        >
                          {param.label}
                        </label>
                        {isAddressParam && walletAddress && formData[param.name] !== walletAddress && (
                          <button
                            type="button"
                            onClick={() => handleInputChange(param.name, walletAddress)}
                            className="text-[10px] text-[var(--purple-1)] hover:text-white font-mono cursor-pointer transition-colors flex items-center gap-1"
                          >
                            <span>Fill Connected Wallet</span>
                            <ArrowUpRight className="w-2.5 h-2.5" />
                          </button>
                        )}
                        {isTradeAdvisorService && param.name === 'amount' && selectedSellBalance !== null && selectedSellToken && (
                          <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums">
                            <span style={{ color: 'var(--fp-4)' }}>
                              Balance:{' '}
                              <strong className="text-white/85">
                                {selectedSellBalance.toLocaleString('en-US', {
                                  maximumFractionDigits: selectedSellBalance < 1 ? 6 : 4,
                                })}{' '}
                                {selectedSellToken}
                              </strong>
                            </span>
                            {selectedSellBalance > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  soundService.play('pop')
                                  const floored = Math.floor(selectedSellBalance * 1e6) / 1e6
                                  handleInputChange('amount', floored)
                                }}
                                className="px-1.5 py-0.5 rounded-md border text-[9px] font-bold uppercase tracking-wider cursor-pointer transition hover:brightness-125"
                                style={{
                                  backgroundColor: STATUS_TONES.pending.pillBg,
                                  borderColor: STATUS_TONES.pending.pillBorder,
                                  color: STATUS_TONES.pending.fg,
                                }}
                              >
                                Max
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {param.type === 'select' ? (
                        <MarketplaceSelect
                          value={String(currentValue)}
                          onChange={(val) => handleInputChange(param.name, val)}
                          options={(param.options || []).map((opt) => ({
                            value: String(opt.value),
                            label: opt.label,
                            leadingNode: renderSelectOptionIcon(param.name, String(opt.value)),
                          }))}
                          menuTitle={param.label}
                        />
                      ) : param.type === 'boolean' ? (
                        <MarketplaceSelect
                          value={currentValue === true ? 'true' : currentValue === false ? 'false' : String(param.defaultValue)}
                          onChange={(val) => handleInputChange(param.name, val === 'true')}
                          options={[
                            { value: 'true', label: 'Enabled' },
                            { value: 'false', label: 'Disabled' },
                          ]}
                          menuTitle={param.label}
                        />
                      ) : param.type === 'number' ? (() => {
                        const schemaProp = (service.requestSchema?.properties as Record<string, any> | undefined)?.[param.name]
                        const minVal = typeof schemaProp?.minimum === 'number' ? schemaProp.minimum : undefined
                        const maxVal = typeof schemaProp?.maximum === 'number' ? schemaProp.maximum : undefined
                        const stepVal = param.name === 'slippageTolerancePct' ? 0.1 : 'any'
                        return (
                          <div className="relative flex items-center">
                            {numberTokenSymbol && (
                              <span className="absolute left-3 inline-flex items-center pointer-events-none">
                                <PortfolioAssetIcon
                                  symbol={numberTokenSymbol}
                                  size={22}
                                  className="w-[22px] h-[22px] object-contain"
                                />
                              </span>
                            )}
                            <input
                              type="number"
                              min={minVal}
                              max={maxVal}
                              step={stepVal}
                              value={currentValue}
                              onChange={(e) => {
                                const raw = e.target.value
                                handleInputChange(param.name, raw === '' ? '' : Number(raw))
                              }}
                              className={`w-full ${numberTokenSymbol ? 'pl-11' : 'pl-3.5'} pr-3.5 py-2.5 rounded-xl border border-white/10 text-sm text-white focus:outline-none focus:border-[var(--purple-1)] focus:ring-1 focus:ring-[var(--purple-1)]/30 transition tabular-nums`}
                              style={{
                                background: 'rgba(9, 11, 20, 0.85)',
                                fontFamily: 'var(--fonts--space-grotesk)',
                              }}
                            />
                          </div>
                        )
                      })() : (
                        <input
                          type="text"
                          value={currentValue}
                          onChange={(e) => handleInputChange(param.name, e.target.value)}
                          placeholder={isAddressParam && walletAddress ? walletAddress : undefined}
                          className="w-full px-3.5 py-2.5 rounded-xl border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--purple-1)] focus:ring-1 focus:ring-[var(--purple-1)]/30 transition font-mono"
                          style={{ background: 'rgba(9, 11, 20, 0.85)' }}
                        />
                      )}

                      <p className="text-[11px] leading-normal" style={{ color: 'var(--fp-4)' }}>
                        {param.description}
                      </p>

                      {isTradeAdvisorService && param.name === 'amount' && exceedsArcWalletBalance && selectedSellBalance !== null && selectedSellToken && (
                        <div
                          className="px-3 py-2 rounded-xl border text-[11px] flex items-center gap-2"
                          style={{
                            backgroundColor: STATUS_TONES.info.bg,
                            borderColor: STATUS_TONES.info.border,
                            color: STATUS_TONES.info.fg,
                          }}
                        >
                          <Info className="w-3.5 h-3.5 shrink-0" style={{ color: STATUS_TONES.info.accent }} />
                          <span>
                            Order exceeds your Arc wallet balance ({selectedSellBalance.toLocaleString('en-US', { maximumFractionDigits: 4 })} {selectedSellToken}). You can still run this trade simulation, or fund before executing.
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Progressive Readiness / Warning Alert (DESIGN.md Cancelled/Warning or Error tone) */}
            {!readiness.ready && (() => {
              const blockedCheck = readiness.checks.find((c) => c.status === 'blocked')
              const isHardBlock = blockedCheck?.id === 'settlement'
              const alertTone = isHardBlock ? STATUS_TONES.error : STATUS_TONES.cancelled
              return (
                <div
                  className="p-3.5 rounded-xl border text-xs flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 animate-fade-in"
                  style={{
                    backgroundColor: alertTone.bg,
                    borderColor: alertTone.border,
                    color: alertTone.fg,
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AlertCircle
                      className="w-4 h-4 flex-shrink-0"
                      style={{ color: alertTone.accent }}
                    />
                    <span className="leading-relaxed">
                      {blockedCheck?.detail || 'Settlement gate action required.'}
                    </span>
                  </div>

                  {readiness.checks.some((c) => c.id === 'network' && c.status === 'blocked') && (
                    <button
                      onClick={() => void handleSwitchNetwork()}
                      disabled={isSwitching}
                      className="ai-focus-ring px-3 py-1.5 rounded-full border text-[11px] font-bold text-white cursor-pointer transition hover:brightness-110 flex-shrink-0"
                      style={{
                        backgroundColor: alertTone.pillBg,
                        borderColor: alertTone.pillBorder,
                      }}
                    >
                      {isSwitching ? 'Switching…' : 'Switch Network'}
                    </button>
                  )}

                  {readiness.checks.some((c) => c.id === 'gateway-balance' && c.status === 'blocked') && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => void handleRequestFaucet()}
                        disabled={faucetState === 'sending'}
                        className="ai-focus-ring px-3 py-1.5 rounded-full border border-white/20 text-[11px] font-semibold text-white hover:bg-white/10 cursor-pointer transition"
                      >
                        {faucetState === 'sending' ? 'Requesting…' : 'Faucet'}
                      </button>
                      <button
                        onClick={handleOpenGatewayDeposit}
                        className="ai-focus-ring px-3 py-1.5 rounded-full border text-[11px] font-bold text-white hover:brightness-110 cursor-pointer transition"
                        style={{
                          backgroundColor: STATUS_TONES.pending.pillBg,
                          borderColor: STATUS_TONES.pending.pillBorder,
                        }}
                      >
                        Deposit Gateway
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}

            {faucetMessage && (
              <p
                className="text-[11px] text-center font-mono"
                style={{
                  color:
                    faucetState === 'error'
                      ? STATUS_TONES.error.fg
                      : STATUS_TONES.success.fg,
                }}
              >
                {faucetMessage}
              </p>
            )}

            {/* Client-Side Input Validation Banner (prevents wasted x402 signatures) */}
            {formValidationError && (
              <div
                className="p-3.5 rounded-xl border text-xs flex items-center gap-2.5 animate-fade-in"
                style={{
                  backgroundColor: STATUS_TONES.cancelled.bg,
                  borderColor: STATUS_TONES.cancelled.border,
                  color: STATUS_TONES.cancelled.fg,
                }}
              >
                <AlertCircle
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: STATUS_TONES.cancelled.accent }}
                />
                <span className="leading-relaxed">{formValidationError}</span>
              </div>
            )}

            {/* Execution CTA Action */}
            <div className="space-y-3">
              <button
                onClick={handleRun}
                disabled={isExecuting || !readiness.ready || Boolean(formValidationError)}
                className={`ai-focus-ring w-full py-3 px-6 rounded-full font-semibold text-sm sm:text-base tracking-wide transition-all duration-200 flex items-center justify-center gap-2.5 select-none ${readiness.ready && !isExecuting && !formValidationError
                    ? 'text-white hover:scale-[1.01] hover:brightness-110 active:scale-[0.98] cursor-pointer'
                    : 'bg-white/[0.04] text-white/40 border border-white/[0.08] cursor-not-allowed opacity-80'
                  }`}
                style={{
                  fontFamily: 'var(--font-app)',
                  ...(readiness.ready && !isExecuting && !formValidationError
                    ? {
                      background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                      boxShadow: '0 6px 24px rgba(152, 150, 255, 0.3)',
                    }
                    : {}),
                }}
              >
                <span>
                  {!readiness.ready
                    ? 'SETTLEMENT GATE BLOCKED'
                    : formValidationError
                      ? 'FIX PARAMETERS TO CONTINUE'
                      : `EXECUTE`}
                </span>
                <ArrowRight className={`w-4 h-4 ml-0.5 ${readiness.ready && !isExecuting && !formValidationError ? 'text-white' : 'text-white/40'}`} />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: EXECUTING STATE (VIOLET COMET CHRONOMETER) ── */}
        {currentStep === 'executing' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-8 space-y-6 text-center animate-fade-in my-auto w-full">
            {/* Violet-Heavy Comet Trail Spinner */}
            <div className="relative w-36 h-36 flex items-center justify-center">
              {/* Deep ambient violet bloom */}
              <div
                className="absolute inset-0 rounded-full animate-pulse"
                style={{
                  background:
                    'radial-gradient(circle, rgba(152, 150, 255, 0.28) 0%, rgba(124, 58, 237, 0.14) 45%, transparent 72%)',
                }}
              />

              {/* Subtle base track */}
              <div
                className="absolute inset-1 rounded-full"
                style={{ border: '5px solid rgba(152, 150, 255, 0.08)' }}
              />

              {/* Soft blurred comet-tail glow layer */}
              <div
                className="absolute inset-1 rounded-full animate-spin blur-[7px] opacity-75"
                style={{
                  animationDuration: '1.65s',
                  willChange: 'transform',
                  background:
                    'conic-gradient(from 0deg, transparent 0deg, transparent 60deg, rgba(124, 58, 237, 0.25) 160deg, rgba(124, 58, 237, 0.85) 275deg, #9896ff 345deg, #e5e5ff 360deg)',
                  maskImage: 'radial-gradient(farthest-side, transparent calc(100% - 8px), #000 calc(100% - 7px))',
                  WebkitMaskImage: 'radial-gradient(farthest-side, transparent calc(100% - 8px), #000 calc(100% - 7px))',
                }}
              />

              {/* Primary razor-sharp violet comet arc with long fading trail */}
              <div
                className="absolute inset-1 rounded-full animate-spin"
                style={{
                  animationDuration: '1.65s',
                  willChange: 'transform',
                  background:
                    'conic-gradient(from 0deg, transparent 0deg, transparent 55deg, rgba(124, 58, 237, 0.18) 140deg, #7c3aed 260deg, #9896ff 342deg, #ffffff 360deg)',
                  maskImage: 'radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))',
                  WebkitMaskImage: 'radial-gradient(farthest-side, transparent calc(100% - 6px), #000 calc(100% - 5px))',
                }}
              />

              {/* Center Aave Luxury Violet Emblem */}
              <div
                className="relative w-14 h-14 rounded-2xl flex items-center justify-center border border-white/20"
                style={{
                  background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                  boxShadow: '0 0 28px rgba(152, 150, 255, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.3)',
                }}
              >
                <Zap className="w-7 h-7 text-white animate-pulse" />
              </div>
            </div>

            <div className="space-y-2 max-w-sm">
              <h4
                className="text-xl font-bold text-white tracking-tight"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                Settling via Circle Gateway x402
              </h4>
              <p className="text-xs font-mono leading-relaxed" style={{ color: 'var(--fp-3)' }}>
                Authenticating EIP-712 intent and retrieving real-time intelligence from Arc Testnet...
              </p>
            </div>
          </div>
        )}

        {/* ── STEP 2B: WALLET-CANCELLED SETTLEMENT (NO EMPTY REPORT SCREEN) ── */}
        {currentStep === 'canceled' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 space-y-4 text-center animate-fade-in my-auto w-full">
            {/* Cancelled Settlement Emblem (Blockstream Gold) */}
            <div className="relative w-28 h-28 flex items-center justify-center">
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, rgba(233, 161, 63, 0.24) 0%, rgba(233, 161, 63, 0.08) 48%, transparent 72%)',
                }}
              />
              <div
                className="absolute inset-2 rounded-full border"
                style={{ borderColor: STATUS_TONES.cancelled.border }}
              />
              <div
              className="relative w-16 h-16 rounded-2xl flex items-center justify-center">
                <Ban className="w-12 h-12" style={{ color: STATUS_TONES.cancelled.accent }} />
              </div>
            </div>

            <div className="space-y-2.5 max-w-md flex flex-col items-center">
              <h4
                className="text-xl font-bold text-white tracking-tight"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                Transaction Cancelled in Wallet
              </h4>
              <p className="text-xs font-mono leading-relaxed" style={{ color: 'var(--fp-3)' }}>
                Signature request was declined in your wallet. No USDC was charged via Circle Gateway x402.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  soundService.play('pop')
                  setUserWantsConfigure(true)
                }}
                className="ai-focus-ring ub-action-btn group inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-mono font-semibold text-white/85 hover:text-white cursor-pointer"
                style={{ fontFamily: 'var(--fonts--space-mono)' }}
              >
                <ArrowLeft className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)] group-hover:-translate-x-0.5 transition-transform" />
                <span>Back to Configure</span>
              </button>

              <button
                type="button"
                onClick={() => void handleRun()}
                disabled={!readiness.ready || Boolean(formValidationError)}
                className="ai-focus-ring inline-flex items-center gap-1.5 rounded-full px-6 py-2 text-xs font-semibold text-white transition-all duration-200 hover:scale-[1.01] hover:brightness-110 active:scale-[0.98] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                style={{
                  fontFamily: 'var(--font-app)',
                  background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                  boxShadow: '0 6px 22px rgba(152, 150, 255, 0.28)',
                }}
              >
                <span>Try Again</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: INTELLIGENCE REPORT (CLEAN, FULL-WIDTH, EXECUTIVE) ── */}
        {currentStep === 'result' && (() => {
          const ticketObj =
            displayedJson && typeof displayedJson === 'object'
              ? (displayedJson as Record<string, unknown>)
              : null
          const isTradeTicketResult = Boolean(
            ticketObj &&
            ticketObj.status === 'ROUTE_OPTIMIZED' &&
            typeof ticketObj.inputAmount === 'string' &&
            typeof ticketObj.expectedOutput === 'string'
          )
          const embedActionInTicket = Boolean(
            isTradeTicketResult &&
            outputViewMode === 'visual' &&
            executionResult?.success &&
            executionResult.actionablePayload
          )

          return (
          <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4 animate-fade-in">
            {/* Back to Configure navigation */}
            <div className="flex items-center justify-start">
              <button
                type="button"
                onClick={() => {
                  soundService.play('pop')
                  setUserWantsConfigure(true)
                }}
                className="ai-focus-ring ub-action-btn group inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-mono font-semibold text-white/80 hover:text-white cursor-pointer"
                style={{ fontFamily: 'var(--fonts--space-mono)' }}
              >
                <ArrowLeft className="w-3.5 h-3.5 text-[var(--secondary-colors--sky-sync)] group-hover:-translate-x-0.5 transition-transform" />
                <span>Back to Configure</span>
              </button>
            </div>

            {/* Content Display: VisualDataDashboard with integrated Raw JSON toggle */}
            <div
              className={
                isTradeTicketResult
                  ? 'space-y-3'
                  : 'p-5 sm:p-6 rounded-2xl border border-white/10 shadow-lg min-h-[300px]'
              }
              style={isTradeTicketResult ? undefined : { background: 'rgba(8, 10, 18, 0.75)' }}
            >
              <VisualDataDashboard
                data={displayedJson}
                outputViewMode={outputViewMode}
                onToggleViewMode={() => {
                  soundService.play('pop')
                  setOutputViewMode((prev) => (prev === 'visual' ? 'raw' : 'visual'))
                }}
                onCopy={() => {
                  if (displayedJson) {
                    copyToClipboard(JSON.stringify(displayedJson, null, 2), 'response')
                  }
                }}
                isCopied={copiedKey === 'response'}
                onNavigateTab={(tab) => {
                  onClose()
                  if (onNavigateTab) onNavigateTab(tab)
                }}
                actionablePayload={embedActionInTicket ? executionResult?.actionablePayload : undefined}
                walletAddress={walletAddress}
                walletConnected={Boolean(walletAddress)}
                ucwHandlers={ucwHandlers}
                generatedAt={executionResult?.authProof?.timestamp}
              />
            </div>

            {/* Actionable Signal Card (external card for non-ticket services or raw JSON view) */}
            {!embedActionInTicket && executionResult?.success && executionResult.actionablePayload && (
              <div className="animate-fade-in pt-1">
                <ServiceActionCard
                  payload={executionResult.actionablePayload}
                  walletAddress={walletAddress}
                  walletConnected={Boolean(walletAddress)}
                  ucwHandlers={ucwHandlers}
                  onNavigateTab={(tab) => {
                    onClose()
                    if (onNavigateTab) onNavigateTab(tab)
                  }}
                />
              </div>
            )}

            {/* Error Banner — names the cause and whether anything was charged */}
            {executionResult && !executionResult.success && executionResult.error && (
              <ServiceFailureBanner result={executionResult} />
            )}
          </div>
          )
        })()}
      </div>
    </div>,
    document.body
  )
}
