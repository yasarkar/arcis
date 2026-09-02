// src/components/pools/PoolActionModal.tsx
//
// Interactive Deposit, Withdraw & AMM Swap modal for ArcFlow Pools & Yield Hub (Phase 5 Enhanced).
// Supports Standard Deposit/Redeem, Cross-Chain 1-Click Gateway Zap (<500ms sub-second teleportation),
// 1-Click Single-Token Zap to LP, Dual-Asset (50/50) Deposit, Slippage tolerance controls,
// LP Withdraw options, and on-chain Pool AMM Swapping (USDC ↔ tcirBTC / EURC).

import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Plus,
  Minus,
  TrendingUp,
  AlertTriangle,
  RefreshCw,
  Zap,
  Layers,
  ArrowRightLeft,
  ArrowUpDown,
  Globe,
  ChevronDown,
} from 'lucide-react'
import UsdcIcon from '../../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../../assets/Token-Icon/EURC Token.svg'
import CirBtcIcon from '../../assets/Token-Icon/cirBTC Token.svg'
import type { PoolConfig } from '../../config/poolsConfig'
import type { UserPoolPosition } from '../../hooks/usePoolsData'
import { useWalletTestnetBalances } from '../../hooks/useWalletTestnetBalances'
import { useGatewayBalance } from '../../hooks/useGatewayBalance'
import { GATEWAY_CHAIN_NAMES } from '../../config/gatewayConfig'

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

