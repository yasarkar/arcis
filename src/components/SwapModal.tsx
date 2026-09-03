import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  ArrowRightLeft,
  AlertTriangle,
  Settings,
  Wallet,
  Clipboard,
  Check,
  Edit3,
  ChevronDown,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import { formatWalletError } from '../utils/errorUtils'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { createViemAdapter } from '../services/sendService'
import { getSwapEstimate, executeSwap, getSupportedSwapChains } from '../services/swapService'
import { getDisplayTokenSymbol } from '../utils/tokenUtils'
import { addTransaction } from '../utils/history'
import { PrivacyLockButton } from './privacy/PrivacyLockButton'
import { useBroadcast } from './BroadcastNotification'
import { SpeedFeeSelector } from './common/SpeedFeeSelector'
import { SPEED_TIERS, type SpeedTier } from '../config/feeTiers'
import {
  getSwapProtocolFeeBps,
  getSwapProtocolFeePercent,
  calculateSwapProtocolFeeAmount,
  TREASURY_ADDRESS,
  TREASURY_EXPLORER_URL,
  formatTreasuryAddress,
  REVENUE_SHARE_LABEL,
  REVENUE_SHARE_TOOLTIP,
} from '../config/treasuryConfig'
import { getChainIconId } from '../config/swapConfig'
import { getExplorerTxUrl } from '../config/sendConfig'
import {
  FintechCard,
  AssetInputPanel,
  DirectionSwitchButton,
  TokenSelectorModal,
  ChainSelectorModal,
  TransactionBreakdown,
  FintechActionButton,
  SwapSuccessReceipt,
  type TokenItem,
  type BreakdownItem,
} from './fintech'

const TOKEN_ICONS: Record<string, string> = {
  USDC: UsdcIcon,
  EURC: EurcIcon,
  cirBTC: CircleIcon,
}

interface SwapModalProps {
  isOpen: boolean
  isInline?: boolean
  onClose: () => void
  connectedAddress: string
  provider: any
  currentChainId: number
  onSuccess: (amountIn: string, amountOut: string, tokenIn: string, tokenOut: string, txHash: string) => void
  addToast?: (title: string, description: string, type: 'info' | 'success' | 'warning' | 'error' | 'pending', txHash?: string, network?: string) => string
  removeToast?: (id: string) => void
}

