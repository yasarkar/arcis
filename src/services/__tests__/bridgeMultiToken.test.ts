import { describe, it, expect, vi, beforeEach } from 'vitest'

const { bridgeMock, onMock, offMock, estimateBridgeMock } = vi.hoisted(() => ({
  bridgeMock: vi.fn(),
  onMock: vi.fn(),
  offMock: vi.fn(),
  estimateBridgeMock: vi.fn(),
}))

vi.mock('@circle-fin/app-kit', () => ({
  AppKit: class {
    on = onMock
    off = offMock
    bridge = (...args: any[]) => bridgeMock(...args)
    estimateBridge = (...args: any[]) => estimateBridgeMock(...args)
    getSupportedChains = vi.fn(() => [])
  },
}))

vi.mock('../tokenAssetService', () => ({
  watchArcToken: vi.fn().mockResolvedValue(true),
}))

import { executeBridge, estimateBridgeCost, normalizeBridgeToken } from '../bridgeService'
import { watchArcToken } from '../tokenAssetService'

describe('Multi-Token Bridging Service Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bridgeMock.mockResolvedValue({
      state: 'success',
      steps: [{ name: 'approve', state: 'success' }, { name: 'burn', state: 'success' }],
    })
    estimateBridgeMock.mockResolvedValue({ estimatedCost: '0.01' })
  })

  describe('normalizeBridgeToken', () => {
    it('defaults to USDC when token is undefined or empty', () => {
      expect(normalizeBridgeToken()).toBe('USDC')
      expect(normalizeBridgeToken('')).toBe('USDC')
    })

    it('normalizes WETH / weth to wETH alias required by App Kit', () => {
      expect(normalizeBridgeToken('WETH')).toBe('wETH')
      expect(normalizeBridgeToken('weth')).toBe('wETH')
    })

    it('normalizes EURC and cirBTC properly', () => {
      expect(normalizeBridgeToken('eurc')).toBe('EURC')
      expect(normalizeBridgeToken('EURC')).toBe('EURC')
      expect(normalizeBridgeToken('cirbtc')).toBe('cirBTC')
      expect(normalizeBridgeToken('cirBTC')).toBe('cirBTC')
    })

    it('preserves custom contract address or token ids', () => {
      const customAddr = '0x2c4047028a72803939b6fb674D01bC059B5C4961'
      expect(normalizeBridgeToken(customAddr)).toBe(customAddr)
    })
  })

  describe('executeBridge with multi-token support', () => {
    const baseParams = {
      fromChain: 'Ethereum_Sepolia',
      toChain: 'Arc_Testnet',
      amount: '0.5',
      sourceAdapter: { provider: null },
      recipientAddress: '0x1111111111111111111111111111111111111111',
      useForwarder: true,
      transferSpeed: 'FAST' as const,
    }

    it('bridges WETH correctly with token: "wETH" and watches WETH on Arc', async () => {
      await executeBridge({
        ...baseParams,
        token: 'WETH',
      })

      expect(bridgeMock).toHaveBeenCalledTimes(1)
      const callArgs = bridgeMock.mock.calls[0][0]
      expect(callArgs.token).toBe('wETH')
      expect(callArgs.amount).toBe('0.5')
      expect(watchArcToken).toHaveBeenCalledWith('WETH', undefined)
    })

    it('bridges EURC and cirBTC correctly with respective tokens', async () => {
      await executeBridge({
        ...baseParams,
        token: 'EURC',
      })
      expect(bridgeMock.mock.calls[0][0].token).toBe('EURC')
      expect(watchArcToken).toHaveBeenCalledWith('EURC', undefined)

      bridgeMock.mockClear()
      await executeBridge({
        ...baseParams,
        token: 'cirBTC',
      })
      expect(bridgeMock.mock.calls[0][0].token).toBe('cirBTC')
      expect(watchArcToken).toHaveBeenCalledWith('cirBTC', undefined)
    })

    it('omits customFee for non-USDC tokens according to Circle CCTP protocol rules', async () => {
      const customFee = {
        value: '0.05',
        recipientAddress: '0x9999999999999999999999999999999999999999',
      }

      await executeBridge({
        ...baseParams,
        token: 'WETH',
        customFee,
      })

      const wethCall = bridgeMock.mock.calls[0][0]
      // Non-USDC should NOT attach customFee to bridge config
      expect(wethCall.config?.customFee).toBeUndefined()
      expect(wethCall.config?.transferSpeed).toBe('FAST')

      bridgeMock.mockClear()
      // USDC SHOULD include customFee
      await executeBridge({
        ...baseParams,
        token: 'USDC',
        customFee,
      })

      const usdcCall = bridgeMock.mock.calls[0][0]
      expect(usdcCall.config?.customFee).toEqual(customFee)
      expect(usdcCall.config?.transferSpeed).toBe('FAST')
    })

    it('estimates costs correctly for non-USDC tokens', async () => {
      await estimateBridgeCost({
        ...baseParams,
        token: 'WETH',
      })

      expect(estimateBridgeMock).toHaveBeenCalledTimes(1)
      expect(estimateBridgeMock.mock.calls[0][0].token).toBe('wETH')
    })

    it('enriches result with burnTxHash and mintTxHash when App Kit returns CCTPx transfer and forward steps', async () => {
      const mockBurnHash = '0xaaaa111122223333444455556666777788889999aaaabbbbccccddddeeeeffff'
      const mockMintHash = '0xbbbb111122223333444455556666777788889999aaaabbbbccccddddeeeeffff'

      bridgeMock.mockResolvedValueOnce({
        state: 'success',
        steps: [
          { name: 'approve', state: 'success', txHash: '0x1111' },
          { name: 'transfer', state: 'success', txHash: mockBurnHash },
          { name: 'fetchAttestation', state: 'success' },
          { name: 'forward', state: 'success', txHash: mockMintHash, data: { forwardTxHash: mockMintHash } },
        ],
      })

      const observedSteps: any[] = []
      const res = await executeBridge(
        {
          ...baseParams,
          token: 'EURC',
        },
        (step) => observedSteps.push(step)
      )

      expect(res.burnTxHash).toBe(mockBurnHash)
      expect(res.mintTxHash).toBe(mockMintHash)
    })
  })

  describe('Multi-token resolution and polling helpers', () => {
    it('resolves correct addresses and decimals for EURC, WETH, cirBTC, and USDC', async () => {
      const { getBridgeTokenAddress, getBridgeTokenDecimals } = await import('../bridgeUcwService')
      const { EURC_ADDRESSES, WETH_ADDRESSES, CIRBTC_ADDRESSES, USDC_ADDRESSES } = await import('../../config/gatewayConfig')

      expect(getBridgeTokenAddress('Arc_Testnet', 'EURC')).toBe(EURC_ADDRESSES['Arc_Testnet'])
      expect(getBridgeTokenAddress('Base_Sepolia', 'EURC')).toBe(EURC_ADDRESSES['Base_Sepolia'])
      expect(getBridgeTokenAddress('Ethereum_Sepolia', 'WETH')).toBe(WETH_ADDRESSES['Ethereum_Sepolia'])
      expect(getBridgeTokenAddress('Ethereum_Sepolia', 'cirBTC')).toBe(CIRBTC_ADDRESSES['Ethereum_Sepolia'])
      expect(getBridgeTokenAddress('Arc_Testnet', 'USDC')).toBe(USDC_ADDRESSES['Arc_Testnet'])

      expect(getBridgeTokenDecimals('EURC')).toBe(6)
      expect(getBridgeTokenDecimals('USDC')).toBe(6)
      expect(getBridgeTokenDecimals('WETH')).toBe(18)
      expect(getBridgeTokenDecimals('ETH')).toBe(18)
      expect(getBridgeTokenDecimals('cirBTC')).toBe(8)
    })

    it('verifies Base Sepolia EURC matches canonical Circle deployment 0x808456652fdb597867f38412077A9182bf77359F', async () => {
      const { EURC_ADDRESSES } = await import('../../config/gatewayConfig')
      expect(EURC_ADDRESSES['Base_Sepolia'].toLowerCase()).toBe('0x808456652fdb597867f38412077a9182bf77359f')
    })

    it('accurately equates 20-byte and 32-byte 0-padded addresses with isSameAddress', async () => {
      const { isSameAddress } = await import('../bridgeUcwService')
      const raw = '0x5f8f4cC0403332fC9c22a23222DDb9B267BF2E70'
      const padded = '0x0000000000000000000000005f8f4cc0403332fc9c22a23222ddb9b267bf2e70'

      expect(isSameAddress(raw, padded)).toBe(true)
      expect(isSameAddress(padded, raw)).toBe(true)
      expect(isSameAddress(raw, raw.toLowerCase())).toBe(true)
      expect(isSameAddress(raw, '0x0000000000000000000000000000000000000000')).toBe(false)
      expect(isSameAddress(undefined, raw)).toBe(false)
    })
  })
})

