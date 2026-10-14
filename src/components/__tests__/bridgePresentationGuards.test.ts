// src/components/__tests__/bridgePresentationGuards.test.ts
//
// Guards for the user-visible bridge surfaces that the audit found were
// *honest in the receipt but not in the preview* — plus the cleanup guards that
// keep the removed dead paths from creeping back. Source-scan tests are used
// deliberately: these were all "two implementations disagree" or "dead branch"
// bugs that only a structural assertion can catch.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { formatFeeDecimals } from '../../utils/tokenUtils'
import { getBridgePlatformFeeValue, BRIDGE_CUSTOM_FEE_CONFIG } from '../../config/fees'

const bridgeModalSource = readFileSync(new URL('../BridgeModal.tsx', import.meta.url), 'utf8')
const bridgeServiceSource = readFileSync(new URL('../../services/bridgeService.ts', import.meta.url), 'utf8')
const bridgeUcwSource = readFileSync(new URL('../../services/bridgeUcwService.ts', import.meta.url), 'utf8')

describe('bridge fee presentation parity (D1)', () => {
  // The estimate once rendered `platformFeeAmount.toFixed(2)` while execution
  // and the receipt used `formatFeeDecimals` — so the fee shown and the fee
  // charged could differ at the 3rd/4th decimal. One formatter now serves both.
  it('no longer rounds the platform fee to 2 decimals anywhere in the modal', () => {
    expect(bridgeModalSource).not.toContain('platformFeeAmount.toFixed(2)')
  })

  it('formats the platform fee through the shared fee formatter', () => {
    expect(bridgeModalSource).toContain('formatFeeDecimals(platformFeeAmount)')
  })

  it('preserves the fee value it displays, without collapsing it to cents', () => {
    const fee = getBridgePlatformFeeValue(211)
    const displayed = formatFeeDecimals(fee)
    // Re-parsing what the user sees must give back the amount that is charged.
    expect(Number(displayed)).toBe(fee)
    // And the display must not be a cent-rounded version of it when it is not.
    const cents = Number(fee.toFixed(2))
    if (cents !== fee) expect(Number(displayed)).not.toBe(cents)
    expect(Number.isFinite(Number(displayed))).toBe(true)
  })

  it('falls back to a real zero floor, never a negative or unknown fee', () => {
    expect(getBridgePlatformFeeValue(0)).toBeGreaterThanOrEqual(0)
    expect(Number(formatFeeDecimals(getBridgePlatformFeeValue(0)))).toBeGreaterThanOrEqual(0)
    expect(BRIDGE_CUSTOM_FEE_CONFIG.percentageBps).toBeGreaterThanOrEqual(0)
  })
})

describe('bridge preview honesty (U1/D2)', () => {
  it('never fabricates a 0.20 fee while the quote is in flight', () => {
    // The breakdown used to print a hardcoded 0.20 that later "jumped" to the
    // real quote; an unquoted fee now renders as a placeholder instead.
    const breakdownBlock = bridgeModalSource.slice(
      bridgeModalSource.indexOf('const zeroFeeRoute'),
      bridgeModalSource.indexOf('const sourceName = getChainDisplayName(sourceChain)')
    )
    expect(breakdownBlock).not.toContain("'0.20'")
  })

  it('names the bridged token in the insufficient-balance message', () => {
    expect(bridgeModalSource).toContain('Insufficient wallet balance! You have ${activeBalance} ${deliveredTokenSymbol}')
    expect(bridgeModalSource).not.toContain('You have ${sourceWalletBalance} USDC in your wallet')
  })
})

describe('bridge surface cleanup guards', () => {
  it('keeps the Bridge tab EVM-only: no Solana/Injective recipient paths', () => {
    expect(bridgeModalSource).not.toContain('isDestSolana')
    expect(bridgeModalSource).not.toContain('isDestInjective')
    expect(bridgeModalSource).not.toContain('isValidSolanaAddress')
    expect(bridgeModalSource).not.toContain('isValidInjectiveAddress')
    expect(bridgeModalSource).not.toContain('useMultiChainWallet')
  })

  it('routes every bridge log through the scoped logger instead of raw console', () => {
    for (const source of [bridgeModalSource, bridgeServiceSource, bridgeUcwSource]) {
      expect(source).not.toContain('console.')
    }
  })

  it('keeps one Arc/USDC messenger constant instead of a duplicate alias', () => {
    expect(bridgeUcwSource).not.toContain('ARC_CCTP_TOKEN_MESSENGER')
  })
})
