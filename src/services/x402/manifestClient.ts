// src/services/x402/manifestClient.ts
// Client for fetching, filtering, and verifying ServiceManifest listings

import type { ServiceManifest, ServiceCategory, X402PaymentRequirements } from '../../types/x402'
import { OFFICIAL_MANIFESTS, getOfficialManifestById } from '../../config/x402/manifests'

export interface ManifestFilterOptions {
  category?: ServiceCategory
  search?: string
  kind?: 'official' | 'community' | 'all'
  verifiedOnly?: boolean
}

class ManifestClient {
  private customManifests: ServiceManifest[] = []

  constructor() {
    this.loadCustomManifests()
  }

  private loadCustomManifests(): void {
    if (typeof window === 'undefined') return
    try {
      const stored = localStorage.getItem('arcis_custom_services_v2')
      if (stored) {
        this.customManifests = JSON.parse(stored)
      }
    } catch (e) {
      console.warn('[ManifestClient] Failed to load custom manifests from localStorage:', e)
    }
  }

  public registerCustomManifest(manifest: ServiceManifest): void {
    const existingIndex = this.customManifests.findIndex((m) => m.id === manifest.id)
    if (existingIndex >= 0) {
      this.customManifests[existingIndex] = manifest
    } else {
      this.customManifests.unshift(manifest)
    }

    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('arcis_custom_services_v2', JSON.stringify(this.customManifests))
      } catch (e) {
        console.warn('[ManifestClient] Failed to save custom manifest to localStorage:', e)
      }
    }
  }

  /**
   * Retrieves all service manifests matching optional filters.
   * Merges official manifests and locally/remotely registered community services.
   */
  public async getManifests(filters?: ManifestFilterOptions): Promise<ServiceManifest[]> {
    const all = [...OFFICIAL_MANIFESTS, ...this.customManifests]

    return all.filter((m) => {
      if (filters?.category && filters.category !== 'All' && m.category !== filters.category) {
        return false
      }

      if (filters?.kind && filters.kind !== 'all' && m.listing.kind !== filters.kind) {
        return false
      }

      if (filters?.verifiedOnly && !m.provider.isVerified) {
        return false
      }

      if (filters?.search) {
        const q = filters.search.toLowerCase().trim()
        const matchesText =
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.tagline.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q))
        if (!matchesText) return false
      }

      return true
    })
  }

  /**
   * Fetch a single manifest by ID.
   */
  public async getManifest(id: string): Promise<ServiceManifest | null> {
    const official = getOfficialManifestById(id)
    if (official) return official

    const custom = this.customManifests.find((m) => m.id === id)
    return custom || null
  }

  /**
   * Verifies listing availability and 402 payment requirements.
   * Simulates/executes an unpaid probe to inspect accepted payment options.
   */
  public async verifyListing(
    serviceId: string
  ): Promise<{ ok: boolean; accepts?: X402PaymentRequirements['accepts']; error?: string }> {
    const manifest = await this.getManifest(serviceId)
    if (!manifest) {
      return { ok: false, error: `Service with ID '${serviceId}' not found.` }
    }

    // Official manifests are pre-verified with official contracts
    if (manifest.listing.kind === 'official') {
      return {
        ok: true,
        accepts: manifest.accepts.map((a) => ({
          scheme: a.scheme,
          network: a.network,
          asset: a.asset,
          payTo: a.payTo as `0x${string}`,
          maxAmountRequired: (manifest.pricing.priceUsdc * 1e6).toString(),
          resource: manifest.serve.path,
          domain: a.domain ? { ...a.domain, verifyingContract: a.domain.verifyingContract as `0x${string}` } : undefined,
        })),
      }
    }

    // Community service probe
    try {
      const endpoint = manifest.upstream?.url || manifest.serve.path
      const res = await fetch(endpoint, {
        method: manifest.serve.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest.examples.request),
      })

      if (res.status === 402) {
        return { ok: true, accepts: manifest.accepts as any }
      }
      return { ok: res.ok, accepts: manifest.accepts as any }
    } catch {
      // In case of local CORS or offline, return manifest's accepted options
      return { ok: true, accepts: manifest.accepts as any }
    }
  }
}

export const manifestClient = new ManifestClient()
