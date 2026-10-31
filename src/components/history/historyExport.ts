// src/components/history/historyExport.ts
//
// CSV / JSON export for the History tab (P1-5).
//
// The export always runs over the rows the user is currently looking at (the
// filtered set), so the file matches the screen. Privacy mode masks every amount,
// recipient, memo and pool/service label: an export must never leak a value the
// table itself hides.

import type { HistoryItem } from '../../utils/history'

export type HistoryExportFormat = 'csv' | 'json'

export interface HistoryExportOptions {
  /** True when the app's privacy mode is on (or the caller wants a masked file). */
  masked: boolean
  /** The same symbol the table shows for masked amounts. */
  maskSymbol: string
}

/** One flat, already-stringified export row. Every value is a string so CSV/JSON agree. */
export interface HistoryExportRow {
  date: string
  type: string
  status: string
  amount: string
  token: string
  amountIn: string
  tokenIn: string
  amountOut: string
  tokenOut: string
  sourceChain: string
  destChain: string
  recipient: string
  txHash: string
  destTxHash: string
  memo: string
  memoId: string
  pool: string
  service: string
  isPrivate: string
}

/** Column order for the CSV header and rows. Keep in sync with `HistoryExportRow`. */
export const HISTORY_EXPORT_COLUMNS: ReadonlyArray<keyof HistoryExportRow> = [
  'date',
  'type',
  'status',
  'amount',
  'token',
  'amountIn',
  'tokenIn',
  'amountOut',
  'tokenOut',
  'sourceChain',
  'destChain',
  'recipient',
  'txHash',
  'destTxHash',
  'memo',
  'memoId',
  'pool',
  'service',
  'isPrivate',
]

const MASKED_TEXT = '*****'

const isoDate = (timestamp: number): string => {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

/**
 * Projects history items onto the flat export shape, applying privacy masking.
 *
 * A row is masked when the caller asked for a masked export **or** the row itself
 * is private — a single private transaction inside an otherwise public export must
 * still come out masked. Transaction hashes stay: they are public on-chain and the
 * table already shows them in privacy mode.
 */
export function toHistoryExportRows(
  items: HistoryItem[],
  options: HistoryExportOptions
): HistoryExportRow[] {
  const maskSymbol = options.maskSymbol?.trim() || MASKED_TEXT

  return (items || []).map((item) => {
    const masked = options.masked || Boolean(item.isPrivate)
    const amount = (value?: string) => (masked && value ? maskSymbol : value || '')
    const text = (value?: string) => (masked && value ? MASKED_TEXT : value || '')

    return {
      date: isoDate(item.timestamp),
      type: item.type || '',
      status: item.status || '',
      amount: amount(item.amount),
      token: item.tokenSymbol || '',
      amountIn: amount(item.amountIn),
      tokenIn: item.tokenIn || '',
      amountOut: amount(item.amountOut),
      tokenOut: item.tokenOut || '',
      sourceChain: item.sourceChain || '',
      destChain: item.destChain || '',
      recipient: text(item.recipient),
      txHash: item.txHash || '',
      destTxHash: item.destTxHash || '',
      memo: text(item.memo),
      memoId: text(item.memoId),
      pool: text(item.poolName || item.poolId),
      service: text(item.serviceName || item.serviceId),
      isPrivate: item.isPrivate ? 'true' : 'false',
    }
  })
}

/** RFC-4180 field escaping: quote commas, quotes and newlines; double inner quotes. */
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/**
 * CSV with a header row, CRLF line endings and RFC-4180 escaping.
 * No BOM here — the download helper adds one so Excel reads UTF-8 correctly.
 */
export function historyToCsv(items: HistoryItem[], options: HistoryExportOptions): string {
  const rows = toHistoryExportRows(items, options)
  const lines = rows.map((row) =>
    HISTORY_EXPORT_COLUMNS.map((column) => escapeCsvField(row[column])).join(',')
  )
  return [HISTORY_EXPORT_COLUMNS.join(','), ...lines].join('\r\n')
}

/** Pretty-printed JSON of the same rows, so a CSV and a JSON export always agree. */
export function historyToJson(items: HistoryItem[], options: HistoryExportOptions): string {
  return JSON.stringify(toHistoryExportRows(items, options), null, 2)
}

/** `arcis-history-<first 6 of the address>-<YYYY-MM-DD>.<ext>`, filesystem-safe. */
export function buildHistoryFilename(walletAddress: string, format: HistoryExportFormat): string {
  const tag =
    (walletAddress || '')
      .trim()
      .toLowerCase()
      .slice(0, 6)
      .replace(/[^a-z0-9]/g, '') || 'wallet'
  const day = new Date().toISOString().slice(0, 10)
  return `arcis-history-${tag}-${day}.${format === 'json' ? 'json' : 'csv'}`
}

/**
 * Triggers a browser download of the given rows. Returns false when there is no
 * DOM (SSR/tests) so callers can stay silent instead of throwing.
 */
export function downloadHistory(
  items: HistoryItem[],
  options: HistoryExportOptions,
  format: HistoryExportFormat,
  walletAddress: string
): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false
  }

  const isCsv = format !== 'json'
  const body = isCsv ? historyToCsv(items, options) : historyToJson(items, options)
  const blob = new Blob([isCsv ? `\uFEFF${body}` : body], {
    type: isCsv ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8',
  })

  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = buildHistoryFilename(walletAddress, isCsv ? 'csv' : 'json')
    anchor.rel = 'noopener'
    anchor.style.display = 'none'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    return true
  } finally {
    // Release the blob on the next tick so the download has started.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
