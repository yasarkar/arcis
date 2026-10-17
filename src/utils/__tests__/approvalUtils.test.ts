// src/utils/__tests__/approvalUtils.test.ts
// Audit #6: an allowance is authorized for exactly the amount a transaction moves.
// A standing ceiling — even a "finite" 10M-token one — is indistinguishable from an
// unlimited approval for a retail wallet, so this suite pins the exact-amount policy
// and guards the fund-moving services against the old ceiling pattern returning.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  exactApprovalAmount,
  increaseAllowanceShortfall,
  IMPLAUSIBLE_APPROVAL_UNITS,
} from '../approvalUtils'

const UINT256_MAX = 2n ** 256n - 1n

function serviceSource(file: string): string {
  return readFileSync(new URL(`../../services/${file}`, import.meta.url), 'utf8')
}

describe('exactApprovalAmount', () => {
  it('authorizes exactly the transaction amount (20 USDC -> 20 USDC, never a ceiling)', () => {
    expect(exactApprovalAmount(20_000_000n)).toBe(20_000_000n)
    expect(exactApprovalAmount(1n)).toBe(1n)
    // 18-decimal token: 1.5 WETH
    expect(exactApprovalAmount(1_500_000_000_000_000_000n)).toBe(1_500_000_000_000_000_000n)
  })

  it('refuses a non-positive amount instead of falling back to a ceiling', () => {
    expect(() => exactApprovalAmount(0n)).toThrow(/positive amount/)
    expect(() => exactApprovalAmount(-1n)).toThrow(/positive amount/)
  })

  it('refuses an unlimited placeholder instead of encoding it', () => {
    expect(() => exactApprovalAmount(UINT256_MAX)).toThrow(/unlimited approval was refused/)
    expect(() => exactApprovalAmount(IMPLAUSIBLE_APPROVAL_UNITS)).toThrow(
      /unlimited approval was refused/
    )
  })
})

describe('increaseAllowanceShortfall', () => {
  it('tops an existing allowance up to exactly the required amount', () => {
    expect(increaseAllowanceShortfall(20_000_000n, 0n)).toBe(20_000_000n)
    expect(increaseAllowanceShortfall(20_000_000n, 5_000_000n)).toBe(15_000_000n)
    expect(increaseAllowanceShortfall(20_000_000n, 19_999_999n)).toBe(1n)
  })

  it('stays bounded by the transaction when the allowance already covers it', () => {
    expect(increaseAllowanceShortfall(20_000_000n, 20_000_000n)).toBe(20_000_000n)
    expect(increaseAllowanceShortfall(20_000_000n, 900_000_000n)).toBe(20_000_000n)
  })

  it('refuses implausible amounts', () => {
    expect(() => increaseAllowanceShortfall(0n, 0n)).toThrow(/plausible positive amount/)
    expect(() => increaseAllowanceShortfall(UINT256_MAX, 0n)).toThrow(/plausible positive amount/)
  })
})

describe('no fund-moving path grants a standing approval ceiling', () => {
  it.each([
    'swapService.ts',
    'sendService.ts',
    'bridgeUcwService.ts',
    'gatewayService.ts',
  ])('%s has no cap/ceiling approval pattern left', (file) => {
    const source = serviceSource(file)
    expect(source).not.toMatch(/SAFE_APPROVAL_CAP_TOKENS|SAFE_CEILING_CAP|boundedApprovalAmount/)
    // 10M whole tokens (6 decimals) was the old "bounded" USDC ceiling.
    expect(source).not.toMatch(/10_000_000n/)
  })
})
