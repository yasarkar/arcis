import { describe, it, expect } from 'vitest'
import { isTransactionalAction } from '../useArcCopilot'

describe('Ask Arco Session Gating & isTransactionalAction', () => {
  it('correctly classifies on-chain transactional actions requiring active session', () => {
    expect(isTransactionalAction('swap')).toBe(true)
    expect(isTransactionalAction('trade')).toBe(true)
    expect(isTransactionalAction('interactive_swap')).toBe(true)
    expect(isTransactionalAction('bridge')).toBe(true)
    expect(isTransactionalAction('interactive_bridge')).toBe(true)
    expect(isTransactionalAction('send')).toBe(true)
    expect(isTransactionalAction('interactive_send')).toBe(true)
    expect(isTransactionalAction('deposit')).toBe(true)
    expect(isTransactionalAction('zap')).toBe(true)
    expect(isTransactionalAction('interactive_deposit')).toBe(true)
  })

  it('correctly identifies non-transactional / read-only actions that do not require session', () => {
    expect(isTransactionalAction('configure_session')).toBe(false)
    expect(isTransactionalAction('view_pool')).toBe(false)
    expect(isTransactionalAction('code')).toBe(false)
    expect(isTransactionalAction('ai-services')).toBe(false)
    expect(isTransactionalAction(undefined)).toBe(false)
    expect(isTransactionalAction('')).toBe(false)
  })
})
