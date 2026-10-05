import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getCctpTokenMessenger,
  getCctpMessageTransmitter,
  getSourceUsdcAddress,
  checkUcwAllowanceSufficient,
  executeUcwBridgeTransfer,
  fetchCctpAttestation,
  fetchCctpFastFeeBps,
  cctpFastFeeSubunits,
  executeCctpReceiveMessage,
  ARC_CCTP_TOKEN_MESSENGER,
  ARC_USDC_ADDRESS,
  CCTP_TOKEN_MESSENGER_TESTNET,
  CCTP_MESSAGE_TRANSMITTER_TESTNET,
  pollCctpDestinationTx,
  parseCctpMessageNonce,
  CCTP_DEST_SCAN_LOOKBACK_BLOCKS,
  fetchCctpForwardQuote,
  cctpMessageAmountMatches,
  CCTP_FORWARD_HOOK_DATA,
  CCTP_MESSAGE_RECEIVED_ABI,
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

    // Forwarding Service quote (`?forward=true`) used by the default burn path.
    const FORWARD_QUOTE = [{
      finalityThreshold: 1000,
      minimumFee: 0,
      forwardFee: { low: 54324, med: 54324, high: 54664 },
    }]

    const stubFeeEndpoints = (opts?: { forward?: any; plain?: any; ok?: boolean }) => {
      vi.stubGlobal('fetch', vi.fn(async (input: any) => ({
        ok: opts?.ok ?? true,
        json: async () =>
          String(input).includes('forward=true')
            ? (opts?.forward ?? FORWARD_QUOTE)
            : (opts?.plain ?? [{ minimumFee: 0 }]),
      })))
    }

    beforeEach(() => {
      mockExecuteContract.mockReset()
      stubFeeEndpoints()
    })

    afterEach(() => {
      vi.unstubAllGlobals()
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

      // Should only call the burn (1 call) because allowance was sufficient —
      // through the Forwarding Service hook so Circle submits the destination mint.
      expect(mockExecuteContract).toHaveBeenCalledTimes(1)
      const call = mockExecuteContract.mock.calls[0][0]
      expect(call.blockchain).toBe('ARC-TESTNET')
      expect(call.contractAddress).toBe(ARC_CCTP_TOKEN_MESSENGER)
      expect(call.abiFunctionSignature).toBe('depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)')
      expect(call.abiParameters[0]).toBe(parseUnits('25', 6).toString())
      expect(call.abiParameters[1]).toBe(GATEWAY_DOMAINS['Base_Sepolia'])
      expect(call.abiParameters[4]).toBe('0x0000000000000000000000000000000000000000000000000000000000000000')
      // Protocol fee (0 bps on this stub) + live forwarding fee.
      expect(call.abiParameters[5]).toBe('54324')
      expect(call.abiParameters[6]).toBe(1000)
      expect(call.abiParameters[7]).toBe(CCTP_FORWARD_HOOK_DATA)
      expect(result.forwarded).toBe(true)
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

      // Second call: depositForBurnWithHook on Base Sepolia CCTP TokenMessenger
      const burnCall = mockExecuteContract.mock.calls[1][0]
      expect(burnCall.blockchain).toBe('BASE-SEPOLIA')
      expect(burnCall.contractAddress).toBe(CCTP_TOKEN_MESSENGER_TESTNET)
      expect(burnCall.abiFunctionSignature).toBe('depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)')
      expect(burnCall.abiParameters[1]).toBe(26) // Arc Testnet domain
      expect(burnCall.abiParameters[3]).toBe(USDC_ADDRESSES['Base_Sepolia'])
      expect(burnCall.abiParameters[4]).toBe('0x0000000000000000000000000000000000000000000000000000000000000000')
      expect(burnCall.abiParameters[5]).toBe('54324')
      expect(burnCall.abiParameters[6]).toBe(1000)
      expect(burnCall.abiParameters[7]).toBe(CCTP_FORWARD_HOOK_DATA)

      expect(onStepProgress).toHaveBeenCalledWith('approving')
      expect(onStepProgress).toHaveBeenCalledWith('burning')
      expect(onStepProgress).toHaveBeenCalledWith('completed')
    })

    it('quotes protocol + forwarding fees into the hook burn maxFee instead of signing 0', async () => {
      vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
      vi.spyOn(rpcModule, 'resilientReadContract').mockResolvedValue(parseUnits('500', 6))
      vi.spyOn(rpcModule, 'resilientWaitForReceipt').mockResolvedValue(successfulReceipt(`0x${'a'.repeat(64)}`) as any)
      // 1.3 bps on 25 USDC → protocol fee 3250 subunits, +20% buffer → 3900,
      // plus the live forwarding fee (med = 18090 subunits) → 21990.
      stubFeeEndpoints({
        forward: [{
          finalityThreshold: 1000,
          minimumFee: 1.3,
          forwardFee: { low: 17940, med: 18090, high: 18435 },
        }],
      })
      mockExecuteContract.mockResolvedValue({ success: true, txHash: `0x${'a'.repeat(64)}` })

      await executeUcwBridgeTransfer({
        amount: '25',
        sourceChain: 'Arc_Testnet',
        destChain: 'Base_Sepolia',
        recipientAddress: '0x9999999999999999999999999999999999999999',
        connectedAddress: '0x1234567890123456789012345678901234567890',
        executeUcwContract: mockExecuteContract,
      })

      const call = mockExecuteContract.mock.calls[0][0]
      expect(call.abiParameters[5]).toBe('21990')
      expect(call.abiParameters[6]).toBe(1000)
    })

    it('fails closed before any burn when the forwarding quote is unavailable', async () => {
      vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
      vi.spyOn(rpcModule, 'resilientReadContract').mockResolvedValue(parseUnits('500', 6))
      vi.spyOn(rpcModule, 'resilientWaitForReceipt').mockResolvedValue(successfulReceipt(`0x${'a'.repeat(64)}`) as any)
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      stubFeeEndpoints({ ok: false })
      mockExecuteContract.mockResolvedValue({ success: true, txHash: `0x${'a'.repeat(64)}` })

      await expect(executeUcwBridgeTransfer({
        amount: '25',
        sourceChain: 'Arc_Testnet',
        destChain: 'Base_Sepolia',
        recipientAddress: '0x9999999999999999999999999999999999999999',
        connectedAddress: '0x1234567890123456789012345678901234567890',
        executeUcwContract: mockExecuteContract,
      })).rejects.toThrow(/Forwarding Service is unavailable/)

      // No approval and no burn: nothing may leave the source wallet when the
      // destination mint cannot be guaranteed.
      expect(mockExecuteContract).not.toHaveBeenCalled()
    })

    it('keeps the legacy plain depositForBurn path when forwarding is disabled', async () => {
      vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
      vi.spyOn(rpcModule, 'resilientReadContract').mockResolvedValue(parseUnits('500', 6))
      vi.spyOn(rpcModule, 'resilientWaitForReceipt').mockResolvedValue(successfulReceipt(`0x${'a'.repeat(64)}`) as any)
      stubFeeEndpoints({ plain: [{ minimumFee: 1.3 }] })
      mockExecuteContract.mockResolvedValue({ success: true, txHash: `0x${'a'.repeat(64)}` })

      await executeUcwBridgeTransfer({
        amount: '25',
        sourceChain: 'Arc_Testnet',
        destChain: 'Base_Sepolia',
        recipientAddress: '0x9999999999999999999999999999999999999999',
        connectedAddress: '0x1234567890123456789012345678901234567890',
        executeUcwContract: mockExecuteContract,
        useForwarder: false,
      })

      const call = mockExecuteContract.mock.calls[0][0]
      expect(call.abiFunctionSignature).toBe('depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)')
      expect(call.abiParameters[5]).toBe('3900')
      expect(call.abiParameters).toHaveLength(7)
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

    function mockIrisAndDestinationReceipt(
      mintRecipient: string,
      includeRootTxHash: boolean = true,
      irisNonce: string = nonce,
      bodyOverrides: Record<string, unknown> = {},
      mintSplit: { amount: string; fee: string } = { amount: '24.99', fee: '0.01' }
    ) {
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
              nonce: irisNonce,
              messageBody,
              decodedMessageBody: {
                mintRecipient: recipient,
                burnToken: USDC_ADDRESSES[sourceChain],
                amount: parseUnits(amount, 6).toString(),
                ...bodyOverrides,
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
        [parseUnits(mintSplit.amount, 6), parseUnits(mintSplit.fee, 6)]
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
        // viem's getLogs accepts a single AbiEvent here. Passing the ABI array
        // threw AbiEventNotFoundError on every real scan (hidden by mocks) and
        // kept every bridge on "Pending" even after its mint had landed.
        event: CCTP_MESSAGE_RECEIVED_ABI[0],
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

    it('confirms a Forwarding Service mint whose burn amount includes the reserved fees (live App Kit shape)', async () => {
      // Live regression: an App Kit `useForwarder` burn records
      // `user amount + maxFee` in the Iris message (e.g. 25 USDC + 18077
      // subunits) and the destination TokenMessenger mints the user's amount
      // while reporting the reserved fee as feeCollected. Requiring the raw
      // message amount to equal the user's amount never matched, so a mint
      // that had already landed on-chain stayed "Bridge Pending" forever.
      const userAmountUnits = parseUnits(amount, 6)
      const maxFeeSubunits = parseUnits('0.018077', 6)
      mockIrisAndDestinationReceipt(
        recipient,
        true,
        nonce,
        {
          amount: (userAmountUnits + maxFeeSubunits).toString(),
          maxFee: maxFeeSubunits.toString(),
          feeExecuted: maxFeeSubunits.toString(),
          hookData: CCTP_FORWARD_HOOK_DATA,
        },
        { amount, fee: '0.018077' }
      )

      const result = await pollCctpDestinationTx({
        sourceChain, destChain, burnTxHash, recipientAddress: recipient, amount,
        maxAttempts: 1, intervalMs: 0,
      })

      expect(result).toEqual({ status: 'confirmed', destTxHash: destinationTxHash, receivedAmount: '25' })
      vi.unstubAllGlobals()
    })

    it('confirms a forward-hook burn whose fees were deducted from the transfer', async () => {
      const userAmountUnits = parseUnits(amount, 6)
      const feeExecuted = parseUnits('0.018077', 6)
      mockIrisAndDestinationReceipt(
        recipient,
        true,
        nonce,
        {
          amount: userAmountUnits.toString(),
          maxFee: feeExecuted.toString(),
          feeExecuted: feeExecuted.toString(),
          hookData: CCTP_FORWARD_HOOK_DATA,
        },
        { amount: '24.981923', fee: '0.018077' }
      )

      const result = await pollCctpDestinationTx({
        sourceChain, destChain, burnTxHash, recipientAddress: recipient, amount,
        maxAttempts: 1, intervalMs: 0,
      })

      expect(result).toEqual({ status: 'confirmed', destTxHash: destinationTxHash, receivedAmount: '24.981923' })
      vi.unstubAllGlobals()
    })

    it('never correlates a forwarded message whose amount matches neither the burn nor the reserved fees', async () => {
      mockIrisAndDestinationReceipt(recipient, true, nonce, {
        amount: parseUnits('99', 6).toString(),
        maxFee: parseUnits('0.018077', 6).toString(),
        feeExecuted: parseUnits('0.018077', 6).toString(),
        hookData: CCTP_FORWARD_HOOK_DATA,
      })

      const result = await pollCctpDestinationTx({
        sourceChain, destChain, burnTxHash, recipientAddress: recipient, amount,
        maxAttempts: 1, intervalMs: 0,
      })

      expect(result.status).toBe('pending')
      expect(result.destTxHash).toBeUndefined()
      vi.unstubAllGlobals()
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

    it('bounds the destination log scan window instead of rescanning from genesis', async () => {
      const { getLogs, getTransactionReceipt } = mockIrisAndDestinationReceipt(recipient)
      const latestBlock = 5_000_000n
      vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({
        getBlockNumber: vi.fn().mockResolvedValue(latestBlock),
        getLogs,
        getTransactionReceipt,
      } as any)

      const result = await pollCctpDestinationTx({
        sourceChain, destChain, burnTxHash, recipientAddress: recipient, amount,
        maxAttempts: 2, intervalMs: 0,
      })

      expect(result.status).toBe('confirmed')
      expect(getLogs).toHaveBeenCalled()
      const scanWindow = getLogs.mock.calls[0][0]
      expect(scanWindow.fromBlock).toBe(latestBlock - CCTP_DEST_SCAN_LOOKBACK_BLOCKS)
      expect(scanWindow.fromBlock).toBeGreaterThan(0n)
      expect(scanWindow.toBlock).toBe(latestBlock)
    })

    it('confirms when Circle Iris returns the nonce as a 0x-prefixed hex string (live sandbox shape)', async () => {
      // Live regression: iris-api-sandbox.circle.com returns
      // nonce = "0xb89321d37be0f14ddfdbcd0276a564ad85a7aa2115646c905a287eca0890bb94",
      // not the decimal string Circle documents. The old /^\d+$/ guard never
      // matched it, so the poll looped until exhaustion and the UI stayed on
      // "Bridge Pending" forever even though the mint was already confirmed.
      const hexNonce = '0xb89321d37be0f14ddfdbcd0276a564ad85a7aa2115646c905a287eca0890bb94'
      const { getLogs } = mockIrisAndDestinationReceipt(recipient, true, hexNonce)

      const result = await pollCctpDestinationTx({
        sourceChain, destChain, burnTxHash, recipientAddress: recipient, amount,
        maxAttempts: 1, intervalMs: 0,
      })

      expect(result).toEqual({ status: 'confirmed', destTxHash: destinationTxHash, receivedAmount: '24.99' })
      expect(getLogs).toHaveBeenCalledWith(expect.objectContaining({
        args: { nonce: `0x${BigInt(hexNonce).toString(16).padStart(64, '0')}` },
      }))
      vi.unstubAllGlobals()
    })

    it('never correlates a message whose nonce is neither decimal nor 0x-hex (fail-closed)', async () => {
      mockIrisAndDestinationReceipt(recipient, true, '0xZZ-not-a-nonce')

      const result = await pollCctpDestinationTx({
        sourceChain, destChain, burnTxHash, recipientAddress: recipient, amount,
        maxAttempts: 1, intervalMs: 0,
      })

      expect(result.status).toBe('pending')
      expect(result.destTxHash).toBeUndefined()
      vi.unstubAllGlobals()
    })

    it('logs a diagnosable warning with Iris miss counts when the budget is exhausted', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) }))
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const result = await pollCctpDestinationTx({
        sourceChain, destChain, burnTxHash, recipientAddress: recipient, amount,
        maxAttempts: 2, intervalMs: 0,
      })

      expect(result.status).toBe('pending')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`after 2 attempts for burn ${burnTxHash}`)
      )
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Iris HTTP misses: 2/2'))
      warnSpy.mockRestore()
      vi.unstubAllGlobals()
    })
  })

  describe('parseCctpMessageNonce', () => {
    it('accepts both the documented decimal nonce and the live 0x-hex nonce', () => {
      expect(parseCctpMessageNonce('569')).toBe(569n)
      expect(
        parseCctpMessageNonce('0xb89321d37be0f14ddfdbcd0276a564ad85a7aa2115646c905a287eca0890bb94')
      ).toBe(0xb89321d37be0f14ddfdbcd0276a564ad85a7aa2115646c905a287eca0890bb94n)
      expect(parseCctpMessageNonce('0')).toBe(0n)
    })

    it('rejects malformed or out-of-range values so correlation stays fail-closed', () => {
      const malformed: unknown[] = [
        '0xZZ',
        '12.5',
        ' 1',
        '',
        '0x',
        '-5',
        569,
        null,
        undefined,
        `0x${'f'.repeat(65)}`,
      ]
      for (const value of malformed) {
        expect(parseCctpMessageNonce(value)).toBeNull()
      }
    })
  })

  describe('cctpMessageAmountMatches', () => {
    const userAmount = parseUnits('25', 6)

    it('accepts the raw burn amount for self-mint transfers', () => {
      expect(cctpMessageAmountMatches({ amount: userAmount.toString() }, userAmount)).toBe(true)
    })

    it('accepts a forward-hook burn that reserved the fees on top of the amount', () => {
      const maxFee = parseUnits('0.018077', 6)
      expect(cctpMessageAmountMatches({
        amount: (userAmount + maxFee).toString(),
        maxFee: maxFee.toString(),
        feeExecuted: maxFee.toString(),
        hookData: CCTP_FORWARD_HOOK_DATA,
      }, userAmount)).toBe(true)
    })

    it('accepts a forward-hook burn whose fees were deducted from the amount', () => {
      const feeExecuted = parseUnits('0.018077', 6)
      expect(cctpMessageAmountMatches({
        amount: userAmount.toString(),
        maxFee: feeExecuted.toString(),
        feeExecuted: feeExecuted.toString(),
        hookData: CCTP_FORWARD_HOOK_DATA,
      }, userAmount)).toBe(true)
    })

    it('rejects amounts that match neither a plain burn nor a forwarded reservation', () => {
      expect(cctpMessageAmountMatches({ amount: (userAmount + 1n).toString() }, userAmount)).toBe(false)
      expect(cctpMessageAmountMatches({
        amount: parseUnits('99', 6).toString(),
        maxFee: parseUnits('0.01', 6).toString(),
        feeExecuted: parseUnits('0.01', 6).toString(),
        hookData: CCTP_FORWARD_HOOK_DATA,
      }, userAmount)).toBe(false)
      expect(cctpMessageAmountMatches(undefined, userAmount)).toBe(false)
    })
  })

  describe('fetchCctpForwardQuote', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('returns the forwarding fee for the requested finality threshold', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ([
          { finalityThreshold: 1000, minimumFee: 1.3, forwardFee: { low: 17940, med: 18090, high: 18435 } },
          { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 17940, med: 18090, high: 18435 } },
        ]),
      })))

      expect(await fetchCctpForwardQuote('Base_Sepolia', 'Arc_Testnet', 2000)).toEqual({
        finalityThreshold: 2000,
        minimumFeeBps: 0,
        forwardFeeSubunits: 18090n,
      })
    })

    it('returns null when the route has no forwarding fee so callers fail closed', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ([{ finalityThreshold: 1000, minimumFee: 0 }]),
      })))

      expect(await fetchCctpForwardQuote('Base_Sepolia', 'Arc_Testnet')).toBeNull()
    })
  })

  describe('fetchCctpFastFeeBps / cctpFastFeeSubunits', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('returns the live fast-fee in basis points for a route', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => [{ minimumFee: 1.4 }],
      })))
      expect(await fetchCctpFastFeeBps('Arc_Testnet', 'Base_Sepolia')).toBe(1.4)
    })

    it('returns null when the endpoint responds with an error', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
      expect(await fetchCctpFastFeeBps('Arc_Testnet', 'Base_Sepolia')).toBeNull()
    })

    it('returns null for an unusable payload or unsupported route', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => [{ minimumFee: 'not-a-number' }],
      })))
      expect(await fetchCctpFastFeeBps('Arc_Testnet', 'Base_Sepolia')).toBeNull()
      expect(await fetchCctpFastFeeBps('Unknown_Chain', 'Base_Sepolia')).toBeNull()
    })

    it('returns null when the request itself fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(await fetchCctpFastFeeBps('Arc_Testnet', 'Base_Sepolia')).toBeNull()
    })

    it('applies the recommended 20% buffer to the quoted fee', () => {
      // 100 USDC at 1.3 bps = 0.013 USDC = 13000 subunits → ×1.2 = 15600
      expect(cctpFastFeeSubunits(parseUnits('100', 6), 1.3)).toBe(15_600n)
      // Zero-fee routes keep maxFee at 0
      expect(cctpFastFeeSubunits(parseUnits('100', 6), 0)).toBe(0n)
      expect(cctpFastFeeSubunits(0n, 1.3)).toBe(0n)
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
