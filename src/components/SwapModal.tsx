import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useClearOnWalletDisconnect } from '../hooks/useClearOnWalletDisconnect'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { useMultiChainWallet } from '../hooks/useMultiChainWallet'
import { useWalletSettings } from '../hooks/useWalletSettings'
import {
  X,
  ArrowRightLeft,
  Settings,
  ChevronDown,
} from 'lucide-react'
import { PinnedNetworkIcon } from './common/PinnedIcons'
import { ChainIcon } from './common/ChainIcon'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CirBtcIcon from '../assets/Token-Icon/cirBTC Token.svg'
import { normalizeAppError } from '../utils/errorNormalizer'
import { useQueryClient } from '@tanstack/react-query'
import { redisCache } from '../services/redisCacheService'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { createViemAdapter } from '../services/sendService'
import { getSwapEstimate, executeSwap, getSupportedSwapChains } from '../services/swapService'
import { addTransaction } from '../utils/history'
import { getArcPublicClient, getResilientPublicClient } from '../services/rpc'
import {
  floorToPlaces,
  computeMaxSpendable,
  computeQuickAmount,
  ARC_GAS_BUFFER_USDC,
} from '../utils/swapAmountUtils'
import { PrivacyLockButton } from './privacy/PrivacyLockButton'
import { useBroadcast } from './BroadcastNotification'
import { type SpeedTier } from '../config/feeTiers'
import {
  getSwapFeeRecipient,
  SWAP_CUSTOM_FEE_CONFIG,
} from '../config/treasuryConfig'
import { WethIcon } from '../config/tokenIcons'
import {
  poolSlippageBps,
  POOL_MAX_SLIPPAGE_BPS,
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
  RecipientAddressField,
  SwapPriceChartCard,
  type TokenItem,
  type BreakdownItem,
} from './fintech'
import { useLiveTokenPrices, formatFiatEstimate } from '../hooks/useLiveTokenPrices'
import { Tooltip } from './common/Tooltip'
import { saveRecipient } from '../utils/recentRecipients'
import { logger } from '../utils/logger'
import { SwapSettingsModal, SwapAlerts, type PendingSwapState } from './swap'
import { buildSwapBreakdown, fetchSwapActuals } from '../services/swap'

/** Scoped logger: skipped best-effort work must be traceable without raw console noise. */
const log = logger.createScope('SwapModal')

const TOKEN_ICONS: Record<string, string> = {
  USDC: UsdcIcon,
  EURC: EurcIcon,
  cirBTC: CirBtcIcon,
  BTC: CirBtcIcon,
  WETH: WethIcon,
  ETH: WethIcon,
}

