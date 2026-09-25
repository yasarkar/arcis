import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getCctpTokenMessenger,
  getCctpMessageTransmitter,
  getSourceUsdcAddress,
  checkUcwAllowanceSufficient,
  executeUcwBridgeTransfer,
  fetchCctpAttestation,
  executeCctpReceiveMessage,
  ARC_CCTP_TOKEN_MESSENGER,
  ARC_USDC_ADDRESS,
  CCTP_TOKEN_MESSENGER_TESTNET,
  CCTP_MESSAGE_TRANSMITTER_TESTNET,
} from '../bridgeUcwService'
import * as rpcModule from '../rpc'
import { USDC_ADDRESSES, GATEWAY_DOMAINS } from '../../config/gatewayConfig'
import { parseUnits } from 'viem'

describe('bridgeUcwService Multi-Chain CCTP V2 Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Contract and Address Resolution', () => {
    it('resolves deterministic CCTP TokenMessengerV2 address on testnet', () => {
      const messenger = getCctpTokenMessenger('Base_Sepolia')
      expect(messenger).toBe(CCTP_TOKEN_MESSENGER_TESTNET)
      expect(messenger).toBe(ARC_CCTP_TOKEN_MESSENGER)
      expect(messenger).toBe('0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA')
    })

    it('resolves deterministic CCTP MessageTransmitterV2 address on testnet', () => {
      const transmitter = getCctpMessageTransmitter('Arc_Testnet')
      expect(transmitter).toBe(CCTP_MESSAGE_TRANSMITTER_TESTNET)
      expect(transmitter).toBe('0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275')
    })

    it('resolves USDC addresses accurately for all supported networks', () => {
      expect(getSourceUsdcAddress('Arc_Testnet')).toBe(ARC_USDC_ADDRESS)
      expect(getSourceUsdcAddress('Base_Sepolia')).toBe(USDC_ADDRESSES['Base_Sepolia'])
      expect(getSourceUsdcAddress('Ethereum_Sepolia')).toBe(USDC_ADDRESSES['Ethereum_Sepolia'])
      expect(getSourceUsdcAddress('Arbitrum_Sepolia')).toBe(USDC_ADDRESSES['Arbitrum_Sepolia'])
    })

    it('throws when requested for an unsupported network without USDC', () => {
      expect(() => getSourceUsdcAddress('Unknown_Chain')).toThrow(
        'USDC contract address not found for chain: Unknown_Chain'
      )
    })
  })

  describe('checkUcwAllowanceSufficient', () => {
    it('returns true when current allowance is greater than or equal to required amount', async () => {
      vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
      vi.spyOn(rpcModule, 'resilientReadContract').mockResolvedValue(parseUnits('100', 6))

      const isSufficient = await checkUcwAllowanceSufficient(
        '0x1234567890123456789012345678901234567890',
        parseUnits('50', 6),
        'Base_Sepolia'
      )

      expect(isSufficient).toBe(true)
    })

    it('returns false when current allowance is less than required amount', async () => {
      vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
      vi.spyOn(rpcModule, 'resilientReadContract').mockResolvedValue(parseUnits('20', 6))

      const isSufficient = await checkUcwAllowanceSufficient(
        '0x1234567890123456789012345678901234567890',
        parseUnits('50', 6),
        'Base_Sepolia'
      )

      expect(isSufficient).toBe(false)
    })

    it('returns false if reading allowance throws an error', async () => {
      vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
      vi.spyOn(rpcModule, 'resilientReadContract').mockRejectedValue(new Error('RPC Timeout'))

      const isSufficient = await checkUcwAllowanceSufficient(
        '0x1234567890123456789012345678901234567890',
        parseUnits('50', 6),
        'Arc_Testnet'
      )

      expect(isSufficient).toBe(false)
    })
  })

  describe('executeUcwBridgeTransfer', () => {
    const mockExecuteContract = vi.fn()

    beforeEach(() => {
      mockExecuteContract.mockReset()
    })

    it('successfully initiates CCTP transfer from Arc Testnet to Base Sepolia without re-approval', async () => {
      // Mock allowance sufficient
      vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
      vi.spyOn(rpcModule, 'resilientReadContract').mockResolvedValue(parseUnits('500', 6))

      mockExecuteContract.mockResolvedValue({
        success: true,
        txHash: '0xarcburn1234567890abcdef',
      })

      const onStepProgress = vi.fn()

      const result = await executeUcwBridgeTransfer({
        amount: '25',
        sourceChain: 'Arc_Testnet',
        destChain: 'Base_Sepolia',
        recipientAddress: '0x9999999999999999999999999999999999999999',
        connectedAddress: '0x1234567890123456789012345678901234567890',
        executeUcwContract: mockExecuteContract,
        onStepProgress,
      })

      expect(result.burnTxHash).toBe('0xarcburn1234567890abcdef')
      expect(result.destDomain).toBe(GATEWAY_DOMAINS['Base_Sepolia'])
      expect(result.mintRecipient).toBe('0x9999999999999999999999999999999999999999')
      expect(result.sourceExplorerUrl).toContain('0xarcburn1234567890abcdef')

      // Should only call depositForBurn (1 call) because allowance was sufficient
      expect(mockExecuteContract).toHaveBeenCalledTimes(1)
      const call = mockExecuteContract.mock.calls[0][0]
      expect(call.blockchain).toBe('ARC-TESTNET')
      expect(call.contractAddress).toBe(ARC_CCTP_TOKEN_MESSENGER)
      expect(call.abiFunctionSignature).toBe('depositForBurn(uint256,uint32,bytes32,address)')
      expect(onStepProgress).toHaveBeenCalledWith('burning')
      expect(onStepProgress).toHaveBeenCalledWith('completed')
    })

    it('successfully initiates CCTP transfer from Base Sepolia to Arc Testnet with approval challenge', async () => {
      // Mock allowance insufficient (0)
      vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
      vi.spyOn(rpcModule, 'resilientReadContract').mockResolvedValue(0n)

      mockExecuteContract
        .mockResolvedValueOnce({
          success: true,
          txHash: '0xapproveTx987654321',
        })
        .mockResolvedValueOnce({
          success: true,
          txHash: '0xbaseBurnTx123456',
        })

      const onStepProgress = vi.fn()

      const result = await executeUcwBridgeTransfer({
        amount: '10',
        sourceChain: 'Base_Sepolia',
        destChain: 'Arc_Testnet',
        recipientAddress: '0x2222222222222222222222222222222222222222',
        connectedAddress: '0x1234567890123456789012345678901234567890',
        executeUcwContract: mockExecuteContract,
        onStepProgress,
      })

      expect(result.burnTxHash).toBe('0xbaseBurnTx123456')
      expect(result.destDomain).toBe(GATEWAY_DOMAINS['Arc_Testnet']) // Domain 26
      expect(result.destDomain).toBe(26)

      // Should call approve first, then depositForBurn
      expect(mockExecuteContract).toHaveBeenCalledTimes(2)

      // First call: approve on Base Sepolia USDC
      const approveCall = mockExecuteContract.mock.calls[0][0]
      expect(approveCall.blockchain).toBe('BASE-SEPOLIA')
      expect(approveCall.contractAddress).toBe(USDC_ADDRESSES['Base_Sepolia'])
      expect(approveCall.abiFunctionSignature).toBe('approve(address,uint256)')

      // Second call: depositForBurn on Base Sepolia CCTP TokenMessenger
      const burnCall = mockExecuteContract.mock.calls[1][0]
      expect(burnCall.blockchain).toBe('BASE-SEPOLIA')
      expect(burnCall.contractAddress).toBe(CCTP_TOKEN_MESSENGER_TESTNET)
      expect(burnCall.abiParameters[1]).toBe(26) // Arc Testnet domain
      expect(burnCall.abiParameters[3]).toBe(USDC_ADDRESSES['Base_Sepolia'])

      expect(onStepProgress).toHaveBeenCalledWith('approving')
      expect(onStepProgress).toHaveBeenCalledWith('burning')
      expect(onStepProgress).toHaveBeenCalledWith('completed')
    })

    it('rejects when source chain equals destination chain', async () => {
      await expect(
        executeUcwBridgeTransfer({
          amount: '5',
          sourceChain: 'Base_Sepolia',
          destChain: 'Base_Sepolia',
          recipientAddress: '0x1234567890123456789012345678901234567890',
          connectedAddress: '0x1234567890123456789012345678901234567890',
          executeUcwContract: mockExecuteContract,
        })
      ).rejects.toThrow('Source and destination networks cannot be the same.')
    })

    it('rejects when recipient address is empty', async () => {
      await expect(
        executeUcwBridgeTransfer({
          amount: '5',
          sourceChain: 'Base_Sepolia',
          destChain: 'Arc_Testnet',
          recipientAddress: '',
          connectedAddress: '0x1234567890123456789012345678901234567890',
          executeUcwContract: mockExecuteContract,
        })
      ).rejects.toThrow('Please enter a valid recipient address.')
    })

    it('rejects when amount is 0', async () => {
      await expect(
        executeUcwBridgeTransfer({
          amount: '0',
          sourceChain: 'Base_Sepolia',
          destChain: 'Arc_Testnet',
          recipientAddress: '0x1234567890123456789012345678901234567890',
          connectedAddress: '0x1234567890123456789012345678901234567890',
          executeUcwContract: mockExecuteContract,
        })
      ).rejects.toThrow('Please enter a valid USDC amount.')
    })
  })

  describe('fetchCctpAttestation', () => {
    it('returns complete status when Circle Iris API confirms attestation', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'complete',
          attestation: '0xattestation_signature_bytes_123',
        }),
      })
      global.fetch = mockFetch

      const result = await fetchCctpAttestation('0xmessagehash123', true, 1, 10)
      expect(result.status).toBe('complete')
      expect(result.attestation).toBe('0xattestation_signature_bytes_123')
    })

    it('returns pending when attestation is not yet available after attempts', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'pending_confirmations' }),
      })
      global.fetch = mockFetch

      const result = await fetchCctpAttestation('0xmessagehash123', true, 2, 10)
      expect(result.status).toBe('pending')
      expect(result.attestation).toBeUndefined()
    })
  })

  describe('executeCctpReceiveMessage', () => {
    it('dispatches receiveMessage to MessageTransmitter on target chain', async () => {
      const mockExecuteContract = vi.fn().mockResolvedValue({
        success: true,
        txHash: '0xmintTxHash777',
      })

      const res = await executeCctpReceiveMessage({
        destChain: 'Arc_Testnet',
        messageBytes: '0x11223344',
        attestationBytes: '0x55667788',
        executeUcwContract: mockExecuteContract,
      })

      expect(res.success).toBe(true)
      expect(res.txHash).toBe('0xmintTxHash777')
      expect(mockExecuteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          contractAddress: CCTP_MESSAGE_TRANSMITTER_TESTNET,
          abiFunctionSignature: 'receiveMessage(bytes,bytes)',
          blockchain: 'ARC-TESTNET',
        })
      )
    })
  })
})
