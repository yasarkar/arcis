// Interactive Deposit, Withdraw & AMM Swap modal for Arcis Pools & Yield Hub (Phase 5 Enhanced).
// Supports Standard Deposit/Redeem, Cross-Chain 1-Click Gateway Zap (<500ms sub-second teleportation),
// 1-Click Single-Token Zap to LP, Dual-Asset (50/50) Deposit, Slippage tolerance controls,
// LP Withdraw options, and on-chain Pool AMM Swapping (USDC ↔ cirBTC / EURC).
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useClearOnWalletDisconnect } from '../../hooks/useClearOnWalletDisconnect'
import {
  X,
  Plus,
  Minus,
  AlertTriangle,
  RefreshCw,
  ArrowRightLeft,
  Globe,
  SlidersHorizontal,
} from 'lucide-react'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import type { PoolConfig } from '../../config/poolsConfig'
import type { UserPoolPosition } from '../../hooks/usePoolsData'
import { useGatewayBalance } from '../../hooks/useGatewayBalance'
import { GATEWAY_CHAIN_NAMES } from '../../config/gatewayConfig'
import { CHAIN_META, getChainDisplayName, getChainIconId } from '../../config/bridgeConfig'
import { ChainSelectorModal } from '../fintech'
import { isUserCanceled, formatWalletError } from '../../utils/errorUtils'
import { parseUnits, formatUnits } from 'viem'
import {
  calculateStableSwapExpectedOut,
  calculateConstantProductExpectedOut,
  calculatePriceImpactPct,
  estimateLpSharesForDeposit,
  analyzeDualDepositBalance,
  DUAL_DEPOSIT_DONATION_WARN_PCT,
  DUAL_DEPOSIT_DONATION_BLOCK_PCT,
} from '../../utils/poolMath'
import { useLiveTokenPrices } from '../../hooks/useLiveTokenPrices'
import { Tooltip } from '../common/Tooltip'
import { useAccount } from 'wagmi'
import {
  POOLS_CHAIN_DEFS,
  STABLE_SWAP_AMP,
  STABLE_SWAP_LP_FEE_BPS,
  CONSTANT_PRODUCT_LP_FEE_BPS,
  POOL_MAX_SLIPPAGE_BPS,
  poolMinOut,
  poolSlippageBps,
} from '../../config/poolsConfig'
import { ensureNetwork } from '../../services/chainSwitchService'
import { setAutoSwitchPaused } from '../../hooks/useAutoSwitchArcChain'
import { useWalletSettings } from '../../hooks/useWalletSettings'
import {
  PoolSlippagePanel,
  PoolSwapTab,
  PoolWithdrawTab,
  PoolDepositTab,
} from './actions'

export interface PoolActionModalProps {
  isOpen: boolean
  pool: (PoolConfig & { userPosition?: UserPoolPosition }) | null
  mode: 'deposit' | 'withdraw' | 'swap'
  onClose: () => void
  walletAddress: string
  availableWalletUsdc: string
  availableWalletEurc?: string
  availableWalletCirBtc?: string
  availableWalletWeth?: string
  onExecute: (poolId: string, amount: string, mode: 'deposit' | 'withdraw') => Promise<void>
  onExecuteZap?: (poolId: string, inputToken: string, inputAmount: string, slippage: number) => Promise<void>
  onExecuteDual?: (poolId: string, amountA: string, amountB: string, slippage: number) => Promise<void>
  onExecuteLpWithdraw?: (poolId: string, lpAmount: string, payoutMode: 'dual' | 'usdc', slippage: number) => Promise<void>
  onExecuteSwap?: (poolId: string, tokenIn: string, tokenOut: string, amountIn: string, minOut?: string) => Promise<{ txHash: string; amountOut: string }>
  onExecuteCrossChainZap?: (poolId: string, sourceChainKey: string, amount: string, slippage: number) => Promise<void>
}

// Arc gas reserve constant: keeps 0.50 USDC for future sub-second network fees
const ARC_GAS_RESERVE_USDC = 0.50

