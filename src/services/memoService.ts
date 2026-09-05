// Official Arc Testnet Transaction Memo Service.
// Enables sending USDC on Arc Testnet with on-chain metadata (memos, invoice refs)
// via the pre-deployed Memo contract (0x5294E9927c3306DcBaDb03fe70b92e01cCede505).
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  hexToString,
  http,
  isHex,
  keccak256,
  parseAbiItem,
  parseEventLogs,
  parseUnits,
  stringToHex,
  type Address,
} from 'viem'
import { arcTestnet, ARC_METADATA } from '../config/arcChain'
import {
  MEMO_ABI,
  MEMO_CONTRACT_ADDRESS,
  ARC_USDC_CONTRACT_ADDRESS,
  type MemoSendResult,
} from '../config/memoConfig'
import {
  getDynamicArcGasOptions,
  ARC_GAS_LIMITS,
  type SpeedTier,
} from '../config/feeTiers'

/**
 * Creates a public client connected directly to Arc Testnet HTTP RPC.
 */
export function getArcPublicClient() {
  const rpcUrl = arcTestnet.rpcUrls?.default?.http?.[0] || ARC_METADATA.rpcHttpUrl
  return createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl, { timeout: 30_000, retryCount: 3 }),
    batch: { multicall: false },
    pollingInterval: 5000,
  })
}

/**
 * Generates a 32-byte memoId from custom text or random entropy.
 */
