// Master Pools & Yield Hub view for Arcis.
// Combines USYC RWA Vault, Circle Gateway Cross-Chain Settlement Vault,
// Arcis Real-Yield Staking, DEX Liquidity Pools,
// 1-Click Zap, and live Arc Testnet state.
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useClearOnWalletDisconnect } from '../../hooks/useClearOnWalletDisconnect'
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
import ConcentratedLiquidityModal from './ConcentratedLiquidityModal'
import YieldCalculator from './YieldCalculator'
import PoolsOverviewCard from './PoolsOverviewCard'
import PoolsTvlChartCard from './PoolsTvlChartCard'
import PoolsToolbar from './PoolsToolbar'
import PoolsTable from './PoolsTable'
import CreatePoolModal from './CreatePoolModal'
import MyPositionsSection from './MyPositionsSection'
import { usePoolsData } from '../../hooks/usePoolsData'
import { useGatewayBalance } from '../../hooks/useGatewayBalance'
import { type PoolCategory, type PoolConfig, type PoolRiskLevel, POOLS_CHAIN_DEFS } from '../../config/poolsConfig'
import { arcTestnet } from '../../config/arcChain'
import { transferFromGateway } from '../../services/gatewayService'
import { useBroadcast, type BroadcastType } from '../BroadcastNotification'
import { TOKEN_ICON_MAP } from '../../config/tokenIcons'
import { isUserCanceled, formatWalletError } from '../../utils/errorUtils'
import { addTransaction } from '../../utils/history'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'