interface SwapModalProps {
  isOpen: boolean
  isInline?: boolean
  onClose: () => void
  connectedAddress: string
  provider: any
  currentChainId: number
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  initialChainKey?: string
  initialChainNonce?: number
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
  initialChainKey,
  initialChainNonce,
  executeUcwContract,
  onSuccess,
}: SwapModalProps) {
  const { addBroadcast, updateBroadcast } = useBroadcast()
  const { solana, injective } = useMultiChainWallet()
  const queryClient = useQueryClient()
  const [isPrivateSwap, setIsPrivateSwap] = useState(false)

  // Dynamic Chain Selector
  const [selectedChain, setSelectedChain] = useState(initialChainKey || 'Arc_Testnet')
  const [showChainModal, setShowChainModal] = useState(false)

  // Sync selectedChain when initialChainKey updates (e.g. from Portfolio quick action)
  useEffect(() => {
    if (initialChainKey) {
      if (authSource === 'ucw' && initialChainKey !== 'Arc_Testnet') {
        setSelectedChain('Arc_Testnet')
      } else {
        setSelectedChain(initialChainKey)
      }
    }
  }, [initialChainKey, initialChainNonce, authSource])

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
  const isArcNativeSwap = fromChain === 'Arc_Testnet'

  const [tokenIn, setTokenIn] = useState('USDC')
  const [tokenOut, setTokenOut] = useState('EURC')
  const [amountIn, setAmountIn] = useState('')
  const [allowanceStrategy] = useState<'permit' | 'approve'>('permit')

  // Wallet-scoped transaction settings (isolated per connected wallet)
  const { settings: walletSettings, updateSettings: updateWalletSettings } = useWalletSettings(connectedAddress)

  // Settings & Slippage
  const [showSettings, setShowSettings] = useState(false)
  const [selectedSlippageType, setSelectedSlippageType] = useState<'0.1' | '0.5' | '1.0' | 'custom'>(
    walletSettings.swapSlippageType
  )

  useBodyScrollLock(showSettings || (!isInline && isOpen))
  const lastPresetSlippageRef = useRef<'0.1' | '0.5' | '1.0'>(
    walletSettings.swapSlippageType === 'custom' ? '0.5' : walletSettings.swapSlippageType
  )
  const [customSlippage, setCustomSlippage] = useState(walletSettings.swapCustomSlippage || '')

  // Speed & Network Execution Priority
  const [speedTier, setSpeedTier] = useState<SpeedTier>(walletSettings.swapSpeedTier)

  // Sync state whenever wallet settings change (e.g. user connects another wallet)
  useEffect(() => {
    setSelectedSlippageType(walletSettings.swapSlippageType)
    if (walletSettings.swapSlippageType !== 'custom') {
      lastPresetSlippageRef.current = walletSettings.swapSlippageType
    }
    setCustomSlippage(walletSettings.swapCustomSlippage || '')
    setSpeedTier(walletSettings.swapSpeedTier)
  }, [walletSettings.swapSlippageType, walletSettings.swapCustomSlippage, walletSettings.swapSpeedTier])

  const handleSpeedTierChange = useCallback(
    (tier: SpeedTier) => {
      setSpeedTier(tier)
      updateWalletSettings({ swapSpeedTier: tier })
    },
    [updateWalletSettings]
  )

  const handleSlippagePreset = (type: '0.1' | '0.5' | '1.0') => {
    lastPresetSlippageRef.current = type
    setSelectedSlippageType(type)
    setCustomSlippage('')
    updateWalletSettings({ swapSlippageType: type, swapCustomSlippage: '' })
  }

  const handleToggleCustomSlippage = () => {
    if (selectedSlippageType === 'custom') {
      setSelectedSlippageType(lastPresetSlippageRef.current)
      setCustomSlippage('')
      updateWalletSettings({ swapSlippageType: lastPresetSlippageRef.current, swapCustomSlippage: '' })
    } else {
      setSelectedSlippageType('custom')
      updateWalletSettings({ swapSlippageType: 'custom' })
    }
  }

  const handleCustomSlippageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomSlippage(e.target.value)
    updateWalletSettings({ swapCustomSlippage: e.target.value, swapSlippageType: 'custom' })
  }

  // Recipient Address (Matching BridgeModal exactly)
  const [recipient, setRecipient] = useState('')

  // Swap Execution States
  const [isSwapping, setIsSwapping] = useState(false)
  const [successData, setSuccessData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCanceledError, setIsCanceledError] = useState(false)
  const [pendingSwap, setPendingSwap] = useState<PendingSwapState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const pendingConfirmRef = useRef(false)
  const pendingPollCancelRef = useRef(false)
  const quoteSeqRef = useRef(0)

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
    setRecipient('')
    setStopLimit('')
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

  // Slippage tolerance calculation
  const slippageTolerance = useMemo(() => {
    const percent =
      selectedSlippageType === 'custom' ? parseFloat(customSlippage) : parseFloat(selectedSlippageType)
    return poolSlippageBps(percent) / 10000
  }, [selectedSlippageType, customSlippage])

  const isHighSlippageWarning =
    selectedSlippageType === 'custom' && parseFloat(customSlippage) > (POOL_MAX_SLIPPAGE_BPS / 100) * 0.75

  // Treasury Platform Fee from SWAP_CUSTOM_FEE_CONFIG
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
      if (tokenIn === 'cirBTC' || tokenIn === 'WETH') {
        return parseFloat(rawPlatformFeeNum.toFixed(6)).toString()
      }
      return '< 0.01'
    }
    return formatFeeDecimals(rawPlatformFeeNum, 2)
  }, [rawPlatformFeeNum, tokenIn])

  // Address Validation
  const isValidEvmAddress = (addr: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(addr)
  const isValidSolanaAddress = (addr: string): boolean =>
    !addr.startsWith('0x') && addr.length >= 32 && addr.length <= 44
  const isValidInjectiveAddress = (addr: string): boolean =>
    addr.startsWith('inj1') && addr.length >= 38

  const isDestSolana = selectedChain.toLowerCase().includes('solana')
  const isDestInjective = selectedChain.toLowerCase().includes('injective')

  const recipientIsValid = useMemo(() => {
    if (!recipient) return false
    if (isDestSolana) return isValidSolanaAddress(recipient)
    if (isDestInjective) return isValidInjectiveAddress(recipient)
    return isValidEvmAddress(recipient)
  }, [recipient, isDestSolana, isDestInjective])

  const supportedChains = useMemo(() => getSupportedSwapChains(), [])

  // When UCW wallet is connected: Arc Testnet is prioritized at the top and selected
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
      // Note: speedTier, selectedSlippageType, and customSlippage are persisted in
      // walletSettings (localStorage) and must not be reset on modal open/mount.
      setRecipient('')
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

  // Load wallet balances
  const { walletBalances, refetch: refetchWalletBalances } = useWalletTestnetBalances(connectedAddress)
  const usdcWalletBalance = walletBalances[fromChain]?.usdc || '0.00'
  const eurcWalletBalance = walletBalances[fromChain]?.eurc || '0.00'
  const cirbtcWalletBalance = walletBalances[fromChain]?.cirbtc || '0.00000'
  const wethWalletBalance = walletBalances[fromChain]?.weth || '0.0000'

  // Dynamic balance for selected tokenIn
  const tokenInBalance = useMemo(() => {
    if (!connectedAddress) return tokenIn === 'cirBTC' ? '0.00000' : tokenIn === 'WETH' ? '0.0000' : '0.00'
    if (tokenIn === 'USDC') return usdcWalletBalance
    if (tokenIn === 'EURC') return eurcWalletBalance
    if (tokenIn === 'cirBTC') return cirbtcWalletBalance
    if (tokenIn === 'WETH') return wethWalletBalance
    return '0.00'
  }, [connectedAddress, tokenIn, usdcWalletBalance, eurcWalletBalance, cirbtcWalletBalance, wethWalletBalance])

  const tokenOutBalance = useMemo(() => {
    if (!connectedAddress) return tokenOut === 'cirBTC' ? '0.00000' : tokenOut === 'WETH' ? '0.0000' : '0.00'
    if (tokenOut === 'USDC') return usdcWalletBalance
    if (tokenOut === 'EURC') return eurcWalletBalance
    if (tokenOut === 'cirBTC') return cirbtcWalletBalance
    if (tokenOut === 'WETH') return wethWalletBalance
    return '0.00'
  }, [connectedAddress, tokenOut, usdcWalletBalance, eurcWalletBalance, cirbtcWalletBalance, wethWalletBalance])

  const tokenInPlaces = tokenIn === 'cirBTC' ? 5 : tokenIn === 'WETH' ? 4 : 2
  const reservesGasBuffer = fromChain === 'Arc_Testnet' && tokenIn === 'USDC' && authSource !== 'passkey'

  const flooredBalance = floorToPlaces(parseFloat(tokenInBalance), tokenInPlaces)
  const maxSpendable = computeMaxSpendable(tokenInBalance, tokenInPlaces, reservesGasBuffer)

  const amountInNum = parseFloat(amountIn)
  const isInsufficient = amountIn ? amountInNum > maxSpendable + 1e-9 : false
  const isShortOnlyByGasBuffer =
    reservesGasBuffer && isInsufficient && amountInNum <= flooredBalance + 1e-9

  // Token list for selector modal
  const tokenList: TokenItem[] = useMemo(
    () => [
      { symbol: 'USDC', name: 'USD Coin', icon: TOKEN_ICONS.USDC, balance: usdcWalletBalance },
      { symbol: 'EURC', name: 'Euro Coin', icon: TOKEN_ICONS.EURC, balance: eurcWalletBalance },
      { symbol: 'cirBTC', name: 'Circle Bitcoin', icon: TOKEN_ICONS.cirBTC, balance: cirbtcWalletBalance },
      { symbol: 'WETH', name: 'Wrapped Ether', icon: TOKEN_ICONS.WETH, balance: wethWalletBalance },
    ],
    [usdcWalletBalance, eurcWalletBalance, cirbtcWalletBalance, wethWalletBalance]
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

    let isMounted = true
    const seq = ++quoteSeqRef.current
    const isCurrent = () => isMounted && quoteSeqRef.current === seq
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
          recipientAddress: recipient || connectedAddress,
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
        if (isCurrent()) {
          setEstimatedOutput(quote.estimatedOutput)
          setStopLimit(quote.stopLimit)
          setRate(quote.rate)
          setQuoteFees(quote.fees || [])
          setIsEstimating(false)
        }
      } catch (err: any) {
        log.error('[Swap Quote Error]', err)
        if (isCurrent()) {
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
    recipient,
    connectedAddress,
  ])

  // Background receipt poller for a submitted-but-unconfirmed swap
  const confirmPendingSwap = useCallback(async (pending: NonNullable<typeof pendingSwap>) => {
    const txHash = pending.txHash
    if (!txHash || pendingConfirmRef.current) return
    pendingConfirmRef.current = true
    pendingPollCancelRef.current = false
    try {
      const client = fromChain === 'Arc_Testnet' ? getArcPublicClient() : getResilientPublicClient(fromChain)
      for (let attempt = 0; attempt < 40; attempt++) {
        if (pendingPollCancelRef.current) return
        await new Promise((resolve) => setTimeout(resolve, 3000))
        let receipt: any = null
        try {
          receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` })
        } catch {
          continue
        }

        if (receipt?.status === 'success') {
          const p = pending.payload
          setPendingSwap(null)
          setIsSwapping(false)

          if (pending.stage === 'approve') {
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
            fee: platformFeeAmount ? `${platformFeeAmount} ${p.tokenIn} (${platformFeePercent})` : undefined,
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
          redisCache.del('arcis:pools:state').catch((err) => {
            log.debug('Pool state cache could not be invalidated after the swap:', err)
          })
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

          void fetchSwapActuals(txHash, p, isArcNativeSwap).then((actuals) => {
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
    } catch (pollErr) {
      log.warn('[SwapModal] Pending swap confirmation poll error:', pollErr)
    } finally {
      pendingConfirmRef.current = false
    }
  }, [
    fromChain,
    connectedAddress,
    isPrivateSwap,
    isArcNativeSwap,
    rate,
    slippageTolerance,
    speedTier,
    platformFeeAmount,
    platformFeePercent,
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

    const targetRecipient = recipient.trim()
    if (!targetRecipient) {
      setError('Please enter a recipient address')
      return
    }

    if (!recipientIsValid) {
      if (isDestSolana) {
        setError('Please enter a valid Solana recipient address (Base58)')
      } else if (isDestInjective) {
        setError('Please enter a valid Injective recipient address (inj1...)')
      } else {
        setError('Please enter a valid EVM recipient address (0x...)')
      }
      return
    }

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
        if (!isArcNative && provider) {
          sourceAdapter = await createViemAdapter(provider)
        }
      } else {
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
        recipientAddress: targetRecipient,
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
          recipient: targetRecipient,
          rate: rate
            ? `1 ${tokenIn} = ${rate} ${tokenOut}`
            : amountIn && estimatedOutput
            ? `1 ${tokenIn} ≈ ${(parseFloat(estimatedOutput) / parseFloat(amountIn)).toFixed(4)} ${tokenOut}`
            : undefined,
          slippage: `${(slippageTolerance * 100).toFixed(1)}%`,
          speedTier: speedTier.charAt(0).toUpperCase() + speedTier.slice(1),
          fee: platformFeeAmount ? `${platformFeeAmount} ${tokenIn} (${platformFeePercent})` : undefined,
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
        redisCache.del('arcis:pools:state').catch((err) => {
          log.debug('Pool state cache could not be invalidated after the swap:', err)
        })

        addTransaction({
          type: 'swap',
          txHash: finalStatus.sourceTxHash || '',
          amount: amountIn,
          tokenSymbol: tokenIn,
          sourceChain: fromChain,
          recipient: targetRecipient,
          userAddress: connectedAddress,
          status: 'success',
          amountIn,
          amountOut: estimatedOutput,
          tokenIn,
          tokenOut,
          isPrivate: isPrivateSwap,
        })

        onSuccess(amountIn, estimatedOutput, tokenIn, tokenOut, finalStatus.sourceTxHash || '')

        void fetchSwapActuals(finalStatus.sourceTxHash || '', {
          amountIn,
          tokenIn,
          tokenOut,
          recipient: targetRecipient,
        }, isArcNativeSwap).then((actuals) => {
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
        const pendingHash = finalStatus.sourceTxHash || ''
        const pendingStage = finalStatus.pendingStage ?? 'swap'
        const pendingMessage =
          finalStatus.errorMessage || 'Swap submitted and awaiting on-chain confirmation. Please do not submit it again.'
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
              recipient: targetRecipient,
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

        if (pendingStage === 'swap') {
          addTransaction({
            type: 'swap',
            txHash: pendingHash,
            amount: amountIn,
            tokenSymbol: tokenIn,
            sourceChain: fromChain,
            recipient: targetRecipient,
            userAddress: connectedAddress,
            status: 'pending',
            amountIn,
            amountOut: estimatedOutput,
            tokenIn,
            tokenOut,
            isPrivate: isPrivateSwap,
          })
          if (targetRecipient) {
            saveRecipient({
              address: targetRecipient,
              chainFamily: isDestSolana ? 'solana' : isDestInjective ? 'injective' : 'evm',
              sourceChain: fromChain,
            })
          }
        }

        refetchWalletBalances()
        if (lockForm && isArcNativeSwap && pendingHash) {
          void confirmPendingSwap({
            txHash: pendingHash,
            stage: pendingStage,
            message: pendingMessage,
            broadcastId,
            payload: { amountIn, amountOut: estimatedOutput, tokenIn, tokenOut, recipient: targetRecipient },
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
      log.error('[SwapModal] Execution error:', err)
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

  // Quick percentage handler
  const handleQuickPercentage = (pct: number) => {
    const calculated = computeQuickAmount(maxSpendable, pct, tokenInPlaces)
    if (calculated <= 0) return
    setAmountIn(calculated.toFixed(tokenInPlaces))
  }

  // Transaction breakdown items
  const breakdownItems: BreakdownItem[] = useMemo(() => {
    return buildSwapBreakdown({
      estimatedOutput,
      rate,
      isEstimating,
      fromChain,
      tokenIn,
      tokenOut,
      stopLimit,
      slippageTolerance,
      amountIn,
      quoteFees,
      rawPlatformFeeNum,
      platformFeeEnabled,
      platformFeeAmount,
      platformFeePercent,
      speedTier,
    })
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
    if (!recipient) {
      return { disabled: true, text: 'ENTER RECIPIENT ADDRESS', loading: false }
    }
    if (!recipientIsValid) {
      return { disabled: true, text: 'INVALID RECIPIENT ADDRESS', loading: false }
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
    recipient,
    recipientIsValid,
    isSwapping,
  ])

  if (!isOpen && !isInline) return null

  // Quick fill recipient badges (Matching BridgeModal exactly)
  const recipientBadge = (
    <div className="flex items-center gap-1.5">
      {isDestSolana && solana.isConnected && solana.address && (
        <button
          type="button"
          onClick={() => {
            setRecipient(solana.address)
            setError(null)
          }}
          className="text-[10px] text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 cursor-pointer transition select-none"
        >
          <PinnedNetworkIcon name="solana" size={11} variant="branded" />
          <span>Solana ({solana.address.slice(0, 4)}...{solana.address.slice(-4)})</span>
        </button>
      )}

      {isDestInjective && injective.isConnected && injective.address && (
        <button
          type="button"
          onClick={() => {
            setRecipient(injective.address)
            setError(null)
          }}
          className="text-[10px] text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 cursor-pointer transition select-none"
        >
          <PinnedNetworkIcon name="injective" size={11} variant="branded" />
          <span>Injective ({injective.address.slice(0, 6)}...{injective.address.slice(-4)})</span>
        </button>
      )}

      {!isDestSolana && !isDestInjective && connectedAddress && !recipient && (
        <button
          type="button"
          onClick={() => {
            setRecipient(connectedAddress)
            setError(null)
          }}
          className="text-[10px] text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 cursor-pointer transition select-none"
        >
          <span>Use Connected Wallet</span>
        </button>
      )}
    </div>
  )

  // Header Actions (Network Selector Pill + Privacy + Settings + Close)
  const headerActions = (
    <>
      <button
        type="button"
        disabled={isSwapping || !!successData}
        onClick={() => setShowChainModal(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/[0.16] text-xs font-medium text-slate-200 transition-all cursor-pointer select-none"
      >
        <div className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center shrink-0">
          <ChainIcon
            chainKeyOrIconId={selectedChain}
            name={selectedChain}
            size={16}
            className="rounded-full"
          />
        </div>
        <span className="truncate max-w-[100px]">{selectedChain.replace(/_/g, ' ')}</span>
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>

      <PrivacyLockButton
        isPrivate={isPrivateSwap}
        onToggle={() => setIsPrivateSwap((prev) => !prev)}
        disabled={isSwapping || !!successData}
        size="md"
      />

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
      minHeight={isInline ? (successData ? 'auto' : 680) : undefined}
      headerActions={headerActions}
    >
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
          connectedAddress={connectedAddress}
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
          <SwapAlerts
            error={error}
            isCanceledError={isCanceledError}
            pendingSwap={pendingSwap}
            onDismissPending={() => {
              pendingPollCancelRef.current = true
              setPendingSwap(null)
            }}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
            estimateError={estimateError}
          />

          {/* Asset Panels Stack */}
          <div className="relative flex flex-col gap-2.5 sm:gap-3.5">
            <AssetInputPanel
              label="YOU PAY"
              amount={amountIn}
              onAmountChange={(val) => setAmountIn(val)}
              tokenSymbol={tokenIn}
              tokenIcon={TOKEN_ICONS[tokenIn]}
              onSelectToken={() => setShowTokenInModal(true)}
              balance={tokenInBalance}
              onMaxClick={() => setAmountIn(maxSpendable.toFixed(tokenInPlaces))}
              maxDecimals={tokenIn === 'cirBTC' ? 8 : (tokenIn === 'WETH' ? 18 : 6)}
              quickPercentages={[25, 50, 75, 100]}
              onSelectPercentage={handleQuickPercentage}
              fiatEstimate={formatFiatEstimate(amountIn, tokenIn, tokenPrices)}
              disabled={isSwapping || !!pendingSwap}
              error={isInsufficient}
            />

            <DirectionSwitchButton
              onClick={handleSwitchDirection}
              disabled={isSwapping || !!pendingSwap}
            />

            <AssetInputPanel
              label="YOU RECEIVE"
              amount={estimatedOutput}
              readOnly={true}
              placeholder={tokenOut === 'cirBTC' ? '0.00000' : (tokenOut === 'WETH' ? '0.0000' : '0.00')}
              tokenSymbol={tokenOut}
              tokenIcon={TOKEN_ICONS[tokenOut]}
              onSelectToken={() => setShowTokenOutModal(true)}
              balance={tokenOutBalance}
              isLoading={isEstimating}
              fiatEstimate={formatFiatEstimate(estimatedOutput, tokenOut, tokenPrices)}
              disabled={isSwapping}
            />
          </div>

          <RecipientAddressField
            value={recipient}
            onChange={(val) => {
              setRecipient(val)
              setError(null)
              setIsCanceledError(false)
            }}
            label="RECIPIENT ADDRESS"
            placeholder={
              isDestSolana
                ? '9WzD....'
                : isDestInjective
                ? 'inj1....'
                : '0x....'
            }
            isValid={recipientIsValid}
            disabled={isSwapping || !!pendingSwap}
            rightBadge={recipientBadge}
            chainFamily={isDestSolana ? 'solana' : isDestInjective ? 'injective' : 'evm'}
            connectedAddress={connectedAddress}
          />

          {breakdownItems.length > 0 && (
            <TransactionBreakdown
              summaryTitle="Swap Breakdown"
              items={breakdownItems}
              defaultOpen={false}
              context="swap"
              showItemIcons={false}
            />
          )}

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

      <TokenSelectorModal
        isOpen={showTokenInModal}
        onClose={() => setShowTokenInModal(false)}
        tokens={tokenList}
        selectedToken={tokenIn}
        onSelectToken={(sym) => {
          setTokenIn(sym)
          if (sym === tokenOut) {
            const others = ['USDC', 'EURC', 'cirBTC', 'WETH'].filter((t) => t !== sym)
            setTokenOut(others[0])
          }
        }}
        title="Pay with"
      />

      <TokenSelectorModal
        isOpen={showTokenOutModal}
        onClose={() => setShowTokenOutModal(false)}
        tokens={tokenList}
        selectedToken={tokenOut}
        onSelectToken={(sym) => {
          setTokenOut(sym)
          if (sym === tokenIn) {
            const others = ['USDC', 'EURC', 'cirBTC', 'WETH'].filter((t) => t !== sym)
            setTokenIn(others[0])
          }
        }}
        title="Receive"
      />

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

  const settingsModalWindow = (
    <SwapSettingsModal
      isOpen={showSettings}
      onClose={() => setShowSettings(false)}
      slippageTolerance={slippageTolerance}
      selectedSlippageType={selectedSlippageType}
      customSlippage={customSlippage}
      isHighSlippageWarning={isHighSlippageWarning}
      onSelectPreset={handleSlippagePreset}
      onToggleCustom={handleToggleCustomSlippage}
      onChangeCustom={handleCustomSlippageChange}
      speedTier={speedTier}
      onSelectTier={handleSpeedTierChange}
      onSave={() => {
        updateWalletSettings({
          swapSlippageType: selectedSlippageType,
          swapCustomSlippage: customSlippage,
          swapSpeedTier: speedTier,
        })
        setShowSettings(false)
      }}
      disabled={isSwapping}
    />
  )

  if (isInline) {
    return (
      <>
        <div className="flex flex-col xl:flex-row items-center xl:items-start justify-center gap-6 w-full max-w-7xl mx-auto px-2 sm:px-4">
          <SwapPriceChartCard
            tokenIn={tokenIn}
            tokenOut={tokenOut}
            isInline={isInline}
          />
          {content}
        </div>
        {settingsModalWindow}
      </>
    )
  }

  if (!isOpen) return null

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overflow-y-auto overscroll-contain touch-none">
        <div className="flex flex-col xl:flex-row items-center xl:items-start justify-center gap-6 w-full max-w-7xl mx-auto my-auto py-4">
          <SwapPriceChartCard
            tokenIn={tokenIn}
            tokenOut={tokenOut}
            isInline={false}
          />
          {content}
        </div>
      </div>
      {settingsModalWindow}
    </>
  )
}
