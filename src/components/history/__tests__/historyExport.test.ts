import { describe, it, expect } from 'vitest'
import type { HistoryItem } from '../../../utils/history'
import {
  HISTORY_EXPORT_COLUMNS,
  buildHistoryFilename,
  downloadHistory,
  historyToCsv,
  historyToJson,
  toHistoryExportRows,
} from '../historyExport'

// P1-5: the CSV/JSON export must mirror the filtered table exactly, escape values
// an accountant's spreadsheet can still open, and never leak a masked value.

const timestamp = Date.UTC(2026, 9, 5, 12, 30, 0) // 2026-10-05T12:30:00.000Z

function item(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: 'tx-1',
    type: 'send',
    txHash: '0x' + 'ab'.repeat(32),
    amount: '25',
    tokenSymbol: 'USDC',
    sourceChain: 'Arc_Testnet',
    recipient: '0x' + 'cd'.repeat(20),
    userAddress: '0x' + 'ef'.repeat(20),
    timestamp,
    status: 'success',
    ...overrides,
  }
}

const open = { masked: false, maskSymbol: '••••' }

describe('toHistoryExportRows', () => {
  it('projects every history field onto the flat export shape', () => {
    const [row] = toHistoryExportRows(
      [
        item({
          type: 'swap',
          amountIn: '10',
          tokenIn: 'USDC',
          amountOut: '0.004',
          tokenOut: 'wETH',
          destChain: 'Base_Sepolia',
          memo: 'invoice 42',
          memoId: 'memo-42',
          poolName: 'USDC / EURC',
          serviceName: 'arc-yield',
        }),
      ],
      open
    )

    expect(row.date).toBe('2026-10-05T12:30:00.000Z')
    expect(row.type).toBe('swap')
    expect(row.status).toBe('success')
    expect(row.amountIn).toBe('10')
    expect(row.amountOut).toBe('0.004')
    expect(row.tokenOut).toBe('wETH')
    expect(row.destChain).toBe('Base_Sepolia')
    expect(row.memo).toBe('invoice 42')
    expect(row.memoId).toBe('memo-42')
    expect(row.pool).toBe('USDC / EURC')
    expect(row.service).toBe('arc-yield')
    expect(row.isPrivate).toBe('false')
  })

  it('masks amounts, recipient, memo, pool and service when privacy is on', () => {
    const [row] = toHistoryExportRows(
      [
        item({
          amountIn: '10',
          amountOut: '9.9',
          memo: 'rent',
          memoId: 'memo-1',
          poolName: 'USDC / EURC',
          serviceName: 'arc-yield',
          isPrivate: false,
        }),
      ],
      { masked: true, maskSymbol: '###' }
    )

    expect(row.amount).toBe('###')
    expect(row.amountIn).toBe('###')
    expect(row.amountOut).toBe('###')
    expect(row.recipient).toBe('*****')
    expect(row.memo).toBe('*****')
    expect(row.memoId).toBe('*****')
    expect(row.pool).toBe('*****')
    expect(row.service).toBe('*****')
    // Public on-chain data and the asset label stay.
    expect(row.txHash).toBe('0x' + 'ab'.repeat(32))
    expect(row.token).toBe('USDC')
  })

  it('masks a private row even when the export itself is not masked', () => {
    const [row] = toHistoryExportRows([item({ isPrivate: true, memo: 'secret' })], open)

    expect(row.amount).toBe(open.maskSymbol)
    expect(row.recipient).toBe('*****')
    expect(row.memo).toBe('*****')
    expect(row.isPrivate).toBe('true')
  })

  it('falls back to the masked placeholder when no mask symbol is configured', () => {
    const [row] = toHistoryExportRows([item({ isPrivate: true })], { masked: true, maskSymbol: '  ' })
    expect(row.amount).toBe('*****')
  })

  it('keeps empty optional fields empty instead of masking nothing', () => {
    const [row] = toHistoryExportRows([item({ isPrivate: true })], open)
    expect(row.amountIn).toBe('')
    expect(row.destTxHash).toBe('')
  })
})

describe('historyToCsv', () => {
  it('writes the declared header order and one CRLF row per item', () => {
    const csv = historyToCsv([item(), item({ id: 'tx-2', txHash: '0x' + '12'.repeat(32) })], open)
    const lines = csv.split('\r\n')

    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(HISTORY_EXPORT_COLUMNS.join(','))
    expect(lines[0].split(',')).toHaveLength(HISTORY_EXPORT_COLUMNS.length)
  })

  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    const csv = historyToCsv(
      [item({ memo: 'He said "hi", then left', recipient: '0xabc,def' })],
      open
    )

    expect(csv).toContain('"He said ""hi"", then left"')
    expect(csv).toContain('"0xabc,def"')
  })

  it('keeps a newline inside one quoted field', () => {
    const csv = historyToCsv([item({ memo: 'line one\nline two' })], open)
    expect(csv).toContain('"line one\nline two"')
  })

  it('does not leak a masked memo into the file', () => {
    const csv = historyToCsv([item({ memo: 'rent for October', isPrivate: true })], open)
    expect(csv).not.toContain('rent for October')
  })
})

describe('historyToJson', () => {
  it('is the same rows as the CSV, parseable', () => {
    const items = [item(), item({ id: 'tx-2', type: 'bridge', destChain: 'Base_Sepolia' })]
    const parsed = JSON.parse(historyToJson(items, open))

    expect(parsed).toHaveLength(2)
    expect(Object.keys(parsed[0])).toEqual([...HISTORY_EXPORT_COLUMNS])
    expect(parsed[1].type).toBe('bridge')
    expect(parsed[1].destChain).toBe('Base_Sepolia')
  })
})

describe('buildHistoryFilename', () => {
  const today = new Date().toISOString().slice(0, 10)

  it('uses the first six address characters, lowercased', () => {
    expect(buildHistoryFilename('0x1234ABCD5678', 'csv')).toBe(`arcis-history-0x1234-${today}.csv`)
    expect(buildHistoryFilename('0x1234ABCD5678', 'json')).toBe(`arcis-history-0x1234-${today}.json`)
  })

  it('falls back to a filesystem-safe wallet tag', () => {
    expect(buildHistoryFilename('', 'csv')).toBe(`arcis-history-wallet-${today}.csv`)
    expect(buildHistoryFilename('  !!  ', 'csv')).toBe(`arcis-history-wallet-${today}.csv`)
  })
})

describe('downloadHistory', () => {
  it('returns false without a DOM instead of throwing', () => {
    expect(downloadHistory([item()], open, 'csv', '0x1234')).toBe(false)
  })
})
