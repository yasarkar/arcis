import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  kvCreateProviderSettlementIntent,
  kvFailPendingProviderSettlement,
  kvGet,
  kvGetPendingProviderSettlement,
  kvMarkProviderSettlementAccepted,
  kvConfirmPendingProviderSettlement,
  kvRejectProviderSettlementIntent,
} from '../redisStorage'

let sequence = 0
let fixture: {
  provider: string
  payer: string
  nonce: string
  transferId: string
  providerKey: string
  pendingKey: string
  nonceKey: string
}

function intent() {
  return {
    providerAddress: fixture.provider,
    payerAddress: fixture.payer,
    serviceId: 'arc-test-service',
    amountMicros: 5000,
    amountUsdc: 0.005,
    nonce: fixture.nonce,
    status: 'settling' as const,
    createdAt: Date.now(),
  }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('NODE_ENV', 'test')
  sequence += 1
  fixture = {
    provider: `0x${sequence.toString(16).padStart(40, '0')}`,
    payer: `0x${(sequence + 1).toString(16).padStart(40, '0')}`,
    nonce: `0x${sequence.toString(16).padStart(64, '0')}`,
    transferId: `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`,
    providerKey: `arcis:x402:provider:{0x${sequence.toString(16).padStart(40, '0')}}`,
    pendingKey: `arcis:x402:pending:{0x${sequence.toString(16).padStart(40, '0')}}:0x${sequence.toString(16).padStart(64, '0')}`,
    nonceKey: `arcis:x402:nonce:{0x${sequence.toString(16).padStart(40, '0')}}:0x${sequence.toString(16).padStart(64, '0')}`,
  }
})

describe('Circle Gateway settlement intent storage', () => {
  it('reserves a nonce, promotes the intent once, then confirms idempotently', async () => {
    expect(await kvCreateProviderSettlementIntent(fixture.providerKey, fixture.pendingKey, fixture.nonceKey, intent())).toBe('created')
    expect(await kvCreateProviderSettlementIntent(fixture.providerKey, fixture.pendingKey, fixture.nonceKey, intent())).toBe('duplicate')
    expect(await kvMarkProviderSettlementAccepted(fixture.providerKey, fixture.pendingKey, 'opaque-circle-ref')).toBe('pending')
    expect(await kvMarkProviderSettlementAccepted(fixture.providerKey, fixture.pendingKey, 'opaque-circle-ref')).toBe('already_pending')
    expect(await kvMarkProviderSettlementAccepted(fixture.providerKey, fixture.pendingKey, 'different-ref')).toBe('unavailable')
    expect((await kvGetPendingProviderSettlement(fixture.pendingKey))?.status).toBe('pending')
    expect(await kvGet(fixture.providerKey)).toMatch(/"pendingUsdc":0.005/)

    expect(await kvConfirmPendingProviderSettlement(fixture.providerKey, fixture.pendingKey, fixture.transferId, `0x${'d'.repeat(64)}`)).toBe('confirmed')
    expect(await kvConfirmPendingProviderSettlement(fixture.providerKey, fixture.pendingKey, fixture.transferId, undefined)).toBe('already_confirmed')
    expect(await kvConfirmPendingProviderSettlement(fixture.providerKey, fixture.pendingKey, `${fixture.transferId.slice(0, -1)}2`, undefined)).toBe('unavailable')
    const ledger = JSON.parse((await kvGet(fixture.providerKey)) || '{}')
    expect(ledger.pendingUsdc).toBe(0)
    expect(ledger.totalUsdcEarned).toBe(0.005)
    expect(ledger.unclaimedEarningsUsdc).toBe(0.005)
  })

  it('releases a matching failed transfer once without crediting earnings', async () => {
    expect(await kvCreateProviderSettlementIntent(fixture.providerKey, fixture.pendingKey, fixture.nonceKey, intent())).toBe('created')
    expect(await kvMarkProviderSettlementAccepted(fixture.providerKey, fixture.pendingKey, 'opaque-circle-ref')).toBe('pending')
    expect(await kvFailPendingProviderSettlement(fixture.providerKey, fixture.pendingKey, fixture.transferId)).toBe('failed')
    expect(await kvFailPendingProviderSettlement(fixture.providerKey, fixture.pendingKey, fixture.transferId)).toBe('already_failed')
    expect(await kvFailPendingProviderSettlement(fixture.providerKey, fixture.pendingKey, '00000000-0000-4000-8000-ffffffffffff')).toBe('unavailable')
    const ledger = JSON.parse((await kvGet(fixture.providerKey)) || '{}')
    expect(ledger.pendingUsdc).toBe(0)
    expect(ledger.totalUsdcEarned).toBe(0)
    expect(ledger.unclaimedEarningsUsdc).toBe(0)
  })

  it('does not accept a facilitator-rejected intent later', async () => {
    expect(await kvCreateProviderSettlementIntent(fixture.providerKey, fixture.pendingKey, fixture.nonceKey, intent())).toBe('created')
    expect(await kvRejectProviderSettlementIntent(fixture.pendingKey)).toBe('failed')
    expect((await kvGetPendingProviderSettlement(fixture.pendingKey))?.status).toBe('failed')
    expect(await kvMarkProviderSettlementAccepted(fixture.providerKey, fixture.pendingKey, 'late-acceptance')).toBe('unavailable')
    expect(await kvGet(fixture.providerKey)).toBeNull()
  })

  it('rejects cross-provider keys, invalid amounts, and non-UUID transfer confirmation', async () => {
    const otherProviderKey = `arcis:x402:provider:{0x${'e'.repeat(40)}}`
    expect(await kvCreateProviderSettlementIntent(otherProviderKey, fixture.pendingKey, fixture.nonceKey, intent())).toBe('unavailable')
    expect(await kvCreateProviderSettlementIntent(fixture.providerKey, fixture.pendingKey, fixture.nonceKey, { ...intent(), amountUsdc: 0.5 })).toBe('unavailable')
    expect(await kvCreateProviderSettlementIntent(fixture.providerKey, fixture.pendingKey, fixture.nonceKey, intent())).toBe('created')
    expect(await kvMarkProviderSettlementAccepted(fixture.providerKey, fixture.pendingKey, 'opaque-circle-ref')).toBe('pending')
    expect(await kvConfirmPendingProviderSettlement(fixture.providerKey, fixture.pendingKey, 'not-a-transfer-id', undefined)).toBe('unavailable')
  })
})
