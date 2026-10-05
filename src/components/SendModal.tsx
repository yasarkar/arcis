import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useClearOnWalletDisconnect } from '../hooks/useClearOnWalletDisconnect'
import {
  X,
  ArrowUpRight,
  AlertTriangle,
  Settings,
  Wallet,
  Zap,
  FileText,
  ChevronDown,
  Ban,
  Shield,
} from 'lucide-react'
import { NetworkIcon } from '@web3icons/react/dynamic'
import UsdcIcon from '../assets/Token-Icon/USDC Token.svg'
import EurcIcon from '../assets/Token-Icon/EURC Token.svg'
import CircleIcon from '../assets/Token-Icon/CIRCLE Token.svg'
import { formatUnits, erc20Abi, isAddress } from 'viem'
import { getResilientPublicClient, getArcPublicClient, resilientGetBalance, resilientReadContract } from '../services/rpc'
import { getDisplayTokenSymbol, CHAIN_NATIVE_MAP } from '../utils/tokenUtils'
import { useGatewayBalance } from '../hooks/useGatewayBalance'
import { useWalletTestnetBalances } from '../hooks/useWalletTestnetBalances'
import { estimateGas, sendToken, resolveNativeActualFee } from '../services/sendService'
import { ensureNetwork } from '../services/chainSwitchService'
import { sendUsdcWithMemo } from '../services/memoService'
import { MEMO_PRESETS, type MemoPreset } from '../config/memoConfig'
import { transferFromGateway } from '../services/gatewayService'
import { GATEWAY_DOMAINS, USDC_ADDRESSES, EURC_ADDRESSES } from '../config/gatewayConfig'
import {
  SUPPORTED_SEND_CHAINS,
  CHAIN_DEFS,
  getChainIconId,
  getExplorerTxUrl,
} from '../config/sendConfig'
import { addTransaction } from '../utils/history'
import { normalizeCircleBlockchain, isCircleUcwChain } from '../utils/circleBlockchain'
import { gatewayMaxFeeUsdc } from '../utils/bridgeAmountUtils'
import { normalizeAppError } from '../utils/errorNormalizer'
import { PrivacyLockButton } from './privacy/PrivacyLockButton'
import { useBroadcast } from './BroadcastNotification'
import { SpeedFeeSelector } from './common/SpeedFeeSelector'
import { Tooltip } from './common/Tooltip'
import {
  SPEED_TIERS,
  getDynamicArcGasOptions,
  arcTransferFeeFallbackUsdc,
  resolveArcActualFeeUsdc,
  ARC_GAS_LIMITS,
  type SpeedTier,
} from '../config/feeTiers'
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
import { useLiveTokenPrices, formatFiatEstimate } from '../hooks/useLiveTokenPrices'

const TOKEN_ICONS: Record<string, string> = {
  USDC: UsdcIcon,
  EURC: EurcIcon,
  cirBTC: CircleIcon,
}

/**
 * Formats the exact base + priority fee split of a resolved actual fee — the same
 * breakdown ArcScan displays under "Transaction fee". Returns '' when the split
 * could not be resolved so the receipt stays honest.
 */
function formatFeeSplit(fee: {
  baseFeeUsdcExact?: string | null
  priorityFeeUsdcExact?: string | null
}): string {
  if (!fee?.baseFeeUsdcExact || !fee?.priorityFeeUsdcExact) return ''
  const base = Number(fee.baseFeeUsdcExact)
  const priority = Number(fee.priorityFeeUsdcExact)
  if (!Number.isFinite(base) || !Number.isFinite(priority)) return ''
  return ` (Base: ${base.toFixed(5)} + Priority: ${priority.toFixed(5)})`
}

/**
 * Composes the receipt "Network Fee" display: the actual paid fee whenever it can
 * be resolved — Arc in USDC (same ArcScan model), every other EVM chain in its
 * native currency from its own receipt (gasUsed × effectiveGasPrice) — with
 * honest estimate/fallback text otherwise.
 */
export async function buildActualFeeDisplay(opts: {
  chainKey: string
  txHash: string
  arcFallback: string
  nativeFallback?: string
}): Promise<string> {
  const nativeSymbol = CHAIN_NATIVE_MAP[opts.chainKey]?.symbol || 'native gas'
  if (opts.chainKey === 'Arc_Testnet') {
    const actualFee = await resolveArcActualFeeUsdc(opts.txHash)
    return actualFee.feeUsdcExact
      ? `${actualFee.feeUsdcExact} USDC${formatFeeSplit(actualFee)}`
      : `~${opts.arcFallback} USDC (estimate, receipt unavailable)`
  }
  const nativeFee = await resolveNativeActualFee(opts.txHash, opts.chainKey)
  if (nativeFee.feeExact) {
    return `${truncateDecimalString(nativeFee.feeExact, 9)} ${nativeFee.symbol}`
  }
  return opts.nativeFallback || `Paid in ${nativeSymbol} (fee could not be resolved)`
}

/** Formats a positive number as a decimal string truncated (never rounded up) to
 * `decimals` fractional digits — safe for MAX/percentage amounts. */
export function truncateToDecimal(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  const safeDecimals = Math.min(Math.max(decimals, 0), 18)
  const factor = 10 ** safeDecimals
  const truncated = Math.floor(value * factor) / factor
  const fixed = truncated.toFixed(safeDecimals)
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}

/** Truncates an exact decimal string (e.g. from formatUnits) without rounding. */
export function truncateDecimalString(raw: string, decimals: number): string {
  const [intPart, fracPart = ''] = raw.split('.')
  const cut = fracPart.slice(0, decimals).replace(/0+$/, '')
  return cut ? `${intPart}.${cut}` : intPart
}

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/

