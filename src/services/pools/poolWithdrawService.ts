import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
} from 'viem'
import { arcTestnet } from '../../config/arcChain'
import {
  ARCIS_POOLS,
  CONSTANT_PRODUCT_LP_FEE_BPS,
  POOL_CONTRACTS,
  POOL_VERSION_V4,
  STABLE_SWAP_ABI,
  STABLE_SWAP_AMP,
  STABLE_SWAP_LP_FEE_BPS,
  YIELD_VAULT_ABI,
  poolMinOut,
  poolSlippageBps,
} from '../../config/poolsConfig'
import { getActiveSmartAccount, sendModularUserOperation } from '../modularWalletService'
import { resilientReadContract, resilientWriteContract } from '../rpc'
import {
  calculateConstantProductExpectedOut,
  calculateLpClaimAmount,
  calculateStableSwapExpectedOut,
} from '../../utils/poolMath'
import { resolveUcwTxHash } from '../../utils/ucwTxHash'
import { poolsLog, type PoolExecutionContext, type PoolWithdrawResult, type UserPoolPosition } from './poolTypes'
import { estimateSafeGas, requireDeployed } from './poolUtils'
import { executeSwapInPool } from './poolSwapService'

/**
 * Withdraw (vault redeem OR LP removeLiquidity)
 */
