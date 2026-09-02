import { parseUnits, parseSignature, type Hex } from 'viem'
import { ARC_TOKENS, arcTestnet } from '../config/arcChain'

export const DEFAULT_GASLESS_DAILY_LIMIT = 5

export const USDC_EIP712_DOMAIN = {
  name: 'USDC',
  version: '2',
  chainId: arcTestnet.id,
  verifyingContract: ARC_TOKENS.USDC as `0x${string}`,
} as const

export const EIP712_TRANSFER_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

export interface GaslessQuota {
  success: boolean
  address: string
  sponsoredBy: string
  relayerAddress: string
  dailyLimit: number
  usedCount: number
  remainingQuota: number
  isEligible: boolean
  error?: string
}

export interface GaslessTransferParams {
  provider: any
  from: string
  to: string
  amount: string
}

export interface GaslessTransferResult {
  success: boolean
  txHash: string
  blockNumber: string
  amount: string
  remainingQuota: number
  message: string
}

/**
 * Generates a cryptographically secure 32-byte hex nonce for EIP-3009.
 */
export function generateRandomNonce(): `0x${string}` {
  const randomBytes = new Uint8Array(32)
  crypto.getRandomValues(randomBytes)
  return `0x${Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * Checks if gasless transfer is supported for the given chain and token.
 */
export function isGaslessSupported(chain: string, token: string): boolean {
  return chain === 'Arc_Testnet' && token === 'USDC'
}

/**
 * Fetches the daily free gasless quota for a wallet address from the relayer.
 */
export async function getGaslessQuota(address: string): Promise<GaslessQuota> {
  if (!address || !address.startsWith('0x')) {
    return {
      success: false,
      address: '',
      sponsoredBy: 'ArcFlow Protocol',
      relayerAddress: '',
      dailyLimit: DEFAULT_GASLESS_DAILY_LIMIT,
      usedCount: 0,
      remainingQuota: DEFAULT_GASLESS_DAILY_LIMIT,
      isEligible: true,
    }
  }

  try {
    const res = await fetch(`/api/relayer?address=${encodeURIComponent(address)}`)
    const data = await res.json()
    if (res.ok && data.success) {
      return data
    }
    return {
      success: false,
      address,
      sponsoredBy: 'ArcFlow Protocol',
      relayerAddress: '',
      dailyLimit: DEFAULT_GASLESS_DAILY_LIMIT,
      usedCount: 0,
      remainingQuota: DEFAULT_GASLESS_DAILY_LIMIT,
      isEligible: true,
      error: data.error,
    }
  } catch (err: any) {
    console.warn(`[GaslessService] Failed to fetch quota, defaulting to ${DEFAULT_GASLESS_DAILY_LIMIT}:`, err)
    return {
      success: true,
      address,
      sponsoredBy: 'ArcFlow Protocol',
      relayerAddress: '',
      dailyLimit: DEFAULT_GASLESS_DAILY_LIMIT,
      usedCount: 0,
      remainingQuota: DEFAULT_GASLESS_DAILY_LIMIT,
      isEligible: true,
    }
  }
}

/**
 * Executes a gasless USDC transfer on Arc Testnet via EIP-712 off-chain signature & Relayer.
 */
export async function sendGaslessUsdcTransfer({
  provider,
  from,
  to,
  amount,
}: GaslessTransferParams): Promise<GaslessTransferResult> {
  if (!provider) {
    throw new Error('Cüzdan sağlayıcısı (provider) bulunamadı. Lütfen cüzdanınızı bağlayın.')
  }

  const valueInUnits = parseUnits(amount, 6)
  const nonce = generateRandomNonce()
  const validAfter = 0
  const validBefore = Math.floor(Date.now() / 1000) + 3600 // 1 hour validity

  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
      ],
      TransferWithAuthorization: EIP712_TRANSFER_TYPES.TransferWithAuthorization,
    },
    primaryType: 'TransferWithAuthorization' as const,
    domain: USDC_EIP712_DOMAIN,
    message: {
      from: from as `0x${string}`,
      to: to as `0x${string}`,
      value: valueInUnits.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
    },
  }

  // 1. Request EIP-712 signature from user wallet (0 gas cost)
  let rawSignature: string
  try {
    rawSignature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [from, JSON.stringify(typedData)],
    })
  } catch (signErr: any) {
    // If user rejected the signature
    if (
      signErr.code === 4001 ||
      signErr.message?.includes('rejected') ||
      signErr.message?.includes('denied')
    ) {
      throw new Error('İmza isteği kullanıcı tarafından reddedildi.')
    }
    throw new Error(`EIP-712 imzalama başarısız: ${signErr.message || signErr}`)
  }

  // 2. Parse signature components: v, r, s
  const sig = parseSignature(rawSignature as Hex)
  const v = sig.v !== undefined ? Number(sig.v) : sig.yParity === 1 ? 28 : 27
  const r = sig.r
  const s = sig.s

  // 3. Submit to ArcFlow Relayer
  const response = await fetch('/api/relayer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      value: valueInUnits.toString(),
      validAfter,
      validBefore,
      nonce,
      v,
      r,
      s,
    }),
  })

  const result = await response.json()

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Relayer işlemi gerçekleştirirken bir hata oluştu.')
  }

  return {
    success: true,
    txHash: result.txHash,
    blockNumber: result.blockNumber,
    amount,
    remainingQuota: result.remainingQuota ?? 0,
    message: result.message || 'Gasless transfer Arc L1 üzerinde onaylandı!',
  }
}
