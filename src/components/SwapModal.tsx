import { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  ArrowRightLeft,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Settings,
  ExternalLink,
  ArrowUpDown,
  ChevronDown,
  Clipboard,
  Check,
  Wallet,
  Edit3
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import { formatWalletError } from '../utils/errorUtils'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { createViemAdapter } from '../services/sendService'
import { getSwapEstimate, executeSwap, getSupportedSwapChains } from '../services/swapService'
import { BRIDGE_CHAIN_DISPLAY_NAMES } from '../types/bridge'
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
  const [chainSearch, setChainSearch] = useState('Arc Testnet')
  const [showChainDropdown, setShowChainDropdown] = useState(false)

  // Custom token dropdown states & refs
  const [showTokenInDropdown, setShowTokenInDropdown] = useState(false)
  const [showTokenOutDropdown, setShowTokenOutDropdown] = useState(false)
  const tokenInRef = useRef<HTMLDivElement>(null)
  const tokenOutRef = useRef<HTMLDivElement>(null)

  // Routing State
  const fromChain = selectedChain
  const toChain = selectedChain

  const [tokenIn, setTokenIn] = useState('USDC')
  const [tokenOut, setTokenOut] = useState('EURC')
  const [amountIn, setAmountIn] = useState('')
  const [allowanceStrategy] = useState<'permit' | 'approve'>('approve')

  // Advanced Settings Toggle
  const [showSettings, setShowSettings] = useState(false)
  const [selectedSlippageType, setSelectedSlippageType] = useState<'0.1' | '0.5' | '1.0' | 'custom'>('0.5')
  const [customSlippage, setCustomSlippage] = useState('')

  // Custom Recipient Address State (send-to-different-address)
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

  const formatAddress = (addr: string) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : ''

  // Swap Execution States
  const [isSwapping, setIsSwapping] = useState(false)
  const [successData, setSuccessData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Dynamic Quote & Estimate States
  const [estimatedOutput, setEstimatedOutput] = useState<string>('')
  const [stopLimit, setStopLimit] = useState<string>('')
  const [rate, setRate] = useState<string>('')
  const [isEstimating, setIsEstimating] = useState(false)
  const [estimateError, setEstimateError] = useState<string | null>(null)

  const getTokenDisplaySymbol = getDisplayTokenSymbol

  // Calculate slippage tolerance based on settings
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

  // Custom Platform Fee from ArcFlow Treasury Fee Engine (Dynamic per speed tier)
  const platformFeeBps = getSwapProtocolFeeBps(speedTier)
  const platformFeePercent = getSwapProtocolFeePercent(speedTier)
  const platformFeeAmount = amountIn ? calculateSwapProtocolFeeAmount(speedTier, amountIn) : null
  const platformFeeEnabled = true

  // Custom Recipient Address validation
  const isValidEvmAddress = (addr: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(addr)
  const recipientIsValid = useCustomRecipient ? isValidEvmAddress(customRecipient) : false
  const recipientIsOwnAddress = useCustomRecipient && connectedAddress && customRecipient.toLowerCase() === connectedAddress.toLowerCase()

  // Effective recipient: custom address if valid & toggle on, otherwise the connected wallet
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
      setChainSearch('Arc Testnet')
      setShowChainDropdown(false)
    }
  }, [isOpen])

  // Close dropdowns on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      setShowChainDropdown(false)
      if (tokenInRef.current && !tokenInRef.current.contains(e.target as Node)) {
        setShowTokenInDropdown(false)
      }
      if (tokenOutRef.current && !tokenOutRef.current.contains(e.target as Node)) {
        setShowTokenOutDropdown(false)
      }
    }
    window.addEventListener('click', handleOutsideClick)
    return () => window.removeEventListener('click', handleOutsideClick)
  }, [])

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

  // Load wallet testnet balances to enforce balance check
  const { walletBalances, refetch: refetchWalletBalances } = useWalletTestnetBalances(connectedAddress)
  const usdcWalletBalance = walletBalances[fromChain]?.usdc || '0.00'
  const eurcWalletBalance = walletBalances[fromChain]?.eurc || '0.00'
  const cirbtcWalletBalance = walletBalances[fromChain]?.cirbtc || '0.00000'

  // Dynamic balance for selected tokenIn (USDC, EURC, cirBTC, etc.)
  const [tokenInBalance, setTokenInBalance] = useState('0.00')

  useEffect(() => {
    if (!connectedAddress) {
      setTokenInBalance(tokenIn === 'cirBTC' ? '0.00000' : '0.00')
      return
    }

    if (tokenIn === 'USDC') {
      setTokenInBalance(usdcWalletBalance)
      return
    }

    if (tokenIn === 'EURC') {
      setTokenInBalance(eurcWalletBalance)
      return
    }

    if (tokenIn === 'cirBTC') {
      setTokenInBalance(cirbtcWalletBalance)
      return
    }

    setTokenInBalance(tokenIn === 'cirBTC' ? '0.00000' : '0.00')
  }, [connectedAddress, fromChain, tokenIn, usdcWalletBalance, eurcWalletBalance, cirbtcWalletBalance])

  const selectedBalance = tokenInBalance
  const isInsufficient = amountIn ? parseFloat(amountIn) > parseFloat(selectedBalance) : false

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
      (fromChain === 'Arc_Testnet' && toChain === 'Arc_Testnet') &&
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
          // Real onchain estimate
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
                recipientAddress: TREASURY_ADDRESS
              }
            })
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

  const isCrossChain = fromChain !== toChain

  // Parse error messages for friendly feedback
  const getFriendlyErrorMessage = (err: any): string => {
    return formatWalletError(err)
  }

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

    // Validate custom recipient before executing the swap
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

    const isCrossChain = Boolean(toChain && toChain !== fromChain)
    const broadcastId = addBroadcast({
      title: isCrossChain ? 'Cross-Chain Swap in Progress...' : 'Swapping Tokens...',
      status: 'pending',
      badgeText: isCrossChain ? 'Cross-Chain' : 'Swapping',
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
        isBridge: isCrossChain,
      },
    })

    try {
      if (provider) {
        // Real Execution
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
              recipientAddress: TREASURY_ADDRESS
            }
          })
        })

        if (finalStatus.status === 'DONE') {
          setIsSwapping(false)
          setSuccessData({
            amountIn,
            amountOut: estimatedOutput,
            tokenIn,
            tokenOut,
            txHash: finalStatus.sourceTxHash,
            destTxHash: finalStatus.destinationTxHash
          })

          updateBroadcast(broadcastId, {
            title: isCrossChain ? 'Cross-Chain Swap Success' : 'Swap Confirmed',
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
              isBridge: isCrossChain,
            },
          })

          // Refetch balances to auto-update UI
          refetchWalletBalances()

          addTransaction({
            type: 'swap',
            txHash: finalStatus.sourceTxHash || '',
            amount: amountIn,
            tokenSymbol: tokenIn,
            sourceChain: fromChain,
            recipient: effectiveRecipient,
            status: 'success',
            amountIn,
            amountOut: estimatedOutput,
            tokenIn,
            tokenOut,
            isPrivate: isPrivateSwap
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
        title: isCrossChain ? 'Cross-Chain Swap Failed' : 'Swap Failed',
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
          isBridge: isCrossChain,
        },
      })
    }
  }

  if (!isOpen && !isInline) return null
  const content = (
    <div
      className={`relative w-full ub-asset-card arc-animate-reveal ${isInline ? '' : 'overflow-y-auto max-h-[90vh]'}`}
      style={{
        maxWidth: isInline ? 780 : 590,
        margin: isInline ? '0 auto' : undefined,
        padding: '36px 42px',
        borderRadius: '28px',
        boxShadow: isInline
          ? '0 0 0 1px rgba(255, 255, 255, 0.06), 0 20px 48px -12px rgba(0, 0, 0, 0.5)'
          : '0 0 0 1px rgba(255, 255, 255, 0.1), 0 28px 64px -12px rgba(0, 0, 0, 0.7)',
      }}
    >

      {/* Modal Header */}
      <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              color: 'var(--purple-1)',
            }}
          >
            <ArrowRightLeft className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 ">
              <span className="arc-eyebrow" style={{ fontSize: 16, color: '#ffffff', fontWeight: 600, letterSpacing: '2px' }}>
                SWAP
              </span>
              {isCrossChain && (
                <span
                  className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full animate-pulse"
                  style={{
                    background: 'rgba(152, 150, 255, 0.15)',
                    color: 'var(--purple-1)',
                    border: '1px solid rgba(152, 150, 255, 0.3)',
                    fontFamily: 'var(--font-app)',
                  }}
                >
                  CROSSCHAIN
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PrivacyLockButton
            isPrivate={isPrivateSwap}
            onToggle={() => setIsPrivateSwap(prev => !prev)}
            disabled={isSwapping || !!successData}
            size="md"
          />
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${
              showSettings
                ? 'text-white bg-[rgba(152,150,255,0.2)] border border-[rgba(152,150,255,0.4)] shadow-md'
                : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06]'
            }`}
            title="Slippage settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          {!isInline && (
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Swap Form */}
      <form onSubmit={handleSwapExecution} className="space-y-5.5">
        {error && (
          <div className="p-3.5 bg-rose-500/10 rounded-2xl border border-rose-500/25 text-rose-400 text-xs flex gap-2.5 font-[var(--font-app)] items-center">
            <AlertTriangle className="w-4 h-4 shrink-0 font-bold" />
            <span>{error}</span>
          </div>
        )}

        {/* Chain Selector */}
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <label className="block text-xs font-semibold tracking-wide text-slate-300 mb-1.5 ml-3" style={{ fontFamily: 'var(--font-app)' }}>
            CHAIN
          </label>
          <button
            type="button"
            disabled={isSwapping || !!successData}
            onClick={(e) => {
              e.stopPropagation()
              setShowChainDropdown(prev => !prev)
            }}
            className="w-full rounded-2xl px-4 py-3.5 text-xs text-white focus:outline-none flex items-center justify-between cursor-pointer transition-all duration-200"
            style={{
              background: 'rgba(11, 13, 24, 0.75)',
              border: showChainDropdown ? '1px solid rgba(152, 150, 255, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
              boxShadow: showChainDropdown ? '0 0 16px rgba(152, 150, 255, 0.2)' : 'none',
              fontFamily: 'var(--font-app)',
            }}
          >
            <div className="flex items-center gap-2.5">
              <div style={{ width: 22, height: 22, borderRadius: '50%', overflow: 'hidden', clipPath: 'circle(50% at 50% 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <NetworkIcon
                  name={getChainIconId(selectedChain)}
                  variant={getChainIconId(selectedChain) === 'solana' ? 'branded' : 'background'}
                  size={22}
                  className="rounded-full overflow-hidden"
                />
              </div>
              <span className="font-semibold text-white text-sm">{selectedChain.replace(/_/g, ' ')}</span>
            </div>
            <ChevronDown size={15} className={`transition-transform duration-200 text-slate-400 ${showChainDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showChainDropdown && (
            <div
              className="absolute z-[120] left-0 right-0 mt-2 max-h-56 overflow-y-auto rounded-2xl shadow-2xl p-1.5 space-y-1 backdrop-blur-2xl"
              style={{
                background: 'rgba(15, 18, 32, 0.96)',
                border: '1px solid rgba(152, 150, 255, 0.25)',
                boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
              }}
            >
              {supportedChains.map((c) => {
                const iconId = getChainIconId(c.chain)
                const isSelected = selectedChain === c.chain
                return (
                  <button
                    key={c.chain}
                    type="button"
                    onClick={() => {
                      setSelectedChain(c.chain)
                      setChainSearch(c.name)
                      setShowChainDropdown(false)
                    }}
                    className={`w-full text-left px-3.5 py-2.5 text-xs rounded-xl transition-all flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'bg-[rgba(152,150,255,0.15)] text-white border border-[rgba(152,150,255,0.3)]'
                        : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div style={{ width: 20, height: 20, borderRadius: '50%', overflow: 'hidden', clipPath: 'circle(50% at 50% 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <NetworkIcon
                          name={iconId}
                          variant={iconId === 'solana' ? 'branded' : 'background'}
                          size={20}
                          className="rounded-full overflow-hidden"
                        />
                      </div>
                      <span className="font-semibold" style={{ fontFamily: 'var(--font-app)' }}>{c.name}</span>
                    </div>
                    {isSelected && (
                      <span className="text-[11px] text-[var(--purple-1)] font-semibold" style={{ fontFamily: 'var(--font-app)' }}>
                        SELECTED
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Token Inputs */}
        <div className="space-y-3 relative">
          {/* Token In (PAY) */}
          <div
            className="p-5 rounded-2xl"
            style={{
              background: 'rgba(11, 13, 24, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div className="flex justify-between items-center mb-2.5">
              <label className="text-xs font-semibold tracking-wide text-slate-300" style={{ fontFamily: 'var(--font-app)' }}>
                YOU PAY
              </label>
              {connectedAddress && (
                <span className="text-xs text-slate-400" style={{ fontFamily: 'var(--font-app)' }}>
                  Balance: <strong className="text-white ml-1">{selectedBalance} {getTokenDisplaySymbol(fromChain, tokenIn)}</strong>
                </span>
              )}
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1">
                <input
                  type="number"
                  step="any"
                  required
                  placeholder={tokenIn === 'cirBTC' ? '0.00000' : '0.00'}
                  value={amountIn}
                  onChange={(e) => setAmountIn(e.target.value)}
                  disabled={isSwapping}
                  className="w-full bg-transparent border-0 p-0 text-2xl font-medium text-white focus:outline-none"
                  style={{
                    fontFamily: 'var(--fonts--space-grotesk)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                />
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setAmountIn(selectedBalance)}
                  disabled={isSwapping}
                  className="ub-action-btn"
                  style={{
                    fontSize: 10,
                    padding: '3px 9px',
                    borderRadius: 99,
                    background: 'rgba(152, 150, 255, 0.12)',
                    borderColor: 'rgba(152, 150, 255, 0.3)',
                    color: 'var(--purple-1)',
                  }}
                >
                  MAX
                </button>

                {/* Custom Token In Dropdown */}
                <div className="relative" ref={tokenInRef}>
                  <button
                    type="button"
                    disabled={isSwapping}
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowTokenInDropdown(prev => !prev)
                      setShowTokenOutDropdown(false)
                    }}
                    className="rounded-2xl px-3 py-2 text-xs text-white focus:outline-none flex items-center gap-2 cursor-pointer transition-all"
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: showTokenInDropdown ? '1px solid rgba(152, 150, 255, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                    }}
                  >
                    {TOKEN_ICONS[tokenIn] && (
                      <img src={TOKEN_ICONS[tokenIn]} alt={tokenIn} className="w-5 h-5 object-contain" />
                    )}
                    <span className="font-semibold">{tokenIn}</span>
                    <ChevronDown size={14} className={`transition-transform duration-200 text-slate-400 ${showTokenInDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {showTokenInDropdown && (
                    <div
                      className="absolute right-0 mt-2 w-36 rounded-2xl shadow-2xl p-1.5 z-[130] space-y-1 backdrop-blur-2xl"
                      style={{
                        background: 'rgba(15, 18, 32, 0.96)',
                        border: '1px solid rgba(152, 150, 255, 0.25)',
                      }}
                    >
                      {['USDC', 'EURC', 'cirBTC'].map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => {
                            setTokenIn(t)
                            setShowTokenInDropdown(false)
                            if (t === tokenOut) {
                              const otherTokens = ['USDC', 'EURC', 'cirBTC'].filter(tk => tk !== t)
                              setTokenOut(otherTokens[0])
                            }
                          }}
                          className={`w-full text-left px-3 py-2 text-xs rounded-xl transition-all flex items-center gap-2.5 cursor-pointer ${
                            tokenIn === t
                              ? 'bg-[rgba(152,150,255,0.15)] text-white border border-[rgba(152,150,255,0.3)]'
                              : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-transparent'
                          }`}
                        >
                          {TOKEN_ICONS[t] && (
                            <img src={TOKEN_ICONS[t]} alt={t} className="w-4 h-4 object-contain" />
                          )}
                          <span className="font-semibold">{t}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Switch Direction Arrow Floating Circle */}
          <div className="flex justify-center -my-2.5 py-0 relative z-10">
            <button
              type="button"
              onClick={handleSwitchDirection}
              disabled={isSwapping}
              className="w-10 h-10 rounded-full flex items-center justify-center text-slate-300 hover:text-white bg-[#0f1220] border border-white/10 hover:border-[var(--purple-1)] hover:shadow-lg hover:shadow-indigo-500/20 hover:scale-110 active:scale-95 transition-all duration-300 cursor-pointer group"
              title="Switch swap direction"
            >
              <ArrowUpDown className="w-4 h-4 text-slate-400 group-hover:text-[var(--purple-1)] transition-transform duration-300 group-hover:rotate-180" />
            </button>
          </div>

          {/* Token Out (RECEIVE) with Integrated Destination Pill */}
          <div
            className={`p-5 rounded-2xl transition-all duration-300 ${
              useCustomRecipient && recipientIsValid
                ? 'border-[rgba(152,150,255,0.25)] shadow-[0_4px_24px_rgba(152,150,255,0.06)]'
                : 'border-white/[0.08]'
            }`}
            style={{
              background: 'rgba(11, 13, 24, 0.75)',
            }}
          >
            <div className="flex justify-between items-center mb-2.5">
              <label className="text-xs font-semibold tracking-wide text-slate-300" style={{ fontFamily: 'var(--font-app)' }}>
                YOU RECEIVE
              </label>

              {/* Destination Wallet Badge (Default: Connected Wallet, Clickable to customize) */}
              <button
                type="button"
                disabled={isSwapping}
                onClick={() => {
                  setIsEditingRecipient(prev => {
                    const next = !prev
                    if (!next) {
                      // Closing: if no valid address was entered, revert back to default connected wallet
                      if (!customRecipient || !isValidEvmAddress(customRecipient)) {
                        setCustomRecipient('')
                        setUseCustomRecipient(false)
                        setRecipientError(null)
                      }
                    }
                    return next
                  })
                }}
                className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-200 cursor-pointer border ${
                  useCustomRecipient && recipientIsValid
                    ? 'bg-[rgba(152,150,255,0.15)] border-[rgba(152,150,255,0.4)] text-white shadow-[0_0_12px_rgba(152,150,255,0.25)]'
                    : isEditingRecipient
                      ? 'bg-white/[0.08] border-white/25 text-white shadow-[0_0_10px_rgba(255,255,255,0.08)]'
                      : 'bg-white/[0.03] hover:bg-white/[0.08] border-white/[0.08] hover:border-white/[0.2] text-slate-300 hover:text-white'
                }`}
                title={useCustomRecipient && recipientIsValid ? `Destination: ${customRecipient} (Click to change)` : `Default: ${connectedAddress || 'Connected Wallet'} (Click to change)`}
              >
                <span className="text-[10px] text-slate-400 font-normal">To:</span>
                {useCustomRecipient && recipientIsValid ? (
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-semibold text-[var(--purple-1)]">{formatAddress(customRecipient)}</span>
                    <Check className="w-3 h-3 text-emerald-400" />
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-semibold text-slate-300 group-hover:text-white">
                      {connectedAddress ? formatAddress(connectedAddress) : 'Default Wallet'}
                    </span>
                    <Edit3 className="w-3 h-3 text-slate-400 group-hover:text-[var(--purple-1)] transition-colors" />
                  </div>
                )}
              </button>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1">
                <input
                  type="number"
                  step="any"
                  readOnly
                  placeholder={tokenOut === 'cirBTC' ? '0.00000' : '0.00'}
                  value={estimatedOutput}
                  className="w-full bg-transparent border-0 p-0 text-2xl font-medium text-white focus:outline-none cursor-default"
                  style={{
                    fontFamily: 'var(--fonts--space-grotesk)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                />
              </div>

              {/* Custom Token Out Dropdown */}
              <div className="relative shrink-0" ref={tokenOutRef}>
                <button
                  type="button"
                  disabled={isSwapping}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowTokenOutDropdown(prev => !prev)
                    setShowTokenInDropdown(false)
                  }}
                  className="rounded-2xl px-3 py-2 text-xs text-white focus:outline-none flex items-center gap-2 cursor-pointer transition-all"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: showTokenOutDropdown ? '1px solid rgba(152, 150, 255, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  {TOKEN_ICONS[tokenOut] && (
                    <img src={TOKEN_ICONS[tokenOut]} alt={tokenOut} className="w-5 h-5 object-contain" />
                  )}
                  <span className="font-semibold">{tokenOut}</span>
                  <ChevronDown size={14} className={`transition-transform duration-200 text-slate-400 ${showTokenOutDropdown ? 'rotate-180' : ''}`} />
                </button>

                {showTokenOutDropdown && (
                  <div
                    className="absolute right-0 mt-2 w-36 rounded-2xl shadow-2xl p-1.5 z-[130] space-y-1 backdrop-blur-2xl"
                    style={{
                      background: 'rgba(15, 18, 32, 0.96)',
                      border: '1px solid rgba(152, 150, 255, 0.25)',
                    }}
                  >
                    {['USDC', 'EURC', 'cirBTC'].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setTokenOut(t)
                          setShowTokenOutDropdown(false)
                          if (t === tokenIn) {
                            const otherTokens = ['USDC', 'EURC', 'cirBTC'].filter(tk => tk !== t)
                            setTokenIn(otherTokens[0])
                          }
                        }}
                        className={`w-full text-left px-3 py-2 text-xs rounded-xl transition-all flex items-center gap-2.5 cursor-pointer ${
                          tokenOut === t
                            ? 'bg-[rgba(152,150,255,0.15)] text-white border border-[rgba(152,150,255,0.3)]'
                            : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-transparent'
                        }`}
                      >
                        {TOKEN_ICONS[t] && (
                          <img src={TOKEN_ICONS[t]} alt={t} className="w-4 h-4 object-contain" />
                        )}
                        <span className="font-semibold">{t}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Custom Destination Address Expansion Panel */}
            {isEditingRecipient && (
              <div className="mt-3.5 pt-3.5 border-t border-white/[0.08] space-y-2 animate-fade-in">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <div className="flex items-center gap-1.5 font-medium">
                    <Wallet className="w-3.5 h-3.5 text-[var(--purple-1)]" />
                    <span>Custom Destination Address</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomRecipient('')
                      setUseCustomRecipient(false)
                      setIsEditingRecipient(false)
                      setRecipientError(null)
                    }}
                    className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                  >
                    Reset to Default
                  </button>
                </div>

                {/* Input Box with Icons */}
                <div className="relative flex items-center">
                  <input
                    ref={recipientInputRef}
                    type="text"
                    placeholder={'0x...'}
                    value={customRecipient}
                    onChange={(e) => {
                      const value = e.target.value.trim()
                      setCustomRecipient(value)
                      setUseCustomRecipient(isValidEvmAddress(value))
                      setRecipientError(null)
                    }}
                    onBlur={() => {
                      if (customRecipient && !isValidEvmAddress(customRecipient)) {
                        setRecipientError('Please enter a valid EVM address.')
                      }
                    }}
                    disabled={isSwapping}
                    className={`w-full rounded-xl pl-3.5 pr-16 py-3 text-xs text-white focus:outline-none font-mono transition-all ${
                      recipientError
                        ? 'bg-rose-500/[0.08] border border-rose-500/40 focus:border-rose-500'
                        : recipientIsValid
                          ? 'bg-[rgba(11,13,24,0.95)] border-2 border-emerald-500 focus:border-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.3)]'
                          : 'bg-[rgba(11,13,24,0.75)] border border-white/10 focus:border-[var(--purple-1)]'
                    }`}
                  />

                  {/* Action Buttons inside Input */}
                  <div className="absolute right-2 flex items-center gap-1">
                    {customRecipient && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomRecipient('')
                          setUseCustomRecipient(false)
                          setRecipientError(null)
                        }}
                        className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer"
                        title="Clear"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handlePasteCustomRecipient}
                      disabled={isSwapping}
                      title="Paste from clipboard"
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white transition-all border border-white/[0.06] cursor-pointer active:scale-95"
                    >
                      <Clipboard className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Recipient Error Display */}
                {recipientError && (
                  <div className="flex items-center gap-1.5 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1.5 rounded-xl animate-shake">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{recipientError}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Error or Quote Summary Card */}
        {estimateError && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/25 rounded-2xl text-rose-400 text-xs flex gap-2.5 font-[var(--font-app)] items-start">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Route Error</span>
              <p className="text-xs text-slate-300 mt-0.5">
                {estimateError.includes('INPUT_AMOUNT_OUT_OF_RANGE') || estimateError.includes('outside the supported liquidity limits')
                  ? 'Girdiğiniz tutar minimum takas limitinin altındadır.'
                  : estimateError}
              </p>
            </div>
          </div>
        )}

        {/* Quote details özet kartı */}
        {estimatedOutput && !estimateError && !isEstimating && (
          <div
            className="p-4.5 sm:p-5 rounded-2xl space-y-2.5 text-xs animate-fade-in"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              fontFamily: 'var(--font-app)',
              color: 'var(--fp-3)',
            }}
          >
            <div className="flex justify-between items-center text-white">
              <span className="font-semibold">Live Quote Preview</span>
              <span className="bg-emerald-500/10 text-emerald-400 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-emerald-500/25">Best Rate</span>
            </div>
            <div className="flex justify-between border-b border-white/[0.06] pb-2 pt-0.5">
              <span>Exchange Rate</span>
              <span className="text-white font-medium">1 {getTokenDisplaySymbol(fromChain, tokenIn)} = {rate} {getTokenDisplaySymbol(toChain, tokenOut)}</span>
            </div>
            <div className="flex justify-between border-b border-white/[0.06] pb-2">
              <span>Minimum Guaranteed (Stop Limit)</span>
              <span className="text-white font-medium">{stopLimit} {getTokenDisplaySymbol(toChain, tokenOut)}</span>
            </div>
            <div className="flex justify-between border-b border-white/[0.06] pb-2">
              <span>Slippage Tolerance</span>
              <span className="text-slate-200 font-mono">{(slippageTolerance * 100).toFixed(1)}%</span>
            </div>
            
            {/* Transparent Fees Breakdown */}
            <div className="space-y-1.5 pt-1">
              <div className="text-[11px] font-semibold text-[var(--purple-1)] uppercase tracking-wider">Fee Breakdown</div>
              
              {/* Platform Fee */}
              {platformFeeEnabled && platformFeeAmount && (
                <div className="flex justify-between items-center text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span>ArcFlow Platform Fee ({platformFeePercent}):</span>
                    <a
                      href={TREASURY_EXPLORER_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Treasury: ${formatTreasuryAddress(TREASURY_ADDRESS)} (${REVENUE_SHARE_TOOLTIP})`}
                      className="text-[9px] bg-[rgba(152,150,255,0.15)] text-[var(--purple-1)] hover:bg-[rgba(152,150,255,0.25)] px-1.5 py-0.2 rounded-full border border-[rgba(152,150,255,0.3)] flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <span>{REVENUE_SHARE_LABEL}</span>
                      <ExternalLink className="w-2.5 h-2.5" />
                    </a>
                  </div>
                  <span className="font-mono text-slate-200">{platformFeeAmount} {getTokenDisplaySymbol(fromChain, tokenIn)}</span>
                </div>
              )}

              {/* Provider Fee / SDK Fees */}
              <div className="flex justify-between items-center text-slate-300">
                <span>DEX Liquidity Provider Fee</span>
                <span className="font-mono text-slate-200">0.02%</span>
              </div>

              {/* Execution Speed & Priority Link */}
              <div className="flex justify-between items-center text-slate-300 pt-0.5">
                <span>Execution Priority</span>
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className={`font-mono text-xs font-semibold flex items-center gap-1.5 px-2.5 py-1 rounded-full border cursor-pointer transition-all duration-200 group ${
                    speedTier === 'turbo'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 hover:border-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                      : speedTier === 'fast'
                        ? 'bg-[rgba(152,150,255,0.2)] text-[var(--purple-1,#9896ff)] border-[rgba(152,150,255,0.45)] hover:bg-[rgba(152,150,255,0.3)] hover:border-[rgba(152,150,255,0.65)] shadow-[0_0_12px_rgba(152,150,255,0.2)]'
                        : 'bg-blue-500/15 text-blue-300 border-blue-500/35 hover:bg-blue-500/25 hover:border-blue-500/55 shadow-[0_0_10px_rgba(59,130,246,0.18)]'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      speedTier === 'turbo'
                        ? 'bg-amber-400 shadow-[0_0_6px_#f59e0b]'
                        : speedTier === 'fast'
                          ? 'bg-[var(--purple-1,#9896ff)] shadow-[0_0_6px_#9896ff]'
                          : 'bg-blue-400 shadow-[0_0_6px_#60a5fa]'
                    }`}
                  />
                  <span>{SPEED_TIERS[speedTier].label} {SPEED_TIERS[speedTier].timeEstimate.swap}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Submit Swap Button */}
        {!successData && (
          <button
            type="submit"
            disabled={
              isSwapping ||
              isInsufficient ||
              tokenIn === tokenOut ||
              !!estimateError ||
              isEstimating ||
              (useCustomRecipient && !isValidEvmAddress(customRecipient)) ||
              !!recipientError
            }
            className="w-full py-4 mt-4 rounded-full text-sm font-semibold tracking-wide text-white bg-blue-900 hover:bg-blue-800 transition-all flex items-center justify-center gap-2 cursor-pointer"
            style={{
              fontFamily: 'var(--font-app)',
              cursor: (
                isSwapping ||
                isInsufficient ||
                tokenIn === tokenOut ||
                !!estimateError ||
                isEstimating ||
                (useCustomRecipient && !isValidEvmAddress(customRecipient)) ||
                !!recipientError
              ) ? 'not-allowed' : 'pointer',
            }}
          >
            {isSwapping ? (
              <>
                <RefreshCw className="w-4 h-4 arcflow-spin" />
                <span>{isCrossChain ? 'CROSS-CHAIN SWAPPING...' : 'SWAPPING...'}</span>
              </>
            ) : (
              <>
                <ArrowRightLeft className="w-4 h-4" />
                <span>{isInsufficient ? 'INSUFFICIENT BALANCE' : isCrossChain ? 'CROSS-CHAIN SWAP' : 'SWAP'}</span>
              </>
            )}
          </button>
        )}
        
        {/* Success Summary */}
        {successData && (
          <div
            className="mt-6 p-5 rounded-2xl space-y-4 animate-fade-in"
            style={{
              background: 'rgba(1, 208, 98, 0.08)',
              border: '1px solid rgba(1, 208, 98, 0.25)',
              fontFamily: 'var(--font-app)',
            }}
          >
            <div className="flex items-center gap-2.5 text-emerald-400 font-semibold text-sm">
              <ShieldCheck className="w-5 h-5 text-emerald-400 animate-bounce" />
              <span>SWAP COMPLETED SUCCESSFULLY!</span>
            </div>

            <div
              className="p-4 rounded-xl space-y-2.5 text-xs"
              style={{
                background: 'rgba(11, 13, 24, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div className="flex justify-between border-b border-white/[0.06] pb-2 text-slate-300">
                <span>Swapped Amount</span>
                <span className="text-white font-semibold">{successData.amountIn} {getTokenDisplaySymbol(fromChain, successData.tokenIn)} {"→"} {successData.amountOut} {getTokenDisplaySymbol(toChain, successData.tokenOut)}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Route Type</span>
                <span className="text-white font-medium">{isCrossChain ? 'Cross-Chain CCTP Swap' : 'Same-Chain Swap'}</span>
              </div>
            </div>

            <div className="flex gap-2.5 pt-2">
              {successData.txHash && (
                <a
                  href={getExplorerTxUrl(fromChain, successData.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="ub-action-btn ub-action-btn-primary flex-1 justify-center py-2.5 text-xs font-semibold"
                >
                  <ExternalLink className="w-3.5 h-3.5 mr-1" />
                  <span>VIEW EXPLORER</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => {
                  setSuccessData(null)
                  setIsSwapping(false)
                }}
                className="ub-action-btn ub-action-btn-primary flex-1 justify-center py-2.5 text-xs font-semibold"
              >
                <ArrowRightLeft className="w-4 h-4" />
                <span>SWAP AGAIN</span>
              </button>
              {!isInline && (
                <button
                  type="button"
                  onClick={onClose}
                  className="ub-action-btn flex-1 justify-center py-2.5 text-xs font-semibold"
                >
                  <span>CLOSE</span>
                </button>
              )}
            </div>
          </div>
        )}

      </form>

    </div>
  )

  // Settings Window / Modal rendered over document.body via Portal
  const settingsModalWindow = showSettings && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in"
          onClick={() => setShowSettings(false)}
        >
          <div
            className="w-full max-w-[540px] rounded-3xl p-7 sm:p-8 shadow-2xl relative border space-y-6 animate-scale-in"
            style={{
              background: 'linear-gradient(180deg, rgba(17, 21, 38, 0.98) 0%, rgba(11, 13, 24, 0.99) 100%)',
              borderColor: 'rgba(152, 150, 255, 0.35)',
              boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.9), 0 0 32px rgba(152, 150, 255, 0.15)',
              fontFamily: 'var(--font-app)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-white/[0.08]">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{
                    background: 'rgba(152, 150, 255, 0.12)',
                    border: '1px solid rgba(152, 150, 255, 0.25)',
                    color: 'var(--purple-1)',
                  }}
                >
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-m font-semibold text-white tracking-wide" style={{ fontFamily: 'var(--font-app)' }}>
                    SETTINGS
                  </h3>
                  <p className="text-[11px] text-slate-400">Transaction & slippage preferences</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06] transition-all cursor-pointer"
                title="Close settings"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Slippage Tolerance Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[14px] font-semibold text-slate-300 tracking-wider flex items-center gap-1.5">
                  SLIPPAGE TOLERANCE
                </label>
                <span className="text-[14px] text-[var(--purple-1)] font-semibold font-mono px-2.5 py-0.5 rounded-full bg-[rgba(152,150,255,0.12)] border border-[rgba(152,150,255,0.25)]">
                  % {(slippageTolerance * 100).toFixed(1)}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Your transaction will revert if the price changes unfavorably by more than this percentage.
              </p>

              {/* Slippage Presets */}
              <div className="grid grid-cols-4 gap-2">
                {(['0.1', '0.5', '1.0'] as const).map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      setSelectedSlippageType(type)
                      setCustomSlippage('')
                    }}
                    className={`py-2 px-2.5 rounded-xl text-xs font-semibold transition-all text-center cursor-pointer ${
                      selectedSlippageType === type
                        ? 'text-white bg-[rgba(152,150,255,0.25)] border border-[rgba(152,150,255,0.5)] shadow-md shadow-indigo-500/20'
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
                      ? 'text-white bg-[rgba(152,150,255,0.25)] border border-[rgba(152,150,255,0.5)] shadow-md shadow-indigo-500/20'
                      : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06]'
                  }`}
                >
                  Custom
                </button>
              </div>

              {/* Custom Slippage Input */}
              {selectedSlippageType === 'custom' && (
                <div className="space-y-2 pt-1 animate-fade-in">
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
                      className="w-full rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none transition-all pr-8"
                      style={{
                        background: 'rgba(11, 13, 24, 0.75)',
                        border: '1px solid rgba(152, 150, 255, 0.3)',
                      }}
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
                      %
                    </span>
                  </div>
                  {isHighSlippageWarning && (
                    <div className="flex gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl leading-relaxed">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>High slippage tolerance may result in frontrunning or unfavorable execution rate.</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Speed & Execution Priority Section */}
            <div className="space-y-2 pt-2 border-t border-white/[0.08]">
              <SpeedFeeSelector
                selectedTier={speedTier}
                onSelectTier={(tier) => setSpeedTier(tier)}
                context="swap"
                disabled={isSwapping}
              />
            </div>

            {/* Footer Action Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold tracking-wide text-white transition-all cursor-pointer flex items-center justify-center gap-1.5"
                style={{
                  background: 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
                  boxShadow: '0 4px 16px rgba(152, 150, 255, 0.3)',
                }}
              >
                Save Settings
              </button>
            </div>
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

