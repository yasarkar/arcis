import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useClearOnWalletDisconnect } from '../hooks/useClearOnWalletDisconnect'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { useWalletSettings } from '../hooks/useWalletSettings'
import {
  X,
  Globe,
  Settings,
  Wallet,
  Zap,
  AlertTriangle,
  Ban,
} from 'lucide-react'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { useGatewayBalance } from '../hooks/useGatewayBalance'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import {
  transferFromGateway,
  ensureChain,
  verifyDestinationUsdcMint,
  gatewayTransferFeeCeiling,
  resolveDestinationUsdcMintAmount,
  gatewayDeliveredUsdc,
} from '../services/gatewayService'
import { executeBridge, estimateBridgeCost, resolveBridgeNetworkFee } from '../services/bridgeService'
import { canAutoWrapEth, wrapEth, unwrapWeth, LEGACY_SEPOLIA_WETH } from '../services/wethService'
import {
  canUcwBridgeTokenFrom,
  executeUcwBridgeTransfer,
  pollCctpDestinationTx,
} from '../services/bridgeUcwService'
import { executeUcwCctpxBridge, quoteUcwCctpxRelayerFee } from '../services/bridgeUcwCctpxService'
import { trackBridgeDelivery, type BridgeDeliveryHandle } from '../services/bridgeDeliveryPoll'
import { logger } from '../utils/logger'
import {
  executeUcwGatewayTransfer,
  mapChainKeyToCircleBlockchain,
} from '../services/gatewayUcwService'
import { createViemAdapter } from '../services/sendService'
import { normalizeAppError } from '../utils/errorNormalizer'
import { buildBridgeReceipt, applyBridgeDelivery, resolveBridgeNetReceived } from '../utils/bridgeReceipt'
import {
  maxBridgeAmount,
  bridgeAmountForPercentage,
  gatewayMaxFeeUsdc,
  sumBridgeDeductedFees,
} from '../utils/bridgeAmountUtils'
import { saveRecipient } from '../utils/recentRecipients'
import { getExplorerTxUrl } from '../config/sendConfig'
import { PrivacyLockButton } from './privacy/PrivacyLockButton'
import { useBroadcast } from './BroadcastNotification'
import { SPEED_TIERS, type SpeedTier } from '../config/feeTiers'
import {
  CHAIN_META,
  CHAIN_DEFS,
  getChainDisplayName,
  getChainIconId,
  BRIDGE_SELECTABLE_CHAINS,
  isBridgeSelectableChain,
  resolveCanonicalChainKey,
} from '../config/bridgeConfig'
import {
  filterBridgeableTokens,
  filterReachableDestinations,
  filterReachableSources,
  getUcwBridgeMechanism,
  isBridgeRouteSupported,
} from '../config/bridgeRouteMatrix'
import {
  getBridgeFeeRecipient,
  isBridgePlatformFeeCharged,
  getBridgePlatformFeeValue,
  BRIDGE_CUSTOM_FEE_CONFIG,
} from '../config/treasuryConfig'
import { MIN_DIRECT_BRIDGE_AMOUNT, ESTIMATED_CCTP_BURN_GAS } from '../config/constants'
import { formatFeeDecimals, CHAIN_NATIVE_MAP } from '../utils/tokenUtils'
import { addTransaction } from '../utils/history'
import { Tooltip } from './common/Tooltip'
import type { SupportedBridgeToken } from '../types/bridge'
import { TOKEN_ICON_MAP } from '../config/tokenIcons'
import {
  FintechCard,
  SegmentedModeSwitch,
  AssetInputPanel,
  RecipientAddressField,
  TransactionBreakdown,
  type BreakdownItem,
  FintechActionButton,
  ChainSelectorModal,
  BridgeSuccessReceipt,
  TokenSelectorModal,
  type TokenItem,
} from './fintech'
import { ChainIcon } from './common/ChainIcon'
import {
  BridgeSettingsModal,
  BridgeRouteSelector,
  BridgeLegacyWethBanner,
  BridgeGatewayHelper,
} from './bridge'
import {
  pollDestinationDelivery,
  quoteDirectCctpFee,
  quoteUcwDirectBridgeFee,
} from '../services/bridge'

/** Scoped logger: bridge diagnostics must not be raw console output in production. */
const bridgeLog = logger.createScope('BridgeModal')

interface BridgeModalProps {
  isOpen: boolean
  isInline?: boolean
  onClose: () => void
  connectedAddress: string
  provider: any // Injected EIP-1193 provider
  currentChainId: number
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  initialSourceChain?: string
  initialChainNonce?: number
  executeUcwContract?: (params: {
    contractAddress: string
    abiFunctionSignature?: string
    abiParameters?: any[]
    callData?: string
    amount?: string
    blockchain?: string
  }) => Promise<{ success: boolean; txHash?: string; error?: string }>
  signTypedData?: (params: {
    data: any
    memo?: string
    blockchain?: string
  }) => Promise<{ success: boolean; signature?: string; error?: string }>
  /**
   * Resolves an executed UCW challenge's broadcast hash. Owned by the wallet
   * hook, which keeps the session token; this component never reads it.
   */
  resolveUcwChallengeTx?: (challengeId?: string, blockchain?: string) => Promise<string | undefined>
  onSuccess: (amount?: string, txHash?: string) => void
  addToast?: (
    title: string,
    description: string,
    type: 'info' | 'success' | 'warning' | 'error' | 'pending',
    txHash?: string,
    network?: string
  ) => string
  removeToast?: (id: string) => void
}

