import {
  encodeFunctionData,
  formatUnits,
  type Address,
  type Hex,
} from 'viem'
import { arcTestnet } from '../../config/arcChain'
import {
  ARCIS_POOLS,
  POOL_CONTRACTS,
  POOL_VERSION_V4,
  STABLE_SWAP_ABI,
  YIELD_VAULT_ABI,
} from '../../config/poolsConfig'
import { getActiveSmartAccount, sendModularUserOperation } from '../modularWalletService'
import { resilientReadContract, resilientWriteContract } from '../rpc'
import { isUserCanceled } from '../../utils/errorUtils'
import { addTransaction } from '../../utils/history'
import { resolveUcwTxHash, ucwHashPendingMessage } from '../../utils/ucwTxHash'
import { type PoolExecutionContext } from './poolTypes'
import { estimateSafeGas } from './poolUtils'

/**
 * Claim/Harvest yield from a specific pool
 */
export async function executeClaimPoolRewards(
  ctx: PoolExecutionContext,
  poolId: string
): Promise<{ amountClaimed: string; txHash: string }> {
  const {
    walletAddress,
    authSource,
    executeUcwContract,
    publicClient,
    getWalletClient,
    waitForReceiptSafe,
    invalidatePoolCaches,
    livePrices,
  } = ctx

  const pool = ARCIS_POOLS.find((p) => p.id === poolId)
  if (!pool) throw new Error('Pool not found')

  if (!POOL_VERSION_V4) {
    throw new Error('Fee harvest requires the V4 pool contracts (deploy V4 and set VITE_POOL_VERSION=v4).')
  }

  const targetAccount = (walletAddress || (await (await getWalletClient())?.getAddresses())?.[0]) as Address
  if (!targetAccount) throw new Error('Wallet not connected')

  const isVault = poolId === 'usdc-yield-vault'
  const poolAddress = (pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
    ? POOL_CONTRACTS.STABLE_SWAP_POOL
    : poolId === 'usdc-weth-pool'
      ? POOL_CONTRACTS.WETH_POOL
      : poolId === 'eurc-weth-pool'
        ? POOL_CONTRACTS.EURC_WETH_POOL
        : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL)) as `0x${string}`

  let harvestableA = 0n
  let harvestableB = 0n
  const decB = pool.tokens?.[1]?.decimals ?? 6
  if (isVault) {
    harvestableA = (await resilientReadContract(publicClient, {
      address: POOL_CONTRACTS.YIELD_VAULT,
      abi: YIELD_VAULT_ABI,
      functionName: 'pendingYield',
      args: [targetAccount],
    })) as bigint
  } else {
    const pending = (await resilientReadContract(publicClient, {
      address: poolAddress,
      abi: STABLE_SWAP_ABI,
      functionName: 'pendingFees',
      args: [targetAccount],
    })) as readonly [bigint, bigint]
    harvestableA = pending?.[0] || 0n
    harvestableB = pending?.[1] || 0n
  }

  if (harvestableA === 0n && harvestableB === 0n) {
    throw new Error('No harvestable rewards accrued yet for this pool.')
  }

  const harvestTarget = (isVault ? POOL_CONTRACTS.YIELD_VAULT : poolAddress) as `0x${string}`

  let txHash = ''
  const smartAccount = getActiveSmartAccount()
  if (smartAccount) {
    const harvestData = isVault
      ? encodeFunctionData({ abi: YIELD_VAULT_ABI, functionName: 'harvest' })
      : encodeFunctionData({ abi: STABLE_SWAP_ABI, functionName: 'harvest' })
    const opRes = await sendModularUserOperation({
      calls: [{ to: harvestTarget as Hex, data: harvestData }],
      paymaster: true,
    })
    if (!opRes.success || !opRes.txHash) {
      throw new Error(opRes.error || 'Modular UserOperation harvest failed.')
    }
    txHash = opRes.txHash
    await waitForReceiptSafe(txHash as Hex, 'Harvest')
  } else if (authSource === 'ucw' && executeUcwContract) {
    const res = await executeUcwContract({
      contractAddress: harvestTarget,
      abiFunctionSignature: 'harvest()',
      abiParameters: [],
      blockchain: 'ARC-TESTNET',
    })
    if (!res.success) {
      const isCanceled = Boolean(res.error && (res.error.toLowerCase().includes('cancel') || res.error.toLowerCase().includes('iptal')))
      const err: any = new Error(res.error || 'Harvest authorization failed.')
      if (isCanceled) err.isCanceled = true
      throw err
    }
    const ucwHarvestHash = resolveUcwTxHash(res)
    if (!ucwHarvestHash) {
      throw new Error(ucwHashPendingMessage('Harvest'))
    }
    txHash = ucwHarvestHash
    await waitForReceiptSafe(txHash as Hex, 'Harvest')
  } else {
    const walletClient = await getWalletClient()
    if (!walletClient) throw new Error('Wallet not connected')
    if (isVault) {
      const gasLimit = await estimateSafeGas(
        publicClient,
        {
          address: POOL_CONTRACTS.YIELD_VAULT,
          abi: YIELD_VAULT_ABI,
          functionName: 'harvest',
          args: [],
          account: targetAccount,
        },
        250_000n
      )
      txHash = await resilientWriteContract(walletClient, {
        address: POOL_CONTRACTS.YIELD_VAULT,
        abi: YIELD_VAULT_ABI,
        functionName: 'harvest',
        args: [],
        account: targetAccount,
        chain: arcTestnet,
        gas: gasLimit,
      })
    } else {
      const gasLimit = await estimateSafeGas(
        publicClient,
        {
          address: poolAddress,
          abi: STABLE_SWAP_ABI,
          functionName: 'harvest',
          args: [],
          account: targetAccount,
        },
        300_000n
      )
      txHash = await resilientWriteContract(walletClient, {
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'harvest',
        args: [],
        account: targetAccount,
        chain: arcTestnet,
        gas: gasLimit,
      })
    }
    await waitForReceiptSafe(txHash as Hex, 'Harvest')
  }

  const usdA = parseFloat(formatUnits(harvestableA, 6))
  const counterPrice = decB === 8 ? livePrices.btc : decB === 18 ? livePrices.weth : livePrices.eurc
  const usdB = harvestableB > 0n
    ? parseFloat(formatUnits(harvestableB, decB)) * counterPrice
    : 0
  const amountClaimed = (usdA + usdB).toFixed(4)

  if (txHash && targetAccount) {
    try {
      addTransaction({
        type: 'harvest',
        txHash,
        amount: amountClaimed,
        tokenSymbol: 'USDC',
        sourceChain: 'Arc_Testnet',
        recipient: targetAccount,
        userAddress: targetAccount,
        status: 'success',
        poolId,
        poolName: pool.name,
      })
    } catch (histErr) {
      console.warn('[usePoolsData] Failed to record harvest in history:', histErr)
    }
  }

  await invalidatePoolCaches()
  return { amountClaimed, txHash }
}

