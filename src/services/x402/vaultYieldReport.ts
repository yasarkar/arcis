// src/services/x402/vaultYieldReport.ts
// `arc-vault-yield-tax-report` — Reporting & Tax.
//
// Measures one address's ERC-4626 vault position from on-chain state:
//   balanceOf(shares), principalAssets(user), pendingYield(user),
//   previewRedeem(shares) / (totalAssets × shares ÷ totalSupply).
// The model narrates those facts and cannot add a figure (llmEngine rejects digits).
// Cost basis beyond the vault's on-chain principal and jurisdiction-specific tax rules are
// outside what this chain can prove, and the response says so instead of estimating them.
//
// The response carries the shared institutional envelope (`institutionalReport.ts`) under
// `report`: read coverage, a data-quality grade, principal-impairment grading and the
// disclosure items that bound what the report can claim.

import { formatUnits, type Address } from 'viem'
import { POOL_CONTRACTS, VAULT_SHARE_DECIMALS, YIELD_VAULT_ABI } from '../../config/poolsConfig'
import { getArcPublicClient, resilientReadContract } from '../rpc'
import { generateLlmNarrative, type LlmNarrative } from './llmEngine'
import { isValidPortfolioAddress } from './portfolioRisk'
import {
  buildInstitutionalReport,
  institutionalRisk,
  type InstitutionalReport,
  type InstitutionalRisk,
} from './institutionalReport'

export const VAULT_YIELD_REPORT_SERVICE_ID = 'arc-vault-yield-tax-report'

const REPORT_TITLE = 'Vault Yield & Tax Report'

/** The five declared vault reads; previewRedeem is a refinement, not a coverage item. */
const EXPECTED_READS = 5

const REPORT_LIMITATIONS = [
  'Only the vault principal recorded on-chain is used as a basis; acquisition history outside the vault is not included.',
  'No jurisdiction-specific tax rule is applied and no filing figure is produced.',
]

const DISCLOSURE_LIMITS = [
  'The report covers the position recorded by the vault contract at the read time; deposits, withdrawals or accruals after that read are not reflected.',
  'A cost basis outside the vault principal and any jurisdiction-specific tax treatment are not measured, so no filing figure is produced.',
  'Yield figures are unrealized until redeemed; nothing in this report constitutes tax, legal or investment advice.',
]

const SYSTEM_PROMPT = `You are a reporting assistant for a USDC yield vault on Arc Testnet.
You receive JSON facts measured from the vault contract. Explain the position qualitatively:
principal versus current redeemable value, pending yield, and what the measurement does not cover.
Return only a JSON object with this exact shape:
{"headline": string, "observations": string[], "risks": string[]}
Rules:
- Never write a digit, a percentage, a token amount or a price. Refer to values qualitatively.
- Never write an address, a transaction hash or calldata.
- Do not invent data. If a fact is null or a read failed, say the measurement is unavailable.
- Do not present the narrative as tax advice; note that jurisdiction rules and cost basis beyond
  the vault principal are not covered.
- observations: 2 to 5 points. risks: 1 to 4 points. No markdown.`

export interface VaultYieldReportResult {
  status: 'REPORT_READY' | 'PARTIAL' | 'NO_POSITION' | 'UNAVAILABLE'
  address: string
  vaultAddress: string
  measured: Record<string, unknown>
  narrative: LlmNarrative | null
  model: string | null
  usage: { promptTokens: number | null; completionTokens: number | null } | null
  /** Institutional envelope: identity, freshness, coverage, grade, graded risk register. */
  report: InstitutionalReport
  readAt: number
  unavailable: string[]
  limitations: string[]
  note: string
}

const round6 = (value: number): number => Number(value.toFixed(6))