export function generateMemoId(text?: string): `0x${string}` {
  if (text && isHex(text) && text.length === 66) {
    return text as `0x${string}`
  }
  if (text && text.trim().length > 0) {
    return keccak256(stringToHex(text.trim()))
  }
  const entropy = `arcis-memo-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  return keccak256(stringToHex(entropy))
}

/**
 * Encodes human-readable text into hex bytes for Memo.memo(...)
 */
export function encodeMemoData(memoText: string): `0x${string}` {
  if (!memoText || memoText.trim() === '') {
    return '0x' as `0x${string}`
  }
  return stringToHex(memoText)
}

/**
 * Decodes hex bytes from Memo event back to readable UTF-8 string.
 */
export function decodeMemoData(memoHex: string): string {
  if (!memoHex || memoHex === '0x') return ''
  try {
    return hexToString(memoHex as `0x${string}`)
  } catch {
    return memoHex
  }
}

/**
 * Ensures the wallet is switched to Arc Testnet (5042002).
 */
async function ensureArcChain(provider: any) {
  const chainIdHex = `0x${arcTestnet.id.toString(16)}`
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    })
  } catch {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: chainIdHex,
          chainName: arcTestnet.name,
          nativeCurrency: arcTestnet.nativeCurrency,
          rpcUrls: arcTestnet.rpcUrls.default.http,
          blockExplorerUrls: arcTestnet.blockExplorers?.default?.url
            ? [arcTestnet.blockExplorers.default.url]
            : ['https://testnet.arcscan.app'],
        },
      ],
    })
  }
}

/**
 * Sends USDC on Arc Testnet with an attached on-chain Memo metadata.
 *
 * Flow:
 * 1. Checks that Memo contract is active on Arc Testnet.
 * 2. Encodes the inner ERC-20 transfer(recipient, amount) calldata.
 * 3. Builds memoId (32-byte hash) and memoData (UTF-8 hex).
 * 4. Calls Memo.memo(target, data, memoId, memoData) from the user's EOA.
 * 5. Waits for transaction receipt and parses emitted Memo / BeforeMemo events.
 */
export async function sendUsdcWithMemo(
  provider: any,
  recipient: string,
  amount: string,
  memoText: string,
  customMemoId?: string,
  tier: SpeedTier = 'fast'
): Promise<MemoSendResult> {
  if (!provider) {
    throw new Error('No browser wallet provider found. Please connect your wallet.')
  }

  const accounts = (await provider.request({
    method: 'eth_requestAccounts',
  })) as string[]

  if (!accounts?.[0]) {
    throw new Error('No active wallet account returned.')
  }

  const senderAddress = getAddress(accounts[0] as Address)
  const recipientAddress = getAddress(recipient as Address)

  await ensureArcChain(provider)

  const publicClient = getArcPublicClient()
  const walletClient = createWalletClient({
    account: senderAddress,
    chain: arcTestnet,
    transport: custom(provider),
  })

  // 1. Verify Memo Contract deployment
  const memoCode = await publicClient.getCode({ address: MEMO_CONTRACT_ADDRESS })
  if (!memoCode || memoCode === '0x') {
    throw new Error(`Arc Memo contract is not found at ${MEMO_CONTRACT_ADDRESS}`)
  }

  // 2. Encode inner ERC-20 transfer calldata (USDC has 6 decimals)
  const amountBaseUnits = parseUnits(amount, 6)
  const transferCalldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'transfer',
    args: [recipientAddress, amountBaseUnits],
  })
  const callDataHash = keccak256(transferCalldata)

  // 3. Prepare Memo ID and Memo Payload
  const memoId = generateMemoId(customMemoId || memoText)
  const memoBytes = encodeMemoData(memoText)

  console.log('[Arc Memo Service] Executing Memo Transfer...')
  console.log(`[Arc Memo Service] Sender: ${senderAddress}`)
  console.log(`[Arc Memo Service] Recipient: ${recipientAddress}`)
  console.log(`[Arc Memo Service] Amount: ${amount} USDC`)
  console.log(`[Arc Memo Service] Memo Text: "${memoText}"`)
  console.log(`[Arc Memo Service] Memo ID: ${memoId}`)
  console.log(`[Arc Memo Service] Speed Tier: ${tier}`)

  // Dynamically resolve Arc L1 gas parameters from RPC (EWMA base fee, 20 Gwei floor, speed tier)
  const gasOptions = await getDynamicArcGasOptions(publicClient, tier, ARC_GAS_LIMITS.memoTransfer)
  console.log(
    `[Arc Memo Service] Dynamic Gas: maxFee=${gasOptions.maxFeePerGas.toString()} wei (source: ${gasOptions.source}), estCost=${gasOptions.estimatedCostUsdc} USDC`
  )

  // 4. Send transaction to Memo contract with dynamic EIP-1559 gas parameters
  const txHash = await walletClient.writeContract({
    address: MEMO_CONTRACT_ADDRESS,
    abi: MEMO_ABI,
    functionName: 'memo',
    args: [ARC_USDC_CONTRACT_ADDRESS, transferCalldata, memoId, memoBytes],
    account: senderAddress,
    maxFeePerGas: gasOptions.maxFeePerGas,
    maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas,
  })

  console.log(`[Arc Memo Service] Tx submitted: ${txHash}. Waiting for confirmation...`)

  // 5. Wait for transaction receipt
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 60_000,
    confirmations: 1,
  })

  if (receipt.status !== 'success') {
    throw new Error(`Memo transaction reverted on Arc Testnet (tx: ${txHash})`)
  }

  // Calculate actual gas fee paid on Arc L1 (18 decimals native USDC accounting)
  const effectiveGasPrice = receipt.effectiveGasPrice || gasOptions.maxFeePerGas
  const actualGasCostWei = receipt.gasUsed * effectiveGasPrice
  const gasFeeUsdc = (Number(actualGasCostWei) / 1e18).toFixed(5)

  console.log(
    `[Arc Memo Service] Confirmed in block ${receipt.blockNumber} (Gas Used: ${receipt.gasUsed.toString()}, Cost: ${gasFeeUsdc} USDC)`
  )

  // 6. Parse and verify emitted logs
  const parsedLogs = parseEventLogs({
    abi: MEMO_ABI,
    logs: receipt.logs,
  })

  const memoEvent = parsedLogs.find((l) => l.eventName === 'Memo')
  const memoArgs = memoEvent?.args as
    | {
        sender: Address
        target: Address
        callDataHash: `0x${string}`
        memoId: `0x${string}`
        memo: `0x${string}`
        memoIndex: bigint
      }
    | undefined

  return {
    txHash,
    blockNumber: receipt.blockNumber,
    memoIndex: memoArgs?.memoIndex,
    memoId: memoArgs?.memoId || memoId,
    memoText,
    callDataHash: memoArgs?.callDataHash || callDataHash,
    sender: senderAddress,
    target: ARC_USDC_CONTRACT_ADDRESS,
    gasFeeUsdc,
  }
}

/**
 * Queries on-chain Memo events matching a specific memoId.
 */
export async function getMemoLogsByMemoId(
  memoId: `0x${string}`,
  fromBlock?: bigint,
  toBlock?: bigint
) {
  const publicClient = getArcPublicClient()
  const memoEvent = parseAbiItem(
    'event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)'
  )

  const logs = await publicClient.getLogs({
    address: MEMO_CONTRACT_ADDRESS,
    event: memoEvent,
    args: { memoId },
    fromBlock: fromBlock || 'earliest',
    toBlock: toBlock || 'latest',
  })

  return logs.map((log) => ({
    sender: log.args.sender,
    target: log.args.target,
    callDataHash: log.args.callDataHash,
    memoId: log.args.memoId,
    memoHex: log.args.memo,
    memoText: decodeMemoData(log.args.memo || '0x'),
    memoIndex: log.args.memoIndex ? Number(log.args.memoIndex) : undefined,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
  }))
}
