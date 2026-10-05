import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../rpc', () => ({
  getResilientPublicClient: vi.fn(),
  resilientReadContract: vi.fn(),
}))

import { getResilientPublicClient } from '../rpc'
import { resolveNativeActualFee } from '../sendService'

const mockClient = (receipt: unknown) => ({
  getTransactionReceipt: vi.fn().mockResolvedValue(receipt),
})

describe('resolveNativeActualFee (actual paid fee for non-Arc EVM chains)', () => {
  beforeEach(() => {
    vi.mocked(getResilientPublicClient).mockReset()
  })

  it('computes the fee as gasUsed × effectiveGasPrice in native decimals', async () => {
    vi.mocked(getResilientPublicClient).mockReturnValue(
      mockClient({ gasUsed: 21000n, effectiveGasPrice: 2_000_000_000n }) as any
    )
    const fee = await resolveNativeActualFee('0x' + 'ab'.repeat(32), 'Ethereum_Sepolia')
    expect(fee.feeExact).toBe('0.000042')
    expect(fee.symbol).toBe('ETH')
    expect(fee.decimals).toBe(18)
    expect(fee.gasUsed).toBe('21000')
    expect(fee.effectiveGasPriceWei).toBe('2000000000')
  })

  it('falls back to gasPrice when effectiveGasPrice is missing', async () => {
    vi.mocked(getResilientPublicClient).mockReturnValue(
      mockClient({ gasUsed: 50000n, gasPrice: 1_000_000_000n }) as any
    )
    const fee = await resolveNativeActualFee('0x' + 'cd'.repeat(32), 'Base_Sepolia')
    expect(fee.feeExact).toBe('0.00005')
  })

  it('resolves the chain native symbol for other networks', async () => {
    vi.mocked(getResilientPublicClient).mockReturnValue(
      mockClient({ gasUsed: 21000n, effectiveGasPrice: 1_000_000_000n }) as any
    )
    expect((await resolveNativeActualFee('0x' + 'ef'.repeat(32), 'Avalanche_Fuji')).symbol).toBe('AVAX')
    expect((await resolveNativeActualFee('0x' + 'ef'.repeat(32), 'Polygon_Amoy_Testnet')).symbol).toBe('POL')
  })

  it('fails closed without a usable EVM hash', async () => {
    const emptyHash = await resolveNativeActualFee('', 'Ethereum_Sepolia')
    expect(emptyHash.feeExact).toBeNull()
    // Solana-style base58 hashes never reach the EVM receipt lookup
    const solanaHash = await resolveNativeActualFee('5VfYxyzBase58HashNotEvm', 'Solana_Devnet')
    expect(solanaHash.feeExact).toBeNull()
    expect(getResilientPublicClient).not.toHaveBeenCalled()
  })

  it('fails closed when the receipt is missing or the RPC errors', async () => {
    vi.mocked(getResilientPublicClient).mockReturnValue(mockClient(null) as any)
    expect((await resolveNativeActualFee('0x' + '12'.repeat(32), 'Ethereum_Sepolia')).feeExact).toBeNull()

    vi.mocked(getResilientPublicClient).mockImplementation(() => {
      throw new Error('rpc down')
    })
    const fee = await resolveNativeActualFee('0x' + '34'.repeat(32), 'Ethereum_Sepolia')
    expect(fee.feeExact).toBeNull()
    expect(fee.symbol).toBe('ETH')
  })
})
