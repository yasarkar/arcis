// src/services/__tests__/bridgeUcwCctpxPlan.test.ts
//
// Guards the Circle-UCW CCTP-X path (wETH/cirBTC) without a network or a wallet.
//
// Two different things are being pinned here:
//   • the request we hand Circle's encoder — token id, CCTS proxy, registry
//     token-manager address, signed quote and native fee — because a wrong value
//     in any of them moves funds through the wrong contract or not at all;
//   • the pass-through of what the encoder returns (`getCallData()`), so the
//     wallet signs exactly Circle's calldata and never a re-derived copy.
//
// The recorded values (CCTS proxy address, registry rows, quoted fee) come from
// the live probe in `docs/cctp-arc-testnet-route-matrix.md`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { decodeFunctionData, encodeFunctionData, erc20Abi, formatUnits, parseUnits } from 'viem'
import {
  CCTPX_IRIS_BASE,
  executeUcwCctpxBridge,
  getCctpxServiceAddress,
  planUcwCctpxTransfer,
  quoteUcwCctpxRelayerFee,
  type CctpxTokenDeployment,
  type UcwCctpxDeps,
  type UcwCctpxEncodeArgs,
  type UcwCctpxParams,
  type UcwCctpxQuoteArgs,
} from '../bridgeUcwCctpxService'
import * as rpcModule from '../rpc'

const WALLET = '0x1111111111111111111111111111111111111111'
const RECIPIENT = '0x2222222222222222222222222222222222222222'

/** An ERC-20 that is not the zero address; only its role as a fee token matters. */
const ARC_USDC_ADDRESS_FOR_TEST = '0x3600000000000000000000000000000000000000'

/** Arc Testnet's CrossChainTokenService (CCTS) proxy — measured. */
const ARC_CCTS_PROXY = '0x63753E722bd2C2A5DF6EE19C5106662208B81077'
/** cirBTC deployment rows: same manager on both domains, different tokens. */
const MANAGER = '0xb995f4060c38b7608626d0ccabe547cdc2c7390a'
const ARC_CIRBTC = '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf'
const ETH_CIRBTC = '0x3a3fe695f684bf9b9e43cf43c2b895ea5e392bb3'
const CIRBTC_TOKEN_ID = '0x7c27b7b6485f3ea49b7d1a439e288d3c3116f533302afabb7e372dfc0770cc7d'
const WETH_TOKEN_ID = '0xaa3cf4df2d82ec4b91da19afe54d414f637d068fe9cd52ba5e0e7e0d94f9eac8'

/** Measured IRIS quote for 0.0001 cirBTC (Arc → Ethereum Sepolia, FAST). */
const RECORDED_FEE = '3740199239139180000'
const RECORDED_SIGNED_QUOTE = `0x${'ab'.repeat(40)}`

/** Recorded `crossChainTransfer` calldata prefix (selector + tokenId). */
const RECORDED_TRANSFER_CALLDATA = `0x780c5acf${CIRBTC_TOKEN_ID.slice(2)}`

const CIRBTC_DEPLOYMENTS: CctpxTokenDeployment[] = [
  { domainId: 0, tokenAddress: ETH_CIRBTC, tokenManagerAddress: MANAGER },
  { domainId: 26, tokenAddress: ARC_CIRBTC, tokenManagerAddress: MANAGER },
]

/** Vitest mock accessor for a dependency that is typed as a plain function. */
const mockOf = (fn: unknown) => (fn as any).mock

function successfulReceipt(hash: string) {
  return { receipt: { transactionHash: hash, status: 'success' }, transactionHash: hash, status: 'success' }
}

function baseParams(overrides: Partial<UcwCctpxParams> = {}): UcwCctpxParams {
  return {
    tokenSymbol: 'cirBTC',
    amount: '0.0001',
    sourceChain: 'Arc_Testnet',
    destChain: 'Ethereum_Sepolia',
    recipientAddress: RECIPIENT,
    connectedAddress: WALLET,
    executeUcwContract: vi.fn(),
    ...overrides,
  }
}

