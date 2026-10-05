import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useClearOnWalletDisconnect } from '../hooks/useClearOnWalletDisconnect'
import {
  X,
  ArrowRightLeft,
  AlertTriangle,
  Settings,
  Wallet,
  Clipboard,
  Edit3,
  ChevronDown,
  Ban,
  Clock,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import { normalizeAppError } from '../utils/errorNormalizer'
import { useQueryClient } from '@tanstack/react-query'
import { redisCache } from '../services/redisCacheService'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { createViemAdapter } from '../services/sendService'
import { getSwapEstimate, executeSwap, getSupportedSwapChains } from '../services/swapService'
import { addTransaction } from '../utils/history'
import { getArcPublicClient, getResilientPublicClient } from '../services/rpc'
import { verifyArcSwapReceipt } from '../services/copilotExecutionService'
import { resolveArcActualFeeUsdc } from '../services/arcGasService'
import {
  floorToPlaces,
  computeMaxSpendable,
  computeQuickAmount,
  ARC_GAS_BUFFER_USDC,
} from '../utils/swapAmountUtils'
import { PrivacyLockButton } from './privacy/PrivacyLockButton'
import { useBroadcast } from './BroadcastNotification'
import { SpeedFeeSelector } from './common/SpeedFeeSelector'
import { SPEED_TIERS, type SpeedTier } from '../config/feeTiers'
import {
  getSwapFeeRecipient,
  SWAP_CUSTOM_FEE_CONFIG,
} from '../config/treasuryConfig'
import {
  poolSlippageBps,
  STABLE_SWAP_LP_FEE_BPS,
  CONSTANT_PRODUCT_LP_FEE_BPS,
} from '../config/poolsConfig'
import { getChainIconId } from '../config/swapConfig'
import { getExplorerTxUrl } from '../config/sendConfig'
import { formatFeeDecimals } from '../utils/tokenUtils'
import type { SwapQuoteResult } from '../types/swap'
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
import { useLiveTokenPrices, formatFiatEstimate } from '../hooks/useLiveTokenPrices'
import { Tooltip } from './common/Tooltip'

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
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  executeUcwContract?: (params: {
    contractAddress: string
    abiFunctionSignature?: string
    abiParameters?: any[]
    callData?: string
    amount?: string
    blockchain?: string
    walletId?: string
  }) => Promise<{ success: boolean; txHash?: string; error?: string }>
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
  authSource,
  executeUcwContract,
  onSuccess,
}: SwapModalProps) {
  const { addBroadcast, updateBroadcast } = useBroadcast()
  const queryClient = useQueryClient()
  const [isPrivateSwap, setIsPrivateSwap] = useState(false)

  // Dynamic Chain Selector
  const [selectedChain, setSelectedChain] = useState('Arc_Testnet')
  const [showChainModal, setShowChainModal] = useState(false)

  // Enforce Arc Testnet when UCW wallet is connected
  useEffect(() => {
    if (authSource === 'ucw' && selectedChain !== 'Arc_Testnet') {
      setSelectedChain('Arc_Testnet')
    }
  }, [authSource, selectedChain])

  // Token Selector Modals
  const [showTokenInModal, setShowTokenInModal] = useState(false)
  const [showTokenOutModal, setShowTokenOutModal] = useState(false)

  // Live Token Prices
  const { data: tokenPrices } = useLiveTokenPrices()

  // Routing State
  const fromChain = selectedChain

  const [tokenIn, setTokenIn] = useState('USDC')
  const [tokenOut, setTokenOut] = useState('EURC')
  const [amountIn, setAmountIn] = useState('')
  const [allowanceStrategy] = useState<'permit' | 'approve'>('permit')

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
  const [isCanceledError, setIsCanceledError] = useState(false)
  // A submitted-but-unconfirmed swap (fix #1): the tx is on-chain but its receipt is not yet
  // observable. While this is set the form refuses to submit again so the same swap can never
  // be broadcast twice.
  const [pendingSwap, setPendingSwap] = useState<{
    txHash?: string
    stage: 'approve' | 'swap'
    message: string
    broadcastId: string
    payload: { amountIn: string; amountOut: string; tokenIn: string; tokenOut: string; recipient: string }
  } | null>(null)
  // Non-blocking follow-up message (e.g. "approval confirmed, submit the swap again").
  const [notice, setNotice] = useState<string | null>(null)
  // Guards the background confirmation poller: only one poll runs at a time, and clearing the
  // pending record (dismiss / wallet disconnect / modal reopen) cancels it immediately.
  const pendingConfirmRef = useRef(false)
  const pendingPollCancelRef = useRef(false)

  // Quote & Estimate States
  const [estimatedOutput, setEstimatedOutput] = useState<string>('')
  const [stopLimit, setStopLimit] = useState<string>('')
  const [rate, setRate] = useState<string>('')
  const [quoteFees, setQuoteFees] = useState<SwapQuoteResult['fees']>([])
  const [isEstimating, setIsEstimating] = useState(false)
  const [estimateError, setEstimateError] = useState<string | null>(null)

  // Systematic input and state clearing on wallet disconnect
  const resetFormInputs = useCallback(() => {
    setAmountIn('')
    setCustomRecipient('')
    setRecipientError(null)
    setStopLimit('')
    setCustomSlippage('')
    setSelectedSlippageType('0.5')
    setUseCustomRecipient(false)
    setIsEditingRecipient(false)
    setEstimatedOutput('')
    setRate('')
    setQuoteFees([])
    setError(null)
    setIsCanceledError(false)
    setEstimateError(null)
    setSuccessData(null)
    setIsSwapping(false)
    setPendingSwap(null)
    setNotice(null)
    pendingPollCancelRef.current = true
  }, [])

  useClearOnWalletDisconnect(resetFormInputs)

  useEffect(() => {
    if (!connectedAddress) {
      resetFormInputs()
    }
  }, [connectedAddress, resetFormInputs])

  // Slippage tolerance calculation — clamped to the pool-safe [0.1%, 10%] band (fix #5) so a
  // custom value can never produce a negative min-out. Invalid/empty input falls back to 0.5%.
  const slippageTolerance = useMemo(() => {
    const percent =
      selectedSlippageType === 'custom' ? parseFloat(customSlippage) : parseFloat(selectedSlippageType)
    return poolSlippageBps(percent) / 10000
  }, [selectedSlippageType, customSlippage])

  const isHighSlippageWarning = selectedSlippageType === 'custom' && parseFloat(customSlippage) > 5.0

  // Speed & Network Execution Priority
  const [speedTier, setSpeedTier] = useState<SpeedTier>('fast')

  // Treasury Platform Fee from SWAP_CUSTOM_FEE_CONFIG (.env: VITE_SWAP_FEE_BPS & VITE_SWAP_FEE_ENABLED)
  // Fix #9: when the custom fee is disabled NOTHING is charged, so there is no "fallback"
  // protocol bps to display — the breakdown must read "Free" and the receipt must show no fee.
  const platformFeeEnabled = SWAP_CUSTOM_FEE_CONFIG.enabled
  const platformFeeBps = platformFeeEnabled ? SWAP_CUSTOM_FEE_CONFIG.percentageBps : 0
  const platformFeePercent = platformFeeBps > 0 ? `${(platformFeeBps / 100).toFixed(2)}%` : 'Free'

  const rawPlatformFeeNum = useMemo(() => {
    const amt = parseFloat(amountIn)
    if (isNaN(amt) || amt <= 0 || !platformFeeBps || platformFeeBps <= 0) return null
    return (amt * platformFeeBps) / 10000
  }, [amountIn, platformFeeBps])

  const platformFeeAmount = useMemo(() => {
    if (rawPlatformFeeNum === null || rawPlatformFeeNum <= 0) return null
    if (rawPlatformFeeNum < 0.01) {
      if (tokenIn === 'cirBTC') {
        return parseFloat(rawPlatformFeeNum.toFixed(6)).toString()
      }
      return '< 0.01'
    }
    return formatFeeDecimals(rawPlatformFeeNum, 2)
  }, [rawPlatformFeeNum, tokenIn])

  // Validation
  const isValidEvmAddress = (addr: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(addr)
  const recipientIsValid = useCustomRecipient ? isValidEvmAddress(customRecipient) : false
  const recipientIsOwnAddress =
    useCustomRecipient && connectedAddress && customRecipient.toLowerCase() === connectedAddress.toLowerCase()

  const effectiveRecipient = useCustomRecipient && recipientIsValid ? customRecipient : connectedAddress
  const supportedChains = useMemo(() => getSupportedSwapChains(), [])

  // When UCW wallet is connected: Arc Testnet is prioritized at the top and selected,
  // and all other networks are rendered muted/dimmed and unselectable (seçilemez).
  const availableSwapChains = useMemo(() => {
    const arcChain = supportedChains.find((c) => c.chain === 'Arc_Testnet') || {
      chain: 'Arc_Testnet',
      name: 'Arc Testnet',
    }
    const otherChains = supportedChains.filter((c) => c.chain !== 'Arc_Testnet')

    if (authSource === 'ucw') {
      const formattedArc = [{ ...arcChain, disabled: false }]
      const formattedOthers = otherChains.map((c) => ({
        ...c,
        disabled: true,
        disabledReason: 'EVM Req.',
      }))
      return [...formattedArc, ...formattedOthers]
    }

    return [arcChain, ...otherChains]
  }, [supportedChains, authSource])

  // Reset modal state on open
  useEffect(() => {
    if (isOpen) {
      refetchWalletBalances()
      setAmountIn('')
      setEstimatedOutput('')
      setStopLimit('')
      setRate('')
      setQuoteFees([])
      setSuccessData(null)
      setError(null)
      setIsCanceledError(false)
      setEstimateError(null)
      setIsSwapping(false)
      setPendingSwap(null)
      setNotice(null)
      pendingPollCancelRef.current = true
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

  // ── Spendable cap for MAX / quick-% (fix #4) ───────────────────────────────────
  // Balances are floored (never rounded up) and, on Arc where gas is paid in USDC, a gas
  // reserve is withheld so a MAX swap cannot consume the whole gas balance.
  const tokenInPlaces = tokenIn === 'cirBTC' ? 5 : 2
  const reservesGasBuffer = fromChain === 'Arc_Testnet' && tokenIn === 'USDC' && authSource !== 'passkey'

  const flooredBalance = floorToPlaces(parseFloat(tokenInBalance), tokenInPlaces)
  const maxSpendable = computeMaxSpendable(tokenInBalance, tokenInPlaces, reservesGasBuffer)

  const isArcNativeSwap = fromChain === 'Arc_Testnet'
  const amountInNum = parseFloat(amountIn)
  const isInsufficient = amountIn ? amountInNum > maxSpendable + 1e-9 : false
  // Distinguishes "you tried to swap your entire balance" from a plain insufficient balance so
  // the CTA can tell the user to keep a gas reserve instead of blaming their balance.
  const isShortOnlyByGasBuffer =
    reservesGasBuffer && isInsufficient && amountInNum <= flooredBalance + 1e-9

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
      setQuoteFees([])
      setEstimateError(null)
      // Fix #6: every early return must clear the estimating flag, otherwise the previous run
      // leaves the receive-panel skeleton spinning forever (e.g. after clearing the amount).
      setIsEstimating(false)
      return
    }

    if (tokenIn === tokenOut) {
      setEstimatedOutput('')
      setStopLimit('')
      setRate('')
      setQuoteFees([])
      setEstimateError('Source and destination tokens must be different for same-chain swaps.')
      setIsEstimating(false)
      return
    }

    // Dead-code removal (audit): Arc swaps only expose USDC/EURC/cirBTC in this modal, so the
    // old USDC↔NATIVE no-op guard could never trigger.

    let isMounted = true
    setIsEstimating(true)
    setEstimateError(null)

    const fetchEstimate = async () => {
      try {
        let sourceAdapter: any = undefined
        if (provider) {
          try {
            sourceAdapter = await createViemAdapter(provider)
          } catch {
            sourceAdapter = undefined
          }
        }

        const quote = await getSwapEstimate({
          fromChain,
          tokenIn,
          tokenOut,
          amountIn,
          sourceAdapter,
          recipientAddress: effectiveRecipient,
          slippageTolerance,
          allowanceStrategy,
          authSource,
          ...(platformFeeEnabled && {
            customFee: {
              percentageBps: platformFeeBps,
              recipientAddress: getSwapFeeRecipient(fromChain),
            },
          }),
        })
        if (isMounted) {
          setEstimatedOutput(quote.estimatedOutput)
          setStopLimit(quote.stopLimit)
          setRate(quote.rate)
          setQuoteFees(quote.fees || [])
          setIsEstimating(false)
        }
      } catch (err: any) {
        console.error('[Swap Quote Error]', err)
        if (isMounted) {
          setEstimatedOutput('')
          setStopLimit('')
          setRate('')
          setQuoteFees([])
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
  }, [
    amountIn,
    tokenIn,
    tokenOut,
    fromChain,
    slippageTolerance,
    allowanceStrategy,
    provider,
    authSource,
    speedTier,
    platformFeeBps,
    platformFeeEnabled,
    effectiveRecipient,
  ])

  // ── Receipt enrichment (fix #8): read the real received amount and the exact network fee
  // from the mined receipt instead of only echoing the quote estimate.
  const fetchSwapActuals = useCallback(
    async (
      txHash: string,
      p: { amountIn: string; tokenIn: string; tokenOut: string; recipient: string }
    ): Promise<{ actualAmountOut?: string; networkFee?: string }> => {
      const actuals: { actualAmountOut?: string; networkFee?: string } = {}
      if (!isArcNativeSwap || !txHash || !txHash.startsWith('0x')) return actuals

      try {
        const proof = await verifyArcSwapReceipt(
          txHash as `0x${string}`,
          p.recipient,
          p.tokenIn,
          p.tokenOut,
          parseFloat(p.amountIn)
        )
        if (proof.status === 'success' && Number.isFinite(proof.amountOut) && proof.amountOut > 0) {
          actuals.actualAmountOut = formatFeeDecimals(proof.amountOut, p.tokenOut === 'cirBTC' ? 8 : 6)
        }
      } catch (actualErr) {
        console.warn('[SwapModal] Actual received amount lookup failed:', actualErr)
      }

      try {
        const fee = await resolveArcActualFeeUsdc(txHash)
        if (fee?.feeUsdc != null && Number.isFinite(fee.feeUsdc)) {
          actuals.networkFee = `${fee.feeUsdc} USDC`
        }
      } catch (feeErr) {
        console.warn('[SwapModal] Actual network fee lookup failed:', feeErr)
      }

      return actuals
    },
    [isArcNativeSwap]
  )

  // ── Background receipt poller for a submitted-but-unconfirmed swap (fix #1) ─────────
  // PENDING means the transaction IS on-chain. Reporting it as "Swap Failed" (the old behaviour)
  // misled users into resubmitting the same swap, so instead we keep a pending broadcast/history
  // entry, lock the CTA, and quietly promote the record to success (or surface a real revert)
  // as soon as the receipt becomes observable.
  const confirmPendingSwap = useCallback(async (pending: NonNullable<typeof pendingSwap>) => {
    const txHash = pending.txHash
    if (!txHash || pendingConfirmRef.current) return
    pendingConfirmRef.current = true
    pendingPollCancelRef.current = false
    try {
      const client = fromChain === 'Arc_Testnet' ? getArcPublicClient() : getResilientPublicClient(fromChain)
      for (let attempt = 0; attempt < 40; attempt++) {
        if (pendingPollCancelRef.current) return // Pending record was cleared — stop polling.
        await new Promise((resolve) => setTimeout(resolve, 3000))
        let receipt: any = null
        try {
          receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })
        } catch {
          continue // Receipt not available yet — keep polling.
        }

        if (receipt?.status === 'success') {
          const p = pending.payload
          setPendingSwap(null)
          setIsSwapping(false)

          if (pending.stage === 'approve') {
            // Only the ERC-20 approval confirmed — the swap itself was never broadcast, so
            // claiming success here would be a lie. Unlock the form and ask the user to submit.
            setNotice('Token approval confirmed on-chain. Please submit the swap again to complete it.')
            return
          }

          setSuccessData({
            amountIn: p.amountIn,
            amountOut: p.amountOut,
            tokenIn: p.tokenIn,
            tokenOut: p.tokenOut,
            txHash,
            destTxHash: txHash,
            recipient: p.recipient,
            rate: rate
              ? `1 ${p.tokenIn} = ${rate} ${p.tokenOut}`
              : p.amountIn && p.amountOut
              ? `1 ${p.tokenIn} ≈ ${(parseFloat(p.amountOut) / parseFloat(p.amountIn)).toFixed(4)} ${p.tokenOut}`
              : undefined,
            slippage: `${(slippageTolerance * 100).toFixed(1)}%`,
            speedTier: speedTier.charAt(0).toUpperCase() + speedTier.slice(1),
            fee: platformFeeAmount ? `${platformFeeAmount} ${p.tokenIn}` : undefined,
          })
          updateBroadcast(pending.broadcastId, {
            type: 'swap',
            title: 'Swap Completed Successfully',
            status: 'success',
            badgeText: 'Confirmed',
            details: {
              fromAmount: p.amountIn,
              fromSymbol: p.tokenIn,
              fromIcon: TOKEN_ICONS[p.tokenIn],
              fromChain: fromChain,
              toAmount: p.amountOut,
              toSymbol: p.tokenOut,
              toIcon: TOKEN_ICONS[p.tokenOut],
              toChain: fromChain,
              network: fromChain,
              txHash,
            },
          })
          refetchWalletBalances()
          queryClient.invalidateQueries({ queryKey: ['onchainPoolState'] })
          queryClient.invalidateQueries({ queryKey: ['onchainPoolBalances'] })
          queryClient.invalidateQueries({ queryKey: ['userPoolPositions'] })
          redisCache.del('arcis:pools:state').catch(() => {})
          addTransaction({
            type: 'swap',
            txHash,
            amount: p.amountIn,
            tokenSymbol: p.tokenIn,
            sourceChain: fromChain,
            recipient: p.recipient,
            userAddress: connectedAddress,
            status: 'success',
            amountIn: p.amountIn,
            amountOut: p.amountOut,
            tokenIn: p.tokenIn,
            tokenOut: p.tokenOut,
            isPrivate: isPrivateSwap,
          })
          onSuccess(p.amountIn, p.amountOut, p.tokenIn, p.tokenOut, txHash)

          // Fix #8: swap the estimated figures for the real on-chain ones once decoded.
          void fetchSwapActuals(txHash, p).then((actuals) => {
            if (!actuals.actualAmountOut && !actuals.networkFee) return
            setSuccessData((prev: any) =>
              prev
                ? {
                    ...prev,
                    amountOut: actuals.actualAmountOut ?? prev.amountOut,
                    networkFee: actuals.networkFee ?? prev.networkFee,
                  }
                : prev
            )
          })
          return
        }

        if (receipt?.status === 'reverted') {
          setPendingSwap(null)
          const failedStep = pending.stage === 'approve' ? 'Token approval' : 'Swap'
          updateBroadcast(pending.broadcastId, {
            type: 'swap',
            title: 'Swap Failed',
            status: 'failed',
            badgeText: 'Failed',
            message: `The submitted ${failedStep.toLowerCase()} transaction reverted on-chain.`,
            details: {
              fromAmount: pending.payload.amountIn,
              fromSymbol: pending.payload.tokenIn,
              fromIcon: TOKEN_ICONS[pending.payload.tokenIn],
              fromChain: fromChain,
              toAmount: pending.payload.amountOut,
              toSymbol: pending.payload.tokenOut,
              toIcon: TOKEN_ICONS[pending.payload.tokenOut],
              toChain: fromChain,
              network: fromChain,
              txHash,
            },
          })
          if (pending.stage === 'swap') {
            addTransaction({
            type: 'swap',
            txHash,
            amount: pending.payload.amountIn,
            tokenSymbol: pending.payload.tokenIn,
            sourceChain: fromChain,
            recipient: pending.payload.recipient,
            userAddress: connectedAddress,
            status: 'failed',
            amountIn: pending.payload.amountIn,
            amountOut: pending.payload.amountOut,
            tokenIn: pending.payload.tokenIn,
            tokenOut: pending.payload.tokenOut,
            isPrivate: isPrivateSwap,
            })
          }
          setError(
            pending.stage === 'approve'
              ? 'The submitted token approval reverted on-chain. Please retry the swap — nothing was spent.'
              : 'The submitted swap transaction reverted on-chain. No tokens were swapped — it is safe to retry.'
          )
          setIsCanceledError(false)
          return
        }
      }
      // Still unconfirmed after the polling window: leave the pending banner in place.
    } catch (pollErr) {
      console.warn('[SwapModal] Pending swap confirmation poll error:', pollErr)
    } finally {
      pendingConfirmRef.current = false
    }
  }, [
    fromChain,
    connectedAddress,
    isPrivateSwap,
    rate,
    slippageTolerance,
    speedTier,
    platformFeeAmount,
    onSuccess,
    queryClient,
    refetchWalletBalances,
    updateBroadcast,
  ])

  // Swap Execution
  const handleSwapExecution = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSwapping) return
    if (pendingSwap) {
      setError('A previously submitted swap is still awaiting on-chain confirmation. Please wait for it to confirm before submitting another swap.')
      return
    }
    setError(null)
    setNotice(null)
    setIsCanceledError(false)
    setSuccessData(null)

    if (tokenIn === tokenOut) {
      setError('Source and destination tokens must be different for same-chain swaps.')
      setIsCanceledError(false)
      return
    }

    const amt = parseFloat(amountIn)
    if (isNaN(amt) || amt <= 0) {
      setError('Please enter a valid amount')
      setIsCanceledError(false)
      return
    }

    if (useCustomRecipient) {
      if (!isValidEvmAddress(customRecipient)) {
        setRecipientError('Please enter a valid EVM address (0x followed by 40 hex characters).')
        return
      }
      if (recipientIsOwnAddress) {
        setRecipientError('This address is identical to your connected wallet. Please specify a different recipient.')
        return
      }
      // ArcisSwapRouter / StableSwapPool deliver the output to the caller (msg.sender) — there is
      // no recipient parameter. Refuse the swap instead of showing a recipient that would be ignored.
      if (isArcNativeSwap && recipientIsValid && !recipientIsOwnAddress) {
        setError('Arc Testnet pool swaps always deliver the output to the connected wallet — the on-chain router has no recipient parameter. Clear the custom recipient, or use your own address as the destination.')
        return
      }
    }

    setIsSwapping(true)

    const broadcastId = addBroadcast({
      type: 'swap',
      title: 'Swapping Tokens...',
      status: 'pending',
      badgeText: 'Pending',
      details: {
        fromAmount: amountIn,
        fromSymbol: tokenIn,
        fromIcon: TOKEN_ICONS[tokenIn],
        fromChain: fromChain,
        toAmount: estimatedOutput,
        toSymbol: tokenOut,
        toIcon: TOKEN_ICONS[tokenOut],
        toChain: fromChain,
        network: fromChain,
      },
    })

    try {
      const isArcNative = fromChain === 'Arc_Testnet'
      let sourceAdapter: any = undefined

      if (authSource === 'ucw') {
        if (!isArcNative) {
          throw new Error('Swap functionality is currently supported on Arc Testnet. Please select Arc Testnet to execute swaps.')
        }
        if (!executeUcwContract) {
          throw new Error('Wallet contract execution handler is not initialized. Please refresh or re-authenticate.')
        }
      } else if (authSource === 'passkey') {
        // Passkey (MSCA) handles execution natively in swapService
        if (!isArcNative && provider) {
          sourceAdapter = await createViemAdapter(provider)
        }
      } else {
        // Standard EOA wallet (MetaMask, etc.) requires an active provider
        if (!provider) {
          throw new Error('No crypto wallet provider found. Please connect your wallet.')
        }
        sourceAdapter = await createViemAdapter(provider)
      }

      const finalStatus = await executeSwap({
        fromChain,
        tokenIn,
        tokenOut,
        amountIn,
        sourceAdapter,
        senderAddress: connectedAddress,
        recipientAddress: effectiveRecipient,
        slippageTolerance,
        allowanceStrategy,
        speedTier,
        authSource,
        executeUcwContract,
        ...(platformFeeEnabled && {
          customFee: {
            percentageBps: platformFeeBps,
            recipientAddress: getSwapFeeRecipient(fromChain),
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
          recipient: effectiveRecipient,
          rate: rate
            ? `1 ${tokenIn} = ${rate} ${tokenOut}`
            : amountIn && estimatedOutput
            ? `1 ${tokenIn} ≈ ${(parseFloat(estimatedOutput) / parseFloat(amountIn)).toFixed(4)} ${tokenOut}`
            : undefined,
          slippage: `${(slippageTolerance * 100).toFixed(1)}%`,
          speedTier: speedTier.charAt(0).toUpperCase() + speedTier.slice(1),
          fee: platformFeeAmount ? `${platformFeeAmount} ${tokenIn}` : undefined,
        })

        updateBroadcast(broadcastId, {
          type: 'swap',
          title: 'Swap Completed Successfully',
          status: 'success',
          badgeText: 'Confirmed',
          details: {
            fromAmount: amountIn,
            fromSymbol: tokenIn,
            fromIcon: TOKEN_ICONS[tokenIn],
            fromChain: fromChain,
            toAmount: estimatedOutput,
            toSymbol: tokenOut,
            toIcon: TOKEN_ICONS[tokenOut],
            toChain: fromChain,
            network: fromChain,
            txHash: finalStatus.sourceTxHash,
          },
        })

        refetchWalletBalances()
        queryClient.invalidateQueries({ queryKey: ['onchainPoolState'] })
        queryClient.invalidateQueries({ queryKey: ['onchainPoolBalances'] })
        queryClient.invalidateQueries({ queryKey: ['userPoolPositions'] })
        redisCache.del('arcis:pools:state').catch(() => {})

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

        // Fix #8: replace the estimated output / placeholder gas with the values read from the
        // mined receipt (decoded SwapWithFee/Swapped event + gasUsed × effectiveGasPrice).
        void fetchSwapActuals(finalStatus.sourceTxHash || '', {
          amountIn,
          tokenIn,
          tokenOut,
          recipient: effectiveRecipient,
        }).then((actuals) => {
          if (!actuals.actualAmountOut && !actuals.networkFee) return
          setSuccessData((prev: any) =>
            prev
              ? {
                  ...prev,
                  amountOut: actuals.actualAmountOut ?? prev.amountOut,
                  networkFee: actuals.networkFee ?? prev.networkFee,
                }
              : prev
          )
        })
      } else if (finalStatus.status === 'PENDING') {
        // Fix #1: the transaction is on-chain but its receipt is not observable yet. This is NOT
        // a failure — record it as pending, tell the user not to resubmit, lock the form and poll
        // for confirmation in the background.
        const pendingHash = finalStatus.sourceTxHash || ''
        const pendingStage = finalStatus.pendingStage ?? 'swap'
        const pendingMessage =
          finalStatus.errorMessage || 'Swap submitted and awaiting on-chain confirmation. Please do not submit it again.'
        // An approval submitted without a hash cannot be polled and must not lock the form:
        // resubmitting re-reads the on-chain allowance and safely skips a landed approval.
        const lockForm = !(pendingStage === 'approve' && !pendingHash)

        setIsSwapping(false)
        if (lockForm) {
          setPendingSwap({
            txHash: pendingHash,
            stage: pendingStage,
            message: pendingMessage,
            broadcastId,
            payload: {
              amountIn,
              amountOut: estimatedOutput,
              tokenIn,
              tokenOut,
              recipient: effectiveRecipient,
            },
          })
          pendingPollCancelRef.current = false
        } else {
          setNotice(pendingMessage)
        }

        updateBroadcast(broadcastId, {
          type: 'swap',
          title:
            pendingStage === 'approve'
              ? 'Token Approval Submitted — Pending'
              : 'Swap Submitted — Confirmation Pending',
          status: 'pending',
          badgeText: pendingStage === 'approve' ? 'Approval' : 'Submitted',
          message: pendingMessage,
          details: {
            fromAmount: amountIn,
            fromSymbol: tokenIn,
            fromIcon: TOKEN_ICONS[tokenIn],
            fromChain: fromChain,
            toAmount: estimatedOutput,
            toSymbol: tokenOut,
            toIcon: TOKEN_ICONS[tokenOut],
            toChain: fromChain,
            network: fromChain,
            txHash: pendingHash,
          },
        })

        // Only a real swap broadcast belongs in the transaction history; an ERC-20 approval
        // confirmation must not be recorded (or later promoted) as a completed swap.
        if (pendingStage === 'swap') {
          addTransaction({
            type: 'swap',
            txHash: pendingHash,
            amount: amountIn,
            tokenSymbol: tokenIn,
            sourceChain: fromChain,
            recipient: effectiveRecipient,
            userAddress: connectedAddress,
            status: 'pending',
            amountIn,
            amountOut: estimatedOutput,
            tokenIn,
            tokenOut,
            isPrivate: isPrivateSwap,
          })
        }

        refetchWalletBalances()
        // Arc-native swaps settle on the chain we can poll directly; cross-chain confirmations are
        // left pending until the bridge completes so we never claim success prematurely.
        if (lockForm && isArcNativeSwap && pendingHash) {
          void confirmPendingSwap({
            txHash: pendingHash,
            stage: pendingStage,
            message: pendingMessage,
            broadcastId,
            payload: { amountIn, amountOut: estimatedOutput, tokenIn, tokenOut, recipient: effectiveRecipient },
          })
        }
      } else {
        const swapErr: any = new Error(finalStatus.errorMessage || 'Swap failed to complete.')
        if (finalStatus.isCanceled) {
          swapErr.isCanceled = true
          swapErr.code = 4001
        }
        throw swapErr
      }
    } catch (err: any) {
      console.error('[SwapModal] Execution error:', err)
      const normalized = normalizeAppError(err, fromChain)
      setError(normalized.message)
      setIsSwapping(false)

      const isCanceled = normalized.isCanceled || err?.isCanceled === true || err?.code === 4001
      setIsCanceledError(isCanceled)
      const status = isCanceled ? 'canceled' : 'failed'
      const title = isCanceled ? 'Swap Canceled' : normalized.title || 'Swap Failed'
      const badgeText = isCanceled ? 'Canceled' : 'Failed'

      updateBroadcast(broadcastId, {
        type: 'swap',
        title,
        status,
        badgeText,
        message: normalized.message,
        details: {
          fromAmount: amountIn,
          fromSymbol: tokenIn,
          fromIcon: TOKEN_ICONS[tokenIn],
          fromChain: fromChain,
          toAmount: estimatedOutput,
          toSymbol: tokenOut,
          toIcon: TOKEN_ICONS[tokenOut],
          toChain: fromChain,
          network: fromChain,
        },
      })
    }
  }

  // Quick percentage handler — always floors, and 100% maps to the gas-reserve-aware cap.
  const handleQuickPercentage = (pct: number) => {
    const calculated = computeQuickAmount(maxSpendable, pct, tokenInPlaces)
    if (calculated <= 0) return
    setAmountIn(calculated.toFixed(tokenInPlaces))
  }

  // Transaction breakdown items
  const breakdownItems: BreakdownItem[] = useMemo(() => {
    if (!estimatedOutput || !rate || isEstimating) return []

    const isArcNative = fromChain === 'Arc_Testnet'
    const lpPoolName = isArcNative
      ? tokenIn === 'cirBTC' || tokenOut === 'cirBTC'
        ? '(AMM LP Pool)'
        : '(StableSwap LP)'
      : '(AppKit Route)'

    // Liquidity Provider fee calculation: show amount instead of percentage next to pool name
    const lpQuoteFee = quoteFees.find((f) => f.type === 'swap' || f.type === 'provider')
    const parsedAmtIn = parseFloat(amountIn)
    const platFeeVal = rawPlatformFeeNum || 0
    const netSwapAmtIn = Math.max(0, (isNaN(parsedAmtIn) ? 0 : parsedAmtIn) - platFeeVal)
    // Pool LP fees come from the shared pool constants (audit #14) so the breakdown can never
    // drift from the deployed contracts.
    const lpBps = isArcNative
      ? tokenIn === 'cirBTC' || tokenOut === 'cirBTC'
        ? Number(CONSTANT_PRODUCT_LP_FEE_BPS)
        : Number(STABLE_SWAP_LP_FEE_BPS)
      : 2
    const fallbackLpFeeNum = (netSwapAmtIn * lpBps) / 10000
    const lpFeeNum = lpQuoteFee ? parseFloat(lpQuoteFee.amount) : fallbackLpFeeNum

    let lpFeeFormatted = '0.00'
    if (lpFeeNum > 0) {
      if (tokenIn === 'cirBTC') {
        lpFeeFormatted = lpFeeNum < 0.000001 ? '< 0.000001' : parseFloat(lpFeeNum.toFixed(6)).toString()
      } else if (lpFeeNum < 0.01) {
        lpFeeFormatted = lpFeeNum < 0.0001 ? '< 0.0001' : parseFloat(lpFeeNum.toFixed(4)).toString()
      } else {
        lpFeeFormatted = formatFeeDecimals(lpFeeNum, 2)
      }
    }

    const lpFeeDisplay = `${lpFeeFormatted} ${tokenIn} ${lpPoolName}`

    const routeName =
      tokenIn === 'cirBTC' || tokenOut === 'cirBTC' ? 'Arcis AMM Pool' : 'Arcis StableSwap'

    const tierConfig = SPEED_TIERS[speedTier] || SPEED_TIERS.fast

    const executionTimeValue =
      tierConfig.timeEstimate.swap === 'Instant'
        ? '< 500 ms (Instant)'
        : `${tierConfig.timeEstimate.swap} (${tierConfig.label})`

    const networkFeeValue =
      fromChain === 'Arc_Testnet'
        ? `~${tierConfig.arcGas?.estimatedCostUsdc || '0.00053'} USDC`
        : '< 0.001 ETH'

    const items: BreakdownItem[] = [
      {
        label: 'Exchange Rate',
        tooltip: 'The current market conversion rate between the selected token pair.',
        value: `1 ${tokenIn} = ${rate} ${tokenOut}`,
      },
      {
        label: 'Min. Received',
        tooltip: 'The guaranteed minimum amount you will receive after maximum slippage tolerance.',
        value: `${stopLimit} ${tokenOut}`,
        highlight: true,
        highlightColor: 'text-indigo-400',
      },
      {
        label: 'Slippage Tolerance',
        tooltip: 'The maximum price difference tolerated before the transaction automatically reverts.',
        value: `${(slippageTolerance * 100).toFixed(1)}%`,
      },
      {
        label: 'Network Fee',
        tooltip: 'Estimated smart contract execution gas fee paid natively in USDC on Arc.',
        value: networkFeeValue,
      },
      {
        label: 'Liquidity Provider Fee',
        tooltip: 'Fee rewarded directly to liquidity pool providers supporting this trade.',
        value: lpFeeDisplay,
      },
      {
        label: 'Platform Fee',
        tooltip: 'Arcis Treasury protocol fee for routing and multi-token liquidity indexing.',
        value: (() => {
          const devQuoteFee = quoteFees.find((f) => f.type === 'developer')
          const displayedPlatformFeeAmount = devQuoteFee
            ? formatFeeDecimals(parseFloat(devQuoteFee.amount), 2)
            : platformFeeAmount
          return platformFeeEnabled && displayedPlatformFeeAmount
            ? `${displayedPlatformFeeAmount} ${tokenIn} (${platformFeePercent})`
            : '0.00 USDC (Free)'
        })(),
      },
      {
        label: 'Execution Time',
        tooltip: 'Estimated duration to execute and finalize the swap transaction onchain based on selected speed tier.',
        value: executionTimeValue,
      },
    ]

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
    rawPlatformFeeNum,
    amountIn,
    quoteFees,
    fromChain,
    speedTier,
  ])

  // Dynamic Button State
  const ctaButtonState = useMemo(() => {
    if (!connectedAddress) {
      return { disabled: true, text: 'CONNECT WALLET', loading: false }
    }
    if (pendingSwap) {
      // Re-submission lock while a previously broadcast swap awaits its receipt.
      return { disabled: true, text: 'SWAP CONFIRMATION PENDING...', loading: true }
    }
    if (!amountIn || parseFloat(amountIn) <= 0) {
      return { disabled: true, text: 'ENTER AN AMOUNT', loading: false }
    }
    if (authSource === 'ucw' && fromChain !== 'Arc_Testnet') {
      return { disabled: true, text: 'SWAP ONLY AVAILABLE ON ARC', loading: false }
    }
    if (tokenIn === tokenOut) {
      return { disabled: true, text: 'SELECT DIFFERENT TOKENS', loading: false }
    }
    if (isInsufficient) {
      return {
        disabled: true,
        text: isShortOnlyByGasBuffer
          ? `KEEP ${ARC_GAS_BUFFER_USDC} USDC FOR GAS`
          : `INSUFFICIENT ${tokenIn} BALANCE`,
        loading: false,
      }
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
        text: 'SWAPPING TOKENS...',
        loading: true,
      }
    }
    return {
      disabled: false,
      text: 'SWAP TOKENS',
      loading: false,
      icon: <ArrowRightLeft className="w-4 h-4" />,
    }
  }, [
    connectedAddress,
    pendingSwap,
    amountIn,
    tokenIn,
    tokenOut,
    fromChain,
    authSource,
    isInsufficient,
    isShortOnlyByGasBuffer,
    isEstimating,
    estimateError,
    useCustomRecipient,
    customRecipient,
    recipientIsOwnAddress,
    isSwapping,
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
      <Tooltip content="Slippage and speed settings" position="bottom" align="end">
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${
            showSettings
              ? 'text-white bg-indigo-500/25 border border-indigo-500/40 shadow-sm'
              : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06]'
          }`}
        >
          <Settings className="w-4 h-4" />
        </button>
      </Tooltip>

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
          toChain={fromChain}
          txHash={successData.txHash}
          destTxHash={successData.destTxHash}
          explorerUrl={getExplorerTxUrl(fromChain, successData.txHash)}
          isInline={isInline}
          recipient={successData.recipient}
          rate={successData.rate}
          slippage={successData.slippage}
          speedTier={successData.speedTier}
          fee={successData.fee}
          networkFee={successData.networkFee}
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
          {/* Error / Rejection Alert */}
          {error && (
            <div
              className={`p-3 rounded-2xl border text-xs flex items-center gap-2.5 animate-fade-in ${
                isCanceledError
                  ? 'bg-amber-500/10 border-amber-500/25 text-amber-300/90'
                  : 'bg-rose-500/10 border-rose-500/25 text-rose-400'
              }`}
            >
              {isCanceledError ? (
                <Ban className="w-4 h-4 shrink-0 text-amber-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              )}
              <span className="flex-1 leading-relaxed">{error}</span>
            </div>
          )}

          {/* Submitted Swap Awaiting Confirmation (fix #1) */}
          {pendingSwap && (
            <div className="p-3 rounded-2xl border text-xs flex items-start gap-2.5 bg-indigo-500/10 border-indigo-500/25 text-indigo-200 animate-fade-in">
              <Clock className="w-4 h-4 shrink-0 mt-0.5 text-indigo-300" />
              <span className="flex-1 leading-relaxed">
                {pendingSwap.message}
                {pendingSwap.txHash && (
                  <span className="block mt-1 font-mono text-[10px] text-indigo-300/80">
                    {pendingSwap.txHash.slice(0, 18)}…{pendingSwap.txHash.slice(-6)}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => {
                  pendingPollCancelRef.current = true
                  setPendingSwap(null)
                }}
                className="shrink-0 text-[11px] text-indigo-300 hover:text-indigo-200 underline underline-offset-2 cursor-pointer transition-colors"
                title="Only dismiss if you are certain the transaction was never broadcast."
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Non-blocking follow-up notice */}
          {notice && (
            <div className="p-3 rounded-2xl border text-xs flex items-start gap-2.5 bg-emerald-500/10 border-emerald-500/25 text-emerald-300 animate-fade-in">
              <Clock className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
              <span className="flex-1 leading-relaxed">{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="shrink-0 text-[11px] text-emerald-300 hover:text-emerald-200 underline underline-offset-2 cursor-pointer transition-colors"
              >
                Dismiss
              </button>
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
              onMaxClick={() => setAmountIn(maxSpendable.toFixed(tokenInPlaces))}
              maxDecimals={tokenIn === 'cirBTC' ? 8 : 6}
              quickPercentages={[25, 50, 75, 100]}
              onSelectPercentage={handleQuickPercentage}
              fiatEstimate={formatFiatEstimate(amountIn, tokenIn, tokenPrices)}
              disabled={isSwapping || !!pendingSwap}
              error={isInsufficient}
            />

            {/* Switch Direction Invert Button */}
            <DirectionSwitchButton
              onClick={handleSwitchDirection}
              disabled={isSwapping || !!pendingSwap}
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
              fiatEstimate={formatFiatEstimate(estimatedOutput, tokenOut, tokenPrices)}
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

                {isArcNativeSwap && (
                  <p className="text-[10px] text-amber-400/90 leading-relaxed flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                    <span>
                      Arc Testnet pool swaps deliver the output to the connected wallet (the on-chain router has no
                      recipient parameter), so a custom recipient will be rejected.
                    </span>
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Live Quote & Fee Breakdown Accordion */}
          {breakdownItems.length > 0 && (
            <TransactionBreakdown
              summaryTitle="Swap Breakdown"
              items={breakdownItems}
              defaultOpen={false}
              context="swap"
              showItemIcons={false}
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
        chains={availableSwapChains}
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
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-[12px] font-semibold tracking-wide text-slate-300 ml-3">
                    <span style={{ fontFamily: 'var(--font-app)' }}>SLIPPAGE TOLERANCE</span>
                  </div>
                  <span className="text-xs text-indigo-400 font-semibold font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 mr-3">
                    {(slippageTolerance * 100).toFixed(1)}%
                  </span>
                </div>

                <div
                  className="p-2 rounded-2xl mt-2 space-y-2"
                >
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
              </div>

              {/* Speed Priority Section */}
              <div className="space-y-2 pt-1">
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
