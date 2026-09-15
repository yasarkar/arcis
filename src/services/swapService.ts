import { AppKit, getErrorCode, type ChainDefinition } from '@circle-fin/app-kit'
import {
  createWalletClient,
  custom,
  parseUnits,
  formatUnits,
  encodeFunctionData,
  maxUint256,
  type Hex,
  type Address,
} from 'viem'
import { arcTestnet, ARC_METADATA } from '../config/arcChain'
import { POOL_CONTRACTS, STABLE_SWAP_ABI, ERC20_ABI } from '../config/poolsConfig'
import { sendModularUserOperation, getActiveSmartAccount } from './modularWalletService'
import { getDynamicArcGasOptions, ARC_GAS_LIMITS } from '../config/feeTiers'
import { getArcPublicClient, resilientReadContract, resilientWaitForReceipt } from './rpc'
import type { SwapExecuteParams, SwapQuoteResult, SwapExecutionStatus } from '../types/swap'
import { SWAP_SUPPORTED_TOKENS } from '../types/swap'
import { formatCopilotError, isUserCanceled } from '../utils/errorUtils'
import { DEFAULT_SLIPPAGE_BPS } from '../config/constants'
import { recordClientSwapVolume } from '../utils/poolVolumeUtils'
import { checkCeilingStatus, setSpendingCeiling } from './spendingCeilingService'

const kit = new AppKit()

// ─────────────────────────────────────────────────────────────
// ARC NATIVE DEX ROUTING & CURVE ENGINE
// ─────────────────────────────────────────────────────────────

interface ArcRoute {
  poolAddress: Address
  isStable: boolean
  tokenInAddr: Address
  tokenOutAddr: Address
  decIn: number
  decOut: number
  feeBps: bigint
}

function getCurveD(x: bigint, y: bigint, A: bigint = 100n): bigint {
  const s = x + y
  if (s === 0n) return 0n
  let d = s
  const Ann = A * 4n
  for (let i = 0; i < 255; i++) {
    let dP = d
    dP = (dP * d) / (x * 2n)
    dP = (dP * d) / (y * 2n)
    const dPrev = d
    const num = (Ann * s + dP * 2n) * d
    const den = (Ann - 1n) * d + dP * 3n
    d = num / den
    if (d > dPrev ? d - dPrev <= 1n : dPrev - d <= 1n) return d
  }
  return d
}

function getCurveY(x: bigint, d: bigint, A: bigint = 100n): bigint {
  const Ann = A * 4n
  let c = d
  c = (c * d) / (x * 2n)
  c = (c * d) / (Ann * 2n)
  const b = x + d / Ann
  let y = d
  for (let i = 0; i < 255; i++) {
    const yPrev = y
    y = (y * y + c) / (2n * y + b - d)
    if (y > yPrev ? y - yPrev <= 1n : yPrev - y <= 1n) return y
  }
  return y
}

export function resolveArcNativeRoute(tokenIn: string, tokenOut: string): ArcRoute | null {
  const tIn = tokenIn.toUpperCase()
  const tOut = tokenOut.toUpperCase()

  if ((tIn === 'USDC' && tOut === 'EURC') || (tIn === 'EURC' && tOut === 'USDC')) {
    return {
      poolAddress: POOL_CONTRACTS.STABLE_SWAP_POOL as Address,
      isStable: true,
      tokenInAddr: (tIn === 'USDC' ? POOL_CONTRACTS.USDC : POOL_CONTRACTS.EURC) as Address,
      tokenOutAddr: (tIn === 'USDC' ? POOL_CONTRACTS.EURC : POOL_CONTRACTS.USDC) as Address,
      decIn: 6,
      decOut: 6,
      feeBps: 12n, // 0.12%
    }
  }

  const isCirBtcIn = tIn === 'CIRBTC' || tIn === 'BTC'
  const isCirBtcOut = tOut === 'CIRBTC' || tOut === 'BTC'
  if (
    (tIn === 'USDC' && isCirBtcOut) ||
    (isCirBtcIn && tOut === 'USDC')
  ) {
    const isUsdcIn = tIn === 'USDC'
    return {
      poolAddress: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL as Address,
      isStable: false,
      tokenInAddr: (isUsdcIn ? POOL_CONTRACTS.USDC : POOL_CONTRACTS.cirBTC) as Address,
      tokenOutAddr: (isUsdcIn ? POOL_CONTRACTS.cirBTC : POOL_CONTRACTS.USDC) as Address,
      decIn: isUsdcIn ? 6 : 8,
      decOut: isUsdcIn ? 8 : 6,
      feeBps: 25n, // 0.25%
    }
  }

  return null
}