/**
 * The real encoder is exercised separately by the live route probe; here it is
 * stubbed so the suite stays offline while still asserting *what we ask it for*.
 */
function stubDeps(overrides: Partial<UcwCctpxDeps> = {}) {
  const encodeCalls = vi.fn(async (args: UcwCctpxEncodeArgs) => ({
    approve: {
      to: args.tokenAddress,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [args.tokenManagerAddress as `0x${string}`, args.amountUnits],
      }),
    },
    transfer: {
      to: args.serviceAddress,
      data: RECORDED_TRANSFER_CALLDATA,
      value: args.nativeFeeAmount.toString(),
    },
  }))

  const deps: UcwCctpxDeps = {
    fetchTokenDeployments: vi.fn(
      async (_tokenId: string, _fetchImpl?: typeof globalThis.fetch) => CIRBTC_DEPLOYMENTS
    ),
    fetchQuote: vi.fn(async (_args: UcwCctpxQuoteArgs, _fetchImpl?: typeof globalThis.fetch) => ({
      signedQuote: RECORDED_SIGNED_QUOTE,
      feeToken: '0x0000000000000000000000000000000000000000',
      feeTotalAmount: RECORDED_FEE,
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    })),
    encodeCalls,
    getPublicClient: vi.fn(() => ({}) as any),
    nowSeconds: () => 1_000_000,
    approvalPollIntervalMs: 0,
    ...overrides,
  }

  return { deps, encodeCalls }
}

describe('quoteUcwCctpxRelayerFee', () => {
  const quoteParams = () => ({
    tokenSymbol: 'cirBTC',
    amount: '0.0001',
    sourceChain: 'Arc_Testnet',
    destChain: 'Ethereum_Sepolia',
    recipientAddress: RECIPIENT,
  })

  it('reports the quoted fee in the source chain native token', async () => {
    const { deps } = stubDeps()
    const fee = await quoteUcwCctpxRelayerFee(quoteParams(), deps)

    // Arc's native currency is USDC with 18 decimals, so the recorded subunits
    // are a USDC figure — not the 0.20 the CCTP v2 estimate would have shown.
    expect(fee.feeAmount).toBe(formatUnits(BigInt(RECORDED_FEE), 18))
    expect(fee.nativeSymbol).toBe('USDC')
    expect(fee.speed).toBe('FAST')
  })

  it('quotes the SLOW tier when asked', async () => {
    const { deps } = stubDeps()
    const fee = await quoteUcwCctpxRelayerFee({ ...quoteParams(), speed: 'SLOW' }, deps)
    expect(fee.speed).toBe('SLOW')
  })

  it('refuses tokens that do not move over CCTP-X', async () => {
    const { deps } = stubDeps()
    for (const tokenSymbol of ['USDC', 'EURC']) {
      await expect(
        quoteUcwCctpxRelayerFee({ ...quoteParams(), tokenSymbol }, deps)
      ).rejects.toThrow(/does not move over CCTP-X/)
    }
  })

  it('refuses an ERC-20-denominated quote instead of labelling it as native', async () => {
    const { deps } = stubDeps({
      fetchQuote: vi.fn(async (_args: UcwCctpxQuoteArgs) => ({
        signedQuote: RECORDED_SIGNED_QUOTE,
        feeToken: ARC_USDC_ADDRESS_FOR_TEST,
        feeTotalAmount: RECORDED_FEE,
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      })),
    })
    await expect(quoteUcwCctpxRelayerFee(quoteParams(), deps)).rejects.toThrow(
      /ERC-20 fee token/
    )
  })

  it('refuses an unusable fee figure', async () => {
    const { deps } = stubDeps({
      fetchQuote: vi.fn(async (_args: UcwCctpxQuoteArgs) => ({
        signedQuote: RECORDED_SIGNED_QUOTE,
        feeToken: '0x0000000000000000000000000000000000000000',
        feeTotalAmount: 'n/a',
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      })),
    })
    await expect(quoteUcwCctpxRelayerFee(quoteParams(), deps)).rejects.toThrow(
      /unusable CCTP-X fee quote/
    )
  })
})

