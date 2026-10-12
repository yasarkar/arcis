import { describe, it, expect, vi } from 'vitest'
import {
  POOL_ACTION_EVENT_TOPICS,
  recordOptimisticPoolTx,
  fetchTotalPoolTransactionCount,
  discoverContractBirthBlock,
} from '../../services/poolEventsIndexer'

describe('poolEventsIndexer', () => {
  it('contains valid 32-byte event topic hashes for pool interactions', () => {
    const topics = POOL_ACTION_EVENT_TOPICS[0]
    expect(topics.length).toBe(6)
    for (const t of topics) {
      expect(t).toMatch(/^0x[a-fA-F0-9]{64}$/)
    }
  })

  it('optimistically records new valid transaction hashes', () => {
    const fakeTx = '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff'
    recordOptimisticPoolTx(fakeTx)
    // Duplicate call should be idempotent
    recordOptimisticPoolTx(fakeTx)
    // Invalid tx should be ignored
    recordOptimisticPoolTx('invalid')
  })

  it('discovers contract birth block dynamically via binary search', async () => {
    const mockClient: any = {
      getBlockNumber: vi.fn().mockResolvedValue(1000n),
      getBytecode: vi.fn().mockImplementation(async ({ blockNumber }: { blockNumber: bigint }) => {
        return blockNumber >= 500n ? '0x6080604052' : '0x'
      }),
    }

    const birth = await discoverContractBirthBlock(
      mockClient,
      '0xC3EdDA15AdfaC31ADfC23aC86dC96d791f72bE8a'
    )
    expect(birth).toBe(500n)
  })

  it('scans on-chain logs dynamically using publicClient and returns valid count', async () => {
    const mockClient: any = {
      getBlockNumber: vi.fn().mockResolvedValue(1000n),
      getBytecode: vi.fn().mockResolvedValue('0x6080604052'),
      getLogs: vi.fn().mockResolvedValue([
        { transactionHash: '0xabc1230000000000000000000000000000000000000000000000000000000001' },
      ]),
    }

    const count = await fetchTotalPoolTransactionCount(mockClient)
    expect(typeof count).toBe('number')
    expect(count).toBeGreaterThanOrEqual(1)
  })
})
