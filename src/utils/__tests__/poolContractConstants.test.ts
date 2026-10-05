import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  STABLE_SWAP_AMP,
  STABLE_SWAP_ANN_MULTIPLIER,
  STABLE_SWAP_LP_FEE_BPS,
  CONSTANT_PRODUCT_LP_FEE_BPS,
} from '../../config/poolsConfig'

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8')

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
