// src/services/__tests__/bridgeTokenSdkContract.test.ts
//
// Contract guard for Circle App Kit's BRIDGE token support — deliberately does
// NOT mock `@circle-fin/app-kit` (every other bridge test does, which is how
// this bug hid: the mocked tests stayed green while the real SDK rejected the
// call before it ever reached our code).
//
// App Kit 1.11.0–1.14.0 validated the bridge token as `z.literal('USDC')`, so
// any non-USDC bridge call failed at param validation with:
//
//   Invalid parameters: token: Invalid literal value, expected "USDC"
//
// Non-USDC tokens (EURC, wETH, cirBTC) are only schema-accepted from App Kit
// 1.15.0 onward, where the field became:
//
//   token: bridgeTokenSchema = z.union([
//     z.enum(['USDC', ...KNOWN_TOKEN_SYMBOLS]),
//     z.string().regex(/^0x[0-9a-fA-F]{64}$/),   // bytes32 token id
//   ])
//
// Network is stubbed out for the non-USDC cases on purpose. App Kit resolves
// non-USDC routes through Circle's CCTP-X provider (a live call, ~3s each),
// which would make this suite slow and network-dependent. With `fetch` blocked,
// a token that clears param validation can only fail later at route resolution,
// so the union of "resolved or failed on route grounds" is exactly the proof
// that the token gate is open. USDC needs no network call at all (local route
// table), which is why it doubles as the environment anchor.

import { describe, expect, it } from 'vitest'
import { AppKit } from '@circle-fin/app-kit'

/** Pre-1.15 rejection this test must never see again. */
const USDC_LITERAL_REGRESSION = /token:\s*Invalid literal value|expected\s*"USDC"/

/** A non-USDC failure caused by unavailable route data, not by the token gate. */
const ROUTE_LEVEL_FAILURE = /Route support for|is not supported for token/

/**
 * Minimal adapter stub: satisfies App Kit's adapter contract so the call gets
 * past param/route validation and stops inside our stub instead of a wallet.
 */
const stubAdapter = {
  prepare: async () => ({}),
  waitForTransaction: async () => ({}),
  getAddress: async () => '0x1111111111111111111111111111111111111111',
  validateChainSupport: async () => ({}),
}

/**
 * Runs one real `estimateBridge` against Arc Testnet with outbound network
 * access disabled, and returns the error message (empty when it resolved).
 *
 * The amount is 1 token with a stub adapter, so a real transfer is impossible:
 * this exercises validation only, never a broadcast.
 */
async function estimateBridgeErrorOffline(token: string, destination: string): Promise<string> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('network disabled by bridgeTokenSdkContract test')
  }) as typeof fetch
  try {
    await new AppKit().estimateBridge({
      from: { adapter: stubAdapter, chain: 'Arc_Testnet' },
      to: {
        recipientAddress: '0x2222222222222222222222222222222222222222',
        chain: destination,
        useForwarder: true,
      },
      amount: '1',
      token,
    } as any)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    globalThis.fetch = originalFetch
  }
}

describe('App Kit bridge token contract (real SDK, unmocked)', () => {
  // Anchor: proves estimateBridge really runs in this environment, so the
  // negative assertions below cannot pass by being vacuous.
  it('resolves a USDC estimate on Arc Testnet without error', async () => {
    expect(await estimateBridgeErrorOffline('USDC', 'Base_Sepolia')).toBe('')
  })

  // The regression guard: these are the tokens App Kit rejected with
  // `expected "USDC"`. Reaching route resolution (or resolving outright) means
  // the token passed the schema that used to be USDC-only.
  it.each([
    ['EURC', 'Base_Sepolia'],
    ['EURC', 'Ethereum_Sepolia'],
    ['wETH', 'Ethereum_Sepolia'],
    ['cirBTC', 'Ethereum_Sepolia'],
  ])('does not reject %s as a non-USDC bridge token (Arc Testnet -> %s)', async (token, destination) => {
    const message = await estimateBridgeErrorOffline(token, destination)
    expect(message).not.toMatch(USDC_LITERAL_REGRESSION)
    expect(message === '' || ROUTE_LEVEL_FAILURE.test(message)).toBe(true)
  })
})