/**
 * Claim all eligible rewards across user's pools
 */
export async function executeClaimAllRewards(
  ctx: PoolExecutionContext
): Promise<{
  totalClaimed: string
  txHash: string
  txHashes: string[]
  successfulPools: string[]
  failedPools: string[]
  isCanceled?: boolean
}> {
  const { userPoolPositions, invalidatePoolCaches } = ctx
  if (!userPoolPositions) {
    throw new Error('No active pool positions found.')
  }

  const claimablePools = ARCIS_POOLS.filter((p) => {
    const pos = userPoolPositions[p.id]
    return pos && pos.earnedUsd >= 0.01
  })

  if (claimablePools.length === 0) {
    throw new Error('No claimable yield available across your pools (minimum 0.01 USDC).')
  }

  let totalClaimed = 0
  let lastTxHash = ''
  const txHashes: string[] = []
  const successfulPools: string[] = []
  const failedPools: string[] = []
  let userCanceledError: any = null

  for (const pool of claimablePools) {
    try {
      const res = await executeClaimPoolRewards(ctx, pool.id)
      const amt = parseFloat(res.amountClaimed) || 0
      totalClaimed += amt
      if (res.txHash) {
        lastTxHash = res.txHash
        txHashes.push(res.txHash)
      }
      successfulPools.push(pool.name)
    } catch (err: any) {
      if (isUserCanceled(err) || err?.isCanceled === true || (err as any)?.code === 4001) {
        userCanceledError = err
        console.info(`[usePoolsData] Claim canceled by user for ${pool.name}`)
        break
      }
      console.warn(`[usePoolsData] Claim failed for ${pool.name}:`, err)
      failedPools.push(pool.name)
    }
  }

  await invalidatePoolCaches()

  if (userCanceledError && successfulPools.length === 0) {
    throw userCanceledError
  }

  return {
    totalClaimed: totalClaimed.toFixed(4),
    txHash: lastTxHash,
    txHashes,
    successfulPools,
    failedPools,
    isCanceled: Boolean(userCanceledError),
  }
}