/** Strict amount check: plain decimal notation only, bounded fractional digits, > 0. */
export function isValidAmountInput(raw: string, maxDecimals: number): boolean {
  const trimmed = raw.trim()
  if (!AMOUNT_PATTERN.test(trimmed)) return false
  const dot = trimmed.indexOf('.')
  if (dot >= 0 && trimmed.length - dot - 1 > maxDecimals) return false
  return parseFloat(trimmed) > 0
}

const SOLANA_BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const INJECTIVE_BECH32_PATTERN = /^inj1[02-9ac-hj-np-z]{38,}$/

export function isValidEvmAddress(addr: string): boolean {
  return isAddress(addr, { strict: true })
}

export function isValidSolanaAddress(addr: string): boolean {
  return SOLANA_BASE58_PATTERN.test(addr)
}

export function isValidInjectiveAddress(addr: string): boolean {
  return INJECTIVE_BECH32_PATTERN.test(addr)
}

// Circle UCW blockchain mapping and the Gateway max-fee floor moved to the
// shared single source of truth:
//   src/utils/circleBlockchain.ts   (normalizeCircleBlockchain, isCircleUcwChain)
//   src/utils/bridgeAmountUtils.ts  (gatewayMaxFeeUsdc)
// Keep using those imports everywhere so the Send and Bridge flows can never
// disagree about which chain a transfer is signed on.

/** Resolves the appropriate tokenAddress parameter for Circle UCW transfers */
export function resolveUcwTokenAddress(
  chain: string,
  tokenSymbol: string,
  isCustomToken: boolean,
  customAddress?: string
): string {
  if (isCustomToken && customAddress) {
    return customAddress
  }
  if (tokenSymbol === 'NATIVE') {
    return ''
  }
  if (tokenSymbol === 'USDC') {
    // Arc Testnet uses native USDC for gas, so empty string represents native currency
    if (chain === 'Arc_Testnet') {
      return ''
    }
    return USDC_ADDRESSES[chain] || ''
  }
  if (tokenSymbol === 'EURC') {
    return EURC_ADDRESSES[chain] || ''
  }
  return ''
}

/** Minimal EIP-1193 provider surface used by the send flows. */
export interface Eip1193ProviderLike {
  request(args: { method: string; params?: unknown }): Promise<unknown>
}

interface CustomTokenInfo {
  address: string
  symbol: string
  decimals: number
  balance: string
}

interface SendReceiptState {
  txHash: string
  explorerUrl?: string
  gasFee: string
  blockNumber: string
  memoText?: string
  memoId?: string
}

/** Cryptographically random suffix for generated memo reference ids. */
function randomRefSuffix(): string {
  try {
    const bytes = new Uint8Array(4)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return Math.random().toString(36).slice(2, 8)
  }
}

interface SendModalProps {
  isOpen: boolean
  isInline?: boolean
  onClose: () => void
  connectedAddress: string
  provider: Eip1193ProviderLike | null
  authSource?: 'passkey' | 'ucw' | 'evm' | null
  executeUcwTransfer?: (params: {
    destinationAddress: string
    amount: string
    tokenId?: string
    tokenAddress?: string
    tokenSymbol?: string
    blockchain?: string
    feeLevel?: 'LOW' | 'MEDIUM' | 'HIGH'
  }) => Promise<{ success: boolean; txHash?: string; error?: string }>
  onSuccess?: (amount?: string, txHash?: string) => void
}

