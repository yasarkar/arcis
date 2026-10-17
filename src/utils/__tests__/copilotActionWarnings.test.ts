// src/utils/__tests__/copilotActionWarnings.test.ts
// ARC-025: the copilot action card is the only confirmation screen before a session key signs, so
// these thresholds are a safety control, not decoration. Each one is pinned at its boundary:
// exactly-half is allowed, more than half warns; exactly 1% is allowed, more warns; an unknown
// balance or an unresolved recipient never invents a warning.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  HIGH_SLIPPAGE_BPS,
  LARGE_SHARE_THRESHOLD,
  availableBalanceFor,
  depositActionWarnings,
  highSlippageWarning,
  isFirstTimeRecipient,
  largeShareWarning,
  newRecipientWarning,
  sendActionWarnings,
  swapActionWarnings,
  warningTokenKey,
} from '../copilotActionWarnings'
import { COPILOT_EXECUTION_POLICY } from '../copilotExecutionPolicy'

const RECIPIENT = '0x5f8f4cc0403332fc9c22a23222ddb9b267bf2e70'

describe('new recipient warning', () => {
  it('flags an address that is not in the saved list', () => {
    expect(isFirstTimeRecipient(RECIPIENT, [])).toBe(true)
    const warning = newRecipientWarning(RECIPIENT, [])
    expect(warning?.code).toBe('new-recipient')
    expect(warning?.message).toMatch(/First transfer/i)
  })

  it('stays quiet for an address the user already sent to (case-insensitive)', () => {
    expect(isFirstTimeRecipient(RECIPIENT, [RECIPIENT.toUpperCase().replace('0X', '0x')])).toBe(false)
    expect(newRecipientWarning(RECIPIENT, [RECIPIENT])).toBeNull()
  })

  it('never warns without a recipient', () => {
    expect(isFirstTimeRecipient('', [])).toBe(false)
    expect(newRecipientWarning(undefined, [])).toBeNull()
  })
})

describe('share of balance warning', () => {
  it('warns strictly above half the available balance', () => {
    expect(largeShareWarning(51, 100, 'USDC')?.code).toBe('large-share-of-balance')
    expect(largeShareWarning(50, 100, 'USDC')).toBeNull()
    expect(largeShareWarning(10, 100, 'USDC')).toBeNull()
  })

  it('reports the share and the available amount', () => {
    const message = largeShareWarning(75, 100, 'USDC')?.message ?? ''
    expect(message).toContain('75%')
    expect(message).toContain('100')
  })

  it('does not invent a warning from an unknown, zero or negative balance', () => {
    expect(largeShareWarning(75, null, 'USDC')).toBeNull()
    expect(largeShareWarning(75, undefined, 'USDC')).toBeNull()
    expect(largeShareWarning(75, 0, 'USDC')).toBeNull()
    expect(largeShareWarning(75, -5, 'USDC')).toBeNull()
    expect(largeShareWarning(0, 100, 'USDC')).toBeNull()
  })
})

describe('slippage warning', () => {
  it('warns above the caution line and not at it', () => {
    expect(HIGH_SLIPPAGE_BPS).toBe(100)
    expect(highSlippageWarning(100)).toBeNull()
    expect(highSlippageWarning(101)?.code).toBe('high-slippage')
    expect(highSlippageWarning(200)?.message).toContain('2%')
  })

  it('ignores an unreadable tolerance instead of guessing one', () => {
    expect(highSlippageWarning(undefined)).toBeNull()
    expect(highSlippageWarning(null)).toBeNull()
    expect(highSlippageWarning(Number.NaN)).toBeNull()
    expect(highSlippageWarning(10.5)).toBeNull()
  })
})

describe('balance keys', () => {
  it('maps chat symbols onto the snapshot fields', () => {
    expect(warningTokenKey('weth')).toBe('WETH')
    expect(warningTokenKey('BTC')).toBe('cirBTC')
    expect(warningTokenKey('cirBTC')).toBe('cirBTC')
    expect(warningTokenKey('')).toBeNull()
  })

  it('reads only a finite number', () => {
    const balances = { USDC: 12.5, EURC: Number.NaN, WETH: undefined, cirBTC: 0.001 }
    expect(availableBalanceFor(balances, 'USDC')).toBe(12.5)
    expect(availableBalanceFor(balances, 'EURC')).toBeNull()
    expect(availableBalanceFor(balances, 'WETH')).toBeNull()
    expect(availableBalanceFor(balances, 'cirBTC')).toBe(0.001)
    expect(availableBalanceFor(null, 'USDC')).toBeNull()
  })
})

describe('composed warning sets', () => {
  it('send: recipient plus balance share', () => {
    const warnings = sendActionWarnings({
      amount: 80,
      tokenSymbol: 'USDC',
      recipient: RECIPIENT,
      savedAddresses: [],
      balances: { USDC: 100 },
    })
    expect(warnings.map((w) => w.code).sort()).toEqual(['large-share-of-balance', 'new-recipient'])
  })

  it('send: a known recipient inside the balance produces no warning', () => {
    expect(
      sendActionWarnings({
        amount: 10,
        tokenSymbol: 'USDC',
        recipient: RECIPIENT,
        savedAddresses: [RECIPIENT],
        balances: { USDC: 100 },
      })
    ).toEqual([])
  })

  it('swap: slippage and the source-token share', () => {
    const warnings = swapActionWarnings({
      amount: 60,
      fromToken: 'EURC',
      slippageBps: 150,
      balances: { EURC: 100 },
    })
    expect(warnings.map((w) => w.code).sort()).toEqual(['high-slippage', 'large-share-of-balance'])
  })

  it('deposit: only the balance-share warning applies', () => {
    expect(depositActionWarnings({ amount: 90, balances: { USDC: 100 } }).map((w) => w.code)).toEqual([
      'large-share-of-balance',
    ])
    expect(depositActionWarnings({ amount: 10, balances: { USDC: 100 } })).toEqual([])
  })
})

describe('shared execution policy (system prompt scope)', () => {
  it('keeps the transactional half and states its boundary', () => {
    expect(COPILOT_EXECUTION_POLICY).toMatch(/never answer such a command with a faucet message/)
    expect(COPILOT_EXECUTION_POLICY).toMatch(/never authorises/)
    expect(COPILOT_EXECUTION_POLICY).toMatch(/negated/)
    expect(COPILOT_EXECUTION_POLICY).not.toMatch(/ALWAYS execute/)
    expect(COPILOT_EXECUTION_POLICY).not.toMatch(/NEVER refuse/)
  })

  it('is the only execution-policy source for both prompt builders', () => {
    for (const file of ['api/copilot.ts', 'src/services/llmService.ts']) {
      const source = readFileSync(path.resolve(process.cwd(), file), 'utf8')
      expect(source).toContain('COPILOT_EXECUTION_POLICY')
      expect(source).not.toMatch(/ALWAYS execute explicit user transactional commands/)
    }
  })
})
