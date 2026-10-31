import { describe, expect, it } from 'vitest'
import type { HistoryItem } from '../../../utils/history'
import { isDisplayableHistoryItem } from '../historyHelpers'

const WALLET = '0xAbCdEf0000000000000000000000000000000001'

const item = (overrides: Partial<HistoryItem>): HistoryItem =>
  ({ id: 'row-1', timestamp: 1, type: 'send', amount: '1', ...overrides } as HistoryItem)

describe('isDisplayableHistoryItem', () => {
  it('rejects every row when no wallet is active', () => {
    expect(isDisplayableHistoryItem(item({ userAddress: WALLET }), '')).toBe(false)
  })

  it('accepts the wallet’s settled rows as sender or recipient', () => {
    expect(isDisplayableHistoryItem(item({ userAddress: WALLET, status: 'success' }), WALLET)).toBe(
      true
    )
    expect(isDisplayableHistoryItem(item({ recipient: WALLET, status: 'success' }), WALLET)).toBe(
      true
    )
  })

  it('matches addresses case-insensitively and ignores surrounding whitespace', () => {
    expect(
      isDisplayableHistoryItem(item({ userAddress: WALLET.toUpperCase() }), `  ${WALLET}  `)
    ).toBe(true)
  })

  it('rejects another wallet’s row', () => {
    expect(
      isDisplayableHistoryItem(
        item({ userAddress: '0x9999990000000000000000000000000000000001' }),
        WALLET
      )
    ).toBe(false)
  })

  it('rejects pending and failed rows so they cannot count as records', () => {
    expect(isDisplayableHistoryItem(item({ userAddress: WALLET, status: 'pending' }), WALLET)).toBe(
      false
    )
    expect(isDisplayableHistoryItem(item({ userAddress: WALLET, status: 'failed' }), WALLET)).toBe(
      false
    )
  })

  it('keeps legacy rows without a status field', () => {
    expect(isDisplayableHistoryItem(item({ userAddress: WALLET }), WALLET)).toBe(true)
  })
})