describe('planUcwCctpxTransfer', () => {
  it('targets the CCTS proxy with the registry token address and manager approval', async () => {
    const { deps, encodeCalls } = stubDeps()

    const plan = await planUcwCctpxTransfer(baseParams({ tokenSymbol: 'cirBTC' }), deps)

    expect(plan.tokenSymbol).toBe('cirBTC')
    expect(plan.decimals).toBe(8)
    expect(plan.sourceDomain).toBe(26)
    expect(plan.destDomain).toBe(0)
    expect(plan.serviceAddress).toBe(ARC_CCTS_PROXY)
    expect(plan.tokenAddress).toBe(ARC_CIRBTC)
    expect(plan.tokenManagerAddress).toBe(MANAGER)
    expect(plan.amountUnits).toBe(parseUnits('0.0001', 8))

    // Approve the manager for the token, transfer through the CCTS proxy.
    expect(plan.approve.to).toBe(ARC_CIRBTC)
    expect(plan.transfer.to).toBe(ARC_CCTS_PROXY)
    expect(plan.approve.data.startsWith('0x095ea7b3')).toBe(true)
    expect(plan.transfer.data.startsWith('0x780c5acf')).toBe(true)

    // The approve's delegate must be the registry's token manager, not a guess.
    const decoded = decodeFunctionData({ abi: erc20Abi, data: plan.approve.data as `0x${string}` })
    expect(decoded.functionName).toBe('approve')
    expect(String(decoded.args?.[0]).toLowerCase()).toBe(MANAGER)
    expect(decoded.args?.[1]).toBe(parseUnits('0.0001', 8))

    // The quoted native fee travels with the call as msg.value.
    expect(plan.transfer.value).toBe(RECORDED_FEE)
    expect(plan.quote.feeTotalAmount).toBe(RECORDED_FEE)
    expect(plan.quote.signedQuote).toBe(RECORDED_SIGNED_QUOTE)

    // And the quote request must carry the token, the domain pair and the amount.
    expect(mockOf(deps.fetchQuote).calls[0][0]).toMatchObject({
      tokenId: CIRBTC_TOKEN_ID,
      sourceDomain: 26,
      destinationDomain: 0,
      amountUnits: 10_000n,
      destinationAddress: RECIPIENT,
      speed: 'FAST',
    })
    expect(mockOf(deps.fetchTokenDeployments).calls[0][0]).toBe(CIRBTC_TOKEN_ID)

    // And the encoder itself must receive the verified parameters.
    expect(encodeCalls).toHaveBeenCalledTimes(1)
    expect(encodeCalls.mock.calls[0][0]).toMatchObject({
      chainKey: 'Arc_Testnet',
      address: WALLET,
      amountUnits: parseUnits('0.0001', 8),
      destinationDomain: 0,
      destinationAddress: RECIPIENT,
      minFinalityThreshold: 1000,
      serviceAddress: ARC_CCTS_PROXY,
      signedQuote: RECORDED_SIGNED_QUOTE,
      nativeFeeAmount: BigInt(RECORDED_FEE),
      tokenAddress: ARC_CIRBTC,
      tokenManagerAddress: MANAGER,
    })
  })

  it('asks the registry for the token being bridged, never another token’s id', async () => {
    const { deps } = stubDeps()
    await planUcwCctpxTransfer(baseParams(), deps)
    expect(mockOf(deps.fetchTokenDeployments).calls[0][0]).toBe(CIRBTC_TOKEN_ID)

    const weth = stubDeps({
      fetchTokenDeployments: vi.fn(
        async (_tokenId: string, _fetchImpl?: typeof globalThis.fetch) => CIRBTC_DEPLOYMENTS
      ),
    })
    await planUcwCctpxTransfer(baseParams({ tokenSymbol: 'wETH', amount: '0.5' }), weth.deps)
    expect(mockOf(weth.deps.fetchTokenDeployments).calls[0][0]).toBe(WETH_TOKEN_ID)
  })

  it('quotes the requested speed and maps it to Circle’s finality threshold', async () => {
    const { deps, encodeCalls } = stubDeps()

    await planUcwCctpxTransfer(baseParams({ speed: 'SLOW' }), deps)

    expect(mockOf(deps.fetchQuote).calls[0][0]).toMatchObject({ speed: 'SLOW' })
    expect(encodeCalls.mock.calls[0][0].minFinalityThreshold).toBe(2000)
  })

  it('resolves the CCTS proxy from the SDK chain definitions, refusing chains without one', () => {
    expect(getCctpxServiceAddress('Arc_Testnet')).toBe(ARC_CCTS_PROXY)
    expect(getCctpxServiceAddress('Base_Sepolia')).toMatch(/^0x[0-9a-fA-F]{40}$/)
    // A chain with no `cctpx.serviceAddress` can never carry these tokens.
    expect(() => getCctpxServiceAddress('Solana_Devnet')).toThrow(/CrossChainTokenService/)
  })

  it('points at the sandbox registry on testnet', () => {
    expect(CCTPX_IRIS_BASE).toBe('https://iris-api-sandbox.circle.com')
  })

  describe('rejections', () => {
    it('refuses tokens that belong to the CCTP v2 mechanism', async () => {
      const { deps } = stubDeps()
      await expect(planUcwCctpxTransfer(baseParams({ tokenSymbol: 'USDC' }), deps)).rejects.toThrow(
        /moves over CCTP v2/
      )
      await expect(planUcwCctpxTransfer(baseParams({ tokenSymbol: 'EURC' }), deps)).rejects.toThrow(
        /moves over CCTP v2/
      )
    })

    it('refuses a token Circle does not carry', async () => {
      const { deps } = stubDeps()
      await expect(planUcwCctpxTransfer(baseParams({ tokenSymbol: 'WBTC' }), deps)).rejects.toThrow(
        /not a Circle-supported bridge token/
      )
    })

    it('refuses a pair outside the route matrix', async () => {
      const { deps } = stubDeps()
      await expect(
        planUcwCctpxTransfer(baseParams({ destChain: 'Base_Sepolia' }), deps)
      ).rejects.toThrow(/cannot be bridged from Arc_Testnet to Base_Sepolia/)
    })

    it('refuses the same chain twice and a non-EVM recipient', async () => {
      const { deps } = stubDeps()
      await expect(
        planUcwCctpxTransfer(baseParams({ destChain: 'Arc_Testnet' }), deps)
      ).rejects.toThrow(/cannot be the same/)
      await expect(
        planUcwCctpxTransfer(baseParams({ recipientAddress: 'not-an-address' }), deps)
      ).rejects.toThrow(/valid 20-byte EVM recipient/)
    })

    it('refuses a zero amount and more decimals than the token has', async () => {
      const { deps } = stubDeps()
      await expect(planUcwCctpxTransfer(baseParams({ amount: '0' }), deps)).rejects.toThrow(
        /valid cirBTC amount/
      )
      await expect(planUcwCctpxTransfer(baseParams({ amount: '0.123456789' }), deps)).rejects.toThrow(
        /at most 8 decimal places/
      )
    })

    it('fails closed when the registry lacks a deployment on either end', async () => {
      const { deps } = stubDeps({
        fetchTokenDeployments: vi.fn(async (_tokenId: string) => [CIRBTC_DEPLOYMENTS[1]]),
      })
      await expect(planUcwCctpxTransfer(baseParams(), deps)).rejects.toThrow(
        /no cirBTC deployment on both domains/
      )
    })

    it('fails closed when the registry is unreachable instead of guessing an address', async () => {
      const { deps } = stubDeps({
        fetchTokenDeployments: vi.fn(async (_tokenId: string) => {
          throw new Error('registry down')
        }),
      })
      await expect(planUcwCctpxTransfer(baseParams(), deps)).rejects.toThrow(/registry down/)
    })

    it('refuses a source registry row whose address is not a valid EVM address', async () => {
      // Only the source row's addresses are encoded into the approve + transfer
      // calldata, and a junk address there would call the wrong contract, so both
      // of its fields are validated before anything is signed.
      const badToken = stubDeps({
        fetchTokenDeployments: vi.fn(async (_tokenId: string) => [
          CIRBTC_DEPLOYMENTS[0],
          { domainId: 26, tokenAddress: '0xdead', tokenManagerAddress: MANAGER },
        ]),
      })
      await expect(planUcwCctpxTransfer(baseParams(), badToken.deps)).rejects.toThrow(
        /no usable cirBTC address/
      )

      const badManager = stubDeps({
        fetchTokenDeployments: vi.fn(async (_tokenId: string) => [
          CIRBTC_DEPLOYMENTS[0],
          { domainId: 26, tokenAddress: ARC_CIRBTC, tokenManagerAddress: 'not-hex' },
        ]),
      })
      await expect(planUcwCctpxTransfer(baseParams(), badManager.deps)).rejects.toThrow(
        /no usable cirBTC address/
      )
    })

    it('refuses an expired or unusable fee quote', async () => {
      const expired = stubDeps({
        fetchQuote: vi.fn(async (_args: UcwCctpxQuoteArgs) => ({
          signedQuote: RECORDED_SIGNED_QUOTE,
          feeToken: '0x0000000000000000000000000000000000000000',
          feeTotalAmount: RECORDED_FEE,
          expiresAt: 999_999,
        })),
      })
      await expect(planUcwCctpxTransfer(baseParams(), expired.deps)).rejects.toThrow(/expired/)

      const unsigned = stubDeps({
        fetchQuote: vi.fn(async (_args: UcwCctpxQuoteArgs) => ({
          signedQuote: '',
          feeToken: '0x0000000000000000000000000000000000000000',
          feeTotalAmount: RECORDED_FEE,
          expiresAt: 2_000_000,
        })),
      })
      await expect(planUcwCctpxTransfer(baseParams(), unsigned.deps)).rejects.toThrow(
        /no signed CCTP-X fee quote/
      )
    })

    it('refuses a quote denominated in an ERC-20 fee token it cannot approve for', async () => {
      const { deps } = stubDeps({
        fetchQuote: vi.fn(async (_args: UcwCctpxQuoteArgs) => ({
          signedQuote: RECORDED_SIGNED_QUOTE,
          feeToken: '0xA0b86a33E6441c8C1c7C16e4c5e3e5b5e4c5e3e5b',
          feeTotalAmount: RECORDED_FEE,
          expiresAt: 2_000_000,
        })),
      })
      await expect(planUcwCctpxTransfer(baseParams(), deps)).rejects.toThrow(/ERC-20 fee token/)
    })
  })
})

