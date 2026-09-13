// Master Pools & Yield Hub view for Arcis.
// Combines USYC RWA Vault, Circle Gateway Cross-Chain Settlement Vault,
// Arcis Real-Yield Staking, DEX Liquidity Pools,
// 1-Click Zap, and live Arc Testnet state.
import { useState, useMemo, useRef, useEffect } from 'react'
import {
  Search,
  SlidersHorizontal,
  RefreshCw,
  TrendingUp,
  Layers,
  ShieldCheck,
  ChevronDown,
  Check,
  BarChart3,
  Wallet,
} from 'lucide-react'
import PoolsHeroStats from './PoolsHeroStats'
import PoolCard from './PoolCard'
import PoolActionModal from './PoolActionModal'
import YieldCalculator from './YieldCalculator'
import { usePoolsData } from '../../hooks/usePoolsData'
import { useGatewayBalance } from '../../hooks/useGatewayBalance'
import { type PoolCategory, type PoolConfig, POOLS_CHAIN_DEFS } from '../../config/poolsConfig'
import { arcTestnet } from '../../config/arcChain'
import { transferFromGateway } from '../../services/gatewayService'
import { useBroadcast, TOKEN_ICON_MAP, type BroadcastType } from '../BroadcastNotification'
import { isUserCanceled, formatWalletError } from '../../utils/errorUtils'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'

interface PoolsTabProps {
  walletAddress: string
  walletConnected: boolean
  provider?: any
  addToast?: (
    title: string,
    description: string,
    type?: 'info' | 'success' | 'warning' | 'error' | 'pending',
    txHash?: string,
    network?: string
  ) => string
  removeToast?: (id: string) => void
}

