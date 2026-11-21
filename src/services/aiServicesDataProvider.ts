// src/services/aiServicesDataProvider.ts
// Live On-Chain Intelligence Dispatcher for Arcis AI Services
// Delegates each official x402 service to its single-owner on-chain module.

import type { x402Service, ActionableSignalPayload } from '../types/marketplace.js'
import { readVaultAnalytics } from './x402/vaultAnalytics.js'
import { readPortfolioRisk } from './x402/portfolioRisk.js'
import { scoutGatewayRoutes, type RouteScoutUrgency } from './x402/gatewayRouteScout.js'
import { readVaultYieldReport } from './x402/vaultYieldReport.js'
import { analyzeTradeExecution } from './x402/tradeExecutionAdvisor.js'
import { scanArcPoolSpreads } from './x402/poolSpreadScanner.js'
import {
  buildGatewayFlowServiceData,
  readGatewayFlow,
  type GatewayFlowWindow,
} from './gatewayFlowIndexer.js'

export interface GeneratedServiceData {
  data: Record<string, any>
  actionablePayload?: ActionableSignalPayload
}

/**
 * Generates live on-chain intelligence and actionable triggers for an AI service execution
 */
export async function generateLiveServiceData(
  service: x402Service,
  inputPayload: Record<string, any>
): Promise<GeneratedServiceData> {
  const now = Date.now()

  // ─────────────────────────────────────────────────────────────
  // 1. ALL-POOLS SPREAD & MISPRICING SCANNER
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-cross-dex-arbitrage-sentinel') {
    return await scanArcPoolSpreads({
      pair: inputPayload.pair,
      tradeSizeUsdc: inputPayload.tradeSizeUsdc,
      minNetProfitPct: inputPayload.minNetProfitPct,
    })
  }

  // ─────────────────────────────────────────────────────────────
  // 2. SMART TRADE & EXECUTION ADVISOR (DIRECT VS 2-HOP + RESERVE RISK)
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-deep-liquidity-slippage-optimizer') {
    return await analyzeTradeExecution({
      fromToken: inputPayload.fromToken,
      toToken: inputPayload.toToken,
      amount: inputPayload.amount,
      slippageTolerancePct: inputPayload.slippageTolerancePct,
    })
  }

  // ─────────────────────────────────────────────────────────────
  // 3. CROSS-CHAIN GATEWAY FLOW MONITOR
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-cross-chain-gateway-flow-indexer') {
    const requestedWindow = String(inputPayload.timeWindow || '1h')
    const timeWindow: GatewayFlowWindow =
      requestedWindow === '24h' || requestedWindow === '7d' ? requestedWindow : '1h'

    // Real read: Circle Gateway AttestationUsed / GatewayBurned logs on Arc L1.
    const flow = await readGatewayFlow(timeWindow)
    const data = buildGatewayFlowServiceData(flow)

    return { data }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. BRIDGE & GATEWAY COST OPTIMIZER
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-gateway-fee-route-scout') {
    const token = inputPayload.token ? String(inputPayload.token) : 'USDC'
    const amountUsdc = Number(inputPayload.amountUsdc)
    const destinationChain = String(inputPayload.destinationChain || 'Ethereum_Sepolia')
    const urgency: RouteScoutUrgency = inputPayload.urgency === 'fast' ? 'fast' : 'standard'

    const quote = await scoutGatewayRoutes({ token, amountUsdc, destinationChain, urgency })

    const riskRegister: any[] = []
    if (quote.status === 'UNAVAILABLE') {
      riskRegister.push({
        id: 'ROUTE_UNAVAILABLE',
        category: 'DATA_QUALITY',
        severity: 'HIGH',
        title: 'Bridge Route Quote Unavailable',
        finding: quote.reason || 'The requested destination chain cannot be quoted on live bridge rails.',
        evidence: { token: quote.token, destinationChain, amountUsdc, unavailable: quote.unavailable },
        threshold: 'Supported token/chain pair and live pricing required.',
        remediation:
          quote.supportedDestinations.length > 0
            ? `Select a supported destination for ${quote.token}: ${quote.supportedDestinations.map((c) => c.replace(/_/g, ' ')).join(', ')}.`
            : 'Select a supported Circle Gateway or CCTP chain on Arc Testnet.',
      })
    } else if (quote.recommendedRail) {
      const railName =
        quote.recommendedRail === 'gateway'
          ? 'Circle Gateway'
          : quote.recommendedRail === 'cctpx'
            ? 'CCTP-X'
            : 'CCTP v2'
      riskRegister.push({
        id: 'ROUTE_RECOMMENDATION',
        category: 'MARKET_STRUCTURE',
        severity: 'INFO',
        title: `${railName} Optimal Route (${quote.token})`,
        finding:
          quote.savingsUsdc !== null && quote.savingsUsdc > 0
            ? `${railName} saves ${quote.savingsUsdc} USDC compared to alternative rails for transferring ${quote.amount} ${quote.token} to ${destinationChain}.`
            : quote.recommendedRail === 'cctpx'
              ? `${railName} routes ${quote.amount} ${quote.token} to ${destinationChain} with 0 token haircut (relayer fee ${quote.cctp.feeUsdc} USDC paid in native Arc gas).`
              : `${railName} is the verified route for transferring ${quote.amount} ${quote.token} to ${destinationChain}.`,
        evidence: {
          token: quote.token,
          recommendedRail: quote.recommendedRail,
          savingsUsdc: quote.savingsUsdc,
          amount: quote.amount,
          destinationChain,
          gatewayFeeUsdc: quote.gateway.totalCostUsdc,
          cctpFeeUsdc: quote.cctp.totalCostUsdc,
        },
        threshold:
          quote.token === 'USDC'
            ? 'Direct comparison between Gateway 0.005% transfer fee and CCTP v2 forwarder quote.'
            : `Live ${railName} quote verified against Arc Testnet bridgeRouteMatrix.`,
        remediation: `Proceed via ${railName} to transfer ${quote.token} to ${destinationChain.replace(/_/g, ' ')}.`,
      })
    } else if (quote.status === 'PARTIAL') {
      riskRegister.push({
        id: 'ROUTE_PARTIAL',
        category: 'DATA_QUALITY',
        severity: 'MEDIUM',
        title: 'Single Rail Quoted',
        finding: 'Only one bridge rail returned pricing; cross-rail comparison is withheld to prevent false precision.',
        evidence: { token: quote.token, destinationChain, amountUsdc, gatewayAvailable: quote.gateway.available, cctpAvailable: quote.cctp.available },
        threshold: 'Both rails must return before savings are claimed.',
        remediation: 'Review individual rail fee before initiating bridge transfer.',
      })
    }

    return { data: { ...quote, riskRegister } }
  }

  // ─────────────────────────────────────────────────────────────
  // 5. ARC YIELD & POOL OPPORTUNITY FINDER
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-yield-vault-analytics') {
    const analytics = await readVaultAnalytics({
      riskPreference: inputPayload.riskPreference,
      walletAddress: inputPayload.walletAddress,
      windowDays: inputPayload.windowDays,
    })

    return { data: analytics }
  }

  // ─────────────────────────────────────────────────────────────
  // 6. PORTFOLIO & DEFI HEALTH AUDITOR
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-portfolio-risk-exposure') {
    const address = String(inputPayload.address || '').trim()
    const includeGatewayBalance = inputPayload.includeGatewayBalance === true

    const risk = await readPortfolioRisk({ address, includeGatewayBalance })

    return { data: risk }
  }

  // ─────────────────────────────────────────────────────────────
  // 7. YIELD & POSITION STATEMENT (AI)
  // ─────────────────────────────────────────────────────────────
  if (service.id === 'arc-vault-yield-tax-report') {
    const address = String(inputPayload.address || '').trim()
    const report = await readVaultYieldReport({ address })

    return { data: report }
  }

  // ─────────────────────────────────────────────────────────────
  // 8. CUSTOM / COMMUNITY REGISTERED SERVICE FALLBACK
  // ─────────────────────────────────────────────────────────────
  return {
    data: {
      status: 'SUCCESS',
      timestamp: now,
      serviceId: service.id,
      serviceName: service.name,
      inputsReceived: inputPayload,
      executionResult: {
        message: 'Community service payload accepted and echoed back; no on-chain execution was performed.',
        echo: inputPayload,
      },
    },
    actionablePayload: {
      type: 'navigate',
      title: 'Explore Service Integration',
      badgeText: 'Service Executed',
      details: {
        navTab: 'ai-services',
      },
    },
  }
}