export default function SendModal({
  isOpen,
  isInline = false,
  onClose,
  connectedAddress,
  provider,
  authSource,
  executeUcwTransfer,
  onSuccess,
}: SendModalProps) {
  const { addBroadcast, updateBroadcast } = useBroadcast()
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // Live Token Prices
  const { data: tokenPrices } = useLiveTokenPrices()

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

  // Fallback to Arc Testnet if UCW wallet is connected and an unsupported non-EVM chain is selected
  useEffect(() => {
    if (authSource === 'ucw' && selectedChain.toLowerCase().includes('solana')) {
      setSelectedChain('Arc_Testnet')
    }
  }, [authSource, selectedChain])

  // Circle UCW can only execute on whitelisted chains (Solana additionally stays
  // EVM-only); unsupported chains are disabled so a transfer can never be signed
  // for the wrong blockchain.
  const availableSendChains = useMemo(() => {
    if (authSource === 'ucw') {
      return SUPPORTED_SEND_CHAINS.map((c) => {
        const isSolana = c.chain.toLowerCase().includes('solana')
        const supported = isCircleUcwChain(c.chain)
        return {
          ...c,
          disabled: isSolana || !supported,
          disabledReason: isSolana
            ? 'EVM Only'
            : supported
            ? undefined
            : 'Not supported by Circle UCW',
        }
      })
    }
    return SUPPORTED_SEND_CHAINS
  }, [authSource])

  // Address validation helpers (EVM checksum, Solana base58, Injective bech32)
  // live at module scope above so they can be unit tested.

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
  const [customTokenResult, setCustomTokenResult] = useState<CustomTokenInfo | null>(null)
  const [customTokenError, setCustomTokenError] = useState<string | null>(null)
  const [isInspectingCustomToken, setIsInspectingCustomToken] = useState(false)
  const [isSending, setIsSending] = useState(false)

  const [successReceipt, setSuccessReceipt] = useState<SendReceiptState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCanceledError, setIsCanceledError] = useState(false)

  const [estimatedFee, setEstimatedFee] = useState<string | null>(null)
  const [nativeBalance, setNativeBalance] = useState('0.00')

  // Arc Transaction Memo State
  const [showMemoPanel, setShowMemoPanel] = useState(false)
  const [memoText, setMemoText] = useState('')
  const [customMemoId, setCustomMemoId] = useState('')
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)

  // Systematic input and state clearing on wallet disconnect
  const resetFormInputs = useCallback(() => {
    setAmount('')
    setRecipient('')
    setRecipientError(null)
    setCustomTokenAddress('')
    setCustomTokenResult(null)
    setCustomTokenError(null)
    setMemoText('')
    setCustomMemoId('')
    setSelectedPresetId(null)
    setShowMemoPanel(false)
    setShowSettings(false)
    setShowTokenModal(false)
    setShowChainModal(false)
    setEstimatedFee(null)
    setError(null)
    setIsCanceledError(false)
    setSuccessReceipt(null)
    setIsSending(false)
  }, [])

  // Wallet-disconnect cleanup runs through the shared clear event the app
  // dispatches (WALLET_DISCONNECT_CLEAR_EVENT) — a single mechanism, no
  // duplicate connectedAddress reset effect.
  useClearOnWalletDisconnect(resetFormInputs)

  const handleRecipientBlur = () => {
    setRecipientError(
      recipient && !recipientIsValid
        ? `Invalid address for ${selectedChain.replace(/_/g, ' ')}`
        : null
    )
  }

  const handleSelectMemoPreset = (preset: MemoPreset) => {
    setSelectedPresetId(preset.id)
    setMemoText(preset.text)
    if (preset.refIdPrefix) {
      setCustomMemoId(`${preset.refIdPrefix}-${randomRefSuffix()}`)
    }
  }

  const handleClearMemo = () => {
    setSelectedPresetId(null)
    setMemoText('')
    setCustomMemoId('')
  }

  // The Arc transaction memo only applies to direct USDC transfers on Arc — clear
  // it the moment that context is left so it is never silently dropped.
  const isMemoContext =
    selectedChain === 'Arc_Testnet' && sendMode === 'direct' && token === 'USDC' && !isCustom
  useEffect(() => {
    if (!isMemoContext && (memoText || customMemoId || selectedPresetId || showMemoPanel)) {
      setMemoText('')
      setCustomMemoId('')
      setSelectedPresetId(null)
      setShowMemoPanel(false)
    }
  }, [isMemoContext, memoText, customMemoId, selectedPresetId, showMemoPanel])

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

  // Amount precision rules per token (custom tokens expose their own decimals).
  const amountDecimals = isCustom
    ? customTokenResult?.decimals ?? 18
    : token === 'NATIVE'
    ? CHAIN_NATIVE_MAP[selectedChain]?.decimals ?? 18
    : token === 'cirBTC'
    ? 8
    : 6

  // Gas is debited from the transferred asset itself when the native currency is
  // being sent (NATIVE anywhere, native USDC on Arc) — reserve it in the checks.
  const feeInSentAsset =
    sendMode === 'direct' &&
    !isCustom &&
    (token === 'NATIVE' || (selectedChain === 'Arc_Testnet' && token === 'USDC'))

  // Circle Gateway draws amount + maxFee (min 1.0 USDC) from the source domain —
  // reserve it the same way as gas-in-sent-asset so MAX / the balance check stay honest.
  const gatewayFeeReserve =
    sendMode === 'gateway' ? gatewayMaxFeeUsdc(parseFloat(activeBalance) || 0) : 0

  const feeReserve = feeInSentAsset
    ? parseFloat(
        estimatedFee ||
          (selectedChain === 'Arc_Testnet' ? arcTransferFeeFallbackUsdc(token, false, speedTier) : '0')
      ) || 0
    : gatewayFeeReserve

  // Balance sufficiency check (Direct transfer has 0 platform fee; gas is reserved
  // above when it is paid from the transferred asset itself).
  const isInsufficient = amount
    ? parseFloat(amount) + feeReserve > parseFloat(activeBalance)
    : false

  // Spendable balance after reserving that gas fee — used by MAX / quick percentages.
  const spendableBalance = Math.max((parseFloat(activeBalance) || 0) - feeReserve, 0)

  // Fetch native token balance from RPC when "NATIVE" is selected in Direct mode
  useEffect(() => {
    if (!connectedAddress || !isOpen) return

    if (sendMode !== 'direct' || isCustom) return

    let isMounted = true
    const fetchNativeBal = async () => {
      try {
        const rpcClient = getResilientPublicClient(selectedChain)
        const bal = await resilientGetBalance(rpcClient, { address: connectedAddress as `0x${string}` })
        const decimals = CHAIN_NATIVE_MAP[selectedChain]?.decimals || 18
        const formatted = truncateDecimalString(formatUnits(bal, decimals), 8)
        if (isMounted) {
          setNativeBalance(formatted)
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
  }, [selectedChain, token, isCustom, connectedAddress, isOpen, sendMode])

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
      // Debounce so typing does not fire an RPC round trip per keystroke.
      await new Promise((resolve) => setTimeout(resolve, 400))
      if (!isMounted) return
      try {
        const client = getResilientPublicClient(selectedChain)

        const [symbol, decimals, balance] = await Promise.all([
          resilientReadContract(client, {
            address: trimmedAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: 'symbol',
          }),
          resilientReadContract(client, {
            address: trimmedAddress as `0x${string}`,
            abi: erc20Abi,
            functionName: 'decimals',
          }),
          connectedAddress
            ? resilientReadContract(client, {
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
            balance: truncateDecimalString(formatUnits(balance, Number(decimals)), Math.min(Number(decimals), 8)),
          })
          setIsInspectingCustomToken(false)
        }
      } catch (err) {
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
      // Debounce so typing does not fire a fee estimation round trip per keystroke.
      await new Promise((resolve) => setTimeout(resolve, 400))
      if (!isMounted) return
      if (sendMode === 'gateway') {
        setEstimatedFee('0.00')
        return
      }
      try {
        if (selectedChain === 'Arc_Testnet') {
          const isMemo = memoText.trim().length > 0
          const isNativeUsdc = token === 'USDC'
          const gasLimit = isMemo
            ? ARC_GAS_LIMITS.memoTransfer
            : isNativeUsdc
              ? ARC_GAS_LIMITS.nativeTransfer
              : ARC_GAS_LIMITS.erc20Transfer

          // 1. Highest-fidelity source: the same execution engine that will broadcast the tx
          //    (Circle AppKit estimateSend) — its pricing matches what the signer applies.
          // 2. Live Arc dynamic base fee (EIP-1559 heuristic) as second preference.
          // 3. Static tier fallback only when no live source is reachable.
          let quoted: string | null = null
          if (provider && recipientIsValid) {
            try {
              const engineQuote = await estimateGas(
                provider,
                selectedChain,
                isCustom ? customTokenAddress : token,
                recipient,
                amount || '1'
              )
              const feeNum = engineQuote?.fee ? parseFloat(formatUnits(BigInt(engineQuote.fee), 18)) : 0
              if (feeNum > 0) quoted = feeNum.toFixed(5)
            } catch {
              // Engine quote unavailable — fall through to the dynamic base-fee estimate.
            }
          }
          if (!quoted) {
            const gasRes = await getDynamicArcGasOptions(undefined, speedTier, gasLimit)
            quoted = gasRes.estimatedCostUsdc
          }
          if (isMounted) {
            setEstimatedFee(quoted)
          }
        } else if (!provider) {
          if (isMounted) setEstimatedFee(null)
        } else {
          const gasRes = await estimateGas(
            provider,
            selectedChain,
            isCustom ? customTokenAddress : token,
            recipientIsValid ? recipient : undefined,
            amount || '1'
          )
          if (isMounted) setEstimatedFee(null)
          if (isMounted && gasRes?.fee) {
            const nativeInfo = CHAIN_NATIVE_MAP[selectedChain]
            const decimals = nativeInfo?.decimals ?? 18
            const formatted = formatUnits(BigInt(gasRes.fee), decimals)
            const feeNum = parseFloat(formatted)
            setEstimatedFee(feeNum > 0 ? feeNum.toFixed(5) : null)
          }
        }
      } catch (err) {
        if (isMounted) {
          setEstimatedFee(
            selectedChain === 'Arc_Testnet'
              ? arcTransferFeeFallbackUsdc(token, memoText.trim().length > 0, speedTier)
              : null
          )
        }
      }
    }

    calculateFee()
    return () => {
      isMounted = false
    }
  }, [
    isOpen,
    amount,
    sendMode,
    selectedChain,
    provider,
    token,
    customTokenAddress,
    isCustom,
    recipient,
    recipientIsValid,
    speedTier,
    memoText,
  ])

  // Reset modal state on open
  useEffect(() => {
    if (isOpen) {
      setIsSending(false)
      setSuccessReceipt(null)
      setError(null)
      setIsCanceledError(false)
      setEstimatedFee(null)
      setShowSettings(false)
    }
  }, [isOpen])

  // ESC: close the Settings overlay first, otherwise close the modal (never
  // while a nested selector modal owns the keyboard).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (showSettings) {
        setShowSettings(false)
        return
      }
      if (showTokenModal || showChainModal) return
      if (!isInline && isOpen) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showSettings, showTokenModal, showChainModal, isInline, isOpen, onClose])

  // Modal-mode accessibility: background scroll lock, initial focus and Tab trap
  useEffect(() => {
    if (isInline || !isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const node = dialogRef.current
    node?.focus()
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !node) return
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
        )
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || active === node || !node.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !node.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleTab)
    return () => {
      window.removeEventListener('keydown', handleTab)
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen, isInline])

  // Send execution
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSending) return
    setError(null)
    setIsCanceledError(false)
    setSuccessReceipt(null)

    if (!recipientIsValid) {
      const recipientMsg = `Please enter a valid recipient address for ${selectedChain.replace(/_/g, ' ')}`
      setError(recipientMsg)
      setRecipientError(recipientMsg)
      setIsCanceledError(false)
      return
    }

    const maxAmountDecimals = sendMode === 'gateway' ? 6 : amountDecimals
    if (!isValidAmountInput(amount, maxAmountDecimals)) {
      setError(`Please enter a valid amount (max ${maxAmountDecimals} decimal places)`)
      setIsCanceledError(false)
      return
    }

    const sendAmt = parseFloat(amount)
    if (isNaN(sendAmt) || sendAmt <= 0) {
      setError('Please enter a valid amount')
      setIsCanceledError(false)
      return
    }

    if (sendMode === 'direct' && isCustom && (!customTokenAddress || !customTokenResult || isInspectingCustomToken)) {
      setError(
        customTokenAddress
          ? 'Custom token contract has not been verified yet. Wait for the inspection to complete.'
          : 'Please enter a valid custom token address'
      )
      setIsCanceledError(false)
      return
    }

    setIsSending(true)

    const displayToken = isCustom
      ? customTokenResult?.symbol || 'Custom Token'
      : getDisplayTokenSymbol(selectedChain, token)
    const tokenIcon = isCustom ? undefined : TOKEN_ICONS[token] || TOKEN_ICONS[displayToken]
    const effectiveToken = sendMode === 'gateway' ? 'USDC' : displayToken

    const broadcastId = addBroadcast({
      type: 'send',
      title: sendMode === 'gateway' ? `Sending ${effectiveToken} via Gateway...` : `Sending ${displayToken}...`,
      status: 'pending',
      badgeText: 'Pending',
      details: {
        amount,
        tokenSymbol: effectiveToken,
        tokenIcon: sendMode === 'gateway' ? TOKEN_ICONS.USDC : tokenIcon,
        recipient,
        network: selectedChain,
        memo: isMemoContext && memoText.trim() ? memoText.trim() : undefined,
      },
    })

    // ── 1. Circle User-Controlled Wallet (UCW) Pathway ────────
    if (authSource === 'ucw') {
      if (!executeUcwTransfer) {
        const errorText = 'Wallet transfer handler is not initialized. Please refresh or re-authenticate.'
        setError(errorText)
        setIsSending(false)
        updateBroadcast(broadcastId, {
          type: 'send',
          title: 'Transfer Failed',
          status: 'failed',
          badgeText: 'Failed',
          message: errorText,
          details: {
            amount,
            tokenSymbol: displayToken,
            tokenIcon,
            recipient,
            network: selectedChain,
          },
        })
        return
      }

      try {
        const circleFeeLevel: 'LOW' | 'MEDIUM' | 'HIGH' =
          speedTier === 'turbo' ? 'HIGH' : speedTier === 'fast' ? 'MEDIUM' : 'LOW'
        const circleBlockchain = normalizeCircleBlockchain(selectedChain)
        const resolvedToken = isCustom ? customTokenResult?.symbol || activeToken : activeToken
        const resolvedAddress = resolveUcwTokenAddress(
          selectedChain,
          resolvedToken,
          isCustom,
          customTokenAddress
        )

        const ucwResult = await executeUcwTransfer({
          destinationAddress: recipient,
          amount,
          tokenSymbol: resolvedToken,
          tokenAddress: resolvedAddress,
          blockchain: circleBlockchain,
          feeLevel: circleFeeLevel,
        })

        if (!ucwResult.success) {
          throw new Error(ucwResult.error || 'Transfer authorization was canceled or failed.')
        }
        const txHash = ucwResult.txHash || ''

        const explorerUrl = txHash ? getExplorerTxUrl(selectedChain, txHash) : undefined
        const gasFeeText = await buildActualFeeDisplay({
          chainKey: selectedChain,
          txHash,
          arcFallback: arcTransferFeeFallbackUsdc('USDC'),
        })

        setSuccessReceipt({
          txHash,
          explorerUrl,
          gasFee: gasFeeText,
          blockNumber: 'Circle MPC Confirmed',
        })
        // Keep the form locked until the receipt is on screen — unlocking earlier
        // re-enabled the form mid-await and allowed a second (double) send.
        setIsSending(false)

        updateBroadcast(broadcastId, {
          type: 'send',
          title: `${displayToken} Transferred Successfully`,
          status: 'success',
          badgeText: 'Confirmed',
          details: {
            amount,
            tokenSymbol: displayToken,
            tokenIcon,
            recipient,
            network: selectedChain,
            txHash,
            explorerUrl,
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
        return
      } catch (err) {
        console.error('[SendModal] Circle UCW transfer failed:', err)
        const normalized = normalizeAppError(err)
        const isCanceled = normalized.isCanceled
        const errMsg = normalized.message || (err instanceof Error ? err.message : '') || 'Transfer failed'

        setError(errMsg)
        setIsSending(false)
        setIsCanceledError(isCanceled)

        const status = isCanceled ? 'canceled' : 'failed'
        const title = isCanceled ? 'Transfer Cancelled' : 'Transfer Failed'
        const badgeText = isCanceled ? 'Canceled' : 'Failed'

        updateBroadcast(broadcastId, {
          type: 'send',
          title,
          status,
          badgeText,
          message: errMsg,
          details: {
            amount,
            tokenSymbol: displayToken,
            tokenIcon,
            recipient,
            network: selectedChain,
          },
        })
        return
      }
    }

    // ── 2. Standard Browser EIP-1193 Provider Pathway (MetaMask, Rabby, Wagmi, etc.) ──
    if (provider) {
      try {
        if (sendMode === 'gateway') {
          if (GATEWAY_DOMAINS[selectedChain] === undefined) {
            const errorText = `Bridge is not supported on ${selectedChain.replace(/_/g, ' ')}.`
            setError(errorText)
            setIsSending(false)
            updateBroadcast(broadcastId, {
              type: 'send',
              title: 'Gateway Send Failed',
              status: 'failed',
              badgeText: 'Failed',
              message: errorText,
              details: {
                amount,
                tokenSymbol: 'USDC',
                tokenIcon: TOKEN_ICONS.USDC,
                recipient,
                network: selectedChain,
              },
            })
            return
          }

          // Circle Gateway draws the transfer from a single source domain whose
          // balance must cover amount + maxFee (min 1.0 USDC; cross-domain adds
          // 0.005% + 0.05 USDC gas buffer). Prefer the destination chain, then the
          // first domain that fully covers the transfer.
          const requiredGatewayBalance = (chainKey: string) =>
            sendAmt +
            (GATEWAY_DOMAINS[chainKey] === GATEWAY_DOMAINS[selectedChain]
              ? 1 // same-domain: transfer fee is 0, so maxFee is exactly the 1.0 floor
              : gatewayMaxFeeUsdc(sendAmt))
          const coveringSources = gatewayBalances.filter(
            (b) =>
              GATEWAY_DOMAINS[b.chainKey] !== undefined &&
              parseFloat(b.balance) >= requiredGatewayBalance(b.chainKey)
          )
          const sourceBalItem =
            coveringSources.find((b) => b.chainKey === selectedChain) || coveringSources[0]
          if (!sourceBalItem && gatewayBalances.length > 0) {
            const largestDomainBalance = gatewayBalances.reduce(
              (max, b) => Math.max(max, parseFloat(b.balance) || 0),
              0
            )
            const errorText =
              `No single Gateway network covers ${amount} USDC plus up to ` +
              `${gatewayMaxFeeUsdc(sendAmt).toFixed(2)} USDC Gateway max fee. ` +
              (largestDomainBalance > 0
                ? `Largest balance on one network: ${largestDomainBalance.toFixed(2)} USDC — reduce the amount or consolidate balances first.`
                : 'No confirmed Gateway balance is available yet.')
            setError(errorText)
            setIsSending(false)
            updateBroadcast(broadcastId, {
              type: 'send',
              title: 'Gateway Send Failed',
              status: 'failed',
              badgeText: 'Failed',
              message: errorText,
              details: {
                amount,
                tokenSymbol: 'USDC',
                tokenIcon: TOKEN_ICONS.USDC,
                recipient,
                network: selectedChain,
              },
            })
            return
          }
          const effectiveSourceChain =
            sourceBalItem?.chainKey ||
            (GATEWAY_DOMAINS[selectedChain] !== undefined ? selectedChain : 'Arc_Testnet')

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

          const explorerUrl = txHash ? getExplorerTxUrl(selectedChain, txHash) : undefined

          const isSameDomain =
            GATEWAY_DOMAINS[effectiveSourceChain] === GATEWAY_DOMAINS[selectedChain]
          setSuccessReceipt({
            txHash,
            explorerUrl,
            gasFee: isSameDomain
              ? '0% Gateway transfer fee (same-domain)'
              : `0.005% Gateway transfer fee ≈ ${(sendAmt * 0.00005).toFixed(6)} USDC (max fee buffer reserved)`,
            blockNumber: 'Instant Gateway Finalized',
          })
          setIsSending(false)

          updateBroadcast(broadcastId, {
            type: 'send',
            title: `${displayToken} Transferred Successfully`,
            status: 'success',
            badgeText: 'Confirmed',
            details: {
              amount,
              tokenSymbol: 'USDC',
              tokenIcon: TOKEN_ICONS.USDC,
              recipient,
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
            tokenSymbol: 'USDC',
            sourceChain: effectiveSourceChain,
            destChain: selectedChain,
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
            const memoResult = await sendUsdcWithMemo(
              provider,
              recipient,
              amount,
              memoText.trim(),
              customMemoId.trim() || undefined,
              speedTier
            )
            const txHash = memoResult.txHash

            const explorerUrl = txHash ? getExplorerTxUrl(selectedChain, txHash) : undefined
            const actualFee = await resolveArcActualFeeUsdc(txHash)

            setSuccessReceipt({
              txHash,
              explorerUrl,
              gasFee: actualFee.feeUsdcExact
                ? `${actualFee.feeUsdcExact} USDC${formatFeeSplit(actualFee)}`
                : memoResult.gasFeeUsdc
                  ? `${memoResult.gasFeeUsdc} USDC`
                  : `~${arcTransferFeeFallbackUsdc('USDC', true)} USDC (estimate, receipt unavailable)`,
              blockNumber: memoResult.blockNumber.toString(),
              memoText: memoResult.memoText,
              memoId: memoResult.memoId,
            })
            setIsSending(false)

            updateBroadcast(broadcastId, {
              type: 'send',
              title: `${displayToken} Transferred Successfully`,
              status: 'success',
              badgeText: 'Confirmed',
              details: {
                amount,
                tokenSymbol: displayToken,
                tokenIcon,
                recipient,
                network: selectedChain,
                memo: memoText.trim(),
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
          } else {
            const result = await sendToken(provider, selectedChain, activeToken, recipient, amount)
            const txHash = result.txHash || ''

            const explorerUrl = txHash ? getExplorerTxUrl(selectedChain, txHash) : undefined
            const gasFeeText = await buildActualFeeDisplay({
              chainKey: selectedChain,
              txHash,
              arcFallback: estimatedFee || arcTransferFeeFallbackUsdc(activeToken),
              nativeFallback: estimatedFee
                ? `~${estimatedFee} ${CHAIN_NATIVE_MAP[selectedChain]?.symbol || 'native gas'} (estimate, fee not yet resolved)`
                : undefined,
            })

            setSuccessReceipt({
              txHash,
              explorerUrl,
              gasFee: gasFeeText,
              blockNumber: 'Instant BFT Finalized',
            })
            setIsSending(false)

            updateBroadcast(broadcastId, {
              type: 'send',
              title: `${displayToken} Transferred Successfully`,
              status: 'success',
              badgeText: 'Confirmed',
              details: {
                amount,
                tokenSymbol: displayToken,
                tokenIcon,
                recipient,
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
      } catch (err) {
        console.error('[SendModal] Token transfer failed:', err)
        const normalized = normalizeAppError(err)
        const isCanceled = normalized.isCanceled
        const errMsg = normalized.message

        setError(errMsg)
        setIsSending(false)
        setIsCanceledError(isCanceled)

        const status = isCanceled ? 'canceled' : 'failed'
        const title = isCanceled
          ? (sendMode === 'gateway' ? 'Gateway Send Canceled' : 'Sending Canceled')
          : (sendMode === 'gateway' ? 'Gateway Send Failed' : (normalized.title || 'Transfer Failed'))
        const badgeText = isCanceled ? 'Canceled' : 'Failed'

        updateBroadcast(broadcastId, {
          type: 'send',
          title,
          status,
          badgeText,
          message: errMsg,
          details: {
            amount,
            tokenSymbol: sendMode === 'gateway' ? 'USDC' : displayToken,
            tokenIcon: sendMode === 'gateway' ? TOKEN_ICONS.USDC : tokenIcon,
            recipient,
            network: selectedChain,
            memo: isMemoContext && memoText.trim() ? memoText.trim() : undefined,
          },
        })
      }
    } else {
      const errorText = 'No wallet provider found. Please connect your Web3 wallet or log in with Circle.'
      setError(errorText)
      setIsSending(false)
      updateBroadcast(broadcastId, {
        type: 'send',
        title: 'Wallet Disconnected',
        status: 'failed',
        badgeText: 'Failed',
        message: errorText,
        details: {
          amount,
          tokenSymbol: displayToken,
          tokenIcon,
          recipient,
          network: selectedChain,
        },
      })
    }
  }

  // Quick percentage handler (truncated, gas-reserve aware)
  const handleQuickPercentage = (pct: number) => {
    if (!Number.isFinite(spendableBalance) || spendableBalance <= 0) return
    const calculated = (spendableBalance * pct) / 100
    setAmount(truncateToDecimal(calculated, amountDecimals))
  }

  // Token list for selector modal (includes the chain's native asset when it is
  // a distinct token from the listed stablecoins; custom ERC-20 import is offered
  // by the modal itself).
  const tokenList: TokenItem[] = useMemo(() => {
    const list: TokenItem[] = [
      { symbol: 'USDC', name: 'USD Coin', icon: TOKEN_ICONS.USDC, balance: usdcWalletBalance },
      { symbol: 'EURC', name: 'Euro Coin', icon: TOKEN_ICONS.EURC, balance: eurcWalletBalance },
      { symbol: 'cirBTC', name: 'Circle Bitcoin', icon: TOKEN_ICONS.cirBTC, balance: cirbtcWalletBalance },
    ]
    const nativeInfo = CHAIN_NATIVE_MAP[selectedChain]
    if (nativeInfo && nativeInfo.symbol !== 'USDC') {
      list.push({ symbol: 'NATIVE', name: `Native ${nativeInfo.name}`, balance: nativeBalance })
    }
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
    const chainDisplayName = selectedChain.replace(/_/g, ' ')
    const chainIconId = getChainIconId(selectedChain)
    const amtNum = parseFloat(amount || '0')

    const items: BreakdownItem[] = [
      {
        label: 'Destination Network',
        tooltip: 'The blockchain network where the recipient will receive the assets.',
        value: (
          <div className="flex items-center gap-1.5 font-medium text-slate-200">
            <div className="w-3.5 h-3.5 rounded-full overflow-hidden flex items-center justify-center shrink-0">
              <NetworkIcon
                name={chainIconId}
                variant={chainIconId === 'solana' ? 'branded' : 'background'}
                size={14}
                className="rounded-full"
              />
            </div>
            <span>{chainDisplayName}</span>
            {sendMode === 'gateway' && (
              <span className="text-[11px] font-mono text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1 py-0.2 rounded">
                Gateway
              </span>
            )}
          </div>
        ),
      },
      {
        label: 'Recipient Gets',
        tooltip: 'The exact net amount that will be delivered to the recipient address.',
        value: `${amount && amtNum > 0 ? amount : '0.00'} ${tokenSymbol}`,
        highlight: true,
        highlightColor: 'text-indigo-400',
      },
      {
        label: 'Network Fee',
        tooltip: 'Blockchain transaction gas fee paid in USDC on Arc or native gas on destination.',
        value: sendMode === 'gateway' ? (            '0% same-domain / 0.005% cross-domain (Gateway)'
        ) : estimatedFee ? (
          `${estimatedFee} ${CHAIN_NATIVE_MAP[selectedChain]?.symbol || 'USDC'}`
        ) : selectedChain === 'Arc_Testnet' ? (
          `~${estimatedFee || arcTransferFeeFallbackUsdc(token, false, speedTier)} USDC`
        ) : (
          `<0.001 ${CHAIN_NATIVE_MAP[selectedChain]?.symbol || 'USDC'}`
        ),
      },
      {
        label: 'Platform Fee',
        tooltip: 'Arcis charges 0% platform fee for standard wallet-to-wallet transfers.',
        value: '0.00 USDC (Free)',
      },
      {
        label: 'Estimated Arrival',
        tooltip: 'The estimated time required for the transfer to achieve onchain finality.',
        value:
          sendMode === 'gateway'
            ? '< 1 sec'
            : SPEED_TIERS[speedTier]?.timeEstimate?.arcL1 || '< 5 sec',
      },
      {
        label: 'Total Debited',
        tooltip: 'The total amount that will be deducted from your wallet balance including fees.',
        value: (() => {
          if (!amount || amtNum <= 0) return `0.00 ${tokenSymbol}`
          if (sendMode === 'gateway') {
            return `${amount} ${tokenSymbol}`
          }
          const gasCost = estimatedFee
            ? parseFloat(estimatedFee)
            : selectedChain === 'Arc_Testnet'
            ? parseFloat(arcTransferFeeFallbackUsdc(token, false, speedTier))
            : 0.0005
          if (tokenSymbol === 'USDC' && (selectedChain === 'Arc_Testnet' || !CHAIN_NATIVE_MAP[selectedChain] || CHAIN_NATIVE_MAP[selectedChain]?.symbol === 'USDC')) {
            return `${(amtNum + gasCost).toFixed(selectedChain === 'Arc_Testnet' ? 6 : 4)} USDC`
          }
          return `${amount} ${tokenSymbol} + ${gasCost} ${CHAIN_NATIVE_MAP[selectedChain]?.symbol || 'USDC'}`
        })(),
      },
    ]

    return items
  }, [sendMode, estimatedFee, speedTier, selectedChain, amount, token, tokenSymbol])

  // Dynamic Button State
  const ctaButtonState = useMemo(() => {
    if (!connectedAddress) {
      return { disabled: true, text: 'CONNECT WALLET', loading: false }
    }
    if (!amount || parseFloat(amount) <= 0) {
      return { disabled: true, text: 'ENTER AN AMOUNT', loading: false }
    }
    if (!isValidAmountInput(amount, sendMode === 'gateway' ? 6 : amountDecimals)) {
      return { disabled: true, text: 'INVALID AMOUNT FORMAT', loading: false }
    }
    if (!recipient) {
      return { disabled: true, text: 'ENTER RECIPIENT ADDRESS', loading: false }
    }
    if (!recipientIsValid) {
      return { disabled: true, text: 'INVALID RECIPIENT FORMAT', loading: false }
    }
    if (isCustom && isInspectingCustomToken) {
      return { disabled: true, text: 'INSPECTING TOKEN...', loading: true }
    }
    if (isCustom && !customTokenResult) {
      return { disabled: true, text: 'VERIFY TOKEN CONTRACT', loading: false }
    }
    if (isInsufficient) {
      return { disabled: true, text: `INSUFFICIENT ${tokenSymbol} BALANCE`, loading: false }
    }
    if (isSending) {
      return {
        disabled: true,
        text: 'SENDING...',
        loading: true,
      }
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
    authSource,
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

      {/* Privacy Lock Toggle */}
      <PrivacyLockButton
        isPrivate={isPrivateSend}
        onToggle={() => setIsPrivateSend((prev) => !prev)}
        disabled={isSending || !!successReceipt}
        size="md"
      />

      {/* Settings Toggle */}
      <Tooltip content="Speed & fee preferences" position="bottom" align="end">
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
            setMemoText('')
            setCustomMemoId('')
            setSelectedPresetId(null)
            setShowMemoPanel(false)
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
              setIsCanceledError(false)
              setSuccessReceipt(null)
            }}
            disabled={isSending}
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
            onMaxClick={() => setAmount(truncateToDecimal(spendableBalance, amountDecimals))}
            quickPercentages={[25, 50, 75, 100]}
            onSelectPercentage={handleQuickPercentage}
            fiatEstimate={formatFiatEstimate(amount, tokenSymbol, tokenPrices)}
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
            onBlur={handleRecipientBlur}
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
                  <div className="flex flex-wrap items-center gap-1.5">
                    {MEMO_PRESETS.map((preset) => {
                      const isSelected = selectedPresetId === preset.id
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleSelectMemoPreset(preset)}
                          title={preset.text}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm shadow-indigo-500/10'
                              : 'bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08] border border-white/[0.06]'
                          }`}
                        >
                          <span className="text-[12px]">{preset.icon}</span>
                          <span>{preset.label}</span>
                        </button>
                      )
                    })}
                    {memoText && (
                      <button
                        type="button"
                        onClick={handleClearMemo}
                        className="px-2 py-1 rounded-lg text-[11px] text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 transition-colors ml-auto cursor-pointer"
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
                      onChange={(e) => {
                        setMemoText(e.target.value)
                        if (!e.target.value) {
                          setSelectedPresetId(null)
                        }
                      }}
                      className="w-full rounded-xl px-3 py-2 text-xs text-white bg-white/[0.04] border border-white/[0.08] focus:border-indigo-500/50 focus:outline-none placeholder:text-slate-500"
                    />
                    <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
                      <span>On-chain immutable transfer memo</span>
                      <span>{memoText.length}/120</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Breakdown Accordion - Hidden until amount is entered */}
          {Boolean(amount && parseFloat(amount) > 0) && breakdownItems.length > 0 && (
            <TransactionBreakdown
              summaryTitle="Transfer Breakdown"
              items={breakdownItems}
              defaultOpen={false}
              context="send"
              showItemIcons={false}
              isGatewayMode={sendMode === 'gateway'}
              className="animate-fade-in"
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

      {/* Token Selector Modal */}        <TokenSelectorModal
          isOpen={showTokenModal}
          onClose={() => setShowTokenModal(false)}
          tokens={tokenList}
          selectedToken={token}
          onSelectToken={(sym) => {
            setToken(sym)
            setIsCustom(false)
          }}
          onSelectCustom={() => {
            setIsCustom(true)
            setToken('USDC')
          }}
        />

      {/* Network Selector Modal */}
      <ChainSelectorModal
        isOpen={showChainModal}
        onClose={() => setShowChainModal(false)}
        chains={availableSendChains}
        selectedChain={selectedChain}
        onSelectChain={(chainKey) => {
          setSelectedChain(chainKey)
          setRecipientError(null)
          // Ask the wallet extension to switch networks immediately (with the
          // wallet_addEthereumChain fallback for unregistered testnets) so the
          // send never dies on a stale-network error later.
          if (provider && authSource !== 'ucw') {
            ensureNetwork(chainKey, provider).catch(() => {})
          }
        }}
        getChainIconId={getChainIconId}
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
      {createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Send tokens"
            tabIndex={-1}
            className="w-full max-w-[540px] outline-none"
          >
            {content}
          </div>
        </div>,
        document.body
      )}
      {settingsModalWindow}
    </>
  )
}