export async function executeWithdrawFromPool(
  ctx: PoolExecutionContext,
  poolId: string,
  amountStr: string,
  payoutMode: 'standard' | 'dual' | 'usdc' = 'standard',
  _provider?: unknown,
  _slippage: number = 0.5,
  skipCacheInvalidation: boolean = false
): Promise<PoolWithdrawResult> {
  const {
    walletAddress,
    authSource,
    executeUcwContract,
    publicClient,
    queryClient,
    getWalletClient,
    waitForReceiptSafe,
    invalidatePoolCaches,
    userPoolPositions,
    onchainPoolState,
  } = ctx

  const pool = ARCIS_POOLS.find((p) => p.id === poolId)
  if (!pool) throw new Error('Pool not found')

  const targetAccount = (walletAddress || (await (await getWalletClient())?.getAddresses())?.[0]) as Address
  if (!targetAccount) throw new Error('Wallet not connected')

  // 1. YieldVault Withdrawal (ERC-4626)
  if (pool.id === 'usdc-yield-vault') {
    requireDeployed(POOL_CONTRACTS.YIELD_VAULT, pool.name)

    const walletSharesRaw = (await resilientReadContract(publicClient, {
      address: POOL_CONTRACTS.YIELD_VAULT,
      abi: YIELD_VAULT_ABI,
      functionName: 'balanceOf',
      args: [targetAccount],
    })) as bigint

    if (walletSharesRaw === 0n) {
      throw new Error('No vault shares deposited')
    }

    const totalAssets = (await resilientReadContract(publicClient, {
      address: POOL_CONTRACTS.YIELD_VAULT,
      abi: YIELD_VAULT_ABI,
      functionName: 'totalAssets',
    })) as bigint

    const totalSupply = (await resilientReadContract(publicClient, {
      address: POOL_CONTRACTS.YIELD_VAULT,
      abi: YIELD_VAULT_ABI,
      functionName: 'totalSupply',
    })) as bigint

    const userPos = userPoolPositions?.['usdc-yield-vault']
    const userStakedUsd = userPos?.stakedUsd || 0
    const withdrawAmountUsd = parseFloat(amountStr) || 0

    let sharesToRedeem: bigint
    if (userStakedUsd > 0 && withdrawAmountUsd >= userStakedUsd * 0.999) {
      sharesToRedeem = walletSharesRaw
    } else {
      const amountAssets = parseUnits(amountStr, 6)
      try {
        sharesToRedeem = (await resilientReadContract(publicClient, {
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'previewWithdraw',
          args: [amountAssets],
        })) as bigint
      } catch {
        if (totalAssets > 0n && totalSupply > 0n) {
          sharesToRedeem = (amountAssets * totalSupply) / totalAssets
        } else {
          throw new Error(
            'Unable to map the withdrawal amount to vault shares right now. Please refresh and retry.'
          )
        }
      }
      if (sharesToRedeem > walletSharesRaw) sharesToRedeem = walletSharesRaw
    }
    if (sharesToRedeem === 0n) {
      throw new Error('Withdrawal amount too small')
    }

    let guardedRedeemArgs: readonly [bigint, Address, Address, bigint] | null = null
    if (POOL_VERSION_V4) {
      const expectedAssets = (await resilientReadContract(publicClient, {
        address: POOL_CONTRACTS.YIELD_VAULT,
        abi: YIELD_VAULT_ABI,
        functionName: 'previewRedeem',
        args: [sharesToRedeem],
      }).catch(() => 0n)) as bigint
      if (!(expectedAssets > 0n)) {
        throw new Error(
          'Unable to compute a safe minimum-assets guard for the vault redeem. Please refresh and retry so the exit is protected against share-price manipulation.'
        )
      }
      guardedRedeemArgs = [
        sharesToRedeem,
        targetAccount,
        targetAccount,
        poolMinOut(expectedAssets, poolSlippageBps(_slippage)),
      ]
    }

    const applyYieldVaultOptimisticWithdraw = () => {
      if (withdrawAmountUsd <= 0) return
      queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
        if (!old) return old
        const oldUsdc = parseFloat(old.usdc || '0')
        return { ...old, usdc: (oldUsdc + withdrawAmountUsd).toFixed(2) }
      })
      queryClient.setQueryData<Record<string, UserPoolPosition>>(
        ['userPoolPositions', targetAccount],
        (old: any) => {
          if (!old) return old
          const curr = old['usdc-yield-vault']
          if (!curr) return old
          const oldStaked = curr.stakedUsd || 0
          const newStaked = Math.max(0, oldStaked - withdrawAmountUsd)
          return {
            ...old,
            ['usdc-yield-vault']: {
              ...curr,
              stakedAmount: newStaked.toFixed(2),
              stakedUsd: newStaked,
              lpTokenBalance: newStaked.toFixed(2),
            },
          }
        }
      )
    }

    // Modular Smart Account (Passkey)
    const smartAccount = getActiveSmartAccount()
    if (smartAccount) {
      const redeemCall = {
        to: POOL_CONTRACTS.YIELD_VAULT as Hex,
        data: guardedRedeemArgs
          ? encodeFunctionData({
            abi: YIELD_VAULT_ABI,
            functionName: 'redeemWithMinAssets',
            args: guardedRedeemArgs,
          })
          : encodeFunctionData({
            abi: YIELD_VAULT_ABI,
            functionName: 'redeem',
            args: [sharesToRedeem, targetAccount, targetAccount],
          }),
      }
      const opRes = await sendModularUserOperation({
        calls: [redeemCall],
        paymaster: true,
      })
      if (!opRes.success || !opRes.txHash) {
        throw new Error(opRes.error || 'Modular UserOperation redeem failed.')
      }
      applyYieldVaultOptimisticWithdraw()
      if (!skipCacheInvalidation) {
        await invalidatePoolCaches()
      }
      return { txHash: opRes.txHash }
    }

    // Circle UCW Execution
    if (authSource === 'ucw' && executeUcwContract) {
      console.log('[usePoolsData UCW] Requesting redeem challenge for Yield Vault...')
      const redeemRes = await executeUcwContract({
        contractAddress: POOL_CONTRACTS.YIELD_VAULT,
        abiFunctionSignature: guardedRedeemArgs
          ? 'redeemWithMinAssets(uint256,address,address,uint256)'
          : 'redeem(uint256,address,address)',
        abiParameters: guardedRedeemArgs
          ? [
            sharesToRedeem.toString(),
            targetAccount,
            targetAccount,
            guardedRedeemArgs[3].toString(),
          ]
          : [sharesToRedeem.toString(), targetAccount, targetAccount],
        blockchain: 'ARC-TESTNET',
      })
      if (!redeemRes.success) {
        throw new Error(redeemRes.error || 'Yield vault redeem authorization failed.')
      }

      const txHash = resolveUcwTxHash(redeemRes) || ''
      applyYieldVaultOptimisticWithdraw()
      if (!skipCacheInvalidation) {
        await invalidatePoolCaches()
      }
      return { txHash }
    }

    // EOA Provider
    const walletClient = await getWalletClient()
    if (!walletClient) throw new Error('Wallet not connected')

    const gasLimit = await estimateSafeGas(
      publicClient,
      {
        address: POOL_CONTRACTS.YIELD_VAULT,
        abi: YIELD_VAULT_ABI,
        functionName: guardedRedeemArgs ? 'redeemWithMinAssets' : 'redeem',
        args: (guardedRedeemArgs || [sharesToRedeem, targetAccount, targetAccount]) as any,
        account: targetAccount,
      },
      350_000n
    )

    const txHash = guardedRedeemArgs
      ? await resilientWriteContract(walletClient, {
        address: POOL_CONTRACTS.YIELD_VAULT,
        abi: YIELD_VAULT_ABI,
        functionName: 'redeemWithMinAssets',
        args: guardedRedeemArgs,
        account: targetAccount,
        chain: arcTestnet,
        gas: gasLimit,
      })
      : await resilientWriteContract(walletClient, {
        address: POOL_CONTRACTS.YIELD_VAULT,
        abi: YIELD_VAULT_ABI,
        functionName: 'redeem',
        args: [sharesToRedeem, targetAccount, targetAccount],
        account: targetAccount,
        chain: arcTestnet,
        gas: gasLimit,
      })
    applyYieldVaultOptimisticWithdraw()
    await waitForReceiptSafe(txHash, 'Yield vault redeem')
    if (!skipCacheInvalidation) {
      await invalidatePoolCaches()
    }
    return { txHash }
  }

  // 2. LP Pool Removal
  const poolAddress = pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
    ? POOL_CONTRACTS.STABLE_SWAP_POOL
    : poolId === 'usdc-weth-pool'
      ? POOL_CONTRACTS.WETH_POOL
      : poolId === 'eurc-weth-pool'
        ? POOL_CONTRACTS.EURC_WETH_POOL
        : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL)
  requireDeployed(poolAddress, pool.name)

  const userLpRaw = (await resilientReadContract(publicClient, {
    address: poolAddress,
    abi: STABLE_SWAP_ABI,
    functionName: 'balanceOf',
    args: [targetAccount],
  })) as bigint

  if (userLpRaw === 0n) {
    throw new Error('No LP liquidity deposited in this pool')
  }

  const userPos = userPoolPositions?.[poolId]
  const userStakedUsd = userPos?.stakedUsd || 0
  const userLpTokensFormatted = parseFloat(userPos?.lpTokenBalance || '0')
  const withdrawAmountNum = parseFloat(amountStr) || 0
  const withdrawAmountUsd = withdrawAmountNum

  let lpToWithdraw: bigint
  if (userStakedUsd > 0 && withdrawAmountNum >= userStakedUsd * 0.999) {
    lpToWithdraw = userLpRaw
  } else if (userLpTokensFormatted > 0 && Math.abs(withdrawAmountNum - userLpTokensFormatted) <= userLpTokensFormatted * 0.001) {
    lpToWithdraw = userLpRaw
  } else {
    let directLpRaw = 0n
    try {
      directLpRaw = parseUnits(withdrawAmountNum.toFixed(18), 18)
    } catch (err) {
      poolsLog.warn('Withdrawal amount could not be parsed as LP shares; falling back to a proportional claim', err)
    }

    if (directLpRaw > 0n && directLpRaw <= userLpRaw) {
      lpToWithdraw = directLpRaw
    } else if (userStakedUsd > 0 && withdrawAmountUsd >= userStakedUsd * 0.999) {
      lpToWithdraw = userLpRaw
    } else if (userStakedUsd <= 0 || userPos?.priceUnavailable) {
      // H3/O4 fix: missing or unverified price feed prevents an unintended full exit
      throw new Error(
        'Unable to value your LP position right now (price feed unverified). Please specify your withdrawal percentage or LP token amount directly.'
      )
    } else {
      lpToWithdraw = calculateLpClaimAmount(withdrawAmountNum, userStakedUsd, userLpRaw)
      if (lpToWithdraw > userLpRaw) lpToWithdraw = userLpRaw
    }
  }

  if (lpToWithdraw === 0n) {
    throw new Error('Withdrawal amount too small')
  }

  const counterToken = pool.tokens[1]
  const counterTokenAddress = (counterToken?.address || (pool.id === 'usdc-weth-pool' ? POOL_CONTRACTS.WETH : POOL_CONTRACTS.cirBTC)) as `0x${string}`

  const removeLiquidityArgs = (() => {
    if (!POOL_VERSION_V4) return [lpToWithdraw, 0n, 0n] as const
    const st = (onchainPoolState || {})[poolAddress] as any
    const total = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
    if (total <= 0n) return [lpToWithdraw, 0n, 0n] as const
    const counterDecimals = counterToken?.decimals ?? (pool.id === 'usdc-cirbtc-pool' ? 8 : pool.id === 'usdc-weth-pool' ? 18 : 6)
    const reserveA = st?.reserveA ? parseUnits(st.reserveA, 6) : 0n
    const reserveB = st?.reserveB ? parseUnits(st.reserveB, counterDecimals) : 0n
    const slipBps = poolSlippageBps(_slippage)
    const minOutA = reserveA > 0n ? poolMinOut((reserveA * lpToWithdraw) / total, slipBps) : 0n
    const minOutB = reserveB > 0n ? poolMinOut((reserveB * lpToWithdraw) / total, slipBps) : 0n
    return [lpToWithdraw, minOutA, minOutB] as const
  })() as readonly [lpAmount: bigint, minOutA: bigint, minOutB: bigint]

  const counterBalBefore = payoutMode === 'usdc' && counterTokenAddress
    ? ((await resilientReadContract(publicClient, {
      address: counterTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [targetAccount],
    })) as bigint)
    : 0n

  const applyLpOptimisticWithdraw = () => {
    if (withdrawAmountUsd <= 0) return
    queryClient.setQueryData<Record<string, UserPoolPosition>>(
      ['userPoolPositions', targetAccount],
      (old: any) => {
        if (!old) return old
        const curr = old[poolId]
        if (!curr) return old
        const oldStaked = curr.stakedUsd || 0
        const newStaked = Math.max(0, oldStaked - withdrawAmountUsd)
        return {
          ...old,
          [poolId]: {
            ...curr,
            stakedAmount: newStaked.toFixed(2),
            stakedUsd: newStaked,
            lpTokenBalance: newStaked.toFixed(2),
          },
        }
      }
    )
  }

  let txHash = ''
  const smartAccount = getActiveSmartAccount()

  if (smartAccount) {
    const removeCall = {
      to: poolAddress as Hex,
      data: encodeFunctionData({
        abi: STABLE_SWAP_ABI,
        functionName: 'removeLiquidity',
        args: removeLiquidityArgs,
      }),
    }
    const opRes = await sendModularUserOperation({
      calls: [removeCall],
      paymaster: true,
    })
    if (!opRes.success || !opRes.txHash) {
      throw new Error(opRes.error || 'Modular UserOperation removeLiquidity failed.')
    }
    txHash = opRes.txHash
    await waitForReceiptSafe(txHash as Hex, 'Remove liquidity')
    applyLpOptimisticWithdraw()
  } else if (authSource === 'ucw' && executeUcwContract) {
    console.log('[usePoolsData UCW] Requesting removeLiquidity challenge on pool...')
    const removeRes = await executeUcwContract({
      contractAddress: poolAddress,
      abiFunctionSignature: 'removeLiquidity(uint256,uint256,uint256)',
      abiParameters: [
        removeLiquidityArgs[0].toString(),
        removeLiquidityArgs[1].toString(),
        removeLiquidityArgs[2].toString(),
      ],
      blockchain: 'ARC-TESTNET',
    })
    if (!removeRes.success) {
      const isCanceled =
        removeRes.error?.toLowerCase().includes('cancel') ||
        removeRes.error?.toLowerCase().includes('iptal') ||
        removeRes.error?.toLowerCase().includes('closed')
      const err: any = new Error(removeRes.error || 'Remove liquidity authorization failed.')
      if (isCanceled) (err as any).isCanceled = true
      throw err
    }
    txHash = removeRes.txHash || ''
    if (txHash && txHash.startsWith('0x')) {
      await waitForReceiptSafe(txHash as Hex, 'Remove liquidity')
    }
    applyLpOptimisticWithdraw()
  } else {
    const walletClient = await getWalletClient()
    if (!walletClient) throw new Error('Wallet not connected')

    const gasLimit = await estimateSafeGas(
      publicClient,
      {
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'removeLiquidity',
        args: removeLiquidityArgs as any,
        account: targetAccount,
      },
      400_000n
    )

    txHash = await resilientWriteContract(walletClient, {
      address: poolAddress,
      abi: STABLE_SWAP_ABI,
      functionName: 'removeLiquidity',
      args: removeLiquidityArgs,
      account: targetAccount,
      chain: arcTestnet,
      gas: gasLimit,
    })
    await waitForReceiptSafe(txHash as Hex, 'Remove liquidity')
    applyLpOptimisticWithdraw()
  }

  // Single-sided 100% USDC Payout: automatically swap the received counter token to USDC
  let autoSwapFailed = false
  let autoSwapCounterSymbol = ''
  let autoSwapCounterAmount = ''

  if (payoutMode === 'usdc' && counterToken?.address) {
    try {
      if (txHash) {
        await waitForReceiptSafe(txHash as Hex, 'Remove liquidity')
      }
      const counterBalAfter = (await resilientReadContract(publicClient, {
        address: counterTokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [targetAccount],
      })) as bigint

      const receivedCounter = counterBalAfter > counterBalBefore ? counterBalAfter - counterBalBefore : 0n
      if (receivedCounter > 0n) {
        const counterDecimals = counterToken.decimals ?? (pool.id === 'usdc-cirbtc-pool' ? 8 : pool.id === 'usdc-weth-pool' ? 18 : 6)
        const counterBalStr = formatUnits(receivedCounter, counterDecimals)
        autoSwapCounterSymbol = counterToken.symbol
        autoSwapCounterAmount = counterBalStr

        let minOutUsdcStr = '0'
        try {
          const [freshReserveA, freshReserveB] = await Promise.all([
            resilientReadContract(publicClient, {
              address: poolAddress,
              abi: STABLE_SWAP_ABI,
              functionName: 'reserveA',
            }).catch(() => 0n),
            resilientReadContract(publicClient, {
              address: poolAddress,
              abi: STABLE_SWAP_ABI,
              functionName: 'reserveB',
            }).catch(() => 0n),
          ])

          let resA = (freshReserveA as bigint) || 0n
          let resB = (freshReserveB as bigint) || 0n

          if (resA === 0n || resB === 0n) {
            const st = (onchainPoolState || {})[poolAddress] as any
            if (st) {
              resA = parseUnits(st.reserveA || '0', 6)
              resB = parseUnits(st.reserveB || '0', counterDecimals)
            }
          }

          if (resA > 0n && resB > 0n) {
            let expectedOut = 0n
            if (poolId === 'usdc-eurc-stable-pool') {
              expectedOut = calculateStableSwapExpectedOut(receivedCounter, resB, resA, STABLE_SWAP_LP_FEE_BPS, STABLE_SWAP_AMP)
            } else {
              expectedOut = calculateConstantProductExpectedOut(receivedCounter, resB, resA, CONSTANT_PRODUCT_LP_FEE_BPS)
            }
            const slipBps = poolSlippageBps(_slippage)
            const minOut = poolMinOut(expectedOut, slipBps)
            if (minOut > 0n) {
              minOutUsdcStr = formatUnits(minOut, 6)
            }
          }
        } catch (mathErr) {
          console.warn('[usePoolsData] Auto-swap fresh minOut calculation fallback:', mathErr)
        }

        if ((parseFloat(minOutUsdcStr) || 0) > 0) {
          await executeSwapInPool(ctx, poolId, counterToken.symbol, 'USDC', counterBalStr, minOutUsdcStr, skipCacheInvalidation)
        } else {
          autoSwapFailed = true
          console.warn('[usePoolsData] Skipping auto-swap to USDC: could not compute a safe minOut from live reserves.')
        }
      }
    } catch (swapErr) {
      autoSwapFailed = true
      console.warn('[usePoolsData] Auto-swap to USDC after LP removal failed:', swapErr)
    }
  }

  if (!skipCacheInvalidation) {
    await invalidatePoolCaches()
  }
  return {
    txHash,
    autoSwapFailed,
    counterTokenSymbol: autoSwapCounterSymbol,
    counterAmount: autoSwapCounterAmount,
  }
}
