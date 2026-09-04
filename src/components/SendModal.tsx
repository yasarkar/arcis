import React, { useState, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  ArrowUpRight,
  AlertTriangle,
  Settings,
  Wallet,
  Zap,
  FileText,
  Check,
  ChevronDown,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import { formatUnits, createPublicClient, http, erc20Abi } from 'viem'
import { getDisplayTokenSymbol, CHAIN_NATIVE_MAP } from '../utils/tokenUtils'
import { useGatewayBalance } from '../hooks/useGatewayBalance'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { estimateGas, sendToken } from '../services/sendService'
import { sendUsdcWithMemo } from '../services/memoService'
import { MEMO_PRESETS, type MemoPreset } from '../config/memoConfig'
import { transferFromGateway } from '../services/gatewayService'
import { GATEWAY_DOMAINS } from '../config/gatewayConfig'
import {
  SUPPORTED_SEND_CHAINS,
  CHAIN_DEFS,
  getChainIconId,
  getExplorerTxUrl,
} from '../config/sendConfig'
import { ARC_METADATA } from '../config/arcChain'
import { addTransaction } from '../utils/history'
import { formatWalletError } from '../utils/errorUtils'
import { PrivacyLockButton } from './privacy/PrivacyLockButton'
import { useBroadcast } from './BroadcastNotification'
import { SpeedFeeSelector } from './common/SpeedFeeSelector'
import { SPEED_TIERS, type SpeedTier } from '../config/feeTiers'
import { getSendProtocolFee } from '../config/treasuryConfig'
import {
  getGaslessQuota,
  sendGaslessUsdcTransfer,
  type GaslessQuota,
} from '../services/gaslessService'
import { GaslessIconButton } from './common/GaslessIconButton'
import {
  FintechCard,
  AssetInputPanel,
  RecipientAddressField,
  SegmentedModeSwitch,
  SendSuccessReceipt,
  TokenSelectorModal,
  ChainSelectorModal,
  TransactionBreakdown,
  FintechActionButton,
  type TokenItem,
  type BreakdownItem,
  type ModeOption,
} from './fintech'

const TOKEN_ICONS: Record<string, string> = {
  USDC: UsdcIcon,
  EURC: EurcIcon,
  cirBTC: CircleIcon,
}

interface SendModalProps {
  isOpen: boolean
  isInline?: boolean
  onClose: () => void
  connectedAddress: string
  provider: any
  currentChainId: number
  onSuccess?: (amount?: string, txHash?: string) => void
  addToast?: (title: string, description: string, type: 'info' | 'success' | 'warning' | 'error' | 'pending', txHash?: string, network?: string) => string
  removeToast?: (id: string) => void
}

export default function SendModal({
  isOpen,
  isInline = false,
  onClose,
  connectedAddress,
  provider,
  onSuccess,
}: SendModalProps) {
  const { addBroadcast, updateBroadcast } = useBroadcast()

  // Mode Selection: 'direct' (Wallet Balance) or 'gateway' (Unified USDC Balance)
  const [sendMode, setSendMode] = useState<'direct' | 'gateway'>('direct')

  // Speed & Network Execution Priority
  const [speedTier, setSpeedTier] = useState<SpeedTier>('fast')
  const [showSettings, setShowSettings] = useState(false)
  const [isPrivateSend, setIsPrivateSend] = useState(false)

  const [recipient, setRecipient] = useState('')
  const [recipientError, setRecipientError] = useState<string | null>(null)
  const [amount, setAmount] = useState('')

  // Dynamic Chain Selector
  const [selectedChain, setSelectedChain] = useState('Arc_Testnet')
  const [showChainModal, setShowChainModal] = useState(false)

  // Address validation
  const isValidEvmAddress = (addr: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(addr)
  const isValidSolanaAddress = (addr: string): boolean =>
    !addr.startsWith('0x') && addr.length >= 32 && addr.length <= 44
  const isValidInjectiveAddress = (addr: string): boolean => addr.startsWith('inj1') && addr.length >= 38

  const isChainSolana = selectedChain.toLowerCase().includes('solana')
  const isChainInjective = selectedChain.toLowerCase().includes('injective')

  const recipientIsValid = recipient
    ? isChainSolana
      ? isValidSolanaAddress(recipient)
      : isChainInjective
      ? isValidInjectiveAddress(recipient)
      : isValidEvmAddress(recipient)
    : false

  // Dynamic Token selector
  const [token, setToken] = useState('USDC')
  const [showTokenModal, setShowTokenModal] = useState(false)
  const [isCustom, setIsCustom] = useState(false)
  const [customTokenAddress, setCustomTokenAddress] = useState('')
  const [customTokenResult, setCustomTokenResult] = useState<any | null>(null)
  const [customTokenError, setCustomTokenError] = useState<string | null>(null)
  const [isInspectingCustomToken, setIsInspectingCustomToken] = useState(false)

  const [isSending, setIsSending] = useState(false)
  const [successReceipt, setSuccessReceipt] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const [estimatedFee, setEstimatedFee] = useState<string | null>(null)
  const [nativeBalance, setNativeBalance] = useState('0.00')

  // EIP-3009 Gasless Quick-Start State
  const [isGaslessMode, setIsGaslessMode] = useState<boolean>(true)
  const [gaslessQuota, setGaslessQuota] = useState<GaslessQuota | null>(null)
  const [gaslessStage, setGaslessStage] = useState<'idle' | 'signing' | 'relaying' | 'finalizing'>('idle')

  // Arc Transaction Memo State
  const [showMemoPanel, setShowMemoPanel] = useState(false)
  const [memoText, setMemoText] = useState('')
  const [customMemoId, setCustomMemoId] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)

  // Load gasless quota when wallet is connected
  useEffect(() => {
    if (!connectedAddress || !isOpen) return
    let isMounted = true
    getGaslessQuota(connectedAddress)
      .then((q) => {
        if (isMounted) setGaslessQuota(q)
      })
      .catch(console.error)
    return () => {
      isMounted = false
    }
  }, [connectedAddress, isOpen])

  const handleSelectMemoPreset = (preset: MemoPreset) => {
    setSelectedPresetId(preset.id)
    setMemoText(preset.text)
    if (preset.refIdPrefix) {
      setCustomMemoId(`${preset.refIdPrefix}-${Math.random().toString(36).substring(2, 7)}`)
    }
  }

  const handleClearMemo = () => {
    setSelectedPresetId(null)
    setMemoText('')
    setCustomMemoId('')
  }

  // Load connected wallet balances across testnet chains & Gateway unified balance
  const { walletBalances, refetch: refetchWalletBalances } = useWalletTestnetBalances(connectedAddress)
  const {
    balances: gatewayBalances,
    totalBalance: gatewayTotalBalance,
    refresh: refreshGatewayBalances,
  } = useGatewayBalance(connectedAddress)

  const usdcWalletBalance = walletBalances[selectedChain]?.usdc || '0.00'
  const eurcWalletBalance = walletBalances[selectedChain]?.eurc || '0.00'
  const cirbtcWalletBalance = walletBalances[selectedChain]?.cirbtc || '0.00000'

  // Reset custom token state if switching to Gateway mode
  useEffect(() => {
    if (sendMode === 'gateway') {
      if (isCustom) setIsCustom(false)
      if (token !== 'USDC') setToken('USDC')
    }
  }, [sendMode, isCustom, token])

  // Determine active balance depending on send mode and token selection
  const activeBalance =
    sendMode === 'gateway'
      ? gatewayTotalBalance || '0.00'
      : isCustom
      ? customTokenResult?.balance || '0.00'
      : token === 'USDC'
      ? usdcWalletBalance
      : token === 'EURC'
      ? eurcWalletBalance
      : token === 'cirBTC'
      ? cirbtcWalletBalance
      : token === 'NATIVE'
      ? nativeBalance
      : '0.00'

  const activeToken = sendMode === 'gateway' ? 'USDC' : isCustom ? customTokenAddress : token
  const tokenSymbol =
    sendMode === 'gateway'
      ? 'USDC'
      : isCustom
      ? customTokenResult?.symbol || 'Custom Token'
      : getDisplayTokenSymbol(selectedChain, token)

  // EIP-3009 Gasless Eligibility
  const isArcUsdc =
    selectedChain === 'Arc_Testnet' && (isCustom ? false : token === 'USDC') && sendMode === 'direct'
  const isGaslessActive = isArcUsdc && isGaslessMode && (gaslessQuota ? gaslessQuota.remainingQuota > 0 : true)

  // Dynamic Arcis Protocol Fee
  const sendProtocolFee =
    selectedChain === 'Arc_Testnet' && tokenSymbol === 'USDC' && sendMode === 'direct' && !isGaslessActive
      ? getSendProtocolFee(speedTier)
      : 0
  const totalSendDebit = amount ? parseFloat(amount) + sendProtocolFee : 0
  const isInsufficient = amount ? totalSendDebit > parseFloat(activeBalance) : false

  // Fetch native token balance from RPC when "NATIVE" is selected in Direct mode
  useEffect(() => {
    if (!connectedAddress || !isOpen) return
    if (sendMode !== 'direct' || token !== 'NATIVE' || isCustom) return

    let isMounted = true
    const fetchNativeBal = async () => {
      try {
        if (provider) {
          const rpcClient = createPublicClient({
            transport: http(ARC_METADATA.rpcHttpUrl),
          })
          const bal = await rpcClient.getBalance({ address: connectedAddress as `0x${string}` })
          const decimals = CHAIN_NATIVE_MAP[selectedChain]?.decimals || 18
          const formatted = parseFloat(formatUnits(bal, decimals)).toFixed(4)
          if (isMounted) {
            setNativeBalance(formatted)
          }
        }
      } catch (e) {
        console.error('[SendModal] Failed to fetch native balance:', e)
        if (isMounted) setNativeBalance('0.00')
      }
    }

    fetchNativeBal()
    return () => {
      isMounted = false
    }
  }, [selectedChain, token, isCustom, connectedAddress, isOpen, provider, sendMode])

  // Custom ERC-20 Token Contract Inspection Effect
  useEffect(() => {
    if (!isOpen || sendMode !== 'direct' || !isCustom) return

    const trimmedAddress = customTokenAddress.trim()
    if (!isValidEvmAddress(trimmedAddress)) {
      setCustomTokenResult(null)
      setCustomTokenError(trimmedAddress ? 'Invalid ERC-20 token address' : null)
      return
    }

    let isMounted = true
    setIsInspectingCustomToken(true)
    setCustomTokenError(null)

    const inspectToken = async () => {
      try {
        const client = createPublicClient({
          transport: http(
            selectedChain === 'Arc_Testnet'
              ? ARC_METADATA.rpcHttpUrl
              : CHAIN_DEFS[selectedChain]?.rpcUrl || ARC_METADATA.rpcHttpUrl
          ),
        })

        const [symbol, decimals, balance] = await Promise.all([
          client.readContract({
            address: trimmedAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: 'symbol',
          }),
          client.readContract({
            address: trimmedAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: 'decimals',
          }),
          connectedAddress
            ? client.readContract({
                address: trimmedAddress as `0x${string}`,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [connectedAddress as `0x${string}`],
              })
            : BigInt(0),
        ])

        if (isMounted) {
          setCustomTokenResult({
            address: trimmedAddress,
            symbol: String(symbol),
            decimals: Number(decimals),
            balance: parseFloat(formatUnits(balance, Number(decimals))).toFixed(4),
          })
          setIsInspectingCustomToken(false)
        }
      } catch (err: any) {
        console.error('[SendModal] Custom token inspection failed:', err)
        if (isMounted) {
          setCustomTokenResult(null)
          setCustomTokenError('Failed to inspect ERC-20 token contract.')
          setIsInspectingCustomToken(false)
        }
      }
    }

    inspectToken()
    return () => {
      isMounted = false
    }
  }, [customTokenAddress, isCustom, selectedChain, connectedAddress, isOpen, sendMode])

  // Fee estimation
  useEffect(() => {
    if (!isOpen || !amount || parseFloat(amount) <= 0) {
      setEstimatedFee(null)
      return
    }

    let isMounted = true
    const calculateFee = async () => {
      if (sendMode === 'gateway') {
        setEstimatedFee('0.00 (Gateway)')
        return
      }
      if (isGaslessActive) {
        setEstimatedFee('0.00 (Gasless Sponsored)')
        return
      }

      try {
        if (selectedChain === 'Arc_Testnet') {
          setEstimatedFee('0.00135')
        } else if (provider) {
          const gasRes = await estimateGas(
            provider,
            selectedChain,
            isCustom ? customTokenAddress : token,
            recipientIsValid ? recipient : undefined,
            amount || '1'
          )
          if (isMounted && gasRes?.fee) {
            const nativeInfo = CHAIN_NATIVE_MAP[selectedChain]
            const decimals = nativeInfo?.decimals ?? 18
            const formatted = formatUnits(BigInt(gasRes.fee), decimals)
            const feeNum = parseFloat(formatted)
            setEstimatedFee(feeNum > 0 ? feeNum.toFixed(5) : '0.00042')
          }
        }
      } catch (err) {
        if (isMounted) setEstimatedFee('0.0015')
      }
    }

    calculateFee()
    return () => {
      isMounted = false
    }
  }, [isOpen, amount, sendMode, isGaslessActive, selectedChain, provider, token, customTokenAddress, isCustom, recipient, recipientIsValid])

  // Reset modal state on open
  useEffect(() => {
    if (isOpen) {
      setIsSending(false)
      setGaslessStage('idle')
      setSuccessReceipt(null)
      setError(null)
      setEstimatedFee(null)
      setShowSettings(false)
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

  // Send execution
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessReceipt(null)

    if (!recipientIsValid) {
      setError(`Please enter a valid recipient address for ${selectedChain.replace(/_/g, ' ')}`)
      return
    }

    const sendAmt = parseFloat(amount)
    if (isNaN(sendAmt) || sendAmt <= 0) {
      setError('Please enter a valid amount')
      return
    }

    if (sendMode === 'direct' && isCustom && !customTokenAddress) {
      setError('Please enter a valid custom token address')
      return
    }

    setIsSending(true)

    const displayToken = isCustom
      ? customTokenResult?.symbol || 'Custom Token'
      : getDisplayTokenSymbol(selectedChain, token)
    const tokenIcon = isCustom ? undefined : TOKEN_ICONS[token] || TOKEN_ICONS[displayToken]

    const broadcastId = addBroadcast({
      title: sendMode === 'gateway' ? 'Sending via Gateway...' : `Sending ${displayToken}...`,
      status: 'pending',
      badgeText: sendMode === 'gateway' ? 'Instant' : 'Pending',
      details: {
        fromAmount: amount,
        fromSymbol: sendMode === 'gateway' ? 'USDC' : displayToken,
        fromIcon: sendMode === 'gateway' ? TOKEN_ICONS.USDC : tokenIcon,
        toSymbol: recipient,
        network: selectedChain,
      },
    })

    if (provider) {
      try {
        if (sendMode === 'gateway') {
          if (GATEWAY_DOMAINS[selectedChain] === undefined) {
            const errorText = `Bridge is not supported on ${selectedChain.replace(/_/g, ' ')}.`
            setError(errorText)
            setIsSending(false)
            updateBroadcast(broadcastId, {
              title: 'Gateway Send Failed',
              status: 'failed',
              badgeText: 'Failed',
              message: errorText,
            })
            return
          }

          const sourceBalItem = gatewayBalances.find((b) => parseFloat(b.balance) >= sendAmt)
          const effectiveSourceChain =
            sourceBalItem?.chainKey && GATEWAY_DOMAINS[sourceBalItem.chainKey] !== undefined
              ? sourceBalItem.chainKey
              : GATEWAY_DOMAINS[selectedChain] !== undefined
              ? selectedChain
              : 'Arc_Testnet'

          await new Promise((r) => setTimeout(r, 600))

          const gatewayRes = await transferFromGateway({
            provider,
            sourceChain: effectiveSourceChain,
            destinationChain: selectedChain,
            amount,
            recipient,
            sourceChainDef: CHAIN_DEFS[effectiveSourceChain] || CHAIN_DEFS['Arc_Testnet'],
            destinationChainDef: CHAIN_DEFS[selectedChain] || CHAIN_DEFS['Arc_Testnet'],
          })

          const txHash = gatewayRes.mintTxHash || ''
          setIsSending(false)

          const explorerUrl = getExplorerTxUrl(selectedChain, txHash)

          setSuccessReceipt({
            txHash,
            explorerUrl,
            gasFee: 'Zero Extra Gateway Fee',
            blockNumber: 'Instant Gateway Finalized',
          })

          updateBroadcast(broadcastId, {
            title: 'Gateway Send Finalized',
            status: 'success',
            badgeText: '<500ms Instant',
            details: {
              fromAmount: amount,
              fromSymbol: 'USDC',
              fromIcon: TOKEN_ICONS.USDC,
              toSymbol: recipient,
              network: selectedChain,
              txHash,
            },
          })

          refetchWalletBalances()
          refreshGatewayBalances()
          addTransaction({
            type: 'send',
            txHash,
            amount,
            tokenSymbol: 'USDC (Gateway)',
            sourceChain: selectedChain,
            recipient,
            userAddress: connectedAddress,
            status: 'success',
            isPrivate: isPrivateSend,
          })
          onSuccess?.(amount, txHash)
        } else {
          // Check if Arc Native Transaction Memo is active
          const isArcMemoActive =
            selectedChain === 'Arc_Testnet' && activeToken === 'USDC' && memoText.trim().length > 0

          if (isArcMemoActive) {
            await new Promise((r) => setTimeout(r, 600))

            const memoResult = await sendUsdcWithMemo(
              provider,
              recipient,
              amount,
              memoText.trim(),
              customMemoId.trim() || undefined,
              speedTier
            )
            const txHash = memoResult.txHash
            setIsSending(false)

            const explorerUrl = getExplorerTxUrl(selectedChain, txHash)

            setSuccessReceipt({
              txHash,
              explorerUrl,
              gasFee: '0.00135 USDC',
              blockNumber: memoResult.blockNumber.toString(),
              memoText: memoResult.memoText,
              memoId: memoResult.memoId,
            })

            updateBroadcast(broadcastId, {
              title: 'Memo Transfer Confirmed',
              status: 'success',
              badgeText: 'Memo Attached',
              details: {
                fromAmount: amount,
                fromSymbol: displayToken,
                fromIcon: tokenIcon,
                toSymbol: recipient,
                network: selectedChain,
                txHash,
              },
            })

            refetchWalletBalances()
            refreshGatewayBalances()
            addTransaction({
              type: 'send',
              txHash,
              amount,
              tokenSymbol: displayToken,
              sourceChain: selectedChain,
              recipient,
              userAddress: connectedAddress,
              status: 'success',
              isPrivate: isPrivateSend,
              memo: memoText.trim(),
              memoId: memoResult.memoId,
            })
            onSuccess?.(amount, txHash)
          } else if (isGaslessActive) {
            // EIP-3009 Gasless Transfer
            setGaslessStage('signing')
            const gaslessPromise = sendGaslessUsdcTransfer({
              provider,
              from: connectedAddress,
              to: recipient,
              amount,
            })

            setTimeout(() => {
              setGaslessStage((prev) => (prev === 'signing' ? 'relaying' : prev))
            }, 1200)

            const gaslessResult = await gaslessPromise
            setGaslessStage('finalizing')
            await new Promise((r) => setTimeout(r, 400))

            const txHash = gaslessResult.txHash
            setIsSending(false)
            setGaslessStage('idle')

            const explorerUrl = getExplorerTxUrl(selectedChain, txHash)

            setSuccessReceipt({
              txHash,
              explorerUrl,
              gasFee: '0.00 USDC (100% Sponsored by Arc)',
              blockNumber: 'Gasless BFT Finalized',
            })

            updateBroadcast(broadcastId, {
              title: 'Gasless USDC Transfer Confirmed',
              status: 'success',
              badgeText: '0 Gas Sponsored',
              details: {
                fromAmount: amount,
                fromSymbol: 'USDC',
                fromIcon: TOKEN_ICONS.USDC,
                toSymbol: recipient,
                network: selectedChain,
                txHash,
              },
            })

            setGaslessQuota((prev) => (prev ? { ...prev, remainingQuota: gaslessResult.remainingQuota } : null))
            refetchWalletBalances()
            refreshGatewayBalances()
            addTransaction({
              type: 'send',
              txHash,
              amount,
              tokenSymbol: 'USDC (Gasless)',
              sourceChain: selectedChain,
              recipient,
              userAddress: connectedAddress,
              status: 'success',
              isPrivate: isPrivateSend,
            })
            onSuccess?.(amount, txHash)
          } else {
            await new Promise((r) => setTimeout(r, 1000))

            const result = await sendToken(provider, selectedChain, activeToken, recipient, amount)
            const txHash = result.txHash || ''
            setIsSending(false)

            const explorerUrl = getExplorerTxUrl(selectedChain, txHash)

            setSuccessReceipt({
              txHash,
              explorerUrl,
              gasFee: estimatedFee ? `${estimatedFee} USDC` : '0.00135 equivalent',
              blockNumber: 'Instant BFT Finalized',
            })

            updateBroadcast(broadcastId, {
              title: 'Transfer Sent',
              status: 'success',
              badgeText: 'Confirmed',
              details: {
                fromAmount: amount,
                fromSymbol: displayToken,
                fromIcon: tokenIcon,
                toSymbol: recipient,
                network: selectedChain,
                txHash,
              },
            })

            refetchWalletBalances()
            refreshGatewayBalances()
            addTransaction({
              type: 'send',
              txHash,
              amount,
              tokenSymbol: displayToken,
              sourceChain: selectedChain,
              recipient,
              userAddress: connectedAddress,
              status: 'success',
              isPrivate: isPrivateSend,
            })
            onSuccess?.(amount, txHash)
          }
        }
      } catch (err: any) {
        console.error('Token transfer failed:', err)
        const errMsg = formatWalletError(err)
        setError(errMsg)
        setIsSending(false)
        setGaslessStage('idle')

        updateBroadcast(broadcastId, {
          title: sendMode === 'gateway' ? 'Gateway Send Failed' : 'Transfer Failed',
          status: 'failed',
          badgeText: 'Failed',
          message: errMsg,
          details: {
            fromAmount: amount,
            fromSymbol: sendMode === 'gateway' ? 'USDC' : displayToken,
            fromIcon: sendMode === 'gateway' ? TOKEN_ICONS.USDC : tokenIcon,
            toSymbol: recipient,
            network: selectedChain,
          },
        })
      }
    }
  }

  // Quick percentage handler
  const handleQuickPercentage = (pct: number) => {
    const bal = parseFloat(activeBalance)
    if (isNaN(bal) || bal <= 0) return
    const calculated = (bal * pct) / 100
    setAmount(calculated.toFixed(token === 'cirBTC' ? 5 : 2))
  }

  // Token list for selector modal
  const tokenList: TokenItem[] = useMemo(() => {
    const list: TokenItem[] = [
      { symbol: 'USDC', name: 'USD Coin', icon: TOKEN_ICONS.USDC, balance: usdcWalletBalance },
      { symbol: 'EURC', name: 'Euro Coin', icon: TOKEN_ICONS.EURC, balance: eurcWalletBalance },
      { symbol: 'cirBTC', name: 'Circle Bitcoin', icon: TOKEN_ICONS.cirBTC, balance: cirbtcWalletBalance },
    ]
    return list
  }, [usdcWalletBalance, eurcWalletBalance, cirbtcWalletBalance, nativeBalance, selectedChain])

  // Mode Options
  const modeOptions: ModeOption[] = [
    {
      id: 'direct',
      label: 'DIRECT WALLET',
      icon: <Wallet className="w-3.5 h-3.5" />,
      tooltip: 'Send directly from connected wallet balance',
    },
    {
      id: 'gateway',
      label: 'GATEWAY FAST',
      icon: <Zap className="w-3.5 h-3.5 text-indigo-400" />,
      tooltip: 'Instant send from Circle Gateway Unified Balance',
    },
  ]

  // Transaction Breakdown Items
  const breakdownItems: BreakdownItem[] = useMemo(() => {
    const items: BreakdownItem[] = [
      {
        label: 'Network Fee',
        value: isGaslessActive
          ? 'Free (Sponsored)'
          : sendMode === 'gateway'
          ? 'Free'
          : estimatedFee
          ? `${estimatedFee} ${CHAIN_NATIVE_MAP[selectedChain]?.symbol || 'USDC'}`
          : '<0.001 USDC',
        highlight: isGaslessActive || sendMode === 'gateway',
      },
      {
        label: 'Estimated Time',
        value:
          sendMode === 'gateway'
            ? '< 1 sec'
            : isGaslessActive
            ? '1-2 sec'
            : SPEED_TIERS[speedTier].timeEstimate.arcL1 || '< 5 sec',
      },
    ]

    return items
  }, [sendMode, isGaslessActive, estimatedFee, speedTier, selectedChain])

  // Dynamic Button State
  const ctaButtonState = useMemo(() => {
    if (!connectedAddress) {
      return { disabled: true, text: 'CONNECT WALLET', loading: false }
    }
    if (!amount || parseFloat(amount) <= 0) {
      return { disabled: true, text: 'ENTER AN AMOUNT', loading: false }
    }
    if (!recipient) {
      return { disabled: true, text: 'ENTER RECIPIENT ADDRESS', loading: false }
    }
    if (!recipientIsValid) {
      return { disabled: true, text: 'INVALID RECIPIENT FORMAT', loading: false }
    }
    if (isInsufficient) {
      return { disabled: true, text: `INSUFFICIENT ${tokenSymbol} BALANCE`, loading: false }
    }
    if (isSending) {
      return { disabled: true, text: 'SENDING...', loading: true }
    }
    return {
      disabled: false,
      text: `SEND ${tokenSymbol}`,
      loading: false,
      icon: <ArrowUpRight className="w-4 h-4" />,
    }
  }, [
    connectedAddress,
    amount,
    recipient,
    recipientIsValid,
    isInsufficient,
    isSending,
    tokenSymbol,
  ])

  if (!isOpen && !isInline) return null

  // Header Actions
  const headerActions = (
    <>
      {/* Network Selector Pill */}
      <button
        type="button"
        disabled={isSending || !!successReceipt}
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

      {/* Gasless Icon Button (if Arc USDC) */}
      {isArcUsdc && (
        <GaslessIconButton
          isActive={isGaslessActive}
          onToggle={() => setIsGaslessMode((prev) => !prev)}
          remainingQuota={gaslessQuota?.remainingQuota}
          dailyLimit={gaslessQuota?.dailyLimit || 5}
          disabled={isSending || !!successReceipt}
          size="md"
        />
      )}

      {/* Privacy Lock Toggle */}
      <PrivacyLockButton
        isPrivate={isPrivateSend}
        onToggle={() => setIsPrivateSend((prev) => !prev)}
        disabled={isSending || !!successReceipt}
        size="md"
      />

      {/* Settings Toggle */}
      <button
        type="button"
        onClick={() => setShowSettings(!showSettings)}
        className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${
          showSettings
            ? 'text-white bg-indigo-500/25 border border-indigo-500/40 shadow-sm'
            : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06]'
        }`}
        title="Speed & fee preferences"
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
      title="SEND"
      icon={<ArrowUpRight className="w-5 h-5" />}
      isInline={isInline}
      maxWidth={isInline ? 640 : 540}
      minHeight={isInline ? 680 : undefined}
      headerActions={headerActions}
    >
      {/* Success View */}
      {successReceipt ? (
        <SendSuccessReceipt
          amount={amount}
          tokenSymbol={tokenSymbol}
          tokenIcon={isCustom ? undefined : TOKEN_ICONS[token]}
          recipient={recipient}
          network={selectedChain}
          networkIconId={getChainIconId(selectedChain)}
          txHash={successReceipt.txHash}
          explorerUrl={successReceipt.explorerUrl}
          gasFee={successReceipt.gasFee}
          blockNumber={successReceipt.blockNumber}
          memoText={successReceipt.memoText}
          memoId={successReceipt.memoId}
          isInline={isInline}
          onSendAgain={() => {
            setSuccessReceipt(null)
            setIsSending(false)
            setAmount('')
            setRecipient('')
            setRecipientError(null)
          }}
          onClose={onClose}
        />
      ) : (
        <form onSubmit={handleSend} className="flex flex-col gap-4 flex-1 justify-between">
          {/* Mode Switcher Tabs */}
          <SegmentedModeSwitch
            options={modeOptions}
            activeId={sendMode}
            onChange={(mode) => {
              setSendMode(mode)
              setError(null)
              setSuccessReceipt(null)
            }}
            disabled={isSending}
          />

          {/* Error Alert */}
          {error && (
            <div className="p-3 bg-rose-500/10 rounded-2xl border border-rose-500/25 text-rose-400 text-xs flex items-center gap-2.5 animate-fade-in">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="flex-1">{error}</span>
            </div>
          )}

          {/* Amount Input Panel */}
          <AssetInputPanel
            label={sendMode === 'gateway' ? 'GATEWAY SEND AMOUNT' : 'AMOUNT TO SEND'}
            amount={amount}
            onAmountChange={(val) => setAmount(val)}
            tokenSymbol={tokenSymbol}
            tokenIcon={isCustom ? undefined : TOKEN_ICONS[token]}
            onSelectToken={sendMode === 'direct' ? () => setShowTokenModal(true) : undefined}
            tokenListAvailable={sendMode === 'direct'}
            balance={activeBalance}
            onMaxClick={() => setAmount(activeBalance)}
            quickPercentages={[25, 50, 75, 100]}
            onSelectPercentage={handleQuickPercentage}
            fiatEstimate={amount ? `≈ $${amount} USD` : undefined}
            disabled={isSending}
            error={isInsufficient}
          />

          {/* Recipient Address Field */}
          <RecipientAddressField
            value={recipient}
            onChange={(val) => {
              setRecipient(val)
              setRecipientError(null)
            }}
            placeholder={
              isChainSolana
                ? 'sol...'
                : isChainInjective
                ? 'inj...'
                : '0x....'
            }
            isValid={recipientIsValid}
            validText="Verified"
            error={recipientError}
            disabled={isSending}
          />

          {/* Custom ERC-20 Address Panel (if isCustom is active in direct mode) */}
          {isCustom && sendMode === 'direct' && (
            <div className="p-3.5 rounded-2xl bg-[#101323]/70 border border-white/[0.08] space-y-2 animate-fade-in">
              <div className="flex justify-between items-center text-xs text-slate-300">
                <span className="font-semibold">Custom ERC-20 Token Contract</span>
                <button
                  type="button"
                  onClick={() => {
                    setIsCustom(false)
                    setToken('USDC')
                    setCustomTokenAddress('')
                    setCustomTokenResult(null)
                  }}
                  className="text-indigo-400 hover:text-indigo-300 text-[11px]"
                >
                  Switch to Standard Tokens
                </button>
              </div>
              <input
                type="text"
                placeholder="0x... contract address"
                value={customTokenAddress}
                onChange={(e) => setCustomTokenAddress(e.target.value.trim())}
                className="w-full rounded-xl px-3 py-2 text-xs font-mono text-white bg-white/[0.04] border border-white/[0.08] focus:border-indigo-500/50 focus:outline-none"
              />
              {customTokenResult && (
                <div className="text-xs text-indigo-300 flex justify-between pt-1">
                  <span>Symbol: {customTokenResult.symbol}</span>
                  <span>Balance: {customTokenResult.balance}</span>
                </div>
              )}
              {customTokenError && (
                <p className="text-xs text-rose-400">{customTokenError}</p>
              )}
            </div>
          )}

          {/* Arc Transaction Memo Collapsible (on Arc Testnet) */}
          {selectedChain === 'Arc_Testnet' && sendMode === 'direct' && activeToken === 'USDC' && (
            <div className="rounded-xl bg-[#101323]/50 border border-white/[0.04] p-3 transition-all">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-300">
                  <FileText className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="text-[12px] font-medium">
                    {memoText ? `Memo: "${memoText}"` : 'Add Transaction Memo'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMemoPanel((prev) => !prev)}
                  className="text-[12px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                >
                  {showMemoPanel ? 'Hide' : memoText ? 'Edit' : '+ Add'}
                </button>
              </div>

              {showMemoPanel && (
                <div className="mt-3 pt-2.5 border-t border-white/[0.06] space-y-2.5 animate-fade-in">
                  {/* Preset Chips */}
                  <div className="flex flex-wrap gap-1.5">
                    {MEMO_PRESETS.slice(0, 5).map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectMemoPreset(preset)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                          selectedPresetId === preset.id
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                            : 'bg-white/[0.04] text-slate-400 hover:text-white border border-white/[0.06]'
                        }`}
                      >
                        {preset.text}
                      </button>
                    ))}
                    {memoText && (
                      <button
                        type="button"
                        onClick={handleClearMemo}
                        className="px-2 py-1 rounded-lg text-[11px] text-slate-500 hover:text-slate-300"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {/* Memo text input */}
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      placeholder="Invoice ID, Payroll note, payment ref..."
                      value={memoText}
                      maxLength={120}
                      onChange={(e) => setMemoText(e.target.value)}
                      className="w-full rounded-xl px-3 py-2 text-xs text-white bg-white/[0.04] border border-white/[0.08] focus:border-indigo-500/50 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Breakdown Accordion */}
          {breakdownItems.length > 0 && (
            <TransactionBreakdown
              summaryTitle={`Network: ${selectedChain.replace(/_/g, ' ')}`}
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

      {/* Token Selector Modal */}
      <TokenSelectorModal
        isOpen={showTokenModal}
        onClose={() => setShowTokenModal(false)}
        tokens={tokenList}
        selectedToken={token}
        onSelectToken={(sym) => {
          setToken(sym)
          setIsCustom(false)
        }}
        title="Select Asset"
      />

      {/* Network Selector Modal */}
      <ChainSelectorModal
        isOpen={showChainModal}
        onClose={() => setShowChainModal(false)}
        chains={SUPPORTED_SEND_CHAINS}
        selectedChain={selectedChain}
        onSelectChain={(chainKey) => {
          setSelectedChain(chainKey)
          setRecipientError(null)
        }}
        getChainIconId={getChainIconId}
        title="Select Network"
      />
    </FintechCard>
  )

  // Settings Modal Window via Portal
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
                    <p className="text-[11px] text-slate-400">Execution speed and priority tiers</p>
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
                  onSelectTier={(tier) => setSpeedTier(tier)}
                  context="send"
                  disabled={isSending}
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
