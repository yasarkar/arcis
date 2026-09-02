import { AppKit, getErrorCode, type ChainDefinition } from '@circle-fin/app-kit'
import type { SwapExecuteParams, SwapQuoteResult, SwapExecutionStatus } from '../types/swap'
import { SWAP_SUPPORTED_TOKENS } from '../types/swap'
import { formatCopilotError } from '../utils/errorUtils'

const kit = new AppKit()

function resolveTokenAddr(chain: string, symbol: string): string {
  // Token addresses are resolved by the App Kit SDK automatically.
  // This helper is kept for backward compatibility.
  return symbol
}

/**
 * Resolves the effective `to` parameter for a swap.
 * - Same-chain swap with a custom recipient: adds `to.recipientAddress`
 *   (chain defaults to source chain per Arc docs).
 * - Cross-chain swap: always requires `to.chain` plus a recipient address.
 * - No recipient provided (same-chain, default): returns undefined.
 */
async function buildSwapTo(
  params: Pick<SwapExecuteParams, 'fromChain' | 'toChain' | 'recipientAddress' | 'sourceAdapter'>,
  from: any
): Promise<any> {
  const isCrossChain = params.toChain && params.fromChain !== params.toChain

  if (!isCrossChain && !params.recipientAddress) {
    return undefined
  }

  let recipientAddress = params.recipientAddress
  if (!recipientAddress) {
    recipientAddress = from.address || params.sourceAdapter?.address || (typeof params.sourceAdapter?.getAddress === 'function' ? await params.sourceAdapter.getAddress() : undefined)
  }

  if (!recipientAddress) {
    return undefined
  }

  if (isCrossChain) {
    return {
      chain: params.toChain as any,
      recipientAddress
    }
  }

  // Same-chain: chain defaults to `from.chain` (per docs), so only recipient is set.
  return {
    recipientAddress
  }
}

/**
 * Dynamic Chain Loading
 * Gets all chains that support swap operations.
 * Allows filtering by testnet or mainnet.
 */
export function getSupportedSwapChains(_isTestnet?: boolean): ChainDefinition[] {
  const chains = kit.getSupportedChains('swap')
  const arcOnly = chains.filter((c) => c.chain === 'Arc_Testnet' || c.chain.toLowerCase().includes('arc'))
  if (arcOnly.length > 0) {
    return arcOnly
  }
  return [
    {
      chain: 'Arc_Testnet',
      name: 'Arc Testnet',
      isTestnet: true,
    } as unknown as ChainDefinition
  ]
}

/**
 * Estimates the output, slippage stop-limit, and fees for a swap transaction.
 * Special check is applied for INPUT_AMOUNT_OUT_OF_RANGE error code.
 */
export async function getSwapEstimate(params: SwapExecuteParams): Promise<SwapQuoteResult> {
  const from = {
    adapter: params.sourceAdapter,
    chain: params.fromChain as any
  }

  const to = await buildSwapTo(params, from)

  const config: any = {
    allowanceStrategy: params.allowanceStrategy || 'approve'
  }

  if (params.slippageTolerance !== undefined) {
    config.slippageBps = Math.round(params.slippageTolerance * 10000)
  }

  if (params.customFee) {
    config.customFee = {
      percentageBps: params.customFee.percentageBps,
      recipientAddress: params.customFee.recipientAddress
    }
  }

  const swapParams = {
    from,
    tokenIn: params.tokenIn as any,
    tokenOut: params.tokenOut as any,
    amountIn: params.amountIn,
    ...(to && { to }),
    config
  }

  let estimate: any
  try {
    estimate = await kit.estimateSwap(swapParams)
  } catch (err: any) {
    const tokenInAddr = resolveTokenAddr(params.fromChain, params.tokenIn)
    const tokenOutAddr = resolveTokenAddr(params.fromChain, params.tokenOut)
    if (tokenInAddr !== params.tokenIn || tokenOutAddr !== params.tokenOut) {
      try {
        estimate = await kit.estimateSwap({
          ...swapParams,
          tokenIn: tokenInAddr as any,
          tokenOut: tokenOutAddr as any
        })
      } catch (retryErr) {
        const errMsg = err?.message || String(err || '')
        const code = getErrorCode(err)
        if (code === 1013 || err.name === 'INPUT_AMOUNT_OUT_OF_RANGE' || err.code === 'INPUT_AMOUNT_OUT_OF_RANGE') {
          throw new Error('The input amount is outside the supported liquidity limits of the swap route.')
        }
        if (errMsg.includes('No route available') || errMsg.includes('Route or resource not found') || errMsg.includes('createSwap failed')) {
          throw new Error(`No active swap route or testnet liquidity available for ${params.tokenIn} → ${params.tokenOut} on ${params.fromChain.replace(/_/g, ' ')}. Try swapping USDC ↔ EURC on Arc Testnet.`)
        }
        throw err
      }
    } else {
      const errMsg = err?.message || String(err || '')
      const code = getErrorCode(err)
      if (code === 1013 || err.name === 'INPUT_AMOUNT_OUT_OF_RANGE' || err.code === 'INPUT_AMOUNT_OUT_OF_RANGE') {
        throw new Error('The input amount is outside the supported liquidity limits of the swap route.')
      }
      if (errMsg.includes('No route available') || errMsg.includes('Route or resource not found') || errMsg.includes('createSwap failed')) {
        throw new Error(`No active swap route or testnet liquidity available for ${params.tokenIn} → ${params.tokenOut} on ${params.fromChain.replace(/_/g, ' ')}. Try swapping USDC ↔ EURC on Arc Testnet.`)
      }
      throw err
    }
  }

  // Calculate rates: 1 tokenIn = X tokenOut
  const amountInFloat = parseFloat(estimate.amountIn)
  const amountOutFloat = parseFloat(estimate.estimatedOutput.amount)
  const rate = amountInFloat > 0 ? (amountOutFloat / amountInFloat).toFixed(6) : '0'

  const fees = (estimate.fees || []).map((f: any) => ({
    token: f.token,
    amount: f.amount || '0',
    type: f.type as 'provider' | 'gas' | 'swap' | 'developer'
  }))

  return {
    estimatedOutput: estimate.estimatedOutput.amount,
    stopLimit: estimate.stopLimit.amount,
    fees,
    rate
  }
}

