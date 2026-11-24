import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  getSupportedSwapChains,
  isSwapChainSupported,
  resolveSupportedSwapChain,
  getSwapEstimate,
  executeSwap,
} from '../swapService'

describe('Swap supported chains (testnet-only: Arc Testnet)', () => {
  it('returns only testnet chains by default (Arc_Testnet) and excludes all mainnet chains', () => {
    const chains = getSupportedSwapChains()

    expect(chains.length).toBeGreaterThan(0)
    expect(chains.every((c) => c.isTestnet === true)).toBe(true)
    expect(chains.map((c) => c.chain)).toEqual(['Arc_Testnet'])
  })

  it('never includes mainnet networks when querying testnet swap chains', () => {
    const chains = getSupportedSwapChains(true)
    const keys = chains.map((c) => c.chain)

    expect(keys).toEqual(['Arc_Testnet'])
    for (const mainnetKey of ['Ethereum', 'Arbitrum', 'Base', 'Optimism', 'Polygon', 'Solana', 'Arc', 'Morph', 'Cronos']) {
      expect(keys).not.toContain(mainnetKey)
      expect(isSwapChainSupported(mainnetKey, true)).toBe(false)
    }
  })

  it('resolves unsupported, mainnet, or missing chain keys to Arc_Testnet', () => {
    expect(resolveSupportedSwapChain(undefined, true)).toBe('Arc_Testnet')
    expect(resolveSupportedSwapChain('Arc_Testnet', true)).toBe('Arc_Testnet')
    expect(resolveSupportedSwapChain('Ethereum', true)).toBe('Arc_Testnet')
    expect(resolveSupportedSwapChain('Base', true)).toBe('Arc_Testnet')
    expect(resolveSupportedSwapChain('Base_Sepolia', true)).toBe('Arc_Testnet')
    expect(resolveSupportedSwapChain('Ethereum_Sepolia', true)).toBe('Arc_Testnet')
  })

  it('blocks AppKit-only mainnet chains (not in networkRegistry) from quoting or executing', async () => {
    await expect(
      getSwapEstimate({
        fromChain: 'Morph',
        tokenIn: 'USDC',
        tokenOut: 'EURC',
        amountIn: '10',
      })
    ).rejects.toThrow('Mainnet swaps are disabled')

    const res = await executeSwap({
      fromChain: 'Cronos',
      tokenIn: 'USDC',
      tokenOut: 'EURC',
      amountIn: '10',
    })
    expect(res.status).toBe('FAILED')
    expect(res.errorMessage).toContain('Mainnet swaps are disabled')
  })

  it('pins SwapModal to testnet-only swap chains via getSupportedSwapChains(true)', () => {
    const swapModalSource = readFileSync(
      resolve(__dirname, '../../components/SwapModal.tsx'),
      'utf-8'
    )

    expect(swapModalSource).toContain('getSupportedSwapChains(true)')
    expect(swapModalSource).toContain('resolveSupportedSwapChain(')
    expect(swapModalSource).not.toContain('getSupportedSwapChains()')
  })
})
