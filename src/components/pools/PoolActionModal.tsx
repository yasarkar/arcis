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
  AlertCircle,
  RefreshCw,
  Layers,
  ArrowRightLeft,
  ArrowUpDown,
  Globe,
  ChevronDown,
  SlidersHorizontal,
  Wallet,
  Info,
} from 'lucide-react'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'
import { WethIcon } from '../../config/tokenIcons'
import type { PoolConfig } from '../../config/poolsConfig'
import type { UserPoolPosition } from '../../hooks/usePoolsData'
import { useGatewayBalance } from '../../hooks/useGatewayBalance'
import { GATEWAY_CHAIN_NAMES } from '../../config/gatewayConfig'
import { ChainIcon } from '../common/ChainIcon'
import { CHAIN_META, getChainDisplayName, getChainIconId } from '../../config/bridgeConfig'
import { AssetInputPanel, ChainSelectorModal } from '../fintech'
import { isUserCanceled, formatWalletError } from '../../utils/errorUtils'
import { parseUnits, formatUnits } from 'viem'
import { calculateStableSwapExpectedOut, calculateConstantProductExpectedOut, calculatePriceImpactPct, estimateLpSharesForDeposit, analyzeDualDepositBalance, DUAL_DEPOSIT_DONATION_WARN_PCT, DUAL_DEPOSIT_DONATION_BLOCK_PCT, calculateLpTokensToAssets } from '../../utils/poolMath'
import { useLiveTokenPrices, formatFiatEstimate } from '../../hooks/useLiveTokenPrices'
import { Tooltip, InfoTooltip } from '../common/Tooltip'
import { useAccount } from 'wagmi'
import { POOLS_CHAIN_DEFS, STABLE_SWAP_AMP, STABLE_SWAP_LP_FEE_BPS, CONSTANT_PRODUCT_LP_FEE_BPS, POOL_MAX_SLIPPAGE_BPS, poolMinOut, poolSlippageBps } from '../../config/poolsConfig'
import { ensureNetwork } from '../../services/chainSwitchService'
import { setAutoSwitchPaused } from '../../hooks/useAutoSwitchArcChain'
import { useWalletSettings } from '../../hooks/useWalletSettings'

interface PoolActionModalProps {
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
  const [amountA, setAmountA] = useState<string>('') // USDC
  const [amountB, setAmountB] = useState<string>('') // Counter token (e.g. EURC, cirBTC)

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

  // Sync state whenever wallet settings change (e.g. user switches wallet account)
  useEffect(() => {
    setSelectedSlippageType(walletSettings.poolSlippageType)
    setCustomSlippage(walletSettings.poolCustomSlippage || '')
    setSlippage(walletSettings.poolSlippage)
  }, [walletSettings.poolSlippageType, walletSettings.poolCustomSlippage, walletSettings.poolSlippage])

