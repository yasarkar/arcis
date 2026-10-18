// H4 wiring checks — vault deposit/redeem go through the guarded ERC-4626 entrypoints on V4
// (`depositWithMinShares` / `redeemWithMinAssets`) with guards derived from LIVE on-chain
// quotes (`previewDeposit` / `previewRedeem`) and the clamped slippage band, and the legacy
// plain calls remain only as the V3 fallback. The contract-side hardening (first-depositor
// inflation attack) is covered by contracts/test/VaultInflationGuardV4.t.sol.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { POOL_VERSION_V4, VAULT_SHARE_DECIMALS, YIELD_VAULT_ABI } from '../../config/poolsConfig'

const usePoolsSource = [
  readFileSync(new URL('../../hooks/usePoolsData.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolDepositService.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/pools/poolWithdrawService.ts', import.meta.url), 'utf8'),
].join('\n')
const copilotSource = [
  readFileSync(new URL('../../services/copilotExecutionService.ts', import.meta.url), 'utf8'),
  readFileSync(new URL('../../services/copilot/copilotDepositAction.ts', import.meta.url), 'utf8'),
].join('\n')

describe('H4 — guarded vault entrypoints', () => {
  const callNames = (abi: readonly { name?: string }[]) => abi.map((entry) => entry.name).filter(Boolean)

  it('exposes the guarded deposit/redeem and conversion reads in the vault ABI', () => {
    expect(callNames(YIELD_VAULT_ABI)).toContain('depositWithMinShares')
    expect(callNames(YIELD_VAULT_ABI)).toContain('redeemWithMinAssets')
    expect(callNames(YIELD_VAULT_ABI)).toContain('previewWithdraw')
    expect(callNames(YIELD_VAULT_ABI)).toContain('decimals')
  })

  it('routes usePoolsData vault calls through the guarded versions with live-quote guards', () => {
    expect(usePoolsSource).toMatch(/functionName: 'depositWithMinShares'/)
    expect(usePoolsSource).toMatch(/functionName: 'redeemWithMinAssets'/)
    expect(usePoolsSource).toMatch(/'depositWithMinShares\(uint256,address,uint256\)'/)
    expect(usePoolsSource).toMatch(/'redeemWithMinAssets\(uint256,address,address,uint256\)'/)
    // The min guards must come from live on-chain quotes with the clamped slippage band.
    expect(usePoolsSource).toMatch(/functionName: 'previewDeposit'/)
    expect(usePoolsSource).toMatch(/functionName: 'previewWithdraw'/)
    expect(usePoolsSource).toMatch(/poolMinOut\(expectedShares, POOL_DEFAULT_SLIPPAGE_BPS\)/)
    expect(usePoolsSource).toMatch(/poolMinOut\(expectedAssets, poolSlippageBps\(_slippage\)\)/)
  })

  it('keeps the legacy plain calls only as the version-gated V3 fallback', () => {
    expect(usePoolsSource).toMatch(/if \(POOL_VERSION_V4\) \{[\s\S]*?guardedDepositArgs/)
    expect(usePoolsSource).toMatch(/if \(POOL_VERSION_V4\) \{[\s\S]*?guardedRedeemArgs/)
  })

  it('routes the copilot vault deposit through the guarded version as well', () => {
    expect(copilotSource).toMatch(/'depositWithMinShares\(uint256,address,uint256\)'/)
    expect(copilotSource).toMatch(/poolMinOut\(expectedShares, POOL_DEFAULT_SLIPPAGE_BPS\)/)
  })

  it('keeps the share-decimals fallback in sync with the active vault version', () => {
    expect(VAULT_SHARE_DECIMALS).toBe(POOL_VERSION_V4 ? 9 : 6)
  })
})
