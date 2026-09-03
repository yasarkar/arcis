import React, { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Globe,
  Settings,
  Wallet,
  Zap,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { useGatewayBalance } from '../hooks/useGatewayBalance'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import { transferFromGateway, estimateGatewayTransfer } from '../services/gatewayService'
import { executeBridge, estimateBridgeCost } from '../services/bridgeService'
import { createViemAdapter } from '../services/sendService'
import { parseTransactionError, type ParsedTransactionError } from '../utils/errorUtils'
import { GATEWAY_SUPPORTED_CHAINS } from '../config/gatewayConfig'
import { PrivacyLockButton } from './privacy/PrivacyLockButton'
import { useBroadcast } from './BroadcastNotification'
import { SpeedFeeSelector } from './common/SpeedFeeSelector'
import { type SpeedTier } from '../config/feeTiers'
import { useMultiChainWallet } from '../hooks/useMultiChainWallet'
import {
  CHAIN_META,
  CHAIN_DEFS,
  getChainDisplayName,
} from '../config/bridgeConfig'
import {
  getBridgeProtocolFee,
  TREASURY_ADDRESS,
} from '../config/treasuryConfig'
import { addTransaction } from '../utils/history'
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
  onSuccess,
}: BridgeModalProps) {
  const { addBroadcast, updateBroadcast } = useBroadcast()
  const { solana, injective } = useMultiChainWallet()
  const [isPrivateBridge, setIsPrivateBridge] = useState(false)

  // Speed & Priority Tier Selection: 'standard' (Eco / CCTP Slow), 'fast' (CCTP Fast 15-30s), 'turbo' (Gateway <500ms Instant)
  const [speedTier, setSpeedTier] = useState<SpeedTier>('fast')
  const [showSettings, setShowSettings] = useState(false)

  // Mode Selection: 'direct' (CCTP via Wallet Balance) or 'gateway' (Fast Transfer via Gateway Unified Balance)
  const [bridgeMode, setBridgeMode] = useState<'direct' | 'gateway'>('direct')

  const handleSpeedTierChange = (tier: SpeedTier) => {
    setSpeedTier(tier)
    if (tier === 'turbo') {
      setBridgeMode('gateway')
    } else {
      setBridgeMode('direct')
    }
  }

  const [sourceChain, setSourceChain] = useState('Arc_Testnet')
  const [destChain, setDestChain] = useState('Base_Sepolia')
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [recipientError, setRecipientError] = useState<string | null>(null)

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

  // Custom Platform Fee configuration from Arcis Treasury Fee Engine (Dynamic per speed tier)
  const platformFeeAmount = getBridgeProtocolFee(speedTier)
  const platformFeeEnabled = platformFeeAmount > 0
  const requiredDebit = amount
    ? parseFloat(amount) + (bridgeMode === 'direct' ? platformFeeAmount : 0)
    : 0
  const isInsufficient = amount ? requiredDebit > parseFloat(activeBalance) : false

  // Transfer execution states
  const [isTransferring, setIsTransferring] = useState(false)
  const [successReceipt, setSuccessReceipt] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Fee estimation
  const [estimatedFee, setEstimatedFee] = useState<string | null>(null)
  const [isEstimating, setIsEstimating] = useState(false)

  // Reset states on open
  useEffect(() => {
    if (isOpen) {
      setIsTransferring(false)
      setSuccessReceipt(null)
      setError(null)
      setEstimatedFee(null)
      setRecipientError(null)
    }
  }, [isOpen])

  // Debounced fee estimation
  useEffect(() => {
    if (isTransferring) return

    if (!amount || parseFloat(amount) <= 0) {
      setEstimatedFee(null)
      return
    }

    let isMounted = true
    const getEstimation = async () => {
      setIsEstimating(true)
      try {
        if (bridgeMode === 'gateway') {
          const fee = await estimateGatewayTransfer(sourceChain, destChain, amount)
          if (isMounted) setEstimatedFee(fee)
        } else {
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
              ...(platformFeeEnabled && {
                customFee: {
                  value: platformFeeAmount.toFixed(2),
                  recipientAddress: TREASURY_ADDRESS,
                },
              }),
            })
            const totalFeeInUsdc =
              cost?.fees?.reduce((acc, fee) => {
                const parsed = fee.amount ? parseFloat(fee.amount) : 0
                return acc + (isNaN(parsed) ? 0 : parsed)
              }, 0) ?? 0

            if (isMounted) {
              setEstimatedFee(
                totalFeeInUsdc > 0
                  ? totalFeeInUsdc.toString()
                  : speedTier === 'standard'
                  ? '0.0000'
                  : '0.2000'
              )
            }
          }
        }
      } catch (err) {
        if (isMounted) {
          setEstimatedFee(
            bridgeMode === 'gateway'
              ? (parseFloat(amount) * 0.00005).toFixed(6)
              : speedTier === 'standard'
              ? '0.0000'
              : '0.2000'
          )
        }
      } finally {
        if (isMounted) setIsEstimating(false)
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
    platformFeeEnabled,
    provider,
    recipient,
    connectedAddress,
    isTransferring,
    platformFeeAmount,
  ])

  if (!isOpen && !isInline) return null

  // Chains formatting for selector modal
  const supportedChainsList = useMemo(() => {
    return GATEWAY_SUPPORTED_CHAINS.map((c) => ({
      chain: c,
      name: getChainDisplayName(c),
    }))
  }, [])

  const handleSwapChains = () => {
    setSourceChain(destChain)
    setDestChain(sourceChain)
  }

  const handleTransfer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    setError(null)
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

    setIsTransferring(true)

    const broadcastId = addBroadcast({
      title: bridgeMode === 'direct' ? 'CCTP Bridging in Progress...' : 'Bridging via Gateway...',
      status: 'pending',
      badgeText: bridgeMode === 'direct' ? 'CCTP V2' : '<500ms Instant',
      details: {
        fromAmount: amount,
        fromSymbol: 'USDC',
        fromIcon: UsdcIcon,
        fromChain: sourceChain,
        toAmount: amount,
        toSymbol: 'USDC',
        toIcon: UsdcIcon,
        toChain: destChain,
        network: destChain,
        isBridge: true,
      },
    })

    try {
      let mintTxHash = ''

      if (bridgeMode === 'direct') {
        // Direct CCTP Bridge via App Kit SDK
        if (!provider) throw new Error('No wallet provider available')
        const adapter = await createViemAdapter(provider)

        const result: any = await executeBridge({
          fromChain: sourceChain,
          toChain: destChain,
          amount,
          sourceAdapter: adapter,
          recipientAddress: targetRecipient,
          useForwarder: true,
          transferSpeed: speedTier === 'standard' ? 'SLOW' : 'FAST',
          ...(platformFeeEnabled && {
            customFee: {
              value: platformFeeAmount.toFixed(2),
              recipientAddress: TREASURY_ADDRESS,
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

        mintTxHash =
          result?.mintTxHash ||
          result?.txHash ||
          result?.steps?.find((s: any) => s.name === 'mint')?.txHash ||
          result?.steps?.find((s: any) => s.name === 'burn')?.txHash ||
          ''
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
        })

        if (!result || !result.mintTxHash) {
          throw new Error('Gateway transfer did not return a valid transaction hash.')
        }

        mintTxHash = result.mintTxHash || ''
      }

      setIsTransferring(false)
      setError(null)

      const computedFee =
        estimatedFee ||
        (bridgeMode === 'gateway'
          ? (parseFloat(amount) * 0.00005).toFixed(6)
          : '0.0001')
      const netAmount = Math.max(0, parseFloat(amount) - parseFloat(computedFee)).toFixed(6)

      const explorerUrl = mintTxHash ? `https://testnet.arcscan.app/tx/${mintTxHash}` : undefined
      setSuccessReceipt({
        txHash: mintTxHash,
        explorerUrl,
        amount,
        sourceChain,
        destChain,
        fee: computedFee,
        netReceived: netAmount,
        mode: bridgeMode,
      })

      updateBroadcast(broadcastId, {
        title: bridgeMode === 'direct' ? 'CCTP Bridge Confirmed' : 'Instant Bridge Completed',
        status: 'success',
        badgeText: 'Finalized',
        details: {
          fromAmount: amount,
          fromSymbol: 'USDC',
          fromIcon: UsdcIcon,
          fromChain: sourceChain,
          toAmount: amount,
          toSymbol: 'USDC',
          toIcon: UsdcIcon,
          toChain: destChain,
          network: destChain,
          txHash: mintTxHash,
          isBridge: true,
        },
      })

      refetchWalletBalances()
      refreshGatewayBalances()

      addTransaction({
        type: 'bridge',
        txHash: mintTxHash || `bridge-${Date.now()}`,
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
    } catch (err: any) {
      console.error('Bridge Failed:', err)
      setIsTransferring(false)

      const parsed: ParsedTransactionError = parseTransactionError(err)

      if (parsed.isRejected) {
        setError(parsed.message)

        updateBroadcast(broadcastId, {
          title: bridgeMode === 'direct' ? 'CCTP Bridge Cancelled' : 'Gateway Transfer Cancelled',
          status: 'failed',
          badgeText: 'Cancelled',
          message: 'The transaction request in the wallet was cancelled by the user.',
          details: {
            fromAmount: amount,
            fromSymbol: 'USDC',
            fromIcon: UsdcIcon,
            fromChain: sourceChain,
            toAmount: amount,
            toSymbol: 'USDC',
            toIcon: UsdcIcon,
            toChain: destChain,
            network: destChain,
            isBridge: true,
          },
        })
      } else {
        setError(parsed.message)

        updateBroadcast(broadcastId, {
          title: bridgeMode === 'direct' ? 'CCTP Bridge Failed' : 'Gateway Transfer Failed',
          status: 'failed',
          badgeText: 'Failed',
          message: parsed.message,
          details: {
            fromAmount: amount,
            fromSymbol: 'USDC',
            fromIcon: UsdcIcon,
            fromChain: sourceChain,
            toAmount: amount,
            toSymbol: 'USDC',
            toIcon: UsdcIcon,
            toChain: destChain,
            network: destChain,
            isBridge: true,
          },
        })
      }
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
      text: bridgeMode === 'direct' ? `BRIDGE ${amount} USDC` : `FAST TRANSFER ${amount} USDC`,
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

  // Clean, non-technical Fee & Route breakdown
  const breakdownItems = useMemo(() => {
    if (!amount || parseFloat(amount) <= 0) return []

    const computedFee =
      estimatedFee ||
      (bridgeMode === 'gateway'
        ? (parseFloat(amount) * 0.00005).toFixed(6)
        : speedTier === 'standard'
        ? '0.0000'
        : '0.2000')

    const netReceived = Math.max(0, parseFloat(amount) - parseFloat(computedFee)).toFixed(6)

    const items: BreakdownItem[] = [
      {
        label: 'Bridge Method',
        value: bridgeMode === 'gateway' ? 'Circle Gateway (Instant)' : 'Circle CCTP V2 (Direct)',
      },
      {
        label: 'Protocol Fee',
        value: isEstimating ? 'Calculating...' : `${computedFee} USDC`,
      },
    ]

    if (platformFeeEnabled && bridgeMode === 'direct') {
      items.push({
        label: 'Platform Fee',
        value: `${platformFeeAmount.toFixed(2)} USDC`,
      })
    }

    items.push(
      {
        label: 'Estimated Arrival',
        value:
          bridgeMode === 'gateway'
            ? '< 500ms Instant'
            : speedTier === 'standard'
            ? '~10-20 min'
            : '~15-30 sec',
      },
      {
        label: 'Net Received on Destination',
        value: `${netReceived} USDC`,
        highlight: true,
      }
    )

    return items
  }, [amount, estimatedFee, bridgeMode, speedTier, platformFeeEnabled, platformFeeAmount, isEstimating])

  // Header actions with Privacy, Settings and Close
  const headerActions = (
    <>
      <PrivacyLockButton
        isPrivate={isPrivateBridge}
        onToggle={() => setIsPrivateBridge((prev) => !prev)}
        disabled={isTransferring || !!successReceipt}
        size="md"
      />

      <button
        type="button"
        onClick={() => setShowSettings(!showSettings)}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${
          showSettings
            ? 'text-white bg-indigo-500/25 border border-indigo-500/40 shadow-sm'
            : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06]'
        }`}
        title="Bridge speed & fee settings"
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
            setRecipientError(null)
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
            setRecipientError(null)
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
            setRecipientError(null)
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
          txHash={successReceipt.txHash}
          explorerUrl={successReceipt.explorerUrl}
          fee={successReceipt.fee}
          netReceived={successReceipt.netReceived}
          isInline={isInline}
          onBridgeAgain={() => {
            setSuccessReceipt(null)
            setIsTransferring(false)
            setAmount('')
            setError(null)
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
              setBridgeMode(mode as 'direct' | 'gateway')
              if (mode === 'gateway') {
                setSpeedTier('turbo')
              } else if (speedTier === 'turbo') {
                setSpeedTier('fast')
              }
              setError(null)
            }}
            disabled={isTransferring}
          />

          {/* Error Alert */}
          {error && (
            <div className="p-3 bg-rose-500/10 rounded-2xl border border-rose-500/25 text-rose-400 text-xs flex items-center gap-2.5 animate-fade-in">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1">{error}</span>
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
                title="Swap source and destination networks"
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
            onAmountChange={(val) => setAmount(val)}
            tokenSymbol="USDC"
            tokenIcon={UsdcIcon}
            balance={activeBalance}
            onMaxClick={() => setAmount(activeBalance)}
            quickPercentages={[25, 50, 75, 100]}
            onSelectPercentage={(pct) => {
              const b = parseFloat(activeBalance)
              if (!isNaN(b) && b > 0) {
                const calculated = ((b * pct) / 100).toFixed(6)
                setAmount(parseFloat(calculated).toString())
              }
            }}
            error={isInsufficient}
            disabled={isTransferring}
          />

          {/* Recipient Address Field */}
          <RecipientAddressField
            value={recipient}
            onChange={(val) => {
              setRecipient(val)
              setRecipientError(null)
              setError(null)
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
            validText="Verified Address"
            error={recipientError}
            disabled={isTransferring}
            rightBadge={recipientBadge}
          />

          {/* Simplified Transaction Breakdown Accordion */}
          {breakdownItems.length > 0 && (
            <TransactionBreakdown
              summaryTitle={`Route: ${getChainDisplayName(sourceChain)} → ${getChainDisplayName(destChain)}`}
              summaryBadge={
                <span className="bg-indigo-500/15 text-indigo-300 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-indigo-500/30">
                  {bridgeMode === 'gateway'
                    ? '⚡ Instant <500ms'
                    : speedTier === 'standard'
                    ? 'Standard'
                    : 'Fast 15-30s'}
                </span>
              }
              items={breakdownItems}
              defaultOpen={false}
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
        chains={supportedChainsList}
        selectedChain={sourceChain}
        onSelectChain={(c) => {
          setSourceChain(c)
          setShowSourceChainModal(false)
          if (c === destChain) {
            const alternate = GATEWAY_SUPPORTED_CHAINS.find((sc) => sc !== c) || ''
            setDestChain(alternate)
          }
        }}
        getChainIconId={(c) => CHAIN_META[c]?.iconId || 'ethereum'}
        title="Select Source Network"
      />

      {/* Destination Network Selector Modal */}
      <ChainSelectorModal
        isOpen={showDestChainModal}
        onClose={() => setShowDestChainModal(false)}
        chains={supportedChainsList}
        selectedChain={destChain}
        onSelectChain={(c) => {
          setDestChain(c)
          setShowDestChainModal(false)
          if (c === sourceChain) {
            const alternate = GATEWAY_SUPPORTED_CHAINS.find((sc) => sc !== c) || ''
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