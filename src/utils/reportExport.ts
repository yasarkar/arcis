// src/utils/reportExport.ts
// Client-side JSON & RFC-4180 CSV export helpers for paid AI Services reports.

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/**
 * Converts a structured AI Service response payload into a clean, spreadsheet-friendly CSV
 * containing summary metrics, positions/pools/holdings rows, and graded risk-register items.
 */
export function buildReportCsv(serviceId: string, data: Record<string, any>): string {
  const rows: string[][] = [['Section', 'Item', 'Metric / Detail', 'Value', 'Notes']]

  // 1. Metadata & scalar summary
  rows.push(['Summary', 'Service ID', 'serviceId', serviceId, ''])
  if (data.status) rows.push(['Summary', 'Status', 'status', data.status, ''])
  if (data.address) rows.push(['Summary', 'Wallet', 'address', data.address, ''])
  if (data.readAt) {
    const iso = typeof data.readAt === 'number' ? new Date(data.readAt).toISOString() : String(data.readAt)
    rows.push(['Summary', 'Read Time (UTC)', 'readAt', iso, ''])
  }

  const scalarSource =
    data.measured && typeof data.measured === 'object' && !Array.isArray(data.measured)
      ? { ...data, ...data.measured }
      : data

  for (const [key, val] of Object.entries(scalarSource)) {
    if (key === 'readAt' || key === 'timestamp' || key === 'shareDecimals') continue
    if (typeof val === 'number' && Number.isFinite(val)) {
      rows.push(['Metric', key, key, String(val), ''])
    }
  }

  // 2. Holdings
  if (Array.isArray(data.holdings)) {
    for (const h of data.holdings) {
      rows.push([
        'Wallet Holding',
        h.symbol ?? '',
        'Balance / USD',
        `${h.balance ?? 'unavailable'} (${h.valueUsd !== null && h.valueUsd !== undefined ? `$${h.valueUsd}` : 'unpriced'})`,
        h.stablecoin ? 'Stablecoin' : 'Non-Stablecoin',
      ])
    }
  }

  // 3. LP Positions (Portfolio Auditor or Yield Statement)
  const lpList = Array.isArray(data.lpPositions)
    ? data.lpPositions
    : Array.isArray(data.defiPositions?.lpPools)
      ? data.defiPositions.lpPools
      : []
  for (const lp of lpList) {
    rows.push([
      'LP Position',
      lp.poolName ?? lp.poolId ?? '',
      'Position USD / Pending Fees USD',
      `${lp.valueUsd !== null && lp.valueUsd !== undefined ? `$${lp.valueUsd}` : 'unavailable'} / Fees: ${lp.pendingFeesUsd !== null && lp.pendingFeesUsd !== undefined ? `$${lp.pendingFeesUsd}` : 'unavailable'}`,
      `${lp.amountA ?? '?'} ${lp.tokenA ?? ''} + ${lp.amountB ?? '?'} ${lp.tokenB ?? ''} (${lp.poolSharePct ?? '?'}% share)`,
    ])
  }

  // 4. Scanned Pools or Yield Opportunities
  if (Array.isArray(data.scannedPools)) {
    for (const pool of data.scannedPools) {
      rows.push([
        'Pool Spread',
        pool.pair ?? '',
        'Gross Spread / Net Profit USD',
        `${pool.grossSpreadPct ?? ''}% / $${pool.netProfitUsdc ?? ''}`,
        `Pool: ${pool.poolRate ?? ''} vs Oracle: ${pool.oracleRate ?? ''}`,
      ])
    }
  }
  if (Array.isArray(data.opportunities)) {
    for (const op of data.opportunities) {
      rows.push([
        'Yield Opportunity',
        op.name ?? '',
        'TVL USD / 24h Vol USD',
        `$${op.tvlUsd ?? '—'} / $${op.volume24hUsd ?? '—'}`,
        `Risk: ${op.riskLevel ?? ''} · Fee: ${op.feeTierPct ?? 0}%`,
      ])
    }
  }

  // 5. Institutional Risk Register
  const riskRegister = Array.isArray(data.report?.riskRegister)
    ? data.report.riskRegister
    : Array.isArray(data.riskRegister)
      ? data.riskRegister
      : []
  for (const risk of riskRegister) {
    rows.push([
      'Risk Register',
      `${risk.severity ?? 'INFO'}: ${risk.title ?? risk.id ?? ''}`,
      risk.category ?? '',
      risk.finding ?? '',
      risk.remediation ?? '',
    ])
  }

  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
}

export function triggerFileDownload(filename: string, content: string, mimeType: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
