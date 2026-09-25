import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  executeUcwGatewayTransfer,
  mapChainKeyToCircleBlockchain,
} from '../gatewayUcwService'
import * as gatewayServiceModule from '../gatewayService'

vi.mock('../gatewayService', () => ({
  getGatewayBalances: vi.fn(),
}))

describe('Gateway UCW Execution & Multi-Chain Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  describe('mapChainKeyToCircleBlockchain', () => {
    it('correctly maps known testnet and mainnet chain keys', () => {
      expect(mapChainKeyToCircleBlockchain('Arc_Testnet')).toBe('ARC-TESTNET')
      expect(mapChainKeyToCircleBlockchain('Base_Sepolia')).toBe('BASE-SEPOLIA')
      expect(mapChainKeyToCircleBlockchain('Ethereum_Sepolia')).toBe('ETH-SEPOLIA')
      expect(mapChainKeyToCircleBlockchain('Arbitrum_Sepolia')).toBe('ARB-SEPOLIA')
      expect(mapChainKeyToCircleBlockchain('Optimism_Sepolia')).toBe('OP-SEPOLIA')
      expect(mapChainKeyToCircleBlockchain('Polygon_Amoy')).toBe('MATIC-AMOY')
      expect(mapChainKeyToCircleBlockchain('Avalanche_Fuji')).toBe('AVAX-FUJI')
    })

    it('defaults unknown chains safely to ARC-TESTNET', () => {
      expect(mapChainKeyToCircleBlockchain('Unknown_Chain')).toBe('ARC-TESTNET')
    })
  })

  describe('executeUcwGatewayTransfer', () => {
    const userAddress = '0x1111111111111111111111111111111111111111'

    it('throws error when connectedAddress is missing', async () => {
      const mockSign = vi.fn()
      const mockExecute = vi.fn()

      await expect(
        executeUcwGatewayTransfer({
          amount: '10',
          sourceChain: 'Arc_Testnet',
          destChain: 'Base_Sepolia',
          connectedAddress: '',
          signTypedData: mockSign,
          executeUcwContract: mockExecute,
        })
      ).rejects.toThrow('Circle UCW cüzdan adresi bulunamadı')
    })

    it('throws error when unsupported chain is passed', async () => {
      const mockSign = vi.fn()
      const mockExecute = vi.fn()

      await expect(
        executeUcwGatewayTransfer({
          amount: '10',
          sourceChain: 'Invalid_Network',
          destChain: 'Base_Sepolia',
          connectedAddress: userAddress,
          signTypedData: mockSign,
          executeUcwContract: mockExecute,
        })
      ).rejects.toThrow('Desteklenmeyen ağ seçildi')
    })

    it('throws error when the unified balance cannot cover value + estimated fee', async () => {
      const mockSign = vi.fn()
      const mockExecute = vi.fn()

      vi.mocked(gatewayServiceModule.getGatewayBalances).mockResolvedValueOnce({
        token: 'USDC',
        balances: [
          { domain: 26, depositor: userAddress, balance: '0.5' }, // less than 1.0 USDC buffer
        ],
      })

      await expect(
        executeUcwGatewayTransfer({
          amount: '10',
          sourceChain: 'Arc_Testnet',
          destChain: 'Base_Sepolia',
          connectedAddress: userAddress,
          signTypedData: mockSign,
          executeUcwContract: mockExecute,
        })
      ).rejects.toThrow('Circle Gateway birleşik bakiyeniz yetersiz')

      expect(mockSign).not.toHaveBeenCalled()
      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('uses the canonical maxFee from the Gateway /estimate endpoint in the signed burn intent', async () => {
      const mockSign = vi.fn().mockResolvedValueOnce({
        success: true,
        signature: '0xmock_eip712_signature',
      })
      const mockExecute = vi.fn().mockResolvedValueOnce({
        success: true,
        txHash: '0xmock_mint_tx_hash',
      })

      vi.mocked(gatewayServiceModule.getGatewayBalances).mockResolvedValueOnce({
        token: 'USDC',
        balances: [
          { domain: 26, depositor: userAddress, balance: '50.00' },
        ],
      })

      // 1st call = POST /estimate, 2nd call = POST /transfer
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ([{ burnIntent: { maxBlockHeight: '65324520', maxFee: '3850' } }]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            attestation: '0xmock_attestation',
            signature: '0xmock_mint_signature',
          }),
        })
      global.fetch = mockFetch

      const onStepProgress = vi.fn()

      const result = await executeUcwGatewayTransfer({
        amount: '10',
        sourceChain: 'Arc_Testnet',
        destChain: 'Base_Sepolia',
        recipientAddress: '0x2222222222222222222222222222222222222222',
        connectedAddress: userAddress,
        useForwarder: false,
        signTypedData: mockSign,
        executeUcwContract: mockExecute,
        onStepProgress,
      })

      // /estimate must be consulted before signing, /transfer after
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(String(mockFetch.mock.calls[0][0])).toContain('/estimate')
      expect(String(mockFetch.mock.calls[0][0])).toContain('enableForwarder=false')
      expect(String(mockFetch.mock.calls[1][0])).toContain('/transfer')

      expect(mockSign).toHaveBeenCalledTimes(1)
      const signArgs = mockSign.mock.calls[0][0]
      expect(signArgs.data.primaryType).toBe('BurnIntent')
      expect(signArgs.data.domain.name).toBe('GatewayWallet')
      expect(signArgs.data.message.maxFee).toBe('3850')
      expect(signArgs.data.message.maxBlockHeight).toBe('65324520')
      expect(signArgs.blockchain).toBe('ARC-TESTNET')

      // The submitted burn intent matches the signed payload exactly
      const transferBody = JSON.parse(mockFetch.mock.calls[1][1].body)
      expect(transferBody[0].burnIntent.maxFee).toBe('3850')
      expect(transferBody[0].burnIntent.spec.value).toBe('10000000')
      expect(transferBody[0].signature).toBe('0xmock_eip712_signature')

      // Destination mint still runs through UCW contract execution
      expect(mockExecute).toHaveBeenCalledTimes(1)
      const execArgs = mockExecute.mock.calls[0][0]
      expect(execArgs.abiFunctionSignature).toBe('gatewayMint(bytes,bytes)')
      expect(execArgs.abiParameters).toEqual(['0xmock_attestation', '0xmock_mint_signature'])
      expect(execArgs.blockchain).toBe('BASE-SEPOLIA')

      // Result reports the FULL requested amount (never silently reduced)
      expect(result.mintTxHash).toBe('0xmock_mint_tx_hash')
      expect(result.sourceChain).toBe('Arc_Testnet')
      expect(result.destChain).toBe('Base_Sepolia')
      expect(result.amount).toBe('10')
      expect(result.destExplorerUrl).toContain('0xmock_mint_tx_hash')
      expect(onStepProgress).toHaveBeenCalledWith('completed')
    })

    it('uses the Forwarding Service by default: Circle mints on the destination without any UCW mint', async () => {
      const mockSign = vi.fn().mockResolvedValueOnce({
        success: true,
        signature: '0xmock_eip712_signature',
      })
      const mockExecute = vi.fn()

      vi.mocked(gatewayServiceModule.getGatewayBalances).mockResolvedValueOnce({
        token: 'USDC',
        balances: [
          { domain: 26, depositor: userAddress, balance: '50.00' },
        ],
      })

      // 1st = /estimate?enableForwarder=true, 2nd = /transfer?enableForwarder=true, 3rd = GET /transfer/{id}
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ([{ burnIntent: { maxBlockHeight: '65324520', maxFee: '56637' } }]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ transferId: 'gw-transfer-123' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'confirmed',
            forwardingDetails: { transactionHash: '0xforwardedmint' },
          }),
        })
      global.fetch = mockFetch

      const onStepProgress = vi.fn()

      const result = await executeUcwGatewayTransfer({
        amount: '10',
        sourceChain: 'Arc_Testnet',
        destChain: 'Base_Sepolia',
        connectedAddress: userAddress,
        signTypedData: mockSign,
        executeUcwContract: mockExecute,
        onStepProgress,
      })

      expect(String(mockFetch.mock.calls[0][0])).toContain('enableForwarder=true')
      expect(String(mockFetch.mock.calls[1][0])).toContain('/transfer?enableForwarder=true')
      expect(String(mockFetch.mock.calls[2][0])).toContain('/transfer/gw-transfer-123')

      // The quote is buffered (+5%, minimum +0.002 USDC) because the forwarding fee is dynamic
      const signArgs = mockSign.mock.calls[0][0]
      expect(signArgs.data.message.maxFee).toBe('59468')

      // No destination-chain UCW challenge is needed at all
      expect(mockExecute).not.toHaveBeenCalled()
      expect(result.forwarded).toBe(true)
      expect(result.transferId).toBe('gw-transfer-123')
      expect(result.status).toBe('confirmed')
      expect(result.mintTxHash).toBe('0xforwardedmint')
      expect(result.destExplorerUrl).toContain('0xforwardedmint')
      expect(onStepProgress).toHaveBeenCalledWith('forwarding')
      expect(onStepProgress).toHaveBeenCalledWith('completed')
    })

    it('fails loudly when the Forwarding Service reports a failed transfer', async () => {
      const mockSign = vi.fn().mockResolvedValueOnce({
        success: true,
        signature: '0xmock_eip712_signature',
      })
      const mockExecute = vi.fn()

      vi.mocked(gatewayServiceModule.getGatewayBalances).mockResolvedValueOnce({
        token: 'USDC',
        balances: [
          { domain: 26, depositor: userAddress, balance: '50.00' },
        ],
      })

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ([{ burnIntent: { maxBlockHeight: '65324520', maxFee: '56637' } }]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ transferId: 'gw-transfer-failed' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'failed',
            forwardingDetails: { failureReason: 'destination mint reverted' },
          }),
        })

      await expect(
        executeUcwGatewayTransfer({
          amount: '10',
          sourceChain: 'Arc_Testnet',
          destChain: 'Base_Sepolia',
          connectedAddress: userAddress,
          signTypedData: mockSign,
          executeUcwContract: mockExecute,
        })
      ).rejects.toThrow('destination mint reverted')

      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('never silently reduces the amount: throws an actionable error when balance cannot cover value + estimated fee', async () => {
      const mockSign = vi.fn()
      const mockExecute = vi.fn()

      // 10.0038 USDC covers the real Gateway fee (0.0035) but NOT the estimated
      // maxFee (0.00385). The previous implementation silently reduced the burn
      // value to ~9.0038 USDC here and minted less than the user asked for.
      vi.mocked(gatewayServiceModule.getGatewayBalances).mockResolvedValueOnce({
        token: 'USDC',
        balances: [
          { domain: 26, depositor: userAddress, balance: '10.0038' },
        ],
      })

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ([{ burnIntent: { maxBlockHeight: '65324520', maxFee: '3850' } }]),
      })

      await expect(
        executeUcwGatewayTransfer({
          amount: '10',
          sourceChain: 'Arc_Testnet',
          destChain: 'Base_Sepolia',
          connectedAddress: userAddress,
          useForwarder: false,
          signTypedData: mockSign,
          executeUcwContract: mockExecute,
        })
      ).rejects.toThrow('Circle Gateway birleşik bakiyeniz yetersiz')

      expect(mockSign).not.toHaveBeenCalled()
      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('falls back to the local fee formula (0.05 USDC gas + 0.005%) when /estimate is unavailable', async () => {
      const mockSign = vi.fn().mockResolvedValueOnce({
        success: true,
        signature: '0xmock_eip712_signature',
      })
      const mockExecute = vi.fn().mockResolvedValueOnce({
        success: true,
        txHash: '0xmock_mint_tx_hash',
      })

      vi.mocked(gatewayServiceModule.getGatewayBalances).mockResolvedValueOnce({
        token: 'USDC',
        balances: [
          { domain: 26, depositor: userAddress, balance: '50.00' },
        ],
      })

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            attestation: '0xmock_attestation',
            signature: '0xmock_mint_signature',
          }),
        })
      global.fetch = mockFetch

      await executeUcwGatewayTransfer({
        amount: '10',
        sourceChain: 'Arc_Testnet',
        destChain: 'Base_Sepolia',
        connectedAddress: userAddress,
        useForwarder: false,
        signTypedData: mockSign,
        executeUcwContract: mockExecute,
      })

      // 10 USDC * 0.005% = 500 units + 50,000 units gas buffer
      const signArgs = mockSign.mock.calls[0][0]
      expect(signArgs.data.message.maxFee).toBe('50500')
      // Reference behaviour: unbounded maxBlockHeight when the fee oracle is silent
      expect(signArgs.data.message.maxBlockHeight).toBe((2n ** 256n - 1n).toString())
    })

    it('rejects when user cancels or denies EIP-712 signature challenge', async () => {
      const mockSign = vi.fn().mockResolvedValueOnce({
        success: false,
        error: 'Kullanıcı PIN doğrulamasını iptal etti.',
      })
      const mockExecute = vi.fn()

      vi.mocked(gatewayServiceModule.getGatewayBalances).mockResolvedValueOnce({
        token: 'USDC',
        balances: [
          { domain: 26, depositor: userAddress, balance: '25.00' },
        ],
      })

      await expect(
        executeUcwGatewayTransfer({
          amount: '5',
          sourceChain: 'Arc_Testnet',
          destChain: 'Ethereum_Sepolia',
          connectedAddress: userAddress,
          signTypedData: mockSign,
          executeUcwContract: mockExecute,
        })
      ).rejects.toThrow('Kullanıcı PIN doğrulamasını iptal etti.')

      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('correctly handles reverse-direction transfer from other chains (Base_Sepolia) to Arc_Testnet', async () => {
      const mockSign = vi.fn().mockResolvedValueOnce({
        success: true,
        signature: '0xmock_base_signature',
      })
      const mockExecute = vi.fn()

      vi.mocked(gatewayServiceModule.getGatewayBalances).mockResolvedValueOnce({
        token: 'USDC',
        balances: [
          { domain: 6, depositor: userAddress, balance: '50.00' }, // Domain 6 = Base Sepolia
        ],
      })

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ([{ burnIntent: { maxBlockHeight: '70000000', maxFee: '50000' } }]),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ transferId: 'gw-transfer-reverse-456' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            status: 'confirmed',
            forwardingDetails: { transactionHash: '0xarcminttxhash' },
          }),
        })
      global.fetch = mockFetch

      const onStepProgress = vi.fn()

      const result = await executeUcwGatewayTransfer({
        amount: '15',
        sourceChain: 'Base_Sepolia',
        destChain: 'Arc_Testnet',
        connectedAddress: userAddress,
        signTypedData: mockSign,
        executeUcwContract: mockExecute,
        onStepProgress,
      })

      expect(mockSign).toHaveBeenCalledTimes(1)
      const signArgs = mockSign.mock.calls[0][0]
      expect(signArgs.blockchain).toBe('BASE-SEPOLIA')
      expect(signArgs.data.message.spec.sourceDomain).toBe(6)
      expect(signArgs.data.message.spec.destinationDomain).toBe(26)

      expect(result.forwarded).toBe(true)
      expect(result.sourceChain).toBe('Base_Sepolia')
      expect(result.destChain).toBe('Arc_Testnet')
      expect(result.mintTxHash).toBe('0xarcminttxhash')
      expect(result.status).toBe('confirmed')
    })
  })
})
