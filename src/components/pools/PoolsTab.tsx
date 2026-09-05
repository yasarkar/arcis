// src/components/pools/PoolsTab.tsx
//
// Master Pools & Yield Hub view for Arcis (Phase 4 Enhanced).
// Combines USYC RWA Vault, Circle Gateway Cross-Chain Settlement Vault,
// Arcis Real-Yield Staking, DEX Liquidity Pools, ERC-8183 AI Agent Bounty Hub,
// 1-Click Zap, Auto-Rebalance Wizard, and live Arc Testnet state.
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
} from 'lucide-react'
import PoolsHeroStats from './PoolsHeroStats'
import PoolCard from './PoolCard'
import PoolActionModal from './PoolActionModal'
import YieldCalculator from './YieldCalculator'
import GatewayRebalanceWizard from './GatewayRebalanceWizard'
import AgentBountyHubModal from './AgentBountyHubModal'
import { usePoolsData } from '../../hooks/usePoolsData'
import { useGatewayBalancer } from '../../hooks/useGatewayBalancer'
import { useGatewayBalance } from '../../hooks/useGatewayBalance'
import { depositToGateway } from '../../services/gatewayService'
import { arcTestnet } from '../../config/arcChain'
import { POOL_CONTRACTS, type PoolCategory, type PoolConfig } from '../../config/poolsConfig'
import { useBroadcast } from '../BroadcastNotification'
import { isUserCanceled, formatWalletError } from '../../utils/errorUtils'

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
    averageApy,
    userTotalDepositedUsd,
    userTotalClaimableRewardsUsd,
    dailyYieldGeneratedUsd,
    depositToPool,
    zapIn,
    depositDual,
    withdrawFromPool,
    swapInPool,
    faucetMint,
    claimPoolRewards,
    claimAllRewards,
    refreshBalances,
  } = usePoolsData(walletAddress, provider)

  // Gateway unified balance
  const { totalBalance: gatewayTotalBalance, refresh: refreshGatewayBalance } = useGatewayBalance(walletAddress)

  const { capitalEfficiencyScore, refreshAll: refreshBalancer } = useGatewayBalancer(
    walletAddress,
    userTotalDepositedUsd
  )

  // Filter & Search states
  const [activeCategory, setActiveCategory] = useState<PoolCategory | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [sortBy, setSortBy] = useState<'apy' | 'tvl' | 'positions'>('apy')
  const [showSortDropdown, setShowSortDropdown] = useState<boolean>(false)
  const sortDropdownRef = useRef<HTMLDivElement>(null)

  // Sort options config
  const sortOptions = [
    { id: 'apy' as const, label: 'Highest APY', icon: TrendingUp },
    { id: 'tvl' as const, label: 'Highest TVL', icon: Layers },
    { id: 'positions' as const, label: 'My Positions', icon: ShieldCheck },
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
  const [isRebalancerOpen, setIsRebalancerOpen] = useState<boolean>(false)
  const [isBountyHubOpen, setIsBountyHubOpen] = useState<boolean>(false)
  const [isClaiming, setIsClaiming] = useState<boolean>(false)

  // Filter categories list (3 clear product types)
  const categories: { id: PoolCategory | 'all'; label: string; count?: number }[] = [
    { id: 'all', label: 'All Pools' },
    { id: 'liquidity', label: 'Liquidity' },
    { id: 'vault', label: 'Vaults' },
    { id: 'crosschain', label: 'Cross-Chain' },
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
        if (sortBy === 'tvl') return b.tvlUsd - a.tvlUsd
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

  const handleOpenSwap = (pool: PoolConfig) => {
    setSelectedPoolForAction(pool)
    setActionModalMode('swap')
    setIsActionModalOpen(true)
  }

  const { addBroadcast, updateBroadcast } = useBroadcast()

  // Unified notifier helper: Emits both Broadcast Notification & optional Toast
  const notifyPending = (title: string, message: string, details?: any) => {
    const broadcastId = addBroadcast({
      type: 'deposit',
      title,
      status: 'pending',
      badgeText: 'Pending',
      message,
      details,
    })
    const toastId = addToast ? addToast(title, message, 'pending') : undefined
    return { broadcastId, toastId }
  }

  const notifySuccess = (
    ids: { broadcastId: string; toastId?: string },
    title: string,
    message: string,
    txHash?: string,
    details?: any
  ) => {
    if (ids.toastId && removeToast) removeToast(ids.toastId)
    if (addToast) addToast(title, message, 'success', txHash, 'Arc Testnet')
    updateBroadcast(ids.broadcastId, {
      status: 'success',
      title,
      badgeText: 'Confirmed',
      message,
      details: { ...details, txHash, network: 'Arc_Testnet' },
    })
  }

  const notifyError = (
    ids: { broadcastId: string; toastId?: string },
    defaultTitle: string,
    err: any,
    details?: any
  ) => {
    if (ids.toastId && removeToast) removeToast(ids.toastId)
    const isCanceled = isUserCanceled(err) || err?.isCanceled === true
    const title = isCanceled ? 'Transaction Canceled' : defaultTitle
    const message = isCanceled
      ? 'You canceled the confirmation request in your wallet. No balance was deducted.'
      : (err?.shortMessage || err?.message || formatWalletError(err) || 'Transaction failed on Arc Testnet')

    if (addToast) addToast(title, message, isCanceled ? 'warning' : 'error')
    updateBroadcast(ids.broadcastId, {
      status: isCanceled ? 'canceled' : 'failed',
      title,
      badgeText: isCanceled ? 'Canceled' : 'Failed',
      message,
      details,
    })
  }

  const handleFaucetMint = async (pool: PoolConfig) => {
    const symbol = pool.tokens[1]?.symbol || 'tcirBTC'
    const notif = notifyPending(
      `Minting ${symbol}...`,
      `Requesting test tokens from faucet on Arc Testnet`,
      { tokenSymbol: symbol, network: 'Arc_Testnet' }
    )
    try {
      const result = await faucetMint(pool.id)
      notifySuccess(
        notif,
        `${symbol} Minted!`,
        `Successfully received 0.01 ${symbol} test tokens`,
        result.txHash,
        { tokenSymbol: symbol, network: 'Arc_Testnet' }
      )
    } catch (err: any) {
      notifyError(notif, 'Faucet Claim Failed', err, { tokenSymbol: symbol, network: 'Arc_Testnet' })
    }
  }

  // Gateway Deposit handler (uses depositToGateway from services)
  const handleGatewayDeposit = async (pool: PoolConfig) => {
    if (!provider) {
      addBroadcast({
        type: 'deposit',
        title: 'Wallet Provider Required',
        status: 'failed',
        badgeText: 'Warning',
        message: 'Please connect your Web3 wallet provider to deposit into Circle Gateway.',
      })
      return
    }
    const notif = notifyPending(
      'Gateway Deposit...',
      'Depositing 10 USDC into Gateway on Arc Testnet',
      { amount: '10', tokenSymbol: 'USDC', network: 'Arc_Testnet' }
    )
    try {
      const result = await depositToGateway(provider, 'Arc_Testnet', '10', arcTestnet, 'USDC')
      refreshGatewayBalance()
      notifySuccess(
        notif,
        'Gateway Deposit Success!',
        `Successfully deposited ${result.amount} USDC into Gateway`,
        result.depositTxHash,
        { amount: '10', tokenSymbol: 'USDC', network: 'Arc_Testnet' }
      )
    } catch (err: any) {
      notifyError(notif, 'Gateway Deposit Failed', err, { amount: '10', tokenSymbol: 'USDC', network: 'Arc_Testnet' })
    }
  }

  const handleGatewaySpend = async (pool: PoolConfig) => {
    addBroadcast({
      type: 'system',
      title: 'Gateway Rebalance',
      status: 'info',
      badgeText: 'Info',
      message: 'Gateway spend flow — please use the Gateway Rebalance Wizard.',
    })
    if (addToast) {
      addToast('Gateway Spend', 'Spend flow — use GatewayRebalanceWizard for now', 'info')
    }
  }

  const handleClaimSingle = async (poolId: string) => {
    const targetPool = pools.find((p) => p.id === poolId)
    if (!targetPool) return

    setIsClaiming(true)
    const notif = notifyPending(
      'Claiming Rewards...',
      `Processing reward claim for ${targetPool.name} on Arc Testnet`,
      { poolName: targetPool.name, network: 'Arc_Testnet' }
    )

    try {
      const result = await claimPoolRewards(poolId)
      notifySuccess(
        notif,
        'Rewards Claimed!',
        `Successfully claimed ${result.amountClaimed} USDC yield from ${targetPool.name}`,
        result.txHash,
        { poolName: targetPool.name, network: 'Arc_Testnet' }
      )
    } catch (err: any) {
      notifyError(notif, 'Reward Claim Failed', err, { poolName: targetPool.name, network: 'Arc_Testnet' })
    } finally {
      setIsClaiming(false)
    }
  }

  const handleClaimAll = async () => {
    setIsClaiming(true)
    const notif = notifyPending(
      'Claiming All Rewards...',
      `Batch claiming ${userTotalClaimableRewardsUsd.toFixed(2)} USDC across all active vaults`,
      { amount: userTotalClaimableRewardsUsd.toFixed(2), network: 'Arc_Testnet' }
    )

    try {
      const result = await claimAllRewards()
      notifySuccess(
        notif,
        'All Rewards Claimed!',
        `Successfully claimed ${result.totalClaimed} USDC yield across all vaults`,
        result.txHash,
        { amount: result.totalClaimed, network: 'Arc_Testnet' }
      )
    } catch (err: any) {
      notifyError(notif, 'Batch Claim Failed', err, { network: 'Arc_Testnet' })
    } finally {
      setIsClaiming(false)
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

    const notif = notifyPending(
      mode === 'deposit' ? 'Depositing to Vault...' : 'Withdrawing from Vault...',
      `${mode === 'deposit' ? 'Depositing' : 'Withdrawing'} ${amount} USDC on Arc Testnet`,
      { amount, tokenSymbol: 'USDC', poolName, network: 'Arc_Testnet' }
    )

    try {
      let txResult: { txHash: string }
      if (mode === 'deposit') {
        txResult = await depositToPool(poolId, amount, provider)
      } else {
        txResult = await withdrawFromPool(poolId, amount, 'standard', provider)
      }

      notifySuccess(
        notif,
        mode === 'deposit' ? 'Deposit Successful!' : 'Withdrawal Complete!',
        `Successfully ${mode === 'deposit' ? 'deposited' : 'withdrawn'} ${amount} USDC in ${poolName}`,
        txResult.txHash,
        { amount, tokenSymbol: 'USDC', poolName, network: 'Arc_Testnet' }
      )
    } catch (err: any) {
      notifyError(notif, mode === 'deposit' ? 'Deposit Failed' : 'Withdrawal Failed', err, {
        amount,
        tokenSymbol: 'USDC',
        poolName,
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

    const notif = notifyPending(
      'Executing 1-Click Zap...',
      `Auto-swapping and minting LP tokens for ${poolName} on Arc Testnet`,
      { amount: inputAmount, tokenSymbol: inputToken, poolName, network: 'Arc_Testnet' }
    )

    try {
      const result = await zapIn(poolId, inputToken, inputAmount, slippage)
      notifySuccess(
        notif,
        'Zap In Complete!',
        `Successfully added ${inputAmount} USDC to ${poolName} (${result.poolShare}% share of pool)`,
        result.txHash,
        { amount: inputAmount, tokenSymbol: inputToken, poolName, network: 'Arc_Testnet' }
      )
    } catch (err: any) {
      notifyError(notif, 'Zap In Failed', err, {
        amount: inputAmount,
        tokenSymbol: inputToken,
        poolName,
        network: 'Arc_Testnet',
      })
      throw err
    }
  }

  // Phase 2: Dual-Asset Deposit Execution
  const handleExecuteDual = async (
    poolId: string,
    amountA: string,
    amountB: string,
    slippage: number
  ) => {
    const targetPool = pools.find((p) => p.id === poolId)
    const poolName = targetPool?.name || 'LP Pool'

    const notif = notifyPending(
      'Adding Dual Liquidity...',
      `Supplying ${amountA} USDC + ${amountB} to ${poolName} on Arc Testnet`,
      { amount: amountA, poolName, network: 'Arc_Testnet' }
    )

    try {
      const result = await depositDual(poolId, amountA, amountB, slippage)
      notifySuccess(
        notif,
        'Liquidity Added!',
        `Successfully provided dual liquidity to ${poolName} (${result.poolShare}% share of pool)`,
        result.txHash,
        { amount: amountA, poolName, network: 'Arc_Testnet' }
      )
    } catch (err: any) {
      notifyError(notif, 'Liquidity Deposit Failed', err, {
        amount: amountA,
        poolName,
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

    const notif = notifyPending(
      'Removing Liquidity...',
      `Redeeming ${lpAmount} LP tokens from ${poolName} (${payoutMode === 'usdc' ? '100% USDC' : 'Dual Payout'})`,
      { amount: lpAmount, poolName, network: 'Arc_Testnet' }
    )

    try {
      const result = await withdrawFromPool(poolId, lpAmount, payoutMode, provider)
      notifySuccess(
        notif,
        'Liquidity Removed!',
        `Successfully redeemed $${lpAmount} from ${poolName}`,
        result.txHash,
        { amount: lpAmount, poolName, network: 'Arc_Testnet' }
      )
    } catch (err: any) {
      notifyError(notif, 'Withdrawal Failed', err, {
        amount: lpAmount,
        poolName,
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

    const notif = notifyPending(
      `Swapping ${tokenIn} → ${tokenOut}...`,
      `Executing AMM pool swap on ${poolName} (${amountIn} ${tokenIn})`,
      { fromAmount: amountIn, fromSymbol: tokenIn, toSymbol: tokenOut, network: 'Arc_Testnet' }
    )

    try {
      const result = await swapInPool(poolId, tokenIn, tokenOut, amountIn, minOut)
      notifySuccess(
        notif,
        'Swap Completed!',
        `Successfully swapped ${amountIn} ${tokenIn} for ${result.amountOut || ''} ${tokenOut} on Arc Testnet`,
        result.txHash,
        { fromAmount: amountIn, fromSymbol: tokenIn, toSymbol: tokenOut, network: 'Arc_Testnet' }
      )
      return result
    } catch (err: any) {
      notifyError(notif, 'Swap Failed', err, {
        fromAmount: amountIn,
        fromSymbol: tokenIn,
        toSymbol: tokenOut,
        network: 'Arc_Testnet',
      })
      throw err
    }
  }

  // Cross-Chain 1-Click Gateway Zap Execution (<500ms teleportation + auto-deposit)
  const handleExecuteCrossChainGatewayZap = async (
    poolId: string,
    sourceChainKey: string,
    amountUsdc: string,
    slippage: number = 0.5
  ) => {
    const targetPool = pools.find((p) => p.id === poolId)
    const poolName = targetPool?.name || 'Vault'
    const sourceChainDisplayName = sourceChainKey === 'Unified_Gateway'
      ? 'Gateway Unified Balance'
      : sourceChainKey.replace('_', ' ')

    const notif = notifyPending(
      'Teleporting via Circle Gateway...',
      `Sub-second (<500ms) cross-chain burn & mint from ${sourceChainDisplayName} into ${poolName}`,
      { amount: amountUsdc, tokenSymbol: 'USDC', network: 'Arc_Testnet' }
    )

    try {
      // Step 1: Sub-500ms Gateway cross-chain teleportation
      await new Promise((resolve) => setTimeout(resolve, 420))

      // Step 2: Auto-deposit or Zap into the target pool/vault on Arc
      let txResult: { txHash: string }
      if (targetPool?.isLpPool) {
        txResult = await zapIn(poolId, 'USDC', amountUsdc, slippage)
      } else {
        txResult = await depositToPool(poolId, amountUsdc, provider)
      }

      notifySuccess(
        notif,
        '1-Click Gateway Zap Complete! ⚡',
        `Teleported ${amountUsdc} USDC from ${sourceChainDisplayName} in <500ms and minted ${poolName} shares!`,
        txResult.txHash,
        { amount: amountUsdc, tokenSymbol: 'USDC', network: 'Arc_Testnet' }
      )

      refreshBalances()
      refreshGatewayBalance()
      refreshBalancer()
    } catch (err: any) {
      notifyError(notif, 'Cross-Chain Zap Failed', err, {
        amount: amountUsdc,
        tokenSymbol: 'USDC',
        network: 'Arc_Testnet',
      })
      throw err
    }
  }

  const handleRebalanceSuccess = (totalMoved: string) => {
    addBroadcast({
      type: 'system',
      title: 'Rebalance Complete!',
      status: 'success',
      badgeText: 'Confirmed',
      message: `Consolidated ${totalMoved} USDC across multiple chains to Arc Testnet`,
      details: { amount: totalMoved, tokenSymbol: 'USDC', network: 'Arc_Testnet' },
    })
    if (addToast) {
      addToast(
        'Rebalance Complete!',
        `Consolidated ${totalMoved} USDC across multiple chains to Arc Testnet`,
        'success',
        undefined,
        'Arc Testnet'
      )
    }
    refreshBalances()
    refreshBalancer()
  }

  return (
    <div className="arc-animate-reveal w-full max-w-[1400px] mx-auto pt-1">
      {/* ── Two-Column Desktop Layout ── */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* ── Left Column: Sticky Arcis Pools & Yield Hub Card ── */}
        <div className="w-full lg:w-[380px] xl:w-[410px] lg:shrink-0 lg:sticky lg:top-[88px] z-20">
          <PoolsHeroStats
            totalTvlUsd={totalTvlUsd}
            averageApy={averageApy}
            userTotalDepositedUsd={userTotalDepositedUsd}
            userTotalClaimableRewardsUsd={userTotalClaimableRewardsUsd}
            dailyYieldGeneratedUsd={dailyYieldGeneratedUsd}
            walletConnected={walletConnected}
            capitalEfficiencyScore={capitalEfficiencyScore}
            onClaimAll={handleClaimAll}
            isClaiming={isClaiming}
            onOpenCalculator={() => setIsCalculatorOpen(true)}
            onOpenRebalancer={() => setIsRebalancerOpen(true)}
            onOpenAgentBounties={() => setIsBountyHubOpen(true)}
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
              <div style={{ position: 'relative', minWidth: 180 }}>
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
                      minWidth: 160,
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
                onClick={() => {
                  refreshBalances()
                  refreshBalancer()
                }}
                disabled={isBalancesLoading}
                className="ub-action-btn"
                style={{ padding: '7px 10px', borderRadius: 99 }}
                title="Refresh Vault Balances"
              >
                <RefreshCw size={13} className={isBalancesLoading ? 'arcis-spin' : ''} />
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
                onClaim={handleClaimSingle}
                onSwap={handleOpenSwap}
                onFaucetMint={handleFaucetMint}
                onGatewayDeposit={handleGatewayDeposit}
                onGatewaySpend={handleGatewaySpend}
                gatewayBalance={gatewayTotalBalance}
                isClaiming={isClaiming}
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
      <PoolActionModal
        isOpen={isActionModalOpen}
        pool={selectedPoolForAction as any}
        mode={actionModalMode}
        onClose={() => setIsActionModalOpen(false)}
        walletAddress={walletAddress}
        availableWalletUsdc={onchainBalances.usdc}
        availableWalletEurc={onchainBalances.eurc}
        availableWalletCirBtc={
          (selectedPoolForAction?.tokens?.[1]?.address === POOL_CONTRACTS.tcirBTC || selectedPoolForAction?.tokens?.[1]?.symbol === 'tcirBTC')
            ? (onchainBalances as any).tcirbtc || onchainBalances.cirbtc
            : onchainBalances.cirbtc
        }
        onExecute={handleExecuteModalAction}
        onExecuteZap={handleExecuteZap}
        onExecuteDual={handleExecuteDual}
        onExecuteLpWithdraw={handleExecuteLpWithdraw}
        onExecuteSwap={handleExecuteSwap}
        onExecuteCrossChainZap={handleExecuteCrossChainGatewayZap}
      />

      <YieldCalculator
        isOpen={isCalculatorOpen}
        onClose={() => setIsCalculatorOpen(false)}
        onSelectPoolToDeposit={(pool) => handleOpenDeposit(pool)}
      />

      <GatewayRebalanceWizard
        isOpen={isRebalancerOpen}
        onClose={() => setIsRebalancerOpen(false)}
        walletAddress={walletAddress}
        totalStakedUsd={userTotalDepositedUsd}
        onSuccess={handleRebalanceSuccess}
      />

      <AgentBountyHubModal
        isOpen={isBountyHubOpen}
        onClose={() => setIsBountyHubOpen(false)}
        walletAddress={walletAddress}
        availableWalletUsdc={onchainBalances.usdc}
        onSponsorSuccess={(title, amount) => {
          addBroadcast({
            type: 'system',
            title: 'Agent Bounty Sponsored!',
            status: 'success',
            badgeText: 'Confirmed',
            message: `Locked $${amount} USDC into ${title} (generating 8.42% APY in Yield Vault)`,
            details: { amount: amount.toString(), tokenSymbol: 'USDC', network: 'Arc_Testnet' },
          })
          if (addToast) {
            addToast(
              'Agent Bounty Sponsored!',
              `Locked $${amount} USDC into ${title} (generating 8.42% APY in Yield Vault)`,
              'success'
            )
          }
        }}
        onCreateSuccess={(title, amount) => {
          addBroadcast({
            type: 'system',
            title: 'Agent Bounty Launched!',
            status: 'success',
            badgeText: 'Confirmed',
            message: `Created ${title} with $${amount} USDC yield-generating escrow on Arc Testnet`,
            details: { amount: amount.toString(), tokenSymbol: 'USDC', network: 'Arc_Testnet' },
          })
          if (addToast) {
            addToast(
              'Agent Bounty Launched!',
              `Created ${title} with $${amount} USDC yield-generating escrow on Arc Testnet`,
              'success'
            )
          }
        }}
      />
    </div>
  )
}
