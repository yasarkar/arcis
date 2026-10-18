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
  POOL_DEFAULT_SLIPPAGE_BPS,
  POOL_VERSION_V4,
  STABLE_SWAP_ABI,
  STABLE_SWAP_AMP,
  YIELD_VAULT_ABI,
  poolMinOut,
  poolSlippageBps,
} from '../../config/poolsConfig'
import { getActiveSmartAccount, sendModularUserOperation } from '../modularWalletService'
import { resilientReadContract, resilientWriteContract } from '../rpc'
import {
  analyzeDualDepositBalance,
  calculatePoolShare,
  calculateStableSwapExpectedOut,
  DUAL_DEPOSIT_DONATION_BLOCK_PCT,
} from '../../utils/poolMath'
import { recordClientSwapVolume } from '../../utils/poolVolumeUtils'
import { poolsLog, type PoolExecutionContext, type UserPoolPosition } from './poolTypes'
import { computeMinLpShares, estimateSafeGas, requireDeployed } from './poolUtils'

/**
 * Standard deposit (Yield Vault & Gateway Settlement Pool)
 */
export async function executeDepositToPool(
  ctx: PoolExecutionContext,
  poolId: string,
  amountStr: string
): Promise<{ txHash: string }> {
  const {
    walletAddress,
    authSource,
    executeUcwContract,
    publicClient,
    queryClient,
    getWalletClient,
    approveToken,
    waitForReceiptSafe,
    invalidatePoolCaches,
  } = ctx

  const pool = ARCIS_POOLS.find((p) => p.id === poolId)
  if (!pool) throw new Error('Pool not found')

  const targetAccount = (walletAddress || (await (await getWalletClient())?.getAddresses())?.[0]) as Address
  if (!targetAccount) throw new Error('Wallet not connected')

  if (pool.id !== 'usdc-yield-vault') {
    throw new Error('Use Zap / Dual deposit for LP pools')
  }

  requireDeployed(POOL_CONTRACTS.YIELD_VAULT, pool.name)
  const amount = parseUnits(amountStr, 6)
  const depositAmt = parseFloat(amountStr) || 0

  let guardedDepositArgs: readonly [bigint, Address, bigint] | null = null
  if (POOL_VERSION_V4) {
    const expectedShares = (await resilientReadContract(publicClient, {
      address: POOL_CONTRACTS.YIELD_VAULT,
      abi: YIELD_VAULT_ABI,
      functionName: 'previewDeposit',
      args: [amount],
    }).catch(() => 0n)) as bigint
    if (!(expectedShares > 0n)) {
      throw new Error(
        'Unable to compute a safe minimum-shares guard for the vault deposit. Please refresh and retry so the deposit is protected against share-price manipulation.'
      )
    }
    guardedDepositArgs = [amount, targetAccount, poolMinOut(expectedShares, POOL_DEFAULT_SLIPPAGE_BPS)]
  }

  const applyYieldVaultOptimisticDeposit = () => {
    if (depositAmt <= 0) return
    queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
      if (!old) return old
      const oldUsdc = parseFloat(old.usdc || '0')
      return { ...old, usdc: Math.max(0, oldUsdc - depositAmt).toFixed(2) }
    })
    queryClient.setQueryData<Record<string, UserPoolPosition>>(['userPoolPositions', targetAccount], (old: any) => {
      if (!old) return old
      const curr = old['usdc-yield-vault']
      const oldStaked = curr?.stakedUsd || 0
      const newStaked = oldStaked + depositAmt
      return {
        ...old,
        ['usdc-yield-vault']: {
          ...(curr || { poolId: 'usdc-yield-vault', earnedRewards: '0.00', earnedUsd: 0, poolSharePct: 0, lastUpdatedTimestamp: Date.now() }),
          stakedAmount: newStaked.toFixed(2),
          stakedUsd: newStaked,
          lpTokenBalance: newStaked.toFixed(2),
        },
      }
    })
  }

  // 1. Modular Smart Account
  const smartAccount = getActiveSmartAccount()
  if (smartAccount) {
    const approveCall = {
      to: POOL_CONTRACTS.USDC as Hex,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [POOL_CONTRACTS.YIELD_VAULT, amount],
      }),
    }
    const depositCall = {
      to: POOL_CONTRACTS.YIELD_VAULT as Hex,
      data: guardedDepositArgs
        ? encodeFunctionData({
          abi: YIELD_VAULT_ABI,
          functionName: 'depositWithMinShares',
          args: guardedDepositArgs,
        })
        : encodeFunctionData({
          abi: YIELD_VAULT_ABI,
          functionName: 'deposit',
          args: [amount, targetAccount],
        }),
    }
    const opRes = await sendModularUserOperation({
      calls: [approveCall, depositCall],
      paymaster: true,
    })
    if (!opRes.success || !opRes.txHash) {
      throw new Error(opRes.error || 'Modular UserOperation deposit failed.')
    }
    applyYieldVaultOptimisticDeposit()
    await invalidatePoolCaches()
    return { txHash: opRes.txHash }
  }

  // 2. Circle UCW Execution
  if (authSource === 'ucw' && executeUcwContract) {
    console.log('[usePoolsData UCW] Checking/requesting USDC allowance for Yield Vault...')
    await approveToken(POOL_CONTRACTS.USDC, POOL_CONTRACTS.YIELD_VAULT, amount)

    console.log('[usePoolsData UCW] Requesting deposit challenge for Yield Vault...')
    const depositRes = await executeUcwContract({
      contractAddress: POOL_CONTRACTS.YIELD_VAULT,
      abiFunctionSignature: guardedDepositArgs
        ? 'depositWithMinShares(uint256,address,uint256)'
        : 'deposit(uint256,address)',
      abiParameters: guardedDepositArgs
        ? [amount.toString(), targetAccount, guardedDepositArgs[2].toString()]
        : [amount.toString(), targetAccount],
      blockchain: 'ARC-TESTNET',
    })
    if (!depositRes.success) {
      const isCanceled =
        depositRes.error?.toLowerCase().includes('cancel') ||
        depositRes.error?.toLowerCase().includes('iptal') ||
        depositRes.error?.toLowerCase().includes('closed')
      const err: any = new Error(depositRes.error || 'Yield vault deposit authorization failed.')
      if (isCanceled) (err as any).isCanceled = true
      throw err
    }

    const txHash = depositRes.txHash || ''
    if (txHash && txHash.startsWith('0x')) {
      await waitForReceiptSafe(txHash as Hex, 'Yield Vault Deposit')
    }
    applyYieldVaultOptimisticDeposit()
    await invalidatePoolCaches()
    return { txHash }
  }

  // 3. EOA Provider
  const walletClient = await getWalletClient()
  if (!walletClient) throw new Error('Wallet not connected')

  await approveToken(POOL_CONTRACTS.USDC, POOL_CONTRACTS.YIELD_VAULT, amount)

  const gasLimit = await estimateSafeGas(
    publicClient,
    {
      address: POOL_CONTRACTS.YIELD_VAULT,
      abi: YIELD_VAULT_ABI,
      functionName: guardedDepositArgs ? 'depositWithMinShares' : 'deposit',
      args: (guardedDepositArgs || [amount, targetAccount]) as any,
      account: targetAccount,
    },
    350_000n
  )

  const txHash = guardedDepositArgs
    ? await resilientWriteContract(walletClient, {
      address: POOL_CONTRACTS.YIELD_VAULT,
      abi: YIELD_VAULT_ABI,
      functionName: 'depositWithMinShares',
      args: guardedDepositArgs,
      account: targetAccount,
      chain: arcTestnet,
      gas: gasLimit,
    })
    : await resilientWriteContract(walletClient, {
      address: POOL_CONTRACTS.YIELD_VAULT,
      abi: YIELD_VAULT_ABI,
      functionName: 'deposit',
      args: [amount, targetAccount],
      account: targetAccount,
      chain: arcTestnet,
      gas: gasLimit,
    })
  applyYieldVaultOptimisticDeposit()
  await waitForReceiptSafe(txHash, 'Deposit')
  await invalidatePoolCaches()
  return { txHash }
}

