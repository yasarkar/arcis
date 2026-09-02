import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  ArrowUpRight,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  ExternalLink,
  ChevronDown,
  Zap,
  Wallet,
  Clipboard,
  Plus,
  FileText,
  Check,
  Copy,
  Settings,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import { formatUnits, createPublicClient, http, erc20Abi } from 'viem'
import { getDisplayTokenSymbol, CHAIN_NATIVE_MAP } from '../utils/tokenUtils'
import { useGatewayBalance } from '../hooks/useGatewayBalance'
import { useWalletTestnetBalances, TESTNET_CHAINS } from '../hooks/useWalletTestnetBalances'
import { estimateGas, sendToken } from '../services/sendService'
import { sendUsdcWithMemo } from '../services/memoService'
import { MEMO_PRESETS, type MemoPreset } from '../config/memoConfig'
import { transferFromGateway } from '../services/gatewayService'
import { GATEWAY_DOMAINS } from '../config/gatewayConfig'
import { SUPPORTED_SEND_CHAINS, CHAIN_DEFS, getChainIconId, getExplorerTxUrl, getExplorerAddressUrl } from '../config/sendConfig'
import { ARC_TOKENS, ARC_METADATA } from '../config/arcChain'
import { addTransaction } from '../utils/history'
import { formatWalletError } from '../utils/errorUtils'
import { PrivacyLockButton } from './privacy/PrivacyLockButton'
import { useBroadcast } from './BroadcastNotification'
import { SpeedFeeSelector } from './common/SpeedFeeSelector'
import { SPEED_TIERS, type SpeedTier, calculateArcGasCostUsdc } from '../config/feeTiers'
import { useMultiChainWallet } from '../hooks/useMultiChainWallet'
import {
  getSendProtocolFee,
  TREASURY_ADDRESS,
  TREASURY_EXPLORER_URL,
  formatTreasuryAddress,
  REVENUE_SHARE_LABEL,
  REVENUE_SHARE_TOOLTIP,
} from '../config/treasuryConfig'
import {
  getGaslessQuota,
  sendGaslessUsdcTransfer,
  type GaslessQuota,
} from '../services/gaslessService'
import { GaslessIconButton } from './common/GaslessIconButton'

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
  provider: any // Injected EIP-1193 provider
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
  const { solana, injective } = useMultiChainWallet()

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

  const isValidEvmAddress = (addr: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(addr)
  const isValidSolanaAddress = (addr: string): boolean => !addr.startsWith('0x') && addr.length >= 32 && addr.length <= 44
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
  const [chainSearch, setChainSearch] = useState('Arc Testnet')
  const [showChainDropdown, setShowChainDropdown] = useState(false)

  // Dynamic Token selector
  const [token, setToken] = useState('USDC')
  const [showTokenDropdown, setShowTokenDropdown] = useState(false)
  const tokenRef = useRef<HTMLDivElement>(null)
  const [isCustom, setIsCustom] = useState(false)
  const [customTokenAddress, setCustomTokenAddress] = useState('')
  const [customTokenResult, setCustomTokenResult] = useState<any | null>(null)
  const [customTokenError, setCustomTokenError] = useState<string | null>(null)
  const [isInspectingCustomToken, setIsInspectingCustomToken] = useState(false)
  const [imgError, setImgError] = useState(false)

  const [isSending, setIsSending] = useState(false)
  const [successReceipt, setSuccessReceipt] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const [estimatedFee, setEstimatedFee] = useState<string | null>(null)
  const [isEstimating, setIsEstimating] = useState(false)
  const [nativeBalance, setNativeBalance] = useState('0.00')

  // EIP-3009 Gasless Quick-Start State
  const [isGaslessMode, setIsGaslessMode] = useState<boolean>(true)
  const [gaslessQuota, setGaslessQuota] = useState<GaslessQuota | null>(null)
  const [isGaslessLoadingQuota, setIsGaslessLoadingQuota] = useState(false)
  const [gaslessStage, setGaslessStage] = useState<'idle' | 'signing' | 'relaying' | 'finalizing'>('idle')

  // Arc Transaction Memo State
  const [memoText, setMemoText] = useState('')
  const [customMemoId, setCustomMemoId] = useState('')
  const [showMemoDropdown, setShowMemoDropdown] = useState(false)
  const [memoSearchQuery, setMemoSearchQuery] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [copiedReceiptMemoId, setCopiedReceiptMemoId] = useState(false)
  const memoDropdownRef = useRef<HTMLDivElement>(null)

  // Load gasless quota when wallet is connected
  useEffect(() => {
    if (!connectedAddress || !isOpen) return
    let isMounted = true
    setIsGaslessLoadingQuota(true)
    getGaslessQuota(connectedAddress)
      .then((q) => {
        if (isMounted) setGaslessQuota(q)
      })
      .catch(console.error)
      .finally(() => {
        if (isMounted) setIsGaslessLoadingQuota(false)
      })
    return () => {
      isMounted = false
    }
  }, [connectedAddress, isOpen])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (memoDropdownRef.current && !memoDropdownRef.current.contains(event.target as Node)) {
        setShowMemoDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelectMemoPreset = (preset: MemoPreset) => {
    setSelectedPresetId(preset.id)
    setMemoText(preset.text)
    if (preset.refIdPrefix) {
      setCustomMemoId(`${preset.refIdPrefix}-${Math.random().toString(36).substring(2, 7)}`)
    }
    setShowMemoDropdown(false)
    setMemoSearchQuery('')
  }

  const handleClearMemo = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    setSelectedPresetId(null)
    setMemoText('')
    setCustomMemoId('')
    setMemoSearchQuery('')
  }

  // Find token options and display names based on active chain config
  const activeChainConfig = SUPPORTED_SEND_CHAINS.find(c => c.chain === selectedChain)
  const tokenOptions = activeChainConfig ? activeChainConfig.tokens : ['USDC', 'NATIVE']

  // Load connected wallet balances across testnet chains & Gateway unified balance
  const { walletBalances, refetch: refetchWalletBalances } = useWalletTestnetBalances(connectedAddress)
  const { balances: gatewayBalances, totalBalance: gatewayTotalBalance, refresh: refreshGatewayBalances } = useGatewayBalance(connectedAddress)
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
      ? (gatewayTotalBalance || '0.00')
      : isCustom
        ? (customTokenResult?.balance || '0.00')
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
  const tokenSymbol = sendMode === 'gateway' ? 'USDC' : isCustom ? (customTokenResult?.symbol || 'Custom Token') : getDisplayTokenSymbol(selectedChain, token)

  // EIP-3009 Gasless Quick-Start Auto-Eligibility
  const isArcUsdc = selectedChain === 'Arc_Testnet' && (isCustom ? false : token === 'USDC') && sendMode === 'direct'
  const isZeroGasDetected = isArcUsdc && (parseFloat(nativeBalance) === 0 || parseFloat(usdcWalletBalance) > 0)
  const isGaslessActive = isArcUsdc && isGaslessMode && (gaslessQuota ? gaslessQuota.remainingQuota > 0 : true)

  // Dynamic Arcis Protocol Fee based on selected speedTier (0.000 / 0.005 / 0.010 USDC)
  const sendProtocolFee = (selectedChain === 'Arc_Testnet' && tokenSymbol === 'USDC' && sendMode === 'direct' && !isGaslessActive) ? getSendProtocolFee(speedTier) : 0
  const totalSendDebit = amount ? parseFloat(amount) + sendProtocolFee : 0
  const isInsufficient = amount ? totalSendDebit > parseFloat(activeBalance) : false

  const handlePasteRecipient = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setRecipient(text.trim())
        setRecipientError(null)
        if (successReceipt) setSuccessReceipt(null)
      }
    } catch (err) {
      console.error('[SendModal] Failed to read clipboard:', err)
    }
  }

  // Fetch native token balance from RPC when "NATIVE" is selected in Direct mode
  useEffect(() => {
    if (!connectedAddress || !isOpen) return
    if (sendMode !== 'direct' || token !== 'NATIVE' || isCustom) return

    let isMounted = true
    const fetchNativeBal = async () => {
      try {
        if (provider) {
          const rpcClient = createPublicClient({
            transport: http(ARC_METADATA.rpcHttpUrl)
          })
          const bal = await rpcClient.getBalance({ address: connectedAddress as `0x${string}` })
          const decimals = CHAIN_NATIVE_MAP[selectedChain]?.decimals || 18
          const formatted = parseFloat(formatUnits(bal, decimals)).toFixed(4)
          if (isMounted) {
            setNativeBalance(formatted)
          }
        } else {
          if (isMounted) {
            setNativeBalance('1.2500')
          }
        }
      } catch (e) {
        console.error('[SendModal] Failed to fetch native token balance:', e)
        if (isMounted) {
          setNativeBalance('0.00')
        }
      }
    }

    fetchNativeBal()
    return () => {
      isMounted = false
    }
  }, [selectedChain, token, isCustom, connectedAddress, isOpen, provider, sendMode])

  // Custom ERC-20 Token Contract Inspection Effect (Arc Testnet & other testnets)
  useEffect(() => {
    if (!isOpen || sendMode !== 'direct' || !isCustom) return

    const trimmedAddress = customTokenAddress.trim()
    if (!trimmedAddress || !trimmedAddress.startsWith('0x') || trimmedAddress.length !== 42) {
      setCustomTokenResult(null)
      setCustomTokenError(null)
      setIsInspectingCustomToken(false)
      return
    }

    let isMounted = true
    setIsInspectingCustomToken(true)
    setCustomTokenError(null)
    setImgError(false)

    const inspectCustomToken = async () => {
      try {
        const chainDef = TESTNET_CHAINS[selectedChain]
        const rpcUrl = selectedChain === 'Arc_Testnet'
          ? ARC_METADATA.rpcHttpUrl
          : (chainDef?.rpcUrls?.default?.http?.[0] || ARC_METADATA.rpcHttpUrl)

        const rpcClient = createPublicClient({
          transport: http(rpcUrl, { timeout: 8000, retryCount: 2 })
        })

        const targetAddress = trimmedAddress as `0x${string}`

        // Fetch symbol, name, decimals in parallel
        const [nameRes, symbolRes, decimalsRes] = await Promise.allSettled([
          rpcClient.readContract({ address: targetAddress, abi: erc20Abi, functionName: 'name' }),
          rpcClient.readContract({ address: targetAddress, abi: erc20Abi, functionName: 'symbol' }),
          rpcClient.readContract({ address: targetAddress, abi: erc20Abi, functionName: 'decimals' }),
        ])

        let tokenName = nameRes.status === 'fulfilled' ? String(nameRes.value) : ''
        let tokenSym = symbolRes.status === 'fulfilled' ? String(symbolRes.value) : ''
        let tokenDec = decimalsRes.status === 'fulfilled' ? Number(decimalsRes.value) : 18

        const lowerAddr = trimmedAddress.toLowerCase()
        if (lowerAddr === ARC_TOKENS.cirBTC.toLowerCase()) {
          if (!tokenSym) tokenSym = 'cirBTC'
          if (!tokenName) tokenName = 'Circle Wrapped Bitcoin'
          if (decimalsRes.status !== 'fulfilled') tokenDec = 8
        } else if (lowerAddr === ARC_TOKENS.USDC.toLowerCase()) {
          if (!tokenSym) tokenSym = 'USDC'
          if (!tokenName) tokenName = 'USD Coin'
          if (decimalsRes.status !== 'fulfilled') tokenDec = 6
        }

        let formattedBalance = '0.00'
        if (connectedAddress && connectedAddress.startsWith('0x')) {
          try {
            const rawBal = await rpcClient.readContract({
              address: targetAddress,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [connectedAddress as `0x${string}`]
            })
            formattedBalance = parseFloat(formatUnits(rawBal, tokenDec)).toFixed(4)
          } catch {
            formattedBalance = '0.00'
          }
        }

        if (isMounted) {
          if (tokenSym || tokenName) {
            setCustomTokenResult({
              address: trimmedAddress,
              name: tokenName || tokenSym || 'Custom ERC-20 Token',
              symbol: tokenSym || 'TOK',
              decimals: tokenDec,
              balance: formattedBalance
            })
            setCustomTokenError(null)
          } else {
            setCustomTokenResult(null)
            setCustomTokenError('Arc Testnet üzerinde bu kontrat adresi için ERC-20 token bilgisi bulunamadı.')
          }
        }
      } catch (err: any) {
        console.error('[SendModal] Custom token inspection failed:', err)
        if (isMounted) {
          const lowerAddr = trimmedAddress.toLowerCase()
          if (lowerAddr === ARC_TOKENS.cirBTC.toLowerCase()) {
            setCustomTokenResult({
              address: trimmedAddress,
              name: 'Circle Wrapped Bitcoin',
              symbol: 'cirBTC',
              decimals: 8,
              balance: '0.00'
            })
            setCustomTokenError(null)
          } else {
            setCustomTokenResult(null)
            setCustomTokenError('We couldnt find any token with this contract address. Please check contract address and try again.')
          }
        }
      } finally {
        if (isMounted) {
          setIsInspectingCustomToken(false)
        }
      }
    }

    const timer = setTimeout(inspectCustomToken, 400)
    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [customTokenAddress, isCustom, selectedChain, connectedAddress, isOpen, sendMode])

  // Debounced Gas Estimation
  useEffect(() => {
    if (sendMode === 'gateway') {
      setEstimatedFee(null)
      return
    }

    if (!provider || !recipient || !amount || !activeToken) {
      setEstimatedFee(null)
      return
    }

    if (!recipient.startsWith('0x') || recipient.length !== 42) {
      setEstimatedFee(null)
      return
    }

    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) {
      setEstimatedFee(null)
      return
    }

    let isMounted = true

    const fetchEstimate = async () => {
      setIsEstimating(true)
      try {
        if (provider) {
          const estimate = await estimateGas(provider, selectedChain, activeToken, recipient, amount)
          if (isMounted && estimate) {
            const nativeDecimals = CHAIN_NATIVE_MAP[selectedChain]?.decimals || 18
            let formatted = '0.000000'

            if (typeof estimate.fee === 'string' && estimate.fee.includes('.')) {
              const p = parseFloat(estimate.fee)
              formatted = isNaN(p) ? '0.000000' : p.toFixed(6)
            } else {
              let feeBigInt: bigint | null = null
              if (typeof estimate.fee === 'bigint') {
                feeBigInt = estimate.fee
              } else if (typeof estimate.fee === 'string' || typeof estimate.fee === 'number') {
                try {
                  feeBigInt = BigInt(estimate.fee.toString())
                } catch {
                  feeBigInt = null
                }
              } else if (estimate.gas && estimate.gasPrice) {
                try {
                  feeBigInt = BigInt(estimate.gas) * BigInt(estimate.gasPrice)
                } catch {
                  feeBigInt = null
                }
              }

              if (feeBigInt !== null) {
                const unformattedStr = formatUnits(feeBigInt, nativeDecimals)
                const p = parseFloat(unformattedStr)
                formatted = isNaN(p) ? '0.000000' : p.toFixed(6)
              }
            }

            setEstimatedFee(formatted)
          }
        } else {
          if (isMounted) {
            setEstimatedFee('0.001245')
          }
        }
      } catch (err: any) {
        console.error("Gas estimation failed:", err)
        if (isMounted) {
          setEstimatedFee(null)
        }
      } finally {
        if (isMounted) {
          setIsEstimating(false)
        }
      }
    }

    const timer = setTimeout(fetchEstimate, 600)
    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [provider, selectedChain, activeToken, recipient, amount])

  // Reset transaction execution states when modal is opened
  useEffect(() => {
    if (isOpen) {
      setIsSending(false)
      setGaslessStage('idle')
      setSuccessReceipt(null)
      setError(null)
      setEstimatedFee(null)
      setShowChainDropdown(false)
    }
  }, [isOpen])

  // Close dropdowns on click outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      setShowChainDropdown(false)
      if (tokenRef.current && !tokenRef.current.contains(e.target as Node)) {
        setShowTokenDropdown(false)
      }
    }
    window.addEventListener('click', handleOutsideClick)
    return () => window.removeEventListener('click', handleOutsideClick)
  }, [])

  if (!isOpen && !isInline) return null

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccessReceipt(null)

    if (!recipient.startsWith('0x') || recipient.length !== 42) {
      setError('Please enter a valid EVM address (0x...)')
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

    const displayToken = isCustom ? (customTokenResult?.symbol || 'Custom Token') : getDisplayTokenSymbol(selectedChain, token)
    const tokenIcon = isCustom ? undefined : (TOKEN_ICONS[token] || TOKEN_ICONS[displayToken])

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
            const errorText = `Bridge is not supported on ${selectedChain.replace(/_/g, ' ')}. Please select a supported chain (e.g. Arc Testnet, Base Sepolia).`
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

          const sourceBalItem = gatewayBalances.find(b => parseFloat(b.balance) >= sendAmt)
          const effectiveSourceChain = sourceBalItem?.chainKey && GATEWAY_DOMAINS[sourceBalItem.chainKey] !== undefined
            ? sourceBalItem.chainKey
            : (GATEWAY_DOMAINS[selectedChain] !== undefined ? selectedChain : 'Arc_Testnet')

          await new Promise(r => setTimeout(r, 600))

          const gatewayRes = await transferFromGateway({
            provider,
            sourceChain: effectiveSourceChain,
            destinationChain: selectedChain,
            amount,
            recipient,
            sourceChainDef: CHAIN_DEFS[effectiveSourceChain] || CHAIN_DEFS['Arc_Testnet'],
            destinationChainDef: CHAIN_DEFS[selectedChain] || CHAIN_DEFS['Arc_Testnet']
          })

          const txHash = gatewayRes.mintTxHash || ''
          setIsSending(false)

          const explorerUrl = getExplorerTxUrl(selectedChain, txHash)

          setSuccessReceipt({
            txHash,
            explorerUrl,
            gasFee: 'Zero Extra Gateway Fee (<500ms Instant)',
            blockNumber: 'Instant Gateway Finalized'
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
            status: 'success',
            isPrivate: isPrivateSend
          })
          onSuccess?.(amount, txHash)
        } else {
          // Check if Arc Native Transaction Memo is active
          const isArcMemoActive = selectedChain === 'Arc_Testnet' && activeToken === 'USDC' && memoText.trim().length > 0

          if (isArcMemoActive) {
            await new Promise(r => setTimeout(r, 600))

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
              memoIndex: memoResult.memoIndex?.toString(),
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
              status: 'success',
              isPrivate: isPrivateSend,
              memo: memoText.trim(),
              memoId: memoResult.memoId,
              memoIndex: memoResult.memoIndex !== undefined ? Number(memoResult.memoIndex) : undefined,
            })
            onSuccess?.(amount, txHash)
          } else if (isGaslessActive) {
            // EIP-3009 Gasless Quick-Start Transfer with 3-Stage Live Tracking
            setGaslessStage('signing')
            const broadcastId = addBroadcast({
              title: '⚡ Gasless USDC Transfer...',
              status: 'pending',
              badgeText: '0 Gas EIP-3009',
              details: {
                fromAmount: amount,
                fromSymbol: 'USDC',
                fromIcon: TOKEN_ICONS.USDC,
                toSymbol: recipient,
                network: selectedChain,
              },
            })

            try {
              // Sign typed data off-chain
              setGaslessStage('signing')
              const gaslessPromise = sendGaslessUsdcTransfer({
                provider,
                from: connectedAddress,
                to: recipient,
                amount,
              })

              // Wait briefly then advance stage indicator
              setTimeout(() => {
                setGaslessStage(prev => prev === 'signing' ? 'relaying' : prev)
              }, 1200)

              const gaslessResult = await gaslessPromise
              setGaslessStage('finalizing')
              await new Promise(r => setTimeout(r, 400))

              const txHash = gaslessResult.txHash
              setIsSending(false)
              setGaslessStage('idle')

              const explorerUrl = getExplorerTxUrl(selectedChain, txHash)

              setSuccessReceipt({
                txHash,
                explorerUrl,
                gasFee: '$0.00 (Arcis Sponsored EIP-3009)',
                blockNumber: gaslessResult.blockNumber || 'Sub-second Finalized',
                isGasless: true,
                remainingQuota: gaslessResult.remainingQuota,
              })

              updateBroadcast(broadcastId, {
                title: '⚡ Gasless Transfer Confirmed',
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

              setGaslessQuota(prev => prev ? { ...prev, remainingQuota: gaslessResult.remainingQuota } : null)
              refetchWalletBalances()
              refreshGatewayBalances()
              addTransaction({
                type: 'send',
                txHash,
                amount,
                tokenSymbol: 'USDC (Gasless)',
                sourceChain: selectedChain,
                recipient,
                status: 'success',
                isPrivate: isPrivateSend,
              })
              onSuccess?.(amount, txHash)
            } catch (err: any) {
              setGaslessStage('idle')
              throw err
            }
          } else {
            await new Promise(r => setTimeout(r, 1200))

            const result = await sendToken(provider, selectedChain, activeToken, recipient, amount)
            const txHash = result.txHash || ''

            setIsSending(false)

            const explorerUrl = getExplorerTxUrl(selectedChain, txHash)

            setSuccessReceipt({
              txHash,
              explorerUrl,
              gasFee: estimatedFee ? `${estimatedFee} ${CHAIN_NATIVE_MAP[selectedChain]?.symbol || 'USDC'}` : '0.00135 equivalent',
              blockNumber: 'Instant BFT Finalized'
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
              status: 'success',
              isPrivate: isPrivateSend
            })
            onSuccess?.(amount, txHash)
          }
        }
      } catch (err: any) {
        console.error("Token transfer failed:", err)
        const errMsg = formatWalletError(err)
        setError(errMsg)
        setIsSending(false)

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

  // Filter chains for searchable dropdown
  const filteredChains = SUPPORTED_SEND_CHAINS.filter(c =>
    c.name.toLowerCase().includes(chainSearch.toLowerCase()) ||
    c.chain.toLowerCase().includes(chainSearch.toLowerCase())
  )

  const content = (
    <div
      className="relative w-full ub-asset-card arc-animate-reveal"
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
            <ArrowUpRight className="w-5 h-5" />
          </div>
          <span className="arc-eyebrow" style={{ fontSize: 16, color: '#ffffff', fontWeight: 600, letterSpacing: '2px' }}>
            SEND
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isArcUsdc && (
            <GaslessIconButton
              isActive={isGaslessActive}
              onToggle={() => setIsGaslessMode(prev => !prev)}
              remainingQuota={gaslessQuota?.remainingQuota}
              dailyLimit={gaslessQuota?.dailyLimit || 5}
              disabled={isSending}
              size="md"
            />
          )}
          <PrivacyLockButton
            isPrivate={isPrivateSend}
            onToggle={() => setIsPrivateSend(prev => !prev)}
            disabled={isSending}
            size="md"
          />
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all cursor-pointer ${showSettings
                ? 'text-white bg-[rgba(152,150,255,0.2)] border border-[rgba(152,150,255,0.4)] shadow-md'
                : 'text-slate-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.1] border border-white/[0.06]'
              }`}
            title="Gas & speed settings"
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

      {/* Mode Switcher Tabs: Direct Wallet Send vs Gateway Fast Transfer (Aave Segmented Capsule) */}
      <div
        className="grid grid-cols-2 gap-2 mb-6 p-1.5 rounded-full backdrop-blur-xl"
        style={{
          background: 'rgba(255, 255, 255, 0.035)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.2)',
        }}
      >
        <button
          type="button"
          disabled={isSending}
          title="Same-chain transfer using your connected wallet balance. Supports USDC, EURC, Native and Custom ERC-20 tokens."
          onClick={() => {
            setSendMode('direct')
            setSuccessReceipt(null)
            setError(null)
          }}
          className={`py-2.5 px-4 rounded-full text-xs font-semibold tracking-wide transition-all flex items-center justify-center gap-2 cursor-pointer ${sendMode === 'direct'
            ? 'text-white shadow-md'
            : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          style={{
            fontFamily: 'var(--font-app)',
            background: sendMode === 'direct'
              ? 'linear-gradient(135deg, rgba(152, 150, 255, 0.22) 0%, rgba(99, 102, 241, 0.3) 100%)'
              : 'transparent',
            border: sendMode === 'direct'
              ? '1px solid rgba(152, 150, 255, 0.4)'
              : '1px solid transparent',
            boxShadow: sendMode === 'direct' ? '0 2px 12px rgba(152, 150, 255, 0.2)' : 'none',
          }}
        >
          <Wallet className="w-3.5 h-3.5" style={{ color: sendMode === 'direct' ? 'var(--purple-1)' : 'inherit' }} />
          <span>DIRECT WALLET</span>
        </button>

        <button
          type="button"
          disabled={isSending}
          title="Instant (<500ms) cross-chain transfer from your Unified USDC Balance."
          onClick={() => {
            setSendMode('gateway')
            setIsCustom(false)
            setToken('USDC')
            setSuccessReceipt(null)
            setError(null)
          }}
          className={`py-2.5 px-4 rounded-full text-xs font-semibold tracking-wide transition-all flex items-center justify-center gap-2 cursor-pointer ${sendMode === 'gateway'
            ? 'text-white shadow-md'
            : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          style={{
            fontFamily: 'var(--font-app)',
            background: sendMode === 'gateway'
              ? 'linear-gradient(135deg, rgba(152, 150, 255, 0.25) 0%, rgba(124, 58, 237, 0.35) 100%)'
              : 'transparent',
            border: sendMode === 'gateway'
              ? '1px solid rgba(152, 150, 255, 0.45)'
              : '1px solid transparent',
            boxShadow: sendMode === 'gateway' ? '0 2px 14px rgba(152, 150, 255, 0.25)' : 'none',
          }}
        >
          <Zap className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
          <span>GATEWAY FAST</span>
        </button>
      </div>

      {/* Body */}
      <form onSubmit={handleSend} className="space-y-5.5">
        {error && (
          <div className="p-3.5 bg-rose-500/10 rounded-2xl border border-rose-500/25 text-rose-400 text-xs flex gap-2.5 font-[var(--font-app)] items-center">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-4.5">
          {/* Chain Selector */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <label className="block text-xs font-semibold tracking-wide text-slate-300 mb-1.5 ml-3" style={{ fontFamily: 'var(--font-app)' }}>
              CHAIN
            </label>
            <button
              type="button"
              disabled={isSending}
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
                {SUPPORTED_SEND_CHAINS.map((c) => {
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
                        if (successReceipt) setSuccessReceipt(null)
                      }}
                      className={`w-full text-left px-3.5 py-2.5 text-xs rounded-xl transition-all flex items-center justify-between cursor-pointer ${isSelected
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

          {/* Recipient Address */}
          <div>
            <div className="flex items-center justify-between mb-1.5 px-3">
              <label className="block text-xs font-semibold tracking-wide text-slate-300" style={{ fontFamily: 'var(--font-app)' }}>
                RECIPIENT ADDRESS
              </label>

              {/* Quick Fill Connected Solana Wallet */}
              {isChainSolana && solana.isConnected && solana.address && (
                <button
                  type="button"
                  onClick={() => {
                    setRecipient(solana.address)
                    setRecipientError(null)
                  }}
                  className="text-[10px] text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 cursor-pointer transition"
                >
                  <NetworkIcon name="solana" size={11} variant="branded" />
                  <span>Bağlı Solana Cüzdanım ({solana.address.slice(0, 4)}...{solana.address.slice(-4)})</span>
                </button>
              )}

              {/* Quick Fill Connected Injective Wallet */}
              {isChainInjective && injective.isConnected && injective.address && (
                <button
                  type="button"
                  onClick={() => {
                    setRecipient(injective.address)
                    setRecipientError(null)
                  }}
                  className="text-[10px] text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 cursor-pointer transition"
                >
                  <NetworkIcon name="injective" size={11} variant="branded" />
                  <span>Bağlı Injective Cüzdanım ({injective.address.slice(0, 6)}...{injective.address.slice(-4)})</span>
                </button>
              )}
            </div>

            <div className="relative flex items-center">
              <input
                type="text"
                required
                disabled={isSending}
                value={recipient}
                onChange={(e) => {
                  const val = e.target.value.trim()
                  setRecipient(val)
                  setRecipientError(null)
                  if (successReceipt) setSuccessReceipt(null)
                }}
                onBlur={() => {
                  if (recipient && !recipientIsValid) {
                    if (isChainSolana) {
                      setRecipientError('Lütfen geçerli bir Solana adresi (Base58) girin.')
                    } else if (isChainInjective) {
                      setRecipientError('Lütfen geçerli bir Injective adresi (inj1...) girin.')
                    } else {
                      setRecipientError('Lütfen geçerli bir EVM adresi (0x...) girin.')
                    }
                  }
                }}
                placeholder={isChainSolana ? 'Solana Base58 Adresi (ör: 9WzD...)' : isChainInjective ? 'Injective Adresi (inj1...)' : '0x...'}
                className={`w-full rounded-2xl pl-4 pr-16 py-3.5 text-xs text-white focus:outline-none font-mono transition-all ${recipientError
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
                      if (successReceipt) setSuccessReceipt(null)
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
                  disabled={isSending}
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
              {connectedAddress && (!isCustom || customTokenResult) && (
                <div className="text-right">
                  <span className="text-xs text-slate-400" style={{ fontFamily: 'var(--font-app)' }}>
                    Balance: <strong className="text-white ml-1">{activeBalance} {tokenSymbol}</strong>
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1">
                <input
                  type="number"
                  step="any"
                  required
                  disabled={isSending}
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value)
                    if (successReceipt) setSuccessReceipt(null)
                  }}
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
                  onClick={() => {
                    setAmount(activeBalance)
                    if (successReceipt) setSuccessReceipt(null)
                  }}
                  disabled={isSending || (isCustom && !customTokenResult)}
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

                {/* Token Selector Dropdown */}
                <div className="relative shrink-0" ref={tokenRef}>
                  {sendMode === 'gateway' ? (
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
                  ) : (
                    <button
                      type="button"
                      disabled={isSending}
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowTokenDropdown(prev => !prev)
                      }}
                      className="rounded-2xl px-3 py-2 text-xs text-white focus:outline-none flex items-center gap-2 cursor-pointer transition-all"
                      style={{
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: showTokenDropdown ? '1px solid rgba(152, 150, 255, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                      }}
                    >
                      {isCustom ? (
                        <span className="font-semibold text-white">{customTokenResult?.symbol || 'Custom'}</span>
                      ) : (
                        <>
                          {TOKEN_ICONS[token] && (
                            <img src={TOKEN_ICONS[token]} alt={token} className="w-5 h-5 object-contain" />
                          )}
                          <span className="font-semibold">{token === 'NATIVE' ? getDisplayTokenSymbol(selectedChain, 'NATIVE') : token}</span>
                        </>
                      )}
                      <ChevronDown size={14} className={`transition-transform duration-200 text-slate-400 ${showTokenDropdown ? 'rotate-180' : ''}`} />
                    </button>
                  )}

                  {showTokenDropdown && sendMode === 'direct' && (
                    <div
                      className="absolute right-0 mt-2 w-36 rounded-2xl shadow-2xl p-1.5 z-[130] space-y-1 backdrop-blur-2xl"
                      style={{
                        background: 'rgba(15, 18, 32, 0.96)',
                        border: '1px solid rgba(152, 150, 255, 0.25)',
                      }}
                    >
                      {tokenOptions.map((t) => {
                        const displaySym = t === 'NATIVE' ? getDisplayTokenSymbol(selectedChain, 'NATIVE') : t
                        const iconSrc = TOKEN_ICONS[t]
                        const isSelected = !isCustom && token === t
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => {
                              setIsCustom(false)
                              setToken(t)
                              setShowTokenDropdown(false)
                              if (successReceipt) setSuccessReceipt(null)
                            }}
                            className={`w-full text-left px-3 py-2 text-xs rounded-xl transition-all flex items-center gap-2.5 cursor-pointer ${isSelected
                              ? 'bg-[rgba(152,150,255,0.15)] text-white border border-[rgba(152,150,255,0.3)]'
                              : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-transparent'
                              }`}
                          >
                            {iconSrc && (
                              <img src={iconSrc} alt={t} className="w-4 h-4 object-contain" />
                            )}
                            <span className="font-semibold">{displaySym}</span>
                          </button>
                        )
                      })}

                      <div className="border-t border-white/[0.08] my-1" />

                      {/* + Custom Option in droplist */}
                      <button
                        type="button"
                        onClick={() => {
                          setIsCustom(true)
                          setShowTokenDropdown(false)
                          if (successReceipt) setSuccessReceipt(null)
                        }}
                        className={`w-full text-left px-3 py-2 text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer ${isCustom
                          ? 'bg-[rgba(152,150,255,0.15)] text-white border border-[rgba(152,150,255,0.3)]'
                          : 'text-white hover:bg-white/[0.06] border border-transparent font-semibold'
                          }`}
                      >
                        <Plus size={14} className="text-white shrink-0" />
                        <span>Custom</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {isInsufficient && (!isCustom || customTokenResult) && (
              <p className="text-xs text-rose-400 mt-2 font-medium" style={{ fontFamily: 'var(--font-app)' }}>
                Insufficient {tokenSymbol} balance!
              </p>
            )}
          </div>

          {/* Custom Token Contract Input & Verification Card (Shown below Amount when + Custom is active) */}
          {sendMode === 'direct' && isCustom && (
            <div className="space-y-3 pt-1">
              <label className="block text-xs font-semibold tracking-wide text-slate-300" style={{ fontFamily: 'var(--font-app)' }}>
                CUSTOM TOKEN CONTRACT
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  disabled={isSending}
                  value={customTokenAddress}
                  onChange={(e) => {
                    setCustomTokenAddress(e.target.value)
                    if (successReceipt) setSuccessReceipt(null)
                  }}
                  placeholder="Enter Contract Address: 0x..."
                  className="w-full rounded-2xl px-4 py-3.5 pr-10 text-xs text-white font-mono focus:outline-none transition-all"
                  style={{
                    background: 'rgba(11, 13, 24, 0.75)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                />
                {isInspectingCustomToken && (
                  <RefreshCw className="w-4 h-4 arcis-spin text-[var(--purple-1)] absolute right-3.5 top-1/2 -translate-y-1/2" />
                )}
                {!isInspectingCustomToken && customTokenResult && (
                  <ShieldCheck className="w-4 h-4 text-emerald-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
                )}
              </div>

              {/* Custom Token Error Display */}
              {!isInspectingCustomToken && customTokenError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/25 rounded-2xl text-xs text-rose-400 flex items-center gap-2" style={{ fontFamily: 'var(--font-app)' }}>
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{customTokenError}</span>
                </div>
              )}

              {/* Verified Custom Token Card */}
              {!isInspectingCustomToken && customTokenResult && (
                <div
                  className="p-5 rounded-2xl space-y-3.5 backdrop-blur-md"
                  style={{
                    background: 'rgba(152, 150, 255, 0.06)',
                    border: '1px solid rgba(152, 150, 255, 0.25)',
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {customTokenResult.logoUrl && !imgError ? (
                        <img
                          src={customTokenResult.logoUrl}
                          alt={customTokenResult.symbol}
                          onError={() => setImgError(true)}
                          className="w-10 h-10 rounded-full object-contain p-0.5 bg-slate-900 border border-emerald-500/40 shadow-sm"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-500 flex items-center justify-center text-white font-bold text-xs shadow-md border border-indigo-400/40 shrink-0">
                          {customTokenResult.symbol}
                        </div>
                      )}

                      <div>
                        <div className="font-mono text-sm font-bold text-white tracking-wide">
                          {customTokenResult.symbol}
                        </div>
                      </div>
                    </div>

                    {connectedAddress && (
                      <div className="text-right">
                        <span className="block text-[11px] text-slate-400 uppercase tracking-wider" style={{ fontFamily: 'var(--font-app)' }}>
                          Your Balance
                        </span>
                        <span className="font-mono text-xs font-bold text-white">
                          {customTokenResult.balance.slice(0, 8)} {customTokenResult.symbol}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Arc Native Transaction Memo Droplist (Placed directly below Amount input) */}
        {selectedChain === 'Arc_Testnet' && sendMode === 'direct' && activeToken === 'USDC' && (
          <div className="space-y-2.5 pt-2" ref={memoDropdownRef}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <label className="block text-xs font-semibold tracking-wide text-slate-300 ml-3" style={{ fontFamily: 'var(--font-app)' }}>
                  MEMO
                </label>
              </div>

              {memoText && (
                <button
                  type="button"
                  onClick={handleClearMemo}
                  disabled={isSending}
                  className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors cursor-pointer mr-3"
                >
                  <X className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              )}
            </div>

            {/* Memo Selection Capsule Trigger */}
            <div className="relative">
              <button
                type="button"
                disabled={isSending}
                onClick={() => setShowMemoDropdown(prev => !prev)}
                className="w-full rounded-2xl px-4 py-3 text-xs text-white focus:outline-none flex items-center justify-between cursor-pointer transition-all duration-200"
                style={{
                  background: 'rgba(11, 13, 24, 0.75)',
                  border: showMemoDropdown ? '1px solid rgba(152, 150, 255, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                  boxShadow: showMemoDropdown ? '0 0 16px rgba(152, 150, 255, 0.2)' : 'none',
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'rgba(152, 150, 255, 0.15)',
                      border: '1px solid rgba(152, 150, 255, 0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <FileText className="w-3.5 h-3.5 text-[var(--purple-1)]" />
                  </div>
                  {memoText ? (
                    <span className="font-semibold text-white truncate text-xs" style={{ fontFamily: 'var(--font-app)' }}>
                      {selectedPresetId
                        ? MEMO_PRESETS.find(p => p.id === selectedPresetId)?.label || 'Custom Note'
                        : 'Custom Note'}
                    </span>
                  ) : (
                    <span className="text-slate-400 text-xs">Add standard memo note...</span>
                  )}
                </div>
                <ChevronDown size={14} className={`transition-transform duration-200 text-slate-400 shrink-0 ${showMemoDropdown ? 'rotate-180' : ''}`} />
              </button>

              {/* Memo Dropdown List */}
              {showMemoDropdown && (
                <div
                  className="absolute z-[120] left-0 right-0 mt-2 max-h-60 overflow-y-auto rounded-2xl shadow-2xl p-1.5 space-y-1 backdrop-blur-2xl"
                  style={{
                    background: 'rgba(15, 18, 32, 0.96)',
                    border: '1px solid rgba(152, 150, 255, 0.25)',
                    boxShadow: '0 24px 48px -8px rgba(0, 0, 0, 0.7)',
                  }}
                >
                  {MEMO_PRESETS.map((c) => {
                    const isSelected = selectedPresetId === c.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectMemoPreset(c)}
                        className={`w-full text-left px-3.5 py-2.5 text-xs rounded-xl transition-all flex items-center justify-between cursor-pointer ${isSelected
                          ? 'bg-[rgba(152,150,255,0.15)] text-white border border-[rgba(152,150,255,0.3)]'
                          : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-transparent'
                          }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: 'rgba(152, 150, 255, 0.15)',
                              border: '1px solid rgba(152, 150, 255, 0.25)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <span className="text-xs">{c.icon}</span>
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="font-semibold text-white text-xs truncate" style={{ fontFamily: 'var(--font-app)' }}>{c.label}</span>
                            <span className="text-[11px] text-slate-400 font-normal truncate">{c.text}</span>
                          </div>
                        </div>
                        {isSelected && (
                          <span className="text-[11px] text-[var(--purple-1)] font-semibold shrink-0" style={{ fontFamily: 'var(--font-app)' }}>
                            SELECTED
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Inline Custom Note & Reference ID Details (Visible when a memo is selected) */}
            {memoText && (
              <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-2.5 animate-fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-300 font-semibold">
                    <span>Active Note Content</span>
                  </div>
                  <span className="text-[10px] text-slate-400">{memoText.length}/180</span>
                </div>

                <input
                  type="text"
                  maxLength={180}
                  disabled={isSending}
                  value={memoText}
                  onChange={(e) => {
                    setMemoText(e.target.value)
                    if (selectedPresetId && e.target.value !== MEMO_PRESETS.find(p => p.id === selectedPresetId)?.text) {
                      setSelectedPresetId(null)
                    }
                  }}
                  placeholder="Memo message or invoice number..."
                  className="w-full rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-all"
                  style={{
                    background: 'rgba(11, 13, 24, 0.85)',
                    border: '1px solid rgba(152, 150, 255, 0.2)',
                  }}
                />

                <div className="space-y-2.5 animate-fade-in">
                  <div>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-300 font-semibold mb-1.5">
                      <span>Custom Reference ID</span>
                      <span className="text-[9px] text-slate-500">(Optional)</span>
                    </div>
                    <input
                      type="text"
                      maxLength={66}
                      disabled={isSending}
                      value={customMemoId}
                      onChange={(e) => setCustomMemoId(e.target.value)}
                      placeholder="e.g. inv-2026-01"
                      className="w-full rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none transition-all"
                      style={{
                        background: 'rgba(11, 13, 24, 0.85)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Fee display preview */}
        {!successReceipt && amount && parseFloat(amount) > 0 && (
          <div
            className="p-4.5 rounded-2xl text-xs space-y-2.5 animate-fade-in"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
              fontFamily: 'var(--font-app)',
              color: 'var(--fp-3)',
            }}
          >
            <div className="flex justify-between items-center text-slate-300">
              <span>Transfer Mode:</span>
              <span className="text-white font-semibold">
                {sendMode === 'gateway'
                  ? 'Gateway Fast Transfer (<500ms)'
                  : selectedChain === 'Arc_Testnet'
                    ? 'Direct Arc L1 (Native USDC Gas)'
                    : 'Direct Wallet Send'}
              </span>
            </div>
            <div className="flex justify-between items-center text-slate-300">
              <span>Transfer Payload:</span>
              <span className="text-white font-semibold flex items-center gap-1.5">
                {sendMode === 'gateway' ? (
                  <img src={UsdcIcon} alt="USDC" className="w-3.5 h-3.5 object-contain inline-block" />
                ) : isCustom && customTokenResult ? (
                  customTokenResult.logoUrl && !imgError ? (
                    <img
                      src={customTokenResult.logoUrl}
                      alt={customTokenResult.symbol}
                      onError={() => setImgError(true)}
                      className="w-3.5 h-3.5 rounded-full object-contain inline-block"
                    />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-500 flex items-center justify-center text-[7px] text-white font-bold shrink-0 inline-flex">
                      {customTokenResult.symbol?.slice(0, 2)}
                    </div>
                  )
                ) : TOKEN_ICONS[token] ? (
                  <img src={TOKEN_ICONS[token]} alt={token} className="w-3.5 h-3.5 object-contain inline-block" />
                ) : TOKEN_ICONS[tokenSymbol] ? (
                  <img src={TOKEN_ICONS[tokenSymbol]} alt={tokenSymbol} className="w-3.5 h-3.5 object-contain inline-block" />
                ) : TOKEN_ICONS[activeToken] ? (
                  <img src={TOKEN_ICONS[activeToken]} alt={activeToken} className="w-3.5 h-3.5 object-contain inline-block" />
                ) : token === 'NATIVE' ? (
                  <div style={{ width: 14, height: 14, borderRadius: '50%', overflow: 'hidden', clipPath: 'circle(50% at 50% 50%)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <NetworkIcon
                      name={getChainIconId(selectedChain)}
                      variant={getChainIconId(selectedChain) === 'solana' ? 'branded' : 'background'}
                      size={14}
                      className="rounded-full overflow-hidden"
                    />
                  </div>
                ) : null}
                <span>{amount} {tokenSymbol}</span>
              </span>
            </div>

            {/* Network Gas / Fee */}
            {sendMode === 'direct' && (
              <div className="flex justify-between items-center border-t border-white/[0.06] pt-2 font-medium">
                <div className="flex items-center gap-1.5">
                  <span className={isGaslessActive ? "text-emerald-400 font-semibold flex items-center gap-1" : "text-[var(--purple-1)]"}>
                    {isGaslessActive && <Zap className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400 shrink-0" />}
                    <span>Network Gas Fee ({selectedChain === 'Arc_Testnet' ? 'USDC Gas' : CHAIN_NATIVE_MAP[selectedChain]?.symbol || 'NATIVE'}):</span>
                  </span>
                </div>
                <span className={`font-mono ${isGaslessActive ? 'text-emerald-400 font-semibold' : 'text-slate-200'}`}>
                  {isGaslessActive ? (
                    <span className="flex items-center gap-1 bg-emerald-500/10 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/25 text-[11px]">
                      <ShieldCheck className="w-3 h-3 shrink-0" />
                      $0.00 (Sponsored by Arcis)
                    </span>
                  ) : isEstimating ? (
                    <span className="flex items-center gap-1">
                      <span>Estimating...</span>
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    </span>
                  ) : selectedChain === 'Arc_Testnet' ? (
                    `~${calculateArcGasCostUsdc(memoText ? 65000n : 21000n, speedTier)} USDC`
                  ) : (
                    `${estimatedFee || '0.0005'} ${CHAIN_NATIVE_MAP[selectedChain]?.symbol || 'ETH'}`
                  )}
                </span>
              </div>
            )}

            {/* Arcis Platform Fee */}
            {selectedChain === 'Arc_Testnet' && tokenSymbol === 'USDC' && sendMode === 'direct' && (
              <div className="flex justify-between items-center border-t border-white/[0.06] pt-2 text-slate-300">
                <div className="flex items-center gap-1.5">
                  <span className="text-[var(--purple-1)] font-medium">Arcis Platform Fee:</span>
                  {isGaslessActive ? (
                    <span className="text-[9px] bg-emerald-500/15 text-emerald-300 px-1.5 py-0.2 rounded-full border border-emerald-500/30 font-mono">
                      ⚡ Quick-Start Free
                    </span>
                  ) : sendProtocolFee > 0 ? (
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
                  ) : (
                    <span className="text-[9px] bg-emerald-500/15 text-emerald-400 px-1.5 py-0.2 rounded-full border border-emerald-500/30">
                      0.000 (Free)
                    </span>
                  )}
                </div>
                <span className={`font-mono font-medium ${isGaslessActive ? 'text-emerald-400' : sendProtocolFee > 0 ? 'text-[var(--purple-1)]' : 'text-emerald-400'}`}>
                  {isGaslessActive ? '0.000 USDC' : sendProtocolFee > 0 ? `+${sendProtocolFee.toFixed(3)} USDC` : '0.000 USDC'}
                </span>
              </div>
            )}

            {/* Total Wallet Debit */}
            {selectedChain === 'Arc_Testnet' && tokenSymbol === 'USDC' && sendMode === 'direct' && sendProtocolFee > 0 && (
              <div className="flex justify-between items-center border-t border-white/[0.06] pt-2 text-slate-200">
                <span className="font-medium">Total Wallet Debit:</span>
                <span className="font-semibold text-white flex items-center gap-1.5 font-mono">
                  <img src={UsdcIcon} alt="USDC" className="w-3.5 h-3.5 object-contain" />
                  {totalSendDebit.toFixed(4)} USDC
                </span>
              </div>
            )}

            {/* Execution Speed & Priority Button */}
            {sendMode === 'direct' && (
              <div className="flex justify-between items-center border-t border-white/[0.06] pt-2 text-slate-300">
                <span>Execution Priority:</span>
                <button
                  type="button"
                  onClick={() => setShowSettings(true)}
                  className={`font-mono text-xs font-semibold flex items-center gap-1.5 px-2.5 py-1 rounded-full border cursor-pointer transition-all duration-200 group ${speedTier === 'turbo'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 hover:border-amber-500/60 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                      : speedTier === 'fast'
                        ? 'bg-[rgba(152,150,255,0.2)] text-[var(--purple-1,#9896ff)] border-[rgba(152,150,255,0.45)] hover:bg-[rgba(152,150,255,0.3)] hover:border-[rgba(152,150,255,0.65)] shadow-[0_0_12px_rgba(152,150,255,0.2)]'
                        : 'bg-blue-500/15 text-blue-300 border-blue-500/35 hover:bg-blue-500/25 hover:border-blue-500/55 shadow-[0_0_10px_rgba(59,130,246,0.18)]'
                    }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${speedTier === 'turbo'
                        ? 'bg-amber-400 shadow-[0_0_6px_#f59e0b]'
                        : speedTier === 'fast'
                          ? 'bg-[var(--purple-1,#9896ff)] shadow-[0_0_6px_#9896ff]'
                          : 'bg-blue-400 shadow-[0_0_6px_#60a5fa]'
                      }`}
                  />
                  <span>{SPEED_TIERS[speedTier].label} {SPEED_TIERS[speedTier].timeEstimate.arcL1}</span>
                </button>
              </div>
            )}

            {sendMode === 'gateway' && (
              <div className="flex justify-between items-center border-t border-white/[0.06] pt-2 text-emerald-400 font-semibold">
                <span>Gateway Speed & Fee:</span>
                <span>&lt;500ms Instant (Zero Extra Fee)</span>
              </div>
            )}
          </div>
        )}

        {/* Live Multi-Stage Execution Tracker (When sending in Gasless Mode) */}
        {isSending && isGaslessActive && (
          <div
            className="p-4 rounded-2xl border space-y-3 animate-fade-in"
            style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(99, 102, 241, 0.1) 100%)',
              borderColor: 'rgba(16, 185, 129, 0.3)',
              boxShadow: '0 8px 24px -6px rgba(16, 185, 129, 0.2)',
              fontFamily: 'var(--font-app)',
            }}
          >
            <div className="flex items-center justify-between text-xs pb-2 border-b border-white/[0.08]">
              <div className="flex items-center gap-2 text-emerald-400 font-bold">
                <Zap className="w-4 h-4 fill-emerald-400 animate-pulse" />
                <span>EIP-3009 Gasless Settlement Engine</span>
              </div>
              <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-400/30">
                &lt;400ms BFT
              </span>
            </div>

            <div className="space-y-2 text-xs">
              {/* Stage 1: Signature */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${gaslessStage === 'signing'
                        ? 'bg-amber-400 text-black animate-pulse shadow-[0_0_8px_#f59e0b]'
                        : 'bg-emerald-500 text-white'
                      }`}
                  >
                    {gaslessStage === 'signing' ? '1' : '✓'}
                  </div>
                  <span className={gaslessStage === 'signing' ? 'text-white font-semibold' : 'text-slate-300'}>
                    1. Off-Chain EIP-712 Signature
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  {gaslessStage === 'signing' ? 'Awaiting Cüzdan Onayı...' : 'İmzalandı (0 Gas)'}
                </span>
              </div>

              {/* Stage 2: Relayer */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${gaslessStage === 'relaying'
                        ? 'bg-indigo-400 text-white animate-pulse shadow-[0_0_8px_#818cf8]'
                        : gaslessStage === 'finalizing'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-white/10 text-slate-500'
                      }`}
                  >
                    {gaslessStage === 'finalizing' ? '✓' : '2'}
                  </div>
                  <span className={gaslessStage === 'relaying' ? 'text-white font-semibold' : 'text-slate-400'}>
                    2. Arcis Relayer Verification
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  {gaslessStage === 'relaying' ? 'Subsidizing Gas...' : gaslessStage === 'finalizing' ? 'Doğrulandı' : 'Bekliyor'}
                </span>
              </div>

              {/* Stage 3: Arc L1 Consensus */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${gaslessStage === 'finalizing'
                        ? 'bg-emerald-400 text-black animate-ping'
                        : 'bg-white/10 text-slate-500'
                      }`}
                  >
                    3
                  </div>
                  <span className={gaslessStage === 'finalizing' ? 'text-emerald-400 font-semibold' : 'text-slate-400'}>
                    3. Arc L1 Finalization
                  </span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  {gaslessStage === 'finalizing' ? 'Sub-second Finalizing...' : 'Sıradaki'}
                </span>
              </div>
            </div>
          </div>
        )}

        {!successReceipt && (
          <button
            type="submit"
            disabled={isSending || isInsufficient}
            className="w-full py-4 mt-4 rounded-full text-sm font-semibold bg-blue-900 hover:bg-blue-800 tracking-wide text-white transition-all flex items-center justify-center gap-2 cursor-pointer"
            style={{
              fontFamily: 'var(--font-app)',
              cursor: (isSending || isInsufficient) ? 'not-allowed' : 'pointer',
            }}
          >
            {isSending ? (
              <>
                <RefreshCw className="w-4 h-4 arcis-spin" />
                <span>{isGaslessActive ? 'PROCESSING GASLESS SEND...' : 'PROCESSING SEND...'}</span>
              </>
            ) : isGaslessActive ? (
              <>
                <ArrowUpRight className="w-4 h-4" />
                <span>SEND GASLESS</span>
              </>
            ) : (
              <>
                <ArrowUpRight className="w-4 h-4" />
                <span>SEND</span>
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-emerald-400 font-semibold text-sm">
              <ShieldCheck className="w-5 h-5 text-emerald-400 animate-bounce" />
              <span>{tokenSymbol} TRANSFER SUCCESSFUL</span>
            </div>
            {successReceipt.isGasless && (
              <span className="text-[10px] font-mono font-semibold bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                ⚡ 100% Sponsorlu (0 Gas)
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 text-xs">
            {/* Transfer Detail (Amount, Token Icon, Mode) */}
            <div className="flex justify-between items-center border-t border-emerald-500/20 pt-2 text-slate-300">
              <span>Transfer Detail</span>
              <div className="flex items-center gap-1.5 font-semibold text-white">
                <span>{amount} {tokenSymbol}</span>
                {TOKEN_ICONS[tokenSymbol] ? (
                  <img src={TOKEN_ICONS[tokenSymbol]} alt={tokenSymbol} className="w-3.5 h-3.5 object-contain inline-block" />
                ) : TOKEN_ICONS[activeToken] ? (
                  <img src={TOKEN_ICONS[activeToken]} alt={activeToken} className="w-3.5 h-3.5 object-contain inline-block" />
                ) : null}
                <span className="text-slate-500 font-normal">-</span>
                <span className="text-slate-200 font-medium">
                  {sendMode === 'gateway' ? 'Gateway Fast Transfer' : 'Direct Wallet Send'}
                </span>
              </div>
            </div>

            {/* Destination Network */}
            <div className="flex justify-between items-center border-t border-emerald-500/20 pt-2 text-slate-300">
              <span>Destination Network</span>
              <div className="flex items-center gap-1.5">
                <div style={{ width: 16, height: 16, borderRadius: '50%', overflow: 'hidden', clipPath: 'circle(50% at 50% 50%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <NetworkIcon
                    name={getChainIconId(selectedChain)}
                    variant={getChainIconId(selectedChain) === 'solana' ? 'branded' : 'background'}
                    size={16}
                    className="rounded-full overflow-hidden"
                  />
                </div>
                <span className="text-white font-medium">
                  {SUPPORTED_SEND_CHAINS.find(c => c.chain === selectedChain)?.name || selectedChain.replace(/_/g, ' ')}
                </span>
              </div>
            </div>

            {/* Recipient */}
            {recipient && (
              <div className="flex justify-between items-center border-t border-emerald-500/20 pt-2 text-slate-300">
                <span>Recipient</span>
                <a
                  href={getExplorerAddressUrl(selectedChain, recipient)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white hover:text-[var(--purple-1)] font-mono font-medium truncate max-w-[220px] flex items-center gap-1.5 transition-colors cursor-pointer group"
                  title={successReceipt.explorerUrl}
                >
                  <span>{recipient.length > 16 ? `${recipient.slice(0, 8)}...${recipient.slice(-6)}` : recipient}</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            )}

            {/* Special Gasless Celebration Box in Success Receipt */}
            {successReceipt.isGasless && (
              <div
                className="p-3.5 rounded-2xl border space-y-2.5 my-2 animate-fade-in"
                style={{
                  background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(99, 102, 241, 0.08) 100%)',
                  borderColor: 'rgba(16, 185, 129, 0.35)',
                  boxShadow: '0 4px 16px -2px rgba(16, 185, 129, 0.2)',
                }}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 fill-emerald-400" />
                    <span>100% Sponsorlu Gasless İşlem Tamamlandı</span>
                  </span>
                  <span className="text-[10px] font-mono text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-400/30 font-bold">
                    SAVED: $0.00 Gas
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono border-t border-emerald-500/20 pt-2 text-slate-300">
                  <div>
                    <span className="text-slate-400 block text-[10px]">İmza Standardı:</span>
                    <span className="text-white font-semibold">EIP-3009 Auth</span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 block text-[10px]">Kalan Ücretsiz Hak:</span>
                    <span className="text-emerald-300 font-semibold">{successReceipt.remainingQuota}/5 Transfer</span>
                  </div>
                </div>
              </div>
            )}

            {/* Gas Fee Paid */}
            <div className="flex justify-between items-center border-t border-emerald-500/20 pt-2 text-slate-300">
              <span>Gas Fee Paid</span>
              <div className="flex items-center gap-1.5 font-medium text-white">
                <span>{successReceipt.gasFee}</span>
                {successReceipt.gasFee.includes('USDC') ? (
                  <img src={UsdcIcon} alt="USDC" className="w-3.5 h-3.5 object-contain inline-block" />
                ) : successReceipt.gasFee.includes('EURC') ? (
                  <img src={EurcIcon} alt="EURC" className="w-3.5 h-3.5 object-contain inline-block" />
                ) : (
                  CHAIN_NATIVE_MAP[selectedChain]?.symbol && TOKEN_ICONS[CHAIN_NATIVE_MAP[selectedChain].symbol] ? (
                    <img src={TOKEN_ICONS[CHAIN_NATIVE_MAP[selectedChain].symbol]} alt={CHAIN_NATIVE_MAP[selectedChain].symbol} className="w-3.5 h-3.5 object-contain inline-block" />
                  ) : null
                )}
              </div>
            </div>

            {/* Gasless Free Quota Status */}
            {successReceipt.isGasless && (
              <div className="flex justify-between items-center border-t border-emerald-500/20 pt-2 text-slate-300">
                <span>Kalan Günlük Ücretsiz Hak</span>
                <span className="font-mono font-semibold text-emerald-400">
                  {successReceipt.remainingQuota}/5 Transfer Kalan
                </span>
              </div>
            )}

            {/* Memo Section */}
            {successReceipt.memoText && (
              <div className="border-t border-emerald-500/20 pt-2 space-y-1.5">
                <div className="flex justify-between items-center text-slate-300 gap-2">
                  <span>Memo</span>
                  <div className="flex items-center gap-1.5 min-w-0 max-w-[70%] justify-end">
                    <span className="text-white font-medium truncate" title={successReceipt.memoText}>
                      {successReceipt.memoText}
                    </span>
                    {successReceipt.memoIndex && (
                      <span className="text-[12px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold shrink-0">
                        #{successReceipt.memoIndex}
                      </span>
                    )}
                  </div>
                </div>
                {successReceipt.memoId && (
                  <div className="flex justify-between items-center text-slate-300 gap-2 mt-2.5">
                    <span>Memo ID</span>
                    <div className="flex items-center gap-1.5 min-w-0 justify-end font-mono text-[12px]">
                      <span className="text-white font-medium truncate max-w-[180px] sm:max-w-[220px]" title={successReceipt.memoId}>
                        {successReceipt.memoId.slice(0, 10)}...{successReceipt.memoId.slice(-8)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(successReceipt.memoId!)
                          setCopiedReceiptMemoId(true)
                          setTimeout(() => setCopiedReceiptMemoId(false), 2000)
                        }}
                        className="text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer shrink-0 ml-1"
                        title="Copy"
                      >
                        {copiedReceiptMemoId ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Explorer */}
            {successReceipt.explorerUrl && (
              <div className="flex justify-between border-t border-emerald-500/20 pt-2 text-slate-300">
                <span>Explorer</span>
                <a
                  href={successReceipt.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white hover:text-[var(--purple-1)] flex items-center gap-1 font-semibold"
                >
                  <span>View Explorer</span>
                  <ExternalLink className="w4 h-4" />
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
                setEstimatedFee(null)
                setIsSending(false)
              }}
              className="ub-action-btn ub-action-btn-primary flex-1 justify-center py-2.5 text-xs font-semibold"
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>SEND AGAIN</span>
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

  // Send Settings Window / Modal rendered over document.body via Portal
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
                <p className="text-[11px] text-slate-400">Gas & execution priority preferences</p>
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
              onSelectTier={(tier) => setSpeedTier(tier)}
              context="send"
              disabled={isSending}
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
