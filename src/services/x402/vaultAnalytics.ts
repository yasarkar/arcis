// src/services/x402/vaultAnalytics.ts
// ERC-4626 vault analytics for the priced AI service `arc-yield-vault-analytics`.
//
// Every figure is derived from the vault's own on-chain accounting:
//   totalAssets() / totalSupply() → TVL and share price.
// When a read fails the field stays null and the response says which read failed; when the
// vault has no shares the share price is not computed at all (division by zero would be a
// fabricated number, not an observation).
//
// The response carries the shared institutional envelope (`institutionalReport.ts`) under
// `report`: read coverage, a data-quality grade and a graded register that states what the
// vault's accounting cannot reveal (no historical series, no strategy risk).

import { formatUnits, type Address } from 'viem'
import { POOL_CONTRACTS, VAULT_SHARE_DECIMALS, YIELD_VAULT_ABI } from '../../config/poolsConfig'
import { getArcPublicClient, resilientReadContract } from '../rpc'
import {
  buildInstitutionalReport,
  institutionalRisk,
  type InstitutionalReport,
  type InstitutionalRisk,
} from './institutionalReport'

export const VAULT_ANALYTICS_SERVICE_ID = 'arc-yield-vault-analytics'

export type VaultAnalyticsWindow = 7 | 30 | 90

export const VAULT_ANALYTICS_WINDOWS: VaultAnalyticsWindow[] = [7, 30, 90]

const REPORT_TITLE = 'USDC Yield Vault Analytics Report'

const REPORT_LIMITATIONS = [
  'The report covers the vault contract’s current accounting only; strategy risk, accrued-yield policy and counterparty exposure are outside what the contract exposes.',
  'Share price is an accounting ratio of assets to shares, not a market quote, a redemption guarantee or a forecast.',
  'No historical series is readable on-chain for this vault, so no APY, drawdown or window return is computed from windowDays.',
]

export interface VaultAnalyticsResult {
  status: 'VAULT_READ' | 'VAULT_EMPTY' | 'UNAVAILABLE'
  windowDays: VaultAnalyticsWindow
  vaultAddress: string
  totalAssetsUsdc: number | null
  totalSupplyShares: string | null
  sharePriceUsdc: number | null
  tvlUsdc: number | null
  shareDecimals: number
  /** Institutional envelope: identity, freshness, coverage, grade, graded risk register. */
  report: InstitutionalReport
  readAt: number
  unavailable: string[]
  limitations: string[]
  reason?: string
  note: string
}

const round6 = (value: number): number => Number(value.toFixed(6))

function normalizeWindow(value: unknown): VaultAnalyticsWindow {
  const parsed = Number(value)
  return parsed === 7 || parsed === 90 ? parsed : 30
}

/**
 * Reads the live vault state. `windowDays` is echoed back as the requested observation
 * window: no historical series exists on-chain here, so no APY or change figure is derived
 * from it.
 */
