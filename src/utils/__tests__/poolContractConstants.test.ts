import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  STABLE_SWAP_AMP,
  STABLE_SWAP_ANN_MULTIPLIER,
  STABLE_SWAP_LP_FEE_BPS,
  CONSTANT_PRODUCT_LP_FEE_BPS,
  POOL_VERSION_V4,
  AMM_POOL_STATE_READ_FNS,
  AMM_POOL_STATE_READ_FNS_V3,
  AMM_POOL_STATE_READ_FNS_V4,
} from '../../config/poolsConfig'

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8')
const exists = (relativePath: string) => existsSync(join(process.cwd(), relativePath))

/**
 * The frontend used to hard-code A = 100 / 12 bps / 25 bps in four different files (audit #14).
 * They are now a single source of truth in poolsConfig — this test pins that source to the
 * deployed Solidity so a contract change cannot silently desynchronise the swap quotes.
 */
describe('Pool constants stay in sync with the deployed contracts (audit #14)', () => {
  it('matches StableSwapPoolV3.sol amplification coefficient A', () => {
    const source = read('contracts/src/v3/StableSwapPoolV3.sol')
    const match = source.match(/uint256 public constant A = (\d+);/)
    expect(match).not.toBeNull()
    expect(STABLE_SWAP_AMP).toBe(BigInt(match![1]))
  })

  it('uses the contract-documented Ann = A * n**n multiplier for a 2-token pool', () => {
    const source = read('contracts/src/v3/StableSwapPoolV3.sol')
    expect(source).toContain('Ann = A * n**n')
    expect(STABLE_SWAP_ANN_MULTIPLIER).toBe(4n)
  })

  it('matches the LP fees passed to the pools at deploy time', () => {
    const deploy = read('contracts/script/DeployV3.s.sol')
    const stable = deploy.match(/new StableSwapPoolV3\([^,]+,\s*[^,]+,\s*(\d+)/)
    const constantProduct = deploy.match(/new ConstantProductPoolV3\([^,]+,\s*[^,]+,\s*(\d+)/)
    expect(stable).not.toBeNull()
    expect(constantProduct).not.toBeNull()
    expect(STABLE_SWAP_LP_FEE_BPS).toBe(BigInt(stable![1]))
    expect(CONSTANT_PRODUCT_LP_FEE_BPS).toBe(BigInt(constantProduct![1]))
  })
})

/**
 * Phase 1 moved LP fees on-chain, which changed *which* getters exist per version: V4 removed the
 * owner-collected `accumulatedFeeA/B` counters in favour of `feeReserveA/B` streaming to holders via
 * `harvest()`. `fetchOnchainPoolState` runs its reads through a multicall with `allowFailure: true`,
 * so asking the wrong version for the wrong getter does not throw — it silently reports 0. These
 * assertions pin each read plan, and the Phase 1 harvest surface, to its Solidity source.
 */
describe('Pool read plan matches the deployed Solidity', () => {
  const V3_AMM = ['contracts/src/v3/StableSwapPoolV3.sol', 'contracts/src/v3/ConstantProductPoolV3.sol']
  const V4_AMM = [
    'contracts/src/v4/StableSwapPoolV4.sol',
    'contracts/src/v4/ConstantProductPoolV4.sol',
    'contracts/src/v4/LpFeeAccounting.sol',
  ]

  /** Function names implemented by a set of contracts, including auto-generated getters for public state. */
  const implementedFunctions = (paths: string[]) => {
    const names = new Set<string>()
    for (const path of paths) {
      const source = read(path)
      for (const match of source.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)) names.add(match[1])
      // `uint256 public reserveA;` / `IERC20Like public immutable tokenA;` both get a getter.
      for (const match of source.matchAll(/\bpublic\s+(?:(?:immutable|constant|override)\s+)*([A-Za-z0-9_]+)\s*(?:=|;)/g)) {
        names.add(match[1])
      }
    }
    return names
  }

  const v3Functions = implementedFunctions(V3_AMM)
  const v4Functions = implementedFunctions(V4_AMM)

  it('only reads V3 getters that StableSwapPoolV3 / ConstantProductPoolV3 implement', () => {
    expect(AMM_POOL_STATE_READ_FNS_V3.filter((fn) => !v3Functions.has(fn))).toEqual([])
  })

  it('only reads V4 getters that StableSwapPoolV4 / LpFeeAccounting implement', () => {
    expect(AMM_POOL_STATE_READ_FNS_V4.filter((fn) => !v4Functions.has(fn))).toEqual([])
  })

  it('documents the V3 → V4 fee-getter divergence (accumulatedFeeA/B no longer exist)', () => {
    expect(AMM_POOL_STATE_READ_FNS_V3).toContain('accumulatedFeeA')
    expect(AMM_POOL_STATE_READ_FNS_V3).toContain('accumulatedFeeB')
    expect(v3Functions.has('accumulatedFeeA')).toBe(true)

    expect(AMM_POOL_STATE_READ_FNS_V4).toContain('feeReserveA')
    expect(AMM_POOL_STATE_READ_FNS_V4).toContain('feeReserveB')
    expect(v4Functions.has('feeReserveA')).toBe(true)
    // The V4 contracts must NOT be asked for counters they dropped.
    expect(v4Functions.has('accumulatedFeeA')).toBe(false)
    expect(AMM_POOL_STATE_READ_FNS_V4).not.toContain('accumulatedFeeA')
  })

  it('selects the read plan that matches the active pool version', () => {
    expect(AMM_POOL_STATE_READ_FNS).toBe(
      POOL_VERSION_V4 ? AMM_POOL_STATE_READ_FNS_V4 : AMM_POOL_STATE_READ_FNS_V3,
    )
  })

  it('exposes the Phase 1 harvest surface on V4 and not on V3', () => {
    if (exists('contracts/src/v4/YieldVaultV4.sol')) {
      const v4Vault = implementedFunctions(['contracts/src/v4/YieldVaultV4.sol'])
      for (const fn of ['harvest', 'pendingYield', 'principalAssets', 'totalYieldDistributed', 'performanceFeeBps']) {
        expect(v4Vault.has(fn)).toBe(true)
      }
    }

    const v3Vault = implementedFunctions(['contracts/src/v3/YieldVaultV3.sol'])
    // V3 has no per-user on-chain accounting — that absence is why the app shows 0 while on V3.
    for (const fn of ['harvest', 'pendingYield', 'principalAssets']) {
      expect(v3Vault.has(fn)).toBe(false)
    }

    // LP pools must expose the per-LP ledger + harvest on V4 only.
    for (const fn of ['harvest', 'pendingFees', 'feeReserveA', 'feeReserveB']) {
      expect(v4Functions.has(fn)).toBe(true)
    }
    expect(v3Functions.has('harvest')).toBe(false)
    expect(v3Functions.has('pendingFees')).toBe(false)
  })

  it('matches the V4 fees passed at deploy time', () => {
    const deploy = read('contracts/script/DeployV4.s.sol')
    const stable = deploy.match(/new StableSwapPoolV4\([^,]+,\s*[^,]+,\s*(\d+)/)
    const constantProduct = deploy.match(/new ConstantProductPoolV4\([^,]+,\s*[^,]+,\s*(\d+)/)
    expect(stable).not.toBeNull()
    expect(constantProduct).not.toBeNull()
    expect(STABLE_SWAP_LP_FEE_BPS).toBe(BigInt(stable![1]))
    expect(CONSTANT_PRODUCT_LP_FEE_BPS).toBe(BigInt(constantProduct![1]))
  })
})