/**
 * 1-Click Zap: swap half USDC->counter, then add dual liquidity
 */
export async function executeZapIn(
  ctx: PoolExecutionContext,
  poolId: string,
  _tokenInSymbol: string,
  inputAmountStr: string,
  _slippage: number = 0.5
): Promise<{ txHash: string; lpMinted: string; poolShare: number }> {
  const {
    walletAddress,
    authSource,
    executeUcwContract,
    publicClient,
    queryClient,
    getWalletClient,
    approveToken,
    waitForReceiptSafe,
    invalidatePoolCaches,
    onchainPoolState,
    poolsWithUserStats,
  } = ctx

  const livePool = poolsWithUserStats.find((p: any) => p.id === poolId)
  const pool = livePool || ARCIS_POOLS.find((p) => p.id === poolId)
  if (!pool || !pool.isLpPool) throw new Error('Pool does not support LP Zap')

  const poolAddress = pool.contractAddress || (poolId === 'usdc-eurc-stable-pool'
    ? POOL_CONTRACTS.STABLE_SWAP_POOL
    : POOL_CONTRACTS.CONSTANT_PRODUCT_POOL)

  requireDeployed(poolAddress, pool.name)

  const targetAccount = (walletAddress || (await (await getWalletClient())?.getAddresses())?.[0]) as Address
  if (!targetAccount) throw new Error('Wallet not connected')

  const usdcAmount = parseUnits(inputAmountStr, 6)
  const halfUsdc = usdcAmount / 2n
  const poolRemainingUsdc = usdcAmount - halfUsdc

  const counterToken = pool.tokens[1]
  const counterTokenAddress = (counterToken?.address || (pool.id === 'usdc-weth-pool' ? POOL_CONTRACTS.WETH : POOL_CONTRACTS.cirBTC)) as `0x${string}`
  const counterDecimals = counterToken?.decimals ?? (pool.id === 'usdc-cirbtc-pool' ? 8 : pool.id === 'usdc-weth-pool' ? 18 : 6)

  const [resA, resB] = await Promise.all([
    publicClient
      .readContract({
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'reserveA',
      })
      .catch(() => 0n),
    publicClient
      .readContract({
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'reserveB',
      })
      .catch(() => 0n),
  ])

  if (resA === 0n || resB === 0n) {
    throw new Error(
      `Cannot 1-Click Zap: The ${pool.name} currently has 0 reserves on Arc Testnet. 1-Click Zap requires existing pool liquidity to execute the 50/50 swap into ${counterToken?.symbol || 'counter token'}. Please supply both tokens via Dual-Asset Deposit or deposit single-sided USDC into the USDC Yield Vault.`
    )
  }

  const isConstantProduct = pool.id === 'usdc-cirbtc-pool' || pool.id === 'usdc-weth-pool' || pool.id === 'eurc-weth-pool' || pool.tags?.includes('Constant Product')
  const feeBps = pool.feeTierPercent ? BigInt(Math.round(pool.feeTierPercent * 100)) : (pool.id === 'usdc-weth-pool' || pool.id === 'eurc-weth-pool' ? 30n : pool.id === 'usdc-cirbtc-pool' ? 25n : 12n)
  const inAfterFee = (halfUsdc * (10000n - feeBps)) / 10000n
  let expectedOut = 0n
  if (isConstantProduct) {
    expectedOut = (resB * inAfterFee) / (resA + inAfterFee)
  } else {
    expectedOut = calculateStableSwapExpectedOut(halfUsdc, resA, resB, feeBps, STABLE_SWAP_AMP)
  }

  const slippageTolerance = typeof _slippage === 'number' && _slippage > 0 ? _slippage : 0.5
  const slippageBps = BigInt(poolSlippageBps(slippageTolerance))
  const minOut = expectedOut > 0n ? (expectedOut * (10000n - slippageBps)) / 10000n : 0n

  const smartAccount = getActiveSmartAccount()

  // 1. Modular Smart Account (Passkey)
  if (smartAccount) {
    const counterBalBefore = (await resilientReadContract(publicClient, {
      address: counterTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [targetAccount],
    })) as bigint

    const approveUsdcCall = {
      to: POOL_CONTRACTS.USDC as Hex,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [poolAddress as Hex, usdcAmount],
      }),
    }
    const swapCall = {
      to: poolAddress as Hex,
      data: encodeFunctionData({
        abi: STABLE_SWAP_ABI,
        functionName: 'swap',
        args: [POOL_CONTRACTS.USDC, counterTokenAddress, halfUsdc, minOut],
      }),
    }
    const swapRes = await sendModularUserOperation({
      calls: [approveUsdcCall, swapCall],
      paymaster: true,
    })
    if (!swapRes.success || !swapRes.txHash) {
      throw new Error(swapRes.error || 'Modular Zap swap failed.')
    }

    await waitForReceiptSafe(swapRes.txHash as Hex, 'Zap swap')
    const counterBalAfter = (await resilientReadContract(publicClient, {
      address: counterTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [targetAccount],
    })) as bigint

    const actualCounter = counterBalAfter > counterBalBefore ? counterBalAfter - counterBalBefore : 0n
    if (actualCounter === 0n) {
      throw new Error('Failed to receive counter token from AMM swap output.')
    }

    let freshPoolState = onchainPoolState
    try {
      const [freshReserveA, freshReserveB, freshTotalLp] = await Promise.all([
        resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }).catch(() => 0n),
        resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }).catch(() => 0n),
        resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }).catch(() => 0n),
      ])
      if ((freshTotalLp as bigint) > 0n) {
        freshPoolState = {
          ...(onchainPoolState || {}),
          [poolAddress]: {
            ...(onchainPoolState?.[poolAddress] || {}),
            reserveA: formatUnits(freshReserveA as bigint, 6),
            reserveB: formatUnits(freshReserveB as bigint, counterDecimals),
            totalLp: formatUnits(freshTotalLp as bigint, 18),
          },
        }
      }
    } catch (freshErr) {
      console.warn('[zapIn] Note: using cached reserves for minLpShares:', freshErr)
    }

    const minLpShares = computeMinLpShares(
      pool,
      poolAddress,
      freshPoolState,
      poolRemainingUsdc,
      actualCounter,
      counterDecimals,
      slippageTolerance
    )
    if (minLpShares <= 0n) {
      throw new Error('Unable to compute a safe minimum LP-shares guard from live pool reserves. Please refresh and retry so liquidity is added with slippage protection.')
    }
    const approveCounterCall = {
      to: counterTokenAddress as Hex,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [poolAddress as Hex, actualCounter],
      }),
    }
    const addLiquidityCall = {
      to: poolAddress as Hex,
      data: encodeFunctionData({
        abi: STABLE_SWAP_ABI,
        functionName: 'addLiquidity',
        args: [poolRemainingUsdc, actualCounter, minLpShares],
      }),
    }
    const addRes = await sendModularUserOperation({
      calls: [approveCounterCall, addLiquidityCall],
      paymaster: true,
    })
    if (!addRes.success || !addRes.txHash) {
      throw new Error(addRes.error || 'Modular Zap liquidity addition failed.')
    }

    const addReceipt = await waitForReceiptSafe(addRes.txHash as Hex, 'Modular Zap liquidity')
    let lpMintedRaw = 0n
    if (addReceipt?.logs) {
      for (const log of addReceipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: STABLE_SWAP_ABI,
            eventName: 'LiquidityAdded',
            data: log.data,
            topics: log.topics,
          })
          if (decoded?.args && (decoded.args as any).lpMinted) {
            lpMintedRaw = (decoded.args as any).lpMinted as bigint
            break
          }
        } catch (err) {
          poolsLog.debug('Receipt log could not be decoded as LiquidityAdded; using the estimated LP amount', err)
        }
      }
    }

    const lpMinted = lpMintedRaw > 0n ? formatUnits(lpMintedRaw, 18) : formatUnits(minLpShares, 18)
    const inputVal = parseFloat(inputAmountStr) || 0
    const st = onchainPoolState?.[poolAddress]
    const prevTotalLp = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
    const totalLpAfter = prevTotalLp + lpMintedRaw
    const poolShare = calculatePoolShare(lpMintedRaw, totalLpAfter)
    recordClientSwapVolume(pool.id, inputVal / 2)

    if (inputVal > 0) {
      queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
        if (!old) return old
        const oldUsdc = parseFloat(old.usdc || '0')
        return { ...old, usdc: Math.max(0, oldUsdc - inputVal).toFixed(2) }
      })
      queryClient.setQueryData<Record<string, UserPoolPosition>>(
        ['userPoolPositions', targetAccount],
        (old: any) => {
          if (!old) return old
          const curr = old[pool.id]
          const oldStaked = curr?.stakedUsd || 0
          const newStaked = oldStaked + inputVal
          return {
            ...old,
            [pool.id]: {
              ...(curr || {
                poolId: pool.id,
                earnedRewards: '0.00',
                earnedUsd: 0,
                poolSharePct: poolShare,
                lastUpdatedTimestamp: Date.now(),
              }),
              stakedAmount: newStaked.toFixed(2),
              stakedUsd: newStaked,
              lpTokenBalance: newStaked.toFixed(2),
              poolSharePct: poolShare,
            },
          }
        }
      )
    }

    await invalidatePoolCaches()
    return { txHash: addRes.txHash, lpMinted, poolShare }
  }

  // 2. Circle UCW Execution
  if (authSource === 'ucw' && executeUcwContract) {
    console.log('[usePoolsData UCW] Executing Zap In on ARC-TESTNET...')

    await approveToken(POOL_CONTRACTS.USDC, poolAddress, usdcAmount)

    const counterBalBefore = (await resilientReadContract(publicClient, {
      address: counterTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [targetAccount],
    })) as bigint

    console.log('[usePoolsData UCW] Requesting swap challenge for Zap...')
    const swapRes = await executeUcwContract({
      contractAddress: poolAddress,
      abiFunctionSignature: 'swap(address,address,uint256,uint256)',
      abiParameters: [POOL_CONTRACTS.USDC, counterTokenAddress, halfUsdc.toString(), minOut.toString()],
      blockchain: 'ARC-TESTNET',
    })
    if (!swapRes.success) {
      const isCanceled =
        swapRes.error?.toLowerCase().includes('cancel') ||
        swapRes.error?.toLowerCase().includes('iptal') ||
        swapRes.error?.toLowerCase().includes('closed')
      const err: any = new Error(swapRes.error || 'Zap swap authorization failed.')
      if (isCanceled) (err as any).isCanceled = true
      throw err
    }

    if (swapRes.txHash && swapRes.txHash.startsWith('0x')) {
      await waitForReceiptSafe(swapRes.txHash as Hex, 'Zap swap')
    }

    const counterBalAfter = (await resilientReadContract(publicClient, {
      address: counterTokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [targetAccount],
    })) as bigint

    const actualCounterAmount = counterBalAfter > counterBalBefore ? counterBalAfter - counterBalBefore : 0n
    if (actualCounterAmount === 0n) {
      throw new Error('Failed to receive counter token from AMM swap output.')
    }

    let freshPoolState = onchainPoolState
    try {
      const [freshReserveA, freshReserveB, freshTotalLp] = await Promise.all([
        resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }).catch(() => 0n),
        resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }).catch(() => 0n),
        resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }).catch(() => 0n),
      ])
      if ((freshTotalLp as bigint) > 0n) {
        freshPoolState = {
          ...(onchainPoolState || {}),
          [poolAddress]: {
            ...(onchainPoolState?.[poolAddress] || {}),
            reserveA: formatUnits(freshReserveA as bigint, 6),
            reserveB: formatUnits(freshReserveB as bigint, counterDecimals),
            totalLp: formatUnits(freshTotalLp as bigint, 18),
          },
        }
      }
    } catch (freshErr) {
      console.warn('[zapIn UCW] Note: using cached reserves for minLpShares:', freshErr)
    }

    await approveToken(POOL_CONTRACTS.USDC, poolAddress, poolRemainingUsdc)
    await approveToken(counterTokenAddress, poolAddress, actualCounterAmount)

    const minLpShares = computeMinLpShares(
      pool,
      poolAddress,
      freshPoolState,
      poolRemainingUsdc,
      actualCounterAmount,
      counterDecimals,
      slippageTolerance
    )
    if (minLpShares <= 0n) {
      throw new Error('Unable to compute a safe minimum LP-shares guard from live pool reserves. Please refresh and retry so liquidity is added with slippage protection.')
    }

    console.log('[usePoolsData UCW] Requesting addLiquidity challenge for Zap...')
    const addRes = await executeUcwContract({
      contractAddress: poolAddress,
      abiFunctionSignature: 'addLiquidity(uint256,uint256,uint256)',
      abiParameters: [poolRemainingUsdc.toString(), actualCounterAmount.toString(), minLpShares.toString()],
      blockchain: 'ARC-TESTNET',
    })
    if (!addRes.success) {
      const isCanceled =
        addRes.error?.toLowerCase().includes('cancel') ||
        addRes.error?.toLowerCase().includes('iptal') ||
        addRes.error?.toLowerCase().includes('closed')
      const err: any = new Error(addRes.error || 'Zap addLiquidity authorization failed.')
      if (isCanceled) (err as any).isCanceled = true
      throw err
    }

    const txHash = (addRes.txHash || '') as Hex
    let lpMintedRaw = 0n
    if (txHash && txHash.startsWith('0x')) {
      const addReceipt = await waitForReceiptSafe(txHash, 'Zap addLiquidity')
      if (addReceipt?.logs) {
        for (const log of addReceipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: STABLE_SWAP_ABI,
              eventName: 'LiquidityAdded',
              data: log.data,
              topics: log.topics,
            })
            if (decoded?.args && (decoded.args as any).lpMinted) {
              lpMintedRaw = (decoded.args as any).lpMinted as bigint
              break
            }
          } catch (err) {
            poolsLog.debug('Receipt log could not be decoded as LiquidityAdded; using the estimated LP amount', err)
          }
        }
      }
    }

    const lpMinted = lpMintedRaw > 0n ? formatUnits(lpMintedRaw, 18) : formatUnits(minLpShares, 18)
    const inputVal = parseFloat(inputAmountStr) || 0
    const st = onchainPoolState?.[poolAddress]
    const prevTotalLp = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
    const totalLpAfter = prevTotalLp + lpMintedRaw
    const poolShare = calculatePoolShare(lpMintedRaw, totalLpAfter)
    recordClientSwapVolume(pool.id, inputVal / 2)

    if (inputVal > 0) {
      queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
        if (!old) return old
        const oldUsdc = parseFloat(old.usdc || '0')
        return { ...old, usdc: Math.max(0, oldUsdc - inputVal).toFixed(2) }
      })
      queryClient.setQueryData<Record<string, UserPoolPosition>>(
        ['userPoolPositions', targetAccount],
        (old: any) => {
          if (!old) return old
          const curr = old[pool.id]
          const oldStaked = curr?.stakedUsd || 0
          const newStaked = oldStaked + inputVal
          return {
            ...old,
            [pool.id]: {
              ...(curr || {
                poolId: pool.id,
                earnedRewards: '0.00',
                earnedUsd: 0,
                poolSharePct: poolShare,
                lastUpdatedTimestamp: Date.now(),
              }),
              stakedAmount: newStaked.toFixed(2),
              stakedUsd: newStaked,
              lpTokenBalance: newStaked.toFixed(2),
              poolSharePct: poolShare,
            },
          }
        }
      )
    }

    await invalidatePoolCaches()
    return { txHash, lpMinted, poolShare }
  }

  // 3. EOA Provider
  const walletClient = await getWalletClient()
  if (!walletClient) throw new Error('Wallet not connected')

  await approveToken(POOL_CONTRACTS.USDC, poolAddress, usdcAmount)

  const counterBalBefore = (await resilientReadContract(publicClient, {
    address: counterTokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [targetAccount],
  })) as bigint

  const swapGasLimit = await estimateSafeGas(
    publicClient,
    {
      address: poolAddress,
      abi: STABLE_SWAP_ABI,
      functionName: 'swap',
      args: [POOL_CONTRACTS.USDC, counterTokenAddress, halfUsdc, minOut],
      account: targetAccount,
    },
    350_000n
  )

  const swapOut = await resilientWriteContract(walletClient, {
    address: poolAddress,
    abi: STABLE_SWAP_ABI,
    functionName: 'swap',
    args: [POOL_CONTRACTS.USDC, counterTokenAddress, halfUsdc, minOut],
    account: targetAccount,
    chain: arcTestnet,
    gas: swapGasLimit,
  })
  await waitForReceiptSafe(swapOut, 'Zap Swap')

  const counterBalAfter = (await resilientReadContract(publicClient, {
    address: counterTokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [targetAccount],
  })) as bigint

  const actualCounterAmount = counterBalAfter > counterBalBefore ? counterBalAfter - counterBalBefore : 0n
  if (actualCounterAmount === 0n) {
    throw new Error('Failed to receive counter token from AMM swap output.')
  }

  let freshPoolState = onchainPoolState
  try {
    const [freshReserveA, freshReserveB, freshTotalLp] = await Promise.all([
      resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }).catch(() => 0n),
      resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }).catch(() => 0n),
      resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }).catch(() => 0n),
    ])
    if ((freshTotalLp as bigint) > 0n) {
      freshPoolState = {
        ...(onchainPoolState || {}),
        [poolAddress]: {
          ...(onchainPoolState?.[poolAddress] || {}),
          reserveA: formatUnits(freshReserveA as bigint, 6),
          reserveB: formatUnits(freshReserveB as bigint, counterDecimals),
          totalLp: formatUnits(freshTotalLp as bigint, 18),
        },
      }
    }
  } catch (freshErr) {
    console.warn('[zapIn] Note: using cached reserves for minLpShares:', freshErr)
  }

  await approveToken(POOL_CONTRACTS.USDC, poolAddress, poolRemainingUsdc)
  await approveToken(counterTokenAddress, poolAddress, actualCounterAmount)

  const minLpShares = computeMinLpShares(
    pool,
    poolAddress,
    freshPoolState,
    poolRemainingUsdc,
    actualCounterAmount,
    counterDecimals,
    slippageTolerance
  )
  if (minLpShares <= 0n) {
    throw new Error('Unable to compute a safe minimum LP-shares guard from live pool reserves. Please refresh and retry so liquidity is added with slippage protection.')
  }

  let txHash: Hex
  try {
    const addLiqGasLimit = await estimateSafeGas(
      publicClient,
      {
        address: poolAddress,
        abi: STABLE_SWAP_ABI,
        functionName: 'addLiquidity',
        args: [poolRemainingUsdc, actualCounterAmount, minLpShares],
        account: targetAccount,
      },
      450_000n
    )

    txHash = await resilientWriteContract(walletClient, {
      address: poolAddress,
      abi: STABLE_SWAP_ABI,
      functionName: 'addLiquidity',
      args: [poolRemainingUsdc, actualCounterAmount, minLpShares],
      account: targetAccount,
      chain: arcTestnet,
      gas: addLiqGasLimit,
    })
  } catch (addLiqErr: any) {
    console.error('[zapIn] Liquidity addition failed after swap:', addLiqErr)
    const counterSymbol = counterToken?.symbol || 'counter tokens'
    const counterFormatted = formatUnits(actualCounterAmount, counterDecimals)
    throw new Error(
      `Zap swap completed successfully (${counterFormatted} ${counterSymbol} added to wallet), but liquidity addition failed: ${addLiqErr?.shortMessage || addLiqErr?.message || 'Transaction reverted'
      }. Your ${counterSymbol} is safe in your wallet; you can provide dual liquidity or swap back to USDC.`
    )
  }
  const receipt = await waitForReceiptSafe(txHash, 'Add liquidity')

  let lpMintedRaw = 0n
  if (receipt?.logs) {
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: STABLE_SWAP_ABI,
          eventName: 'LiquidityAdded',
          data: log.data,
          topics: log.topics,
        })
        if (decoded?.args && (decoded.args as any).lpMinted) {
          lpMintedRaw = (decoded.args as any).lpMinted as bigint
          break
        }
      } catch (err) {
        poolsLog.debug('Receipt log could not be decoded as LiquidityAdded; using the estimated LP amount', err)
      }
    }
  }

  const lpMinted = lpMintedRaw > 0n ? formatUnits(lpMintedRaw, 18) : formatUnits(minLpShares, 18)
  const inputVal = parseFloat(inputAmountStr) || 0
  const st = onchainPoolState?.[poolAddress]
  const prevTotalLp = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
  const totalLpAfter = prevTotalLp + lpMintedRaw
  const poolShare = calculatePoolShare(lpMintedRaw, totalLpAfter)
  recordClientSwapVolume(pool.id, inputVal / 2)

  if (inputVal > 0) {
    queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
      if (!old) return old
      const oldUsdc = parseFloat(old.usdc || '0')
      return { ...old, usdc: Math.max(0, oldUsdc - inputVal).toFixed(2) }
    })
    queryClient.setQueryData<Record<string, UserPoolPosition>>(
      ['userPoolPositions', targetAccount],
      (old: any) => {
        if (!old) return old
        const curr = old[pool.id]
        const oldStaked = curr?.stakedUsd || 0
        const newStaked = oldStaked + inputVal
        return {
          ...old,
          [pool.id]: {
            ...(curr || {
              poolId: pool.id,
              earnedRewards: '0.00',
              earnedUsd: 0,
              poolSharePct: poolShare,
              lastUpdatedTimestamp: Date.now(),
            }),
            stakedAmount: newStaked.toFixed(2),
            stakedUsd: newStaked,
            lpTokenBalance: newStaked.toFixed(2),
            poolSharePct: poolShare,
          },
        }
      }
    )
  }

  await invalidatePoolCaches()
  return { txHash, lpMinted, poolShare }
}

