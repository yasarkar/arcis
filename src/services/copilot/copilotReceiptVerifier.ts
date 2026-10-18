import { type Hex, parseUnits, formatUnits, decodeEventLog } from 'viem'
import { POOL_CONTRACTS, ARCIS_SWAP_ROUTER_ABI, STABLE_SWAP_ABI } from '../../config/poolsConfig'
import { resolveArcNativeRoute } from '../swapService'
import { getResilientPublicClient } from '../rpc'
import { numberToExactDecimal } from '../../utils/copilotAmount'

/**
 * Verifies that a swap transaction hash was mined successfully on Arc Testnet,
 * matches the recipient, tokenIn/tokenOut, amountIn, and decodes the real amountOut
 * from either the SwapWithFee event (router) or Swapped event (pool).
 */
export async function verifyArcSwapReceipt(
  hash: Hex,
  recipient: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: number
): Promise<{ status: 'success'; amountOut: number } | { status: 'reverted' } | { status: 'unknown' }> {
  try {
    const route = resolveArcNativeRoute(tokenIn, tokenOut)
    if (!route) return { status: 'unknown' }
    const client = getResilientPublicClient('Arc_Testnet')
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 20_000 })
    if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) return { status: 'unknown' }
    if (receipt.status === 'reverted') return { status: 'reverted' }
    if (receipt.status !== 'success') return { status: 'unknown' }

    const expectedAmountIn = parseUnits(numberToExactDecimal(amountIn)!, route.decIn)
    for (const log of receipt.logs) {
      try {
        if (log.address.toLowerCase() === POOL_CONTRACTS.ARCIS_SWAP_ROUTER.toLowerCase()) {
          const decoded = decodeEventLog({ abi: ARCIS_SWAP_ROUTER_ABI, data: log.data, topics: log.topics })
          if (decoded.eventName !== 'SwapWithFee') continue
          const args = decoded.args as any
          if (
            String(args.user).toLowerCase() === recipient.toLowerCase() &&
            String(args.pool).toLowerCase() === route.poolAddress.toLowerCase() &&
            String(args.tokenIn).toLowerCase() === route.tokenInAddr.toLowerCase() &&
            String(args.tokenOut).toLowerCase() === route.tokenOutAddr.toLowerCase() &&
            BigInt(args.amountIn) === expectedAmountIn
          ) {
            const amountOut = Number(formatUnits(BigInt(args.amountOut), route.decOut))
            if (Number.isFinite(amountOut) && amountOut > 0) return { status: 'success', amountOut }
          }
        } else if (log.address.toLowerCase() === route.poolAddress.toLowerCase()) {
          const decoded = decodeEventLog({ abi: STABLE_SWAP_ABI, data: log.data, topics: log.topics })
          if (decoded.eventName !== 'Swapped') continue
          const args = decoded.args as any
          if (
            String(args.user).toLowerCase() === recipient.toLowerCase() &&
            String(args.tokenIn).toLowerCase() === route.tokenInAddr.toLowerCase() &&
            BigInt(args.amountIn) === expectedAmountIn
          ) {
            const amountOut = Number(formatUnits(BigInt(args.amountOut), route.decOut))
            if (Number.isFinite(amountOut) && amountOut > 0) return { status: 'success', amountOut }
          }
        }
      } catch {
        // Ignore unrelated receipt logs; success requires a matching configured pool/router event.
      }
    }
    return { status: 'unknown' }
  } catch {
    return { status: 'unknown' }
  }
}
