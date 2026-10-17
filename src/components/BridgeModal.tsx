import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
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
  ChevronDown,
  Save,
  Sparkles,
} from 'lucide-react'
import { ChainIcon } from './common/ChainIcon'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { useGatewayBalance } from '../hooks/useGatewayBalance'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import { transferFromGateway, ensureChain, verifyDestinationUsdcMint, gatewayTransferFeeCeiling, resolveDestinationUsdcMintAmount, gatewayDeliveredUsdc } from '../services/gatewayService'
import { executeBridge, estimateBridgeCost, resolveBridgeNetworkFee } from '../services/bridgeService'
import { canAutoWrapEth, wrapEth, unwrapWeth, LEGACY_SEPOLIA_WETH } from '../services/wethService'
import {
  canUcwBridgeTokenFrom,
  executeUcwBridgeTransfer,
  pollCctpDestinationTx,
  fetchCctpFastFeeBps,
  fetchCctpForwardQuote,
} from '../services/bridgeUcwService'
import { executeUcwCctpxBridge, quoteUcwCctpxRelayerFee } from '../services/bridgeUcwCctpxService'
import { trackBridgeDelivery, type BridgeDeliveryHandle } from '../services/bridgeDeliveryPoll'
import { logger } from '../utils/logger'
import {
  executeUcwGatewayTransfer,
  pollForwardedGatewayTransfer,
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
import { SpeedFeeSelector } from './common/SpeedFeeSelector'
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
import { addTransaction, completeBridgeTransaction } from '../utils/history'
import { Tooltip } from './common/Tooltip'
import type { SupportedBridgeToken } from '../types/bridge'
import { TOKEN_ICON_MAP } from '../config/tokenIcons'
import {
  FintechCard,
  SegmentedModeSwitch,
  AssetInputPanel,
  DirectionSwitchButton,
  RecipientAddressField,
  TransactionBreakdown,
  type BreakdownItem,
  FintechActionButton,
  ChainSelectorModal,
  BridgeSuccessReceipt,
  TokenSelectorModal,
  type TokenItem,
} from './fintech'

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

  // Speed & Priority Tier Selection (Direct CCTP): 'standard' (Eco / CCTP Slow),
  // 'fast' (CCTP Fast 15-30s), 'turbo' (fastest Direct tier — carries its own
  // platform fee). The Gateway route is a separate mode picked through
  // SegmentedModeSwitch, not a speed tier.
  const [speedTier, setSpeedTier] = useState<SpeedTier>(walletSettings.bridgeSpeedTier)
  const [showSettings, setShowSettings] = useState(false)

  // Sync speedTier when connected wallet settings change (e.g. switching accounts)
  useEffect(() => {
    setSpeedTier(walletSettings.bridgeSpeedTier)
  }, [walletSettings.bridgeSpeedTier])

  useBodyScrollLock(showSettings || (!isInline && isOpen))

  // Mode Selection: 'direct' (CCTP via Wallet Balance) or 'gateway' (Fast Transfer via Gateway Unified Balance)
  const [bridgeMode, setBridgeMode] = useState<'direct' | 'gateway'>('direct')

  const handleSpeedTierChange = (tier: SpeedTier) => {
    // Speed tiers are a Direct CCTP property: Turbo is the fastest Direct tier
    // and carries its own platform fee (charged through App Kit's customFee),
    // not a synonym for the Gateway route. Picking any tier while the Gateway
    // route is active switches back to Direct; the route itself is chosen only
    // through the mode switch below.
    setSpeedTier(tier)
    setBridgeMode('direct')
    updateWalletSettings({ bridgeSpeedTier: tier })
  }

  // A chain hint only ever names a chain this tab can serve; anything else (a
  // Solana balance, a stale link) is ignored so the pair cannot start out
  // unbridgeable. See `isBridgeSelectableChain`.
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

  // Sync sourceChain and destChain when initialSourceChain updates (e.g. from Portfolio quick action)
  useEffect(() => {
    if (!initialSourceChain) return
    if (!isBridgeSelectableChain(initialSelectableChain)) {
      // Clamp back to the defaults rather than leaving an unbridgeable pair on
      // screen: an off-matrix hint is not a route the app can complete.
      setSourceChain('Arc_Testnet')
      setDestChain('Base_Sepolia')
      return
    }
    setSourceChain(initialSelectableChain)
    if (initialSelectableChain === 'Arc_Testnet') {
      // If bridging out of Arc Testnet, default destination to Base Sepolia
      setDestChain('Base_Sepolia')
    } else {
      // If bridging from any external network (Base Sepolia, Ethereum Sepolia, etc.), destination is Arc Testnet
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

  // This tab is EVM-only. `BRIDGE_SELECTABLE_CHAINS` excludes Solana and
  // Injective (config/bridgeConfig.ts) and every chain hint that reaches this
  // modal passes through `isBridgeSelectableChain`, so a Base58/`inj1…`
  // destination address is unreachable here: the recipient contract is the EVM
  // shape checked in `recipientIsValid` and nowhere else. Re-adding those chains
  // means widening the selectable list first, not restoring branches here.

  // Non-USDC CCTP Expanded Assets bridging is supported exclusively on Direct EVM-to-EVM routes.
  const isUcwDirect = bridgeMode === 'direct' && authSource === 'ucw'
  const canBridgeNonUsdc = bridgeMode === 'direct'
  // Wrapping native ETH needs an EIP-1193 provider to sign `deposit()`; a Circle
  // UCW wallet only signs challenges, so the auto-wrap tier stays EOA/passkey-only.
  const isSourceEthAutoWrap =
    canBridgeNonUsdc && authSource !== 'ucw' && canAutoWrapEth(sourceChain)
  // UCW direct bridges split by mechanism: CCTP v2 for USDC/EURC, CCTP-X for
  // wETH/cirBTC. CCTP-X fees are quoted separately (see below).
  const isUcwCctpxRoute =
    isUcwDirect && getUcwBridgeMechanism(selectedToken) === 'cctpx'

  // Circle only routes a non-USDC token where its registry lists a deployment on
  // BOTH ends, so token availability is a property of the selected pair rather
  // than of a chain (see config/bridgeRouteMatrix.ts).
  const isCurrentBridgeRouteSupported = isBridgeRouteSupported(selectedToken, sourceChain, destChain)

  // Auto-reset token to USDC or WETH if current mode or route does not support non-USDC or ETH auto-wrap
  useEffect(() => {
    if (!canBridgeNonUsdc && selectedToken !== 'USDC') {
      setSelectedToken('USDC')
    } else if (selectedToken === 'ETH' && !isSourceEthAutoWrap) {
      setSelectedToken('WETH')
    } else if (!isCurrentBridgeRouteSupported && selectedToken !== 'USDC') {
      // This pair cannot carry the token (no CCTP-X deployment on both ends); USDC
      // is the only token exempt from that rule, so it is the safe fallback.
      setSelectedToken('USDC')
    }
  }, [canBridgeNonUsdc, isSourceEthAutoWrap, isCurrentBridgeRouteSupported, selectedToken])

  const recipientIsValid = useMemo(() => {
    if (!recipient) return false
    return isValidEvmAddress(recipient)
  }, [recipient])

  // Load wallet testnet balances & Gateway unified balances
  const { walletBalances, refetch: refetchWalletBalances } =
    useWalletTestnetBalances(connectedAddress)
  const { balances: gatewayBalances, refresh: refreshGatewayBalances } =
    useGatewayBalance(connectedAddress)

  const sourceWalletBalance = walletBalances[sourceChain]?.usdc || '0.00'
  const sourceGatewayBalance =
    gatewayBalances.find((b) => b.chainKey === sourceChain)?.balance || '0.00'

  const isUsdc = selectedToken === 'USDC'
  const deliveredTokenSymbol = selectedToken === 'ETH' ? 'WETH' : selectedToken
  // The CCTP forwarder floor applies to every direct CCTP v2 route that pays a
  // forwarding fee — USDC and EURC, injected wallet or Circle UCW. The CCTP-X
  // tokens and the Gateway route have their own fee models and are excluded.
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

  // Tokens the selected pair can actually carry, straight from the route matrix.
  // The token dropdown is the only place this shows: a token the pair cannot
  // carry is simply absent, with no explanatory banner (the list is the answer).
  const pairBridgeableTokens = useMemo(
    () => filterBridgeableTokens(['USDC', 'EURC', 'WETH', 'ETH', 'cirBTC'], sourceChain, [destChain]),
    [sourceChain, destChain]
  )

  // A UCW wallet signs through Circle challenges, and each mechanism needs the
  // token's own contract to exist on the source chain: EURC and the CCTP-X tokens
  // (wETH, cirBTC) can only leave a chain that has their ERC-20 deployed.
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

  // Dynamic Platform Fee configuration from Arcis Treasury Fee Engine
  // (VITE_BRIDGE_FEE_BPS + VITE_BRIDGE_FEE_MIN_USDC + VITE_BRIDGE_FEE_MAX_USDC).
  // Calculates volume-based fee with floor & ceiling: clamp(amount * bps / 10000, min, max).
  // Non-USDC CCTP bridge transfers do not carry platform fees per Circle protocol rules.
  const platformFeeAmount = isUsdc ? getBridgePlatformFeeValue(amount) : 0
  // One policy, one source: the fee is only charged — and only enforced against
  // the balance — where the execution path can actually collect it (Direct CCTP
  // via App Kit; never for UCW or the Gateway paths).
  const platformFeeCharged = isUsdc && isBridgePlatformFeeCharged({ bridgeMode, authSource })
  const requiredDebit = amount
    ? parseFloat(amount) + (platformFeeCharged ? platformFeeAmount : 0)
    : 0
  const isInsufficient = amount ? requiredDebit > parseFloat(activeBalance) : false

  // What execution will debit on top of the entered amount. MAX and the
  // percentage chips must reserve both, otherwise clicking MAX is rejected as
  // INSUFFICIENT the moment it fills the field:
  //   • Direct CCTP reserves the platform fee calculated for the active balance.
  //   • Gateway pre-flight requires balance ≥ amount + maxFee (1.0 USDC floor).
  const amountReserves = {
    platformFeeUsdc: platformFeeCharged ? getBridgePlatformFeeValue(activeBalance) : 0,
    gatewayMaxFeeUsdc:
      bridgeMode === 'gateway' ? gatewayMaxFeeUsdc(parseFloat(activeBalance) || 0) : 0,
  }

  // One phase owns the whole flow, so the CTA text and the broadcast can never
  // disagree: 'wrapping' is the ETH → WETH step, 'executing' covers
  // approve/burn/awaiting-mint on every route, and `null` is idle.
  const [bridgePhase, setBridgePhase] = useState<'wrapping' | 'executing' | null>(null)
  const isTransferring = bridgePhase === 'executing'
  const isWrapping = bridgePhase === 'wrapping'

  // Background destination-delivery tracking: one poll per delivery, cancelled
  // when this modal goes away instead of running for ~15 minutes off-screen.
  const deliveryHandlesRef = useRef<BridgeDeliveryHandle[]>([])
  const stopTrackedDeliveries = useCallback(() => {
    for (const handle of deliveryHandlesRef.current) handle.cancel()
    deliveryHandlesRef.current = []
  }, [])
  /**
   * Registers a background delivery poll. The registry deduplicates by delivery
   * key, so a joiner (the recovery path re-tracking the same burn) does not
   * become the owner of the running poll and cannot cancel someone else's work.
   */
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

  // Estimate-loop adapter reuse: `createViemAdapter` builds a fresh adapter on
  // every call, and the debounced estimate used to build one per keystroke.
  // Cached per (provider, chain) only — the execute path keeps its own adapter,
  // so a cached estimate adapter is never the one signing a transfer.
  // P05: sequence guard for the debounced fee estimate. Only the latest
  // scheduled quote may write fee state; slower earlier quotes resolve
  // silently. Quote-only: execution paths never read this ref.
  const estimateSeqRef = useRef(0)
  const estimateAdapterRef = useRef<{ provider: any; chain: string; adapter: any } | null>(null)
  const getEstimateAdapter = useCallback(async (provider: any, chain: string) => {
    const cached = estimateAdapterRef.current
    if (cached && cached.provider === provider && cached.chain === chain) return cached.adapter
    const adapter = await createViemAdapter(provider)
    estimateAdapterRef.current = { provider, chain, adapter }
    return adapter
  }, [])

  // Fee estimation
  const [estimatedFee, setEstimatedFee] = useState<string | null>(null)
  // Circle's CCTP-X relayer fee, quoted in the source chain's native token. It
  // is paid on top of the transfer (never deducted from it), so it is shown
  // beside the gas estimate instead of inside Net Received.
  const [ucwCctpxRelayerFee, setUcwCctpxRelayerFee] = useState<string | null>(null)

  // Systematic input and state clearing on wallet disconnect
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

  // Closing or unmounting the modal stops its background mint polls instead of
  // leaving a ~15-minute tracker running against a receipt nobody is watching.
  // The receipt itself is unchanged: the delivery stays pending and is resolved
  // by the same tracker if the user reopens and it is still in flight.
  useEffect(() => {
    if (!isOpen) stopTrackedDeliveries()
  }, [isOpen, stopTrackedDeliveries])

  useEffect(() => () => stopTrackedDeliveries(), [stopTrackedDeliveries])

  // Reset states on open
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

  // Direct CCTP fee fallback: Circle's Fast Transfer fee is route-specific and
  // changes over time (Circle: "Do not hardcode fee values"), so quote the live
  // fee API first and only fall back to the legacy static estimate when the
  // quote itself is unavailable.
  const quoteDirectCctpFee = useCallback(async (): Promise<string> => {
    if (speedTier === 'standard') return '0.00' // Standard transfers are free
    try {
      const feeBps = await fetchCctpFastFeeBps(sourceChain, destChain)
      if (feeBps !== null) {
        return formatFeeDecimals((parseFloat(amount || '0') * feeBps) / 10000)
      }
    } catch {
      // Quote unavailable → keep the static fallback below.
    }
    return '0.20'
  }, [speedTier, sourceChain, destChain, amount])

  // UCW direct CCTP transfers are submitted through Circle's Forwarding Service:
  // there is no destination wallet signing the mint, so the displayed cost is
  // the CCTP protocol fee (Fast tier only; Standard is free) PLUS the live
  // forwarding fee that covers destination gas. Quoting only the protocol fee
  // understated the real cost and left the receipt's pending net amount wrong.
  const quoteUcwDirectBridgeFee = useCallback(async (): Promise<string> => {
    const threshold = speedTier === 'standard' ? 2000 : 1000
    try {
      const quote = await fetchCctpForwardQuote(sourceChain, destChain, threshold)
      if (quote) {
        const protocolFee = (parseFloat(amount || '0') * quote.minimumFeeBps) / 10000
        const forwardFee = Number(quote.forwardFeeSubunits) / 1_000_000
        return formatFeeDecimals(protocolFee + forwardFee)
      }
    } catch {
      // Quote unavailable → fall back to the legacy direct estimate below.
    }
    return quoteDirectCctpFee()
  }, [speedTier, sourceChain, destChain, amount, quoteDirectCctpFee])

  // Debounced fee estimation
  useEffect(() => {
    if (isTransferring) return

    // Each quote belongs to the amount it was computed for. Drop the previous
    // quote as soon as an input changes so the breakdown never pairs a stale
    // fee with a new amount; the debounced quote below replaces it.
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
        // Gateway Fast quotes nothing: Arcis charges no platform fee on that
        // route and Circle bills its own cost straight from the user's Gateway
        // balance, so no fee is deducted from the bridged amount and there is no
        // fee row or quote to produce for it (in any auth mode).
        if (bridgeMode === 'gateway') return

        if (authSource === 'ucw') {
          if (isUcwCctpxRoute) {
            // CCTP-X (wETH, cirBTC): Circle's relayer fee is paid in the source
            // chain's native token ON TOP of the transfer, so nothing is
            // deducted from the bridged amount. The relayer fee is disclosed in
            // the Source Network Fee row instead of a Net Received haircut.
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

          // Circle UCW CCTP v2 transfer fee estimation (live Circle fee quote)
          if (isCurrent()) {
            setEstimatedFee(await quoteUcwDirectBridgeFee())
          }
          return
        }

        // Direct CCTP mode cost estimation
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
          // Only the fees deducted from the bridged amount (CCTP provider +
          // forwarder) may reduce Net Received. The App Kit `kit` entry is
          // Arcis's platform fee, added ON TOP of the transfer amount, so it is
          // excluded here and disclosed in its own Platform Fee row instead.
          const totalFeeInUsdc = sumBridgeDeductedFees(cost?.fees as any)

          if (isCurrent()) {
            setEstimatedFee(
              totalFeeInUsdc > 0 ? formatFeeDecimals(totalFeeInUsdc) : await quoteDirectCctpFee()
            )
          }
        }
      } catch (err) {
        if (isCurrent() && bridgeMode !== 'gateway') {
          // A CCTP-X fee is quoted in the source native token, so the CCTP v2
          // USDC estimate would be both wrong and in the wrong unit.
          setEstimatedFee(isUcwCctpxRoute ? '0.00' : await quoteDirectCctpFee())
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
    quoteDirectCctpFee,
    quoteUcwDirectBridgeFee,
    getEstimateAdapter,
  ])

  // Chains formatting for selector modal. Both lists are narrowed by the matrix so
  // the route selectors can only produce a pair the selected token can bridge.
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

    // Fail closed on the pair itself. The token effect keeps `selectedToken` in
    // step with the route, but an execution must never depend on that: a chain
    // swap or a restored session can still race it, and the SDK error for an
    // unsupported pair is far less clear than this one.
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
      // Name the token actually being bridged and the balance actually compared:
      // the message used to say "USDC" even when the user was bridging WETH/EURC.
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

    // Circle UCW can only sign on chains it supports. Validate the route against
    // the shared fail-closed chain map BEFORE creating a broadcast, so an
    // unsupported network shows one clear inline error instead of a pending
    // transaction that would otherwise be signed on the wrong blockchain.
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
          // Circle UCW Gateway Fast Transfer via EIP-712 BurnIntent & destination gatewayMint
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
            // Circle's execute response omits the hash once the Forwarding
            // Service settles, so the mint hash is resolved through the wallet
            // session instead of a storage read inside the service.
            resolveChallengeTx: resolveUcwChallengeTx,
            onStepProgress: (step) => {
              if (step === 'checking_balance') {
                updateBroadcast(broadcastId, {
                  title: 'Verifying Gateway Balance...',
                  badgeText: 'Verifying',
                })
              } else if (step === 'preparing_wallet') {
                updateBroadcast(broadcastId, {
                  title: 'Preparing Multi-Chain Wallet...',
                  badgeText: 'Setup',
                })
              } else if (step === 'signing') {
                updateBroadcast(broadcastId, {
                  title: 'Awaiting Authorization Signature...',
                  badgeText: 'Authorize',
                })
              } else if (step === 'gateway_api') {
                updateBroadcast(broadcastId, {
                  title: 'Processing Gateway Transfer...',
                  badgeText: 'Gateway API',
                })
              } else if (step === 'forwarding') {
                updateBroadcast(broadcastId, {
                  title: 'Circle is minting USDC...',
                  badgeText: 'Forwarding',
                })
              } else if (step === 'minting') {
                updateBroadcast(broadcastId, {
                  title: 'Circle is minting USDC...',
                  badgeText: 'Minting',
                })
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
          // Circle UCW CCTP-X (wETH, cirBTC): the UCW wallet signs the exact
          // calldata Circle's own encoder produces for the route's CCTP-X proxy,
          // instead of a TokenMessenger burn. The quote carries the forward leg
          // and its fee, which is paid as the challenge's native amount.
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
          mintTxHash = '' // Destination tx is submitted by Circle's relayer (forwarded)
          sourceExplorerUrl = ucwCctpxResult.sourceExplorerUrl
          destExplorerUrl = undefined
          ucwChallengeId = ucwCctpxResult.challengeId
        } else {
          // Circle UCW Direct CCTP v2 Bridge via smart contract execution (USDC, EURC)
          if (!executeUcwContract) {
            throw new Error('Wallet contract execution module is not initialized. Please refresh or re-authenticate.')
          }

          const ucwResult = await executeUcwBridgeTransfer({
            // Route the burn through Circle's Forwarding Service so the mint is
            // submitted on the destination chain; without the hook nothing
            // mints and the transfer stays pending forever.
            useForwarder: true,
            // EURC uses the same TokenMessengerV2; only the token address and
            // decimals differ, which the service resolves from the matrix.
            tokenSymbol: selectedToken,
            minFinalityThreshold: speedTier === 'standard' ? 2000 : 1000,
            amount,
            sourceChain,
            destChain,
            recipientAddress: targetRecipient,
            connectedAddress,
            executeUcwContract,
            // Same reason as the Gateway path: a burn whose challenge response
            // carries no hash is resolved by the wallet session callback.
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
          mintTxHash = '' // Destination tx will be resolved asynchronously on the destination chain
          sourceExplorerUrl = ucwResult.sourceExplorerUrl
          destExplorerUrl = undefined
          ucwChallengeId = ucwResult.challengeId
        }
      } else if (bridgeMode === 'direct') {
        // Direct CCTP Bridge via App Kit SDK
        if (!provider) throw new Error('No wallet provider available')

        // Ensure wallet network is aligned with the source chain before bridging
        const sourceChainDef = CHAIN_DEFS[sourceChain]
        if (sourceChainDef && typeof provider.request === 'function') {
          await ensureChain(provider, sourceChainDef)
        }

        // Auto-Wrap ETH -> WETH on source chain if user selected native ETH
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
            // The wrap finished; approve/burn still follow, so execution
            // continues. A failed wrap already reset the phase to null above.
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

        // Strict verification: Ensure result is valid and not in error state
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

        // `result.txHash` and the burn step are source-chain transactions; they are never a mint.
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
        // Gateway Fast Transfer
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
          // transferFromGateway switches the wallet to the destination chain for
          // the mint. Restore the pre-flow (source) network afterwards as a
          // best-effort action: a rejected or failed switch prompt must never
          // change the result of the transfer itself.
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

      // Gateway delivery: Circle mints the FULL principal to the recipient (it
      // bills its own cost from the unified Gateway balance instead), so the only
      // thing worth reading here is what the mint receipt proves was delivered.
      let gatewayReceivedAmount: string | undefined = undefined
      if (isGateway && destinationConfirmed && mintTxHash) {
        const mintedSubunits = await resolveDestinationUsdcMintAmount(destChain, mintTxHash, targetRecipient)
        gatewayReceivedAmount = mintedSubunits === null ? undefined : gatewayDeliveredUsdc(mintedSubunits) ?? undefined
      }

      const candidateMintHash = mintTxHash
      const confirmedMintTxHash = destinationConfirmed ? candidateMintHash : ''
      setIsBridgePending(!destinationConfirmed)
      // Net Received. The CCTP routes deduct a protocol fee from the minted
      // amount; Gateway never does, so it settles on the full bridged amount
      // unless the mint receipt proves a different delivery. The fee-derived
      // estimate is only ever the CCTP routes' last resort. Fee resolution is
      // async, so it happens here; the receipt's field selection itself is the
      // pure `buildBridgeReceipt` (utils/bridgeReceipt.ts).
      let fallbackFee: string | undefined
      if (!isGateway && destinationConfirmed && !confirmedCctpReceivedAmount) {
        fallbackFee =
          estimatedFee ||
          (isUcwCctpxRoute
            ? '0.00'
            : authSource === 'ucw'
              ? await quoteUcwDirectBridgeFee()
              : await quoteDirectCctpFee())
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

      // Real source-chain gas for the receipt's Network Fee row, read from the
      // mined burn receipt. Undefined → the row is omitted; never an estimate.
      const networkFeeText =
        !isGateway && burnTxHash
          ? await resolveBridgeNetworkFee(sourceChain, burnTxHash)
          : undefined

      // Real destination-chain gas for the receipt's Destination Network Fee row, read
      // from the mined mint receipt and denominated in the destination chain's
      // native token (ETH on Base, USDC on Arc) — exactly like the source row.
      // The mint is submitted by Circle's Forwarding Service, so this is the
      // gas the destination network charged for the mint, never an estimate.
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

      // Background Resolution for a destination mint correlated to the submitted source burn.
      if (!destinationConfirmed) {
        const deliveryKey =
          isGateway && gatewayTransferId
            ? `gateway:${gatewayTransferId}`
            : burnTxHash && burnTxHash.startsWith('0x')
              ? `cctp:${burnTxHash.toLowerCase()}`
              : null
        if (deliveryKey) trackDelivery(deliveryKey, async (signal) => {
          try {
            let resolvedDestTx: string | undefined = undefined

            if (isGateway && gatewayTransferId) {
              bridgeLog.debug('Polling Circle Gateway Forwarding for real destination tx:', gatewayTransferId)
              const forwarded = await pollForwardedGatewayTransfer(gatewayTransferId, {
                maxAttempts: 30, intervalMs: 2500, destChain, recipient: targetRecipient, amount, signal,
              })
              if ((forwarded.status === 'confirmed' || forwarded.status === 'finalized') && forwarded.txHash) resolvedDestTx = forwarded.txHash
            } else if (!isGateway && burnTxHash && burnTxHash.startsWith('0x')) {
              bridgeLog.debug('Polling Circle CCTP destination mint for real destination tx:', burnTxHash)
              const cctpDest = await pollCctpDestinationTx({
                sourceChain,
                destChain,
                burnTxHash,
                recipientAddress: targetRecipient,
                amount,
                tokenSymbol: deliveredTokenSymbol,
                mintTxHash: mintTxHash || undefined,
                // Slow destinations (e.g. Ethereum Sepolia standard finality)
                // can take ~13 minutes to mint; a 2-minute budget stranded the
                // receipt on "Bridge Pending" even after a successful burn.
                maxAttempts: 300,
                intervalMs: 3000,
                signal,
              })
              if (cctpDest.status === 'confirmed' && cctpDest.destTxHash && /^0x[0-9a-fA-F]{64}$/.test(cctpDest.destTxHash)) {
                resolvedDestTx = cctpDest.destTxHash
                confirmedCctpReceivedAmount = cctpDest.receivedAmount
              } else {
                bridgeLog.warn(
                  `Background CCTP destination poll ended without confirmation for burn ${burnTxHash} → status: ${cctpDest.status}`
                )
              }
            }

            if (resolvedDestTx && isGateway && !await verifyDestinationUsdcMint(destChain, resolvedDestTx, targetRecipient, amount, gatewayTransferFeeCeiling(amount))) {
              resolvedDestTx = undefined
            }
            if (resolvedDestTx) {
              bridgeLog.debug('Real destination tx confirmed on-chain:', resolvedDestTx)
              const resolvedExplorerUrl = getExplorerTxUrl(destChain, resolvedDestTx)
              // Same mechanism as the source Network Fee row: the destination
              // mint's real gas in the destination chain's native token.
              const resolvedDestFeeText = await resolveBridgeNetworkFee(destChain, resolvedDestTx)

              // Gateway only: the mint receipt proves the delivered amount, so
              // the receipt settles on real delivery as soon as the mint lands.
              let resolvedGatewayReceivedAmount: string | undefined = undefined
              if (isGateway) {
                const mintedSubunits = await resolveDestinationUsdcMintAmount(destChain, resolvedDestTx, targetRecipient)
                resolvedGatewayReceivedAmount =
                  mintedSubunits === null ? undefined : gatewayDeliveredUsdc(mintedSubunits) ?? undefined
              }

              // Update Success Receipt Modal state in real-time. `undefined` in
              // the patch means "keep what the receipt already shows".
              setSuccessReceipt((prev: any) =>
                applyBridgeDelivery(prev, {
                  txHash: isGateway ? resolvedDestTx : undefined,
                  destTxHash: resolvedDestTx,
                  explorerUrl: isGateway ? resolvedExplorerUrl : undefined,
                  destExplorerUrl: resolvedExplorerUrl,
                  netReceived: isGateway ? resolvedGatewayReceivedAmount : confirmedCctpReceivedAmount,
                  destFee: resolvedDestFeeText,
                  tokenSymbol: deliveredTokenSymbol,
                  tokenIcon: deliveredTokenIcon,
                })
              )
              setIsBridgePending(false)
              completeBridgeTransaction({
                sourceTxHash: burnTxHash, destTxHash: resolvedDestTx, amount, tokenSymbol: deliveredTokenSymbol, sourceChain, destChain,
                recipient: targetRecipient, userAddress: connectedAddress, isPrivate: isPrivateBridge,
              })
              onSuccess(amount, resolvedDestTx)

              // Update Floating Broadcast Notification in real-time
              updateBroadcast(broadcastId, {
                title: 'Bridge Completed Successfully',
                status: 'success',
                badgeText: 'Confirmed',
                details: {
                  amount,
                  tokenSymbol: deliveredTokenSymbol,
                  tokenIcon: deliveredTokenIcon,
                  sourceChain,
                  destChain,
                  bridgeMode,
                  network: broadcastNetwork,
                  txHash: isGateway ? resolvedDestTx : burnTxHash,
                  destTxHash: resolvedDestTx,
                  sourceTxHash: isGateway ? undefined : burnTxHash,
                  explorerUrl: isGateway ? resolvedExplorerUrl : primaryExplorerUrl,
                  destExplorerUrl: resolvedExplorerUrl,
                  sourceExplorerUrl: isGateway ? undefined : sourceExplorerUrl,
                },
              })
            }
          } catch (pollingErr) {
            bridgeLog.warn('Background destination tx resolution notice:', pollingErr)
          }
        })
      }
    } catch (err: any) {
      bridgeLog.error('Execution error:', err)
      setBridgePhase(null)

      // Recovery: a Direct CCTP transfer that failed AFTER the source burn is
      // not a failure — the USDC is already burned. Reporting it as an error
      // would invite a retry that burns a second time, so fall back to the
      // pending receipt and keep polling for the destination mint.
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
        // Recovery: the burn landed but the mint has not been proved, so the
        // receipt keeps the source hash and reports no net amount.
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

        // Background resolution of the destination mint (same poll as the happy
        // path) — registered under the same delivery key, so a burn already
        // being tracked joins that poll instead of starting a second one.
        trackDelivery(`cctp:${burnedTxHash.toLowerCase()}`, async (signal) => {
          try {
            const cctpDest = await pollCctpDestinationTx({
              sourceChain,
              destChain,
              burnTxHash: burnedTxHash,
              recipientAddress: targetRecipient,
              amount,
              tokenSymbol: deliveredTokenSymbol,
              mintTxHash: failedMintTxHash,
              maxAttempts: 300,
              intervalMs: 3000,
              signal,
            })
            const resolvedDestTx =
              cctpDest.status === 'confirmed' && cctpDest.destTxHash && /^0x[0-9a-fA-F]{64}$/.test(cctpDest.destTxHash)
                ? cctpDest.destTxHash
                : undefined
            if (!resolvedDestTx) {
              bridgeLog.warn('Recovery: destination mint still unconfirmed after polling')
              return
            }
            const resolvedExplorerUrl = getExplorerTxUrl(destChain, resolvedDestTx)
            // Destination-chain gas, read from the resolved mint receipt.
            const resolvedDestFeeText = await resolveBridgeNetworkFee(destChain, resolvedDestTx).catch(() => undefined)
            setSuccessReceipt((prev: any) =>
              applyBridgeDelivery(prev, {
                destTxHash: resolvedDestTx,
                destExplorerUrl: resolvedExplorerUrl,
                netReceived: cctpDest.receivedAmount,
                destFee: resolvedDestFeeText,
                tokenSymbol: deliveredTokenSymbol,
                tokenIcon: deliveredTokenIcon,
              })
            )
            setIsBridgePending(false)
            completeBridgeTransaction({
              sourceTxHash: burnedTxHash, destTxHash: resolvedDestTx, amount, tokenSymbol: deliveredTokenSymbol,
              sourceChain, destChain, recipient: targetRecipient, userAddress: connectedAddress,
              isPrivate: isPrivateBridge,
            })
            onSuccess(amount, resolvedDestTx)
            updateBroadcast(broadcastId, {
              type: 'bridge',
              title: 'Bridge Completed Successfully',
              status: 'success',
              badgeText: 'Confirmed',
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
                destTxHash: resolvedDestTx,
                destExplorerUrl: resolvedExplorerUrl,
              },
            })
          } catch (pollingErr) {
            bridgeLog.warn('Recovery destination polling notice:', pollingErr)
          }
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

    // Gateway mints the full principal — Circle bills its own cost from the user's
    // Gateway balance — so nothing is subtracted from Net Received on that route.
    // A fee that has not been quoted yet renders as "—" instead of a made-up
    // number: the breakdown used to show 0.20 and then swap it for the real
    // quote, briefly displaying a value that never existed. CCTP-X and the
    // Standard tier really are zero (that fee is paid in source gas), so they
    // keep their 0.00.
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
    const sourceIconId = getChainIconId(sourceChain) || CHAIN_META[sourceChain]?.iconId || 'ethereum'
    const destIconId = getChainIconId(destChain) || CHAIN_META[destChain]?.iconId || 'ethereum'

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

    // Gateway Fast is a route Circle and Arc provide end to end: Arcis charges no
    // platform fee on it and Circle bills its own cost from the user's Gateway
    // balance, so no Platform Fee row is presented for that route.
    // Non-USDC CCTP routes also carry no platform fee.
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
    authSource,
    selectedToken,
    isUsdc,
    isUcwCctpxRoute,
    ucwCctpxRelayerFee,
  ])

  // NOTE: Keep every hook above this line unconditional. The render bailout for
  // a closed modal must run after all hooks so hook order never changes between
  // renders (React throws "Rendered more/fewer hooks" otherwise).
  if (!isOpen && !isInline) return null

  // Header actions with Privacy, Settings and Close
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

  // Quick fill recipient badge. EVM-only: the Solana/Injective quick-fill
  // buttons that used to live here could never render (both chains are
  // unselectable in this tab), so the connected EVM address is the only fill.
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
      {/* Success Receipt Screen */}
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
          // Gateway Fast carries no Arcis platform fee, so no Platform Fee row is
          // requested for it; every other bridge route still reports the real one.
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
          {/* Mode Switcher */}
          <SegmentedModeSwitch
            options={modeOptions}
            activeId={bridgeMode}
            onChange={(mode) => {
              // Route and speed are independent: switching routes keeps the
              // selected Direct tier (turbo no longer means "gateway").
              setBridgeMode(mode as 'direct' | 'gateway')
              setError(null)
              setIsCanceledError(false)
            }}
            disabled={isTransferring}
          />

          {/* Legacy Sepolia WETH Migration Notice */}
          {sourceChain === 'Ethereum_Sepolia' &&
            walletBalances['Ethereum_Sepolia']?.legacyWeth &&
            parseFloat(walletBalances['Ethereum_Sepolia'].legacyWeth) > 0 && (
              <div className="p-3 rounded-2xl border bg-amber-500/10 border-amber-500/25 text-amber-300 text-xs flex items-center justify-between gap-3 animate-fade-in">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                  <div className="min-w-0">
                    <p className="font-semibold text-amber-200">
                      Legacy Sepolia WETH ({walletBalances['Ethereum_Sepolia'].legacyWeth} WETH)
                    </p>
                    <p className="text-[11px] text-amber-300/80 truncate">
                      CCTP-X routes via official Sepolia WETH (0xfff9...). Unwrap legacy token back to ETH to bridge.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={isUnwrappingLegacy || isTransferring}
                  onClick={handleUnwrapLegacyWeth}
                  className="px-3 py-1.5 rounded-xl font-medium text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 transition shrink-0 disabled:opacity-50 cursor-pointer"
                >
                  {isUnwrappingLegacy ? 'Unwrapping...' : 'Unwrap to ETH'}
                </button>
              </div>
            )}

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

          {/* Route Selection Panel (Source & Destination Networks) */}
          <div className="bg-[#121626]/85 border border-white/[0.06] rounded-2xl p-3.5 sm:p-4 flex items-center justify-between gap-2.5 sm:gap-3">
            {/* Source Network */}
            <div className="flex-1 min-w-0">
              <div
                className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 ml-1"
                style={{ fontFamily: 'var(--font-app)' }}
              >
                FROM NETWORK
              </div>
              <button
                type="button"
                disabled={isTransferring}
                onClick={() => setShowSourceChainModal(true)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-indigo-500/40 transition-all cursor-pointer select-none text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                    <ChainIcon
                      chainKeyOrIconId={sourceChain}
                      name={getChainDisplayName(sourceChain)}
                      size={20}
                      className="rounded-full"
                    />
                  </div>
                  <span className="text-xs font-semibold text-white truncate">
                    {getChainDisplayName(sourceChain)}
                  </span>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
            </div>

            {/* Invert Route Button */}
            <div className="pt-5 shrink-0">
              <DirectionSwitchButton
                onClick={handleSwapChains}
                disabled={isTransferring}
                orientation="horizontal"
              />
            </div>

            {/* Destination Network */}
            <div className="flex-1 min-w-0">
              <div
                className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 ml-1"
                style={{ fontFamily: 'var(--font-app)' }}
              >
                TO NETWORK
              </div>
              <button
                type="button"
                disabled={isTransferring}
                onClick={() => setShowDestChainModal(true)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-indigo-500/40 transition-all cursor-pointer select-none text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center shrink-0">
                    <ChainIcon
                      chainKeyOrIconId={destChain}
                      name={getChainDisplayName(destChain)}
                      size={20}
                      className="rounded-full"
                    />
                  </div>
                  <span className="text-xs font-semibold text-white truncate">
                    {getChainDisplayName(destChain)}
                  </span>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
            </div>
          </div>

          {/* Amount Input Panel */}
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

          {/* Smart Gateway Balance Helper: suggest switching to Direct CCTP if user has wallet balance */}
          {bridgeMode === 'gateway' && isInsufficient && parseFloat(sourceWalletBalance) > 0 && (
            <div className="text-[11px] text-indigo-300 bg-indigo-500/10 border border-indigo-500/25 rounded-xl p-3 flex items-start gap-2.5 animate-fade-in">
              <Zap className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <p className="leading-relaxed">
                  Your Gateway unified balance on {getChainDisplayName(sourceChain)} is insufficient, but you hold <strong>{sourceWalletBalance} USDC</strong> in your wallet.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setBridgeMode('direct')
                    setSpeedTier('fast')
                    setError(null)
                    setIsCanceledError(false)
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-300 hover:text-white bg-indigo-500/20 hover:bg-indigo-500/35 border border-indigo-500/30 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  <span>Switch to Direct CCTP</span>
                </button>
              </div>
            </div>
          )}

          {/* Minimum Amount Warning for CCTP Direct */}
          {isDirectCctpMinApplies && amount && parseFloat(amount) > 0 && parseFloat(amount) < MIN_DIRECT_BRIDGE_AMOUNT && (
            <div className="text-[11px] text-amber-400/90 flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl animate-fade-in">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>Minimum transfer amount is {MIN_DIRECT_BRIDGE_AMOUNT.toFixed(2)} {deliveredTokenSymbol} to cover CCTP network forwarder fees.</span>
            </div>
          )}

          {/* Recipient Address Field */}
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

          {/* Simplified Transaction Breakdown Accordion */}
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

          {/* Smart CTA Button */}
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

      {/* Source Network Selector Modal */}
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

      {/* Destination Network Selector Modal */}
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

      {/* Token Selector Modal for Multi-Token Bridging */}
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

  // Bridge Settings Window / Modal rendered over document.body via Portal
  const settingsModalWindow =
    showSettings && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in overscroll-contain touch-none"
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
                      Bridge Settings
                    </h3>
                    <p className="text-[11px] text-slate-400">Execution speed and network gas priority</p>
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

              {/* Speed & Execution Priority Section */}
              <div className="space-y-2 pt-1">
                <SpeedFeeSelector
                  selectedTier={speedTier}
                  onSelectTier={handleSpeedTierChange}
                  context="bridge"
                  disabled={isTransferring}
                />
              </div>

              {/* Save button */}
              <button
                type="button"
                onClick={() => {
                  updateWalletSettings({ bridgeSpeedTier: speedTier })
                  setShowSettings(false)
                }}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-400 hover:to-purple-500 transition-all cursor-pointer shadow-md shadow-indigo-500/20"
              >
                <Save className="w-4 h-4" />
                <span>Save Settings</span>
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
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overscroll-contain touch-none">
        {content}
      </div>
      {settingsModalWindow}
    </>
  )
}