// Arc gas reserve constant: keeps $0.50 USDC for future sub-second network fees
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
  
  // Deposit Source: Native Arc vs Cross-Chain 1-Click Gateway Zap
  const [depositSource, setDepositSource] = useState<'native' | 'crosschain'>('native')
  const [selectedSourceChain, setSelectedSourceChain] = useState<string>('Base_Sepolia')
  const [showChainDropdown, setShowChainDropdown] = useState<boolean>(false)

  const [lpDepositMethod, setLpDepositMethod] = useState<'zap' | 'dual'>('zap')
  
  // Standard & Zap inputs
  const [amount, setAmount] = useState<string>('')
  const [percentage, setPercentage] = useState<number>(0)
  
  // Dual LP inputs
  const [amountA, setAmountA] = useState<string>('') // USDC
  const [amountB, setAmountB] = useState<string>('') // Counter token (e.g. EURC, tcirBTC)
  
  // LP Withdraw mode
  const [lpPayoutMode, setLpPayoutMode] = useState<'usdc' | 'dual'>('usdc')
  
  // Slippage & Settings
  const [slippage, setSlippage] = useState<number>(0.5)
  const [showSettings, setShowSettings] = useState<boolean>(false)
  
  // AMM Swap state
  const [swapTokenIn, setSwapTokenIn] = useState<string>('USDC')
  const [swapTokenOut, setSwapTokenOut] = useState<string>('tcirBTC')
  const [swapAmountIn, setSwapAmountIn] = useState<string>('')

  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

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
    setErrorMsg(null)
    setLpDepositMethod('zap')
    setLpPayoutMode('usdc')

    if (pool?.tokens && pool.tokens.length >= 2) {
      setSwapTokenIn(pool.tokens[0].symbol)
      setSwapTokenOut(pool.tokens[1].symbol)
    }
  }, [initialMode, pool, isOpen])

  if (!isOpen || !pool) return null

  const isLp = Boolean(pool.isLpPool)
  const userStaked = parseFloat(pool.userPosition?.stakedAmount || '0')
  const walletBalUsdc = parseFloat(availableWalletUsdc || '0')
  const walletBalEurc = parseFloat(availableWalletEurc || '0')
  const walletBalCirBtc = parseFloat(availableWalletCirBtc || '0')
  const exchangeRate = pool.exchangeRate || 1.0
  const counterToken = pool.tokens[1]
  const counterTokenSymbol = counterToken?.symbol || 'tcirBTC'
  const counterTokenDecimals = counterToken?.decimals || 8
  const feePercent = pool.feeTierPercent || (pool.id === 'usdc-eurc-stable-pool' ? 0.12 : 0.25)

  // Cross-Chain balance on selected source chain
  const crossChainBalNum = useMemo(() => {
    if (selectedSourceChain === 'Unified_Gateway') {
      return parseFloat(gatewayTotalBalance || '0')
    }
    const item = walletBalances[selectedSourceChain]
    return parseFloat(item?.usdc || '0')
  }, [selectedSourceChain, walletBalances, gatewayTotalBalance])

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

  // Swap wallet balance for selected swapTokenIn
  const swapWalletBalTokenIn = swapTokenIn === 'USDC'
    ? walletBalUsdc
    : swapTokenIn === 'EURC'
      ? walletBalEurc
      : walletBalCirBtc

  const swapWalletBalTokenInStr = swapTokenIn === 'USDC' || swapTokenIn === 'EURC'
    ? swapWalletBalTokenIn.toFixed(2)
    : swapWalletBalTokenIn.toFixed(4)

  // Calculate AMM swap output with pool fee and exchange rate
  const swapAmountInNum = parseFloat(swapAmountIn) || 0
  let calculatedSwapOut = '0.00'
  let minSwapOutStr = '0.00'

  if (swapAmountInNum > 0 && exchangeRate > 0) {
    const feeMultiplier = (100 - feePercent) / 100
    if (swapTokenIn === 'USDC') {
      const rawOut = (swapAmountInNum / exchangeRate) * feeMultiplier
      calculatedSwapOut = rawOut.toFixed(counterTokenDecimals === 8 ? 6 : 4)
      const minOutNum = rawOut * ((100 - slippage) / 100)
      minSwapOutStr = minOutNum.toFixed(counterTokenDecimals === 8 ? 6 : 4)
    } else {
      const rawOut = (swapAmountInNum * exchangeRate) * feeMultiplier
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
    if (symbol === 'tcirBTC' || symbol === 'cirBTC') {
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
      const requiredB = (num / exchangeRate).toFixed(pool.tokens[1]?.decimals === 8 ? 4 : 2)
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
          // Reserve $0.50 USDC for Arc network gas fees
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
    ? (((inputAmountNum) / (pool.tvlUsd + inputAmountNum)) * 100).toFixed(3)
    : '0.000'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    // ── AMM Swap Mode ──
    if (activeMode === 'swap') {
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
        setErrorMsg(err.message || 'Swap transaction failed on Arc Testnet.')
      } finally {
        setIsProcessing(false)
      }
      return
    }

    // ── Deposit Mode ──
    if (activeMode === 'deposit') {
      // Cross-Chain 1-Click Gateway Zap
      if (depositSource === 'crosschain') {
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
          setErrorMsg(err.message || 'Cross-Chain Zap transaction failed.')
        } finally {
          setIsProcessing(false)
        }
        return
      }

      // Native Dual LP Deposit
      if (isLp && lpDepositMethod === 'dual') {
        const aNum = parseFloat(amountA)
        const bNum = parseFloat(amountB)
        if (isNaN(aNum) || aNum <= 0 || isNaN(bNum) || bNum <= 0) {
          setErrorMsg('Please enter valid amounts for both tokens in the dual deposit.')
          return
        }
        if (aNum > walletBalUsdc) {
          setErrorMsg(`Insufficient USDC balance (${walletBalUsdc} USDC available).`)
          return
        }
        if (pool.tokens[1]?.symbol === 'EURC' && bNum > walletBalEurc) {
          setErrorMsg(`Insufficient EURC balance (${walletBalEurc} EURC available).`)
          return
        }
        if ((pool.tokens[1]?.symbol === 'tcirBTC' || pool.tokens[1]?.symbol === 'cirBTC') && bNum > walletBalCirBtc) {
          setErrorMsg(`Insufficient ${pool.tokens[1].symbol} balance (${walletBalCirBtc} ${pool.tokens[1].symbol} available).`)
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
          console.error('[PoolActionModal] Error:', err)
          setErrorMsg(err.message || 'Transaction failed on Arc Testnet.')
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

      setIsProcessing(true)
      try {
        if (isLp && onExecuteZap) {
          await onExecuteZap(pool.id, 'USDC', amount, slippage)
        } else {
          await onExecute(pool.id, amount, 'deposit')
        }
        onClose()
      } catch (err: any) {
        console.error('[PoolActionModal] Error:', err)
        setErrorMsg(err.message || 'Transaction failed on Arc Testnet.')
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
        setErrorMsg(`Withdrawal amount exceeds your deposited balance of $${userStaked.toFixed(2)}.`)
        return
      }

      setIsProcessing(true)
      try {
        if (isLp && onExecuteLpWithdraw) {
          await onExecuteLpWithdraw(pool.id, amount, lpPayoutMode, slippage)
        } else {
          await onExecute(pool.id, amount, 'withdraw')
        }
        onClose()
      } catch (err: any) {
        console.error('[PoolActionModal] Error:', err)
        setErrorMsg(err.message || 'Withdrawal failed on Arc Testnet.')
      } finally {
        setIsProcessing(false)
      }
    }
  }

  // Eligible source chains for Cross-Chain Zap
  const sourceChainsList = [
    { key: 'Base_Sepolia', name: 'Base Sepolia', balance: walletBalances['Base_Sepolia']?.usdc || '0.00' },
    { key: 'Ethereum_Sepolia', name: 'Ethereum Sepolia', balance: walletBalances['Ethereum_Sepolia']?.usdc || '0.00' },
    { key: 'Arbitrum_Sepolia', name: 'Arbitrum Sepolia', balance: walletBalances['Arbitrum_Sepolia']?.usdc || '0.00' },
    { key: 'Optimism_Sepolia', name: 'Optimism Sepolia', balance: walletBalances['Optimism_Sepolia']?.usdc || '0.00' },
    { key: 'Polygon_Amoy_Testnet', name: 'Polygon PoS Amoy', balance: walletBalances['Polygon_Amoy_Testnet']?.usdc || '0.00' },
    { key: 'Avalanche_Fuji', name: 'Avalanche Fuji', balance: walletBalances['Avalanche_Fuji']?.usdc || '0.00' },
    { key: 'Unified_Gateway', name: 'Unified Gateway Balance (Multi-Chain)', balance: gatewayTotalBalance || '0.00' },
  ]

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        animation: 'arc-reveal 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProcessing) onClose()
      }}
    >
      <div
        className="ub-hero-card"
        style={{
          width: '100%',
          maxWidth: 580,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'linear-gradient(180deg, rgba(17, 21, 38, 0.98) 0%, rgba(11, 13, 24, 0.99) 100%)',
          border: '1px solid rgba(152, 150, 255, 0.35)',
          boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.9), 0 0 32px rgba(152, 150, 255, 0.15)',
          borderRadius: 24,
          padding: '28px',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isProcessing}
          type="button"
          className="ub-action-btn"
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            padding: 8,
            borderRadius: '50%',
          }}
          title="Close Modal"
        >
          <X size={16} />
        </button>

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
                ? 'Cross-Chain 1-Click Gateway Zap'
                : isLp
                ? 'Add Liquidity'
                : 'Deposit to Vault'
              : activeMode === 'withdraw'
              ? isLp
                ? 'Remove Liquidity'
                : 'Withdraw from Vault'
              : `Pool AMM Swap (${pool.tokens[0]?.symbol} ↔ ${pool.tokens[1]?.symbol})`}
          </h2>
        </div>

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
            <span>Deposit</span>
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
            <span>Withdraw</span>
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
              <Zap size={13} style={{ color: 'var(--purple-1)' }} />
              <span>Arc Native Wallet</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDepositSource('crosschain')
                setAmount('')
                setPercentage(0)
                setErrorMsg(null)
              }}
              style={{
                padding: '8px 10px',
                borderRadius: 9,
                border: 'none',
                background: depositSource === 'crosschain' ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.25) 0%, rgba(99, 102, 241, 0.25) 100%)' : 'transparent',
                color: depositSource === 'crosschain' ? '#38bdf8' : 'var(--fp-3)',
                fontSize: 12,
                fontFamily: 'var(--font-app)',
                fontWeight: depositSource === 'crosschain' ? 600 : 500,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
            >
              <Globe size={13} style={{ color: '#38bdf8' }} />
              <span>🌐 1-Click Gateway Zap</span>
            </button>
          </div>
        )}

        {/* ── Cross-Chain Gateway Zap Configuration Area ── */}
        {activeMode === 'deposit' && depositSource === 'crosschain' && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.08) 0%, rgba(99, 102, 241, 0.08) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: 16,
              padding: '14px 16px',
              marginBottom: 16,
            }}
          >
            {/* Source Network Dropdown */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--fp-4)', fontWeight: 600 }}>SOURCE NETWORK</span>
                <span style={{ fontSize: 11, color: '#38bdf8', fontWeight: 600 }}>
                  Avail: {crossChainBalStr} USDC
                </span>
              </div>

              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowChainDropdown(!showChainDropdown)}
                  style={{
                    width: '100%',
                    background: 'rgba(11, 13, 24, 0.9)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    borderRadius: 12,
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    color: '#fff',
                    fontSize: 13,
                    fontFamily: 'var(--font-app)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Globe size={15} style={{ color: '#38bdf8' }} />
                    <span style={{ fontWeight: 600 }}>
                      {sourceChainsList.find((c) => c.key === selectedSourceChain)?.name || selectedSourceChain}
                    </span>
                  </div>
                  <ChevronDown size={14} style={{ color: 'var(--fp-3)' }} />
                </button>

                {showChainDropdown && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 4px)',
                      left: 0,
                      right: 0,
                      background: 'rgba(15, 18, 32, 0.98)',
                      backdropFilter: 'blur(20px)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      borderRadius: 12,
                      padding: 4,
                      zIndex: 100,
                      maxHeight: 200,
                      overflowY: 'auto',
                    }}
                  >
                    {sourceChainsList.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          setSelectedSourceChain(item.key)
                          setShowChainDropdown(false)
                          setAmount('')
                          setPercentage(0)
                        }}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: selectedSourceChain === item.key ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                          border: 'none',
                          color: '#fff',
                          fontSize: 12,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontWeight: selectedSourceChain === item.key ? 600 : 400 }}>{item.name}</span>
                        <span style={{ color: '#38bdf8', fontWeight: 600 }}>${item.balance} USDC</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Instant Teleportation Routing Visualization */}
            <div
              style={{
                background: 'rgba(11, 13, 24, 0.7)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 12,
                padding: '10px 12px',
                fontSize: 11,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: 'var(--fp-3)' }}>1-Click Cross-Chain Route:</span>
                <span style={{ color: 'var(--earned-green)', fontWeight: 700 }}>⚡ &lt; 500ms Finality</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#fff', fontWeight: 600 }}>
                <span>{selectedSourceChain === 'Unified_Gateway' ? 'Gateway' : selectedSourceChain.replace('_', ' ')}</span>
                <span style={{ color: 'var(--purple-1)' }}>➔</span>
                <span style={{ color: '#38bdf8' }}>Circle Gateway (Burn &amp; Mint)</span>
                <span style={{ color: 'var(--purple-1)' }}>➔</span>
                <span style={{ color: '#01d062' }}>{pool.name}</span>
              </div>
            </div>
          </div>
        )}

        {/* Native LP Deposit Method Switcher (When depositSource === 'native') */}
        {isLp && activeMode === 'deposit' && depositSource === 'native' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
            <button
              type="button"
              onClick={() => { setLpDepositMethod('zap'); setErrorMsg(null) }}
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: 10,
                background: lpDepositMethod === 'zap' ? 'rgba(152, 150, 255, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                border: lpDepositMethod === 'zap' ? '1px solid rgba(152, 150, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                color: lpDepositMethod === 'zap' ? '#fff' : 'var(--fp-3)',
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
              <Zap size={13} style={{ color: 'var(--purple-1)' }} />
              <span>⚡ 1-Click Zap</span>
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
              <Layers size={13} />
              <span>⚖️ Dual-Asset</span>
            </button>
          </div>
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
              <Zap size={13} style={{ color: 'var(--purple-1)' }} />
              <span>100% USDC Payout</span>
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
              <span>Dual Token Payout</span>
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {activeMode === 'swap' ? (
            /* ── AMM Swap View ── */
            <div style={{ marginBottom: 18 }}>
              <div
                style={{
                  background: 'rgba(99, 102, 241, 0.08)',
                  border: '1px solid rgba(99, 102, 241, 0.25)',
                  borderRadius: 14,
                  padding: '10px 14px',
                  marginBottom: 16,
                  fontSize: 12,
                  fontFamily: 'var(--font-app)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <TrendingUp size={14} style={{ color: '#818cf8' }} />
                  <span style={{ color: '#c7d2fe' }}>
                    <strong>AMM Engine:</strong> Constant Product ($x \cdot y = k$)
                  </span>
                </div>
                <span style={{ color: '#a5b4fc', fontWeight: 600, fontSize: 11 }}>
                  Fee: {feePercent}%
                </span>
              </div>

              <div
                style={{
                  background: 'rgba(11, 13, 24, 0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 16,
                  padding: '14px 16px',
                  marginBottom: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 11, color: 'var(--fp-3)' }}>
                  <span>YOU PAY</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>
                      Available: <strong style={{ color: '#fff' }}>{swapWalletBalTokenInStr} {swapTokenIn}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (swapTokenIn === 'USDC') {
                          const maxUsdcWithGas = Math.max(0, swapWalletBalTokenIn - ARC_GAS_RESERVE_USDC)
                          setSwapAmountIn(maxUsdcWithGas.toFixed(2))
                        } else {
                          setSwapAmountIn(swapWalletBalTokenIn.toString())
                        }
                        setErrorMsg(null)
                      }}
                      style={{
                        background: 'rgba(152, 150, 255, 0.18)',
                        border: '1px solid rgba(152, 150, 255, 0.35)',
                        borderRadius: 6,
                        padding: '1px 6px',
                        color: 'var(--purple-1)',
                        fontSize: 10,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                      title={swapTokenIn === 'USDC' ? 'Max amount reserving $0.50 for Arc gas' : 'Max available balance'}
                    >
                      MAX
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input
                    type="number"
                    step={swapTokenIn === 'tcirBTC' || swapTokenIn === 'cirBTC' ? '0.0001' : 'any'}
                    min="0"
                    placeholder="0.00"
                    value={swapAmountIn}
                    onChange={(e) => {
                      setSwapAmountIn(e.target.value)
                      setErrorMsg(null)
                    }}
                    disabled={isProcessing}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      fontSize: 20,
                      fontWeight: 600,
                      color: '#fff',
                      fontFamily: 'var(--fonts--space-grotesk)',
                      outline: 'none',
                    }}
                  />

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: 99,
                      padding: '6px 12px',
                      flexShrink: 0,
                    }}
                  >
                    {renderTokenBadgeIcon(swapTokenIn)}
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'var(--fonts--space-grotesk)' }}>
                      {swapTokenIn}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', margin: '-10px 0', zIndex: 2, position: 'relative' }}>
                <button
                  type="button"
                  onClick={handleFlipSwapDirection}
                  style={{
                    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.35) 0%, rgba(139, 92, 246, 0.4) 100%)',
                    border: '1px solid rgba(152, 150, 255, 0.4)',
                    borderRadius: '50%',
                    width: 34,
                    height: 34,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    color: '#fff',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
                    transition: 'all 0.2s ease',
                  }}
                  title="Switch Swap Direction"
                >
                  <ArrowUpDown size={15} />
                </button>
              </div>

              <div
                style={{
                  background: 'rgba(11, 13, 24, 0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 16,
                  padding: '14px 16px',
                  marginTop: 6,
                  marginBottom: 16,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 11, color: 'var(--fp-3)' }}>
                  <span>YOU RECEIVE (ESTIMATED)</span>
                  <span>1 {counterTokenSymbol} ≈ {exchangeRate.toLocaleString()} USDC</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 20,
                      fontWeight: 600,
                      color: 'var(--earned-green)',
                      fontFamily: 'var(--fonts--space-grotesk)',
                    }}
                  >
                    {calculatedSwapOut}
                  </span>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: 99,
                      padding: '6px 12px',
                      flexShrink: 0,
                    }}
                  >
                    {renderTokenBadgeIcon(swapTokenOut)}
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'var(--fonts--space-grotesk)' }}>
                      {swapTokenOut}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : isLp && activeMode === 'deposit' && lpDepositMethod === 'dual' && depositSource === 'native' ? (
            /* ── Dual Token Deposit (Native Arc Only) ── */
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, fontSize: 11, color: 'var(--fp-3)' }}>
                  <span>TOKEN A (USDC)</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>Available: <strong style={{ color: '#fff' }}>{availableWalletUsdc}</strong></span>
                    <button
                      type="button"
                      onClick={() => {
                        const maxUsdcWithGas = Math.max(0, walletBalUsdc - ARC_GAS_RESERVE_USDC)
                        handleAmountAChange(maxUsdcWithGas.toFixed(2))
                      }}
                      style={{
                        background: 'rgba(152, 150, 255, 0.18)',
                        border: '1px solid rgba(152, 150, 255, 0.35)',
                        borderRadius: 4,
                        padding: '1px 5px',
                        color: 'var(--purple-1)',
                        fontSize: 9,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                      title="Max amount reserving $0.50 for Arc gas"
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0.00"
                    value={amountA}
                    onChange={(e) => handleAmountAChange(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(11, 13, 24, 0.85)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: 14,
                      padding: '12px 16px',
                      fontSize: 16,
                      color: '#fff',
                      fontFamily: 'var(--fonts--space-grotesk)',
                      outline: 'none',
                    }}
                  />
                  <img src={UsdcIcon} alt="USDC" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, objectFit: 'contain' }} />
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, fontSize: 11, color: 'var(--fp-3)' }}>
                  <span>TOKEN B ({counterTokenSymbol})</span>
                  <span>
                    Available: <strong style={{ color: '#fff' }}>{counterTokenSymbol === 'EURC' ? availableWalletEurc : availableWalletCirBtc}</strong>
                  </span>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0.00"
                    value={amountB}
                    onChange={(e) => handleAmountBChange(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(11, 13, 24, 0.85)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: 14,
                      padding: '12px 16px',
                      fontSize: 16,
                      color: '#fff',
                      fontFamily: 'var(--fonts--space-grotesk)',
                      outline: 'none',
                    }}
                  />
                  {counterTokenSymbol === 'EURC' ? (
                    <img src={EurcIcon} alt="EURC" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, objectFit: 'contain' }} />
                  ) : (
                    <img src={CirBtcIcon} alt="BTC" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, objectFit: 'contain' }} />
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ── Single Token / Zap Deposit or Withdraw ── */
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--fp-3)' }}>
                  {activeMode === 'deposit'
                    ? depositSource === 'crosschain'
                      ? 'CROSS-CHAIN DEPOSIT AMOUNT (USDC)'
                      : 'AMOUNT TO DEPOSIT'
                    : 'AMOUNT TO WITHDRAW'}
                </label>
                <span style={{ fontSize: 12, color: 'var(--fp-3)' }}>
                  Available: <strong style={{ color: '#fff' }}>{maxAvailableStr}</strong>
                </span>
              </div>
              <input
                type="number"
                step="any"
                min="0"
                placeholder="0.00"
                value={amount}
                onChange={(e) => handleAmountInputChange(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(11, 13, 24, 0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: 16,
                  padding: '14px 18px',
                  fontSize: 18,
                  color: '#fff',
                  fontFamily: 'var(--fonts--space-grotesk)',
                  outline: 'none',
                }}
              />
            </div>
          )}

          {activeMode !== 'swap' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: activeMode === 'deposit' && depositSource === 'native' ? 10 : 18 }}>
              {[25, 50, 75, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => handlePercentageChange(pct)}
                  disabled={isProcessing || maxAvailable <= 0}
                  style={{
                    padding: '7px 0',
                    borderRadius: 10,
                    background: percentage === pct ? 'rgba(152, 150, 255, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                    border: percentage === pct ? '1px solid rgba(152, 150, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                    color: percentage === pct ? 'var(--purple-1)' : 'var(--fp-3)',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: maxAvailable <= 0 ? 'not-allowed' : 'pointer',
                    opacity: maxAvailable <= 0 ? 0.4 : 1,
                  }}
                >
                  {pct === 100 ? 'MAX' : `${pct}%`}
                </button>
              ))}
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
                  <strong>Arc Gas Shield:</strong> $0.50 USDC is automatically kept for transaction fees on MAX.
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
                  -$0.50 Gas Reserved
                </span>
              )}
            </div>
          )}

          {errorMsg && (
            <div style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 12, fontSize: 12, color: '#f87171', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={14} /> <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={
              isProcessing ||
              (activeMode === 'swap' ? swapAmountInNum <= 0 || swapAmountInNum > swapWalletBalTokenIn : inputAmountNum <= 0)
            }
            style={{
              width: '100%',
              padding: '14px 0',
              borderRadius: 99,
              border: 'none',
              background:
                isProcessing || (activeMode === 'swap' ? swapAmountInNum <= 0 || swapAmountInNum > swapWalletBalTokenIn : inputAmountNum <= 0)
                  ? 'rgba(152, 150, 255, 0.25)'
                  : activeMode === 'swap'
                  ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                  : activeMode === 'deposit'
                  ? depositSource === 'crosschain'
                    ? 'linear-gradient(135deg, #0284c7 0%, #6366f1 100%)'
                    : 'linear-gradient(135deg, #9896ff 0%, #6366f1 100%)'
                  : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              transition: 'all 0.2s ease',
            }}
          >
            {isProcessing ? (
              <>
                <RefreshCw size={15} className="arcflow-spin" />
                <span>
                  {depositSource === 'crosschain'
                    ? 'TELEPORTING VIA CIRCLE GATEWAY (<500MS)...'
                    : 'CONFIRMING ON ARC TESTNET...'}
                </span>
              </>
            ) : activeMode === 'swap' ? (
              swapAmountInNum <= 0 ? (
                <span>ENTER SWAP AMOUNT</span>
              ) : swapAmountInNum > swapWalletBalTokenIn ? (
                <span>INSUFFICIENT {swapTokenIn} BALANCE</span>
              ) : (
                <>
                  <ArrowRightLeft size={16} />
                  <span>SWAP {swapTokenIn} FOR {swapTokenOut}</span>
                </>
              )
            ) : activeMode === 'deposit' ? (
              depositSource === 'crosschain' ? (
                <>
                  <Globe size={16} />
                  <span>EXECUTE 1-CLICK GATEWAY ZAP (${inputAmountNum.toFixed(2)} USDC)</span>
                </>
              ) : (
                <>
                  <Plus size={16} />
                  <span>
                    {isLp && lpDepositMethod === 'zap'
                      ? `1-CLICK ZAP IN (${inputAmountNum.toFixed(2)} USDC)`
                      : `DEPOSIT ${inputAmountNum.toFixed(2)} USDC`}
                  </span>
                </>
              )
            ) : (
              <>
                <Minus size={16} />
                <span>WITHDRAW ${inputAmountNum.toFixed(2)}</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>,
    document.body
  )
}