export async function readVaultAnalytics(input: { windowDays?: unknown }): Promise<VaultAnalyticsResult> {
  const readAt = Date.now()
  const windowDays = normalizeWindow(input.windowDays)
  const vaultAddress = String(POOL_CONTRACTS.YIELD_VAULT)
  const note =
    'TVL and share price are read from the ERC-4626 vault at call time. No historical APY or window return is computed because no such series is readable on-chain.'

  const expectedReads = 2

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
          title: 'Observation window carries no historical return',
          finding: `The requested ${windowDays}-day window is echoed for traceability; the vault exposes no historical series, so no window return or APY is derived from it.`,
          evidence: { windowDays },
          threshold: null,
          remediation:
            'Treat the window as a request label. Compare successive independent reads to build a series, and state that the comparison is the caller’s own.',
        }),
      ],
      methodology: [
        'totalAssets() and totalSupply() are read with eth_call against the ERC-4626 vault at call time.',
        'TVL is totalAssets() in USDC (6 decimals); share price is TVL divided by totalSupply() denominated in share units (9 decimals).',
        'Share price is withheld, not defaulted, when totalSupply() is zero — division by zero would be a fabricated figure.',
      ],
      limitations: REPORT_LIMITATIONS,
    })

  try {
    const client = getArcPublicClient()
    const [assets, supply] = await Promise.all([
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

    const unavailable: string[] = []
    if (assets === null) unavailable.push('vault totalAssets()')
    if (supply === null) unavailable.push('vault totalSupply()')

    if (assets === null || supply === null) {
      return {
        status: 'UNAVAILABLE',
        windowDays,
        vaultAddress,
        totalAssetsUsdc: assets === null ? null : Number(formatUnits(assets as bigint, 6)),
        totalSupplyShares: supply === null ? null : formatUnits(supply as bigint, VAULT_SHARE_DECIMALS),
        sharePriceUsdc: null,
        tvlUsdc: null,
        shareDecimals: VAULT_SHARE_DECIMALS,
        report: reportFor(expectedReads - unavailable.length, [
          institutionalRisk({
            id: 'VAULT_READ_FAILED',
            category: 'DATA_QUALITY',
            severity: 'HIGH',
            title: 'Vault accounting read did not return',
            finding: `${unavailable.join(' and ')} returned nothing, so TVL and share price are withheld rather than derived from a partial read.`,
            evidence: {
              measuredReads: expectedReads - unavailable.length,
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
        reason: `Vault analytics not computed: could not read ${unavailable.join(' and ')}.`,
        note,
      }
    }

    const totalAssetsUsdc = Number(formatUnits(assets as bigint, 6))
    const totalSupplyShares = formatUnits(supply as bigint, VAULT_SHARE_DECIMALS)
    const supplyNumber = Number(totalSupplyShares)

    if (supply === 0n || !Number.isFinite(supplyNumber) || supplyNumber <= 0) {
      // Assets held while no share exists is an accounting inconsistency, not merely an empty
      // vault: a depositor could not redeem anything against that balance.
      const assetsWithoutShares = totalAssetsUsdc > 0
      return {
        status: 'VAULT_EMPTY',
        windowDays,
        vaultAddress,
        totalAssetsUsdc,
        totalSupplyShares,
        sharePriceUsdc: null,
        tvlUsdc: totalAssetsUsdc,
        shareDecimals: VAULT_SHARE_DECIMALS,
        report: reportFor(expectedReads, [
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
          }),
        ]),
        readAt,
        unavailable: ['share price (vault has no shares outstanding)'],
        limitations: REPORT_LIMITATIONS,
        note,
      }
    }

    return {
      status: 'VAULT_READ',
      windowDays,
      vaultAddress,
      totalAssetsUsdc,
      totalSupplyShares,
      sharePriceUsdc: round6(totalAssetsUsdc / supplyNumber),
      tvlUsdc: totalAssetsUsdc,
      shareDecimals: VAULT_SHARE_DECIMALS,
      report: reportFor(expectedReads, [
        institutionalRisk({
          id: 'VAULT_ACTIVE_RESERVES',
          category: 'COMPOSITION',
          severity: 'INFO',
          title: 'USDC Yield Vault Operating Normally',
          finding: `Vault holds ${totalAssetsUsdc} USDC in verified on-chain assets across ${totalSupplyShares} shares at ${round6(totalAssetsUsdc / supplyNumber)} USDC/share.`,
          evidence: {
            totalAssetsUsdc,
            totalSupplyShares,
            sharePriceUsdc: round6(totalAssetsUsdc / supplyNumber),
          },
          threshold: 'Vault totalAssets() > 0 and totalSupply() > 0.',
          remediation: 'Inspect current yield performance and deposit liquidity via the Arc USDC yield pool.',
        }),
      ]),
      readAt,
      unavailable: [],
      limitations: REPORT_LIMITATIONS,
      note,
    }
  } catch (err) {
    return {
      status: 'UNAVAILABLE',
      windowDays,
      vaultAddress,
      totalAssetsUsdc: null,
      totalSupplyShares: null,
      sharePriceUsdc: null,
      tvlUsdc: null,
      shareDecimals: VAULT_SHARE_DECIMALS,
      report: reportFor(0, [
        institutionalRisk({
          id: 'VAULT_READ_FAILED',
          category: 'DATA_QUALITY',
          severity: 'HIGH',
          title: 'Vault accounting read threw',
          finding: 'The vault read failed before any figure was measured, so no TVL or share price is published.',
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
