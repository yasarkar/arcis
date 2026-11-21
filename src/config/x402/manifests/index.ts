// src/config/x402/manifests/index.ts
// Aggregation of all official Arc AI service manifests (v2)

import type { ServiceManifest } from '../../../types/x402.js'
import { arbitrageSentinelManifest } from './arbitrageSentinel.js'
import { slippageOptimizerManifest } from './slippageOptimizer.js'
import { gatewayIndexerManifest } from './gatewayIndexer.js'
import { gatewayRouteScoutManifest } from './gatewayRouteScout.js'
import { vaultAnalyticsManifest } from './vaultAnalytics.js'
import { portfolioRiskManifest } from './portfolioRisk.js'
import { vaultYieldReportManifest } from './vaultYieldReport.js'

export {
  arbitrageSentinelManifest,
  slippageOptimizerManifest,
  gatewayIndexerManifest,
  gatewayRouteScoutManifest,
  vaultAnalyticsManifest,
  portfolioRiskManifest,
  vaultYieldReportManifest,
}

export const OFFICIAL_MANIFESTS: ServiceManifest[] = [
  slippageOptimizerManifest,
  arbitrageSentinelManifest,
  gatewayRouteScoutManifest,
  vaultAnalyticsManifest,
  portfolioRiskManifest,
  vaultYieldReportManifest,
  gatewayIndexerManifest,
]

export function getOfficialManifestById(id: string): ServiceManifest | undefined {
  return OFFICIAL_MANIFESTS.find((m) => m.id === id)
}
