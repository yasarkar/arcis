import { describe, it, expect, vi } from 'vitest'
import { ensureHealthyWalletRpc } from '../chainSwitchService'
import { worldChainSepolia } from '../../config/networks/networkRegistry'

describe('ensureHealthyWalletRpc pre-flight health & repair', () => {
  it('returns healthy: true immediately without calling wallet_addEthereumChain when RPC responds', async () => {
    const mockRequest = vi.fn().mockImplementation(async ({ method }) => {
      if (method === 'eth_blockNumber') return '0x12345'
      return null
    })
    const provider = { request: mockRequest }

    const result = await ensureHealthyWalletRpc(worldChainSepolia, provider)

    expect(result.success).toBe(true)
    expect(result.healthy).toBe(true)
    expect(result.repaired).toBeFalsy()
    expect(mockRequest).toHaveBeenCalledTimes(1)
    expect(mockRequest).toHaveBeenCalledWith({ method: 'eth_blockNumber' })
    expect(mockRequest).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'wallet_addEthereumChain' }))
  })

  it('triggers wallet_addEthereumChain with verified RPCs when RPC probe fails, and succeeds on user approval', async () => {
    const mockRequest = vi.fn().mockImplementation(async ({ method }) => {
      if (method === 'eth_blockNumber') {
        throw new Error('RPC endpoint returned too many errors, retrying in 0,46 minutes.')
      }
      if (method === 'wallet_addEthereumChain') {
        return null // user approved
      }
      return null
    })
    const provider = { request: mockRequest }

    const result = await ensureHealthyWalletRpc(worldChainSepolia, provider)

    expect(result.success).toBe(true)
    expect(result.healthy).toBe(true)
    expect(result.repaired).toBe(true)
    expect(mockRequest).toHaveBeenCalledWith({ method: 'eth_blockNumber' })
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'wallet_addEthereumChain',
        params: [
          expect.objectContaining({
            chainId: '0x12c1',
            rpcUrls: expect.arrayContaining([
              'https://worldchain-sepolia.g.alchemy.com/public',
              'https://4801.rpc.thirdweb.com',
            ]),
          }),
        ],
      })
    )
  })

  it('handles user cancellation (code 4001) during wallet_addEthereumChain gracefully', async () => {
    const mockRequest = vi.fn().mockImplementation(async ({ method }) => {
      if (method === 'eth_blockNumber') {
        throw new Error('the method eth_blockNumber does not exist/is not available')
      }
      if (method === 'wallet_addEthereumChain') {
        const err: any = new Error('User rejected the request.')
        err.code = 4001
        throw err
      }
      return null
    })
    const provider = { request: mockRequest }

    const result = await ensureHealthyWalletRpc(worldChainSepolia, provider)

    expect(result.success).toBe(false)
    expect(result.healthy).toBe(false)
    expect(result.isCanceled).toBe(true)
    expect(result.error).toContain('canceled')
  })

  it('returns failure if provider is missing', async () => {
    const result = await ensureHealthyWalletRpc(worldChainSepolia, null)
    expect(result.success).toBe(false)
    expect(result.error).toContain('No active Ethereum wallet provider found')
  })

  it('returns failure for unrecognized network target', async () => {
    const mockRequest = vi.fn()
    const provider = { request: mockRequest }

    const result = await ensureHealthyWalletRpc('NonExistentChain999999', provider)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unrecognized network')
  })
})