describe('executeUcwCctpxBridge', () => {
  let executeUcwContract: ReturnType<typeof vi.fn>

  beforeEach(() => {
    executeUcwContract = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function stubChain(allowance: bigint) {
    vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
    vi.spyOn(rpcModule, 'resilientReadContract').mockResolvedValue(allowance)
    vi.spyOn(rpcModule, 'resilientWaitForReceipt').mockImplementation(
      async (_client: any, hash: any) => successfulReceipt(hash) as any
    )
  }

  it('approves the manager then transfers through the CCTS proxy, fee included', async () => {
    stubChain(0n)
    const approveHash = `0x${'a'.repeat(64)}`
    const burnHash = `0x${'b'.repeat(64)}`
    executeUcwContract
      .mockResolvedValueOnce({ success: true, txHash: approveHash })
      .mockResolvedValueOnce({ success: true, txHash: burnHash })

    const { deps } = stubDeps()
    const onStepProgress = vi.fn()

    const result = await executeUcwCctpxBridge(
      baseParams({ executeUcwContract: executeUcwContract as any, onStepProgress }),
      deps
    )

    expect(executeUcwContract).toHaveBeenCalledTimes(2)

    const approveCall = executeUcwContract.mock.calls[0][0]
    expect(approveCall.contractAddress).toBe(ARC_CIRBTC)
    expect(approveCall.callData.startsWith('0x095ea7b3')).toBe(true)
    expect(approveCall.blockchain).toBe('ARC-TESTNET')
    expect(approveCall.amount).toBeUndefined()

    const transferCall = executeUcwContract.mock.calls[1][0]
    expect(transferCall.contractAddress).toBe(ARC_CCTS_PROXY)
    expect(transferCall.callData).toBe(RECORDED_TRANSFER_CALLDATA)
    expect(transferCall.blockchain).toBe('ARC-TESTNET')
    // Arc pays gas in USDC with 18 decimals — the quoted wei must be sent as-is.
    expect(transferCall.amount).toBe(formatUnits(BigInt(RECORDED_FEE), 18))

    expect(result.burnTxHash).toBe(burnHash)
    expect(result.destDomain).toBe(0)
    expect(result.mintRecipient).toBe(RECIPIENT)
    expect(result.sourceExplorerUrl).toContain(burnHash)
    expect(onStepProgress.mock.calls.map((call) => call[0])).toEqual([
      'approving',
      'burning',
      'completed',
    ])
  })

  it('skips the approval challenge when the manager allowance already covers the amount', async () => {
    stubChain(parseUnits('1', 8))
    executeUcwContract.mockResolvedValue({ success: true, txHash: `0x${'b'.repeat(64)}` })

    const { deps } = stubDeps()
    await executeUcwCctpxBridge(baseParams({ executeUcwContract: executeUcwContract as any }), deps)

    expect(executeUcwContract).toHaveBeenCalledTimes(1)
    expect(executeUcwContract.mock.calls[0][0].contractAddress).toBe(ARC_CCTS_PROXY)
  })

  it('never submits the transfer when the approval is not confirmed on-chain', async () => {
    vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
    vi.spyOn(rpcModule, 'resilientReadContract').mockResolvedValue(0n)
    vi.spyOn(rpcModule, 'resilientWaitForReceipt').mockResolvedValue({ status: 'unknown' } as any)
    executeUcwContract.mockResolvedValueOnce({ success: true, txHash: `0x${'a'.repeat(64)}` })

    const { deps } = stubDeps()
    await expect(
      executeUcwCctpxBridge(baseParams({ executeUcwContract: executeUcwContract as any }), deps)
    ).rejects.toThrow(/approval has not been confirmed/)
    expect(executeUcwContract).toHaveBeenCalledTimes(1)
  })

  it('reports a pending hash instead of inventing a transaction hash', async () => {
    stubChain(parseUnits('1', 8))
    executeUcwContract.mockResolvedValueOnce({ success: true, hashPending: true, challengeId: 'ch_1' })

    const { deps } = stubDeps()
    const result = await executeUcwCctpxBridge(
      baseParams({ executeUcwContract: executeUcwContract as any }),
      deps
    )

    expect(result.burnTxHash).toBe('')
    expect(result.sourceExplorerUrl).toBe('')
    expect(result.challengeId).toBe('ch_1')
    // Only the allowance read happened; no receipt was awaited for a burn that
    // has no hash yet.
    expect(rpcModule.resilientWaitForReceipt).not.toHaveBeenCalled()
  })

  it('surfaces a reverted source transfer instead of reporting success', async () => {
    vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({} as any)
    vi.spyOn(rpcModule, 'resilientReadContract').mockResolvedValue(parseUnits('1', 8))
    vi.spyOn(rpcModule, 'resilientWaitForReceipt').mockResolvedValue({
      receipt: { transactionHash: `0x${'b'.repeat(64)}`, status: 'reverted' },
      transactionHash: `0x${'b'.repeat(64)}`,
      status: 'reverted',
    } as any)
    executeUcwContract.mockResolvedValueOnce({ success: true, txHash: `0x${'b'.repeat(64)}` })

    const { deps } = stubDeps()
    await expect(
      executeUcwCctpxBridge(baseParams({ executeUcwContract: executeUcwContract as any }), deps)
    ).rejects.toThrow(/reverted/)
  })
})
