import { AppKit, getErrorCode, type ChainDefinition } from '@circle-fin/app-kit'
import {
  createWalletClient,
  custom,
  parseUnits,
  formatUnits,
  encodeFunctionData,
  zeroAddress,
  type Hex,
  type Address,
} from 'viem'
import { arcTestnet, IS_TESTNET } from '../config/arcChain'
import {
  POOL_CONTRACTS,
  STABLE_SWAP_ABI,
  ERC20_ABI,
  ARCIS_SWAP_ROUTER_ABI,
  poolSlippageBps,
  STABLE_SWAP_AMP,
  STABLE_SWAP_ANN_MULTIPLIER,
  STABLE_SWAP_LP_FEE_BPS,
  CONSTANT_PRODUCT_LP_FEE_BPS,
} from '../config/poolsConfig'
import { getNetwork } from '../config/networks/networkRegistry'
import { sendModularUserOperation, getActiveSmartAccount, restoreSmartAccount } from './modularWalletService'
import { getDynamicArcGasOptions, ARC_GAS_LIMITS } from '../config/feeTiers'
import { getArcPublicClient, getResilientPublicClient, resilientReadContract, resilientWaitForReceipt } from './rpc'
import type { SwapExecuteParams, SwapQuoteResult, SwapExecutionStatus } from '../types/swap'
import { formatCopilotError, isUserCanceled } from '../utils/errorUtils'
import { recordClientSwapVolumeForPair } from '../utils/poolVolumeUtils'
import { checkCeilingStatus, setSpendingCeiling } from './spendingCeilingService'

const kit = new AppKit()

/**
 * Clamps a caller-provided tolerance (a fraction, e.g. 0.005 = 0.5%) into the pool-safe
 * [10, 1000] bps band used by the rest of the app (fix #5). Without this, a custom value ≥ 100%
 * produced `10000 - slippageBps <= 0` and therefore a negative minOut / negative stop-limit.
 * Undefined or invalid input falls back to the protocol default (50 bps).
 */
function clampSlippageBps(slippageTolerance?: number): number {
  return poolSlippageBps(slippageTolerance === undefined || !Number.isFinite(slippageTolerance) ? NaN : slippageTolerance * 100)
}

/**
 * Bounded approval amount (audit #11): never grant an unlimited (maxUint256) allowance.
 * Mirrors sendService's SAFE_CEILING_CAP convention — a large but finite 10M-token ceiling
 * (or the requested amount when that is larger), so a compromised pool/router could only ever
 * move a capped amount instead of the entire wallet balance.
 */
const SAFE_APPROVAL_CAP_TOKENS = 10_000_000n
function boundedApprovalAmount(amountInUnits: bigint, decimals: number): bigint {
  const cap = SAFE_APPROVAL_CAP_TOKENS * 10n ** BigInt(decimals)
  return cap > amountInUnits ? cap : amountInUnits
}

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

function getCurveD(x: bigint, y: bigint, A: bigint = STABLE_SWAP_AMP): bigint {
  const s = x + y
  if (s === 0n) return 0n
  let d = s
  const Ann = A * STABLE_SWAP_ANN_MULTIPLIER
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

function getCurveY(x: bigint, d: bigint, A: bigint = STABLE_SWAP_AMP): bigint {
  const Ann = A * STABLE_SWAP_ANN_MULTIPLIER
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
      feeBps: STABLE_SWAP_LP_FEE_BPS, // 0.12%
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
      feeBps: CONSTANT_PRODUCT_LP_FEE_BPS, // 0.25%
    }
  }

  return null
}

/**
 * Resolves a token symbol to its on-chain address for AppKit's address-based retry (audit #10).
 * The old stub returned the symbol itself, which made `tokenInAddr !== params.tokenIn` always
 * false and the address retry dead code. Unknown tokens (and NATIVE) keep the symbol.
 */
function resolveTokenAddr(chain: string, symbol: string): string {
  const key = String(symbol || '').trim()
  if (!key || key.toUpperCase() === 'NATIVE') return symbol

  const network = getNetwork(chain)
  const tokens = (network?.tokens || {}) as Record<string, string | undefined>
  const exact = tokens[key]
  if (exact) return exact

  const match = Object.keys(tokens).find((k) => k.toUpperCase() === key.toUpperCase())
  return match ? tokens[match]! : symbol
}