export default function BridgeModal({
  isOpen,
  isInline = false,
  onClose,
  connectedAddress,
  provider,
  authSource,
  initialSourceChain,
  initialChainNonce,
  executeUcwContract,
  signTypedData,
  resolveUcwChallengeTx,
  onSuccess,
}: BridgeModalProps) {
  const { addBroadcast, updateBroadcast } = useBroadcast()
  const [isPrivateBridge, setIsPrivateBridge] = useState(false)

  // Wallet-scoped transaction settings (isolated per connected wallet)
  const { settings: walletSettings, updateSettings: updateWalletSettings } = useWalletSettings(connectedAddress)

  // Speed & Priority Tier Selection
  const [speedTier, setSpeedTier] = useState<SpeedTier>(walletSettings.bridgeSpeedTier)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    setSpeedTier(walletSettings.bridgeSpeedTier)
  }, [walletSettings.bridgeSpeedTier])

  useBodyScrollLock(showSettings || (!isInline && isOpen))

  // Mode Selection: 'direct' or 'gateway'
  const [bridgeMode, setBridgeMode] = useState<'direct' | 'gateway'>('direct')

  const handleSpeedTierChange = (tier: SpeedTier) => {
    setSpeedTier(tier)
    setBridgeMode('direct')
    updateWalletSettings({ bridgeSpeedTier: tier })
  }

  const initialSelectableChain = useMemo(() => {
    const canonical = initialSourceChain ? resolveCanonicalChainKey(initialSourceChain) : ''
    return isBridgeSelectableChain(canonical) ? canonical : ''
  }, [initialSourceChain])

  const [sourceChain, setSourceChain] = useState(() =>
    initialSelectableChain || 'Arc_Testnet'
  )
  const [destChain, setDestChain] = useState(() =>
    initialSelectableChain && initialSelectableChain !== 'Arc_Testnet'
      ? 'Arc_Testnet'
      : 'Base_Sepolia'
  )

  useEffect(() => {
    if (!initialSourceChain) return
    if (!isBridgeSelectableChain(initialSelectableChain)) {
      setSourceChain('Arc_Testnet')
      setDestChain('Base_Sepolia')
      return
    }
    setSourceChain(initialSelectableChain)
    if (initialSelectableChain === 'Arc_Testnet') {
      setDestChain('Base_Sepolia')
    } else {
      setDestChain('Arc_Testnet')
    }
  }, [initialSourceChain, initialChainNonce, initialSelectableChain])

  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')

  // Chain selection modals
  const [showSourceChainModal, setShowSourceChainModal] = useState(false)
  const [showDestChainModal, setShowDestChainModal] = useState(false)

  // Token selection
  const [selectedToken, setSelectedToken] = useState<SupportedBridgeToken>('USDC')
  const [showTokenModal, setShowTokenModal] = useState(false)

  const isValidEvmAddress = (addr: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(addr)

  const isUcwDirect = bridgeMode === 'direct' && authSource === 'ucw'
  const canBridgeNonUsdc = bridgeMode === 'direct'
  const isSourceEthAutoWrap =
    canBridgeNonUsdc && authSource !== 'ucw' && canAutoWrapEth(sourceChain)
  const isUcwCctpxRoute =
    isUcwDirect && getUcwBridgeMechanism(selectedToken) === 'cctpx'

  const isCurrentBridgeRouteSupported = isBridgeRouteSupported(selectedToken, sourceChain, destChain)

  useEffect(() => {
    if (!canBridgeNonUsdc && selectedToken !== 'USDC') {
      setSelectedToken('USDC')
    } else if (selectedToken === 'ETH' && !isSourceEthAutoWrap) {
      setSelectedToken('WETH')
    } else if (!isCurrentBridgeRouteSupported && selectedToken !== 'USDC') {
      setSelectedToken('USDC')
    }
  }, [canBridgeNonUsdc, isSourceEthAutoWrap, isCurrentBridgeRouteSupported, selectedToken])

  const recipientIsValid = useMemo(() => {
    if (!recipient) return false
    return isValidEvmAddress(recipient)
  }, [recipient])

  const { walletBalances, refetch: refetchWalletBalances } =
    useWalletTestnetBalances(connectedAddress)
  const { balances: gatewayBalances, refresh: refreshGatewayBalances } =
    useGatewayBalance(connectedAddress)

  const sourceWalletBalance = walletBalances[sourceChain]?.usdc || '0.00'
  const sourceGatewayBalance =
    gatewayBalances.find((b) => b.chainKey === sourceChain)?.balance || '0.00'

  const isUsdc = selectedToken === 'USDC'
  const deliveredTokenSymbol = selectedToken === 'ETH' ? 'WETH' : selectedToken
  const isDirectCctpMinApplies =
    bridgeMode === 'direct' && (isUsdc || getUcwBridgeMechanism(selectedToken) === 'cctp-v2')
  const deliveredTokenIcon = TOKEN_ICON_MAP[deliveredTokenSymbol] || UsdcIcon
  const tokenDecimals = selectedToken === 'WETH' || selectedToken === 'ETH' ? 18 : selectedToken === 'cirBTC' ? 8 : 6

  const activeBalance = useMemo(() => {
    if (selectedToken === 'USDC') {
      return bridgeMode === 'direct' ? sourceWalletBalance : sourceGatewayBalance
    }
    if (selectedToken === 'EURC') return walletBalances[sourceChain]?.eurc || '0.00'
    if (selectedToken === 'WETH') return walletBalances[sourceChain]?.weth || '0.0000'
    if (selectedToken === 'ETH') return walletBalances[sourceChain]?.nativeAmount || '0.0000'
    if (selectedToken === 'cirBTC') return walletBalances[sourceChain]?.cirbtc || '0.00000'
    return '0.00'
  }, [selectedToken, bridgeMode, sourceWalletBalance, sourceGatewayBalance, walletBalances, sourceChain])

  const pairBridgeableTokens = useMemo(
    () => filterBridgeableTokens(['USDC', 'EURC', 'WETH', 'ETH', 'cirBTC'], sourceChain, [destChain]),
    [sourceChain, destChain]
  )

  const isTokenAvailableOnSource = (symbol: string) =>
    canUcwBridgeTokenFrom(sourceChain, symbol)

  const availableBridgeTokens = useMemo<TokenItem[]>(() => {
    const usdcItem: TokenItem = {
      symbol: 'USDC',
      name: 'USD Coin',
      icon: TOKEN_ICON_MAP.USDC || UsdcIcon,
      balance: bridgeMode === 'gateway' ? sourceGatewayBalance : sourceWalletBalance,
    }

    if (!canBridgeNonUsdc) {
      return [usdcItem]
    }

    const tokens: TokenItem[] = [
      usdcItem,
      {
        symbol: 'EURC',
        name: 'Euro Coin',
        icon: TOKEN_ICON_MAP.EURC,
        balance: walletBalances[sourceChain]?.eurc || '0.00',
      },
      {
        symbol: 'WETH',
        name: 'Wrapped Ether',
        icon: TOKEN_ICON_MAP.WETH,
        balance: walletBalances[sourceChain]?.weth || '0.0000',
      },
    ]

    if (isSourceEthAutoWrap) {
      tokens.push({
        symbol: 'ETH',
        name: 'Ethereum (Auto-Wrap)',
        icon: TOKEN_ICON_MAP.ETH || TOKEN_ICON_MAP.WETH,
        balance: walletBalances[sourceChain]?.nativeAmount || '0.0000',
      })
    }

    tokens.push({
      symbol: 'cirBTC',
      name: 'Circle Bitcoin',
      icon: TOKEN_ICON_MAP.cirBTC,
      balance: walletBalances[sourceChain]?.cirbtc || '0.00000',
    })

    return tokens.filter(
      (token) => pairBridgeableTokens.includes(token.symbol) && isTokenAvailableOnSource(token.symbol)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBridgeNonUsdc, isSourceEthAutoWrap, bridgeMode, sourceGatewayBalance, sourceWalletBalance, walletBalances, sourceChain, pairBridgeableTokens, authSource])

  const platformFeeAmount = isUsdc ? getBridgePlatformFeeValue(amount) : 0
  const platformFeeCharged = isUsdc && isBridgePlatformFeeCharged({ bridgeMode, authSource })
  const requiredDebit = amount
    ? parseFloat(amount) + (platformFeeCharged ? platformFeeAmount : 0)
    : 0
  const isInsufficient = amount ? requiredDebit > parseFloat(activeBalance) : false

  const amountReserves = {
    platformFeeUsdc: platformFeeCharged ? getBridgePlatformFeeValue(activeBalance) : 0,
    gatewayMaxFeeUsdc:
      bridgeMode === 'gateway' ? gatewayMaxFeeUsdc(parseFloat(activeBalance) || 0) : 0,
  }

  const [bridgePhase, setBridgePhase] = useState<'wrapping' | 'executing' | null>(null)
  const isTransferring = bridgePhase === 'executing'
  const isWrapping = bridgePhase === 'wrapping'

  const deliveryHandlesRef = useRef<BridgeDeliveryHandle[]>([])
  const stopTrackedDeliveries = useCallback(() => {
    for (const handle of deliveryHandlesRef.current) handle.cancel()
    deliveryHandlesRef.current = []
  }, [])

  const trackDelivery = useCallback(
    (key: string, runner: (signal: AbortSignal) => Promise<void>) => {
      const handle = trackBridgeDelivery(key, runner)
      if (!handle.alreadyTracked) deliveryHandlesRef.current.push(handle)
      return handle
    },
    []
  )
  const [isUnwrappingLegacy, setIsUnwrappingLegacy] = useState(false)
  const [successReceipt, setSuccessReceipt] = useState<any>(null)
  const [isBridgePending, setIsBridgePending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCanceledError, setIsCanceledError] = useState(false)

  const estimateSeqRef = useRef(0)
  const estimateAdapterRef = useRef<{ provider: any; chain: string; adapter: any } | null>(null)
  const getEstimateAdapter = useCallback(async (prov: any, chain: string) => {
    const cached = estimateAdapterRef.current
    if (cached && cached.provider === prov && cached.chain === chain) return cached.adapter
    const adapter = await createViemAdapter(prov)
    estimateAdapterRef.current = { provider: prov, chain, adapter }
    return adapter
  }, [])

  const [estimatedFee, setEstimatedFee] = useState<string | null>(null)
  const [ucwCctpxRelayerFee, setUcwCctpxRelayerFee] = useState<string | null>(null)

  const resetFormInputs = useCallback(() => {
    setAmount('')
    setRecipient('')
    setSelectedToken('USDC')
    setBridgePhase(null)
    setSuccessReceipt(null)
    setIsBridgePending(false)
    setError(null)
    setIsCanceledError(false)
    setEstimatedFee(null)
    stopTrackedDeliveries()
  }, [stopTrackedDeliveries])

  useClearOnWalletDisconnect(resetFormInputs)

  useEffect(() => {
    if (!connectedAddress) {
      resetFormInputs()
    }
  }, [connectedAddress, resetFormInputs])

  useEffect(() => {
    if (!isOpen) stopTrackedDeliveries()
  }, [isOpen, stopTrackedDeliveries])

  useEffect(() => () => stopTrackedDeliveries(), [stopTrackedDeliveries])

  useEffect(() => {
    if (isOpen) {
      setBridgePhase(null)
      setSuccessReceipt(null)
      setIsBridgePending(false)
      setError(null)
      setIsCanceledError(false)
      setEstimatedFee(null)
    }
  }, [isOpen])

  // Debounced fee estimation
  useEffect(() => {
    if (isTransferring) return

    setEstimatedFee(null)
    setUcwCctpxRelayerFee(null)

    if (!amount || parseFloat(amount) <= 0) {
      return
    }

    let isMounted = true
    const seq = ++estimateSeqRef.current
    const isCurrent = () => isMounted && estimateSeqRef.current === seq
    const getEstimation = async () => {
      try {
        if (bridgeMode === 'gateway') return

        if (authSource === 'ucw') {
          if (isUcwCctpxRoute) {
            const relayerFee = await quoteUcwCctpxRelayerFee({
              tokenSymbol: selectedToken,
              amount,
              sourceChain,
              destChain,
              recipientAddress: recipient || connectedAddress,
              speed: speedTier === 'standard' ? 'SLOW' : 'FAST',
            })
              .then((quote) => quote.feeAmount)
              .catch((feeErr: any) => {
                bridgeLog.debug('CCTP-X fee quote unavailable:', feeErr?.message || feeErr)
                return null
              })
            if (isCurrent()) {
              setEstimatedFee('0.00')
              setUcwCctpxRelayerFee(relayerFee)
            }
            return
          }

          if (isCurrent()) {
            setEstimatedFee(await quoteUcwDirectBridgeFee(speedTier, sourceChain, destChain, amount))
          }
          return
        }

        if (provider) {
          const adapter = await getEstimateAdapter(provider, sourceChain)
          const cost = await estimateBridgeCost({
            fromChain: sourceChain,
            toChain: destChain,
            amount,
            token: selectedToken,
            sourceAdapter: adapter,
            recipientAddress: recipient || connectedAddress,
            useForwarder: true,
            transferSpeed: speedTier === 'standard' ? 'SLOW' : 'FAST',
            ...(platformFeeCharged && {
              customFee: {
                value: formatFeeDecimals(platformFeeAmount),
                recipientAddress: getBridgeFeeRecipient(sourceChain),
              },
            }),
          })
          const totalFeeInUsdc = sumBridgeDeductedFees(cost?.fees as any)

          if (isCurrent()) {
            setEstimatedFee(
              totalFeeInUsdc > 0
                ? formatFeeDecimals(totalFeeInUsdc)
                : await quoteDirectCctpFee(speedTier, sourceChain, destChain, amount)
            )
          }
        }
      } catch (err) {
        if (isCurrent() && bridgeMode !== 'gateway') {
          setEstimatedFee(
            isUcwCctpxRoute ? '0.00' : await quoteDirectCctpFee(speedTier, sourceChain, destChain, amount)
          )
        }
      }
    }

    const timer = setTimeout(getEstimation, 400)
    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [
    amount,
    sourceChain,
    destChain,
    bridgeMode,
    speedTier,
    platformFeeCharged,
    provider,
    recipient,
    connectedAddress,
    isTransferring,
    platformFeeAmount,
    authSource,
    selectedToken,
    isUcwCctpxRoute,
    getEstimateAdapter,
  ])

  const sourceChainsList = useMemo(() => {
    return filterReachableSources(selectedToken, destChain, BRIDGE_SELECTABLE_CHAINS).map((c) => ({
      chain: c,
      name: getChainDisplayName(c),
    }))
  }, [selectedToken, destChain])

  const destChainsList = useMemo(() => {
    return filterReachableDestinations(selectedToken, sourceChain, BRIDGE_SELECTABLE_CHAINS).map(
      (c) => ({
        chain: c,
        name: getChainDisplayName(c),
      })
    )
  }, [selectedToken, sourceChain])

  const handleSwapChains = () => {
    setSourceChain(destChain)
    setDestChain(sourceChain)
    setError(null)
    setIsCanceledError(false)
  }

  const handleUnwrapLegacyWeth = async () => {
    const legacyBal = walletBalances['Ethereum_Sepolia']?.legacyWeth
    if (!legacyBal || parseFloat(legacyBal) <= 0) return
    setIsUnwrappingLegacy(true)
    setError(null)
    try {
      const activeProvider =
        provider ||
        (typeof window !== 'undefined' ? (window as any).ethereum : undefined)
      if (!activeProvider) throw new Error('No wallet provider available.')
      await unwrapWeth({
        provider: activeProvider,
        chainKey: 'Ethereum_Sepolia',
        amount: legacyBal,
        wethAddress: LEGACY_SEPOLIA_WETH,
        fromAddress: connectedAddress,
      })
      await refetchWalletBalances()
    } catch (err: any) {
      bridgeLog.error('Failed to unwrap legacy WETH:', err)
      const normalized = normalizeAppError(err)
      setError(normalized.message)
    } finally {
      setIsUnwrappingLegacy(false)
    }
  }

  const handleTransfer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setError(null)
    setIsCanceledError(false)
    setSuccessReceipt(null)

    const targetRecipient = recipient.trim()
    if (!targetRecipient) {
      setError('Please enter a recipient address')
      return
    }

    if (!recipientIsValid) {
      setError('Please enter a valid EVM recipient address (0x...)')
      return
    }

    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) {
      setError('Please enter a valid amount')
      return
    }

    if (isDirectCctpMinApplies && amt < MIN_DIRECT_BRIDGE_AMOUNT) {
      setError(
        `Minimum transfer amount for a direct CCTP bridge is ${MIN_DIRECT_BRIDGE_AMOUNT.toFixed(2)} ${deliveredTokenSymbol} to cover CCTP network forwarder fees.`
      )
      return
    }

    if (sourceChain === destChain) {
      setError('Source and destination chains must be different')
      return
    }

    if (!isCurrentBridgeRouteSupported) {
      setError(
        `${selectedToken} cannot be bridged from ${getChainDisplayName(sourceChain)} to ${getChainDisplayName(destChain)}. Choose a supported route.`
      )
      return
    }

    if (isUcwDirect && !isTokenAvailableOnSource(selectedToken)) {
      setError(
        `${selectedToken} cannot be bridged from ${getChainDisplayName(sourceChain)} with a Circle wallet. Choose another token or network.`
      )
      return
    }

    if (isInsufficient) {
      setError(
        bridgeMode === 'direct'
          ? `Insufficient wallet balance! You have ${activeBalance} ${deliveredTokenSymbol} in your wallet on ${getChainDisplayName(
              sourceChain
            )}.`
          : `Insufficient Gateway balance! You have ${sourceGatewayBalance} USDC in Gateway on ${getChainDisplayName(
              sourceChain
            )}.`
      )
      return
    }

    if (authSource === 'ucw') {
      try {
        mapChainKeyToCircleBlockchain(sourceChain)
        if (bridgeMode === 'gateway') {
          mapChainKeyToCircleBlockchain(destChain)
        }
      } catch (chainErr) {
        setError(chainErr instanceof Error ? chainErr.message : String(chainErr))
        return
      }
    }

    setBridgePhase('executing')

    const broadcastId = addBroadcast({
      type: 'bridge',
      title: bridgeMode === 'direct' ? `Bridging ${selectedToken}...` : `Bridging ${selectedToken} via Gateway...`,
      status: 'pending',
      badgeText: 'Pending',
      details: {
        amount,
        tokenSymbol: deliveredTokenSymbol,
        tokenIcon: deliveredTokenIcon,
        sourceChain,
        destChain,
        bridgeMode,
        network: destChain,
      },
    })

    let mintTxHash = ''
    let burnTxHash = ''
    let destExplorerUrl: string | undefined = undefined
    let sourceExplorerUrl: string | undefined = undefined
    let ucwChallengeId: string | undefined = undefined
    let gatewayTransferId: string | undefined = undefined
    let confirmedCctpReceivedAmount: string | undefined = undefined

    try {
      if (authSource === 'ucw') {
        if (bridgeMode === 'gateway') {
          if (!signTypedData) {
            throw new Error('Wallet signature module is not initialized. Please refresh or re-authenticate.')
          }
          if (!executeUcwContract) {
            throw new Error('Wallet contract execution module is not initialized. Please refresh or re-authenticate.')
          }

          const gatewayUcwResult = await executeUcwGatewayTransfer({
            amount,
            sourceChain,
            destChain,
            recipientAddress: targetRecipient,
            connectedAddress,
            signTypedData,
            executeUcwContract,
            resolveChallengeTx: resolveUcwChallengeTx,
            onStepProgress: (step) => {
              if (step === 'checking_balance') {
                updateBroadcast(broadcastId, { title: 'Verifying Gateway Balance...', badgeText: 'Verifying' })
              } else if (step === 'preparing_wallet') {
                updateBroadcast(broadcastId, { title: 'Preparing Multi-Chain Wallet...', badgeText: 'Setup' })
              } else if (step === 'signing') {
                updateBroadcast(broadcastId, { title: 'Awaiting Authorization Signature...', badgeText: 'Authorize' })
              } else if (step === 'gateway_api') {
                updateBroadcast(broadcastId, { title: 'Processing Gateway Transfer...', badgeText: 'Gateway API' })
              } else if (step === 'forwarding') {
                updateBroadcast(broadcastId, { title: 'Circle is minting USDC...', badgeText: 'Forwarding' })
              } else if (step === 'minting') {
                updateBroadcast(broadcastId, { title: 'Circle is minting USDC...', badgeText: 'Minting' })
              }
            },
          })

          mintTxHash = gatewayUcwResult.mintTxHash || ''
          gatewayTransferId = gatewayUcwResult.transferId
          burnTxHash = ''
          sourceExplorerUrl = undefined
          destExplorerUrl = gatewayUcwResult.destExplorerUrl
          ucwChallengeId = gatewayUcwResult.challengeId
        } else if (getUcwBridgeMechanism(selectedToken) === 'cctpx') {
          if (!executeUcwContract) {
            throw new Error('Wallet contract execution module is not initialized. Please refresh or re-authenticate.')
          }

          const ucwCctpxResult = await executeUcwCctpxBridge({
            tokenSymbol: selectedToken,
            amount,
            sourceChain,
            destChain,
            recipientAddress: targetRecipient,
            connectedAddress,
            executeUcwContract,
            speed: speedTier === 'standard' ? 'SLOW' : 'FAST',
            onStepProgress: (step) => {
              if (step === 'approving') {
                updateBroadcast(broadcastId, {
                  title: `Approving ${selectedToken} Allowance...`,
                  badgeText: 'Approving',
                })
              } else if (step === 'burning') {
                updateBroadcast(broadcastId, {
                  title: 'Initiating CCTP-X Bridge...',
                  badgeText: 'Bridging',
                })
              }
            },
          })

          burnTxHash = ucwCctpxResult.burnTxHash
          mintTxHash = ''
          sourceExplorerUrl = ucwCctpxResult.sourceExplorerUrl
          destExplorerUrl = undefined
          ucwChallengeId = ucwCctpxResult.challengeId
        } else {
          if (!executeUcwContract) {
            throw new Error('Wallet contract execution module is not initialized. Please refresh or re-authenticate.')
          }

          const ucwResult = await executeUcwBridgeTransfer({
            useForwarder: true,
            tokenSymbol: selectedToken,
            minFinalityThreshold: speedTier === 'standard' ? 2000 : 1000,
            amount,
            sourceChain,
            destChain,
            recipientAddress: targetRecipient,
            connectedAddress,
            executeUcwContract,
            resolveChallengeTx: resolveUcwChallengeTx,
            onStepProgress: (step) => {
              if (step === 'approving') {
                updateBroadcast(broadcastId, {
                  title: `Approving ${selectedToken} Allowance...`,
                  badgeText: 'Approving',
                })
              } else if (step === 'burning') {
                updateBroadcast(broadcastId, {
                  title: 'Initiating CCTP Bridge...',
                  badgeText: 'Bridging',
                })
              }
            },
          })

          burnTxHash = ucwResult.burnTxHash
          mintTxHash = ''
          sourceExplorerUrl = ucwResult.sourceExplorerUrl
          destExplorerUrl = undefined
          ucwChallengeId = ucwResult.challengeId
        }
      } else if (bridgeMode === 'direct') {
        if (!provider) throw new Error('No wallet provider available')

        const sourceChainDef = CHAIN_DEFS[sourceChain]
        if (sourceChainDef && typeof provider.request === 'function') {
          await ensureChain(provider, sourceChainDef)
        }

        if (selectedToken === 'ETH') {
          setBridgePhase('wrapping')
          updateBroadcast(broadcastId, {
            type: 'bridge',
            title: 'Wrapping ETH to WETH...',
            status: 'pending',
            badgeText: 'Wrapping',
            message: `Wrapping ${amount} ETH to WETH on ${getChainDisplayName(sourceChain)} before cross-chain bridge.`,
            details: {
              amount,
              tokenSymbol: 'ETH',
              tokenIcon: TOKEN_ICON_MAP.ETH || UsdcIcon,
              sourceChain,
              destChain,
              bridgeMode,
            },
          })

          try {
            await wrapEth({
              provider,
              chainKey: sourceChain,
              amount,
              fromAddress: connectedAddress,
            })
            bridgeLog.debug('ETH wrapped to WETH successfully.')
            refetchWalletBalances()
          } catch (wrapErr: any) {
            setBridgePhase(null)
            const normalized = normalizeAppError(wrapErr)
            setIsCanceledError(normalized.isCanceled)
            setError(normalized.message)
            updateBroadcast(broadcastId, {
              type: 'bridge',
              title: normalized.isCanceled ? 'ETH Wrapping Canceled' : 'ETH Wrapping Failed',
              status: normalized.isCanceled ? 'canceled' : 'failed',
              badgeText: normalized.isCanceled ? 'Canceled' : 'Failed',
              message: normalized.message,
            })
            return
          } finally {
            setBridgePhase((prev) => (prev === 'wrapping' ? 'executing' : prev))
          }
        }

        const adapter = await createViemAdapter(provider)
        const bridgeToken = selectedToken === 'ETH' ? 'WETH' : selectedToken

        const result: any = await executeBridge(
          {
            fromChain: sourceChain,
            toChain: destChain,
            amount,
            token: bridgeToken,
            sourceAdapter: adapter,
            recipientAddress: targetRecipient,
            useForwarder: true,
            transferSpeed: speedTier === 'standard' ? 'SLOW' : 'FAST',
            ...(platformFeeCharged && {
              customFee: {
                value: formatFeeDecimals(platformFeeAmount),
                recipientAddress: getBridgeFeeRecipient(sourceChain),
              },
            }),
          },
          (step) => {
            const isBurnLike = step.name === 'burn' || step.name === 'transfer'
            const isMintLike = step.name === 'mint' || step.name === 'forward'

            if (isBurnLike && step.txHash) {
              burnTxHash = step.txHash
              sourceExplorerUrl = step.explorerUrl || getExplorerTxUrl(sourceChain, step.txHash)
              updateBroadcast(broadcastId, {
                title: 'Burn Confirmed — Awaiting Destination Mint...',
                badgeText: 'Attesting',
                status: 'pending',
                message: `Source burn confirmed on ${getChainDisplayName(sourceChain)}. Destination mint in progress.`,
                details: {
                  amount,
                  tokenSymbol: deliveredTokenSymbol,
                  tokenIcon: deliveredTokenIcon,
                  sourceChain,
                  destChain,
                  bridgeMode,
                  network: sourceChain,
                  txHash: step.txHash,
                  sourceTxHash: step.txHash,
                  sourceExplorerUrl,
                },
              })
            } else if (step.name === 'fetchAttestation') {
              updateBroadcast(broadcastId, {
                title: 'Retrieving Circle Attestation...',
                badgeText: 'Attesting',
              })
            } else if (isMintLike) {
              if (step.txHash) {
                mintTxHash = step.txHash
                destExplorerUrl = step.explorerUrl || getExplorerTxUrl(destChain, step.txHash)
              }
              updateBroadcast(broadcastId, {
                title: `Minting ${deliveredTokenSymbol} on ${getChainDisplayName(destChain)}...`,
                badgeText: 'Minting',
              })
            }
          }
        )

        if (
          !result ||
          result.state === 'error' ||
          result.status === 'error' ||
          result.status === 'failed'
        ) {
          const errorStep = result?.steps?.find(
            (s: any) => s.state === 'error' || s.errorMessage || s.error
          )
          const errorMsg =
            errorStep?.errorMessage ||
            errorStep?.error?.message ||
            result?.errorMessage ||
            result?.error?.message ||
            'CCTP Bridge transfer failed.'
          throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg))
        }

        const mintStep = result?.steps?.find((s: any) => s.name === 'mint' || s.name === 'forward')
        const burnStep = result?.steps?.find((s: any) => s.name === 'burn' || s.name === 'transfer')

        mintTxHash =
          result?.mintTxHash ||
          result?.forwardTxHash ||
          mintStep?.txHash ||
          mintStep?.transactionHash ||
          mintStep?.data?.forwardTxHash ||
          mintTxHash ||
          ''
        burnTxHash =
          burnStep?.txHash ||
          burnStep?.transactionHash ||
          result?.burnTxHash ||
          result?.transferTxHash ||
          result?.txHash ||
          burnTxHash ||
          ''

        destExplorerUrl =
          destExplorerUrl ||
          mintStep?.explorerUrl ||
          (mintTxHash ? getExplorerTxUrl(destChain, mintTxHash) : undefined)
        sourceExplorerUrl =
          sourceExplorerUrl ||
          burnStep?.explorerUrl ||
          (burnTxHash ? getExplorerTxUrl(sourceChain, burnTxHash) : undefined)
      } else {
        if (!provider) throw new Error('No wallet provider available')
        const result = await transferFromGateway({
          provider,
          sourceChain,
          destinationChain: destChain,
          amount,
          recipient: targetRecipient,
          sourceChainDef: CHAIN_DEFS[sourceChain],
          destinationChainDef: CHAIN_DEFS[destChain],
        }).finally(() => {
          try {
            const sourceDef = CHAIN_DEFS[sourceChain]
            if (sourceDef && typeof provider.request === 'function') {
              ensureChain(provider, sourceDef).catch((switchErr: any) =>
                bridgeLog.debug('Source network restore skipped:', switchErr?.message || switchErr)
              )
            }
          } catch (restoreErr: any) {
            bridgeLog.debug('Source network restore skipped:', restoreErr?.message || restoreErr)
          }
        })

        if (!result || !result.mintTxHash) {
          throw new Error('Gateway transfer did not return a valid transaction hash.')
        }

        mintTxHash = result.mintTxHash || ''
        destExplorerUrl = mintTxHash ? getExplorerTxUrl(destChain, mintTxHash) : undefined
      }

      setBridgePhase(null)
      setError(null)

      const isGateway = bridgeMode === 'gateway'
      let destinationConfirmed = Boolean(
        isGateway && mintTxHash && /^0x[0-9a-fA-F]{64}$/.test(mintTxHash) &&
        await verifyDestinationUsdcMint(destChain, mintTxHash, targetRecipient, amount, gatewayTransferFeeCeiling(amount))
      )
      if (!isGateway && mintTxHash && /^0x[0-9a-fA-F]{64}$/.test(mintTxHash)) {
        const cctpDestination = await pollCctpDestinationTx({
          sourceChain, destChain, burnTxHash, recipientAddress: targetRecipient, amount,
          tokenSymbol: deliveredTokenSymbol,
          mintTxHash,
          maxAttempts: 1, intervalMs: 0,
        })
        destinationConfirmed = cctpDestination.status === 'confirmed' && cctpDestination.destTxHash?.toLowerCase() === mintTxHash.toLowerCase()
        confirmedCctpReceivedAmount = destinationConfirmed ? cctpDestination.receivedAmount : undefined
      }

      let gatewayReceivedAmount: string | undefined = undefined
      if (isGateway && destinationConfirmed && mintTxHash) {
        const mintedSubunits = await resolveDestinationUsdcMintAmount(destChain, mintTxHash, targetRecipient)
        gatewayReceivedAmount = mintedSubunits === null ? undefined : gatewayDeliveredUsdc(mintedSubunits) ?? undefined
      }

      const candidateMintHash = mintTxHash
      const confirmedMintTxHash = destinationConfirmed ? candidateMintHash : ''
      setIsBridgePending(!destinationConfirmed)

      let fallbackFee: string | undefined
      if (!isGateway && destinationConfirmed && !confirmedCctpReceivedAmount) {
        fallbackFee =
          estimatedFee ||
          (isUcwCctpxRoute
            ? '0.00'
            : authSource === 'ucw'
              ? await quoteUcwDirectBridgeFee(speedTier, sourceChain, destChain, amount)
              : await quoteDirectCctpFee(speedTier, sourceChain, destChain, amount))
      }
      const netAmount = resolveBridgeNetReceived({
        destinationConfirmed,
        mode: isGateway ? 'gateway' : 'direct',
        amount,
        gatewayReceivedAmount,
        confirmedCctpReceivedAmount,
        fallbackFee,
      })
      const broadcastNetwork = isGateway ? destChain : sourceChain
      const hasRealDestTx = destinationConfirmed && Boolean(confirmedMintTxHash)
      const primaryTxHash = isGateway ? confirmedMintTxHash : (burnTxHash || confirmedMintTxHash || '')

      const networkFeeText =
        !isGateway && burnTxHash
          ? await resolveBridgeNetworkFee(sourceChain, burnTxHash)
          : undefined

      const destFeeText =
        hasRealDestTx && confirmedMintTxHash
          ? await resolveBridgeNetworkFee(destChain, confirmedMintTxHash)
          : undefined
      const receipt = buildBridgeReceipt({
        mode: isGateway ? 'gateway' : 'direct',
        amount,
        tokenSymbol: deliveredTokenSymbol,
        tokenIcon: deliveredTokenIcon,
        sourceChain,
        destChain,
        destinationConfirmed,
        burnTxHash,
        mintTxHash: confirmedMintTxHash,
        sourceExplorerUrl,
        destExplorerUrl: confirmedMintTxHash ? getExplorerTxUrl(destChain, confirmedMintTxHash) : undefined,
        networkFee: networkFeeText,
        destFee: destFeeText,
        netReceived: netAmount,
      })
      const primaryExplorerUrl = receipt.explorerUrl

      setSuccessReceipt(receipt)
      if (recipient) {
        saveRecipient({
          address: recipient,
          chainFamily: 'evm',
          sourceChain,
        })
      }

      updateBroadcast(broadcastId, {
        type: 'bridge',
        title: destinationConfirmed ? 'Bridge Completed Successfully' : 'Bridge Awaiting Destination Confirmation',
        status: destinationConfirmed ? 'success' : 'pending',
        badgeText: destinationConfirmed ? 'Confirmed' : 'Pending',
        details: {
          amount,
          tokenSymbol: deliveredTokenSymbol,
          tokenIcon: deliveredTokenIcon,
          sourceChain,
          destChain,
          bridgeMode,
          network: broadcastNetwork,
          txHash: destinationConfirmed ? primaryTxHash : undefined,
          sourceTxHash: receipt.sourceTxHash,
          destTxHash: hasRealDestTx ? mintTxHash : undefined,
          explorerUrl: destinationConfirmed ? primaryExplorerUrl : undefined,
          sourceExplorerUrl: receipt.sourceExplorerUrl,
          destExplorerUrl: receipt.destExplorerUrl,
        },
      })

      refetchWalletBalances()
      refreshGatewayBalances()

      if (destinationConfirmed) {
        addTransaction({
          type: 'bridge',
          txHash: mintTxHash,
          destTxHash: mintTxHash,
          amount,
          tokenSymbol: deliveredTokenSymbol,
          sourceChain,
          destChain,
          recipient: targetRecipient,
          userAddress: connectedAddress,
          status: 'success',
          isPrivate: isPrivateBridge,
        })
        onSuccess(amount, mintTxHash)
      } else if (burnTxHash && /^0x[0-9a-fA-F]{64}$/.test(burnTxHash)) {
        addTransaction({
          type: 'bridge', txHash: burnTxHash, amount, tokenSymbol: deliveredTokenSymbol, sourceChain, destChain,
          recipient: targetRecipient, userAddress: connectedAddress, status: 'pending', isPrivate: isPrivateBridge,
        })
      }

      if (!destinationConfirmed) {
        const deliveryKey =
          isGateway && gatewayTransferId
            ? `gateway:${gatewayTransferId}`
            : burnTxHash && burnTxHash.startsWith('0x')
              ? `cctp:${burnTxHash.toLowerCase()}`
              : null
        if (deliveryKey) {
          trackDelivery(deliveryKey, async (signal) => {
            await pollDestinationDelivery({
              isGateway,
              gatewayTransferId,
              burnTxHash,
              mintTxHash,
              sourceChain,
              destChain,
              targetRecipient,
              amount,
              deliveredTokenSymbol,
              deliveredTokenIcon,
              connectedAddress,
              isPrivateBridge,
              broadcastId,
              sourceExplorerUrl,
              primaryExplorerUrl,
              signal,
              setSuccessReceipt,
              setIsBridgePending,
              updateBroadcast,
              onSuccess,
            })
          })
        }
      }
    } catch (err: any) {
      bridgeLog.error('Execution error:', err)
      setBridgePhase(null)

      const failedBridgeResult = err?.bridgeResult
      const burnedTxHash: string | undefined =
        failedBridgeResult?.steps?.find(
          (s: any) =>
            (s?.name === 'burn' || s?.name === 'transfer') &&
            s?.state === 'success' &&
            /^0x[0-9a-fA-F]{64}$/.test(s?.txHash || s?.transactionHash || '')
        )?.txHash ||
        failedBridgeResult?.steps?.find(
          (s: any) =>
            (s?.name === 'burn' || s?.name === 'transfer') &&
            s?.state === 'success' &&
            /^0x[0-9a-fA-F]{64}$/.test(s?.txHash || s?.transactionHash || '')
        )?.transactionHash ||
        (burnTxHash && /^0x[0-9a-fA-F]{64}$/.test(burnTxHash) ? burnTxHash : undefined)

      const candidateMintInFailure = failedBridgeResult?.steps?.find(
        (s: any) =>
          (s?.name === 'mint' || s?.name === 'forward') &&
          /^0x[0-9a-fA-F]{64}$/.test(s?.txHash || s?.transactionHash || s?.data?.forwardTxHash || '')
      )
      const failedMintTxHash =
        candidateMintInFailure?.txHash ||
        candidateMintInFailure?.transactionHash ||
        candidateMintInFailure?.data?.forwardTxHash ||
        mintTxHash ||
        undefined

      if (burnedTxHash && bridgeMode === 'direct' && authSource !== 'ucw') {
        const sourceExplorer = getExplorerTxUrl(sourceChain, burnedTxHash)
        setError(null)
        setIsCanceledError(false)
        const pendingNetworkFee = await resolveBridgeNetworkFee(sourceChain, burnedTxHash).catch(() => undefined)
        setSuccessReceipt(
          buildBridgeReceipt({
            mode: 'direct',
            amount,
            tokenSymbol: deliveredTokenSymbol,
            tokenIcon: deliveredTokenIcon,
            sourceChain,
            destChain,
            destinationConfirmed: false,
            burnTxHash: burnedTxHash,
            sourceExplorerUrl: sourceExplorer,
            networkFee: pendingNetworkFee,
          })
        )
        setIsBridgePending(true)

        addTransaction({
          type: 'bridge', txHash: burnedTxHash, amount, tokenSymbol: deliveredTokenSymbol,
          sourceChain, destChain, recipient: targetRecipient, userAddress: connectedAddress,
          status: 'pending', isPrivate: isPrivateBridge,
        })

        updateBroadcast(broadcastId, {
          type: 'bridge',
          title: 'Source Transaction Confirmed — Destination Pending',
          status: 'pending',
          badgeText: 'Pending',
          message: 'The source burn succeeded; the destination mint is being tracked automatically.',
          details: {
            amount,
            tokenSymbol: deliveredTokenSymbol,
            tokenIcon: deliveredTokenIcon,
            sourceChain,
            destChain,
            bridgeMode,
            network: sourceChain,
            txHash: burnedTxHash,
            sourceTxHash: burnedTxHash,
            sourceExplorerUrl: sourceExplorer,
          },
        })

        trackDelivery(`cctp:${burnedTxHash.toLowerCase()}`, async (signal) => {
          await pollDestinationDelivery({
            isGateway: false,
            burnTxHash: burnedTxHash,
            mintTxHash: failedMintTxHash,
            sourceChain,
            destChain,
            targetRecipient,
            amount,
            deliveredTokenSymbol,
            deliveredTokenIcon,
            connectedAddress,
            isPrivateBridge,
            broadcastId,
            sourceExplorerUrl: sourceExplorer,
            signal,
            setSuccessReceipt,
            setIsBridgePending,
            updateBroadcast,
            onSuccess,
          })
        })

        return
      }

      const normalized = normalizeAppError(err)
      const isCanceled = normalized.isCanceled

      setIsCanceledError(isCanceled)
      setError(normalized.message)

      updateBroadcast(broadcastId, {
        type: 'bridge',
        title: isCanceled
          ? (bridgeMode === 'direct' ? 'Bridging Canceled' : 'Gateway Bridging Canceled')
          : (bridgeMode === 'direct' ? (normalized.title || 'Bridge Failed') : 'Gateway Transfer Failed'),
        status: isCanceled ? 'canceled' : 'failed',
        badgeText: isCanceled ? 'Canceled' : 'Failed',
        message: normalized.message,
        details: {
          amount,
          tokenSymbol: deliveredTokenSymbol,
          tokenIcon: deliveredTokenIcon,
          sourceChain,
          destChain,
          bridgeMode,
          network: destChain,
        },
      })
    }
  }

  // Smart Action Button States
  const actionButtonState = useMemo(() => {
    if (isWrapping) {
      return {
        disabled: true,
        text: 'WRAPPING ETH TO WETH...',
        loading: true,
      }
    }
    if (isTransferring) {
      return {
        disabled: true,
        text:
          selectedToken === 'ETH'
            ? 'BRIDGING WETH VIA CCTP...'
            : bridgeMode === 'direct'
              ? 'BRIDGING VIA CCTP...'
              : 'TRANSFERRING VIA GATEWAY...',
        loading: true,
      }
    }
    if (!connectedAddress) {
      return {
        disabled: true,
        text: 'CONNECT WALLET',
        loading: false,
      }
    }
    if (!amount || parseFloat(amount) <= 0) {
      return {
        disabled: true,
        text: 'ENTER AN AMOUNT',
        loading: false,
      }
    }
    if (isDirectCctpMinApplies && parseFloat(amount) < MIN_DIRECT_BRIDGE_AMOUNT) {
      return {
        disabled: true,
        text: `MINIMUM IS ${MIN_DIRECT_BRIDGE_AMOUNT.toFixed(2)} ${deliveredTokenSymbol}`,
        loading: false,
      }
    }
    if (isInsufficient) {
      return {
        disabled: true,
        text: 'INSUFFICIENT BALANCE',
        loading: false,
      }
    }
    if (sourceChain === destChain) {
      return {
        disabled: true,
        text: 'SELECT DIFFERENT NETWORKS',
        loading: false,
      }
    }
    if (!recipient) {
      return {
        disabled: true,
        text: 'ENTER RECIPIENT ADDRESS',
        loading: false,
      }
    }
    if (!recipientIsValid) {
      return {
        disabled: true,
        text: 'INVALID RECIPIENT ADDRESS',
        loading: false,
      }
    }
    if (!isCurrentBridgeRouteSupported) {
      return {
        disabled: true,
        text: 'ROUTE NOT SUPPORTED',
        loading: false,
      }
    }
    return {
      disabled: false,
      text:
        selectedToken === 'ETH'
          ? 'WRAP & BRIDGE ETH'
          : bridgeMode === 'direct'
            ? `BRIDGE ${selectedToken}`
            : 'FAST TRANSFER USDC',
      loading: false,
      icon: <Globe className="w-4 h-4" />,
    }
  }, [
    isWrapping,
    isTransferring,
    connectedAddress,
    amount,
    isInsufficient,
    sourceChain,
    destChain,
    recipient,
    recipientIsValid,
    bridgeMode,
    selectedToken,
    isUsdc,
    isCurrentBridgeRouteSupported,
  ])

  // Clean, standardized Fee & Route breakdown
  const breakdownItems = useMemo(() => {
    if (!amount || parseFloat(amount) <= 0) return []

    const zeroFeeRoute = isUcwCctpxRoute || speedTier === 'standard'
    const computedFee =
      bridgeMode === 'gateway' || zeroFeeRoute
        ? '0.00'
        : estimatedFee
          ? formatFeeDecimals(estimatedFee)
          : null

    const computedFeeNum = computedFee === null ? null : parseFloat(computedFee)
    const netReceived = computedFeeNum === null
      ? null
      : Math.max(0, parseFloat(amount) - (Number.isFinite(computedFeeNum) ? computedFeeNum : 0))

    const sourceName = getChainDisplayName(sourceChain)
    const destName = getChainDisplayName(destChain)

    const items: BreakdownItem[] = [
      {
        label: 'Transfer Route',
        tooltip: 'The path connecting your origin blockchain to the destination network.',
        value: (
          <div className="flex items-center gap-1.5 font-sans font-medium text-xs text-slate-200">
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className="w-4.5 h-4.5 rounded-full overflow-hidden flex items-center justify-center shrink-0 border border-white/10 shadow-sm"
                title={sourceName}
              >
                <ChainIcon
                  chainKeyOrIconId={sourceChain}
                  name={sourceName}
                  size={16}
                  className="rounded-full"
                />
              </div>
              <span className="text-slate-200 font-medium whitespace-nowrap">{sourceName}</span>
            </div>
            <span className="text-indigo-400 font-bold px-0.5 shrink-0">→</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className="w-4.5 h-4.5 rounded-full overflow-hidden flex items-center justify-center shrink-0 border border-white/10 shadow-sm"
                title={destName}
              >
                <ChainIcon
                  chainKeyOrIconId={destChain}
                  name={destName}
                  size={16}
                  className="rounded-full"
                />
              </div>
              <span className="text-slate-200 font-medium whitespace-nowrap">{destName}</span>
            </div>
          </div>
        ),
      },
      {
        label: 'Net Received',
        tooltip:
          selectedToken === 'ETH'
            ? `1:1 Auto-Wrap: ${amount} ETH wrapped into WETH on ${sourceName}, arriving as WETH in your Arc destination wallet.`
            : isUcwCctpxRoute
              ? `1:1: Circle's CCTP-X relayer fee is paid on ${sourceName} in its native token, so the full ${amount} ${selectedToken} arrives in your destination wallet.`
              : `The final net amount of ${selectedToken} that will arrive in your destination wallet.`,
        value:
          netReceived === null
            ? '—'
            : `${formatFeeDecimals(netReceived)} ${selectedToken === 'ETH' ? 'WETH' : selectedToken}`,
        highlight: true,
        highlightColor: 'text-indigo-400',
      },
      {
        label: 'Source Network Fee',
        tooltip:
          bridgeMode === 'gateway'
            ? 'Gateway Fast Transfer authorizes the burn with an off-chain EIP-712 signature: your wallet never submits a source-chain transaction, so you pay no source gas.'
            : isUcwCctpxRoute
              ? `Transaction gas to submit the bridge on ${sourceName}, plus Circle's CCTP-X relayer fee, which is paid in ${sourceName}'s native ${CHAIN_NATIVE_MAP[sourceChain]?.symbol || 'ETH'} on top of the bridged amount.`
              : 'Transaction gas fee required to initiate the bridge deposit on the source chain.',
        value:
          bridgeMode === 'gateway'
            ? '0.00 USDC'
            : isUcwCctpxRoute
              ? `${sourceChain === 'Arc_Testnet'
                  ? `~${((ESTIMATED_CCTP_BURN_GAS * SPEED_TIERS[speedTier].arcGas.maxFeePerGasGwei) / 1_000_000_000).toFixed(4)} USDC`
                  : `< 0.001 ${CHAIN_NATIVE_MAP[sourceChain]?.symbol || 'ETH'}`}${ucwCctpxRelayerFee ? ` + ~${formatFeeDecimals(ucwCctpxRelayerFee)} ${CHAIN_NATIVE_MAP[sourceChain]?.symbol || 'ETH'}` : ''}`
              : sourceChain === 'Arc_Testnet'
                ? `~${((ESTIMATED_CCTP_BURN_GAS * SPEED_TIERS[speedTier].arcGas.maxFeePerGasGwei) / 1_000_000_000).toFixed(4)} USDC`
                : `< 0.001 ${CHAIN_NATIVE_MAP[sourceChain]?.symbol || 'ETH'}`,
      },
      {
        label: 'Platform Fee',
        tooltip: isUsdc
          ? `Arcis platform routing fee: ${(BRIDGE_CUSTOM_FEE_CONFIG.percentageBps / 100).toFixed(2)}% (Min ${BRIDGE_CUSTOM_FEE_CONFIG.minUsdc.toFixed(2)} USDC, Max ${BRIDGE_CUSTOM_FEE_CONFIG.maxUsdc.toFixed(2)} USDC cap). 90% supports Arcis treasury, 10% Arc ecosystem.`
          : 'Non-USDC CCTP token bridge transfers do not carry platform fees (0.00).',
        value:
          platformFeeCharged && platformFeeAmount
            ? `${formatFeeDecimals(platformFeeAmount)} USDC`
            : '0.00 USDC',
      },
      {
        label: 'Estimated Arrival',
        tooltip: 'Expected time until the bridged funds are unlocked and available on the target network.',
        value:
          bridgeMode === 'gateway'
            ? `${SPEED_TIERS.turbo.timeEstimate.gateway} (${SPEED_TIERS.turbo.shortLabel})`
            : (SPEED_TIERS[speedTier] || SPEED_TIERS.fast).timeEstimate.cctpBridge,
      },
    ]

    return bridgeMode === 'gateway' || !isUsdc
      ? items.filter((item) => item.label !== 'Platform Fee')
      : items
  }, [
    amount,
    estimatedFee,
    bridgeMode,
    speedTier,
    platformFeeCharged,
    platformFeeAmount,
    sourceChain,
    destChain,
    selectedToken,
    isUsdc,
    isUcwCctpxRoute,
    ucwCctpxRelayerFee,
  ])

  if (!isOpen && !isInline) return null

  const headerActions = (
    <>
      <PrivacyLockButton
        isPrivate={isPrivateBridge}
        onToggle={() => setIsPrivateBridge((prev) => !prev)}
        disabled={isTransferring || !!successReceipt}
        size="md"
      />

      <Tooltip content="Bridge speed & fee settings" position="bottom" align="end">
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

  const recipientBadge = (
    <div className="flex items-center gap-1.5">
      {connectedAddress && !recipient && (
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

  const modeOptions = [
    {
      id: 'direct',
      label: 'DIRECT CCTP',
      icon: <Wallet className="w-3.5 h-3.5" />,
    },
    {
      id: 'gateway',
      label: 'GATEWAY FAST',
      icon: <Zap className="w-3.5 h-3.5 text-indigo-400" />,
    },
  ]

  const content = (
    <FintechCard
      title="BRIDGE"
      icon={<Globe className="w-5 h-5" />}
      isInline={isInline}
      maxWidth={isInline ? 640 : 540}
      minHeight={isInline ? (successReceipt ? 'auto' : 680) : undefined}
      headerActions={headerActions}
    >
      {successReceipt ? (
        <BridgeSuccessReceipt
          amount={successReceipt.amount}
          tokenSymbol={successReceipt.tokenSymbol || deliveredTokenSymbol}
          tokenIcon={successReceipt.tokenIcon || deliveredTokenIcon}
          sourceChain={successReceipt.sourceChain}
          destChain={successReceipt.destChain}
          sourceChainName={getChainDisplayName(successReceipt.sourceChain)}
          destChainName={getChainDisplayName(successReceipt.destChain)}
          sourceIconId={CHAIN_META[successReceipt.sourceChain]?.iconId || 'ethereum'}
          destIconId={CHAIN_META[successReceipt.destChain]?.iconId || 'ethereum'}
          recipient={recipient || connectedAddress}
          connectedAddress={connectedAddress}
          mode={successReceipt.mode}
          pending={isBridgePending}
          txHash={successReceipt.txHash}
          sourceTxHash={successReceipt.sourceTxHash}
          destTxHash={successReceipt.destTxHash}
          explorerUrl={successReceipt.explorerUrl}
          sourceExplorerUrl={successReceipt.sourceExplorerUrl}
          destExplorerUrl={successReceipt.destExplorerUrl}
          platformFee={
            successReceipt.mode === 'gateway' || !isUsdc
              ? undefined
              : platformFeeCharged && platformFeeAmount
                ? `${formatFeeDecimals(platformFeeAmount)} USDC`
                : '0.00 USDC (Free)'
          }
          networkFee={successReceipt.networkFee}
          sourceFeeGasless={successReceipt.mode === 'gateway'}
          destinationFee={successReceipt.destFee}
          netReceived={successReceipt.netReceived}
          isInline={isInline}
          onBridgeAgain={() => {
            setSuccessReceipt(null)
            setIsBridgePending(false)
            setBridgePhase(null)
            setAmount('')
            setError(null)
            setIsCanceledError(false)
          }}
          onClose={onClose}
        />
      ) : (
        <form onSubmit={handleTransfer} className="flex flex-col gap-4 flex-1 justify-between">
          <SegmentedModeSwitch
            options={modeOptions}
            activeId={bridgeMode}
            onChange={(mode) => {
              setBridgeMode(mode as 'direct' | 'gateway')
              setError(null)
              setIsCanceledError(false)
            }}
            disabled={isTransferring}
          />

          <BridgeLegacyWethBanner
            sourceChain={sourceChain}
            legacyWethBalance={walletBalances['Ethereum_Sepolia']?.legacyWeth}
            isUnwrapping={isUnwrappingLegacy}
            disabled={isTransferring}
            onUnwrap={handleUnwrapLegacyWeth}
          />

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

          <BridgeRouteSelector
            sourceChain={sourceChain}
            destChain={destChain}
            onOpenSourceModal={() => setShowSourceChainModal(true)}
            onOpenDestModal={() => setShowDestChainModal(true)}
            onSwapChains={handleSwapChains}
            disabled={isTransferring}
          />

          <AssetInputPanel
            label={bridgeMode === 'gateway' ? 'GATEWAY BRIDGE AMOUNT' : 'AMOUNT TO BRIDGE'}
            amount={amount}
            onAmountChange={(val) => {
              setAmount(val)
              if (error) setError(null)
              if (isCanceledError) setIsCanceledError(false)
            }}
            tokenSymbol={selectedToken}
            tokenIcon={TOKEN_ICON_MAP[selectedToken] || UsdcIcon}
            tokenListAvailable={canBridgeNonUsdc && availableBridgeTokens.length > 1}
            onSelectToken={() => setShowTokenModal(true)}
            maxDecimals={tokenDecimals}
            balance={activeBalance}
            onMaxClick={() => {
              if (selectedToken === 'ETH') {
                const rawBal = parseFloat(activeBalance) || 0
                const safeMax = Math.max(0, rawBal - 0.002).toFixed(4)
                setAmount(safeMax)
              } else {
                setAmount(maxBridgeAmount(activeBalance, amountReserves))
              }
            }}
            quickPercentages={[25, 50, 75, 100]}
            onSelectPercentage={(pct) => {
              if (selectedToken === 'ETH') {
                const rawBal = parseFloat(activeBalance) || 0
                const safeMax = Math.max(0, rawBal - 0.002)
                const next = ((safeMax * pct) / 100).toFixed(4)
                if (parseFloat(next) > 0) {
                  setAmount(next)
                }
              } else {
                const next = bridgeAmountForPercentage(activeBalance, pct, amountReserves)
                if (parseFloat(next) > 0) {
                  setAmount(next)
                }
              }
            }}
            error={isInsufficient}
            disabled={isTransferring}
          />

          <BridgeGatewayHelper
            bridgeMode={bridgeMode}
            isInsufficient={isInsufficient}
            sourceWalletBalance={sourceWalletBalance}
            sourceChain={sourceChain}
            onSwitchToDirect={() => {
              setBridgeMode('direct')
              setSpeedTier('fast')
              setError(null)
              setIsCanceledError(false)
            }}
          />

          {isDirectCctpMinApplies && amount && parseFloat(amount) > 0 && parseFloat(amount) < MIN_DIRECT_BRIDGE_AMOUNT && (
            <div className="text-[11px] text-amber-400/90 flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl animate-fade-in">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>Minimum transfer amount is {MIN_DIRECT_BRIDGE_AMOUNT.toFixed(2)} ${deliveredTokenSymbol} to cover CCTP network forwarder fees.</span>
            </div>
          )}

          <RecipientAddressField
            value={recipient}
            onChange={(val) => {
              setRecipient(val)
              setError(null)
              setIsCanceledError(false)
            }}
            label="RECIPIENT ADDRESS"
            placeholder="0x...."
            isValid={recipientIsValid}
            disabled={isTransferring}
            rightBadge={recipientBadge}
            chainFamily="evm"
            connectedAddress={connectedAddress}
          />

          {breakdownItems.length > 0 && (
            <TransactionBreakdown
              summaryTitle="Bridge Breakdown"
              items={breakdownItems}
              defaultOpen={false}
              context="bridge"
              isGatewayMode={bridgeMode === 'gateway'}
              showItemIcons={false}
            />
          )}

          <div className="pt-2">
            <FintechActionButton
              disabled={actionButtonState.disabled}
              loading={actionButtonState.loading}
              icon={actionButtonState.icon}
              onClick={() => handleTransfer()}
            >
              {actionButtonState.text}
            </FintechActionButton>
          </div>
        </form>
      )}

      <ChainSelectorModal
        isOpen={showSourceChainModal}
        onClose={() => setShowSourceChainModal(false)}
        chains={sourceChainsList}
        selectedChain={sourceChain}
        onSelectChain={(c) => {
          setSourceChain(c)
          setShowSourceChainModal(false)
          setError(null)
          setIsCanceledError(false)
          if (c === destChain) {
            const alternate = c === 'Arc_Testnet' ? 'Base_Sepolia' : 'Arc_Testnet'
            setDestChain(alternate)
          }
        }}
        getChainIconId={(c) => CHAIN_META[c]?.iconId || 'ethereum'}
      />

      <ChainSelectorModal
        isOpen={showDestChainModal}
        onClose={() => setShowDestChainModal(false)}
        chains={destChainsList}
        selectedChain={destChain}
        onSelectChain={(c) => {
          setDestChain(c)
          setShowDestChainModal(false)
          setError(null)
          setIsCanceledError(false)
          if (c === sourceChain) {
            const alternate = c === 'Arc_Testnet' ? 'Base_Sepolia' : 'Arc_Testnet'
            setSourceChain(alternate)
          }
        }}
        getChainIconId={(c) => CHAIN_META[c]?.iconId || 'ethereum'}
        title="Select Destination Network"
      />

      <TokenSelectorModal
        isOpen={showTokenModal}
        onClose={() => setShowTokenModal(false)}
        tokens={availableBridgeTokens}
        selectedToken={selectedToken}
        onSelectToken={(sym) => {
          setSelectedToken(sym as SupportedBridgeToken)
          setShowTokenModal(false)
          setAmount('')
          setError(null)
          setIsCanceledError(false)
        }}
        title="Select Token to Bridge"
      />
    </FintechCard>
  )

  const settingsModalWindow = (
    <BridgeSettingsModal
      isOpen={showSettings}
      onClose={() => setShowSettings(false)}
      speedTier={speedTier}
      onSelectTier={handleSpeedTierChange}
      onSave={() => {
        updateWalletSettings({ bridgeSpeedTier: speedTier })
        setShowSettings(false)
      }}
      disabled={isTransferring}
    />
  )

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
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overscroll-contain touch-none">
        {content}
      </div>
      {settingsModalWindow}
    </>
  )
}