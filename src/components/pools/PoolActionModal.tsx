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
  TrendingUp,
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
  Shield,
  Info,
} from 'lucide-react'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'
import type { PoolConfig } from '../../config/poolsConfig'
import type { UserPoolPosition } from '../../hooks/usePoolsData'
import { useWalletTestnetBalances } from '../../hooks/useWalletTestnetBalances'
import { useGatewayBalance } from '../../hooks/useGatewayBalance'
import { GATEWAY_CHAIN_NAMES } from '../../config/gatewayConfig'
import { NetworkIcon } from '@web3icons/react/dynamic'
import { CHAIN_META, getChainDisplayName, getChainIconId } from '../../config/bridgeConfig'
import { AssetInputPanel, ChainSelectorModal } from '../fintech'
import { isUserCanceled, formatWalletError } from '../../utils/errorUtils'
import { parseUnits, formatUnits } from 'viem'
import { calculateStableSwapExpectedOut } from '../../utils/poolMath'
import { useLiveTokenPrices, formatFiatEstimate } from '../../hooks/useLiveTokenPrices'

interface PoolActionModalProps {
  isOpen: boolean
  pool: (PoolConfig & { userPosition?: UserPoolPosition }) | null
  mode: 'deposit' | 'withdraw' | 'swap'
  onClose: () => void
  walletAddress: string
  availableWalletUsdc: string
  availableWalletEurc?: string
  availableWalletCirBtc?: string
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
  onExecute,
  onExecuteZap,
  onExecuteDual,
  onExecuteLpWithdraw,
  onExecuteSwap,
  onExecuteCrossChainZap,
}: PoolActionModalProps) {
  const [activeMode, setActiveMode] = useState<'deposit' | 'withdraw' | 'swap'>(initialMode)

  // Live Token Prices
  const { data: tokenPrices } = useLiveTokenPrices()

  // Deposit Source: Native Arc vs Cross-Chain 1-Click Gateway Zap
  const [depositSource, setDepositSource] = useState<'native' | 'crosschain'>('native')
  const [selectedSourceChain, setSelectedSourceChain] = useState<string>('Base_Sepolia')
  const [showChainDropdown, setShowChainDropdown] = useState<boolean>(false)

  const isInitialPoolEmpty = Boolean(
    pool?.isLpPool && (
      pool?.tvlUsd === 0 ||
      (pool?.reserves && (pool.reserves.tokenA === 0 || pool.reserves.tokenB === 0))
    )
  )
  const [lpDepositMethod, setLpDepositMethod] = useState<'zap' | 'dual'>(
    isInitialPoolEmpty ? 'dual' : 'zap'
  )

  // Standard & Zap inputs
  const [amount, setAmount] = useState<string>('')
  const [percentage, setPercentage] = useState<number>(0)

  // Dual LP inputs
  const [amountA, setAmountA] = useState<string>('') // USDC
  const [amountB, setAmountB] = useState<string>('') // Counter token (e.g. EURC, cirBTC)

  // LP Withdraw mode
  const [lpPayoutMode, setLpPayoutMode] = useState<'usdc' | 'dual'>('usdc')

  // Slippage & Settings
  const [slippage, setSlippage] = useState<number>(0.5)
  const [showSettings, setShowSettings] = useState<boolean>(false)
  const [selectedSlippageType, setSelectedSlippageType] = useState<'0.1' | '0.5' | '1.0' | 'custom'>('0.5')
  const [customSlippage, setCustomSlippage] = useState<string>('')

  // Sync slippage numeric value with active toggle or custom input
  useEffect(() => {
    if (selectedSlippageType === 'custom') {
      const parsed = parseFloat(customSlippage)
      if (!isNaN(parsed) && parsed > 0 && parsed <= 50) {
        setSlippage(parsed)
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
    setCustomSlippage('')
    setSelectedSlippageType('0.5')
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

  // Multi-chain balances for Cross-Chain Gateway Zap
  const { walletBalances } = useWalletTestnetBalances(walletAddress)
  const { totalBalance: gatewayTotalBalance } = useGatewayBalance(walletAddress)

  useEffect(() => {
    setActiveMode(initialMode)
    setDepositSource('native')
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
    setSelectedSlippageType('0.5')
    setCustomSlippage('')

    if (pool?.tokens && pool.tokens.length >= 2) {
      setSwapTokenIn(pool.tokens[0].symbol)
      setSwapTokenOut(pool.tokens[1].symbol)
    }
  }, [initialMode, pool, isOpen])

  // Cross-Chain balance on selected source chain (Hook called unconditionally at top level)
  const crossChainBalNum = useMemo(() => {
    if (selectedSourceChain === 'Unified_Gateway') {
      return parseFloat(gatewayTotalBalance || '0')
    }
    const item = walletBalances[selectedSourceChain]
    return parseFloat(item?.usdc || '0')
  }, [selectedSourceChain, walletBalances, gatewayTotalBalance])

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
  const livePoolRate = pool?.reserves && pool.reserves.tokenB > 0 && pool.reserves.tokenA > 0
    ? pool.reserves.tokenA / pool.reserves.tokenB
    : 0
  const exchangeRate = livePoolRate > 0 ? livePoolRate : (pool?.exchangeRate || 0)
  const counterToken = pool.tokens[1]
  const counterTokenSymbol = counterToken?.symbol || 'cirBTC'
  const counterTokenDecimals = counterToken?.decimals || 8
  const feePercent = pool.feeTierPercent || (pool.id === 'usdc-eurc-stable-pool' ? 0.12 : 0.25)

  const crossChainBalStr = crossChainBalNum.toFixed(2)

  // Maximum available depending on mode and deposit source
  const maxAvailable = activeMode === 'deposit'
    ? depositSource === 'crosschain'
      ? crossChainBalNum
      : walletBalUsdc
    : userStaked

  const maxAvailableStr = activeMode === 'deposit'
    ? depositSource === 'crosschain'
      ? `${crossChainBalStr} USDC (${selectedSourceChain === 'Unified_Gateway' ? 'Gateway Unified' : (GATEWAY_CHAIN_NAMES[selectedSourceChain] || selectedSourceChain)})`
      : `${availableWalletUsdc} USDC`
    : `${userStaked.toFixed(2)} USD`

  const depositTokenSymbol = activeMode === 'withdraw'
    ? (isLp ? (pool.lpTokenSymbol || 'LP') : (pool.tokens[0]?.symbol || 'USDC'))
    : depositSource === 'crosschain'
      ? 'USDC'
      : isLp && lpDepositMethod === 'zap'
        ? 'USDC'
        : pool.tokens[0]?.symbol || 'USDC'

  const depositTokenIcon = depositTokenSymbol === 'EURC' || depositTokenSymbol.includes('EURC')
    ? EurcIcon
    : (depositTokenSymbol === 'cirBTC' || depositTokenSymbol === 'BTC' || depositTokenSymbol.includes('cirBTC') || depositTokenSymbol.includes('BTC'))
      ? CirBtcIcon
      : UsdcIcon

  const depositLabel = activeMode === 'withdraw'
    ? (isVault ? 'AMOUNT OF USDC TO REDEEM' : 'AMOUNT TO WITHDRAW')
    : 'AMOUNT TO DEPOSIT'

  const numericBalanceStr = activeMode === 'deposit'
    ? (depositSource === 'crosschain' ? crossChainBalStr : availableWalletUsdc)
    : userStaked.toFixed(2)

  // Swap wallet balance for selected swapTokenIn
  const swapWalletBalTokenIn = swapTokenIn === 'USDC'
    ? walletBalUsdc
    : swapTokenIn === 'EURC'
      ? walletBalEurc
      : walletBalCirBtc

  const swapWalletBalTokenInStr = swapTokenIn === 'USDC' || swapTokenIn === 'EURC'
    ? swapWalletBalTokenIn.toFixed(2)
    : (swapWalletBalTokenIn > 0 && swapWalletBalTokenIn < 0.0001 ? swapWalletBalTokenIn.toFixed(8) : swapWalletBalTokenIn.toFixed(6))

  // Dual-Asset deposit balance and validation calculations
  const aNum = parseFloat(amountA) || 0
  const bNum = parseFloat(amountB) || 0
  const counterWalletBal = counterTokenSymbol === 'EURC' ? walletBalEurc : walletBalCirBtc
  const counterWalletBalStr = counterTokenSymbol === 'EURC' ? availableWalletEurc : availableWalletCirBtc

  const isDualMode = isLp && lpDepositMethod === 'dual' && depositSource === 'native'
  const isDualIncomplete = isDualMode && (aNum <= 0 || bNum <= 0)
  const isDualInsuffA = isDualMode && aNum > walletBalUsdc
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

  // Calculate AMM swap output with pool fee, real pool reserves and slippage
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
      let rawOut = 0
      if (hasReserves && pool.reserves) {
        if (pool.id === 'usdc-eurc-stable-pool') {
          try {
            const rawInBig = parseUnits(swapAmountInNum.toFixed(6), 6)
            const resABig = parseUnits(pool.reserves.tokenA.toFixed(6), 6)
            const resBBig = parseUnits(pool.reserves.tokenB.toFixed(6), 6)
            const outBig = calculateStableSwapExpectedOut(rawInBig, resABig, resBBig, 12n, 100n)
            rawOut = parseFloat(formatUnits(outBig, 6))
          } catch {
            rawOut = (pool.reserves.tokenB * netIn) / (pool.reserves.tokenA + netIn)
          }
        } else {
          // x * y = k AMM Constant Product calculation matching on-chain swap()
          rawOut = (pool.reserves.tokenB * netIn) / (pool.reserves.tokenA + netIn)
        }
      } else if (exchangeRate > 0) {
        rawOut = (swapAmountInNum / exchangeRate) * feeMultiplier
      }
      calculatedSwapOut = rawOut.toFixed(counterTokenDecimals === 8 ? 8 : 4)
      const minOutNum = rawOut * ((100 - slippage) / 100)
      minSwapOutStr = minOutNum.toFixed(counterTokenDecimals === 8 ? 8 : 4)
    } else {
      let rawOut = 0
      if (hasReserves && pool.reserves) {
        if (pool.id === 'usdc-eurc-stable-pool') {
          try {
            const rawInBig = parseUnits(swapAmountInNum.toFixed(6), 6)
            const resABig = parseUnits(pool.reserves.tokenA.toFixed(6), 6)
            const resBBig = parseUnits(pool.reserves.tokenB.toFixed(6), 6)
            const outBig = calculateStableSwapExpectedOut(rawInBig, resBBig, resABig, 12n, 100n)
            rawOut = parseFloat(formatUnits(outBig, 6))
          } catch {
            rawOut = (pool.reserves.tokenA * netIn) / (pool.reserves.tokenB + netIn)
          }
        } else {
          // x * y = k AMM Constant Product calculation matching on-chain swap()
          rawOut = (pool.reserves.tokenA * netIn) / (pool.reserves.tokenB + netIn)
        }
      } else if (exchangeRate > 0) {
        rawOut = (swapAmountInNum * exchangeRate) * feeMultiplier
      }
      calculatedSwapOut = rawOut.toFixed(2)
      const minOutNum = rawOut * ((100 - slippage) / 100)
      minSwapOutStr = minOutNum.toFixed(2)
    }
  }

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
    if (symbol === 'cirBTC') {
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
      const bDecimals = counterTokenDecimals === 8 ? 8 : (counterTokenSymbol === 'EURC' ? 2 : 4)
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
      const calculated = (maxAvailable * (pct / 100)).toFixed(2)
      setAmount(calculated)
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

  // LP preview calculations
  const estimatedLpMinted = inputAmountNum > 0 ? (inputAmountNum * 0.998).toFixed(2) : '0.00'
  const estimatedPoolShare = inputAmountNum > 0
    ? (((inputAmountNum) / (pool.tvlUsd + inputAmountNum)) * 100).toFixed(2)
    : '0.000'

  const isSingleDepositInsuff = activeMode === 'deposit' && !isDualMode && (
    depositSource === 'crosschain'
      ? inputAmountNum > crossChainBalNum
      : inputAmountNum > walletBalUsdc
  )

  const isWithdrawExceeds = activeMode === 'withdraw' && inputAmountNum > userStaked

  const isSubmitDisabled = Boolean(
    isProcessing ||
    (activeMode === 'swap'
      ? isSwapUnavailable || swapAmountInNum <= 0 || swapAmountInNum > swapWalletBalTokenIn
      : activeMode === 'withdraw'
        ? inputAmountNum <= 0 || isWithdrawExceeds
        : isDualMode
          ? isDualIncomplete || isDualInsuffA || isDualInsuffB
          : isZapUnavailable || inputAmountNum <= 0 || isSingleDepositInsuff)
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

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
          setErrorMsg(`Amount exceeds your balance of ${crossChainBalStr} USDC on ${selectedSourceChain === 'Unified_Gateway' ? 'Gateway' : (GATEWAY_CHAIN_NAMES[selectedSourceChain] || selectedSourceChain)}.`)
          return
        }

        setIsProcessing(true)
        try {
          if (onExecuteCrossChainZap) {
            await onExecuteCrossChainZap(pool.id, selectedSourceChain, amount, slippage)
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
        if (aNum > walletBalUsdc) {
          setErrorMsg(`Insufficient USDC balance (${walletBalUsdc} USDC available).`)
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
      if (inputAmountNum > userStaked) {
        setErrorMsg(`Withdrawal amount exceeds your deposited balance of ${userStaked.toFixed(2)}.`)
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

  // Eligible source chains for Cross-Chain Zap (matches ChainItem interface)
  const sourceChainsList = [
    { chain: 'Base_Sepolia', name: 'Base Sepolia', balance: walletBalances['Base_Sepolia']?.usdc || '0.00' },
    { chain: 'Ethereum_Sepolia', name: 'Ethereum Sepolia', balance: walletBalances['Ethereum_Sepolia']?.usdc || '0.00' },
    { chain: 'Arbitrum_Sepolia', name: 'Arbitrum Sepolia', balance: walletBalances['Arbitrum_Sepolia']?.usdc || '0.00' },
    { chain: 'Optimism_Sepolia', name: 'Optimism Sepolia', balance: walletBalances['Optimism_Sepolia']?.usdc || '0.00' },
    { chain: 'Polygon_Amoy_Testnet', name: 'Polygon PoS Amoy', balance: walletBalances['Polygon_Amoy_Testnet']?.usdc || '0.00' },
    { chain: 'Avalanche_Fuji', name: 'Avalanche Fuji', balance: walletBalances['Avalanche_Fuji']?.usdc || '0.00' },
    { chain: 'Unified_Gateway', name: 'Unified Gateway (Multi-Chain)', balance: gatewayTotalBalance || '0.00' },
  ]

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
              title="Slippage & Pool Settings"
            >
              <SlidersHorizontal size={15} />
            </button>

            <button
              onClick={onClose}
              disabled={isProcessing}
              type="button"
              className="ub-action-btn"
              style={{
                padding: 8,
                borderRadius: '50%',
              }}
              title="Close Modal"
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
                  onClick={() => setSelectedSlippageType('custom')}
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
                      max="5.0"
                      placeholder="e.g. 1.0"
                      value={customSlippage}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value)
                        if (!isNaN(val) && val > 5.0) {
                          setCustomSlippage('5.0')
                        } else {
                          setCustomSlippage(e.target.value)
                        }
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
                  {slippage > 3.0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: '#f59e0b' }}>
                      <AlertTriangle size={12} />
                      <span>High slippage may result in unfavorable execution (strictly capped at 5.0% max).</span>
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

          {/* ── Deposit Source Switcher: Arc Native vs Cross-Chain Gateway Zap ── */}
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
                <span>Arc Native</span>
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
                    FROM NETWORK
                  </div>
                  <span className="text-[12px] text-slate-400 font-medium">
                    {crossChainBalStr} USDC
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
                      <NetworkIcon
                        name={CHAIN_META[selectedSourceChain]?.iconId || getChainIconId(selectedSourceChain)}
                        variant={selectedSourceChain === 'Solana_Devnet' ? 'branded' : 'background'}
                        size={20}
                        className="rounded-full"
                      />
                    </div>
                    <span className="text-xs font-semibold text-white truncate">
                      {CHAIN_META[selectedSourceChain]?.name || getChainDisplayName(selectedSourceChain)}
                    </span>
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>
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
                  tokenSymbol={swapTokenIn}
                  tokenIcon={swapTokenIn === 'EURC' ? EurcIcon : (swapTokenIn === 'cirBTC' ? CirBtcIcon : UsdcIcon)}
                  tokenListAvailable={false}
                  balance={swapWalletBalTokenInStr}
                  onMaxClick={() => {
                    if (swapTokenIn === 'USDC') {
                      const maxUsdcWithGas = Math.max(0, swapWalletBalTokenIn - ARC_GAS_RESERVE_USDC)
                      setSwapAmountIn(maxUsdcWithGas.toFixed(2))
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
                    const decimals = swapTokenIn === 'cirBTC' ? 6 : 2
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
                    title="Switch Swap Direction"
                  >
                    <ArrowUpDown size={14} />
                  </button>
                </div>

                {/* Output: YOU RECEIVE */}
                <AssetInputPanel
                  label="YOU RECEIVE (ESTIMATED)"
                  amount={calculatedSwapOut}
                  readOnly={true}
                  placeholder={swapTokenOut === 'cirBTC' ? '0.0000' : '0.00'}
                  tokenSymbol={swapTokenOut}
                  tokenIcon={swapTokenOut === 'EURC' ? EurcIcon : (swapTokenOut === 'cirBTC' ? CirBtcIcon : UsdcIcon)}
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
                  label="AMOUNT TO DEPOSIT"
                  amount={amountA}
                  onAmountChange={handleAmountAChange}
                  tokenSymbol="USDC"
                  tokenIcon={UsdcIcon}
                  tokenListAvailable={false}
                  balance={availableWalletUsdc}
                  onMaxClick={() => {
                    const maxUsdcWithGas = Math.max(0, walletBalUsdc - ARC_GAS_RESERVE_USDC)
                    handleAmountAChange(maxUsdcWithGas.toFixed(2))
                  }}
                  quickPercentages={[25, 50, 75, 100]}
                  onSelectPercentage={(pct) => {
                    const maxUsdcWithGas = Math.max(0, walletBalUsdc - ARC_GAS_RESERVE_USDC)
                    handleAmountAChange(((maxUsdcWithGas * pct) / 100).toFixed(2))
                  }}
                  fiatEstimate={formatFiatEstimate(amountA, 'USDC', tokenPrices)}
                  disabled={isProcessing}
                />
                <AssetInputPanel
                  label="AMOUNT TO DEPOSIT"
                  amount={amountB}
                  onAmountChange={handleAmountBChange}
                  tokenSymbol={counterTokenSymbol}
                  tokenIcon={counterTokenSymbol === 'EURC' ? EurcIcon : CirBtcIcon}
                  tokenListAvailable={false}
                  balance={counterTokenSymbol === 'EURC' ? availableWalletEurc : availableWalletCirBtc}
                  onMaxClick={() => {
                    const bal = counterTokenSymbol === 'EURC' ? availableWalletEurc : availableWalletCirBtc
                    handleAmountBChange(bal)
                  }}
                  quickPercentages={[25, 50, 75, 100]}
                  onSelectPercentage={(pct) => {
                    const balNum = parseFloat(counterTokenSymbol === 'EURC' ? availableWalletEurc : availableWalletCirBtc) || 0
                    handleAmountBChange(((balNum * pct) / 100).toFixed(counterTokenSymbol === 'EURC' ? 2 : 6))
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
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Minimum Received ({slippage}% Slippage):</span>
                  <span style={{ color: '#fff', fontWeight: 600 }}>{minSwapOutStr} {swapTokenOut}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>AMM Swap Fee ({feePercent}%):</span>
                  <span style={{ color: 'var(--fp-2)' }}>{(swapAmountInNum * (feePercent / 100)).toFixed(4)} {swapTokenIn}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Estimated Price Impact:</span>
                  <span style={{ color: '#34d399', fontWeight: 600 }}>&lt; 0.05%</span>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Estimated LP Minted:</span>
                  <span style={{ color: '#fff', fontWeight: 600 }}>~{estimatedLpMinted} {pool.lpTokenSymbol || 'LP'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Pool Share:</span>
                  <span style={{ color: 'var(--purple-1)', fontWeight: 600 }}>~{estimatedPoolShare}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Projected Annual Return ({pool.apy.toFixed(2)}% {pool.apyType}):</span>
                  <span style={{ color: 'var(--earned-green)', fontWeight: 600 }}>+{annualYield.toFixed(2)} USD</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Slippage:</span>
                  <span style={{ color: 'var(--fp-2)' }}>{slippage}%</span>
                </div>
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
                  <span>Projected Annual Return ({pool.apy.toFixed(2)}% {pool.apyType}):</span>
                  <span style={{ color: 'var(--earned-green)', fontWeight: 600 }}>+${annualYield.toFixed(2)} USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Estimated Daily Yield:</span>
                  <span style={{ color: 'var(--fp-2)' }}>+{dailyYield.toFixed(4)} USDC/day</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fp-3)' }}>
                  <span>Pool Share:</span>
                  <span style={{ color: 'var(--purple-1)', fontWeight: 600 }}>~{estimatedPoolShare}%</span>
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
              {isProcessing ? (
                <>
                  <RefreshCw size={15} className="arcis-spin" />
                  <span>
                    {activeMode === 'swap'
                      ? 'SWAPPING...'
                      : activeMode === 'deposit'
                        ? depositSource === 'crosschain'
                          ? 'TELEPORTING VIA CIRCLE GATEWAY (<500MS)...'
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
                  ) : (
                    <>
                      <Plus size={16} />
                      <span>ADD LIQUIDITY</span>
                    </>
                  )
                ) : isSingleDepositInsuff ? (
                  <span>INSUFFICIENT BALANCE</span>
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
        title="Select Source Network"
      />
    </>,
    document.body
  )
}