/**
 * Mainnet chains must never be swapped from this build (audit #10): the old `!IS_TESTNET`
 * guard only protected a mainnet-configured build from *everything*, while a testnet build
 * happily routed a mainnet chain through AppKit with real funds.
 */
function isMainnetSwapChain(chain?: string): boolean {
  if (!chain) return false
  const network = getNetwork(chain)
  return Boolean(network && network.testnet === false)
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
export function getSupportedSwapChains(isTestnet?: boolean): ChainDefinition[] {
  const chains = kit.getSupportedChains('swap')
  if (isTestnet !== undefined) {
    return chains.filter((c) => c.isTestnet === isTestnet)
  }
  return chains
}

/**
 * Estimates the output, slippage stop-limit, and fees for a swap transaction.
 */
export async function getSwapEstimate(params: SwapExecuteParams): Promise<SwapQuoteResult> {
  // Audit #10: a testnet build must refuse mainnet chains explicitly (IS_TESTNET only protects
  // a mainnet-configured build, it does not stop someone quoting a mainnet pool here).
  if (isMainnetSwapChain(params.fromChain) || isMainnetSwapChain(params.toChain)) {
    throw new Error('Mainnet swaps are disabled until deployments and signing routes are verified.')
  }

  // Check if this is an internal Arc Testnet swap
  const isArcNative = params.fromChain === 'Arc_Testnet' && (!params.toChain || params.toChain === 'Arc_Testnet')
  const arcRoute = isArcNative ? resolveArcNativeRoute(params.tokenIn, params.tokenOut) : null

  if (arcRoute) {
    try {
      const amountInUnits = parseUnits(params.amountIn, arcRoute.decIn)
      const arcPublicClient = getArcPublicClient()

      let reserveA: bigint
      let reserveB: bigint
      try {
        ;[reserveA, reserveB] = await Promise.all([
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
      } catch (error) {
        throw new Error(`Unable to read live ${params.tokenIn}/${params.tokenOut} pool reserves on Arc Testnet: ${String(error)}`)
      }

      if (reserveA <= 0n || reserveB <= 0n) {
        throw new Error(`The ${params.tokenIn}/${params.tokenOut} liquidity pool on Arc Testnet has no live reserves.`)
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
      const slippageBps = clampSlippageBps(params.slippageTolerance)
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
      console.warn('[swapService] Native Arc live quote unavailable:', arcErr)
      throw arcErr
    }
  }

  // Cross-chain or external AppKit fallback
  const from = {
    adapter: params.sourceAdapter,
    chain: params.fromChain as any
  }

  const to = await buildSwapTo(params, from)

  const config: any = {
    allowanceStrategy: params.allowanceStrategy || 'permit'
  }

  if (params.slippageTolerance !== undefined) {
    config.slippageBps = clampSlippageBps(params.slippageTolerance)
  }

  if (params.customFee && params.customFee.percentageBps > 0 && params.customFee.recipientAddress) {
    config.customFee = {
      percentageBps: Number(params.customFee.percentageBps),
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
    type: f.type as 'provider' | 'gas' | 'swap' | 'developer',
    ...(f.recipientAddress && { recipientAddress: f.recipientAddress })
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
  if (!IS_TESTNET) {
    return {
      status: 'FAILED',
      errorMessage: 'Mainnet execution is disabled until deployments and signing routes are verified.',
    }
  }
  // Audit #10: same protection for a testnet build selecting a mainnet chain.
  if (isMainnetSwapChain(params.fromChain) || isMainnetSwapChain(params.toChain)) {
    return {
      status: 'FAILED',
      errorMessage: 'Mainnet swaps are disabled until deployments and signing routes are verified.',
    }
  }
  let submittedTxHash: string | undefined = undefined
  try {
    const isArcNative = params.fromChain === 'Arc_Testnet' && (!params.toChain || params.toChain === 'Arc_Testnet')
    const arcRoute = isArcNative ? resolveArcNativeRoute(params.tokenIn, params.tokenOut) : null

    // ─────────────────────────────────────────────────────────────
    // 1. ARC TESTNET ON-CHAIN DEX EXECUTION
    // ─────────────────────────────────────────────────────────────
    if (arcRoute) {
      const amountInUnits = parseUnits(params.amountIn, arcRoute.decIn)
      const slippageBps = clampSlippageBps(params.slippageTolerance)

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
      // Explicit signer routing by authSource (fix #3): a passkey user MUST execute through the
      // MSCA. When the module cache is cold (page reload) we rebuild it from the stored credential
      // instead of silently falling into the UCW challenge flow or window.ethereum. ucw/evm auth
      // never signs through a stale MSCA cache.
      let mscaAccount = getActiveSmartAccount()
      if (params.authSource === 'passkey') {
        if (!mscaAccount) {
          mscaAccount = await restoreSmartAccount()
        }
        if (!mscaAccount) {
          throw new Error(
            'Passkey smart account could not be loaded. Please sign in with your passkey again and retry the swap.'
          )
        }
      } else if (params.authSource === 'ucw' || params.authSource === 'evm') {
        mscaAccount = null
      }
      const smartAccount = mscaAccount
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
              args: [arcRoute.poolAddress, boundedApprovalAmount(amountInUnits, arcRoute.decIn)],
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
          throw new Error(userOpRes.error || 'The Modular UserOperation swap could not be confirmed on Arc Testnet.')
        }

        // Elevate ceiling upon successful UserOperation
        if (requiresMscaApprove) {
          setSpendingCeiling(smartAccount.address, params.tokenIn, mscaCeiling.suggestedCeiling, userOpRes.txHash)
        }

        // Track 24h pool volume and dispatch reactive event (single FX source: DEFAULT_TOKEN_PRICES)
        try {
          recordClientSwapVolumeForPair(params.tokenIn, params.tokenOut, params.amountIn, userOpRes.txHash)
        } catch (volErr) {
          console.warn('[swapService] Volume tracking error:', volErr)
        }

        return {
          status: 'DONE',
          sourceTxHash: userOpRes.txHash,
          destinationTxHash: userOpRes.txHash,
        }
      }

      // B. Circle User-Controlled Wallet (UCW) Execution
      // evm-authenticated users are never routed into the UCW challenge flow just because their
      // EOA adapter is missing; that fallback only applies when auth is ucw or unspecified.
      const wantsUcw =
        params.authSource === 'ucw' ||
        (params.authSource !== 'evm' && !params.sourceAdapter && Boolean(params.executeUcwContract))
      const executeUcwContract = wantsUcw ? params.executeUcwContract : undefined
      if (wantsUcw && !executeUcwContract) {
        throw new Error('Circle UCW execution handler is missing. Please refresh the app or re-authenticate.')
      }
      if (executeUcwContract) {
        // Fix #2: allowance/ceiling checks are scoped to the SENDER. recipientAddress only decides
        // where the output lands (and ArcisSwapRouter always delivers to msg.sender), so reading it
        // as the token owner would check/approve the wrong wallet.
        const userAddress = (params.senderAddress || params.recipientAddress || '') as Address
        if (!userAddress || !userAddress.startsWith('0x')) {
          throw new Error('Circle UCW wallet address could not be resolved.')
        }

        const routerAddress = POOL_CONTRACTS.ARCIS_SWAP_ROUTER

        // 1. Check on-chain allowance against ArcisSwapRouter
        let currentAllowance = 0n
        try {
          currentAllowance = await resilientReadContract(arcPublicClient, {
            address: arcRoute.tokenInAddr,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [userAddress, routerAddress],
          })
        } catch (readErr) {
          console.warn('[swapService UCW] Allowance read warning:', readErr)
        }

        const ceilingStatus = checkCeilingStatus(userAddress, params.tokenIn, parseFloat(params.amountIn))
        const requiresApprove = currentAllowance < amountInUnits

        // 2. Request ERC-20 approval via Circle UCW challenge if allowance is insufficient
        if (requiresApprove) {
          console.log('[swapService UCW] Insufficient allowance. Initiating approve challenge on ARC-TESTNET...')
          const approveRes = await executeUcwContract({
            contractAddress: arcRoute.tokenInAddr,
            abiFunctionSignature: 'approve(address,uint256)',
            abiParameters: [routerAddress, boundedApprovalAmount(amountInUnits, arcRoute.decIn).toString()],
            blockchain: 'ARC-TESTNET',
          })

          if (!approveRes.success) {
            const isCanceled =
              approveRes.error?.toLowerCase().includes('cancel') ||
              approveRes.error?.toLowerCase().includes('iptal') ||
              approveRes.error?.toLowerCase().includes('closed')
            const err: any = new Error(approveRes.error || 'Token approval canceled by user.')
            if (isCanceled) err.isCanceled = true
            throw err
          }

          if (!approveRes.txHash || !/^0x[0-9a-fA-F]{64}$/.test(approveRes.txHash)) {
            return { status: 'PENDING', pendingStage: 'approve', errorMessage: 'Token approval was submitted but its transaction hash is not available yet.' }
          }
          const approvalReceipt = await resilientWaitForReceipt(arcPublicClient, approveRes.txHash as Hex, 'UCW Token approval')
          if (
            approvalReceipt.status === 'success' &&
            (!approvalReceipt.receipt || approvalReceipt.receipt.transactionHash.toLowerCase() !== approveRes.txHash.toLowerCase())
          ) {
            throw new Error('Token approval receipt did not match the submitted transaction.')
          }
          if (approvalReceipt.status === 'unknown') {
            return { status: 'PENDING', pendingStage: 'approve', sourceTxHash: approveRes.txHash, errorMessage: 'Token approval is awaiting on-chain confirmation.' }
          }
          if (approvalReceipt.status === 'reverted') throw new Error('Token approval reverted on Arc Testnet.')
          setSpendingCeiling(userAddress, params.tokenIn, ceilingStatus.suggestedCeiling, approveRes.txHash)
        } else if (ceilingStatus.suggestedCeiling > ceilingStatus.currentCeiling) {
          setSpendingCeiling(userAddress, params.tokenIn, ceilingStatus.suggestedCeiling)
        }

        // 3. Request swapWithFee challenge on ArcisSwapRouter via Circle UCW
        const treasuryRecipient = (params.customFee?.recipientAddress || zeroAddress) as Address
        const feeBps = BigInt(params.customFee?.percentageBps || 0)

        console.log('[swapService UCW] Requesting swapWithFee challenge on ARC-TESTNET...')
        const swapRes = await executeUcwContract({
          contractAddress: routerAddress,
          abiFunctionSignature: 'swapWithFee(address,address,address,uint256,uint256,address,uint256)',
          abiParameters: [
            arcRoute.poolAddress,
            arcRoute.tokenInAddr,
            arcRoute.tokenOutAddr,
            amountInUnits.toString(),
            minOutUnits.toString(),
            treasuryRecipient,
            feeBps.toString(),
          ],
          blockchain: 'ARC-TESTNET',
        })

        if (!swapRes.success) {
          const isCanceled =
            swapRes.error?.toLowerCase().includes('cancel') ||
            swapRes.error?.toLowerCase().includes('iptal') ||
            swapRes.error?.toLowerCase().includes('closed')
          const err: any = new Error(swapRes.error || 'Swap canceled by user.')
          if (isCanceled) err.isCanceled = true
          throw err
        }

        const realTxHash = swapRes.txHash || ''
        if (!/^0x[0-9a-fA-F]{64}$/.test(realTxHash)) {
          return { status: 'PENDING', errorMessage: 'Swap was submitted but its transaction hash is not available yet.' }
        }
        const swapReceipt = await resilientWaitForReceipt(arcPublicClient, realTxHash as Hex, 'UCW Swap')
        if (swapReceipt.status === 'unknown') {
            return { status: 'PENDING', sourceTxHash: realTxHash, errorMessage: 'Swap is awaiting on-chain confirmation.' }
          }
        if (swapReceipt.status === 'reverted') throw new Error('Swap transaction reverted on Arc Testnet.')
        if (!swapReceipt.receipt || swapReceipt.receipt.transactionHash.toLowerCase() !== realTxHash.toLowerCase()) {
          throw new Error('Swap receipt did not match the submitted transaction.')
        }

        // 4. Track 24h pool volume and dispatch reactive event (single FX source: DEFAULT_TOKEN_PRICES)
        try {
          recordClientSwapVolumeForPair(params.tokenIn, params.tokenOut, params.amountIn, realTxHash)
        } catch (volErr) {
          console.warn('[swapService UCW] Volume tracking error:', volErr)
        }

        return {
          status: 'DONE',
          sourceTxHash: realTxHash || undefined,
          destinationTxHash: realTxHash || undefined,
        }
      }

      // C. EOA Wallet Execution (MetaMask, Rainbow, Viem)
      // No window.ethereum fallback (fix #3): signing must come from the adapter the caller
      // explicitly connected — never from whatever injected wallet happens to be present.
      const provider = params.sourceAdapter?.provider || null

      if (!provider) {
        throw new Error(
          'No active Web3 wallet signer is available for this swap. Please reconnect your wallet and try again.'
        )
      }

      if (provider) {
        let account: Address | undefined
        if (params.sourceAdapter?.address) {
          account = params.sourceAdapter.address as Address
        } else {
          const accounts = await provider.request({ method: 'eth_requestAccounts' })
          account = accounts[0] as Address
        }

        if (!account) throw new Error('Wallet account could not be found.')

        const walletClient = createWalletClient({
          account,
          chain: arcTestnet,
          transport: custom(provider),
        })

        // Check on-chain allowance against ArcisSwapRouter (audit #12: a failed read must not
        // abort the swap — fall back to 0 so the approval flow runs instead).
        const routerAddress = POOL_CONTRACTS.ARCIS_SWAP_ROUTER
        let currentAllowance = 0n
        try {
          currentAllowance = await resilientReadContract(arcPublicClient, {
            address: arcRoute.tokenInAddr,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [account, routerAddress],
          })
        } catch (readErr) {
          console.warn('[swapService EOA] Allowance read error:', readErr)
        }

        // Dynamically resolve Arc L1 gas parameters enforcing 20 Gwei floor & EWMA base fee
        const gasOptions = await getDynamicArcGasOptions(
          arcPublicClient,
          params.speedTier || 'fast',
          ARC_GAS_LIMITS.contractInteraction
        )

        // Check on-chain allowance against user input amount
        const ceilingStatus = checkCeilingStatus(account, params.tokenIn, parseFloat(params.amountIn))
        const requiresApprove = currentAllowance < amountInUnits

        // 1. Only prompt for approve if current on-chain allowance is insufficient
        if (requiresApprove) {
          const approveTx = await walletClient.writeContract({
            address: arcRoute.tokenInAddr,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [routerAddress, boundedApprovalAmount(amountInUnits, arcRoute.decIn)],
            chain: arcTestnet,
            account,
            maxFeePerGas: gasOptions.maxFeePerGas,
            maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas,
          })
          const approveRes = await resilientWaitForReceipt(arcPublicClient, approveTx, 'Token approval')
          if (approveRes.status === 'reverted') {
            throw new Error('Token approval reverted on Arc Testnet.')
          }
          if (!approveRes.receipt || approveRes.receipt.transactionHash.toLowerCase() !== approveTx.toLowerCase()) {
            throw new Error('Token approval is not confirmed with a matching receipt; swap was not submitted.')
          }
          // Elevate approved ceiling so subsequent transactions <= suggestedCeiling skip approval
          setSpendingCeiling(account, params.tokenIn, ceilingStatus.suggestedCeiling, approveTx)
        } else if (ceilingStatus.suggestedCeiling > ceilingStatus.currentCeiling) {
          // On-chain allowance is already sufficient, elevate local ceiling seamlessly
          setSpendingCeiling(account, params.tokenIn, ceilingStatus.suggestedCeiling)
        }

        // 2. Execute atomic swapWithFee on ArcisSwapRouter in a single transaction
        const treasuryRecipient = (params.customFee?.recipientAddress || zeroAddress) as Address
        const feeBps = BigInt(params.customFee?.percentageBps || 0)

        const swapTx = await walletClient.writeContract({
          address: routerAddress,
          abi: ARCIS_SWAP_ROUTER_ABI,
          functionName: 'swapWithFee',
          args: [
            arcRoute.poolAddress,
            arcRoute.tokenInAddr,
            arcRoute.tokenOutAddr,
            amountInUnits,
            minOutUnits,
            treasuryRecipient,
            feeBps,
          ],
          chain: arcTestnet,
          account,
          maxFeePerGas: gasOptions.maxFeePerGas,
          maxPriorityFeePerGas: gasOptions.maxPriorityFeePerGas,
        })
        const swapRes = await resilientWaitForReceipt(arcPublicClient, swapTx, 'Swap')
        if (swapRes.status === 'reverted') {
          throw new Error('Swap transaction reverted on Arc Testnet. Liquidity may be insufficient or slippage tolerance was exceeded.')
        }
        if (!swapRes.receipt || swapRes.receipt.transactionHash.toLowerCase() !== swapTx.toLowerCase()) {
          throw new Error('Swap is not confirmed with a matching receipt.')
        }

        // Track 24h pool volume and dispatch reactive event (single FX source: DEFAULT_TOKEN_PRICES)
        try {
          recordClientSwapVolumeForPair(params.tokenIn, params.tokenOut, params.amountIn, swapTx)
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
    if (params.authSource === 'ucw') {
      throw new Error(
        'Circle UCW wallets currently support Arc Testnet swaps only. For cross-chain swaps, connect MetaMask or a Circle Modular Wallet (Passkey).'
      )
    }

    if (!params.sourceAdapter) {
      throw new Error('An active Web3 wallet connection is required for cross-chain swaps.')
    }

    const from = {
      adapter: params.sourceAdapter,
      chain: params.fromChain as any
    }

    const to = await buildSwapTo(params, from)

    const config: any = {
      allowanceStrategy: params.allowanceStrategy || 'permit'
    }

    if (params.slippageTolerance !== undefined) {
      config.slippageBps = Math.round(params.slippageTolerance * 10000)
    }

    if (params.customFee && params.customFee.percentageBps > 0 && params.customFee.recipientAddress) {
      config.customFee = {
        percentageBps: Number(params.customFee.percentageBps),
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
      submittedTxHash = result?.txHash
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
          submittedTxHash = result?.txHash
        } catch (retryErr) {
          throw err
        }
      } else {
        throw err
      }
    }

    // If it's a same-chain swap, it is finalized immediately
    if (!params.toChain) {
      const sourceTxHash = result?.txHash
      if (!sourceTxHash || !/^0x[0-9a-fA-F]{64}$/.test(sourceTxHash)) {
        return { status: 'PENDING', errorMessage: 'Swap was submitted but its transaction hash is not available yet.' }
      }
      submittedTxHash = sourceTxHash
      const sourceClient = getResilientPublicClient(params.fromChain)
      const receipt = await resilientWaitForReceipt(sourceClient, sourceTxHash as Hex, 'Swap')
      if (receipt.status === 'unknown') {
        return { status: 'PENDING', sourceTxHash, errorMessage: 'Swap is awaiting on-chain confirmation.' }
      }
      if (receipt.status === 'reverted') {
        return {
          status: 'FAILED',
          sourceTxHash,
          errorMessage: `Swap transaction reverted on ${params.fromChain || 'source chain'}.`,
        }
      }
      return { status: 'DONE', sourceTxHash, destinationTxHash: sourceTxHash }
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
    const errStr = (err?.message || '').toLowerCase()
    const isReverted = errStr.includes('revert') || err?.receipt?.status === 'reverted'
    if (isReverted) {
      return {
        status: 'FAILED',
        sourceTxHash: submittedTxHash,
        errorMessage: err.message || 'Swap transaction reverted on-chain.',
      }
    }
    if (submittedTxHash && !isUserCanceled(err)) {
      return {
        status: 'PENDING',
        sourceTxHash: submittedTxHash,
        errorMessage: 'Submitted; confirmation is temporarily unavailable. Do not resubmit.',
      }
    }
    const clean = formatCopilotError(err)
    const isCanceled = clean.isCanceled || isUserCanceled(err) || err?.isCanceled === true
    return {
      status: 'FAILED',
      errorMessage: clean.message,
      isCanceled,
    }
  }
}

