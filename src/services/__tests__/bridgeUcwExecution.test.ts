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
  pollCctpDestinationTx,
} from '../bridgeUcwService'
import * as rpcModule from '../rpc'
import { USDC_ADDRESSES, GATEWAY_DOMAINS } from '../../config/gatewayConfig'
import { decodeEventLog, encodeAbiParameters, encodeEventTopics, parseUnits } from 'viem'

function successfulReceipt(hash: string) {
  return { receipt: { transactionHash: hash, status: 'success' }, transactionHash: hash, status: 'success' }
}

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
      vi.spyOn(rpcModule, 'resilientWaitForReceipt').mockResolvedValue(successfulReceipt(`0x${'a'.repeat(64)}`) as any)

      mockExecuteContract.mockResolvedValue({
        success: true,
        txHash: `0x${'a'.repeat(64)}`,
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

      expect(result.burnTxHash).toBe(`0x${'a'.repeat(64)}`)
      expect(result.destDomain).toBe(GATEWAY_DOMAINS['Base_Sepolia'])
      expect(result.mintRecipient).toBe('0x9999999999999999999999999999999999999999')
      expect(result.sourceExplorerUrl).toContain(`0x${'a'.repeat(64)}`)

      // Should only call depositForBurn (1 call) because allowance was sufficient
      expect(mockExecuteContract).toHaveBeenCalledTimes(1)
      const call = mockExecuteContract.mock.calls[0][0]
      expect(call.blockchain).toBe('ARC-TESTNET')
      expect(call.contractAddress).toBe(ARC_CCTP_TOKEN_MESSENGER)
      expect(call.abiFunctionSignature).toBe('depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)')
      expect(call.abiParameters[0]).toBe(parseUnits('25', 6).toString())
      expect(call.abiParameters[1]).toBe(GATEWAY_DOMAINS['Base_Sepolia'])
      expect(call.abiParameters[4]).toBe('0x0000000000000000000000000000000000000000000000000000000000000000')
      expect(call.abiParameters[5]).toBe('0')
      expect(call.abiParameters[6]).toBe(1000)
      expect(onStepProgress).toHaveBeenCalledWith('burning')
      expect(onStepProgress).toHaveBeenCalledWith('completed')
    })

    it('successfully initiates CCTP transfer from Base Sepolia to Arc Testnet with approval challenge', async () => {
      // Mock allowance insufficient (0), then confirm the approval transaction on-chain.
      vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
      vi.spyOn(rpcModule, 'resilientReadContract').mockResolvedValue(0n)
      vi.spyOn(rpcModule, 'resilientWaitForReceipt')
        .mockResolvedValueOnce(successfulReceipt(`0x${'b'.repeat(64)}`) as any)
        .mockResolvedValueOnce(successfulReceipt(`0x${'c'.repeat(64)}`) as any)

      mockExecuteContract
        .mockResolvedValueOnce({
          success: true,
          txHash: `0x${'b'.repeat(64)}`,
        })
        .mockResolvedValueOnce({
          success: true,
          txHash: `0x${'c'.repeat(64)}`,
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

      expect(result.burnTxHash).toBe(`0x${'c'.repeat(64)}`)
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
      expect(burnCall.abiFunctionSignature).toBe('depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)')
      expect(burnCall.abiParameters[1]).toBe(26) // Arc Testnet domain
      expect(burnCall.abiParameters[3]).toBe(USDC_ADDRESSES['Base_Sepolia'])
      expect(burnCall.abiParameters[4]).toBe('0x0000000000000000000000000000000000000000000000000000000000000000')
      expect(burnCall.abiParameters[5]).toBe('0')
      expect(burnCall.abiParameters[6]).toBe(1000)

      expect(onStepProgress).toHaveBeenCalledWith('approving')
      expect(onStepProgress).toHaveBeenCalledWith('burning')
      expect(onStepProgress).toHaveBeenCalledWith('completed')
    })

    it('does not proceed to burn when an approval receipt is missing', async () => {
      vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
      vi.spyOn(rpcModule, 'resilientReadContract').mockResolvedValue(0n)
      vi.spyOn(rpcModule, 'resilientWaitForReceipt').mockResolvedValue({ status: 'unknown' } as any)
      mockExecuteContract.mockResolvedValueOnce({ success: true, txHash: `0x${'e'.repeat(64)}` })

      await expect(executeUcwBridgeTransfer({
        amount: '10', sourceChain: 'Base_Sepolia', destChain: 'Arc_Testnet',
        recipientAddress: '0x2222222222222222222222222222222222222222',
        connectedAddress: '0x1234567890123456789012345678901234567890',
        executeUcwContract: mockExecuteContract,
      })).rejects.toThrow('USDC approval has not been confirmed')
      expect(mockExecuteContract).toHaveBeenCalledTimes(1)
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

  describe('pollCctpDestinationTx', () => {
    const sourceChain = 'Base_Sepolia'
    const destChain = 'Arc_Testnet'
    const burnTxHash = `0x${'a'.repeat(64)}`
    const recipient = '0x1111111111111111111111111111111111111111'
    const wrongRecipient = '0x2222222222222222222222222222222222222222'
    const destinationTxHash = `0x${'b'.repeat(64)}`
    const nonce = '12345'
    const messageBody = '0x1234'
    const amount = '25'

    const mintEventAbi = [{
      type: 'event', name: 'MintAndWithdraw',
      inputs: [
        { type: 'address', indexed: true, name: 'mintRecipient' },
        { type: 'uint256', indexed: false, name: 'amount' },
        { type: 'address', indexed: true, name: 'mintToken' },
        { type: 'uint256', indexed: false, name: 'feeCollected' },
      ],
    }] as const

    function mockIrisAndDestinationReceipt(mintRecipient: string, includeRootTxHash: boolean = true) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...(includeRootTxHash ? { sourceTxHash: burnTxHash } : {}),
          messages: [{
            message: '0xabcd',
            cctpVersion: 2,
            status: 'complete',
            decodedMessage: {
              sourceDomain: String(GATEWAY_DOMAINS[sourceChain]),
              destinationDomain: String(GATEWAY_DOMAINS[destChain]),
              nonce,
              messageBody,
              decodedMessageBody: {
                mintRecipient: recipient,
                burnToken: USDC_ADDRESSES[sourceChain],
                amount: parseUnits(amount, 6).toString(),
              },
            },
          }],
        }),
      }))

      const topics = encodeEventTopics({
        abi: mintEventAbi,
        eventName: 'MintAndWithdraw',
        args: {
          mintRecipient: mintRecipient as `0x${string}`,
          mintToken: USDC_ADDRESSES[destChain] as `0x${string}`,
        },
      })
      const data = encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256' }],
        [parseUnits('24.99', 6), parseUnits('0.01', 6)]
      )
      const getLogs = vi.fn().mockResolvedValue([{
        transactionHash: destinationTxHash,
        args: { messageBody },
      }])
      const mintLog = { address: CCTP_TOKEN_MESSENGER_TESTNET, topics, data }
      const getTransactionReceipt = vi.fn().mockResolvedValue({
        transactionHash: destinationTxHash,
        status: 'success',
        logs: [mintLog],
      })
      vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({
        getBlockNumber: vi.fn().mockResolvedValue(100n),
        getLogs,
        getTransactionReceipt,
      } as any)
      return { getLogs, getTransactionReceipt, mintLog }
    }

    it('confirms only the matching successful CCTP receive and exact TokenMessenger mint', async () => {
      const { getLogs, getTransactionReceipt, mintLog } = mockIrisAndDestinationReceipt(recipient)
      expect(decodeEventLog({
        abi: mintEventAbi,
        data: mintLog.data,
        topics: mintLog.topics as any,
      }).args).toMatchObject({ mintRecipient: recipient, mintToken: USDC_ADDRESSES[destChain], amount: parseUnits('24.99', 6), feeCollected: parseUnits('0.01', 6) })

      const result = await pollCctpDestinationTx({
        sourceChain, destChain, burnTxHash, recipientAddress: recipient, amount,
        maxAttempts: 1, intervalMs: 0,
      })

      expect(getLogs).toHaveBeenCalledWith(expect.objectContaining({
        address: CCTP_MESSAGE_TRANSMITTER_TESTNET,
        args: { nonce: `0x${BigInt(nonce).toString(16).padStart(64, '0')}` },
      }))
      expect(getTransactionReceipt).toHaveBeenCalledWith({ hash: destinationTxHash })
      expect(result).toEqual({ status: 'confirmed', destTxHash: destinationTxHash, receivedAmount: '24.99' })
    })

    it('successfully correlates documented Iris response when root sourceTxHash is absent (W3-10)', async () => {
      // Circle Iris API documented schema omits root sourceTxHash
      mockIrisAndDestinationReceipt(recipient, false)

      const result = await pollCctpDestinationTx({
        sourceChain, destChain, burnTxHash, recipientAddress: recipient, amount,
        maxAttempts: 1, intervalMs: 0,
      })

      expect(result).toEqual({ status: 'confirmed', destTxHash: destinationTxHash, receivedAmount: '24.99' })
    })

    it('does not confirm a CCTP mint delivered to a different recipient', async () => {
      mockIrisAndDestinationReceipt(wrongRecipient)

      const result = await pollCctpDestinationTx({
        sourceChain, destChain, burnTxHash, recipientAddress: recipient, amount,
        maxAttempts: 1, intervalMs: 0,
      })

      expect(result.status).toBe('pending')
      expect(result.destTxHash).toBeUndefined()
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
        txHash: `0x${'d'.repeat(64)}`,
      })

      const res = await executeCctpReceiveMessage({
        destChain: 'Arc_Testnet',
        messageBytes: '0x11223344',
        attestationBytes: '0x55667788',
        executeUcwContract: mockExecuteContract,
      })

      expect(res.success).toBe(true)
      expect(res.txHash).toBe(`0x${'d'.repeat(64)}`)
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
