// src/config/x402/manifests/index.ts
// Aggregation of all official Arc AI service manifests (v2)

import type { ServiceManifest } from '../../../types/x402'
import { arbitrageSentinelManifest } from './arbitrageSentinel'
import { slippageOptimizerManifest } from './slippageOptimizer'
import { flashLoanRadarManifest } from './flashLoanRadar'
import { mevShieldManifest } from './mevShield'
import { gatewayIndexerManifest } from './gatewayIndexer'
import { gatewayRouteScoutManifest } from './gatewayRouteScout'
import { vaultAnalyticsManifest } from './vaultAnalytics'
import { portfolioRiskManifest } from './portfolioRisk'
import { vaultYieldReportManifest } from './vaultYieldReport'

export {
  arbitrageSentinelManifest,
  slippageOptimizerManifest,
  flashLoanRadarManifest,
  mevShieldManifest,
  gatewayIndexerManifest,
  gatewayRouteScoutManifest,
  vaultAnalyticsManifest,
  portfolioRiskManifest,
  vaultYieldReportManifest,
}

export const OFFICIAL_MANIFESTS: ServiceManifest[] = [
  arbitrageSentinelManifest,
  slippageOptimizerManifest,
  flashLoanRadarManifest,
  mevShieldManifest,
  gatewayIndexerManifest,
  gatewayRouteScoutManifest,
  vaultAnalyticsManifest,
  portfolioRiskManifest,
  vaultYieldReportManifest,
]

export function getOfficialManifestById(id: string): ServiceManifest | undefined {
  return OFFICIAL_MANIFESTS.find((m) => m.id === id)
}
