import {
  decodeEventLog,
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
  POOL_CONTRACTS,
  STABLE_SWAP_ABI,
} from '../../config/poolsConfig'
import { getActiveSmartAccount, sendModularUserOperation } from '../modularWalletService'
import { resilientWriteContract } from '../rpc'
import { recordClientSwapVolume } from '../../utils/poolVolumeUtils'
import { poolsLog, type PoolExecutionContext } from './poolTypes'
import { estimateSafeGas, requireDeployed } from './poolUtils'

/**
 * Pool Swap (USDC ↔ EURC via StableSwapPool or USDC ↔ cirBTC via ConstantProductPool)
 */
export async function executeSwapInPool(
  ctx: PoolExecutionContext,
  poolId: string,
  tokenIn: string,
  tokenOut: string,
  amountInStr: string,
  minOutStr?: string,
  skipCacheInvalidation: boolean = false
): Promise<{ txHash: string; amountOut: string }> {
  const {
    walletAddress,
    authSource,
    executeUcwContract,
    publicClient,
    getWalletClient,
    approveToken,
    waitForReceiptSafe,
    invalidatePoolCaches,
    livePrices,
  } = ctx

  const pool = ARCIS_POOLS.find((p) => p.id === poolId)
  if (!pool || !pool.isLpPool) throw new Error('Pool does not support swapping')

  const poolAddress = pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
    ? POOL_CONTRACTS.STABLE_SWAP_POOL
    : poolId === 'usdc-weth-pool'
      ? POOL_CONTRACTS.WETH_POOL
      : poolId === 'eurc-weth-pool'
        ? POOL_CONTRACTS.EURC_WETH_POOL
        : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL)

  requireDeployed(poolAddress, pool.name)

  const targetAccount = (walletAddress || (await (await getWalletClient())?.getAddresses())?.[0]) as Address
  if (!targetAccount) throw new Error('Wallet not connected')

  const counterToken = pool.tokens[1]
  const counterTokenAddr = (counterToken?.address || (pool.id === 'usdc-weth-pool' || pool.id === 'eurc-weth-pool' ? POOL_CONTRACTS.WETH : POOL_CONTRACTS.cirBTC)) as `0x${string}`

  const isWeth = (s: string) => s === 'WETH' || s === 'ETH'
  const tokenInAddr = tokenIn === 'USDC'
    ? POOL_CONTRACTS.USDC
    : tokenIn === 'EURC'
      ? POOL_CONTRACTS.EURC
      : isWeth(tokenIn)
        ? POOL_CONTRACTS.WETH
        : counterTokenAddr

  const tokenOutAddr = tokenOut === 'USDC'
    ? POOL_CONTRACTS.USDC
    : tokenOut === 'EURC'
      ? POOL_CONTRACTS.EURC
      : isWeth(tokenOut)
        ? POOL_CONTRACTS.WETH
        : counterTokenAddr

  const inDecimals = isWeth(tokenIn) ? 18 : (tokenIn === 'cirBTC' || (counterToken?.decimals === 8 && tokenIn !== 'USDC' && tokenIn !== 'EURC')) ? 8 : 6
  const outDecimals = isWeth(tokenOut) ? 18 : (tokenOut === 'cirBTC' || (counterToken?.decimals === 8 && tokenOut !== 'USDC' && tokenOut !== 'EURC')) ? 8 : 6
  const amountIn = parseUnits(amountInStr, inDecimals)
  const minOut = minOutStr ? parseUnits(minOutStr, outDecimals) : 0n
  if (minOut <= 0n) {
    throw new Error('A positive minimum-output guard is required; refusing to swap without slippage protection.')
  }

  let swapVolUsd = 0
  if (tokenIn === 'USDC') {
    swapVolUsd = parseFloat(amountInStr) || 0
  } else if (tokenIn === 'EURC') {
    swapVolUsd = (parseFloat(amountInStr) || 0) * livePrices.eurc
  } else if (tokenIn === 'cirBTC' || tokenIn === 'BTC') {
    swapVolUsd = (parseFloat(amountInStr) || 0) * livePrices.btc
  } else if (isWeth(tokenIn)) {
    swapVolUsd = (parseFloat(amountInStr) || 0) * livePrices.weth
  }

  const smartAccount = getActiveSmartAccount()
  if (smartAccount) {
    const approveCall = {
      to: tokenInAddr as Hex,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [poolAddress as Hex, amountIn],
      }),
    }
    const swapCall = {
      to: poolAddress as Hex,
      data: encodeFunctionData({
        abi: STABLE_SWAP_ABI,
        functionName: 'swap',
        args: [tokenInAddr, tokenOutAddr, amountIn, minOut],
      }),
    }
    const opRes = await sendModularUserOperation({
      calls: [approveCall, swapCall],
      paymaster: true,
    })
    if (!opRes.success || !opRes.txHash) {
      throw new Error(opRes.error || 'Modular UserOperation swap failed.')
    }

    const opReceipt = await waitForReceiptSafe(opRes.txHash as Hex, 'Modular Swap')
    let actualAmountOutStr = minOutStr || '0'
    if (opReceipt?.logs) {
      for (const log of opReceipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: STABLE_SWAP_ABI,
            eventName: 'Swapped',
            data: log.data,
            topics: log.topics,
          })
          if (decoded?.args && (decoded.args as any).amountOut !== undefined) {
            actualAmountOutStr = formatUnits((decoded.args as any).amountOut as bigint, outDecimals)
            break
          }
        } catch (err) {
          poolsLog.debug('Receipt log could not be decoded as Swapped; keeping the quoted swap output', err)
        }
      }
    }

    if (swapVolUsd > 0) {
      recordClientSwapVolume(poolId, swapVolUsd, opRes.txHash)
    }
    if (!skipCacheInvalidation) {
      await invalidatePoolCaches()
    }
    return { txHash: opRes.txHash, amountOut: actualAmountOutStr }
  }

  // 2. Circle UCW Execution
  if (authSource === 'ucw' && executeUcwContract) {
    console.log('[usePoolsData UCW] Requesting token approval for pool swap on ARC-TESTNET...')
    await approveToken(tokenInAddr as `0x${string}`, poolAddress, amountIn)

    console.log('[usePoolsData UCW] Requesting swap challenge on pool...')
    const swapRes = await executeUcwContract({
      contractAddress: poolAddress,
      abiFunctionSignature: 'swap(address,address,uint256,uint256)',
      abiParameters: [tokenInAddr, tokenOutAddr, amountIn.toString(), minOut.toString()],
      blockchain: 'ARC-TESTNET',
    })
    if (!swapRes.success) {
      const isCanceled =
        swapRes.error?.toLowerCase().includes('cancel') ||
        swapRes.error?.toLowerCase().includes('iptal') ||
        swapRes.error?.toLowerCase().includes('closed')
      const err: any = new Error(swapRes.error || 'Pool swap authorization failed.')
      if (isCanceled) (err as any).isCanceled = true
      throw err
    }

    const txHash = (swapRes.txHash || '') as Hex
    let actualAmountOutStr = minOutStr || '0'
    if (txHash && txHash.startsWith('0x')) {
      const receipt = await waitForReceiptSafe(txHash, 'Pool swap')
      if (receipt?.logs) {
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: STABLE_SWAP_ABI,
              eventName: 'Swapped',
              data: log.data,
              topics: log.topics,
            })
            if (decoded?.args && (decoded.args as any).amountOut !== undefined) {
              actualAmountOutStr = formatUnits((decoded.args as any).amountOut as bigint, outDecimals)
              break
            }
          } catch (err) {
            poolsLog.debug('Receipt log could not be decoded as Swapped; keeping the quoted swap output', err)
          }
        }
      }
    }

    if (swapVolUsd > 0) {
      recordClientSwapVolume(poolId, swapVolUsd, txHash)
    }
    if (!skipCacheInvalidation) {
      await invalidatePoolCaches()
    }
    return { txHash, amountOut: actualAmountOutStr }
  }

  // 3. EOA Provider
  const walletClient = await getWalletClient()
  if (!walletClient) throw new Error('Wallet not connected')

  await approveToken(tokenInAddr as `0x${string}`, poolAddress, amountIn)

  const gasLimit = await estimateSafeGas(
    publicClient,
    {
      address: poolAddress,
      abi: STABLE_SWAP_ABI,
      functionName: 'swap',
      args: [tokenInAddr, tokenOutAddr, amountIn, minOut],
      account: targetAccount,
    },
    350_000n
  )

  const txHash = await resilientWriteContract(walletClient, {
    address: poolAddress,
    abi: STABLE_SWAP_ABI,
    functionName: 'swap',
    args: [tokenInAddr, tokenOutAddr, amountIn, minOut],
    account: targetAccount,
    chain: arcTestnet,
    gas: gasLimit,
  })
  const receipt = await waitForReceiptSafe(txHash, 'Pool swap')

  let actualAmountOutStr = minOutStr || '0'
  if (receipt?.logs) {
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: STABLE_SWAP_ABI,
          eventName: 'Swapped',
          data: log.data,
          topics: log.topics,
        })
        if (decoded?.args && (decoded.args as any).amountOut !== undefined) {
          actualAmountOutStr = formatUnits((decoded.args as any).amountOut as bigint, outDecimals)
          break
        }
      } catch (err) {
        poolsLog.debug('Receipt log could not be decoded as Swapped; keeping the quoted swap output', err)
      }
    }
  }

  if (swapVolUsd > 0) {
    recordClientSwapVolume(poolId, swapVolUsd, txHash)
  }

  if (!skipCacheInvalidation) {
    await invalidatePoolCaches()
  }
  return { txHash, amountOut: actualAmountOutStr }
}