/**
 * Dual-asset deposit (USDC + counter token)
 */
export async function executeDepositDual(
  ctx: PoolExecutionContext,
  poolId: string,
  amountAStr: string,
  amountBStr: string,
  _slippage: number = 0.5
): Promise<{ txHash: string; lpMinted: string; poolShare: number }> {
  const {
    walletAddress,
    authSource,
    executeUcwContract,
    publicClient,
    queryClient,
    getWalletClient,
    approveToken,
    waitForReceiptSafe,
    invalidatePoolCaches,
    onchainPoolState,
    poolsWithUserStats,
    livePrices,
  } = ctx

  const livePool = poolsWithUserStats.find((p: any) => p.id === poolId)
  const pool = livePool || ARCIS_POOLS.find((p) => p.id === poolId)
  if (!pool || !pool.isLpPool) throw new Error('Pool is not an LP pool')

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

  const tokenA = pool.tokens[0]
  const tokenAAddress = (tokenA?.address || (poolId === 'eurc-weth-pool' ? POOL_CONTRACTS.EURC : POOL_CONTRACTS.USDC)) as `0x${string}`
  const counterToken = pool.tokens[1]
  const counterDecimals = counterToken?.decimals ?? (pool.id === 'usdc-cirbtc-pool' ? 8 : (pool.id === 'usdc-weth-pool' || pool.id === 'eurc-weth-pool') ? 18 : 6)
  const amountA = parseUnits(amountAStr, 6)
  const amountB = parseUnits(amountBStr, counterDecimals)
  const counterTokenAddress = (counterToken?.address || (pool.id === 'usdc-weth-pool' || pool.id === 'eurc-weth-pool' ? POOL_CONTRACTS.WETH : POOL_CONTRACTS.cirBTC)) as `0x${string}`

  let freshPoolState = onchainPoolState
  try {
    const [freshReserveA, freshReserveB, freshTotalLp] = await Promise.all([
      resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }).catch(() => 0n),
      resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }).catch(() => 0n),
      resilientReadContract(publicClient, { address: poolAddress, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }).catch(() => 0n),
    ])
    if ((freshTotalLp as bigint) > 0n) {
      freshPoolState = {
        ...(onchainPoolState || {}),
        [poolAddress]: {
          ...(onchainPoolState?.[poolAddress] || {}),
          reserveA: formatUnits(freshReserveA as bigint, 6),
          reserveB: formatUnits(freshReserveB as bigint, counterDecimals),
          totalLp: formatUnits(freshTotalLp as bigint, 18),
        },
      }
    }
  } catch (freshErr) {
    console.warn('[depositDual] Note: using cached reserves for minLpShares:', freshErr)
  }

  const minLpShares = computeMinLpShares(pool, poolAddress, freshPoolState, amountA, amountB, counterDecimals, _slippage)
  const previewTotalLpRaw = freshPoolState?.[poolAddress]?.totalLp ? parseUnits(freshPoolState[poolAddress].totalLp, 18) : 0n
  if (minLpShares <= 0n && previewTotalLpRaw > 0n) {
    throw new Error('Unable to compute a safe minimum LP-shares guard from live pool reserves. Please refresh and retry so liquidity is added with slippage protection.')
  }

  {
    const stNow = (freshPoolState || {})[poolAddress] as any
    const reserveANum = parseFloat(stNow?.reserveA || '0') || 0
    const reserveBNum = parseFloat(stNow?.reserveB || '0') || 0
    const totalLpNum = parseFloat(stNow?.totalLp || '0') || 0
    if (reserveANum > 0 && reserveBNum > 0 && totalLpNum > 0) {
      const balance = analyzeDualDepositBalance({
        poolId,
        amountA: parseFloat(amountAStr) || 0,
        amountB: parseFloat(amountBStr) || 0,
        reserveA: reserveANum,
        reserveB: reserveBNum,
        totalLp: totalLpNum,
        amp: STABLE_SWAP_AMP,
      })
      if (balance && balance.donationPct > DUAL_DEPOSIT_DONATION_BLOCK_PCT) {
        throw new Error(
          `Unbalanced deposit: about ${balance.donationValueA.toFixed(2)} USDC of excess would be donated to existing LPs instead of minting LP shares. Please rebalance the amounts to the pool ratio and retry.`
        )
      }
    }
  }
  const addLiquidityArgs = [amountA, amountB, minLpShares] as const

  const { eurc: liveEurcPrice, btc: liveBtcPrice, weth: liveWethPrice } = livePrices
  const tokenAUsdPrice = (poolId === 'eurc-weth-pool' || pool.tokens[0]?.symbol === 'EURC') ? liveEurcPrice : 1.0
  const counterUsdPrice = poolId === 'usdc-eurc-stable-pool' ? liveEurcPrice : liveBtcPrice
  const effectiveCounterUsdPrice = (poolId === 'usdc-weth-pool' || poolId === 'eurc-weth-pool') ? liveWethPrice : counterUsdPrice
  const totalUsdAdded = (parseFloat(amountAStr) || 0) * tokenAUsdPrice + (parseFloat(amountBStr) || 0) * effectiveCounterUsdPrice

  // 1. Modular Smart Account
  const smartAccount = getActiveSmartAccount()
  if (smartAccount) {
    const approveCallA = {
      to: tokenAAddress as Hex,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [poolAddress as Hex, amountA],
      }),
    }
    const approveCallB = {
      to: counterTokenAddress as Hex,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [poolAddress as Hex, amountB],
      }),
    }
    const addLiquidityCall = {
      to: poolAddress as Hex,
      data: encodeFunctionData({
        abi: STABLE_SWAP_ABI,
        functionName: 'addLiquidity',
        args: addLiquidityArgs,
      }),
    }
    const opRes = await sendModularUserOperation({
      calls: [approveCallA, approveCallB, addLiquidityCall],
      paymaster: true,
    })
    if (!opRes.success || !opRes.txHash) {
      throw new Error(opRes.error || 'Modular UserOperation dual liquidity failed.')
    }

    const opReceipt = await waitForReceiptSafe(opRes.txHash as Hex, 'Modular Dual Liquidity')
    let lpMintedRaw = 0n
    if (opReceipt?.logs) {
      for (const log of opReceipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: STABLE_SWAP_ABI,
            eventName: 'LiquidityAdded',
            data: log.data,
            topics: log.topics,
          })
          if (decoded?.args && (decoded.args as any).lpMinted) {
            lpMintedRaw = (decoded.args as any).lpMinted as bigint
            break
          }
        } catch (err) {
          poolsLog.debug('Receipt log could not be decoded as LiquidityAdded; using the estimated LP amount', err)
        }
      }
    }

    const lpMinted = lpMintedRaw > 0n ? formatUnits(lpMintedRaw, 18) : formatUnits(minLpShares, 18)
    const st = onchainPoolState?.[poolAddress]
    const prevTotalLp = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
    const totalLpAfter = prevTotalLp + lpMintedRaw
    const poolShare = calculatePoolShare(lpMintedRaw, totalLpAfter)

    const decA = parseFloat(amountAStr) || 0
    if (totalUsdAdded > 0) {
      const isTokenAEurc = pool.id === 'eurc-weth-pool' || pool.tokens[0]?.symbol === 'EURC'
      queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
        if (!old) return old
        if (isTokenAEurc) {
          const oldEurc = parseFloat(old.eurc || '0')
          return { ...old, eurc: Math.max(0, oldEurc - decA).toFixed(2) }
        }
        const oldUsdc = parseFloat(old.usdc || '0')
        return { ...old, usdc: Math.max(0, oldUsdc - decA).toFixed(2) }
      })
      queryClient.setQueryData<Record<string, UserPoolPosition>>(
        ['userPoolPositions', targetAccount],
        (old: any) => {
          if (!old) return old
          const curr = old[pool.id]
          const oldStaked = curr?.stakedUsd || 0
          const newStaked = oldStaked + totalUsdAdded
          return {
            ...old,
            [pool.id]: {
              ...(curr || {
                poolId: pool.id,
                earnedRewards: '0.00',
                earnedUsd: 0,
                poolSharePct: poolShare,
                lastUpdatedTimestamp: Date.now(),
              }),
              stakedAmount: newStaked.toFixed(2),
              stakedUsd: newStaked,
              lpTokenBalance: newStaked.toFixed(2),
              poolSharePct: poolShare,
            },
          }
        }
      )
    }

    await invalidatePoolCaches()
    return { txHash: opRes.txHash, lpMinted, poolShare }
  }

  // 2. Circle UCW Execution
  if (authSource === 'ucw' && executeUcwContract) {
    console.log('[usePoolsData UCW] Providing dual liquidity on ARC-TESTNET...')

    await approveToken(tokenAAddress, poolAddress, amountA)
    await approveToken(counterTokenAddress, poolAddress, amountB)

    console.log('[usePoolsData UCW] Requesting addLiquidity challenge on ARC-TESTNET...')
    const addLiqRes = await executeUcwContract({
      contractAddress: poolAddress,
      abiFunctionSignature: 'addLiquidity(uint256,uint256,uint256)',
      abiParameters: [amountA.toString(), amountB.toString(), minLpShares.toString()],
      blockchain: 'ARC-TESTNET',
    })

    if (!addLiqRes.success) {
      const isCanceled =
        addLiqRes.error?.toLowerCase().includes('cancel') ||
        addLiqRes.error?.toLowerCase().includes('iptal') ||
        addLiqRes.error?.toLowerCase().includes('closed')
      const err: any = new Error(addLiqRes.error || 'Dual liquidity authorization failed.')
      if (isCanceled) (err as any).isCanceled = true
      throw err
    }

    const txHash = (addLiqRes.txHash || '') as Hex
    let lpMintedRaw = 0n
    if (txHash && txHash.startsWith('0x')) {
      const receipt = await waitForReceiptSafe(txHash, 'Add dual liquidity')
      if (receipt?.logs) {
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: STABLE_SWAP_ABI,
              eventName: 'LiquidityAdded',
              data: log.data,
              topics: log.topics,
            })
            if (decoded?.args && (decoded.args as any).lpMinted) {
              lpMintedRaw = (decoded.args as any).lpMinted as bigint
              break
            }
          } catch (err) {
            poolsLog.debug('Receipt log could not be decoded as LiquidityAdded; using the estimated LP amount', err)
          }
        }
      }
    }

    const lpMinted = lpMintedRaw > 0n ? formatUnits(lpMintedRaw, 18) : formatUnits(minLpShares, 18)
    const st = onchainPoolState?.[poolAddress]
    const prevTotalLp = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
    const totalLpAfter = prevTotalLp + lpMintedRaw
    const poolShare = calculatePoolShare(lpMintedRaw, totalLpAfter)

    const decA = parseFloat(amountAStr) || 0
    if (totalUsdAdded > 0) {
      const isTokenAEurc = pool.id === 'eurc-weth-pool' || pool.tokens[0]?.symbol === 'EURC'
      queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
        if (!old) return old
        if (isTokenAEurc) {
          const oldEurc = parseFloat(old.eurc || '0')
          return { ...old, eurc: Math.max(0, oldEurc - decA).toFixed(2) }
        }
        const oldUsdc = parseFloat(old.usdc || '0')
        return { ...old, usdc: Math.max(0, oldUsdc - decA).toFixed(2) }
      })
      queryClient.setQueryData<Record<string, UserPoolPosition>>(
        ['userPoolPositions', targetAccount],
        (old: any) => {
          if (!old) return old
          const curr = old[pool.id]
          const oldStaked = curr?.stakedUsd || 0
          const newStaked = oldStaked + totalUsdAdded
          return {
            ...old,
            [pool.id]: {
              ...(curr || {
                poolId: pool.id,
                earnedRewards: '0.00',
                earnedUsd: 0,
                poolSharePct: poolShare,
                lastUpdatedTimestamp: Date.now(),
              }),
              stakedAmount: newStaked.toFixed(2),
              stakedUsd: newStaked,
              lpTokenBalance: newStaked.toFixed(2),
              poolSharePct: poolShare,
            },
          }
        }
      )
    }

    await invalidatePoolCaches()
    return { txHash, lpMinted, poolShare }
  }

  // 3. EOA Provider
  const walletClient = await getWalletClient()
  if (!walletClient) throw new Error('Wallet not connected')

  await approveToken(tokenAAddress, poolAddress, amountA)
  await approveToken(counterTokenAddress, poolAddress, amountB)

  const gasLimit = await estimateSafeGas(
    publicClient,
    {
      address: poolAddress,
      abi: STABLE_SWAP_ABI,
      functionName: 'addLiquidity',
      args: addLiquidityArgs,
      account: targetAccount,
    },
    450_000n
  )

  const txHash = await resilientWriteContract(walletClient, {
    address: poolAddress,
    abi: STABLE_SWAP_ABI,
    functionName: 'addLiquidity',
    args: addLiquidityArgs,
    account: targetAccount,
    chain: arcTestnet,
    gas: gasLimit,
  })
  const receipt = await waitForReceiptSafe(txHash, 'Add dual liquidity')

  let lpMintedRaw = 0n
  if (receipt?.logs) {
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: STABLE_SWAP_ABI,
          eventName: 'LiquidityAdded',
          data: log.data,
          topics: log.topics,
        })
        if (decoded?.args && (decoded.args as any).lpMinted) {
          lpMintedRaw = (decoded.args as any).lpMinted as bigint
          break
        }
      } catch (err) {
        poolsLog.debug('Receipt log could not be decoded as LiquidityAdded; using the estimated LP amount', err)
      }
    }
  }

  const lpMinted = lpMintedRaw > 0n ? formatUnits(lpMintedRaw, 18) : formatUnits(minLpShares, 18)
  const st = onchainPoolState?.[poolAddress]
  const prevTotalLp = st?.totalLp ? parseUnits(st.totalLp, 18) : 0n
  const totalLpAfter = prevTotalLp + lpMintedRaw
  const poolShare = calculatePoolShare(lpMintedRaw, totalLpAfter)

  const decA = parseFloat(amountAStr) || 0
  if (totalUsdAdded > 0) {
    const isTokenAEurc = pool.id === 'eurc-weth-pool' || pool.tokens[0]?.symbol === 'EURC'
    queryClient.setQueryData<any>(['onchainPoolBalances', targetAccount], (old: any) => {
      if (!old) return old
      if (isTokenAEurc) {
        const oldEurc = parseFloat(old.eurc || '0')
        return { ...old, eurc: Math.max(0, oldEurc - decA).toFixed(2) }
      }
      const oldUsdc = parseFloat(old.usdc || '0')
      return { ...old, usdc: Math.max(0, oldUsdc - decA).toFixed(2) }
    })
    queryClient.setQueryData<Record<string, UserPoolPosition>>(
      ['userPoolPositions', targetAccount],
      (old: any) => {
        if (!old) return old
        const curr = old[pool.id]
        const oldStaked = curr?.stakedUsd || 0
        const newStaked = oldStaked + totalUsdAdded
        return {
          ...old,
          [pool.id]: {
            ...(curr || {
              poolId: pool.id,
              earnedRewards: '0.00',
              earnedUsd: 0,
              poolSharePct: poolShare,
              lastUpdatedTimestamp: Date.now(),
            }),
            stakedAmount: newStaked.toFixed(2),
            stakedUsd: newStaked,
            lpTokenBalance: newStaked.toFixed(2),
            poolSharePct: poolShare,
          },
        }
      }
    )
  }

  await invalidatePoolCaches()
  return { txHash, lpMinted, poolShare }
}
