import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useClearOnWalletDisconnect } from '../hooks/useClearOnWalletDisconnect'
import {
  X,
  Globe,
  Settings,
  Wallet,
  Zap,
  AlertTriangle,
  Ban,
  ChevronDown,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { useGatewayBalance } from '../hooks/useGatewayBalance'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import { transferFromGateway, ensureChain, verifyDestinationUsdcMint, gatewayTransferFeeCeiling, resolveDestinationUsdcMintAmount, gatewayDeliveredUsdc } from '../services/gatewayService'
import { executeBridge, estimateBridgeCost, resolveBridgeNetworkFee } from '../services/bridgeService'
import { executeUcwBridgeTransfer, pollCctpDestinationTx, fetchCctpFastFeeBps, fetchCctpForwardQuote } from '../services/bridgeUcwService'
import {
  executeUcwGatewayTransfer,
  pollForwardedGatewayTransfer,
  mapChainKeyToCircleBlockchain,
} from '../services/gatewayUcwService'
import { createViemAdapter } from '../services/sendService'
import { normalizeAppError } from '../utils/errorNormalizer'
import {
  maxBridgeAmount,
  bridgeAmountForPercentage,
  gatewayMaxFeeUsdc,
  sumBridgeDeductedFees,
} from '../utils/bridgeAmountUtils'
import { getExplorerTxUrl } from '../config/sendConfig'
import { PrivacyLockButton } from './privacy/PrivacyLockButton'
import { useBroadcast } from './BroadcastNotification'
import { SpeedFeeSelector } from './common/SpeedFeeSelector'
import { SPEED_TIERS, type SpeedTier } from '../config/feeTiers'
import { useMultiChainWallet } from '../hooks/useMultiChainWallet'
import {
  CHAIN_META,
  CHAIN_DEFS,
  getChainDisplayName,
  getChainIconId,
  BRIDGE_SELECTABLE_CHAINS,
} from '../config/bridgeConfig'
import {
  getBridgeFeeRecipient,
  isBridgePlatformFeeCharged,
  getBridgePlatformFeeValue,
} from '../config/treasuryConfig'
import { MIN_DIRECT_BRIDGE_AMOUNT } from '../config/constants'
import { formatFeeDecimals, CHAIN_NATIVE_MAP } from '../utils/tokenUtils'
import { addTransaction, completeBridgeTransaction } from '../utils/history'
import { Tooltip } from './common/Tooltip'
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
} from './fintech'