export default function PoolActionModal({
  isOpen,
  pool,
  mode: initialMode,
  onClose,
  walletAddress,
  availableWalletUsdc,
  availableWalletEurc = '0.00',
  availableWalletCirBtc = '0.0000',
  availableWalletWeth = '0.0000',
  onExecute,
  onExecuteZap,
  onExecuteDual,
  onExecuteLpWithdraw,
  onExecuteSwap,
  onExecuteCrossChainZap,
}: PoolActionModalProps) {
  const [activeMode, setActiveMode] = useState<'deposit' | 'withdraw' | 'swap'>(initialMode)
  const { chainId: walletChainId, connector } = useAccount()
  const [isSwitchingNetwork, setIsSwitchingNetwork] = useState(false)

  // Pause background auto-switch while this modal is open
  useEffect(() => {
    if (isOpen) {
      setAutoSwitchPaused(true)
      sessionStorage.setItem('arcis_cross_chain_active', 'true')
    }
    return () => {
      setAutoSwitchPaused(false)
      sessionStorage.removeItem('arcis_cross_chain_active')
    }
  }, [isOpen])

  // Live Token Prices
  const { data: tokenPrices } = useLiveTokenPrices()

  // Circle Gateway balances & Wallet multi-chain balances for Cross-Chain Gateway Zap
  const { totalBalance: gatewayTotalBalance, balances: gatewayBalances } = useGatewayBalance(walletAddress)

  // Deposit Source: Native Arc vs Cross-Chain 1-Click Gateway Zap
  const [depositSource, setDepositSource] = useState<'native' | 'crosschain'>('native')

  // Helper to pick preferred default source chain (highest non-Arc gateway balance, or Base_Sepolia)
  const getPreferredSourceChain = useCallback(() => {
    const validChains = (gatewayBalances || []).filter((b) => b.chainKey !== 'Arc_Testnet')
    const withBal = validChains.filter((b) => parseFloat(b.balance) > 0)
    if (withBal.length > 0) {
      const highest = withBal.reduce((prev, curr) =>
        parseFloat(curr.balance) > parseFloat(prev.balance) ? curr : prev
      , withBal[0])
      return highest.chainKey
    }
    return 'Base_Sepolia'
  }, [gatewayBalances])

  const [selectedSourceChain, setSelectedSourceChain] = useState<string>('Base_Sepolia')
  const [showChainDropdown, setShowChainDropdown] = useState<boolean>(false)

  // Standard & Zap inputs
  const [amount, setAmount] = useState<string>('')
  const [percentage, setPercentage] = useState<number>(0)

  // Helper to get Gateway balance for a given chainKey
  const getGatewayChainBalance = useCallback(
    (chainKey: string) => {
      const found = gatewayBalances?.find((b) => b.chainKey === chainKey)
      return found?.balance || '0.00'
    },
    [gatewayBalances]
  )

  // Direct source chain resolution (selectedSourceChain is always a physical EVM chain)
  const resolvedSourceChainKey = selectedSourceChain
  const effectiveSourceDef = (POOLS_CHAIN_DEFS as Record<string, any>)[resolvedSourceChainKey]

  const isCrossChainMode = activeMode === 'deposit' && depositSource === 'crosschain'
  const isWrongChainForCrossChain = Boolean(
    isCrossChainMode &&
    effectiveSourceDef &&
    walletChainId &&
    walletChainId !== effectiveSourceDef.id
  )

  const handleSwitchToSourceChain = useCallback(async () => {
    if (!effectiveSourceDef) return
    setIsSwitchingNetwork(true)
    setErrorMsg(null)
    try {
      const provider = (await connector?.getProvider()) as any
      const res = await ensureNetwork(effectiveSourceDef, provider)
      if (!res.success && !res.isCanceled) {
        setErrorMsg(res.error || `Failed to switch to ${effectiveSourceDef.name}`)
      }
    } catch (err: any) {
      setErrorMsg(err?.message || `Failed to switch to ${effectiveSourceDef.name}`)
    } finally {
      setIsSwitchingNetwork(false)
    }
  }, [effectiveSourceDef, connector])

  const isInitialPoolEmpty = Boolean(
    pool?.isLpPool && (
      pool?.tvlUsd === 0 ||
      (pool?.reserves && (pool.reserves.tokenA === 0 || pool.reserves.tokenB === 0))
    )
  )
  const [lpDepositMethod, setLpDepositMethod] = useState<'zap' | 'dual'>(
    isInitialPoolEmpty ? 'dual' : 'zap'
  )

  // Dual LP inputs
  const [amountA, setAmountA] = useState<string>('')
  const [amountB, setAmountB] = useState<string>('')

  // LP Withdraw mode
  const [lpPayoutMode, setLpPayoutMode] = useState<'usdc' | 'dual'>('usdc')

  // Wallet-scoped transaction settings (isolated per connected wallet)
  const { settings: walletSettings, updateSettings: updateWalletSettings } = useWalletSettings(walletAddress)

  // Slippage & Settings
  const [slippage, setSlippage] = useState<number>(walletSettings.poolSlippage)
  const [showSettings, setShowSettings] = useState<boolean>(false)
  const [selectedSlippageType, setSelectedSlippageType] = useState<'0.1' | '0.5' | '1.0' | 'custom'>(
    walletSettings.poolSlippageType
  )
  const [customSlippage, setCustomSlippage] = useState<string>(walletSettings.poolCustomSlippage || '')

  useEffect(() => {
    setSelectedSlippageType(walletSettings.poolSlippageType)
    setCustomSlippage(walletSettings.poolCustomSlippage || '')
    setSlippage(walletSettings.poolSlippage)
  }, [walletSettings.poolSlippageType, walletSettings.poolCustomSlippage, walletSettings.poolSlippage])

  useEffect(() => {
    if (selectedSlippageType === 'custom') {
      const parsed = parseFloat(customSlippage)
      if (!isNaN(parsed) && parsed > 0) {
        setSlippage(Math.min(parsed, POOL_MAX_SLIPPAGE_BPS / 100))
      }
    } else {
      setSlippage(parseFloat(selectedSlippageType))
    }
  }, [selectedSlippageType, customSlippage])

  // AMM Swap state
  const [swapTokenIn, setSwapTokenIn] = useState<string>('USDC')
  const [swapTokenOut, setSwapTokenOut] = useState<string>('cirBTC')
  const [swapAmountIn, setSwapAmountIn] = useState<string>('')

  // Reset form inputs
  const resetFormInputs = useCallback(() => {
    setAmount('')
    setPercentage(0)
    setAmountA('')
    setAmountB('')
    setSwapAmountIn('')
    setErrorMsg(null)
    setIsCanceledError(false)
  }, [])

  useClearOnWalletDisconnect(resetFormInputs)

  useEffect(() => {
    if (!walletAddress) {
      resetFormInputs()
    }
  }, [walletAddress, resetFormInputs])

  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isCanceledError, setIsCanceledError] = useState<boolean>(false)

  const clearError = () => {
    setErrorMsg(null)
    setIsCanceledError(false)
  }

  const handleActionError = (err: any, fallbackMessage: string) => {
    if (isUserCanceled(err) || err?.isCanceled === true) {
      setIsCanceledError(true)
      setErrorMsg('You canceled the confirmation request in your wallet. No balance was deducted.')
    } else {
      setIsCanceledError(false)
      const formatted = formatWalletError(err)
      setErrorMsg(formatted || err?.shortMessage || err?.message || fallbackMessage)
    }
  }

  useEffect(() => {
    setActiveMode(initialMode)
    setDepositSource('native')
    setSelectedSourceChain(getPreferredSourceChain())
    setAmount('')
    setAmountA('')
    setAmountB('')
    setSwapAmountIn('')
    setPercentage(0)
    clearError()
    const isModalPoolEmpty = Boolean(
      pool?.isLpPool && (
        pool?.tvlUsd === 0 ||
        (pool?.reserves && (pool.reserves.tokenA === 0 || pool.reserves.tokenB === 0))
      )
    )
    setLpDepositMethod(isModalPoolEmpty ? 'dual' : 'zap')
    setLpPayoutMode('usdc')
    setShowSettings(false)
    setSelectedSlippageType(walletSettings.poolSlippageType)
    setCustomSlippage(walletSettings.poolCustomSlippage || '')

    if (pool?.tokens && pool.tokens.length >= 2) {
      setSwapTokenIn(pool.tokens[0].symbol)
      setSwapTokenOut(pool.tokens[1].symbol)
    }
  }, [initialMode, pool, isOpen, getPreferredSourceChain, walletSettings.poolSlippageType, walletSettings.poolCustomSlippage])

  // Cross-Chain balance on selected source chain
  const crossChainBalNum = useMemo(() => {
    return parseFloat(getGatewayChainBalance(selectedSourceChain) || '0')
  }, [selectedSourceChain, getGatewayChainBalance])

  if (!isOpen || !pool) return null

  const isLp = Boolean(pool.isLpPool)
  const isPool = isLp
  const isVault = pool.category === 'vault'
  const isPoolEmpty = Boolean(
    isLp && (
      pool.tvlUsd === 0 ||
      (pool.reserves && (pool.reserves.tokenA === 0 || pool.reserves.tokenB === 0))
    )
  )
  const userStaked = parseFloat(pool.userPosition?.stakedAmount || '0')
  const walletBalUsdc = parseFloat(availableWalletUsdc || '0')
  const walletBalEurc = parseFloat(availableWalletEurc || '0')
  const walletBalCirBtc = parseFloat(availableWalletCirBtc || '0')
  const walletBalWeth = parseFloat(availableWalletWeth || '0')

  const tokenA = pool.tokens[0]
  const tokenASymbol = tokenA?.symbol || 'USDC'
  const isTokenAEurc = tokenASymbol === 'EURC'
  const tokenAIcon = isTokenAEurc ? EurcIcon : UsdcIcon
  const availableWalletTokenA = isTokenAEurc ? (availableWalletEurc || '0.00') : availableWalletUsdc
  const walletBalTokenA = isTokenAEurc ? walletBalEurc : walletBalUsdc

  const livePoolRate = pool?.reserves && pool.reserves.tokenB > 0 && pool.reserves.tokenA > 0
    ? pool.reserves.tokenA / pool.reserves.tokenB
    : 0

  const fallbackExchangeRate = useMemo(() => {
    if (pool.exchangeRate && pool.exchangeRate > 0) return pool.exchangeRate
    if (pool.id === 'eurc-weth-pool') {
      const wethUsd = tokenPrices?.weth || 2600
      const eurcUsd = tokenPrices?.eurc || 1.08
      return eurcUsd > 0 ? wethUsd / eurcUsd : 2400
    }
    if (pool.id === 'usdc-weth-pool') {
      return tokenPrices?.weth || 2600
    }
    if (pool.id === 'usdc-cirbtc-pool') {
      return tokenPrices?.cirbtc || 65000
    }
    if (pool.id === 'usdc-eurc-stable-pool') {
      const eurcUsd = tokenPrices?.eurc || 1.08
      return eurcUsd > 0 ? 1 / eurcUsd : 0.92
    }
    return 1
  }, [pool.id, pool.exchangeRate, tokenPrices])

  const exchangeRate = livePoolRate > 0 ? livePoolRate : fallbackExchangeRate
  const counterToken = pool.tokens[1]
  const counterTokenSymbol = counterToken?.symbol || 'cirBTC'
  const counterTokenDecimals = counterToken?.decimals || (counterTokenSymbol === 'WETH' ? 18 : counterTokenSymbol === 'cirBTC' ? 8 : 6)
  const feePercent = pool.feeTierPercent || (pool.id === 'usdc-weth-pool' ? 0.30 : pool.id === 'usdc-eurc-stable-pool' ? 0.12 : 0.25)
  const crossChainBalStr = crossChainBalNum.toFixed(2)

  const maxAvailable = activeMode === 'deposit'
    ? depositSource === 'crosschain'
      ? crossChainBalNum
      : walletBalTokenA
    : userStaked

  const maxAvailableStr = activeMode === 'deposit'
    ? depositSource === 'crosschain'
      ? `${crossChainBalStr} USDC (${GATEWAY_CHAIN_NAMES[selectedSourceChain] || selectedSourceChain})`
      : `${availableWalletTokenA} ${tokenASymbol}`
    : `${userStaked.toFixed(2)} USD`

  const depositTokenSymbol = activeMode === 'withdraw'
    ? (isVault ? 'USDC' : 'USD')
    : depositSource === 'crosschain'
      ? 'USDC'
      : isLp && lpDepositMethod === 'zap'
        ? 'USDC'
        : pool.tokens[0]?.symbol || 'USDC'

  const depositLabel = activeMode === 'withdraw'
    ? (isVault ? 'AMOUNT OF USDC TO REDEEM' : 'AMOUNT TO WITHDRAW (USD)')
    : 'AMOUNT TO DEPOSIT'

  const numericBalanceStr = activeMode === 'deposit'
    ? (depositSource === 'crosschain' ? crossChainBalStr : availableWalletUsdc)
    : userStaked.toFixed(2)

  // Swap wallet balance
  const swapWalletBalTokenIn = swapTokenIn === 'USDC'
    ? walletBalUsdc
    : swapTokenIn === 'EURC'
      ? walletBalEurc
      : swapTokenIn === 'WETH'
        ? walletBalWeth
        : walletBalCirBtc

  const swapWalletBalTokenInStr = swapTokenIn === 'USDC' || swapTokenIn === 'EURC'
    ? swapWalletBalTokenIn.toFixed(2)
    : swapTokenIn === 'WETH'
      ? (swapWalletBalTokenIn > 0 && swapWalletBalTokenIn < 0.0001 ? swapWalletBalTokenIn.toFixed(6) : swapWalletBalTokenIn.toFixed(4))
      : (swapWalletBalTokenIn > 0 && swapWalletBalTokenIn < 0.0001 ? swapWalletBalTokenIn.toFixed(8) : swapWalletBalTokenIn.toFixed(6))

  const aNum = parseFloat(amountA) || 0
  const bNum = parseFloat(amountB) || 0
  const counterWalletBal = counterTokenSymbol === 'EURC'
    ? walletBalEurc
    : counterTokenSymbol === 'WETH'
      ? walletBalWeth
      : walletBalCirBtc
  const counterWalletBalStr = counterTokenSymbol === 'EURC'
    ? availableWalletEurc
    : counterTokenSymbol === 'WETH'
      ? availableWalletWeth
      : availableWalletCirBtc

  const isDualMode = isLp && lpDepositMethod === 'dual' && depositSource === 'native'
  const isDualIncomplete = isDualMode && (aNum <= 0 || bNum <= 0)
  const isDualInsuffA = isDualMode && aNum > walletBalTokenA
  const isDualInsuffB = isDualMode && bNum > counterWalletBal

  const isZapUnavailable = Boolean(
    isLp && isPoolEmpty && (
      (depositSource === 'native' && lpDepositMethod === 'zap') ||
      depositSource === 'crosschain'
    )
  )

  const isSwapUnavailable = Boolean(activeMode === 'swap' && isPoolEmpty)

  const isCanceled = Boolean(
    isCanceledError ||
    (errorMsg && (
      errorMsg === 'You canceled the confirmation request in your wallet. No balance was deducted.' ||
      errorMsg.toLowerCase().includes('canceled the confirmation request') ||
      errorMsg.toLowerCase().includes('user rejected') ||
      errorMsg.toLowerCase().includes('user denied')
    ))
  )

  // Swap output calculation
  const swapAmountInNum = parseFloat(swapAmountIn) || 0
  let calculatedSwapOut = ''
  let minSwapOutStr = ''

  if (swapAmountInNum > 0) {
    const feeMultiplier = (100 - feePercent) / 100
    const netIn = swapAmountInNum * feeMultiplier

    const hasReserves = Boolean(
      pool.reserves &&
      pool.reserves.tokenA > 0 &&
      pool.reserves.tokenB > 0
    )

    if (swapTokenIn === 'USDC') {
      if (hasReserves && pool.reserves) {
        if (pool.id === 'usdc-eurc-stable-pool') {
          try {
            const rawInBig = parseUnits(swapAmountInNum.toFixed(6), 6)
            const resABig = parseUnits(pool.reserves.tokenA.toFixed(6), 6)
            const resBBig = parseUnits(pool.reserves.tokenB.toFixed(6), 6)
            const outBig = calculateStableSwapExpectedOut(rawInBig, resABig, resBBig, STABLE_SWAP_LP_FEE_BPS, STABLE_SWAP_AMP)
            calculatedSwapOut = formatUnits(outBig, 6)
            const minOutBig = poolMinOut(outBig, poolSlippageBps(slippage))
            minSwapOutStr = formatUnits(minOutBig, 6)
          } catch {
            const rawOut = (pool.reserves.tokenB * netIn) / (pool.reserves.tokenA + netIn)
            calculatedSwapOut = rawOut.toFixed(2)
            minSwapOutStr = (rawOut * ((100 - slippage) / 100)).toFixed(2)
          }
        } else {
          try {
            const rawInBig = parseUnits(swapAmountInNum.toFixed(6), 6)
            const resABig = parseUnits(pool.reserves.tokenA.toFixed(6), 6)
            const resBBig = parseUnits(pool.reserves.tokenB.toFixed(counterTokenDecimals), counterTokenDecimals)
            const outBig = calculateConstantProductExpectedOut(rawInBig, resABig, resBBig, CONSTANT_PRODUCT_LP_FEE_BPS)
            calculatedSwapOut = formatUnits(outBig, counterTokenDecimals)
            const minOutBig = poolMinOut(outBig, poolSlippageBps(slippage))
            minSwapOutStr = formatUnits(minOutBig, counterTokenDecimals)
          } catch {
            const rawOut = (pool.reserves.tokenB * netIn) / (pool.reserves.tokenA + netIn)
            calculatedSwapOut = rawOut.toFixed(counterTokenDecimals)
            minSwapOutStr = (rawOut * ((100 - slippage) / 100)).toFixed(counterTokenDecimals)
          }
        }
      } else if (exchangeRate > 0) {
        const rawOut = (swapAmountInNum / exchangeRate) * feeMultiplier
        calculatedSwapOut = rawOut.toFixed(counterTokenDecimals)
        minSwapOutStr = (rawOut * ((100 - slippage) / 100)).toFixed(counterTokenDecimals)
      }
    } else {
      if (hasReserves && pool.reserves) {
        if (pool.id === 'usdc-eurc-stable-pool') {
          try {
            const rawInBig = parseUnits(swapAmountInNum.toFixed(6), 6)
            const resBBig = parseUnits(pool.reserves.tokenB.toFixed(6), 6)
            const resABig = parseUnits(pool.reserves.tokenA.toFixed(6), 6)
            const outBig = calculateStableSwapExpectedOut(rawInBig, resBBig, resABig, STABLE_SWAP_LP_FEE_BPS, STABLE_SWAP_AMP)
            calculatedSwapOut = formatUnits(outBig, 6)
            const minOutBig = poolMinOut(outBig, poolSlippageBps(slippage))
            minSwapOutStr = formatUnits(minOutBig, 6)
          } catch {
            const rawOut = (pool.reserves.tokenA * netIn) / (pool.reserves.tokenB + netIn)
            calculatedSwapOut = rawOut.toFixed(2)
            minSwapOutStr = (rawOut * ((100 - slippage) / 100)).toFixed(2)
          }
        } else {
          try {
            const rawInBig = parseUnits(swapAmountInNum.toFixed(counterTokenDecimals), counterTokenDecimals)
            const resBBig = parseUnits(pool.reserves.tokenB.toFixed(counterTokenDecimals), counterTokenDecimals)
            const resABig = parseUnits(pool.reserves.tokenA.toFixed(6), 6)
            const outBig = calculateConstantProductExpectedOut(rawInBig, resBBig, resABig, CONSTANT_PRODUCT_LP_FEE_BPS)
            calculatedSwapOut = formatUnits(outBig, 6)
            const minOutBig = poolMinOut(outBig, poolSlippageBps(slippage))
            minSwapOutStr = formatUnits(minOutBig, 6)
          } catch {
            const rawOut = (pool.reserves.tokenA * netIn) / (pool.reserves.tokenB + netIn)
            calculatedSwapOut = rawOut.toFixed(2)
            minSwapOutStr = (rawOut * ((100 - slippage) / 100)).toFixed(2)
          }
        }
      } else if (exchangeRate > 0) {
        const rawOut = (swapAmountInNum * exchangeRate) * feeMultiplier
        calculatedSwapOut = rawOut.toFixed(2)
        minSwapOutStr = (rawOut * ((100 - slippage) / 100)).toFixed(2)
      }
    }
  }

  // Real price impact (derived from live reserves)
  const priceImpactPct = (swapAmountInNum > 0 && pool.reserves)
    ? calculatePriceImpactPct(
        swapAmountInNum,
        swapTokenIn === 'USDC' ? pool.reserves.tokenA : pool.reserves.tokenB,
        swapTokenIn === 'USDC' ? pool.reserves.tokenB : pool.reserves.tokenA,
        pool.id === 'usdc-eurc-stable-pool',
        STABLE_SWAP_AMP
      )
    : 0

  const handleFlipSwapDirection = () => {
    const tempIn = swapTokenIn
    setSwapTokenIn(swapTokenOut)
    setSwapTokenOut(tempIn)
    setSwapAmountIn('')
    setErrorMsg(null)
  }

  const handleAmountAChange = (val: string) => {
    setAmountA(val)
    setErrorMsg(null)
    const num = parseFloat(val)
    if (!isNaN(num) && num > 0 && exchangeRate > 0) {
      const bDecimals = counterTokenDecimals
      const requiredB = (num / exchangeRate).toFixed(bDecimals)
      setAmountB(requiredB)
    } else {
      setAmountB('')
    }
  }

  const handleAmountBChange = (val: string) => {
    setAmountB(val)
    setErrorMsg(null)
    const num = parseFloat(val)
    if (!isNaN(num) && num > 0 && exchangeRate > 0) {
      const requiredA = (num * exchangeRate).toFixed(2)
      setAmountA(requiredA)
    } else {
      setAmountA('')
    }
  }

  const handlePercentageChange = (pct: number) => {
    setPercentage(pct)
    if (maxAvailable <= 0) {
      setAmount('0.00')
      return
    }

    if (activeMode === 'deposit') {
      if (depositSource === 'native') {
        if (pct === 100) {
          const maxDepositWithGas = Math.max(0, maxAvailable - ARC_GAS_RESERVE_USDC)
          setAmount(maxDepositWithGas.toFixed(2))
          if (isLp && lpDepositMethod === 'dual') {
            const halfUsdc = (maxDepositWithGas / 2).toFixed(2)
            handleAmountAChange(halfUsdc)
          }
        } else {
          const calculated = (maxAvailable * (pct / 100)).toFixed(2)
          setAmount(calculated)
          if (isLp && lpDepositMethod === 'dual') {
            const halfUsdc = (parseFloat(calculated) / 2).toFixed(2)
            handleAmountAChange(halfUsdc)
          }
        }
      } else {
        const calculated = (maxAvailable * (pct / 100)).toFixed(2)
        setAmount(calculated)
      }
    } else {
      if (pct === 100) {
        setAmount(userStaked.toFixed(2))
      } else {
        const calculated = (userStaked * (pct / 100)).toFixed(2)
        setAmount(calculated)
      }
    }
    setErrorMsg(null)
  }

  const handleAmountInputChange = (val: string) => {
    setAmount(val)
    setErrorMsg(null)
    const num = parseFloat(val)
    if (!isNaN(num) && maxAvailable > 0) {
      const pct = Math.min(100, Math.max(0, (num / maxAvailable) * 100))
      setPercentage(Math.round(pct))
    } else {
      setPercentage(0)
    }
  }

  const inputAmountNum = isLp && lpDepositMethod === 'dual' && depositSource === 'native'
    ? (parseFloat(amountA) || 0) + ((parseFloat(amountB) || 0) * exchangeRate)
    : parseFloat(amount) || 0

  const annualYield = (inputAmountNum * pool.apy) / 100
  const dailyYield = annualYield / 365

  const previewTotalLp = parseFloat((pool as any).totalLp || '0') || 0
  const previewReserveA = pool.reserves?.tokenA || 0
  const previewReserveB = pool.reserves?.tokenB || 0

  const zapCounterOut = (() => {
    if (!(previewTotalLp > 0) || !(previewReserveA > 0) || !(previewReserveB > 0)) return 0
    const half = inputAmountNum / 2
    if (!(half > 0)) return 0
    try {
      if (pool.id === 'usdc-eurc-stable-pool') {
        return parseFloat(formatUnits(
          calculateStableSwapExpectedOut(
            parseUnits(half.toFixed(6), 6),
            parseUnits(previewReserveA.toFixed(6), 6),
            parseUnits(previewReserveB.toFixed(6), 6),
            STABLE_SWAP_LP_FEE_BPS,
            STABLE_SWAP_AMP
          ),
          6
        ))
      }
      return parseFloat(formatUnits(
        calculateConstantProductExpectedOut(
          parseUnits(half.toFixed(6), 6),
          parseUnits(previewReserveA.toFixed(6), 6),
          parseUnits(previewReserveB.toFixed(counterTokenDecimals), counterTokenDecimals),
          CONSTANT_PRODUCT_LP_FEE_BPS
        ),
        counterTokenDecimals
      ))
    } catch {
      return 0
    }
  })()

  const lpPreview = (() => {
    const isSeedingInitialLiquidity = Boolean(previewTotalLp === 0 || previewReserveA === 0 || previewReserveB === 0)
    if (isSeedingInitialLiquidity) {
      if (isLp && lpDepositMethod === 'dual' && depositSource === 'native' && aNum > 0 && bNum > 0) {
        return estimateLpSharesForDeposit({
          poolId: pool.id,
          amountA: aNum,
          amountB: bNum,
          reserveA: 0,
          reserveB: 0,
          totalLp: 0,
          amp: STABLE_SWAP_AMP,
          allowInitialSeed: true,
        })
      }
      return null
    }
    if (isLp && lpDepositMethod === 'dual' && depositSource === 'native') {
      return estimateLpSharesForDeposit({
        poolId: pool.id,
        amountA: aNum,
        amountB: bNum,
        reserveA: previewReserveA,
        reserveB: previewReserveB,
        totalLp: previewTotalLp,
        amp: STABLE_SWAP_AMP,
      })
    }
    if (isLp && zapCounterOut > 0) {
      return estimateLpSharesForDeposit({
        poolId: pool.id,
        amountA: inputAmountNum / 2,
        amountB: zapCounterOut,
        reserveA: previewReserveA,
        reserveB: previewReserveB,
        totalLp: previewTotalLp,
        amp: STABLE_SWAP_AMP,
      })
    }
    return null
  })()

  const estimatedLpMinted = lpPreview ? lpPreview.shares.toFixed(2) : ''

  const estimatedPoolShare = isLp
    ? (lpPreview && lpPreview.shares > 0
        ? (previewTotalLp === 0
            ? '100.00'
            : ((lpPreview.shares / lpPreview.totalLpAfter) * 100).toFixed(2))
        : '')
    : (inputAmountNum > 0 && pool.tvlUsd + inputAmountNum > 0
        ? ((inputAmountNum / (pool.tvlUsd + inputAmountNum)) * 100).toFixed(2)
        : '')

  const withdrawAssetReturns = useMemo(() => {
    if (!isLp || activeMode !== 'withdraw' || inputAmountNum <= 0 || userStaked <= 0) return null
    try {
      const ratio = Math.min(1, inputAmountNum / userStaked)
      const tokenAStaked = parseFloat(pool.userPosition?.tokenAStaked || '0')
      const tokenBStaked = parseFloat(pool.userPosition?.tokenBStaked || '0')

      let outA = tokenAStaked * ratio
      let outB = tokenBStaked * ratio

      if (outA === 0 && outB === 0 && previewReserveA > 0 && previewTotalLp > 0) {
        const poolShare = (parseFloat(pool.userPosition?.poolSharePct?.toString() || '0') / 100) * ratio
        outA = previewReserveA * poolShare
        outB = previewReserveB * poolShare
      }
      return {
        amountA: outA.toFixed(2),
        amountB: outB.toFixed(counterTokenDecimals === 8 ? 6 : 2),
      }
    } catch {
      return null
    }
  }, [isLp, activeMode, inputAmountNum, userStaked, pool.userPosition, previewReserveA, previewReserveB, previewTotalLp, counterTokenDecimals])

  // O2 guard: analyze dual deposit ratio
  const dualDepositBalance = useMemo(() => {
    if (!isDualMode || aNum <= 0 || bNum <= 0) return null
    return analyzeDualDepositBalance({
      poolId: pool.id,
      amountA: aNum,
      amountB: bNum,
      reserveA: previewReserveA,
      reserveB: previewReserveB,
      totalLp: previewTotalLp,
      amp: STABLE_SWAP_AMP,
    })
  }, [isDualMode, aNum, bNum, pool.id, previewReserveA, previewReserveB, previewTotalLp])

  const donationPct = dualDepositBalance ? dualDepositBalance.donationPct : 0
  const isDualDonationWarn = Boolean(dualDepositBalance && donationPct >= DUAL_DEPOSIT_DONATION_WARN_PCT)
  const isDualDonationBlock = Boolean(dualDepositBalance && donationPct > DUAL_DEPOSIT_DONATION_BLOCK_PCT)

  const isSingleDepositInsuff = Boolean(
    activeMode === 'deposit' &&
    !isDualMode &&
    inputAmountNum > 0 &&
    inputAmountNum > (depositSource === 'crosschain' ? crossChainBalNum : walletBalTokenA)
  )

  const isWithdrawExceeds = Boolean(
    activeMode === 'withdraw' &&
    inputAmountNum > 0 &&
    inputAmountNum > (userStaked + 0.01)
  )

  const isSubmitDisabled = Boolean(
    isProcessing ||
    isSwitchingNetwork ||
    (activeMode === 'swap'
      ? isSwapUnavailable || swapAmountInNum <= 0 || swapAmountInNum > swapWalletBalTokenIn
      : activeMode === 'withdraw'
        ? inputAmountNum <= 0 || isWithdrawExceeds
        : isDualMode
          ? isDualIncomplete || isDualInsuffA || isDualInsuffB || isDualDonationBlock
          : isWrongChainForCrossChain
            ? false
            : isZapUnavailable || inputAmountNum <= 0 || isSingleDepositInsuff)
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    if (isWrongChainForCrossChain) {
      await handleSwitchToSourceChain()
      return
    }

    if (activeMode === 'swap') {
      if (isPoolEmpty) {
        setErrorMsg('Cannot swap: This AMM pool currently has 0 reserves on Arc Testnet. Please supply liquidity first via Dual-Asset Deposit.')
        return
      }
      if (swapAmountInNum <= 0) {
        setErrorMsg('Please enter a valid swap amount greater than 0.')
        return
      }
      if (swapAmountInNum > swapWalletBalTokenIn) {
        setErrorMsg(`Insufficient ${swapTokenIn} balance (${swapWalletBalTokenInStr} ${swapTokenIn} available).`)
        return
      }

      setIsProcessing(true)
      try {
        if (onExecuteSwap) {
          await onExecuteSwap(pool.id, swapTokenIn, swapTokenOut, swapAmountIn, minSwapOutStr)
        }
        onClose()
      } catch (err: any) {
        console.error('[PoolActionModal] Swap Error:', err)
        handleActionError(err, 'Swap transaction failed on Arc Testnet.')
      } finally {
        setIsProcessing(false)
      }
      return
    }

    if (activeMode === 'deposit') {
      if (depositSource === 'crosschain') {
        if (isLp && isPoolEmpty) {
          setErrorMsg(
            `Single-token liquidity is unavailable: This pool currently has 0 reserves on Arc Testnet. Adding liquidity with a single token requires existing reserves to auto-balance into ${counterTokenSymbol}. Please supply both assets via Dual-Asset Deposit.`
          )
          return
        }
        if (inputAmountNum <= 0) {
          setErrorMsg('Please enter a valid deposit amount greater than 0.')
          return
        }
        if (inputAmountNum > crossChainBalNum) {
          setErrorMsg(`Amount exceeds your balance of ${crossChainBalStr} USDC on ${GATEWAY_CHAIN_NAMES[selectedSourceChain] || selectedSourceChain}.`)
          return
        }

        setIsProcessing(true)
        try {
          if (onExecuteCrossChainZap) {
            await onExecuteCrossChainZap(pool.id, resolvedSourceChainKey, amount, slippage)
          } else if (isLp && onExecuteZap) {
            await onExecuteZap(pool.id, 'USDC', amount, slippage)
          } else {
            await onExecute(pool.id, amount, 'deposit')
          }
          onClose()
        } catch (err: any) {
          console.error('[PoolActionModal] Cross-Chain Zap Error:', err)
          handleActionError(err, 'Cross-Chain Zap transaction failed.')
        } finally {
          setIsProcessing(false)
        }
        return
      }

      if (isLp && lpDepositMethod === 'dual') {
        if (aNum <= 0 || bNum <= 0) {
          setErrorMsg('Please enter valid amounts for both tokens in the dual deposit.')
          return
        }
        if (aNum > walletBalTokenA) {
          setErrorMsg(`Insufficient ${tokenASymbol} balance (${availableWalletTokenA} ${tokenASymbol} available).`)
          return
        }
        if (bNum > counterWalletBal) {
          setErrorMsg(`Insufficient ${counterTokenSymbol} balance (${counterWalletBalStr} ${counterTokenSymbol} available).`)
          return
        }

        setIsProcessing(true)
        try {
          if (onExecuteDual) {
            await onExecuteDual(pool.id, amountA, amountB, slippage)
          } else {
            await onExecute(pool.id, inputAmountNum.toString(), 'deposit')
          }
          onClose()
        } catch (err: any) {
          console.error('[PoolActionModal] Dual Deposit Error:', err)
          handleActionError(err, 'Transaction failed on Arc Testnet.')
        } finally {
          setIsProcessing(false)
        }
        return
      }

      if (inputAmountNum <= 0) {
        setErrorMsg('Please enter a valid amount greater than 0.')
        return
      }
      if (inputAmountNum > maxAvailable) {
        setErrorMsg(`Amount exceeds your available wallet balance of ${maxAvailableStr}.`)
        return
      }

      if (isLp && lpDepositMethod === 'zap' && isPoolEmpty) {
        setErrorMsg(
          `Single-token liquidity is unavailable: This pool currently has 0 reserves on Arc Testnet. Please supply both assets via Dual-Asset Deposit or deposit single-sided USDC into the USDC Yield Vault.`
        )
        return
      }

      setIsProcessing(true)
      try {
        if (isLp && onExecuteZap) {
          await onExecuteZap(pool.id, 'USDC', amount, slippage)
        } else {
          await onExecute(pool.id, amount, 'deposit')
        }
        onClose()
      } catch (err: any) {
        console.error('[PoolActionModal] Deposit Error:', err)
        handleActionError(err, 'Transaction failed on Arc Testnet.')
      } finally {
        setIsProcessing(false)
      }
    } else {
      if (inputAmountNum <= 0) {
        setErrorMsg('Please enter a valid withdrawal amount.')
        return
      }
      if (inputAmountNum > (userStaked + 0.01)) {
        setErrorMsg(`Withdrawal amount exceeds your deposited balance of $${userStaked.toFixed(2)}.`)
        return
      }

      let finalAmount = amount

      setIsProcessing(true)
      try {
        if (isLp && onExecuteLpWithdraw) {
          await onExecuteLpWithdraw(pool.id, finalAmount, lpPayoutMode, slippage)
        } else {
          await onExecute(pool.id, finalAmount, 'withdraw')
        }
        onClose()
      } catch (err: any) {
        console.error('[PoolActionModal] Withdraw Error:', err)
        handleActionError(err, 'Withdrawal failed on Arc Testnet.')
      } finally {
        setIsProcessing(false)
      }
    }
  }

  const sourceChainsList = useMemo(() => {
    const list = [
      { chain: 'Base_Sepolia', name: 'Base Sepolia', balance: getGatewayChainBalance('Base_Sepolia') },
      { chain: 'Ethereum_Sepolia', name: 'Ethereum Sepolia', balance: getGatewayChainBalance('Ethereum_Sepolia') },
      { chain: 'Arbitrum_Sepolia', name: 'Arbitrum Sepolia', balance: getGatewayChainBalance('Arbitrum_Sepolia') },
      { chain: 'Optimism_Sepolia', name: 'Optimism Sepolia', balance: getGatewayChainBalance('Optimism_Sepolia') },
      { chain: 'Polygon_Amoy_Testnet', name: 'Polygon PoS Amoy', balance: getGatewayChainBalance('Polygon_Amoy_Testnet') },
      { chain: 'Avalanche_Fuji', name: 'Avalanche Fuji', balance: getGatewayChainBalance('Avalanche_Fuji') },
    ]
    return [...list].sort((a, b) => {
      const balA = parseFloat(a.balance || '0')
      const balB = parseFloat(b.balance || '0')
      if (balB !== balA) return balB - balA
      return a.name.localeCompare(b.name)
    })
  }, [getGatewayChainBalance])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[999] flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
        style={{
          background: 'rgba(5, 7, 15, 0.78)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && !isProcessing) onClose()
        }}
      >
        <div
          className="relative w-full max-w-[580px] my-auto rounded-3xl overflow-hidden shadow-2xl transition-all border animate-in fade-in zoom-in-95 duration-200"
          style={{
            maxHeight: 'min(90vh, 880px)',
            overflowY: 'auto',
            background: 'linear-gradient(180deg, rgba(20, 24, 44, 0.96) 0%, rgba(12, 14, 26, 0.98) 100%)',
            borderColor: 'rgba(152, 150, 255, 0.35)',
            boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 40px rgba(99, 102, 241, 0.15)',
            borderRadius: 24,
            padding: '28px',
            position: 'relative',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Glow ambient header accent */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-24 bg-gradient-to-r from-blue-500/20 via-indigo-500/30 to-purple-500/20 blur-3xl pointer-events-none" />

          {/* Top-Right Controls */}
          <div
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              zIndex: 10,
            }}
          >
            <Tooltip content="Slippage & Pool Settings" position="bottom" align="end">
              <button
                onClick={() => setShowSettings((prev) => !prev)}
                disabled={isProcessing}
                type="button"
                className="ub-action-btn"
                style={{
                  padding: 8,
                  borderRadius: '50%',
                  background: showSettings ? 'rgba(152, 150, 255, 0.25)' : undefined,
                  borderColor: showSettings ? 'rgba(152, 150, 255, 0.5)' : undefined,
                  color: showSettings ? '#fff' : 'var(--fp-3)',
                  transition: 'all 0.15s ease',
                }}
              >
                <SlidersHorizontal size={15} />
              </button>
            </Tooltip>

            <button
              onClick={onClose}
              disabled={isProcessing}
              type="button"
              className="ub-action-btn"
              style={{
                padding: 8,
                borderRadius: '50%',
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Modal Header */}
          <div style={{ marginBottom: 16, paddingRight: 40 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                className="arc-eyebrow"
                style={{ fontSize: 12, color: 'var(--purple-1)', fontWeight: 600, letterSpacing: '1.5px' }}
              >
                {pool.name.toUpperCase()}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--fonts--space-grotesk)',
                  fontWeight: 700,
                  color: 'var(--earned-green)',
                  background: 'rgba(1, 208, 98, 0.15)',
                  border: '1px solid rgba(1, 208, 98, 0.3)',
                  padding: '1px 8px',
                  borderRadius: 99,
                }}
              >
                {pool.apy}% {pool.apyType}
              </span>
            </div>

            <h2
              style={{
                margin: 0,
                fontSize: 22,
                fontFamily: 'var(--fonts--space-grotesk)',
                fontWeight: 600,
                color: '#fff',
              }}
            >
              {activeMode === 'deposit'
                ? depositSource === 'crosschain'
                  ? isPool
                    ? 'Add Cross-Chain Liquidity'
                    : 'Cross-Chain Deposit'
                  : isPool
                    ? 'Add Liquidity'
                    : 'Deposit'
                : activeMode === 'withdraw'
                  ? isPool
                    ? 'Remove Liquidity'
                    : isVault
                      ? 'Redeem'
                      : 'Withdraw'
                  : `Swap (${pool.tokens[0]?.symbol} ↔ ${pool.tokens[1]?.symbol})`}
            </h2>
          </div>

          {/* Collapsible Slippage Settings Panel */}
          <PoolSlippagePanel
            showSettings={showSettings}
            slippage={slippage}
            selectedSlippageType={selectedSlippageType}
            customSlippage={customSlippage}
            onSelectSlippageType={(type) => {
              setSelectedSlippageType(type)
              if (type !== 'custom') {
                setCustomSlippage('')
                const num = parseFloat(type)
                updateWalletSettings({ poolSlippageType: type, poolCustomSlippage: '', poolSlippage: num })
              } else {
                updateWalletSettings({ poolSlippageType: 'custom' })
              }
            }}
            onChangeCustomSlippage={(val) => {
              const numVal = parseFloat(val)
              const maxPercent = POOL_MAX_SLIPPAGE_BPS / 100
              const finalVal = !isNaN(numVal) && numVal > maxPercent ? String(maxPercent) : val
              setCustomSlippage(finalVal)
              const parsedNum = parseFloat(finalVal)
              const safeNum = !isNaN(parsedNum) && parsedNum > 0 ? Math.min(parsedNum, maxPercent) : 0.5
              updateWalletSettings({ poolCustomSlippage: finalVal, poolSlippageType: 'custom', poolSlippage: safeNum })
            }}
          />

          {/* Main Mode Switcher */}
          <div
            style={{
              display: 'flex',
              background: 'rgba(11, 13, 24, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 14,
              padding: 4,
              marginBottom: 16,
              gap: 4,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setActiveMode('deposit')
                setAmount('')
                setAmountA('')
                setAmountB('')
                setPercentage(0)
                setErrorMsg(null)
              }}
              disabled={isProcessing}
              style={{
                flex: 1,
                padding: '9px 0',
                borderRadius: 10,
                border: 'none',
                fontSize: 13,
                fontFamily: 'var(--font-app)',
                fontWeight: activeMode === 'deposit' ? 600 : 500,
                color: activeMode === 'deposit' ? '#fff' : 'var(--fp-3)',
                background:
                  activeMode === 'deposit'
                    ? 'linear-gradient(135deg, rgba(152, 150, 255, 0.25) 0%, rgba(99, 102, 241, 0.3) 100%)'
                    : 'transparent',
                boxShadow:
                  activeMode === 'deposit'
                    ? '0 2px 8px rgba(152, 150, 255, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.15)'
                    : 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.2s ease',
              }}
            >
              <Plus size={14} />
              <span>{isPool ? 'Add Liquidity' : 'Deposit'}</span>
            </button>

            {isLp && (
              <button
                type="button"
                onClick={() => {
                  setActiveMode('swap')
                  setErrorMsg(null)
                }}
                disabled={isProcessing}
                style={{
                  flex: 1,
                  padding: '9px 0',
                  borderRadius: 10,
                  border: 'none',
                  fontSize: 13,
                  fontFamily: 'var(--font-app)',
                  fontWeight: activeMode === 'swap' ? 600 : 500,
                  color: activeMode === 'swap' ? '#fff' : 'var(--fp-3)',
                  background:
                    activeMode === 'swap'
                      ? 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(139, 92, 246, 0.35) 100%)'
                      : 'transparent',
                  boxShadow:
                    activeMode === 'swap'
                      ? '0 2px 8px rgba(99, 102, 241, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.15)'
                      : 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'all 0.2s ease',
                }}
              >
                <ArrowRightLeft size={14} />
                <span>Swap</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setActiveMode('withdraw')
                setAmount('')
                setAmountA('')
                setAmountB('')
                setPercentage(0)
                setErrorMsg(null)
              }}
              disabled={isProcessing || userStaked <= 0}
              style={{
                flex: 1,
                padding: '9px 0',
                borderRadius: 10,
                border: 'none',
                fontSize: 13,
                fontFamily: 'var(--font-app)',
                fontWeight: activeMode === 'withdraw' ? 600 : 500,
                color: userStaked <= 0 ? 'var(--fp-4)' : activeMode === 'withdraw' ? '#fff' : 'var(--fp-3)',
                background:
                  activeMode === 'withdraw'
                    ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.2) 0%, rgba(220, 38, 38, 0.25) 100%)'
                    : 'transparent',
                boxShadow:
                  activeMode === 'withdraw'
                    ? '0 2px 8px rgba(239, 68, 68, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.15)'
                    : 'none',
                cursor: userStaked <= 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.2s ease',
              }}
            >
              <Minus size={14} />
              <span>{isPool ? 'Remove' : isVault ? 'Redeem' : 'Withdraw'}</span>
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {activeMode === 'swap' ? (
              <PoolSwapTab
                isPoolEmpty={isPoolEmpty}
                swapTokenIn={swapTokenIn}
                swapTokenOut={swapTokenOut}
                swapAmountIn={swapAmountIn}
                calculatedSwapOut={calculatedSwapOut}
                minSwapOutStr={minSwapOutStr}
                swapWalletBalTokenInStr={swapWalletBalTokenInStr}
                swapWalletBalTokenIn={swapWalletBalTokenIn}
                priceImpactPct={priceImpactPct}
                feePercent={feePercent}
                slippage={slippage}
                tokenPrices={tokenPrices}
                pool={pool}
                livePoolRate={livePoolRate}
                isProcessing={isProcessing}
                onSwapAmountChange={(val) => {
                  setSwapAmountIn(val)
                  setErrorMsg(null)
                }}
                onFlipDirection={handleFlipSwapDirection}
              />
            ) : activeMode === 'deposit' ? (
              <PoolDepositTab
                isLp={isLp}
                isVault={isVault}
                isPoolEmpty={isPoolEmpty}
                depositSource={depositSource}
                setDepositSource={setDepositSource}
                selectedSourceChain={selectedSourceChain}
                setShowChainDropdown={setShowChainDropdown}
                crossChainBalStr={crossChainBalStr}
                crossChainBalNum={crossChainBalNum}
                gatewayTotalBalance={gatewayTotalBalance}
                lpDepositMethod={lpDepositMethod}
                setLpDepositMethod={setLpDepositMethod}
                amount={amount}
                percentage={percentage}
                depositLabel={depositLabel}
                depositTokenSymbol={depositTokenSymbol}
                numericBalanceStr={numericBalanceStr}
                handleAmountInputChange={handleAmountInputChange}
                handlePercentageChange={handlePercentageChange}
                amountA={amountA}
                amountB={amountB}
                handleAmountAChange={handleAmountAChange}
                handleAmountBChange={handleAmountBChange}
                tokenASymbol={tokenASymbol}
                tokenAIcon={tokenAIcon}
                availableWalletTokenA={availableWalletTokenA}
                counterTokenSymbol={counterTokenSymbol}
                counterTokenDecimals={counterTokenDecimals}
                counterWalletBalStr={counterWalletBalStr}
                counterWalletBal={counterWalletBal}
                walletBalTokenA={walletBalTokenA}
                isTokenAEurc={isTokenAEurc}
                tokenPrices={tokenPrices}
                livePoolRate={livePoolRate}
                pool={pool}
                isProcessing={isProcessing}
                errorMsg={errorMsg}
                inputAmountNum={inputAmountNum}
                annualYield={annualYield}
                dailyYield={dailyYield}
                estimatedLpMinted={estimatedLpMinted}
                estimatedPoolShare={estimatedPoolShare}
                slippage={slippage}
                isDualDonationWarn={isDualDonationWarn}
                isDualDonationBlock={isDualDonationBlock}
                dualDepositBalance={dualDepositBalance}
                donationPct={donationPct}
                setAmountA={setAmountA}
                setAmountB={setAmountB}
                setErrorMsg={setErrorMsg}
              />
            ) : (
              <PoolWithdrawTab
                isLp={isLp}
                isVault={isVault}
                lpPayoutMode={lpPayoutMode}
                setLpPayoutMode={setLpPayoutMode}
                amount={amount}
                depositLabel={depositLabel}
                depositTokenSymbol={depositTokenSymbol}
                numericBalanceStr={numericBalanceStr}
                userStaked={userStaked}
                handleAmountInputChange={handleAmountInputChange}
                handlePercentageChange={handlePercentageChange}
                tokenPrices={tokenPrices}
                livePoolRate={livePoolRate}
                pool={pool}
                isProcessing={isProcessing}
                errorMsg={errorMsg}
                inputAmountNum={inputAmountNum}
                withdrawAssetReturns={withdrawAssetReturns}
                tokenASymbol={tokenASymbol}
                counterTokenSymbol={counterTokenSymbol}
                exchangeRate={exchangeRate}
                slippage={slippage}
              />
            )}

            {errorMsg && (
              <div
                style={{
                  padding: '10px 14px',
                  background: isCanceled ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.1)',
                  border: isCanceled ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 12,
                  fontSize: 12,
                  color: isCanceled ? '#fbbf24' : '#f87171',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  lineHeight: 1.4,
                }}
              >
                <AlertTriangle
                  size={14}
                  style={{
                    color: isCanceled ? '#fbbf24' : '#f87171',
                    flexShrink: 0,
                  }}
                />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitDisabled}
              style={{
                width: '100%',
                padding: '14px 0',
                borderRadius: 99,
                border: 'none',
                background:
                  isSubmitDisabled
                    ? 'rgba(152, 150, 255, 0.25)'
                    : isWrongChainForCrossChain
                      ? 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)'
                      : activeMode === 'swap'
                        ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                        : activeMode === 'deposit'
                          ? 'linear-gradient(135deg, #9896ff 0%, #6366f1 100%)'
                          : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: isSubmitDisabled ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'all 0.2s ease',
              }}
            >
              {isSwitchingNetwork ? (
                <>
                  <RefreshCw size={15} className="arcis-spin" />
                  <span>
                    SWITCHING TO {(CHAIN_META[resolvedSourceChainKey]?.name || resolvedSourceChainKey).toUpperCase()} IN WALLET...
                  </span>
                </>
              ) : isWrongChainForCrossChain ? (
                <>
                  <Globe size={16} />
                  <span>
                    SWITCH NETWORK TO {(CHAIN_META[resolvedSourceChainKey]?.name || resolvedSourceChainKey).toUpperCase()}
                  </span>
                </>
              ) : isProcessing ? (
                <>
                  <RefreshCw size={15} className="arcis-spin" />
                  <span>
                    {activeMode === 'swap'
                      ? 'SWAPPING...'
                      : activeMode === 'deposit'
                        ? depositSource === 'crosschain'
                          ? 'ADDING LIQUIDITY VIA CIRCLE GATEWAY...'
                          : isPool
                            ? 'ADDING LIQUIDITY...'
                            : 'DEPOSITING...'
                        : isPool
                          ? 'REMOVING LIQUIDITY...'
                          : isVault
                            ? 'REDEEMING...'
                            : 'WITHDRAWING...'}
                  </span>
                </>
              ) : activeMode === 'swap' ? (
                isSwapUnavailable ? (
                  <>
                    <AlertTriangle size={16} />
                    <span>SWAP UNAVAILABLE</span>
                  </>
                ) : swapAmountInNum <= 0 ? (
                  <span>ENTER SWAP AMOUNT</span>
                ) : swapAmountInNum > swapWalletBalTokenIn ? (
                  <span>INSUFFICIENT BALANCE</span>
                ) : (
                  <>
                    <ArrowRightLeft size={16} />
                    <span>SWAP</span>
                  </>
                )
              ) : activeMode === 'deposit' ? (
                isZapUnavailable ? (
                  <>
                    <AlertTriangle size={16} />
                    <span>LIQUIDITY UNAVAILABLE</span>
                  </>
                ) : isDualMode ? (
                  isDualIncomplete ? (
                    <span>ENTER BOTH TOKEN AMOUNTS</span>
                  ) : isDualInsuffA ? (
                    <span>INSUFFICIENT BALANCE</span>
                  ) : isDualInsuffB ? (
                    <span>INSUFFICIENT BALANCE</span>
                  ) : isDualDonationBlock ? (
                    <span>UNBALANCED — EXCESS IS DONATED</span>
                  ) : (
                    <>
                      <Plus size={16} />
                      <span>ADD LIQUIDITY</span>
                    </>
                  )
                ) : isSingleDepositInsuff ? (
                  <span>{depositSource === 'crosschain' ? 'INSUFFICIENT GATEWAY BALANCE' : 'INSUFFICIENT BALANCE'}</span>
                ) : inputAmountNum <= 0 ? (
                  <span>ENTER DEPOSIT AMOUNT</span>
                ) : isPool ? (
                  <>
                    <Plus size={16} />
                    <span>ADD LIQUIDITY</span>
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    <span>DEPOSIT</span>
                  </>
                )
              ) : (
                inputAmountNum <= 0 ? (
                  <span>{isVault ? 'ENTER REDEEM AMOUNT' : 'ENTER WITHDRAW AMOUNT'}</span>
                ) : isWithdrawExceeds ? (
                  <span>AMOUNT EXCEEDS STAKED BALANCE</span>
                ) : (
                  <>
                    <Minus size={16} />
                    <span>{isPool ? 'REMOVE LIQUIDITY' : isVault ? 'REDEEM USDC' : 'WITHDRAW'}</span>
                  </>
                )
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Source Network Selector Modal */}
      <ChainSelectorModal
        isOpen={showChainDropdown}
        onClose={() => setShowChainDropdown(false)}
        chains={sourceChainsList}
        selectedChain={selectedSourceChain}
        onSelectChain={(chainKey) => {
          setSelectedSourceChain(chainKey)
          setShowChainDropdown(false)
          setAmount('')
          setPercentage(0)
          setErrorMsg(null)
        }}
        getChainIconId={(c) => CHAIN_META[c]?.iconId || getChainIconId(c)}
      />
    </>,
    document.body
  )
}
