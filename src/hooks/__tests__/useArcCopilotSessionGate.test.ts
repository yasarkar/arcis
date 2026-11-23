import { describe, it, expect } from 'vitest'
import { isTransactionalAction } from '../useArcCopilot'
import { isSettingsSyncableDraft } from '../../services/copilot/copilotDraftSync'

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

  it('keeps interactive_lp_remove and interactive_claim_fees exempt from session gating while allowing live settings sync (ARCO-06)', () => {
    expect(isTransactionalAction('interactive_lp_remove')).toBe(false)
    expect(isTransactionalAction('interactive_claim_fees')).toBe(false)
    expect(
      isSettingsSyncableDraft({
        type: 'interactive_lp_remove',
        title: 'Remove LP',
        data: { poolId: 'usdc-eurc-v4', removePercent: 50 },
      })
    ).toBe(true)
    expect(
      isSettingsSyncableDraft({
        type: 'interactive_claim_fees',
        title: 'Claim All Fees',
        data: {
          claimPools: [
            {
              poolId: 'usdc-eurc-stable-pool',
              poolName: 'USDC / EURC',
              poolAddress: '0x1111111111111111111111111111111111111111',
              isVault: false,
              tokenA: 'USDC',
              tokenB: 'EURC',
              feeADecimal: '1.2',
              feeARaw: '1200000',
              estimatedUsd: 1.2,
            },
          ],
        },
      })
    ).toBe(true)
  })
})
