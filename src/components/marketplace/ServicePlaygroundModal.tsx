// Corporate & Institutional AI Agent Playground & Specification Suite for Arcis x402 Services
// Redesigned under Konsept B: "Linear Command / Step-by-Step Focus"
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  FileJson,
  Info,
  Lock,
  Sparkles,
  X,
  Zap
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import { getChainDisplayName, getChainIconId } from '../../config/chainMeta'
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
import { getSessionKeyConfig, SESSION_KEY_UPDATED_EVENT } from '../../services/sessionKeyService'
import { soundService } from '../../services/soundService'
import type { SessionBudgetState } from '../../services/x402Client'
import type { x402ExecutionResult, x402Service } from '../../types/marketplace'
import type { SessionKeyConfig } from '../../types/sessionKey'
import { diagnoseX402Failure } from '../../utils/x402FailureDiagnosis'
import { evaluateX402Readiness } from '../../utils/x402Readiness'
import { ChainIcon } from '../common/ChainIcon'
import { PortfolioAssetIcon } from '../portfolio/PortfolioAssetIcon'
import MarketplaceSelect from './MarketplaceSelect'
import ServiceActionCard from './ServiceActionCard'

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
    const impact = typeof evidence.priceImpactPct === 'number' ? `${evidence.priceImpactPct.toFixed(2)}%` : 'elevated'
    return {
      humanTitle: `High Slippage Warning (${impact} impact)`,
      problemText: `Trade size causes ${impact} price impact against live pool depth.`,
      riskText: 'Large single-block orders in shallow pools incur severe execution slippage and negative pricing.',
      solutionText: 'Split the order into smaller tranches or route via multi-hop pools to preserve capital.',
      actionLabel: 'Inspect Swap Route',
      actionTab: 'swap',
    }
  }

  if (id === 'OPTIMAL_SLIPPAGE_ROUTE') {
    const impact = typeof evidence.priceImpactPct === 'number' ? `${evidence.priceImpactPct.toFixed(2)}%` : 'low'
    return {
      humanTitle: `Deep Liquidity Route Verified (${impact} impact)`,
      problemText: `Verified tight execution price with only ${impact} price impact on Arc Testnet DEX.`,
      solutionText: 'The pool depth accommodates this trade size efficiently with minimal slippage.',
      actionLabel: 'Execute Swap',
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

  if (id === 'MEV_SANDWICH_EXPOSURE') {
    const exp = typeof evidence.tradeReserveExposurePct === 'number' ? `${evidence.tradeReserveExposurePct.toFixed(1)}%` : 'elevated'
    return {
      humanTitle: `Mempool Sandwich Threat (${exp} of pool)`,
      problemText: `Trade size consumes ${exp} of the pool's entire liquidity reserve.`,
      riskText: 'Block builders and searchers can extract value via front-running and back-running sandwich bundles.',
      solutionText: 'Tighten max slippage tolerance or route through Arc native FIFO sequencer.',
      actionLabel: 'Adjust Slippage on Swap',
      actionTab: 'swap',
    }
  }

  if (id === 'LOW_MEV_RISK') {
    const exp = typeof evidence.tradeReserveExposurePct === 'number' ? `${evidence.tradeReserveExposurePct.toFixed(2)}%` : 'minimal'
    return {
      humanTitle: `Protected MEV Profile (${exp} of pool)`,
      problemText: `Trade size is modest (${exp} of pool depth) and well below MEV sandwich thresholds.`,
      solutionText: 'Arc L1 native deterministic FIFO ordering protects this transaction from mempool reordering.',
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
      return `This surveillance monitor tracks trade size against total pool reserve depth. Trades exceeding 5% of pool liquidity create sufficient price impact to incentivize atomic sandwich arbitrage by mempool searchers.`

    case 'LOW_MEV_RISK':
      return `When trade-to-reserve exposure remains below 5%, the potential MEV extraction profit is less than the gas cost required to execute a sandwich attack on Arc L1.`

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
  tone,
  onNavigateTab,
}: {
  entry: any
  index: number
  tone: { color: string; background: string; border: string }
  onNavigateTab?: (tab: string) => void
}) {
  const [isTechOpen, setIsTechOpen] = useState(false)
  const diagnosis = getHumanDiagnosis(entry)

  return (
    <div
      key={`${String(entry?.id ?? 'risk')}-${index}`}
      className="p-4 rounded-xl border transition-all duration-200 hover:border-white/20"
      style={{
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.02) 0%, rgba(15, 17, 26, 0.85) 100%)',
        borderColor: tone.border,
        boxShadow: '0 4px 16px -2px rgba(0, 0, 0, 0.3)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="px-2 py-0.5 rounded-md border text-[9px] font-mono font-bold tracking-wider shrink-0 shadow-sm"
            style={{
              color: tone.color,
              backgroundColor: tone.background,
              borderColor: tone.border,
            }}
          >
            {String(entry?.severity ?? 'INFO')}
          </span>
          <span className="text-xs sm:text-sm font-bold text-white tracking-tight inline-flex items-center gap-1.5 flex-wrap">
            {diagnosis.titlePrefix && diagnosis.assetSymbol ? (
              <>
                <span>{diagnosis.titlePrefix}</span>
                <span className="text-white font-normal inline-flex items-center gap-1">
                  <span>({diagnosis.pctStr}</span>
                  <span className="w-3.5 h-3.5 inline-flex items-center justify-center shrink-0" title={diagnosis.assetSymbol}>
                    <PortfolioAssetIcon symbol={diagnosis.assetSymbol} size={14} className="w-3.5 h-3.5 object-contain shrink-0" />
                  </span>
                  <span>)</span>
                </span>
              </>
            ) : (
              <span>{diagnosis.humanTitle}</span>
            )}
          </span>
        </div>
      </div>

      {/* Condition statements without prefix headings */}
      <div className="mt-3 space-y-1.5 text-xs leading-relaxed">
        <p className="text-white/90">{diagnosis.problemText}</p>

        {diagnosis.riskText && (
          <p className="text-rose-200/90">{diagnosis.riskText}</p>
        )}

        {diagnosis.solutionText && (
          <div className="flex items-start gap-2 pt-1.5 text-[var(--secondary-colors--static-ether)]">
            <ArrowRight className="w-3.5 h-3.5 shrink-0 text-[var(--secondary-colors--sky-sync)] mt-0.5" />
            <p className="flex-1 leading-relaxed">{diagnosis.solutionText}</p>
          </div>
        )}
      </div>

      {/* Actionable Button + Technical Specifications Button Row */}
      <div className="mt-3 pt-2.5 border-t border-white/[0.05] flex items-center gap-2 flex-wrap">
        {diagnosis.actionLabel && diagnosis.actionTab && onNavigateTab && (
          <button
            type="button"
            onClick={() => onNavigateTab(diagnosis.actionTab!)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.05] hover:bg-white/10 hover:border-white/30 text-white text-xs font-semibold transition cursor-pointer shadow-sm group shrink-0"
          >
            <span>{diagnosis.actionLabel}</span>
            <ArrowRight className="w-3.5 h-3.5 text-white/60 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}

        {/* Info Icon Button - Clean borderless/backgroundless icon that smoothly expands on hover */}
        <button
          type="button"
          onClick={() => setIsTechOpen(!isTechOpen)}
          className="group/specs inline-flex items-center gap-1 p-1 rounded-md transition-all duration-300 cursor-pointer select-none text-white/60 hover:text-white"
          aria-expanded={isTechOpen}
        >
          <Info
            className={`w-4 h-4 shrink-0 transition-colors duration-200 ${isTechOpen
                ? 'text-[var(--secondary-colors--sky-sync)]'
                : 'text-white/50 group-hover/specs:text-[var(--secondary-colors--sky-sync)]'
              }`}
          />
          <span
            className={`max-w-0 opacity-0 ${isTechOpen
                ? 'max-w-[190px] opacity-100 ml-0.5'
                : 'group-hover/specs:max-w-[190px] group-hover/specs:opacity-100 group-hover/specs:ml-0.5'
              } transition-all duration-300 ease-out whitespace-nowrap overflow-hidden text-[11px] font-mono font-medium tracking-wide text-white/70 group-hover/specs:text-white`}
          >
            Technical Specifications
          </span>
          <ChevronRight
            className={`w-3 h-3 shrink-0 transition-all duration-300 ${isTechOpen
                ? 'rotate-90 text-[var(--secondary-colors--sky-sync)]'
                : 'text-white/40 max-w-0 opacity-0 group-hover/specs:max-w-[14px] group-hover/specs:opacity-100'
              }`}
          />
        </button>
      </div>

      {/* Expanded Technical Specifications Panel */}
      <div className={`mt-2.5 p-3 rounded-xl border border-white/[0.08] bg-black/40 transition-all ${isTechOpen ? 'block' : 'hidden'}`}>
        {/* 2-3 Sentence Clear Explanation */}
        <p className="text-xs text-white/85 leading-relaxed font-sans">
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
}: {
  data: any
  outputViewMode?: 'visual' | 'raw'
  onToggleViewMode?: () => void
  onCopy?: () => void
  isCopied?: boolean
  onNavigateTab?: (tab: string) => void
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

  const SEVERITY_TONE: Record<string, { color: string; background: string; border: string }> = {
    CRITICAL: { color: '#fecdd3', background: 'rgba(244, 63, 94, 0.22)', border: 'rgba(244, 63, 94, 0.55)' },
    HIGH: { color: '#fecaca', background: 'rgba(244, 63, 94, 0.12)', border: 'rgba(244, 63, 94, 0.32)' },
    MEDIUM: {
      color: 'var(--secondary-colors--blockstream-gold)',
      background: 'rgba(233, 161, 63, 0.12)',
      border: 'rgba(233, 161, 63, 0.32)',
    },
    LOW: { color: 'rgba(255, 255, 255, 0.72)', background: 'rgba(255, 255, 255, 0.05)', border: 'rgba(255, 255, 255, 0.12)' },
    INFO: { color: 'rgba(255, 255, 255, 0.55)', background: 'rgba(255, 255, 255, 0.03)', border: 'rgba(255, 255, 255, 0.09)' },
  }
  const toneFor = (severity: unknown) => SEVERITY_TONE[String(severity)] ?? SEVERITY_TONE.INFO

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
  const numericMetrics: { key: string; label: string; value: string; isCurrency?: boolean; isPct?: boolean }[] = []

  const knownMetrics: Record<string, { label: string; isCurrency?: boolean; isPct?: boolean }> = {
    totalUsd: { label: 'Total Value', isCurrency: true },
    totalValueUsd: { label: 'Total Portfolio', isCurrency: true },
    concentrationPct: { label: 'Asset Concentration', isPct: true },
    stablecoinSharePct: { label: 'Stablecoin Share', isPct: true },
    apy: { label: 'Annual Yield (APY)', isPct: true },
    yieldApy: { label: 'Vault APY', isPct: true },
    spreadPct: { label: 'Arb Spread', isPct: true },
    priceImpactPct: { label: 'Price Impact', isPct: true },
    estimatedProfitUsdc: { label: 'Est. Profit', isCurrency: true },
    savingsUsdc: { label: 'Rail Fee Savings', isCurrency: true },
    latencyMs: { label: 'Execution Ping' },
    // `llm` services report their measured block under these keys.
    currentValueUsdc: { label: 'Redeemable Value', isCurrency: true },
    principalUsdc: { label: 'Principal', isCurrency: true },
    pendingYieldUsdc: { label: 'Pending Yield', isCurrency: true },
    unrealizedYieldUsdc: { label: 'Unrealized Yield', isCurrency: true },
    vaultTotalAssetsUsdc: { label: 'Vault Total Assets', isCurrency: true },
    tvlUsdc: { label: 'Vault TVL', isCurrency: true },
    sharePriceUsdc: { label: 'Share Price', isCurrency: true },
    gatewayBalanceUsdc: { label: 'Gateway Balance', isCurrency: true },
    gasCostUsdc: { label: 'Gas Cost', isCurrency: true },
    estimatedGasCostUsdc: { label: 'Est. Gas Cost', isCurrency: true },
    netProfitUsdc: { label: 'Net Profit', isCurrency: true },
    grossSpreadPct: { label: 'Gross Spread', isPct: true },
    netProfitPct: { label: 'Net Profit Margin', isPct: true },
    tradeReserveExposurePct: { label: 'Reserve Exposure', isPct: true },
    overallPriceImpactPct: { label: 'Price Impact', isPct: true },
  }

  for (const [k, v] of Object.entries(view)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (k === 'readAt' || k === 'timestamp' || k === 'shareDecimals' || k === 'decimals') continue
      const meta = knownMetrics[k] || { label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()) }
      let formatted = v.toLocaleString(undefined, { maximumFractionDigits: 4 })
      if (meta.isCurrency) {
        formatted = `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      } else if (meta.isPct) {
        formatted = `${v.toFixed(2)}%`
      }
      numericMetrics.push({
        key: k,
        label: meta.label,
        value: formatted,
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
  const recommendations: string[] = Array.isArray(view.recommendations) ? view.recommendations : []

  const [copiedAddress, setCopiedAddress] = useState(false)

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
      {/* Top Status & Risk Badges */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            {status && (
              <h3
                className={`text-2xl sm:text-3xl font-black tracking-tight ${status === 'UNAVAILABLE' ? 'text-rose-400' : 'text-white'
                  }`}
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                {status === 'PORTFOLIO_ANALYZED' || status === 'REPORT_READY'
                  ? 'ANALYSIS REPORT'
                  : status.replace(/_/g, ' ')}
              </h3>
            )}

            {note && (
              <div className="relative group/note inline-flex">
                <div
                  className="inline-flex items-center justify-center p-1.5 rounded-xl text-[11px] font-mono font-bold tracking-tight transition cursor-help select-none hover:bg-white/[0.05]"
                  style={{
                    color: 'var(--secondary-colors--blockstream-gold)',
                  }}
                >
                  <Info className="w-4 h-4 flex-shrink-0" />
                </div>

                {/* Note Content Tooltip */}
                <div className="absolute left-0 top-full mt-2 hidden group-hover/note:flex flex-col z-50 w-80 sm:w-96 p-3.5 rounded-2xl bg-[#090c18] border border-[rgba(233,161,63,0.35)] shadow-2xl backdrop-blur-2xl animate-fade-in pointer-events-none">
                  <div className="flex items-center gap-1.5 mb-1.5 text-[12px] font-mono font-bold uppercase tracking-wider text-[var(--secondary-colors--blockstream-gold)]">
                    <Info className="w-4 h-4 flex-shrink-0" />
                    <span>Protocol Verification Note</span>
                  </div>
                  <p className="text-xs font-mono leading-relaxed text-white/90">
                    {note}
                  </p>
                </div>
              </div>
            )}
          </div>

          {data.address && (
            <div className="text-xs font-mono text-white/50 flex items-center gap-2 pt-0.5">
              <span>Target:</span>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white/[0.04] border border-white/10 hover:border-white/20 transition group">
                <button
                  type="button"
                  onClick={handleCopyAddress}
                  className="p-0.5 rounded hover:bg-white/10 text-white/50 hover:text-white transition cursor-pointer"
                >
                  {copiedAddress ? (
                    <Check className="w-4 h-4 text-[var(--earned-green)]" />
                  ) : (
                    <Copy className="w-4 h-4 text-white/60 group-hover:text-white" />
                  )}
                </button>
                <span className="text-white/90 font-medium select-all">
                  {String(data.address).slice(0, 8)}…{String(data.address).slice(-6)}
                </span>
                {copiedAddress && (
                  <span className="text-[10px] text-[var(--earned-green)] font-semibold animate-fade-in">
                    Copied
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right side controls: Raw JSON toggle button */}
        {onToggleViewMode && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onToggleViewMode}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono font-semibold transition cursor-pointer shadow-sm ${outputViewMode === 'raw'
                ? 'bg-white/20 border-white/30 text-white font-bold'
                : 'bg-white/[0.05] hover:bg-white/[0.1] border-white/10 hover:border-white/20 text-white/80 hover:text-white'
                }`}
              title={outputViewMode === 'raw' ? 'Switch to Visual Report' : 'View Raw JSON Payload'}
            >
              <FileJson className="w-4 h-4 flex-shrink-0" />
            </button>
          </div>
        )}
      </div>

      {outputViewMode === 'raw' ? (
        <div className="relative pt-1 animate-fade-in group">
          {/* Floating Copy Button in Top-Right of JSON Container */}
          {onCopy && (
            <div className="absolute top-3 right-3 z-10">
              <button
                type="button"
                onClick={onCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 hover:border-white/30 bg-black/75 hover:bg-black/90 backdrop-blur-md text-white/80 hover:text-white text-xs font-mono transition cursor-pointer shadow-lg"
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

          <pre className="text-emerald-300/90 whitespace-pre-wrap selection:bg-[var(--purple-1)] selection:text-white font-mono text-xs leading-relaxed max-h-[500px] overflow-y-auto p-4 pt-5 rounded-xl bg-black/40 border border-white/[0.06]">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      ) : (
        <>

          {/* Headline Metric Cards Grid — Prominently displayed at top */}
          {numericMetrics.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
              {numericMetrics.map((m) => (
                <div
                  key={m.key}
                  className="relative p-4 rounded-2xl border border-white/[0.08] hover:border-white/20 transition-all duration-300 group overflow-hidden"
                  style={{
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(15, 17, 26, 0.8) 100%)',
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.35)',
                  }}
                >
                  <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-white/15 to-transparent group-hover:via-[var(--purple-1)]/40 transition-all duration-500" />
                  <span
                    className="text-[10px] font-mono uppercase tracking-[1.5px] text-white/50 block truncate group-hover:text-white/70 transition-colors"
                    style={{ fontFamily: 'var(--fonts--space-mono, monospace)' }}
                  >
                    {m.label}
                  </span>
                  <div
                    className="text-xl sm:text-2xl md:text-3xl font-bold text-white tabular-nums tracking-tight truncate mt-1.5"
                    style={{ fontFamily: 'var(--fonts--space-grotesk, sans-serif)' }}
                  >
                    {m.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Best route (arbitrage sentinel) */}
          {bestRoute && (
            <div
              className="rounded-2xl border border-white/[0.08] p-4 space-y-3"
              style={{ background: 'rgba(8, 10, 18, 0.6)' }}
            >
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/50 block">
                BEST ROUTE
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-white/[0.025] border border-white/[0.05] space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 block">Buy</span>
                  <div className="text-xs font-semibold text-white">
                    {typeof bestRoute.buyDex === 'string' ? bestRoute.buyDex : 'Unavailable'}
                  </div>
                  <div className="text-xs font-mono text-white/70 tabular-nums">
                    {typeof bestRoute.buyPriceUsdc === 'number' ? `${bestRoute.buyPriceUsdc} USDC` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.025] border border-white/[0.05] space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 block">Sell reference</span>
                  <div className="text-xs font-semibold text-white">
                    {typeof bestRoute.sellDex === 'string' ? bestRoute.sellDex : 'Unavailable'}
                  </div>
                  <div className="text-xs font-mono text-white/70 tabular-nums">
                    {typeof bestRoute.sellPriceUsdc === 'number' ? `${bestRoute.sellPriceUsdc} USDC` : '—'}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono text-white/60">
                {typeof bestRoute.grossSpreadPct === 'number' && (
                  <span>Spread: <span className="text-white tabular-nums">{bestRoute.grossSpreadPct}%</span></span>
                )}
                {typeof bestRoute.netProfitUsdc === 'number' && (
                  <span>Net: <span className="text-[var(--earned-green)] tabular-nums">{bestRoute.netProfitUsdc} USDC</span></span>
                )}
                {typeof bestRoute.estimatedGasCostUsdc === 'number' && (
                  <span>Gas: <span className="text-white tabular-nums">{bestRoute.estimatedGasCostUsdc} USDC</span></span>
                )}
              </div>
              <p className="text-[10px] font-mono text-white/35 leading-relaxed">
                Analysis only. The sell side is an external price reference, not a second DEX venue, and no trade is executed.
              </p>
            </div>
          )}

          {/* Recommended MEV shield action (advisory only) */}
          {shieldAction && (
            <div
              className="rounded-2xl border border-white/[0.08] p-4 space-y-2"
              style={{ background: 'rgba(8, 10, 18, 0.6)' }}
            >
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/50 block">
                RECOMMENDED SHIELD ACTION (ADVISORY)
              </span>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono text-white/60">
                {typeof shieldAction.adjustedMaxSlippagePct === 'number' && (
                  <span>Max slippage: <span className="text-white tabular-nums">{shieldAction.adjustedMaxSlippagePct}%</span></span>
                )}
                {typeof shieldAction.estimatedGasCostUsdc === 'number' && (
                  <span>Est. gas: <span className="text-white tabular-nums">{shieldAction.estimatedGasCostUsdc} USDC</span></span>
                )}
                {typeof shieldAction.bundleType === 'string' && (
                  <span>{shieldAction.bundleType}</span>
                )}
              </div>
              <p className="text-[10px] font-mono text-white/35 leading-relaxed">
                No private relay, bundle or transaction protection is submitted by this service.
              </p>
            </div>
          )}

          {/* Unavailable measurements and the reason they are missing */}
          {(unavailableList.length > 0 || reason) && (
            <div className="p-3.5 rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-rose-300 block">
                UNAVAILABLE MEASUREMENTS
              </span>
              {unavailableList.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {unavailableList.map((item) => (
                    <span
                      key={item}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-mono border border-rose-500/30 text-rose-200 bg-rose-500/10"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              )}
              {reason && (
                <p className="text-[11px] font-mono leading-relaxed text-rose-200/80">{reason}</p>
              )}
            </div>
          )}


          {/* Side-by-Side: Portfolio Assets & Chain Exposure */}
          {(holdings.length > 0 || chainExposure.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
              {/* Left Column: Holdings Breakdown Table */}
              {holdings.length > 0 && (
                <div
                  className="rounded-2xl border border-white/[0.08] overflow-hidden flex flex-col h-full"
                  style={{ background: 'rgba(8, 10, 18, 0.6)' }}
                >
                  <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between text-[12px] font-mono font-semibold text-white/60">
                    <span>PORTFOLIO ASSETS ({holdings.length})</span>
                  </div>
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
                          className="p-2.5 rounded-xl bg-white/[0.025] hover:bg-white/[0.05] border border-white/[0.05] hover:border-white/10 transition-all flex items-center justify-between gap-3 group"
                        >
                          {/* Left: Token Icon & Symbol */}
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl p-1 bg-white/[0.04] border border-white/[0.06] group-hover:scale-105 transition-transform overflow-hidden shadow-inner">
                              <PortfolioAssetIcon symbol={symbol} size={24} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-white tracking-wide">{symbol}</span>
                              </div>
                            </div>
                          </div>

                          {/* Right: Balance & USD Value */}
                          <div className="text-right shrink-0 pl-2">
                            <div
                              className="font-mono text-xs font-bold text-white tracking-tight tabular-nums"
                              style={{ fontFamily: 'var(--fonts--space-grotesk)' }}
                            >
                              {formattedBalance}{' '}
                              <span className="text-[11px] text-white/40">{symbol}</span>
                            </div>
                            {formattedUsd && (
                              <div className="text-[11px] text-slate-400 font-mono mt-0.5 tabular-nums">
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
                <div
                  className="rounded-2xl border border-white/[0.08] overflow-hidden flex flex-col h-full"
                  style={{ background: 'rgba(8, 10, 18, 0.6)' }}
                >
                  <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between text-[12px] font-mono font-semibold text-white/60">
                    <span>CHAIN ({chainExposure.length})</span>
                  </div>
                  <div className="p-3 max-h-72 overflow-y-auto flex-1 flex flex-col gap-2">
                    {chainExposure.map((c, i) => {
                      const chainKey = String(c.chain || 'Network')
                      const displayName = getChainDisplayName(chainKey) || chainKey.replace(/_/g, ' ')
                      return (
                        <div
                          key={i}
                          className="p-2.5 rounded-xl bg-white/[0.025] hover:bg-white/[0.05] border border-white/[0.05] hover:border-white/10 transition-all flex items-center justify-between gap-2.5 group"
                        >
                          {/* Left: Chain Icon & Name */}
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="shrink-0 flex items-center justify-center w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] overflow-hidden group-hover:scale-105 transition-transform shadow-inner">
                              <ChainIcon chainKeyOrIconId={chainKey} size={24} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-white truncate" title={displayName}>
                                {displayName}
                              </div>
                            </div>
                          </div>

                          {/* Right: Value in USD */}
                          <div className="text-right shrink-0">
                            <div
                              className="text-xs font-bold text-white tabular-nums"
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
              className="relative rounded-2xl border border-white/[0.1] p-5 space-y-3.5 overflow-hidden transition-all"
              style={{
                background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.05) 0%, rgba(99, 102, 241, 0.03) 40%, rgba(15, 17, 26, 0.85) 100%)',
                backdropFilter: 'blur(24px)',
                boxShadow: '0 8px 32px -4px rgba(0, 0, 0, 0.4)',
              }}
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[var(--purple-1)]/20 to-[var(--color-brand-primary)]/20 border border-[var(--purple-1)]/30 flex items-center justify-center text-[var(--purple-1)] shadow-inner">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                  <span
                    className="text-[11px] font-mono uppercase tracking-[2px] font-semibold text-white/70"
                    style={{ fontFamily: 'var(--fonts--space-mono, monospace)' }}
                  >
                    ANALYST NARRATIVE
                  </span>
                </div>
              </div>

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
                    <div key={`observation-${i}`} className="flex items-start gap-2.5 text-xs text-white/85 leading-relaxed">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand-primary)] mt-1.5 shrink-0 shadow-[0_0_8px_var(--color-brand-primary)]" />
                      <p>{observation}</p>
                    </div>
                  ))}
                </div>
              )}

              {narrativeRisks.length > 0 && (
                <div
                  className="p-3 rounded-xl border space-y-2 mt-2"
                  style={{
                    backgroundColor: 'rgba(233, 161, 63, 0.08)',
                    borderColor: 'rgba(233, 161, 63, 0.25)',
                  }}
                >
                  <span
                    className="text-[10px] font-mono uppercase tracking-[1.5px] font-bold block"
                    style={{ color: 'var(--secondary-colors--blockstream-gold)' }}
                  >
                    RISKS &amp; ADVISORIES
                  </span>
                  <ul className="space-y-1.5 text-xs text-white/85">
                    {narrativeRisks.map((risk, i) => (
                      <li key={`risk-${i}`} className="leading-relaxed flex items-start gap-2">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[var(--secondary-colors--blockstream-gold)]" />
                        <span>{risk}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Available Routes */}
          {routes.length > 0 && (
            <div className="rounded-2xl border border-white/[0.08] p-3.5 space-y-2" style={{ background: 'rgba(8, 10, 18, 0.6)' }}>
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/50 block">GATEWAY ROUTES</span>
              <div className="space-y-1.5">
                {routes.map((r, i) => (
                  <div key={i} className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white">{r.sourceChain || 'Source'}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-white/30" />
                      <span className="font-semibold text-cyan-300">{r.targetChain || 'Target'}</span>
                    </div>
                    {r.estimatedFee && (
                      <span className="font-mono text-[10px] text-[var(--earned-green)]">Fee: {r.estimatedFee} USDC</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Narrative Recommendations */}
          {recommendations.length > 0 && (
            <div className="rounded-2xl border border-white/[0.08] p-3.5 space-y-1.5" style={{ background: 'rgba(8, 10, 18, 0.6)' }}>
              <span className="text-[10px] font-mono uppercase tracking-wider text-white/50 block">AI RECOMMENDATIONS</span>
              <ul className="space-y-1 list-disc list-inside text-xs text-white/80">
                {recommendations.map((rec, i) => (
                  <li key={i} className="leading-relaxed">{rec}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Graded risk register: Human-Centric Actionable Diagnoses */}
          {riskRegister.length > 0 && (
            <div
              className="rounded-2xl border border-white/[0.08] overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.02) 0%, rgba(8, 10, 18, 0.75) 100%)',
                backdropFilter: 'blur(16px)',
              }}
            >
              <div className="px-6 py-4 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[12px] font-mono uppercase tracking-[1.5px] font-semibold text-white/80"
                  >
                    Risk register ({riskRegister.length})
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const)
                    .filter((severity) => (reportSummary?.counts?.[severity] ?? 0) > 0)
                    .map((severity) => (
                      <span
                        key={severity}
                        className="px-2 py-0.5 rounded-md border text-[9px] font-mono font-bold tracking-wider tabular-nums shadow-sm"
                        style={{
                          color: toneFor(severity).color,
                          backgroundColor: toneFor(severity).background,
                          borderColor: toneFor(severity).border,
                        }}
                      >
                        {severity} {reportSummary.counts[severity]}
                      </span>
                    ))}
                </div>
              </div>

              <div className="p-3.5 space-y-3">
                {riskRegister.map((entry, index) => (
                  <RiskRegisterCard
                    key={`${String(entry?.id ?? 'risk')}-${index}`}
                    entry={entry}
                    index={index}
                    tone={toneFor(entry?.severity)}
                    onNavigateTab={onNavigateTab}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Protocol Risk Warnings — only for services without a graded register */}
          {riskFlags.length > 0 && riskRegister.length === 0 && (
            <div
              className="p-3.5 sm:p-4 rounded-2xl border flex items-start gap-3 transition-all"
              style={{
                backgroundColor: 'rgba(233, 161, 63, 0.08)',
                borderColor: 'rgba(233, 161, 63, 0.28)',
                boxShadow: '0 4px 20px -4px rgba(233, 161, 63, 0.1)',
              }}
            >
              <div
                className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
                style={{
                  backgroundColor: 'rgba(233, 161, 63, 0.15)',
                  color: 'var(--secondary-colors--blockstream-gold)',
                }}
              >
                <AlertCircle className="w-4 h-4 stroke-[2.2]" />
              </div>
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[14px] font-mono font-bold uppercase tracking-wider"
                    style={{ color: 'var(--secondary-colors--blockstream-gold)' }}
                  >
                    Protocol Risk Flags
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap pt-0.5">
                  {riskFlags.map((flag) => (
                    <span
                      key={flag}
                      className="px-3 py-1.5 rounded-xl text-xs font-mono font-bold border flex items-center gap-1.5 shadow-sm"
                      style={{
                        backgroundColor: 'rgba(233, 161, 63, 0.15)',
                        borderColor: 'rgba(233, 161, 63, 0.4)',
                        color: 'var(--secondary-colors--blockstream-gold)',
                      }}
                    >
                      <span>⚠️</span>
                      <span>{flag.replace(/_/g, ' ')}</span>
                    </span>
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
 * A voided paid call is not one failure: a model that produced no narrative, an unreadable
 * on-chain input and a service that returned nothing all need different next steps. The banner
 * names the cause (from the server's `diagnostics`) and states plainly whether money moved.
 */
function ServiceFailureBanner({ result }: { result: x402ExecutionResult }) {
  const diagnosis = diagnoseX402Failure(result)
  const charged = diagnosis ? diagnosis.charged : (result.costUsdc ?? 0) > 0

  return (
    <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-3 animate-fade-in">
      <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
      <div className="space-y-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-rose-200">{diagnosis?.title ?? 'Execution Error'}</span>
          {!charged && (
            <span className="px-2 py-0.5 rounded-md border border-white/15 bg-white/[0.04] text-[10px] font-mono uppercase tracking-wider text-white/60">
              No charge
            </span>
          )}
        </div>
        {diagnosis?.detail && (
          <p className="font-mono text-[11px] leading-relaxed text-rose-200/90">{diagnosis.detail}</p>
        )}
        {diagnosis && diagnosis.reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {diagnosis.reasons.map((item) => (
              <span
                key={item}
                className="px-2 py-0.5 rounded-md text-[10px] font-mono border border-rose-500/30 text-rose-200/90 bg-rose-500/10"
              >
                {item}
              </span>
            ))}
          </div>
        )}
        {diagnosis?.action && (
          <p className="font-mono text-[10px] leading-relaxed text-white/45">{diagnosis.action}</p>
        )}
        <p className="font-mono text-[10px] leading-relaxed text-rose-300/60 break-words">{result.error}</p>
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

  // Session key authority for autonomous agent spending limits
  const [sessionConfig, setSessionConfig] = useState<SessionKeyConfig>(() =>
    getSessionKeyConfig(walletAddress)
  )

  // Standard body scroll lock
  useBodyScrollLock(isOpen)
  useEffect(() => {
    const syncSessionConfig = () => setSessionConfig(getSessionKeyConfig(walletAddress))
    syncSessionConfig()
    window.addEventListener(SESSION_KEY_UPDATED_EVENT, syncSessionConfig)
    return () => window.removeEventListener(SESSION_KEY_UPDATED_EVENT, syncSessionConfig)
  }, [walletAddress])

  const sessionIsActive = sessionConfig.isActive && Date.now() <= sessionConfig.expiresAt
  const remainingSessionUsdc = Math.max(0, sessionConfig.maxSpendUsdc - (sessionConfig.spentUsdc || 0))

  // Derive current step
  const currentStep = isExecuting
    ? 'executing'
    : (executionResult) && !userWantsConfigure
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

  // Initialize form data with default values
  useEffect(() => {
    if (service) {
      setFormData((prev) => {
        const next: Record<string, any> = {}
        service.ui.form.forEach((param) => {
          const isAddressParam =
            param.name === 'address' ||
            param.name === 'walletAddress' ||
            param.label?.toLowerCase().includes('wallet address')

          if (isAddressParam && walletAddress) {
            const currentVal = prev[param.name]
            if (!currentVal || currentVal === '0x0000000000000000000000000000000000000000' || currentVal === param.defaultValue) {
              next[param.name] = walletAddress
              return
            }
            next[param.name] = currentVal
            return
          }

          next[param.name] = prev[param.name] !== undefined ? prev[param.name] : param.defaultValue
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
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleRun = async () => {
    soundService.play('pop')
    setUserWantsConfigure(false)
    setOutputViewMode('visual')
    try {
      await onExecute(service, formData)
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

  const stepIndex = currentStep === 'configure' ? 1 : currentStep === 'executing' ? 2 : 3

  const stepItems = [
    { idx: 1, title: 'Configure', subtitle: 'Payload Inputs' },
    { idx: 2, title: 'Settlement', subtitle: 'Circle Gateway x402' },
    { idx: 3, title: 'Report', subtitle: 'AI Intelligence' },
  ]

  const renderStepBoxes = () => (
    <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full mb-5">
      {stepItems.map((st) => {
        const isCompleted = st.idx < stepIndex
        const isActive = st.idx === stepIndex
        const isClickable = isCompleted && currentStep === 'result' && st.idx === 1

        return (
          <div
            key={st.idx}
            onClick={() => {
              if (isClickable) {
                soundService.play('pop')
                setUserWantsConfigure(true)
              }
            }}
            title={isClickable ? 'Click to modify parameters' : undefined}
            className={`p-2.5 sm:p-3.5 rounded-2xl border transition-all duration-300 relative overflow-hidden select-none ${isCompleted
              ? `border-indigo-500/40 bg-indigo-500/10 shadow-[0_4px_16px_rgba(99,102,241,0.15)] ${isClickable ? 'cursor-pointer hover:border-indigo-400/70 hover:bg-indigo-500/15 hover:scale-[1.02]' : ''
              }`
              : isActive
                ? 'border-[var(--purple-1)] bg-[linear-gradient(135deg,rgba(112,88,248,0.22)_0%,rgba(6,182,212,0.14)_100%)] shadow-[0_0_24px_rgba(112,88,248,0.28),inset_0_1px_0_rgba(255,255,255,0.2)] ring-1 ring-[var(--purple-1)]/50'
                : 'border-white/[0.07] bg-white/[0.02] opacity-55'
              }`}
          >
            {/* Top Glowing Hairline Indicator */}
            {isActive && (
              <div
                className="absolute top-0 left-0 right-0 h-[2px]"
                style={{
                  background: 'linear-gradient(90deg, transparent, var(--color-brand-cyan), var(--purple-1), transparent)',
                }}
              />
            )}
            {isCompleted && (
              <div
                className="absolute top-0 left-0 right-0 h-[2px]"
                style={{
                  background: 'linear-gradient(90deg, transparent, #818cf8, transparent)',
                }}
              />
            )}

            <div className="flex items-center gap-2.5 sm:gap-3">
              {/* Number Badge or Checkmark */}
              <span
                className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg inline-flex items-center justify-center font-mono text-[10px] sm:text-xs font-bold transition-all shrink-0 ${isCompleted
                  ? 'bg-indigo-500 text-white shadow-[0_0_10px_rgba(99,102,241,0.6)]'
                  : isActive
                    ? 'bg-[var(--purple-1)] text-black shadow-[0_0_12px_rgba(152,150,255,0.6)]'
                    : 'bg-white/10 text-white/40'
                  }`}
              >
                {isCompleted ? <Check className="w-3.5 h-3.5 text-white stroke-[3]" /> : `0${st.idx}`}
              </span>

              {/* Title & Subtitle */}
              <div className="min-w-0 flex-1">
                <div
                  className={`text-xs sm:text-sm font-bold tracking-tight truncate ${isCompleted ? 'text-white' : isActive ? 'text-white' : 'text-white/50'
                    }`}
                  style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
                >
                  {st.title}
                </div>
                <div className="text-[10px] text-white/40 font-mono truncate mt-0.5">
                  {st.subtitle}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 md:p-6 overflow-y-auto">
      {/* Dark Luxury Ambient Backdrop (Modal can only be closed via top-right 'X' button) */}
      <div className="fixed inset-0 bg-[#060810]/85 backdrop-blur-[28px] transition-all duration-300 animate-fade-in" />

      {/* Main Container: Linear Command Box */}
      <div
        className={`relative w-full rounded-[28px] overflow-hidden transition-all duration-300 my-auto flex flex-col max-h-[92vh] z-10 ${currentStep === 'result' ? 'max-w-5xl lg:max-w-6xl' : 'max-w-2xl'
          }`}
        style={{
          background: 'linear-gradient(145deg, rgba(16, 20, 36, 0.98) 0%, rgba(10, 13, 24, 0.99) 100%)',
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 32px 80px -16px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.04), 0 0 40px rgba(112, 88, 248, 0.12)',
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
          style={{ background: 'rgba(15, 18, 32, 0.7)' }}
        >
          {/* Service Identity & Price */}
          <div className="flex items-center gap-3 min-w-0">
            <div>
              <div className="flex items-center gap-2">
                <span className="arc-eyebrow text-[10px] text-[var(--secondary-colors--sky-sync)] font-semibold">
                  ARCIS AI // {service.category}
                </span>
              </div>
              <h2
                className="text-base sm:text-lg font-bold text-white tracking-tight truncate mt-0.5"
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
                <span className="text-[10px] text-white/40 font-normal">
                  / call
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                soundService.play('pop')
                onClose()
              }}
              className="p-2 rounded-xl text-white/40 hover:text-white border border-white/10 hover:border-white/20 transition cursor-pointer flex items-center gap-1 group shadow-sm text-xs font-mono"
            >
              <X className="w-4 h-4 text-white/60 group-hover:text-white transition" />
            </button>
          </div>
        </div>

        {/* ── STEP 1: CONFIGURE PAYLOAD (FOCUSED & UNCLUTTERED) ── */}
        {currentStep === 'configure' && (
          <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 animate-fade-in w-full">
            {/* Step Progress Boxes */}
            {renderStepBoxes()}

            <div className="space-y-1.5 text-left">
              <h3
                className="text-xl sm:text-2xl font-bold text-white tracking-tight"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                Configure Analysis Parameters
              </h3>
              <p className="text-xs sm:text-sm text-white/60 font-sans leading-relaxed">
                {service.description}
              </p>
            </div>

            {/* Inputs Card */}
            <div
              className="p-5 sm:p-6 rounded-2xl border border-white/[0.08] space-y-4 shadow-sm"
              style={{ background: 'rgba(255, 255, 255, 0.02)' }}
            >

              {/* Form Parameter Fields */}
              <div className="space-y-4">
                {service.ui.form.map((param) => {
                  const isAddressParam =
                    param.name === 'address' ||
                    param.name === 'walletAddress' ||
                    param.label?.toLowerCase().includes('wallet address')
                  const effectiveDefault = isAddressParam && walletAddress ? walletAddress : param.defaultValue
                  const currentValue = formData[param.name] ?? effectiveDefault

                  return (
                    <div key={param.name} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-white/90 block">
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
                      </div>

                      {param.type === 'select' ? (
                        <MarketplaceSelect
                          value={String(currentValue)}
                          onChange={(val) => handleInputChange(param.name, val)}
                          options={(param.options || []).map((opt) => ({
                            value: String(opt.value),
                            label: opt.label,
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
                      ) : param.type === 'number' ? (
                        <input
                          type="number"
                          value={currentValue}
                          onChange={(e) => handleInputChange(param.name, Number(e.target.value))}
                          className="w-full px-3.5 py-2 rounded-xl border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--purple-1)] focus:ring-1 focus:ring-[var(--purple-1)]/30 transition font-mono tabular-nums"
                          style={{ background: 'rgba(9, 11, 20, 0.85)' }}
                        />
                      ) : (
                        <input
                          type="text"
                          value={currentValue}
                          onChange={(e) => handleInputChange(param.name, e.target.value)}
                          placeholder={isAddressParam && walletAddress ? walletAddress : undefined}
                          className="w-full px-3.5 py-2 rounded-xl border border-white/10 text-xs text-white focus:outline-none focus:border-[var(--purple-1)] focus:ring-1 focus:ring-[var(--purple-1)]/30 transition font-mono"
                          style={{ background: 'rgba(9, 11, 20, 0.85)' }}
                        />
                      )}

                      <p className="text-[10px] text-white/50 leading-normal">{param.description}</p>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Progressive Readiness / Warning Alert (Shown ONLY if attention needed) */}
            {!readiness.ready && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between gap-3 animate-fade-in">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-300 flex-shrink-0" />
                  <span>
                    {readiness.checks.find((c) => c.status === 'blocked')?.detail || 'Settlement gate action required.'}
                  </span>
                </div>

                {readiness.checks.some((c) => c.id === 'network' && c.status === 'blocked') && (
                  <button
                    onClick={() => void handleSwitchNetwork()}
                    disabled={isSwitching}
                    className="px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[11px] font-bold text-white cursor-pointer transition flex-shrink-0"
                  >
                    {isSwitching ? 'Switching…' : 'Switch Network'}
                  </button>
                )}

                {readiness.checks.some((c) => c.id === 'gateway-balance' && c.status === 'blocked') && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => void handleRequestFaucet()}
                      disabled={faucetState === 'sending'}
                      className="px-2.5 py-1 rounded-lg border border-white/20 text-[11px] font-semibold text-white hover:bg-white/10 cursor-pointer"
                    >
                      {faucetState === 'sending' ? 'Requesting…' : 'Faucet'}
                    </button>
                    <button
                      onClick={handleOpenGatewayDeposit}
                      className="px-2.5 py-1 rounded-lg bg-[var(--purple-1)]/30 border border-[var(--purple-1)]/50 text-[11px] font-bold text-white hover:bg-[var(--purple-1)]/40 cursor-pointer"
                    >
                      Deposit Gateway
                    </button>
                  </div>
                )}
              </div>
            )}

            {faucetMessage && (
              <p className={`text-[11px] text-center font-mono ${faucetState === 'error' ? 'text-rose-400' : 'text-[var(--earned-green)]'}`}>
                {faucetMessage}
              </p>
            )}

            {/* Execution CTA Action */}
            <div className="space-y-3 pt-2">
              <button
                onClick={handleRun}
                disabled={isExecuting || !readiness.ready}
                className={`w-full py-4 px-6 rounded-full font-semibold text-sm sm:text-base tracking-wide transition-all duration-200 flex items-center justify-center gap-2 select-none ${
                  readiness.ready && !isExecuting
                    ? 'text-white hover:scale-[1.01] hover:brightness-110 active:scale-[0.98] cursor-pointer'
                    : 'bg-white/[0.04] text-slate-500 border border-white/[0.06] cursor-not-allowed opacity-80'
                }`}
                style={{
                  fontFamily: 'var(--font-app)',
                  ...(readiness.ready && !isExecuting
                    ? {
                        background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                        boxShadow: '0 6px 24px rgba(152, 150, 255, 0.3)',
                      }
                    : {}),
                }}
              >
                {!readiness.ready ? (
                  <Lock className="w-4 h-4 text-slate-400" />
                ) : (
                  <Zap className="w-4 h-4 text-white" />
                )}
                <span>
                  {!readiness.ready
                    ? 'SETTLEMENT GATE BLOCKED'
                    : `EXECUTE — ${service.pricing.priceUsdc} USDC`}
                </span>
                <ArrowRight className={`w-4 h-4 ml-1 ${readiness.ready && !isExecuting ? 'text-white' : 'text-slate-400'}`} />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: EXECUTING STATE (RADAR CHRONOMETER) ── */}
        {currentStep === 'executing' && (
          <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-8 space-y-6 text-center animate-fade-in my-auto w-full">
            {/* Step Progress Boxes */}
            {renderStepBoxes()}

            {/* Pulsing Arc Hologram Ring */}
            <div className="relative w-36 h-36 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(112,88,248,0.25)_0%,transparent_70%)] animate-pulse" />
              <svg className="w-40 h-40 animate-spin" style={{ animationDuration: '3s' }} viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.05)"
                  strokeWidth="6"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="url(#execGradient)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray="264"
                  strokeDashoffset="120"
                />
                <defs>
                  <linearGradient id="execGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00E5FF" />
                    <stop offset="50%" stopColor="#7058F8" />
                    <stop offset="100%" stopColor="#01D062" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <Zap className="w-10 h-10 text-[var(--color-brand-cyan)] animate-pulse" />
              </div>
            </div>

            <div className="space-y-2 max-w-sm">
              <h4
                className="text-lg font-bold text-white tracking-tight"
                style={{ fontFamily: 'var(--font-display, Outfit, sans-serif)' }}
              >
                Settling via Circle Gateway x402
              </h4>
              <p className="text-xs text-white/50 font-mono leading-relaxed">
                Authenticating EIP-712 intent and retrieving real-time intelligence from Arc Testnet...
              </p>
            </div>
          </div>
        )}

        {/* ── STEP 3: INTELLIGENCE REPORT (CLEAN, FULL-WIDTH, EXECUTIVE) ── */}
        {currentStep === 'result' && (
          <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-5 animate-fade-in">
            {/* Step Progress Boxes */}
            {renderStepBoxes()}

            {/* Content Display: VisualDataDashboard with integrated Raw JSON toggle */}
            <div
              className="p-5 sm:p-6 rounded-2xl border border-white/10 shadow-lg min-h-[300px]"
              style={{ background: 'rgba(8, 10, 18, 0.75)' }}
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
                onNavigateTab={onNavigateTab}
              />
            </div>

            {/* Actionable Signal Card (Arbitrage, Swap, or Deposit Opportunity) */}
            {executionResult?.success && executionResult.actionablePayload && (
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
        )}
      </div>
    </div>,
    document.body
  )
}
