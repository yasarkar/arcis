import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  ArrowRightLeft,
  Globe,
  ExternalLink,
  ChevronDown,
  Zap,
  Wallet,
  Clipboard,
  Settings,
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
import { SPEED_TIERS, type SpeedTier } from '../config/feeTiers'
import { useMultiChainWallet } from '../hooks/useMultiChainWallet'
import {
  CHAIN_META,
  CHAIN_DEFS,
  getChainDisplayName,
} from '../config/bridgeConfig'
import {
  getBridgeProtocolFee,
  TREASURY_ADDRESS,
  TREASURY_EXPLORER_URL,
  formatTreasuryAddress,
  REVENUE_SHARE_LABEL,
  REVENUE_SHARE_TOOLTIP,
} from '../config/treasuryConfig'

interface BridgeModalProps {
  isOpen: boolean
  isInline?: boolean
  onClose: () => void
  connectedAddress: string
  provider: any // Injected EIP-1193 provider
  currentChainId: number
  onSuccess: (amount?: string, txHash?: string) => void
  addToast?: (title: string, description: string, type: 'info' | 'success' | 'warning' | 'error' | 'pending', txHash?: string, network?: string) => string
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

  const isValidEvmAddress = (addr: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(addr)
  const isValidSolanaAddress = (addr: string): boolean => !addr.startsWith('0x') && addr.length >= 32 && addr.length <= 44
  const isValidInjectiveAddress = (addr: string): boolean => addr.startsWith('inj1') && addr.length >= 38

  const isDestSolana = destChain.toLowerCase().includes('solana')
  const isDestInjective = destChain.toLowerCase().includes('injective')

  const recipientIsValid = recipient
    ? isDestSolana
      ? isValidSolanaAddress(recipient)
      : isDestInjective
      ? isValidInjectiveAddress(recipient)
      : isValidEvmAddress(recipient)
    : false

  // Dropdown states
  const [showSourceDropdown, setShowSourceDropdown] = useState(false)
  const [showDestDropdown, setShowDestDropdown] = useState(false)

  // Close dropdowns on outside click
  useEffect(() => {
    const handleOutsideClick = () => {
      setShowSourceDropdown(false)
      setShowDestDropdown(false)
    }
    window.addEventListener('click', handleOutsideClick)
    return () => window.removeEventListener('click', handleOutsideClick)
  }, [])

  const handlePasteRecipient = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setRecipient(text.trim())
        setRecipientError(null)
        setError(null)
      }
    } catch (err) {
      console.error('[BridgeModal] Failed to read clipboard:', err)
    }
  }

  // Load wallet testnet balances & Gateway unified balances
  const { walletBalances, refetch: refetchWalletBalances } = useWalletTestnetBalances(connectedAddress)
  const { balances: gatewayBalances, refresh: refreshGatewayBalances } = useGatewayBalance(connectedAddress)

  const sourceWalletBalance = walletBalances[sourceChain]?.usdc || '0.00'
  const sourceGatewayBalance = gatewayBalances.find(b => b.chainKey === sourceChain)?.balance || '0.00'

  const activeBalance = bridgeMode === 'direct' ? sourceWalletBalance : sourceGatewayBalance
  
  // Custom Platform Fee configuration from ArcFlow Treasury Fee Engine (Dynamic per speed tier)
  const platformFeeAmount = getBridgeProtocolFee(speedTier)
  const platformFeeEnabled = platformFeeAmount > 0
  const requiredDebit = amount ? parseFloat(amount) + (bridgeMode === 'direct' ? platformFeeAmount : 0) : 0
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
    // If currently transferring, preserve fee and do not wipe or re-estimate
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
                }
              })
            })
            const totalFeeInUsdc = cost?.fees?.reduce((acc, fee) => {
              const parsed = fee.amount ? parseFloat(fee.amount) : 0
              return acc + (isNaN(parsed) ? 0 : parsed)
            }, 0) ?? 0

            if (isMounted) {
              setEstimatedFee(totalFeeInUsdc > 0 ? totalFeeInUsdc.toString() : (speedTier === 'standard' ? '0.0000' : '0.2000'))
            }
          }
        }
      } catch (err) {
        if (isMounted) {
          setEstimatedFee(bridgeMode === 'gateway' ? (parseFloat(amount) * 0.00005).toFixed(6) : (speedTier === 'standard' ? '0.0000' : '0.2000'))
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
  }, [amount, sourceChain, destChain, bridgeMode, speedTier, platformFeeEnabled, provider, recipient, connectedAddress, isTransferring])

  if (!isOpen && !isInline) return null

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessReceipt(null)

    const targetRecipient = recipient.trim()
    if (!targetRecipient.startsWith('0x') || targetRecipient.length !== 42) {
      setError('Please enter a valid EVM recipient address (0x...)')
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
      setError(bridgeMode === 'direct'
        ? `Insufficient wallet balance! You have ${sourceWalletBalance} USDC in your wallet on ${getChainDisplayName(sourceChain)}.`
        : `Insufficient Gateway balance! You have ${sourceGatewayBalance} USDC in Gateway on ${getChainDisplayName(sourceChain)}.`
      )
      return
    }

    setIsTransferring(true)

    const sourceName = getChainDisplayName(sourceChain)
    const destName = getChainDisplayName(destChain)

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

        const result: any = await executeBridge(
          {
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
              }
            })
          }
        )

        // Strict verification: Ensure result is valid and not in error state
        if (!result || result.state === 'error' || result.status === 'error' || result.status === 'failed') {
          const errorStep = result?.steps?.find((s: any) => s.state === 'error' || s.errorMessage || s.error)
          const errorMsg = errorStep?.errorMessage || errorStep?.error?.message || result?.errorMessage || result?.error?.message || 'CCTP Bridge transfer failed.'
          throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg))
        }

        mintTxHash = result?.mintTxHash || result?.txHash || result?.steps?.find((s: any) => s.name === 'mint')?.txHash || result?.steps?.find((s: any) => s.name === 'burn')?.txHash || ''
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

      const computedFee = estimatedFee || (bridgeMode === 'gateway' ? (parseFloat(amount) * 0.00005).toFixed(6) : '0.0001')
      const netAmount = (Math.max(0, parseFloat(amount) - parseFloat(computedFee))).toFixed(6)

      const explorerUrl = mintTxHash ? `https://testnet.arcscan.app/tx/${mintTxHash}` : undefined
      setSuccessReceipt({
        txHash: mintTxHash,
        explorerUrl,
        amount,
        sourceChain,
        destChain,
        fee: computedFee,
        netReceived: netAmount,
        mode: bridgeMode
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

  const handleSwapChains = () => {
    setSourceChain(destChain)
    setDestChain(sourceChain)
  }

  const content = (
    <div
      className="relative w-full ub-asset-card arc-animate-reveal overflow-hidden"
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-5 border-b border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{
              color: 'var(--purple-1)',
            }}
          >
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <span className="arc-eyebrow" style={{ fontSize: 16, color: '#ffffff', fontWeight: 600, letterSpacing: '2px' }}>
              BRIDGE
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PrivacyLockButton
            isPrivate={isPrivateBridge}
            onToggle={() => setIsPrivateBridge(prev => !prev)}
            disabled={isTransferring}
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
        </div>
      </div>

      {/* Mode Selector Segmented Capsule */}
      <div
        className="grid grid-cols-2 gap-2 p-1.5 mb-6 rounded-full"
        style={{
          background: 'rgba(0, 0, 0, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        <button
          type="button"
          disabled={isTransferring}
          title="Bridge USDC directly from your connected wallet balance across blockchains using CCTP protocol."
          onClick={() => {
            setBridgeMode('direct')
            if (speedTier === 'turbo') setSpeedTier('fast')
            setError(null)
          }}
          className={`py-2.5 px-4 rounded-full text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            bridgeMode === 'direct'
              ? 'text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
          style={{
            fontFamily: 'var(--font-app)',
            background: bridgeMode === 'direct' ? 'rgba(152, 150, 255, 0.22)' : 'transparent',
            border: bridgeMode === 'direct' ? '1px solid rgba(152, 150, 255, 0.45)' : '1px solid border-transparent',
            boxShadow: bridgeMode === 'direct' ? '0 4px 16px rgba(152, 150, 255, 0.2)' : 'none',
          }}
        >
          <Wallet className="w-3.5 h-3.5" />
          <span>DIRECT CCTP</span>
        </button>

        <button
          type="button"
          disabled={isTransferring}
          title="Instant (<500ms) cross-chain transfer using your Unified Gateway USDC balance pool."
          onClick={() => {
            setBridgeMode('gateway')
            setSpeedTier('turbo')
            setError(null)
          }}
          className={`py-2.5 px-4 rounded-full text-xs font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
            bridgeMode === 'gateway'
              ? 'text-white shadow-md'
              : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
          }`}
          style={{
            fontFamily: 'var(--font-app)',
            background: bridgeMode === 'gateway' ? 'rgba(152, 150, 255, 0.22)' : 'transparent',
            border: bridgeMode === 'gateway' ? '1px solid rgba(152, 150, 255, 0.45)' : '1px solid border-transparent',
            boxShadow: bridgeMode === 'gateway' ? '0 4px 16px rgba(152, 150, 255, 0.2)' : 'none',
          }}
        >
          <Zap className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
          <span>GATEWAY FAST</span>
        </button>
      </div>

      <form onSubmit={handleTransfer} className="space-y-5.5">
        {error && (
          <div className="p-3.5 bg-rose-500/10 rounded-2xl border border-rose-500/25 text-rose-400 text-xs flex gap-2.5 font-[var(--font-app)] items-center">
            <AlertTriangle className="w-4 h-4 shrink-0 font-bold" />
            <span>{error}</span>
          </div>
        )}
        {/* Routing Inputs (Source & Destination) */}
        <div className="grid grid-cols-5 gap-3 sm:gap-3.5 items-center">
          {/* Source Chain */}
          <div className="col-span-2 relative" onClick={(e) => e.stopPropagation()}>
            <label className="block text-xs font-semibold tracking-wide text-slate-300 mb-1.5 ml-3" style={{ fontFamily: 'var(--font-app)' }}>
              SOURCE CHAIN
            </label>
            <button
              type="button"
              disabled={isTransferring}
              onClick={(e) => {
                e.stopPropagation()
                setShowSourceDropdown(prev => !prev)
                setShowDestDropdown(false)
              }}
              className="w-full rounded-2xl px-4 py-3 text-xs text-white focus:outline-none flex items-center justify-between cursor-pointer transition-all duration-200"
              style={{
                background: 'rgba(11, 13, 24, 0.75)',
                border: showSourceDropdown ? '1px solid rgba(152, 150, 255, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: showSourceDropdown ? '0 0 16px rgba(152, 150, 255, 0.2)' : 'none',
                fontFamily: 'var(--font-app)',
              }}
            >
              <div className="flex items-center gap-2 truncate">
                <div style={{ width: 20, height: 20, borderRadius: '50%', overflow: 'hidden', clipPath: 'circle(50% at 50% 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <NetworkIcon
                    name={CHAIN_META[sourceChain]?.iconId || 'ethereum'}
                    variant={CHAIN_META[sourceChain]?.iconId === 'solana' ? 'branded' : 'background'}
                    size={20}
                    className="rounded-full overflow-hidden"
                  />
                </div>
                <span className="font-semibold text-white truncate">{getChainDisplayName(sourceChain)}</span>
              </div>
              <ChevronDown size={14} className={`transition-transform duration-200 text-slate-400 shrink-0 ${showSourceDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showSourceDropdown && (
              <div
                className="absolute z-[120] left-0 right-0 mt-2 max-h-56 overflow-y-auto rounded-2xl shadow-2xl p-1.5 space-y-1 backdrop-blur-2xl"
                style={{
                  background: 'rgba(15, 18, 32, 0.96)',
                  border: '1px solid rgba(152, 150, 255, 0.25)',
                  boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
                }}
              >
                {GATEWAY_SUPPORTED_CHAINS.map((c) => {
                  const iconId = CHAIN_META[c]?.iconId || 'ethereum'
                  const isSelected = sourceChain === c
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setSourceChain(c)
                        setShowSourceDropdown(false)
                        if (c === destChain) {
                          const alternate = GATEWAY_SUPPORTED_CHAINS.find(sc => sc !== c) || ''
                          setDestChain(alternate)
                        }
                      }}
                      className={`w-full text-left px-3 py-2 text-xs rounded-xl transition-all flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-[rgba(152,150,255,0.15)] text-white border border-[rgba(152,150,255,0.3)]'
                          : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div style={{ width: 18, height: 18, borderRadius: '50%', overflow: 'hidden', clipPath: 'circle(50% at 50% 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <NetworkIcon
                            name={iconId}
                            variant={iconId === 'solana' ? 'branded' : 'background'}
                            size={18}
                            className="rounded-full overflow-hidden"
                          />
                        </div>
                        <span className="font-semibold" style={{ fontFamily: 'var(--font-app)' }}>{getChainDisplayName(c)}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Swap Chains Button */}
          <div className="flex justify-center pt-5">
            <button
              type="button"
              onClick={handleSwapChains}
              disabled={isTransferring}
              title="Swap chains"
              className="w-10 h-10 rounded-full flex items-center justify-center text-slate-300 hover:text-white bg-[#0f1220] border border-white/10 hover:border-[var(--purple-1)] hover:shadow-lg hover:shadow-indigo-500/20 hover:scale-110 active:scale-95 transition-all duration-300 cursor-pointer group"
            >
              <ArrowRightLeft className="w-4 h-4 text-slate-400 group-hover:text-[var(--purple-1)] transition-transform duration-300 group-hover:rotate-180" />
            </button>
          </div>

          {/* Destination Chain */}
          <div className="col-span-2 relative" onClick={(e) => e.stopPropagation()}>
            <label className="block text-xs font-semibold tracking-wide text-slate-300 mb-1.5 ml-3" style={{ fontFamily: 'var(--font-app)' }}>
              DESTINATION CHAIN
            </label>
            <button
              type="button"
              disabled={isTransferring}
              onClick={(e) => {
                e.stopPropagation()
                setShowDestDropdown(prev => !prev)
                setShowSourceDropdown(false)
              }}
              className="w-full rounded-2xl px-4 py-3 text-xs text-white focus:outline-none flex items-center justify-between cursor-pointer transition-all duration-200"
              style={{
                background: 'rgba(11, 13, 24, 0.75)',
                border: showDestDropdown ? '1px solid rgba(152, 150, 255, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                boxShadow: showDestDropdown ? '0 0 16px rgba(152, 150, 255, 0.2)' : 'none',
                fontFamily: 'var(--font-app)',
              }}
            >
              <div className="flex items-center gap-2 truncate">
                <div style={{ width: 20, height: 20, borderRadius: '50%', overflow: 'hidden', clipPath: 'circle(50% at 50% 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <NetworkIcon
                    name={CHAIN_META[destChain]?.iconId || 'ethereum'}
                    variant={CHAIN_META[destChain]?.iconId === 'solana' ? 'branded' : 'background'}
                    size={20}
                    className="rounded-full overflow-hidden"
                  />
                </div>
                <span className="font-semibold text-white truncate">{getChainDisplayName(destChain)}</span>
              </div>
              <ChevronDown size={14} className={`transition-transform duration-200 text-slate-400 shrink-0 ${showDestDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showDestDropdown && (
              <div
                className="absolute z-[120] left-0 right-0 mt-2 max-h-56 overflow-y-auto rounded-2xl shadow-2xl p-1.5 space-y-1 backdrop-blur-2xl"
                style={{
                  background: 'rgba(15, 18, 32, 0.96)',
                  border: '1px solid rgba(152, 150, 255, 0.25)',
                  boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
                }}
              >
                {GATEWAY_SUPPORTED_CHAINS.map((c) => {
                  const iconId = CHAIN_META[c]?.iconId || 'ethereum'
                  const isSelected = destChain === c
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setDestChain(c)
                        setShowDestDropdown(false)
                        if (c === sourceChain) {
                          const alternate = GATEWAY_SUPPORTED_CHAINS.find(sc => sc !== c) || ''
                          setSourceChain(alternate)
                        }
                      }}
                      className={`w-full text-left px-3 py-2 text-xs rounded-xl transition-all flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-[rgba(152,150,255,0.15)] text-white border border-[rgba(152,150,255,0.3)]'
                          : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div style={{ width: 18, height: 18, borderRadius: '50%', overflow: 'hidden', clipPath: 'circle(50% at 50% 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <NetworkIcon
                            name={iconId}
                            variant={iconId === 'solana' ? 'branded' : 'background'}
                            size={18}
                            className="rounded-full overflow-hidden"
                          />
                        </div>
                        <span className="font-semibold" style={{ fontFamily: 'var(--font-app)' }}>{getChainDisplayName(c)}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Recipient and Amount */}
        <div className="space-y-4">
          {/* Recipient Address */}
          <div>
            <div className="flex items-center justify-between mb-1.5 px-3">
              <label className="block text-xs font-semibold tracking-wide text-slate-300" style={{ fontFamily: 'var(--font-app)' }}>
                RECIPIENT ADDRESS
              </label>

              {/* Quick Fill Connected Solana Wallet */}
              {isDestSolana && solana.isConnected && solana.address && (
                <button
                  type="button"
                  onClick={() => {
                    setRecipient(solana.address)
                    setRecipientError(null)
                    setError(null)
                  }}
                  className="text-[10px] text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 cursor-pointer transition"
                >
                  <NetworkIcon name="solana" size={11} variant="branded" />
                  <span>Bağlı Solana ({solana.address.slice(0, 4)}...{solana.address.slice(-4)})</span>
                </button>
              )}

              {/* Quick Fill Connected Injective Wallet */}
              {isDestInjective && injective.isConnected && injective.address && (
                <button
                  type="button"
                  onClick={() => {
                    setRecipient(injective.address)
                    setRecipientError(null)
                    setError(null)
                  }}
                  className="text-[10px] text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 cursor-pointer transition"
                >
                  <NetworkIcon name="injective" size={11} variant="branded" />
                  <span>Bağlı Injective ({injective.address.slice(0, 6)}...{injective.address.slice(-4)})</span>
                </button>
              )}
            </div>

            <div className="relative flex items-center">
              <input
                type="text"
                required
                placeholder={isDestSolana ? 'Solana Base58 Adresi (ör: 9WzD...)' : isDestInjective ? 'Injective Adresi (inj1...)' : '0x...'}
                value={recipient}
                onChange={(e) => {
                  const val = e.target.value.trim()
                  setRecipient(val)
                  setRecipientError(null)
                  setError(null)
                }}
                onBlur={() => {
                  if (recipient && !recipientIsValid) {
                    if (isDestSolana) {
                      setRecipientError('Lütfen geçerli bir Solana adresi (Base58) girin.')
                    } else if (isDestInjective) {
                      setRecipientError('Lütfen geçerli bir Injective adresi (inj1...) girin.')
                    } else {
                      setRecipientError('Lütfen geçerli bir EVM adresi (0x...) girin.')
                    }
                  }
                }}
                disabled={isTransferring}
                className={`w-full rounded-2xl pl-4 pr-16 py-3.5 text-xs text-white focus:outline-none font-mono transition-all ${
                  recipientError
                    ? 'bg-rose-500/[0.08] border border-rose-500/40 focus:border-rose-500'
                    : recipientIsValid
                      ? 'bg-[rgba(11,13,24,0.95)] border-2 border-emerald-500 focus:border-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.3)]'
                      : 'bg-[rgba(11,13,24,0.75)] border border-white/10 focus:border-[var(--purple-1)]'
                }`}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {recipient && (
                  <button
                    type="button"
                    onClick={() => {
                      setRecipient('')
                      setRecipientError(null)
                      setError(null)
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-all cursor-pointer"
                    title="Clear"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handlePasteRecipient}
                  disabled={isTransferring}
                  title="Paste from clipboard"
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.08] active:scale-95 transition-all cursor-pointer group"
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                  }}
                >
                  <Clipboard className="w-3.5 h-3.5 transition-transform duration-200 group-hover:scale-110 group-hover:text-[var(--purple-1)]" />
                </button>
              </div>
            </div>

            {recipientError && (
              <div className="flex items-center gap-1.5 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1.5 rounded-xl animate-shake mt-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>{recipientError}</span>
              </div>
            )}
          </div>

          {/* Amount Card */}
          <div
            className="p-5 rounded-2xl"
            style={{
              background: 'rgba(11, 13, 24, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div className="flex justify-between items-center mb-2.5">
              <label className="text-xs font-semibold tracking-wide text-slate-300" style={{ fontFamily: 'var(--font-app)' }}>
                AMOUNT
              </label>
              <div className="text-right">
                <span className="text-xs text-slate-400" style={{ fontFamily: 'var(--font-app)' }}>
                  Balance: <strong className="text-white ml-1">{activeBalance} USDC</strong>
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1">
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  placeholder="0.00"
                  value={amount}
                  onKeyDown={(e) => {
                    // Prevent typing negative sign, plus, exponential, or down arrow below 0
                    if (e.key === '-' || e.key === '+' || e.key === 'e' || e.key === 'E') {
                      e.preventDefault()
                    }
                    if (e.key === 'ArrowDown') {
                      const currentVal = parseFloat(amount)
                      if (isNaN(currentVal) || currentVal <= 0) {
                        e.preventDefault()
                        setAmount('0')
                      }
                    }
                  }}
                  onChange={(e) => {
                    let val = e.target.value
                    if (val === '') {
                      setAmount('')
                      return
                    }
                    if (val.includes('-')) {
                      val = val.replace(/-/g, '')
                    }
                    const num = parseFloat(val)
                    if (!isNaN(num) && num < 0) {
                      setAmount('0')
                      return
                    }
                    setAmount(val)
                  }}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text')
                    if (text.includes('-') || parseFloat(text) < 0) {
                      e.preventDefault()
                      const sanitized = text.replace(/[^0-9.]/g, '')
                      if (sanitized && !isNaN(parseFloat(sanitized))) {
                        setAmount(sanitized)
                      }
                    }
                  }}
                  disabled={isTransferring}
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
                  onClick={() => setAmount(activeBalance)}
                  disabled={isTransferring}
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
                <div
                  className="rounded-2xl px-3 py-2 text-xs text-white flex items-center gap-2"
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  <img src={UsdcIcon} alt="USDC" className="w-5 h-5 object-contain" />
                  <span className="font-semibold">USDC</span>
                </div>
              </div>
            </div>
            {isInsufficient && (
              <p className="text-xs text-rose-400 mt-2 font-medium" style={{ fontFamily: 'var(--font-app)' }}>
                Insufficient wallet balance!
              </p>
            )}
          </div>
        </div>

        {/* Comprehensive Itemized Fee Breakdown Card */}
        {amount && parseFloat(amount) > 0 && (
          <div
            className="p-4.5 sm:p-5 rounded-2xl space-y-2.5 text-xs animate-fade-in"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              fontFamily: 'var(--font-app)',
              color: 'var(--fp-3)',
            }}
          >
            <div className="flex items-center justify-between text-slate-300">
              <span>Bridge Amount:</span>
              <span className="text-white font-semibold flex items-center gap-1.5">
                <img src={UsdcIcon} alt="USDC" className="w-3.5 h-3.5 object-contain" />
                {parseFloat(amount).toFixed(2)} USDC
              </span>
            </div>

            {/* Platform Custom Fee (ArcFlow Platform Fee) */}
            {platformFeeEnabled && bridgeMode === 'direct' && (
              <div className="flex items-center justify-between text-slate-300 border-t border-white/[0.04] pt-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[var(--purple-1)] font-medium">ArcFlow Platform Fee:</span>
                  <a
                    href={TREASURY_EXPLORER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Treasury: ${formatTreasuryAddress(TREASURY_ADDRESS)} (${REVENUE_SHARE_TOOLTIP})`}
                    className="text-[10px] bg-[rgba(152,150,255,0.15)] text-[var(--purple-1)] hover:bg-[rgba(152,150,255,0.25)] px-1.5 py-0.2 rounded-full border border-[rgba(152,150,255,0.3)] flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>{REVENUE_SHARE_LABEL}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
                <span className="text-[var(--purple-1)] font-medium font-mono flex items-center gap-1">
                  +{platformFeeAmount.toFixed(2)} USDC
                </span>
              </div>
            )}

            {/* CCTP Protocol or Gateway Transfer Fee */}
            <div className="flex items-center justify-between text-slate-300 border-t border-white/[0.04] pt-2">
              <span>{bridgeMode === 'gateway' ? 'Gateway Protocol Fee (0.005%):' : speedTier === 'standard' ? 'Standard Fee:' : 'Forwarding Service Fee:'}</span>
              {isEstimating ? (
                <div className="flex items-center gap-1.5 text-[var(--purple-1)]">
                  <span>Calculating...</span>
                  <RefreshCw className="w-3 h-3 animate-spin" />
                </div>
              ) : (
                <span className="text-slate-200 font-mono">
                  {bridgeMode === 'gateway'
                    ? `${(parseFloat(amount) * 0.00005).toFixed(6)} USDC`
                    : speedTier === 'standard'
                      ? '0.0000 USDC'
                      : `${estimatedFee || '0.2000'} USDC`}
                </span>
              )}
            </div>

            {/* Total Wallet Debit */}
            <div className="flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-slate-200">
              <span className="font-medium">Total Wallet Debit:</span>
              <span className="font-semibold text-white flex items-center gap-1.5 font-mono">
                <img src={UsdcIcon} alt="USDC" className="w-3.5 h-3.5 object-contain" />
                {requiredDebit.toFixed(6)} USDC
              </span>
            </div>

            {/* Net Received on Destination */}
            <div className="flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-emerald-400 font-semibold">
              <span>Net Received at Destination:</span>
              <span className="flex items-center gap-1.5 font-mono text-sm">
                <img src={UsdcIcon} alt="USDC" className="w-3.5 h-3.5 object-contain" />
                {(
                  Math.max(
                    0,
                    parseFloat(amount) -
                      parseFloat(
                        bridgeMode === 'gateway'
                          ? (parseFloat(amount) * 0.00005).toFixed(6)
                          : (speedTier === 'standard' ? '0.0000' : (estimatedFee || '0.2000'))
                      )
                  )
                ).toFixed(6)}{' '}
                USDC
              </span>
            </div>

            {/* Speed & Priority Setting Trigger */}
            <div className="flex items-center justify-between border-t border-white/[0.04] pt-2 text-slate-300">
              <span>Bridge Priority:</span>
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
                <span>{SPEED_TIERS[speedTier].label} {SPEED_TIERS[speedTier].timeEstimate.cctpBridge}</span>
              </button>
            </div>
          </div>
        )}

        {!successReceipt && (
          <button
            type="submit"
            disabled={isTransferring || isInsufficient}
            className="w-full py-4 mt-4 rounded-full text-sm font-semibold tracking-wide text-white transition-all flex items-center justify-center gap-2 cursor-pointer"
            style={{
              fontFamily: 'var(--font-app)',
              background: (isTransferring || isInsufficient)
                ? 'rgba(152, 150, 255, 0.3)'
                : 'linear-gradient(135deg, #9896ff 0%, #7c3aed 100%)',
              boxShadow: (isTransferring || isInsufficient) ? 'none' : '0 6px 24px rgba(152, 150, 255, 0.3)',
              cursor: (isTransferring || isInsufficient) ? 'not-allowed' : 'pointer',
            }}
          >
            {isTransferring ? (
              <>
                <RefreshCw className="w-4 h-4 arcflow-spin" />
                <span>{bridgeMode === 'direct' ? 'BRIDGING CCTP...' : 'TRANSFERRING FAST...'}</span>
              </>
            ) : (
              <>
                <Globe className="w-4 h-4" />
                <span>{bridgeMode === 'direct' ? 'BRIDGE VIA CCTP' : 'FAST GATEWAY TRANSFER'}</span>
              </>
            )}
          </button>
        )}
      </form>

      {/* Success Screen */}
      {successReceipt && (
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
            <span>BRIDGE COMPLETED SUCCESSFULLY</span>
          </div>

          <div
            className="p-4 rounded-xl space-y-2.5 text-xs"
            style={{
              background: 'rgba(11, 13, 24, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 text-slate-300">
              <span>Amount</span>
              <span className="text-white font-semibold flex items-center gap-1.5">
                <img src={UsdcIcon} alt="USDC" className="w-3.5 h-3.5 object-contain" />
                {successReceipt.amount} USDC
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 text-slate-300">
              <span>Method</span>
              <span className="text-white font-medium">
                {successReceipt.mode === 'direct' ? 'Direct CCTP Bridge' : 'Gateway Fast Transfer'}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 text-slate-300">
              <span>Route</span>
              <span className="text-white font-medium flex items-center gap-1.5">
                <div style={{ width: 14, height: 14, borderRadius: '50%', overflow: 'hidden', clipPath: 'circle(50% at 50% 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <NetworkIcon
                    name={CHAIN_META[successReceipt.sourceChain]?.iconId || 'ethereum'}
                    variant={CHAIN_META[successReceipt.sourceChain]?.iconId === 'solana' ? 'branded' : 'background'}
                    size={14}
                    className="rounded-full overflow-hidden"
                  />
                </div>
                <span>{getChainDisplayName(successReceipt.sourceChain)}</span>
                <span className="text-slate-500">→</span>
                <div style={{ width: 14, height: 14, borderRadius: '50%', overflow: 'hidden', clipPath: 'circle(50% at 50% 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <NetworkIcon
                    name={CHAIN_META[successReceipt.destChain]?.iconId || 'ethereum'}
                    variant={CHAIN_META[successReceipt.destChain]?.iconId === 'solana' ? 'branded' : 'background'}
                    size={14}
                    className="rounded-full overflow-hidden"
                  />
                </div>
                <span>{getChainDisplayName(successReceipt.destChain)}</span>
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 text-slate-300">
              <span>Protocol / Bridge Fee</span>
              <span className="text-white font-medium flex items-center gap-1.5">
                <img src={UsdcIcon} alt="USDC" className="w-3.5 h-3.5 object-contain" />
                {successReceipt.fee} USDC
              </span>
            </div>
            <div className="flex items-center justify-between text-emerald-400 font-semibold">
              <span>Net Received</span>
              <span className="flex items-center gap-1.5">
                <img src={UsdcIcon} alt="USDC" className="w-3.5 h-3.5 object-contain" />
                {successReceipt.netReceived || successReceipt.amount} USDC
              </span>
            </div>
            {successReceipt.explorerUrl && (
              <div className="flex items-center justify-between border-t border-white/[0.06] pt-2 text-slate-300">
                <span>Explorer</span>
                <a
                  href={successReceipt.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white hover:text-[var(--purple-1)] flex items-center gap-1 font-semibold"
                >
                  <span>View Explorer</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            )}
          </div>

          <div className="flex gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => {
                setSuccessReceipt(null)
                setError(null)
                setIsTransferring(false)
              }}
              className="ub-action-btn ub-action-btn-primary flex-1 justify-center py-2.5 text-xs font-semibold"
            >
              <Globe className="w-4 h-4" />
              <span>BRIDGE AGAIN</span>
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
    </div>
  )

  // Bridge Settings Window / Modal rendered over document.body via Portal
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
                  <p className="text-[11px] text-slate-400">CCTP & Gateway speed preferences</p>
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

            {/* Speed & Execution Priority Section */}
            <div className="space-y-3">
              <SpeedFeeSelector
                selectedTier={speedTier}
                onSelectTier={handleSpeedTierChange}
                context="bridge"
                disabled={isTransferring}
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