export async function readVaultYieldReport(input: { address: string }): Promise<VaultYieldReportResult> {
  const readAt = Date.now()
  const vaultAddress = String(POOL_CONTRACTS.YIELD_VAULT)
  const limitations = [...REPORT_LIMITATIONS, ...DISCLOSURE_LIMITS]
  const note =
    'Figures under `measured` come from the ERC-4626 vault contract; the narrative is model-written prose and contains no figures.'

  const reportFor = (args: {
    subject: string
    measuredReads: number
    risks: InstitutionalRisk[]
  }): InstitutionalReport =>
    buildInstitutionalReport({
      kind: 'VAULT_POSITION',
      serviceId: VAULT_YIELD_REPORT_SERVICE_ID,
      title: REPORT_TITLE,
      subject: { type: 'WALLET', identifier: args.subject },
      issuedAt: readAt,
      asOf: readAt,
      coverage: { measuredReads: args.measuredReads, expectedReads: EXPECTED_READS },
      risks: [
        ...args.risks,
        institutionalRisk({
          id: 'COST_BASIS_OUTSIDE_VAULT',
          category: 'DISCLOSURE',
          severity: 'INFO',
          title: 'Cost basis is limited to the vault principal',
          finding:
            'Acquisition history outside this vault is not on-chain for this service, so no realized gain or loss is derived.',
          evidence: { vault: String(POOL_CONTRACTS.YIELD_VAULT) },
          threshold: null,
          remediation:
            'Supply an external cost-basis record when a realized figure is required; this report will not infer one.',
        }),
        institutionalRisk({
          id: 'TAX_RULES_NOT_APPLIED',
          category: 'DISCLOSURE',
          severity: 'INFO',
          title: 'No tax jurisdiction was applied',
          finding:
            'The report measures the position; it applies no jurisdiction-specific rule and produces no filing figure.',
          evidence: { jurisdictionApplied: false },
          threshold: null,
          remediation:
            'Route the measured values to a qualified adviser for the jurisdiction in question.',
        }),
      ],
      methodology: [
        'totalAssets(), totalSupply(), balanceOf(address), principalAssets(address) and pendingYield(address) are read with eth_call against the ERC-4626 vault.',
        'Redeemable value uses previewRedeem(shares); when that read fails the report falls back to totalAssets() × shares ÷ totalSupply().',
        'Unrealized yield is redeemable value minus on-chain principal. The narrative is model-written and carries no figures.',
      ],
      limitations,
    })

  if (!isValidPortfolioAddress(input.address)) {
    return {
      status: 'UNAVAILABLE',
      address: input.address,
      vaultAddress,
      measured: {},
      narrative: null,
      model: null,
      usage: null,
      report: reportFor({
        subject: input.address,
        measuredReads: 0,
        risks: [
          institutionalRisk({
            id: 'INVALID_ADDRESS',
            category: 'DATA_QUALITY',
            severity: 'HIGH',
            title: 'Subject address is not a 20-byte hex account',
            finding: 'No vault read was attempted because the supplied subject is not a valid address.',
            evidence: { address: input.address },
            threshold: 'Subject must match ^0x[a-fA-F0-9]{40}$.',
            remediation: 'Re-issue the call with a checksummed or lowercase 20-byte address.',
          }),
        ],
      }),
      readAt,
      unavailable: ['a valid 20-byte address'],
      limitations,
      note,
    }
  }

  const client = getArcPublicClient()
  const user = input.address as Address
  const [assets, supply, shares, principal, pending] = await Promise.all([
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
    resilientReadContract(client, {
      address: vaultAddress as Address,
      abi: YIELD_VAULT_ABI,
      functionName: 'balanceOf',
      args: [user],
    }).catch(() => null),
    resilientReadContract(client, {
      address: vaultAddress as Address,
      abi: YIELD_VAULT_ABI,
      functionName: 'principalAssets',
      args: [user],
    }).catch(() => null),
    resilientReadContract(client, {
      address: vaultAddress as Address,
      abi: YIELD_VAULT_ABI,
      functionName: 'pendingYield',
      args: [user],
    }).catch(() => null),
  ])

  const unavailable: string[] = []
  if (assets === null) unavailable.push('vault totalAssets()')
  if (supply === null) unavailable.push('vault totalSupply()')
  if (shares === null) unavailable.push('vault balanceOf(address)')
  if (principal === null) unavailable.push('vault principalAssets(address)')
  if (pending === null) unavailable.push('vault pendingYield(address)')

  if (assets === null || supply === null || shares === null) {
    return {
      status: 'UNAVAILABLE',
      address: input.address,
      vaultAddress,
      measured: {},
      narrative: null,
      model: null,
      usage: null,
      report: reportFor({
        subject: input.address,
        measuredReads: EXPECTED_READS - unavailable.length,
        risks: [
          institutionalRisk({
            id: 'VAULT_POSITION_READ_FAILED',
            category: 'DATA_QUALITY',
            severity: 'HIGH',
            title: 'A required vault read returned nothing',
            finding: `${unavailable.join(', ')} could not be read, so no position is reported from a partial measurement.`,
            evidence: {
              measuredReads: EXPECTED_READS - unavailable.length,
              expectedReads: EXPECTED_READS,
              unavailableReads: unavailable.join(', '),
            },
            threshold: 'The vault total, share supply and holder share balance must all return.',
            remediation: 'Re-run once the Arc RPC answers; a failed read is never substituted with zero.',
          }),
        ],
      }),
      readAt,
      unavailable,
      limitations,
      note,
    }
  }

  const sharesUnits = shares as bigint
  const totalAssets = Number(formatUnits(assets as bigint, 6))
  const totalSupplyUnits = supply as bigint

  let currentValueUsdc: number | null = null
  if (sharesUnits === 0n) {
    currentValueUsdc = 0
  } else if (totalSupplyUnits > 0n) {
    const redeemed = await resilientReadContract(client, {
      address: vaultAddress as Address,
      abi: YIELD_VAULT_ABI,
      functionName: 'previewRedeem',
      args: [sharesUnits],
    }).catch(() => null)
    currentValueUsdc =
      redeemed !== null
        ? Number(formatUnits(redeemed as bigint, 6))
        : Number(formatUnits(((assets as bigint) * sharesUnits) / totalSupplyUnits, 6))
  }

  const principalUsdc = principal === null ? null : Number(formatUnits(principal as bigint, 6))
  const pendingYieldUsdc = pending === null ? null : Number(formatUnits(pending as bigint, 6))
  const unrealizedYieldUsdc =
    currentValueUsdc !== null && principalUsdc !== null ? round6(currentValueUsdc - principalUsdc) : null

  const measured: Record<string, unknown> = {
    shares: formatUnits(sharesUnits, VAULT_SHARE_DECIMALS),
    shareDecimals: VAULT_SHARE_DECIMALS,
    currentValueUsdc: currentValueUsdc === null ? null : round6(currentValueUsdc),
    principalUsdc,
    pendingYieldUsdc,
    unrealizedYieldUsdc,
    vaultTotalAssetsUsdc: Number(totalAssets.toFixed(6)),
    sharePriceUsdc:
      totalSupplyUnits > 0n
        ? round6(totalAssets / Number(formatUnits(totalSupplyUnits, VAULT_SHARE_DECIMALS)))
        : null,
  }

  const measuredReads = EXPECTED_READS - unavailable.length
  const positionRisks: InstitutionalRisk[] = []

  if (sharesUnits === 0n) {
    positionRisks.push(
      institutionalRisk({
        id: 'NO_VAULT_POSITION',
        category: 'COMPOSITION',
        severity: 'INFO',
        title: 'No vault shares are held',
        finding:
          'The address holds zero vault shares, so principal, redeemable value and pending yield carry no position.',
        evidence: { shares: measured.shares as string, principalUsdc, pendingYieldUsdc },
        threshold: null,
        remediation: 'No position report is issued for this address until it holds shares.',
      })
    )
  } else if (principalUsdc !== null && currentValueUsdc !== null && currentValueUsdc < principalUsdc) {
    const shortfallUsdc = round6(principalUsdc - currentValueUsdc)
    const shortfallPct = round6((shortfallUsdc / principalUsdc) * 100)
    positionRisks.push(
      institutionalRisk({
        id: 'PRINCIPAL_IMPAIRMENT',
        category: 'COMPOSITION',
        severity: shortfallPct >= 5 ? 'HIGH' : 'MEDIUM',
        title: 'Redeemable value is below on-chain principal',
        finding: `Redeemable value is ${shortfallUsdc} USDC below the ${principalUsdc} USDC principal recorded by the vault (${shortfallPct}% shortfall).`,
        evidence: { currentValueUsdc, principalUsdc, shortfallUsdc, shortfallPct },
        threshold: 'Redeemable value < principalAssets(address); a shortfall >= 5% is graded HIGH.',
        remediation:
          'The shortfall is measured, not explained. Review the vault’s accounting and strategy before relying on the principal as recoverable.',
      })
    )
  } else if (principalUsdc !== null && currentValueUsdc !== null && currentValueUsdc > principalUsdc) {
    positionRisks.push(
      institutionalRisk({
        id: 'UNREALIZED_YIELD_UNSETTLED',
        category: 'MARKET_STRUCTURE',
        severity: 'INFO',
        title: 'Measured gain is unrealized',
        finding: `Redeemable value exceeds principal by ${unrealizedYieldUsdc} USDC; the gain is unrealized until the shares are redeemed.`,
        evidence: { unrealizedYieldUsdc, pendingYieldUsdc },
        threshold: null,
        remediation:
          'The gain is not a settled return. Redemption timing, fees and share price at redemption determine what is actually received.',
      })
    )
  }

  if (sharesUnits === 0n) {
    return {
      status: 'NO_POSITION',
      address: input.address,
      vaultAddress,
      measured,
      narrative: null,
      model: null,
      usage: null,
      report: reportFor({ subject: input.address, measuredReads, risks: positionRisks }),
      readAt,
      unavailable,
      limitations,
      note,
    }
  }

  const llm = await generateLlmNarrative({
    serviceId: VAULT_YIELD_REPORT_SERVICE_ID,
    systemPrompt: SYSTEM_PROMPT,
    facts: measured,
  })

  if (!llm.ok) {
    return {
      status: 'UNAVAILABLE',
      address: input.address,
      vaultAddress,
      measured,
      narrative: null,
      model: null,
      usage: null,
      report: reportFor({
        subject: input.address,
        measuredReads,
        risks: [
          ...positionRisks,
          institutionalRisk({
            id: 'NARRATIVE_UNAVAILABLE',
            category: 'DATA_QUALITY',
            severity: 'HIGH',
            title: 'The narrative half of the report was not produced',
            finding: `The measured position is intact, but no narrative could be generated (${llm.unavailable.join(', ')}).`,
            evidence: { measuredReads, expectedReads: EXPECTED_READS },
            threshold: 'A complete report requires both the measured position and the model narrative.',
            remediation:
              'Re-run once the provider credential and model budget are healthy; the measured block does not need to be re-read.',
          }),
        ],
      }),
      readAt,
      unavailable: [...unavailable, ...llm.unavailable],
      limitations,
      note,
    }
  }

  return {
    status: unavailable.length === 0 ? 'REPORT_READY' : 'PARTIAL',
    address: input.address,
    vaultAddress,
    measured,
    narrative: llm.narrative,
    model: llm.model,
    usage: llm.usage,
    report: reportFor({ subject: input.address, measuredReads, risks: positionRisks }),
    readAt,
    unavailable,
    limitations,
    note,
  }
}
