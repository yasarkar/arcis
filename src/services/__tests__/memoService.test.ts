// src/services/__tests__/memoService.test.ts
// Pins the generic memo-call builder: the Memo contract wraps ANY target ERC-20 transfer, so a
// cirBTC (8-decimal) memo must be built just like a USDC one rather than being silently dropped.

import { describe, it, expect } from 'vitest'
import { decodeFunctionData, erc20Abi } from 'viem'
import { buildMemoCall } from '../memoService'
import { MEMO_ABI, MEMO_CONTRACT_ADDRESS, ARC_USDC_CONTRACT_ADDRESS } from '../../config/memoConfig'
import { ARC_TOKENS } from '../../config/arcChain'

const RECIPIENT = '0x5f8f4cC0403332fC9c22a2211111111111111111'

describe('buildMemoCall', () => {
  it('targets the Memo contract and wraps a cirBTC transfer with 8 decimals', () => {
    const call = buildMemoCall({
      tokenAddress: ARC_TOKENS.cirBTC,
      decimals: 8,
      recipient: RECIPIENT,
      amount: '0.0001',
      memoText: 'Invoice #1',
    })

    expect(call.to).toBe(MEMO_CONTRACT_ADDRESS)

    const outer = decodeFunctionData({ abi: MEMO_ABI, data: call.data })
    expect(outer.functionName).toBe('memo')
    const [target, innerData] = outer.args as [string, `0x${string}`, `0x${string}`, `0x${string}`]
    expect(target.toLowerCase()).toBe(ARC_TOKENS.cirBTC.toLowerCase())
    expect(call.memoId).toMatch(/^0x[0-9a-f]{64}$/i)

    const inner = decodeFunctionData({ abi: erc20Abi, data: innerData })
    expect(inner.functionName).toBe('transfer')
    // 0.0001 cirBTC at 8 decimals = 10_000 base units.
    expect((inner.args as [string, bigint])[1]).toBe(10000n)
  })

  it('builds a USDC memo with the native USDC ERC-20 facade as the target', () => {
    const call = buildMemoCall({
      tokenAddress: ARC_USDC_CONTRACT_ADDRESS,
      decimals: 6,
      recipient: RECIPIENT,
      amount: '25',
      memoText: 'payroll',
    })
    const outer = decodeFunctionData({ abi: MEMO_ABI, data: call.data })
    const inner = decodeFunctionData({ abi: erc20Abi, data: (outer.args as any)[1] })
    expect(inner.functionName).toBe('transfer')
    expect((inner.args as [string, bigint])[1]).toBe(25_000_000n)
  })
})
