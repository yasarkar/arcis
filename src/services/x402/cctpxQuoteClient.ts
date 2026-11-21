// src/services/x402/cctpxQuoteClient.ts
// Lightweight, NodeNext-safe CCTP-X relayer fee quote client for server-side x402 routes.
// Calls Circle's `@circle-fin/provider-cctpx` directly without pulling browser/AppKit adapters
// into the Vercel serverless bundle.

import { fetchCCTPXFeeQuote } from '@circle-fin/provider-cctpx'
import { formatUnits, parseUnits } from 'viem'
import { IS_TESTNET } from '../../config/arcChain.js'
import {
  CCTPX_ELIGIBLE_CHAINS,
  NON_USDC_TOKEN_DEPLOYMENTS,
  getUcwBridgeMechanism,
  normalizeMatrixToken,
  type NonUsdcBridgeToken,
} from '../../config/bridgeRouteMatrix.js'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const DECIMAL_AMOUNT = /^\d+(\.\d+)?$/
const CCTPX_IRIS_BASE = IS_TESTNET
  ? 'https://iris-api-sandbox.circle.com'
  : 'https://iris-api.circle.com'

export interface CctpxFeeQuoteResult {
  feeAmount: string
  nativeSymbol: string
  speed: 'FAST' | 'SLOW'
}

export async function quoteCctpxRelayerFee(params: {
  tokenSymbol: string
  amount: string
  sourceChain: string
  destChain: string
  recipientAddress: string
  speed?: 'FAST' | 'SLOW'
}): Promise<CctpxFeeQuoteResult> {
  const token = normalizeMatrixToken(params.tokenSymbol)
  if (getUcwBridgeMechanism(token) !== 'cctpx') {
    throw new Error(`${params.tokenSymbol} does not move over CCTP-X.`)
  }

  const sourceDomain = CCTPX_ELIGIBLE_CHAINS[params.sourceChain]
  const destDomain = CCTPX_ELIGIBLE_CHAINS[params.destChain]
  if (sourceDomain === undefined || destDomain === undefined) {
    throw new Error('Both chains must carry a CrossChainTokenService deployment for CCTP-X.')
  }
  if (!DECIMAL_AMOUNT.test(params.amount)) {
    throw new Error(`Invalid ${token} amount.`)
  }

  const { tokenId, decimals } = NON_USDC_TOKEN_DEPLOYMENTS[token as NonUsdcBridgeToken]
  const amountUnits = parseUnits(params.amount, decimals)
  if (amountUnits <= 0n) {
    throw new Error(`Invalid ${token} amount.`)
  }

  const speed: 'FAST' | 'SLOW' = params.speed ?? 'FAST'
  const quote = await fetchCCTPXFeeQuote({
    baseUrl: CCTPX_IRIS_BASE,
    tokenId,
    sourceDomain,
    destinationDomain: destDomain,
    amount: amountUnits.toString(),
    destinationAddress: params.recipientAddress,
    speed: speed as any,
  } as any)

  const feeTotalAmount = String(quote?.feeTotalAmount ?? '')
  const feeToken = String(quote?.feeToken ?? '')
  if (!DECIMAL_AMOUNT.test(feeTotalAmount)) {
    throw new Error('Circle returned an unusable CCTP-X fee quote.')
  }
  if (feeToken.toLowerCase() !== ZERO_ADDRESS) {
    throw new Error('Circle quoted this CCTP-X transfer in an ERC-20 fee token.')
  }

  // On Arc L1 native gas is USDC with 18 decimals (msg.value); on EVM Sepolias it is ETH (18).
  const isArc = params.sourceChain === 'Arc_Testnet' || params.sourceChain === 'Arc'
  const nativeSymbol = isArc ? 'USDC' : 'ETH'
  return {
    feeAmount: formatUnits(BigInt(feeTotalAmount), 18),
    nativeSymbol,
    speed,
  }
}