export default function SwapModal({
  isOpen,
  isInline = false,
  onClose,
  connectedAddress,
  provider,
  onSuccess,
}: SwapModalProps) {
  const { addBroadcast, updateBroadcast } = useBroadcast()
  const [isPrivateSwap, setIsPrivateSwap] = useState(false)

  // Dynamic Chain Selector
  const [selectedChain, setSelectedChain] = useState('Arc_Testnet')
  const [showChainModal, setShowChainModal] = useState(false)

  // Token Selector Modals
  const [showTokenInModal, setShowTokenInModal] = useState(false)
  const [showTokenOutModal, setShowTokenOutModal] = useState(false)

  // Routing State
  const fromChain = selectedChain
  const toChain = selectedChain

  const [tokenIn, setTokenIn] = useState('USDC')
  const [tokenOut, setTokenOut] = useState('EURC')
  const [amountIn, setAmountIn] = useState('')
  const [allowanceStrategy] = useState<'permit' | 'approve'>('approve')

  // Settings & Slippage
  const [showSettings, setShowSettings] = useState(false)
  const [selectedSlippageType, setSelectedSlippageType] = useState<'0.1' | '0.5' | '1.0' | 'custom'>('0.5')
  const [customSlippage, setCustomSlippage] = useState('')

  // Custom Recipient Address
  const [useCustomRecipient, setUseCustomRecipient] = useState(false)
  const [customRecipient, setCustomRecipient] = useState('')
  const [recipientError, setRecipientError] = useState<string | null>(null)
  const [isEditingRecipient, setIsEditingRecipient] = useState(false)
  const recipientInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditingRecipient) {
      const timer = setTimeout(() => {
        recipientInputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isEditingRecipient])

  const formatAddress = (addr: string) => (addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '')

  // Swap Execution States
  const [isSwapping, setIsSwapping] = useState(false)
  const [successData, setSuccessData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Quote & Estimate States
  const [estimatedOutput, setEstimatedOutput] = useState<string>('')
  const [stopLimit, setStopLimit] = useState<string>('')
  const [rate, setRate] = useState<string>('')
  const [isEstimating, setIsEstimating] = useState(false)
  const [estimateError, setEstimateError] = useState<string | null>(null)

  const getTokenDisplaySymbol = getDisplayTokenSymbol

  // Slippage tolerance calculation
  const slippageTolerance = useMemo(() => {
    if (selectedSlippageType === 'custom') {
      const val = parseFloat(customSlippage)
      return isNaN(val) ? 0.005 : val / 100
    }
    return parseFloat(selectedSlippageType) / 100
  }, [selectedSlippageType, customSlippage])

  const isHighSlippageWarning = selectedSlippageType === 'custom' && parseFloat(customSlippage) > 5.0

  // Speed & Network Execution Priority
  const [speedTier, setSpeedTier] = useState<SpeedTier>('fast')

  // Treasury Platform Fee
  const platformFeeBps = getSwapProtocolFeeBps(speedTier)
  const platformFeePercent = getSwapProtocolFeePercent(speedTier)
  const platformFeeAmount = amountIn ? calculateSwapProtocolFeeAmount(speedTier, amountIn) : null
  const platformFeeEnabled = true

  // Validation
  const isValidEvmAddress = (addr: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(addr)
  const recipientIsValid = useCustomRecipient ? isValidEvmAddress(customRecipient) : false
  const recipientIsOwnAddress =
    useCustomRecipient && connectedAddress && customRecipient.toLowerCase() === connectedAddress.toLowerCase()

  const effectiveRecipient = useCustomRecipient && recipientIsValid ? customRecipient : connectedAddress
  const supportedChains = useMemo(() => getSupportedSwapChains(), [])

  // Reset modal state on open
  useEffect(() => {
    if (isOpen) {
      refetchWalletBalances()
      setAmountIn('')
      setEstimatedOutput('')
      setStopLimit('')
      setRate('')
      setSuccessData(null)
      setError(null)
      setEstimateError(null)
      setIsSwapping(false)
      setShowSettings(false)
      setSpeedTier('fast')
      setSelectedSlippageType('0.5')
      setCustomSlippage('')
      setIsEditingRecipient(false)
      setUseCustomRecipient(false)
      setCustomRecipient('')
      setRecipientError(null)
      setSelectedChain('Arc_Testnet')
      setShowChainModal(false)
    }
  }, [isOpen])

  // Close Settings modal on ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showSettings) {
        setShowSettings(false)
      }
    }
    if (showSettings) {
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showSettings])

  const handlePasteCustomRecipient = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        const trimmed = text.trim()
        setCustomRecipient(trimmed)
        setUseCustomRecipient(isValidEvmAddress(trimmed))
        setRecipientError(null)
      }
    } catch (err) {
      console.error('[SwapModal] Failed to read clipboard:', err)
    }
  }

  // Load wallet balances
  const { walletBalances, refetch: refetchWalletBalances } = useWalletTestnetBalances(connectedAddress)
  const usdcWalletBalance = walletBalances[fromChain]?.usdc || '0.00'
  const eurcWalletBalance = walletBalances[fromChain]?.eurc || '0.00'
  const cirbtcWalletBalance = walletBalances[fromChain]?.cirbtc || '0.00000'

  // Dynamic balance for selected tokenIn
  const tokenInBalance = useMemo(() => {
    if (!connectedAddress) return tokenIn === 'cirBTC' ? '0.00000' : '0.00'
    if (tokenIn === 'USDC') return usdcWalletBalance
    if (tokenIn === 'EURC') return eurcWalletBalance
    if (tokenIn === 'cirBTC') return cirbtcWalletBalance
    return '0.00'
  }, [connectedAddress, tokenIn, usdcWalletBalance, eurcWalletBalance, cirbtcWalletBalance])

  const tokenOutBalance = useMemo(() => {
    if (!connectedAddress) return tokenOut === 'cirBTC' ? '0.00000' : '0.00'
    if (tokenOut === 'USDC') return usdcWalletBalance
    if (tokenOut === 'EURC') return eurcWalletBalance
    if (tokenOut === 'cirBTC') return cirbtcWalletBalance
    return '0.00'
  }, [connectedAddress, tokenOut, usdcWalletBalance, eurcWalletBalance, cirbtcWalletBalance])

  const isInsufficient = amountIn ? parseFloat(amountIn) > parseFloat(tokenInBalance) : false
  const isCrossChain = fromChain !== toChain

  // Token list for selector modal
  const tokenList: TokenItem[] = useMemo(
    () => [
      { symbol: 'USDC', name: 'USD Coin', icon: TOKEN_ICONS.USDC, balance: usdcWalletBalance },
      { symbol: 'EURC', name: 'Euro Coin', icon: TOKEN_ICONS.EURC, balance: eurcWalletBalance },
      { symbol: 'cirBTC', name: 'Circle Bitcoin', icon: TOKEN_ICONS.cirBTC, balance: cirbtcWalletBalance },
    ],
    [usdcWalletBalance, eurcWalletBalance, cirbtcWalletBalance]
  )

  // Swap Direction Switch
  const handleSwitchDirection = () => {
    const tempToken = tokenIn
    setTokenIn(tokenOut)
    setTokenOut(tempToken)
    if (estimatedOutput) {
      setAmountIn(estimatedOutput)
    }
  }

  // Live Quote & Estimation Hook
  useEffect(() => {
    const amt = parseFloat(amountIn)
    if (isNaN(amt) || amt <= 0) {
      setEstimatedOutput('')
      setStopLimit('')
      setRate('')
      setEstimateError(null)
      return
    }

    if (tokenIn === tokenOut && fromChain === toChain) {
      setEstimatedOutput('')
      setStopLimit('')
      setRate('')
      setEstimateError('Source and destination tokens must be different for same-chain swaps.')
      return
    }

    const isArcUSDCConflict =
      fromChain === 'Arc_Testnet' &&
      toChain === 'Arc_Testnet' &&
      ((tokenIn === 'USDC' && tokenOut === 'NATIVE') || (tokenIn === 'NATIVE' && tokenOut === 'USDC'))
    if (isArcUSDCConflict) {
      setEstimatedOutput('')
      setStopLimit('')
      setRate('')
      setEstimateError('USDC and NATIVE are the same asset on Arc. Swapping them is a no-op.')
      return
    }

    let isMounted = true
    setIsEstimating(true)
    setEstimateError(null)

    const fetchEstimate = async () => {
      try {
        if (provider) {
          const quote = await getSwapEstimate({
            fromChain,
            toChain: toChain === fromChain ? undefined : toChain,
            tokenIn,
            tokenOut,
            amountIn,
            sourceAdapter: await createViemAdapter(provider),
            recipientAddress: effectiveRecipient,
            slippageTolerance,
            allowanceStrategy,
            ...(platformFeeEnabled && {
              customFee: {
                percentageBps: platformFeeBps,
                recipientAddress: TREASURY_ADDRESS,
              },
            }),
          })
          if (isMounted) {
            setEstimatedOutput(quote.estimatedOutput)
            setStopLimit(quote.stopLimit)
            setRate(quote.rate)
            setIsEstimating(false)
          }
        }
      } catch (err: any) {
        console.error('[Swap Quote Error]', err)
        if (isMounted) {
          setEstimatedOutput('')
          setStopLimit('')
          setRate('')
          setEstimateError(err.message || 'Swap route not supported.')
          setIsEstimating(false)
        }
      }
    }

    const timer = setTimeout(fetchEstimate, 500)
    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [amountIn, tokenIn, tokenOut, fromChain, toChain, slippageTolerance, allowanceStrategy, provider])

  const getFriendlyErrorMessage = (err: any): string => {
    return formatWalletError(err)
  }

  // Swap Execution
  const handleSwapExecution = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessData(null)

    if (tokenIn === tokenOut && fromChain === toChain) {
      setError('Source and destination tokens must be different for same-chain swaps.')
      return
    }

    const amt = parseFloat(amountIn)
    if (isNaN(amt) || amt <= 0) {
      setError('Please enter a valid amount')
      return
    }

    if (useCustomRecipient) {
      if (!isValidEvmAddress(customRecipient)) {
        setRecipientError('Geçerli bir EVM adresi girin (0x + 40 karakter).')
        return
      }
      if (recipientIsOwnAddress) {
        setRecipientError('Bu adres bağlı cüzdanınızla aynı. Farklı bir adres girin.')
        return
      }
    }

    setIsSwapping(true)

    const isCross = Boolean(toChain && toChain !== fromChain)
    const broadcastId = addBroadcast({
      title: isCross ? 'Cross-Chain Swap in Progress...' : 'Swapping Tokens...',
      status: 'pending',
      badgeText: isCross ? 'Cross-Chain' : 'Swapping',
      details: {
        fromAmount: amountIn,
        fromSymbol: tokenIn,
        fromIcon: TOKEN_ICONS[tokenIn],
        fromChain: fromChain,
        toAmount: estimatedOutput,
        toSymbol: tokenOut,
        toIcon: TOKEN_ICONS[tokenOut],
        toChain: toChain || fromChain,
        network: fromChain,
        isBridge: isCross,
      },
    })

    try {
      if (provider) {
        const sourceAdapter = await createViemAdapter(provider)

        const finalStatus = await executeSwap({
          fromChain,
          toChain: toChain === fromChain ? undefined : toChain,
          tokenIn,
          tokenOut,
          amountIn,
          sourceAdapter,
          recipientAddress: effectiveRecipient,
          slippageTolerance,
          allowanceStrategy,
          ...(platformFeeEnabled && {
            customFee: {
              percentageBps: platformFeeBps,
              recipientAddress: TREASURY_ADDRESS,
            },
          }),
        })

        if (finalStatus.status === 'DONE') {
          setIsSwapping(false)
          setSuccessData({
            amountIn,
            amountOut: estimatedOutput,
            tokenIn,
            tokenOut,
            txHash: finalStatus.sourceTxHash,
            destTxHash: finalStatus.destinationTxHash,
          })

          updateBroadcast(broadcastId, {
            title: isCross ? 'Cross-Chain Swap Success' : 'Swap Confirmed',
            status: 'success',
            badgeText: 'Swapped',
            details: {
              fromAmount: amountIn,
              fromSymbol: tokenIn,
              fromIcon: TOKEN_ICONS[tokenIn],
              fromChain: fromChain,
              toAmount: estimatedOutput,
              toSymbol: tokenOut,
              toIcon: TOKEN_ICONS[tokenOut],
              toChain: toChain || fromChain,
              network: fromChain,
              txHash: finalStatus.sourceTxHash,
              isBridge: isCross,
            },
          })

          refetchWalletBalances()

          addTransaction({
            type: 'swap',
            txHash: finalStatus.sourceTxHash || '',
            amount: amountIn,
            tokenSymbol: tokenIn,
            sourceChain: fromChain,
            recipient: effectiveRecipient,
            userAddress: connectedAddress,
            status: 'success',
            amountIn,
            amountOut: estimatedOutput,
            tokenIn,
            tokenOut,
            isPrivate: isPrivateSwap,
          })

          onSuccess(amountIn, estimatedOutput, tokenIn, tokenOut, finalStatus.sourceTxHash || '')
        } else {
          throw new Error(finalStatus.errorMessage || 'Swap failed to complete.')
        }
      }
    } catch (err: any) {
      console.error(err)
      const friendlyMsg = getFriendlyErrorMessage(err)
      setError(friendlyMsg)
      setIsSwapping(false)

      updateBroadcast(broadcastId, {
        title: isCross ? 'Cross-Chain Swap Failed' : 'Swap Failed',
        status: 'failed',
        badgeText: 'Failed',
        message: friendlyMsg,
        details: {
          fromAmount: amountIn,
          fromSymbol: tokenIn,
          fromIcon: TOKEN_ICONS[tokenIn],
          fromChain: fromChain,
          toAmount: estimatedOutput,
          toSymbol: tokenOut,
          toIcon: TOKEN_ICONS[tokenOut],
          toChain: toChain || fromChain,
          network: fromChain,
          isBridge: isCross,
        },
      })
    }
  }

  // Quick percentage handler
  const handleQuickPercentage = (pct: number) => {
    const bal = parseFloat(tokenInBalance)
    if (isNaN(bal) || bal <= 0) return
    const calculated = (bal * pct) / 100
    setAmountIn(calculated.toFixed(tokenIn === 'cirBTC' ? 5 : 2))
  }

  // Transaction breakdown items
  const breakdownItems: BreakdownItem[] = useMemo(() => {
    if (!estimatedOutput || !rate || isEstimating) return []

    const items: BreakdownItem[] = [
      {
        label: 'Exchange Rate',
        value: `1 ${tokenIn} = ${rate} ${tokenOut}`,
      },
      {
        label: 'Min. Guaranteed',
        value: `${stopLimit} ${tokenOut}`,
        tooltip: 'Minimum amount you will receive after slippage tolerance',
      },
      {
        label: 'Slippage Tolerance',
        value: `${(slippageTolerance * 100).toFixed(1)}%`,
      },
    ]

    if (platformFeeEnabled && platformFeeAmount) {
      items.push({
        label: `Platform Fee (${platformFeePercent})`,
        value: `${platformFeeAmount} ${tokenIn}`,
        tooltip: 'Arcis Treasury protocol fee for routing & liquidity optimization',
      })
    }

    items.push({
      label: 'Liquidity Provider Fee',
      value: '0.02%',
    })

    items.push({
      label: 'Execution Speed',
      value: `${SPEED_TIERS[speedTier].label} (${SPEED_TIERS[speedTier].timeEstimate.swap})`,
      highlight: speedTier === 'turbo',
    })

    return items
  }, [
    estimatedOutput,
    rate,
    isEstimating,
    tokenIn,
    tokenOut,
    stopLimit,
    slippageTolerance,
    platformFeeEnabled,
    platformFeeAmount,
    platformFeePercent,
    speedTier,
  ])

  // Dynamic Button State
  const ctaButtonState = useMemo(() => {
    if (!connectedAddress) {
      return { disabled: true, text: 'CONNECT WALLET', loading: false }
    }
    if (!amountIn || parseFloat(amountIn) <= 0) {
      return { disabled: true, text: 'ENTER AN AMOUNT', loading: false }
    }
    if (tokenIn === tokenOut) {
      return { disabled: true, text: 'SELECT DIFFERENT TOKENS', loading: false }
    }
    if (isInsufficient) {
      return { disabled: true, text: `INSUFFICIENT ${tokenIn} BALANCE`, loading: false }
    }
    if (isEstimating) {
      return { disabled: true, text: 'FETCHING BEST QUOTE...', loading: true }
    }
    if (estimateError) {
      return { disabled: true, text: 'SWAP ROUTE UNAVAILABLE', loading: false }
    }
    if (useCustomRecipient && (!isValidEvmAddress(customRecipient) || recipientIsOwnAddress)) {
      return { disabled: true, text: 'ENTER VALID DESTINATION', loading: false }
    }
    if (isSwapping) {
      return {
        disabled: true,
        text: isCrossChain ? 'CROSS-CHAIN SWAPPING...' : 'SWAPPING TOKENS...',
        loading: true,
      }
    }
    return {
      disabled: false,
      text: isCrossChain ? 'CROSS-CHAIN SWAP' : 'SWAP TOKENS',
      loading: false,
      icon: <ArrowRightLeft className="w-4 h-4" />,
    }
  }, [
    connectedAddress,
    amountIn,
    tokenIn,
    tokenOut,
    isInsufficient,
    isEstimating,
    estimateError,
    useCustomRecipient,
    customRecipient,
    recipientIsOwnAddress,
    isSwapping,
    isCrossChain,
  ])

  if (!isOpen && !isInline) return null

  // Header Actions (Network Selector Pill + Privacy + Settings + Close)
  const headerActions = (
    <>
      {/* Network Selector Pill */}
      <button
        type="button"
        disabled={isSwapping || !!successData}
        onClick={() => setShowChainModal(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/[0.16] text-xs font-medium text-slate-200 transition-all cursor-pointer select-none"
      >
        <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
          <NetworkIcon
            name={getChainIconId(selectedChain)}
            variant={getChainIconId(selectedChain) === 'solana' ? 'branded' : 'background'}
            size={16}
            className="rounded-full"
          />
        </div>
        <span className="truncate max-w-[100px]">{selectedChain.replace(/_/g, ' ')}</span>
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>

      {/* Privacy Lock Toggle */}
      <PrivacyLockButton
        isPrivate={isPrivateSwap}
        onToggle={() => setIsPrivateSwap((prev) => !prev)}
        disabled={isSwapping || !!successData}
        size="md"
      />

      {/* Settings / Slippage Toggle */}
      <button
        type="button"
        onClick={() => setShowSettings(!showSettings)}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${
          showSettings
            ? 'text-white bg-indigo-500/25 border border-indigo-500/40 shadow-sm'
            : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06]'
        }`}
        title="Slippage and speed settings"
      >
        <Settings className="w-4 h-4" />
      </button>

      {/* Close button if modal */}
      {!isInline && (
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </>
  )

  const content = (
    <FintechCard
      title="SWAP"
      icon={<ArrowRightLeft className="w-5 h-5" />}
      isInline={isInline}
      maxWidth={isInline ? 640 : 540}
      minHeight={isInline ? 680 : undefined}
      pill={
        isCrossChain ? (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            CROSS-CHAIN
          </span>
        ) : undefined
      }
      headerActions={headerActions}
    >
      {/* Success View */}
      {successData ? (
        <SwapSuccessReceipt
          amountIn={successData.amountIn}
          amountOut={successData.amountOut}
          tokenIn={successData.tokenIn}
          tokenOut={successData.tokenOut}
          tokenInIcon={TOKEN_ICONS[successData.tokenIn]}
          tokenOutIcon={TOKEN_ICONS[successData.tokenOut]}
          fromChain={fromChain}
          toChain={toChain}
          txHash={successData.txHash}
          explorerUrl={getExplorerTxUrl(fromChain, successData.txHash)}
          isCrossChain={isCrossChain}
          isInline={isInline}
          onSwapAgain={() => {
            setSuccessData(null)
            setIsSwapping(false)
            setAmountIn('')
            setEstimatedOutput('')
          }}
          onClose={onClose}
        />
      ) : (
        <form onSubmit={handleSwapExecution} className="flex flex-col gap-4 flex-1 justify-between">
          {/* Error Alert */}
          {error && (
            <div className="p-3 bg-rose-500/10 rounded-2xl border border-rose-500/25 text-rose-400 text-xs flex items-center gap-2.5 animate-fade-in">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1">{error}</span>
            </div>
          )}

          {/* Route Error Alert */}
          {estimateError && !error && (
            <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/25 text-amber-300 text-xs flex items-center gap-2.5 animate-fade-in">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1">
                {estimateError.includes('INPUT_AMOUNT_OUT_OF_RANGE')
                  ? 'Entered amount is outside supported swap liquidity limits.'
                  : estimateError}
              </span>
            </div>
          )}

          {/* Asset Panels Stack */}
          <div className="relative flex flex-col gap-2.5 sm:gap-3.5">
            {/* Input Panel 1: YOU PAY */}
            <AssetInputPanel
              label="YOU PAY"
              amount={amountIn}
              onAmountChange={(val) => setAmountIn(val)}
              tokenSymbol={tokenIn}
              tokenIcon={TOKEN_ICONS[tokenIn]}
              onSelectToken={() => setShowTokenInModal(true)}
              balance={tokenInBalance}
              onMaxClick={() => setAmountIn(tokenInBalance)}
              quickPercentages={[25, 50, 75, 100]}
              onSelectPercentage={handleQuickPercentage}
              fiatEstimate={amountIn ? `≈ $${amountIn} USD` : undefined}
              disabled={isSwapping}
              error={isInsufficient}
            />

            {/* Switch Direction Invert Button */}
            <DirectionSwitchButton
              onClick={handleSwitchDirection}
              disabled={isSwapping}
            />

            {/* Input Panel 2: YOU RECEIVE */}
            <AssetInputPanel
              label="YOU RECEIVE"
              amount={estimatedOutput}
              readOnly={true}
              placeholder={tokenOut === 'cirBTC' ? '0.00000' : '0.00'}
              tokenSymbol={tokenOut}
              tokenIcon={TOKEN_ICONS[tokenOut]}
              onSelectToken={() => setShowTokenOutModal(true)}
              balance={tokenOutBalance}
              isLoading={isEstimating}
              fiatEstimate={estimatedOutput ? `≈ $${estimatedOutput} USD` : undefined}
              disabled={isSwapping}
            />
          </div>

          {/* Destination Address Pill & Collapsible Field */}
          <div className="rounded-xl bg-[#101323]/50 border border-white/[0.04] p-2.5 transition-all">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Wallet className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[12px]">To:</span>
                <span className="font-mono text-slate-200 text-[12px]">
                  {useCustomRecipient && recipientIsValid
                    ? formatAddress(customRecipient)
                    : formatAddress(connectedAddress) || 'Connected Wallet'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsEditingRecipient((prev) => !prev)}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Edit3 className="w-3 h-3" />
                <span>{isEditingRecipient ? 'Hide' : 'Change'}</span>
              </button>
            </div>

            {/* Custom Recipient Expanded Drawer */}
            {isEditingRecipient && (
              <div className="mt-2.5 pt-2 border-t border-white/[0.06] space-y-1.5 animate-fade-in">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  {customRecipient && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomRecipient('')
                        setUseCustomRecipient(false)
                        setRecipientError(null)
                      }}
                      className="text-slate-500 hover:text-slate-300 cursor-pointer"
                    >
                      Reset
                    </button>
                  )}
                </div>

                <div className="relative flex items-center">
                  <input
                    ref={recipientInputRef}
                    type="text"
                    placeholder="0x..."
                    value={customRecipient}
                    onChange={(e) => {
                      const val = e.target.value.trim()
                      setCustomRecipient(val)
                      setUseCustomRecipient(isValidEvmAddress(val))
                      setRecipientError(null)
                    }}
                    className={`w-full rounded-xl pl-3 pr-14 py-2 text-xs text-white font-mono focus:outline-none transition-all ${
                      recipientError
                        ? 'bg-rose-500/10 border border-rose-500/40'
                        : recipientIsValid
                        ? 'bg-white/[0.04] border border-emerald-500/50'
                        : 'bg-white/[0.04] border border-white/[0.08] focus:border-indigo-500/50'
                    }`}
                  />
                  <div className="absolute right-2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handlePasteCustomRecipient}
                      className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                      title="Paste from clipboard"
                    >
                      <Clipboard className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {recipientError && (
                  <p className="text-[10px] text-rose-400">{recipientError}</p>
                )}
              </div>
            )}
          </div>

          {/* Live Quote & Fee Breakdown Accordion */}
          {breakdownItems.length > 0 && (
            <TransactionBreakdown
              summaryTitle={`1 ${tokenIn} ≈ ${rate} ${tokenOut}`}
              summaryBadge={
                <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-semibold px-2 py-0.2 rounded-full border border-emerald-500/20">
                  Best Rate
                </span>
              }
              items={breakdownItems}
              defaultOpen={false}
            />
          )}

          {/* Primary Action Button */}
          <div className="pt-2">
            <FintechActionButton
              disabled={ctaButtonState.disabled}
              loading={ctaButtonState.loading}
              loadingText={ctaButtonState.text}
              icon={ctaButtonState.icon}
            >
              {ctaButtonState.text}
            </FintechActionButton>
          </div>
        </form>
      )}

      {/* Token In Selector Modal */}
      <TokenSelectorModal
        isOpen={showTokenInModal}
        onClose={() => setShowTokenInModal(false)}
        tokens={tokenList}
        selectedToken={tokenIn}
        onSelectToken={(sym) => {
          setTokenIn(sym)
          if (sym === tokenOut) {
            const others = ['USDC', 'EURC', 'cirBTC'].filter((t) => t !== sym)
            setTokenOut(others[0])
          }
        }}
        title="Pay with"
      />

      {/* Token Out Selector Modal */}
      <TokenSelectorModal
        isOpen={showTokenOutModal}
        onClose={() => setShowTokenOutModal(false)}
        tokens={tokenList}
        selectedToken={tokenOut}
        onSelectToken={(sym) => {
          setTokenOut(sym)
          if (sym === tokenIn) {
            const others = ['USDC', 'EURC', 'cirBTC'].filter((t) => t !== sym)
            setTokenIn(others[0])
          }
        }}
        title="Receive"
      />

      {/* Network Selector Modal */}
      <ChainSelectorModal
        isOpen={showChainModal}
        onClose={() => setShowChainModal(false)}
        chains={supportedChains}
        selectedChain={selectedChain}
        onSelectChain={(chainKey) => setSelectedChain(chainKey)}
        getChainIconId={getChainIconId}
        title="Select Network"
      />
    </FintechCard>
  )

  // Settings Modal rendered over document.body via Portal
  const settingsModalWindow =
    showSettings && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in"
            onClick={() => setShowSettings(false)}
          >
            <div
              className="w-full max-w-[480px] rounded-3xl p-6 sm:p-7 shadow-2xl relative border space-y-5 animate-scale-in"
              style={{
                background: 'linear-gradient(180deg, rgba(16, 20, 36, 0.98) 0%, rgba(10, 12, 22, 0.99) 100%)',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.9), 0 0 32px rgba(99, 102, 241, 0.15)',
                fontFamily: 'var(--font-app)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3.5 border-b border-white/[0.06]">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white tracking-wide">
                      Transaction Settings
                    </h3>
                    <p className="text-[11px] text-slate-400">Slippage and execution preferences</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Slippage Tolerance */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 tracking-wide">
                    SLIPPAGE TOLERANCE
                  </label>
                  <span className="text-xs text-indigo-400 font-semibold font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">
                    {(slippageTolerance * 100).toFixed(1)}%
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {(['0.1', '0.5', '1.0'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        setSelectedSlippageType(type)
                        setCustomSlippage('')
                      }}
                      className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all text-center cursor-pointer ${
                        selectedSlippageType === type
                          ? 'text-white bg-indigo-500/20 border border-indigo-500/40 shadow-sm'
                          : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]'
                      }`}
                    >
                      {type}%
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSelectedSlippageType('custom')}
                    className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all text-center cursor-pointer ${
                      selectedSlippageType === 'custom'
                        ? 'text-white bg-indigo-500/20 border border-indigo-500/40 shadow-sm'
                        : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]'
                    }`}
                  >
                    Custom
                  </button>
                </div>

                {selectedSlippageType === 'custom' && (
                  <div className="space-y-1.5 pt-1 animate-fade-in">
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        min="0.01"
                        max="50"
                        placeholder="e.g. 2.5"
                        value={customSlippage}
                        onChange={(e) => setCustomSlippage(e.target.value)}
                        autoFocus
                        className="w-full rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none transition-all pr-8 bg-white/[0.04] border border-indigo-500/40 focus:border-indigo-500"
                      />
                      <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
                        %
                      </span>
                    </div>
                    {isHighSlippageWarning && (
                      <div className="flex gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 p-2 rounded-xl">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>High slippage may result in frontrunning or poor execution.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Speed Priority Section */}
              <div className="space-y-2 pt-2 border-t border-white/[0.06]">
                <SpeedFeeSelector
                  selectedTier={speedTier}
                  onSelectTier={(tier) => setSpeedTier(tier)}
                  context="swap"
                  disabled={isSwapping}
                />
              </div>

              {/* Save button */}
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="w-full py-3 px-4 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 transition-all cursor-pointer shadow-md shadow-indigo-500/20"
              >
                Save Settings
              </button>
            </div>
          </div>,
          document.body
        )
      : null

  if (isInline) {
    return (
      <>
        {content}
        {settingsModalWindow}
      </>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
        {content}
      </div>
      {settingsModalWindow}
    </>
  )
}