/**
 * Executes a same-chain or cross-chain swap transaction.
 * For cross-chain swaps, it polls with kit.waitForSwap() until done or failed.
 */
export async function executeSwap(params: SwapExecuteParams): Promise<SwapExecutionStatus> {
  try {
    const from = {
      adapter: params.sourceAdapter,
      chain: params.fromChain as any
    }

    const to = await buildSwapTo(params, from)

    const config: any = {
      allowanceStrategy: params.allowanceStrategy || 'approve'
    }

    if (params.slippageTolerance !== undefined) {
      config.slippageBps = Math.round(params.slippageTolerance * 10000)
    }

    if (params.customFee) {
      config.customFee = {
        percentageBps: params.customFee.percentageBps,
        recipientAddress: params.customFee.recipientAddress
      }
    }

    const swapParams = {
      from,
      tokenIn: params.tokenIn as any,
      tokenOut: params.tokenOut as any,
      amountIn: params.amountIn,
      ...(to && { to }),
      config
    }

    let result: any
    try {
      result = await kit.swap(swapParams)
    } catch (err: any) {
      const tokenInAddr = resolveTokenAddr(params.fromChain, params.tokenIn)
      const tokenOutAddr = resolveTokenAddr(params.fromChain, params.tokenOut)
      if (tokenInAddr !== params.tokenIn || tokenOutAddr !== params.tokenOut) {
        try {
          result = await kit.swap({
            ...swapParams,
            tokenIn: tokenInAddr as any,
            tokenOut: tokenOutAddr as any
          })
        } catch (retryErr) {
          throw err
        }
      } else {
        throw err
      }
    }

    // If it's a same-chain swap, it is finalized immediately
    if (!params.toChain) {
      return {
        status: 'DONE',
        sourceTxHash: result.txHash,
        destinationTxHash: result.txHash
      }
    }

    // If it's a cross-chain swap, we poll using kit.waitForSwap()
    const final = await kit.waitForSwap({
      result
    })

    const statusMap: Record<string, 'PENDING' | 'DONE' | 'FAILED' | 'NOT_FOUND'> = {
      PENDING: 'PENDING',
      DONE: 'DONE',
      FAILED: 'FAILED',
      NOT_FOUND: 'NOT_FOUND'
    }

    const resolvedStatus = statusMap[final.progress.status.toUpperCase()] || 'PENDING'

    return {
      status: resolvedStatus,
      sourceTxHash: final.source?.txHash || result.txHash,
      destinationTxHash: final.destination?.txHash,
      errorMessage: final.progress.substatusMessage || undefined
    }
  } catch (err: any) {
    console.error('[swapService] executeSwap failed:', err)
    const clean = formatCopilotError(err)
    return {
      status: 'FAILED',
      errorMessage: clean.message
    }
  }
}

/**
 * Helper to return swap-eligible tokens for a given blockchain context.
 */
export function getSupportedSwapTokens(chain: string): string[] {
  if (chain === 'Arc_Testnet') {
    return ['USDC', 'EURC', 'cirBTC']
  }

  const NETWORK_TOKENS: Record<string, string[]> = {
    Ethereum_Sepolia: ['USDC', 'EURC', 'USDT', 'DAI', 'NATIVE'],
    Base_Sepolia: ['USDC', 'EURC', 'USDT', 'DAI', 'NATIVE'],
    Arbitrum_Sepolia: ['USDC', 'USDT', 'NATIVE'],
    Optimism_Sepolia: ['USDC', 'USDT', 'NATIVE'],
    Polygon_Amoy_Testnet: ['USDC', 'USDT', 'NATIVE'],
    Avalanche_Fuji: ['USDC', 'USDT', 'NATIVE'],
    HyperEVM_Testnet: ['USDC', 'USDT', 'NATIVE'],
    Sei_Testnet: ['USDC', 'USDT', 'NATIVE'],
    Solana_Devnet: ['USDC', 'USDT', 'NATIVE'],
    Sonic_Testnet: ['USDC', 'USDT', 'NATIVE'],
    Unichain_Sepolia: ['USDC', 'USDT', 'NATIVE'],
    World_Chain_Sepolia: ['USDC', 'USDT', 'NATIVE'],
    // Mainnets
    Base: ['USDC', 'EURC', 'USDT', 'DAI', 'NATIVE'],
    Ethereum: ['USDC', 'USDT', 'DAI', 'WBTC', 'WETH', 'NATIVE'],
    Solana: ['USDC', 'USDT', 'WSOL', 'NATIVE'],
    Arbitrum: ['USDC', 'USDT', 'NATIVE'],
    Avalanche: ['USDC', 'USDT', 'NATIVE'],
    Optimism: ['USDC', 'USDT', 'NATIVE'],
    Polygon: ['USDC', 'USDT', 'NATIVE']
  }

  return NETWORK_TOKENS[chain] || [...SWAP_SUPPORTED_TOKENS]
}
