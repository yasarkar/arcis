// src/services/x402/paymentOrchestrator.ts
// Circle Gateway x402 buyer flow. Requires an explicitly connected EOA because batched
// EIP-3009 authorization uses ecrecover and does not support Circle MSCA/passkey signatures.

import { BatchEvmScheme } from '@circle-fin/x402-batching/client'
import { createWalletClient, custom, getAddress, isAddress, type Address, type Hex } from 'viem'
import type { ServiceManifest, X402ExecutionReceipt, X402PaymentRequirements } from '../../types/x402'
import { arcTestnet, ARC_TESTNET_TOKENS } from '../../config/arcChain'
import {
  CIRCLE_BATCHING_METADATA,
  GATEWAY_CONTRACTS,
  X402_NETWORKS,
  X402_SCHEMES,
} from '../../config/x402/schemes'
import { usdcToBaseUnits } from '../../config/x402/pricing'

export function safeAddress(addr: string): Address {
  try {
    return getAddress(addr.toLowerCase())
  } catch {
    return '0x0000000000000000000000000000000000000000' as Address
  }
}

export interface ExecutePaidCallInput {
  manifest: ServiceManifest
  payload: Record<string, unknown>
  payer?: {
    kind: 'session_eoa' | 'external_eoa'
    address: `0x${string}`
  }
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

function failure(statusCode: number, error: string, requirements?: X402PaymentRequirements): X402ExecutionReceipt {
  return { statusCode, success: false, error, executionTimeMs: 0, costUsdc: 0, requirements }
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
  const address = input.payer?.kind === 'session_eoa' ? '' : (input.payer?.address || input.walletAddress || '')
  if (!provider || !isAddress(address)) {
    return failure(503, 'Paid x402 calls require a connected external EOA. No authorization or charge was created; Circle passkey/MSCA and autonomous session signers are unsupported.', requirementsFallback)
  }

  const payerAddress = getAddress(address)
  if (payerAddress.toLowerCase() === manifest.provider.address.toLowerCase()) {
    return failure(400, 'The paying EOA must differ from the service provider address.')
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

  const endpoint = `/api/x402/${encodeURIComponent(manifest.id)}`
  try {
    const challengeResponse = await fetch(endpoint, { method: 'GET', headers: { Accept: 'application/json' } })
    if (challengeResponse.status !== 402) {
      return failure(challengeResponse.status || 503, `The paid service did not provide an x402 payment challenge (HTTP ${challengeResponse.status}).`)
    }

    const paymentRequiredHeader = challengeResponse.headers.get('payment-required')
    const paymentRequired = paymentRequiredHeader ? parsePaymentRequiredHeader(paymentRequiredHeader) : null
    const requirements = paymentRequired?.accepts?.find((option: any) =>
      option?.scheme === X402_SCHEMES.EXACT &&
      option?.network === X402_NETWORKS.CAIP2_ARC_TESTNET &&
      option?.maxTimeoutSeconds === CIRCLE_BATCHING_METADATA.MAX_TIMEOUT_SECONDS &&
      option?.extra?.name === CIRCLE_BATCHING_METADATA.NAME &&
      option?.extra?.version === CIRCLE_BATCHING_METADATA.VERSION &&
      option?.extra?.verifyingContract?.toLowerCase() === GATEWAY_CONTRACTS.testnet.gatewayWallet.toLowerCase() &&
      option?.asset?.toLowerCase() === ARC_TESTNET_TOKENS.USDC.toLowerCase() &&
      option?.payTo?.toLowerCase() === manifest.provider.address.toLowerCase() &&
      option?.amount === usdcToBaseUnits(manifest.pricing.priceUsdc)
    )
    if (!paymentRequired || paymentRequired.x402Version !== 2 || !requirements || paymentRequired.resource?.url !== manifest.serve.path || paymentRequired.resource?.description !== manifest.description || paymentRequired.resource?.mimeType !== 'application/json') {
      return failure(502, 'The service returned payment requirements that do not match the trusted Arc Testnet Gateway configuration.')
    }

    const scheme = new BatchEvmScheme({
      address: payerAddress,
      signTypedData: async (typedData) => walletClient.signTypedData({
        account: payerAddress,
        ...typedData,
      } as any) as Promise<Hex>,
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
      return failure(paidResponse.status || 502, responseBody?.error || `Paid request failed (HTTP ${paidResponse.status}); check payment status before retrying.`)
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
