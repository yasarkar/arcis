// src/utils/__tests__/errorUtils.test.ts
// Coverage for receipt-level cancellation classification and cancel copy.

import { describe, it, expect } from 'vitest'
import { isCanceledReceipt, canceledActionTitle, formatCopilotError } from '../errorUtils'
import { USER_CANCELED_MESSAGE, USER_CANCELED_TITLE } from '../../config/errorMessages'

describe('isCanceledReceipt', () => {
  it('honors the explicit CANCELED status', () => {
    expect(isCanceledReceipt({ status: 'CANCELED', errorMessage: '' })).toBe(true)
  })

  it('detects a cancellation even when a path only recorded FAILED', () => {
    expect(isCanceledReceipt({ status: 'FAILED', errorMessage: 'User rejected the request' })).toBe(true)
    expect(isCanceledReceipt({ status: 'FAILED', errorMessage: 'Kullanıcı iptal edildi' })).toBe(true)
    expect(isCanceledReceipt({ status: 'FAILED', errorMessage: 'Transaction was cancelled by user' })).toBe(true)
  })

  it('does not misclassify real errors or successes as cancellations', () => {
    expect(isCanceledReceipt({ status: 'FAILED', errorMessage: 'Insufficient USDC balance' })).toBe(false)
    expect(isCanceledReceipt({ status: 'SUCCESS', errorMessage: '' })).toBe(false)
    expect(isCanceledReceipt(null)).toBe(false)
    expect(isCanceledReceipt(undefined)).toBe(false)
  })
})

describe('canceledActionTitle', () => {
  it('names the action so a dismissed transfer reads "Transfer Cancelled", not "Transfer Failed"', () => {
    expect(canceledActionTitle('send')).toBe('Transfer Cancelled')
    expect(canceledActionTitle('swap')).toBe('Swap Cancelled')
    expect(canceledActionTitle('deposit')).toBe('Deposit Cancelled')
    expect(canceledActionTitle('bridge')).toBe('Bridge Cancelled')
    expect(canceledActionTitle('faucet')).toBe('Faucet Claim Cancelled')
  })

  it('falls back to a generic title for unknown or missing action types', () => {
    expect(canceledActionTitle('configure_session')).toBe('Transaction Cancelled')
    expect(canceledActionTitle()).toBe(USER_CANCELED_TITLE)
  })
})

describe('formatCopilotError cancellation copy', () => {
  it('maps a wallet rejection to the canonical cancel title + retry subtext', () => {
    const result = formatCopilotError({ code: 4001, message: 'User rejected the request' })

    expect(result.isCanceled).toBe(true)
    expect(result.title).toBe(USER_CANCELED_TITLE)
    expect(result.message).toBe(USER_CANCELED_MESSAGE)
    expect(result.message).toBe('Transaction canceled by user. Try again whenever you are ready.')
  })
})