export default function PoolsTab({
  walletAddress,
  walletConnected,
  provider,
  addToast,
  removeToast,
}: PoolsTabProps) {
  const {
    pools,
    onchainBalances,
    isBalancesLoading,
    totalTvlUsd,
    localTvlUsd,
    gatewayTvlUsd,
    userTotalDepositedUsd,
    userTotalClaimableRewardsUsd,
    dailyYieldGeneratedUsd,
    depositToPool,
    zapIn,
    depositDual,
    withdrawFromPool,
    swapInPool,
    claimPoolRewards,
    claimAllRewards,
    refreshBalances,
  } = usePoolsData(walletAddress, provider)

  // Gateway unified balance (for cross-chain zap)
  const { totalBalance: gatewayTotalBalance, refresh: refreshGatewayBalance } = useGatewayBalance(walletAddress)

  // Filter & Search states
  const [activeCategory, setActiveCategory] = useState<PoolCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [sortBy, setSortBy] = useState<'apy' | 'volume' | 'tvl' | 'risk' | 'positions'>('apy')
  const [showSortDropdown, setShowSortDropdown] = useState<boolean>(false)
  const sortDropdownRef = useRef<HTMLDivElement>(null)

  // Sort options config
  const sortOptions = [
    { id: 'apy' as const, label: 'Highest APY', icon: TrendingUp },
    { id: 'volume' as const, label: 'Highest 24H Volume', icon: BarChart3 },
    { id: 'tvl' as const, label: 'Highest TVL', icon: Layers },
    { id: 'risk' as const, label: 'Lowest Risk', icon: ShieldCheck },
    { id: 'positions' as const, label: 'My Positions', icon: Wallet },
  ]

  // Close sort dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target as Node)) {
        setShowSortDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Modal states
  const [selectedPoolForAction, setSelectedPoolForAction] = useState<PoolConfig | null>(null)
  const [actionModalMode, setActionModalMode] = useState<'deposit' | 'withdraw' | 'swap'>('deposit')
  const [isActionModalOpen, setIsActionModalOpen] = useState<boolean>(false)
  const [isCalculatorOpen, setIsCalculatorOpen] = useState<boolean>(false)
  const [isClaiming, setIsClaiming] = useState<boolean>(false)
  const [claimingPoolId, setClaimingPoolId] = useState<string | null>(null)
  const [isManualRefreshing, setIsManualRefreshing] = useState<boolean>(false)

  // Filter categories list (native Arc DeFi products)
  const categories: { id: PoolCategory | 'all'; label: string; count?: number }[] = [
    { id: 'all', label: 'All Pools' },
    { id: 'liquidity', label: 'Liquidity' },
    { id: 'vault', label: 'Vaults' },
  ]

  // Filtered and sorted pools
  const filteredPools = useMemo(() => {
    return pools
      .filter((p) => {
        // Category match
        if (activeCategory !== 'all' && p.category !== activeCategory) return false
        // Search query match
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase()
          const matchesName = p.name.toLowerCase().includes(q)
          const matchesSubtitle = p.subtitle.toLowerCase().includes(q)
          const matchesTag = p.tags.some((t: string) => t.toLowerCase().includes(q))
          if (!matchesName && !matchesSubtitle && !matchesTag) return false
        }
        return true
      })
      .sort((a, b) => {
        if (sortBy === 'apy') return b.apy - a.apy
        if (sortBy === 'volume') return (b.volume24hUsd || 0) - (a.volume24hUsd || 0)
        if (sortBy === 'tvl') return b.tvlUsd - a.tvlUsd
        if (sortBy === 'risk') {
          const riskWeight: Record<string, number> = { Safe: 1, Low: 2, Medium: 3 }
          const weightA = riskWeight[a.riskLevel] || 2
          const weightB = riskWeight[b.riskLevel] || 2
          if (weightA !== weightB) return weightA - weightB
          return b.tvlUsd - a.tvlUsd
        }
        if (sortBy === 'positions') {
          const aStaked = parseFloat(a.userPosition?.stakedAmount || '0')
          const bStaked = parseFloat(b.userPosition?.stakedAmount || '0')
          return bStaked - aStaked
        }
        return 0
      })
  }, [pools, activeCategory, searchQuery, sortBy])

  // Handlers for PoolCard actions
  const handleOpenDeposit = (pool: PoolConfig) => {
    setSelectedPoolForAction(pool)
    setActionModalMode('deposit')
    setIsActionModalOpen(true)
  }

  const handleOpenWithdraw = (pool: PoolConfig) => {
    setSelectedPoolForAction(pool)
    setActionModalMode('withdraw')
    setIsActionModalOpen(true)
  }

  const { addBroadcast, updateBroadcast } = useBroadcast()

  // Unified notifier helper: Emits both Broadcast Notification & optional Toast
  const notifyPending = (
    title: string,
    message: string,
    details?: any,
    type: BroadcastType = 'pool'
  ) => {
    const broadcastId = addBroadcast({
      type,
      title,
      status: 'pending',
      badgeText: 'Pending',
      message,
      details,
    })
    const toastId = addToast ? addToast(title, message, 'pending') : undefined
    return { broadcastId, toastId, type }
  }

  const notifySuccess = (
    ids: { broadcastId: string; toastId?: string; type?: BroadcastType },
    title: string,
    message: string,
    txHash?: string,
    details?: any
  ) => {
    if (ids.toastId && removeToast) removeToast(ids.toastId)
    if (addToast) addToast(title, message, 'success', txHash, 'Arc Testnet')
    updateBroadcast(ids.broadcastId, {
      type: ids.type || 'pool',
      status: 'success',
      title,
      badgeText: 'Confirmed',
      message,
      details: { ...details, txHash, network: details?.network || 'Arc_Testnet' },
    })
  }

  const notifyError = (
    ids: { broadcastId: string; toastId?: string; type?: BroadcastType },
    defaultTitle: string,
    err: any,
    details?: any
  ) => {
    if (ids.toastId && removeToast) removeToast(ids.toastId)
    const isCanceled = isUserCanceled(err) || err?.isCanceled === true
    const title = isCanceled ? 'Transaction Canceled' : defaultTitle
    const message = isCanceled
      ? 'You canceled the confirmation request in your wallet. No balance was deducted.'
      : (formatWalletError(err) || err?.shortMessage || err?.message || 'Transaction failed on Arc Testnet')

    if (addToast) addToast(title, message, isCanceled ? 'warning' : 'error')
    updateBroadcast(ids.broadcastId, {
      type: ids.type || 'pool',
      status: isCanceled ? 'canceled' : 'failed',
      title,
      badgeText: isCanceled ? 'Canceled' : 'Failed',
      message,
      details,
    })
  }

  const handleClaimAll = async () => {
    if (userTotalClaimableRewardsUsd < 0.01) {
      if (addToast) {
        addToast(
          'No Claimable Yield',
          'You have no accrued yield to claim at this time (minimum 0.01 USDC).',
          'info',
          undefined,
          'Arc Testnet'
        )
      }
      return
    }

    setIsClaiming(true)
    const notif = notifyPending(
      'Claiming All Yield...',
      `Redeeming ${userTotalClaimableRewardsUsd.toFixed(2)} USDC in accumulated profit across your pools`,
      {
        amount: userTotalClaimableRewardsUsd.toFixed(2),
        tokenSymbol: 'USDC',
        tokenIcon: UsdcIcon,
        network: 'Arc_Testnet',
      },
      'pool'
    )

    try {
      const res = await claimAllRewards()
      if (res.failedPools && res.failedPools.length > 0) {
        if (res.successfulPools && res.successfulPools.length > 0) {
          notifySuccess(
            notif,
            'Partial Yield Claimed',
            `Claimed ${res.totalClaimed} USDC from ${res.successfulPools.join(', ')}. Note: Claim failed for ${res.failedPools.join(', ')}.`,
            res.txHash,
            {
              amount: res.totalClaimed,
              tokenSymbol: 'USDC',
              tokenIcon: UsdcIcon,
              network: 'Arc_Testnet',
            }
          )
        } else {
          notifyError(notif, 'Claim Failed', new Error(`Claim failed for: ${res.failedPools.join(', ')}`), {
            amount: userTotalClaimableRewardsUsd.toFixed(2),
            tokenSymbol: 'USDC',
            tokenIcon: UsdcIcon,
            network: 'Arc_Testnet',
          })
        }
      } else {
        notifySuccess(
          notif,
          'Yield Claimed Successfully!',
          `Successfully claimed ${res.totalClaimed} USDC across ${res.successfulPools.length} pool(s) directly to your wallet!`,
          res.txHash,
          {
            amount: res.totalClaimed,
            tokenSymbol: 'USDC',
            tokenIcon: UsdcIcon,
            network: 'Arc_Testnet',
          }
        )
      }
      refreshBalances()
      refreshGatewayBalance()
    } catch (err: any) {
      notifyError(notif, 'Claim Failed', err, {
        amount: userTotalClaimableRewardsUsd.toFixed(2),
        tokenSymbol: 'USDC',
        tokenIcon: UsdcIcon,
        network: 'Arc_Testnet',
      })
    } finally {
      setIsClaiming(false)
    }
  }

  const handleClaimPool = async (poolId: string) => {
    const targetPool = pools.find((p) => p.id === poolId)
    const poolName = targetPool?.name || 'Pool'
    const earnedUsd = targetPool?.userPosition?.earnedUsd || 0

    if (earnedUsd < 0.01) {
      if (addToast) {
        addToast(
          'No Claimable Yield',
          `No accrued yield available to claim for ${poolName}.`,
          'info',
          undefined,
          'Arc Testnet'
        )
      }
      return
    }

    setClaimingPoolId(poolId)
    setIsClaiming(true)

    const notif = notifyPending(
      `Claiming Yield...`,
      `Redeeming ${earnedUsd.toFixed(2)} USDC in profit without unstaking your principal`,
      {
        poolId,
        poolName,
        amount: earnedUsd.toFixed(2),
        tokenSymbol: 'USDC',
        tokenIcon: UsdcIcon,
        network: 'Arc_Testnet',
      },
      'pool'
    )

    try {
      const res = await claimPoolRewards(poolId)
      notifySuccess(
        notif,
        'Yield Claimed Successfully!',
        `Successfully claimed +${res.amountClaimed} USDC from ${poolName} directly into your wallet!`,
        res.txHash,
        {
          poolId,
          poolName,
          amount: res.amountClaimed,
          tokenSymbol: 'USDC',
          tokenIcon: UsdcIcon,
          network: 'Arc_Testnet',
        }
      )
      refreshBalances()
      refreshGatewayBalance()
    } catch (err: any) {
      notifyError(notif, 'Claim Failed', err, {
        poolId,
        poolName,
        amount: earnedUsd.toFixed(2),
        tokenSymbol: 'USDC',
        tokenIcon: UsdcIcon,
        network: 'Arc_Testnet',
      })
    } finally {
      setIsClaiming(false)
      setClaimingPoolId(null)
    }
  }

  // Standard Deposit / Withdraw execution
  const handleExecuteModalAction = async (
    poolId: string,
    amount: string,
    mode: 'deposit' | 'withdraw'
  ) => {
    const targetPool = pools.find((p) => p.id === poolId)
    const poolName = targetPool?.name || 'Vault'
    const isLp = Boolean(targetPool?.isLpPool || targetPool?.lpTokenSymbol)
    const isPool = isLp
    const lpTokenSymbol = targetPool?.lpTokenSymbol || (
      poolId === 'usdc-cirbtc-pool'
        ? 'af-USDC-cirBTC'
        : poolId === 'usdc-eurc-stable-pool'
          ? 'af-USDC-EURC'
          : 'af-USDC'
    )
    const tokenSymbol = mode === 'withdraw'
      ? (isLp ? lpTokenSymbol : (targetPool?.tokens[0]?.symbol || 'USDC'))
      : (targetPool?.tokens[0]?.symbol || 'USDC')
    const tokenIcon = (tokenSymbol.includes('cirBTC') || tokenSymbol.includes('BTC'))
      ? CirBtcIcon
      : (tokenSymbol.includes('EURC'))
        ? EurcIcon
        : (TOKEN_ICON_MAP[tokenSymbol] || UsdcIcon)
    const poolApy = targetPool?.apy

    const pendingTitle = isPool
      ? (mode === 'deposit' ? 'Adding Liquidity...' : 'Removing Liquidity...')
      : (mode === 'deposit' ? 'Depositing to Vault...' : 'Redeeming from Vault...')

    const pendingMsg = isPool
      ? `${mode === 'deposit' ? 'Adding' : 'Removing'} ${amount} ${tokenSymbol} liquidity on Arc Testnet`
      : `${mode === 'deposit' ? 'Depositing' : 'Redeeming'} ${amount} ${tokenSymbol} on Arc Testnet`

    const notif = notifyPending(
      pendingTitle,
      pendingMsg,
      {
        poolId,
        poolName,
        poolAction: mode,
        amount,
        tokenSymbol,
        tokenIcon,
        poolApy,
        network: 'Arc_Testnet',
      },
      'pool'
    )

    try {
      let txResult: { txHash: string }
      if (mode === 'deposit') {
        txResult = await depositToPool(poolId, amount, provider)
      } else {
        txResult = await withdrawFromPool(poolId, amount, 'standard', provider)
      }

      const successTitle = isPool
        ? (mode === 'deposit' ? 'Liquidity Added Successfully!' : 'Liquidity Removed Successfully!')
        : (mode === 'deposit' ? 'Deposit Completed Successfully!' : 'Withdrawal Completed Successfully!')

      const successMsg = isPool
        ? `Successfully ${mode === 'deposit' ? 'added' : 'removed'} ${amount} ${tokenSymbol} liquidity ${mode === 'deposit' ? 'to' : 'from'} ${poolName}`
        : `Successfully ${mode === 'deposit' ? 'deposited' : 'withdrawn'} ${amount} ${tokenSymbol} in ${poolName}`

      notifySuccess(
        notif,
        successTitle,
        successMsg,
        txResult.txHash,
        {
          poolId,
          poolName,
          poolAction: mode,
          amount,
          tokenSymbol,
          tokenIcon,
          poolApy,
          network: 'Arc_Testnet',
        }
      )

      refreshBalances()
      refreshGatewayBalance()
    } catch (err: any) {
      const errorTitle = isPool
        ? (mode === 'deposit' ? 'Add Liquidity Failed' : 'Remove Liquidity Failed')
        : (mode === 'deposit' ? 'Deposit Failed' : 'Withdrawal Failed')

      notifyError(notif, errorTitle, err, {
        poolId,
        poolName,
        poolAction: mode,
        amount,
        tokenSymbol,
        tokenIcon,
        poolApy,
        network: 'Arc_Testnet',
      })
      throw err
    }
  }

  // Phase 2: 1-Click Zap Execution
  const handleExecuteZap = async (
    poolId: string,
    inputToken: string,
    inputAmount: string,
    slippage: number
  ) => {
    const targetPool = pools.find((p) => p.id === poolId)
    const poolName = targetPool?.name || 'LP Pool'
    const poolApy = targetPool?.apy
    const tokenIcon = TOKEN_ICON_MAP[inputToken] || TOKEN_ICON_MAP['USDC']

    const notif = notifyPending(
      'Adding Liquidity...',
      `Auto-swapping and minting LP tokens for ${poolName} on Arc Testnet`,
      {
        poolId,
        poolName,
        poolAction: 'zap',
        amount: inputAmount,
        tokenSymbol: inputToken,
        tokenIcon,
        poolApy,
        network: 'Arc_Testnet',
      },
      'pool'
    )

    try {
      const result = await zapIn(poolId, inputToken, inputAmount, slippage)
      notifySuccess(
        notif,
        'Liquidity Added Successfully',
        `Successfully added ${inputAmount} ${inputToken} to ${poolName} (${result.lpMinted} LP tokens, ${result.poolShare}% share of pool)`,
        result.txHash,
        {
          poolId,
          poolName,
          poolAction: 'zap',
          amount: inputAmount,
          tokenSymbol: inputToken,
          tokenIcon,
          poolShare: result.poolShare,
          poolApy,
          network: 'Arc_Testnet',
        }
      )

      refreshBalances()
      refreshGatewayBalance()
    } catch (err: any) {
      notifyError(notif, 'Add Liquidity Failed', err, {
        poolId,
        poolName,
        poolAction: 'zap',
        amount: inputAmount,
        tokenSymbol: inputToken,
        tokenIcon,
        poolApy,
        network: 'Arc_Testnet',
      })
      throw err
    }
  }

  // Dual-Asset 50/50 Deposit Execution (USDC + counter token)
  const handleExecuteDual = async (
    poolId: string,
    amountA: string,
    amountB: string,
    slippage: number = 0.5
  ) => {
    const targetPool = pools.find((p) => p.id === poolId)
    const poolName = targetPool?.name || 'Dual Liquidity Pool'
    const symbolA = targetPool?.tokens[0]?.symbol || 'USDC'
    const symbolB = targetPool?.tokens[1]?.symbol || 'Token'
    const iconA = TOKEN_ICON_MAP[symbolA] || TOKEN_ICON_MAP['USDC']
    const iconB = TOKEN_ICON_MAP[symbolB] || TOKEN_ICON_MAP['cirBTC'] || TOKEN_ICON_MAP['USDC']
    const poolApy = targetPool?.apy

    const notif = notifyPending(
      'Providing Dual Liquidity...',
      `Adding ${amountA} ${symbolA} + ${amountB} ${symbolB} to ${poolName}`,
      {
        poolId,
        poolName,
        poolAction: 'dual',
        amountA,
        symbolA,
        iconA,
        amountB,
        symbolB,
        iconB,
        poolApy,
        network: 'Arc_Testnet',
      },
      'pool'
    )

    try {
      const result = await depositDual(poolId, amountA, amountB, slippage)
      notifySuccess(
        notif,
        'Liquidity Added Successfully',
        `Successfully provided dual liquidity to ${poolName} (${result.lpMinted} LP tokens, ${result.poolShare}% share of pool)`,
        result.txHash,
        {
          poolId,
          poolName,
          poolAction: 'dual',
          amountA,
          symbolA,
          iconA,
          amountB,
          symbolB,
          iconB,
          poolApy,
          network: 'Arc_Testnet',
        }
      )

      refreshBalances()
      refreshGatewayBalance()
    } catch (err: any) {
      notifyError(notif, 'Liquidity Deposit Failed', err, {
        poolId,
        poolName,
        poolAction: 'dual',
        amountA,
        symbolA,
        iconA,
        amountB,
        symbolB,
        iconB,
        network: 'Arc_Testnet',
      })
      throw err
    }
  }

  // Phase 2: LP Withdraw Execution
  const handleExecuteLpWithdraw = async (
    poolId: string,
    lpAmount: string,
    payoutMode: 'dual' | 'usdc',
    slippage: number
  ) => {
    const targetPool = pools.find((p) => p.id === poolId)
    const poolName = targetPool?.name || 'LP Pool'
    const poolApy = targetPool?.apy
    const lpTokenSymbol = targetPool?.lpTokenSymbol || (
      poolId === 'usdc-cirbtc-pool' || poolName.toLowerCase().includes('cirbtc') || poolName.toLowerCase().includes('btc')
        ? 'af-USDC-cirBTC'
        : poolId === 'usdc-eurc-stable-pool' || poolName.toLowerCase().includes('eurc')
          ? 'af-USDC-EURC'
          : 'af-USDC'
    )
    const tokenIcon = (lpTokenSymbol.includes('cirBTC') || lpTokenSymbol.includes('BTC') || poolId.includes('btc'))
      ? CirBtcIcon
      : (lpTokenSymbol.includes('EURC') || poolId.includes('eurc'))
        ? EurcIcon
        : UsdcIcon

    const notif = notifyPending(
      'Removing Liquidity...',
      `Redeeming ${lpAmount} ${lpTokenSymbol} from ${poolName} (${payoutMode === 'usdc' ? '100% USDC' : 'Dual Payout'})`,
      {
        poolId,
        poolName,
        poolAction: 'withdraw',
        lpAmount,
        amount: lpAmount,
        tokenSymbol: lpTokenSymbol,
        tokenIcon,
        poolApy,
        network: 'Arc_Testnet',
      },
      'pool'
    )

    try {
      const result = await withdrawFromPool(poolId, lpAmount, payoutMode, provider, slippage)
      
      if (result.autoSwapFailed) {
        notifySuccess(
          notif,
          'Liquidity Removed (Auto-Swap Incomplete)',
          `Successfully redeemed ${lpAmount} ${lpTokenSymbol} from ${poolName}. Note: Auto-swap of ${result.counterTokenSymbol || 'counter token'} to USDC failed. Your tokens remain safely in your wallet.`,
          result.txHash,
          {
            poolId,
            poolName,
            poolAction: 'withdraw',
            lpAmount,
            amount: lpAmount,
            tokenSymbol: lpTokenSymbol,
            tokenIcon,
            poolApy,
            network: 'Arc_Testnet',
          }
        )
      } else {
        notifySuccess(
          notif,
          'Liquidity Removed!',
          `Successfully redeemed ${lpAmount} ${lpTokenSymbol} from ${poolName}`,
          result.txHash,
          {
            poolId,
            poolName,
            poolAction: 'withdraw',
            lpAmount,
            amount: lpAmount,
            tokenSymbol: lpTokenSymbol,
            tokenIcon,
            poolApy,
            network: 'Arc_Testnet',
          }
        )
      }

      refreshBalances()
      refreshGatewayBalance()
    } catch (err: any) {
      notifyError(notif, 'Withdrawal Failed', err, {
        poolId,
        poolName,
        poolAction: 'withdraw',
        lpAmount,
        amount: lpAmount,
        tokenSymbol: lpTokenSymbol,
        tokenIcon,
        network: 'Arc_Testnet',
      })
      throw err
    }
  }

  // Phase 2: Pool AMM Swap Execution
  const handleExecuteSwap = async (
    poolId: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    minOut?: string
  ): Promise<{ txHash: string; amountOut: string }> => {
    const targetPool = pools.find((p) => p.id === poolId)
    const poolName = targetPool?.name || 'AMM Pool'
    const fromIcon = TOKEN_ICON_MAP[tokenIn] || TOKEN_ICON_MAP['USDC']
    const toIcon = TOKEN_ICON_MAP[tokenOut] || TOKEN_ICON_MAP['cirBTC'] || TOKEN_ICON_MAP['USDC']

    const notif = notifyPending(
      `Swapping ${tokenIn} → ${tokenOut}...`,
      `Executing AMM pool swap on ${poolName} (${amountIn} ${tokenIn})`,
      {
        fromAmount: amountIn,
        fromSymbol: tokenIn,
        fromIcon,
        toAmount: minOut,
        toSymbol: tokenOut,
        toIcon,
        network: 'Arc_Testnet',
      },
      'swap'
    )

    try {
      const result = await swapInPool(poolId, tokenIn, tokenOut, amountIn, minOut)
      notifySuccess(
        notif,
        'Swap Completed!',
        `Successfully swapped ${amountIn} ${tokenIn} for ${result.amountOut || ''} ${tokenOut} on Arc Testnet`,
        result.txHash,
        {
          fromAmount: amountIn,
          fromSymbol: tokenIn,
          fromIcon,
          toAmount: result.amountOut,
          toSymbol: tokenOut,
          toIcon,
          network: 'Arc_Testnet',
        }
      )
      return result
    } catch (err: any) {
      notifyError(notif, 'Swap Failed', err, {
        fromAmount: amountIn,
        fromSymbol: tokenIn,
        fromIcon,
        toSymbol: tokenOut,
        toIcon,
        network: 'Arc_Testnet',
      })
      throw err
    }
  }

  // Cross-Chain 1-Click Gateway Zap Execution (teleportation + auto-deposit)
  const handleExecuteCrossChainGatewayZap = async (
    poolId: string,
    sourceChainKey: string,
    amountUsdc: string,
    slippage: number = 0.5
  ) => {
    const targetPool = pools.find((p) => p.id === poolId)
    const poolName = targetPool?.name || 'Vault'
    const isPool = Boolean(targetPool?.isLpPool)
    const sourceChainDisplayName = sourceChainKey === 'Unified_Gateway'
      ? 'Gateway Unified Balance'
      : sourceChainKey.replace('_', ' ')

    const pendingTitle = isPool ? 'Adding Liquidity...' : 'Depositing to Cross-Chain Vault...'
    const notif = notifyPending(
      pendingTitle,
      `Cross-chain burn & mint from ${sourceChainDisplayName} into ${poolName}`,
      {
        poolId,
        poolName,
        poolAction: 'zap',
        amount: amountUsdc,
        tokenSymbol: 'USDC',
        tokenIcon: TOKEN_ICON_MAP['USDC'],
        sourceChain: sourceChainKey,
        destChain: 'Arc_Testnet',
        network: 'Arc_Testnet',
        poolApy: targetPool?.apy,
      },
      'pool'
    )

    try {
      // Step 1: Real Circle Gateway cross-chain teleportation if source is not Arc
      if (sourceChainKey !== 'Arc_Testnet' && sourceChainKey !== 'native' && provider) {
        const effectiveSourceChain = sourceChainKey === 'Unified_Gateway' ? 'Base_Sepolia' : sourceChainKey
        const sourceDef = POOLS_CHAIN_DEFS[effectiveSourceChain]
        if (sourceDef) {
          await transferFromGateway({
            provider,
            sourceChain: effectiveSourceChain,
            destinationChain: 'Arc_Testnet',
            amount: amountUsdc,
            recipient: (walletAddress || undefined) as `0x${string}` | undefined,
            sourceChainDef: sourceDef,
            destinationChainDef: arcTestnet,
          })
        }
      }

      // Step 2: Auto-deposit or Zap into the target pool/vault on Arc
      let txResult: { txHash: string }
      if (targetPool?.isLpPool) {
        txResult = await zapIn(poolId, 'USDC', amountUsdc, slippage)
      } else {
        txResult = await depositToPool(poolId, amountUsdc, provider)
      }

      const successTitle = isPool ? 'Liquidity Added Successfully!' : 'Cross-Chain Deposit Complete!'
      notifySuccess(
        notif,
        successTitle,
        `Transferred ${amountUsdc} USDC from ${sourceChainDisplayName} and ${isPool ? 'added liquidity to' : 'deposited to'} ${poolName}!`,
        txResult.txHash,
        {
          poolId,
          poolName,
          poolAction: 'zap',
          amount: amountUsdc,
          tokenSymbol: 'USDC',
          tokenIcon: TOKEN_ICON_MAP['USDC'],
          sourceChain: sourceChainKey,
          destChain: 'Arc_Testnet',
          network: 'Arc_Testnet',
          poolApy: targetPool?.apy,
        }
      )

      refreshBalances()
      refreshGatewayBalance()
    } catch (err: any) {
      const errorTitle = isPool ? 'Add Liquidity Failed' : 'Cross-Chain Deposit Failed'
      notifyError(notif, errorTitle, err, {
        poolId,
        poolName,
        poolAction: 'zap',
        amount: amountUsdc,
        tokenSymbol: 'USDC',
        tokenIcon: TOKEN_ICON_MAP['USDC'],
        sourceChain: sourceChainKey,
        destChain: 'Arc_Testnet',
        network: 'Arc_Testnet',
      })
      throw err
    }
  }



  return (
    <div className="arc-animate-reveal w-full max-w-[1400px] mx-auto pt-1">
      {/* ── Two-Column Desktop Layout ── */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* ── Left Column: Sticky Arcis Pools & Yield Hub Card ── */}
        <div className="w-full lg:w-[430px] xl:w-[460px] lg:shrink-0 lg:sticky lg:top-[88px] z-20">
          <PoolsHeroStats
            totalTvlUsd={totalTvlUsd}
            localTvlUsd={localTvlUsd}
            gatewayTvlUsd={gatewayTvlUsd}
            pools={pools}
            userTotalDepositedUsd={userTotalDepositedUsd}
            userTotalClaimableRewardsUsd={userTotalClaimableRewardsUsd}
            dailyYieldGeneratedUsd={dailyYieldGeneratedUsd}
            walletConnected={walletConnected}
            onClaimAll={handleClaimAll}
            isClaiming={isClaiming}
            onOpenCalculator={() => setIsCalculatorOpen(true)}
          />
        </div>

        {/* ── Right Column: Filters, Search & Pools List ── */}
        <div className="flex-1 min-w-0 w-full flex flex-col">
          {/* ── Filter Bar & Search Controls ── */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 18,
            }}
          >
            {/* Category Filter Pills */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                overflowX: 'auto',
                padding: '2px 0',
                maxWidth: '100%',
              }}
            >
              {categories.map((cat) => {
                const isActive = activeCategory === cat.id
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setActiveCategory(cat.id)}
                    style={{
                      padding: '7px 14px',
                      borderRadius: 99,
                      fontSize: 12,
                      fontFamily: 'var(--font-app)',
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? '#fff' : 'var(--fp-3)',
                      background: isActive
                        ? 'linear-gradient(135deg, rgba(152, 150, 255, 0.25) 0%, rgba(99, 102, 241, 0.3) 100%)'
                        : 'rgba(255, 255, 255, 0.04)',
                      border: isActive
                        ? '1px solid rgba(152, 150, 255, 0.4)'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                      boxShadow: isActive ? '0 2px 10px rgba(152, 150, 255, 0.2)' : 'none',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {cat.label}
                  </button>
                )
              })}
            </div>

            {/* Search & Sort Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {/* Search Box */}
              <div style={{ position: 'relative', minWidth: 360}}>
                <Search
                  size={14}
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--fp-4)',
                  }}
                />
                <input
                  type="text"
                  placeholder="Search vaults..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    background: 'rgba(11, 13, 24, 0.75)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 99,
                    padding: '6px 14px 6px 32px',
                    fontSize: 12,
                    color: '#fff',
                    fontFamily: 'var(--font-app)',
                    outline: 'none',
                    width: '100%',
                  }}
                />
              </div>

              {/* Custom Luxury Sort Dropdown */}
              <div style={{ position: 'relative' }} ref={sortDropdownRef}>
                <button
                  type="button"
                  onClick={() => setShowSortDropdown((prev) => !prev)}
                  style={{
                    background: 'rgba(11, 13, 24, 0.75)',
                    border: showSortDropdown
                      ? '1px solid rgba(152, 150, 255, 0.5)'
                      : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 99,
                    padding: '6px 14px',
                    fontSize: 12,
                    color: '#fff',
                    fontFamily: 'var(--font-app)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    cursor: 'pointer',
                    outline: 'none',
                    transition: 'all 0.2s var(--ease-out-smooth)',
                    boxShadow: showSortDropdown ? '0 0 14px rgba(152, 150, 255, 0.2)' : 'none',
                  }}
                >
                  <SlidersHorizontal size={12} style={{ color: 'var(--purple-1)' }} />
                  <span style={{ fontWeight: 500 }}>
                    {sortOptions.find((opt) => opt.id === sortBy)?.label || 'Sort'}
                  </span>
                  <ChevronDown
                    size={13}
                    style={{
                      transition: 'transform 0.25s var(--ease-out-smooth)',
                      transform: showSortDropdown ? 'rotate(180deg)' : 'rotate(0deg)',
                      color: 'var(--fp-3)',
                    }}
                  />
                </button>

                {showSortDropdown && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      right: 0,
                      minWidth: 195,
                      background: 'rgba(15, 18, 32, 0.96)',
                      backdropFilter: 'blur(24px)',
                      WebkitBackdropFilter: 'blur(24px)',
                      border: '1px solid rgba(152, 150, 255, 0.25)',
                      borderRadius: 14,
                      boxShadow: '0 16px 36px -4px rgba(0, 0, 0, 0.7), 0 4px 16px rgba(0, 0, 0, 0.4)',
                      padding: 4,
                      zIndex: 100,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    {sortOptions.map((opt) => {
                      const isSelected = sortBy === opt.id
                      const IconComponent = opt.icon
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setSortBy(opt.id)
                            setShowSortDropdown(false)
                          }}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 12px',
                            borderRadius: 10,
                            background: isSelected ? 'rgba(152, 150, 255, 0.15)' : 'transparent',
                            border: 'none',
                            fontSize: 12,
                            color: isSelected ? '#fff' : 'var(--fp-3)',
                            fontFamily: 'var(--font-app)',
                            fontWeight: isSelected ? 600 : 400,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) (e.currentTarget.style.background = 'transparent')
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <IconComponent size={13} style={{ color: isSelected ? 'var(--purple-1)' : 'var(--fp-4)' }} />
                            <span>{opt.label}</span>
                          </div>
                          {isSelected && <Check size={13} style={{ color: 'var(--purple-1)' }} />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Refresh Balances Button */}
              <button
                type="button"
                onClick={async () => {
                  if (isManualRefreshing) return
                  try {
                    setIsManualRefreshing(true)
                    await refreshBalances()
                  } finally {
                    setIsManualRefreshing(false)
                  }
                }}
                disabled={isBalancesLoading || isManualRefreshing}
                className="ub-action-btn"
                style={{ padding: '7px 10px', borderRadius: 99 }}
                title="Refresh Vault Balances & Positions"
              >
                <RefreshCw size={13} className={isBalancesLoading || isManualRefreshing ? 'arcis-spin' : ''} />
              </button>
            </div>
          </div>

          {/* ── Pools Cards List ── */}
          <div>
            {filteredPools.map((pool) => (
              <PoolCard
                key={pool.id}
                pool={pool}
                walletConnected={walletConnected}
                onDeposit={handleOpenDeposit}
                onWithdraw={handleOpenWithdraw}
                onClaim={handleClaimPool}
                isClaiming={isClaiming}
                claimingPoolId={claimingPoolId}
              />
            ))}

            {filteredPools.length === 0 && (
              <div
                className="ub-asset-card"
                style={{ padding: '48px 20px', textAlign: 'center', color: 'var(--fp-3)' }}
              >
                <Layers size={32} style={{ margin: '0 auto 12px auto', opacity: 0.4 }} />
                <h4 style={{ margin: '0 0 6px 0', color: '#fff', fontSize: 16 }}>No Vaults Found</h4>
                <p style={{ margin: 0, fontSize: 13 }}>
                  No pools matched your current search and filter criteria.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Interactive Modals ── */}
      {isActionModalOpen && selectedPoolForAction && (
        <PoolActionModal
          isOpen={isActionModalOpen}
          pool={selectedPoolForAction as any}
          mode={actionModalMode}
          onClose={() => setIsActionModalOpen(false)}
          walletAddress={walletAddress}
          availableWalletUsdc={onchainBalances.usdc}
          availableWalletEurc={onchainBalances.eurc}
          availableWalletCirBtc={onchainBalances.cirbtc}
          onExecute={handleExecuteModalAction}
          onExecuteZap={handleExecuteZap}
          onExecuteDual={handleExecuteDual}
          onExecuteLpWithdraw={handleExecuteLpWithdraw}
          onExecuteSwap={handleExecuteSwap}
          onExecuteCrossChainZap={handleExecuteCrossChainGatewayZap}
        />
      )}

      {isCalculatorOpen && (
        <YieldCalculator
          isOpen={isCalculatorOpen}
          onClose={() => setIsCalculatorOpen(false)}
          onSelectPoolToDeposit={(pool) => handleOpenDeposit(pool)}
          walletBalanceUsdc={onchainBalances.usdc}
          pools={pools}
        />
      )}
    </div>
  )
}
