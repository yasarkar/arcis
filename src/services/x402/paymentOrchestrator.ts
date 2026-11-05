// src/services/x402/paymentOrchestrator.ts
// Circle Gateway x402 buyer flow. Batched EIP-3009 authorization is verified with
// ecrecover, so the payer must be an EOA key holder. Two EOA routes exist:
//   • an injected EIP-1193 wallet (signTypedData on the connected account), and
//   • a Circle user-controlled wallet created as `accountType: EOA`, whose MPC
//     share signs through a Circle challenge (PIN/biometrics via api/ucw).
// Circle MSCA/passkey (ERC-4337 smart accounts) and session keys are still unsupported:
// Circle Gateway nanopayments do not accept ERC-1271 signatures.

import { BatchEvmScheme } from '@circle-fin/x402-batching/client'
import { createWalletClient, custom, getAddress, isAddress, type Address, type Hex } from 'viem'
import type { ServiceManifest, X402ExecutionReceipt, X402FailureDiagnostics, X402PaymentRequirements } from '../../types/x402'
import { arcTestnet, ARC_TESTNET_TOKENS } from '../../config/arcChain'
import {
  CIRCLE_BATCHING_METADATA,
  GATEWAY_CONTRACTS,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../../config/x402/schemes'
import { usdcToBaseUnits } from '../../config/x402/pricing'
import { getEphemeralSessionAccount } from '../sessionEnclaveService'

export function safeAddress(addr: string): Address {
  try {
    return getAddress(addr.toLowerCase())
  } catch {
    return '0x0000000000000000000000000000000000000000' as Address
  }
}

export type X402PayerKind = 'session_eoa' | 'external_eoa' | 'ucw_eoa'

/** One EIP-712 payload signed by the payer (domain/types/primaryType/message). */
export type X402TypedDataSigner = (typedData: {
  domain: Record<string, unknown>
  types: Record<string, unknown>
  primaryType: string
  message: Record<string, unknown>
}) => Promise<Hex>

export interface X402Payer {
  kind: X402PayerKind
  address: `0x${string}`
  /**
   * Required for `ucw_eoa`: runs Circle's typed-data challenge and returns the
   * 65-byte ECDSA signature. A UCW wallet is created as an EOA, so `ecrecover`
   * on the server resolves the same address the wallet reports.
   */
  signTypedData?: X402TypedDataSigner
}

export interface ExecutePaidCallInput {
  manifest: ServiceManifest
  payload: Record<string, unknown>
  payer?: X402Payer
  walletAddress?: string
  provider?: any
  idempotencyKey?: string
}

function encodeJsonBase64(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function parsePaymentRequiredHeader(header: string): any {
  try {
    const binary = atob(header)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

/**
 * The server's reason for a voided call is untrusted input, so only known fields with primitive
 * types are kept: the UI may render them, never execute or trust them.
 */
function sanitizeFailureDiagnostics(value: unknown): X402FailureDiagnostics | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const unavailable = Array.isArray(source.unavailable)
    ? source.unavailable.filter((item): item is string => typeof item === 'string').slice(0, 10)
    : []
  return {
    serviceId: typeof source.serviceId === 'string' ? source.serviceId.slice(0, 80) : undefined,
    engine:
      source.engine === 'native' || source.engine === 'llm' || source.engine === 'proxy'
        ? source.engine
        : undefined,
    resultStatus: typeof source.resultStatus === 'string' ? source.resultStatus.slice(0, 40) : null,
    unavailable,
    reason: typeof source.reason === 'string' ? source.reason.slice(0, 400) : null,
    charged: source.charged === true,
  }
}

function failure(
  statusCode: number,
  error: string,
  requirements?: X402PaymentRequirements,
  diagnostics?: X402FailureDiagnostics
): X402ExecutionReceipt {
  return { statusCode, success: false, error, executionTimeMs: 0, costUsdc: 0, requirements, diagnostics }
}

/**
 * The treasury that receives fee-bearing calls, read from the server's public settlement config.
 * Null means the buyer cannot verify who it would be paying, so the call is refused.
 */
async function readTreasuryAddress(): Promise<string | null> {
  try {
    const res = await fetch('/api/x402/config', { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const body = await res.json().catch(() => null)
    const treasury = body?.protocolFee?.treasuryAddress
    if (typeof treasury !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(treasury)) return null
    return getAddress(treasury.toLowerCase())
  } catch {
    return null
  }
}

/** Sign one explicit Circle Gateway payment using the connected EOA and call the paid service. */
export async function executePaidCall(input: ExecutePaidCallInput): Promise<X402ExecutionReceipt> {
  const startedAt = performance.now()
  const { manifest, provider } = input
  const requirementsFallback: X402PaymentRequirements = {
    x402Version: 2,
    accepts: manifest.accepts.map((accept) => ({
      ...accept,
      payTo: accept.payTo as `0x${string}`,
      domain: accept.domain ? { ...accept.domain, verifyingContract: accept.domain.verifyingContract as `0x${string}` } : undefined,
    })),
  }
  const payerKind: X402PayerKind = input.payer?.kind || 'external_eoa'
  const ucwSigner = payerKind === 'ucw_eoa' ? input.payer?.signTypedData : undefined
  const sessionAccount = payerKind === 'session_eoa' ? getEphemeralSessionAccount(input.walletAddress) : null

  let address = ''
  if (payerKind === 'session_eoa') {
    address = sessionAccount ? sessionAccount.address : (input.payer?.address || '')
  } else if (payerKind === 'ucw_eoa') {
    address = ucwSigner ? (input.payer?.address || input.walletAddress || '') : ''
  } else {
    address = input.payer?.address || input.walletAddress || ''
  }

  if (!isAddress(address)) {
    return failure(503, 'Paid x402 calls require a connected external EOA, an active Circle Wallet signing session, or an active Session Enclave. No authorization or charge was created.', requirementsFallback)
  }

  const payerAddress = getAddress(address)
  if (payerAddress.toLowerCase() === manifest.provider.address.toLowerCase()) {
    return failure(400, 'The paying EOA must differ from the service provider address.')
  }
  let signTypedData: X402TypedDataSigner
  if (payerKind === 'session_eoa') {
    if (sessionAccount) {
      signTypedData = async (typedData) => {
        return sessionAccount.signTypedData(typedData as any) as Promise<Hex>
      }
    } else if (input.payer?.signTypedData) {
      signTypedData = input.payer.signTypedData
    } else {
      return failure(503, 'Session enclave signer is unavailable in client memory. Please reactivate your session key; no authorization or charge was created.', requirementsFallback)
    }
  } else if (ucwSigner) {
    // The Circle challenge route selects the ARC-TESTNET wallet itself. A signature made by a
    // wallet in another EIP-712 domain recovers to a different address, so the server still
    // fails closed on ecrecover; no client-side chain probe exists (and none is trusted).
    signTypedData = ucwSigner
  } else {
    if (!provider) {
      return failure(503, 'Paid x402 calls require a connected external EOA or an active Circle Wallet signing session. No authorization or charge was created; Circle passkey/MSCA and autonomous session signers are unsupported.', requirementsFallback)
    }
    let walletClient: ReturnType<typeof createWalletClient>
    try {
      walletClient = createWalletClient({ account: payerAddress, chain: arcTestnet, transport: custom(provider) })
      const [chainId, accounts] = await Promise.all([walletClient.getChainId(), walletClient.getAddresses()])
      if (chainId !== arcTestnet.id || !accounts.some((account) => account.toLowerCase() === payerAddress.toLowerCase())) {
        return failure(400, 'Connect the paying EOA on Arc Testnet and confirm it is the active wallet.')
      }
    } catch {
      return failure(503, 'The connected EOA could not be verified; no trusted payment settlement was attempted.', requirementsFallback)
    }
    signTypedData = async (typedData) => walletClient.signTypedData({
      account: payerAddress,
      ...typedData,
    } as any) as Promise<Hex>
  }

  const endpoint = `/api/x402/${encodeURIComponent(manifest.id)}`
  try {
    const challengeResponse = await fetch(endpoint, { method: 'GET', headers: { Accept: 'application/json' } })
    if (challengeResponse.status !== 402) {
      return failure(challengeResponse.status || 503, `The paid service did not provide an x402 payment challenge (HTTP ${challengeResponse.status}).`)
    }

    const paymentRequiredHeader = challengeResponse.headers.get('payment-required')
    const paymentRequired = paymentRequiredHeader ? parsePaymentRequiredHeader(paymentRequiredHeader) : null
    // A fee-bearing service settles to the protocol treasury, so the expected payee is the
    // treasury the server publishes for this deployment — never whatever the challenge names.
    const feeBps = Math.max(0, Math.trunc(Number(manifest.pricing.protocolFeeBps) || 0))
    const expectedPayee = feeBps > 0
      ? await readTreasuryAddress()
      : getAddress(manifest.provider.address.toLowerCase())
    if (!expectedPayee) {
      return failure(503, 'Settlement routing could not be verified because the protocol treasury address is unavailable. No authorization or charge was created.', requirementsFallback)
    }
    const requirements = paymentRequired?.accepts?.find((option: any) =>
      option?.scheme === X402_SCHEMES.EXACT &&
      option?.network === X402_NETWORKS.CAIP2_ARC_TESTNET &&
      option?.maxTimeoutSeconds === CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS &&
      option?.extra?.name === CIRCLE_BATCHING_METADATA.NAME &&
      option?.extra?.version === CIRCLE_BATCHING_METADATA.VERSION &&
      option?.extra?.verifyingContract?.toLowerCase() === GATEWAY_CONTRACTS.testnet.gatewayWallet.toLowerCase() &&
      option?.asset?.toLowerCase() === ARC_TESTNET_TOKENS.USDC.toLowerCase() &&
      option?.payTo?.toLowerCase() === expectedPayee.toLowerCase() &&
      option?.amount === usdcToBaseUnits(manifest.pricing.priceUsdc)
    )
    if (!paymentRequired || paymentRequired.x402Version !== 2 || !requirements || paymentRequired.resource?.url !== manifest.serve.path || paymentRequired.resource?.description !== manifest.description || paymentRequired.resource?.mimeType !== 'application/json') {
      return failure(502, 'The service returned payment requirements that do not match the trusted Arc Testnet Gateway configuration.')
    }

    const scheme = new BatchEvmScheme({
      address: payerAddress,
      signTypedData,
    })
    const paymentPayload = await scheme.createPaymentPayload(paymentRequired.x402Version, requirements)
    const paidResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Payment-Signature': encodeJsonBase64({
          ...paymentPayload,
          accepted: requirements,
          resource: paymentRequired.resource,
        }),
      },
      body: JSON.stringify({ payload: input.payload }),
    })
    const responseBody = await paidResponse.json().catch(() => null)
    if (!paidResponse.ok || !responseBody || typeof responseBody !== 'object') {
      return failure(
        paidResponse.status || 502,
        responseBody?.error || `Paid request failed (HTTP ${paidResponse.status}); check payment status before retrying.`,
        undefined,
        sanitizeFailureDiagnostics((responseBody as any)?.diagnostics)
      )
    }

    const payment = responseBody.payment
    const validAcceptedPayment = paidResponse.status === 200 && responseBody.statusCode === 200 && responseBody.success === true &&
      payment?.status === 'settlement_pending' &&
      payment?.payerAddress?.toLowerCase() === payerAddress.toLowerCase() &&
      payment?.providerAddress?.toLowerCase() === manifest.provider.address.toLowerCase() &&
      payment?.serviceId === manifest.id &&
      payment?.amountUsdc === manifest.pricing.priceUsdc &&
      typeof payment?.settlementRef === 'string' && payment.settlementRef.length > 0 &&
      !/^0x[0-9a-fA-F]{64}$/.test(payment.settlementRef)
    const data = responseBody.data
    const availableData = Boolean(data && typeof data === 'object' && typeof data.status === 'string' && data.status !== 'UNAVAILABLE')
    if (!validAcceptedPayment || !availableData) {
      return failure(502, 'The Gateway payment acceptance or paid service result could not be verified; the request will not be reported as successful.')
    }

    return {
      ...responseBody,
      statusCode: paidResponse.status,
      success: true,
      executionTimeMs: Math.round(performance.now() - startedAt),
      costUsdc: manifest.pricing.priceUsdc,
      requirements: paymentRequired,
    } as X402ExecutionReceipt
  } catch (error: any) {
    return failure(503, error?.message || 'The paid x402 request failed. Its payment status may be unknown; do not retry until it is checked.')
  }
}
