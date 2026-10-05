import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { encodeEventTopics, encodeAbiParameters, zeroAddress, parseUnits } from 'viem'

vi.mock('../rpc', async (importOriginal) => {
  const actual = await importOriginal<any>()
  return {
    ...actual,
    getResilientPublicClient: vi.fn(),
    resilientWaitForReceipt: vi.fn(),
  }
})

import { transferFromGateway } from '../gatewayService'
import { getNetwork } from '../../config/networks/networkRegistry'
import { USDC_ADDRESSES, GATEWAY_DOMAINS } from '../../config/gatewayConfig'
import * as rpcModule from '../rpc'

// The injected-wallet path must share the UCW path's fee source of truth:
// Circle's Gateway /estimate decides maxFee when it is higher than the proven
// local formula, and an /estimate outage can never lower that local floor.

const sourceChain = 'Arc_Testnet'
const destChain = 'Base_Sepolia'
const account = `0x${'aa'.repeat(20)}` as `0x${string}`
const amount = '100'
const mintTxHash = `0x${'cd'.repeat(32)}` as `0x${string}`
const localFloorMaxFee = 1_000_000n // 1.0 USDC local minimum (unchanged behavior)

const sourceChainDef = getNetwork(sourceChain)!.viemChain!
const destChainDef = getNetwork(destChain)!.viemChain!

const TRANSFER_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { type: 'address', indexed: true, name: 'from' },
      { type: 'address', indexed: true, name: 'to' },
      { type: 'uint256', indexed: false, name: 'value' },
    ],
  },
] as const

function okJson(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

function makeProvider() {
  const provider: any = {
    currentChainId: sourceChainDef.id,
    request: vi.fn(async ({ method, params }: any) => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account]
        case 'eth_chainId':
          return `0x${provider.currentChainId.toString(16)}`
        case 'wallet_switchEthereumChain':
          provider.currentChainId = parseInt(String(params?.[0]?.chainId), 16)
          return null
        case 'eth_signTypedData_v4':
          return `0x${'11'.repeat(65)}`
        case 'eth_sendTransaction':
          return mintTxHash
        default:
          return null
      }
    }),
  }
  return provider
}

function stubMintDelivery() {
  const topics = encodeEventTopics({
    abi: TRANSFER_ABI,
    eventName: 'Transfer',
    args: { from: zeroAddress, to: account },
  })
  const data = encodeAbiParameters([{ type: 'uint256' }], [parseUnits(amount, 6)])
  vi.spyOn(rpcModule, 'getResilientPublicClient').mockReturnValue({
    estimateContractGas: vi.fn().mockResolvedValue(60_000n),
    getTransactionReceipt: vi.fn().mockResolvedValue({
      status: 'success',
      transactionHash: mintTxHash,
      logs: [{ address: USDC_ADDRESSES[destChain], topics, data }],
    }),
  } as any)
  vi.mocked(rpcModule.resilientWaitForReceipt).mockResolvedValue({
    status: 'success',
    receipt: { transactionHash: mintTxHash },
    transactionHash: mintTxHash,
  } as any)
}

function stubFetch({ estimateFee, estimateOk = true }: { estimateFee: string; estimateOk?: boolean }) {
  const fetchMock = vi.fn(async (url: any) => {
    const u = String(url)
    if (u.includes('/estimate')) {
      return estimateOk
        ? okJson([{ burnIntent: { maxBlockHeight: '70000000', maxFee: estimateFee } }])
        : okJson({ error: 'unavailable' }, 503)
    }
    if (u.includes('/balances')) {
      return okJson({ balances: [{ domain: GATEWAY_DOMAINS[sourceChain], balance: '1000.000000' }] })
    }
    if (u.endsWith('/transfer')) {
      return okJson({ attestation: `0x${'ab'.repeat(128)}`, signature: `0x${'ef'.repeat(65)}` })
    }
    throw new Error(`Unexpected fetch in test: ${u}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function signedMaxFee(fetchMock: ReturnType<typeof vi.fn>): bigint {
  const transferCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/transfer'))
  expect(transferCall, 'transfer request must have been sent').toBeTruthy()
  const body = JSON.parse(String(transferCall![1].body))
  return BigInt(body[0].burnIntent.maxFee)
}

describe('transferFromGateway canonical maxFee', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    stubMintDelivery()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('signs the canonical /estimate maxFee when it exceeds the local floor', async () => {
    const fetchMock = stubFetch({ estimateFee: '2500000' }) // 2.5 USDC > 1.0 floor

    const result = await transferFromGateway({
      provider: makeProvider(),
      sourceChain,
      destinationChain: destChain,
      amount,
      recipient: account,
      sourceChainDef: sourceChainDef as any,
      destinationChainDef: destChainDef as any,
    })

    expect(result.mintTxHash).toBe(mintTxHash)
    expect(signedMaxFee(fetchMock)).toBe(2_500_000n)
  })

  it('never signs below the proven local floor when the quote is smaller', async () => {
    const fetchMock = stubFetch({ estimateFee: '3850' })

    await transferFromGateway({
      provider: makeProvider(),
      sourceChain,
      destinationChain: destChain,
      amount,
      recipient: account,
      sourceChainDef: sourceChainDef as any,
      destinationChainDef: destChainDef as any,
    })

    expect(signedMaxFee(fetchMock)).toBe(localFloorMaxFee)
  })

  it('falls back to the local floor when /estimate is unavailable', async () => {
    const fetchMock = stubFetch({ estimateFee: '0', estimateOk: false })

    const result = await transferFromGateway({
      provider: makeProvider(),
      sourceChain,
      destinationChain: destChain,
      amount,
      recipient: account,
      sourceChainDef: sourceChainDef as any,
      destinationChainDef: destChainDef as any,
    })

    expect(result.mintTxHash).toBe(mintTxHash)
    expect(signedMaxFee(fetchMock)).toBe(localFloorMaxFee)
  })
})
