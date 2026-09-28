// src/config/x402/manifests/index.ts
// Aggregation of all official Arc AI service manifests (v2)

import type { ServiceManifest } from '../../../types/x402'
import { arbitrageSentinelManifest } from './arbitrageSentinel'
import { slippageOptimizerManifest } from './slippageOptimizer'
import { flashLoanRadarManifest } from './flashLoanRadar'
import { mevShieldManifest } from './mevShield'
import { gatewayIndexerManifest } from './gatewayIndexer'

export {
  arbitrageSentinelManifest,
  slippageOptimizerManifest,
  flashLoanRadarManifest,
  mevShieldManifest,
  gatewayIndexerManifest,
}

export const OFFICIAL_MANIFESTS: ServiceManifest[] = [
  arbitrageSentinelManifest,
  slippageOptimizerManifest,
  flashLoanRadarManifest,
  mevShieldManifest,
  gatewayIndexerManifest,
]

export function getOfficialManifestById(id: string): ServiceManifest | undefined {
  return OFFICIAL_MANIFESTS.find((m) => m.id === id)
}