function resolveTokenAddr(chain: string, symbol: string): string {
  return symbol
}

/**
 * Resolves the effective `to` parameter for a swap.
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

  return {
    recipientAddress
  }
}

/**
 * Dynamic Chain Loading
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
 */
export async function getSwapEstimate(params: SwapExecuteParams): Promise<SwapQuoteResult> {
  // Check if this is an internal Arc Testnet swap
  const isArcNative = params.fromChain === 'Arc_Testnet' && (!params.toChain || params.toChain === 'Arc_Testnet')
  const arcRoute = isArcNative ? resolveArcNativeRoute(params.tokenIn, params.tokenOut) : null

  if (arcRoute) {
    try {
      const amountInUnits = parseUnits(params.amountIn, arcRoute.decIn)
      const arcPublicClient = getArcPublicClient()

      let reserveA = 0n
      let reserveB = 0n
      try {
        const [rA, rB] = await Promise.all([
          resilientReadContract(arcPublicClient, {
            address: arcRoute.poolAddress,
            abi: STABLE_SWAP_ABI,
            functionName: 'reserveA',
          }),
          resilientReadContract(arcPublicClient, {
            address: arcRoute.poolAddress,
            abi: STABLE_SWAP_ABI,
            functionName: 'reserveB',
          }),
        ])
        reserveA = rA
        reserveB = rB
      } catch {
        reserveA = parseUnits('100000', 6)
        reserveB = arcRoute.isStable ? parseUnits('100000', 6) : parseUnits('1.5', 8)
      }

      if (reserveA === 0n || reserveB === 0n) {
        reserveA = parseUnits('100000', 6)
        reserveB = arcRoute.isStable ? parseUnits('100000', 6) : parseUnits('1.5', 8)
      }

      // 1. Calculate platform protocol fee (customFee) if configured
      const customFeeBps = params.customFee?.percentageBps ? BigInt(params.customFee.percentageBps) : 0n
      const customFeeUnits = customFeeBps > 0n ? (amountInUnits * customFeeBps) / 10000n : 0n
      const netSwapAmountIn = amountInUnits - customFeeUnits

      // 2. Calculate pool LP fee on net amount
      const feeUnits = (netSwapAmountIn * arcRoute.feeBps) / 10000n
      const amountInAfterFee = netSwapAmountIn - feeUnits
      let amountOutUnits = 0n

      if (arcRoute.isStable) {
        if (params.tokenIn.toUpperCase() === 'USDC') {
          const d = getCurveD(reserveA, reserveB)
          const y = getCurveY(reserveA + amountInAfterFee, d)
          amountOutUnits = reserveB > y ? reserveB - y : 0n
        } else {
          const d = getCurveD(reserveB, reserveA)
          const y = getCurveY(reserveB + amountInAfterFee, d)
          amountOutUnits = reserveA > y ? reserveA - y : 0n
        }
      } else {
        if (params.tokenIn.toUpperCase() === 'USDC') {
          amountOutUnits = (reserveB * amountInAfterFee) / (reserveA + amountInAfterFee)
        } else {
          amountOutUnits = (reserveA * amountInAfterFee) / (reserveB + amountInAfterFee)
        }
      }

      const estimatedOutput = formatUnits(amountOutUnits, arcRoute.decOut)
      const slippageBps = params.slippageTolerance !== undefined ? Math.round(params.slippageTolerance * 10000) : DEFAULT_SLIPPAGE_BPS
      const minOutUnits = (amountOutUnits * BigInt(10000 - slippageBps)) / 10000n
      const stopLimit = formatUnits(minOutUnits, arcRoute.decOut)
      const amountInNum = parseFloat(params.amountIn)
      const amountOutNum = parseFloat(estimatedOutput)
      const rate = amountInNum > 0 ? (amountOutNum / amountInNum).toFixed(6) : '0'

      const fees: SwapQuoteResult['fees'] = [
        {
          token: params.tokenIn,
          amount: formatUnits(feeUnits, arcRoute.decIn),
          type: 'swap',
        },
      ]

      if (customFeeUnits > 0n) {
        fees.push({
          token: params.tokenIn,
          amount: formatUnits(customFeeUnits, arcRoute.decIn),
          type: 'developer',
        })
      }

      return {
        estimatedOutput,
        stopLimit,
        fees,
        rate,
      }
    } catch (arcErr) {
      console.warn('[swapService] Native Arc estimate fallback error:', arcErr)
    }
  }

  // Cross-chain or external AppKit fallback
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
 * For Arc Testnet internal swaps, executes directly against Arcis liquidity pools.
 * For cross-chain swaps, it polls with kit.waitForSwap() until done or failed.
 */
export async function executeSwap(params: SwapExecuteParams): Promise<SwapExecutionStatus> {
  try {
    const isArcNative = params.fromChain === 'Arc_Testnet' && (!params.toChain || params.toChain === 'Arc_Testnet')
    const arcRoute = isArcNative ? resolveArcNativeRoute(params.tokenIn, params.tokenOut) : null

    // ─────────────────────────────────────────────────────────────
    // 1. ARC TESTNET ON-CHAIN DEX EXECUTION
    // ─────────────────────────────────────────────────────────────
    if (arcRoute) {
      const amountInUnits = parseUnits(params.amountIn, arcRoute.decIn)
      const slippageBps = params.slippageTolerance !== undefined ? Math.round(params.slippageTolerance * 10000) : DEFAULT_SLIPPAGE_BPS

      const arcPublicClient = getArcPublicClient()

      let reserveA = 0n
      let reserveB = 0n
      try {
        const [rA, rB] = await Promise.all([
          resilientReadContract(arcPublicClient, {
            address: arcRoute.poolAddress,
            abi: STABLE_SWAP_ABI,
            functionName: 'reserveA',
          }),
          resilientReadContract(arcPublicClient, {
            address: arcRoute.poolAddress,
            abi: STABLE_SWAP_ABI,
            functionName: 'reserveB',
          }),
        ])
        reserveA = rA
        reserveB = rB
      } catch {
        reserveA = 0n
        reserveB = 0n
      }

      if (reserveA === 0n || reserveB === 0n) {
        throw new Error(
          `The ${params.tokenIn}/${params.tokenOut} liquidity pool on Arc Testnet currently has zero reserves. Please provide liquidity first before swapping.`
        )
      }

      // 1. Calculate platform protocol fee (customFee) if configured
      const customFeeBps = params.customFee?.percentageBps ? BigInt(params.customFee.percentageBps) : 0n
      const customFeeUnits = customFeeBps > 0n ? (amountInUnits * customFeeBps) / 10000n : 0n
      const swapAmountInUnits = amountInUnits - customFeeUnits

      // 2. Calculate pool LP fee on net amount
      const feeUnits = (swapAmountInUnits * arcRoute.feeBps) / 10000n
      const amountInAfterFee = swapAmountInUnits - feeUnits
      let amountOutUnits = 0n

      if (arcRoute.isStable) {
        if (params.tokenIn.toUpperCase() === 'USDC') {
          const d = getCurveD(reserveA, reserveB)
          const y = getCurveY(reserveA + amountInAfterFee, d)
          amountOutUnits = reserveB > y ? reserveB - y : 0n
        } else {
          const d = getCurveD(reserveB, reserveA)
          const y = getCurveY(reserveB + amountInAfterFee, d)
          amountOutUnits = reserveA > y ? reserveA - y : 0n
        }
      } else {
        if (params.tokenIn.toUpperCase() === 'USDC') {
          amountOutUnits = (reserveB * amountInAfterFee) / (reserveA + amountInAfterFee)
        } else {
          amountOutUnits = (reserveA * amountInAfterFee) / (reserveB + amountInAfterFee)
        }
      }

      const minOutUnits = (amountOutUnits * BigInt(10000 - slippageBps)) / 10000n

      // A. Modular Smart Account (Passkey / MSCA) Execution
      const smartAccount = getActiveSmartAccount()
      if (smartAccount) {
        const calls: Array<{ to: Hex; data: Hex }> = []
        let mscaAllowance = 0n
        try {
          mscaAllowance = await resilientReadContract(arcPublicClient, {
            address: arcRoute.tokenInAddr,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [smartAccount.address as Address, arcRoute.poolAddress],
          })
        } catch (e) {
          console.warn('[swapService] MSCA allowance read error:', e)
        }

        // Check on-chain allowance against user input amount
        const mscaCeiling = checkCeilingStatus(smartAccount.address, params.tokenIn, parseFloat(params.amountIn))
        const requiresMscaApprove = mscaAllowance < amountInUnits

        // Only include approve call if on-chain allowance is insufficient
        if (requiresMscaApprove) {
          calls.push({
            to: arcRoute.tokenInAddr as Hex,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'approve',
              args: [arcRoute.poolAddress, amountInUnits],
            }),
          })
        }

        const swapCall = {
          to: arcRoute.poolAddress as Hex,
          data: encodeFunctionData({
            abi: STABLE_SWAP_ABI,
            functionName: 'swap',
            args: [arcRoute.tokenInAddr, arcRoute.tokenOutAddr, swapAmountInUnits, minOutUnits],
          }),
        }
        calls.push(swapCall)

        // Atomically transfer protocol fee to Treasury in the same UserOp
        if (customFeeUnits > 0n && params.customFee?.recipientAddress) {
          calls.push({
            to: arcRoute.tokenInAddr as Hex,
            data: encodeFunctionData({
              abi: ERC20_ABI,
              functionName: 'transfer',
              args: [params.customFee.recipientAddress as Address, customFeeUnits],
            }),
          })
        }

        const userOpRes = await sendModularUserOperation({
          calls,
          paymaster: true,
        })

        if (!userOpRes.success || !userOpRes.txHash) {
          throw new Error(userOpRes.error || 'Arc Testnet üzerinde Modular UserOp takas işlemi onaylanamadı.')
        }

        // Elevate ceiling upon successful UserOperation
        if (requiresMscaApprove) {
          setSpendingCeiling(smartAccount.address, params.tokenIn, mscaCeiling.suggestedCeiling, userOpRes.txHash)
        }

        // Track 24h pool volume and dispatch reactive event
        try {
          const inUpper = params.tokenIn.toUpperCase()
          const outUpper = params.tokenOut.toUpperCase()
          const isCirBtc = inUpper === 'CIRBTC' || inUpper === 'BTC' || outUpper === 'CIRBTC' || outUpper === 'BTC'
          const poolId = isCirBtc ? 'usdc-cirbtc-pool' : 'usdc-eurc-stable-pool'
          let volUsd = 0
          const inAmt = parseFloat(params.amountIn) || 0
          if (inUpper === 'USDC') {
            volUsd = inAmt
          } else if (inUpper === 'EURC') {
            volUsd = inAmt * 1.08
          } else if (inUpper === 'CIRBTC' || inUpper === 'BTC') {
            volUsd = inAmt * 78500
          }
          if (volUsd > 0) {
            recordClientSwapVolume(poolId, volUsd, userOpRes.txHash)
          }
        } catch (volErr) {
          console.warn('[swapService] Volume tracking error:', volErr)
        }

        return {
          status: 'DONE',
          sourceTxHash: userOpRes.txHash,
          destinationTxHash: userOpRes.txHash,
        }
      }

      // B. EOA Wallet Execution (MetaMask, Rainbow, Viem)
      const provider =
        params.sourceAdapter?.provider ||
        (typeof window !== 'undefined' && (window as any).ethereum ? (window as any).ethereum : null)

      if (provider) {
        let account: Address | undefined
        if (params.sourceAdapter?.address) {
          account = params.sourceAdapter.address as Address
        } else {
          const accounts = await provider.request({ method: 'eth_requestAccounts' })
          account = accounts[0] as Address
        }

        if (!account) throw new Error('Cüzdan hesabı bulunamadı.')

        const walletClient = createWalletClient({
          account,
          chain: arcTestnet,
          transport: custom(provider),
        })

        // Check on-chain allowance
        const currentAllowance = await resilientReadContract(arcPublicClient, {
          address: arcRoute.tokenInAddr,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [account, arcRoute.poolAddress],
        })

        // Dynamically resolve Arc L1 gas parameters enforcing 20 Gwei floor & EWMA base fee
        const gasOptions = await getDynamicArcGasOptions(
          arcPublicClient,
          params.speedTier || 'fast',
          ARC_GAS_LIMITS.contractInteraction
        )

        // Check on-chain allowance against user input amount
        const ceilingStatus = checkCeilingStatus(account, params.tokenIn, parseFloat(params.amountIn))
        const requiresApprove = currentAllowance < amountInUnits

        // Only prompt for approve if current on-chain allowance is insufficient
        if (requiresApprove) {
          const approveTx = await walletClient.writeContract({
            address: arcRoute.tokenInAddr,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [arcRoute.poolAddress, amountInUnits],
            chain: arcTestnet,
            account,
            maxFeePerGas: gasOptions.maxFeePerGas,
            maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas,
          })
          const approveRes = await resilientWaitForReceipt(arcPublicClient, approveTx, 'Token approval')
          if (approveRes.status === 'reverted') {
            throw new Error('Token approval reverted on Arc Testnet.')
          }
          // Elevate approved ceiling so subsequent transactions <= suggestedCeiling skip approval
          setSpendingCeiling(account, params.tokenIn, ceilingStatus.suggestedCeiling, approveTx)
        } else if (ceilingStatus.suggestedCeiling > ceilingStatus.currentCeiling) {
          // On-chain allowance is already sufficient, elevate local ceiling seamlessly
          setSpendingCeiling(account, params.tokenIn, ceilingStatus.suggestedCeiling)
        }

        // Execute pool swap with net input
        const swapTx = await walletClient.writeContract({
          address: arcRoute.poolAddress,
          abi: STABLE_SWAP_ABI,
          functionName: 'swap',
          args: [arcRoute.tokenInAddr, arcRoute.tokenOutAddr, swapAmountInUnits, minOutUnits],
          chain: arcTestnet,
          account,
          maxFeePerGas: gasOptions.maxFeePerGas,
          maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas,
        })
        const swapRes = await resilientWaitForReceipt(arcPublicClient, swapTx, 'Swap')
        if (swapRes.status === 'reverted') {
          throw new Error('Swap transaction reverted on Arc Testnet. Liquidity may be insufficient or slippage tolerance was exceeded.')
        }

        // Collect custom platform protocol fee to Treasury if enabled
        if (customFeeUnits > 0n && params.customFee?.recipientAddress) {
          try {
            const feeTx = await walletClient.writeContract({
              address: arcRoute.tokenInAddr,
              abi: ERC20_ABI,
              functionName: 'transfer',
              args: [params.customFee.recipientAddress as Address, customFeeUnits],
              chain: arcTestnet,
              account,
              maxFeePerGas: gasOptions.maxFeePerGas,
              maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas,
            })
            const feeReceipt = await arcPublicClient.waitForTransactionReceipt({ hash: feeTx }).catch((err) => {
              console.warn('[swapService] Platform fee receipt error on EOA:', err)
              return null
            })
            if (feeReceipt && feeReceipt.status === 'reverted') {
              console.warn('[swapService] Platform fee transfer reverted on-chain.')
            }
          } catch (feeErr: any) {
            console.warn('[swapService] Platform fee transfer error on EOA:', feeErr)
            if (isUserCanceled(feeErr) || feeErr?.isCanceled === true) {
              throw feeErr
            }
          }
        }

        // Track 24h pool volume and dispatch reactive event
        try {
          const inUpper = params.tokenIn.toUpperCase()
          const outUpper = params.tokenOut.toUpperCase()
          const isCirBtc = inUpper === 'CIRBTC' || inUpper === 'BTC' || outUpper === 'CIRBTC' || outUpper === 'BTC'
          const poolId = isCirBtc ? 'usdc-cirbtc-pool' : 'usdc-eurc-stable-pool'
          let volUsd = 0
          const inAmt = parseFloat(params.amountIn) || 0
          if (inUpper === 'USDC') {
            volUsd = inAmt
          } else if (inUpper === 'EURC') {
            volUsd = inAmt * 1.08
          } else if (inUpper === 'CIRBTC' || inUpper === 'BTC') {
            volUsd = inAmt * 78500
          }
          if (volUsd > 0) {
            recordClientSwapVolume(poolId, volUsd, swapTx)
          }
        } catch (volErr) {
          console.warn('[swapService] Volume tracking error:', volErr)
        }

        return {
          status: 'DONE',
          sourceTxHash: swapTx,
          destinationTxHash: swapTx,
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 2. CROSS-CHAIN APP-KIT SWAP FALLBACK
    // ─────────────────────────────────────────────────────────────
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
    const isCanceled = clean.isCanceled || isUserCanceled(err) || err?.isCanceled === true
    return {
      status: 'FAILED',
      errorMessage: clean.message,
      isCanceled,
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
