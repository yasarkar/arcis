// api/_utils/x402Payout.ts
// Treasury → provider USDC payout for x402 provider earnings.
//
// Fee-bearing paid calls settle to the protocol treasury (one EIP-3009 authorization can name only
// one payee), so a provider's earnings only become real money when the treasury pays them out. The
// payout signer is a dedicated key and it must derive to the configured treasury address: a
// mismatch is a refusal, never a payout from the wrong wallet.

import { createPublicClient, createWalletClient, erc20Abi, http, isAddress, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ARC_METADATA, ARC_TESTNET_TOKENS, arcActiveChain, arcTestnet } from '../../src/config/arcChain'
import { resolveX402TreasuryAddress } from '../../src/config/x402/treasury'

export const X402_TREASURY_PRIVATE_KEY_ENV = 'X402_TREASURY_PRIVATE_KEY'

const PRIVATE_KEY_PATTERN = /^(0x)?[0-9a-fA-F]{64}$/
const RECEIPT_TIMEOUT_MS = 30_000

export type X402PayoutResult =
  | { status: 'paid'; txHash: Hex; treasuryAddress: Address }
  | { status: 'unconfigured'; reason: string }
  | { status: 'failed'; error: string }
  | { status: 'unknown'; txHash?: Hex; error: string }

function readEnv(name: string): string {
  const local = typeof process !== 'undefined' && process.env ? process.env[name] : undefined
  const globalValue = (globalThis as any)?.process?.env?.[name]
  return String(local ?? globalValue ?? '').trim()
}

/**
 * Resolves the treasury signer, or explains why payouts are unavailable.
 * The key must belong to the configured treasury address; otherwise funds would leave the wrong wallet.
 */
export function resolveX402TreasurySigner():
  | { account: ReturnType<typeof privateKeyToAccount>; treasuryAddress: Address }
  | { reason: string } {
  const treasuryAddress = resolveX402TreasuryAddress()
  if (!treasuryAddress) {
    return { reason: 'X402_TREASURY_ADDRESS is not a usable treasury address.' }
  }
  const raw = readEnv(X402_TREASURY_PRIVATE_KEY_ENV)
  if (!raw) {
    return { reason: `${X402_TREASURY_PRIVATE_KEY_ENV} is not set, so provider payouts cannot be signed.` }
  }
  if (!PRIVATE_KEY_PATTERN.test(raw)) {
    return { reason: `${X402_TREASURY_PRIVATE_KEY_ENV} is not a 32-byte hex key.` }
  }
  const account = privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as Hex)
  if (account.address.toLowerCase() !== treasuryAddress.toLowerCase()) {
    return { reason: `${X402_TREASURY_PRIVATE_KEY_ENV} does not belong to the configured treasury address.` }
  }
  return { account, treasuryAddress }
}

/** True when a payout could be signed right now. */
export function isX402PayoutConfigured(): boolean {
  return 'account' in resolveX402TreasurySigner()
}

/**
 * Sends `amountMicros` USDC from the treasury to the provider on Arc Testnet.
 *
 * The caller has already reserved the amount in the provider ledger. A definitive failure is
 * reported as `failed` so the reservation can be refunded; an unconfirmed broadcast is `unknown`,
 * which must never be retried blindly.
 */
export async function sendProviderPayout(params: {
  provider: Address
  amountMicros: number
}): Promise<X402PayoutResult> {
  const { provider, amountMicros } = params
  if (!isAddress(provider) || !Number.isSafeInteger(amountMicros) || amountMicros <= 0) {
    return { status: 'failed', error: 'Invalid provider address or payout amount.' }
  }
  const signer = resolveX402TreasurySigner()
  if (!('account' in signer)) return { status: 'unconfigured', reason: signer.reason }

  const rpcUrl = ARC_METADATA.rpcHttpUrl || arcActiveChain.rpcUrls.default.http[0]
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl) })
  const walletClient = createWalletClient({ account: signer.account, chain: arcTestnet, transport: http(rpcUrl) })

  let txHash: Hex | undefined
  try {
    txHash = await walletClient.writeContract({
      address: ARC_TESTNET_TOKENS.USDC,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [provider, BigInt(amountMicros)],
      chain: arcTestnet,
      account: signer.account,
    })
  } catch (err: any) {
    return { status: 'failed', error: err?.shortMessage || err?.message || 'Treasury payout transaction could not be submitted.' }
  }

  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: RECEIPT_TIMEOUT_MS })
    if (receipt.status === 'success') {
      return { status: 'paid', txHash, treasuryAddress: signer.treasuryAddress }
    }
    return { status: 'failed', error: 'Treasury payout transaction reverted; no USDC left the treasury.' }
  } catch (err: any) {
    return {
      status: 'unknown',
      txHash,
      error: err?.shortMessage || err?.message || 'Treasury payout was submitted but its receipt could not be confirmed.',
    }
  }
}