interface BridgeModalProps {
  isOpen: boolean
  isInline?: boolean
  onClose: () => void
  connectedAddress: string
  provider: any // Injected EIP-1193 provider
  currentChainId: number
  authSource?: 'passkey' | 'ucw' | 'evm' | null
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
  executeUcwContract,
  signTypedData,
  onSuccess,
}: BridgeModalProps) {
  const { addBroadcast, updateBroadcast } = useBroadcast()
  const { solana, injective } = useMultiChainWallet()
  const [isPrivateBridge, setIsPrivateBridge] = useState(false)

  // Speed & Priority Tier Selection (Direct CCTP): 'standard' (Eco / CCTP Slow),
  // 'fast' (CCTP Fast 15-30s), 'turbo' (fastest Direct tier — carries its own
  // platform fee). The Gateway route is a separate mode picked through
  // SegmentedModeSwitch, not a speed tier.
  const [speedTier, setSpeedTier] = useState<SpeedTier>('fast')
  const [showSettings, setShowSettings] = useState(false)

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
  }

  const [sourceChain, setSourceChain] = useState('Arc_Testnet')
  const [destChain, setDestChain] = useState('Base_Sepolia')
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')

  // Chain selection modals
  const [showSourceChainModal, setShowSourceChainModal] = useState(false)
  const [showDestChainModal, setShowDestChainModal] = useState(false)


  const isValidEvmAddress = (addr: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(addr)
  const isValidSolanaAddress = (addr: string): boolean =>
    !addr.startsWith('0x') && addr.length >= 32 && addr.length <= 44
  const isValidInjectiveAddress = (addr: string): boolean =>
    addr.startsWith('inj1') && addr.length >= 38

  const isDestSolana = destChain.toLowerCase().includes('solana')
  const isDestInjective = destChain.toLowerCase().includes('injective')

  const recipientIsValid = useMemo(() => {
    if (!recipient) return false
    if (isDestSolana) return isValidSolanaAddress(recipient)
    if (isDestInjective) return isValidInjectiveAddress(recipient)
    return isValidEvmAddress(recipient)
  }, [recipient, isDestSolana, isDestInjective])

  // Load wallet testnet balances & Gateway unified balances
  const { walletBalances, refetch: refetchWalletBalances } =
    useWalletTestnetBalances(connectedAddress)
  const { balances: gatewayBalances, refresh: refreshGatewayBalances } =
    useGatewayBalance(connectedAddress)

  const sourceWalletBalance = walletBalances[sourceChain]?.usdc || '0.00'
  const sourceGatewayBalance =
    gatewayBalances.find((b) => b.chainKey === sourceChain)?.balance || '0.00'

  const activeBalance = bridgeMode === 'direct' ? sourceWalletBalance : sourceGatewayBalance

  // Custom Platform Fee configuration from Arcis Treasury Fee Engine
  // (.env: VITE_BRIDGE_FEE_ENABLED + the per-speed ladder VITE_BRIDGE_FEE_VALUE_STANDARD /
  // _FAST / _TURBO, falling back to the flat VITE_BRIDGE_FEE_VALUE). Every charge
  // surface below (requiredDebit, MAX reserve, App Kit customFee, breakdown, receipt)
  // reads this one tiered value, so what is shown and what is debited cannot diverge.
  const platformFeeAmount = getBridgePlatformFeeValue(speedTier)
  // One policy, one source: the fee is only charged — and only enforced against
  // the balance — where the execution path can actually collect it (Direct CCTP
  // via App Kit; never for UCW or the Gateway paths).
  const platformFeeCharged = isBridgePlatformFeeCharged({ bridgeMode, authSource })
  const requiredDebit = amount
    ? parseFloat(amount) + (platformFeeCharged ? platformFeeAmount : 0)
    : 0
  const isInsufficient = amount ? requiredDebit > parseFloat(activeBalance) : false

  // What execution will debit on top of the entered amount. MAX and the
  // percentage chips must reserve both, otherwise clicking MAX is rejected as
  // INSUFFICIENT the moment it fills the field:
  //   • Direct CCTP adds the flat platform fee to the debit.
  //   • Gateway pre-flight requires balance ≥ amount + maxFee (1.0 USDC floor),
  //     so the reserve is computed from the full balance — maxFee grows with the
  //     amount, which never exceeds the balance.
  const amountReserves = {
    platformFeeUsdc: platformFeeCharged ? platformFeeAmount : 0,
    gatewayMaxFeeUsdc:
      bridgeMode === 'gateway' ? gatewayMaxFeeUsdc(parseFloat(activeBalance) || 0) : 0,
  }

  // Transfer execution states
  const [isTransferring, setIsTransferring] = useState(false)
  const [successReceipt, setSuccessReceipt] = useState<any>(null)
  const [isBridgePending, setIsBridgePending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCanceledError, setIsCanceledError] = useState(false)

  // Fee estimation
  const [estimatedFee, setEstimatedFee] = useState<string | null>(null)

  // Systematic input and state clearing on wallet disconnect
  const resetFormInputs = useCallback(() => {
    setAmount('')
    setRecipient('')
    setIsTransferring(false)
    setSuccessReceipt(null)
    setIsBridgePending(false)
    setError(null)
    setIsCanceledError(false)
    setEstimatedFee(null)
  }, [])

  useClearOnWalletDisconnect(resetFormInputs)

  useEffect(() => {
    if (!connectedAddress) {
      resetFormInputs()
    }
  }, [connectedAddress, resetFormInputs])

  // Reset states on open
  useEffect(() => {
    if (isOpen) {
      setIsTransferring(false)
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

    if (!amount || parseFloat(amount) <= 0) {
      return
    }

    let isMounted = true
    const getEstimation = async () => {
      try {
        // Gateway Fast quotes nothing: Arcis charges no platform fee on that
        // route and Circle bills its own cost straight from the user's Gateway
        // balance, so no fee is deducted from the bridged amount and there is no
        // fee row or quote to produce for it (in any auth mode).
        if (bridgeMode === 'gateway') return

        if (authSource === 'ucw') {
          // Circle UCW CCTP transfer fee estimation (live Circle fee quote)
          if (isMounted) {
            setEstimatedFee(await quoteUcwDirectBridgeFee())
          }
          return
        }

        // Direct CCTP mode cost estimation
        if (provider) {
          const adapter = await createViemAdapter(provider)
          const cost = await estimateBridgeCost({
            fromChain: sourceChain,
            toChain: destChain,
            amount,
            sourceAdapter: adapter,
            recipientAddress: recipient || connectedAddress,
            useForwarder: true,
            transferSpeed: speedTier === 'standard' ? 'SLOW' : 'FAST',
            ...(platformFeeCharged && {
              customFee: {
                value: platformFeeAmount.toFixed(2),
                recipientAddress: getBridgeFeeRecipient(sourceChain),
              },
            }),
          })
          // Only the fees deducted from the bridged amount (CCTP provider +
          // forwarder) may reduce Net Received. The App Kit `kit` entry is
          // Arcis's platform fee, added ON TOP of the transfer amount, so it is
          // excluded here and disclosed in its own Platform Fee row instead.
          const totalFeeInUsdc = sumBridgeDeductedFees(cost?.fees as any)

          if (isMounted) {
            setEstimatedFee(
              totalFeeInUsdc > 0 ? formatFeeDecimals(totalFeeInUsdc) : await quoteDirectCctpFee()
            )
          }
        }
      } catch (err) {
        if (isMounted && bridgeMode !== 'gateway') {
          setEstimatedFee(await quoteDirectCctpFee())
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
    quoteDirectCctpFee,
    quoteUcwDirectBridgeFee,
  ])

  // Chains formatting for selector modal
  const sourceChainsList = useMemo(() => {
    return BRIDGE_SELECTABLE_CHAINS.map((c) => ({
      chain: c,
      name: getChainDisplayName(c),
    }))
  }, [])

  const destChainsList = useMemo(() => {
    return BRIDGE_SELECTABLE_CHAINS.map((c) => ({
      chain: c,
      name: getChainDisplayName(c),
    }))
  }, [])

  const handleSwapChains = () => {
    setSourceChain(destChain)
    setDestChain(sourceChain)
    setError(null)
    setIsCanceledError(false)
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
      if (isDestSolana) {
        setError('Please enter a valid Solana recipient address (Base58)')
      } else if (isDestInjective) {
        setError('Please enter a valid Injective recipient address (inj1...)')
      } else {
        setError('Please enter a valid EVM recipient address (0x...)')
      }
      return
    }

    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) {
      setError('Please enter a valid amount')
      return
    }

    if (bridgeMode === 'direct' && amt < MIN_DIRECT_BRIDGE_AMOUNT) {
      setError(
        `Minimum transfer amount for direct CCTP bridge is ${MIN_DIRECT_BRIDGE_AMOUNT.toFixed(2)} USDC to cover CCTP network forwarder fees.`
      )
      return
    }

    if (sourceChain === destChain) {
      setError('Source and destination chains must be different')
      return
    }

    if (isInsufficient) {
      setError(
        bridgeMode === 'direct'
          ? `Insufficient wallet balance! You have ${sourceWalletBalance} USDC in your wallet on ${getChainDisplayName(
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

    setIsTransferring(true)

    const tokenSymbol = 'USDC'
    const broadcastId = addBroadcast({
      type: 'bridge',
      title: bridgeMode === 'direct' ? `Bridging ${tokenSymbol}...` : `Bridging ${tokenSymbol} via Gateway...`,
      status: 'pending',
      badgeText: 'Pending',
      details: {
        amount,
        tokenSymbol,
        tokenIcon: UsdcIcon,
        sourceChain,
        destChain,
        bridgeMode,
        network: destChain,
      },
    })

    try {
      let mintTxHash = ''
      let burnTxHash = ''
      let destExplorerUrl: string | undefined = undefined
      let sourceExplorerUrl: string | undefined = undefined
      let ucwChallengeId: string | undefined = undefined
      let gatewayTransferId: string | undefined = undefined
      let confirmedCctpReceivedAmount: string | undefined = undefined

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
        } else {
          // Circle UCW Direct CCTP Bridge via smart contract execution
          if (!executeUcwContract) {
            throw new Error('Wallet contract execution module is not initialized. Please refresh or re-authenticate.')
          }

          const ucwResult = await executeUcwBridgeTransfer({
            // Route the burn through Circle's Forwarding Service so the mint is
            // submitted on the destination chain; without the hook nothing
            // mints and the transfer stays pending forever.
            useForwarder: true,
            minFinalityThreshold: speedTier === 'standard' ? 2000 : 1000,
            amount,
            sourceChain,
            destChain,
            recipientAddress: targetRecipient,
            connectedAddress,
            executeUcwContract,
            onStepProgress: (step) => {
              if (step === 'approving') {
                updateBroadcast(broadcastId, {
                  title: 'Approving USDC Allowance...',
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

        const adapter = await createViemAdapter(provider)

        const result: any = await executeBridge({
          fromChain: sourceChain,
          toChain: destChain,
          amount,
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
        })

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

        const mintStep = result?.steps?.find((s: any) => s.name === 'mint')
        const burnStep = result?.steps?.find((s: any) => s.name === 'burn')

        // `result.txHash` and the burn step are source-chain transactions; they are never a mint.
        mintTxHash = result?.mintTxHash || mintStep?.txHash || ''
        burnTxHash = burnStep?.txHash || result?.burnTxHash || result?.txHash || ''

        destExplorerUrl =
          mintStep?.explorerUrl ||
          (mintTxHash ? getExplorerTxUrl(destChain, mintTxHash) : undefined)
        sourceExplorerUrl =
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
                console.debug('[BridgeModal] Source network restore skipped:', switchErr?.message || switchErr)
              )
            }
          } catch (restoreErr: any) {
            console.debug('[BridgeModal] Source network restore skipped:', restoreErr?.message || restoreErr)
          }
        })

        if (!result || !result.mintTxHash) {
          throw new Error('Gateway transfer did not return a valid transaction hash.')
        }

        mintTxHash = result.mintTxHash || ''
        destExplorerUrl = mintTxHash ? getExplorerTxUrl(destChain, mintTxHash) : undefined
      }

      setIsTransferring(false)
      setError(null)

      const isGateway = bridgeMode === 'gateway'
      let destinationConfirmed = Boolean(
        isGateway && mintTxHash && /^0x[0-9a-fA-F]{64}$/.test(mintTxHash) &&
        await verifyDestinationUsdcMint(destChain, mintTxHash, targetRecipient, amount, gatewayTransferFeeCeiling(amount))
      )
      if (!isGateway && mintTxHash && /^0x[0-9a-fA-F]{64}$/.test(mintTxHash)) {
        const cctpDestination = await pollCctpDestinationTx({
          sourceChain, destChain, burnTxHash, recipientAddress: targetRecipient, amount,
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

      if (!destinationConfirmed) mintTxHash = ''
      setIsBridgePending(!destinationConfirmed)
      // Net Received. The CCTP routes deduct a protocol fee from the minted
      // amount; Gateway never does, so it settles on the full bridged amount
      // unless the mint receipt proves a different delivery. The fee-derived
      // estimate is only ever the CCTP routes' last resort.
      let netAmount: string | undefined = undefined
      if (destinationConfirmed) {
        if (isGateway) {
          netAmount = gatewayReceivedAmount ?? amount
        } else {
          const fallbackFee =
            estimatedFee || (authSource === 'ucw' ? await quoteUcwDirectBridgeFee() : await quoteDirectCctpFee())
          netAmount =
            confirmedCctpReceivedAmount ??
            Math.max(0, parseFloat(amount) - parseFloat(fallbackFee)).toFixed(6)
        }
      }
      const primaryTxHash = isGateway ? mintTxHash : (burnTxHash || mintTxHash || '')
      const explorerUrl = destinationConfirmed && mintTxHash
        ? getExplorerTxUrl(destChain, mintTxHash)
        : undefined
      const primaryExplorerUrl = isGateway
        ? explorerUrl
        : (burnTxHash && sourceExplorerUrl ? sourceExplorerUrl : explorerUrl)
      const broadcastNetwork = isGateway ? destChain : sourceChain
      const hasRealDestTx = destinationConfirmed && Boolean(mintTxHash)

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
        hasRealDestTx && mintTxHash
          ? await resolveBridgeNetworkFee(destChain, mintTxHash)
          : undefined

      setSuccessReceipt({
        txHash: destinationConfirmed ? (isGateway ? mintTxHash : burnTxHash) : undefined,
        sourceTxHash: isGateway ? undefined : burnTxHash,
        destTxHash: hasRealDestTx ? mintTxHash : undefined,
        explorerUrl: primaryExplorerUrl,
        sourceExplorerUrl: isGateway || !burnTxHash ? undefined : sourceExplorerUrl,
        destExplorerUrl: hasRealDestTx ? explorerUrl : undefined,
        amount,
        sourceChain,
        destChain,
        networkFee: networkFeeText,
        destFee: destFeeText,
        netReceived: netAmount,
        mode: bridgeMode,
      })

      updateBroadcast(broadcastId, {
        type: 'bridge',
        title: destinationConfirmed ? 'Bridge Completed Successfully' : 'Bridge Awaiting Destination Confirmation',
        status: destinationConfirmed ? 'success' : 'pending',
        badgeText: destinationConfirmed ? 'Confirmed' : 'Pending',
        details: {
          amount,
          tokenSymbol: 'USDC',
          tokenIcon: UsdcIcon,
          sourceChain,
          destChain,
          bridgeMode,
          network: broadcastNetwork,
          txHash: destinationConfirmed ? primaryTxHash : undefined,
          sourceTxHash: isGateway ? undefined : burnTxHash,
          destTxHash: hasRealDestTx ? mintTxHash : undefined,
          explorerUrl: destinationConfirmed ? primaryExplorerUrl : undefined,
          sourceExplorerUrl: isGateway || !burnTxHash ? undefined : sourceExplorerUrl,
          destExplorerUrl: hasRealDestTx ? explorerUrl : undefined,
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
          tokenSymbol: 'USDC',
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
          type: 'bridge', txHash: burnTxHash, amount, tokenSymbol: 'USDC', sourceChain, destChain,
          recipient: targetRecipient, userAddress: connectedAddress, status: 'pending', isPrivate: isPrivateBridge,
        })
      }

      // Background Resolution for a destination mint correlated to the submitted source burn.
      if (!destinationConfirmed) {
        ;(async () => {
          try {
            let resolvedDestTx: string | undefined = undefined

            if (isGateway && gatewayTransferId) {
              console.log('[BridgeModal] Polling Circle Gateway Forwarding for real destination tx:', gatewayTransferId)
              const forwarded = await pollForwardedGatewayTransfer(gatewayTransferId, {
                maxAttempts: 30, intervalMs: 2500, destChain, recipient: targetRecipient, amount,
              })
              if ((forwarded.status === 'confirmed' || forwarded.status === 'finalized') && forwarded.txHash) resolvedDestTx = forwarded.txHash
            } else if (!isGateway && burnTxHash && burnTxHash.startsWith('0x')) {
              console.log('[BridgeModal] Polling Circle CCTP destination mint for real destination tx:', burnTxHash)
              const cctpDest = await pollCctpDestinationTx({
                sourceChain,
                destChain,
                burnTxHash,
                recipientAddress: targetRecipient,
                amount,
                // Slow destinations (e.g. Ethereum Sepolia standard finality)
                // can take ~13 minutes to mint; a 2-minute budget stranded the
                // receipt on "Bridge Pending" even after a successful burn.
                maxAttempts: 300,
                intervalMs: 3000,
              })
              if (cctpDest.status === 'confirmed' && cctpDest.destTxHash && /^0x[0-9a-fA-F]{64}$/.test(cctpDest.destTxHash)) {
                resolvedDestTx = cctpDest.destTxHash
                confirmedCctpReceivedAmount = cctpDest.receivedAmount
              } else {
                console.warn(
                  '[BridgeModal] Background CCTP destination poll ended without confirmation for burn',
                  burnTxHash,
                  '→ status:',
                  cctpDest.status
                )
              }
            }

            if (resolvedDestTx && isGateway && !await verifyDestinationUsdcMint(destChain, resolvedDestTx, targetRecipient, amount, gatewayTransferFeeCeiling(amount))) {
              resolvedDestTx = undefined
            }
            if (resolvedDestTx) {
              console.log('[BridgeModal] Real destination tx confirmed on-chain:', resolvedDestTx)
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

              // Update Success Receipt Modal state in real-time
              setSuccessReceipt((prev: any) =>
                prev
                  ? {
                      ...prev,
                      txHash: isGateway ? resolvedDestTx : prev.txHash,
                      destTxHash: resolvedDestTx,
                      explorerUrl: isGateway ? resolvedExplorerUrl : prev.explorerUrl,
                      destExplorerUrl: resolvedExplorerUrl,
                      netReceived: isGateway ? (resolvedGatewayReceivedAmount ?? prev.netReceived) : confirmedCctpReceivedAmount,
                      destFee: resolvedDestFeeText ?? prev.destFee,
                    }
                  : prev
              )
              setIsBridgePending(false)
              completeBridgeTransaction({
                sourceTxHash: burnTxHash, destTxHash: resolvedDestTx, amount, tokenSymbol: 'USDC', sourceChain, destChain,
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
                  tokenSymbol: 'USDC',
                  tokenIcon: UsdcIcon,
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
            console.warn('[BridgeModal] Background destination tx resolution notice:', pollingErr)
          }
        })()
      }
    } catch (err: any) {
      console.error('[BridgeModal] Execution error:', err)
      setIsTransferring(false)

      // Recovery: a Direct CCTP transfer that failed AFTER the source burn is
      // not a failure — the USDC is already burned. Reporting it as an error
      // would invite a retry that burns a second time, so fall back to the
      // pending receipt and keep polling for the destination mint.
      const failedBridgeResult = err?.bridgeResult
      const burnedTxHash: string | undefined = failedBridgeResult?.steps?.find(
        (s: any) => s?.name === 'burn' && s?.state === 'success' && /^0x[0-9a-fA-F]{64}$/.test(s?.txHash || '')
      )?.txHash

      if (burnedTxHash && bridgeMode === 'direct' && authSource !== 'ucw') {
        const sourceExplorer = getExplorerTxUrl(sourceChain, burnedTxHash)
        setError(null)
        setIsCanceledError(false)
        const pendingNetworkFee = await resolveBridgeNetworkFee(sourceChain, burnedTxHash)
        setSuccessReceipt({
          txHash: burnedTxHash,
          sourceTxHash: burnedTxHash,
          destTxHash: undefined,
          explorerUrl: sourceExplorer,
          sourceExplorerUrl: sourceExplorer,
          destExplorerUrl: undefined,
          amount,
          sourceChain,
          destChain,
          networkFee: pendingNetworkFee,
          netReceived: undefined,
          mode: bridgeMode,
        })
        setIsBridgePending(true)

        addTransaction({
          type: 'bridge', txHash: burnedTxHash, amount, tokenSymbol: 'USDC',
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
            tokenSymbol: 'USDC',
            tokenIcon: UsdcIcon,
            sourceChain,
            destChain,
            bridgeMode,
            network: sourceChain,
            txHash: burnedTxHash,
            sourceTxHash: burnedTxHash,
            sourceExplorerUrl: sourceExplorer,
          },
        })

        // Background resolution of the destination mint (same poll as the happy path).
        ;(async () => {
          try {
            const cctpDest = await pollCctpDestinationTx({
              sourceChain, destChain, burnTxHash: burnedTxHash,
              recipientAddress: targetRecipient, amount,
              maxAttempts: 300, intervalMs: 3000,
            })
            const resolvedDestTx =
              cctpDest.status === 'confirmed' && cctpDest.destTxHash && /^0x[0-9a-fA-F]{64}$/.test(cctpDest.destTxHash)
                ? cctpDest.destTxHash
                : undefined
            if (!resolvedDestTx) {
              console.warn('[BridgeModal] Recovery: destination mint still unconfirmed after polling')
              return
            }
            const resolvedExplorerUrl = getExplorerTxUrl(destChain, resolvedDestTx)
            // Destination-chain gas, read from the resolved mint receipt.
            const resolvedDestFeeText = await resolveBridgeNetworkFee(destChain, resolvedDestTx)
            setSuccessReceipt((prev: any) =>
              prev
                ? {
                    ...prev,
                    destTxHash: resolvedDestTx,
                    destExplorerUrl: resolvedExplorerUrl,
                    netReceived: cctpDest.receivedAmount ?? prev.netReceived,
                    destFee: resolvedDestFeeText ?? prev.destFee,
                  }
                : prev
            )
            setIsBridgePending(false)
            completeBridgeTransaction({
              sourceTxHash: burnedTxHash, destTxHash: resolvedDestTx, amount, tokenSymbol: 'USDC',
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
                tokenSymbol: 'USDC',
                tokenIcon: UsdcIcon,
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
            console.warn('[BridgeModal] Recovery destination polling notice:', pollingErr)
          }
        })()

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
          tokenSymbol: 'USDC',
          tokenIcon: UsdcIcon,
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
    if (isTransferring) {
      return {
        disabled: true,
        text: bridgeMode === 'direct' ? 'BRIDGING VIA CCTP...' : 'TRANSFERRING VIA GATEWAY...',
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
    if (bridgeMode === 'direct' && parseFloat(amount) < MIN_DIRECT_BRIDGE_AMOUNT) {
      return {
        disabled: true,
        text: `MINIMUM IS ${MIN_DIRECT_BRIDGE_AMOUNT.toFixed(2)} USDC`,
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
    return {
      disabled: false,
      text: bridgeMode === 'direct' ? 'BRIDGE USDC' : 'FAST TRANSFER USDC',
      loading: false,
      icon: <Globe className="w-4 h-4" />,
    }
  }, [
    isTransferring,
    connectedAddress,
    amount,
    isInsufficient,
    sourceChain,
    destChain,
    recipient,
    recipientIsValid,
    bridgeMode,
  ])

  // Clean, standardized Fee & Route breakdown
  const breakdownItems = useMemo(() => {
    if (!amount || parseFloat(amount) <= 0) return []

    // Gateway mints the full principal — Circle bills its own cost from the user's
    // Gateway balance — so nothing is subtracted from Net Received on that route.
    const computedFee =
      bridgeMode === 'gateway'
        ? '0.00'
        : (estimatedFee ? formatFeeDecimals(estimatedFee) : null) ||
          (speedTier === 'standard' ? '0.00' : '0.20')

    const computedFeeNum = parseFloat(computedFee)
    const netReceived = Math.max(
      0,
      parseFloat(amount) - (isNaN(computedFeeNum) ? 0 : computedFeeNum)
    )

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
                <NetworkIcon
                  name={sourceIconId}
                  variant={sourceIconId === 'solana' ? 'branded' : 'background'}
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
                <NetworkIcon
                  name={destIconId}
                  variant={destIconId === 'solana' ? 'branded' : 'background'}
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
        tooltip: 'The final net amount of USDC that will arrive in your destination wallet.',
        value: `${formatFeeDecimals(netReceived)} USDC`,
        highlight: true,
        highlightColor: 'text-indigo-400',
      },
      {
        label: 'Source Network Fee',
        tooltip:
          bridgeMode === 'gateway'
            ? 'Gateway Fast Transfer authorizes the burn with an off-chain EIP-712 signature: your wallet never submits a source-chain transaction, so you pay no source gas.'
            : 'Transaction gas fee required to initiate the bridge deposit on the source chain.',
        value:
          bridgeMode === 'gateway'
            ? '0.00 USDC'
            : sourceChain === 'Arc_Testnet'
              ? '~0.000021 USDC'
              : `< 0.001 ${CHAIN_NATIVE_MAP[sourceChain]?.symbol || 'ETH'}`,
      },
      {
        label: 'Platform Fee',
        tooltip: 'Arcis platform routing fee for cross-chain transaction management.',
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
    return bridgeMode === 'gateway'
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

  // Quick fill recipient badges
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
          <NetworkIcon name="solana" size={11} variant="branded" />
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
          <NetworkIcon name="injective" size={11} variant="branded" />
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
      minHeight={isInline ? 680 : undefined}
      headerActions={headerActions}
    >
      {/* Success Receipt Screen */}
      {successReceipt ? (
        <BridgeSuccessReceipt
          amount={successReceipt.amount}
          sourceChain={successReceipt.sourceChain}
          destChain={successReceipt.destChain}
          sourceChainName={getChainDisplayName(successReceipt.sourceChain)}
          destChainName={getChainDisplayName(successReceipt.destChain)}
          sourceIconId={CHAIN_META[successReceipt.sourceChain]?.iconId || 'ethereum'}
          destIconId={CHAIN_META[successReceipt.destChain]?.iconId || 'ethereum'}
          recipient={recipient || connectedAddress}
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
            successReceipt.mode === 'gateway'
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
            setIsTransferring(false)
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
                    <NetworkIcon
                      name={CHAIN_META[sourceChain]?.iconId || 'ethereum'}
                      variant={CHAIN_META[sourceChain]?.iconId === 'solana' ? 'branded' : 'background'}
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
                    <NetworkIcon
                      name={CHAIN_META[destChain]?.iconId || 'ethereum'}
                      variant={CHAIN_META[destChain]?.iconId === 'solana' ? 'branded' : 'background'}
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
            tokenSymbol="USDC"
            tokenIcon={UsdcIcon}
            balance={activeBalance}
            onMaxClick={() => setAmount(maxBridgeAmount(activeBalance, amountReserves))}
            quickPercentages={[25, 50, 75, 100]}
            onSelectPercentage={(pct) => {
              const next = bridgeAmountForPercentage(activeBalance, pct, amountReserves)
              if (parseFloat(next) > 0) {
                setAmount(next)
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
          {bridgeMode === 'direct' && amount && parseFloat(amount) > 0 && parseFloat(amount) < MIN_DIRECT_BRIDGE_AMOUNT && (
            <div className="text-[11px] text-amber-400/90 flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl animate-fade-in">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>Minimum transfer amount is {MIN_DIRECT_BRIDGE_AMOUNT.toFixed(2)} USDC to cover CCTP network forwarder fees.</span>
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
            placeholder={
              isDestSolana
                ? '9WzD....'
                : isDestInjective
                ? 'inj1....'
                : '0x....'
            }
            isValid={recipientIsValid}
            disabled={isTransferring}
            rightBadge={recipientBadge}
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
            const alternate = BRIDGE_SELECTABLE_CHAINS.find((sc) => sc !== c) || ''
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
            const alternate = BRIDGE_SELECTABLE_CHAINS.find((sc) => sc !== c) || ''
            setSourceChain(alternate)
          }
        }}
        getChainIconId={(c) => CHAIN_META[c]?.iconId || 'ethereum'}
        title="Select Destination Network"
      />
    </FintechCard>
  )

  // Bridge Settings Window / Modal rendered over document.body via Portal
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
                      Bridge Settings
                    </h3>
                    <p className="text-[11px] text-slate-400">Speed & fee preferences</p>
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