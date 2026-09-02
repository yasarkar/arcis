import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  formatUnits,
  parseUnits,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet, ARC_TOKENS, ARC_METADATA } from '../src/config/arcChain'
import { DEFAULT_GASLESS_DAILY_LIMIT } from '../src/services/gaslessService'
import {
  getGaslessDailyQuota,
  incrementGaslessDailyQuota,
} from './rateLimiter'

const USDC_ADDRESS = ARC_TOKENS.USDC
const DAILY_FREE_LIMIT = DEFAULT_GASLESS_DAILY_LIMIT

const USDC_EIP3009_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'authorizationState',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// ─────────────────────────────────────────────────────────────
// 1. RELAYER TRANSACTION MUTEX (Prevents Nonce Collision)
// ─────────────────────────────────────────────────────────────
class RelayerTransactionMutex {
  private mutex = Promise.resolve()

  async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    let release: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    const current = this.mutex
    this.mutex = current.then(() => next)
    await current
    try {
      return await task()
    } finally {
      release!()
    }
  }
}

const relayerMutex = new RelayerTransactionMutex()

function getRelayerAccount() {
  const rawKey = (process.env.PRIVATE_KEY || '').trim()
  if (!rawKey) {
    throw new Error('PRIVATE_KEY is not configured in .env for Relayer service')
  }
  const formattedKey: Hex = rawKey.startsWith('0x') ? (rawKey as Hex) : `0x${rawKey}`
  return privateKeyToAccount(formattedKey)
}

function getPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_METADATA.rpcHttpUrl, { retryCount: 3, timeout: 15000 }),
  })
}