interface PoolsTabProps {
  walletAddress: string
  walletConnected: boolean
  provider?: unknown
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  executeUcwContract?: (params: any) => Promise<{ success: boolean; txHash?: string; error?: string }>
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
  authSource,
  executeUcwContract,
  addToast,
  removeToast,
}: PoolsTabProps) {
  const {
    pools,
    onchainBalances,
    isBalancesLoading,
    totalTvlUsd,
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
  } = usePoolsData(walletAddress, provider, authSource, executeUcwContract)

  // Gateway unified balance (for cross-chain zap)
  const { totalBalance: gatewayTotalBalance, balances: gatewayBalances, refresh: refreshGatewayBalance } = useGatewayBalance(walletAddress)

  // Filter & Search states
  const [activeCategory, setActiveCategory] = useState<PoolCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Systematic input and state clearing on wallet disconnect
  const resetFormInputs = useCallback(() => {
    setSearchQuery('')
  }, [])

  useClearOnWalletDisconnect(resetFormInputs)

  useEffect(() => {
    if (!walletConnected) {
      resetFormInputs()
    }
  }, [walletConnected, resetFormInputs])

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
          const riskWeight: Record<PoolRiskLevel, number> = { Safe: 1, Low: 2, Medium: 3 }
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
    const isCanceled = isUserCanceled(err) || err?.isCanceled === true || err?.code === 4001
    const title = isCanceled ? (defaultTitle.includes('Withdraw') ? 'Withdrawal Canceled' : 'Transaction Canceled') : defaultTitle
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
    if (userTotalClaimableRewardsUsd < 0.005) {
      if (addToast) {
        addToast(
          'Nothing to Harvest',
          'No accrued fees or yield to harvest yet (minimum 0.01 USDC).',
          'info',
          undefined,
          'Arc Testnet'
        )
      }
      return
    }

    setIsClaiming(true)

    // Calculate portfolio or active pools average APY
    const userPortfolioApy = userTotalDepositedUsd > 0 && dailyYieldGeneratedUsd > 0
      ? ((dailyYieldGeneratedUsd * 365) / userTotalDepositedUsd) * 100
      : 0
    const claimablePools = pools.filter(
      (p) => (p.userPosition?.earnedUsd || 0) >= 0.005 || (p.userPosition?.stakedAmount && parseFloat(p.userPosition.stakedAmount) > 0)
    )
    const poolsForApy = claimablePools.length > 0 ? claimablePools : pools
    const simpleAvgApy = poolsForApy.reduce((sum, p) => sum + (p.apy || 0), 0) / (poolsForApy.length || 1)
    const avgApy = userPortfolioApy > 0 ? userPortfolioApy : simpleAvgApy
    const formattedAvgApy = `Avg ${avgApy.toFixed(1)}% APY`

    const notif = notifyPending(
      'Harvesting Accrued Yield...',
      `Harvesting ${userTotalClaimableRewardsUsd.toFixed(2)} USDC of accrued fees/yield — your principal stays staked`,
      {
        poolName: 'All Active Pools',
        isClaimAll: true,
        poolApy: formattedAvgApy,
        amount: userTotalClaimableRewardsUsd.toFixed(2),
        rewardAmount: userTotalClaimableRewardsUsd.toFixed(2),
        tokenSymbol: 'USDC',
        tokenIcon: UsdcIcon,
        network: 'Arc_Testnet',
      },
      'pool'
    )

    try {
      const res = await claimAllRewards()
      if (res.isCanceled && res.successfulPools && res.successfulPools.length > 0) {
        notifySuccess(
          notif,
          'Partial Harvest',
          `Harvested ${res.totalClaimed} USDC from ${res.successfulPools.join(', ')}. Remaining harvest requests were canceled in wallet.`,
          res.txHash,
          {
            poolName: 'All Active Pools',
            isClaimAll: true,
            poolApy: formattedAvgApy,
            amount: res.totalClaimed,
            rewardAmount: res.totalClaimed,
            tokenSymbol: 'USDC',
            tokenIcon: UsdcIcon,
            network: 'Arc_Testnet',
          }
        )
      } else if (res.failedPools && res.failedPools.length > 0) {
        if (res.successfulPools && res.successfulPools.length > 0) {
          notifySuccess(
            notif,
            'Partial Harvest',
            `Harvested ${res.totalClaimed} USDC from ${res.successfulPools.join(', ')}. Note: Harvest failed for ${res.failedPools.join(', ')}.`,
            res.txHash,
            {
              poolName: 'All Active Pools',
              isClaimAll: true,
              poolApy: formattedAvgApy,
              amount: res.totalClaimed,
              rewardAmount: res.totalClaimed,
              tokenSymbol: 'USDC',
              tokenIcon: UsdcIcon,
              network: 'Arc_Testnet',
            }
          )
        } else {
          notifyError(notif, 'Withdrawal Failed', new Error(`Withdrawal failed for: ${res.failedPools.join(', ')}`), {
            poolName: 'All Active Pools',
            isClaimAll: true,
            poolApy: formattedAvgApy,
            amount: userTotalClaimableRewardsUsd.toFixed(2),
            rewardAmount: userTotalClaimableRewardsUsd.toFixed(2),
            tokenSymbol: 'USDC',
            tokenIcon: UsdcIcon,
            network: 'Arc_Testnet',
          })
        }
      } else {
        notifySuccess(
          notif,
          'Yield Harvested Successfully!',
          `Successfully harvested ${res.totalClaimed} USDC across ${res.successfulPools.length} pool(s) directly to your wallet!`,
          res.txHash,
          {
            poolName: 'All Active Pools',
            isClaimAll: true,
            poolApy: formattedAvgApy,
            amount: res.totalClaimed,
            rewardAmount: res.totalClaimed,
            tokenSymbol: 'USDC',
            tokenIcon: UsdcIcon,
            network: 'Arc_Testnet',
          }
        )
      }
      refreshBalances()
      refreshGatewayBalance()
    } catch (err: any) {
      notifyError(notif, 'Withdrawal Failed', err, {
        poolName: 'All Active Pools',
        isClaimAll: true,
        poolApy: formattedAvgApy,
        amount: userTotalClaimableRewardsUsd.toFixed(2),
        rewardAmount: userTotalClaimableRewardsUsd.toFixed(2),
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
    const poolApy = targetPool?.apy

    if (earnedUsd < 0.005) {
      if (addToast) {
        addToast(
          'Nothing to Harvest',
          `No accrued fees or yield available to harvest for ${poolName} yet (minimum 0.01 USDC).`,
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
      `Harvesting Yield...`,
      `Harvesting ${earnedUsd.toFixed(2)} USDC of accrued fees/yield — your principal stays staked`,
      {
        poolId,
        poolName,
        amount: earnedUsd.toFixed(2),
        tokenSymbol: 'USDC',
        tokenIcon: UsdcIcon,
        poolApy,
        network: 'Arc_Testnet',
      },
      'pool'
    )

    try {
      const res = await claimPoolRewards(poolId)
      notifySuccess(
        notif,
        'Yield Harvested Successfully!',
        `Successfully harvested +${res.amountClaimed} USDC from ${poolName} directly into your wallet!`,
        res.txHash,
        {
          poolId,
          poolName,
          amount: res.amountClaimed,
          tokenSymbol: 'USDC',
          tokenIcon: UsdcIcon,
          poolApy,
          network: 'Arc_Testnet',
        }
      )
      refreshBalances()
      refreshGatewayBalance()
    } catch (err: any) {
      notifyError(notif, 'Withdrawal Failed', err, {
        poolId,
        poolName,
        amount: earnedUsd.toFixed(2),
        tokenSymbol: 'USDC',
        tokenIcon: UsdcIcon,
        poolApy,
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

      if (txResult?.txHash && walletAddress) {
        try {
          addTransaction({
            type: mode === 'deposit' ? 'add_liquidity' : 'remove_liquidity',
            txHash: txResult.txHash,
            amount,
            tokenSymbol,
            sourceChain: 'Arc_Testnet',
            recipient: targetPool?.contractAddress || undefined,
            userAddress: walletAddress,
            status: 'success',
            poolId,
            poolName,
          })
        } catch (err) {
          console.warn('[PoolsTab] Failed to add transaction to history:', err)
        }
      }

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

      if (result?.txHash && walletAddress) {
        try {
          addTransaction({
            type: 'add_liquidity',
            txHash: result.txHash,
            amount: inputAmount,
            tokenSymbol: inputToken,
            sourceChain: 'Arc_Testnet',
            recipient: targetPool?.contractAddress || undefined,
            userAddress: walletAddress,
            status: 'success',
            poolId,
            poolName,
            lpMinted: result.lpMinted,
            poolShare: result.poolShare,
          })
        } catch (err) {
          console.warn('[PoolsTab] Failed to add zap transaction to history:', err)
        }
      }

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

      if (result?.txHash && walletAddress) {
        try {
          addTransaction({
            type: 'add_liquidity',
            txHash: result.txHash,
            amount: amountA,
            tokenSymbol: symbolA,
            amountB,
            tokenB: symbolB,
            sourceChain: 'Arc_Testnet',
            recipient: targetPool?.contractAddress || undefined,
            userAddress: walletAddress,
            status: 'success',
            poolId,
            poolName,
            lpMinted: result.lpMinted,
            poolShare: result.poolShare,
          })
        } catch (err) {
          console.warn('[PoolsTab] Failed to add dual deposit transaction to history:', err)
        }
      }

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
        poolApy,
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

      if (result?.txHash && walletAddress) {
        try {
          addTransaction({
            type: 'remove_liquidity',
            txHash: result.txHash,
            amount: lpAmount,
            tokenSymbol: lpTokenSymbol,
            sourceChain: 'Arc_Testnet',
            recipient: targetPool?.contractAddress || undefined,
            userAddress: walletAddress,
            status: 'success',
            poolId,
            poolName,
          })
        } catch (err) {
          console.warn('[PoolsTab] Failed to add LP withdraw transaction to history:', err)
        }
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

    // Dynamically resolve source chain if Unified_Gateway
    let effectiveSourceChain = sourceChainKey
    if (sourceChainKey === 'Unified_Gateway') {
      const reqAmt = parseFloat(amountUsdc) || 0
      const validChains = (gatewayBalances || []).filter((b) => b.chainKey !== 'Arc_Testnet')
      const candidate = validChains.find((b) => parseFloat(b.balance) >= reqAmt && parseFloat(b.balance) > 0)
        || validChains.reduce((prev, curr) => (parseFloat(curr.balance) > parseFloat(prev.balance) ? curr : prev), validChains[0])
      effectiveSourceChain = candidate?.chainKey || 'Base_Sepolia'
    }

    const sourceChainDisplayName = sourceChainKey === 'Unified_Gateway'
      ? `Gateway (${effectiveSourceChain.replace('_', ' ')})`
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
        sourceChain: effectiveSourceChain,
        destChain: 'Arc_Testnet',
        network: 'Arc_Testnet',
        poolApy: targetPool?.apy,
      },
      'pool'
    )

    try {
      let effectiveDepositAmount = amountUsdc
      let gatewayMintTxHash: string | undefined

      // Step 1: Real Circle Gateway cross-chain teleportation if source is not Arc
      if (effectiveSourceChain !== 'Arc_Testnet' && effectiveSourceChain !== 'native' && provider) {
        const sourceDef = POOLS_CHAIN_DEFS[effectiveSourceChain]
        if (sourceDef) {
          const gatewayRes = await transferFromGateway({
            provider,
            sourceChain: effectiveSourceChain,
            destinationChain: 'Arc_Testnet',
            amount: amountUsdc,
            recipient: (walletAddress || undefined) as `0x${string}` | undefined,
            sourceChainDef: sourceDef,
            destinationChainDef: arcTestnet,
          })
          gatewayMintTxHash = gatewayRes?.mintTxHash
          if (gatewayRes?.effectiveAmount && parseFloat(gatewayRes.effectiveAmount) > 0) {
            effectiveDepositAmount = gatewayRes.effectiveAmount
          }
        }
      }

      // Step 2: Auto-deposit or Zap into the target pool/vault on Arc with effective minted amount
      let txResult: { txHash: string }
      if (targetPool?.isLpPool) {
        txResult = await zapIn(poolId, 'USDC', effectiveDepositAmount, slippage)
      } else {
        txResult = await depositToPool(poolId, effectiveDepositAmount, provider)
      }

      const successTitle = isPool ? 'Liquidity Added Successfully!' : 'Cross-Chain Deposit Complete!'
      notifySuccess(
        notif,
        successTitle,
        `Transferred ${effectiveDepositAmount} USDC from ${sourceChainDisplayName} and ${isPool ? 'added liquidity to' : 'deposited to'} ${poolName}!`,
        txResult.txHash,
        {
          poolId,
          poolName,
          poolAction: 'zap',
          amount: effectiveDepositAmount,
          tokenSymbol: 'USDC',
          tokenIcon: TOKEN_ICON_MAP['USDC'],
          sourceChain: effectiveSourceChain,
          destChain: 'Arc_Testnet',
          network: 'Arc_Testnet',
          poolApy: targetPool?.apy,
          mintTxHash: gatewayMintTxHash,
        }
      )

      if (txResult?.txHash && walletAddress) {
        try {
          addTransaction({
            type: 'add_liquidity',
            txHash: txResult.txHash,
            amount: effectiveDepositAmount,
            tokenSymbol: 'USDC',
            sourceChain: effectiveSourceChain,
            destChain: 'Arc_Testnet',
            recipient: targetPool?.contractAddress || undefined,
            userAddress: walletAddress,
            status: 'success',
            poolId,
            poolName,
          })
        } catch (err) {
          console.warn('[PoolsTab] Failed to add cross-chain deposit to history:', err)
        }
      }

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
        sourceChain: effectiveSourceChain,
        destChain: 'Arc_Testnet',
        network: 'Arc_Testnet',
        poolApy: targetPool?.apy,
      })
      throw err
    }
  }



  // Chart timeframe state
  const [chartTimeframe, setChartTimeframe] = useState<'24H' | '7D' | '30D'>('30D')
  // Create pool modal state
  const [isCreatePoolOpen, setIsCreatePoolOpen] = useState<boolean>(false)

  return (
    <div className="arc-animate-reveal w-full max-w-[1400px] mx-auto pt-1 pb-12">
      {/* ── 1. Top Section: Hero Analytics Grid (Left: Overview, Right: TVL Chart) ── */}
      <div className="flex flex-col lg:flex-row gap-5 sm:gap-6 items-stretch">
        {/* Left Hero: Liquidity Pools Overview Card (Expanded Width) */}
        <div className="w-full lg:w-[380px] xl:w-[420px] 2xl:w-[460px] lg:shrink-0 flex flex-col self-stretch">
          <PoolsOverviewCard
            totalTvlUsd={totalTvlUsd}
            pools={pools}
            userTotalDepositedUsd={userTotalDepositedUsd}
            userTotalClaimableRewardsUsd={userTotalClaimableRewardsUsd}
            dailyYieldGeneratedUsd={dailyYieldGeneratedUsd}
            walletConnected={walletConnected}
            onClaimAll={handleClaimAll}
            isClaiming={isClaiming}
            onOpenCalculator={() => setIsCalculatorOpen(true)}
            timeframe={chartTimeframe}
          />
        </div>

        {/* Right Hero: Interactive TVL Historical SVG Chart Card (Expansive Width) */}
        <div className="flex-1 min-w-0 flex flex-col self-stretch">
          <PoolsTvlChartCard
            totalTvlUsd={totalTvlUsd}
            activeTimeframe={chartTimeframe}
            onTimeframeChange={setChartTimeframe}
          />
        </div>
      </div>

      {/* ── 2. Middle Section: Search & Actions Toolbar ── */}
      <PoolsToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeCategory={activeCategory}
        onCategoryChange={setActiveCategory}
        onCreatePool={() => setIsCreatePoolOpen(true)}
        onOpenCalculator={() => setIsCalculatorOpen(true)}
        onRefresh={async () => {
          if (isManualRefreshing) return
          try {
            setIsManualRefreshing(true)
            await refreshBalances()
          } finally {
            setIsManualRefreshing(false)
          }
        }}
        isRefreshing={isBalancesLoading || isManualRefreshing}
      />

      {/* ── 3. Bottom Section: Modern DeFi Pools Table View ── */}
      <PoolsTable
        pools={filteredPools}
        onSelectPool={(pool, mode = 'deposit') => {
          setSelectedPoolForAction(pool)
          setActionModalMode(mode)
          setIsActionModalOpen(true)
        }}
        walletConnected={walletConnected}
        searchQuery={searchQuery}
      />

      {/* ── 4. My Positions Section (Concentrated Liquidity Cards Matching Screenshot) ── */}
      <MyPositionsSection
        pools={pools}
        walletConnected={walletConnected}
        walletAddress={walletAddress}
        onClaim={handleClaimPool}
        onAddLiquidity={(pool) => {
          if (pool) {
            handleOpenDeposit(pool)
          } else if (pools.length > 0) {
            handleOpenDeposit(pools[0])
          }
        }}
        onRemoveLiquidity={(pool) => {
          if (pool) {
            handleOpenWithdraw(pool)
          } else if (pools.length > 0) {
            handleOpenWithdraw(pools[0])
          }
        }}
        isClaiming={isClaiming}
        claimingPoolId={claimingPoolId}
      />

      {/* ── Interactive Modals ── */}
      {isActionModalOpen && selectedPoolForAction && (
        actionModalMode === 'deposit' && (selectedPoolForAction.id === 'usdc-cirbtc-pool' || selectedPoolForAction.tags?.includes('Concentrated Liquidity')) ? (
          <ConcentratedLiquidityModal
            isOpen={isActionModalOpen}
            pool={selectedPoolForAction as any}
            onClose={() => setIsActionModalOpen(false)}
            walletAddress={walletAddress}
            availableWalletUsdc={onchainBalances.usdc}
            availableWalletCirBtc={onchainBalances.cirbtc}
            onExecuteDeposit={async (poolId, usdcAmt, btcAmt, slip) => {
              await handleExecuteDual(poolId, usdcAmt, btcAmt, slip)
            }}
          />
        ) : (
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
        )
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

      {isCreatePoolOpen && (
        <CreatePoolModal
          isOpen={isCreatePoolOpen}
          onClose={() => setIsCreatePoolOpen(false)}
          walletAddress={walletAddress}
          availableWalletUsdc={onchainBalances.usdc}
        />
      )}
    </div>
  )
}

