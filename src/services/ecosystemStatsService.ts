// src/services/ecosystemStatsService.ts
// Live Ecosystem Telemetry & Persistent Statistics Service for Arcis x402 Marketplace
// Tracks real execution counts, live settled volume, accumulated YieldVault fees, and physical latency.

import { MARKETPLACE_STATS } from '../config/servicesRegistry'
import { getAccumulatedYieldVaultFees } from './x402PaymentEngine'
import type { MarketplaceStats } from '../types/marketplace'

const ECOSYSTEM_STATS_STORAGE_KEY = 'arcis_live_ecosystem_stats_v3'

type StatsListener = (stats: MarketplaceStats) => void

class EcosystemStatsService {
  private stats: MarketplaceStats
  private listeners: Set<StatsListener> = new Set()

  constructor() {
    this.stats = this.loadStats()
  }

  private loadStats(): MarketplaceStats {
    try {
      const stored = localStorage.getItem(ECOSYSTEM_STATS_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        // Purge legacy hardcoded mock baseline or seeded values (including legacy 24.15 fallback)
        if (
          parsed.totalCallsProcessed >= 400000 ||
          parsed.savedSubscriptionCostUsd >= 100000 ||
          parsed.totalYieldGeneratedUsdc === 24.15 ||
          localStorage.getItem('arcis_yield_vault_ai_share_v2') === '24.15'
        ) {
          localStorage.removeItem(ECOSYSTEM_STATS_STORAGE_KEY)
          localStorage.removeItem('arcis_yield_vault_ai_share_v2')
          return {
            ...MARKETPLACE_STATS,
            totalYieldGeneratedUsdc: 0,
          }
        }

        // Synchronize YieldVault fees with x402PaymentEngine single source of truth
        const realVaultFees = getAccumulatedYieldVaultFees()
        return {
          ...parsed,
          totalYieldGeneratedUsdc: realVaultFees,
        }
      }
    } catch {
      // ignore
    }

    const initialVaultFees = getAccumulatedYieldVaultFees()
    return {
      ...MARKETPLACE_STATS,
      totalYieldGeneratedUsdc: initialVaultFees,
    }
  }

  private saveStats() {
    try {
      localStorage.setItem(ECOSYSTEM_STATS_STORAGE_KEY, JSON.stringify(this.stats))
    } catch {
      // ignore
    }
  }

  public getStats(): MarketplaceStats {
    return { ...this.stats }
  }

  public subscribe(listener: StatsListener): () => void {
    this.listeners.add(listener)
    listener({ ...this.stats })
    return () => this.listeners.delete(listener)
  }

  private notify() {
    const copy = { ...this.stats }
    this.listeners.forEach((listener) => {
      try {
        listener(copy)
      } catch (err) {
        console.error('[EcosystemStatsService] Listener notification error:', err)
      }
    })
    this.saveStats()
  }

  /**
   * Updates average latency dynamically from real physical probes
   */
  public updateLiveLatency(averageMs: number) {
    if (averageMs > 0 && averageMs !== this.stats.averageResponseTimeMs) {
      this.stats.averageResponseTimeMs = averageMs
      this.notify()
    }
  }

  /**
   * Records a genuine completed x402 execution
   */
  public recordExecution(priceUsdc: number) {
    this.stats.totalCallsProcessed += 1
    this.stats.totalVolumeUsdc = Number((this.stats.totalVolumeUsdc + priceUsdc).toFixed(4))
    
    // Sync protocol fee directly from YieldVault engine single source of truth
    this.stats.totalYieldGeneratedUsdc = Number(
      getAccumulatedYieldVaultFees().toFixed(4)
    )

    // Average user savings vs standard Web2 API request (~$0.05-$0.10 baseline)
    const netSavingsPerCall = Math.max(0, 0.05 - priceUsdc)
    this.stats.savedSubscriptionCostUsd = Number(
      (this.stats.savedSubscriptionCostUsd + netSavingsPerCall).toFixed(4)
    )

    this.notify()
  }

  /**
   * Increments active registered services count
   */
  public incrementServiceCount() {
    this.stats.activeServicesCount += 1
    this.notify()
  }

  /**
   * Resets stats to clean state (for testing or clean profile wipe)
   */
  public resetStats() {
    this.stats = {
      ...MARKETPLACE_STATS,
      totalYieldGeneratedUsdc: 0,
    }
    this.saveStats()
    this.notify()
  }
}

export const ecosystemStatsService = new EcosystemStatsService()
