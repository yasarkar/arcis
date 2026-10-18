import { type Hex, parseUnits, formatUnits, decodeEventLog } from 'viem'
import {
  canonicalCopilotTokenSymbol,
  COPILOT_SEND_DECIMALS,
} from '../../config/copilotTokens'
import { ARC_TOKENS } from '../../config/arcChain'
import { numberToExactDecimal } from '../../utils/copilotAmount'
import { getResilientPublicClient } from '../rpc'
import { getLiveTokenPrices, normalizeTokenSymbol, DEFAULT_TOKEN_PRICES } from '../tokenPriceService'
import type { CopilotActionPayload } from '../../types/marketplace'
import type { InlineExecutionReceipt, ExecutionProgressState, SessionActionType } from '../../types/sessionKey'
import { ERC20_ABI } from '../../config/poolsConfig'

export interface CopilotUcwHandlers {
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  executeUcwTransfer?: (params: {
    destinationAddress: string
    amount: string
    tokenAddress?: string
    tokenSymbol?: string
    blockchain?: string
  }) => Promise<{ success: boolean; txHash?: string; error?: string }>
  executeUcwContract?: (params: {
    contractAddress: string
    abiFunctionSignature?: string
    abiParameters?: any[]
    callData?: string
    amount?: string
    blockchain?: string
  }) => Promise<{ success: boolean; txHash?: string; error?: string }>
  pollChallengeTx?: (challengeId?: string, blockchain?: string) => Promise<string | undefined>
}

export interface CopilotActionContext {
  actionPayload: CopilotActionPayload
  activeWallet: string
  activeMsca?: string | null
  provider?: any
  onProgress?: (state: ExecutionProgressState) => void
  ucwHandlers?: CopilotUcwHandlers
  budgetManaged?: boolean
  onSubmission?: (evidence: { txHash?: string; userOpHash?: string; phase: 'approval' | 'spend' }) => void
  startTime: number
}

export async function valueTokenAmountUsd(tokenSymbol: string, amount: number): Promise<number> {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  const norm = normalizeTokenSymbol(tokenSymbol)
  if (norm === 'USDC') return amount
  try {
    const prices = await getLiveTokenPrices()
    const price = prices[norm] || DEFAULT_TOKEN_PRICES[norm] || 1.0
    return Number((amount * price).toFixed(4))
  } catch {
    const fallback = DEFAULT_TOKEN_PRICES[norm] || 1.0
    return Number((amount * fallback).toFixed(4))
  }
}

export function isTransactionHash(value: unknown): value is Hex {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

export function isPositiveTokenAmount(value: unknown, decimals: number): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false
  try {
    const units = parseUnits(numberToExactDecimal(value)!, decimals)
    return units > 0n && Number(formatUnits(units, decimals)) === value
  } catch {
    return false
  }
}

export const knownCopilotTokenAliases = new Set([
  'usdc', 'usdcoin', 'native', 'eurc', 'eur', 'euro', 'weth', 'eth', 'ethereum',
  'cirbtc', 'circlebtc', 'circlebitcoin', 'circlewrappedbitcoin', 'btc', 'wbtc', 'bitcoin', 'wrappedbitcoin',
  'afusdc', 'vault',
])

export function resolveCopilotToken(raw: unknown, fallback: string): string | null {
  if (raw == null || String(raw).trim() === '') return fallback
  const input = String(raw).trim().toLowerCase().replace(/[\s_-]/g, '')
  if (!knownCopilotTokenAliases.has(input)) return null
  return canonicalCopilotTokenSymbol(String(raw))
}

export async function readArcSendBalance(tokenSymbol: string, wallet: string): Promise<bigint> {
  const client = getResilientPublicClient('Arc_Testnet')
  const tokenAddress = ARC_TOKENS[tokenSymbol as keyof typeof ARC_TOKENS]
  if (!tokenAddress) throw new Error(`No Arc Testnet token address is configured for ${tokenSymbol}.`)
  return client.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [wallet as `0x${string}`],
  })
}

export function tokenUnits(amount: number, tokenSymbol: string): bigint {
  return parseUnits(numberToExactDecimal(amount)!, COPILOT_SEND_DECIMALS[tokenSymbol] ?? 6)
}

export async function getVerifiedArcReceipt(hash: Hex, description: string) {
  try {
    const client = getResilientPublicClient('Arc_Testnet')
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 20_000 })
    return receipt.transactionHash.toLowerCase() === hash.toLowerCase() ? receipt : null
  } catch {
    return null
  }
}

export const ERC20_TRANSFER_EVENT_ABI = [{
  type: 'event',
  name: 'Transfer',
  inputs: [
    { type: 'address', indexed: true, name: 'from' },
    { type: 'address', indexed: true, name: 'to' },
    { type: 'uint256', indexed: false, name: 'value' },
  ],
}] as const

export function verifyArcTokenTransferReceipt(
  receipt: any,
  tokenAddress: string,
  recipient: string,
  amount: number,
  decimals: number,
  sender?: string
): boolean {
  const expectedAmount = parseUnits(amount.toFixed(decimals), decimals)
  return receipt.logs.some((log: any) => {
    if (log.address.toLowerCase() !== tokenAddress.toLowerCase()) return false
    try {
      const decoded = decodeEventLog({ abi: ERC20_TRANSFER_EVENT_ABI, data: log.data, topics: log.topics })
      const args = decoded.args as any
      return String(args.to).toLowerCase() === recipient.toLowerCase() &&
        (!sender || String(args.from).toLowerCase() === sender.toLowerCase()) &&
        BigInt(args.value) === expectedAmount
    } catch {
      return false
    }
  })
}

export function failedActionReceipt(
  actionType: InlineExecutionReceipt['actionType'],
  title: string,
  errorMessage: string,
  startTime: number
): InlineExecutionReceipt {
  return {
    id: `rcpt_err_${Date.now()}`,
    actionType,
    title,
    status: 'FAILED',
    txHash: '',
    gasUsdc: 0,
    settlementLatencyMs: Date.now() - startTime,
    timestamp: Date.now(),
    errorMessage,
  }
}

export function budgetActionType(payload: CopilotActionPayload): SessionActionType | undefined {
  if (['interactive_swap', 'trade'].includes(payload.type)) return 'swap'
  if (['interactive_deposit', 'view_pool'].includes(payload.type)) return 'deposit'
  if (['interactive_bridge', 'bridge'].includes(payload.type)) return 'bridge'
  if (['interactive_send', 'send', 'interactive_batch_send'].includes(payload.type)) return 'send'
  return undefined
}
