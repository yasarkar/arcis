import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recoverTypedDataAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { PROVIDER_LEDGER_TYPES, X402_AUTHORIZATION_DOMAIN } from '../../../config/x402/authorization'
import { withdrawProviderEarningsApi } from '../../x402PaymentEngine'
import {
  buildProviderLedgerTypedData,
  providerSignerErrorMessage,
  resolveProviderSigner,
  signProviderLedgerAuthorization,
} from '../providerAuthorization'

const PROVIDER = '0x1111111111111111111111111111111111111111'
const SIGNATURE: Hex = `0x${'ab'.repeat(65)}`

// The engine syncs a browser-local earnings cache after a successful withdrawal.
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockChallenge(signature: Hex = SIGNATURE) {
  return vi.fn(async (_params: any) => ({ success: true, signature }))
}

describe('resolveProviderSigner', () => {
  it('routes an injected EVM wallet to its provider signer', () => {
    const resolved = resolveProviderSigner({
      authSource: 'evm',
      walletAddress: PROVIDER,
      provider: { request: vi.fn() },
      memo: 'listing',
    })
    expect(resolved.ok && resolved.kind).toBe('evm')
  })

  it('routes a Circle Wallet through its typed-data challenge', () => {
    const resolved = resolveProviderSigner({
      authSource: 'ucw',
      walletAddress: PROVIDER,
      ucwSignTypedData: mockChallenge(),
      memo: 'listing',
    })
    expect(resolved.ok && resolved.kind).toBe('ucw')
  })

  it('refuses a passkey wallet, a signer-less UCW session, and a missing wallet', () => {
    expect(resolveProviderSigner({ authSource: 'passkey', walletAddress: PROVIDER, ucwSignTypedData: mockChallenge(), memo: 'x' }))
      .toEqual({ ok: false, reason: 'passkey' })
    expect(resolveProviderSigner({ authSource: 'ucw', walletAddress: PROVIDER, memo: 'x' }))
      .toEqual({ ok: false, reason: 'ucw_session' })
    expect(resolveProviderSigner({ authSource: 'evm', memo: 'x', allowWindowFallback: false }))
      .toEqual({ ok: false, reason: 'no_wallet' })
    expect(resolveProviderSigner({ authSource: 'evm', walletAddress: PROVIDER, memo: 'x', allowWindowFallback: false }))
      .toEqual({ ok: false, reason: 'no_provider' })
  })

  it('explains every refusal', () => {
    for (const reason of ['no_wallet', 'passkey', 'ucw_session', 'no_provider'] as const) {
      expect(providerSignerErrorMessage(reason).length).toBeGreaterThan(10)
    }
    expect(providerSignerErrorMessage('passkey')).toMatch(/Passkey wallets cannot sign/i)
    expect(providerSignerErrorMessage('ucw_session')).toMatch(/sign in again/i)
    expect(providerSignerErrorMessage('no_provider')).toMatch(/Connect the provider wallet/i)
  })
})

describe('buildProviderLedgerTypedData', () => {
  it('binds the provider, the micro-USDC amount, the nonce and the deadline', () => {
    const typedData = buildProviderLedgerTypedData({
      providerAddress: PROVIDER,
      amountUsdc: 2.5,
      nonce: `0x${'cd'.repeat(32)}`,
      deadline: 1_800_000_000,
    })

    expect(typedData.domain).toBe(X402_AUTHORIZATION_DOMAIN)
    expect(typedData.types).toBe(PROVIDER_LEDGER_TYPES)
    expect(typedData.primaryType).toBe('ProviderLedgerAuthorization')
    expect(typedData.message).toEqual({
      providerAddress: PROVIDER,
      amountMicros: 2_500_000n,
      nonce: `0x${'cd'.repeat(32)}`,
      deadline: 1_800_000_000n,
    })
  })

  it('signs through a Circle UCW EOA so the server recovers the provider address', async () => {
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
    const challenge = vi.fn(async ({ data }: any) => ({ success: true, signature: await account.signTypedData(data) }))
    const resolved = resolveProviderSigner({
      authSource: 'ucw',
      walletAddress: account.address,
      ucwSignTypedData: challenge,
      memo: 'Arcis provider withdrawal: 2 USDC',
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    const proof = await signProviderLedgerAuthorization({
      providerAddress: account.address,
      amountUsdc: 2,
      signTypedData: resolved.signer,
    })

    const sent = challenge.mock.calls[0][0]
    expect(sent.memo).toBe('Arcis provider withdrawal: 2 USDC')
    expect(sent.blockchain).toBe('ARC-TESTNET')
    expect(sent.data.types.EIP712Domain).toHaveLength(Object.keys(sent.data.domain).length)
    expect(sent.data.message.amountMicros).toBe('2000000')
    expect(typeof sent.data.message.deadline).toBe('string')

    const recovered = await recoverTypedDataAddress({
      domain: X402_AUTHORIZATION_DOMAIN,
      types: PROVIDER_LEDGER_TYPES,
      primaryType: 'ProviderLedgerAuthorization',
      message: {
        providerAddress: account.address,
        amountMicros: 2_000_000n,
        nonce: proof.nonce,
        deadline: BigInt(proof.deadline),
      },
      signature: proof.signature,
    })
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
  })
})

describe('withdrawProviderEarningsApi — payer parity', () => {
  it('withdraws through a Circle UCW wallet and posts a recoverable authorization', async () => {
    const account = privateKeyToAccount(`0x${'22'.repeat(32)}`)
    const challenge = vi.fn(async ({ data }: any) => ({ success: true, signature: await account.signTypedData(data) }))
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true, remainingBalanceUsdc: 0, totalWithdrawnUsdc: 2 }), { status: 200 })
    )

    try {
      const res = await withdrawProviderEarningsApi(account.address, 2, null, {
        authSource: 'ucw',
        ucwSignTypedData: challenge,
      })
      expect(res.success).toBe(true)
      expect(challenge).toHaveBeenCalledTimes(1)

      const body = JSON.parse((fetchSpy.mock.calls[0][1] as any).body)
      expect(body.providerAddress).toBe(account.address)
      expect(body.amountUsdc).toBe(2)
      expect(body.nonce).toMatch(/^0x[0-9a-f]{64}$/)

      // The exact recovery api/x402.ts performs on /withdraw.
      const recovered = await recoverTypedDataAddress({
        domain: X402_AUTHORIZATION_DOMAIN,
        types: PROVIDER_LEDGER_TYPES,
        primaryType: 'ProviderLedgerAuthorization',
        message: {
          providerAddress: account.address.toLowerCase() as `0x${string}`,
          amountMicros: 2_000_000n,
          nonce: body.nonce,
          deadline: BigInt(body.deadline),
        },
        signature: body.signature,
      })
      expect(recovered.toLowerCase()).toBe(account.address.toLowerCase())
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('refuses a UCW session that cannot sign and never posts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const res = await withdrawProviderEarningsApi(PROVIDER, 1, null, { authSource: 'ucw' })
      expect(res.success).toBe(false)
      expect(res.error).toMatch(/Circle Wallet session cannot sign/i)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('refuses a passkey wallet before signing', async () => {
    const res = await withdrawProviderEarningsApi(PROVIDER, 1, null, {
      authSource: 'passkey',
      ucwSignTypedData: mockChallenge(),
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Passkey wallets cannot sign/i)
  })
})