  // Sync slippage numeric value with active toggle or custom input
  useEffect(() => {
    if (selectedSlippageType === 'custom') {
      const parsed = parseFloat(customSlippage)
      if (!isNaN(parsed) && parsed > 0) {
        // O3: never display a tolerance the execution path would clamp away.
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

  // Systematic input and state clearing on wallet disconnect
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

  // Cross-Chain balance on selected source chain (shows Circle Gateway balance)
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
  const userLpTokensFormatted = parseFloat(pool.userPosition?.lpTokenBalance || '0')
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

  // Maximum available depending on mode and deposit source
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

  const depositTokenIcon = depositTokenSymbol === 'EURC' || depositTokenSymbol.includes('EURC')
    ? EurcIcon
    : (depositTokenSymbol === 'WETH' || depositTokenSymbol === 'ETH' || depositTokenSymbol.includes('WETH') || depositTokenSymbol.includes('ETH'))
      ? WethIcon
      : (depositTokenSymbol === 'cirBTC' || depositTokenSymbol === 'BTC' || depositTokenSymbol.includes('cirBTC') || depositTokenSymbol.includes('BTC'))
        ? CirBtcIcon
        : UsdcIcon

  const depositLabel = activeMode === 'withdraw'
    ? (isVault ? 'AMOUNT OF USDC TO REDEEM' : 'AMOUNT TO WITHDRAW (USD)')
    : 'AMOUNT TO DEPOSIT'

  const numericBalanceStr = activeMode === 'deposit'
    ? (depositSource === 'crosschain' ? crossChainBalStr : availableWalletUsdc)
    : userStaked.toFixed(2)

  // Swap wallet balance for selected swapTokenIn
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

  // Dual-Asset deposit balance and validation calculations
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

  // Calculate AMM swap output with pool fee, real pool reserves and slippage using exact BigInt math
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
            calculatedSwapOut = rawOut.toFixed(4)
            minSwapOutStr = (rawOut * ((100 - slippage) / 100)).toFixed(4)
          }
        } else {
          // Constant Product (USDC -> cirBTC, 6 -> 8 decimals)
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
            calculatedSwapOut = rawOut.toFixed(counterTokenDecimals === 8 ? 8 : 4)
            minSwapOutStr = (rawOut * ((100 - slippage) / 100)).toFixed(counterTokenDecimals === 8 ? 8 : 4)
          }
        }
      } else if (exchangeRate > 0) {
        const rawOut = (swapAmountInNum / exchangeRate) * feeMultiplier
        calculatedSwapOut = rawOut.toFixed(counterTokenDecimals === 8 ? 8 : 4)
        minSwapOutStr = (rawOut * ((100 - slippage) / 100)).toFixed(counterTokenDecimals === 8 ? 8 : 4)
      }
    } else {
      // Counter Token -> USDC
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
          // Constant Product (cirBTC -> USDC, 8 -> 6 decimals)
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

  // Real price impact (fee-excluded), derived from live reserves — never a hard-coded value.
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

  const renderTokenBadgeIcon = (symbol: string) => {
    if (symbol === 'EURC') {
      return <img src={EurcIcon} alt="EURC" style={{ width: 18, height: 18, objectFit: 'contain' }} />
    }
    if (symbol === 'WETH' || symbol === 'ETH') {
      return <img src={WethIcon} alt="WETH" style={{ width: 18, height: 18, objectFit: 'contain' }} />
    }
    if (symbol === 'cirBTC' || symbol === 'BTC') {
      return <img src={CirBtcIcon} alt="BTC" style={{ width: 18, height: 18, objectFit: 'contain' }} />
    }
    return <img src={UsdcIcon} alt="USDC" style={{ width: 18, height: 18, objectFit: 'contain' }} />
  }

  // Handle Dual Token Inputs Auto-Calculation
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
          // Reserve 0.50 USDC for Arc network gas fees
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
        // Cross-chain 1-Click Zap (Gas is abstracted on source)
        const calculated = (maxAvailable * (pct / 100)).toFixed(2)
        setAmount(calculated)
      }
    } else {
      // Withdraw mode
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

  // Yield projection calculation
  const inputAmountNum = isLp && lpDepositMethod === 'dual' && depositSource === 'native'
    ? (parseFloat(amountA) || 0) + ((parseFloat(amountB) || 0) * exchangeRate)
    : parseFloat(amount) || 0

  const annualYield = (inputAmountNum * pool.apy) / 100
  const monthlyYield = annualYield / 12
  const dailyYield = annualYield / 365

  // ── Real, invariant-based LP/share preview (no fabricated conversion factor) ──
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

  // Proportional withdrawal asset returns preview for LP pools
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

  // ── O2: unbalanced dual-deposit donation guard ──
  // Both V4 pool contracts transfer BOTH full input amounts but only credit min(lpA, lpB)
  // (ConstantProduct) or the Curve D-delta (StableSwap), so amounts off the pool ratio
  // silently donate the excess to existing LPs. Warn above a small tolerance, block beyond it.
  const dualDepositBalance = (() => {
    if (!isDualMode) return null
    if (!(aNum > 0) || !(bNum > 0)) return null
    return analyzeDualDepositBalance({
      poolId: pool.id,
      amountA: aNum,
      amountB: bNum,
      reserveA: previewReserveA,
      reserveB: previewReserveB,
      totalLp: previewTotalLp,
      amp: STABLE_SWAP_AMP,
    })
  })()
  const donationPct = dualDepositBalance?.donationPct ?? 0
  const isDualDonationWarn = isDualMode && donationPct > DUAL_DEPOSIT_DONATION_WARN_PCT
  const isDualDonationBlock = isDualMode && donationPct > DUAL_DEPOSIT_DONATION_BLOCK_PCT

  const isSingleDepositInsuff = activeMode === 'deposit' && !isDualMode && (
    depositSource === 'crosschain'
      ? inputAmountNum > crossChainBalNum
      : inputAmountNum > walletBalUsdc
  )

  const isWithdrawExceeds = activeMode === 'withdraw' && inputAmountNum > (userStaked + 0.01)

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

    // If attempting cross-chain deposit and wallet is not yet on that chain, switch network first!
    if (isWrongChainForCrossChain) {
      await handleSwitchToSourceChain()
      return
    }

    // ── AMM Swap Mode ──
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

    // ── Deposit Mode ──
    if (activeMode === 'deposit') {
      // Cross-Chain 1-Click Gateway Zap
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

      // Native Dual LP Deposit
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

      // Native 1-Click Zap or Standard Deposit
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
      // Withdraw Mode
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

  // Eligible source chains for Cross-Chain Zap (Circle Gateway balances sorted descending by balance)
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

          {/* Top-Right Controls: Slippage Settings & Close */}
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

          {/* ── Collapsible Slippage Settings Panel ── */}
          {showSettings && (
            <div
              className="animate-in fade-in slide-in-from-top-2 duration-200"
              style={{
                background: 'rgba(15, 18, 35, 0.95)',
                border: '1px solid rgba(152, 150, 255, 0.3)',
                borderRadius: 16,
                padding: '14px 16px',
                marginBottom: 16,
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <SlidersHorizontal className='w-4 h-4 text-indigo-400' />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', letterSpacing: '0.5px' }}>
                    SLIPPAGE
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    color: 'var(--purple-1)',
                    background: 'rgba(152, 150, 255, 0.15)',
                    border: '1px solid rgba(152, 150, 255, 0.3)',
                    padding: '4px 10px',
                    borderRadius: 99,
                  }}
                >
                  {slippage.toFixed(1)}%
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {(['0.1', '0.5', '1.0'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setSelectedSlippageType(type)
                      setCustomSlippage('')
                      const num = parseFloat(type)
                      updateWalletSettings({ poolSlippageType: type, poolCustomSlippage: '', poolSlippage: num })
                    }}
                    style={{
                      padding: '6px 0',
                      borderRadius: 10,
                      border: selectedSlippageType === type ? '1px solid rgba(152, 150, 255, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
                      background: selectedSlippageType === type ? 'rgba(152, 150, 255, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                      color: selectedSlippageType === type ? '#fff' : 'var(--fp-3)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {type}%
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSlippageType('custom')
                    updateWalletSettings({ poolSlippageType: 'custom' })
                  }}
                  style={{
                    padding: '6px 0',
                    borderRadius: 10,
                    border: selectedSlippageType === 'custom' ? '1px solid rgba(152, 150, 255, 0.6)' : '1px solid rgba(255, 255, 255, 0.08)',
                    background: selectedSlippageType === 'custom' ? 'rgba(152, 150, 255, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                    color: selectedSlippageType === 'custom' ? '#fff' : 'var(--fp-3)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Custom
                </button>
              </div>

              {selectedSlippageType === 'custom' && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      step="0.1"
                      min="0.01"
                      max={POOL_MAX_SLIPPAGE_BPS / 100}
                      placeholder="e.g. 1.0"
                      value={customSlippage}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value)
                        const maxPercent = POOL_MAX_SLIPPAGE_BPS / 100
                        const finalVal = !isNaN(val) && val > maxPercent ? String(maxPercent) : e.target.value
                        setCustomSlippage(finalVal)
                        const parsedNum = parseFloat(finalVal)
                        const safeNum = !isNaN(parsedNum) && parsedNum > 0 ? Math.min(parsedNum, maxPercent) : 0.5
                        updateWalletSettings({ poolCustomSlippage: finalVal, poolSlippageType: 'custom', poolSlippage: safeNum })
                      }}
                      autoFocus
                      style={{
                        width: '100%',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(152, 150, 255, 0.4)',
                        borderRadius: 10,
                        padding: '7px 28px 7px 12px',
                        fontSize: 12,
                        color: '#fff',
                        outline: 'none',
                      }}
                    />
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--fp-3)', fontWeight: 600 }}>
                      %
                    </span>
                  </div>
                  {slippage > 1.5 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: '#f59e0b' }}>
                      <AlertTriangle size={12} />
                      <span>High slippage may result in unfavorable execution (strictly capped at 2.0% max).</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Main Mode Switcher (Deposit / Swap / Withdraw) ── */}
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

          {/* ── Deposit Source Switcher: Arc Testnet vs Cross-Chain Gateway Zap ── */}
          {activeMode === 'deposit' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
                background: 'rgba(11, 13, 24, 0.65)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 12,
                padding: 4,
                marginBottom: 16,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setDepositSource('native')
                  setAmount('')
                  setAmountA('')
                  setAmountB('')
                  setPercentage(0)
                  setErrorMsg(null)
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: 9,
                  border: 'none',
                  background: depositSource === 'native' ? 'rgba(152, 150, 255, 0.2)' : 'transparent',
                  color: depositSource === 'native' ? '#fff' : 'var(--fp-3)',
                  fontSize: 12,
                  fontFamily: 'var(--font-app)',
                  fontWeight: depositSource === 'native' ? 600 : 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'all 0.15s ease',
                }}
              >
                <Wallet size={13} style={{ color: 'var(--purple-1)' }} />
                <span>Arc Testnet</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (isLp && isPoolEmpty) {
                    setErrorMsg(`Cross-Chain liquidity requires existing pool reserves to auto-balance into ${counterTokenSymbol}. Please use Arc Native Dual-Asset Deposit.`)
                    return
                  }
                  setDepositSource('crosschain')
                  setAmount('')
                  setAmountA('')
                  setAmountB('')
                  setPercentage(0)
                  setErrorMsg(null)
                }}
                disabled={isLp && isPoolEmpty}
                style={{
                  padding: '8px 10px',
                  borderRadius: 9,
                  border: 'none',
                  background: depositSource === 'crosschain' ? 'rgba(152, 150, 255, 0.2)' : 'transparent',
                  color: isLp && isPoolEmpty ? 'rgba(255, 255, 255, 0.35)' : (depositSource === 'crosschain' ? '#fff' : 'var(--fp-3)'),
                  fontSize: 12,
                  fontFamily: 'var(--font-app)',
                  fontWeight: depositSource === 'crosschain' ? 600 : 500,
                  cursor: isLp && isPoolEmpty ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  transition: 'all 0.15s ease',
                  opacity: isLp && isPoolEmpty ? 0.6 : 1,
                }}
                title={isLp && isPoolEmpty ? 'Cross-Chain liquidity requires existing pool reserves' : undefined}
              >
                <Globe className='w-3.5 h-3.5 text-indigo-400' />
                <span>Cross-Chain</span>
                {isLp && isPoolEmpty && <span className="text-[10px] text-amber-400/80 ml-1">(0 Reserves)</span>}
              </button>
            </div>
          )}

          {/* ── Cross-Chain Gateway Zap Configuration Area (FROM NETWORK styled like BridgeModal) ── */}
          {activeMode === 'deposit' && depositSource === 'crosschain' && (
            <div className="bg-[#121626]/85 border border-white/[0.06] rounded-2xl p-3.5 sm:p-4 mb-4">
              <div className="w-full min-w-0">
                <div className="flex items-center justify-between mb-1.5 ml-1">
                  <div
                    className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider"
                    style={{ fontFamily: 'var(--font-app)' }}
                  >
                    NETWORK
                  </div>
                  <span className="text-[12px] text-slate-400 font-medium">
                    Available: <strong className="text-white">{crossChainBalStr} USDC</strong>
                  </span>
                </div>

                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => setShowChainDropdown(true)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-indigo-500/40 transition-all cursor-pointer select-none text-left"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                      <ChainIcon
                        chainKeyOrIconId={selectedSourceChain}
                        name={CHAIN_META[selectedSourceChain]?.name || getChainDisplayName(selectedSourceChain)}
                        size={20}
                        className="rounded-full"
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-semibold text-white truncate">
                        {CHAIN_META[selectedSourceChain]?.name || getChainDisplayName(selectedSourceChain)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  </div>
                </button>

                {parseFloat(gatewayTotalBalance || '0') <= 0 ? (
                  <div className="mt-2.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300/90 leading-relaxed flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-amber-200 block mb-0.5">No Circle Gateway Balance</strong>
                      Cross-Chain Zap burns deposited USDC from Circle Gateway. Please deposit testnet USDC into Circle Gateway via the <strong>Unified Balance</strong> tab before zapping.
                    </div>
                  </div>
                ) : crossChainBalNum <= 0 ? (
                  <div className="mt-2.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300/90 leading-relaxed flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-amber-200 block mb-0.5">0 USDC on {CHAIN_META[selectedSourceChain]?.name || selectedSourceChain}</strong>
                      Your Gateway balance on this specific network is 0. Please select another source network with available balance above, or deposit via the <strong>Unified Balance</strong> tab.
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* Native LP Deposit Method Switcher (When depositSource === 'native') */}
          {isLp && activeMode === 'deposit' && depositSource === 'native' && (
            <>
              {isPoolEmpty && (
                <div className="mb-3.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300/90 leading-relaxed flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-amber-200 block mb-0.5">Initial Pool Liquidity (0 Reserves)</strong>
                    This AMM pool currently has 0 reserves on Arc Testnet. Single-token deposit is unavailable because it requires pre-existing pool reserves to swap 50% USDC into {counterTokenSymbol}. To bootstrap this pool, please supply both assets via <strong>Dual-Asset Deposit</strong>, or deposit single-sided USDC into the <strong>USDC Yield Vault</strong>.
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                <button
                  type="button"
                  disabled={isPoolEmpty}
                  onClick={() => {
                    if (isPoolEmpty) return
                    setLpDepositMethod('zap')
                    setErrorMsg(null)
                  }}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: lpDepositMethod === 'zap' ? 'rgba(152, 150, 255, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                    border: lpDepositMethod === 'zap' ? '1px solid rgba(152, 150, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                    color: isPoolEmpty ? 'rgba(255, 255, 255, 0.4)' : (lpDepositMethod === 'zap' ? '#fff' : 'var(--fp-3)'),
                    fontSize: 12,
                    fontFamily: 'var(--font-app)',
                    fontWeight: 600,
                    cursor: isPoolEmpty ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'all 0.15s ease',
                    opacity: isPoolEmpty ? 0.6 : 1,
                  }}
                  title={isPoolEmpty ? 'Single-token deposit requires existing pool reserves' : undefined}
                >
                  <Plus className='w-3.5 h-3.5 text-indigo-400' />
                  <span>Single Asset</span>
                  {isPoolEmpty && <span className="text-[10px] text-amber-400/80 ml-1">(0 Reserves)</span>}
                </button>

                <button
                  type="button"
                  onClick={() => { setLpDepositMethod('dual'); setErrorMsg(null) }}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: lpDepositMethod === 'dual' ? 'rgba(152, 150, 255, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                    border: lpDepositMethod === 'dual' ? '1px solid rgba(152, 150, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                    color: lpDepositMethod === 'dual' ? '#fff' : 'var(--fp-3)',
                    fontSize: 12,
                    fontFamily: 'var(--font-app)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Layers className='w-3.5 h-3.5 text-indigo-400' />
                  <span>Dual Asset</span>
                </button>
              </div>
            </>
          )}

          {/* LP Withdraw Payout Switcher */}
          {isLp && activeMode === 'withdraw' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              <button
                type="button"
                onClick={() => setLpPayoutMode('usdc')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: lpPayoutMode === 'usdc' ? 'rgba(152, 150, 255, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                  border: lpPayoutMode === 'usdc' ? '1px solid rgba(152, 150, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                  color: lpPayoutMode === 'usdc' ? '#fff' : 'var(--fp-3)',
                  fontSize: 12,
                  fontFamily: 'var(--font-app)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Plus size={13} style={{ color: 'var(--purple-1)' }} />
                <span>Single Token</span>
              </button>

              <button
                type="button"
                onClick={() => setLpPayoutMode('dual')}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: lpPayoutMode === 'dual' ? 'rgba(152, 150, 255, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                  border: lpPayoutMode === 'dual' ? '1px solid rgba(152, 150, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                  color: lpPayoutMode === 'dual' ? '#fff' : 'var(--fp-3)',
                  fontSize: 12,
                  fontFamily: 'var(--font-app)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Layers size={13} />
                <span>Both Tokens</span>
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {activeMode === 'swap' ? (
              /* ── AMM Swap View ── */
              <div className="mb-4 space-y-2">
                {isPoolEmpty && (
                  <div className="mb-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300/90 leading-relaxed flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-amber-200 block mb-0.5">Pool Reserves Empty (0 Liquidity)</strong>
                      This AMM pool currently has 0 reserves on Arc Testnet. Swaps cannot be executed until initial liquidity is provided via <strong>Dual-Asset Deposit</strong>.
                    </div>
                  </div>
                )}

                {/* Input: YOU PAY */}
                <AssetInputPanel
                  label="YOU PAY"
                  amount={swapAmountIn}
                  onAmountChange={(val) => {
                    setSwapAmountIn(val)
                    setErrorMsg(null)
                  }}
                  placeholder={swapTokenIn === 'cirBTC' || swapTokenIn.toLowerCase().includes('btc') ? '0.0000' : swapTokenIn === 'WETH' ? '0.0000' : '0.00'}
                  tokenSymbol={swapTokenIn}
                  tokenIcon={swapTokenIn === 'EURC' ? EurcIcon : (swapTokenIn === 'WETH' ? WethIcon : (swapTokenIn === 'cirBTC' ? CirBtcIcon : UsdcIcon))}
                  tokenListAvailable={false}
                  balance={swapWalletBalTokenInStr}
                  onMaxClick={() => {
                    if (swapTokenIn === 'USDC') {
                      const maxUsdcWithGas = Math.max(0, swapWalletBalTokenIn - ARC_GAS_RESERVE_USDC)
                      setSwapAmountIn(maxUsdcWithGas.toFixed(2))
                    } else if (swapTokenIn === 'WETH') {
                      setSwapAmountIn(swapWalletBalTokenIn.toFixed(4))
                    } else {
                      setSwapAmountIn(swapWalletBalTokenIn.toString())
                    }
                    setErrorMsg(null)
                  }}
                  quickPercentages={[25, 50, 75, 100]}
                  onSelectPercentage={(pct) => {
                    const max = swapTokenIn === 'USDC'
                      ? Math.max(0, swapWalletBalTokenIn - ARC_GAS_RESERVE_USDC)
                      : swapWalletBalTokenIn
                    const decimals = swapTokenIn === 'cirBTC' ? 6 : swapTokenIn === 'WETH' ? 4 : 2
                    setSwapAmountIn(((max * pct) / 100).toFixed(decimals))
                    setErrorMsg(null)
                  }}
                  fiatEstimate={formatFiatEstimate(
                    swapAmountIn,
                    swapTokenIn,
                    tokenPrices,
                    livePoolRate > 0 ? livePoolRate : pool?.exchangeRate
                  )}
                  disabled={isProcessing}
                />

                {/* Flip Button */}
                <div className="flex justify-center -my-2 z-10 relative">
                  <button
                    type="button"
                    onClick={handleFlipSwapDirection}
                    className="w-8 h-8 rounded-full bg-[#1e2238] hover:bg-[#282d4a] border border-white/10 flex items-center justify-center text-slate-300 hover:text-white transition-all shadow-md active:scale-95 cursor-pointer"
                  >
                    <ArrowUpDown size={14} />
                  </button>
                </div>

                {/* Output: YOU RECEIVE */}
                <AssetInputPanel
                  label="YOU RECEIVE (ESTIMATED)"
                  amount={calculatedSwapOut}
                  readOnly={true}
                  placeholder={swapTokenOut === 'cirBTC' || swapTokenOut.toLowerCase().includes('btc') ? '0.0000' : swapTokenOut === 'WETH' ? '0.0000' : '0.00'}
                  tokenSymbol={swapTokenOut}
                  tokenIcon={swapTokenOut === 'EURC' ? EurcIcon : (swapTokenOut === 'WETH' ? WethIcon : (swapTokenOut === 'cirBTC' ? CirBtcIcon : UsdcIcon))}
                  tokenListAvailable={false}
                  fiatEstimate={formatFiatEstimate(
                    calculatedSwapOut,
                    swapTokenOut,
                    tokenPrices,
                    livePoolRate > 0 ? livePoolRate : pool?.exchangeRate
                  )}
                  disabled={isProcessing}
                />
              </div>
            ) : isLp && activeMode === 'deposit' && lpDepositMethod === 'dual' && depositSource === 'native' ? (
              /* ── Dual Token Deposit (Native Arc Only) ── */
              <div className="space-y-3 mb-4">
                <AssetInputPanel
                  label={`AMOUNT OF ${tokenASymbol} TO DEPOSIT`}
                  amount={amountA}
                  onAmountChange={handleAmountAChange}
                  tokenSymbol={tokenASymbol}
                  tokenIcon={tokenAIcon}
                  tokenListAvailable={false}
                  balance={availableWalletTokenA}
                  onMaxClick={() => {
                    const maxAWithGas = isTokenAEurc ? walletBalTokenA : Math.max(0, walletBalTokenA - ARC_GAS_RESERVE_USDC)
                    handleAmountAChange(maxAWithGas.toFixed(2))
                  }}
                  quickPercentages={[25, 50, 75, 100]}
                  onSelectPercentage={(pct) => {
                    const maxAWithGas = isTokenAEurc ? walletBalTokenA : Math.max(0, walletBalTokenA - ARC_GAS_RESERVE_USDC)
                    handleAmountAChange(((maxAWithGas * pct) / 100).toFixed(2))
                  }}
                  fiatEstimate={formatFiatEstimate(amountA, tokenASymbol, tokenPrices)}
                  disabled={isProcessing}
                />
                <AssetInputPanel
                  label="AMOUNT TO DEPOSIT"
                  amount={amountB}
                  onAmountChange={handleAmountBChange}
                  placeholder={counterTokenSymbol === 'cirBTC' || counterTokenSymbol.toLowerCase().includes('btc') ? '0.0000' : counterTokenSymbol === 'WETH' ? '0.0000' : '0.00'}
                  tokenSymbol={counterTokenSymbol}
                  tokenIcon={counterTokenSymbol === 'EURC' ? EurcIcon : (counterTokenSymbol === 'WETH' ? WethIcon : CirBtcIcon)}
                  tokenListAvailable={false}
                  balance={counterWalletBalStr}
                  onMaxClick={() => {
                    handleAmountBChange(counterWalletBalStr)
                  }}
                  quickPercentages={[25, 50, 75, 100]}
                  onSelectPercentage={(pct) => {
                    const balNum = counterWalletBal || 0
                    handleAmountBChange(((balNum * pct) / 100).toFixed(counterTokenSymbol === 'EURC' ? 2 : counterTokenSymbol === 'WETH' ? 4 : 6))
                  }}
                  fiatEstimate={formatFiatEstimate(
                    amountB,
                    counterTokenSymbol,
                    tokenPrices,
                    livePoolRate > 0 ? livePoolRate : pool?.exchangeRate
                  )}
                  disabled={isProcessing}
                />
              </div>
            ) : (
              /* ── Single Token / Zap Deposit or Withdraw ── */
              <div className="mb-4">
                <AssetInputPanel
                  label={depositLabel}
                  amount={amount}
                  onAmountChange={handleAmountInputChange}
                  placeholder={depositTokenSymbol === 'cirBTC' || depositTokenSymbol.toLowerCase().includes('btc') ? '0.0000' : '0.00'}
                  tokenSymbol={depositTokenSymbol}
                  tokenIcon={depositTokenIcon}
                  tokenListAvailable={false}
                  balance={numericBalanceStr}
                  onMaxClick={() => handlePercentageChange(100)}
                  quickPercentages={[25, 50, 75, 100]}
                  onSelectPercentage={handlePercentageChange}
                  fiatEstimate={formatFiatEstimate(
                    amount,
                    depositTokenSymbol,
                    tokenPrices,
                    livePoolRate > 0 ? livePoolRate : pool?.exchangeRate
                  )}
                  disabled={isProcessing}
                  error={Boolean(errorMsg && (errorMsg.toLowerCase().includes('exceeds') || errorMsg.toLowerCase().includes('insufficient')))}
                />
              </div>
            )}



            {/* Arc Gas Shield Banner (Native Deposit Only) */}
            {activeMode === 'deposit' && depositSource === 'native' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'rgba(56, 189, 248, 0.08)',
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                  borderRadius: 10,
                  marginBottom: 16,
                  fontSize: 11,
                  fontFamily: 'var(--font-app)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12 }}>⛽</span>
                  <span style={{ color: '#bae6fd' }}>
                    <strong>Arcis Gas Protect:</strong> 0.50 USDC is automatically kept for transaction fees on MAX.
                  </span>
                </div>
                {percentage === 100 && (
                  <span
                    style={{
                      color: '#38bdf8',
                      fontWeight: 700,
                      fontSize: 10,
                      background: 'rgba(56, 189, 248, 0.18)',
                      padding: '2px 6px',
                      borderRadius: 4,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    -0.50 USDC Gas Reserved
                  </span>
                )}
              </div>
            )}

            {/* ── Pre-Execution Summary Breakdown Card (Swap, Zap, & LP) ── */}
            {activeMode === 'swap' && swapAmountInNum > 0 && (
              <div
                style={{
                  background: 'rgba(15, 18, 35, 0.85)',
                  border: '1px solid rgba(152, 150, 255, 0.2)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  marginBottom: 16,
                  fontSize: 11,
                  fontFamily: 'var(--font-app)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Minimum Received ({slippage}% Slippage):</span>
                    <InfoTooltip
                      content="Guaranteed minimum amount received after maximum slippage tolerance."
                      position="top"
                      align="start"
                      size={11}
                      iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
                    />
                  </div>
                  <span style={{ color: '#fff', fontWeight: 600 }}>{minSwapOutStr} {swapTokenOut}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>AMM Swap Fee ({feePercent}%):</span>
                    <InfoTooltip
                      content="Fee rewarded directly to liquidity pool providers supporting this trade."
                      position="top"
                      align="start"
                      size={11}
                      iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
                    />
                  </div>
                  <span style={{ color: 'var(--fp-2)' }}>{(swapAmountInNum * (feePercent / 100)).toFixed(4)} {swapTokenIn}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Estimated Price Impact:</span>
                    <InfoTooltip
                      content="Estimated impact of your swap size on pool exchange rates."
                      position="top"
                      align="start"
                      size={11}
                      iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
                    />
                  </div>
                  <span
                    style={{
                      color: priceImpactPct > 3 ? '#f87171' : priceImpactPct > 1 ? '#fbbf24' : '#34d399',
                      fontWeight: 600,
                    }}
                  >
                    {priceImpactPct <= 0 ? '< 0.01%' : `${priceImpactPct.toFixed(2)}%`}
                  </span>
                </div>
              </div>
            )}

            {activeMode === 'deposit' && isLp && inputAmountNum > 0 && (
              <div
                style={{
                  background: 'rgba(15, 18, 35, 0.85)',
                  border: '1px solid rgba(152, 150, 255, 0.2)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  marginBottom: 16,
                  fontSize: 11,
                  fontFamily: 'var(--font-app)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Estimated LP Minted:</span>
                    <InfoTooltip
                      content="Estimated liquidity provider tokens minted based on pool reserves."
                      position="top"
                      align="start"
                      size={11}
                      iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
                    />
                  </div>
                  <span style={{ color: '#fff', fontWeight: 600 }}>
                    {estimatedLpMinted ? `~${estimatedLpMinted} ${pool.lpTokenSymbol || 'LP'}` : 'Unavailable — live reserves required'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Pool Share:</span>
                    <InfoTooltip
                      content="Your proportional ownership percentage of the total liquidity pool."
                      position="top"
                      align="start"
                      size={11}
                      iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
                    />
                  </div>
                  <span style={{ color: 'var(--purple-1)', fontWeight: 600 }}>{estimatedPoolShare ? `~${estimatedPoolShare}%` : '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Projected Annual Return (Est. {pool.apy.toFixed(2)}% {pool.apyType}):</span>
                    <InfoTooltip
                      content="Projected annual earnings based on current pool APY."
                      position="top"
                      align="start"
                      size={11}
                      iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
                    />
                  </div>
                  <span style={{ color: 'var(--earned-green)', fontWeight: 600 }}>+{annualYield.toFixed(2)} USD</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Slippage:</span>
                    <InfoTooltip
                      content="The maximum price difference tolerated before transaction reverts."
                      position="top"
                      align="start"
                      size={11}
                      iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
                    />
                  </div>
                  <span style={{ color: 'var(--fp-2)' }}>{slippage}%</span>
                </div>
              </div>
            )}

            {activeMode === 'withdraw' && isLp && inputAmountNum > 0 && withdrawAssetReturns && (
              <div
                style={{
                  background: 'rgba(15, 18, 35, 0.85)',
                  border: '1px solid rgba(152, 150, 255, 0.2)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  marginBottom: 16,
                  fontSize: 11,
                  fontFamily: 'var(--font-app)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Estimated Return ({lpPayoutMode === 'usdc' ? '100% USDC' : 'Dual Assets'}):</span>
                    <InfoTooltip
                      content={
                        lpPayoutMode === 'usdc'
                          ? `Proportional pool assets redeemed and automatically swapped to USDC with ${slippage}% slippage tolerance.`
                          : 'Proportional pool assets redeemed and sent directly to your wallet.'
                      }
                      position="top"
                      align="start"
                      size={11}
                      iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
                    />
                  </div>
                  <span style={{ color: '#fff', fontWeight: 600 }}>
                    {lpPayoutMode === 'usdc'
                      ? `~${(parseFloat(withdrawAssetReturns.amountA) + (parseFloat(withdrawAssetReturns.amountB) * exchangeRate)).toFixed(2)} ${tokenASymbol}`
                      : `~${withdrawAssetReturns.amountA} ${tokenASymbol} + ~${withdrawAssetReturns.amountB} ${counterTokenSymbol}`}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Underlying Proportional Assets:</span>
                    <InfoTooltip
                      content="Underlying assets corresponding to your LP token share before any conversions."
                      position="top"
                      align="start"
                      size={11}
                      iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
                    />
                  </div>
                  <span style={{ color: 'var(--fp-2)' }}>
                    {withdrawAssetReturns.amountA} ${tokenASymbol} / {withdrawAssetReturns.amountB} {counterTokenSymbol}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--fp-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>Slippage Protection:</span>
                    <InfoTooltip
                      content="Maximum slippage tolerance applied during the withdrawal and any auto-swap."
                      position="top"
                      align="start"
                      size={11}
                      iconClassName="w-3 h-3 text-slate-400 hover:text-indigo-300 cursor-help transition-colors"
                    />
                  </div>
                  <span style={{ color: 'var(--fp-2)' }}>{slippage}%</span>
                </div>
              </div>
            )}

            {/* ── O2: Unbalanced dual-deposit donation warning ── */}
            {isDualDonationWarn && dualDepositBalance && (
              <div
                style={{
                  background: isDualDonationBlock ? 'rgba(248, 113, 113, 0.08)' : 'rgba(251, 191, 36, 0.08)',
                  border: `1px solid ${isDualDonationBlock ? 'rgba(248, 113, 113, 0.35)' : 'rgba(251, 191, 36, 0.35)'}`,
                  borderRadius: 12,
                  padding: '10px 14px',
                  marginBottom: 16,
                  fontSize: 11,
                  fontFamily: 'var(--font-app)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: isDualDonationBlock ? '#fca5a5' : '#fcd34d' }}>
                  <AlertTriangle size={14} />
                  <span style={{ fontWeight: 700 }}>Unbalanced deposit — excess is donated to existing LPs</span>
                </div>
                <div style={{ color: 'var(--fp-3)', lineHeight: 1.5 }}>
                  About <strong style={{ color: '#fff' }}>{dualDepositBalance.donationValueA.toFixed(2)} USDC</strong>{' '}
                  ({donationPct.toFixed(2)}% of your deposit) is above the current pool ratio and would not
                  mint any LP shares — it stays in the pool as a donation to existing LPs.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const bDecimals = counterTokenDecimals
                    setAmountA(dualDepositBalance.optimizedAmountA.toFixed(2))
                    setAmountB(dualDepositBalance.optimizedAmountB.toFixed(bDecimals))
                    setErrorMsg(null)
                  }}
                  style={{
                    alignSelf: 'flex-start',
                    background: 'rgba(152, 150, 255, 0.15)',
                    border: '1px solid rgba(152, 150, 255, 0.35)',
                    color: '#c7d2fe',
                    fontWeight: 700,
                    fontSize: 11,
                    padding: '6px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  Balance amounts to pool ratio
                </button>
              </div>
            )}

            {activeMode === 'deposit' && !isLp && inputAmountNum > 0 && (
              <div
                style={{
                  background: 'rgba(15, 18, 35, 0.85)',
                  border: '1px solid rgba(152, 150, 255, 0.2)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  marginBottom: 16,
                  fontSize: 11,
                  fontFamily: 'var(--font-app)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Projected Annual Return (Est. {pool.apy.toFixed(2)}% {pool.apyType}):</span>
                  <span style={{ color: 'var(--earned-green)', fontWeight: 600 }}>+{annualYield.toFixed(2)} USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Estimated Daily Yield:</span>
                  <span style={{ color: 'var(--fp-2)' }}>+{dailyYield.toFixed(4)} USDC/day</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Pool Share:</span>
                  <span style={{ color: 'var(--purple-1)', fontWeight: 600 }}>{estimatedPoolShare ? `~${estimatedPoolShare}%` : '—'}</span>
                </div>
              </div>
            )}

            {activeMode === 'withdraw' && isVault && inputAmountNum > 0 && (
              <div
                style={{
                  background: 'rgba(15, 18, 35, 0.85)',
                  border: '1px solid rgba(152, 150, 255, 0.2)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  marginBottom: 16,
                  fontSize: 11,
                  fontFamily: 'var(--font-app)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Redeeming Asset:</span>
                  <span style={{ color: '#fff', fontWeight: 600 }}>Pure USDC (Direct to Wallet)</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Vault Shares Burned:</span>
                  <span style={{ color: 'var(--purple-1)', fontWeight: 600 }}>~{inputAmountNum.toFixed(2)} af-USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Protocol Lockup / Penalty:</span>
                  <span style={{ color: '#34d399', fontWeight: 600 }}>0% (Flexible / No Penalty)</span>
                </div>
              </div>
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

            {/* ── Transaction Cost & Route Summary Panel ── */}

              {activeMode === 'deposit' && depositSource === 'native' && percentage === 100 && (
                <div
                  style={{
                    background: 'rgba(96, 165, 250, 0.1)',
                    border: '1px solid rgba(96, 165, 250, 0.25)',
                    borderRadius: 8,
                    padding: '5px 8px',
                    marginTop: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#93c5fd',
                    fontSize: 10.5,
                  }}
                >
                  <Info size={12} style={{ flexShrink: 0 }} />
                  <span>0.50 USDC reserved for future network gas buffer</span>
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

      {/* Source Network Selector Modal (BridgeModal style) */}
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

