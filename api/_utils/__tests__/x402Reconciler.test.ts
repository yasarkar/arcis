import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runReconcileSweep } from '../x402Reconciler'
import {
  kvCreateProviderSettlementIntent,
  kvMarkProviderSettlementAccepted,
  kvScanKeys,
  kvSetIfAbsent,
} from '../redisStorage'

vi.mock('../redisStorage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../redisStorage')>()
  return {
    ...actual,
    kvScanKeys: vi.fn(),
    kvSetIfAbsent: vi.fn(),
  }
})

let sequence = 0

function fixture() {
  sequence += 1
  const provider = `0x${(sequence + 100).toString(16).padStart(40, '0')}`
  const payer = `0x${(sequence + 200).toString(16).padStart(40, '0')}`
  const nonce = `0x${(sequence + 300).toString(16).padStart(64, '0')}`
  const transferId = `00000000-0000-4000-8000-${(sequence + 400).toString(16).padStart(12, '0')}`
  return {
    provider,
    payer,
    nonce,
    transferId,
    providerKey: `arcis:x402:provider:{${provider}}`,
    pendingKey: `arcis:x402:pending:{${provider}}:${nonce}`,
    nonceKey: `arcis:x402:nonce:{${provider}}:${nonce}`,
  }
}

async function seedPending(f: ReturnType<typeof fixture>) {
  expect(
    await kvCreateProviderSettlementIntent(f.providerKey, f.pendingKey, f.nonceKey, {
      providerAddress: f.provider,
      payerAddress: f.payer,
      serviceId: 'arc-test-service',
      amountMicros: 5000,
      amountUsdc: 0.005,
      nonce: f.nonce,
      status: 'settling' as const,
      createdAt: Date.now(),
    })
  ).toBe('created')
  expect(await kvMarkProviderSettlementAccepted(f.providerKey, f.pendingKey, 'opaque-circle-ref')).toBe('pending')
}

function stubCircle(transfers: unknown[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ transfers }) }))
}

describe('runReconcileSweep', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('X402_RECONCILE_ENABLED', 'true')
    vi.stubEnv('X402_RECONCILE_INTERVAL_MINUTES', '5')
    vi.stubEnv('X402_RECONCILE_BATCH_SIZE', '50')
    vi.mocked(kvScanKeys).mockReset()
    vi.mocked(kvScanKeys).mockResolvedValue([])
    vi.mocked(kvSetIfAbsent).mockReset()
    vi.mocked(kvSetIfAbsent).mockResolvedValue('acquired')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('reconciles a scanned pending record and reports the tally', async () => {
    const f = fixture()
    await seedPending(f)
    vi.mocked(kvScanKeys).mockResolvedValue([f.pendingKey])
    stubCircle([
      {
        nonce: f.nonce,
        status: 'confirmed',
        token: 'USDC',
        sendingNetwork: 'eip155:5042002',
        recipientNetwork: 'eip155:5042002',
        fromAddress: f.payer,
        toAddress: f.provider,
        amount: '0.005',
        id: f.transferId,
        txHash: `0x${'b'.repeat(64)}`,
      },
    ])

    const summary = await runReconcileSweep()
    expect(summary).toMatchObject({
      enabled: true,
      scanned: 1,
      attempted: 1,
      confirmed: 1,
      failed: 0,
      pending: 0,
      errors: 0,
    })
    expect(kvScanKeys).toHaveBeenCalledWith('arcis:x402:pending:{*}', 50)
    expect(kvSetIfAbsent).toHaveBeenCalledWith(`arcis:x402:reconcile:{${f.provider}}:${f.nonce}`, '1', 300)
  })

  it('skips a record whose per-nonce throttle is still active', async () => {
    const f = fixture()
    vi.mocked(kvScanKeys).mockResolvedValue([f.pendingKey])
    vi.mocked(kvSetIfAbsent).mockResolvedValue('exists')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const summary = await runReconcileSweep()
    expect(summary).toMatchObject({ scanned: 1, attempted: 0, skipped: 1, errors: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips instead of reconciling when shared storage cannot take the throttle', async () => {
    vi.mocked(kvScanKeys).mockResolvedValue([`arcis:x402:pending:{${'1'.repeat(40)}}:0x${'1'.repeat(64)}`])
    vi.mocked(kvSetIfAbsent).mockResolvedValue('unavailable')
    const summary = await runReconcileSweep()
    expect(summary).toMatchObject({ attempted: 0, skipped: 1, errors: 0 })
  })

  it('ignores keys that are not pending-settlement records', async () => {
    vi.mocked(kvScanKeys).mockResolvedValue(['arcis:x402:pending:garbage'])
    const summary = await runReconcileSweep()
    expect(summary).toMatchObject({ scanned: 1, attempted: 0, skipped: 1 })
  })

  it('does nothing when the reconciler is disabled', async () => {
    vi.stubEnv('X402_RECONCILE_ENABLED', 'false')
    const summary = await runReconcileSweep()
    expect(summary.enabled).toBe(false)
    expect(kvScanKeys).not.toHaveBeenCalled()
  })
})