// ─────────────────────────────────────────────────────────────
// 2. GET: QUOTA & RELAYER HEALTH STATUS
// ─────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const url = new URL(req.url)
  const address = url.searchParams.get('address')

  if (!address || !isAddress(address)) {
    return Response.json(
      { success: false, error: 'Valid EVM address query param is required' },
      { status: 400 }
    )
  }

  try {
    const quota = await getGaslessDailyQuota(address, DAILY_FREE_LIMIT)
    const relayerAccount = getRelayerAccount()
    const publicClient = getPublicClient()

    let relayerBalanceFormatted = '0.00'
    try {
      const relayerBal = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: USDC_EIP3009_ABI,
        functionName: 'balanceOf',
        args: [relayerAccount.address],
      })
      relayerBalanceFormatted = formatUnits(relayerBal, 6)
    } catch {}

    return Response.json({
      success: true,
      address,
      sponsoredBy: 'ArcFlow Protocol',
      relayerAddress: relayerAccount.address,
      relayerBalanceUsdc: relayerBalanceFormatted,
      dailyLimit: quota.limit,
      usedCount: quota.count,
      remainingQuota: quota.remaining,
      isEligible: quota.remaining > 0,
    })
  } catch (error: any) {
    return Response.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// ─────────────────────────────────────────────────────────────
// 3. POST: PROCESS GASLESS EIP-3009 META-TRANSACTION
// ─────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const {
      from,
      to,
      value,
      validAfter = 0,
      validBefore,
      nonce,
      v,
      r,
      s,
    } = body

    // 1. Validate required fields
    if (!from || !to || !value || !nonce || v === undefined || !r || !s) {
      return Response.json(
        {
          success: false,
          error: 'Missing required EIP-3009 parameters (from, to, value, nonce, v, r, s).',
        },
        { status: 400 }
      )
    }

    if (!isAddress(from) || !isAddress(to)) {
      return Response.json(
        { success: false, error: 'Invalid EVM address for sender (from) or recipient (to).' },
        { status: 400 }
      )
    }

    // 2. Check Daily Free Gasless Quota (Redis / In-Memory Distributed)
    const quota = await getGaslessDailyQuota(from, DAILY_FREE_LIMIT)
    if (quota.remaining <= 0) {
      return Response.json(
        {
          success: false,
          error: `Daily free ${DAILY_FREE_LIMIT}/${DAILY_FREE_LIMIT} Gasless transfer limit has been reached. Please try again tomorrow or use standard sending.`,
          remainingQuota: 0,
        },
        { status: 429 }
      )
    }

    // 3. Set up Viem Clients for Arc Testnet
    const rpcUrl = ARC_METADATA.rpcHttpUrl
    const publicClient = getPublicClient()
    const relayerAccount = getRelayerAccount()

    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: arcTestnet,
      transport: http(rpcUrl, { retryCount: 3, timeout: 15000 }),
    })

    const transferValue = BigInt(value.toString())
    const validAfterBig = BigInt(validAfter.toString())
    const validBeforeBig = BigInt(
      (validBefore || Math.floor(Date.now() / 1000) + 3600).toString()
    )

    // 4. On-chain Verifications (Sender Balance, Nonce, Relayer Gas Reserve)
    const [senderBalance, isNonceUsed, relayerBalance] = await Promise.all([
      publicClient.readContract({
        address: USDC_ADDRESS,
        abi: USDC_EIP3009_ABI,
        functionName: 'balanceOf',
        args: [from as `0x${string}`],
      }),
      publicClient.readContract({
        address: USDC_ADDRESS,
        abi: USDC_EIP3009_ABI,
        functionName: 'authorizationState',
        args: [from as `0x${string}`, nonce as `0x${string}`],
      }),
      publicClient.readContract({
        address: USDC_ADDRESS,
        abi: USDC_EIP3009_ABI,
        functionName: 'balanceOf',
        args: [relayerAccount.address],
      }),
    ])

    if (isNonceUsed) {
      return Response.json(
        {
          success: false,
          error: 'Authorization signature (nonce) has already been used. Please start a new transaction.',
        },
        { status: 400 }
      )
    }

    if (senderBalance < transferValue) {
      const formattedSenderBal = formatUnits(senderBalance, 6)
      const formattedTransferVal = formatUnits(transferValue, 6)
      return Response.json(
        {
          success: false,
          error: `Insufficient USDC balance. Balance: ${formattedSenderBal} USDC, Attempting to send: ${formattedTransferVal} USDC.`,
        },
        { status: 400 }
      )
    }

    // Check if Relayer has enough gas liquidity (USDC)
    const minRelayerGasReserve = parseUnits('0.01', 6)
    if (relayerBalance < minRelayerGasReserve) {
      console.warn(`[Relayer Low Balance Alert]: Relayer balance is ${formatUnits(relayerBalance, 6)} USDC`)
      return Response.json(
        {
          success: false,
          error: 'Relayer gas liquidity is currently low. Please try standard transfer or notify the administrator.',
        },
        { status: 503 }
      )
    }

    // 5. Format v, r, s
    const parsedV = typeof v === 'string' ? parseInt(v, 16) || Number(v) : Number(v)
    const normalizedV = parsedV < 27 ? parsedV + 27 : parsedV
    const parsedR = (r.startsWith('0x') ? r : `0x${r}`) as `0x${string}`
    const parsedS = (s.startsWith('0x') ? s : `0x${s}`) as `0x${string}`
    const parsedNonce = (nonce.startsWith('0x') ? nonce : `0x${nonce}`) as `0x${string}`

    // 6. Execute with Mutex Lock to sequence nonce broadcasts
    const { receipt, txHash } = await relayerMutex.runExclusive(async () => {
      const { request } = await publicClient.simulateContract({
        account: relayerAccount,
        address: USDC_ADDRESS,
        abi: USDC_EIP3009_ABI,
        functionName: 'transferWithAuthorization',
        args: [
          from as `0x${string}`,
          to as `0x${string}`,
          transferValue,
          validAfterBig,
          validBeforeBig,
          parsedNonce,
          normalizedV,
          parsedR,
          parsedS,
        ],
      })

      const hash = await walletClient.writeContract(request)

      // Wait for sub-second confirmation on Arc Testnet
      const rec = await publicClient.waitForTransactionReceipt({
        hash,
        timeout: 20000,
      })

      return { receipt: rec, txHash: hash }
    })

    // 7. Increment daily quota
    const remainingQuota = await incrementGaslessDailyQuota(from, DAILY_FREE_LIMIT)

    return Response.json({
      success: true,
      txHash,
      blockNumber: receipt.blockNumber.toString(),
      status: receipt.status,
      from,
      to,
      amount: formatUnits(transferValue, 6),
      remainingQuota,
      message: 'Gasless transfer executed successfully on Arc L1!',
    })
  } catch (error: any) {
    console.error('[Relayer API Error]:', error)
    return Response.json(
      {
        success: false,
        error: error.shortMessage || error.message || 'Relayer transaction sending error.',
      },
      { status: 500 }
    )
  }
}
